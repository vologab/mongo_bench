import { MongoClient, Db, CollectionAggregationOptions } from "mongodb";
const jsf = require("json-schema-faker");
import * as _ from "lodash";

jsf.extend("faker", () => require("faker"));
const doc = require("./doc.json");

const indexes: string[] = [];

let integerField: string;
let dateField: string;
let categoryField: string;
let stringField: string;
let booleanField: string;

Object.keys(doc.properties)
  .filter(
    k =>
      doc.properties[k].type !== "object" ||
      doc.properties[k].faker === "date.past"
  )
  .forEach(k => {
    if (doc.properties[k].type == "integer" && !integerField) {
      integerField = k;
      //   console.log(`Integer field: ${integerField}`);
    }

    if (
      doc.properties[k].type == "object" &&
      doc.properties[k].faker === "date.past" &&
      !dateField
    ) {
      dateField = k;
      //   console.log(`Date field: ${dateField}`);
    }

    if (
      doc.properties[k].type == "string" &&
      doc.properties[k].enum &&
      !categoryField
    ) {
      categoryField = k;
      //   console.log(`Category field: ${categoryField}`);
    }

    if (
      doc.properties[k].type == "string" &&
      !doc.properties[k].enum &&
      doc.properties[k].faker !== "date.past" &&
      !stringField
    ) {
      stringField = k;
      //   console.log(`String field: ${stringField}`);
    }

    if (doc.properties[k].type == "boolean" && !booleanField) {
      booleanField = k;
      //   console.log(`Boolean field: ${booleanField}`);
    }

    indexes.push(k);
  });

const getConnection = async (): Promise<Db> => {
  const client = await MongoClient.connect(
    process.env.DB_URI || "mongodb://localhost:27017",
    { useNewUrlParser: true }
  );
  return await client.db(process.env.DB_NAME);
};

const DOCUMENTS_COUNT = Number(process.env.DOCUMENTS_COUNT);
const BATCH_SIZE = Number(process.env.INSERT_BATCH_SIZE);
const DOC_SIZE_FACTOR = Number(process.env.DOC_SIZE_FACTOR);
const COLL_NAME = process.env.COLL_NAME;

const aggregationQuery1Fun = (months: number) => [
  {
    $match: {
      [dateField]: {
        $gte: new Date(new Date().setMonth(new Date().getMonth() - months)),
        $lte: new Date(new Date().setMonth(new Date().getMonth()))
      },
      [booleanField]: true
    }
  }
];

const aggregationQuery2 = [
  {
    $sort: { [dateField]: 1 }
  }
];

const aggregationQuery3 = [
  {
    $group: {
      _id: `$${categoryField}`,
      avg_number: { $avg: `$${integerField}` },
      count: { $sum: 1 }
    }
  }
];

const aggregationQueryLimit = [{ $limit: 200 }];

const getQueryTime = async (conn: Db, collection: string, query: object[]) => {
  const t = new Date().valueOf();
  const additionalOptions: CollectionAggregationOptions = {};
  if (process.env.DB_AGGR_ALLOW_DISK_USE === "true") {
    additionalOptions.allowDiskUse = true;
  }
  await conn
    .collection(collection)
    .aggregate(query, additionalOptions)
    .toArray();
  return new Date().valueOf() - t;
};

const getFirstStageSize = async (conn: Db, collection, query) => {
  const countArr = await conn
    .collection(collection)
    .aggregate([query[0], { $count: "count" }])
    .toArray();
  return countArr[0] && countArr[0].count ? countArr[0].count : 0;
};

const measureQueryMultipleTimes = async (conn, collection, query, times) => {
  const stats = [];
  const count = await getFirstStageSize(conn, collection, query);
  for (let i = 0; i < times; i++) {
    stats.push(await getQueryTime(conn, collection, query));
  }
  return { count, stats };
};

const buildIndexes = async (conn: Db, indexes: string[]) => {
  indexes.forEach(async ix => {
    await conn.collection(COLL_NAME).createIndex({ [ix]: 1 });
  });
};

const generate = async (conn: Db) => {
  // Clear old data
  await conn.collection(COLL_NAME).drop();

  // Generate new data
  let documents = [];
  let docInitial;
  let extendedDoc;

  for (let i = 0; i < DOCUMENTS_COUNT; i++) {
    const docInitial = jsf.generate(doc);
    extendedDoc = [...Array(DOC_SIZE_FACTOR).keys()]
      .map(ix => ({
        [`d${ix}`]: docInitial
      }))
      .reduce((a, c) => ({ ...a, ...c }), {});
    const resDoc = { ...docInitial, ...extendedDoc };

    documents.push(resDoc);
    if (!(i % BATCH_SIZE)) {
      await conn.collection(COLL_NAME).insertMany(documents);
      documents = [];
      //   console.log(`Inserted ${BATCH_SIZE} documents`);
    }
  }
};

const getDatabaseStat = async (conn: Db, collection) => {
  // Get dataset statistics
  const statistics = await conn.collection(COLL_NAME).stats();
  return {
    size: statistics.size,
    avgObjSize: statistics.avgObjSize,
    count: statistics.count,
    totalIndexSize: statistics.totalIndexSize
  };
};

const benchmark = async (conn: Db, collection, pipelineBuilder, months) => {
  // Get database/collection statistics
  const dbStat = await getDatabaseStat(conn, COLL_NAME);
  generateReportTitle();
  const results = [];
  for (let m = 0; m < months; m++) {
    await conn.command({ planCacheClear: COLL_NAME });
    generateReport(
      dbStat,
      await measureQueryMultipleTimes(conn, collection, pipelineBuilder(m), 2)
    );
  }
};

const generateReportTitle = () => {
  console.log(
    `Instance, Ram size, Cpu size, Db size, Rows count, Avg Obj size, First stage count, Avg response time, Docs / ms, other response times`
  );
};
const generateReport = (dbStat, r) => {
  console.log(
    `${process.env.INSTANCE_TYPE},${process.env.RAM_SIZE},${
      process.env.CPU_CORES
    },${dbStat.size},${dbStat.count},${dbStat.avgObjSize},${r.count},${_.mean(
      r.stats
    )},${Math.round(r.count / _.mean(r.stats))},${r.stats.join(",")}`
  );
};

const run = async () => {
  const conn = await getConnection();
  if (process.env.GENERATE_DATA === "true") {
    // Start data generation
    await buildIndexes(conn, indexes);
    await generate(conn);
  }

  if (process.env.RUN_BENCHMARK === "true") {
    // Start benchamarking
    const pipeLineBuilder = months => {
      return [
        ...aggregationQuery1Fun(months),
        ...aggregationQuery2,
        ...aggregationQuery3,
        ...aggregationQueryLimit
      ];
    };

    await benchmark(conn, COLL_NAME, pipeLineBuilder, 12);
  }

  process.exit(0);
};

run();
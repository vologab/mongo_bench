const mongodb = require("mongodb");
const jsf = require("json-schema-faker");
const _ = require("lodash");

jsf.extend("faker", () => require("faker"));
const doc = require("./doc.json");

const indexes = [];

let integerField;
let dateField;
let categoryField;
let stringField;
let booleanField;

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

const getConnection = async () => {
  const client = await mongodb.MongoClient.connect(process.env.DB_URI);
  return await client.db(process.env.DB_NAME);
};

const N = 500000;
const BATCH_SIZE = 10000;
const DOC_SIZE_FACTOR = 10;
const COLL_NAME = "agg_perf_test";

const aggregationQuery1Fun = months => [
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
      avg_number: { $avg: `${integerField}` },
      count: { $sum: 1 }
    }
  }
];

const aggregationQueryLimit = [{ $limit: 200 }];

const getQueryTime = async (conn, collection, query) => {
  const t = new Date();
  await conn
    .collection(collection)
    .aggregate(query)
    .toArray();
  return new Date() - t;
};

const getFirstStageSize = async (conn, collection, query) => {
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

const buildIndexes = async (conn, indexes) => {
  indexes.forEach(async ix => {
    await conn.collection(COLL_NAME).createIndex({ [ix]: 1 });
  });
};

const generate = async conn => {
  // Clear old data
  await conn.collection(COLL_NAME).drop();

  // Generate new data
  let documents = [];
  let docInitial;
  let extendedDoc;

  for (let i = 0; i < N; i++) {
    docInitial = jsf.generate(doc);
    extendedDoc = [...Array(DOC_SIZE_FACTOR).keys()]
      .map(ix => ({
        [`d${ix}`]: docInitial
      }))
      .reduce((a, c) => ({ ...a, ...c }), {});
    resDoc = { ...docInitial, ...extendedDoc };

    documents.push(resDoc);
    if (!(i % BATCH_SIZE)) {
      await conn.collection(COLL_NAME).insertMany(documents);
      documents = [];
      //   console.log(`Inserted ${BATCH_SIZE} documents`);
    }
  }
};

const getDatabaseStat = async (conn, collection) => {
  // Get dataset statistics
  const statistics = await conn.collection(COLL_NAME).stats();
  return {
    size: statistics.size,
    avgObjSize: statistics.avgObjSize,
    count: statistics.count,
    totalIndexSize: statistics.totalIndexSize
  };
};

const benchmark = async (conn, collection, pipelineBuilder, months) => {
  const results = [];
  for (let m = 0; m < months; m++) {
    results.push(
      await measureQueryMultipleTimes(conn, collection, pipelineBuilder(m), 10)
    );
  }

  return results;
};

const generateReport = (dbStat, benchResults) => {
  console.log(
    `Instance, Ram size, Cpu size, Db size, Rows count, Avg Obj size, First stage count, Avg response time, Docs / ms, other response times`
  );
  benchResults.forEach(r => {
    console.log(
      `${process.env.INSTANCE_TYPE},${process.env.RAM_SIZE},${
        process.env.CPU_CORES
      },${dbStat.size},${dbStat.count},${dbStat.avgObjSize},${r.count},${_.mean(
        r.stats
      )},${Math.round(r.count / _.mean(r.stats))},${r.stats.join(",")}`
    );
  });
};

const run = async () => {
  const conn = await getConnection();
  if (process.env.GENERATE_DATA === "true") {
    // Start data generation
    await buildIndexes(conn, indexes);
    await generate(conn);
  }

  if (process.env.RUN_BENCHMARK === "true") {
    // Get database/collection statistics
    const dbStat = await getDatabaseStat(conn, COLL_NAME);

    // Start benchamarking
    const pipeLineBuilder = months => {
      return [
        ...aggregationQuery1Fun(months),
        ...aggregationQuery2,
        ...aggregationQuery3,
        ...aggregationQueryLimit
      ];
    };

    const benchResults = await benchmark(conn, COLL_NAME, pipeLineBuilder, 11);
    //console.log(benchResults);

    generateReport(dbStat, benchResults);
  }

  process.exit(0);
};

run();

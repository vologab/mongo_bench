import { MongoClient, Db, CollectionAggregationOptions } from "mongodb";
import * as _ from "lodash";
import { getQueryFields, docGenerate, extendDoc } from "./doc_utils";
import { getSysLoadData } from "./sys_utils";
const doc = require("./doc.json");

let {integerField, dateField, categoryField, stringField, booleanField} = getQueryFields(doc);
const indexes: string[] = [integerField, dateField, categoryField, stringField, booleanField];


const getConnection = async (): Promise<Db> => {
  const client = await MongoClient.connect(
    process.env.DB_URI || "mongodb://localhost:27017",
    { connectTimeoutMS: 700000, socketTimeoutMS: 700000, useNewUrlParser: true }
  );
  return await client.db(process.env.DB_NAME);
};

const DOCUMENTS_COUNT = Number(process.env.DOCUMENTS_COUNT);
const BATCH_SIZE = Number(process.env.INSERT_BATCH_SIZE);
const DOC_SIZE_FACTOR = Number(process.env.DOC_SIZE_FACTOR);
const COLL_NAME = process.env.COLL_NAME;

const aggregationQuery1Fun = (daysAgo: number) => [
  {
    $match: {
      [dateField]: {
        $gte: new Date((new Date()).getTime() - (daysAgo * 24 * 60 * 60 * 1000)),
        $lte: new Date()
      }
    }
  }
];

const aggregationQuery2 = [
  {
    $sort: { [dateField]: -1 }
  }
];

const aggregationQuery3 = [
  {
    $group: {
      _id: `$${categoryField}`,
      number_avg: { $avg: `$${integerField}` },
      number_max: { $max: `$${integerField}` },
      number_min: { $min: `$${integerField}` },
      date_min: { $min: `$${dateField}` },
      date_max: { $max: `$${dateField}` },
      string_last: { $last: `$${stringField}` },
      flag_true_count: {
        $sum: { $cond: [{ $eq: [`$${booleanField}`, true] }, 1, 0] }
      },
      flag_false_count: {
        $sum: { $cond: [{ $eq: [`$${booleanField}`, true] }, 0, 1] }
      },
      count: { $sum: 1 }
    }
  }
];

const aggregationQueryLimit = [{ $limit: 200 }];

const getQueryTime = async (conn: Db, collection: string, query: object[]) => {
  const t = new Date().valueOf();
  // console.log(JSON.stringify(query));
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
  const sys = [];
  let sysMeasureInterval = 1;
  let sysMeasureTimes = 1;
  const count = await getFirstStageSize(conn, collection, query);
  for (let i = 0; i < times; i++) {
    const sysLoadPromise = getSysLoadData(sysMeasureInterval, sysMeasureTimes);
    const queryPromise = getQueryTime(conn, collection, query);
    const [sysLoadRes, queryRes] = await Promise.all([sysLoadPromise, queryPromise]);
    sysMeasureInterval = Math.round(queryRes/(1000*sysMeasureTimes));
    sysMeasureInterval = sysMeasureInterval > 1 ? sysMeasureInterval : 1;
    sysMeasureTimes = sysMeasureInterval * sysMeasureTimes > 5 ? 5 : 1;
    stats.push(queryRes);
    sys.push(sysLoadRes)
  }
  return { count, stats, sys };
};

const buildIndexes = async (conn: Db, indexes: string[]) => {
  const buildIndexPromises = indexes.map(async ix => {
    return conn.collection(COLL_NAME).createIndex({ [ix]: 1 });
  });
  return Promise.all(buildIndexPromises);
};

const generate = async (conn: Db) => {
  // Clear old data
  try {
    await conn.collection(COLL_NAME).drop();
  } catch (err) {}

  // Generate new data
  let documents = [];
  let docInitial;
  let extendedDoc;

  for (let i = 0; i < DOCUMENTS_COUNT; i++) {
    const resDoc = extendDoc(docGenerate(doc), DOC_SIZE_FACTOR);
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

const benchmark = async (conn: Db, collection, pipelineBuilder, daysAgo: number[]) => {
  // Get database/collection statistics
  const dbStat = await getDatabaseStat(conn, COLL_NAME);
  generateReportTitle();
  const results = [];
  for (let d of daysAgo) {
    if (process.env.CLEAR_PLAN_CACHE === "true") {
    await conn.command({ planCacheClear: COLL_NAME });
    }
    generateReport(
      dbStat,
      await measureQueryMultipleTimes(conn, collection, pipelineBuilder(d), 5)
    );
  }
};

const generateReportTitle = () => {
  console.log(
    `Timestamp, Instance, Ram size, Cpu size, Storage, Db size, Rows count, Avg Obj size, First stage count, Avg response time, Docs / ms, allowDiskUse, Cpu user, Cpu nice, Cpu system, Cpu iowait, Mem free, Mem used, Mem usage, other response times`
  );
};
const generateReport = (dbStat, r) => {
  console.log(
    `${new Date().valueOf()},${process.env.INSTANCE_TYPE},${
      process.env.RAM_SIZE
    },${process.env.CPU_CORES},${process.env.STORAGE},${dbStat.size},${
      dbStat.count
    },${dbStat.avgObjSize},${r.count},${_.mean(r.stats)},${Math.round(
      r.count / _.mean(r.stats)
    )},${
      process.env.DB_AGGR_ALLOW_DISK_USE
    },${
      _.mean(r.sys.map(x => x.cpu[0]))
    },${
      _.mean(r.sys.map(x => x.cpu[1]))
    },${
      _.mean(r.sys.map(x => x.cpu[2]))
    },${
      _.mean(r.sys.map(x => x.cpu[3]))
    },${
      _.mean(r.sys.map(x => x.mem[0]))
    },${
      _.mean(r.sys.map(x => x.mem[1]))
    },${
      _.mean(r.sys.map(x => x.mem[2]))
    },${r.stats.join(",")}`
  );
};

const run = async () => {
  const conn = await getConnection();
  if (process.env.GENERATE_DATA === "true") {
    // Start data generation
    await generate(conn);
    await buildIndexes(conn, indexes);
  }

  if (process.env.RUN_BENCHMARK === "true") {
    // Start benchamarking
    const pipeLineBuilder = daysAgo => {
      return [
        ...aggregationQuery1Fun(daysAgo),
        ...aggregationQuery2,
        ...aggregationQuery3,
        ...aggregationQueryLimit
      ];
    };

    await benchmark(conn, COLL_NAME, pipeLineBuilder, [1, 2, 5, 10, 15, 25, ...[...Array(12).keys()].map(e => (e+1)*30)]);
  }

  process.exit(0);
};

run();

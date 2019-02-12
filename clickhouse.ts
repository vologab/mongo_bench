import { ClickHouse } from "clickhouse";
import * as AplaClickHouse from "@apla/clickhouse";
const jsf = require("json-schema-faker");
import * as _ from "lodash";
import { getQueryFields, docGenerate } from "./doc_utils";
import { getMongogoDbConnection } from "./db_utils";
import { getSysLoadData } from "./sys_utils";
import { generateReport } from "./report_utils";
const doc = require("./doc.json");

export const getCHCreateTableStmt = (doc: any, tblName: string) => {
  let dateField;
  const docString = Object.keys(doc.properties)
    .reduce((a, c) => {
      if (doc.properties[c].type === "string") return `${a}${c} String,`;
      if (doc.properties[c].type === "integer") return `${a}${c} UInt16,`;
      if (doc.properties[c].type === "boolean") return `${a}${c} UInt8,`;
      if (doc.properties[c].faker === "date.past") {
        dateField = c;
        return `${a}${c} DateTime,`;
      }
      return a;
    }, "")
    .slice(0, -1);
  return `CREATE TABLE IF NOT EXISTS ${tblName} (${docString}) ENGINE = MergeTree() ORDER BY ${dateField}`;
};

export const getAllFields = (doc: any) => {
  return Object.keys(doc.properties)
    .map(f => {
      if (
        ["string", "integer", "boolean"].includes(doc.properties[f].type) ||
        doc.properties[f]["faker"] === "date.past"
      ) {
        return f;
      }
    })
    .filter(f => f);
};
export const genCHInsertData = (
  doc: any,
  schema: any,
  fields: string[],
  quoted: boolean = false
) => {
  return Object.keys(doc)
    .filter(k => fields.includes(k))
    .map(k => {
      if (doc[k] instanceof Date) {
        return Math.round(doc[k].valueOf() / 1000);
      } else if (typeof doc[k] === "boolean") {
        return typeof doc[k] ? 1 : 0;
      } else if (
        !isNaN(doc[k]) &&
        (schema.properties[k].type === "number" ||
          schema.properties[k].type === "integer")
      ) {
        return doc[k];
      }
      return quoted ? `'${doc[k]}'` : doc[k];
    });
};
export const genCHInsertStatement = (
  data: any[][],
  fields: string[],
  tblName: string
) => {
  const values = data.map(d => `(${d.join(",")})`);
  return `INSERT INTO ${tblName} (${fields.join(",")}) VALUES ${values}`;
};

const generate = async () => {
  const clickhouse = new ClickHouse({
    url: `http://${process.env.CH_URL}`,
    port: Number(process.env.CH_PORT),
    debug: false,
    protocol: "http",
    user: "default",
    password: "",
    basicAuth: null,
    isUseGzip: false,
    config: {
      session_timeout: 60,
      output_format_json_quote_64bit_integers: 0,
      enable_http_compression: 0
    }
  });
  try {
    const createTblStm = getCHCreateTableStmt(doc, process.env.COLL_NAME);
    // console.log(createTblStm);
    await clickhouse.query(createTblStm).toPromise();

    const fields = getAllFields(doc);

    const recordsCount = Number(process.env.DOCUMENTS_COUNT);
    const batchSize = Number(process.env.INSERT_BATCH_SIZE);

    let data = [];
    let ws = clickhouse.insert(`INSERT INTO ${process.env.COLL_NAME}`).stream();
    for (let i = 0; i < recordsCount; i++) {
      let row = genCHInsertData(docGenerate(doc), doc, fields, true);
      // console.log(row);
      await ws.writeRow(row);
      if (!(i % batchSize)) {
        await ws.exec();
        ws = clickhouse.insert(`INSERT INTO ${process.env.COLL_NAME}`).stream();
      }
    }
  } catch (err) {
    console.log(err);
  }
};

const copy = async () => {
  try {
    var ch = new AplaClickHouse({
      host: process.env.CH_URL,
      port: Number(process.env.CH_PORT)
    });
    const createTblStm = getCHCreateTableStmt(doc, process.env.COLL_NAME);
    await ch.querying(createTblStm);

    const dbConnection = await getMongogoDbConnection();
    const {
      integerField,
      dateField,
      categoryField,
      stringField,
      booleanField
    } = getQueryFields(doc);

    const fields = getAllFields(doc);
    const batchSize = Number(process.env.INSERT_BATCH_SIZE);

    const documents = dbConnection
      .collection(process.env.COLL_NAME)
      .find({})
      .sort({ [dateField]: 1 });
    let i = 0;
    let ws = ch.query(`INSERT INTO ${process.env.COLL_NAME}`, {
      inputFormat: "TSV"
      // format: 'JSONEachRow'
    });
    while (await documents.hasNext()) {
      let curDoc = await documents.next();
      let row = genCHInsertData(curDoc, doc, fields);
      try {
        ws.write(row.join("\t"));
        i++;
        if (!(i % batchSize)) {
          console.log("Write data, batch size:", batchSize);
          ws.end();
          ws = ch.query(`INSERT INTO ${process.env.COLL_NAME}`, {
            inputFormat: "TSV"
            // format: 'JSONEachRow'
          });
        }
      } catch (err) {
        console.log("Error occured while inserting into db", err);
        process.exit(1);
      }
    }
    ws.end();
    console.log("Database ", process.env.COLL_NAME, " was successfully copied");
    process.exit();
  } catch (err) {
    console.log(err);
  }
};

const queryBuilder = daysAgo => {
  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = d.getSeconds();
    const addZero = num => {
      return num < 10 ? `0${num}` : num;
    };
    return `${year}-${addZero(month)}-${addZero(day)} ${addZero(
      hours
    )}:${addZero(minutes)}:${addZero(seconds)}`;
  };

  const fromDate = formatDate(
    new Date(new Date().getTime() - daysAgo * 24 * 60 * 60 * 1000)
  );
  const toDate = formatDate(new Date());

  const selectQuery = `
 select
    t1.country,
    t1.avg_count,
    t1.max_count,
    t1.min_count,
    t1.min_date,
    t1.max_date,
    t1.flag_true_count,
    t1.flag_false_count,
    t1.total_count,
    t2.city
from
    (
        select
            country,
            AVG(count) as avg_count,
            MAX(count) as max_count,
            MIN(count) as min_count,
            MIN(date) as min_date,
            MAX(date) as max_date,
            countIf(flag) as flag_true_count,
            countIf(1, flag = 0) as flag_false_count,
            SUM(count) as total_count
        from
            ${process.env.COLL_NAME}
        where
            date >= '${fromDate}'
            and date <= '${toDate}'
        group by
            country
        limit
            200
    ) t1
    left join ${process.env.COLL_NAME} t2 on t1.max_date = date`;

  return { query: selectQuery, from: fromDate, to: toDate };
};

const getTableStat = async (conn, tbl) => {
  const q = await conn.querying(
    `select SUM(rows), SUM(data_compressed_bytes), SUM(data_uncompressed_bytes) from system.parts where table = '${tbl}' group by table`,
    {
      syncParser: true
    }
  );
  return {
    size: q.data[0][1],
    count: q.data[0][0],
    size_uncompressed: q.data[0][2]
  };
};

const getCount = async (conn, tbl, from, to) => {
  const q = await conn.querying(
    `SELECT COUNT(*) FROM ${tbl} WHERE date > '${from}' and date <= '${to}'`,
    {
      syncParser: true
    }
  );
  return q.data[0][0];
};

const getQueryTime = async (conn, collection, query) => {
  const t = new Date().valueOf();
  const q = await conn.querying(query, { syncParser: true });
  return new Date().valueOf() - t;
};

const measureQueryMultipleTimes = async (
  conn,
  collection,
  queryData,
  times
) => {
  const stats = [];
  const sys = [];
  let sysMeasureInterval = 1;
  let sysMeasureTimes = 1;
  const count = await getCount(conn, collection, queryData.from, queryData.to);
  for (let i = 0; i < times; i++) {
    const sysLoadPromise = getSysLoadData(sysMeasureInterval, sysMeasureTimes);
    const queryPromise = getQueryTime(conn, collection, queryData.query);
    const [sysLoadRes, queryRes] = await Promise.all([
      sysLoadPromise,
      queryPromise
    ]);
    sysMeasureInterval = Math.round(queryRes / (1000 * sysMeasureTimes));
    sysMeasureInterval = sysMeasureInterval > 1 ? sysMeasureInterval : 1;
    sysMeasureTimes = sysMeasureInterval * sysMeasureTimes > 5 ? 5 : 1;
    stats.push(queryRes);
    sys.push(sysLoadRes);
  }
  return { count, stats, sys };
};

const benchmark = async () => {
  try {
    const ch = new AplaClickHouse({
      host: process.env.CH_URL,
      port: Number(process.env.CH_PORT)
    });

    const daysList = [
      1,
      2,
      5,
      10,
      15,
      25,
      ...[...Array(12).keys()].map(e => (e + 1) * 30)
    ];
    const dbStat = await getTableStat(ch, process.env.COLL_NAME);

    const queryData = queryBuilder(100);
    for (let d of daysList) {
      generateReport(
        dbStat,
        await measureQueryMultipleTimes(ch, process.env.COLL_NAME, queryData, 5)
      );
    }
  } catch (err) {
    console.log("Error occured while benhcmarking", err);
  }
};

const run = async () => {
  if (process.env.GENERATE_DATA === "true") {
    await generate();
  }

  if (process.env.COPY_DATA === "true") {
    await copy();
  }

  if (process.env.RUN_BENCHMARK === "true") {
    await benchmark();
  }
};

run();

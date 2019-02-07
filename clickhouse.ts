import { ClickHouse } from "clickhouse";
import * as AplaClickHouse from "@apla/clickhouse";
const jsf = require("json-schema-faker");
import * as _ from "lodash";
import { getQueryFields, docGenerate } from "./doc_utils";
import { getMongogoDbConnection } from "./db_utils";
const doc = require("./doc.json");

export const getCHCreateTableStmt = (doc: any, tblName: string) => {
  let dateField;
  const docString = Object.keys(doc.properties)
    .reduce((a, c) => {
      if (doc.properties[c].type === "string") return `${a}${c} String,`;
      if (doc.properties[c].type === "integer") return `${a}${c} UInt16,`;
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
        ["string", "integer"].includes(doc.properties[f].type) ||
        doc.properties[f]["faker"] === "date.past"
      ) {
        return f;
      }
    })
    .filter(f => f);
};
export const genCHInsertData = (doc: any, schema: any, fields: string[], quoted: boolean = false) => {
  return Object.keys(doc)
    .filter(k => fields.includes(k))
    .map(k => {
      if (doc[k] instanceof Date) {
        return Math.round(doc[k].valueOf()/1000);
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
    await clickhouse.query(createTblStm).toPromise();

    const fields = getAllFields(doc);

    const recordsCount = Number(process.env.DOCUMENTS_COUNT);
    const batchSize = Number(process.env.INSERT_BATCH_SIZE);

    let data = [];
    let ws = clickhouse.insert(`INSERT INTO ${process.env.COLL_NAME}`).stream();
    for (let i = 0; i < recordsCount; i++) {
      await ws.writeRow(genCHInsertData(docGenerate(doc), doc, fields, true));
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

const run = async () => {
  if (process.env.GENERATE_DATA === "true") {
    await generate();
  }

  if (process.env.COPY_DATA === "true") {
    await copy();
  }
};

run();

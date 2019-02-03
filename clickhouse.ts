import { ClickHouse } from "clickhouse";
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
export const genCHInsertData = (doc: any, schema: any, fields: string[]) => {
  return Object.keys(doc)
    .filter(k => fields.includes(k))
    .map(k => {
      if (doc[k] instanceof Date) {
        return doc[k].valueOf();
      } else if (
        !isNaN(doc[k]) &&
        (schema.properties[k].type === "number" ||
          schema.properties[k].type === "integer")
      ) {
        return doc[k];
      }
      return `'${doc[k]}'`;
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

const clickhouse = new ClickHouse({
  url: process.env.CH_URL,
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

const generate = async () => {
  try {
    const createTblStm = getCHCreateTableStmt(doc, process.env.COLL_NAME);

    await clickhouse.query(createTblStm).toPromise();

    const fields = getAllFields(doc);

    const recordsCount = Number(process.env.DOCUMENTS_COUNT);
    const batchSize = Number(process.env.INSERT_BATCH_SIZE);

    let data = [];

    for (let i = 0; i < recordsCount; i++) {
      let insertStmt;
      const ws = clickhouse
        .insert(`INSERT INTO ${process.env.COLL_NAME}`)
        .stream();
      await ws.writeRow(genCHInsertData(docGenerate(doc), doc, fields));
      if (!(data.length % batchSize)) {
        await ws.exec();
        data = [];
      }
    }
  } catch (err) {
    console.log(err);
  }
};

const copy = async () => {
  try {
    const dbConnection = await getMongogoDbConnection();
    const {
      integerField,
      dateField,
      categoryField,
      stringField,
      booleanField
    } = getQueryFields(doc);
    const documents = dbConnection
      .collection(process.env.COLL_NAME)
      .find({})
      .sort({ [dateField]: 1 });

    let i = 0;
    let ws = clickhouse.insert(`INSERT INTO ${process.env.COLL_NAME}`).stream();
    while (documents.hasNext()) {
      const createTblStm = getCHCreateTableStmt(doc, process.env.COLL_NAME);

      await clickhouse.query(createTblStm).toPromise();

      const fields = getAllFields(doc);
      const batchSize = Number(process.env.INSERT_BATCH_SIZE);

      try {
        await ws.writeRow(genCHInsertData(documents.next(), doc, fields));
        if (!(i % batchSize)) {
          await ws.exec();
        }
      } catch (err) {
        console.log("Error occured while inserting into db", err);
        // Retry
        ws = clickhouse.insert(`INSERT INTO ${process.env.COLL_NAME}`).stream();
        await ws.writeRow(genCHInsertData(documents.next(), doc, fields));
      }

      i++;
    }
  } catch (err) {
    console.log(err);
  }
};

generate();

const run = async () => {
  if (process.env.GENERATE_DATA === "true") {
    await generate();
  }

  if (process.env.COPY_DATA === "true") {
    await copy();
  }
};

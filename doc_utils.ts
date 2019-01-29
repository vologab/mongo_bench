const jsf = require("json-schema-faker");
import * as _ from "lodash";
jsf.extend("faker", () => require("faker"));

export const getQueryFields = (doc: any) => {
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
        doc.properties[k].category1 &&
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
    });

    return {
        integerField,
        dateField,
        categoryField,
        stringField,
        booleanField
    }
};

export const docGenerate = (doc: any) => {
    return jsf.generate(doc);
}

export const extendDoc = (doc: any, extensionFactor: number) => {
    const extendedDoc = [...Array(extensionFactor).keys()]
      .map(ix => ({
        [`d${ix}`]: doc
      }))
      .reduce((a, c) => ({ ...a, ...c }), {});
    return { ...doc, ...extendedDoc };
}
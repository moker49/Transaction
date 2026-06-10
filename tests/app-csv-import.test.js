const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Could not find ${name}`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not parse ${name}`);
}

const appSource = readFileSync("app.js", "utf8");
const functionNames = [
  "clean",
  "parseCsv",
  "normalizeCsvRow",
  "firstCsvValue",
  "signedAmountFromDebitCredit",
  "detectCsvLayout",
  "hasFields",
];
const sourceUnderTest = `${functionNames.map((name) => extractFunctionSource(appSource, name)).join("\n")}
module.exports = { parseCsv, normalizeCsvRow, detectCsvLayout };`;
const app = new Function("module", sourceUnderTest);
const moduleUnderTest = { exports: {} };
app(moduleUnderTest);

test("normalizes Capital One credit CSV rows into raw imported rows", () => {
  const csv = [
    "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
    "2026-06-01,2026-06-02,1234,STARBUCKS STORE,Food & Drink,5.75,",
    "2026-06-03,2026-06-04,1234,REFUND,Shopping,,2.50",
  ].join("\n");

  const parsed = moduleUnderTest.exports.parseCsv(csv);
  const rawRows = parsed.rows.map(moduleUnderTest.exports.normalizeCsvRow);

  assert.deepEqual(parsed.headers, [
    "Transaction Date",
    "Posted Date",
    "Card No.",
    "Description",
    "Category",
    "Debit",
    "Credit",
  ]);
  assert.equal(moduleUnderTest.exports.detectCsvLayout(parsed.headers), "capital_one_credit");
  assert.deepEqual(rawRows, [
    {
      raw_date: "2026-06-02",
      raw_type: null,
      raw_category: "Food & Drink",
      raw_description: "STARBUCKS STORE",
      raw_amount: "-5.75",
    },
    {
      raw_date: "2026-06-04",
      raw_type: null,
      raw_category: "Shopping",
      raw_description: "REFUND",
      raw_amount: "2.50",
    },
  ]);
});

test("parses quoted CSV values and generic amount columns", () => {
  const csv = [
    "Date,Description,Type,Amount",
    '2026-06-05,"Coffee, downtown",Sale,-4.20',
  ].join("\n");

  const parsed = moduleUnderTest.exports.parseCsv(csv);
  const rawRows = parsed.rows.map(moduleUnderTest.exports.normalizeCsvRow);

  assert.equal(moduleUnderTest.exports.detectCsvLayout(parsed.headers), "generic_csv");
  assert.deepEqual(rawRows, [
    {
      raw_date: "2026-06-05",
      raw_type: "Sale",
      raw_category: null,
      raw_description: "Coffee, downtown",
      raw_amount: "-4.20",
    },
  ]);
});

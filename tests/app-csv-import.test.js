const assert = require("node:assert/strict");
const test = require("node:test");

async function loadCsvModule() {
  return import("../scripts/js/csv.mjs");
}

test("normalizes Capital One credit CSV rows into raw imported rows", async () => {
  const csvModule = await loadCsvModule();
  const csv = [
    "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
    "2026-06-01,2026-06-02,1234,STARBUCKS STORE,Food & Drink,5.75,",
    "2026-06-03,2026-06-04,1234,REFUND,Shopping,,2.50",
  ].join("\n");
  const parsed = csvModule.parseCsv(csv);
  const rawRows = parsed.rows.map(csvModule.normalizeCsvRow);
  assert.deepEqual(parsed.headers, ["Transaction Date", "Posted Date", "Card No.", "Description", "Category", "Debit", "Credit"]);
  assert.equal(csvModule.detectCsvLayout(parsed.headers), "capital_one_credit");
  assert.deepEqual(rawRows, [
    { raw_date: "2026-06-02", raw_category: "Food & Drink", raw_description: "STARBUCKS STORE", raw_amount: "-5.75" },
    { raw_date: "2026-06-04", raw_category: "Shopping", raw_description: "REFUND", raw_amount: "2.50" },
  ]);
});

test("parses quoted CSV values and generic amount columns", async () => {
  const csvModule = await loadCsvModule();
  const csv = ["Date,Description,Type,Amount", '2026-06-05,"Coffee, downtown",Sale,-4.20'].join("\n");
  const parsed = csvModule.parseCsv(csv);
  const rawRows = parsed.rows.map(csvModule.normalizeCsvRow);
  assert.equal(csvModule.detectCsvLayout(parsed.headers), "generic_csv");
  assert.deepEqual(rawRows, [{ raw_date: "2026-06-05", raw_category: null, raw_description: "Coffee, downtown", raw_amount: "-4.20" }]);
});

test("collapses repeated spaces in raw CSV values", async () => {
  const csvModule = await loadCsvModule();
  const csv = ["Date,Description,Category,Amount", "2026-06-06,Big   Store  Downtown,Food    Drink,-12.34"].join("\n");
  const parsed = csvModule.parseCsv(csv);
  const rawRows = parsed.rows.map(csvModule.normalizeCsvRow);
  assert.deepEqual(rawRows, [{ raw_date: "2026-06-06", raw_category: "Food Drink", raw_description: "Big Store Downtown", raw_amount: "-12.34" }]);
});

test("detects normalized statement export rows", async () => {
  const csvModule = await loadCsvModule();
  const csv = [
    "account,account_number,source_file,statement_period,transaction_date,post_date,description,category,amount,balance,transaction_type,card",
    'checking_chase,0000,file.pdf,"December 05, 2019 - January 06, 2020",2019-12-05,,Card Purchase,ATM & Debit Card Withdrawals,-3.20,,,',
  ].join("\n");
  const parsed = csvModule.parseCsv(csv);
  const rawRows = parsed.rows.map(csvModule.normalizeCsvRow);
  assert.equal(csvModule.detectCsvLayout(parsed.headers), "normalized_statement_export");
  assert.deepEqual(rawRows, [{ raw_date: "2019-12-05", raw_category: "ATM & Debit Card Withdrawals", raw_description: "Card Purchase", raw_amount: "-3.20" }]);
});

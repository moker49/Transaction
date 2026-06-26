const assert = require("node:assert/strict");
const test = require("node:test");

test("normalizes and converts category colors", async () => {
  const colors = await import("../scripts/js/colors.mjs");

  assert.equal(colors.normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(colors.normalizeHexColor("A1B2C3"), "#a1b2c3");
  assert.equal(colors.normalizeHexColor("nope"), null);
  assert.equal(colors.hslToHex(120, 100, 50), "#00ff00");
  assert.deepEqual(colors.hexToHsl("#808080"), { h: 0, s: 0, l: 50.19607843137255 });
});

test("builds dashboard totals and grouped segments", async () => {
  const { dashboardFromTransactions } = await import("../scripts/js/dashboard-model.mjs");
  const categories = [
    { id: 1, name: "Food", parent_id: null, color: "#111111" },
    { id: 2, name: "Restaurants", parent_id: 1, color: null },
    { id: 3, name: "Income", parent_id: null, color: "#222222" },
  ];
  const transactions = [
    { transaction_type: "income", amount_cents: 10000, category_id: 3, tags: [] },
    { transaction_type: "expense", amount_cents: -2500, category_id: 2, tags: [] },
    { transaction_type: "expense", amount_cents: -1500, category_id: 1, tags: [{ name: "bill" }] },
  ];

  const dashboard = dashboardFromTransactions(transactions, { categories, segmentLimit: 7 });

  assert.equal(dashboard.income, 10000);
  assert.equal(dashboard.bills, 1500);
  assert.equal(dashboard.splurge, 2500);
  assert.equal(dashboard.saved, 6000);
  assert.deepEqual(dashboard.categorySegments, [{ label: "Food", value: 4000, color: "#111111" }]);
  assert.deepEqual(dashboard.incomeSegments, [{ label: "Income", value: 10000, color: "#222222" }]);
});

test("formats app labels", async () => {
  const labels = await import("../scripts/js/labels.mjs");

  assert.equal(labels.statusLabel("auto-importable"), "Auto-importable");
  assert.equal(labels.statusClass("manual"), "status-new");
  assert.equal(labels.accountTypeLabel("checking"), "Checking");
  assert.equal(labels.matchAmountLabel("negative"), "Negative");
  assert.equal(labels.transactionTypeLabel("transfer"), "Transfer");
  assert.equal(labels.destructiveMessage("Delete it?"), "Delete it?\nThis cannot be undone.");
});

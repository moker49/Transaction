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

test("builds payloads from form data", async () => {
  const payloads = await import("../scripts/js/form-payloads.mjs");

  globalThis.FormData = class FormData {
    constructor(form) {
      this.form = form;
    }

    get(name) {
      return this.form[name] ?? "";
    }
  };

  const tagContainer = {
    querySelectorAll() {
      return [{ value: "2" }, { value: "bad" }, { value: "5" }];
    },
  };

  assert.deepEqual(payloads.buildAccountPayload({
    name: " Main ",
    institution: "",
    accountType: " checking ",
  }), {
    name: "Main",
    institution: null,
    account_type: "checking",
  });
  assert.deepEqual(payloads.buildRulePayload({
    ruleKind: "template",
    matchDescription: " Store ",
    matchCategory: "",
    matchAmount: "",
    setCategoryId: "7",
    setCleanDescription: "",
    setTransactionType: "expense",
  }, tagContainer), {
    name: "Store",
    rule_type: "template",
    match_description: "Store",
    match_category: null,
    match_amount: "any",
    set_category_id: 7,
    set_clean_description: null,
    set_transaction_type: "expense",
    add_tag_ids: [2, 5],
  });
  assert.equal(payloads.payloadMatchesSnapshot({ tag_ids: [5, 2] }, { tag_ids: [2, 5] }), true);
});

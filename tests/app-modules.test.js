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

test("matches raw rows against rules and selection state", async () => {
  const rawRows = await import("../scripts/js/raw-row-model.mjs");
  const row = {
    id: 10,
    import_status: "auto-importable",
    raw_amount: "debit=12.50; credit=",
    raw_category: "Food & Drink",
    raw_description: "Coffee Shop",
  };
  const rules = [
    { id: 2, is_active: true, match_description: "Coffee", match_category: "", match_amount: "negative" },
    { id: 1, is_active: true, match_description: "Coffee", match_category: "Food", match_amount: "negative" },
  ];

  assert.equal(rawRows.parseRawAmount(row.raw_amount), -12.5);
  assert.equal(rawRows.rawRowMatchesStatusFilter(row, "new"), true);
  assert.equal(rawRows.selectedRawRowStatus(new Set([10]), [row]), "auto-importable");
  assert.equal(rawRows.isSelectableRawRow(row, "auto-importable"), true);
  assert.equal(rawRows.nextSelectVisibleStatus(null, [10], [], new Set()), "auto-importable");
  assert.equal(rawRows.topMatchingRuleForRawRow(rules, row)?.id, 1);
});

test("truncates long raw row description words for table display", async () => {
  const rawRowsController = await import("../scripts/js/raw-rows-controller.mjs");

  assert.equal(
    rawRowsController.truncateLongDescriptionWords("BESTBUYCOM806243645796 Store"),
    "BESTBUYCOM... Store",
  );
  assert.equal(
    rawRowsController.truncateLongDescriptionWords("Short words stay intact"),
    "Short words stay intact",
  );
});

test("updates segmented type groups", async () => {
  const typeGroups = await import("../scripts/js/type-groups.mjs");
  const buttons = [
    { dataset: { typeValue: "expense" }, classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } },
    { dataset: { typeValue: "income" }, classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } },
  ];
  const input = { value: "" };
  const group = {
    querySelectorAll() {
      return buttons;
    },
  };
  const changes = [];

  typeGroups.setTypeGroupValue(input, group, "income", {
    onChange: ({ value }) => changes.push(value),
  });

  assert.equal(input.value, "income");
  assert.equal(buttons[1]["aria-checked"], "true");
  assert.equal(buttons[1].tabIndex, 0);
  assert.deepEqual(changes, ["income"]);

  typeGroups.setOptionalTypeGroupValue(input, group, "");
  assert.equal(input.value, "");
  assert.equal(buttons[0].tabIndex, 0);
});

test("orders and labels category trees", async () => {
  const categories = await import("../scripts/js/category-model.mjs");
  const list = [
    { id: 2, name: "Restaurants", parent_id: 1, sort_order: 2, color: null },
    { id: 1, name: "Food", parent_id: null, sort_order: 1, color: "#111111" },
    { id: 3, name: "Groceries", parent_id: 1, sort_order: 1, color: null },
  ];

  assert.equal(categories.selectedCategory(list, "2")?.name, "Restaurants");
  assert.equal(categories.rootCategoryId(list, 2), 1);
  assert.equal(categories.effectiveCategoryColor(list, list[0]), "#111111");
  assert.deepEqual([...categories.categoryDescendantIds(list, 1)], [2, 3]);
  assert.deepEqual(categories.orderedCategories(list).map((category) => category.name), ["Food", "Groceries", "Restaurants"]);
  assert.equal(categories.categoryLabel(list, list[0]), "Food / Restaurants");
  assert.equal(categories.categoryLabelById(list, 3), "Food / Groceries");
});

test("sorts table rows with app context", async () => {
  const tableSort = await import("../scripts/js/table-sort.mjs");
  const rows = [
    { id: 2, posted_date: "2026-01-01", category_id: 1, clean_description: "B", amount_cents: 200 },
    { id: 1, posted_date: "2026-01-02", category_id: 1, clean_description: "A", amount_cents: 100 },
  ];
  const sortState = { transactions: { key: "date", direction: "desc", type: "date" } };

  assert.deepEqual(
    tableSort.sortedTableRows("transactions", rows, sortState, { categories: [{ id: 1, name: "Food", parent_id: null }] }).map((row) => row.id),
    [1, 2],
  );
});

test("normalizes and slices app state", async () => {
  const stateModel = await import("../scripts/js/state-model.mjs");
  const normalized = stateModel.normalizeState({
    realTransactions: [{ id: 1, posted_date: "2026-01-02" }],
    rawTransactions: [{ id: 2, raw_date: "2026-01-02", import_status: "imported" }],
  });

  assert.equal(normalized.transactions.length, 1);
  assert.equal(normalized.rawRows.length, 1);

  const sliced = stateModel.transactionSliceForRange(normalized, normalized, {
    start: "2026-01-01",
    end: "2026-01-31",
  });
  assert.deepEqual(sliced.transactions.map((row) => row.id), [1]);
  assert.deepEqual(sliced.rawRows.map((row) => row.id), [2]);

  const ids = new Set([1, 3]);
  stateModel.pruneMissingIds(ids, new Set([1]));
  assert.deepEqual([...ids], [1]);
});

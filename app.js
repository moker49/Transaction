(function () {
  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:5050" : "";

  const defaultState = {
    accounts: [],
    categories: [],
    tags: [],
    rules: [],
    imports: [],
    transactions: [],
    rawRows: [],
    logs: [],
  };

  let state = structuredClone(defaultState);
  const selectedRawRowIds = new Set();
  const rawRowNotes = new Map();
  let visibleRawRows = [];
  const importableRawRowStatuses = new Set(["new", "ready"]);

  const elements = {
    tabs: document.querySelectorAll(".tab"),
    views: document.querySelectorAll(".view"),
    accountForm: document.querySelector("#accountForm"),
    importForm: document.querySelector("#importForm"),
    categoryForm: document.querySelector("#categoryForm"),
    tagForm: document.querySelector("#tagForm"),
    ruleForm: document.querySelector("#ruleForm"),
    importMessage: document.querySelector("#importMessage"),
    importAccountSelect: document.querySelector("#importAccountSelect"),
    rawAccountFilter: document.querySelector("#rawAccountFilter"),
    rawStatusFilter: document.querySelector("#rawStatusFilter"),
    rawSearch: document.querySelector("#rawSearch"),
    selectVisibleRowsButton: document.querySelector("#selectVisibleRowsButton"),
    importSelectedRowsButton: document.querySelector("#importSelectedRowsButton"),
    ruleCategorySelect: document.querySelector("#ruleCategorySelect"),
    ruleTagSelect: document.querySelector("#ruleTagSelect"),
    themeToggle: document.querySelector("#themeToggle"),
  };

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });

  elements.accountForm.addEventListener("submit", addAccount);
  elements.importForm.addEventListener("submit", importCsv);
  elements.categoryForm.addEventListener("submit", addCategory);
  elements.tagForm.addEventListener("submit", addTag);
  elements.ruleForm.addEventListener("submit", addRule);
  elements.rawAccountFilter.addEventListener("change", renderRawRows);
  elements.rawStatusFilter.addEventListener("change", renderRawRows);
  elements.rawSearch.addEventListener("input", renderRawRows);
  elements.selectVisibleRowsButton.addEventListener("click", selectVisibleRawRows);
  elements.importSelectedRowsButton.addEventListener("click", importSelectedRawRows);
  elements.themeToggle.addEventListener("change", updateTheme);

  initializeTheme();
  loadInitialState();

  function initializeTheme() {
    const theme = localStorage.getItem("transaction-theme") || "dark";
    document.documentElement.dataset.theme = theme;
    elements.themeToggle.checked = theme === "dark";
  }

  function updateTheme() {
    const theme = elements.themeToggle.checked ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("transaction-theme", theme);
  }

  async function loadInitialState() {
    try {
      state = normalizeState(await apiRequest("/api/state"));
      render();
    } catch (error) {
      setMessage(error.message || "Could not load server data.", true);
      render();
    }
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with ${response.status}`);
    }
    return payload;
  }

  function normalizeState(payload) {
    return {
      ...structuredClone(defaultState),
      ...(payload || {}),
    };
  }

  function applyStateFromPayload(payload) {
    state = normalizeState(payload.state || payload);
    const visibleIds = new Set(state.rawRows.map((row) => row.id));
    [...selectedRawRowIds].forEach((rowId) => {
      if (!visibleIds.has(rowId)) {
        selectedRawRowIds.delete(rowId);
      }
    });
    [...rawRowNotes.keys()].forEach((rowId) => {
      if (!visibleIds.has(rowId)) {
        rawRowNotes.delete(rowId);
      }
    });
    render();
  }

  function activateView(viewName) {
    elements.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === viewName));
    elements.views.forEach((view) => view.classList.toggle("is-active", view.id === `${viewName}View`));
  }

  async function addAccount(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currency = clean(form.get("currency")).toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      alert("Currency must be a three-letter code.");
      return;
    }

    try {
      const payload = await apiRequest("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          name: clean(form.get("name")),
          institution: clean(form.get("institution")) || null,
          account_type: clean(form.get("accountType")) || null,
          currency,
        }),
      });
      formElement.reset();
      formElement.elements.currency.value = "USD";
      applyStateFromPayload(payload);
    } catch (error) {
      alert(error.message || "Could not add account.");
    }
  }

  async function importCsv(event) {
    event.preventDefault();
    setMessage("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const accountId = Number(form.get("accountId"));
    const file = form.get("csvFile");
    const sourceType = clean(form.get("sourceType")) || "csv";

    if (!accountId || !(file instanceof File)) {
      setMessage("Choose an account and CSV file.", true);
      return;
    }

    try {
      const upload = new FormData();
      upload.append("accountId", String(accountId));
      upload.append("sourceType", sourceType);
      upload.append("csvFile", file);
      const payload = await apiRequest("/api/imports/csv", {
        method: "POST",
        body: upload,
      });
      formElement.reset();
      formElement.elements.sourceType.value = "csv";
      applyStateFromPayload(payload);
      if (payload.status === "already_imported") {
        setMessage("File already imported for this account.");
      } else {
        setMessage(`Imported ${payload.inserted_raw_row_count} raw rows from ${file.name}.`);
      }
    } catch (error) {
      setMessage(error.message || "CSV import failed.", true);
    }
  }

  async function addTag(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = clean(form.get("name"));
    if (!name) {
      return;
    }
    try {
      const payload = await apiRequest("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      formElement.reset();
      applyStateFromPayload(payload);
    } catch (error) {
      alert(error.message || "Could not add tag.");
    }
  }

  async function addCategory(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = clean(form.get("name"));
    if (!name) {
      return;
    }
    try {
      const payload = await apiRequest("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      formElement.reset();
      applyStateFromPayload(payload);
    } catch (error) {
      alert(error.message || "Could not add category.");
    }
  }

  async function addRule(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const setCleanDescription = clean(form.get("setCleanDescription"));
    const setCategoryId = Number(form.get("setCategoryId")) || null;
    const addTagId = Number(form.get("addTagId")) || null;

    if (!setCategoryId && !setCleanDescription && !addTagId) {
      alert("Set a clean category, clean description, or tag.");
      return;
    }

    try {
      const payload = await apiRequest("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          name: clean(form.get("name")),
          match_field: clean(form.get("matchField")),
          match_type: clean(form.get("matchType")),
          match_value: clean(form.get("matchValue")),
          set_category_id: setCategoryId,
          set_clean_description: setCleanDescription || null,
          add_tag_id: addTagId,
          priority: Number(form.get("priority")) || 100,
        }),
      });
      formElement.reset();
      formElement.elements.priority.value = "100";
      applyStateFromPayload(payload);
    } catch (error) {
      alert(error.message || "Could not add rule.");
    }
  }

  function render() {
    renderMetrics();
    renderAccounts();
    renderTransactions();
    renderAccountSelects();
    renderImports();
    renderSnapshotRows();
    renderCategories();
    renderTags();
    renderRules();
    renderLogs();
    renderRawRows();
  }

  function renderMetrics() {
    setText("#accountCount", state.accounts.length);
    setText("#importCount", state.imports.length);
    setText("#rawRowCount", state.rawRows.length);
    setText("#newImportCount", state.rawRows.filter((row) => isImportableRawRow(row)).length);
  }

  function renderAccounts() {
    const tbody = document.querySelector("#accountsTable");
    clear(tbody);
    if (!state.accounts.length) {
      tbody.appendChild(emptyTableRow(4));
      return;
    }

    state.accounts.forEach((account) => {
      const rowCount = state.rawRows.filter((row) => row.account_id === account.id).length;
      tbody.appendChild(tableRow([
        account.name,
        account.institution || "-",
        account.account_type || "-",
        String(rowCount),
      ]));
    });
  }

  function renderTransactions() {
    const tbody = document.querySelector("#transactionsTable");
    clear(tbody);
    if (!state.transactions.length) {
      tbody.appendChild(emptyTableRow(6));
      return;
    }

    state.transactions.forEach((transaction) => {
      tbody.appendChild(tableRow([
        transaction.posted_date || "-",
        transaction.account || "-",
        transaction.clean_description || "-",
        transaction.category || "-",
        transaction.amount || formatCents(transaction.amount_cents),
        transaction.notes || "-",
      ]));
    });
  }

  function renderAccountSelects() {
    const options = state.accounts.map((account) => {
      return { value: String(account.id), label: accountLabel(account) };
    });

    fillSelect(elements.importAccountSelect, options, "Select account");
    fillSelect(elements.rawAccountFilter, [{ value: "all", label: "All accounts" }, ...options]);
  }

  function renderImports() {
    const importList = document.querySelector("#importList");
    const recentImports = document.querySelector("#recentImports");
    clear(importList);
    clear(recentImports);

    if (!state.imports.length) {
      appendEmpty(importList);
      appendEmpty(recentImports);
      return;
    }

    state.imports.slice().reverse().forEach((item) => importList.appendChild(importListItem(item)));
    state.imports.slice(-5).reverse().forEach((item) => recentImports.appendChild(importListItem(item)));
  }

  function importListItem(item) {
    const account = state.accounts.find((candidate) => candidate.id === item.account_id);
    const node = document.createElement("div");
    node.className = "list-item";
    node.append(
      el("strong", item.filename),
      el("span", `${account ? accountLabel(account) : "Unknown account"} | ${item.row_count} rows | ${item.metadata.layout}`, "list-meta"),
      el("span", formatDateTime(item.imported_at), "list-meta"),
    );
    return node;
  }

  function renderSnapshotRows() {
    const tbody = document.querySelector("#snapshotRows");
    clear(tbody);
    const rows = state.rawRows.slice(-8).reverse();
    if (!rows.length) {
      tbody.appendChild(emptyTableRow(3));
      return;
    }

    rows.forEach((row) => {
      tbody.appendChild(tableRow([
        row.raw_date || "-",
        row.raw_description || "-",
        row.raw_amount || "-",
      ]));
    });
  }

  function renderTags() {
    const tagList = document.querySelector("#tagList");
    clear(tagList);
    if (!state.tags.length) {
      appendEmpty(tagList);
    } else {
      state.tags.forEach((tag) => tagList.appendChild(el("span", tag.name, "chip")));
    }

    fillSelect(
      elements.ruleTagSelect,
      [{ value: "", label: "No tag" }, ...state.tags.map((tag) => ({ value: String(tag.id), label: tag.name }))],
    );
  }

  function renderCategories() {
    const categoryList = document.querySelector("#categoryList");
    clear(categoryList);
    if (!state.categories.length) {
      appendEmpty(categoryList);
    } else {
      state.categories.forEach((category) => categoryList.appendChild(el("span", category.name, "chip")));
    }

    fillSelect(
      elements.ruleCategorySelect,
      [
        { value: "", label: "No category" },
        ...state.categories.map((category) => ({ value: String(category.id), label: category.name })),
      ],
    );
  }

  function renderRules() {
    const ruleList = document.querySelector("#ruleList");
    clear(ruleList);
    if (!state.rules.length) {
      appendEmpty(ruleList);
      return;
    }

    state.rules
      .slice()
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .forEach((rule) => {
        const tag = state.tags.find((candidate) => candidate.id === rule.add_tag_id);
        const category = state.categories.find((candidate) => candidate.id === rule.set_category_id);
        const node = document.createElement("div");
        node.className = "list-item";
        node.append(
          el("strong", `${rule.name} (${rule.priority})`),
          el("span", `${rule.match_field} ${rule.match_type} "${rule.match_value}"`, "list-meta"),
          el("span", ruleActions(rule, category, tag), "list-meta"),
        );
        ruleList.appendChild(node);
      });
  }

  function renderLogs() {
    const logList = document.querySelector("#logList");
    clear(logList);
    if (!state.logs.length) {
      appendEmpty(logList);
      return;
    }

    state.logs.slice(0, 20).forEach((log) => {
      const node = document.createElement("div");
      node.className = `list-item log-${log.level}`;
      node.append(
        el("strong", `${log.level.toUpperCase()} | ${log.source}`),
        el("span", log.message, "list-meta"),
        el("span", formatDateTime(log.created_at), "list-meta"),
      );
      if (log.details && Object.keys(log.details).length) {
        node.append(el("span", JSON.stringify(log.details), "list-meta"));
      }
      logList.appendChild(node);
    });
  }

  function renderRawRows() {
    const tbody = document.querySelector("#rawRowsTable");
    clear(tbody);

    const accountFilter = elements.rawAccountFilter.value;
    const statusFilter = elements.rawStatusFilter.value;
    const search = elements.rawSearch.value.trim().toLowerCase();

    const rows = state.rawRows.filter((row) => {
      if (accountFilter !== "all" && String(row.account_id) !== accountFilter) {
        return false;
      }
      if (!rawRowMatchesStatusFilter(row, statusFilter)) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [row.raw_date, row.raw_category, row.raw_description, row.raw_amount]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
    visibleRawRows = rows;
    if (!rows.length) {
      tbody.appendChild(emptyTableRow(8));
      updateImportSelectedButton();
      updateSelectVisibleButton();
      return;
    }

    rows.slice().reverse().forEach((rawRow) => {
      const account = state.accounts.find((candidate) => candidate.id === rawRow.account_id);
      const tr = document.createElement("tr");
      tr.classList.toggle("is-matched-row", isMatchedRawRow(rawRow));
      const checkbox = document.createElement("input");
      checkbox.className = "row-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = selectedRawRowIds.has(rawRow.id);
      checkbox.disabled = !isImportableRawRow(rawRow);
      checkbox.setAttribute("aria-label", `Select row ${rawRow.id}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedRawRowIds.add(rawRow.id);
        } else {
          selectedRawRowIds.delete(rawRow.id);
        }
        updateImportSelectedButton();
        updateSelectVisibleButton();
      });
      const noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.className = "raw-note-input";
      noteInput.value = rawRowNotes.get(rawRow.id) || "";
      noteInput.disabled = !isImportableRawRow(rawRow);
      noteInput.placeholder = isImportableRawRow(rawRow) ? "Transaction note" : "";
      noteInput.setAttribute("aria-label", `Note for row ${rawRow.id}`);
      noteInput.addEventListener("input", () => {
        const note = clean(noteInput.value);
        if (note) {
          rawRowNotes.set(rawRow.id, note);
        } else {
          rawRowNotes.delete(rawRow.id);
        }
      });

      tr.append(
        cell(checkbox),
        cell(statusBadge(rawRow), "status-cell"),
        cell(account ? account.name : "Unknown", "muted-cell"),
        cell(rawRow.raw_date || "-"),
        cell(rawValueWithPreview(rawRow.raw_category, rawRow.preview_category)),
        cell(rawValueWithPreview(rawRow.raw_description, rawRow.preview_clean_description)),
        cell(rawRow.raw_amount || "-", "amount"),
        cell(noteInput),
      );
      tbody.appendChild(tr);
    });
    updateImportSelectedButton();
    updateSelectVisibleButton();
  }

  async function importSelectedRawRows() {
    const rowIds = [...selectedRawRowIds].filter((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      return rawRow && isImportableRawRow(rawRow);
    });
    if (!rowIds.length) {
      return;
    }
    const notes = rowIds.reduce((record, rowId) => {
      const note = clean(rawRowNotes.get(rowId));
      if (note) {
        record[rowId] = note;
      }
      return record;
    }, {});

    elements.importSelectedRowsButton.disabled = true;
    elements.importSelectedRowsButton.textContent = "Importing...";
    try {
      const payload = await apiRequest("/api/raw-rows/import", {
        method: "POST",
        body: JSON.stringify({ raw_row_ids: rowIds, raw_row_notes: notes }),
      });
      rowIds.forEach((rowId) => rawRowNotes.delete(rowId));
      selectedRawRowIds.clear();
      applyStateFromPayload(payload);
      const counts = payload.import_result.counts;
      setMessage(
        `Imported ${counts.imported}; duplicates ${counts.duplicate}; errors ${counts.error}.`,
        counts.error > 0,
      );
    } catch (error) {
      alert(error.message || "Could not import selected rows.");
    } finally {
      updateImportSelectedButton();
    }
  }

  function selectVisibleRawRows() {
    const selectableIds = visibleRawRows
      .filter((row) => isImportableRawRow(row))
      .map((row) => row.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((rowId) => selectedRawRowIds.has(rowId));
    if (allSelected) {
      selectableIds.forEach((rowId) => selectedRawRowIds.delete(rowId));
    } else {
      selectableIds.forEach((rowId) => selectedRawRowIds.add(rowId));
    }
    renderRawRows();
  }

  function updateImportSelectedButton() {
    const importableCount = [...selectedRawRowIds].filter((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      return rawRow && isImportableRawRow(rawRow);
    }).length;
    elements.importSelectedRowsButton.disabled = importableCount === 0;
    elements.importSelectedRowsButton.textContent =
      importableCount === 0 ? "Import selected" : `Import selected (${importableCount})`;
  }

  function updateSelectVisibleButton() {
    const selectableIds = visibleRawRows
      .filter((row) => isImportableRawRow(row))
      .map((row) => row.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((rowId) => selectedRawRowIds.has(rowId));
    elements.selectVisibleRowsButton.disabled = selectableIds.length === 0;
    elements.selectVisibleRowsButton.textContent = allSelected ? "Clear visible" : "Select visible";
  }

  function statusBadge(rawRow) {
    const status = rawRow.import_status || "new";
    const badge = document.createElement("span");
    badge.className = `status-badge ${statusClass(status)}`;
    badge.textContent = statusLabel(status);
    if (rawRow.import_error) {
      badge.title = rawRow.import_error;
    }
    return badge;
  }

  function rawValueWithPreview(rawValue, previewValue) {
    const wrapper = document.createElement("div");
    wrapper.className = "raw-value";
    wrapper.appendChild(el("span", rawValue || "-"));
    if (previewValue) {
      wrapper.appendChild(el("span", previewValue, "rule-preview"));
    }
    return wrapper;
  }

  function isImportableRawRow(rawRow) {
    return importableRawRowStatuses.has(rawRow.import_status || "new");
  }

  function isMatchedRawRow(rawRow) {
    return rawRow.import_status === "ready";
  }

  function rawRowMatchesStatusFilter(rawRow, filter) {
    if (filter === "all") {
      return true;
    }
    if (filter === "new") {
      return isImportableRawRow(rawRow);
    }
    if (filter === "matched") {
      return isMatchedRawRow(rawRow);
    }
    if (filter === "unmatched") {
      return rawRow.import_status === "new";
    }
    return rawRow.import_status === filter;
  }

  function statusClass(status) {
    if (status === "ready") {
      return "status-new";
    }
    return `status-${status}`;
  }

  function statusLabel(status) {
    return {
      new: "New",
      ready: "New",
      imported: "Imported",
      duplicate: "Duplicate",
      error: "Error",
    }[status] || status;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"' && inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        row.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") {
          i += 1;
        }
        row.push(value);
        if (row.some((field) => field.trim() !== "")) {
          rows.push(row);
        }
        row = [];
        value = "";
      } else {
        value += char;
      }
    }

    row.push(value);
    if (row.some((field) => field.trim() !== "")) {
      rows.push(row);
    }

    if (!rows.length) {
      throw new Error("CSV file does not contain a header row.");
    }

    const headers = rows[0].map((header) => header.trim());
    const dataRows = rows.slice(1).map((items) => {
      return headers.reduce((record, header, index) => {
        record[header] = items[index] ?? "";
        return record;
      }, {});
    });

    return { headers, rows: dataRows };
  }

  function normalizeCsvRow(row) {
    let rawAmount = firstCsvValue(row, "Amount");
    if (!rawAmount && ("Debit" in row || "Credit" in row)) {
      rawAmount = signedAmountFromDebitCredit(row);
    }

    return {
      raw_date: firstCsvValue(row, "Posted Date", "Posting Date", "Date", "Transaction Date"),
      raw_category: firstCsvValue(row, "Category"),
      raw_description: firstCsvValue(row, "Description", "Memo", "Name", "Payee"),
      raw_amount: rawAmount,
    };
  }

  function firstCsvValue(row, ...names) {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(row, name)) {
        const value = clean(row[name]);
        if (value) {
          return value;
        }
      }
    }
    return null;
  }

  function signedAmountFromDebitCredit(row) {
    const debit = firstCsvValue(row, "Debit");
    const credit = firstCsvValue(row, "Credit");

    if (debit && credit) {
      return `debit=${debit}; credit=${credit}`;
    }
    if (debit) {
      return debit.startsWith("-") ? debit : `-${debit}`;
    }
    return credit;
  }

  function detectCsvLayout(fieldnames) {
    const fields = new Set(fieldnames);
    if (hasFields(fields, ["Transaction Date", "Posted Date", "Description", "Category", "Debit", "Credit"])) {
      return "capital_one_credit";
    }
    if (hasFields(fields, ["Details", "Posting Date", "Description", "Amount", "Type", "Balance"])) {
      return "chase_checking";
    }
    if (hasFields(fields, ["Date", "Description", "Type", "Amount", "Current balance", "Status"])) {
      return "sofi_bank";
    }
    return "generic_csv";
  }

  function hasFields(fields, required) {
    return required.every((field) => fields.has(field));
  }

  async function sha256(text) {
    if (!crypto.subtle) {
      return String(text.length) + ":" + text.slice(0, 64);
    }

    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function accountLabel(account) {
    return account.institution ? `${account.name} - ${account.institution}` : account.name;
  }

  function formatCents(value) {
    const cents = Number(value);
    if (!Number.isFinite(cents)) {
      return "-";
    }
    return (cents / 100).toFixed(2);
  }

  function ruleActions(rule, category, tag) {
    const actions = [];
    if (category) {
      actions.push(`category: ${category.name}`);
    } else if (rule.set_category) {
      actions.push(`category: ${rule.set_category}`);
    }
    if (rule.set_clean_description) {
      actions.push(`description: ${rule.set_clean_description}`);
    }
    if (tag) {
      actions.push(`tag: ${tag.name}`);
    }
    return actions.join(" | ");
  }

  function setMessage(message, isError = false) {
    elements.importMessage.textContent = message;
    elements.importMessage.classList.toggle("error", isError);
  }

  function setText(selector, value) {
    document.querySelector(selector).textContent = value;
  }

  function clear(node) {
    node.replaceChildren();
  }

  function appendEmpty(node) {
    node.appendChild(document.querySelector("#emptyTemplate").content.firstElementChild.cloneNode(true));
  }

  function fillSelect(select, options, emptyLabel) {
    const currentValue = select.value;
    clear(select);

    if (emptyLabel) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = emptyLabel;
      option.disabled = true;
      option.selected = true;
      select.appendChild(option);
    }

    options.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });

    if ([...select.options].some((option) => option.value === currentValue)) {
      select.value = currentValue;
    }
  }

  function tableRow(values) {
    const tr = document.createElement("tr");
    values.forEach((value) => tr.appendChild(cell(value)));
    return tr;
  }

  function emptyTableRow(colspan) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.appendChild(document.querySelector("#emptyTemplate").content.firstElementChild.cloneNode(true));
    tr.appendChild(td);
    return tr;
  }

  function cell(content, className) {
    const td = document.createElement("td");
    if (className) {
      td.className = className;
    }
    if (content instanceof Node) {
      td.appendChild(content);
    } else {
      td.textContent = content;
    }
    return td;
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    node.textContent = text;
    return node;
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }
})();

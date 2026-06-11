(function () {
  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:5050" : "";

  const defaultState = {
    accounts: [],
    tags: [],
    rules: [],
    imports: [],
    rawRows: [],
    logs: [],
  };

  let state = structuredClone(defaultState);
  const selectedRawRowIds = new Set();

  const elements = {
    tabs: document.querySelectorAll(".tab"),
    views: document.querySelectorAll(".view"),
    accountForm: document.querySelector("#accountForm"),
    importForm: document.querySelector("#importForm"),
    tagForm: document.querySelector("#tagForm"),
    ruleForm: document.querySelector("#ruleForm"),
    importMessage: document.querySelector("#importMessage"),
    importAccountSelect: document.querySelector("#importAccountSelect"),
    rawAccountFilter: document.querySelector("#rawAccountFilter"),
    rawStatusFilter: document.querySelector("#rawStatusFilter"),
    rawSearch: document.querySelector("#rawSearch"),
    importSelectedRowsButton: document.querySelector("#importSelectedRowsButton"),
    ruleTagSelect: document.querySelector("#ruleTagSelect"),
    exportJsonButton: document.querySelector("#exportJsonButton"),
    clearDataButton: document.querySelector("#clearDataButton"),
  };

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });

  elements.accountForm.addEventListener("submit", addAccount);
  elements.importForm.addEventListener("submit", importCsv);
  elements.tagForm.addEventListener("submit", addTag);
  elements.ruleForm.addEventListener("submit", addRule);
  elements.rawAccountFilter.addEventListener("change", renderRawRows);
  elements.rawStatusFilter.addEventListener("change", renderRawRows);
  elements.rawSearch.addEventListener("input", renderRawRows);
  elements.importSelectedRowsButton.addEventListener("click", importSelectedRawRows);
  elements.exportJsonButton.addEventListener("click", exportJson);
  elements.clearDataButton.addEventListener("click", clearLocalData);

  loadInitialState();

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

  async function addRule(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const setCleanDescription = clean(form.get("setCleanDescription"));
    const addTagId = Number(form.get("addTagId")) || null;

    if (!setCleanDescription && !addTagId) {
      alert("Set a clean description or tag.");
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
    renderAccountSelects();
    renderImports();
    renderSnapshotRows();
    renderTags();
    renderRules();
    renderLogs();
    renderRawRows();
  }

  function renderMetrics() {
    setText("#accountCount", state.accounts.length);
    setText("#importCount", state.imports.length);
    setText("#rawRowCount", state.rawRows.length);
    setText("#pendingImportCount", state.rawRows.filter((row) => row.import_status === "pending").length);
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
        const node = document.createElement("div");
        node.className = "list-item";
        node.append(
          el("strong", `${rule.name} (${rule.priority})`),
          el("span", `${rule.match_field} ${rule.match_type} "${rule.match_value}"`, "list-meta"),
          el("span", ruleActions(rule, tag), "list-meta"),
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
      if (statusFilter !== "all" && row.import_status !== statusFilter) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [row.raw_date, row.raw_type, row.raw_category, row.raw_description, row.raw_amount]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    if (!rows.length) {
      tbody.appendChild(emptyTableRow(8));
      updateImportSelectedButton();
      return;
    }

    rows.slice().reverse().forEach((rawRow) => {
      const account = state.accounts.find((candidate) => candidate.id === rawRow.account_id);
      const tr = document.createElement("tr");
      const checkbox = document.createElement("input");
      checkbox.className = "row-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = selectedRawRowIds.has(rawRow.id);
      checkbox.disabled = rawRow.import_status === "imported";
      checkbox.setAttribute("aria-label", `Select row ${rawRow.id}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedRawRowIds.add(rawRow.id);
        } else {
          selectedRawRowIds.delete(rawRow.id);
        }
        updateImportSelectedButton();
      });

      tr.append(
        cell(checkbox),
        cell(statusBadge(rawRow), "status-cell"),
        cell(account ? account.name : "Unknown", "muted-cell"),
        cell(rawRow.raw_date || "-"),
        cell(rawRow.raw_type || "-"),
        cell(rawRow.raw_category || "-"),
        cell(rawRow.raw_description || "-"),
        cell(rawRow.raw_amount || "-", "amount"),
      );
      tbody.appendChild(tr);
    });
    updateImportSelectedButton();
  }

  async function importSelectedRawRows() {
    const rowIds = [...selectedRawRowIds];
    if (!rowIds.length) {
      return;
    }

    elements.importSelectedRowsButton.disabled = true;
    elements.importSelectedRowsButton.textContent = "Importing...";
    try {
      const payload = await apiRequest("/api/raw-rows/import", {
        method: "POST",
        body: JSON.stringify({ raw_row_ids: rowIds }),
      });
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

  function updateImportSelectedButton() {
    elements.importSelectedRowsButton.disabled = selectedRawRowIds.size === 0;
    elements.importSelectedRowsButton.textContent =
      selectedRawRowIds.size === 0 ? "Import selected" : `Import selected (${selectedRawRowIds.size})`;
  }

  function statusBadge(rawRow) {
    const status = rawRow.import_status || "pending";
    const badge = document.createElement("span");
    badge.className = `status-badge status-${status}`;
    badge.textContent = status;
    if (rawRow.import_error) {
      badge.title = rawRow.import_error;
    }
    return badge;
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
      raw_type: firstCsvValue(row, "Type", "Details", "Status"),
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

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transaction-history-v1.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clearLocalData() {
    if (!confirm("Clear server app data?")) {
      return;
    }
    try {
      const payload = await apiRequest("/api/state", { method: "DELETE" });
      setMessage("");
      applyStateFromPayload(payload);
    } catch (error) {
      alert(error.message || "Could not clear data.");
    }
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function accountLabel(account) {
    return account.institution ? `${account.name} - ${account.institution}` : account.name;
  }

  function ruleActions(rule, tag) {
    const actions = [];
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

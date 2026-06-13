(function () {
  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:5050" : "";
  const DUMMY_DATABASE_KEY = "transaction-use-dummy-database";

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
  let editingAccountId = null;
  let editingRuleId = null;
  let activeTransactionId = null;
  let transactionEditMode = false;
  let accountDialogMode = "add";
  let ruleDialogMode = "add";
  let confirmResolver = null;
  let textInputResolver = null;
  let popupTimer = null;
  const importableRawRowStatuses = new Set(["new", "ready"]);

  const elements = {
    navItems: document.querySelectorAll(".nav-item"),
    tabNav: document.querySelector(".tabs"),
    tabs: document.querySelectorAll(".tab"),
    views: document.querySelectorAll(".view"),
    appMessage: document.querySelector("#appMessage"),
    appMessageIcon: document.querySelector("#appMessageIcon"),
    appMessageText: document.querySelector("#appMessageText"),
    accountAddButton: document.querySelector("#accountAddButton"),
    accountForm: document.querySelector("#accountForm"),
    importForm: document.querySelector("#importForm"),
    categoryForm: document.querySelector("#categoryForm"),
    tagForm: document.querySelector("#tagForm"),
    ruleForm: document.querySelector("#ruleForm"),
    importMessage: document.querySelector("#importMessage"),
    devMessage: document.querySelector("#devMessage"),
    importAccountSelect: document.querySelector("#importAccountSelect"),
    dummyDatabaseToggle: document.querySelector("#dummyDatabaseToggle"),
    dummyDatabaseLabel: document.querySelector("#dummyDatabaseLabel"),
    dummyDatabaseDescription: document.querySelector("#dummyDatabaseDescription"),
    rawAccountFilter: document.querySelector("#rawAccountFilter"),
    rawStatusFilter: document.querySelector("#rawStatusFilter"),
    rawRowsTableElement: document.querySelector("#rawRowsTableElement"),
    rawSearch: document.querySelector("#rawSearch"),
    selectVisibleRowsButton: document.querySelector("#selectVisibleRowsButton"),
    importSelectedRowsButton: document.querySelector("#importSelectedRowsButton"),
    regenerateDatabaseButton: document.querySelector("#regenerateDatabaseButton"),
    ruleAddButton: document.querySelector("#ruleAddButton"),
    ruleDialog: document.querySelector("#ruleDialog"),
    ruleCategorySelect: document.querySelector("#ruleCategorySelect"),
    ruleTagSelect: document.querySelector("#ruleTagSelect"),
    ruleCancelButton: document.querySelector("#ruleCancelButton"),
    ruleDismissButton: document.querySelector("#ruleDismissButton"),
    ruleDialogTitle: document.querySelector("#ruleDialogTitle"),
    ruleMessage: document.querySelector("#ruleMessage"),
    ruleSubmitButton: document.querySelector("#ruleSubmitButton"),
    profileButton: document.querySelector("#profileButton"),
    settingsThemeToggle: document.querySelector("#settingsThemeToggle"),
    accountDialog: document.querySelector("#accountDialog"),
    accountDialogTitle: document.querySelector("#accountDialogTitle"),
    accountCancelButton: document.querySelector("#accountCancelButton"),
    accountDismissButton: document.querySelector("#accountDismissButton"),
    accountSubmitButton: document.querySelector("#accountSubmitButton"),
    accountMessage: document.querySelector("#accountMessage"),
    textInputDialog: document.querySelector("#textInputDialog"),
    textInputForm: document.querySelector("#textInputForm"),
    textInputTitle: document.querySelector("#textInputTitle"),
    textInputLabel: document.querySelector("#textInputLabel"),
    textInputCancelButton: document.querySelector("#textInputCancelButton"),
    textInputDismissButton: document.querySelector("#textInputDismissButton"),
    confirmDialog: document.querySelector("#confirmDialog"),
    confirmForm: document.querySelector("#confirmForm"),
    confirmTitle: document.querySelector("#confirmTitle"),
    confirmMessage: document.querySelector("#confirmMessage"),
    confirmCancelButton: document.querySelector("#confirmCancelButton"),
    confirmDismissButton: document.querySelector("#confirmDismissButton"),
    confirmSubmitButton: document.querySelector("#confirmSubmitButton"),
    transactionDialog: document.querySelector("#transactionDialog"),
    transactionForm: document.querySelector("#transactionForm"),
    transactionDialogTitle: document.querySelector("#transactionDialogTitle"),
    transactionCloseButton: document.querySelector("#transactionCloseButton"),
    transactionAccountSelect: document.querySelector("#transactionAccountSelect"),
    transactionCategorySelect: document.querySelector("#transactionCategorySelect"),
    transactionTags: document.querySelector("#transactionTags"),
    transactionRawValues: document.querySelector("#transactionRawValues"),
    transactionMetadata: document.querySelector("#transactionMetadata"),
    transactionMessage: document.querySelector("#transactionMessage"),
    transactionEditButton: document.querySelector("#transactionEditButton"),
    transactionCancelButton: document.querySelector("#transactionCancelButton"),
    transactionSaveButton: document.querySelector("#transactionSaveButton"),
  };

  elements.navItems.forEach((navItem) => {
    navItem.addEventListener("click", () => activateView(navItem.dataset.defaultView));
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });

  elements.accountAddButton.addEventListener("click", openAccountAddDialog);
  elements.accountForm.addEventListener("submit", saveAccount);
  elements.importForm.addEventListener("submit", importCsv);
  elements.categoryForm.addEventListener("submit", addCategory);
  elements.tagForm.addEventListener("submit", addTag);
  elements.ruleForm.addEventListener("submit", saveRule);
  elements.rawAccountFilter.addEventListener("change", renderRawRows);
  elements.rawStatusFilter.addEventListener("change", renderRawRows);
  elements.rawSearch.addEventListener("input", renderRawRows);
  elements.selectVisibleRowsButton.addEventListener("click", selectVisibleRawRows);
  elements.importSelectedRowsButton.addEventListener("click", importSelectedRawRows);
  elements.regenerateDatabaseButton.addEventListener("click", regenerateDatabase);
  elements.dummyDatabaseToggle.addEventListener("change", updateDatabaseMode);
  elements.ruleAddButton.addEventListener("click", openRuleAddDialog);
  elements.ruleCancelButton.addEventListener("click", closeRuleDialog);
  elements.ruleDismissButton.addEventListener("click", closeRuleDialog);
  elements.ruleDialog.addEventListener("close", () => {
    editingRuleId = null;
  });
  elements.profileButton.addEventListener("click", () => activateView("settings"));
  elements.settingsThemeToggle.addEventListener("change", updateTheme);
  elements.accountCancelButton.addEventListener("click", closeAccountDialog);
  elements.accountDismissButton.addEventListener("click", closeAccountDialog);
  elements.accountDialog.addEventListener("close", () => {
    editingAccountId = null;
  });
  elements.textInputForm.addEventListener("submit", resolveTextInput);
  elements.textInputCancelButton.addEventListener("click", () => closeTextInputDialog(null));
  elements.textInputDismissButton.addEventListener("click", () => closeTextInputDialog(null));
  elements.textInputDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTextInputDialog(null);
  });
  elements.confirmForm.addEventListener("submit", resolveConfirm);
  elements.confirmCancelButton.addEventListener("click", () => closeConfirmDialog(false));
  elements.confirmDismissButton.addEventListener("click", () => closeConfirmDialog(false));
  elements.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirmDialog(false);
  });
  elements.transactionForm.addEventListener("submit", saveTransaction);
  elements.transactionCloseButton.addEventListener("click", closeTransactionDialog);
  elements.transactionEditButton.addEventListener("click", () => setTransactionEditMode(true));
  elements.transactionCancelButton.addEventListener("click", cancelTransactionEdit);
  elements.transactionDialog.addEventListener("close", () => {
    activeTransactionId = null;
    transactionEditMode = false;
  });
  document.querySelectorAll("dialog.modal").forEach((dialog) => {
    dialog.addEventListener("close", updateModalScrollLock);
  });

  initializeTheme();
  initializeDatabaseMode();
  activateView("overview");
  loadInitialState();

  function initializeTheme() {
    const theme = localStorage.getItem("transaction-theme") || "dark";
    setTheme(theme);
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("transaction-theme", theme);
    const isDark = theme === "dark";
    elements.settingsThemeToggle.checked = isDark;
  }

  function updateTheme(event) {
    setTheme(event.currentTarget.checked ? "dark" : "light");
  }

  function initializeDatabaseMode() {
    elements.dummyDatabaseToggle.checked = localStorage.getItem(DUMMY_DATABASE_KEY) === "true";
    renderDatabaseModeLabel();
  }

  function updateDatabaseMode(event) {
    localStorage.setItem(DUMMY_DATABASE_KEY, event.currentTarget.checked ? "true" : "false");
    renderDatabaseModeLabel();
    selectedRawRowIds.clear();
    rawRowNotes.clear();
    visibleRawRows = [];
    setMessage("");
    setDevMessage(event.currentTarget.checked ? "Using dummy database." : "Using primary database.");
    loadInitialState();
  }

  function isUsingDummyDatabase() {
    return elements.dummyDatabaseToggle.checked;
  }

  function renderDatabaseModeLabel() {
    if (isUsingDummyDatabase()) {
      elements.dummyDatabaseLabel.textContent = "Using dummy database";
      elements.dummyDatabaseDescription.textContent =
        "All reads, writes, imports, and dev actions are using data/transactions.dummy.sqlite.";
      return;
    }
    elements.dummyDatabaseLabel.textContent = "Using primary database";
    elements.dummyDatabaseDescription.textContent =
      "All reads, writes, imports, and dev actions are using data/transactions.sqlite.";
  }

  async function loadInitialState() {
    try {
      state = normalizeState(await apiRequest("/api/state"));
      render();
    } catch (error) {
      showPopup(error.message || "Could not load server data.", "error");
      render();
    }
  }

  async function apiRequest(path, options = {}) {
    const headers = {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-Use-Dummy-Database": isUsingDummyDatabase() ? "1" : "0",
      ...(options.headers || {}),
    };
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
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
    hidePopup();
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
    const activeTab = [...elements.tabs].find((tab) => tab.dataset.view === viewName);
    const activeNavItem = [...elements.navItems].find((navItem) => navItem.dataset.defaultView === viewName);
    const activeSection = activeTab?.dataset.section || activeNavItem?.dataset.section || "dash";
    let visibleTabCount = 0;

    elements.navItems.forEach((navItem) => {
      const isActive = navItem.dataset.section === activeSection;
      navItem.classList.toggle("is-active", isActive);
      navItem.setAttribute("aria-current", isActive ? "page" : "false");
    });
    elements.profileButton.classList.toggle("is-active", activeSection === "settings");
    elements.profileButton.setAttribute("aria-current", activeSection === "settings" ? "page" : "false");
    elements.tabs.forEach((tab) => {
      const isActive = tab.dataset.view === viewName;
      const isVisible = tab.dataset.section === activeSection;
      tab.classList.toggle("is-active", isActive);
      tab.hidden = !isVisible;
      if (isVisible) {
        visibleTabCount += 1;
      }
      tab.setAttribute("aria-current", isActive ? "page" : "false");
    });
    elements.tabNav.hidden = visibleTabCount === 0;
    elements.views.forEach((view) => view.classList.toggle("is-active", view.id === `${viewName}View`));
  }

  function openAccountAddDialog() {
    accountDialogMode = "add";
    editingAccountId = null;
    elements.accountDialogTitle.textContent = "Add Account";
    elements.accountSubmitButton.textContent = "Add Account";
    elements.accountMessage.textContent = "";
    elements.accountMessage.classList.remove("error");
    elements.accountForm.reset();
    elements.accountForm.elements.accountType.value = "checking";
    elements.accountForm.elements.currency.value = "USD";
    openModal(elements.accountDialog);
  }

  function openAccountEditDialog(account) {
    accountDialogMode = "edit";
    editingAccountId = account.id;
    elements.accountDialogTitle.textContent = "Edit Account";
    elements.accountSubmitButton.textContent = "Save";
    elements.accountMessage.textContent = "";
    elements.accountMessage.classList.remove("error");
    const form = elements.accountForm;
    form.elements.name.value = account.name || "";
    form.elements.institution.value = account.institution || "";
    form.elements.accountType.value = account.account_type || "checking";
    form.elements.currency.value = account.currency || "USD";
    openModal(elements.accountDialog);
  }

  function closeAccountDialog() {
    elements.accountDialog.close();
  }

  async function saveAccount(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currency = clean(form.get("currency")).toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      setModalMessage(elements.accountMessage, "Currency must be a three-letter code.", true);
      return;
    }

    try {
      const isEdit = accountDialogMode === "edit";
      const payload = await apiRequest(isEdit ? `/api/accounts/${editingAccountId}` : "/api/accounts", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify({
          name: clean(form.get("name")),
          institution: clean(form.get("institution")) || null,
          account_type: clean(form.get("accountType")) || null,
          currency,
        }),
      });
      closeAccountDialog();
      applyStateFromPayload(payload);
    } catch (error) {
      setModalMessage(
        elements.accountMessage,
        error.message || (accountDialogMode === "edit" ? "Could not update account." : "Could not add account."),
        true,
      );
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
      showPopup("Choose an account and CSV file.", "warning");
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
        showPopup("File already imported for this account.", "warning");
      } else {
        setMessage(`Imported ${payload.inserted_raw_row_count} raw rows from ${file.name}.`);
      }
    } catch (error) {
      showPopup(error.message || "CSV import failed.", "error");
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
      showPopup(error.message || "Could not add tag.", "error");
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
      showPopup(error.message || "Could not add category.", "error");
    }
  }

  function openRuleAddDialog() {
    ruleDialogMode = "add";
    editingRuleId = null;
    elements.ruleMessage.textContent = "";
    elements.ruleMessage.classList.remove("error");
    elements.ruleDialogTitle.textContent = "Add Rule";
    elements.ruleSubmitButton.textContent = "Add Rule";
    elements.ruleForm.reset();
    elements.ruleForm.elements.matchField.value = "description";
    elements.ruleForm.elements.matchType.value = "contains";
    elements.ruleForm.elements.priority.value = "100";
    openModal(elements.ruleDialog);
  }

  function openRuleEditDialog(rule) {
    ruleDialogMode = "edit";
    editingRuleId = rule.id;
    elements.ruleMessage.textContent = "";
    elements.ruleMessage.classList.remove("error");
    elements.ruleDialogTitle.textContent = "Edit Rule";
    elements.ruleSubmitButton.textContent = "Save";
    const form = elements.ruleForm;
    form.elements.name.value = rule.name || "";
    form.elements.matchField.value = rule.match_field || "description";
    form.elements.matchType.value = rule.match_type || "contains";
    form.elements.matchValue.value = rule.match_value || "";
    form.elements.setCleanDescription.value = rule.set_clean_description || "";
    form.elements.setCategoryId.value = rule.set_category_id === null ? "" : String(rule.set_category_id);
    form.elements.addTagId.value = rule.add_tag_id === null ? "" : String(rule.add_tag_id);
    form.elements.priority.value = String(rule.priority ?? 100);
    openModal(elements.ruleDialog);
  }

  function closeRuleDialog() {
    elements.ruleDialog.close();
  }

  async function saveRule(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const setCleanDescription = clean(form.get("setCleanDescription"));
    const setCategoryId = Number(form.get("setCategoryId")) || null;
    const addTagId = Number(form.get("addTagId")) || null;

    if (!setCategoryId && !setCleanDescription && !addTagId) {
      setModalMessage(elements.ruleMessage, "Set a clean category, clean description, or tag.", true);
      return;
    }

    try {
      const isEdit = ruleDialogMode === "edit";
      const payload = await apiRequest(isEdit ? `/api/rules/${editingRuleId}` : "/api/rules", {
        method: isEdit ? "PATCH" : "POST",
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
      closeRuleDialog();
      applyStateFromPayload(payload);
    } catch (error) {
      setModalMessage(
        elements.ruleMessage,
        error.message || (ruleDialogMode === "edit" ? "Could not update rule." : "Could not add rule."),
        true,
      );
    }
  }

  async function deleteAccount(account) {
    const confirmed = await confirmDestructive({
      title: "Delete Account",
      message: `Delete account "${account.name}"? This cannot be undone.`,
      actionLabel: "Delete Account",
    });
    if (!confirmed) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/accounts/${account.id}`, { method: "DELETE" });
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not delete account.", "error");
    }
  }

  async function editCategory(category) {
    const name = await promptForText({
      title: "Edit Category",
      label: "Category name",
      value: category.name,
    });
    if (name === null) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: clean(name) }),
      });
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not update category.", "error");
    }
  }

  async function deleteCategory(category) {
    const confirmed = await confirmDestructive({
      title: "Delete Category",
      message: `Delete category "${category.name}"? This cannot be undone.`,
      actionLabel: "Delete Category",
    });
    if (!confirmed) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/categories/${category.id}`, { method: "DELETE" });
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not delete category.", "error");
    }
  }

  async function editTag(tag) {
    const name = await promptForText({
      title: "Edit Tag",
      label: "Tag name",
      value: tag.name,
    });
    if (name === null) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/tags/${tag.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: clean(name) }),
      });
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not update tag.", "error");
    }
  }

  async function deleteTag(tag) {
    const confirmed = await confirmDestructive({
      title: "Delete Tag",
      message: `Delete tag "${tag.name}"? This cannot be undone.`,
      actionLabel: "Delete Tag",
    });
    if (!confirmed) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/tags/${tag.id}`, { method: "DELETE" });
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not delete tag.", "error");
    }
  }

  async function deleteRule(rule) {
    const confirmed = await confirmDestructive({
      title: "Delete Rule",
      message: `Delete rule "${rule.name}"? This cannot be undone.`,
      actionLabel: "Delete Rule",
    });
    if (!confirmed) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/rules/${rule.id}`, { method: "DELETE" });
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not delete rule.", "error");
    }
  }

  function render() {
    renderDashboard();
    renderAccounts();
    renderTransactions();
    renderAccountSelects();
    renderImports();
    renderCategories();
    renderTags();
    renderRules();
    renderLogs();
    renderRawRows();
  }

  function renderDashboard() {
    const period = lastFullMonthPeriod();
    const transactions = state.transactions.filter((transaction) => {
      return transaction.posted_date >= period.start && transaction.posted_date < period.end;
    });
    const income = sumTaggedTransactions(transactions, "income", false);
    const bills = sumTaggedTransactions(transactions, "bill", true);
    const splurge = sumTaggedTransactions(transactions, "splurge", true);
    const saved = income - bills - splurge;
    setText("#dashboardIncome", formatDollars(income));
    setText("#dashboardBills", formatDollars(bills));
    setText("#dashboardSplurge", formatDollars(splurge));
    setText("#dashboardSaved", formatDollars(saved));
  }

  function renderAccounts() {
    const tbody = document.querySelector("#accountsTable");
    clear(tbody);
    if (!state.accounts.length) {
      tbody.appendChild(emptyTableRow(5));
      return;
    }

    state.accounts.forEach((account) => {
      const rowCount = state.rawRows.filter((row) => row.account_id === account.id).length;
      const actions = actionButtons([
        ["edit", "Edit account", () => openAccountEditDialog(account)],
        ["close", "Delete account", () => deleteAccount(account)],
      ]);
      tbody.appendChild(tableRow([
        account.name,
        account.institution || "-",
        account.account_type || "-",
        String(rowCount),
        actions,
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
      const row = tableRow([
        transaction.posted_date || "-",
        transaction.category || "-",
        transaction.amount || formatCents(transaction.amount_cents),
        transaction.clean_description || "-",
        transaction.account || "-",
        transaction.notes || "-",
      ]);
      row.classList.add("clickable-row");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `View transaction ${transaction.clean_description || transaction.id}`);
      row.addEventListener("click", () => openTransactionDialog(transaction));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTransactionDialog(transaction);
        }
      });
      tbody.appendChild(row);
    });
  }

  function openTransactionDialog(transaction) {
    activeTransactionId = transaction.id;
    transactionEditMode = false;
    openModal(elements.transactionDialog);
    populateTransactionDialog(transaction);
    setTransactionEditMode(false);
  }

  function closeTransactionDialog() {
    elements.transactionDialog.close();
  }

  function activeTransaction() {
    return state.transactions.find((transaction) => transaction.id === activeTransactionId) || null;
  }

  function populateTransactionDialog(transaction) {
    const form = elements.transactionForm;
    elements.transactionDialogTitle.textContent = transaction.clean_description || `Transaction ${transaction.id}`;
    elements.transactionMessage.textContent = "";
    elements.transactionMessage.classList.remove("error");
    form.elements.postedDate.value = transaction.posted_date || "";
    form.elements.accountId.value = String(transaction.account_id);
    form.elements.categoryId.value = transaction.category_id === null ? "" : String(transaction.category_id);
    form.elements.amount.value = transaction.amount || formatCents(transaction.amount_cents);
    form.elements.cleanDescription.value = transaction.clean_description || "";
    form.elements.status.value = transaction.status || "posted";
    form.elements.notes.value = transaction.notes || "";
    renderTransactionTags(transaction);
    renderDefinitionList(elements.transactionRawValues, [
      ["Raw date", transaction.raw_date],
      ["Raw category", transaction.raw_category],
      ["Raw amount", transaction.raw_amount],
      ["Raw description", transaction.raw_description],
      ["Raw row status", transaction.raw_import_status],
      ["Raw row error", transaction.raw_import_error],
    ]);
    renderDefinitionList(elements.transactionMetadata, [
      ["ID", transaction.id],
      ["Account", transaction.account],
      ["Currency", transaction.currency],
      ["Transaction date", transaction.transaction_date],
      ["Raw row ID", transaction.raw_imported_row_id],
      ["Import file", transaction.import_filename],
      ["Import source", transaction.import_source_type],
      ["Imported at", formatMaybeDateTime(transaction.imported_at)],
      ["Created", formatMaybeDateTime(transaction.created_at)],
      ["Updated", formatMaybeDateTime(transaction.updated_at)],
      ["Hash", transaction.transaction_hash],
    ]);
  }

  function setTransactionEditMode(isEditing) {
    transactionEditMode = isEditing;
    const transaction = activeTransaction();
    if (transaction) {
      renderTransactionTags(transaction);
    }
    elements.transactionForm.querySelectorAll("[data-editable-field]").forEach((field) => {
      if (field.tagName === "SELECT") {
        field.disabled = !isEditing;
      } else {
        field.readOnly = !isEditing;
      }
    });
    elements.transactionTags.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.disabled = !isEditing;
    });
    elements.transactionEditButton.hidden = isEditing;
    elements.transactionCancelButton.hidden = !isEditing;
    elements.transactionSaveButton.hidden = !isEditing;
  }

  function renderTransactionTags(transaction) {
    clear(elements.transactionTags);
    const selectedTagIds = new Set((transaction.tags || []).map((tag) => Number(tag.id)));
    if (!transactionEditMode) {
      if (!transaction.tags?.length) {
        elements.transactionTags.appendChild(el("span", "No tags.", "list-meta"));
        return;
      }
      transaction.tags.forEach((tag) => {
        elements.transactionTags.appendChild(el("span", tag.name, "chip"));
      });
      return;
    }
    if (!state.tags.length) {
      elements.transactionTags.appendChild(el("span", "No tags available.", "list-meta"));
      return;
    }
    state.tags.forEach((tag) => {
      const label = document.createElement("label");
      label.className = "tag-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "tagIds";
      checkbox.value = String(tag.id);
      checkbox.checked = selectedTagIds.has(Number(tag.id));
      checkbox.disabled = !transactionEditMode;
      label.append(checkbox, el("span", tag.name));
      elements.transactionTags.appendChild(label);
    });
  }

  function cancelTransactionEdit() {
    const transaction = activeTransaction();
    if (!transaction) {
      return;
    }
    populateTransactionDialog(transaction);
    setTransactionEditMode(false);
  }

  async function saveTransaction(event) {
    event.preventDefault();
    const transaction = activeTransaction();
    if (!transaction || !transactionEditMode) {
      return;
    }
    const form = new FormData(elements.transactionForm);
    const tagIds = [...elements.transactionTags.querySelectorAll("input[type='checkbox']:checked")]
      .map((checkbox) => Number(checkbox.value))
      .filter((tagId) => Number.isInteger(tagId) && tagId > 0);
    try {
      const payload = await apiRequest(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          posted_date: clean(form.get("postedDate")),
          account_id: Number(form.get("accountId")),
          category_id: Number(form.get("categoryId")) || null,
          amount: clean(form.get("amount")),
          clean_description: clean(form.get("cleanDescription")) || null,
          status: clean(form.get("status")),
          notes: clean(form.get("notes")),
          tag_ids: tagIds,
        }),
      });
      applyStateFromPayload(payload);
      activeTransactionId = payload.transaction.id;
      populateTransactionDialog(payload.transaction);
      setTransactionEditMode(false);
    } catch (error) {
      setModalMessage(elements.transactionMessage, error.message || "Could not update transaction.", true);
    }
  }

  function renderAccountSelects() {
    const options = state.accounts.map((account) => {
      return { value: String(account.id), label: accountLabel(account) };
    });

    fillSelect(elements.importAccountSelect, options, "Select account");
    fillSelect(elements.rawAccountFilter, [{ value: "all", label: "All accounts" }, ...options]);
    fillSelect(elements.transactionAccountSelect, options);
  }

  function renderImports() {
    const importList = document.querySelector("#importList");
    clear(importList);

    if (!state.imports.length) {
      appendEmpty(importList);
      return;
    }

    state.imports.slice().reverse().forEach((item) => importList.appendChild(importListItem(item)));
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

  function renderTags() {
    const tagList = document.querySelector("#tagList");
    clear(tagList);
    if (!state.tags.length) {
      appendEmpty(tagList);
    } else {
      state.tags.forEach((tag) => {
        if (tag.is_protected) {
          tagList.appendChild(el("span", tag.name, "chip"));
        } else {
          tagList.appendChild(manageableChip(tag.name, () => editTag(tag), () => deleteTag(tag)));
        }
      });
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
      state.categories.forEach((category) => {
        categoryList.appendChild(manageableChip(category.name, () => editCategory(category), () => deleteCategory(category)));
      });
    }

    fillSelect(
      elements.ruleCategorySelect,
      [
        { value: "", label: "No category" },
        ...state.categories.map((category) => ({ value: String(category.id), label: category.name })),
      ],
    );
    fillSelect(
      elements.transactionCategorySelect,
      [
        { value: "", label: "No category" },
        ...state.categories.map((category) => ({ value: String(category.id), label: category.name })),
      ],
    );
  }

  function renderRules() {
    const tbody = document.querySelector("#rulesTable");
    clear(tbody);
    if (!state.rules.length) {
      tbody.appendChild(emptyTableRow(4));
      return;
    }

    state.rules
      .slice()
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .forEach((rule) => {
        const tag = state.tags.find((candidate) => candidate.id === rule.add_tag_id);
        const category = state.categories.find((candidate) => candidate.id === rule.set_category_id);
        tbody.appendChild(tableRow([
          `${rule.name} (${rule.priority})`,
          `${rule.match_field} ${rule.match_type} "${rule.match_value}"`,
          ruleActions(rule, category, tag) || "-",
          actionButtons([
            ["edit", "Edit rule", () => openRuleEditDialog(rule)],
            ["close", "Delete rule", () => deleteRule(rule)],
          ]),
        ]));
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
    const hiddenColumns = new Set();
    if (accountFilter !== "all") {
      hiddenColumns.add("account");
    }
    if (statusFilter !== "all") {
      hiddenColumns.add("status");
    }
    updateRawColumnHeaders(hiddenColumns);
    const rawColumnCount = 8 - hiddenColumns.size;
    const search = elements.rawSearch.value.trim().toLowerCase();

    [...selectedRawRowIds].forEach((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      if (!rawRow || !isImportableRawRow(rawRow)) {
        selectedRawRowIds.delete(rowId);
      }
    });

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
      tbody.appendChild(emptyTableRow(rawColumnCount));
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

      const cells = [
        ["select", cell(checkbox)],
        ["status", cell(statusBadge(rawRow), "status-cell")],
        ["account", cell(account ? account.name : "Unknown", "muted-cell")],
        ["date", cell(rawRow.raw_date || "-")],
        ["category", cell(rawValueWithPreview(rawRow.raw_category, rawRow.preview_category))],
        ["description", cell(rawValueWithPreview(rawRow.raw_description, rawRow.preview_clean_description))],
        ["amount", cell(rawRow.raw_amount || "-", "amount")],
        ["notes", cell(noteInput)],
      ];
      tr.append(...cells.filter(([column]) => !hiddenColumns.has(column)).map(([, node]) => node));
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
      showPopup(error.message || "Could not import selected rows.", "error");
    } finally {
      updateImportSelectedButton();
    }
  }

  async function regenerateDatabase() {
    const confirmed = await confirmDestructive({
      title: "Regenerate Database",
      message: "Regenerate the database? This permanently deletes all accounts, imports, transactions, categories, tags, rules, and logs.",
      actionLabel: "Regenerate",
    });
    if (!confirmed) {
      return;
    }

    setDevMessage("Regenerating database...");
    elements.regenerateDatabaseButton.disabled = true;
    try {
      const payload = await apiRequest("/api/dev/regenerate-database", {
        method: "POST",
        body: JSON.stringify({ confirm: "DELETE ALL DATA" }),
      });
      selectedRawRowIds.clear();
      rawRowNotes.clear();
      visibleRawRows = [];
      applyStateFromPayload(payload);
      setDevMessage("Database regenerated.");
    } catch (error) {
      showPopup(error.message || "Could not regenerate database.", "error");
    } finally {
      elements.regenerateDatabaseButton.disabled = false;
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

  function updateRawColumnHeaders(hiddenColumns) {
    elements.rawRowsTableElement.querySelectorAll("th[data-raw-column]").forEach((header) => {
      header.hidden = hiddenColumns.has(header.dataset.rawColumn);
    });
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
    return importableRawRowStatuses.has(rawRow.import_status || "new") && hasMatchedCategory(rawRow);
  }

  function hasMatchedCategory(rawRow) {
    return Boolean(clean(rawRow.preview_category));
  }

  function isMatchedRawRow(rawRow) {
    return rawRow.import_status === "ready";
  }

  function rawRowMatchesStatusFilter(rawRow, filter) {
    if (filter === "all") {
      return true;
    }
    if (filter === "new") {
      return importableRawRowStatuses.has(rawRow.import_status || "new");
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

  function lastFullMonthPeriod() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      start: formatDateKey(start),
      end: formatDateKey(end),
    };
  }

  function formatDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function sumTaggedTransactions(transactions, tagName, useAbsoluteValue) {
    return transactions.reduce((total, transaction) => {
      const hasTag = (transaction.tags || []).some((tag) => tag.name === tagName);
      if (!hasTag) {
        return total;
      }
      const amount = Number(transaction.amount_cents) || 0;
      return total + (useAbsoluteValue ? Math.abs(amount) : amount);
    }, 0);
  }

  function formatDollars(cents) {
    const amount = Math.abs(cents) / 100;
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
    }).format(amount);
    return cents < 0 ? `-${formatted}` : formatted;
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

  function promptForText({ title, label, value }) {
    if (textInputResolver) {
      closeTextInputDialog(null);
    }
    elements.textInputTitle.textContent = title;
    elements.textInputLabel.textContent = label;
    elements.textInputForm.elements.value.value = value || "";
    openModal(elements.textInputDialog, { focusSingleTextField: true });
    return new Promise((resolve) => {
      textInputResolver = resolve;
    });
  }

  function resolveTextInput(event) {
    event.preventDefault();
    const value = clean(elements.textInputForm.elements.value.value);
    if (!value) {
      return;
    }
    closeTextInputDialog(value);
  }

  function closeTextInputDialog(value) {
    if (elements.textInputDialog.open) {
      elements.textInputDialog.close();
    }
    if (textInputResolver) {
      textInputResolver(value);
      textInputResolver = null;
    }
  }

  function confirmDestructive({ title, message, actionLabel }) {
    if (confirmResolver) {
      closeConfirmDialog(false);
    }
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmSubmitButton.textContent = actionLabel;
    openModal(elements.confirmDialog);
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function resolveConfirm(event) {
    event.preventDefault();
    closeConfirmDialog(true);
  }

  function closeConfirmDialog(confirmed) {
    if (elements.confirmDialog.open) {
      elements.confirmDialog.close();
    }
    if (confirmResolver) {
      confirmResolver(confirmed);
      confirmResolver = null;
    }
  }

  function setModalMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function showPopup(message, severity = "info") {
    if (popupTimer) {
      window.clearTimeout(popupTimer);
      popupTimer = null;
    }
    const icons = {
      info: "info",
      success: "check_circle",
      warning: "warning",
      error: "error",
    };
    elements.appMessageIcon.textContent = icons[severity] || icons.info;
    elements.appMessageText.textContent = message;
    elements.appMessage.classList.remove("info", "success", "warning", "error");
    elements.appMessage.classList.add(severity);
    elements.appMessage.classList.toggle("is-visible", Boolean(message));
    if (message) {
      popupTimer = window.setTimeout(hidePopup, 6000);
    }
  }

  function hidePopup() {
    if (popupTimer) {
      window.clearTimeout(popupTimer);
      popupTimer = null;
    }
    elements.appMessage.classList.remove("is-visible", "info", "success", "warning", "error");
    elements.appMessageText.textContent = "";
  }

  function setMessage(message, isError = false) {
    elements.importMessage.textContent = message;
    elements.importMessage.classList.toggle("error", isError);
  }

  function setDevMessage(message, isError = false) {
    elements.devMessage.textContent = message;
    elements.devMessage.classList.toggle("error", isError);
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

  function renderDefinitionList(list, items) {
    clear(list);
    items.forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value === null || value === undefined || value === "" ? "-" : String(value);
      list.append(term, detail);
    });
  }

  function openModal(dialog, { focusSingleTextField } = {}) {
    dialog.showModal();
    updateModalScrollLock();
    if (focusSingleTextField) {
      const input = dialog.querySelector("input[type='text']");
      input?.focus();
      input?.select();
      return;
    }
    dialog.focus({ preventScroll: true });
  }

  function updateModalScrollLock() {
    const hasOpenModal = Boolean(document.querySelector("dialog.modal[open]"));
    document.body.classList.toggle("modal-open", hasOpenModal);
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

  function actionButtons(actions) {
    const wrapper = document.createElement("div");
    wrapper.className = "action-row";
    actions.forEach(([icon, label, handler]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = icon === "close" ? "icon-only danger" : "icon-only";
      button.title = label;
      button.setAttribute("aria-label", label);
      const symbol = document.createElement("span");
      symbol.className = "material-symbols-outlined";
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = icon;
      button.appendChild(symbol);
      button.addEventListener("click", handler);
      wrapper.appendChild(button);
    });
    return wrapper;
  }

  function manageableChip(label, onEdit, onDelete) {
    const wrapper = document.createElement("span");
    wrapper.className = "chip manageable-chip";
    wrapper.append(
      el("span", label),
      actionButtons([
        ["edit", `Edit ${label}`, onEdit],
        ["close", `Delete ${label}`, onDelete],
      ]),
    );
    return wrapper;
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

  function formatMaybeDateTime(value) {
    return value ? formatDateTime(value) : "-";
  }
})();

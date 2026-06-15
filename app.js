(function () {
  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:5050" : "";
  const DUMMY_DATABASE_KEY = "transaction-use-dummy-database";
  const DASHBOARD_RANGE_KEY = "transaction-dashboard-range";
  const DASHBOARD_CUSTOM_START_KEY = "transaction-dashboard-custom-start";
  const DASHBOARD_CUSTOM_END_KEY = "transaction-dashboard-custom-end";
  const DEFAULT_DASHBOARD_RANGE = "last-month";
  const CUSTOM_DASHBOARD_RANGE = "custom";
  const dashboardRangePresets = [
    { value: "this-month", label: "This month" },
    { value: "last-month", label: "Last month" },
    { value: "this-year", label: "This year" },
    { value: "last-year", label: "Last year" },
  ];

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
  let editingCategoryId = null;
  let activeTransactionId = null;
  let activeRawRowId = null;
  let transactionEditMode = false;
  let accountDialogMode = "add";
  let ruleDialogMode = "add";
  let confirmResolver = null;
  let textInputResolver = null;
  let textInputDeleteHandler = null;
  let categoryPickerTarget = null;
  let popupTimer = null;
  let dashboardRangeDraft = null;
  const importableRawRowStatuses = new Set(["new", "ready"]);
  const transactionTypes = [
    { value: "income", label: "Income" },
    { value: "bill", label: "Bill" },
    { value: "splurge", label: "Splurge" },
  ];
  const comfortableCategoryColors = [
    "#2f8f2f",
    "#d27da8",
    "#91a82f",
    "#3f7fc2",
    "#d07b2f",
    "#3f9f72",
    "#c85d5d",
    "#7c6bc2",
    "#239f9f",
    "#b68b2e",
    "#a8adb3",
    "#4f93a8",
    "#7a5234",
    "#6f944f",
    "#5f666d",
  ];
  const defaultCategoryOrder = [
    "Income", "Salary", "Bonus", "Interest", "Dividend", "Refund", "Gift Received",
    "Housing", "Rent", "Mortgage", "Property Tax", "HOA", "Home Insurance", "Home Maintenance",
    "Utility", "Electric", "Gas", "Water", "Sewer", "Trash", "Internet", "Phone",
    "Transportation", "Car Payment", "Fuel", "Charging", "Auto Insurance", "Maintenance", "Registration", "Parking", "Toll", "Public Transit",
    "Food & Dining", "Groceries", "Restaurant",
    "Shopping", "Clothing", "Electronic", "Household", "Furniture",
    "Health", "Medical", "Dental", "Vision", "Pharmacy", "Fitness",
    "Entertainment", "Activity", "Streaming", "Gaming", "Movie", "Music", "Hobby",
    "Travel", "Hotel", "Flight", "Rental",
    "Financial", "Fee", "Loan Payment", "Investment Contribution", "Tax Payment",
    "Insurance", "Life Insurance", "Umbrella Insurance",
    "Education", "Tuition", "Books", "Courses", "Certifications",
    "Family & Personal", "Childcare", "Pet Expense", "Gift Given", "Personal Care",
    "Business", "Software", "Equipment", "Service", "Office Expense",
    "Transfer", "Brokerage Transfer", "Internal Transfer", "Credit Card Payment",
  ];

  const elements = {
    navItems: document.querySelectorAll(".nav-item"),
    tabNav: document.querySelector(".tabs"),
    tabs: document.querySelectorAll(".tab"),
    views: document.querySelectorAll(".view"),
    appMessage: document.querySelector("#appMessage"),
    appMessageIcon: document.querySelector("#appMessageIcon"),
    appMessageText: document.querySelector("#appMessageText"),
    dashboardTypeBar: document.querySelector("#dashboardTypeBar"),
    dashboardTypeBarLegend: document.querySelector("#dashboardTypeBarLegend"),
    dashboardCategoryPie: document.querySelector("#dashboardCategoryPie"),
    dashboardCategoryLegend: document.querySelector("#dashboardCategoryLegend"),
    dashboardSplurgePie: document.querySelector("#dashboardSplurgePie"),
    dashboardSplurgeLegend: document.querySelector("#dashboardSplurgeLegend"),
    accountAddButton: document.querySelector("#accountAddButton"),
    accountForm: document.querySelector("#accountForm"),
    importForm: document.querySelector("#importForm"),
    categoryAddButton: document.querySelector("#categoryAddButton"),
    tagAddButton: document.querySelector("#tagAddButton"),
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
    selectVisibleRowsButton: document.querySelector("#selectVisibleRowsButton"),
    importSelectedRowsButton: document.querySelector("#importSelectedRowsButton"),
    regenerateDatabaseButton: document.querySelector("#regenerateDatabaseButton"),
    ruleAddButton: document.querySelector("#ruleAddButton"),
    ruleDialog: document.querySelector("#ruleDialog"),
    ruleCategoryInput: document.querySelector("#ruleCategoryInput"),
    ruleCategoryButton: document.querySelector("#ruleCategoryButton"),
    ruleTypeInput: document.querySelector("#ruleTypeInput"),
    ruleTypeGroup: document.querySelector("#ruleTypeGroup"),
    ruleTags: document.querySelector("#ruleTags"),
    ruleCancelButton: document.querySelector("#ruleCancelButton"),
    ruleDismissButton: document.querySelector("#ruleDismissButton"),
    ruleDialogTitle: document.querySelector("#ruleDialogTitle"),
    ruleMessage: document.querySelector("#ruleMessage"),
    ruleSubmitButton: document.querySelector("#ruleSubmitButton"),
    ruleDeleteButton: document.querySelector("#ruleDeleteButton"),
    profileButton: document.querySelector("#profileButton"),
    settingsThemeToggle: document.querySelector("#settingsThemeToggle"),
    dashboardRangeButton: document.querySelector("#dashboardRangeButton"),
    dashboardRangeLabel: document.querySelector("#dashboardRangeLabel"),
    dashboardRangeDialog: document.querySelector("#dashboardRangeDialog"),
    dashboardRangeForm: document.querySelector("#dashboardRangeForm"),
    dashboardRangeCloseButton: document.querySelector("#dashboardRangeCloseButton"),
    dashboardRangePresetList: document.querySelector("#dashboardRangePresetList"),
    dashboardCalendarGrid: document.querySelector("#dashboardCalendarGrid"),
    dashboardRangeCancelButton: document.querySelector("#dashboardRangeCancelButton"),
    dashboardRangeApplyButton: document.querySelector("#dashboardRangeApplyButton"),
    dashboardCustomStart: document.querySelector("#dashboardCustomStart"),
    dashboardCustomEnd: document.querySelector("#dashboardCustomEnd"),
    accountDialog: document.querySelector("#accountDialog"),
    accountDialogTitle: document.querySelector("#accountDialogTitle"),
    accountCancelButton: document.querySelector("#accountCancelButton"),
    accountDismissButton: document.querySelector("#accountDismissButton"),
    accountSubmitButton: document.querySelector("#accountSubmitButton"),
    accountDeleteButton: document.querySelector("#accountDeleteButton"),
    accountMessage: document.querySelector("#accountMessage"),
    textInputDialog: document.querySelector("#textInputDialog"),
    textInputForm: document.querySelector("#textInputForm"),
    textInputTitle: document.querySelector("#textInputTitle"),
    textInputLabel: document.querySelector("#textInputLabel"),
    textInputCancelButton: document.querySelector("#textInputCancelButton"),
    textInputDismissButton: document.querySelector("#textInputDismissButton"),
    textInputDeleteButton: document.querySelector("#textInputDeleteButton"),
    confirmDialog: document.querySelector("#confirmDialog"),
    confirmForm: document.querySelector("#confirmForm"),
    confirmTitle: document.querySelector("#confirmTitle"),
    confirmMessage: document.querySelector("#confirmMessage"),
    confirmCancelButton: document.querySelector("#confirmCancelButton"),
    confirmDismissButton: document.querySelector("#confirmDismissButton"),
    confirmSubmitButton: document.querySelector("#confirmSubmitButton"),
    confirmOption: document.querySelector("#confirmOption"),
    confirmOptionInput: document.querySelector("#confirmOptionInput"),
    confirmOptionLabel: document.querySelector("#confirmOptionLabel"),
    transactionDialog: document.querySelector("#transactionDialog"),
    transactionForm: document.querySelector("#transactionForm"),
    transactionDialogTitle: document.querySelector("#transactionDialogTitle"),
    transactionCloseButton: document.querySelector("#transactionCloseButton"),
    transactionCategoryInput: document.querySelector("#transactionCategoryInput"),
    transactionCategoryButton: document.querySelector("#transactionCategoryButton"),
    transactionCategoryFilterButton: document.querySelector("#transactionCategoryFilterButton"),
    transactionTypeInput: document.querySelector("#transactionTypeInput"),
    transactionTypeGroup: document.querySelector("#transactionTypeGroup"),
    transactionCategoryFilter: document.querySelector("#transactionCategoryFilter"),
    transactionSearch: document.querySelector("#transactionSearch"),
    transactionTags: document.querySelector("#transactionTags"),
    transactionRawValues: document.querySelector("#transactionRawValues"),
    transactionMetadata: document.querySelector("#transactionMetadata"),
    transactionMessage: document.querySelector("#transactionMessage"),
    transactionEditButton: document.querySelector("#transactionEditButton"),
    transactionCancelButton: document.querySelector("#transactionCancelButton"),
    transactionSaveButton: document.querySelector("#transactionSaveButton"),
    transactionDeleteButton: document.querySelector("#transactionDeleteButton"),
    rawRowDialog: document.querySelector("#rawRowDialog"),
    rawRowForm: document.querySelector("#rawRowForm"),
    rawRowDialogTitle: document.querySelector("#rawRowDialogTitle"),
    rawRowCloseButton: document.querySelector("#rawRowCloseButton"),
    rawRowDismissButton: document.querySelector("#rawRowDismissButton"),
    rawRowDeleteButton: document.querySelector("#rawRowDeleteButton"),
    rawRowSaveButton: document.querySelector("#rawRowSaveButton"),
    rawRowRawValues: document.querySelector("#rawRowRawValues"),
    rawRowMatchedValues: document.querySelector("#rawRowMatchedValues"),
    rawRowImportValues: document.querySelector("#rawRowImportValues"),
    rawRowNoteInput: document.querySelector("#rawRowNoteInput"),
    categoryDialog: document.querySelector("#categoryDialog"),
    categoryDialogForm: document.querySelector("#categoryDialogForm"),
    categoryDialogTitle: document.querySelector("#categoryDialogTitle"),
    categoryCloseButton: document.querySelector("#categoryCloseButton"),
    categoryCancelButton: document.querySelector("#categoryCancelButton"),
    categoryDeleteButton: document.querySelector("#categoryDeleteButton"),
    categorySubmitButton: document.querySelector("#categorySubmitButton"),
    categoryParentSelect: document.querySelector("#categoryParentSelect"),
    categoryColorControl: document.querySelector("#categoryColorControl"),
    categoryColorInput: document.querySelector("#categoryColorInput"),
    categoryColorSwatch: document.querySelector("#categoryColorSwatch"),
    categoryColorRandomizeButton: document.querySelector("#categoryColorRandomizeButton"),
    categoryMessage: document.querySelector("#categoryMessage"),
    categoryPickerDialog: document.querySelector("#categoryPickerDialog"),
    categoryPickerTitle: document.querySelector("#categoryPickerTitle"),
    categoryPickerCloseButton: document.querySelector("#categoryPickerCloseButton"),
    categoryPickerCancelButton: document.querySelector("#categoryPickerCancelButton"),
    categoryPickerClearButton: document.querySelector("#categoryPickerClearButton"),
    categoryPickerList: document.querySelector("#categoryPickerList"),
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
  elements.categoryAddButton.addEventListener("click", openCategoryAddDialog);
  elements.tagAddButton.addEventListener("click", addTag);
  elements.ruleForm.addEventListener("submit", saveRule);
  elements.rawAccountFilter.addEventListener("change", renderRawRows);
  elements.rawStatusFilter.addEventListener("change", renderRawRows);
  elements.selectVisibleRowsButton.addEventListener("click", selectVisibleRawRows);
  elements.importSelectedRowsButton.addEventListener("click", importSelectedRawRows);
  elements.regenerateDatabaseButton.addEventListener("click", regenerateDatabase);
  elements.dummyDatabaseToggle.addEventListener("change", updateDatabaseMode);
  elements.ruleAddButton.addEventListener("click", () => openRuleAddDialog());
  elements.ruleCancelButton.addEventListener("click", closeRuleDialog);
  elements.ruleDismissButton.addEventListener("click", closeRuleDialog);
  elements.ruleDeleteButton.addEventListener("click", deleteEditingRule);
  elements.ruleForm.elements.matchDescriptionEnabled.addEventListener("change", updateRuleMatchInputs);
  elements.ruleForm.elements.matchCategoryEnabled.addEventListener("change", updateRuleMatchInputs);
  elements.ruleCategoryButton.addEventListener("click", () => openCategoryPicker("rule"));
  elements.ruleTypeGroup.addEventListener("click", (event) => selectTypeFromGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup));
  elements.ruleTypeGroup.addEventListener("keydown", (event) => navigateTypeGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup));
  elements.ruleDialog.addEventListener("close", () => {
    editingRuleId = null;
  });
  elements.profileButton.addEventListener("click", () => activateView("settings"));
  elements.settingsThemeToggle.addEventListener("change", updateTheme);
  elements.dashboardRangeButton.addEventListener("click", openDashboardRangeDialog);
  elements.dashboardRangeForm.addEventListener("submit", applyDashboardRange);
  elements.dashboardRangeCloseButton.addEventListener("click", closeDashboardRangeDialog);
  elements.dashboardRangeCancelButton.addEventListener("click", closeDashboardRangeDialog);
  elements.dashboardCustomStart.addEventListener("change", updateDashboardCustomRange);
  elements.dashboardCustomEnd.addEventListener("change", updateDashboardCustomRange);
  elements.dashboardRangeDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDashboardRangeDialog();
  });
  elements.accountCancelButton.addEventListener("click", closeAccountDialog);
  elements.accountDismissButton.addEventListener("click", closeAccountDialog);
  elements.accountDeleteButton.addEventListener("click", deleteEditingAccount);
  elements.accountDialog.addEventListener("close", () => {
    editingAccountId = null;
  });
  elements.textInputForm.addEventListener("submit", resolveTextInput);
  elements.textInputCancelButton.addEventListener("click", () => closeTextInputDialog(null));
  elements.textInputDismissButton.addEventListener("click", () => closeTextInputDialog(null));
  elements.textInputDeleteButton.addEventListener("click", async () => {
    if (textInputDeleteHandler) {
      await textInputDeleteHandler();
    }
  });
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
  elements.transactionCategoryFilterButton.addEventListener("click", () => openCategoryPicker("transaction-filter"));
  elements.transactionCloseButton.addEventListener("click", closeTransactionDialog);
  elements.transactionEditButton.addEventListener("click", () => setTransactionEditMode(true));
  elements.transactionCancelButton.addEventListener("click", cancelTransactionDialogAction);
  elements.transactionDeleteButton.addEventListener("click", deleteActiveTransaction);
  elements.transactionCategoryButton.addEventListener("click", () => {
    if (transactionEditMode) {
      openCategoryPicker("transaction");
    }
  });
  elements.transactionTypeGroup.addEventListener("click", (event) => {
    if (transactionEditMode) {
      selectTypeFromGroup(event, elements.transactionTypeInput, elements.transactionTypeGroup);
    }
  });
  elements.transactionTypeGroup.addEventListener("keydown", (event) => {
    if (transactionEditMode) {
      navigateTypeGroup(event, elements.transactionTypeInput, elements.transactionTypeGroup);
    }
  });
  elements.rawRowForm.addEventListener("submit", saveRawRowNote);
  elements.rawRowCloseButton.addEventListener("click", closeRawRowDialog);
  elements.rawRowDismissButton.addEventListener("click", closeRawRowDialog);
  elements.rawRowDeleteButton.addEventListener("click", deleteActiveRawRow);
  elements.rawRowDialog.addEventListener("close", () => {
    activeRawRowId = null;
  });
  elements.transactionSearch.addEventListener("input", renderTransactions);
  elements.transactionDialog.addEventListener("close", () => {
    activeTransactionId = null;
    transactionEditMode = false;
  });
  elements.categoryDialogForm.addEventListener("submit", saveCategory);
  elements.categoryCloseButton.addEventListener("click", closeCategoryDialog);
  elements.categoryCancelButton.addEventListener("click", closeCategoryDialog);
  elements.categoryDeleteButton.addEventListener("click", deleteEditingCategory);
  elements.categoryParentSelect.addEventListener("change", updateCategoryColorControl);
  elements.categoryColorRandomizeButton.addEventListener("click", () => setCategoryDialogColor(randomComfortableColor()));
  elements.categoryDialog.addEventListener("close", () => {
    editingCategoryId = null;
  });
  elements.categoryPickerCloseButton.addEventListener("click", closeCategoryPicker);
  elements.categoryPickerCancelButton.addEventListener("click", closeCategoryPicker);
  elements.categoryPickerClearButton.addEventListener("click", () => selectPickedCategory(null));
  elements.categoryPickerDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCategoryPicker();
  });
  document.querySelectorAll("dialog.modal").forEach((dialog) => {
    dialog.addEventListener("close", updateModalScrollLock);
  });

  initializeTheme();
  initializeDashboardRange();
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

  function initializeDashboardRange() {
    const savedRange = localStorage.getItem(DASHBOARD_RANGE_KEY) || DEFAULT_DASHBOARD_RANGE;
    const validRange = dashboardRangeValues().has(savedRange) ? savedRange : DEFAULT_DASHBOARD_RANGE;
    localStorage.setItem(DASHBOARD_RANGE_KEY, validRange);
    renderDashboardRangeButton();
  }

  function dashboardRangeValues() {
    return new Set([...dashboardRangePresets.map((preset) => preset.value), CUSTOM_DASHBOARD_RANGE]);
  }

  function openDashboardRangeDialog() {
    dashboardRangeDraft = currentDashboardRangeState();
    elements.dashboardCustomStart.value = dashboardRangeDraft.start || "";
    elements.dashboardCustomEnd.value = dashboardRangeDraft.end || "";
    renderDashboardRangeDialog();
    openModal(elements.dashboardRangeDialog);
  }

  function closeDashboardRangeDialog() {
    dashboardRangeDraft = null;
    elements.dashboardRangeDialog.close();
  }

  function applyDashboardRange(event) {
    event.preventDefault();
    if (!dashboardRangeDraft) {
      return;
    }
    localStorage.setItem(DASHBOARD_RANGE_KEY, dashboardRangeDraft.range);
    if (dashboardRangeDraft.range === CUSTOM_DASHBOARD_RANGE) {
      localStorage.setItem(DASHBOARD_CUSTOM_START_KEY, dashboardRangeDraft.start || "");
      localStorage.setItem(DASHBOARD_CUSTOM_END_KEY, dashboardRangeDraft.end || "");
    }
    renderDashboardRangeButton();
    renderDashboard();
    closeDashboardRangeDialog();
  }

  function updateDashboardCustomRange() {
    if (!dashboardRangeDraft) {
      return;
    }
    dashboardRangeDraft.range = CUSTOM_DASHBOARD_RANGE;
    dashboardRangeDraft.start = elements.dashboardCustomStart.value;
    dashboardRangeDraft.end = elements.dashboardCustomEnd.value;
    dashboardRangeDraft.viewDate = dashboardRangeDraft.start ? firstOfMonth(parseDateKey(dashboardRangeDraft.start)) : dashboardRangeDraft.viewDate;
    renderDashboardRangeDialog();
  }

  function currentDashboardRangeState() {
    const savedRange = localStorage.getItem(DASHBOARD_RANGE_KEY) || DEFAULT_DASHBOARD_RANGE;
    const range = dashboardRangeValues().has(savedRange) ? savedRange : DEFAULT_DASHBOARD_RANGE;
    return dashboardRangeState(range);
  }

  function dashboardRangeState(range) {
    const period = dashboardPeriodForRange(range);
    const inclusiveEnd = formatDateKey(addDays(parseDateKey(period.end), -1));
    const customStart = localStorage.getItem(DASHBOARD_CUSTOM_START_KEY) || "";
    const customEnd = localStorage.getItem(DASHBOARD_CUSTOM_END_KEY) || "";
    return {
      range,
      start: range === CUSTOM_DASHBOARD_RANGE ? customStart : period.start,
      end: range === CUSTOM_DASHBOARD_RANGE ? customEnd : inclusiveEnd,
      viewDate: firstOfMonth(rangeStartDate(range)),
    };
  }

  function renderDashboardRangeButton() {
    const period = dashboardPeriod();
    elements.dashboardRangeLabel.textContent = formatDateRangeLabel(period.start, period.end);
  }

  function renderDashboardRangeDialog() {
    renderDashboardRangePresets();
    renderDashboardCalendars();
    elements.dashboardRangeApplyButton.disabled =
      dashboardRangeDraft?.range === CUSTOM_DASHBOARD_RANGE && (!dashboardRangeDraft.start || !dashboardRangeDraft.end);
  }

  function renderDashboardRangePresets() {
    clear(elements.dashboardRangePresetList);
    dashboardRangePresets.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "range-preset-button";
      button.classList.toggle("is-active", dashboardRangeDraft?.range === preset.value);
      button.textContent = preset.label;
      button.addEventListener("click", () => selectDashboardRangePreset(preset.value));
      elements.dashboardRangePresetList.appendChild(button);
    });
  }

  function selectDashboardRangePreset(range) {
    dashboardRangeDraft.range = range;
    const period = dashboardPeriodForRange(range);
    dashboardRangeDraft.start = period.start;
    dashboardRangeDraft.end = formatDateKey(addDays(parseDateKey(period.end), -1));
    dashboardRangeDraft.viewDate = firstOfMonth(parseDateKey(period.start));
    elements.dashboardCustomStart.value = dashboardRangeDraft.start || "";
    elements.dashboardCustomEnd.value = dashboardRangeDraft.end || "";
    renderDashboardRangeDialog();
  }

  function renderDashboardCalendars() {
    clear(elements.dashboardCalendarGrid);
    const viewDate = dashboardRangeDraft?.viewDate || firstOfMonth(new Date());
    elements.dashboardCalendarGrid.append(
      calendarMonthElement(viewDate, -1),
      calendarMonthElement(addMonths(viewDate, 1), 1),
    );
  }

  function calendarMonthElement(monthDate, direction) {
    const container = document.createElement("section");
    container.className = "calendar-month";
    const header = document.createElement("div");
    header.className = "calendar-month-header";
    const previous = calendarNavButton("chevron_left", () => shiftDashboardCalendar(-1));
    const next = calendarNavButton("chevron_right", () => shiftDashboardCalendar(1));
    const title = el("strong", monthDate.toLocaleDateString(undefined, { month: "short", year: "numeric" }));
    header.append(direction < 0 ? previous : document.createElement("span"), title, direction > 0 ? next : document.createElement("span"));

    const grid = document.createElement("div");
    grid.className = "calendar-grid";
    ["S", "M", "T", "W", "T", "F", "S"].forEach((day) => grid.appendChild(el("span", day, "calendar-weekday")));
    const firstDay = firstOfMonth(monthDate);
    for (let index = 0; index < firstDay.getDay(); index += 1) {
      grid.appendChild(el("span", "", "calendar-empty-day"));
    }
    const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const key = formatDateKey(date);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      button.textContent = String(day);
      button.classList.toggle("is-in-range", isDraftDateInRange(key));
      button.classList.toggle("is-range-edge", key === dashboardRangeDraft?.start || key === dashboardRangeDraft?.end);
      button.addEventListener("click", () => selectDashboardCustomDay(key));
      grid.appendChild(button);
    }
    container.append(header, grid);
    return container;
  }

  function calendarNavButton(icon, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-only calendar-nav-button";
    button.setAttribute("aria-label", icon === "chevron_left" ? "Previous month" : "Next month");
    button.appendChild(el("span", icon, "material-symbols-outlined"));
    button.addEventListener("click", handler);
    return button;
  }

  function shiftDashboardCalendar(months) {
    dashboardRangeDraft.viewDate = addMonths(dashboardRangeDraft.viewDate, months);
    renderDashboardRangeDialog();
  }

  function selectDashboardCustomDay(key) {
    dashboardRangeDraft.range = CUSTOM_DASHBOARD_RANGE;
    if (!dashboardRangeDraft.start || dashboardRangeDraft.end) {
      dashboardRangeDraft.start = key;
      dashboardRangeDraft.end = "";
    } else if (key < dashboardRangeDraft.start) {
      dashboardRangeDraft.end = dashboardRangeDraft.start;
      dashboardRangeDraft.start = key;
    } else {
      dashboardRangeDraft.end = key;
    }
    elements.dashboardCustomStart.value = dashboardRangeDraft.start;
    elements.dashboardCustomEnd.value = dashboardRangeDraft.end;
    renderDashboardRangeDialog();
  }

  function isDraftDateInRange(key) {
    if (!dashboardRangeDraft?.start) {
      return false;
    }
    const end = dashboardRangeDraft.end || dashboardRangeDraft.start;
    return key >= dashboardRangeDraft.start && key <= end;
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
    loadInitialState();
  }

  function isUsingDummyDatabase() {
    return elements.dummyDatabaseToggle.checked;
  }

  function renderDatabaseModeLabel() {
    elements.dummyDatabaseLabel.textContent = "Database";
    if (isUsingDummyDatabase()) {
      elements.dummyDatabaseDescription.textContent = "Using dummy database";
      return;
    }
    elements.dummyDatabaseDescription.textContent = "Using primary database";
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
    elements.accountDialogTitle.textContent = "Create Account";
    elements.accountSubmitButton.textContent = "Create Account";
    elements.accountDeleteButton.hidden = true;
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
    elements.accountDeleteButton.hidden = false;
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
    const sourceType = "csv";

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
      applyStateFromPayload(payload);
      if (payload.status === "already_imported") {
        showPopup("File already imported for this account.", "warning");
      } else {
        setMessage(`Imported ${payload.inserted_raw_row_count} raw transactions from ${file.name}.`);
      }
    } catch (error) {
      showPopup(error.message || "CSV import failed.", "error");
    }
  }

  async function addTag() {
    const name = await promptForText({
      title: "Create Tag",
      label: "Tag name",
      value: "",
    });
    if (!name) {
      return;
    }
    try {
      const payload = await apiRequest("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not add tag.", "error");
    }
  }

  function openCategoryAddDialog() {
    editingCategoryId = null;
    elements.categoryDialogTitle.textContent = "Create Category";
    elements.categorySubmitButton.textContent = "Create Category";
    elements.categoryDeleteButton.hidden = true;
    elements.categoryMessage.textContent = "";
    elements.categoryMessage.classList.remove("error");
    elements.categoryDialogForm.reset();
    populateCategoryParentSelect();
    setCategoryDialogColor(randomComfortableColor());
    updateCategoryColorControl();
    openModal(elements.categoryDialog);
  }

  function openCategoryEditDialog(category) {
    editingCategoryId = category.id;
    elements.categoryDialogTitle.textContent = "Edit Category";
    elements.categorySubmitButton.textContent = "Save";
    elements.categoryDeleteButton.hidden = Boolean(category.is_default);
    elements.categoryMessage.textContent = "";
    elements.categoryMessage.classList.remove("error");
    elements.categoryDialogForm.elements.name.value = category.name || "";
    populateCategoryParentSelect(category);
    elements.categoryDialogForm.elements.parentId.value = category.parent_id === null ? "" : String(category.parent_id);
    setCategoryDialogColor(category.color || randomComfortableColor());
    updateCategoryColorControl();
    openModal(elements.categoryDialog);
  }

  function closeCategoryDialog() {
    elements.categoryDialog.close();
  }

  async function saveCategory(event) {
    event.preventDefault();
    const form = new FormData(elements.categoryDialogForm);
    const payload = {
      name: clean(form.get("name")),
      parent_id: Number(form.get("parentId")) || null,
      color: clean(form.get("parentId")) ? null : clean(form.get("color")),
    };
    try {
      const response = await apiRequest(editingCategoryId ? `/api/categories/${editingCategoryId}` : "/api/categories", {
        method: editingCategoryId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeCategoryDialog();
      applyStateFromPayload(response);
    } catch (error) {
      setModalMessage(elements.categoryMessage, error.message || "Could not save category.", true);
    }
  }

  function setCategoryDialogColor(color) {
    elements.categoryColorInput.value = color;
    elements.categoryColorSwatch.style.setProperty("--category-color", color);
  }

  function updateCategoryColorControl() {
    const isParent = !clean(elements.categoryParentSelect.value);
    elements.categoryColorControl.hidden = !isParent;
  }

  function randomComfortableColor() {
    return comfortableCategoryColors[Math.floor(Math.random() * comfortableCategoryColors.length)];
  }

  function updateRuleMatchInputs() {
    const form = elements.ruleForm;
    const descriptionEnabled = form.elements.matchDescriptionEnabled.checked;
    const categoryEnabled = form.elements.matchCategoryEnabled.checked;
    form.elements.matchDescription.disabled = !descriptionEnabled;
    form.elements.matchDescription.required = descriptionEnabled;
    form.elements.matchCategory.disabled = !categoryEnabled;
    form.elements.matchCategory.required = categoryEnabled;
  }

  function ruleMatchValues(rule) {
    const description = clean(rule.match_description) ||
      (rule.match_field === "description" ? clean(rule.match_value) : "");
    const category = clean(rule.match_category) ||
      (rule.match_field === "category" ? clean(rule.match_value) : "");
    return { description, category };
  }

  function selectTypeFromGroup(event, input, group) {
    const button = event.target.closest("[data-type-value]");
    if (!button || button.disabled || !group.contains(button)) {
      return;
    }
    setTypeGroupValue(input, group, button.dataset.typeValue);
  }

  function setTypeGroupValue(input, group, value) {
    const normalized = clean(value) || "splurge";
    input.value = normalized;
    group.querySelectorAll("[data-type-value]").forEach((button) => {
      const isSelected = button.dataset.typeValue === normalized;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-checked", isSelected ? "true" : "false");
      button.tabIndex = isSelected ? 0 : -1;
    });
  }

  function setTypeGroupDisabled(group, isDisabled) {
    group.querySelectorAll("[data-type-value]").forEach((button) => {
      button.disabled = isDisabled;
    });
  }

  function navigateTypeGroup(event, input, group) {
    const buttons = [...group.querySelectorAll("[data-type-value]")].filter((button) => !button.disabled);
    if (!buttons.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = Math.max(0, buttons.findIndex((button) => button.dataset.typeValue === input.value));
    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    }
    setTypeGroupValue(input, group, buttons[nextIndex].dataset.typeValue);
    buttons[nextIndex].focus();
  }

  function openRuleAddDialog(prefill = {}) {
    ruleDialogMode = "add";
    editingRuleId = null;
    elements.ruleMessage.textContent = "";
    elements.ruleMessage.classList.remove("error");
    elements.ruleDialogTitle.textContent = "Create Rule";
    elements.ruleSubmitButton.textContent = "Create Rule";
    elements.ruleDeleteButton.hidden = true;
    elements.ruleForm.reset();
    const matchDescription = clean(prefill.matchDescription);
    const matchCategory = clean(prefill.matchCategory);
    elements.ruleForm.elements.matchDescription.value = matchDescription;
    elements.ruleForm.elements.matchCategory.value = matchCategory;
    elements.ruleForm.elements.matchDescriptionEnabled.checked = Boolean(matchDescription) || !matchCategory;
    elements.ruleForm.elements.matchCategoryEnabled.checked = Boolean(matchCategory);
    elements.ruleForm.elements.priority.value = "100";
    setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, "splurge");
    setRuleCategoryValue(null);
    updateRuleMatchInputs();
    renderRuleTags([]);
    openModal(elements.ruleDialog);
  }

  function openRuleEditDialog(rule) {
    ruleDialogMode = "edit";
    editingRuleId = rule.id;
    elements.ruleMessage.textContent = "";
    elements.ruleMessage.classList.remove("error");
    elements.ruleDialogTitle.textContent = "Edit Rule";
    elements.ruleSubmitButton.textContent = "Save";
    elements.ruleDeleteButton.hidden = false;
    const form = elements.ruleForm;
    const matches = ruleMatchValues(rule);
    form.elements.name.value = rule.name || "";
    form.elements.matchDescriptionEnabled.checked = Boolean(matches.description);
    form.elements.matchDescription.value = matches.description;
    form.elements.matchCategoryEnabled.checked = Boolean(matches.category);
    form.elements.matchCategory.value = matches.category;
    form.elements.setCleanDescription.value = rule.set_clean_description || "";
    setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, rule.set_transaction_type || "income");
    setRuleCategoryValue(rule.set_category_id);
    renderRuleTags(rule.tag_ids || (rule.add_tag_id === null ? [] : [rule.add_tag_id]));
    form.elements.priority.value = String(rule.priority ?? 100);
    updateRuleMatchInputs();
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
    const setTransactionType = clean(form.get("setTransactionType"));
    const setCategoryId = Number(form.get("setCategoryId")) || null;
    const matchDescription = form.has("matchDescriptionEnabled") ? clean(form.get("matchDescription")) : null;
    const matchCategory = form.has("matchCategoryEnabled") ? clean(form.get("matchCategory")) : null;
    const addTagIds = [...elements.ruleTags.querySelectorAll("input[type='checkbox']:checked")]
      .map((checkbox) => Number(checkbox.value))
      .filter((tagId) => Number.isInteger(tagId) && tagId > 0);

    if (!matchDescription && !matchCategory) {
      setModalMessage(elements.ruleMessage, "Match description, category, or both.", true);
      return;
    }

    if (!setCategoryId && !setCleanDescription && !setTransactionType && !addTagIds.length) {
      setModalMessage(elements.ruleMessage, "Set a category, description, type, or tag.", true);
      return;
    }

    try {
      const isEdit = ruleDialogMode === "edit";
      const payload = await apiRequest(isEdit ? `/api/rules/${editingRuleId}` : "/api/rules", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify({
          name: clean(form.get("name")),
          match_description: matchDescription || null,
          match_category: matchCategory || null,
          set_category_id: setCategoryId,
          set_clean_description: setCleanDescription || null,
          set_transaction_type: setTransactionType || null,
          add_tag_ids: addTagIds,
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
      message: destructiveMessage(`Delete account "${account.name}"?`),
      actionLabel: "Delete Account",
    });
    if (!confirmed) {
      return false;
    }
    try {
      const payload = await apiRequest(`/api/accounts/${account.id}`, { method: "DELETE" });
      applyStateFromPayload(payload);
      return true;
    } catch (error) {
      showPopup(error.message || "Could not delete account.", "error");
      return false;
    }
  }

  async function deleteEditingAccount() {
    const account = state.accounts.find((candidate) => candidate.id === editingAccountId);
    if (!account) {
      return;
    }
    if (await deleteAccount(account)) {
      closeAccountDialog();
    }
  }

  async function editCategory(category) {
    openCategoryEditDialog(category);
  }

  async function deleteCategory(category) {
    const confirmed = await confirmDestructive({
      title: "Delete Category",
      message: destructiveMessage(`Delete category "${category.name}"?`),
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

  async function deleteEditingCategory() {
    const category = state.categories.find((candidate) => candidate.id === editingCategoryId);
    if (!category) {
      return;
    }
    await deleteCategory(category);
    if (!state.categories.some((candidate) => candidate.id === editingCategoryId)) {
      closeCategoryDialog();
    }
  }

  async function editTag(tag) {
    const name = await promptForText({
      title: "Edit Tag",
      label: "Tag name",
      value: tag.name,
      deleteLabel: "Delete",
      onDelete: async () => {
        if (await deleteTag(tag)) {
          closeTextInputDialog(null);
        }
      },
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
      message: destructiveMessage(`Delete tag "${tag.name}"?`),
      actionLabel: "Delete Tag",
    });
    if (!confirmed) {
      return false;
    }
    try {
      const payload = await apiRequest(`/api/tags/${tag.id}`, { method: "DELETE" });
      applyStateFromPayload(payload);
      return true;
    } catch (error) {
      showPopup(error.message || "Could not delete tag.", "error");
      return false;
    }
  }

  async function deleteRule(rule) {
    const confirmed = await confirmDestructive({
      title: "Delete Rule",
      message: destructiveMessage(`Delete rule "${rule.name}"?`),
      actionLabel: "Delete Rule",
    });
    if (!confirmed) {
      return false;
    }
    try {
      const payload = await apiRequest(`/api/rules/${rule.id}`, { method: "DELETE" });
      applyStateFromPayload(payload);
      return true;
    } catch (error) {
      showPopup(error.message || "Could not delete rule.", "error");
      return false;
    }
  }

  async function deleteEditingRule() {
    const rule = state.rules.find((candidate) => candidate.id === editingRuleId);
    if (!rule) {
      return;
    }
    if (await deleteRule(rule)) {
      closeRuleDialog();
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
    const period = dashboardPeriod();
    const transactions = state.transactions.filter((transaction) => {
      return transaction.posted_date >= period.start && transaction.posted_date < period.end;
    });
    const income = sumTypedTransactions(transactions, "income", false);
    const bills = sumTypedTransactions(transactions, "bill", true);
    const splurge = sumTypedTransactions(transactions, "splurge", true);
    const saved = income - bills - splurge;
    setText("#dashboardIncome", formatDollars(income));
    setText("#dashboardBills", formatDollars(bills));
    setText("#dashboardSplurge", formatDollars(splurge));
    setText("#dashboardSaved", formatDollars(saved));
    renderStackedBar(elements.dashboardTypeBar, elements.dashboardTypeBarLegend, [
      { label: "Bills", value: bills, color: "#c85d5d" },
      { label: "Splurge", value: splurge, color: "#7c6bc2" },
      { label: "Saved", value: Math.max(saved, 0), color: "#2f8f2f" },
    ]);
    renderPieChart(elements.dashboardCategoryPie, elements.dashboardCategoryLegend, categorySpendingSegments(transactions, ["bill", "splurge"]));
    renderPieChart(elements.dashboardSplurgePie, elements.dashboardSplurgeLegend, categorySpendingSegments(transactions, ["splurge"]));
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
      const row = tableRow([
        account.name,
        account.institution || "-",
        account.account_type || "-",
        String(rowCount),
      ]);
      makeEditableRow(row, `Edit account ${account.name}`, () => openAccountEditDialog(account));
      tbody.appendChild(row);
    });
  }

  function renderTransactions() {
    const tbody = document.querySelector("#transactionsTable");
    clear(tbody);
    const categoryFilter = Number(elements.transactionCategoryFilter.value) || null;
    const categoryIds = categoryFilter === null ? null : new Set([categoryFilter, ...categoryDescendantIds(categoryFilter)]);
    const search = clean(elements.transactionSearch.value).toLowerCase();
    const transactions = state.transactions.filter((transaction) => {
      if (categoryIds && !categoryIds.has(Number(transaction.category_id))) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [
        transaction.posted_date,
        transaction.category,
        transaction.amount || formatCents(transaction.amount_cents),
        transaction.clean_description,
        transaction.account,
        transaction.notes,
      ].join(" ").toLowerCase().includes(search);
    });
    if (!transactions.length) {
      tbody.appendChild(emptyTableRow(6));
      return;
    }

    transactions.forEach((transaction) => {
      const category = state.categories.find((candidate) => candidate.id === transaction.category_id)
        || state.categories.find((candidate) => candidate.name === transaction.category);
      const row = tableRow([
        displayDateCell(transaction.posted_date),
        category ? displayCategoryChip(category) : transaction.category || "-",
        transaction.clean_description || "-",
        transaction.amount || formatCents(transaction.amount_cents),
        transaction.account || "-",
        transaction.notes || "-",
      ]);
      row.children[0]?.classList.add("date-cell");
      row.children[3]?.classList.add("amount");
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
    populateTransactionDialog(transaction);
    setTransactionEditMode(false);
    openModal(elements.transactionDialog);
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
    setTypeGroupValue(elements.transactionTypeInput, elements.transactionTypeGroup, transaction.transaction_type || "splurge");
    setTransactionCategoryValue(transaction.category_id);
    form.elements.amount.value = transaction.amount || formatCents(transaction.amount_cents);
    form.elements.cleanDescription.value = transaction.clean_description || "";
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
    elements.transactionCategoryButton.disabled = !isEditing;
    setTypeGroupDisabled(elements.transactionTypeGroup, !isEditing);
    elements.transactionEditButton.hidden = isEditing;
    elements.transactionCancelButton.hidden = false;
    elements.transactionSaveButton.hidden = !isEditing;
  }

  function renderTransactionTags(transaction) {
    clear(elements.transactionTags);
    const selectedTagIds = new Set((transaction.tags || []).map((tag) => Number(tag.id)));
    if (!transactionEditMode) {
      if (!transaction.tags?.length) {
        elements.transactionTags.appendChild(el("span", "-", "list-meta"));
        return;
      }
      transaction.tags.forEach((tag) => {
        elements.transactionTags.appendChild(staticTagChip(tag.name));
      });
      return;
    }
    if (!state.tags.length) {
      elements.transactionTags.appendChild(el("span", "No tags available.", "list-meta"));
      return;
    }
    state.tags.forEach((tag) => {
      elements.transactionTags.appendChild(selectableTagChip(tag, selectedTagIds.has(Number(tag.id)), "tagIds"));
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

  function cancelTransactionDialogAction() {
    if (transactionEditMode) {
      cancelTransactionEdit();
      suppressButtonState(elements.transactionCancelButton);
      return;
    }
    closeTransactionDialog();
  }

  function suppressButtonState(button) {
    button.blur();
    button.classList.add("suppress-button-state");
    button.addEventListener("pointerleave", () => {
      button.classList.remove("suppress-button-state");
    }, { once: true });
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
          category_id: Number(form.get("categoryId")),
          transaction_type: clean(form.get("transactionType")) || null,
          amount: clean(form.get("amount")),
          clean_description: clean(form.get("cleanDescription")) || null,
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

  async function deleteActiveTransaction() {
    const transaction = activeTransaction();
    if (!transaction) {
      return;
    }
    const confirmed = await confirmDestructive({
      title: "Delete Transaction",
      message: destructiveMessage(`Delete transaction "${transaction.clean_description || transaction.id}"?`),
      actionLabel: "Delete Transaction",
      optionLabel: transaction.raw_imported_row_id ? `Also delete associated raw transaction ${transaction.raw_imported_row_id}` : "",
    });
    if (!confirmed) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/transactions/${transaction.id}`, {
        method: "DELETE",
        body: JSON.stringify({ delete_raw_row: Boolean(confirmed.optionChecked) }),
      });
      closeTransactionDialog();
      applyStateFromPayload(payload);
    } catch (error) {
      setModalMessage(elements.transactionMessage, error.message || "Could not delete transaction.", true);
    }
  }

  function openRawRowDialog(rawRow) {
    activeRawRowId = rawRow.id;
    populateRawRowDialog(rawRow);
    openModal(elements.rawRowDialog);
  }

  function closeRawRowDialog() {
    elements.rawRowDialog.close();
  }

  function activeRawRow() {
    return state.rawRows.find((row) => row.id === activeRawRowId) || null;
  }

  function populateRawRowDialog(rawRow) {
    const account = state.accounts.find((candidate) => candidate.id === rawRow.account_id);
    const shouldCreateRule = shouldOfferRuleCreation(rawRow);
    elements.rawRowDialogTitle.textContent = `Raw Transaction ${rawRow.id}`;
    elements.rawRowNoteInput.value = rawRowNotes.get(rawRow.id) || "";
    elements.rawRowNoteInput.disabled = false;
    elements.rawRowSaveButton.textContent = shouldCreateRule ? "Create Rule" : "Save";
    renderDefinitionList(elements.rawRowRawValues, [
      ["Date", formatDisplayDate(rawRow.raw_date)],
      ["Category", rawRow.raw_category],
      ["Description", rawRow.raw_description],
      ["Amount", rawRow.raw_amount],
      ["Hash", rawRow.raw_row_hash],
    ]);
    renderDefinitionList(elements.rawRowMatchedValues, [
      ["Matched", isMatchedRawRow(rawRow) ? "Yes" : "No"],
      ["Importable", isImportableRawRow(rawRow) ? "Yes" : "No"],
      ["Category", rawRow.preview_category],
      ["Description", rawRow.preview_clean_description],
      ["Type", transactionTypeLabel(rawRow.preview_type)],
    ]);
    renderDefinitionList(elements.rawRowImportValues, [
      ["Account", account ? accountLabel(account) : "Unknown"],
      ["Status", rawRow.import_status],
      ["Error", rawRow.import_error],
      ["Source ID", rawRow.imported_source_id],
      ["Parsed transaction ID", rawRow.parsed_transaction_id],
      ["Created", formatMaybeDateTime(rawRow.created_at)],
      ["Updated", formatMaybeDateTime(rawRow.updated_at)],
    ]);
  }

  function shouldOfferRuleCreation(rawRow) {
    return rawRow.import_status !== "imported" && !isImportableRawRow(rawRow);
  }

  function saveRawRowNote(event) {
    event.preventDefault();
    const rawRow = activeRawRow();
    if (!rawRow) {
      closeRawRowDialog();
      return;
    }
    if (shouldOfferRuleCreation(rawRow)) {
      closeRawRowDialog();
      openRuleAddDialog({
        matchDescription: rawRow.raw_description,
        matchCategory: rawRow.raw_category,
      });
      return;
    }
    const note = clean(elements.rawRowNoteInput.value);
    if (note) {
      rawRowNotes.set(rawRow.id, note);
    } else {
      rawRowNotes.delete(rawRow.id);
    }
    renderRawRows();
    closeRawRowDialog();
  }

  async function deleteActiveRawRow() {
    const rawRow = activeRawRow();
    if (!rawRow) {
      return;
    }
    const associatedTransactionId = rawRow.import_status === "imported" ? rawRow.parsed_transaction_id : null;
    const confirmed = await confirmDestructive({
      title: "Delete Raw Transaction",
      message: destructiveMessage(`Delete raw transaction ${rawRow.id}?`),
      actionLabel: "Delete",
      optionLabel: associatedTransactionId ? `Also delete associated transaction ${associatedTransactionId}` : "",
    });
    if (!confirmed) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/raw-rows/${rawRow.id}`, {
        method: "DELETE",
        body: JSON.stringify({ delete_transaction: Boolean(confirmed.optionChecked) }),
      });
      selectedRawRowIds.delete(rawRow.id);
      rawRowNotes.delete(rawRow.id);
      closeRawRowDialog();
      applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not delete raw transaction.", "error");
    }
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
    clear(importList);

    if (!state.imports.length) {
      appendEmpty(importList);
      return;
    }

    state.imports.slice().reverse().slice(0, 5).forEach((item) => importList.appendChild(importListItem(item)));
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
          tagList.appendChild(staticTagChip(tag.name));
        } else {
          tagList.appendChild(editableTagChip(tag, () => editTag(tag)));
        }
      });
    }

  }

  function renderRuleTags(selectedTagIds) {
    clear(elements.ruleTags);
    const selected = new Set(selectedTagIds.map((tagId) => Number(tagId)));
    if (!state.tags.length) {
      elements.ruleTags.appendChild(el("span", "No tags available.", "list-meta"));
      return;
    }
    state.tags.forEach((tag) => {
      elements.ruleTags.appendChild(selectableTagChip(tag, selected.has(Number(tag.id)), "addTagIds"));
    });
  }

  function selectedCategory(categoryId) {
    const id = Number(categoryId);
    return Number.isInteger(id) && id > 0
      ? state.categories.find((category) => category.id === id) || null
      : null;
  }

  function renderCategoryButton(button, categoryId, fallbackLabel = "No category") {
    clear(button);
    const category = selectedCategory(categoryId);
    if (category) {
      button.appendChild(plainCategoryChip(category));
    } else {
      button.appendChild(el("span", fallbackLabel, "chip category-chip empty-category-chip"));
    }
  }

  function setRuleCategoryValue(categoryId) {
    elements.ruleCategoryInput.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.ruleCategoryButton, elements.ruleCategoryInput.value);
  }

  function setTransactionCategoryValue(categoryId) {
    elements.transactionCategoryInput.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.transactionCategoryButton, elements.transactionCategoryInput.value, "Select category");
  }

  function setTransactionCategoryFilterValue(categoryId) {
    elements.transactionCategoryFilter.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.transactionCategoryFilterButton, elements.transactionCategoryFilter.value, "All categories");
    renderTransactions();
  }

  function renderCategories() {
    const categoryList = document.querySelector("#categoryList");
    clear(categoryList);
    if (!state.categories.length) {
      appendEmpty(categoryList);
    } else {
      renderCategorySections(categoryList);
    }

    renderCategoryButton(elements.ruleCategoryButton, elements.ruleCategoryInput.value);
    renderCategoryButton(elements.transactionCategoryButton, elements.transactionCategoryInput.value, "Select category");
    renderCategoryButton(elements.transactionCategoryFilterButton, elements.transactionCategoryFilter.value, "All categories");
  }

  function populateCategoryParentSelect(category = null) {
    if (category && categoryDescendantIds(category.id).size > 0) {
      fillSelect(elements.categoryParentSelect, [{ value: "", label: "No parent" }]);
      return;
    }
    const options = orderedCategories()
      .filter((option) => option.parent_id === null && option.id !== category?.id)
      .map((option) => ({ value: String(option.id), label: option.name }));
    fillSelect(elements.categoryParentSelect, [{ value: "", label: "No parent" }, ...options]);
  }

  function categoryOptions() {
    return orderedCategories().map((category) => ({ value: String(category.id), label: categoryLabel(category) }));
  }

  function openCategoryPicker(target) {
    categoryPickerTarget = target;
    const canClear = target === "rule" || target === "transaction-filter";
    elements.categoryPickerTitle.textContent = target === "rule"
      ? "Select Clean Category"
      : target === "transaction-filter"
        ? "Filter By Category"
        : "Select Category";
    elements.categoryPickerClearButton.textContent = target === "transaction-filter" ? "All Categories" : "No Category";
    elements.categoryPickerClearButton.hidden = !canClear;
    renderCategoryPicker();
    openModal(elements.categoryPickerDialog);
  }

  function closeCategoryPicker() {
    categoryPickerTarget = null;
    elements.categoryPickerDialog.close();
  }

  function renderCategoryPicker() {
    clear(elements.categoryPickerList);
    if (!state.categories.length) {
      appendEmpty(elements.categoryPickerList);
      return;
    }
    const selectedId = categoryPickerTarget === "transaction"
      ? Number(elements.transactionCategoryInput.value) || null
      : categoryPickerTarget === "transaction-filter"
        ? Number(elements.transactionCategoryFilter.value) || null
        : Number(elements.ruleCategoryInput.value) || null;
    renderCategorySections(elements.categoryPickerList, {
      selectable: true,
      selectedId,
      onSelect: (category) => selectPickedCategory(category.id),
    });
  }

  function selectPickedCategory(categoryId) {
    if (categoryPickerTarget === "transaction") {
      if (categoryId === null) {
        return;
      }
      setTransactionCategoryValue(categoryId);
    } else if (categoryPickerTarget === "transaction-filter") {
      setTransactionCategoryFilterValue(categoryId);
    } else if (categoryPickerTarget === "rule") {
      setRuleCategoryValue(categoryId);
    }
    closeCategoryPicker();
  }

  function renderCategorySections(categoryList, options = {}) {
    const selectable = Boolean(options.selectable);
    const roots = orderedCategories().filter((category) => category.parent_id === null);
    const rendered = new Set();
    roots.forEach((root) => {
      const section = document.createElement("section");
      section.className = "category-section";
      const header = document.createElement("div");
      header.className = "category-section-heading";
      header.appendChild(el("h3", root.name));
      if (!root.is_default) {
        header.appendChild(actionButtons([["edit", `Edit ${root.name}`, () => editCategory(root)]]));
      }
      const chips = document.createElement("div");
      chips.className = "category-section-chips";
      const children = orderedCategories().filter((category) => category.parent_id === root.id);
      if (selectable) {
        chips.appendChild(selectableCategoryChip(root, options.selectedId === root.id, options.onSelect));
        rendered.add(root.id);
      }
      if (!selectable && !children.length && !root.is_default) {
        chips.appendChild(selectable
          ? selectableCategoryChip(root, options.selectedId === root.id, options.onSelect)
          : categoryChip(root));
        rendered.add(root.id);
      }
      children.forEach((child) => {
        chips.appendChild(selectable
          ? selectableCategoryChip(child, options.selectedId === child.id, options.onSelect)
          : categoryChip(child));
        rendered.add(child.id);
      });
      section.append(header, chips);
      categoryList.appendChild(section);
      rendered.add(root.id);
    });
    orderedCategories()
      .filter((category) => !rendered.has(category.id))
      .forEach((category) => categoryList.appendChild(selectable
        ? selectableCategoryChip(category, options.selectedId === category.id, options.onSelect)
        : categoryChip(category)));
  }

  function selectableCategoryChip(category, isSelected, onSelect) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-picker-chip";
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    if (isSelected) {
      button.classList.add("is-selected");
    }
    button.appendChild(plainCategoryChip(category));
    button.addEventListener("click", () => onSelect?.(category));
    return button;
  }

  function categoryChip(category) {
    const chip = category.is_default ? plainCategoryChip(category) : manageableChip(category.name, () => editCategory(category), "category-chip");
    chip.style.setProperty("--category-color", effectiveCategoryColor(category));
    return chip;
  }

  function plainCategoryChip(category) {
    const chip = el("span", category.name, "chip category-chip");
    chip.style.setProperty("--category-color", effectiveCategoryColor(category));
    return chip;
  }

  function staticTagChip(label) {
    return el("span", label, "tag-chip tag-chip-filled");
  }

  function editableTagChip(tag, onEdit) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip tag-chip-filled tag-chip-action";
    button.append(materialIcon("edit"), el("span", tag.name));
    button.addEventListener("click", onEdit);
    return button;
  }

  function selectableTagChip(tag, isSelected, inputName) {
    const label = document.createElement("label");
    label.className = `tag-chip tag-chip-select${isSelected ? " is-selected" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = inputName;
    checkbox.value = String(tag.id);
    checkbox.checked = isSelected;
    const icon = materialIcon("check");
    icon.classList.add("tag-chip-check");
    label.append(checkbox, icon, el("span", tag.name));
    checkbox.addEventListener("change", () => {
      label.classList.toggle("is-selected", checkbox.checked);
    });
    return label;
  }

  function displayCategoryChip(category) {
    const chip = el("span", "", "chip category-chip transaction-category-chip");
    chip.style.setProperty("--category-color", effectiveCategoryColor(category));
    manualChipWrap(category.name, 11).forEach((line) => {
      chip.appendChild(el("span", line, "transaction-category-chip-line"));
    });
    return chip;
  }

  function manualChipWrap(label, maxLineLength) {
    const words = clean(label).split(/\s+/).filter(Boolean);
    if (!words.length) {
      return ["-"];
    }
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (current && next.length > maxLineLength) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) {
      lines.push(current);
    }
    return lines;
  }

  function effectiveCategoryColor(category) {
    if (category.color) {
      return category.color;
    }
    const parent = state.categories.find((candidate) => candidate.id === category.parent_id);
    return parent?.color || comfortableCategoryColors[0];
  }

  function orderedCategories() {
    return state.categories.slice().sort((a, b) => categorySortKey(a).localeCompare(categorySortKey(b)));
  }

  function categorySortKey(category) {
    const parent = state.categories.find((candidate) => candidate.id === category.parent_id);
    const parentName = parent?.name || category.name;
    const parentIndex = defaultCategoryOrder.indexOf(parentName);
    const categoryIndex = defaultCategoryOrder.indexOf(category.name);
    const parentRank = parentIndex === -1 ? 999 : parentIndex;
    const categoryRank = category.parent_id === null ? -1 : categoryIndex === -1 ? 999 : categoryIndex;
    return `${String(parentRank).padStart(3, "0")}:${parentName}:${String(categoryRank).padStart(3, "0")}:${category.name}`;
  }

  function categoryLabel(category) {
    const parent = state.categories.find((candidate) => candidate.id === category.parent_id);
    return parent ? `${parent.name} / ${category.name}` : category.name;
  }

  function categoryDescendantIds(categoryId) {
    const descendants = new Set();
    const visit = (parentId) => {
      state.categories
        .filter((category) => category.parent_id === parentId)
        .forEach((category) => {
          descendants.add(category.id);
          visit(category.id);
        });
    };
    visit(categoryId);
    return descendants;
  }

  function renderRules() {
    const tbody = document.querySelector("#rulesTable");
    clear(tbody);
    if (!state.rules.length) {
      tbody.appendChild(emptyTableRow(3));
      return;
    }

    state.rules
      .slice()
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .forEach((rule) => {
        const tag = state.tags.find((candidate) => candidate.id === rule.add_tag_id);
        const category = state.categories.find((candidate) => candidate.id === rule.set_category_id);
        const row = tableRow([
          `${rule.name} (${rule.priority})`,
          ruleMatchSummary(rule),
          ruleActions(rule, category, tag) || "-",
        ]);
        makeEditableRow(row, `Edit rule ${rule.name}`, () => openRuleEditDialog(rule));
        tbody.appendChild(row);
      });
  }

  function ruleMatchSummary(rule) {
    const matches = ruleMatchValues(rule);
    const list = document.createElement("div");
    list.className = "effects-list";
    if (matches.description) {
      list.appendChild(el("span", `Description contains "${matches.description}"`));
    }
    if (matches.category) {
      list.appendChild(el("span", `Category contains "${matches.category}"`));
    }
    return list.childElementCount ? list : "-";
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
      return true;
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
      makeEditableRow(tr, `View raw transaction ${rawRow.id}`, () => openRawRowDialog(rawRow));
      const checkbox = document.createElement("input");
      checkbox.className = "row-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = selectedRawRowIds.has(rawRow.id);
      checkbox.disabled = !isImportableRawRow(rawRow);
      checkbox.setAttribute("aria-label", `Select row ${rawRow.id}`);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
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
      noteInput.addEventListener("click", (event) => event.stopPropagation());
      noteInput.addEventListener("keydown", (event) => event.stopPropagation());
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
        ["date", cell(displayDateCell(rawRow.raw_date), "date-cell")],
        ["category", cell(rawValueWithPreview(rawRow.raw_category, rawRow.preview_category))],
        ["description", cell(rawValueWithPreview(rawRow.raw_description, rawRow.preview_clean_description))],
        ["amount", cell(rawRow.raw_amount || "-", "amount")],
        ["account", cell(account ? account.name : "Unknown", "muted-cell")],
        ["notes", cell(noteInput)],
        ["status", cell(statusBadge(rawRow), "status-cell")],
      ];
      tr.append(...cells
        .filter(([column]) => !hiddenColumns.has(column))
        .map(([column, node]) => {
          node.dataset.rawColumn = column;
          return node;
        }));
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
    elements.importSelectedRowsButton.title = "Importing";
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
      title: "Restore Dummy Database",
      message: destructiveMessage("Restore dummy database?"),
      actionLabel: "Restore",
    });
    if (!confirmed) {
      return;
    }

    setDevMessage("Restoring dummy database...");
    elements.regenerateDatabaseButton.disabled = true;
    try {
      const payload = await apiRequest("/api/dev/regenerate-database", {
        method: "POST",
        body: JSON.stringify({ confirm: "RESTORE DUMMY DATABASE" }),
      });
      selectedRawRowIds.clear();
      rawRowNotes.clear();
      visibleRawRows = [];
      elements.dummyDatabaseToggle.checked = true;
      localStorage.setItem(DUMMY_DATABASE_KEY, "true");
      renderDatabaseModeLabel();
      applyStateFromPayload(payload);
      setDevMessage("Dummy database restored.");
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
    elements.importSelectedRowsButton.hidden = importableCount === 0;
    elements.importSelectedRowsButton.title =
      importableCount === 0 ? "Import selected" : `Import selected (${importableCount})`;
    elements.importSelectedRowsButton.setAttribute("aria-label", elements.importSelectedRowsButton.title);
  }

  function updateSelectVisibleButton() {
    const selectableIds = visibleRawRows
      .filter((row) => isImportableRawRow(row))
      .map((row) => row.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((rowId) => selectedRawRowIds.has(rowId));
    elements.selectVisibleRowsButton.disabled = selectableIds.length === 0;
    elements.selectVisibleRowsButton.title = allSelected ? "Clear visible" : "Select visible";
    elements.selectVisibleRowsButton.setAttribute("aria-label", elements.selectVisibleRowsButton.title);
    elements.selectVisibleRowsButton.querySelector(".material-symbols-outlined").textContent = allSelected ? "deselect" : "select_all";
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
    return importableRawRowStatuses.has(rawRow.import_status || "new") && hasMatchedCategory(rawRow) && hasMatchedType(rawRow);
  }

  function hasMatchedCategory(rawRow) {
    return Boolean(clean(rawRow.preview_category));
  }

  function hasMatchedType(rawRow) {
    return Boolean(clean(rawRow.preview_type));
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

  function dashboardPeriod() {
    const savedRange = localStorage.getItem(DASHBOARD_RANGE_KEY) || DEFAULT_DASHBOARD_RANGE;
    const range = dashboardRangeValues().has(savedRange) ? savedRange : DEFAULT_DASHBOARD_RANGE;
    return dashboardPeriodForRange(range);
  }

  function dashboardPeriodForRange(range) {
    const today = startOfDay(new Date());
    if (range === "this-month") {
      return {
        start: formatDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: formatDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 1)),
      };
    }
    if (range === "this-year") {
      return {
        start: formatDateKey(new Date(today.getFullYear(), 0, 1)),
        end: formatDateKey(new Date(today.getFullYear() + 1, 0, 1)),
      };
    }
    if (range === "last-year") {
      return lastFullYearPeriod();
    }
    if (range === CUSTOM_DASHBOARD_RANGE) {
      return customDashboardPeriod() || lastFullMonthPeriod();
    }
    return lastFullMonthPeriod();
  }

  function rangeStartDate(range) {
    return parseDateKey(dashboardPeriodForRange(range).start);
  }

  function customDashboardPeriod() {
    const start = localStorage.getItem(DASHBOARD_CUSTOM_START_KEY) || "";
    const end = localStorage.getItem(DASHBOARD_CUSTOM_END_KEY) || "";
    if (!start || !end) {
      return null;
    }
    return {
      start,
      end: formatDateKey(addDays(parseDateKey(end), 1)),
    };
  }

  function lastFullYearPeriod() {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear(), 0, 1);
    return {
      start: formatDateKey(start),
      end: formatDateKey(end),
    };
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

  function parseDateKey(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDateRangeLabel(start, exclusiveEnd) {
    const startDate = parseDateKey(start);
    const endDate = addDays(parseDateKey(exclusiveEnd), -1);
    const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  }

  function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function sumTypedTransactions(transactions, transactionType, useAbsoluteValue) {
    return transactions.reduce((total, transaction) => {
      if (transaction.transaction_type !== transactionType) {
        return total;
      }
      const amount = Number(transaction.amount_cents) || 0;
      return total + (useAbsoluteValue ? Math.abs(amount) : amount);
    }, 0);
  }

  function categorySpendingSegments(transactions, transactionTypesToInclude) {
    const includedTypes = new Set(transactionTypesToInclude);
    const totals = new Map();
    transactions
      .filter((transaction) => includedTypes.has(transaction.transaction_type))
      .forEach((transaction) => {
        const parent = parentCategoryForTransaction(transaction);
        if (!parent || parent.name === "Transfer") {
          return;
        }
        const amount = Math.abs(Number(transaction.amount_cents) || 0);
        totals.set(parent.id, {
          label: parent.name,
          value: (totals.get(parent.id)?.value || 0) + amount,
          color: parent.color || "#000000",
        });
      });
    const segments = [...totals.values()].sort((a, b) => b.value - a.value);
    if (segments.length <= 6) {
      return segments;
    }
    const visible = segments.slice(0, 5);
    const otherValue = segments.slice(5).reduce((sum, segment) => sum + segment.value, 0);
    if (otherValue > 0) {
      visible.push({ label: "All others", value: otherValue, color: "#000000" });
    }
    return visible;
  }

  function parentCategoryForTransaction(transaction) {
    const category = state.categories.find((candidate) => candidate.id === transaction.category_id);
    if (!category) {
      return null;
    }
    if (category.parent_id === null) {
      return category;
    }
    return state.categories.find((candidate) => candidate.id === category.parent_id) || category;
  }

  function renderPieChart(chart, legend, rawSegments) {
    const segments = rawSegments.filter((segment) => segment.value > 0);
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    clear(legend);
    if (total <= 0) {
      chart.style.background = "var(--surface-muted)";
      legend.appendChild(el("span", "No data", "list-meta"));
      return;
    }
    let cursor = 0;
    const stops = segments.map((segment) => {
      const start = cursor;
      cursor += (segment.value / total) * 100;
      return `${segment.color} ${start}% ${cursor}%`;
    });
    chart.style.background = `conic-gradient(${stops.join(", ")})`;
    renderChartLegend(legend, segments, total);
  }

  function renderStackedBar(bar, legend, rawSegments) {
    const segments = rawSegments.filter((segment) => segment.value > 0);
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    clear(bar);
    clear(legend);
    if (total <= 0) {
      bar.appendChild(el("span", "", "stacked-bar-empty"));
      legend.appendChild(el("span", "No data", "list-meta"));
      return;
    }
    segments.forEach((segment) => {
      const piece = document.createElement("span");
      piece.className = "stacked-bar-segment";
      piece.style.width = `${(segment.value / total) * 100}%`;
      piece.style.background = segment.color;
      piece.title = `${segment.label}: ${formatDollars(segment.value)}`;
      bar.appendChild(piece);
    });
    renderChartLegend(legend, segments, total);
  }

  function renderChartLegend(legend, segments, total) {
    segments.forEach((segment) => {
      const item = document.createElement("div");
      item.className = "chart-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "chart-legend-swatch";
      swatch.style.background = segment.color;
      item.append(
        swatch,
        el("span", segment.label),
        el("strong", `${Math.round((segment.value / total) * 100)}%`),
      );
      legend.appendChild(item);
    });
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
    if (rule.set_transaction_type) {
      actions.push(`type: ${transactionTypeLabel(rule.set_transaction_type)}`);
    }
    if (rule.tags?.length) {
      actions.push(`tags: ${rule.tags.map((item) => item.name).join(", ")}`);
    } else if (tag) {
      actions.push(`tag: ${tag.name}`);
    }
    if (!actions.length) {
      return "";
    }
    const list = document.createElement("div");
    list.className = "effects-list";
    actions.forEach((action) => list.appendChild(el("span", action)));
    return list;
  }

  function transactionTypeLabel(value) {
    return transactionTypes.find((type) => type.value === value)?.label || value;
  }

  function destructiveMessage(message) {
    return `${message}\nThis cannot be undone.`;
  }

  function promptForText({ title, label, value, deleteLabel, onDelete }) {
    if (textInputResolver) {
      closeTextInputDialog(null);
    }
    elements.textInputTitle.textContent = title;
    elements.textInputLabel.textContent = label;
    elements.textInputForm.elements.value.value = value || "";
    textInputDeleteHandler = onDelete || null;
    elements.textInputDeleteButton.hidden = !onDelete;
    elements.textInputDeleteButton.textContent = deleteLabel || "Delete";
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
    textInputDeleteHandler = null;
    elements.textInputDeleteButton.hidden = true;
  }

  function confirmDestructive({ title, message, actionLabel, optionLabel = "" }) {
    if (confirmResolver) {
      closeConfirmDialog(false);
    }
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmSubmitButton.textContent = actionLabel;
    elements.confirmOption.hidden = !optionLabel;
    elements.confirmOptionInput.checked = false;
    elements.confirmOptionLabel.textContent = optionLabel;
    openModal(elements.confirmDialog);
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function resolveConfirm(event) {
    event.preventDefault();
    closeConfirmDialog(true, { optionChecked: elements.confirmOptionInput.checked });
  }

  function closeConfirmDialog(confirmed, result = {}) {
    if (elements.confirmDialog.open) {
      elements.confirmDialog.close();
    }
    if (confirmResolver) {
      confirmResolver(confirmed ? { confirmed: true, ...result } : false);
      confirmResolver = null;
    }
    elements.confirmOption.hidden = true;
    elements.confirmOptionInput.checked = false;
    elements.confirmOptionLabel.textContent = "";
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
    dialog.scrollTop = 0;
    const panel = dialog.querySelector(".modal-panel");
    if (panel) {
      panel.scrollTop = 0;
    }
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

  function makeEditableRow(row, label, handler) {
    row.classList.add("clickable-row");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", label);
    row.addEventListener("click", handler);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
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

  function materialIcon(name) {
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = name;
    return icon;
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

  function manageableChip(label, onEdit, extraClass = "") {
    const wrapper = document.createElement("span");
    wrapper.className = `chip manageable-chip${extraClass ? ` ${extraClass}` : ""}`;
    wrapper.append(
      el("span", label),
      actionButtons([["edit", `Edit ${label}`, onEdit]]),
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

  function formatDisplayDate(value) {
    if (!value) {
      return "-";
    }
    const text = String(value);
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return text;
    }
    return [
      String(date.getDate()).padStart(2, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      date.getFullYear(),
    ].join("-");
  }

  function displayDateCell(value) {
    const formatted = formatDisplayDate(value);
    if (formatted === "-" || !/^\d{2}-\d{2}-\d{4}$/.test(formatted)) {
      return formatted;
    }
    const wrapper = document.createElement("span");
    wrapper.className = "date-stack";
    wrapper.append(
      el("span", formatted.slice(0, 5)),
      el("span", formatted.slice(6)),
    );
    return wrapper;
  }

  function formatMaybeDateTime(value) {
    return value ? formatDateTime(value) : "-";
  }
})();

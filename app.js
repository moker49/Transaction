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
  let activeManualImportRawRowId = null;
  let transactionEditMode = false;
  let accountDialogMode = "add";
  let ruleDialogMode = "add";
  let accountEditSnapshot = null;
  let categoryEditSnapshot = null;
  let ruleEditSnapshot = null;
  let transactionEditSnapshot = null;
  let confirmResolver = null;
  let textInputResolver = null;
  let textInputDeleteHandler = null;
  let categoryPickerTarget = null;
  let categoryColorDraft = "#2f8f2f";
  let popupTimer = null;
  let dashboardRangeDraft = null;
  let rawMobileImportColumnVisible = false;
  const importableRawRowStatuses = new Set(["importable"]);
  const transactionTypes = [
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
    { value: "transfer", label: "Transfer" },
  ];
  const comfortableCategoryColors = [
    "#2f8f2f",
    "#c4457c",
    "#91a82f",
    "#3a67c2",
    "#d07b2f",
    "#3f9f72",
    "#c85d5d",
    "#7c6bc2",
    "#239f9f",
    "#b68b2e",
    "#d27da8",
    "#4f83a8",
    "#7a5234",
    "#6f944f",
    "#909499",
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
    "Financial", "Fee", "Loan Payment", "Investment", "Tax Payment",
    "Insurance", "Life Insurance", "Umbrella Insurance",
    "Education", "Tuition", "Books", "Courses", "Certifications",
    "Family & Personal", "Childcare", "Pet Expense", "Gift Given", "Personal Care",
    "Business", "Software", "Equipment", "Service", "Office Expense",
    "Transfer", "Internal Transfer", "Card Payment",
  ];

  const elements = {
    navItems: document.querySelectorAll(".nav-item"),
    tabNav: document.querySelector(".tabs"),
    tabs: document.querySelectorAll(".tab"),
    views: document.querySelectorAll(".view"),
    appMessage: document.querySelector("#appMessage"),
    appMessageIcon: document.querySelector("#appMessageIcon"),
    appMessageText: document.querySelector("#appMessageText"),
    mobileMenuButton: document.querySelector("#mobileMenuButton"),
    mobileDashboardRangeButton: document.querySelector("#mobileDashboardRangeButton"),
    mobileDashboardRangeLabel: document.querySelector("#mobileDashboardRangeLabel"),
    mobileDrawerBackdrop: document.querySelector("#mobileDrawerBackdrop"),
    mobileNavDrawer: document.querySelector("#mobileNavDrawer"),
    mobileDummyDatabaseToggle: document.querySelector("#mobileDummyDatabaseToggle"),
    mobileDummyDatabaseLabel: document.querySelector("#mobileDummyDatabaseLabel"),
    mobileDummyDatabaseDescription: document.querySelector("#mobileDummyDatabaseDescription"),
    mobileThemeToggle: document.querySelector("#mobileThemeToggle"),
    mobileRegenerateDatabaseButton: document.querySelector("#mobileRegenerateDatabaseButton"),
    mobileDevMessage: document.querySelector("#mobileDevMessage"),
    dashboardTypeBar: document.querySelector("#dashboardTypeBar"),
    dashboardTypeBarLegend: document.querySelector("#dashboardTypeBarLegend"),
    dashboardCategoryPie: document.querySelector("#dashboardCategoryPie"),
    dashboardCategoryLegend: document.querySelector("#dashboardCategoryLegend"),
    dashboardSplurgePie: document.querySelector("#dashboardSplurgePie"),
    dashboardSplurgeLegend: document.querySelector("#dashboardSplurgeLegend"),
    accountAddButton: document.querySelector("#accountAddButton"),
    accountForm: document.querySelector("#accountForm"),
    csvUploadButton: document.querySelector("#csvUploadButton"),
    importDialog: document.querySelector("#importDialog"),
    importForm: document.querySelector("#importForm"),
    importCloseButton: document.querySelector("#importCloseButton"),
    importCancelButton: document.querySelector("#importCancelButton"),
    importCsvFileInput: document.querySelector("#importCsvFileInput"),
    importFileDropZone: document.querySelector("#importFileDropZone"),
    importFileName: document.querySelector("#importFileName"),
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
    rawColumnToggleInput: document.querySelector("#rawColumnToggleInput"),
    rawSelectedCount: document.querySelector("#rawSelectedCount"),
    rawSelectedCountMobile: document.querySelector("#rawSelectedCountMobile"),
    rawRowsTableElement: document.querySelector("#rawRowsTableElement"),
    selectVisibleRowsButton: document.querySelector("#selectVisibleRowsButton"),
    selectVisibleRowsMobileButton: document.querySelector("#selectVisibleRowsMobileButton"),
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
    manualImportDialog: document.querySelector("#manualImportDialog"),
    manualImportForm: document.querySelector("#manualImportForm"),
    manualImportDialogTitle: document.querySelector("#manualImportDialogTitle"),
    manualImportCloseButton: document.querySelector("#manualImportCloseButton"),
    manualImportCancelButton: document.querySelector("#manualImportCancelButton"),
    manualImportSubmitButton: document.querySelector("#manualImportSubmitButton"),
    manualImportMessage: document.querySelector("#manualImportMessage"),
    manualImportCategoryInput: document.querySelector("#manualImportCategoryInput"),
    manualImportCategoryButton: document.querySelector("#manualImportCategoryButton"),
    manualImportTypeInput: document.querySelector("#manualImportTypeInput"),
    manualImportTypeGroup: document.querySelector("#manualImportTypeGroup"),
    manualImportTags: document.querySelector("#manualImportTags"),
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
    accountTypeInput: document.querySelector("#accountTypeInput"),
    accountTypeGroup: document.querySelector("#accountTypeGroup"),
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
    rawRowStatusSubtitle: document.querySelector("#rawRowStatusSubtitle"),
    rawRowCloseButton: document.querySelector("#rawRowCloseButton"),
    rawRowImportButton: document.querySelector("#rawRowImportButton"),
    rawRowDeleteButton: document.querySelector("#rawRowDeleteButton"),
    rawRowRuleButton: document.querySelector("#rawRowRuleButton"),
    rawRowSaveButton: document.querySelector("#rawRowSaveButton"),
    rawRowRawValues: document.querySelector("#rawRowRawValues"),
    rawRowCleanValues: document.querySelector("#rawRowCleanValues"),
    rawRowImportValues: document.querySelector("#rawRowImportValues"),
    rawRowNoteInput: document.querySelector("#rawRowNoteInput"),
    categoryDialog: document.querySelector("#categoryDialog"),
    categoryDialogForm: document.querySelector("#categoryDialogForm"),
    categoryDialogTitle: document.querySelector("#categoryDialogTitle"),
    categoryCloseButton: document.querySelector("#categoryCloseButton"),
    categoryCancelButton: document.querySelector("#categoryCancelButton"),
    categoryDeleteButton: document.querySelector("#categoryDeleteButton"),
    categorySubmitButton: document.querySelector("#categorySubmitButton"),
    categoryParentInput: document.querySelector("#categoryParentInput"),
    categoryParentButton: document.querySelector("#categoryParentButton"),
    categoryColorInput: document.querySelector("#categoryColorInput"),
    categoryColorPickButton: document.querySelector("#categoryColorPickButton"),
    categoryColorRandomizeButton: document.querySelector("#categoryColorRandomizeButton"),
    categoryColorDialog: document.querySelector("#categoryColorDialog"),
    categoryColorForm: document.querySelector("#categoryColorForm"),
    categoryColorCloseButton: document.querySelector("#categoryColorCloseButton"),
    categoryColorCancelButton: document.querySelector("#categoryColorCancelButton"),
    categoryColorPreview: document.querySelector("#categoryColorPreview"),
    categoryColorHue: document.querySelector("#categoryColorHue"),
    categoryColorSaturation: document.querySelector("#categoryColorSaturation"),
    categoryColorLightness: document.querySelector("#categoryColorLightness"),
    categoryColorHex: document.querySelector("#categoryColorHex"),
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
  elements.csvUploadButton.addEventListener("click", openImportDialog);
  elements.importForm.addEventListener("submit", importCsv);
  elements.importCloseButton.addEventListener("click", closeImportDialog);
  elements.importCancelButton.addEventListener("click", closeImportDialog);
  elements.importCsvFileInput.addEventListener("change", updateImportFileName);
  elements.importFileDropZone.addEventListener("dragover", handleImportFileDrag);
  elements.importFileDropZone.addEventListener("dragleave", handleImportFileDrag);
  elements.importFileDropZone.addEventListener("drop", handleImportFileDrop);
  elements.categoryAddButton.addEventListener("click", openCategoryAddDialog);
  elements.tagAddButton.addEventListener("click", addTag);
  elements.ruleForm.addEventListener("submit", saveRule);
  elements.rawAccountFilter.addEventListener("change", renderRawRows);
  elements.rawStatusFilter.addEventListener("change", renderRawRows);
  elements.rawColumnToggleInput.addEventListener("change", toggleRawMobileColumn);
  elements.selectVisibleRowsButton.addEventListener("click", selectVisibleRawRows);
  elements.selectVisibleRowsMobileButton.addEventListener("click", selectVisibleRawRows);
  elements.importSelectedRowsButton.addEventListener("click", importSelectedRawRows);
  elements.regenerateDatabaseButton.addEventListener("click", regenerateDatabase);
  elements.dummyDatabaseToggle.addEventListener("change", updateDatabaseMode);
  elements.ruleAddButton.addEventListener("click", () => openRuleAddDialog());
  elements.ruleCancelButton.addEventListener("click", closeRuleDialog);
  elements.ruleDismissButton.addEventListener("click", closeRuleDialog);
  elements.ruleDeleteButton.addEventListener("click", deleteEditingRule);
  elements.ruleCategoryButton.addEventListener("click", () => openCategoryPicker("rule"));
  elements.ruleTypeGroup.addEventListener("click", (event) => selectTypeFromGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup));
  elements.ruleTypeGroup.addEventListener("keydown", (event) => navigateTypeGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup));
  elements.ruleDialog.addEventListener("close", () => {
    editingRuleId = null;
  });
  elements.manualImportForm.addEventListener("submit", importManualRawRow);
  elements.manualImportCloseButton.addEventListener("click", closeManualImportDialog);
  elements.manualImportCancelButton.addEventListener("click", closeManualImportDialog);
  elements.manualImportCategoryButton.addEventListener("click", () => openCategoryPicker("manual-import"));
  elements.manualImportTypeGroup.addEventListener("click", (event) => selectTypeFromGroup(event, elements.manualImportTypeInput, elements.manualImportTypeGroup));
  elements.manualImportTypeGroup.addEventListener("keydown", (event) => navigateTypeGroup(event, elements.manualImportTypeInput, elements.manualImportTypeGroup));
  elements.manualImportDialog.addEventListener("close", () => {
    activeManualImportRawRowId = null;
  });
  elements.settingsThemeToggle.addEventListener("change", updateTheme);
  elements.mobileThemeToggle.addEventListener("change", updateTheme);
  elements.mobileMenuButton.addEventListener("click", openMobileDrawer);
  elements.mobileDrawerBackdrop.addEventListener("click", closeMobileDrawer);
  elements.appMessage.addEventListener("click", hidePopup);
  elements.appMessage.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
      event.preventDefault();
      hidePopup();
    }
  });
  elements.appMessage.addEventListener("cancel", (event) => {
    event.preventDefault();
    hidePopup();
  });
  elements.mobileDashboardRangeButton.addEventListener("click", openDashboardRangeDialog);
  elements.mobileDummyDatabaseToggle.addEventListener("change", updateDatabaseMode);
  elements.mobileRegenerateDatabaseButton.addEventListener("click", regenerateDatabase);
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
  elements.accountTypeGroup.addEventListener("click", (event) => selectTypeFromGroup(event, elements.accountTypeInput, elements.accountTypeGroup));
  elements.accountTypeGroup.addEventListener("keydown", (event) => navigateTypeGroup(event, elements.accountTypeInput, elements.accountTypeGroup));
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
  elements.rawRowImportButton.addEventListener("click", importActiveRawRow);
  elements.rawRowDeleteButton.addEventListener("click", deleteActiveRawRow);
  elements.rawRowRuleButton.addEventListener("click", openTopRawRowRule);
  elements.rawRowNoteInput.addEventListener("input", updateRawRowModalActions);
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
  elements.categoryParentButton.addEventListener("click", () => {
    if (!elements.categoryParentButton.disabled) {
      openCategoryPicker("category-parent");
    }
  });
  elements.categoryColorPickButton.addEventListener("click", openCategoryColorPicker);
  elements.categoryColorRandomizeButton.addEventListener("click", randomizeCategoryColorDraft);
  elements.categoryColorForm.addEventListener("submit", applyCategoryColorPicker);
  [elements.categoryColorHue, elements.categoryColorSaturation, elements.categoryColorLightness].forEach((input) => {
    input.addEventListener("input", updateCategoryColorDraftFromSliders);
  });
  elements.categoryColorHex.addEventListener("input", updateCategoryColorDraftFromHex);
  elements.categoryColorCloseButton.addEventListener("click", closeCategoryColorPicker);
  elements.categoryColorCancelButton.addEventListener("click", closeCategoryColorPicker);
  elements.categoryColorDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCategoryColorPicker();
  });
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
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.mobileNavDrawer.classList.contains("is-open")) {
      closeMobileDrawer();
    }
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
    elements.mobileThemeToggle.checked = isDark;
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
    elements.mobileDashboardRangeLabel.textContent = formatDateRangeLabel(period.start, period.end);
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
    const isDummy = localStorage.getItem(DUMMY_DATABASE_KEY) === "true";
    elements.dummyDatabaseToggle.checked = isDummy;
    elements.mobileDummyDatabaseToggle.checked = isDummy;
    renderDatabaseModeLabel();
  }

  function updateDatabaseMode(event) {
    const isDummy = event.currentTarget.checked;
    localStorage.setItem(DUMMY_DATABASE_KEY, isDummy ? "true" : "false");
    elements.dummyDatabaseToggle.checked = isDummy;
    elements.mobileDummyDatabaseToggle.checked = isDummy;
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
    elements.mobileDummyDatabaseLabel.textContent = "Database";
    if (isUsingDummyDatabase()) {
      elements.dummyDatabaseDescription.textContent = "Using dummy database";
      elements.mobileDummyDatabaseDescription.textContent = "Using dummy database";
      return;
    }
    elements.dummyDatabaseDescription.textContent = "Using primary database";
    elements.mobileDummyDatabaseDescription.textContent = "Using primary database";
  }

  function openMobileDrawer() {
    elements.mobileDrawerBackdrop.hidden = false;
    elements.mobileNavDrawer.classList.add("is-open");
    elements.mobileNavDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
  }

  function closeMobileDrawer() {
    elements.mobileNavDrawer.classList.remove("is-open");
    elements.mobileNavDrawer.setAttribute("aria-hidden", "true");
    elements.mobileDrawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");
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
    const activeSection = activeTab?.dataset.section || activeNavItem?.dataset.section || (viewName === "settings" ? "settings" : "dash");
    let visibleTabCount = 0;

    elements.navItems.forEach((navItem) => {
      const isActive = navItem.dataset.section === activeSection;
      navItem.classList.toggle("is-active", isActive);
      navItem.setAttribute("aria-current", isActive ? "page" : "false");
    });
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
    accountEditSnapshot = null;
    elements.accountDialogTitle.textContent = "Create Account";
    elements.accountSubmitButton.textContent = "Create Account";
    elements.accountDeleteButton.hidden = true;
    elements.accountMessage.textContent = "";
    elements.accountMessage.classList.remove("error");
    elements.accountForm.reset();
    setTypeGroupValue(elements.accountTypeInput, elements.accountTypeGroup, "credit");
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
    setTypeGroupValue(elements.accountTypeInput, elements.accountTypeGroup, accountTypeValues().has(account.account_type) ? account.account_type : "checking");
    accountEditSnapshot = buildAccountPayload();
    openModal(elements.accountDialog);
  }

  function closeAccountDialog() {
    elements.accountDialog.close();
  }

  async function saveAccount(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const payload = buildAccountPayload(formElement);

    const isEdit = accountDialogMode === "edit";
    if (isEdit && payloadMatchesSnapshot(payload, accountEditSnapshot)) {
      closeAccountDialog();
      return;
    }

    try {
      const response = await apiRequest(isEdit ? `/api/accounts/${editingAccountId}` : "/api/accounts", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeAccountDialog();
      applyStateFromPayload(response);
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

    if (!accountId || !(file instanceof File) || !file.name) {
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
      updateImportFileName();
      closeImportDialog();
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

  function openImportDialog() {
    setMessage("");
    updateImportFileName();
    openModal(elements.importDialog);
  }

  function closeImportDialog() {
    elements.importDialog.close();
  }

  function updateImportFileName() {
    const file = elements.importCsvFileInput.files?.[0];
    elements.importFileName.textContent = file?.name || "Choose file";
    elements.importFileDropZone.classList.toggle("has-file", Boolean(file));
  }

  function handleImportFileDrag(event) {
    event.preventDefault();
    elements.importFileDropZone.classList.toggle("is-dragging", event.type === "dragover");
  }

  function handleImportFileDrop(event) {
    event.preventDefault();
    elements.importFileDropZone.classList.remove("is-dragging");
    const file = [...event.dataTransfer.files].find((candidate) => {
      return candidate.type === "text/csv" || candidate.name.toLowerCase().endsWith(".csv");
    });
    if (!file) {
      showPopup("Choose a CSV file.", "warning");
      return;
    }
    const files = new DataTransfer();
    files.items.add(file);
    elements.importCsvFileInput.files = files.files;
    updateImportFileName();
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
    categoryEditSnapshot = null;
    elements.categoryDialogTitle.textContent = "Create Category";
    elements.categorySubmitButton.textContent = "Create Category";
    elements.categoryDeleteButton.hidden = true;
    elements.categoryMessage.textContent = "";
    elements.categoryMessage.classList.remove("error");
    elements.categoryDialogForm.reset();
    setCategoryParentValue(null);
    elements.categoryParentButton.disabled = false;
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
    setCategoryParentValue(category.parent_id);
    elements.categoryParentButton.disabled = categoryDescendantIds(category.id).size > 0;
    setCategoryDialogColor(category.color || randomComfortableColor());
    updateCategoryColorControl();
    categoryEditSnapshot = buildCategoryPayload();
    openModal(elements.categoryDialog);
  }

  function closeCategoryDialog() {
    elements.categoryDialog.close();
  }

  async function saveCategory(event) {
    event.preventDefault();
    const payload = buildCategoryPayload();
    if (editingCategoryId && payloadMatchesSnapshot(payload, categoryEditSnapshot)) {
      closeCategoryDialog();
      return;
    }
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
    const normalizedColor = normalizeHexColor(color) || comfortableCategoryColors[0];
    elements.categoryColorInput.value = normalizedColor;
  }

  function updateCategoryColorControl() {
    const isParent = !clean(elements.categoryParentInput.value);
    elements.categoryColorPickButton.hidden = !isParent;
  }

  function openCategoryColorPicker() {
    categoryColorDraft = normalizeHexColor(elements.categoryColorInput.value) || comfortableCategoryColors[0];
    syncCategoryColorPickerFromHex(categoryColorDraft);
    openModal(elements.categoryColorDialog);
  }

  function closeCategoryColorPicker() {
    elements.categoryColorDialog.close();
  }

  function applyCategoryColorPicker(event) {
    event.preventDefault();
    const normalizedColor = normalizeHexColor(categoryColorDraft);
    if (!normalizedColor) {
      return;
    }
    setCategoryDialogColor(normalizedColor);
    closeCategoryColorPicker();
  }

  function updateCategoryColorDraftFromSliders() {
    categoryColorDraft = hslToHex(
      Number(elements.categoryColorHue.value),
      Number(elements.categoryColorSaturation.value),
      Number(elements.categoryColorLightness.value),
    );
    syncCategoryColorPickerPreview(categoryColorDraft);
  }

  function updateCategoryColorDraftFromHex() {
    const normalizedColor = normalizeHexColor(elements.categoryColorHex.value);
    if (!normalizedColor) {
      return;
    }
    categoryColorDraft = normalizedColor;
    syncCategoryColorPickerFromHex(normalizedColor, { keepHexInput: true });
  }

  function randomizeCategoryColorDraft() {
    categoryColorDraft = randomComfortableColor();
    syncCategoryColorPickerFromHex(categoryColorDraft);
  }

  function syncCategoryColorPickerFromHex(color, { keepHexInput = false } = {}) {
    const normalizedColor = normalizeHexColor(color) || comfortableCategoryColors[0];
    const hsl = hexToHsl(normalizedColor);
    elements.categoryColorHue.value = String(Math.round(hsl.h));
    elements.categoryColorSaturation.value = String(Math.round(hsl.s));
    elements.categoryColorLightness.value = String(Math.round(hsl.l));
    if (!keepHexInput) {
      elements.categoryColorHex.value = normalizedColor;
    }
    syncCategoryColorPickerPreview(normalizedColor);
  }

  function syncCategoryColorPickerPreview(color) {
    const normalizedColor = normalizeHexColor(color);
    if (!normalizedColor) {
      return;
    }
    elements.categoryColorPreview.style.setProperty("--category-color", normalizedColor);
    elements.categoryColorHex.value = normalizedColor;
  }

  function randomComfortableColor() {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 38 + Math.floor(Math.random() * 23);
    const lightness = 40 + Math.floor(Math.random() * 17);
    return hslToHex(hue, saturation, lightness);
  }

  function normalizeHexColor(value) {
    const raw = clean(value).replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
      return `#${raw.split("").map((char) => `${char}${char}`).join("").toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(raw)) {
      return `#${raw.toLowerCase()}`;
    }
    return null;
  }

  function hexToHsl(hex) {
    const normalized = normalizeHexColor(hex) || comfortableCategoryColors[0];
    const r = parseInt(normalized.slice(1, 3), 16) / 255;
    const g = parseInt(normalized.slice(3, 5), 16) / 255;
    const b = parseInt(normalized.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) {
      return { h: 0, s: 0, l: lightness * 100 };
    }
    const delta = max - min;
    const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
    let hue;
    if (max === r) {
      hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      hue = 60 * (((b - r) / delta) + 2);
    } else {
      hue = 60 * (((r - g) / delta) + 4);
    }
    return {
      h: (hue + 360) % 360,
      s: saturation * 100,
      l: lightness * 100,
    };
  }

  function hslToHex(hue, saturation, lightness) {
    const h = (((Number(hue) || 0) % 360) + 360) % 360;
    const s = clamp(Number(saturation) || 0, 0, 100) / 100;
    const l = clamp(Number(lightness) || 0, 0, 100) / 100;
    const chroma = (1 - Math.abs((2 * l) - 1)) * s;
    const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
    const match = l - (chroma / 2);
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) {
      r = chroma;
      g = x;
    } else if (h < 120) {
      r = x;
      g = chroma;
    } else if (h < 180) {
      g = chroma;
      b = x;
    } else if (h < 240) {
      g = x;
      b = chroma;
    } else if (h < 300) {
      r = x;
      b = chroma;
    } else {
      r = chroma;
      b = x;
    }
    return `#${[r, g, b].map((channel) => {
      return Math.round((channel + match) * 255).toString(16).padStart(2, "0");
    }).join("")}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
    const normalized = clean(value) || "expense";
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
    ruleEditSnapshot = null;
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
    elements.ruleForm.elements.priority.value = "100";
    setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, "expense");
    setRuleCategoryValue(null);
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
    form.elements.matchDescription.value = matches.description;
    form.elements.matchCategory.value = matches.category;
    form.elements.setCleanDescription.value = rule.set_clean_description || "";
    setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, rule.set_transaction_type || "expense");
    setRuleCategoryValue(rule.set_category_id);
    renderRuleTags(rule.tag_ids || (rule.add_tag_id === null ? [] : [rule.add_tag_id]));
    form.elements.priority.value = String(rule.priority ?? 100);
    ruleEditSnapshot = buildRulePayload();
    openModal(elements.ruleDialog);
  }

  function closeRuleDialog() {
    elements.ruleDialog.close();
  }

  async function saveRule(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const payload = buildRulePayload(formElement);

    if (!payload.match_description && !payload.match_category) {
      setModalMessage(elements.ruleMessage, "Match description, category, or both.", true);
      return;
    }

    if (!payload.set_clean_description) {
      setModalMessage(elements.ruleMessage, "Clean description is required.", true);
      return;
    }

    if (!payload.set_category_id && !payload.set_clean_description && !payload.set_transaction_type && !payload.add_tag_ids.length) {
      setModalMessage(elements.ruleMessage, "Set a category, description, type, or tag.", true);
      return;
    }

    try {
      const isEdit = ruleDialogMode === "edit";
      if (isEdit && payloadMatchesSnapshot(payload, ruleEditSnapshot)) {
        closeRuleDialog();
        return;
      }
      const response = await apiRequest(isEdit ? `/api/rules/${editingRuleId}` : "/api/rules", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeRuleDialog();
      applyStateFromPayload(response);
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
    if (clean(name) === clean(tag.name)) {
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
    renderRawRows();
  }

  function renderDashboard() {
    const period = dashboardPeriod();
    const transactions = state.transactions.filter((transaction) => {
      return transaction.posted_date >= period.start
        && transaction.posted_date < period.end
        && transaction.transaction_type !== "transfer";
    });
    const income = sumTypedTransactions(transactions, "income", false);
    const bills = sumExpenseTransactions(transactions, true);
    const splurge = sumExpenseTransactions(transactions, false);
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
    renderPieChart(elements.dashboardCategoryPie, elements.dashboardCategoryLegend, categorySpendingSegments(transactions, "all-expenses"));
    renderPieChart(elements.dashboardSplurgePie, elements.dashboardSplurgeLegend, categorySpendingSegments(transactions, "splurge"));
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
    transactionEditSnapshot = null;
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
    setTypeGroupValue(elements.transactionTypeInput, elements.transactionTypeGroup, transaction.transaction_type || "expense");
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
    transactionEditSnapshot = isEditing ? buildTransactionPayload() : null;
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

  function accountTypeValues() {
    return new Set(["credit", "checking", "savings"]);
  }

  function buildAccountPayload(formElement = elements.accountForm) {
    const form = new FormData(formElement);
    return {
      name: clean(form.get("name")),
      institution: clean(form.get("institution")) || null,
      account_type: clean(form.get("accountType")) || null,
    };
  }

  function buildCategoryPayload() {
    const form = new FormData(elements.categoryDialogForm);
    return {
      name: clean(form.get("name")),
      parent_id: Number(form.get("parentId")) || null,
      color: clean(form.get("parentId")) ? null : clean(form.get("color")),
    };
  }

  function buildRulePayload(formElement = elements.ruleForm) {
    const form = new FormData(formElement);
    const setCleanDescription = clean(form.get("setCleanDescription")) || null;
    const addTagIds = selectedTagIdsFrom(elements.ruleTags);
    return {
      name: setCleanDescription,
      match_description: clean(form.get("matchDescription")) || null,
      match_category: clean(form.get("matchCategory")) || null,
      set_category_id: Number(form.get("setCategoryId")) || null,
      set_clean_description: setCleanDescription,
      set_transaction_type: clean(form.get("setTransactionType")) || null,
      add_tag_ids: addTagIds,
      priority: Number(form.get("priority")) || 100,
    };
  }

  function buildManualImportPayload() {
    const form = new FormData(elements.manualImportForm);
    return {
      category_id: Number(form.get("categoryId")) || null,
      clean_description: clean(form.get("cleanDescription")) || null,
      transaction_type: clean(form.get("transactionType")) || null,
      tag_ids: selectedTagIdsFrom(elements.manualImportTags),
      note: clean(elements.rawRowNoteInput.value),
    };
  }

  function buildTransactionPayload() {
    const form = new FormData(elements.transactionForm);
    const tagIds = selectedTagIdsFrom(elements.transactionTags);
    return {
      posted_date: clean(form.get("postedDate")),
      category_id: Number(form.get("categoryId")),
      transaction_type: clean(form.get("transactionType")) || null,
      amount: clean(form.get("amount")),
      clean_description: clean(form.get("cleanDescription")) || null,
      notes: clean(form.get("notes")),
      tag_ids: tagIds,
    };
  }

  function selectedTagIdsFrom(container) {
    return [...container.querySelectorAll("input[type='checkbox']:checked")]
      .map((checkbox) => Number(checkbox.value))
      .filter((tagId) => Number.isInteger(tagId) && tagId > 0);
  }

  function payloadMatchesSnapshot(payload, snapshot) {
    return Boolean(snapshot) && JSON.stringify(normalizePayloadForComparison(payload)) === JSON.stringify(normalizePayloadForComparison(snapshot));
  }

  function normalizePayloadForComparison(value) {
    if (Array.isArray(value)) {
      return value.map((item) => Number(item)).filter((item) => Number.isInteger(item)).sort((a, b) => a - b);
    }
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce((record, key) => {
        record[key] = normalizePayloadForComparison(value[key]);
        return record;
      }, {});
    }
    return value ?? null;
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
    const payload = buildTransactionPayload();
    if (payloadMatchesSnapshot(payload, transactionEditSnapshot)) {
      closeTransactionDialog();
      return;
    }
    try {
      const response = await apiRequest(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      applyStateFromPayload(response);
      activeTransactionId = response.transaction.id;
      populateTransactionDialog(response.transaction);
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

  function openManualImportDialog(rawRow) {
    activeManualImportRawRowId = rawRow.id;
    elements.manualImportDialogTitle.textContent = `Manual Import ${rawRow.id}`;
    elements.manualImportMessage.textContent = "";
    elements.manualImportMessage.classList.remove("error");
    elements.manualImportForm.reset();
    setTypeGroupValue(elements.manualImportTypeInput, elements.manualImportTypeGroup, rawRow.preview_type || "expense");
    setManualImportCategoryValue(null);
    elements.manualImportForm.elements.cleanDescription.value = clean(rawRow.preview_clean_description) || clean(rawRow.raw_description) || "";
    renderManualImportTags([]);
    openModal(elements.manualImportDialog);
  }

  function closeManualImportDialog() {
    elements.manualImportDialog.close();
  }

  function activeRawRow() {
    return state.rawRows.find((row) => row.id === activeRawRowId) || null;
  }

  function activeManualImportRawRow() {
    return state.rawRows.find((row) => row.id === activeManualImportRawRowId) || null;
  }

  function populateRawRowDialog(rawRow) {
    const account = state.accounts.find((candidate) => candidate.id === rawRow.account_id);
    elements.rawRowDialogTitle.textContent = `Raw Transaction ${rawRow.id}`;
    elements.rawRowStatusSubtitle.replaceChildren(statusBadge(rawRow));
    elements.rawRowNoteInput.value = rawRowStoredNote(rawRow);
    elements.rawRowNoteInput.disabled = false;
    elements.rawRowSaveButton.textContent = "Save";
    renderDefinitionList(elements.rawRowRawValues, [
      ["Date", formatDisplayDate(rawRow.raw_date)],
      ["Category", rawRow.raw_category],
      ["Description", rawRow.raw_description],
      ["Amount", rawRow.raw_amount],
      ["Hash", rawRow.raw_row_hash],
    ]);
    renderDefinitionList(elements.rawRowCleanValues, [
      ["Type", transactionTypeLabel(rawRow.preview_type)],
      ["Category", rawRow.preview_category],
      ["Description", rawRow.preview_clean_description],
    ]);
    renderDefinitionList(elements.rawRowImportValues, [
      ["Account", account ? accountLabel(account) : "Unknown"],
      ["Status", rawRow.import_status],
      ["Importable", isImportableRawRow(rawRow) ? "Yes" : "No"],
      ["Error", rawRow.import_error],
      ["Source ID", rawRow.imported_source_id],
      ["Parsed transaction ID", rawRow.parsed_transaction_id],
      ["Created", formatMaybeDateTime(rawRow.created_at)],
      ["Updated", formatMaybeDateTime(rawRow.updated_at)],
    ]);
    updateRawRowModalActions();
  }

  function rawRowStoredNote(rawRow) {
    return rawRowNotes.get(rawRow.id) || "";
  }

  function isRawRowNoteDirty(rawRow) {
    return clean(elements.rawRowNoteInput.value) !== clean(rawRowStoredNote(rawRow));
  }

  function updateRawRowModalActions() {
    const rawRow = activeRawRow();
    if (!rawRow) {
      elements.rawRowSaveButton.hidden = true;
      elements.rawRowRuleButton.hidden = true;
      return;
    }
    const noteDirty = isRawRowNoteDirty(rawRow);
    elements.rawRowSaveButton.hidden = !noteDirty;
    if (noteDirty) {
      elements.rawRowRuleButton.hidden = true;
      return;
    }
    const topRule = topPriorityRuleForRawRow(rawRow);
    const canEditRule = isImportableRawRow(rawRow) && topRule;
    const canCreateRule = shouldOfferRuleCreation(rawRow);
    elements.rawRowRuleButton.hidden = !canEditRule && !canCreateRule;
    elements.rawRowRuleButton.textContent = "Rule";
  }

  function shouldOfferRuleCreation(rawRow) {
    return rawRow.import_status !== "imported" && !isImportableRawRow(rawRow);
  }

  function openTopRawRowRule() {
    const rawRow = activeRawRow();
    if (rawRow && shouldOfferRuleCreation(rawRow)) {
      closeRawRowDialog();
      openRuleAddDialog({
        matchDescription: rawRow.raw_description,
        matchCategory: rawRow.raw_category,
      });
      return;
    }
    const rule = rawRow ? topPriorityRuleForRawRow(rawRow) : null;
    if (!rule) {
      updateRawRowModalActions();
      return;
    }
    closeRawRowDialog();
    openRuleEditDialog(rule);
  }

  function saveRawRowNote(event) {
    event.preventDefault();
    const rawRow = activeRawRow();
    if (!rawRow) {
      closeRawRowDialog();
      return;
    }
    if (!isRawRowNoteDirty(rawRow)) {
      closeRawRowDialog();
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

  async function importActiveRawRow() {
    const rawRow = activeRawRow();
    if (!rawRow) {
      closeRawRowDialog();
      return;
    }
    if (!isImportableRawRow(rawRow)) {
      closeRawRowDialog();
      openManualImportDialog(rawRow);
      return;
    }
    const note = clean(elements.rawRowNoteInput.value);
    if (note) {
      rawRowNotes.set(rawRow.id, note);
    } else {
      rawRowNotes.delete(rawRow.id);
    }
    await importRawRows([rawRow.id], {
      successMessage: ({ counts }) => `Imported ${counts.imported}; duplicates ${counts.duplicate}; errors ${counts.error}.`,
      onSuccess: () => {
        selectedRawRowIds.delete(rawRow.id);
        closeRawRowDialog();
      },
    });
  }

  async function importManualRawRow(event) {
    event.preventDefault();
    const rawRow = activeManualImportRawRow();
    if (!rawRow) {
      closeManualImportDialog();
      return;
    }
    const payload = buildManualImportPayload();
    if (!payload.transaction_type) {
      setModalMessage(elements.manualImportMessage, "Type is required.", true);
      return;
    }
    if (!payload.category_id) {
      setModalMessage(elements.manualImportMessage, "Category is required.", true);
      return;
    }
    if (!payload.clean_description) {
      setModalMessage(elements.manualImportMessage, "Description is required.", true);
      return;
    }

    elements.manualImportSubmitButton.disabled = true;
    try {
      const response = await apiRequest(`/api/raw-rows/${rawRow.id}/manual-import`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      rawRowNotes.delete(rawRow.id);
      selectedRawRowIds.delete(rawRow.id);
      closeManualImportDialog();
      applyStateFromPayload(response);
      const result = response.import_result;
      setMessage(
        result.status === "duplicate" ? "Raw row matched an existing transaction." : "Raw row imported.",
        false,
      );
    } catch (error) {
      setModalMessage(elements.manualImportMessage, error.message || "Could not import raw transaction.", true);
    } finally {
      elements.manualImportSubmitButton.disabled = false;
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
    renderSelectableTags(elements.ruleTags, selectedTagIds, "addTagIds");
  }

  function renderManualImportTags(selectedTagIds) {
    renderSelectableTags(elements.manualImportTags, selectedTagIds, "tagIds");
  }

  function renderSelectableTags(container, selectedTagIds, inputName) {
    clear(container);
    const selected = new Set(selectedTagIds.map((tagId) => Number(tagId)));
    if (!state.tags.length) {
      container.appendChild(el("span", "No tags available.", "list-meta"));
      return;
    }
    state.tags.forEach((tag) => {
      container.appendChild(selectableTagChip(tag, selected.has(Number(tag.id)), inputName));
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

  function setManualImportCategoryValue(categoryId) {
    elements.manualImportCategoryInput.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.manualImportCategoryButton, elements.manualImportCategoryInput.value);
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
    renderCategoryButton(elements.manualImportCategoryButton, elements.manualImportCategoryInput.value);
    renderCategoryButton(elements.transactionCategoryButton, elements.transactionCategoryInput.value, "Select category");
    renderCategoryButton(elements.transactionCategoryFilterButton, elements.transactionCategoryFilter.value, "All categories");
    renderCategoryButton(elements.categoryParentButton, elements.categoryParentInput.value, "No parent");
  }

  function setCategoryParentValue(categoryId) {
    elements.categoryParentInput.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.categoryParentButton, elements.categoryParentInput.value, "No parent");
    updateCategoryColorControl();
  }

  function categoryOptions() {
    return orderedCategories().map((category) => ({ value: String(category.id), label: categoryLabel(category) }));
  }

  function openCategoryPicker(target) {
    categoryPickerTarget = target;
    const canClear = target === "rule" || target === "manual-import" || target === "transaction-filter" || target === "category-parent";
    elements.categoryPickerTitle.textContent = target === "rule" || target === "manual-import"
      ? "Select Clean Category"
      : target === "transaction-filter"
        ? "Filter By Category"
        : target === "category-parent"
          ? "Select Parent Category"
          : "Select Category";
    elements.categoryPickerClearButton.textContent = target === "transaction-filter"
      ? "All Categories"
      : target === "category-parent"
        ? "No Parent"
        : "No Category";
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
        : categoryPickerTarget === "category-parent"
          ? Number(elements.categoryParentInput.value) || null
          : categoryPickerTarget === "manual-import"
            ? Number(elements.manualImportCategoryInput.value) || null
            : Number(elements.ruleCategoryInput.value) || null;
    const parentOnly = categoryPickerTarget === "category-parent";
    renderCategorySections(elements.categoryPickerList, {
      selectable: true,
      selectedId,
      parentOnly,
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
    } else if (categoryPickerTarget === "manual-import") {
      setManualImportCategoryValue(categoryId);
    } else if (categoryPickerTarget === "category-parent") {
      setCategoryParentValue(categoryId);
    }
    closeCategoryPicker();
  }

  function renderCategorySections(categoryList, options = {}) {
    const selectable = Boolean(options.selectable);
    const parentOnly = Boolean(options.parentOnly);
    const roots = orderedCategories().filter((category) => category.parent_id === null);
    const rendered = new Set();
    roots.forEach((root) => {
      if (parentOnly && root.id === editingCategoryId) {
        rendered.add(root.id);
        return;
      }
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
      const children = parentOnly ? [] : orderedCategories().filter((category) => category.parent_id === root.id);
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
      .filter((category) => !rendered.has(category.id) && (!parentOnly || category.parent_id === null))
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
        const category = state.categories.find((candidate) => candidate.id === rule.set_category_id);
        const row = tableRow([
          `${rule.name} (${rule.priority})`,
          ruleMatchSummary(rule),
          ruleActions(rule, category),
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
    updateRawMobileColumnToggle();
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
      tr.classList.toggle("is-importable-row", isImportableRawRow(rawRow));
      makeEditableRow(tr, `View raw transaction ${rawRow.id}`, () => openRawRowDialog(rawRow));
      const checkbox = document.createElement("input");
      checkbox.className = "row-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = selectedRawRowIds.has(rawRow.id);
      checkbox.disabled = !isImportableRawRow(rawRow);
      checkbox.setAttribute("aria-label", `Select row ${rawRow.id}`);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("keydown", (event) => event.stopPropagation());
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
      const selectCell = cell(checkbox, "raw-select-cell");
      selectCell.addEventListener("click", (event) => {
        event.stopPropagation();
        checkbox.click();
      });

      const cells = [
        ["select", selectCell],
        ["date", cell(displayDateCell(rawRow.raw_date), "date-cell")],
        ["category", cell(rawValueWithPreview(rawRow.raw_category, rawRow.preview_category))],
        ["description", cell(rawValueWithPreview(rawRow.raw_description, rawRow.preview_clean_description))],
        ["amount", cell(rawRow.raw_amount || "-", "amount")],
        ["account", cell(account ? account.name : "Unknown", "muted-cell")],
        ["status", cell(statusBadge(rawRow), "status-cell")],
        ["notes", cell(noteInput)],
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
    await importRawRows(rowIds, {
      button: elements.importSelectedRowsButton,
      successMessage: ({ counts }) => `Imported ${counts.imported}; duplicates ${counts.duplicate}; errors ${counts.error}.`,
      onSuccess: () => {
        selectedRawRowIds.clear();
      },
      errorMessage: "Could not import selected rows.",
    });
  }

  async function importRawRows(rowIds, options = {}) {
    const notes = rowIds.reduce((record, rowId) => {
      const note = clean(rawRowNotes.get(rowId));
      if (note) {
        record[rowId] = note;
      }
      return record;
    }, {});

    const button = options.button || elements.rawRowImportButton;
    if (button) {
      button.disabled = true;
      button.title = "Importing";
    }
    try {
      const payload = await apiRequest("/api/raw-rows/import", {
        method: "POST",
        body: JSON.stringify({ raw_row_ids: rowIds, raw_row_notes: notes }),
      });
      rowIds.forEach((rowId) => rawRowNotes.delete(rowId));
      if (options.onSuccess) {
        options.onSuccess(payload);
      }
      applyStateFromPayload(payload);
      const counts = payload.import_result.counts;
      setMessage(
        options.successMessage ? options.successMessage(payload.import_result) : `Imported ${counts.imported}; duplicates ${counts.duplicate}; errors ${counts.error}.`,
        counts.error > 0,
      );
    } catch (error) {
      showPopup(error.message || options.errorMessage || "Could not import raw rows.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.title = "";
      }
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
    elements.mobileRegenerateDatabaseButton.disabled = true;
    try {
      const payload = await apiRequest("/api/dev/regenerate-database", {
        method: "POST",
        body: JSON.stringify({ confirm: "RESTORE DUMMY DATABASE" }),
      });
      selectedRawRowIds.clear();
      rawRowNotes.clear();
      visibleRawRows = [];
      elements.dummyDatabaseToggle.checked = true;
      elements.mobileDummyDatabaseToggle.checked = true;
      localStorage.setItem(DUMMY_DATABASE_KEY, "true");
      renderDatabaseModeLabel();
      applyStateFromPayload(payload);
      setDevMessage("Dummy database restored.");
    } catch (error) {
      showPopup(error.message || "Could not regenerate database.", "error");
    } finally {
      elements.regenerateDatabaseButton.disabled = false;
      elements.mobileRegenerateDatabaseButton.disabled = false;
    }
  }

  function selectVisibleRawRows() {
    const selectableIds = visibleRawRows
      .filter((row) => isImportableRawRow(row))
      .map((row) => row.id);
    selectableIds.forEach((rowId) => selectedRawRowIds.add(rowId));
    rawMobileImportColumnVisible = true;
    renderRawRows();
  }

  function toggleRawMobileColumn() {
    rawMobileImportColumnVisible = elements.rawColumnToggleInput.checked;
    updateRawMobileColumnToggle();
  }

  function updateRawMobileColumnToggle() {
    elements.rawRowsTableElement.classList.toggle("show-mobile-import-column", rawMobileImportColumnVisible);
    elements.rawColumnToggleInput.checked = rawMobileImportColumnVisible;
    const label = rawMobileImportColumnVisible ? "Show date column" : "Show import column";
    elements.rawColumnToggleInput.setAttribute("aria-label", label);
    elements.rawColumnToggleInput.closest(".raw-column-toggle").title = label;
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
    elements.rawSelectedCount.textContent = `${importableCount} selected`;
    elements.rawSelectedCountMobile.textContent = `${importableCount} selected`;
  }

  function updateSelectVisibleButton() {
    const selectableIds = visibleRawRows
      .filter((row) => isImportableRawRow(row))
      .map((row) => row.id);
    elements.selectVisibleRowsButton.disabled = selectableIds.length === 0;
    elements.selectVisibleRowsButton.title = "Select all visible";
    elements.selectVisibleRowsButton.setAttribute("aria-label", elements.selectVisibleRowsButton.title);
    elements.selectVisibleRowsButton.textContent = "Select all";
    elements.selectVisibleRowsMobileButton.disabled = selectableIds.length === 0;
    elements.selectVisibleRowsMobileButton.title = elements.selectVisibleRowsButton.title;
    elements.selectVisibleRowsMobileButton.setAttribute("aria-label", elements.selectVisibleRowsButton.title);
    elements.selectVisibleRowsMobileButton.textContent = "Select all";
  }

  function updateRawColumnHeaders(hiddenColumns) {
    elements.rawRowsTableElement.querySelectorAll("th[data-raw-column]").forEach((header) => {
      header.hidden = hiddenColumns.has(header.dataset.rawColumn);
    });
  }

  function statusBadge(rawRow) {
    const status = rawRow.import_status || "notImportable";
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
    return rawRow.import_status === "importable";
  }

  function topPriorityRuleForRawRow(rawRow) {
    return state.rules
      .filter((rule) => rule.is_active !== false && ruleMatchesRawRow(rule, rawRow))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id - b.id)[0] || null;
  }

  function ruleMatchesRawRow(rule, rawRow) {
    const matches = ruleMatchValues(rule);
    const matchDescription = normalizeMatchText(matches.description);
    const matchCategory = normalizeMatchText(matches.category);
    if (matchDescription || matchCategory) {
      if (matchDescription && !normalizeMatchText(rawRow.raw_description).includes(matchDescription)) {
        return false;
      }
      if (matchCategory && !normalizeMatchText(rawRow.raw_category).includes(matchCategory)) {
        return false;
      }
      return true;
    }
    const fieldValue = rule.match_field === "category" ? rawRow.raw_category : rawRow.raw_description;
    const needle = normalizeMatchText(rule.match_value);
    return Boolean(needle) && normalizeMatchText(fieldValue).includes(needle);
  }

  function normalizeMatchText(value) {
    return clean(value).toLowerCase();
  }

  function rawRowMatchesStatusFilter(rawRow, filter) {
    if (filter === "all") {
      return true;
    }
    if (filter === "new") {
      return ["importable", "notImportable"].includes(rawRow.import_status || "notImportable");
    }
    if (filter === "importable") {
      return isImportableRawRow(rawRow);
    }
    if (filter === "notImportable") {
      return rawRow.import_status === "notImportable";
    }
    return rawRow.import_status === filter;
  }

  function statusClass(status) {
    if (status === "importable" || status === "notImportable") {
      return "status-new";
    }
    return `status-${status}`;
  }

  function statusLabel(status) {
    return {
      importable: "Importable",
      notImportable: "Not importable",
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

  function sumExpenseTransactions(transactions, billTagged) {
    return transactions.reduce((total, transaction) => {
      if (transaction.transaction_type !== "expense" || hasBillTag(transaction) !== billTagged) {
        return total;
      }
      return total + Math.abs(Number(transaction.amount_cents) || 0);
    }, 0);
  }

  function hasBillTag(transaction) {
    return (transaction.tags || []).some((tag) => clean(tag.name).toLowerCase() === "bill");
  }

  function isDashboardExpense(transaction, mode) {
    if (transaction.transaction_type !== "expense") {
      return false;
    }
    if (mode === "splurge") {
      return !hasBillTag(transaction);
    }
    return true;
  }

  function categorySpendingSegments(transactions, expenseMode) {
    const totals = new Map();
    transactions
      .filter((transaction) => isDashboardExpense(transaction, expenseMode))
      .forEach((transaction) => {
        const parent = parentCategoryForTransaction(transaction);
        if (!parent) {
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
    const formatted = `$${new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
    return cents < 0 ? `-${formatted}` : formatted;
  }

  function formatCents(value) {
    const cents = Number(value);
    if (!Number.isFinite(cents)) {
      return "-";
    }
    return (cents / 100).toFixed(2);
  }

  function ruleActions(rule, category) {
    const list = document.createElement("div");
    list.className = "effects-list";

    if (category) {
      list.appendChild(plainCategoryChip(category));
    } else if (rule.set_category) {
      list.appendChild(el("span", rule.set_category));
    }

    if (rule.tags?.length) {
      const tags = el("div", "", "effect-chip-row");
      rule.tags.forEach((item) => tags.appendChild(staticTagChip(item.name)));
      list.appendChild(tags);
    } else if (rule.add_tag_id !== null && rule.add_tag_id !== undefined) {
      const tag = state.tags.find((candidate) => candidate.id === rule.add_tag_id);
      if (tag) {
        const tags = el("div", "", "effect-chip-row");
        tags.appendChild(staticTagChip(tag.name));
        list.appendChild(tags);
      }
    }

    return list.childElementCount ? list : "-";
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
      showPopupLayer();
      popupTimer = window.setTimeout(hidePopup, 6000);
    } else {
      hidePopupLayer();
    }
  }

  function hidePopup() {
    if (popupTimer) {
      window.clearTimeout(popupTimer);
      popupTimer = null;
    }
    hidePopupLayer();
    elements.appMessage.classList.remove("is-visible", "info", "success", "warning", "error");
    elements.appMessageText.textContent = "";
  }

  function showPopupLayer() {
    if (typeof elements.appMessage.showModal !== "function" || typeof elements.appMessage.show !== "function") {
      return;
    }
    try {
      if (!elements.appMessage.open) {
        if (hasOpenBlockingLayer()) {
          elements.appMessage.showModal();
        } else {
          elements.appMessage.show();
        }
      }
    } catch (_error) {
      elements.appMessage.classList.add("is-visible");
    }
  }

  function hidePopupLayer() {
    if (typeof elements.appMessage.close !== "function") {
      return;
    }
    try {
      if (elements.appMessage.open) {
        elements.appMessage.close();
      }
    } catch (_error) {
      // The class-based fallback still hides the popup below.
    }
  }

  function hasOpenBlockingLayer() {
    return Boolean(document.querySelector("dialog[open]:not(#appMessage)"));
  }

  function setMessage(message, isError = false) {
    elements.importMessage.textContent = message;
    elements.importMessage.classList.toggle("error", isError);
  }

  function setDevMessage(message, isError = false) {
    elements.devMessage.textContent = message;
    elements.devMessage.classList.toggle("error", isError);
    elements.mobileDevMessage.textContent = message;
    elements.mobileDevMessage.classList.toggle("error", isError);
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip manageable-chip${extraClass ? ` ${extraClass}` : ""}`;
    button.setAttribute("aria-label", `Edit ${label}`);
    button.append(materialIcon("edit"), el("span", label));
    button.addEventListener("click", onEdit);
    return button;
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

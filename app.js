import { clean } from "./scripts/js/common.mjs";
import { parseCsv, normalizeCsvRow, detectCsvLayout, sourceAccountKeyFromCsvRows, accountImportKeys, sha256 } from "./scripts/js/csv.mjs";
import { addDays, addMonths, allTimeDateRangePeriod, customDateRangePeriod, dateRangePeriodForRange, dateRangeYearOptions, daysInMonth, firstOfMonth, formatDateKey, formatDateRangeLabel, isYearRange, monthName, parseDateKey, rangeStartDate, startOfDay, yearRangeValue } from "./scripts/js/date-range.mjs";
import { compareSortValues, formatCents, formatDateTime, formatDisplayDate, formatMaybeDateTime, formatDollars } from "./scripts/js/format.mjs";
import { actionButtons, appendEmpty, cell, clear, displayDateCell, el, emptyTableRow, fillSelect, makeEditableRow, manageableChip, materialIcon, renderDefinitionList, setText, tableRow } from "./scripts/js/dom.mjs";
import { renderPieChart, renderStackedBar } from "./scripts/js/charts.mjs";

  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:5050" : "";
  const DUMMY_DATABASE_KEY = "transaction-use-dummy-database";
  const DATE_RANGE_KEY = "transaction-date-range";
  const DATE_RANGE_CUSTOM_START_KEY = "transaction-date-range-custom-start";
  const DATE_RANGE_CUSTOM_END_KEY = "transaction-date-range-custom-end";
  const LEGACY_DATE_RANGE_CUSTOM_START_KEY = "transaction-dashboard-custom-start";
  const LEGACY_DATE_RANGE_CUSTOM_END_KEY = "transaction-dashboard-custom-end";
  const DASHBOARD_FILTER_ENABLED_KEY = "transaction-dashboard-filter-enabled";
  const DASHBOARD_FILTER_CATEGORY_IDS_KEY = "transaction-dashboard-filter-category-ids";
  const DEFAULT_DATE_RANGE = "last-month";
  const CUSTOM_DATE_RANGE = "custom";
  const MOBILE_LAYOUT_QUERY = "(max-width: 860px)";
  const SCROLL_TOP_BUTTON_THRESHOLD = 200;
  const DASHBOARD_CATEGORY_SEGMENT_LIMIT = 7;
  const dateRangePresets = [
    { value: "this-month", label: "This month" },
    { value: "last-month", label: "Last month" },
    { value: "this-year", label: "This year" },
  ];
  const YEAR_RANGE_PREFIX = "year-";
  const FIRST_YEAR_RANGE = 2020;

  const defaultState = {
    accounts: [],
    categories: [],
    tags: [],
    rules: [],
    imports: [],
    transactions: [],
    rawRows: [],
    dashboard: null,
    activeDateRange: null,
  };

  let state = structuredClone(defaultState);
  const selectedRawRowIds = new Set();
  const selectedTransactionIds = new Set();
  const rawRowNotes = new Map();
  let visibleRawRows = [];
  let editingAccountId = null;
  let editingRuleId = null;
  let editingCategoryId = null;
  let activeTransactionId = null;
  let activeRawRowId = null;
  let activeUploadedFileId = null;
  let activeManualImportRawRowId = null;
  let transactionTagsEditMode = false;
  let transactionTagDraftIds = null;
  let accountDialogMode = "add";
  let ruleDialogMode = "add";
  let accountEditSnapshot = null;
  let categoryEditSnapshot = null;
  let ruleEditSnapshot = null;
  let ruleRawRowContext = null;
  let transactionEditSnapshot = null;
  let confirmResolver = null;
  let duplicateRuleResolver = null;
  let textInputResolver = null;
  let textInputDeleteHandler = null;
  let categoryPickerTarget = null;
  let categoryColorDraft = "#2f8f2f";
  let popupTimer = null;
  let dateRangeDraft = null;
  let mobileDrawerHistoryActive = false;
  let activeViewName = "overview";
  let scrollTopAnimationFrame = null;
  let dashboardCategoryPieMode = "spending";
  let dashboardSplurgePieMode = "splurge";
  let shouldAnimateDashboardCategoryPie = false;
  let shouldAnimateDashboardSplurgePie = false;
  let importFileAnalysisToken = 0;
  let dashboardFilterCategoryIds = new Set();
  const viewScrollPositions = new Map();
  const sectionViewSelections = new Map();
  const tableSortState = {
    transactions: { key: "date", direction: "desc", type: "date" },
    accounts: { key: "name", direction: "asc", type: "text" },
    rawRows: { key: "date", direction: "desc", type: "date" },
    rules: { key: "name", direction: "asc", type: "text" },
  };
  const transactionTypes = [
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
    { value: "transfer", label: "Transfer" },
  ];

  const elements = {
    navItems: document.querySelectorAll(".nav-item"),
    tabNav: document.querySelector(".tabs"),
    tabs: document.querySelectorAll(".tab"),
    views: document.querySelectorAll(".view"),
    scrollTopButton: document.querySelector("#scrollTopButton"),
    appMessage: document.querySelector("#appMessage"),
    appMessageIcon: document.querySelector("#appMessageIcon"),
    appMessageText: document.querySelector("#appMessageText"),
    mobileMenuButton: document.querySelector("#mobileMenuButton"),
    mobileDateRangeButton: document.querySelector("#mobileDateRangeButton"),
    mobileDateRangeLabel: document.querySelector("#mobileDateRangeLabel"),
    mobileDrawerBackdrop: document.querySelector("#mobileDrawerBackdrop"),
    mobileNavDrawer: document.querySelector("#mobileNavDrawer"),
    mobileDummyDatabaseToggle: document.querySelector("#mobileDummyDatabaseToggle"),
    mobileDummyDatabaseLabel: document.querySelector("#mobileDummyDatabaseLabel"),
    mobileDummyDatabaseDescription: document.querySelector("#mobileDummyDatabaseDescription"),
    mobileDashboardFilterButton: document.querySelector("#mobileDashboardFilterButton"),
    mobileDashboardFilterToggle: document.querySelector("#mobileDashboardFilterToggle"),
    mobileRegenerateDatabaseButton: document.querySelector("#mobileRegenerateDatabaseButton"),
    mobileDevMessage: document.querySelector("#mobileDevMessage"),
    dashboardTypeBar: document.querySelector("#dashboardTypeBar"),
    dashboardTypeBarLegend: document.querySelector("#dashboardTypeBarLegend"),
    dashboardCategoryPieFrame: document.querySelector("#dashboardCategoryPieFrame"),
    dashboardCategoryPieTitle: document.querySelector("#dashboardCategoryPieTitle"),
    dashboardCategoryPie: document.querySelector("#dashboardCategoryPie"),
    dashboardCategoryLegend: document.querySelector("#dashboardCategoryLegend"),
    dashboardSplurgePieFrame: document.querySelector("#dashboardSplurgePieFrame"),
    dashboardSplurgePieTitle: document.querySelector("#dashboardSplurgePieTitle"),
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
    ruleKindInput: document.querySelector("#ruleKindInput"),
    ruleKindGroup: document.querySelector("#ruleKindGroup"),
    importMessage: document.querySelector("#importMessage"),
    importTable: document.querySelector("#importTable"),
    uploadedFileDialog: document.querySelector("#uploadedFileDialog"),
    uploadedFileDialogTitle: document.querySelector("#uploadedFileDialogTitle"),
    uploadedFileCloseButton: document.querySelector("#uploadedFileCloseButton"),
    uploadedFileDismissButton: document.querySelector("#uploadedFileDismissButton"),
    uploadedFileDeleteButton: document.querySelector("#uploadedFileDeleteButton"),
    uploadedFileFileValues: document.querySelector("#uploadedFileFileValues"),
    uploadedFileUploadValues: document.querySelector("#uploadedFileUploadValues"),
    uploadedFileImpactValues: document.querySelector("#uploadedFileImpactValues"),
    devMessage: document.querySelector("#devMessage"),
    importAccountSelect: document.querySelector("#importAccountSelect"),
    dashboardFilterButton: document.querySelector("#dashboardFilterButton"),
    dashboardFilterToggle: document.querySelector("#dashboardFilterToggle"),
    dashboardFilterDialog: document.querySelector("#dashboardFilterDialog"),
    dashboardFilterCloseButton: document.querySelector("#dashboardFilterCloseButton"),
    dashboardFilterDoneButton: document.querySelector("#dashboardFilterDoneButton"),
    dashboardFilterResetButton: document.querySelector("#dashboardFilterResetButton"),
    dashboardFilterList: document.querySelector("#dashboardFilterList"),
    dummyDatabaseToggle: document.querySelector("#dummyDatabaseToggle"),
    dummyDatabaseLabel: document.querySelector("#dummyDatabaseLabel"),
    dummyDatabaseDescription: document.querySelector("#dummyDatabaseDescription"),
    rawAccountFilter: document.querySelector("#rawAccountFilter"),
    rawStatusFilter: document.querySelector("#rawStatusFilter"),
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
    ruleMatchAmountInput: document.querySelector("#ruleMatchAmountInput"),
    ruleMatchAmountGroup: document.querySelector("#ruleMatchAmountGroup"),
    ruleTypeInput: document.querySelector("#ruleTypeInput"),
    ruleTypeGroup: document.querySelector("#ruleTypeGroup"),
    ruleTags: document.querySelector("#ruleTags"),
    ruleCancelButton: document.querySelector("#ruleCancelButton"),
    ruleDismissButton: document.querySelector("#ruleDismissButton"),
    ruleDialogTitle: document.querySelector("#ruleDialogTitle"),
    ruleMessage: document.querySelector("#ruleMessage"),
    ruleSubmitButton: document.querySelector("#ruleSubmitButton"),
    ruleDeleteButton: document.querySelector("#ruleDeleteButton"),
    duplicateRuleDialog: document.querySelector("#duplicateRuleDialog"),
    duplicateRuleMessage: document.querySelector("#duplicateRuleMessage"),
    duplicateRuleCloseButton: document.querySelector("#duplicateRuleCloseButton"),
    duplicateRuleCancelButton: document.querySelector("#duplicateRuleCancelButton"),
    duplicateRuleGoButton: document.querySelector("#duplicateRuleGoButton"),
    bulkImportDialog: document.querySelector("#bulkImportDialog"),
    bulkImportForm: document.querySelector("#bulkImportForm"),
    bulkImportDialogTitle: document.querySelector("#bulkImportDialogTitle"),
    bulkImportCloseButton: document.querySelector("#bulkImportCloseButton"),
    bulkImportCancelButton: document.querySelector("#bulkImportCancelButton"),
    bulkImportResetButton: document.querySelector("#bulkImportResetButton"),
    bulkImportSubmitButton: document.querySelector("#bulkImportSubmitButton"),
    bulkImportMessage: document.querySelector("#bulkImportMessage"),
    bulkImportTypeInput: document.querySelector("#bulkImportTypeInput"),
    bulkImportTypeGroup: document.querySelector("#bulkImportTypeGroup"),
    bulkImportCategoryInput: document.querySelector("#bulkImportCategoryInput"),
    bulkImportCategoryButton: document.querySelector("#bulkImportCategoryButton"),
    bulkImportTagsModeInput: document.querySelector("#bulkImportTagsModeInput"),
    bulkImportTagsModeGroup: document.querySelector("#bulkImportTagsModeGroup"),
    bulkImportTags: document.querySelector("#bulkImportTags"),
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
    dateRangeButton: document.querySelector("#dateRangeButton"),
    dateRangeLabel: document.querySelector("#dateRangeLabel"),
    dateRangeDialog: document.querySelector("#dateRangeDialog"),
    dateRangeForm: document.querySelector("#dateRangeForm"),
    dateRangeCloseButton: document.querySelector("#dateRangeCloseButton"),
    dateRangePresetList: document.querySelector("#dateRangePresetList"),
    dateRangeCalendarGrid: document.querySelector("#dateRangeCalendarGrid"),
    dateRangeAllTimeButton: document.querySelector("#dateRangeAllTimeButton"),
    dateRangeCancelButton: document.querySelector("#dateRangeCancelButton"),
    dateRangeApplyButton: document.querySelector("#dateRangeApplyButton"),
    dateRangeCustomStart: document.querySelector("#dateRangeCustomStart"),
    dateRangeCustomEnd: document.querySelector("#dateRangeCustomEnd"),
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
    bulkEditTransactionsButton: document.querySelector("#bulkEditTransactionsButton"),
    bulkEditDialog: document.querySelector("#bulkEditDialog"),
    bulkEditForm: document.querySelector("#bulkEditForm"),
    bulkEditDialogTitle: document.querySelector("#bulkEditDialogTitle"),
    bulkEditCloseButton: document.querySelector("#bulkEditCloseButton"),
    bulkEditCancelButton: document.querySelector("#bulkEditCancelButton"),
    bulkEditResetButton: document.querySelector("#bulkEditResetButton"),
    bulkEditSubmitButton: document.querySelector("#bulkEditSubmitButton"),
    bulkEditMessage: document.querySelector("#bulkEditMessage"),
    bulkEditTypeInput: document.querySelector("#bulkEditTypeInput"),
    bulkEditTypeGroup: document.querySelector("#bulkEditTypeGroup"),
    bulkEditCategoryInput: document.querySelector("#bulkEditCategoryInput"),
    bulkEditCategoryButton: document.querySelector("#bulkEditCategoryButton"),
    bulkEditTagsModeInput: document.querySelector("#bulkEditTagsModeInput"),
    bulkEditTagsModeGroup: document.querySelector("#bulkEditTagsModeGroup"),
    bulkEditTags: document.querySelector("#bulkEditTags"),
    ruleCategoryFilterButton: document.querySelector("#ruleCategoryFilterButton"),
    transactionTypeInput: document.querySelector("#transactionTypeInput"),
    transactionTypeGroup: document.querySelector("#transactionTypeGroup"),
    transactionCategoryFilter: document.querySelector("#transactionCategoryFilter"),
    transactionSearch: document.querySelector("#transactionSearch"),
    ruleCategoryFilter: document.querySelector("#ruleCategoryFilter"),
    ruleSearch: document.querySelector("#ruleSearch"),
    transactionTags: document.querySelector("#transactionTags"),
    transactionTagsEditButton: document.querySelector("#transactionTagsEditButton"),
    transactionRawValues: document.querySelector("#transactionRawValues"),
    transactionMetadata: document.querySelector("#transactionMetadata"),
    transactionMessage: document.querySelector("#transactionMessage"),
    transactionCancelButton: document.querySelector("#transactionCancelButton"),
    transactionSaveButton: document.querySelector("#transactionSaveButton"),
    transactionDeleteButton: document.querySelector("#transactionDeleteButton"),
    rawRowDialog: document.querySelector("#rawRowDialog"),
    rawRowDialogTitle: document.querySelector("#rawRowDialogTitle"),
    rawRowStatusSubtitle: document.querySelector("#rawRowStatusSubtitle"),
    rawRowCloseButton: document.querySelector("#rawRowCloseButton"),
    rawRowImportButton: document.querySelector("#rawRowImportButton"),
    rawRowDeleteButton: document.querySelector("#rawRowDeleteButton"),
    rawRowRuleButton: document.querySelector("#rawRowRuleButton"),
    rawRowRawValues: document.querySelector("#rawRowRawValues"),
    rawRowCleanValues: document.querySelector("#rawRowCleanValues"),
    rawRowImportValues: document.querySelector("#rawRowImportValues"),
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
    navItem.addEventListener("click", () => {
      activateView(sectionViewSelections.get(navItem.dataset.section) || navItem.dataset.defaultView);
    });
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });
  elements.dashboardCategoryPieFrame.addEventListener("click", toggleDashboardCategoryPieMode);
  elements.dashboardCategoryPieFrame.addEventListener("keydown", (event) => activateDashboardPieToggleFromKeyboard(event, toggleDashboardCategoryPieMode));
  elements.dashboardSplurgePieFrame.addEventListener("click", toggleDashboardSplurgePieMode);
  elements.dashboardSplurgePieFrame.addEventListener("keydown", (event) => activateDashboardPieToggleFromKeyboard(event, toggleDashboardSplurgePieMode));
  elements.dashboardFilterButton.addEventListener("click", openDashboardFilterDialog);
  elements.mobileDashboardFilterButton.addEventListener("click", () => {
    closeMobileDrawer();
    openDashboardFilterDialog();
  });
  elements.dashboardFilterToggle.addEventListener("change", () => setDashboardFilterEnabled(elements.dashboardFilterToggle.checked));
  elements.mobileDashboardFilterToggle.addEventListener("change", () => setDashboardFilterEnabled(elements.mobileDashboardFilterToggle.checked));
  elements.dashboardFilterCloseButton.addEventListener("click", closeDashboardFilterDialog);
  elements.dashboardFilterDoneButton.addEventListener("click", closeDashboardFilterDialog);
  elements.dashboardFilterResetButton.addEventListener("click", resetDashboardFilterSelection);
  elements.dashboardFilterDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDashboardFilterDialog();
  });
  window.addEventListener("scroll", updateScrollTopButton, { passive: true });
  elements.scrollTopButton.addEventListener("click", scrollActiveViewToTop);

  initializeSortableTables();
  initializeClearableTextFields();

  elements.accountAddButton.addEventListener("click", openAccountAddDialog);
  elements.accountForm.addEventListener("submit", saveAccount);
  elements.csvUploadButton.addEventListener("click", openImportDialog);
  elements.importForm.addEventListener("submit", importCsv);
  elements.importCloseButton.addEventListener("click", closeImportDialog);
  elements.importCancelButton.addEventListener("click", closeImportDialog);
  elements.importCsvFileInput.addEventListener("change", handleImportFileChange);
  elements.importFileDropZone.addEventListener("dragover", handleImportFileDrag);
  elements.importFileDropZone.addEventListener("dragleave", handleImportFileDrag);
  elements.importFileDropZone.addEventListener("drop", handleImportFileDrop);
  elements.uploadedFileCloseButton.addEventListener("click", closeUploadedFileDialog);
  elements.uploadedFileDismissButton.addEventListener("click", closeUploadedFileDialog);
  elements.uploadedFileDeleteButton.addEventListener("click", deleteActiveUploadedFile);
  elements.uploadedFileDialog.addEventListener("close", () => {
    activeUploadedFileId = null;
  });
  elements.categoryAddButton.addEventListener("click", openCategoryAddDialog);
  elements.tagAddButton.addEventListener("click", addTag);
  elements.ruleForm.addEventListener("submit", saveRule);
  elements.rawAccountFilter.addEventListener("change", renderRawRows);
  elements.rawStatusFilter.addEventListener("change", renderRawRows);
  elements.selectVisibleRowsButton.addEventListener("click", selectVisibleRawRows);
  elements.selectVisibleRowsMobileButton.addEventListener("click", selectVisibleRawRows);
  elements.importSelectedRowsButton.addEventListener("click", openBulkImportDialog);
  elements.regenerateDatabaseButton.addEventListener("click", regenerateDatabase);
  elements.dummyDatabaseToggle.addEventListener("change", updateDatabaseMode);
  elements.ruleAddButton.addEventListener("click", () => openRuleAddDialog());
  elements.ruleCancelButton.addEventListener("click", closeRuleDialog);
  elements.ruleDismissButton.addEventListener("click", handleRuleDismissButton);
  elements.ruleDeleteButton.addEventListener("click", deleteEditingRule);
  elements.ruleCategoryButton.addEventListener("click", () => openCategoryPicker("rule"));
  elements.ruleKindGroup.addEventListener("click", (event) => {
    selectTypeFromGroup(event, elements.ruleKindInput, elements.ruleKindGroup);
    syncRuleDialogModeForSelectedType();
  });
  elements.ruleKindGroup.addEventListener("keydown", (event) => {
    navigateTypeGroup(event, elements.ruleKindInput, elements.ruleKindGroup);
    syncRuleDialogModeForSelectedType();
  });
  elements.ruleTypeGroup.addEventListener("click", (event) => {
    selectTypeFromGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("rule");
  });
  elements.ruleTypeGroup.addEventListener("keydown", (event) => {
    navigateTypeGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("rule");
  });
  elements.ruleMatchAmountGroup.addEventListener("click", (event) => selectTypeFromGroup(event, elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup));
  elements.ruleMatchAmountGroup.addEventListener("keydown", (event) => navigateTypeGroup(event, elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup));
  elements.ruleForm.elements.matchDescription.addEventListener("input", updateRuleFieldErrorState);
  elements.ruleForm.elements.matchCategory.addEventListener("input", updateRuleFieldErrorState);
  elements.ruleForm.elements.setCleanDescription.addEventListener("input", updateRuleFieldErrorState);
  document.querySelectorAll(".modal form input[required], .modal form select[required]").forEach((field) => {
    field.addEventListener("invalid", () => setFieldError(field.closest("label")));
    field.addEventListener("input", () => {
      if (field.checkValidity()) {
        clearFieldError(field.closest("label"));
      }
    });
    field.addEventListener("change", () => {
      if (field.checkValidity()) {
        clearFieldError(field.closest("label"));
      }
    });
  });
  elements.ruleDialog.addEventListener("close", () => {
    editingRuleId = null;
    ruleRawRowContext = null;
    updateRuleFillButtons();
  });
  elements.duplicateRuleCloseButton.addEventListener("click", () => closeDuplicateRuleWarning("cancel"));
  elements.duplicateRuleCancelButton.addEventListener("click", () => closeDuplicateRuleWarning("cancel"));
  elements.duplicateRuleGoButton.addEventListener("click", () => closeDuplicateRuleWarning("go"));
  elements.bulkImportForm.addEventListener("submit", importSelectedRawRows);
  elements.bulkImportCloseButton.addEventListener("click", closeBulkImportDialog);
  elements.bulkImportCancelButton.addEventListener("click", closeBulkImportDialog);
  elements.bulkImportResetButton.addEventListener("click", resetBulkImportForm);
  elements.bulkImportCategoryButton.addEventListener("click", () => openCategoryPicker("bulk-import"));
  elements.bulkImportTypeGroup.addEventListener("click", (event) => {
    selectOptionalTypeFromGroup(event, elements.bulkImportTypeInput, elements.bulkImportTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("bulk-import");
    updateBulkImportActionState();
  });
  elements.bulkImportTypeGroup.addEventListener("keydown", (event) => {
    navigateOptionalTypeGroup(event, elements.bulkImportTypeInput, elements.bulkImportTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("bulk-import");
    updateBulkImportActionState();
  });
  elements.bulkImportTagsModeGroup.addEventListener("click", (event) => {
    selectTypeFromGroup(event, elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup);
    updateBulkImportActionState();
  });
  elements.bulkImportTagsModeGroup.addEventListener("keydown", (event) => {
    navigateTypeGroup(event, elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup);
    updateBulkImportActionState();
  });
  elements.bulkImportForm.elements.cleanDescription.addEventListener("input", updateBulkImportActionState);
  elements.bulkEditTransactionsButton.addEventListener("click", openBulkEditDialog);
  elements.bulkEditForm.addEventListener("submit", bulkEditTransactions);
  elements.bulkEditCloseButton.addEventListener("click", closeBulkEditDialog);
  elements.bulkEditCancelButton.addEventListener("click", closeBulkEditDialog);
  elements.bulkEditResetButton.addEventListener("click", resetBulkEditForm);
  elements.bulkEditCategoryButton.addEventListener("click", () => openCategoryPicker("bulk-edit"));
  elements.bulkEditTypeGroup.addEventListener("click", (event) => {
    selectOptionalTypeFromGroup(event, elements.bulkEditTypeInput, elements.bulkEditTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("bulk-edit");
    updateBulkEditActionState();
  });
  elements.bulkEditTypeGroup.addEventListener("keydown", (event) => {
    navigateOptionalTypeGroup(event, elements.bulkEditTypeInput, elements.bulkEditTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("bulk-edit");
    updateBulkEditActionState();
  });
  elements.bulkEditTagsModeGroup.addEventListener("click", (event) => {
    selectTypeFromGroup(event, elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup);
    updateBulkEditActionState();
  });
  elements.bulkEditTagsModeGroup.addEventListener("keydown", (event) => {
    navigateTypeGroup(event, elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup);
    updateBulkEditActionState();
  });
  elements.bulkEditForm.elements.cleanDescription.addEventListener("input", updateBulkEditActionState);
  elements.manualImportForm.addEventListener("submit", importManualRawRow);
  elements.manualImportCloseButton.addEventListener("click", closeManualImportDialog);
  elements.manualImportCancelButton.addEventListener("click", closeManualImportDialog);
  elements.manualImportCategoryButton.addEventListener("click", () => openCategoryPicker("manual-import"));
  elements.manualImportTypeGroup.addEventListener("click", (event) => {
    selectTypeFromGroup(event, elements.manualImportTypeInput, elements.manualImportTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("manual-import");
  });
  elements.manualImportTypeGroup.addEventListener("keydown", (event) => {
    navigateTypeGroup(event, elements.manualImportTypeInput, elements.manualImportTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("manual-import");
  });
  elements.manualImportForm.elements.cleanDescription.addEventListener("input", updateManualImportFieldErrorState);
  elements.manualImportDialog.addEventListener("close", () => {
    activeManualImportRawRowId = null;
    updateManualImportFillButtons();
  });
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
  elements.mobileDateRangeButton.addEventListener("click", openDateRangeDialog);
  elements.mobileDummyDatabaseToggle.addEventListener("change", updateDatabaseMode);
  elements.mobileRegenerateDatabaseButton.addEventListener("click", regenerateDatabase);
  elements.dateRangeButton.addEventListener("click", openDateRangeDialog);
  elements.dateRangeForm.addEventListener("submit", applyDateRange);
  elements.dateRangeCloseButton.addEventListener("click", closeDateRangeDialog);
  elements.dateRangeAllTimeButton.addEventListener("click", applyAllTimeDateRange);
  elements.dateRangeCancelButton.addEventListener("click", closeDateRangeDialog);
  elements.dateRangeCustomStart.addEventListener("change", updateDateRangeCustomRange);
  elements.dateRangeCustomEnd.addEventListener("change", updateDateRangeCustomRange);
  elements.dateRangeDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDateRangeDialog();
  });
  elements.accountCancelButton.addEventListener("click", closeAccountDialog);
  elements.accountDismissButton.addEventListener("click", closeAccountDialog);
  elements.accountDeleteButton.addEventListener("click", deleteEditingAccount);
  elements.accountForm.elements.institution.addEventListener("input", autofillAccountName);
  elements.accountTypeGroup.addEventListener("click", (event) => {
    selectTypeFromGroup(event, elements.accountTypeInput, elements.accountTypeGroup);
    autofillAccountName();
  });
  elements.accountTypeGroup.addEventListener("keydown", (event) => {
    navigateTypeGroup(event, elements.accountTypeInput, elements.accountTypeGroup);
    autofillAccountName();
  });
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
  elements.ruleCategoryFilterButton.addEventListener("click", () => openCategoryPicker("rule-filter"));
  elements.transactionCloseButton.addEventListener("click", closeTransactionDialog);
  elements.transactionCancelButton.addEventListener("click", closeTransactionDialog);
  elements.transactionTagsEditButton.addEventListener("click", toggleTransactionTagsEditMode);
  elements.transactionDeleteButton.addEventListener("click", deleteActiveTransaction);
  elements.transactionCategoryButton.addEventListener("click", () => {
    openCategoryPicker("transaction");
  });
  elements.transactionTypeGroup.addEventListener("click", (event) => {
    selectTypeFromGroup(event, elements.transactionTypeInput, elements.transactionTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("transaction");
  });
  elements.transactionTypeGroup.addEventListener("keydown", (event) => {
    navigateTypeGroup(event, elements.transactionTypeInput, elements.transactionTypeGroup);
    clearTransferCategoryIfTypeIsNotTransfer("transaction");
  });
  elements.rawRowCloseButton.addEventListener("click", closeRawRowDialog);
  elements.rawRowImportButton.addEventListener("click", importActiveRawRow);
  elements.rawRowDeleteButton.addEventListener("click", deleteActiveRawRow);
  elements.rawRowRuleButton.addEventListener("click", openTopRawRowRule);
  elements.rawRowDialog.addEventListener("close", () => {
    activeRawRowId = null;
  });
  elements.transactionSearch.addEventListener("input", renderTransactions);
  elements.ruleSearch.addEventListener("input", renderRules);
  elements.transactionDialog.addEventListener("close", () => {
    activeTransactionId = null;
    transactionTagsEditMode = false;
    transactionTagDraftIds = null;
    transactionEditSnapshot = null;
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
    dialog.addEventListener("close", () => clearModalErrorState(dialog));
    dialog.addEventListener("close", updateModalScrollLock);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.mobileNavDrawer.classList.contains("is-open")) {
      closeMobileDrawer();
    }
  });
  window.addEventListener("popstate", (event) => {
    if (elements.mobileNavDrawer.classList.contains("is-open") && !event.state?.mobileDrawerOpen) {
      closeMobileDrawer({ skipHistory: true });
      return;
    }
    if (!elements.mobileNavDrawer.classList.contains("is-open") && event.state?.mobileDrawerOpen) {
      openMobileDrawer({ skipHistory: true });
    }
  });
  window.matchMedia(MOBILE_LAYOUT_QUERY).addEventListener("change", () => {
    if (dateRangeDraft) {
      renderDateRangeCalendars();
    }
  });

  initializeDateRange();
  initializeDatabaseMode();
  initializeDashboardFilter();
  activateView("overview");
  loadInitialState();

  function initializeDateRange() {
    const savedRange = localStorage.getItem(DATE_RANGE_KEY) || DEFAULT_DATE_RANGE;
    const validRange = dateRangeValues().has(savedRange) ? savedRange : DEFAULT_DATE_RANGE;
    localStorage.setItem(DATE_RANGE_KEY, validRange);
    migrateLegacyDateRangeStorage();
    renderDateRangeButton();
  }

  function migrateLegacyDateRangeStorage() {
    if (!localStorage.getItem(DATE_RANGE_CUSTOM_START_KEY) && localStorage.getItem(LEGACY_DATE_RANGE_CUSTOM_START_KEY)) {
      localStorage.setItem(DATE_RANGE_CUSTOM_START_KEY, localStorage.getItem(LEGACY_DATE_RANGE_CUSTOM_START_KEY));
    }
    if (!localStorage.getItem(DATE_RANGE_CUSTOM_END_KEY) && localStorage.getItem(LEGACY_DATE_RANGE_CUSTOM_END_KEY)) {
      localStorage.setItem(DATE_RANGE_CUSTOM_END_KEY, localStorage.getItem(LEGACY_DATE_RANGE_CUSTOM_END_KEY));
    }
  }

  function dateRangeValues() {
    return new Set([
      ...dateRangePresets.map((preset) => preset.value),
      ...dateRangeYearOptions(dateRangeOptions()).map((option) => option.value),
      CUSTOM_DATE_RANGE,
    ]);
  }

  function openDateRangeDialog() {
    dateRangeDraft = currentDateRangeState();
    elements.dateRangeCustomStart.value = dateRangeDraft.start || "";
    elements.dateRangeCustomEnd.value = dateRangeDraft.end || "";
    renderDateRangeDialog();
    openModal(elements.dateRangeDialog);
  }

  function closeDateRangeDialog() {
    dateRangeDraft = null;
    elements.dateRangeDialog.close();
  }

  async function applyDateRange(event) {
    event.preventDefault();
    if (!dateRangeDraft) {
      return;
    }
    await commitDateRangeDraft();
  }

  async function applyAllTimeDateRange() {
    const period = allTimeDateRangePeriod();
    dateRangeDraft = {
      range: CUSTOM_DATE_RANGE,
      start: period.start,
      end: period.end,
      viewDate: firstOfMonth(parseDateKey(period.start)),
    };
    elements.dateRangeCustomStart.value = dateRangeDraft.start;
    elements.dateRangeCustomEnd.value = dateRangeDraft.end;
    renderDateRangeDialog();
    await commitDateRangeDraft();
  }

  async function commitDateRangeDraft() {
    localStorage.setItem(DATE_RANGE_KEY, dateRangeDraft.range);
    if (dateRangeDraft.range === CUSTOM_DATE_RANGE) {
      localStorage.setItem(DATE_RANGE_CUSTOM_START_KEY, dateRangeDraft.start || "");
      localStorage.setItem(DATE_RANGE_CUSTOM_END_KEY, dateRangeDraft.end || "");
    }
    renderDateRangeButton();
    await loadTransactionData();
    closeDateRangeDialog();
  }

  function updateDateRangeCustomRange() {
    if (!dateRangeDraft) {
      return;
    }
    dateRangeDraft.range = CUSTOM_DATE_RANGE;
    const start = elements.dateRangeCustomStart.value;
    const end = elements.dateRangeCustomEnd.value;
    dateRangeDraft.start = start && end && end < start ? end : start;
    dateRangeDraft.end = start && end && end < start ? start : end;
    elements.dateRangeCustomStart.value = dateRangeDraft.start;
    elements.dateRangeCustomEnd.value = dateRangeDraft.end;
    dateRangeDraft.viewDate = dateRangeDraft.start ? firstOfMonth(parseDateKey(dateRangeDraft.start)) : dateRangeDraft.viewDate;
    renderDateRangeDialog();
  }

  function dateRangeOptions() {
    return {
      customDateRange: () => customDateRangePeriod(DATE_RANGE_CUSTOM_START_KEY, DATE_RANGE_CUSTOM_END_KEY),
      customDateRangeValue: CUSTOM_DATE_RANGE,
      firstYear: FIRST_YEAR_RANGE,
      yearRangePrefix: YEAR_RANGE_PREFIX,
    };
  }

  function currentDateRangeState() {
    const savedRange = localStorage.getItem(DATE_RANGE_KEY) || DEFAULT_DATE_RANGE;
    const normalizedRange = savedRange === "last-year" ? yearRangeValue(lastFullYear(), dateRangeOptions()) : savedRange;
    const range = dateRangeValues().has(normalizedRange) ? normalizedRange : DEFAULT_DATE_RANGE;
    return dateRangeState(range);
  }

  function dateRangeState(range) {
    const period = dateRangePeriodForRange(range, dateRangeOptions());
    return {
      range,
      start: period.start,
      end: period.end,
      viewDate: firstOfMonth(rangeStartDate(range, dateRangeOptions())),
    };
  }

  function renderDateRangeButton() {
    const range = currentDateRangeState();
    elements.dateRangeLabel.textContent = formatDateRangeLabel(range.start, range.end);
    elements.mobileDateRangeLabel.textContent = formatDateRangeLabel(range.start, range.end);
  }

  function renderDateRangeDialog() {
    renderDateRangePresets();
    renderDateRangeCalendars();
    elements.dateRangeApplyButton.disabled =
      dateRangeDraft?.range === CUSTOM_DATE_RANGE && (!dateRangeDraft.start || !dateRangeDraft.end);
  }

  function renderDateRangePresets() {
    clear(elements.dateRangePresetList);
    dateRangePresets.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "range-preset-button";
      button.classList.toggle("is-active", dateRangeDraft?.range === preset.value);
      button.textContent = preset.label;
      button.addEventListener("click", () => selectDateRangePreset(preset.value));
      elements.dateRangePresetList.appendChild(button);
    });
    const yearSelect = document.createElement("select");
    yearSelect.className = "range-preset-button range-year-select";
    yearSelect.setAttribute("aria-label", "Year");
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Select year";
    yearSelect.appendChild(placeholderOption);
    dateRangeYearOptions(dateRangeOptions()).forEach((option) => {
      const yearOption = document.createElement("option");
      yearOption.value = option.value;
      yearOption.textContent = option.label;
      yearSelect.appendChild(yearOption);
    });
    yearSelect.value = isYearRange(dateRangeDraft?.range, dateRangeOptions()) ? dateRangeDraft.range : "";
    yearSelect.classList.toggle("is-active", isYearRange(dateRangeDraft?.range, dateRangeOptions()));
    yearSelect.addEventListener("change", () => {
      if (yearSelect.value) {
        selectDateRangePreset(yearSelect.value);
      }
    });
    elements.dateRangePresetList.appendChild(yearSelect);
  }

  function selectDateRangePreset(range) {
    dateRangeDraft.range = range;
    const period = dateRangePeriodForRange(range, dateRangeOptions());
    dateRangeDraft.start = period.start;
    dateRangeDraft.end = period.end;
    dateRangeDraft.viewDate = firstOfMonth(parseDateKey(period.start));
    elements.dateRangeCustomStart.value = dateRangeDraft.start || "";
    elements.dateRangeCustomEnd.value = dateRangeDraft.end || "";
    renderDateRangeDialog();
  }

  function renderDateRangeCalendars() {
    clear(elements.dateRangeCalendarGrid);
    const viewDate = dateRangeDraft?.viewDate || firstOfMonth(new Date());
    if (window.matchMedia(MOBILE_LAYOUT_QUERY).matches) {
      elements.dateRangeCalendarGrid.append(calendarMonthElement(viewDate, 0));
      return;
    }
    elements.dateRangeCalendarGrid.append(calendarMonthElement(viewDate, -1), calendarMonthElement(addMonths(viewDate, 1), 1));
  }

  function calendarMonthElement(monthDate, direction) {
    const container = document.createElement("section");
    container.className = "calendar-month";
    const header = document.createElement("div");
    header.className = "calendar-month-header";
    const previous = calendarNavButton("chevron_left", () => shiftDateRangeCalendar(-1));
    const next = calendarNavButton("chevron_right", () => shiftDateRangeCalendar(1));
    const title = el("strong", monthDate.toLocaleDateString(undefined, { month: "short", year: "numeric" }));
    header.append(direction <= 0 ? previous : document.createElement("span"), title, direction >= 0 ? next : document.createElement("span"));

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
      button.classList.toggle("is-range-edge", key === dateRangeDraft?.start || key === dateRangeDraft?.end);
      button.addEventListener("click", () => selectDateRangeCustomDay(key));
      grid.appendChild(button);
    }
    const renderedDayCells = firstDay.getDay() + days;
    for (let index = renderedDayCells; index < 42; index += 1) {
      grid.appendChild(el("span", "", "calendar-empty-day"));
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

  function shiftDateRangeCalendar(months) {
    dateRangeDraft.viewDate = addMonths(dateRangeDraft.viewDate, months);
    renderDateRangeDialog();
  }

  function selectDateRangeCustomDay(key) {
    dateRangeDraft.range = CUSTOM_DATE_RANGE;
    if (!dateRangeDraft.start || dateRangeDraft.end) {
      dateRangeDraft.start = key;
      dateRangeDraft.end = "";
    } else if (key < dateRangeDraft.start) {
      dateRangeDraft.end = dateRangeDraft.start;
      dateRangeDraft.start = key;
    } else {
      dateRangeDraft.end = key;
    }
    elements.dateRangeCustomStart.value = dateRangeDraft.start;
    elements.dateRangeCustomEnd.value = dateRangeDraft.end;
    renderDateRangeDialog();
  }

  function isDraftDateInRange(key) {
    if (!dateRangeDraft?.start) {
      return false;
    }
    const end = dateRangeDraft.end || dateRangeDraft.start;
    return key >= dateRangeDraft.start && key <= end;
  }

  function dateRangeQuery() {
    const range = currentDateRangeState();
    return new URLSearchParams({
      startDate: range.start,
      endDate: range.end,
    }).toString();
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

  function openMobileDrawer({ skipHistory = false } = {}) {
    if (elements.mobileNavDrawer.classList.contains("is-open")) {
      return;
    }
    if (!skipHistory) {
      history.pushState({ ...(history.state || {}), mobileDrawerOpen: true }, "");
      mobileDrawerHistoryActive = true;
    }
    elements.mobileDrawerBackdrop.hidden = false;
    elements.mobileNavDrawer.classList.add("is-open");
    elements.mobileNavDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
  }

  function closeMobileDrawer({ skipHistory = false } = {}) {
    const wasOpen = elements.mobileNavDrawer.classList.contains("is-open");
    elements.mobileNavDrawer.classList.remove("is-open");
    elements.mobileNavDrawer.setAttribute("aria-hidden", "true");
    elements.mobileDrawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");
    if (wasOpen && !skipHistory && mobileDrawerHistoryActive && history.state?.mobileDrawerOpen) {
      mobileDrawerHistoryActive = false;
      history.back();
      return;
    }
    if (skipHistory || !history.state?.mobileDrawerOpen) {
      mobileDrawerHistoryActive = false;
    }
  }

  async function loadInitialState() {
    try {
      const [referencePayload, transactionPayload] = await Promise.all([
        apiRequest("/api/reference-data"),
        apiRequest(`/api/transactions?${dateRangeQuery()}`),
      ]);
      applyReferenceData(referencePayload.referenceData, { shouldRender: false });
      applyTransactionData(transactionPayload.transactionData, { shouldRender: false });
      render();
    } catch (error) {
      showPopup(error.message || "Could not load server data.", "error");
      render();
    }
  }

  async function loadTransactionData({ shouldRender = true } = {}) {
    const payload = await apiRequest(`/api/transactions?${dateRangeQuery()}`);
    applyTransactionData(payload.transactionData, { shouldRender });
  }

  async function loadReferenceData({ shouldRender = true } = {}) {
    const payload = await apiRequest("/api/reference-data");
    applyReferenceData(payload.referenceData, { shouldRender });
  }

  function mutationPath(path) {
    return `${path}?${dateRangeQuery()}`;
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
    const normalizedPayload = {
      ...(payload || {}),
    };
    if (normalizedPayload.realTransactions && !normalizedPayload.transactions) {
      normalizedPayload.transactions = normalizedPayload.realTransactions;
    }
    if (normalizedPayload.rawTransactions && !normalizedPayload.rawRows) {
      normalizedPayload.rawRows = normalizedPayload.rawTransactions;
    }
    return {
      ...structuredClone(defaultState),
      ...normalizedPayload,
    };
  }

  function applyStateFromPayload(payload) {
    const nextPayload = payload.state || payload;
    if (payload.referenceData || payload.transactionData) {
      if (payload.referenceData) {
        applyReferenceData(payload.referenceData, { shouldRender: false });
      }
      if (payload.transactionData) {
        applyTransactionData(payload.transactionData, { shouldRender: false });
      }
    } else {
      state = normalizeState({
        ...state,
        ...nextPayload,
        ...transactionSliceForCurrentDateRange(nextPayload),
      });
    }
    hidePopup();
    pruneRawRowUiState();
    render();
  }

  function applyReferenceData(referenceData, { shouldRender = true } = {}) {
    state = normalizeState({
      ...state,
      ...(referenceData || {}),
    });
    if (shouldRender) {
      render();
    }
  }

  function applyTransactionData(transactionData, { shouldRender = true } = {}) {
    state = normalizeState({
      ...state,
      dashboard: transactionData?.dashboard || null,
      activeDateRange: transactionData
        ? { startDate: transactionData.startDate, endDate: transactionData.endDate }
        : state.activeDateRange,
      transactions: transactionData?.realTransactions || [],
      rawRows: transactionData?.rawTransactions || [],
    });
    pruneRawRowUiState();
    if (shouldRender) {
      render();
    }
  }

  function transactionSliceForCurrentDateRange(payload) {
    if (!payload?.transactions && !payload?.rawRows) {
      return {};
    }
    const range = currentDateRangeState();
    const transactions = (payload.transactions || state.transactions).filter((transaction) => (
      transaction.posted_date >= range.start && transaction.posted_date <= range.end
    ));
    const rawRows = (payload.rawRows || state.rawRows).filter((row) => (
      row.import_status === "auto-importable"
      || row.import_status === "manual"
      || row.import_status === "pre-fill"
      || isRawRowInCurrentDateRange(row, range)
    ));
    return {
      transactions,
      rawRows,
      dashboard: null,
      activeDateRange: { startDate: range.start, endDate: range.end },
    };
  }

  function isRawRowInCurrentDateRange(row, range) {
    const rawDate = clean(row.raw_date);
    return rawDate >= range.start && rawDate <= range.end;
  }

  function pruneRawRowUiState() {
    const visibleTransactionIds = new Set(state.transactions.map((transaction) => transaction.id));
    [...selectedTransactionIds].forEach((transactionId) => {
      if (!visibleTransactionIds.has(transactionId)) {
        selectedTransactionIds.delete(transactionId);
      }
    });
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
  }

  function activateView(viewName) {
    if (activeViewName) {
      viewScrollPositions.set(activeViewName, window.scrollY);
    }
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
    activeViewName = viewName;
    sectionViewSelections.set(activeSection, viewName);
    requestAnimationFrame(() => {
      window.scrollTo({ top: viewScrollPositions.get(viewName) || 0, left: 0 });
      updateScrollTopButton();
    });
  }

  function updateScrollTopButton() {
    if (!elements.scrollTopButton) {
      return;
    }
    const activeView = document.querySelector(`#${activeViewName}View`);
    elements.scrollTopButton.hidden = !activeView || window.scrollY < SCROLL_TOP_BUTTON_THRESHOLD;
  }

  function scrollActiveViewToTop() {
    const shouldAnimate = window.scrollY <= (window.innerHeight * 2);
    if (activeViewName) {
      viewScrollPositions.set(activeViewName, 0);
    }
    window.scrollTo({ top: 0, left: 0, behavior: shouldAnimate ? "smooth" : "auto" });
    updateScrollTopButton();
  }

  function initializeSortableTables() {
    document.querySelectorAll("th[data-sort-table][data-sort-key]").forEach((header) => {
      header.classList.add("sortable-header");
      header.tabIndex = 0;
      header.setAttribute("role", "button");
      header.addEventListener("click", () => setTableSort(header));
      header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setTableSort(header);
        }
      });
    });
    updateSortableHeaders();
  }

  function setTableSort(header) {
    const table = header.dataset.sortTable;
    const key = header.dataset.sortKey;
    const type = header.dataset.sortType || "text";
    const current = tableSortState[table];
    const defaultDirection = type === "text" ? "asc" : "desc";
    tableSortState[table] = {
      key,
      type,
      direction: current?.key === key && current.direction === defaultDirection
        ? oppositeSortDirection(defaultDirection)
        : defaultDirection,
    };
    updateSortableHeaders();
    render();
  }

  function updateSortableHeaders() {
    document.querySelectorAll("th[data-sort-table][data-sort-key]").forEach((header) => {
      const stateForTable = tableSortState[header.dataset.sortTable];
      const isActive = stateForTable?.key === header.dataset.sortKey;
      header.classList.toggle("is-sorted", isActive);
      header.dataset.sortDirection = isActive ? stateForTable.direction : "";
      header.setAttribute("aria-sort", isActive
        ? (stateForTable.direction === "asc" ? "ascending" : "descending")
        : "none");
    });
  }

  function oppositeSortDirection(direction) {
    return direction === "asc" ? "desc" : "asc";
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
    autofillAccountName();
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
      const response = await apiRequest(isEdit ? mutationPath(`/api/accounts/${editingAccountId}`) : "/api/accounts", {
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
    const accountId = Number(elements.importAccountSelect.value);
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
      resetImportDialogState();
      closeImportDialog();
      applyStateFromPayload(payload);
      if (payload.status === "already_imported") {
        showPopup("File already imported.", "warning");
      } else {
        setMessage(`Imported ${payload.inserted_raw_row_count} raw transactions from ${file.name}.`);
      }
    } catch (error) {
      showPopup(error.message || "CSV import failed.", "error");
    }
  }

  function openImportDialog() {
    setMessage("");
    resetImportDialogState();
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

  function handleImportFileChange() {
    updateImportFileName();
    setImportAccountLocked(false);
    analyzeImportFileAccount();
  }

  function resetImportDialogState() {
    importFileAnalysisToken += 1;
    elements.importForm.reset();
    setImportAccountLocked(false);
    updateImportFileName();
  }

  function setImportAccountLocked(locked) {
    elements.importAccountSelect.disabled = locked;
    elements.importAccountSelect.classList.toggle("is-locked-in", locked);
  }

  async function analyzeImportFileAccount() {
    const file = elements.importCsvFileInput.files?.[0];
    const token = (importFileAnalysisToken += 1);
    if (!file) {
      return;
    }

    try {
      const parsed = parseCsv(await file.text());
      if (token !== importFileAnalysisToken) {
        return;
      }
      if (detectCsvLayout(parsed.headers) !== "normalized_statement_export") {
        return;
      }
      const sourceAccountKey = sourceAccountKeyFromCsvRows(parsed.rows);
      if (!sourceAccountKey) {
        setImportAccountLocked(false);
        showPopup("CSV file does not include an account key.", "error");
        return;
      }
      const account = state.accounts.find((candidate) => {
        return accountImportKeys(candidate).includes(sourceAccountKey);
      });
      if (!account) {
        elements.importAccountSelect.value = "";
        setImportAccountLocked(false);
        showPopup(`No account matches CSV account "${sourceAccountKey}".`, "error");
        return;
      }
      elements.importAccountSelect.value = String(account.id);
      setImportAccountLocked(true);
    } catch (error) {
      if (token === importFileAnalysisToken) {
        setImportAccountLocked(false);
        showPopup(error.message || "Could not inspect CSV file.", "error");
      }
    }
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
    handleImportFileChange();
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
    const normalizedColor = normalizeHexColor(color);
    elements.categoryColorInput.value = normalizedColor;
  }

  function updateCategoryColorControl() {
    const isParent = !clean(elements.categoryParentInput.value);
    elements.categoryColorPickButton.hidden = !isParent;
  }

  function openCategoryColorPicker() {
    categoryColorDraft = normalizeHexColor(elements.categoryColorInput.value);
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
      closeCategoryColorPicker();
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
    const normalizedColor = normalizeHexColor(color);
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
    const normalized = normalizeHexColor(hex);
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
    const amount = clean(rule.match_amount) || "any";
    return { description, category, amount };
  }

  function selectTypeFromGroup(event, input, group) {
    const button = event.target.closest("[data-type-value]");
    if (!button || button.disabled || !group.contains(button)) {
      return;
    }
    setTypeGroupValue(input, group, button.dataset.typeValue);
  }

  function selectOptionalTypeFromGroup(event, input, group) {
    const button = event.target.closest("[data-type-value]");
    if (!button || button.disabled || !group.contains(button)) {
      return;
    }
    setOptionalTypeGroupValue(input, group, input.value === button.dataset.typeValue ? "" : button.dataset.typeValue);
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
    if (input === elements.ruleKindInput && normalized === "template") {
      clearRuleFieldErrors();
    }
  }

  function setOptionalTypeGroupValue(input, group, value) {
    const normalized = clean(value);
    input.value = normalized;
    const buttons = [...group.querySelectorAll("[data-type-value]")];
    buttons.forEach((button, index) => {
      const isSelected = Boolean(normalized) && button.dataset.typeValue === normalized;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-checked", isSelected ? "true" : "false");
      button.tabIndex = isSelected || (!normalized && index === 0) ? 0 : -1;
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

  function navigateOptionalTypeGroup(event, input, group) {
    const buttons = [...group.querySelectorAll("[data-type-value]")].filter((button) => !button.disabled);
    if (!buttons.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const foundIndex = buttons.findIndex((button) => button.dataset.typeValue === input.value);
    const currentIndex = foundIndex >= 0 ? foundIndex : 0;
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
    setOptionalTypeGroupValue(input, group, buttons[nextIndex].dataset.typeValue);
    buttons[nextIndex].focus();
  }

  function openRuleAddDialog(prefill = {}) {
    ruleRawRowContext = prefill.rawRowContext || null;
    setRuleDialogCreateMode();
    elements.ruleMessage.textContent = "";
    elements.ruleMessage.classList.remove("error");
    elements.ruleForm.reset();
    const matchDescription = truncatePrefilledMatchDescription(prefill.matchDescription);
    const matchCategory = clean(prefill.matchCategory);
    elements.ruleForm.elements.matchDescription.value = matchDescription;
    elements.ruleForm.elements.matchCategory.value = matchCategory;
    elements.ruleForm.elements.setCleanDescription.value = clean(prefill.setCleanDescription) || ruleContextCleanDescription();
    setTypeGroupValue(elements.ruleKindInput, elements.ruleKindGroup, prefill.ruleType || "auto-import");
    setTypeGroupValue(elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup, prefill.matchAmount || "any");
    setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, prefill.setTransactionType || "expense");
    setRuleCategoryValue(prefill.setCategoryId || null);
    renderRuleTags(prefill.addTagIds || []);
    if (!elements.ruleDialog.open) {
      openModal(elements.ruleDialog);
    }
    syncRuleDialogModeForSelectedType();
    updateRuleFillButtons();
  }

  function truncatePrefilledMatchDescription(value) {
    return truncateIncludingCutoffWord(value, 25);
  }

  function ruleContextCleanDescription(selectedRule = null) {
    return clean(selectedRule?.set_clean_description)
      || clean(ruleRawRowContext?.selectedRule?.set_clean_description)
      || clean(ruleRawRowContext?.autoImportRule?.set_clean_description)
      || clean(ruleRawRowContext?.templateRule?.set_clean_description)
      || clean(ruleRawRowContext?.rawRow?.default_clean_description)
      || clean(ruleRawRowContext?.rawRow?.raw_description);
  }

  function truncateIncludingCutoffWord(value, maxLength) {
    const text = clean(value);
    if (text.length <= maxLength) {
      return text;
    }
    const nextSpace = text.indexOf(" ", maxLength);
    return (nextSpace === -1 ? text : text.slice(0, nextSpace)).trim();
  }

  function openRuleEditDialog(rule, options = {}) {
    ruleRawRowContext = options.rawRowContext || null;
    elements.ruleMessage.textContent = "";
    elements.ruleMessage.classList.remove("error");
    populateRuleEditDialog(rule);
    if (!elements.ruleDialog.open) {
      openModal(elements.ruleDialog);
    }
  }

  function setRuleDialogCreateMode() {
    ruleDialogMode = "add";
    editingRuleId = null;
    ruleEditSnapshot = null;
    clearRuleFieldErrors();
    elements.ruleDialogTitle.textContent = "Create Rule";
    elements.ruleSubmitButton.textContent = "Create Rule";
    elements.ruleDismissButton.textContent = "Cancel";
    elements.ruleDeleteButton.hidden = true;
    const contextDescription = ruleContextCleanDescription();
    if (contextDescription) {
      elements.ruleForm.elements.setCleanDescription.value = contextDescription;
    }
    updateRuleFillButtons();
  }

  function populateRuleEditDialog(rule) {
    ruleDialogMode = "edit";
    editingRuleId = rule.id;
    if (ruleRawRowContext) {
      ruleRawRowContext.selectedRule = rule;
    }
    clearRuleFieldErrors();
    elements.ruleDialogTitle.textContent = "Edit Rule";
    elements.ruleSubmitButton.textContent = "Save";
    elements.ruleDismissButton.textContent = "Create";
    elements.ruleDeleteButton.hidden = false;
    const form = elements.ruleForm;
    const matches = ruleMatchValues(rule);
    setTypeGroupValue(elements.ruleKindInput, elements.ruleKindGroup, rule.rule_type || "auto-import");
    form.elements.matchDescription.value = matches.description;
    form.elements.matchCategory.value = matches.category;
    setTypeGroupValue(elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup, matches.amount);
    form.elements.setCleanDescription.value = ruleContextCleanDescription(rule);
    setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, rule.set_transaction_type || "expense");
    setRuleCategoryValue(rule.set_category_id);
    renderRuleTags(rule.tag_ids || (rule.add_tag_id === null ? [] : [rule.add_tag_id]));
    ruleEditSnapshot = buildRulePayload();
    updateRuleFillButtons();
  }

  function handleRuleDismissButton() {
    if (ruleDialogMode === "edit") {
      saveRuleFromForm({ forceCreate: true });
      return;
    }
    closeRuleDialog();
  }

  function syncRuleDialogModeForSelectedType() {
    if (!elements.ruleDialog.open) {
      return;
    }
    const existingRule = findDuplicateRule(buildRulePayload());
    if (existingRule) {
      if (existingRule.id !== editingRuleId) {
        populateRuleEditDialog(existingRule);
      }
      return;
    }
    if (ruleDialogMode === "edit") {
      setRuleDialogCreateMode();
    }
  }

  function closeRuleDialog() {
    elements.ruleDialog.close();
  }

  async function saveRule(event) {
    event.preventDefault();
    await saveRuleFromForm();
  }

  async function saveRuleFromForm({ forceCreate = false } = {}) {
    const payload = buildRulePayload(elements.ruleForm);
    clearRuleFieldErrors();

    if (!payload.match_description && !payload.match_category) {
      setRuleFieldErrors(["matchDescription", "matchCategory"]);
      setModalMessage(elements.ruleMessage, "Match description, category, or both.", true);
      return;
    }

    if (!payload.set_category_id && !payload.set_clean_description && !payload.set_transaction_type && !payload.add_tag_ids.length) {
      setRuleFieldErrors(["setCategory", "setCleanDescription"]);
      setModalMessage(elements.ruleMessage, "Set a category, description, type, or tag.", true);
      return;
    }
    if (payload.rule_type === "auto-import" && (!payload.set_category_id || !payload.set_clean_description || !payload.set_transaction_type)) {
      setRuleFieldErrors([
        ...(!payload.set_category_id ? ["setCategory"] : []),
        ...(!payload.set_clean_description ? ["setCleanDescription"] : []),
      ]);
      setModalMessage(elements.ruleMessage, "Auto-import rules need a category and description.", true);
      return;
    }
    if (payload.rule_type === "template" && (!payload.set_category_id || !payload.set_transaction_type)) {
      setRuleFieldErrors([
        ...(!payload.set_category_id ? ["setCategory"] : []),
      ]);
      setModalMessage(elements.ruleMessage, "Pre-fill rules need a category and type.", true);
      return;
    }

    const isEdit = ruleDialogMode === "edit" && !forceCreate;
    try {
      const duplicateRule = findDuplicateRule(payload, isEdit ? editingRuleId : null);
      if (duplicateRule) {
        const action = await showDuplicateRuleWarning(duplicateRule);
        if (action === "go") {
          closeRuleDialog();
          openRuleEditDialog(duplicateRule);
        }
        return;
      }
      const splitConflict = findSplitAmountConflict(payload, isEdit ? editingRuleId : null);
      if (splitConflict) {
        setModalMessage(elements.ruleMessage, "Match amount already has a positive or negative rule for the same match criteria.", true);
        return;
      }
      if (isEdit && payloadMatchesSnapshot(payload, ruleEditSnapshot)) {
        closeRuleDialog();
        return;
      }
      const response = await apiRequest(mutationPath(isEdit ? `/api/rules/${editingRuleId}` : "/api/rules"), {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeRuleDialog();
      applyStateFromPayload(response);
    } catch (error) {
      setModalMessage(
        elements.ruleMessage,
        error.message || (isEdit ? "Could not update rule." : "Could not add rule."),
        true,
      );
    }
  }

  function ruleFieldTargets() {
    return {
      matchDescription: elements.ruleForm.elements.matchDescription.closest("label"),
      matchCategory: elements.ruleForm.elements.matchCategory.closest("label"),
      setCategory: elements.ruleCategoryButton.closest("label"),
      setCleanDescription: elements.ruleForm.elements.setCleanDescription.closest("label"),
    };
  }

  function setRuleFieldErrors(fields) {
    const targets = ruleFieldTargets();
    fields.forEach((field) => {
      setFieldError(targets[field], "rule-field-error");
    });
  }

  function clearRuleFieldErrors() {
    Object.values(ruleFieldTargets()).forEach((target) => {
      clearFieldError(target, "rule-field-error");
    });
  }


  function clearRuleFieldError(field) {
    if (elements.ruleKindInput.value === "template") {
      clearRuleFieldErrors();
      return;
    }
    clearFieldError(ruleFieldTargets()[field], "rule-field-error");
  }

  function updateRuleFieldErrorState() {
    const form = elements.ruleForm.elements;
    if (clean(form.matchDescription.value)) {
      clearRuleFieldError("matchDescription");
    }
    if (clean(form.matchCategory.value)) {
      clearRuleFieldError("matchCategory");
    }
    if (clean(form.setCleanDescription.value)) {
      clearRuleFieldError("setCleanDescription");
    }
  }

  function manualImportFieldTargets() {
    return {
      category: elements.manualImportCategoryButton.closest("label"),
      cleanDescription: elements.manualImportForm.elements.cleanDescription.closest("label"),
    };
  }

  function setManualImportFieldErrors(fields) {
    const targets = manualImportFieldTargets();
    fields.forEach((field) => {
      setFieldError(targets[field]);
    });
  }

  function clearManualImportFieldErrors() {
    Object.values(manualImportFieldTargets()).forEach((target) => {
      clearFieldError(target);
    });
  }

  function clearManualImportFieldError(field) {
    clearFieldError(manualImportFieldTargets()[field]);
  }

  function updateManualImportFieldErrorState() {
    const form = elements.manualImportForm.elements;
    if (elements.manualImportCategoryInput.value) {
      clearManualImportFieldError("category");
    }
    if (clean(form.cleanDescription.value)) {
      clearManualImportFieldError("cleanDescription");
    }
  }

  function setFieldError(target, className = "field-error") {
    target?.classList.add(className);
  }

  function clearFieldError(target, className = "field-error") {
    target?.classList.remove(className);
  }

  function findDuplicateRule(payload, excludeRuleId = null) {
    return state.rules.find((rule) => {
      if (excludeRuleId !== null && Number(rule.id) === Number(excludeRuleId)) {
        return false;
      }
      const matches = ruleMatchValues(rule);
      return (rule.rule_type || "auto-import") === payload.rule_type
        && clean(matches.description) === clean(payload.match_description)
        && clean(matches.category) === clean(payload.match_category)
        && matches.amount === (payload.match_amount || "any");
    }) || null;
  }

  function findRuleByAmount(payload, matchAmount, excludeRuleId = null) {
    return state.rules.find((rule) => {
      if (excludeRuleId !== null && Number(rule.id) === Number(excludeRuleId)) {
        return false;
      }
      const matches = ruleMatchValues(rule);
      return (rule.rule_type || "auto-import") === payload.rule_type
        && clean(matches.description) === clean(payload.match_description)
        && clean(matches.category) === clean(payload.match_category)
        && matches.amount === matchAmount;
    }) || null;
  }

  function findSplitAmountConflict(payload, excludeRuleId = null) {
    if ((payload.match_amount || "any") !== "any") {
      return null;
    }
    const positiveRule = findRuleByAmount(payload, "positive", excludeRuleId);
    const negativeRule = findRuleByAmount(payload, "negative", excludeRuleId);
    return positiveRule || negativeRule ? { positiveRule, negativeRule } : null;
  }

  function showDuplicateRuleWarning(rule) {
    if (duplicateRuleResolver) {
      closeDuplicateRuleWarning("cancel");
    }
    const matches = ruleMatchValues(rule);
    const kind = (rule.rule_type || "auto-import") === "template" ? "Pre-fill" : "Auto-import";
    elements.duplicateRuleMessage.textContent = [
      `${kind} rule already exists.`,
      matches.description ? `Description: ${matches.description}` : "",
      matches.category ? `Category: ${matches.category}` : "",
      `Amount: ${matchAmountLabel(matches.amount)}`,
    ].filter(Boolean).join("\n");
    openModal(elements.duplicateRuleDialog);
    return new Promise((resolve) => {
      duplicateRuleResolver = resolve;
    });
  }

  function closeDuplicateRuleWarning(action) {
    if (elements.duplicateRuleDialog.open) {
      elements.duplicateRuleDialog.close();
    }
    if (duplicateRuleResolver) {
      duplicateRuleResolver(action);
      duplicateRuleResolver = null;
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
      const payload = await apiRequest(mutationPath(`/api/rules/${rule.id}`), { method: "DELETE" });
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
    const dashboard = dashboardFromTransactions(state.transactions);
    setText("#dashboardIncome", formatDollars(dashboard.income || 0));
    setText("#dashboardBills", formatDollars(dashboard.bills || 0));
    setText("#dashboardSplurge", formatDollars(dashboard.splurge || 0));
    setText("#dashboardSaved", formatDollars(dashboard.saved || 0));
    renderStackedBar(elements.dashboardTypeBar, elements.dashboardTypeBarLegend, dashboard.typeSegments || []);
    const categorySegments = dashboardCategoryPieMode === "income"
      ? dashboard.incomeSegments || []
      : dashboard.categorySegments || [];
    const splurgeSegments = dashboardSplurgePieMode === "bills"
      ? dashboard.billSegments || []
      : dashboard.splurgeSegments || [];
    elements.dashboardCategoryPieTitle.textContent = dashboardCategoryPieMode === "income" ? "Income" : "Spending";
    elements.dashboardSplurgePieTitle.textContent = dashboardSplurgePieMode === "bills" ? "Bills" : "Splurge";
    elements.dashboardCategoryPieFrame.setAttribute("aria-pressed", dashboardCategoryPieMode === "income" ? "true" : "false");
    elements.dashboardSplurgePieFrame.setAttribute("aria-pressed", dashboardSplurgePieMode === "bills" ? "true" : "false");
    renderPieChart(elements.dashboardCategoryPie, elements.dashboardCategoryLegend, categorySegments, {
      animate: shouldAnimateDashboardCategoryPie,
    });
    renderPieChart(elements.dashboardSplurgePie, elements.dashboardSplurgeLegend, splurgeSegments, {
      animate: shouldAnimateDashboardSplurgePie,
    });
    shouldAnimateDashboardCategoryPie = false;
    shouldAnimateDashboardSplurgePie = false;
  }

  function initializeDashboardFilter() {
    const savedEnabled = localStorage.getItem(DASHBOARD_FILTER_ENABLED_KEY);
    const enabled = savedEnabled !== "false";
    elements.dashboardFilterToggle.checked = enabled;
    elements.mobileDashboardFilterToggle.checked = enabled;
    dashboardFilterCategoryIds = readDashboardFilterCategoryIds() || new Set();
  }

  function setDashboardFilterEnabled(enabled) {
    localStorage.setItem(DASHBOARD_FILTER_ENABLED_KEY, enabled ? "true" : "false");
    elements.dashboardFilterToggle.checked = enabled;
    elements.mobileDashboardFilterToggle.checked = enabled;
    renderDashboard();
  }

  function openDashboardFilterDialog() {
    normalizeDashboardFilterSelection();
    renderDashboardFilterList();
    openModal(elements.dashboardFilterDialog);
  }

  function closeDashboardFilterDialog() {
    elements.dashboardFilterDialog.close();
  }

  function resetDashboardFilterSelection() {
    dashboardFilterCategoryIds = defaultDashboardFilterCategoryIds();
    persistDashboardFilterSelection();
    renderDashboardFilterList();
    renderDashboard();
  }

  function toggleDashboardCategoryPieMode() {
    dashboardCategoryPieMode = dashboardCategoryPieMode === "income" ? "spending" : "income";
    shouldAnimateDashboardCategoryPie = true;
    renderDashboard();
  }

  function toggleDashboardSplurgePieMode() {
    dashboardSplurgePieMode = dashboardSplurgePieMode === "bills" ? "splurge" : "bills";
    shouldAnimateDashboardSplurgePie = true;
    renderDashboard();
  }

  function activateDashboardPieToggleFromKeyboard(event, toggle) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    toggle();
  }

  function renderAccounts() {
    const tbody = document.querySelector("#accountsTable");
    clear(tbody);
    if (!state.accounts.length) {
      tbody.appendChild(emptyTableRow(4));
      return;
    }

    sortedTableRows("accounts", state.accounts).forEach((account) => {
      const rowCount = account.raw_row_count ?? state.rawRows.filter((row) => row.account_id === account.id).length;
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
      tbody.appendChild(emptyTableRow(7));
      updateBulkEditTransactionsButton();
      return;
    }

    sortedTableRows("transactions", transactions).forEach((transaction) => {
      const category = state.categories.find((candidate) => candidate.id === transaction.category_id)
        || state.categories.find((candidate) => candidate.name === transaction.category);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "row-checkbox";
      checkbox.checked = selectedTransactionIds.has(transaction.id);
      checkbox.setAttribute("aria-label", `Select transaction ${transaction.clean_description || transaction.id}`);
      checkbox.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      checkbox.addEventListener("change", () => {
        setTransactionSelected(transaction.id, checkbox.checked);
      });
      const row = tableRow([
        checkbox,
        displayDateCell(transaction.posted_date),
        category ? displayCategoryChip(category) : transaction.category || "-",
        transaction.clean_description || "-",
        transaction.amount || formatCents(transaction.amount_cents),
        transaction.account || "-",
        transaction.notes || "-",
      ]);
      const selectCell = row.children[0];
      selectCell?.classList.add("transaction-select-cell", "raw-select-cell");
      row.children[1]?.classList.add("date-cell", "transaction-date-select-cell");
      row.children[4]?.classList.add("amount");
      row.children[5]?.classList.add("transaction-account-cell");
      row.children[6]?.classList.add("transaction-notes-cell");
      row.classList.toggle("is-selected-row", selectedTransactionIds.has(transaction.id));
      row.classList.add("clickable-row");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Edit transaction ${transaction.clean_description || transaction.id}`);
      row.addEventListener("click", () => openTransactionDialog(transaction));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTransactionDialog(transaction);
        }
      });
      selectCell.addEventListener("click", (event) => {
        event.stopPropagation();
        setTransactionSelected(transaction.id, !selectedTransactionIds.has(transaction.id));
      });
      row.children[1]?.addEventListener("click", (event) => {
        event.stopPropagation();
        setTransactionSelected(transaction.id, !selectedTransactionIds.has(transaction.id));
      });
      tbody.appendChild(row);
    });
    updateBulkEditTransactionsButton();
  }

  function setTransactionSelected(transactionId, selected) {
    if (selected) {
      selectedTransactionIds.add(transactionId);
    } else {
      selectedTransactionIds.delete(transactionId);
    }
    renderTransactions();
  }

  function selectedEditableTransactionIds() {
    const visibleIds = new Set(state.transactions.map((transaction) => transaction.id));
    return [...selectedTransactionIds].filter((transactionId) => visibleIds.has(transactionId));
  }

  function updateBulkEditTransactionsButton() {
    const selectedCount = selectedEditableTransactionIds().length;
    elements.bulkEditTransactionsButton.hidden = selectedCount === 0;
    elements.bulkEditTransactionsButton.disabled = selectedCount === 0;
    elements.bulkEditTransactionsButton.title = selectedCount
      ? `Edit selected transactions (${selectedCount})`
      : "Edit selected transactions";
    elements.bulkEditTransactionsButton.setAttribute("aria-label", elements.bulkEditTransactionsButton.title);
  }

  function openTransactionDialog(transaction) {
    activeTransactionId = transaction.id;
    transactionTagsEditMode = false;
    transactionEditSnapshot = null;
    populateTransactionDialog(transaction);
    transactionEditSnapshot = buildTransactionPayload();
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
    transactionTagsEditMode = false;
    transactionTagDraftIds = transactionTagIds(transaction);
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

  function toggleTransactionTagsEditMode() {
    const transaction = activeTransaction();
    if (!transaction) {
      return;
    }
    if (transactionTagsEditMode) {
      transactionTagDraftIds = selectedTagIdsFrom(elements.transactionTags);
    } else if (!transactionTagDraftIds) {
      transactionTagDraftIds = transactionTagIds(transaction);
    }
    transactionTagsEditMode = !transactionTagsEditMode;
    renderTransactionTags(transaction);
  }

  function renderTransactionTags(transaction) {
    clear(elements.transactionTags);
    elements.transactionTagsEditButton.querySelector(".material-symbols-outlined").textContent = transactionTagsEditMode ? "check" : "edit";
    elements.transactionTagsEditButton.setAttribute("aria-label", transactionTagsEditMode ? "Done editing tags" : "Edit tags");
    elements.transactionTagsEditButton.setAttribute("aria-pressed", transactionTagsEditMode ? "true" : "false");
    const selectedTagIds = new Set(transactionTagDraftIds || transactionTagIds(transaction));
    if (!transactionTagsEditMode) {
      if (!selectedTagIds.size) {
        elements.transactionTags.appendChild(el("span", "-", "list-meta"));
        return;
      }
      state.tags.filter((tag) => selectedTagIds.has(Number(tag.id))).forEach((tag) => {
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

  function transactionTagIds(transaction) {
    return (transaction.tags || [])
      .map((tag) => Number(tag.id))
      .filter((tagId) => Number.isInteger(tagId) && tagId > 0);
  }

  function accountTypeValues() {
    return new Set(["credit", "checking", "savings"]);
  }

  function accountTypeLabel(value) {
    return {
      credit: "Credit",
      checking: "Checking",
      savings: "Savings",
    }[clean(value)] || clean(value);
  }

  function autofillAccountName() {
    const form = elements.accountForm;
    const institution = clean(form.elements.institution.value);
    const accountType = accountTypeLabel(form.elements.accountType.value);
    form.elements.name.value = [institution, accountType].filter(Boolean).join(" ");
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
    const matchDescription = clean(form.get("matchDescription")) || null;
    const matchCategory = clean(form.get("matchCategory")) || null;
    const addTagIds = selectedTagIdsFrom(elements.ruleTags);
    const ruleType = clean(form.get("ruleKind")) || "auto-import";
    return {
      name: setCleanDescription || matchDescription || matchCategory || (ruleType === "template" ? "Template" : "Rule"),
      rule_type: ruleType,
      match_description: matchDescription,
      match_category: matchCategory,
      match_amount: clean(form.get("matchAmount")) || "any",
      set_category_id: Number(form.get("setCategoryId")) || null,
      set_clean_description: setCleanDescription,
      set_transaction_type: clean(form.get("setTransactionType")) || null,
      add_tag_ids: addTagIds,
    };
  }

  function buildManualImportPayload() {
    const form = new FormData(elements.manualImportForm);
    return {
      category_id: Number(form.get("categoryId")) || null,
      clean_description: clean(form.get("cleanDescription")) || null,
      transaction_type: clean(form.get("transactionType")) || null,
      tag_ids: selectedTagIdsFrom(elements.manualImportTags),
      note: clean(form.get("note")),
    };
  }

  function buildBulkImportOverrides() {
    const form = new FormData(elements.bulkImportForm);
    const overrides = {};
    const transactionType = clean(form.get("transactionType"));
    const categoryId = Number(form.get("categoryId")) || null;
    const cleanDescription = clean(form.get("cleanDescription")) || null;
    if (transactionType && transactionType !== "keep") {
      overrides.transaction_type = transactionType;
    }
    if (categoryId) {
      overrides.category_id = categoryId;
    }
    if (cleanDescription) {
      overrides.clean_description = cleanDescription;
    }
    if (clean(form.get("tagsMode")) === "overwrite") {
      overrides.tag_ids = selectedTagIdsFrom(elements.bulkImportTags);
    }
    return overrides;
  }

  function buildBulkEditOverrides() {
    const form = new FormData(elements.bulkEditForm);
    const overrides = {};
    const transactionType = clean(form.get("transactionType"));
    const categoryId = Number(form.get("categoryId")) || null;
    const cleanDescription = clean(form.get("cleanDescription")) || null;
    if (transactionType && transactionType !== "keep") {
      overrides.transaction_type = transactionType;
    }
    if (categoryId) {
      overrides.category_id = categoryId;
    }
    if (cleanDescription) {
      overrides.clean_description = cleanDescription;
    }
    if (clean(form.get("tagsMode")) === "overwrite") {
      overrides.tag_ids = selectedTagIdsFrom(elements.bulkEditTags);
    }
    return overrides;
  }

  function bulkImportHasOverrides() {
    return Object.keys(buildBulkImportOverrides()).length > 0;
  }

  function bulkEditHasOverrides() {
    return Object.keys(buildBulkEditOverrides()).length > 0;
  }

  function matchAmountLabel(matchAmount) {
    return {
      positive: "Positive",
      negative: "Negative",
      any: "Any",
    }[matchAmount || "any"] || "Any";
  }

  function buildTransactionPayload() {
    const form = new FormData(elements.transactionForm);
    const tagIds = transactionTagsEditMode
      ? selectedTagIdsFrom(elements.transactionTags)
      : (transactionTagDraftIds || []);
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
    if (!transaction) {
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
      closeTransactionDialog();
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
    clearManualImportFieldErrors();
    setTypeGroupValue(elements.manualImportTypeInput, elements.manualImportTypeGroup, rawRow.preview_type || "expense");
    setManualImportCategoryValue(rawRow.preview_category_id || null);
    const previewDescription = clean(rawRow.preview_clean_description);
    elements.manualImportForm.elements.cleanDescription.value = isTemplateRawRow(rawRow)
      ? previewDescription || clean(rawRow.default_clean_description)
      : previewDescription || clean(rawRow.default_clean_description);
    elements.manualImportForm.elements.note.value = rawRowStoredNote(rawRow);
    renderManualImportTags(rawRow.preview_tag_ids || []);
    openModal(elements.manualImportDialog);
    updateManualImportFillButtons();
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
      ["Description", rawRowPreviewCleanDescription(rawRow)],
    ]);
    renderDefinitionList(elements.rawRowImportValues, [
      ["Account", account ? accountLabel(account) : "Unknown"],
      ["Status", rawRow.import_status],
      ["Auto-importable", isImportableRawRow(rawRow) ? "Yes" : "No"],
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

  function updateRawRowModalActions() {
    const rawRow = activeRawRow();
    if (!rawRow) {
      elements.rawRowRuleButton.hidden = true;
      return;
    }
    const canOpenRule = rawRow.import_status !== "imported";
    const canEditRule = canOpenRule && Boolean(topMatchingRuleForRawRow(rawRow, "auto-import"));
    const canUseTemplate = canOpenRule && Boolean(topMatchingRuleForRawRow(rawRow, "template"));
    const canCreateRule = shouldOfferRuleCreation(rawRow);
    elements.rawRowRuleButton.hidden = !canEditRule && !canUseTemplate && !canCreateRule;
    elements.rawRowRuleButton.textContent = "Rule";
  }

  function shouldOfferRuleCreation(rawRow) {
    return rawRow.import_status !== "imported" && !isImportableRawRow(rawRow) && !isTemplateRawRow(rawRow);
  }

  function openTopRawRowRule() {
    const rawRow = activeRawRow();
    if (!rawRow) {
      updateRawRowModalActions();
      return;
    }
    const autoImportRule = topMatchingRuleForRawRow(rawRow, "auto-import");
    const template = topMatchingRuleForRawRow(rawRow, "template");
    const rule = autoImportRule || template;
    const rawRowContext = {
      rawRow,
      autoImportRule,
      templateRule: template,
      selectedRule: rule || null,
    };
    if (rule) {
      closeRawRowDialog();
      openRuleEditDialog(rule, { rawRowContext });
      return;
    }
    if (shouldOfferRuleCreation(rawRow)) {
      closeRawRowDialog();
      openRuleAddDialog({
        matchDescription: rawRow.raw_description,
        matchCategory: rawRow.raw_category,
        setTransactionType: ruleTransactionTypeFromRawAmount(rawRow),
        rawRowContext,
      });
      return;
    }
    updateRawRowModalActions();
  }

  function ruleTransactionTypeFromRawAmount(rawRow) {
    const amount = parseRawAmount(rawRow.raw_amount);
    return Number.isFinite(amount) && amount > 0 ? "income" : "expense";
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
    closeRawRowDialog();
    openManualImportDialog(rawRow);
  }

  async function importManualRawRow(event) {
    event.preventDefault();
    const rawRow = activeManualImportRawRow();
    if (!rawRow) {
      closeManualImportDialog();
      return;
    }
    const payload = buildManualImportPayload();
    clearManualImportFieldErrors();
    if (!payload.transaction_type) {
      setModalMessage(elements.manualImportMessage, "Type is required.", true);
      return;
    }
    const missingFields = [
      ...(!payload.category_id ? ["category"] : []),
      ...(!payload.clean_description ? ["cleanDescription"] : []),
    ];
    if (missingFields.length) {
      setManualImportFieldErrors(missingFields);
      setModalMessage(
        elements.manualImportMessage,
        missingFields.length === 2 ? "Category and description are required." : (!payload.category_id ? "Category is required." : "Description is required."),
        true,
      );
      return;
    }

    elements.manualImportSubmitButton.disabled = true;
    try {
      const response = await apiRequest(mutationPath(`/api/raw-rows/${rawRow.id}/manual-import`), {
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
    clear(elements.importTable);

    if (!state.imports.length) {
      elements.importTable.appendChild(emptyTableRow(5));
      return;
    }

    state.imports.slice().reverse().forEach((item) => {
      const account = state.accounts.find((candidate) => candidate.id === item.account_id);
      const row = tableRow([
        displayDateCell(item.first_date),
        displayDateCell(item.last_date),
        account ? accountLabel(account) : "Unknown",
        String(uploadRawRowCount(item)),
        formatDateTime(item.imported_at),
      ]);
      row.children[4]?.classList.add("uploaded-date-column");
      makeEditableRow(row, `View upload ${item.filename}`, () => openUploadedFileDialog(item));
      elements.importTable.appendChild(row);
    });
  }

  function openUploadedFileDialog(item) {
    const account = state.accounts.find((candidate) => candidate.id === item.account_id);
    const rawRows = uploadRawRows(item);
    const transactions = uploadTransactions(item);
    activeUploadedFileId = item.id;
    elements.uploadedFileDialogTitle.textContent = item.filename || "Uploaded File";
    renderDefinitionList(elements.uploadedFileFileValues, [
      ["Filename", item.filename],
      ["Source type", item.source_type],
      ["Layout", item.metadata?.layout],
      ["SHA-256", item.sha256],
      ["Columns", (item.metadata?.columns || []).join(", ")],
    ]);
    renderDefinitionList(elements.uploadedFileUploadValues, [
      ["Account", account ? accountLabel(account) : "Unknown"],
      ["First", item.first_date || uploadFirstDate(item)],
      ["Last", item.last_date || uploadLastDate(item)],
      ["Uploaded", formatDateTime(item.imported_at)],
      ["Source ID", item.id],
    ]);
    renderDefinitionList(elements.uploadedFileImpactValues, [
      ["Rows", uploadRawRowCount(item)],
      ["Original rows", item.row_count],
      ["Transactions", item.transaction_count ?? transactions.length],
    ]);
    openModal(elements.uploadedFileDialog);
  }

  function closeUploadedFileDialog() {
    elements.uploadedFileDialog.close();
  }

  async function deleteActiveUploadedFile() {
    const item = state.imports.find((candidate) => candidate.id === activeUploadedFileId);
    if (!item) {
      return;
    }
    const rawRowCount = uploadRawRowCount(item);
    const transactionCount = item.transaction_count ?? uploadTransactions(item).length;
    const result = await confirmDestructive({
      title: "Delete Uploaded File",
      message: destructiveMessage(
        `Delete ${item.filename}?\n
        This will also delete:
        - ${rawRowCount} raw transactions
        - ${transactionCount} transactions\n`,
      ),
      actionLabel: "Delete",
    });
    if (!result) {
      return;
    }
    try {
      const payload = await apiRequest(mutationPath(`/api/imports/${item.id}`), { method: "DELETE" });
      closeUploadedFileDialog();
      applyStateFromPayload(payload);
      showPopup("Uploaded file deleted.", "success");
    } catch (error) {
      showPopup(error.message || "Could not delete uploaded file.", "error");
    }
  }

  function uploadRawRows(item) {
    return state.rawRows.filter((row) => row.imported_source_id === item.id);
  }

  function uploadRawRowCount(item) {
    return item.raw_row_count ?? uploadRawRows(item).length;
  }

  function uploadTransactions(item) {
    const rawRowIds = new Set(uploadRawRows(item).map((row) => Number(row.id)));
    return state.transactions.filter((transaction) => rawRowIds.has(Number(transaction.raw_imported_row_id)));
  }

  function uploadFirstDate(item) {
    return sortedUploadDates(item)[0] || null;
  }

  function uploadLastDate(item) {
    const dates = sortedUploadDates(item);
    return dates[dates.length - 1] || null;
  }

  function sortedUploadDates(item) {
    return uploadRawRows(item)
      .map((row) => clean(row.raw_date))
      .filter(Boolean)
      .sort();
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

  function renderBulkImportTags(selectedTagIds) {
    renderSelectableTags(elements.bulkImportTags, selectedTagIds, "tagIds");
    elements.bulkImportTags.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        setTypeGroupValue(elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup, "overwrite");
        updateBulkImportActionState();
      });
    });
  }

  function renderBulkEditTags(selectedTagIds) {
    renderSelectableTags(elements.bulkEditTags, selectedTagIds, "tagIds");
    elements.bulkEditTags.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        setTypeGroupValue(elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup, "overwrite");
        updateBulkEditActionState();
      });
    });
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
    if (elements.ruleCategoryInput.value) {
      clearRuleFieldError("setCategory");
    }
  }

  function setManualImportCategoryValue(categoryId) {
    elements.manualImportCategoryInput.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.manualImportCategoryButton, elements.manualImportCategoryInput.value);
    if (elements.manualImportCategoryInput.value) {
      clearManualImportFieldError("category");
    }
  }

  function setBulkImportCategoryValue(categoryId) {
    elements.bulkImportCategoryInput.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.bulkImportCategoryButton, elements.bulkImportCategoryInput.value, "Keep category");
    updateBulkImportActionState();
  }

  function setBulkEditCategoryValue(categoryId) {
    elements.bulkEditCategoryInput.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.bulkEditCategoryButton, elements.bulkEditCategoryInput.value, "Keep category");
    updateBulkEditActionState();
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

  function setRuleCategoryFilterValue(categoryId) {
    elements.ruleCategoryFilter.value = categoryId === null || categoryId === undefined ? "" : String(categoryId);
    renderCategoryButton(elements.ruleCategoryFilterButton, elements.ruleCategoryFilter.value, "All categories");
    renderRules();
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
    renderCategoryButton(elements.bulkImportCategoryButton, elements.bulkImportCategoryInput.value, "Keep category");
    renderCategoryButton(elements.bulkEditCategoryButton, elements.bulkEditCategoryInput.value, "Keep category");
    renderCategoryButton(elements.transactionCategoryButton, elements.transactionCategoryInput.value, "Select category");
    renderCategoryButton(elements.transactionCategoryFilterButton, elements.transactionCategoryFilter.value, "All categories");
    renderCategoryButton(elements.ruleCategoryFilterButton, elements.ruleCategoryFilter.value, "All categories");
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
    const canClear = target === "rule" || target === "manual-import" || target === "bulk-import" || target === "bulk-edit" || target === "transaction-filter" || target === "rule-filter" || target === "category-parent";
    elements.categoryPickerTitle.textContent = target === "rule" || target === "manual-import" || target === "bulk-import" || target === "bulk-edit"
      ? "Select Clean Category"
      : target === "transaction-filter" || target === "rule-filter"
        ? "Filter By Category"
        : target === "category-parent"
          ? "Select Parent Category"
          : "Select Category";
    elements.categoryPickerClearButton.textContent = target === "transaction-filter" || target === "rule-filter"
      ? "All Categories"
      : target === "category-parent"
        ? "No Parent"
        : target === "bulk-import" || target === "bulk-edit"
          ? "Keep Category"
          : "No Category";
    elements.categoryPickerClearButton.hidden = !canClear;
    renderCategoryPicker();
    openModal(elements.categoryPickerDialog);
    scrollCategoryPickerToSelectedSection();
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
    const selectedId = selectedCategoryPickerId();
    const parentOnly = categoryPickerTarget === "category-parent";
    renderCategorySections(elements.categoryPickerList, {
      selectable: true,
      selectedId,
      parentOnly,
      transferCategoryMode: categoryPickerTransferCategoryMode(),
      onSelect: (category) => selectPickedCategory(category.id),
    });
  }

  function selectedCategoryPickerId() {
    if (categoryPickerTarget === "transaction") {
      return Number(elements.transactionCategoryInput.value) || null;
    }
    if (categoryPickerTarget === "transaction-filter") {
      return Number(elements.transactionCategoryFilter.value) || null;
    }
    if (categoryPickerTarget === "rule-filter") {
      return Number(elements.ruleCategoryFilter.value) || null;
    }
    if (categoryPickerTarget === "category-parent") {
      return Number(elements.categoryParentInput.value) || null;
    }
    if (categoryPickerTarget === "manual-import") {
      return Number(elements.manualImportCategoryInput.value) || null;
    }
    if (categoryPickerTarget === "bulk-import") {
      return Number(elements.bulkImportCategoryInput.value) || null;
    }
    if (categoryPickerTarget === "bulk-edit") {
      return Number(elements.bulkEditCategoryInput.value) || null;
    }
    return Number(elements.ruleCategoryInput.value) || null;
  }

  function scrollCategoryPickerToSelectedSection() {
    const selectedId = selectedCategoryPickerId();
    const rootId = selectedId ? rootCategoryId(selectedId) : null;
    const panel = elements.categoryPickerDialog.querySelector(".modal-panel");
    const section = rootId
      ? elements.categoryPickerList.querySelector(`[data-category-root-id="${rootId}"]`)
      : null;
    if (!panel || !section) {
      return;
    }
    requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      const centeredTop = panel.scrollTop
        + sectionRect.top
        - panelRect.top
        - ((panel.clientHeight - sectionRect.height) / 2);
      panel.scrollTo({ top: Math.max(0, centeredTop), left: 0 });
    });
  }

  function rootCategoryId(categoryId) {
    let category = state.categories.find((candidate) => candidate.id === Number(categoryId));
    while (category?.parent_id) {
      const parent = state.categories.find((candidate) => candidate.id === category.parent_id);
      if (!parent) {
        break;
      }
      category = parent;
    }
    return category?.id || null;
  }

  function categoryPickerTransferCategoryMode() {
    if (!["transaction", "rule", "manual-import", "bulk-import", "bulk-edit"].includes(categoryPickerTarget || "")) {
      return "all";
    }
    return pendingCategoryPickerTransactionType() === "transfer" ? "transfer-only" : "non-transfer";
  }

  function pendingCategoryPickerTransactionType() {
    if (categoryPickerTarget === "transaction") {
      return clean(elements.transactionTypeInput.value);
    }
    if (categoryPickerTarget === "rule") {
      return clean(elements.ruleTypeInput.value);
    }
    if (categoryPickerTarget === "manual-import") {
      return clean(elements.manualImportTypeInput.value);
    }
    if (categoryPickerTarget === "bulk-import") {
      return clean(elements.bulkImportTypeInput.value);
    }
    if (categoryPickerTarget === "bulk-edit") {
      return clean(elements.bulkEditTypeInput.value);
    }
    return "";
  }

  function isTransferCategory(categoryOrId) {
    const category = typeof categoryOrId === "object"
      ? categoryOrId
      : state.categories.find((candidate) => candidate.id === Number(categoryOrId));
    if (!category) {
      return false;
    }
    const rootId = rootCategoryId(category.id);
    const root = state.categories.find((candidate) => candidate.id === rootId);
    return clean(root?.name).toLowerCase() === "transfer";
  }

  function clearTransferCategoryIfTypeIsNotTransfer(target) {
    const transactionType = pendingTransactionTypeForTarget(target);
    const categoryId = selectedCategoryIdForTarget(target);
    if (!categoryId) {
      return;
    }
    const categoryIsTransfer = isTransferCategory(categoryId);
    const categoryIsValid = transactionType === "transfer" ? categoryIsTransfer : !categoryIsTransfer;
    if (categoryIsValid) {
      return;
    }
    setCategoryValueForTarget(target, null);
  }

  function pendingTransactionTypeForTarget(target) {
    if (target === "transaction") {
      return clean(elements.transactionTypeInput.value);
    }
    if (target === "rule") {
      return clean(elements.ruleTypeInput.value);
    }
    if (target === "manual-import") {
      return clean(elements.manualImportTypeInput.value);
    }
    if (target === "bulk-import") {
      return clean(elements.bulkImportTypeInput.value);
    }
    if (target === "bulk-edit") {
      return clean(elements.bulkEditTypeInput.value);
    }
    return "";
  }

  function selectedCategoryIdForTarget(target) {
    if (target === "transaction") {
      return Number(elements.transactionCategoryInput.value) || null;
    }
    if (target === "rule") {
      return Number(elements.ruleCategoryInput.value) || null;
    }
    if (target === "manual-import") {
      return Number(elements.manualImportCategoryInput.value) || null;
    }
    if (target === "bulk-import") {
      return Number(elements.bulkImportCategoryInput.value) || null;
    }
    if (target === "bulk-edit") {
      return Number(elements.bulkEditCategoryInput.value) || null;
    }
    return null;
  }

  function setCategoryValueForTarget(target, categoryId) {
    if (target === "transaction") {
      setTransactionCategoryValue(categoryId);
    } else if (target === "rule") {
      setRuleCategoryValue(categoryId);
    } else if (target === "manual-import") {
      setManualImportCategoryValue(categoryId);
    } else if (target === "bulk-import") {
      setBulkImportCategoryValue(categoryId);
    } else if (target === "bulk-edit") {
      setBulkEditCategoryValue(categoryId);
    }
  }

  function readDashboardFilterCategoryIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DASHBOARD_FILTER_CATEGORY_IDS_KEY) || "null");
      if (!Array.isArray(parsed)) {
        return null;
      }
      return new Set(parsed.map((id) => Number(id)).filter(Boolean));
    } catch {
      return null;
    }
  }

  function persistDashboardFilterSelection() {
    localStorage.setItem(DASHBOARD_FILTER_CATEGORY_IDS_KEY, JSON.stringify([...dashboardFilterCategoryIds]));
  }

  function defaultDashboardFilterCategoryIds() {
    return new Set(state.categories
      .filter((category) => !isTransferCategory(category))
      .map((category) => category.id));
  }

  function normalizeDashboardFilterSelection() {
    const validIds = new Set(state.categories.map((category) => category.id));
    const storedIds = readDashboardFilterCategoryIds();
    dashboardFilterCategoryIds = storedIds || defaultDashboardFilterCategoryIds();
    dashboardFilterCategoryIds = new Set([...dashboardFilterCategoryIds].filter((categoryId) => validIds.has(categoryId)));
    if (!storedIds && state.categories.length) {
      persistDashboardFilterSelection();
    }
  }

  function dashboardFilterEnabled() {
    return elements.dashboardFilterToggle.checked;
  }

  function dashboardFilterTransactions(transactions) {
    if (!dashboardFilterEnabled()) {
      return transactions;
    }
    normalizeDashboardFilterSelection();
    return transactions.filter((transaction) => dashboardFilterCategoryIds.has(Number(transaction.category_id)));
  }

  function renderDashboardFilterList() {
    clear(elements.dashboardFilterList);
    if (!state.categories.length) {
      appendEmpty(elements.dashboardFilterList);
      return;
    }
    const roots = orderedCategories().filter((category) => category.parent_id === null);
    const rendered = new Set();
    roots.forEach((root) => {
      const section = document.createElement("section");
      section.className = "category-section";
      const header = document.createElement("div");
      header.className = "category-section-heading";
      header.appendChild(el("h3", root.name));
      const chips = document.createElement("div");
      chips.className = "category-section-chips";
      chips.appendChild(dashboardFilterCategoryChip(root, () => toggleDashboardFilterRoot(root)));
      rendered.add(root.id);
      orderedCategories()
        .filter((category) => category.parent_id === root.id)
        .forEach((child) => {
          chips.appendChild(dashboardFilterCategoryChip(child, () => toggleDashboardFilterCategory(child.id)));
          rendered.add(child.id);
        });
      section.append(header, chips);
      elements.dashboardFilterList.appendChild(section);
    });
    orderedCategories()
      .filter((category) => !rendered.has(category.id))
      .forEach((category) => elements.dashboardFilterList.appendChild(dashboardFilterCategoryChip(category, () => toggleDashboardFilterCategory(category.id))));
  }

  function dashboardFilterCategoryChip(category, onClick) {
    const selected = dashboardFilterCategoryIds.has(category.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = selected
      ? "dashboard-filter-chip is-selected"
      : "dashboard-filter-chip chip category-chip";
    button.style.setProperty("--category-color", effectiveCategoryColor(category));
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    if (selected) {
      const icon = materialIcon("check");
      icon.classList.add("dashboard-filter-chip-check");
      button.append(icon);
    }
    button.appendChild(el("span", category.name));
    button.addEventListener("click", onClick);
    return button;
  }

  function toggleDashboardFilterRoot(root) {
    const categoryIds = [root.id, ...orderedCategories()
      .filter((category) => category.parent_id === root.id)
      .map((category) => category.id)];
    const shouldSelect = !dashboardFilterCategoryIds.has(root.id);
    categoryIds.forEach((categoryId) => {
      if (shouldSelect) {
        dashboardFilterCategoryIds.add(categoryId);
      } else {
        dashboardFilterCategoryIds.delete(categoryId);
      }
    });
    persistDashboardFilterSelection();
    renderDashboardFilterList();
    renderDashboard();
  }

  function toggleDashboardFilterCategory(categoryId) {
    if (dashboardFilterCategoryIds.has(categoryId)) {
      dashboardFilterCategoryIds.delete(categoryId);
    } else {
      dashboardFilterCategoryIds.add(categoryId);
    }
    persistDashboardFilterSelection();
    renderDashboardFilterList();
    renderDashboard();
  }

  function selectPickedCategory(categoryId) {
    if (categoryPickerTarget === "transaction") {
      if (categoryId === null) {
        return;
      }
      setTransactionCategoryValue(categoryId);
    } else if (categoryPickerTarget === "transaction-filter") {
      setTransactionCategoryFilterValue(categoryId);
    } else if (categoryPickerTarget === "rule-filter") {
      setRuleCategoryFilterValue(categoryId);
    } else if (categoryPickerTarget === "rule") {
      setRuleCategoryValue(categoryId);
    } else if (categoryPickerTarget === "manual-import") {
      setManualImportCategoryValue(categoryId);
    } else if (categoryPickerTarget === "bulk-import") {
      setBulkImportCategoryValue(categoryId);
    } else if (categoryPickerTarget === "bulk-edit") {
      setBulkEditCategoryValue(categoryId);
    } else if (categoryPickerTarget === "category-parent") {
      setCategoryParentValue(categoryId);
    }
    closeCategoryPicker();
  }

  function renderCategorySections(categoryList, options = {}) {
    const selectable = Boolean(options.selectable);
    const parentOnly = Boolean(options.parentOnly);
    const transferCategoryMode = options.transferCategoryMode || "all";
    const roots = orderedCategories().filter((category) => category.parent_id === null);
    const rendered = new Set();
    roots.forEach((root) => {
      if (!categoryMatchesTransferMode(root, transferCategoryMode)) {
        rendered.add(root.id);
        orderedCategories()
          .filter((category) => category.parent_id === root.id)
          .forEach((category) => rendered.add(category.id));
        return;
      }
      if (parentOnly && root.id === editingCategoryId) {
        rendered.add(root.id);
        return;
      }
      const section = document.createElement("section");
      section.className = "category-section";
      section.dataset.categoryRootId = String(root.id);
      const header = document.createElement("div");
      header.className = "category-section-heading";
      header.appendChild(el("h3", root.name));
      if (!root.is_default) {
        header.appendChild(actionButtons([["edit", `Edit ${root.name}`, () => editCategory(root)]]));
      }
      const chips = document.createElement("div");
      chips.className = "category-section-chips";
      const children = parentOnly
        ? []
        : orderedCategories().filter((category) => category.parent_id === root.id && categoryMatchesTransferMode(category, transferCategoryMode));
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
      .filter((category) => !rendered.has(category.id) && (!parentOnly || category.parent_id === null) && categoryMatchesTransferMode(category, transferCategoryMode))
      .forEach((category) => categoryList.appendChild(selectable
        ? selectableCategoryChip(category, options.selectedId === category.id, options.onSelect)
        : categoryChip(category)));
  }

  function categoryMatchesTransferMode(category, transferCategoryMode) {
    if (transferCategoryMode === "transfer-only") {
      return isTransferCategory(category);
    }
    if (transferCategoryMode === "non-transfer") {
      return !isTransferCategory(category);
    }
    return true;
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
    return parent?.color;
  }

  function orderedCategories() {
    return state.categories.slice().sort((a, b) => categorySortKey(a).localeCompare(categorySortKey(b)));
  }

  function categorySortKey(category) {
    const parent = state.categories.find((candidate) => candidate.id === category.parent_id);
    const parentName = parent?.name || category.name;
    const parentRank = Number.isFinite(Number(parent?.sort_order ?? category.sort_order))
      ? Number(parent?.sort_order ?? category.sort_order)
      : 999999;
    const categoryRank = category.parent_id === null
      ? -1
      : Number.isFinite(Number(category.sort_order))
        ? Number(category.sort_order)
        : 999999;
    return `${String(parentRank).padStart(6, "0")}:${parentName}:${String(categoryRank).padStart(6, "0")}:${category.name}`;
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
    const categoryFilter = Number(elements.ruleCategoryFilter.value) || null;
    const categoryIds = categoryFilter === null ? null : new Set([categoryFilter, ...categoryDescendantIds(categoryFilter)]);
    const search = clean(elements.ruleSearch.value).toLowerCase();
    const rules = state.rules.filter((rule) => {
      if (categoryIds && !categoryIds.has(Number(rule.set_category_id))) {
        return false;
      }
      if (!search) {
        return true;
      }
      return clean(rule.name).toLowerCase().includes(search);
    });
    if (!rules.length) {
      tbody.appendChild(emptyTableRow(3));
      return;
    }

    sortedTableRows("rules", rules)
      .forEach((rule) => {
        const category = state.categories.find((candidate) => candidate.id === rule.set_category_id);
        const kind = (rule.rule_type || "auto-import") === "template" ? "Pre-fill" : "Auto-import";
        const row = tableRow([
          `${rule.name} (${kind})`,
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
    list.appendChild(el("span", `Amount is ${matchAmountLabel(matches.amount).toLowerCase()}`));
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
    updateRawColumnHeaders(hiddenColumns);
    const rawColumnCount = 8 - hiddenColumns.size;

    [...selectedRawRowIds].forEach((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      if (!rawRow || !isBaseSelectableRawRow(rawRow)) {
        selectedRawRowIds.delete(rowId);
      }
    });
    const lockedStatus = selectedRawRowStatus();
    [...selectedRawRowIds].forEach((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      if (lockedStatus && rawRow?.import_status !== lockedStatus) {
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
    const sortedRows = sortedTableRows("rawRows", rows);
    visibleRawRows = sortedRows;
    if (!rows.length) {
      tbody.appendChild(emptyTableRow(rawColumnCount));
      updateImportSelectedButton();
      updateSelectVisibleButton();
      return;
    }

    sortedRows.forEach((rawRow) => {
      const account = state.accounts.find((candidate) => candidate.id === rawRow.account_id);
      const tr = document.createElement("tr");
      tr.classList.toggle("is-selected-row", selectedRawRowIds.has(rawRow.id));
      makeEditableRow(tr, `View raw transaction ${rawRow.id}`, () => openRawRowDialog(rawRow));
      const checkbox = document.createElement("input");
      checkbox.className = "row-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = selectedRawRowIds.has(rawRow.id);
      checkbox.disabled = !isSelectableRawRow(rawRow);
      checkbox.setAttribute("aria-label", `Select row ${rawRow.id}`);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("keydown", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          clearSelectedRawRowsExceptStatus(rawRow.import_status);
          selectedRawRowIds.add(rawRow.id);
        } else {
          selectedRawRowIds.delete(rawRow.id);
        }
        renderRawRows();
      });
      const noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.className = "raw-note-input";
      noteInput.value = rawRowNotes.get(rawRow.id) || "";
      noteInput.disabled = !isSelectableRawRow(rawRow);
      noteInput.placeholder = isSelectableRawRow(rawRow) ? "Transaction note" : "";
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
      const selectCell = cell(checkbox, "transaction-select-cell raw-select-cell");
      selectCell.addEventListener("click", (event) => {
        event.stopPropagation();
        checkbox.click();
      });
      const dateCell = cell(displayDateCell(rawRow.raw_date), "date-cell transaction-date-select-cell raw-date-select-cell");
      dateCell.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!checkbox.disabled) {
          checkbox.click();
        }
      });

      const cells = [
        ["select", selectCell],
        ["date", dateCell],
        ["category", cell(rawCategoryValueWithPreview(rawRow))],
        ["description", cell(rawValueWithPreview(rawRow.raw_description, rawRowPreviewCleanDescription(rawRow)))],
        ["amount", cell(rawRow.raw_amount || "-", "amount")],
        ["account", cell(account ? account.name : "Unknown", "transaction-account-cell muted-cell")],
        ["status", cell(statusBadge(rawRow), "status-cell")],
        ["notes", cell(noteInput, "transaction-notes-cell")],
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

  function selectedImportableRawRowIds() {
    return [...selectedRawRowIds].filter((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      return rawRow && isSelectableRawRow(rawRow);
    });
  }

  function openBulkImportDialog() {
    const rowIds = selectedImportableRawRowIds();
    if (!rowIds.length) {
      return;
    }
    elements.bulkImportDialogTitle.textContent = `Bulk Import ${rowIds.length}`;
    resetBulkImportForm();
    openModal(elements.bulkImportDialog);
  }

  function closeBulkImportDialog() {
    elements.bulkImportDialog.close();
  }

  function resetBulkImportForm() {
    elements.bulkImportMessage.textContent = "";
    elements.bulkImportMessage.classList.remove("error");
    elements.bulkImportForm.reset();
    setOptionalTypeGroupValue(elements.bulkImportTypeInput, elements.bulkImportTypeGroup, "");
    setBulkImportCategoryValue(null);
    setTypeGroupValue(elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup, "keep");
    renderBulkImportTags([]);
    updateBulkImportActionState();
  }

  function updateBulkImportActionState() {
    const hasOverrides = bulkImportHasOverrides();
    elements.bulkImportSubmitButton.textContent = hasOverrides ? "Overwrite" : "Import";
    elements.bulkImportSubmitButton.classList.toggle("warning-button", hasOverrides);
  }

  function openBulkEditDialog() {
    const transactionIds = selectedEditableTransactionIds();
    if (!transactionIds.length) {
      return;
    }
    elements.bulkEditDialogTitle.textContent = `Bulk Edit ${transactionIds.length}`;
    resetBulkEditForm();
    openModal(elements.bulkEditDialog);
  }

  function closeBulkEditDialog() {
    elements.bulkEditDialog.close();
  }

  function resetBulkEditForm() {
    elements.bulkEditMessage.textContent = "";
    elements.bulkEditMessage.classList.remove("error");
    elements.bulkEditForm.reset();
    setOptionalTypeGroupValue(elements.bulkEditTypeInput, elements.bulkEditTypeGroup, "");
    setBulkEditCategoryValue(null);
    setTypeGroupValue(elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup, "keep");
    renderBulkEditTags([]);
    updateBulkEditActionState();
  }

  function updateBulkEditActionState() {
    const hasOverrides = bulkEditHasOverrides();
    elements.bulkEditSubmitButton.textContent = hasOverrides ? "Overwrite" : "Edit";
    elements.bulkEditSubmitButton.classList.toggle("warning-button", hasOverrides);
  }

  async function bulkEditTransactions(event) {
    event?.preventDefault();
    const transactionIds = selectedEditableTransactionIds();
    if (!transactionIds.length) {
      closeBulkEditDialog();
      return;
    }
    const overrides = buildBulkEditOverrides();
    if (!Object.keys(overrides).length) {
      closeBulkEditDialog();
      return;
    }
    elements.bulkEditSubmitButton.disabled = true;
    try {
      const payload = await apiRequest(mutationPath("/api/transactions/bulk-edit"), {
        method: "POST",
        body: JSON.stringify({ transaction_ids: transactionIds, overrides }),
      });
      selectedTransactionIds.clear();
      closeBulkEditDialog();
      applyStateFromPayload(payload);
      setMessage(`Updated ${payload.updated_count || transactionIds.length} transactions.`);
    } catch (error) {
      setModalMessage(elements.bulkEditMessage, error.message || "Could not update selected transactions.", true);
    } finally {
      elements.bulkEditSubmitButton.disabled = false;
    }
  }

  async function importSelectedRawRows(event) {
    event?.preventDefault();
    const overrides = buildBulkImportOverrides();
    const rowIds = [...selectedRawRowIds].filter((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      return rawRow && isSelectableRawRow(rawRow);
    });
    if (!rowIds.length) {
      closeBulkImportDialog();
      return;
    }
    await importRawRows(rowIds, {
      button: elements.bulkImportSubmitButton,
      overrides,
      messageElement: elements.bulkImportMessage,
      successMessage: ({ counts }) => `Imported ${counts.imported}; duplicates ${counts.duplicate}; errors ${counts.error}.`,
      onSuccess: () => {
        selectedRawRowIds.clear();
        closeBulkImportDialog();
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
      const payload = await apiRequest(mutationPath("/api/raw-rows/import"), {
        method: "POST",
        body: JSON.stringify({ raw_row_ids: rowIds, raw_row_notes: notes, raw_row_overrides: options.overrides || {} }),
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
      const message = error.message || options.errorMessage || "Could not import raw rows.";
      if (options.messageElement) {
        setModalMessage(options.messageElement, message, true);
      } else {
        showPopup(message, "error");
      }
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
    const selectedStatus = selectedRawRowStatus();
    const autoImportIds = visibleSelectableRawRowIds("auto-importable");
    const prefillIds = visibleSelectableRawRowIds("pre-fill");
    const targetStatus = nextSelectVisibleStatus(selectedStatus, autoImportIds, prefillIds);
    selectedRawRowIds.clear();
    if (targetStatus === "auto-importable") {
      autoImportIds.forEach((rowId) => selectedRawRowIds.add(rowId));
    } else if (targetStatus === "pre-fill") {
      prefillIds.forEach((rowId) => selectedRawRowIds.add(rowId));
    }
    renderRawRows();
  }

  function updateImportSelectedButton() {
    const importableCount = [...selectedRawRowIds].filter((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      return rawRow && isSelectableRawRow(rawRow);
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
    const autoImportIds = visibleSelectableRawRowIds("auto-importable");
    const prefillIds = visibleSelectableRawRowIds("pre-fill");
    const selectedStatus = selectedRawRowStatus();
    const nextStatus = nextSelectVisibleStatus(selectedStatus, autoImportIds, prefillIds);
    const selectableCount = autoImportIds.length + prefillIds.length;
    const title = nextStatus === "auto-importable"
      ? "Select all auto-importable"
      : nextStatus === "pre-fill"
        ? "Select all pre-fill"
        : "Clear selection";
    elements.selectVisibleRowsButton.disabled = selectableCount === 0 && selectedRawRowIds.size === 0;
    elements.selectVisibleRowsButton.title = title;
    elements.selectVisibleRowsButton.setAttribute("aria-label", elements.selectVisibleRowsButton.title);
    elements.selectVisibleRowsButton.textContent = title;
    elements.selectVisibleRowsMobileButton.disabled = elements.selectVisibleRowsButton.disabled;
    elements.selectVisibleRowsMobileButton.title = elements.selectVisibleRowsButton.title;
    elements.selectVisibleRowsMobileButton.setAttribute("aria-label", elements.selectVisibleRowsButton.title);
    elements.selectVisibleRowsMobileButton.textContent = title;
  }

  function updateRawColumnHeaders(hiddenColumns) {
    elements.rawRowsTableElement.querySelectorAll("th[data-raw-column]").forEach((header) => {
      header.hidden = hiddenColumns.has(header.dataset.rawColumn);
    });
  }

  function statusBadge(rawRow) {
    const status = rawRow.import_status || "manual";
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

  function rawRowPreviewCleanDescription(rawRow) {
    return clean(rawRow.preview_clean_description)
      || (isTemplateRawRow(rawRow) ? clean(rawRow.default_clean_description) : "");
  }

  function rawCategoryValueWithPreview(rawRow) {
    const wrapper = document.createElement("div");
    wrapper.className = "raw-value raw-category-value";
    wrapper.appendChild(el("span", rawRow.raw_category || "-"));
    const category = state.categories.find((candidate) => candidate.id === rawRow.preview_category_id);
    if (category) {
      const preview = document.createElement("span");
      preview.className = "rule-preview raw-category-preview";
      preview.appendChild(plainCategoryChip(category));
      wrapper.appendChild(preview);
    } else if (rawRow.preview_category) {
      wrapper.appendChild(el("span", rawRow.preview_category, "rule-preview"));
    }
    return wrapper;
  }

  function isImportableRawRow(rawRow) {
    return rawRow.import_status === "auto-importable";
  }

  function isTemplateRawRow(rawRow) {
    return rawRow.import_status === "pre-fill";
  }

  function isSelectableRawRow(rawRow) {
    if (!isBaseSelectableRawRow(rawRow)) {
      return false;
    }
    const selectedStatus = selectedRawRowStatus();
    return !selectedStatus || rawRow.import_status === selectedStatus;
  }

  function isBaseSelectableRawRow(rawRow) {
    return isImportableRawRow(rawRow) || isTemplateRawRow(rawRow);
  }

  function selectedRawRowStatus() {
    for (const rowId of selectedRawRowIds) {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      if (rawRow && isBaseSelectableRawRow(rawRow)) {
        return rawRow.import_status;
      }
    }
    return null;
  }

  function clearSelectedRawRowsExceptStatus(status) {
    [...selectedRawRowIds].forEach((rowId) => {
      const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
      if (!rawRow || rawRow.import_status !== status) {
        selectedRawRowIds.delete(rowId);
      }
    });
  }

  function visibleSelectableRawRowIds(status) {
    return visibleRawRows
      .filter((row) => row.import_status === status && isBaseSelectableRawRow(row))
      .map((row) => row.id);
  }

  function nextSelectVisibleStatus(selectedStatus, autoImportIds, prefillIds) {
    if (selectedStatus === "auto-importable") {
      const allAutoImportSelected = autoImportIds.length > 0 && autoImportIds.every((rowId) => selectedRawRowIds.has(rowId));
      if (!allAutoImportSelected) {
        return "auto-importable";
      }
      return prefillIds.length ? "pre-fill" : null;
    }
    if (selectedStatus === "pre-fill") {
      const allPrefillSelected = prefillIds.length > 0 && prefillIds.every((rowId) => selectedRawRowIds.has(rowId));
      return allPrefillSelected ? null : "pre-fill";
    }
    return autoImportIds.length ? "auto-importable" : prefillIds.length ? "pre-fill" : null;
  }

  function topMatchingRuleForRawRow(rawRow, ruleType = null) {
    return state.rules
      .filter((rule) => rule.is_active !== false && (ruleType === null || (rule.rule_type || "auto-import") === ruleType) && ruleMatchesRawRow(rule, rawRow))
      .sort((a, b) => ruleSpecificityRank(a) - ruleSpecificityRank(b) || a.id - b.id)[0] || null;
  }

  function ruleSpecificityRank(rule) {
    const matches = ruleMatchValues(rule);
    if (matches.description && matches.category) {
      return 0;
    }
    if (matches.description) {
      return 1;
    }
    if (matches.category) {
      return 2;
    }
    return 3;
  }

  function ruleMatchesRawRow(rule, rawRow) {
    if (!ruleAmountMatches(rule, rawRow)) {
      return false;
    }
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

  function ruleAmountMatches(rule, rawRow) {
    const matchAmount = ruleMatchValues(rule).amount;
    if (matchAmount === "any") {
      return true;
    }
    const amount = parseRawAmount(rawRow.raw_amount);
    if (!Number.isFinite(amount)) {
      return false;
    }
    return matchAmount === "positive" ? amount > 0 : amount < 0;
  }

  function parseRawAmount(value) {
    const rawValue = clean(value);
    if (!rawValue) {
      return NaN;
    }
    let normalized = rawValue;
    if (normalized.startsWith("debit=")) {
      const parts = Object.fromEntries(normalized.split("; ").map((part) => part.split("=", 2)).filter((part) => part.length === 2));
      const debit = clean(parts.debit);
      const credit = clean(parts.credit);
      normalized = debit ? `-${debit.replace(/^-/, "")}` : credit;
    }
    const isNegative = normalized.startsWith("(") && normalized.endsWith(")");
    const numeric = Number(normalized.replace(/[$,()]/g, ""));
    if (!Number.isFinite(numeric)) {
      return NaN;
    }
    return isNegative ? -numeric : numeric;
  }

  function normalizeMatchText(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function rawRowMatchesStatusFilter(rawRow, filter) {
    if (filter === "all") {
      return true;
    }
    if (filter === "new") {
      return ["auto-importable", "manual", "pre-fill"].includes(rawRow.import_status || "manual");
    }
    if (filter === "auto-importable") {
      return isImportableRawRow(rawRow);
    }
    if (filter === "manual") {
      return rawRow.import_status === "manual";
    }
    if (filter === "pre-fill") {
      return isTemplateRawRow(rawRow);
    }
    return rawRow.import_status === filter;
  }

  function statusClass(status) {
    if (status === "auto-importable" || status === "manual" || status === "pre-fill") {
      return "status-new";
    }
    return `status-${status}`;
  }

  function statusLabel(status) {
    return {
      "auto-importable": "Auto-importable",
      manual: "Manual Import",
      "pre-fill": "Pre-fill",
      imported: "Imported",
      duplicate: "Duplicate",
      error: "Error",
    }[status] || status;
  }













  function accountLabel(account) {
    return account.name;
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

  function dashboardFromTransactions(transactions) {
    const dashboardTransactions = dashboardFilterTransactions(transactions);
    const income = sumTypedTransactions(dashboardTransactions, "income", false);
    const bills = sumExpenseTransactions(dashboardTransactions, true);
    const splurge = sumExpenseTransactions(dashboardTransactions, false);
    const saved = income - bills - splurge;
    return {
      income,
      bills,
      splurge,
      saved,
      typeSegments: [
        { label: "Bills", value: bills, color: "#c85d5d" },
        { label: "Splurge", value: splurge, color: "#7c6bc2" },
        { label: "Saved", value: Math.max(saved, 0), color: "#2f8f2f" },
      ],
      incomeSegments: categoryTransactionSegments(dashboardTransactions, "income"),
      categorySegments: categorySpendingSegments(dashboardTransactions, "all-expenses"),
      billSegments: categorySpendingSegments(dashboardTransactions, "bills"),
      splurgeSegments: categorySpendingSegments(dashboardTransactions, "splurge"),
    };
  }

  function isDashboardExpense(transaction, mode) {
    if (transaction.transaction_type !== "expense") {
      return false;
    }
    if (mode === "splurge") {
      return !hasBillTag(transaction);
    }
    if (mode === "bills") {
      return hasBillTag(transaction);
    }
    return true;
  }

  function categorySpendingSegments(transactions, expenseMode) {
    return categoryTransactionSegments(
      transactions.filter((transaction) => isDashboardExpense(transaction, expenseMode)),
      "expense",
    );
  }

  function categoryTransactionSegments(transactions, transactionType) {
    const totals = new Map();
    transactions
      .filter((transaction) => transaction.transaction_type === transactionType)
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
    if (segments.length <= DASHBOARD_CATEGORY_SEGMENT_LIMIT) {
      return segments;
    }
    const visibleLimit = DASHBOARD_CATEGORY_SEGMENT_LIMIT - 1;
    const visible = segments.slice(0, visibleLimit);
    const otherValue = segments.slice(visibleLimit).reduce((sum, segment) => sum + segment.value, 0);
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
      closeTextInputDialog(null);
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


  function openModal(dialog, { focusSingleTextField } = {}) {
    dialog.showModal();
    dialog.scrollTop = 0;
    const panel = dialog.querySelector(".modal-panel");
    if (panel) {
      panel.scrollTop = 0;
    }
    anchorModalToCurrentViewportCenter(dialog);
    updateModalScrollLock();
    if (focusSingleTextField) {
      const input = dialog.querySelector("input[type='text']");
      input?.focus();
      input?.select();
      return;
    }
    dialog.focus({ preventScroll: true });
  }

  function anchorModalToCurrentViewportCenter(dialog) {
    if (!window.matchMedia(MOBILE_LAYOUT_QUERY).matches) {
      dialog.style.removeProperty("--modal-top-offset");
      return;
    }
    const viewport = window.visualViewport;
    const viewportHeight = viewport?.height || window.innerHeight;
    const viewportTop = viewport?.offsetTop || 0;
    const minimumTop = 12;
    const dialogHeight = dialog.getBoundingClientRect().height;
    const centeredTop = viewportTop + Math.max(minimumTop, (viewportHeight - dialogHeight) / 2);
    dialog.style.setProperty("--modal-top-offset", `${Math.round(centeredTop)}px`);
  }

  function initializeClearableTextFields() {
    document.querySelectorAll("input[type='text'], input[type='search'], textarea").forEach((field) => {
      if (field.closest(".clearable-field")) {
        return;
      }
      const wrapper = document.createElement("span");
      wrapper.className = "clearable-field";
      if (field.matches("textarea")) {
        wrapper.classList.add("clearable-textarea-field");
      }
      if (field.matches("input[type='search']")) {
        wrapper.classList.add("clearable-search-field");
      }
      field.parentNode.insertBefore(wrapper, field);
      wrapper.appendChild(field);
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "clear-field-button";
      clearButton.setAttribute("aria-label", "Clear field");
      const icon = el("span", "close_small", "material-symbols-outlined");
      clearButton.appendChild(icon);
      clearButton.addEventListener("mousedown", (event) => event.preventDefault());
      clearButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const fillValue = clearButton.dataset.clearAction === "fill" ? ruleRawRowFillValueForField(field) : "";
        field.value = fillValue;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
      wrapper.appendChild(clearButton);
      field.addEventListener("input", () => updateClearableFieldButton(field));
      field.addEventListener("change", () => updateClearableFieldButton(field));
      updateClearableFieldButton(field);
    });
  }

  function updateClearableFieldButton(field) {
    const button = field.closest(".clearable-field")?.querySelector(".clear-field-button");
    if (!button) {
      return;
    }
    const fillValue = ruleRawRowFillValueForField(field);
    const shouldFill = Boolean(fillValue) && !clean(field.value);
    button.dataset.clearAction = shouldFill ? "fill" : "clear";
    button.setAttribute("aria-label", shouldFill ? "Fill from raw row" : "Clear field");
    const icon = button.querySelector(".material-symbols-outlined");
    if (icon) {
      icon.textContent = shouldFill ? "ink_pen" : "close_small";
    }
  }

  function updateRuleFillButtons() {
    if (!elements.ruleForm) {
      return;
    }
    ["matchDescription", "matchCategory", "setCleanDescription"].forEach((fieldName) => {
      updateClearableFieldButton(elements.ruleForm.elements[fieldName]);
    });
  }

  function updateManualImportFillButtons() {
    if (!elements.manualImportForm) {
      return;
    }
    updateClearableFieldButton(elements.manualImportForm.elements.cleanDescription);
  }

  function ruleRawRowFillValueForField(field) {
    if (!field) {
      return "";
    }
    if (field.form === elements.manualImportForm) {
      const rawRow = activeManualImportRawRow();
      if (!rawRow || field.name !== "cleanDescription") {
        return "";
      }
      return clean(rawRow.default_clean_description) || clean(rawRow.raw_description);
    }
    if (field.form !== elements.ruleForm || !ruleRawRowContext?.rawRow) {
      return "";
    }
    const rawRow = ruleRawRowContext.rawRow;
    if (field.name === "matchCategory") {
      return clean(rawRow.raw_category);
    }
    if (field.name === "matchDescription") {
      return clean(rawRow.raw_description);
    }
    if (field.name === "setCleanDescription") {
      return clean(rawRow.default_clean_description) || clean(rawRow.raw_description);
    }
    return "";
  }

  function clearModalErrorState(dialog) {
    dialog.querySelectorAll(".field-error, .rule-field-error").forEach((element) => {
      element.classList.remove("field-error", "rule-field-error");
    });
    dialog.querySelectorAll(".modal-message").forEach((element) => {
      element.textContent = "";
      element.classList.remove("error");
    });
  }

  function updateModalScrollLock() {
    const hasOpenModal = Boolean(document.querySelector("dialog.modal[open]"));
    document.body.classList.toggle("modal-open", hasOpenModal);
  }













  function sortedTableRows(table, rows) {
    const sortState = tableSortState[table];
    if (!sortState) {
      return rows.slice();
    }
    return rows
      .slice()
      .sort((left, right) => {
        const comparison = compareSortValues(
          tableSortValue(table, left, sortState.key),
          tableSortValue(table, right, sortState.key),
          sortState.type,
          sortState.direction,
        );
        if (comparison !== 0) {
          return comparison;
        }
        return compareSortValues(tableSortValue(table, left, "id"), tableSortValue(table, right, "id"), "number");
      });
  }

  function tableSortValue(table, item, key) {
    if (key === "id") {
      return item.id;
    }
    if (table === "accounts") {
      return {
        name: item.name,
        institution: item.institution,
        type: item.account_type,
        records: item.raw_row_count ?? state.rawRows.filter((row) => row.account_id === item.id).length,
      }[key];
    }
    if (table === "transactions") {
      return {
        date: item.posted_date,
        category: item.category || categoryLabelById(item.category_id),
        description: item.clean_description,
        amount: item.amount_cents,
        account: item.account,
        notes: item.notes,
      }[key];
    }
    if (table === "rawRows") {
      const account = state.accounts.find((candidate) => candidate.id === item.account_id);
      return {
        date: item.raw_date,
        category: clean(item.preview_category) || item.raw_category,
        description: clean(item.preview_clean_description) || item.default_clean_description || item.raw_description,
        amount: item.raw_amount,
        account: account?.name,
        status: statusLabel(item.import_status),
        notes: rawRowNotes.get(item.id),
      }[key];
    }
    if (table === "rules") {
      const matches = ruleMatchValues(item);
      return {
        name: item.name,
        match: `${matches.description} ${matches.category}`.trim(),
      }[key];
    }
    return null;
  }

  function categoryLabelById(categoryId) {
    const category = state.categories.find((candidate) => candidate.id === categoryId);
    return category ? categoryLabel(category) : "";
  }




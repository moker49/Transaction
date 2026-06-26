import { clean } from "./scripts/js/common.mjs";
import { parseCsv, normalizeCsvRow, detectCsvLayout, sourceAccountKeyFromCsvRows, accountImportKeys, sha256 } from "./scripts/js/csv.mjs";
import { formatCents, formatDateTime, formatDisplayDate, formatMaybeDateTime, formatDollars } from "./scripts/js/format.mjs";
import { appendEmpty, cell, clear, displayDateCell, el, emptyTableRow, fillSelect, makeEditableRow, materialIcon, renderDefinitionList, setText, tableRow } from "./scripts/js/dom.mjs";
import { renderPieChart, renderStackedBar } from "./scripts/js/charts.mjs";
import { getElements } from "./scripts/js/dom-elements.mjs";
import { buildAccountPayload, buildBulkEditOverrides, buildBulkImportOverrides, buildCategoryPayload, buildManualImportPayload, buildRulePayload, buildTransactionPayload, payloadMatchesSnapshot, selectedTagIdsFrom } from "./scripts/js/form-payloads.mjs";
import { randomComfortableColor, normalizeHexColor, hexToHsl, hslToHex } from "./scripts/js/colors.mjs";
import { dashboardFromTransactions } from "./scripts/js/dashboard-model.mjs";
import { categoryDescendantIds, categoryLabel, categoryOptions, rootCategoryId, selectedCategory } from "./scripts/js/category-model.mjs";
import { accountLabel, accountTypeLabel, accountTypeValues, destructiveMessage, matchAmountLabel, statusClass, statusLabel, transactionTypeLabel } from "./scripts/js/labels.mjs";
import { clearSelectedRawRowsExceptStatus, isBaseSelectableRawRow, isImportableRawRow, isSelectableRawRow, isTemplateRawRow, nextSelectVisibleStatus, parseRawAmount, rawRowMatchesStatusFilter, ruleMatchValues, selectedRawRowStatus, topMatchingRuleForRawRow, visibleSelectableRawRowIds } from "./scripts/js/raw-row-model.mjs";
import { navigateOptionalTypeGroup, navigateTypeGroup, selectOptionalTypeFromGroup, selectTypeFromGroup, setOptionalTypeGroupValue, setTypeGroupValue } from "./scripts/js/type-groups.mjs";
import { sortedTableRows } from "./scripts/js/table-sort.mjs";
import { DEFAULT_STATE, normalizeState, pruneMissingIds, pruneMissingMapKeys, transactionSliceForRange } from "./scripts/js/state-model.mjs";
import { createDateRangeController } from "./scripts/js/date-range-controller.mjs";
import { createUiController } from "./scripts/js/ui-controller.mjs";
import { createCategoryUi } from "./scripts/js/category-ui.mjs";
import { createDashboardFilterController } from "./scripts/js/dashboard-filter-controller.mjs";
import { createCategoryPickerController } from "./scripts/js/category-picker-controller.mjs";

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


let state = structuredClone(DEFAULT_STATE);
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
let duplicateRuleResolver = null;
let categoryColorDraft = "#2f8f2f";
let mobileDrawerHistoryActive = false;
let activeViewName = "overview";
let scrollTopAnimationFrame = null;
let dashboardCategoryPieMode = "spending";
let dashboardSplurgePieMode = "splurge";
let shouldAnimateDashboardCategoryPie = false;
let shouldAnimateDashboardSplurgePie = false;
let importFileAnalysisToken = 0;
const viewScrollPositions = new Map();
const sectionViewSelections = new Map();
const tableSortState = {
  transactions: { key: "date", direction: "desc", type: "date" },
  accounts: { key: "name", direction: "asc", type: "text" },
  rawRows: { key: "date", direction: "desc", type: "date" },
  rules: { key: "name", direction: "asc", type: "text" },
};
const elements = getElements();
const ui = createUiController({
  elements,
  mobileLayoutQuery: MOBILE_LAYOUT_QUERY,
  fillValueForField: ruleRawRowFillValueForField,
});
const {
  clearModalErrorState,
  closeConfirmDialog,
  closeTextInputDialog,
  confirmDestructive,
  hidePopup,
  initializeClearableTextFields,
  openModal,
  promptForText,
  resolveConfirm,
  resolveTextInput,
  runTextInputDeleteHandler,
  setDevMessage,
  setMessage,
  setModalMessage,
  showPopup,
  updateClearableFieldButton,
  updateModalScrollLock,
} = ui;
const dateRange = createDateRangeController({
  elements,
  keys: {
    dateRange: DATE_RANGE_KEY,
    customStart: DATE_RANGE_CUSTOM_START_KEY,
    customEnd: DATE_RANGE_CUSTOM_END_KEY,
    legacyCustomStart: LEGACY_DATE_RANGE_CUSTOM_START_KEY,
    legacyCustomEnd: LEGACY_DATE_RANGE_CUSTOM_END_KEY,
  },
  presets: dateRangePresets,
  constants: {
    defaultRange: DEFAULT_DATE_RANGE,
    customRange: CUSTOM_DATE_RANGE,
    firstYear: FIRST_YEAR_RANGE,
    yearRangePrefix: YEAR_RANGE_PREFIX,
  },
  openModal,
  loadTransactionData,
  isMobileLayout: () => window.matchMedia(MOBILE_LAYOUT_QUERY).matches,
});
const categoryUi = createCategoryUi({
  getCategories: () => state.categories,
  getEditingCategoryId: () => editingCategoryId,
  editCategory,
  isTransferCategory,
});
const {
  displayCategoryChip,
  plainCategoryChip,
  renderCategorySections,
} = categoryUi;
const categoryPicker = createCategoryPickerController({
  elements,
  getCategories: () => state.categories,
  openModal,
  renderCategorySections,
  rootCategoryId,
  isTransferCategory,
  targets: {
    transaction: {
      title: "Select Category",
      selectedId: () => elements.transactionCategoryInput.value,
      setValue: setTransactionCategoryValue,
      transactionType: () => elements.transactionTypeInput.value,
    },
    "transaction-filter": {
      title: "Filter By Category",
      clearLabel: "All Categories",
      canClear: true,
      selectedId: () => elements.transactionCategoryFilter.value,
      setValue: setTransactionCategoryFilterValue,
    },
    "rule-filter": {
      title: "Filter By Category",
      clearLabel: "All Categories",
      canClear: true,
      selectedId: () => elements.ruleCategoryFilter.value,
      setValue: setRuleCategoryFilterValue,
    },
    rule: {
      title: "Select Clean Category",
      clearLabel: "No Category",
      canClear: true,
      selectedId: () => elements.ruleCategoryInput.value,
      setValue: setRuleCategoryValue,
      transactionType: () => elements.ruleTypeInput.value,
    },
    "manual-import": {
      title: "Select Clean Category",
      clearLabel: "No Category",
      canClear: true,
      selectedId: () => elements.manualImportCategoryInput.value,
      setValue: setManualImportCategoryValue,
      transactionType: () => elements.manualImportTypeInput.value,
    },
    "bulk-import": {
      title: "Select Clean Category",
      clearLabel: "Keep Category",
      canClear: true,
      selectedId: () => elements.bulkImportCategoryInput.value,
      setValue: setBulkImportCategoryValue,
      transactionType: () => elements.bulkImportTypeInput.value,
    },
    "bulk-edit": {
      title: "Select Clean Category",
      clearLabel: "Keep Category",
      canClear: true,
      selectedId: () => elements.bulkEditCategoryInput.value,
      setValue: setBulkEditCategoryValue,
      transactionType: () => elements.bulkEditTypeInput.value,
    },
    "category-parent": {
      title: "Select Parent Category",
      clearLabel: "No Parent",
      canClear: true,
      selectedId: () => elements.categoryParentInput.value,
      setValue: setCategoryParentValue,
    },
  },
});
const dashboardFilter = createDashboardFilterController({
  elements,
  keys: {
    enabled: DASHBOARD_FILTER_ENABLED_KEY,
    categoryIds: DASHBOARD_FILTER_CATEGORY_IDS_KEY,
  },
  getCategories: () => state.categories,
  isTransferCategory,
  openModal,
  renderDashboard,
});
const typeGroupOptions = {
  onChange: ({ input, value }) => {
    if (input === elements.ruleKindInput && value === "template") {
      clearRuleFieldErrors();
    }
  },
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
elements.dashboardFilterButton.addEventListener("click", dashboardFilter.openDialog);
elements.mobileDashboardFilterButton.addEventListener("click", () => {
  closeMobileDrawer();
  dashboardFilter.openDialog();
});
elements.dashboardFilterToggle.addEventListener("change", () => dashboardFilter.setEnabled(elements.dashboardFilterToggle.checked));
elements.mobileDashboardFilterToggle.addEventListener("change", () => dashboardFilter.setEnabled(elements.mobileDashboardFilterToggle.checked));
elements.dashboardFilterCloseButton.addEventListener("click", dashboardFilter.closeDialog);
elements.dashboardFilterDoneButton.addEventListener("click", dashboardFilter.closeDialog);
elements.dashboardFilterResetButton.addEventListener("click", dashboardFilter.resetSelection);
elements.dashboardFilterDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  dashboardFilter.closeDialog();
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
elements.ruleCategoryButton.addEventListener("click", () => categoryPicker.open("rule"));
elements.ruleKindGroup.addEventListener("click", (event) => {
  selectTypeFromGroup(event, elements.ruleKindInput, elements.ruleKindGroup, typeGroupOptions);
  syncRuleDialogModeForSelectedType();
});
elements.ruleKindGroup.addEventListener("keydown", (event) => {
  navigateTypeGroup(event, elements.ruleKindInput, elements.ruleKindGroup, typeGroupOptions);
  syncRuleDialogModeForSelectedType();
});
elements.ruleTypeGroup.addEventListener("click", (event) => {
  selectTypeFromGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup, typeGroupOptions);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("rule");
});
elements.ruleTypeGroup.addEventListener("keydown", (event) => {
  navigateTypeGroup(event, elements.ruleTypeInput, elements.ruleTypeGroup, typeGroupOptions);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("rule");
});
elements.ruleMatchAmountGroup.addEventListener("click", (event) => selectTypeFromGroup(event, elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup, typeGroupOptions));
elements.ruleMatchAmountGroup.addEventListener("keydown", (event) => navigateTypeGroup(event, elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup, typeGroupOptions));
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
elements.bulkImportCategoryButton.addEventListener("click", () => categoryPicker.open("bulk-import"));
elements.bulkImportTypeGroup.addEventListener("click", (event) => {
  selectOptionalTypeFromGroup(event, elements.bulkImportTypeInput, elements.bulkImportTypeGroup);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("bulk-import");
  updateBulkImportActionState();
});
elements.bulkImportTypeGroup.addEventListener("keydown", (event) => {
  navigateOptionalTypeGroup(event, elements.bulkImportTypeInput, elements.bulkImportTypeGroup);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("bulk-import");
  updateBulkImportActionState();
});
elements.bulkImportTagsModeGroup.addEventListener("click", (event) => {
  selectTypeFromGroup(event, elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup, typeGroupOptions);
  updateBulkImportActionState();
});
elements.bulkImportTagsModeGroup.addEventListener("keydown", (event) => {
  navigateTypeGroup(event, elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup, typeGroupOptions);
  updateBulkImportActionState();
});
elements.bulkImportForm.elements.cleanDescription.addEventListener("input", updateBulkImportActionState);
elements.bulkEditTransactionsButton.addEventListener("click", openBulkEditDialog);
elements.bulkEditForm.addEventListener("submit", bulkEditTransactions);
elements.bulkEditCloseButton.addEventListener("click", closeBulkEditDialog);
elements.bulkEditCancelButton.addEventListener("click", closeBulkEditDialog);
elements.bulkEditResetButton.addEventListener("click", resetBulkEditForm);
elements.bulkEditCategoryButton.addEventListener("click", () => categoryPicker.open("bulk-edit"));
elements.bulkEditTypeGroup.addEventListener("click", (event) => {
  selectOptionalTypeFromGroup(event, elements.bulkEditTypeInput, elements.bulkEditTypeGroup);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("bulk-edit");
  updateBulkEditActionState();
});
elements.bulkEditTypeGroup.addEventListener("keydown", (event) => {
  navigateOptionalTypeGroup(event, elements.bulkEditTypeInput, elements.bulkEditTypeGroup);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("bulk-edit");
  updateBulkEditActionState();
});
elements.bulkEditTagsModeGroup.addEventListener("click", (event) => {
  selectTypeFromGroup(event, elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup, typeGroupOptions);
  updateBulkEditActionState();
});
elements.bulkEditTagsModeGroup.addEventListener("keydown", (event) => {
  navigateTypeGroup(event, elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup, typeGroupOptions);
  updateBulkEditActionState();
});
elements.bulkEditForm.elements.cleanDescription.addEventListener("input", updateBulkEditActionState);
elements.manualImportForm.addEventListener("submit", importManualRawRow);
elements.manualImportCloseButton.addEventListener("click", closeManualImportDialog);
elements.manualImportCancelButton.addEventListener("click", closeManualImportDialog);
elements.manualImportCategoryButton.addEventListener("click", () => categoryPicker.open("manual-import"));
elements.manualImportTypeGroup.addEventListener("click", (event) => {
  selectTypeFromGroup(event, elements.manualImportTypeInput, elements.manualImportTypeGroup, typeGroupOptions);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("manual-import");
});
elements.manualImportTypeGroup.addEventListener("keydown", (event) => {
  navigateTypeGroup(event, elements.manualImportTypeInput, elements.manualImportTypeGroup, typeGroupOptions);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("manual-import");
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
elements.mobileDateRangeButton.addEventListener("click", dateRange.openDialog);
elements.mobileDummyDatabaseToggle.addEventListener("change", updateDatabaseMode);
elements.mobileRegenerateDatabaseButton.addEventListener("click", regenerateDatabase);
elements.dateRangeButton.addEventListener("click", dateRange.openDialog);
elements.dateRangeForm.addEventListener("submit", dateRange.applyDateRange);
elements.dateRangeCloseButton.addEventListener("click", dateRange.closeDialog);
elements.dateRangeAllTimeButton.addEventListener("click", dateRange.applyAllTimeDateRange);
elements.dateRangeCancelButton.addEventListener("click", dateRange.closeDialog);
elements.dateRangeCustomStart.addEventListener("change", dateRange.updateCustomRange);
elements.dateRangeCustomEnd.addEventListener("change", dateRange.updateCustomRange);
elements.dateRangeDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  dateRange.closeDialog();
});
elements.accountCancelButton.addEventListener("click", closeAccountDialog);
elements.accountDismissButton.addEventListener("click", closeAccountDialog);
elements.accountDeleteButton.addEventListener("click", deleteEditingAccount);
elements.accountForm.elements.institution.addEventListener("input", autofillAccountName);
elements.accountTypeGroup.addEventListener("click", (event) => {
  selectTypeFromGroup(event, elements.accountTypeInput, elements.accountTypeGroup, typeGroupOptions);
  autofillAccountName();
});
elements.accountTypeGroup.addEventListener("keydown", (event) => {
  navigateTypeGroup(event, elements.accountTypeInput, elements.accountTypeGroup, typeGroupOptions);
  autofillAccountName();
});
elements.accountDialog.addEventListener("close", () => {
  editingAccountId = null;
});
elements.textInputForm.addEventListener("submit", resolveTextInput);
elements.textInputCancelButton.addEventListener("click", () => closeTextInputDialog(null));
elements.textInputDismissButton.addEventListener("click", () => closeTextInputDialog(null));
elements.textInputDeleteButton.addEventListener("click", async () => {
  await runTextInputDeleteHandler();
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
elements.transactionCategoryFilterButton.addEventListener("click", () => categoryPicker.open("transaction-filter"));
elements.ruleCategoryFilterButton.addEventListener("click", () => categoryPicker.open("rule-filter"));
elements.transactionCloseButton.addEventListener("click", closeTransactionDialog);
elements.transactionCancelButton.addEventListener("click", closeTransactionDialog);
elements.transactionTagsEditButton.addEventListener("click", toggleTransactionTagsEditMode);
elements.transactionDeleteButton.addEventListener("click", deleteActiveTransaction);
elements.transactionCategoryButton.addEventListener("click", () => {
  categoryPicker.open("transaction");
});
elements.transactionTypeGroup.addEventListener("click", (event) => {
  selectTypeFromGroup(event, elements.transactionTypeInput, elements.transactionTypeGroup, typeGroupOptions);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("transaction");
});
elements.transactionTypeGroup.addEventListener("keydown", (event) => {
  navigateTypeGroup(event, elements.transactionTypeInput, elements.transactionTypeGroup, typeGroupOptions);
  categoryPicker.clearTransferCategoryIfTypeIsNotTransfer("transaction");
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
    categoryPicker.open("category-parent");
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
elements.categoryPickerCloseButton.addEventListener("click", categoryPicker.close);
elements.categoryPickerCancelButton.addEventListener("click", categoryPicker.close);
elements.categoryPickerClearButton.addEventListener("click", () => categoryPicker.select(null));
elements.categoryPickerDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  categoryPicker.close();
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
  if (dateRange.hasDraft()) {
    dateRange.renderCalendars();
  }
});

dateRange.initialize();
initializeDatabaseMode();
dashboardFilter.initialize();
activateView("overview");
loadInitialState();
























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
      apiRequest(`/api/transactions?${dateRange.query()}`),
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
  const payload = await apiRequest(`/api/transactions?${dateRange.query()}`);
  applyTransactionData(payload.transactionData, { shouldRender });
}

async function loadReferenceData({ shouldRender = true } = {}) {
  const payload = await apiRequest("/api/reference-data");
  applyReferenceData(payload.referenceData, { shouldRender });
}

function mutationPath(path) {
  return `${path}?${dateRange.query()}`;
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
      ...transactionSliceForRange(nextPayload, state, dateRange.currentState()),
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



function pruneRawRowUiState() {
  const visibleTransactionIds = new Set(state.transactions.map((transaction) => transaction.id));
  pruneMissingIds(selectedTransactionIds, visibleTransactionIds);
  const visibleIds = new Set(state.rawRows.map((row) => row.id));
  pruneMissingIds(selectedRawRowIds, visibleIds);
  pruneMissingMapKeys(rawRowNotes, visibleIds);
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
  setTypeGroupValue(elements.accountTypeInput, elements.accountTypeGroup, "credit", typeGroupOptions);
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
  setTypeGroupValue(elements.accountTypeInput, elements.accountTypeGroup, accountTypeValues().has(account.account_type) ? account.account_type : "checking", typeGroupOptions);
  accountEditSnapshot = buildAccountPayload(elements.accountForm);
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
  elements.categoryParentButton.disabled = categoryDescendantIds(state.categories, category.id).size > 0;
  setCategoryDialogColor(category.color || randomComfortableColor());
  updateCategoryColorControl();
  categoryEditSnapshot = buildCategoryPayload(elements.categoryDialogForm);
  openModal(elements.categoryDialog);
}

function closeCategoryDialog() {
  elements.categoryDialog.close();
}

async function saveCategory(event) {
  event.preventDefault();
  const payload = buildCategoryPayload(elements.categoryDialogForm);
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
  setTypeGroupValue(elements.ruleKindInput, elements.ruleKindGroup, prefill.ruleType || "auto-import", typeGroupOptions);
  setTypeGroupValue(elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup, prefill.matchAmount || "any", typeGroupOptions);
  setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, prefill.setTransactionType || "expense", typeGroupOptions);
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
  setTypeGroupValue(elements.ruleKindInput, elements.ruleKindGroup, rule.rule_type || "auto-import", typeGroupOptions);
  form.elements.matchDescription.value = matches.description;
  form.elements.matchCategory.value = matches.category;
  setTypeGroupValue(elements.ruleMatchAmountInput, elements.ruleMatchAmountGroup, matches.amount, typeGroupOptions);
  form.elements.setCleanDescription.value = ruleContextCleanDescription(rule);
  setTypeGroupValue(elements.ruleTypeInput, elements.ruleTypeGroup, rule.set_transaction_type || "expense", typeGroupOptions);
  setRuleCategoryValue(rule.set_category_id);
  renderRuleTags(rule.tag_ids || (rule.add_tag_id === null ? [] : [rule.add_tag_id]));
  ruleEditSnapshot = buildRulePayload(elements.ruleForm, elements.ruleTags);
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
  const existingRule = findDuplicateRule(buildRulePayload(elements.ruleForm, elements.ruleTags));
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
  const payload = buildRulePayload(elements.ruleForm, elements.ruleTags);
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

function tableSortContext() {
  return {
    accounts: state.accounts,
    categories: state.categories,
    rawRows: state.rawRows,
    rawRowNotes,
  };
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
  const dashboard = dashboardFromTransactions(state.transactions, {
    categories: state.categories,
    filterTransactions: dashboardFilter.filterTransactions,
    segmentLimit: DASHBOARD_CATEGORY_SEGMENT_LIMIT,
  });
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

  sortedTableRows("accounts", state.accounts, tableSortState, tableSortContext()).forEach((account) => {
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
  const categoryIds = categoryFilter === null ? null : new Set([categoryFilter, ...categoryDescendantIds(state.categories, categoryFilter)]);
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

  sortedTableRows("transactions", transactions, tableSortState, tableSortContext()).forEach((transaction) => {
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
  transactionEditSnapshot = buildTransactionPayload(elements.transactionForm, transactionTagsEditMode ? selectedTagIdsFrom(elements.transactionTags) : (transactionTagDraftIds || []));
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
  setTypeGroupValue(elements.transactionTypeInput, elements.transactionTypeGroup, transaction.transaction_type || "expense", typeGroupOptions);
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



function autofillAccountName() {
  const form = elements.accountForm;
  const institution = clean(form.elements.institution.value);
  const accountType = accountTypeLabel(form.elements.accountType.value);
  form.elements.name.value = [institution, accountType].filter(Boolean).join(" ");
}







function bulkImportHasOverrides() {
  return Object.keys(buildBulkImportOverrides(elements.bulkImportForm, elements.bulkImportTags)).length > 0;
}

function bulkEditHasOverrides() {
  return Object.keys(buildBulkEditOverrides(elements.bulkEditForm, elements.bulkEditTags)).length > 0;
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
  const payload = buildTransactionPayload(elements.transactionForm, transactionTagsEditMode ? selectedTagIdsFrom(elements.transactionTags) : (transactionTagDraftIds || []));
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
  setTypeGroupValue(elements.manualImportTypeInput, elements.manualImportTypeGroup, rawRow.preview_type || "expense", typeGroupOptions);
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
  const canEditRule = canOpenRule && Boolean(topMatchingRuleForRawRow(state.rules, rawRow, "auto-import"));
  const canUseTemplate = canOpenRule && Boolean(topMatchingRuleForRawRow(state.rules, rawRow, "template"));
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
  const autoImportRule = topMatchingRuleForRawRow(state.rules, rawRow, "auto-import");
  const template = topMatchingRuleForRawRow(state.rules, rawRow, "template");
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
  const payload = buildManualImportPayload(elements.manualImportForm, elements.manualImportTags);
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
      setTypeGroupValue(elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup, "overwrite", typeGroupOptions);
      updateBulkImportActionState();
    });
  });
}

function renderBulkEditTags(selectedTagIds) {
  renderSelectableTags(elements.bulkEditTags, selectedTagIds, "tagIds");
  elements.bulkEditTags.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      setTypeGroupValue(elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup, "overwrite", typeGroupOptions);
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


function renderCategoryButton(button, categoryId, fallbackLabel = "No category") {
  clear(button);
  const category = selectedCategory(state.categories, categoryId);
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


function isTransferCategory(categoryOrId) {
  const category = typeof categoryOrId === "object"
    ? categoryOrId
    : state.categories.find((candidate) => candidate.id === Number(categoryOrId));
  if (!category) {
    return false;
  }
  const rootId = rootCategoryId(state.categories, category.id);
  const root = state.categories.find((candidate) => candidate.id === rootId);
  return clean(root?.name).toLowerCase() === "transfer";
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






function renderRules() {
  const tbody = document.querySelector("#rulesTable");
  clear(tbody);
  const categoryFilter = Number(elements.ruleCategoryFilter.value) || null;
  const categoryIds = categoryFilter === null ? null : new Set([categoryFilter, ...categoryDescendantIds(state.categories, categoryFilter)]);
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

  sortedTableRows("rules", rules, tableSortState, tableSortContext())
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
  const lockedStatus = selectedRawRowStatus(selectedRawRowIds, state.rawRows);
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
  const sortedRows = sortedTableRows("rawRows", rows, tableSortState, tableSortContext());
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
    checkbox.disabled = !isSelectableRawRow(rawRow, selectedRawRowStatus(selectedRawRowIds, state.rawRows));
    checkbox.setAttribute("aria-label", `Select row ${rawRow.id}`);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("keydown", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        clearSelectedRawRowsExceptStatus(selectedRawRowIds, state.rawRows, rawRow.import_status);
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
    noteInput.disabled = !isSelectableRawRow(rawRow, selectedRawRowStatus(selectedRawRowIds, state.rawRows));
    noteInput.placeholder = isSelectableRawRow(rawRow, selectedRawRowStatus(selectedRawRowIds, state.rawRows)) ? "Transaction note" : "";
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
    return rawRow && isSelectableRawRow(rawRow, selectedRawRowStatus(selectedRawRowIds, state.rawRows));
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
  setTypeGroupValue(elements.bulkImportTagsModeInput, elements.bulkImportTagsModeGroup, "keep", typeGroupOptions);
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
  setTypeGroupValue(elements.bulkEditTagsModeInput, elements.bulkEditTagsModeGroup, "keep", typeGroupOptions);
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
  const overrides = buildBulkEditOverrides(elements.bulkEditForm, elements.bulkEditTags);
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
  const overrides = buildBulkImportOverrides(elements.bulkImportForm, elements.bulkImportTags);
  const rowIds = [...selectedRawRowIds].filter((rowId) => {
    const rawRow = state.rawRows.find((candidate) => candidate.id === rowId);
    return rawRow && isSelectableRawRow(rawRow, selectedRawRowStatus(selectedRawRowIds, state.rawRows));
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
  const selectedStatus = selectedRawRowStatus(selectedRawRowIds, state.rawRows);
  const autoImportIds = visibleSelectableRawRowIds(visibleRawRows, "auto-importable");
  const prefillIds = visibleSelectableRawRowIds(visibleRawRows, "pre-fill");
  const targetStatus = nextSelectVisibleStatus(selectedStatus, autoImportIds, prefillIds, selectedRawRowIds);
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
    return rawRow && isSelectableRawRow(rawRow, selectedRawRowStatus(selectedRawRowIds, state.rawRows));
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
  const autoImportIds = visibleSelectableRawRowIds(visibleRawRows, "auto-importable");
  const prefillIds = visibleSelectableRawRowIds(visibleRawRows, "pre-fill");
  const selectedStatus = selectedRawRowStatus(selectedRawRowIds, state.rawRows);
  const nextStatus = nextSelectVisibleStatus(selectedStatus, autoImportIds, prefillIds, selectedRawRowIds);
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


import { clean } from "./common.mjs";
import { cell, clear, displayDateCell, el, emptyTableRow, makeEditableRow } from "./dom.mjs";
import { statusClass, statusLabel } from "./labels.mjs";
import {
  clearSelectedRawRowsExceptStatusFromMap,
  isBaseSelectableRawRow,
  isSelectableRawRow,
  isTemplateRawRow,
  nextSelectVisibleStatus,
  rawRowsByIdMap,
  rawRowMatchesStatusFilter,
  selectedRawRowStatusFromMap,
  visibleSelectableRawRowIds,
} from "./raw-row-model.mjs";
import { sortedTableRows } from "./table-sort.mjs";

export function createRawRowsController({
  elements,
  getState,
  selectedRawRowIds,
  rawRowNotes,
  tableSortState,
  tableSortContext,
  openRawRowDialog,
  plainCategoryChip,
}) {
  let visibleRawRows = [];
  let renderContext = null;

  function render() {
    const tbody = document.querySelector("#rawRowsTable");
    clear(tbody);
    const state = getState();
    const rawRowsById = rawRowsByIdMap(state.rawRows);
    const accountsById = new Map(state.accounts.map((account) => [account.id, account]));
    const categoriesById = new Map(state.categories.map((category) => [category.id, category]));
    const selectedStatus = selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById);
    renderContext = { state, rawRowsById, accountsById, categoriesById, selectedStatus };

    const accountFilter = elements.rawAccountFilter.value;
    const statusFilter = elements.rawStatusFilter.value;
    const hiddenColumns = new Set();
    if (accountFilter !== "all") {
      hiddenColumns.add("account");
    }
    if (statusFilter !== "all") {
      hiddenColumns.add("status");
    }
    updateColumnHeaders(hiddenColumns);
    const rawColumnCount = 8 - hiddenColumns.size;

    pruneSelection();
    renderContext.selectedStatus = selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById);

    const rows = state.rawRows.filter((row) => {
      if (accountFilter !== "all" && String(row.account_id) !== accountFilter) {
        return false;
      }
      return rawRowMatchesStatusFilter(row, statusFilter);
    });
    const sortedRows = sortedTableRows("rawRows", rows, tableSortState, {
      ...tableSortContext(),
      accountsById,
    });
    visibleRawRows = sortedRows;
    if (!rows.length) {
      tbody.appendChild(emptyTableRow(rawColumnCount));
      updateImportSelectedButton();
      updateSelectVisibleButton();
      return;
    }

    sortedRows.forEach((rawRow) => {
      tbody.appendChild(rawRowTableRow(rawRow, hiddenColumns));
    });
    updateImportSelectedButton();
    updateSelectVisibleButton();
  }

  function pruneSelection() {
    const { rawRowsById } = renderContext;
    [...selectedRawRowIds].forEach((rowId) => {
      const rawRow = rawRowsById.get(rowId);
      if (!rawRow || !isBaseSelectableRawRow(rawRow)) {
        selectedRawRowIds.delete(rowId);
      }
    });
    const lockedStatus = selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById);
    [...selectedRawRowIds].forEach((rowId) => {
      const rawRow = rawRowsById.get(rowId);
      if (lockedStatus && rawRow?.import_status !== lockedStatus) {
        selectedRawRowIds.delete(rowId);
      }
    });
  }

  function rawRowTableRow(rawRow, hiddenColumns) {
    const { accountsById } = renderContext;
    const account = accountsById.get(rawRow.account_id);
    const tr = document.createElement("tr");
    tr.classList.toggle("is-selected-row", selectedRawRowIds.has(rawRow.id));
    makeEditableRow(tr, `View raw transaction ${rawRow.id}`, () => openRawRowDialog(rawRow));

    const checkbox = rowCheckbox(rawRow);
    const noteInput = noteField(rawRow);
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
    return tr;
  }

  function rowCheckbox(rawRow) {
    const { rawRowsById, selectedStatus } = renderContext;
    const checkbox = document.createElement("input");
    checkbox.className = "row-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = selectedRawRowIds.has(rawRow.id);
    checkbox.disabled = !isSelectableRawRow(rawRow, selectedStatus);
    checkbox.setAttribute("aria-label", `Select row ${rawRow.id}`);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("keydown", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        clearSelectedRawRowsExceptStatusFromMap(selectedRawRowIds, rawRowsById, rawRow.import_status);
        selectedRawRowIds.add(rawRow.id);
      } else {
        selectedRawRowIds.delete(rawRow.id);
      }
      render();
    });
    return checkbox;
  }

  function noteField(rawRow) {
    const { selectedStatus } = renderContext;
    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.className = "raw-note-input";
    noteInput.value = rawRowNotes.get(rawRow.id) || "";
    const selectable = isSelectableRawRow(rawRow, selectedStatus);
    noteInput.disabled = !selectable;
    noteInput.placeholder = selectable ? "Transaction note" : "";
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
    return noteInput;
  }

  function selectedImportableRowIds() {
    const { rawRowsById } = renderContext;
    const selectedStatus = selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById);
    return [...selectedRawRowIds].filter((rowId) => {
      const rawRow = rawRowsById.get(rowId);
      return rawRow && isSelectableRawRow(rawRow, selectedStatus);
    });
  }

  function selectVisibleRows() {
    const rawRowsById = renderContext?.rawRowsById || rawRowsByIdMap(getState().rawRows);
    const selectedStatus = selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById);
    const autoImportIds = visibleSelectableRawRowIds(visibleRawRows, "auto-importable");
    const prefillIds = visibleSelectableRawRowIds(visibleRawRows, "pre-fill");
    const targetStatus = nextSelectVisibleStatus(selectedStatus, autoImportIds, prefillIds, selectedRawRowIds);
    selectedRawRowIds.clear();
    if (targetStatus === "auto-importable") {
      autoImportIds.forEach((rowId) => selectedRawRowIds.add(rowId));
    } else if (targetStatus === "pre-fill") {
      prefillIds.forEach((rowId) => selectedRawRowIds.add(rowId));
    }
    render();
  }

  function updateImportSelectedButton() {
    const importableCount = selectedImportableRowIds().length;
    elements.importSelectedRowsButton.disabled = importableCount === 0;
    elements.importSelectedRowsButton.hidden = importableCount === 0;
    elements.importSelectedRowsButton.title =
      importableCount === 0 ? "Import selected" : `Import selected (${importableCount})`;
    elements.importSelectedRowsButton.setAttribute("aria-label", elements.importSelectedRowsButton.title);
    elements.rawSelectedCount.textContent = `${importableCount} selected`;
    elements.rawSelectedCountMobile.textContent = `${importableCount} selected`;
  }

  function updateSelectVisibleButton() {
    const { rawRowsById } = renderContext;
    const autoImportIds = visibleSelectableRawRowIds(visibleRawRows, "auto-importable");
    const prefillIds = visibleSelectableRawRowIds(visibleRawRows, "pre-fill");
    const selectedStatus = selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById);
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

  function updateColumnHeaders(hiddenColumns) {
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
    const { categoriesById } = renderContext;
    const wrapper = document.createElement("div");
    wrapper.className = "raw-value raw-category-value";
    wrapper.appendChild(el("span", rawRow.raw_category || "-"));
    const category = categoriesById.get(rawRow.preview_category_id);
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

  function resetVisibleRows() {
    visibleRawRows = [];
  }

  return {
    rawCategoryValueWithPreview,
    rawRowPreviewCleanDescription,
    render,
    resetVisibleRows,
    selectVisibleRows,
    selectedImportableRowIds,
    statusBadge,
    updateImportSelectedButton,
  };
}


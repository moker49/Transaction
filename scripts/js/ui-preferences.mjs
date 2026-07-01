import { clean } from "./common.mjs";

export function createUiPreferences({
  storageKey,
  elements,
  tableSortState,
  sectionViewSelections,
  isAvailableSort,
  isValidSectionView,
}) {
  let pendingRawAccountFilterValue = null;

  function restore() {
    const preferences = read();
    restoreTableSortPreferences(preferences.tableSort);
    restoreSectionViewPreferences(preferences.sectionViews);

    elements.transactionSearch.value = clean(preferences.filters?.transactionSearch);
    elements.ruleSearch.value = clean(preferences.filters?.ruleSearch);
    elements.transactionCategoryFilter.value = clean(preferences.filters?.transactionCategoryId);
    elements.ruleCategoryFilter.value = clean(preferences.filters?.ruleCategoryId);

    pendingRawAccountFilterValue = clean(preferences.filters?.rawAccount);
    setSelectValueIfAvailable(elements.rawStatusFilter, preferences.filters?.rawStatus);
    setSelectValueIfAvailable(elements.rawAccountFilter, pendingRawAccountFilterValue);
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        sectionViews: Object.fromEntries(sectionViewSelections),
        tableSort: tableSortState,
        filters: {
          rawAccount: elements.rawAccountFilter.value || pendingRawAccountFilterValue || "all",
          rawStatus: elements.rawStatusFilter.value,
          transactionSearch: elements.transactionSearch.value,
          transactionCategoryId: elements.transactionCategoryFilter.value,
          ruleSearch: elements.ruleSearch.value,
          ruleCategoryId: elements.ruleCategoryFilter.value,
        },
      }));
    } catch (_error) {
      // Persistence is a convenience; ignore unavailable storage.
    }
  }

  function restoreTableSortPreferences(savedSortState = {}) {
    Object.entries(savedSortState || {}).forEach(([table, sort]) => {
      if (!tableSortState[table] || !isAvailableSort(table, sort)) {
        return;
      }
      tableSortState[table] = {
        key: sort.key,
        direction: sort.direction === "asc" ? "asc" : "desc",
        type: sort.type || "text",
      };
    });
  }

  function restoreSectionViewPreferences(savedSectionViews = {}) {
    Object.entries(savedSectionViews || {}).forEach(([section, view]) => {
      if (isValidSectionView(section, view)) {
        sectionViewSelections.set(section, view);
      }
    });
  }

  function read() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
    } catch (_error) {
      return {};
    }
  }

  return {
    getPendingRawAccountFilterValue: () => pendingRawAccountFilterValue,
    restore,
    save,
    setPendingRawAccountFilterValue: (value) => {
      pendingRawAccountFilterValue = clean(value);
    },
  };
}

export function setSelectValueIfAvailable(select, value) {
  if ([...select.options].some((option) => option.value === String(value))) {
    select.value = String(value);
    return true;
  }
  return false;
}

export function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/"/g, '\\"');
}

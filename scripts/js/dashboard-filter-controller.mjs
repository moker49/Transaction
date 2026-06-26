import { appendEmpty, clear, el, materialIcon } from "./dom.mjs";
import { effectiveCategoryColor, orderedCategories } from "./category-model.mjs";

export function createDashboardFilterController({
  elements,
  keys,
  getCategories,
  isTransferCategory,
  openModal,
  renderDashboard,
  storage = localStorage,
}) {
  let selectedCategoryIds = new Set();

  function initialize() {
    const savedEnabled = storage.getItem(keys.enabled);
    const enabled = savedEnabled !== "false";
    elements.dashboardFilterToggle.checked = enabled;
    elements.mobileDashboardFilterToggle.checked = enabled;
    selectedCategoryIds = readCategoryIds() || new Set();
  }

  function setEnabled(enabled) {
    storage.setItem(keys.enabled, enabled ? "true" : "false");
    elements.dashboardFilterToggle.checked = enabled;
    elements.mobileDashboardFilterToggle.checked = enabled;
    renderDashboard();
  }

  function openDialog() {
    normalizeSelection();
    renderList();
    openModal(elements.dashboardFilterDialog);
  }

  function closeDialog() {
    elements.dashboardFilterDialog.close();
  }

  function resetSelection() {
    selectedCategoryIds = defaultCategoryIds();
    persistSelection();
    renderList();
    renderDashboard();
  }

  function filterTransactions(transactions) {
    if (!isEnabled()) {
      return transactions;
    }
    normalizeSelection();
    return transactions.filter((transaction) => selectedCategoryIds.has(Number(transaction.category_id)));
  }

  function readCategoryIds() {
    try {
      const parsed = JSON.parse(storage.getItem(keys.categoryIds) || "null");
      if (!Array.isArray(parsed)) {
        return null;
      }
      return new Set(parsed.map((id) => Number(id)).filter(Boolean));
    } catch {
      return null;
    }
  }

  function persistSelection() {
    storage.setItem(keys.categoryIds, JSON.stringify([...selectedCategoryIds]));
  }

  function defaultCategoryIds() {
    return new Set(getCategories()
      .filter((category) => !isTransferCategory(category))
      .map((category) => category.id));
  }

  function normalizeSelection() {
    const categories = getCategories();
    const validIds = new Set(categories.map((category) => category.id));
    const storedIds = readCategoryIds();
    selectedCategoryIds = storedIds || defaultCategoryIds();
    selectedCategoryIds = new Set([...selectedCategoryIds].filter((categoryId) => validIds.has(categoryId)));
    if (!storedIds && categories.length) {
      persistSelection();
    }
  }

  function isEnabled() {
    return elements.dashboardFilterToggle.checked;
  }

  function renderList() {
    const categories = getCategories();
    clear(elements.dashboardFilterList);
    if (!categories.length) {
      appendEmpty(elements.dashboardFilterList);
      return;
    }
    const roots = orderedCategories(categories).filter((category) => category.parent_id === null);
    const rendered = new Set();
    roots.forEach((root) => {
      const section = document.createElement("section");
      section.className = "category-section";
      const header = document.createElement("div");
      header.className = "category-section-heading";
      header.appendChild(el("h3", root.name));
      const chips = document.createElement("div");
      chips.className = "category-section-chips";
      chips.appendChild(categoryChip(root, () => toggleRoot(root)));
      rendered.add(root.id);
      orderedCategories(categories)
        .filter((category) => category.parent_id === root.id)
        .forEach((child) => {
          chips.appendChild(categoryChip(child, () => toggleCategory(child.id)));
          rendered.add(child.id);
        });
      section.append(header, chips);
      elements.dashboardFilterList.appendChild(section);
    });
    orderedCategories(categories)
      .filter((category) => !rendered.has(category.id))
      .forEach((category) => elements.dashboardFilterList.appendChild(categoryChip(category, () => toggleCategory(category.id))));
  }

  function categoryChip(category, onClick) {
    const selected = selectedCategoryIds.has(category.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = selected
      ? "dashboard-filter-chip is-selected"
      : "dashboard-filter-chip chip category-chip";
    button.style.setProperty("--category-color", effectiveCategoryColor(getCategories(), category));
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

  function toggleRoot(root) {
    const categories = getCategories();
    const categoryIds = [root.id, ...orderedCategories(categories)
      .filter((category) => category.parent_id === root.id)
      .map((category) => category.id)];
    const shouldSelect = !selectedCategoryIds.has(root.id);
    categoryIds.forEach((categoryId) => {
      if (shouldSelect) {
        selectedCategoryIds.add(categoryId);
      } else {
        selectedCategoryIds.delete(categoryId);
      }
    });
    persistSelection();
    renderList();
    renderDashboard();
  }

  function toggleCategory(categoryId) {
    if (selectedCategoryIds.has(categoryId)) {
      selectedCategoryIds.delete(categoryId);
    } else {
      selectedCategoryIds.add(categoryId);
    }
    persistSelection();
    renderList();
    renderDashboard();
  }

  return {
    closeDialog,
    filterTransactions,
    initialize,
    openDialog,
    resetSelection,
    setEnabled,
  };
}

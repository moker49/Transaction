import { clean } from "./common.mjs";
import { actionButtons, el, manageableChip } from "./dom.mjs";
import { effectiveCategoryColor, orderedCategories } from "./category-model.mjs";

export function createCategoryUi({
  getCategories,
  getEditingCategoryId = () => null,
  editCategory,
  isTransferCategory = () => false,
}) {
  function renderCategorySections(categoryList, options = {}) {
    const categories = getCategories();
    const selectable = Boolean(options.selectable);
    const parentOnly = Boolean(options.parentOnly);
    const transferCategoryMode = options.transferCategoryMode || "all";
    const roots = orderedCategories(categories).filter((category) => category.parent_id === null);
    const rendered = new Set();

    roots.forEach((root) => {
      if (!categoryMatchesTransferMode(root, transferCategoryMode)) {
        rendered.add(root.id);
        orderedCategories(categories)
          .filter((category) => category.parent_id === root.id)
          .forEach((category) => rendered.add(category.id));
        return;
      }
      if (parentOnly && root.id === getEditingCategoryId()) {
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
        : orderedCategories(categories).filter((category) => category.parent_id === root.id && categoryMatchesTransferMode(category, transferCategoryMode));

      if (selectable) {
        chips.appendChild(selectableCategoryChip(root, options.selectedId === root.id, options.onSelect));
        rendered.add(root.id);
      }
      if (!selectable && !children.length && !root.is_default) {
        chips.appendChild(categoryChip(root));
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

    orderedCategories(categories)
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
    const categories = getCategories();
    const chip = category.is_default ? plainCategoryChip(category) : manageableChip(category.name, () => editCategory(category), "category-chip");
    chip.style.setProperty("--category-color", effectiveCategoryColor(categories, category));
    return chip;
  }

  function plainCategoryChip(category) {
    const chip = el("span", category.name, "chip category-chip");
    chip.style.setProperty("--category-color", effectiveCategoryColor(getCategories(), category));
    return chip;
  }

  function displayCategoryChip(category) {
    const chip = el("span", "", "chip category-chip transaction-category-chip");
    chip.style.setProperty("--category-color", effectiveCategoryColor(getCategories(), category));
    manualChipWrap(category.name, 11).forEach((line) => {
      chip.appendChild(el("span", line, "transaction-category-chip-line"));
    });
    return chip;
  }

  return {
    displayCategoryChip,
    plainCategoryChip,
    renderCategorySections,
  };
}

export function manualChipWrap(label, maxLineLength) {
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

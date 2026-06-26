import { clean } from "./common.mjs";
import { appendEmpty, clear } from "./dom.mjs";

export function createCategoryPickerController({
  elements,
  getCategories,
  openModal,
  renderCategorySections,
  rootCategoryId,
  isTransferCategory,
  targets,
}) {
  let activeTarget = null;

  function open(target) {
    activeTarget = target;
    const config = targets[target] || {};
    elements.categoryPickerTitle.textContent = config.title || "Select Category";
    elements.categoryPickerClearButton.textContent = config.clearLabel || "No Category";
    elements.categoryPickerClearButton.hidden = !config.canClear;
    render();
    openModal(elements.categoryPickerDialog);
    scrollToSelectedSection();
  }

  function close() {
    activeTarget = null;
    elements.categoryPickerDialog.close();
  }

  function render() {
    clear(elements.categoryPickerList);
    if (!getCategories().length) {
      appendEmpty(elements.categoryPickerList);
      return;
    }
    renderCategorySections(elements.categoryPickerList, {
      selectable: true,
      selectedId: selectedId(),
      parentOnly: activeTarget === "category-parent",
      transferCategoryMode: transferCategoryMode(),
      onSelect: (category) => select(category.id),
    });
  }

  function selectedId() {
    return Number(targets[activeTarget]?.selectedId?.()) || null;
  }

  function scrollToSelectedSection() {
    const rootId = selectedId() ? rootCategoryId(getCategories(), selectedId()) : null;
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

  function transferCategoryMode() {
    const config = targets[activeTarget] || {};
    if (!config.transactionType) {
      return "all";
    }
    return clean(config.transactionType()) === "transfer" ? "transfer-only" : "non-transfer";
  }

  function select(categoryId) {
    const config = targets[activeTarget] || {};
    if (categoryId === null && !config.canClear) {
      return;
    }
    config.setValue?.(categoryId);
    close();
  }

  function clearTransferCategoryIfTypeIsNotTransfer(target) {
    const config = targets[target] || {};
    if (!config.transactionType) {
      return;
    }
    const categoryId = Number(config.selectedId?.()) || null;
    if (!categoryId) {
      return;
    }
    const categoryIsTransfer = isTransferCategory(categoryId);
    const categoryIsValid = clean(config.transactionType()) === "transfer" ? categoryIsTransfer : !categoryIsTransfer;
    if (!categoryIsValid) {
      config.setValue?.(null);
    }
  }

  return {
    clearTransferCategoryIfTypeIsNotTransfer,
    close,
    open,
    render,
    select,
  };
}

import { clean } from "./common.mjs";
import { el } from "./dom.mjs";

export function createUiController({ elements, mobileLayoutQuery, fillValueForField = () => "" }) {
  let confirmResolver = null;
  let textInputResolver = null;
  let textInputDeleteHandler = null;
  let popupTimer = null;

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

  async function runTextInputDeleteHandler() {
    if (textInputDeleteHandler) {
      await textInputDeleteHandler();
    }
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

  function enableModalBackdropClose(dialog, closeHandler) {
    let pointerStartedOnBackdrop = false;

    dialog.addEventListener("pointerdown", (event) => {
      pointerStartedOnBackdrop = event.target === dialog;
    });

    dialog.addEventListener("click", (event) => {
      if (!pointerStartedOnBackdrop || event.target !== dialog) {
        pointerStartedOnBackdrop = false;
        return;
      }
      pointerStartedOnBackdrop = false;
      closeHandler();
    });
  }

  function anchorModalToCurrentViewportCenter(dialog) {
    if (!window.matchMedia(mobileLayoutQuery).matches) {
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
        const fillValue = clearButton.dataset.clearAction === "fill" ? fillValueForField(field) : "";
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
    const fillValue = fillValueForField(field);
    const shouldFill = Boolean(fillValue) && !clean(field.value);
    button.dataset.clearAction = shouldFill ? "fill" : "clear";
    button.setAttribute("aria-label", shouldFill ? "Fill from raw row" : "Clear field");
    const icon = button.querySelector(".material-symbols-outlined");
    if (icon) {
      icon.textContent = shouldFill ? "ink_pen" : "close_small";
    }
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

  return {
    clearModalErrorState,
    closeConfirmDialog,
    closeTextInputDialog,
    confirmDestructive,
    enableModalBackdropClose,
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
  };
}

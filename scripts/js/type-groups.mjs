import { clean } from "./common.mjs";

export function selectTypeFromGroup(event, input, group, options = {}) {
  const button = event.target.closest("[data-type-value]");
  if (!button || button.disabled || !group.contains(button)) {
    return;
  }
  setTypeGroupValue(input, group, button.dataset.typeValue, options);
}

export function selectOptionalTypeFromGroup(event, input, group) {
  const button = event.target.closest("[data-type-value]");
  if (!button || button.disabled || !group.contains(button)) {
    return;
  }
  setOptionalTypeGroupValue(input, group, input.value === button.dataset.typeValue ? "" : button.dataset.typeValue);
}

export function setTypeGroupValue(input, group, value, options = {}) {
  const normalized = clean(value) || (options.defaultValue || "expense");
  input.value = normalized;
  group.querySelectorAll("[data-type-value]").forEach((button) => {
    const isSelected = button.dataset.typeValue === normalized;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-checked", isSelected ? "true" : "false");
    button.tabIndex = isSelected ? 0 : -1;
  });
  options.onChange?.({ input, group, value: normalized });
}

export function setOptionalTypeGroupValue(input, group, value) {
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

export function setTypeGroupDisabled(group, isDisabled) {
  group.querySelectorAll("[data-type-value]").forEach((button) => {
    button.disabled = isDisabled;
  });
}

export function navigateTypeGroup(event, input, group, options = {}) {
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
  setTypeGroupValue(input, group, buttons[nextIndex].dataset.typeValue, options);
  buttons[nextIndex].focus();
}

export function navigateOptionalTypeGroup(event, input, group) {
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

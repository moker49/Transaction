import {
  addMonths,
  allTimeDateRangePeriod,
  customDateRangePeriod,
  dateRangePeriodForRange,
  dateRangeYearOptions,
  firstOfMonth,
  formatDateKey,
  formatDateRangeLabel,
  isYearRange,
  lastFullYear,
  parseDateKey,
  rangeStartDate,
  yearRangeValue,
} from "./date-range.mjs";
import { clear, el } from "./dom.mjs";

export function createDateRangeController({
  elements,
  storage = localStorage,
  keys,
  presets,
  constants,
  openModal,
  loadTransactionData,
  isMobileLayout,
}) {
  let draft = null;

  const options = () => ({
    customDateRange: () => customDateRangePeriod(keys.customStart, keys.customEnd, storage),
    customDateRangeValue: constants.customRange,
    firstYear: constants.firstYear,
    yearRangePrefix: constants.yearRangePrefix,
  });

  function initialize() {
    const savedRange = storage.getItem(keys.dateRange) || constants.defaultRange;
    const validRange = values().has(savedRange) ? savedRange : constants.defaultRange;
    storage.setItem(keys.dateRange, validRange);
    migrateLegacyStorage();
    renderButton();
  }

  function migrateLegacyStorage() {
    if (!storage.getItem(keys.customStart) && storage.getItem(keys.legacyCustomStart)) {
      storage.setItem(keys.customStart, storage.getItem(keys.legacyCustomStart));
    }
    if (!storage.getItem(keys.customEnd) && storage.getItem(keys.legacyCustomEnd)) {
      storage.setItem(keys.customEnd, storage.getItem(keys.legacyCustomEnd));
    }
  }

  function values() {
    return new Set([
      ...presets.map((preset) => preset.value),
      ...dateRangeYearOptions(options()).map((option) => option.value),
      constants.customRange,
    ]);
  }

  function openDialog() {
    draft = currentState();
    elements.dateRangeCustomStart.value = draft.start || "";
    elements.dateRangeCustomEnd.value = draft.end || "";
    renderDialog();
    openModal(elements.dateRangeDialog);
  }

  function closeDialog() {
    draft = null;
    elements.dateRangeDialog.close();
  }

  async function applyDateRange(event) {
    event.preventDefault();
    if (!draft) {
      return;
    }
    await commitDraft();
  }

  async function applyAllTimeDateRange() {
    const period = allTimeDateRangePeriod();
    draft = {
      range: constants.customRange,
      start: period.start,
      end: period.end,
      viewDate: firstOfMonth(parseDateKey(period.start)),
    };
    elements.dateRangeCustomStart.value = draft.start;
    elements.dateRangeCustomEnd.value = draft.end;
    renderDialog();
    await commitDraft();
  }

  async function commitDraft() {
    storage.setItem(keys.dateRange, draft.range);
    if (draft.range === constants.customRange) {
      storage.setItem(keys.customStart, draft.start || "");
      storage.setItem(keys.customEnd, draft.end || "");
    }
    renderButton();
    await loadTransactionData();
    closeDialog();
  }

  function updateCustomRange() {
    if (!draft) {
      return;
    }
    draft.range = constants.customRange;
    const start = elements.dateRangeCustomStart.value;
    const end = elements.dateRangeCustomEnd.value;
    draft.start = start && end && end < start ? end : start;
    draft.end = start && end && end < start ? start : end;
    elements.dateRangeCustomStart.value = draft.start;
    elements.dateRangeCustomEnd.value = draft.end;
    draft.viewDate = draft.start ? firstOfMonth(parseDateKey(draft.start)) : draft.viewDate;
    renderDialog();
  }

  function currentState() {
    const savedRange = storage.getItem(keys.dateRange) || constants.defaultRange;
    const normalizedRange = savedRange === "last-year" ? yearRangeValue(lastFullYear(), options()) : savedRange;
    const range = values().has(normalizedRange) ? normalizedRange : constants.defaultRange;
    return stateForRange(range);
  }

  function stateForRange(range) {
    const period = dateRangePeriodForRange(range, options());
    return {
      range,
      start: period.start,
      end: period.end,
      viewDate: firstOfMonth(rangeStartDate(range, options())),
    };
  }

  function renderButton() {
    const range = currentState();
    elements.dateRangeLabel.textContent = formatDateRangeLabel(range.start, range.end);
    elements.mobileDateRangeLabel.textContent = formatDateRangeLabel(range.start, range.end);
  }

  function renderDialog() {
    renderPresets();
    renderCalendars();
    elements.dateRangeApplyButton.disabled =
      draft?.range === constants.customRange && (!draft.start || !draft.end);
  }

  function renderPresets() {
    clear(elements.dateRangePresetList);
    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "range-preset-button";
      button.classList.toggle("is-active", draft?.range === preset.value);
      button.textContent = preset.label;
      button.addEventListener("click", () => selectPreset(preset.value));
      elements.dateRangePresetList.appendChild(button);
    });
    const yearSelect = document.createElement("select");
    yearSelect.className = "range-preset-button range-year-select";
    yearSelect.setAttribute("aria-label", "Year");
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Select year";
    yearSelect.appendChild(placeholderOption);
    dateRangeYearOptions(options()).forEach((option) => {
      const yearOption = document.createElement("option");
      yearOption.value = option.value;
      yearOption.textContent = option.label;
      yearSelect.appendChild(yearOption);
    });
    yearSelect.value = isYearRange(draft?.range, options()) ? draft.range : "";
    yearSelect.classList.toggle("is-active", isYearRange(draft?.range, options()));
    yearSelect.addEventListener("change", () => {
      if (yearSelect.value) {
        selectPreset(yearSelect.value);
      }
    });
    elements.dateRangePresetList.appendChild(yearSelect);
  }

  function selectPreset(range) {
    draft.range = range;
    const period = dateRangePeriodForRange(range, options());
    draft.start = period.start;
    draft.end = period.end;
    draft.viewDate = firstOfMonth(parseDateKey(period.start));
    elements.dateRangeCustomStart.value = draft.start || "";
    elements.dateRangeCustomEnd.value = draft.end || "";
    renderDialog();
  }

  function renderCalendars() {
    clear(elements.dateRangeCalendarGrid);
    const viewDate = draft?.viewDate || firstOfMonth(new Date());
    if (isMobileLayout()) {
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
    const previous = calendarNavButton("chevron_left", () => shiftCalendar(-1));
    const next = calendarNavButton("chevron_right", () => shiftCalendar(1));
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
      button.classList.toggle("is-range-edge", key === draft?.start || key === draft?.end);
      button.addEventListener("click", () => selectCustomDay(key));
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

  function shiftCalendar(months) {
    draft.viewDate = addMonths(draft.viewDate, months);
    renderDialog();
  }

  function selectCustomDay(key) {
    draft.range = constants.customRange;
    if (!draft.start || draft.end) {
      draft.start = key;
      draft.end = "";
    } else if (key < draft.start) {
      draft.end = draft.start;
      draft.start = key;
    } else {
      draft.end = key;
    }
    elements.dateRangeCustomStart.value = draft.start;
    elements.dateRangeCustomEnd.value = draft.end;
    renderDialog();
  }

  function isDraftDateInRange(key) {
    if (!draft?.start) {
      return false;
    }
    const end = draft.end || draft.start;
    return key >= draft.start && key <= end;
  }

  function query() {
    const range = currentState();
    return new URLSearchParams({
      startDate: range.start,
      endDate: range.end,
    }).toString();
  }

  return {
    applyAllTimeDateRange,
    applyDateRange,
    closeDialog,
    currentState,
    hasDraft: () => Boolean(draft),
    initialize,
    openDialog,
    query,
    renderCalendars,
    updateCustomRange,
  };
}

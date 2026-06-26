export function dateRangePeriodForRange(range, options = {}) {
  const { customDateRange = customDateRangePeriod, customDateRangeValue = "custom", yearRangePrefix = "year-" } = options;
  const today = startOfDay(new Date());
  if (range === "this-month") {
    return {
      start: formatDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: formatDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (range === "this-year") {
    return {
      start: formatDateKey(new Date(today.getFullYear(), 0, 1)),
      end: formatDateKey(new Date(today.getFullYear(), 11, 31)),
    };
  }
  if (range === "last-year") {
    return lastFullYearPeriod();
  }
  if (isYearRange(range, options)) {
    return fullYearPeriod(Number(range.slice(yearRangePrefix.length)));
  }
  if (range === customDateRangeValue) {
    return customDateRange() || lastFullMonthPeriod();
  }
  return lastFullMonthPeriod();
}

export function allTimeDateRangePeriod() {
  const today = startOfDay(new Date());
  return {
    start: "2020-01-01",
    end: formatDateKey(new Date(today.getFullYear(), 11, 31)),
  };
}

export function dateRangeYearOptions(options = {}) {
  const { firstYear = 2020, yearRangePrefix = "year-" } = options;
  const years = [];
  for (let year = lastFullYear(); year >= firstYear; year -= 1) {
    years.push({ value: yearRangeValue(year, { yearRangePrefix }), label: String(year) });
  }
  return years;
}

export function yearRangeValue(year, options = {}) {
  const { yearRangePrefix = "year-" } = options;
  return `${yearRangePrefix}${year}`;
}

export function isYearRange(range, options = {}) {
  const { firstYear = 2020, yearRangePrefix = "year-" } = options;
  if (!String(range || "").startsWith(yearRangePrefix)) {
    return false;
  }
  const year = Number(String(range).slice(yearRangePrefix.length));
  return Number.isInteger(year) && year >= firstYear && year <= lastFullYear();
}

export function lastFullYear() {
  return new Date().getFullYear() - 1;
}

export function rangeStartDate(range, options = {}) {
  return parseDateKey(dateRangePeriodForRange(range, options).start);
}

export function customDateRangePeriod(startKey, endKey, storage = localStorage) {
  const start = storage.getItem(startKey) || "";
  const end = storage.getItem(endKey) || "";
  if (!start || !end) {
    return null;
  }
  return {
    start: end < start ? end : start,
    end: end < start ? start : end,
  };
}

export function lastFullYearPeriod() {
  return fullYearPeriod(lastFullYear());
}

export function fullYearPeriod(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  return {
    start: formatDateKey(start),
    end: formatDateKey(end),
  };
}

export function lastFullMonthPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    start: formatDateKey(start),
    end: formatDateKey(end),
  };
}

export function formatDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateRangeLabel(start, end) {
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  const startsOnFirst = startDate.getDate() === 1;
  const endsOnLast = endDate.getDate() === daysInMonth(endDate);

  if (sameYear && startDate.getMonth() === 0 && endDate.getMonth() === 11 && startsOnFirst && endsOnLast) {
    return String(startDate.getFullYear());
  }

  if (sameMonth && startsOnFirst && endsOnLast) {
    return `${monthName(startDate, "long")} ${startDate.getFullYear()}`;
  }

  if (sameMonth) {
    if (startDate.getDate() === endDate.getDate()) {
      return `${monthName(startDate, "long")} ${startDate.getDate()}, ${startDate.getFullYear()}`;
    }
    return `${monthName(startDate, "long")} ${startDate.getDate()}-${endDate.getDate()}, ${startDate.getFullYear()}`;
  }

  if (startsOnFirst && endsOnLast) {
    return `${monthName(startDate, "short")} ${startDate.getFullYear()} - ${monthName(endDate, "short")} ${endDate.getFullYear()}`;
  }

  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

export function monthName(date, width) {
  return new Intl.DateTimeFormat("en-US", { month: width }).format(date);
}

export function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

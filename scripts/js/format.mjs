import { clean } from "./common.mjs";

export function formatDollars(cents) {
  const amount = Math.abs(cents) / 100;
  const formatted = `$${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

export function formatCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) {
    return "-";
  }
  return (cents / 100).toFixed(2);
}

export function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDisplayDate(value) {
  if (!value) {
    return "-";
  }
  const text = String(value);
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[2]}-${isoMatch[3]}-${isoMatch[1]}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return [
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    date.getFullYear(),
  ].join("-");
}

export function formatMaybeDateTime(value) {
  return value ? formatDateTime(value) : "-";
}

export function compareSortValues(left, right, type, direction = "asc") {
  const leftValue = normalizeSortValue(left, type);
  const rightValue = normalizeSortValue(right, type);
  const leftMissing = leftValue === null || leftValue === "";
  const rightMissing = rightValue === null || rightValue === "";
  if (leftMissing && rightMissing) {
    return 0;
  }
  if (leftMissing) {
    return 1;
  }
  if (rightMissing) {
    return -1;
  }
  if (type === "number" || type === "date") {
    const comparison = leftValue - rightValue;
    return direction === "asc" ? comparison : -comparison;
  }
  const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}

export function normalizeSortValue(value, type) {
  if (value === null || value === undefined || value === "-") {
    return null;
  }
  if (type === "number") {
    const number = parseSortableNumber(value);
    return Number.isFinite(number) ? number : null;
  }
  if (type === "date") {
    const time = parseSortableDate(value);
    return Number.isFinite(time) ? time : null;
  }
  return clean(value).toLowerCase();
}

export function parseSortableNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  const text = clean(value);
  if (!text) {
    return Number.NaN;
  }
  const isParenthetical = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[,$()]/g, ""));
  return isParenthetical ? -number : number;
}

export function parseSortableDate(value) {
  const text = clean(value);
  if (!text) {
    return Number.NaN;
  }
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }
  const slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
    return Date.UTC(year, Number(slashMatch[1]) - 1, Number(slashMatch[2]));
  }
  const parsed = new Date(text);
  return parsed.getTime();
}

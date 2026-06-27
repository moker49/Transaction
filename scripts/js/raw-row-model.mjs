import { clean } from "./common.mjs";

export function ruleMatchValues(rule) {
  const description = clean(rule.match_description) ||
    (rule.match_field === "description" ? clean(rule.match_value) : "");
  const category = clean(rule.match_category) ||
    (rule.match_field === "category" ? clean(rule.match_value) : "");
  const amount = clean(rule.match_amount) || "any";
  return { description, category, amount };
}

export function isImportableRawRow(rawRow) {
  return rawRow.import_status === "auto-importable";
}

export function isTemplateRawRow(rawRow) {
  return rawRow.import_status === "pre-fill";
}

export function isBaseSelectableRawRow(rawRow) {
  return isImportableRawRow(rawRow) || isTemplateRawRow(rawRow);
}

export function isSelectableRawRow(rawRow, selectedStatus = null) {
  if (!isBaseSelectableRawRow(rawRow)) {
    return false;
  }
  return !selectedStatus || rawRow.import_status === selectedStatus;
}

export function selectedRawRowStatus(selectedRawRowIds, rawRows) {
  const rawRowsById = rawRowsByIdMap(rawRows);
  return selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById);
}

export function selectedRawRowStatusFromMap(selectedRawRowIds, rawRowsById) {
  for (const rowId of selectedRawRowIds) {
    const rawRow = rawRowsById.get(rowId);
    if (rawRow && isBaseSelectableRawRow(rawRow)) {
      return rawRow.import_status;
    }
  }
  return null;
}

export function clearSelectedRawRowsExceptStatus(selectedRawRowIds, rawRows, status) {
  const rawRowsById = rawRowsByIdMap(rawRows);
  clearSelectedRawRowsExceptStatusFromMap(selectedRawRowIds, rawRowsById, status);
}

export function clearSelectedRawRowsExceptStatusFromMap(selectedRawRowIds, rawRowsById, status) {
  [...selectedRawRowIds].forEach((rowId) => {
    const rawRow = rawRowsById.get(rowId);
    if (!rawRow || rawRow.import_status !== status) {
      selectedRawRowIds.delete(rowId);
    }
  });
}

export function rawRowsByIdMap(rawRows) {
  return new Map(rawRows.map((row) => [row.id, row]));
}

export function visibleSelectableRawRowIds(visibleRawRows, status) {
  return visibleRawRows
    .filter((row) => row.import_status === status && isBaseSelectableRawRow(row))
    .map((row) => row.id);
}

export function nextSelectVisibleStatus(selectedStatus, autoImportIds, prefillIds, selectedRawRowIds) {
  if (selectedStatus === "auto-importable") {
    const allAutoImportSelected = autoImportIds.length > 0 && autoImportIds.every((rowId) => selectedRawRowIds.has(rowId));
    if (!allAutoImportSelected) {
      return "auto-importable";
    }
    return prefillIds.length ? "pre-fill" : null;
  }
  if (selectedStatus === "pre-fill") {
    const allPrefillSelected = prefillIds.length > 0 && prefillIds.every((rowId) => selectedRawRowIds.has(rowId));
    return allPrefillSelected ? null : "pre-fill";
  }
  return autoImportIds.length ? "auto-importable" : prefillIds.length ? "pre-fill" : null;
}

export function topMatchingRuleForRawRow(rules, rawRow, ruleType = null) {
  return rules
    .filter((rule) => rule.is_active !== false && (ruleType === null || (rule.rule_type || "auto-import") === ruleType) && ruleMatchesRawRow(rule, rawRow))
    .sort((a, b) => ruleSpecificityRank(a) - ruleSpecificityRank(b) || a.id - b.id)[0] || null;
}

export function ruleSpecificityRank(rule) {
  const matches = ruleMatchValues(rule);
  if (matches.description && matches.category) {
    return 0;
  }
  if (matches.description) {
    return 1;
  }
  if (matches.category) {
    return 2;
  }
  return 3;
}

export function ruleMatchesRawRow(rule, rawRow) {
  if (!ruleAmountMatches(rule, rawRow)) {
    return false;
  }
  const matches = ruleMatchValues(rule);
  const matchDescription = normalizeMatchText(matches.description);
  const matchCategory = normalizeMatchText(matches.category);
  if (matchDescription || matchCategory) {
    if (matchDescription && !normalizeMatchText(rawRow.raw_description).includes(matchDescription)) {
      return false;
    }
    if (matchCategory && !normalizeMatchText(rawRow.raw_category).includes(matchCategory)) {
      return false;
    }
    return true;
  }
  const fieldValue = rule.match_field === "category" ? rawRow.raw_category : rawRow.raw_description;
  const needle = normalizeMatchText(rule.match_value);
  return Boolean(needle) && normalizeMatchText(fieldValue).includes(needle);
}

export function ruleAmountMatches(rule, rawRow) {
  const matchAmount = ruleMatchValues(rule).amount;
  if (matchAmount === "any") {
    return true;
  }
  const amount = parseRawAmount(rawRow.raw_amount);
  if (!Number.isFinite(amount)) {
    return false;
  }
  return matchAmount === "positive" ? amount > 0 : amount < 0;
}

export function parseRawAmount(value) {
  const rawValue = clean(value);
  if (!rawValue) {
    return NaN;
  }
  let normalized = rawValue;
  if (normalized.startsWith("debit=")) {
    const parts = Object.fromEntries(normalized.split("; ").map((part) => part.split("=", 2)).filter((part) => part.length === 2));
    const debit = clean(parts.debit);
    const credit = clean(parts.credit);
    normalized = debit ? `-${debit.replace(/^-/, "")}` : credit;
  }
  const isNegative = normalized.startsWith("(") && normalized.endsWith(")");
  const numeric = Number(normalized.replace(/[$,()]/g, ""));
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return isNegative ? -numeric : numeric;
}

export function normalizeMatchText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function rawRowMatchesStatusFilter(rawRow, filter) {
  if (filter === "all") {
    return true;
  }
  if (filter === "new") {
    return ["auto-importable", "manual", "pre-fill"].includes(rawRow.import_status || "manual");
  }
  if (filter === "auto-importable") {
    return isImportableRawRow(rawRow);
  }
  if (filter === "manual") {
    return rawRow.import_status === "manual";
  }
  if (filter === "pre-fill") {
    return isTemplateRawRow(rawRow);
  }
  return rawRow.import_status === filter;
}

import { clean } from "./common.mjs";
import { compareSortValues } from "./format.mjs";
import { categoryLabelById } from "./category-model.mjs";
import { statusLabel } from "./labels.mjs";
import { ruleMatchValues } from "./raw-row-model.mjs";

export function sortedTableRows(table, rows, tableSortState, context = {}) {
  const sortState = tableSortState[table];
  if (!sortState) {
    return rows.slice();
  }
  return rows
    .slice()
    .sort((left, right) => {
      const comparison = compareSortValues(
        tableSortValue(table, left, sortState.key, context),
        tableSortValue(table, right, sortState.key, context),
        sortState.type,
        sortState.direction,
      );
      if (comparison !== 0) {
        return comparison;
      }
      return compareSortValues(
        tableSortValue(table, left, "id", context),
        tableSortValue(table, right, "id", context),
        "number",
      );
    });
}

export function tableSortValue(table, item, key, context = {}) {
  if (key === "id") {
    return item.id;
  }
  if (table === "accounts") {
    return {
      name: item.name,
      institution: item.institution,
      type: item.account_type,
      records: item.raw_row_count ?? (context.rawRows || []).filter((row) => row.account_id === item.id).length,
    }[key];
  }
  if (table === "transactions") {
    return {
      date: item.posted_date,
      category: item.category || categoryLabelById(context.categories || [], item.category_id),
      description: item.clean_description,
      amount: item.amount_cents,
      account: item.account,
      notes: item.notes,
    }[key];
  }
  if (table === "rawRows") {
    const account = (context.accounts || []).find((candidate) => candidate.id === item.account_id);
    return {
      date: item.raw_date,
      category: clean(item.preview_category) || item.raw_category,
      description: clean(item.preview_clean_description) || item.default_clean_description || item.raw_description,
      amount: item.raw_amount,
      account: account?.name,
      status: statusLabel(item.import_status),
      notes: context.rawRowNotes?.get(item.id),
    }[key];
  }
  if (table === "rules") {
    const matches = ruleMatchValues(item);
    return {
      name: item.name,
      match: `${matches.description} ${matches.category}`.trim(),
    }[key];
  }
  return null;
}

import { clean } from "./common.mjs";

export function buildAccountPayload(formElement) {
  const form = new FormData(formElement);
  return {
    name: clean(form.get("name")),
    institution: clean(form.get("institution")) || null,
    account_type: clean(form.get("accountType")) || null,
  };
}

export function buildCategoryPayload(formElement) {
  const form = new FormData(formElement);
  return {
    name: clean(form.get("name")),
    parent_id: Number(form.get("parentId")) || null,
    color: clean(form.get("parentId")) ? null : clean(form.get("color")),
  };
}

export function buildRulePayload(formElement, tagsContainer) {
  const form = new FormData(formElement);
  const setCleanDescription = clean(form.get("setCleanDescription")) || null;
  const matchDescription = clean(form.get("matchDescription")) || null;
  const matchCategory = clean(form.get("matchCategory")) || null;
  const addTagIds = selectedTagIdsFrom(tagsContainer);
  const ruleType = clean(form.get("ruleKind")) || "auto-import";
  return {
    name: setCleanDescription || matchDescription || matchCategory || (ruleType === "template" ? "Template" : "Rule"),
    rule_type: ruleType,
    match_description: matchDescription,
    match_category: matchCategory,
    match_amount: clean(form.get("matchAmount")) || "any",
    set_category_id: Number(form.get("setCategoryId")) || null,
    set_clean_description: setCleanDescription,
    set_transaction_type: clean(form.get("setTransactionType")) || null,
    add_tag_ids: addTagIds,
  };
}

export function buildManualImportPayload(formElement, tagsContainer) {
  const form = new FormData(formElement);
  return {
    category_id: Number(form.get("categoryId")) || null,
    clean_description: clean(form.get("cleanDescription")) || null,
    transaction_type: clean(form.get("transactionType")) || null,
    tag_ids: selectedTagIdsFrom(tagsContainer),
    note: clean(form.get("note")),
  };
}

export function buildBulkImportOverrides(formElement, tagsContainer) {
  const form = new FormData(formElement);
  return buildBulkOverrides(form, tagsContainer);
}

export function buildBulkEditOverrides(formElement, tagsContainer) {
  const form = new FormData(formElement);
  return buildBulkOverrides(form, tagsContainer);
}

function buildBulkOverrides(form, tagsContainer) {
  const overrides = {};
  const transactionType = clean(form.get("transactionType"));
  const categoryId = Number(form.get("categoryId")) || null;
  const cleanDescription = clean(form.get("cleanDescription")) || null;
  if (transactionType && transactionType !== "keep") {
    overrides.transaction_type = transactionType;
  }
  if (categoryId) {
    overrides.category_id = categoryId;
  }
  if (cleanDescription) {
    overrides.clean_description = cleanDescription;
  }
  if (clean(form.get("tagsMode")) === "overwrite") {
    overrides.tag_ids = selectedTagIdsFrom(tagsContainer);
  }
  return overrides;
}

export function buildTransactionPayload(formElement, tagIds) {
  const form = new FormData(formElement);
  return {
    posted_date: clean(form.get("postedDate")),
    category_id: Number(form.get("categoryId")),
    transaction_type: clean(form.get("transactionType")) || null,
    amount: clean(form.get("amount")),
    clean_description: clean(form.get("cleanDescription")) || null,
    notes: clean(form.get("notes")),
    tag_ids: tagIds,
  };
}

export function selectedTagIdsFrom(container) {
  return [...container.querySelectorAll("input[type='checkbox']:checked")]
    .map((checkbox) => Number(checkbox.value))
    .filter((tagId) => Number.isInteger(tagId) && tagId > 0);
}

export function payloadMatchesSnapshot(payload, snapshot) {
  return Boolean(snapshot) && JSON.stringify(normalizePayloadForComparison(payload)) === JSON.stringify(normalizePayloadForComparison(snapshot));
}

export function normalizePayloadForComparison(value) {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isInteger(item)).sort((a, b) => a - b);
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((record, key) => {
      record[key] = normalizePayloadForComparison(value[key]);
      return record;
    }, {});
  }
  return value ?? null;
}

import { clean } from "./common.mjs";

export const DEFAULT_STATE = {
  accounts: [],
  categories: [],
  tags: [],
  rules: [],
  imports: [],
  transactions: [],
  rawRows: [],
  dashboard: null,
  activeDateRange: null,
};

export function normalizeState(payload, defaultState = DEFAULT_STATE) {
  const normalizedPayload = {
    ...(payload || {}),
  };
  if (normalizedPayload.realTransactions && !normalizedPayload.transactions) {
    normalizedPayload.transactions = normalizedPayload.realTransactions;
  }
  if (normalizedPayload.rawTransactions && !normalizedPayload.rawRows) {
    normalizedPayload.rawRows = normalizedPayload.rawTransactions;
  }
  return {
    ...structuredClone(defaultState),
    ...normalizedPayload,
  };
}

export function transactionSliceForRange(payload, currentState, range) {
  if (!payload?.transactions && !payload?.rawRows) {
    return {};
  }
  const transactions = (payload.transactions || currentState.transactions).filter((transaction) => (
    transaction.posted_date >= range.start && transaction.posted_date <= range.end
  ));
  const rawRows = (payload.rawRows || currentState.rawRows).filter((row) => (
    row.import_status === "auto-importable"
    || row.import_status === "manual"
    || row.import_status === "pre-fill"
    || isRawRowInRange(row, range)
  ));
  return {
    transactions,
    rawRows,
    dashboard: null,
    activeDateRange: { startDate: range.start, endDate: range.end },
  };
}

export function isRawRowInRange(row, range) {
  const rawDate = clean(row.raw_date);
  return rawDate >= range.start && rawDate <= range.end;
}

export function pruneMissingIds(selectedIds, visibleIds) {
  [...selectedIds].forEach((id) => {
    if (!visibleIds.has(id)) {
      selectedIds.delete(id);
    }
  });
}

export function pruneMissingMapKeys(map, visibleIds) {
  [...map.keys()].forEach((id) => {
    if (!visibleIds.has(id)) {
      map.delete(id);
    }
  });
}

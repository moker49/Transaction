import { normalizeState, transactionSliceForRange, pruneMissingIds, pruneMissingMapKeys } from "./state-model.mjs";

export function createAppDataController({
  apiBase,
  dateRange,
  getState,
  setState,
  selectedTransactionIds,
  selectedRawRowIds,
  rawRowNotes,
  isUsingDummyDatabase,
  render,
  showPopup,
  hidePopup,
}) {
  async function loadInitialState() {
    try {
      const [referencePayload, transactionPayload] = await Promise.all([
        apiRequest("/api/reference-data"),
        apiRequest(`/api/transactions?${dateRange.query()}`),
      ]);
      applyReferenceData(referencePayload.referenceData, { shouldRender: false });
      applyTransactionData(transactionPayload.transactionData, { shouldRender: false });
      render();
    } catch (error) {
      showPopup(error.message || "Could not load server data.", "error");
      render();
    }
  }

  async function loadTransactionData({ shouldRender = true } = {}) {
    const payload = await apiRequest(`/api/transactions?${dateRange.query()}`);
    applyTransactionData(payload.transactionData, { shouldRender });
  }

  async function loadReferenceData({ shouldRender = true } = {}) {
    const payload = await apiRequest("/api/reference-data");
    applyReferenceData(payload.referenceData, { shouldRender });
  }

  function mutationPath(path) {
    return `${path}?${dateRange.query()}`;
  }

  async function apiRequest(path, options = {}) {
    const headers = {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-Use-Dummy-Database": isUsingDummyDatabase() ? "1" : "0",
      ...(options.headers || {}),
    };
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with ${response.status}`);
    }
    return payload;
  }

  function applyStateFromPayload(payload) {
    const currentState = getState();
    const nextPayload = payload.state || payload;
    if (payload.referenceData || payload.transactionData) {
      if (payload.referenceData) {
        applyReferenceData(payload.referenceData, { shouldRender: false });
      }
      if (payload.transactionData) {
        applyTransactionData(payload.transactionData, { shouldRender: false });
      }
    } else {
      setState(normalizeState({
        ...currentState,
        ...nextPayload,
        ...transactionSliceForRange(nextPayload, currentState, dateRange.currentState()),
      }));
    }
    hidePopup();
    pruneRawRowUiState();
    render();
  }

  function applyReferenceData(referenceData, { shouldRender = true } = {}) {
    setState(normalizeState({
      ...getState(),
      ...(referenceData || {}),
    }));
    if (shouldRender) {
      render();
    }
  }

  function applyTransactionData(transactionData, { shouldRender = true } = {}) {
    const currentState = getState();
    setState(normalizeState({
      ...currentState,
      dashboard: transactionData?.dashboard || null,
      activeDateRange: transactionData
        ? { startDate: transactionData.startDate, endDate: transactionData.endDate }
        : currentState.activeDateRange,
      transactions: transactionData?.realTransactions || [],
      rawRows: transactionData?.rawTransactions || [],
    }));
    pruneRawRowUiState();
    if (shouldRender) {
      render();
    }
  }

  function pruneRawRowUiState() {
    const currentState = getState();
    const visibleTransactionIds = new Set(currentState.transactions.map((transaction) => transaction.id));
    pruneMissingIds(selectedTransactionIds, visibleTransactionIds);
    const visibleRawRowIds = new Set(currentState.rawRows.map((row) => row.id));
    pruneMissingIds(selectedRawRowIds, visibleRawRowIds);
    pruneMissingMapKeys(rawRowNotes, visibleRawRowIds);
  }

  return {
    apiRequest,
    applyStateFromPayload,
    loadInitialState,
    loadReferenceData,
    loadTransactionData,
    mutationPath,
    pruneRawRowUiState,
  };
}

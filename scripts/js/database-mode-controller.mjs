export function createDatabaseModeController({
  elements,
  storageKey,
  selectedRawRowIds,
  rawRowNotes,
  rawRowsController,
  setMessage,
  reload,
  storage = localStorage,
}) {
  function initialize() {
    setDummyMode(storage.getItem(storageKey) === "true");
  }

  function update(event) {
    const isDummy = event.currentTarget.checked;
    setDummyMode(isDummy);
    selectedRawRowIds.clear();
    rawRowNotes.clear();
    rawRowsController.resetVisibleRows();
    setMessage("");
    reload();
  }

  function isUsingDummyDatabase() {
    return elements.dummyDatabaseToggle.checked;
  }

  function setDummyMode(isDummy) {
    storage.setItem(storageKey, isDummy ? "true" : "false");
    elements.dummyDatabaseToggle.checked = isDummy;
    elements.mobileDummyDatabaseToggle.checked = isDummy;
    renderLabel();
  }

  function renderLabel() {
    elements.dummyDatabaseLabel.textContent = "Database";
    elements.mobileDummyDatabaseLabel.textContent = "Database";
    const description = isUsingDummyDatabase() ? "Using dummy database" : "Using primary database";
    elements.dummyDatabaseDescription.textContent = description;
    elements.mobileDummyDatabaseDescription.textContent = description;
  }

  return {
    initialize,
    isUsingDummyDatabase,
    setDummyMode,
    update,
  };
}

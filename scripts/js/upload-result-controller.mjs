import { renderDefinitionList } from "./dom.mjs";

export function createUploadResultController({
  elements,
  openModal,
  onViewRows,
}) {
  let activeViewRowsTarget = null;

  function show(result) {
    activeViewRowsTarget = result.viewRows || null;
    const message = result.message || "";
    elements.uploadResultTitle.textContent = result.title || "Upload Complete";
    elements.uploadResultMessage.textContent = message;
    elements.uploadResultMessage.hidden = !message;
    renderDefinitionList(elements.uploadResultValues, result.details || []);
    elements.uploadResultViewRowsButton.hidden = !activeViewRowsTarget;
    openModal(elements.uploadResultDialog);
  }

  function close() {
    activeViewRowsTarget = null;
    elements.uploadResultDialog.close();
  }

  function viewRows() {
    const target = activeViewRowsTarget;
    close();
    if (target) {
      onViewRows(target);
    }
  }

  return {
    close,
    show,
    viewRows,
  };
}

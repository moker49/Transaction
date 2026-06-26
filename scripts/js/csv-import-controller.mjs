import { accountImportKeys, detectCsvLayout, parseCsv, sourceAccountKeyFromCsvRows } from "./csv.mjs";

export function createCsvImportController({
  elements,
  getAccounts,
  dataController,
  openModal,
  setMessage,
  showPopup,
}) {
  let analysisToken = 0;

  async function importCsv(event) {
    event.preventDefault();
    setMessage("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const accountId = Number(elements.importAccountSelect.value);
    const file = form.get("csvFile");
    const sourceType = "csv";

    if (!accountId || !(file instanceof File) || !file.name) {
      showPopup("Choose an account and CSV file.", "warning");
      return;
    }

    try {
      const upload = new FormData();
      upload.append("accountId", String(accountId));
      upload.append("sourceType", sourceType);
      upload.append("csvFile", file);
      const payload = await dataController.apiRequest("/api/imports/csv", {
        method: "POST",
        body: upload,
      });
      resetDialogState();
      closeDialog();
      dataController.applyStateFromPayload(payload);
      if (payload.status === "already_imported") {
        showPopup("File already imported.", "warning");
      } else {
        setMessage(`Imported ${payload.inserted_raw_row_count} raw transactions from ${file.name}.`);
      }
    } catch (error) {
      showPopup(error.message || "CSV import failed.", "error");
    }
  }

  function openDialog() {
    setMessage("");
    resetDialogState();
    openModal(elements.importDialog);
  }

  function closeDialog() {
    elements.importDialog.close();
  }

  function updateFileName() {
    const file = elements.importCsvFileInput.files?.[0];
    elements.importFileName.textContent = file?.name || "Choose file";
    elements.importFileDropZone.classList.toggle("has-file", Boolean(file));
  }

  function handleFileChange() {
    updateFileName();
    setAccountLocked(false);
    analyzeFileAccount();
  }

  function resetDialogState() {
    analysisToken += 1;
    elements.importForm.reset();
    setAccountLocked(false);
    updateFileName();
  }

  function setAccountLocked(locked) {
    elements.importAccountSelect.disabled = locked;
    elements.importAccountSelect.classList.toggle("is-locked-in", locked);
  }

  async function analyzeFileAccount() {
    const file = elements.importCsvFileInput.files?.[0];
    const token = (analysisToken += 1);
    if (!file) {
      return;
    }

    try {
      const parsed = parseCsv(await file.text());
      if (token !== analysisToken) {
        return;
      }
      if (detectCsvLayout(parsed.headers) !== "normalized_statement_export") {
        return;
      }
      const sourceAccountKey = sourceAccountKeyFromCsvRows(parsed.rows);
      if (!sourceAccountKey) {
        setAccountLocked(false);
        showPopup("CSV file does not include an account key.", "error");
        return;
      }
      const account = getAccounts().find((candidate) => {
        return accountImportKeys(candidate).includes(sourceAccountKey);
      });
      if (!account) {
        elements.importAccountSelect.value = "";
        setAccountLocked(false);
        showPopup(`No account matches CSV account "${sourceAccountKey}".`, "error");
        return;
      }
      elements.importAccountSelect.value = String(account.id);
      setAccountLocked(true);
    } catch (error) {
      if (token === analysisToken) {
        setAccountLocked(false);
        showPopup(error.message || "Could not inspect CSV file.", "error");
      }
    }
  }

  function handleFileDrag(event) {
    event.preventDefault();
    elements.importFileDropZone.classList.toggle("is-dragging", event.type === "dragover");
  }

  function handleFileDrop(event) {
    event.preventDefault();
    elements.importFileDropZone.classList.remove("is-dragging");
    const file = [...event.dataTransfer.files].find((candidate) => {
      return candidate.type === "text/csv" || candidate.name.toLowerCase().endsWith(".csv");
    });
    if (!file) {
      showPopup("Choose a CSV file.", "warning");
      return;
    }
    const files = new DataTransfer();
    files.items.add(file);
    elements.importCsvFileInput.files = files.files;
    handleFileChange();
  }

  return {
    closeDialog,
    handleFileChange,
    handleFileDrag,
    handleFileDrop,
    importCsv,
    openDialog,
  };
}

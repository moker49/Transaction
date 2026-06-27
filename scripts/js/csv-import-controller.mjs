import { accountImportKeys, detectCsvLayout, parseCsv, sourceAccountKeyFromCsvRows } from "./csv.mjs";

export function createCsvImportController({
  elements,
  getAccounts,
  dataController,
  openModal,
  setMessage,
  setModalMessage,
  showPopup,
}) {
  let analysisToken = 0;

  async function importFile(event) {
    event.preventDefault();
    setMessage("");
    setModalMessage(elements.importMessage, "");

    const files = [...(elements.importCsvFileInput.files || [])];
    const uploadMode = selectedUploadMode(files);
    if (uploadMode === "empty") {
      showPopup("Choose a CSV or PDF file.", "warning");
      return;
    }
    if (uploadMode === "mixed") {
      showPopup("Choose either one CSV file or one or more PDF files.", "warning");
      return;
    }
    if (uploadMode === "csv") {
      await importCsv(files[0]);
      return;
    }
    await importPdf(files);
  }

  async function importCsv(file) {
    const accountId = Number(elements.importAccountSelect.value);
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

  async function importPdf(files) {
    try {
      const upload = new FormData();
      files.forEach((file) => upload.append("pdfFiles", file));
      const payload = await dataController.apiRequest("/api/imports/pdf", {
        method: "POST",
        body: upload,
      });
      resetDialogState();
      closeDialog();
      dataController.applyStateFromPayload(payload);
      const insertedCount = payload.inserted_raw_row_count || 0;
      const duplicateCount = payload.already_imported_sources?.length || 0;
      if (insertedCount) {
        showPopup(`Imported ${insertedCount} raw transactions from PDF.`, "success");
      } else if (duplicateCount) {
        showPopup("PDF file already imported.", "warning");
      } else {
        showPopup("No PDF rows were imported.", "warning");
      }
    } catch (error) {
      setModalMessage(elements.importMessage, error.message || "PDF import failed.", true);
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
    const files = [...(elements.importCsvFileInput.files || [])];
    elements.importFileName.textContent = fileLabel(files);
    elements.importFileDropZone.classList.toggle("has-file", files.length > 0);
    updateAccountVisibility(files);
  }

  function handleFileChange() {
    setAccountLocked(false);
    updateFileName();
    analyzeSelectedFilesAccount();
  }

  function resetDialogState() {
    analysisToken += 1;
    elements.importForm.reset();
    setAccountLocked(false);
    setModalMessage(elements.importMessage, "");
    updateFileName();
  }

  function setAccountLocked(locked) {
    elements.importAccountSelect.disabled = locked;
    elements.importAccountSelect.classList.toggle("is-locked-in", locked);
  }

  async function analyzeSelectedFilesAccount() {
    const files = [...(elements.importCsvFileInput.files || [])];
    const token = (analysisToken += 1);
    const uploadMode = selectedUploadMode(files);
    if (uploadMode === "csv") {
      await analyzeCsvFileAccount(files[0], token);
      return;
    }
    if (uploadMode === "pdf") {
      await analyzePdfFileAccount(files, token);
    }
  }

  async function analyzeCsvFileAccount(file, token) {
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

  async function analyzePdfFileAccount(files, token) {
    try {
      const upload = new FormData();
      files.forEach((file) => upload.append("pdfFiles", file));
      const payload = await dataController.apiRequest("/api/imports/pdf/analyze", {
        method: "POST",
        body: upload,
      });
      if (token !== analysisToken) {
        return;
      }
      const accounts = payload.accounts || [];
      if (accounts.length === 1) {
        elements.importAccountSelect.value = String(accounts[0].id);
        setAccountLocked(true);
        return;
      }
      elements.importAccountSelect.value = "";
      setAccountLocked(false);
      if (accounts.length > 1) {
        setModalMessage(elements.importMessage, "Multiple PDF accounts detected; the parser will import each file to its matched account.");
      }
    } catch (error) {
      if (token === analysisToken) {
        elements.importAccountSelect.value = "";
        setAccountLocked(false);
        setModalMessage(elements.importMessage, error.message || "Could not inspect PDF file.", true);
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
    const acceptedFiles = [...event.dataTransfer.files].filter((candidate) => {
      return isCsvFile(candidate) || isPdfFile(candidate);
    });
    if (!acceptedFiles.length) {
      showPopup("Choose a CSV or PDF file.", "warning");
      return;
    }
    const files = new DataTransfer();
    acceptedFiles.forEach((file) => files.items.add(file));
    elements.importCsvFileInput.files = files.files;
    handleFileChange();
  }

  function updateAccountVisibility(files) {
    const uploadMode = selectedUploadMode(files);
    const showAccount = uploadMode === "csv" || uploadMode === "pdf" || uploadMode === "empty";
    const requireAccount = uploadMode === "csv" || uploadMode === "empty";
    elements.importAccountField.hidden = !showAccount;
    elements.importAccountSelect.disabled = !showAccount;
    elements.importAccountSelect.required = requireAccount;
    if (!showAccount) {
      elements.importAccountSelect.value = "";
      elements.importAccountSelect.classList.remove("is-locked-in");
    }
  }

  function selectedUploadMode(files) {
    if (!files.length) {
      return "empty";
    }
    const csvFiles = files.filter(isCsvFile);
    const pdfFiles = files.filter(isPdfFile);
    if (csvFiles.length === 1 && pdfFiles.length === 0 && files.length === 1) {
      return "csv";
    }
    if (pdfFiles.length === files.length) {
      return "pdf";
    }
    return "mixed";
  }

  function isCsvFile(file) {
    return file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv");
  }

  function isPdfFile(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  }

  function fileLabel(files) {
    if (!files.length) {
      return "Choose file";
    }
    if (files.length === 1) {
      return files[0].name;
    }
    return `${files.length} files selected`;
  }

  return {
    closeDialog,
    handleFileChange,
    handleFileDrag,
    handleFileDrop,
    importFile,
    openDialog,
  };
}

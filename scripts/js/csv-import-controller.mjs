import { accountImportKeys, detectCsvLayout, parseCsv, sourceAccountKeyFromCsvRows } from "./csv.mjs";

export function createCsvImportController({
  elements,
  getAccounts,
  dataController,
  openModal,
  setMessage,
  setModalMessage,
  showPopup,
  showUploadResult = () => { },
}) {
  const syntheticPdfAccountValue = "__pdf_multi_account_upload__";
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

    setUploadBusy(true);
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
      showUploadResult(csvUploadResult(payload, file));
    } catch (error) {
      showPopup(error.message || "CSV import failed.", "error");
    } finally {
      setUploadBusy(false);
    }
  }

  async function importPdf(files) {
    setUploadBusy(true);
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
      showUploadResult(pdfUploadResult(payload, files));
    } catch (error) {
      setModalMessage(elements.importMessage, error.message || "PDF import failed.", true);
    } finally {
      setUploadBusy(false);
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
    setModalMessage(elements.importMessage, "");
    setAccountLocked(false);
    updateFileName();
    analyzeSelectedFilesAccount();
  }

  function resetDialogState() {
    analysisToken += 1;
    elements.importForm.reset();
    setAccountLocked(false);
    clearSyntheticAccountOption();
    setModalMessage(elements.importMessage, "");
    updateFileName();
  }

  function setAccountLocked(locked) {
    elements.importAccountSelect.disabled = locked;
    elements.importAccountSelect.classList.toggle("is-locked-in", locked);
  }

  function setSyntheticLockedAccount(label) {
    clearSyntheticAccountOption();
    const option = document.createElement("option");
    option.value = syntheticPdfAccountValue;
    option.textContent = label;
    option.dataset.syntheticPdfAccount = "true";
    elements.importAccountSelect.appendChild(option);
    elements.importAccountSelect.value = syntheticPdfAccountValue;
    setAccountLocked(true);
  }

  function clearSyntheticAccountOption() {
    elements.importAccountSelect.querySelectorAll("option[data-synthetic-pdf-account='true']").forEach((option) => {
      option.remove();
    });
    if (elements.importAccountSelect.value === syntheticPdfAccountValue) {
      elements.importAccountSelect.value = "";
    }
  }

  function setUploadBusy(isBusy) {
    elements.importForm.setAttribute("aria-busy", isBusy ? "true" : "false");
    elements.importSubmitButton.disabled = isBusy;
    elements.importSubmitButton.textContent = isBusy ? "Uploading..." : "Upload";
  }

  function csvUploadResult(payload, file) {
    const insertedCount = payload.inserted_raw_row_count || 0;
    const source = payload.imported_source || null;
    return {
      title: insertedCount ? "Upload Complete" : "File Already Imported",
      message: insertedCount
        ? ""
        : `${file.name} was already imported.`,
      details: [
        ["Account", payload.account?.name || ""],
        ["Rows inserted", insertedCount],
        ["File", file.name],
      ],
      viewRows: source ? {
        accountId: source.account_id,
        status: insertedCount ? "new" : "all",
      } : null,
    };
  }

  function pdfUploadResult(payload, files) {
    const insertedCount = payload.inserted_raw_row_count || 0;
    const importedSources = payload.imported_sources || [];
    const alreadyImportedSources = payload.already_imported_sources || [];
    const allSources = [...importedSources, ...alreadyImportedSources];
    const viewRowSources = importedSources.length ? importedSources : alreadyImportedSources;
    const accountIds = uniqueAccountIds(viewRowSources);
    const duplicateCount = alreadyImportedSources.length;
    return {
      title: insertedCount ? "Upload Complete" : duplicateCount ? "PDF Already Imported" : "No Rows Imported",
      message: pdfUploadResultMessage(insertedCount, duplicateCount),
      details: compactDetails([
        accountNamesDetail(allSources),
        ["Rows inserted", insertedCount],
        ["Already imported", duplicateCount],
        fileCountDetail(files),
      ]),
      viewRows: viewRowSources.length ? {
        accountId: accountIds.length === 1 ? accountIds[0] : null,
        status: insertedCount ? "new" : "all",
      } : null,
    };
  }

  function pdfUploadResultMessage(insertedCount, duplicateCount) {
    if (insertedCount) {
      return "";
    }
    if (duplicateCount) {
      return "";
    }
    return "No PDF rows were imported.";
  }

  function uniqueAccountIds(sources) {
    return [...new Set(sources
      .map((source) => Number(source.account_id))
      .filter((accountId) => Number.isFinite(accountId)))];
  }

  function accountNamesDetail(sources) {
    const accountNames = uniqueAccountIds(sources)
      .map((accountId) => getAccounts().find((account) => Number(account.id) === accountId)?.name)
      .filter(Boolean);
    return accountNames.length ? ["Accounts", accountNames.join(", ")] : null;
  }

  function fileCountDetail(files) {
    return files.length === 1 ? ["File", files[0].name] : ["Files", files.length];
  }

  function compactDetails(details) {
    return details.filter(Boolean);
  }

  async function analyzeSelectedFilesAccount() {
    const files = [...(elements.importCsvFileInput.files || [])];
    const token = (analysisToken += 1);
    const uploadMode = selectedUploadMode(files);
    clearSyntheticAccountOption();
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
      if (accounts.length > 1) {
        setSyntheticLockedAccount(payload.display_label || "Multiple Accounts");
        setModalMessage(elements.importMessage, pdfAccountListLabel(accounts));
        return;
      }
      elements.importAccountSelect.value = "";
      setAccountLocked(false);
    } catch (error) {
      if (token === analysisToken) {
        elements.importAccountSelect.value = "";
        setAccountLocked(false);
        setModalMessage(elements.importMessage, error.message || "Could not inspect PDF file.", true);
      }
    }
  }

  function pdfAccountListLabel(accounts) {
    return accounts
      .map((account) => account.name || [account.institution, account.account_type].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(", ");
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
      clearSyntheticAccountOption();
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

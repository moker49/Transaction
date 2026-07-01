export function createKeyboardShortcuts({
  getActiveViewName,
  appMessage,
  submitFormIds,
}) {
  function handle(event) {
    if (event.defaultPrevented) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      submitOpenEditableModal(event);
      return;
    }
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextEntryTarget(event.target)) {
      focusActiveSearch(event);
    }
  }

  function focusActiveSearch(event) {
    const search = activeViewSearchField();
    if (!search || search.disabled || search.hidden) {
      return;
    }
    event.preventDefault();
    search.focus();
    search.select();
  }

  function activeViewSearchField() {
    const activeView = document.getElementById(`${getActiveViewName()}View`);
    return activeView?.querySelector("input[type='search']");
  }

  function submitOpenEditableModal(event) {
    const dialog = openTopDialog();
    const form = dialog?.querySelector("form");
    if (!form || !submitFormIds.has(form.id)) {
      return;
    }
    const submitter = form.querySelector("button[type='submit'], input[type='submit']");
    if (submitter?.disabled) {
      return;
    }
    event.preventDefault();
    form.requestSubmit(submitter || undefined);
  }

  function openTopDialog() {
    const dialogs = [...document.querySelectorAll("dialog[open]")].filter((dialog) => dialog !== appMessage);
    return dialogs[dialogs.length - 1] || null;
  }

  function isTextEntryTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  return {
    handle,
  };
}

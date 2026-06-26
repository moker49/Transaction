import { clean } from "./common.mjs";
import { appendEmpty, clear, el, materialIcon } from "./dom.mjs";
import { destructiveMessage } from "./labels.mjs";

export function createTagsController({
  elements,
  getTags,
  dataController,
  promptForText,
  closeTextInputDialog,
  confirmDestructive,
  showPopup,
  onBulkImportTagsChange,
  onBulkEditTagsChange,
}) {
  async function addTag() {
    const name = await promptForText({
      title: "Create Tag",
      label: "Tag name",
      value: "",
    });
    if (!name) {
      return;
    }
    try {
      const payload = await dataController.apiRequest("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      dataController.applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not add tag.", "error");
    }
  }

  async function editTag(tag) {
    const name = await promptForText({
      title: "Edit Tag",
      label: "Tag name",
      value: tag.name,
      deleteLabel: "Delete",
      onDelete: async () => {
        if (await deleteTag(tag)) {
          closeTextInputDialog(null);
        }
      },
    });
    if (name === null || clean(name) === clean(tag.name)) {
      return;
    }
    try {
      const payload = await dataController.apiRequest(`/api/tags/${tag.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: clean(name) }),
      });
      dataController.applyStateFromPayload(payload);
    } catch (error) {
      showPopup(error.message || "Could not update tag.", "error");
    }
  }

  async function deleteTag(tag) {
    const confirmed = await confirmDestructive({
      title: "Delete Tag",
      message: destructiveMessage(`Delete tag "${tag.name}"?`),
      actionLabel: "Delete Tag",
    });
    if (!confirmed) {
      return false;
    }
    try {
      const payload = await dataController.apiRequest(`/api/tags/${tag.id}`, { method: "DELETE" });
      dataController.applyStateFromPayload(payload);
      return true;
    } catch (error) {
      showPopup(error.message || "Could not delete tag.", "error");
      return false;
    }
  }

  function renderTags() {
    const tagList = document.querySelector("#tagList");
    clear(tagList);
    if (!getTags().length) {
      appendEmpty(tagList);
      return;
    }
    getTags().forEach((tag) => {
      if (tag.is_protected) {
        tagList.appendChild(staticTagChip(tag.name));
      } else {
        tagList.appendChild(editableTagChip(tag, () => editTag(tag)));
      }
    });
  }

  function renderRuleTags(selectedTagIds) {
    renderSelectableTags(elements.ruleTags, selectedTagIds, "addTagIds");
  }

  function renderManualImportTags(selectedTagIds) {
    renderSelectableTags(elements.manualImportTags, selectedTagIds, "tagIds");
  }

  function renderBulkImportTags(selectedTagIds) {
    renderSelectableTags(elements.bulkImportTags, selectedTagIds, "tagIds");
    elements.bulkImportTags.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", onBulkImportTagsChange);
    });
  }

  function renderBulkEditTags(selectedTagIds) {
    renderSelectableTags(elements.bulkEditTags, selectedTagIds, "tagIds");
    elements.bulkEditTags.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", onBulkEditTagsChange);
    });
  }

  function renderSelectableTags(container, selectedTagIds, inputName) {
    clear(container);
    const selected = new Set(selectedTagIds.map((tagId) => Number(tagId)));
    if (!getTags().length) {
      container.appendChild(el("span", "No tags available.", "list-meta"));
      return;
    }
    getTags().forEach((tag) => {
      container.appendChild(selectableTagChip(tag, selected.has(Number(tag.id)), inputName));
    });
  }

  function staticTagChip(label) {
    return el("span", label, "tag-chip tag-chip-filled");
  }

  function editableTagChip(tag, onEdit) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip tag-chip-filled tag-chip-action";
    button.append(materialIcon("edit"), el("span", tag.name));
    button.addEventListener("click", onEdit);
    return button;
  }

  function selectableTagChip(tag, isSelected, inputName) {
    const label = document.createElement("label");
    label.className = `tag-chip tag-chip-select${isSelected ? " is-selected" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = inputName;
    checkbox.value = String(tag.id);
    checkbox.checked = isSelected;
    const icon = materialIcon("check");
    icon.classList.add("tag-chip-check");
    label.append(checkbox, icon, el("span", tag.name));
    checkbox.addEventListener("change", () => {
      label.classList.toggle("is-selected", checkbox.checked);
    });
    return label;
  }

  return {
    addTag,
    renderBulkEditTags,
    renderBulkImportTags,
    renderManualImportTags,
    renderRuleTags,
    renderTags,
    selectableTagChip,
    staticTagChip,
  };
}

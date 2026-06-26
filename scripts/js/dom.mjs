import { formatDisplayDate } from "./format.mjs";

export function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

export function clear(node) {
  node.replaceChildren();
}

export function appendEmpty(node) {
  node.appendChild(document.querySelector("#emptyTemplate").content.firstElementChild.cloneNode(true));
}

export function fillSelect(select, options, emptyLabel) {
  const currentValue = select.value;
  clear(select);

  if (emptyLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
  }

  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  if ([...select.options].some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

export function renderDefinitionList(list, items) {
  clear(list);
  items.forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value === null || value === undefined || value === "" ? "-" : String(value);
    list.append(term, detail);
  });
}

export function tableRow(values) {
  const tr = document.createElement("tr");
  values.forEach((value) => tr.appendChild(cell(value)));
  return tr;
}

export function makeEditableRow(row, label, handler) {
  row.classList.add("clickable-row");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", label);
  row.addEventListener("click", handler);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  });
}

export function emptyTableRow(colspan) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colspan;
  td.appendChild(document.querySelector("#emptyTemplate").content.firstElementChild.cloneNode(true));
  tr.appendChild(td);
  return tr;
}

export function cell(content, className) {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  if (content instanceof Node) {
    td.appendChild(content);
  } else {
    td.textContent = content;
  }
  return td;
}

export function materialIcon(name) {
  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = name;
  return icon;
}

export function actionButtons(actions) {
  const wrapper = document.createElement("div");
  wrapper.className = "action-row";
  actions.forEach(([icon, label, handler]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = icon === "close" ? "icon-only danger" : "icon-only";
    button.title = label;
    button.setAttribute("aria-label", label);
    const symbol = document.createElement("span");
    symbol.className = "material-symbols-outlined";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = icon;
    button.appendChild(symbol);
    button.addEventListener("click", handler);
    wrapper.appendChild(button);
  });
  return wrapper;
}

export function manageableChip(label, onEdit, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `chip manageable-chip${extraClass ? ` ${extraClass}` : ""}`;
  button.setAttribute("aria-label", `Edit ${label}`);
  button.append(materialIcon("edit"), el("span", label));
  button.addEventListener("click", onEdit);
  return button;
}

export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  node.textContent = text;
  return node;
}

export function displayDateCell(value) {
  const formatted = formatDisplayDate(value);
  if (formatted === "-" || !/^\d{2}-\d{2}-\d{4}$/.test(formatted)) {
    return formatted;
  }
  const wrapper = document.createElement("span");
  wrapper.className = "date-stack";
  wrapper.append(
    el("span", formatted.slice(0, 5)),
    el("span", formatted.slice(6)),
  );
  return wrapper;
}

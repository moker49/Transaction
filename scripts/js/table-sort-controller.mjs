export function createTableSortController({ tableSortState, render, onSortChange = () => {} }) {
  function initialize() {
    document.querySelectorAll("th[data-sort-table][data-sort-key]").forEach((header) => {
      header.classList.add("sortable-header");
      header.tabIndex = 0;
      header.setAttribute("role", "button");
      header.addEventListener("click", () => setTableSort(header));
      header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setTableSort(header);
        }
      });
    });
    updateHeaders();
  }

  function setTableSort(header) {
    const table = header.dataset.sortTable;
    const key = header.dataset.sortKey;
    const type = header.dataset.sortType || "text";
    const current = tableSortState[table];
    const defaultDirection = type === "text" ? "asc" : "desc";
    tableSortState[table] = {
      key,
      type,
      direction: current?.key === key && current.direction === defaultDirection
        ? oppositeSortDirection(defaultDirection)
        : defaultDirection,
    };
    updateHeaders();
    onSortChange(tableSortState);
    render();
  }

  function updateHeaders() {
    document.querySelectorAll("th[data-sort-table][data-sort-key]").forEach((header) => {
      const state = tableSortState[header.dataset.sortTable];
      const isActive = state?.key === header.dataset.sortKey;
      header.classList.toggle("is-sorted", isActive);
      header.dataset.sortDirection = isActive ? state.direction : "";
      header.setAttribute("aria-sort", isActive
        ? (state.direction === "asc" ? "ascending" : "descending")
        : "none");
    });
  }

  function oppositeSortDirection(direction) {
    return direction === "asc" ? "desc" : "asc";
  }

  return {
    initialize,
    updateHeaders,
  };
}

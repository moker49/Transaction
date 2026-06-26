import { clear, el } from "./dom.mjs";
import { formatDollars } from "./format.mjs";

export function renderPieChart(chart, legend, rawSegments, options = {}) {
  const segments = rawSegments.filter((segment) => segment.value > 0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  clear(legend);
  if (total <= 0) {
    chart.style.background = "var(--surface-muted)";
    legend.appendChild(el("span", "No data", "list-meta"));
    return;
  }
  let cursor = 0;
  const stops = segments.map((segment) => {
    const start = cursor;
    cursor += (segment.value / total) * 100;
    return `${segment.color} ${start}% ${cursor}%`;
  });
  chart.style.background = `conic-gradient(${stops.join(", ")})`;
  renderChartLegend(legend, segments, total);
  if (options.animate) {
    animatePieChartToggle(chart, legend);
  }
}

export function animatePieChartToggle(chart, legend) {
  const frame = chart.closest(".pie-chart-frame");
  [frame, legend].forEach((element) => {
    if (!element) {
      return;
    }
    element.classList.remove("is-pie-toggle-animating");
    void element.offsetWidth;
    element.classList.add("is-pie-toggle-animating");
    element.addEventListener("animationend", () => {
      element.classList.remove("is-pie-toggle-animating");
    }, { once: true });
  });
}

export function renderStackedBar(bar, legend, rawSegments) {
  const segments = rawSegments.filter((segment) => segment.value > 0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  clear(bar);
  clear(legend);
  if (total <= 0) {
    bar.appendChild(el("span", "", "stacked-bar-empty"));
    legend.appendChild(el("span", "No data", "list-meta"));
    return;
  }
  segments.forEach((segment) => {
    const piece = document.createElement("span");
    piece.className = "stacked-bar-segment";
    piece.style.width = `${(segment.value / total) * 100}%`;
    piece.style.background = segment.color;
    piece.title = `${segment.label}: ${formatDollars(segment.value)}`;
    bar.appendChild(piece);
  });
  renderChartLegend(legend, segments, total);
}

export function renderChartLegend(legend, segments, total) {
  segments.forEach((segment) => {
    const item = document.createElement("div");
    item.className = "chart-legend-item";
    const swatch = document.createElement("span");
    swatch.className = "chart-legend-swatch";
    swatch.style.background = segment.color;
    const label = document.createElement("span");
    label.className = "chart-legend-label";
    label.append(
      el("span", segment.label),
      el("strong", `${Math.round((segment.value / total) * 100)}%`),
    );
    item.append(
      swatch,
      label,
    );
    legend.appendChild(item);
  });
}

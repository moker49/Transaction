import { clean } from "./common.mjs";

export function randomComfortableColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 20 + Math.floor(Math.random() * 50);
  const lightness = 20 + Math.floor(Math.random() * 50);
  return hslToHex(hue, saturation, lightness);
}

export function normalizeHexColor(value) {
  const raw = clean(value).replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw.split("").map((char) => `${char}${char}`).join("").toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return null;
}

export function hexToHsl(hex) {
  const normalized = normalizeHexColor(hex);
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: lightness * 100 };
  }
  const delta = max - min;
  const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
  let hue;
  if (max === r) {
    hue = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    hue = 60 * (((b - r) / delta) + 2);
  } else {
    hue = 60 * (((r - g) / delta) + 4);
  }
  return {
    h: (hue + 360) % 360,
    s: saturation * 100,
    l: lightness * 100,
  };
}

export function hslToHex(hue, saturation, lightness) {
  const h = (((Number(hue) || 0) % 360) + 360) % 360;
  const s = clamp(Number(saturation) || 0, 0, 100) / 100;
  const l = clamp(Number(lightness) || 0, 0, 100) / 100;
  const chroma = (1 - Math.abs((2 * l) - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = l - (chroma / 2);
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = chroma;
    g = x;
  } else if (h < 120) {
    r = x;
    g = chroma;
  } else if (h < 180) {
    g = chroma;
    b = x;
  } else if (h < 240) {
    g = x;
    b = chroma;
  } else if (h < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  return `#${[r, g, b].map((channel) => {
    return Math.round((channel + match) * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


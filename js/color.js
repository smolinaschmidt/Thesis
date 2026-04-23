/**
 * Shared color utilities + the 7 color groups used across the site.
 * Pure functions, no DOM.
 */

export const COLOR_GROUPS = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Neutral"];

export const COLOR_MAP = {
  Red: "#d9423a",
  Orange: "#f17a32",
  Yellow: "#f2cc4d",
  Green: "#67b46f",
  Blue: "#4a7fd8",
  Purple: "#8a68d8",
  Neutral: "#9a9a9a",
};

export function hexToRgb(hex) {
  if (!hex || hex.length !== 7) return [120, 120, 120];
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function classifyColor(hex) {
  const [rr, gg, bb] = hexToRgb(hex);
  const r = rr / 255;
  const g = gg / 255;
  const b = bb / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const light = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  const deg = (hue * 60 + 360) % 360;
  if (sat < 0.18 || light < 0.14 || light > 0.88) return "Neutral";
  if (deg < 18 || deg >= 345) return "Red";
  if (deg < 45) return "Orange";
  if (deg < 70) return "Yellow";
  if (deg < 165) return "Green";
  if (deg < 255) return "Blue";
  return "Purple";
}

export function brightness(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) * 100;
}

export function shade(hex, pct) {
  const [r, g, b] = hexToRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct) / 100;
  const mix = (c) => Math.round((t - c) * p + c);
  const toHex = (c) => c.toString(16).padStart(2, "0");
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

export function posterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

/**
 * Tiny DOM helper — creates an element with attributes, classes, and children.
 * Keeps render functions declarative without a framework.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

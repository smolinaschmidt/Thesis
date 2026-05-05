/**
 * Single shared tooltip attached to #tooltip in index.html.
 * One DOM node for every hover across the whole site.
 */

function getNode() {
  return document.getElementById("tooltip");
}

export function showTooltip(event, html, options = {}) {
  const node = getNode();
  if (!node) return;
  node.innerHTML = html;
  node.classList.toggle("tooltip--film", Boolean(options.film));
  if (options.accent) node.style.setProperty("--tooltip-accent", String(options.accent));
  else node.style.removeProperty("--tooltip-accent");
  node.classList.add("is-visible");
  moveTooltip(event);
}

export function moveTooltip(event) {
  const node = getNode();
  if (!node) return;
  node.style.left = `${event.clientX}px`;
  node.style.top = `${event.clientY}px`;
}

export function hideTooltip() {
  const node = getNode();
  if (!node) return;
  node.classList.remove("is-visible", "tooltip--film");
}

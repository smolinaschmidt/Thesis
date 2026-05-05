import { el, clear, posterUrl, classifyColor, brightness } from "./color.js";
import { loadMediaColors, rgbToHex } from "./case-study.js";
import { showTooltip, moveTooltip, hideTooltip } from "./tooltip.js";

const GRID_ROWS = 8;
const GRID_COLS = 5;

const SLOPE_FAMILY_IDS = new Set(["FAM0003", "FAM0018"]); // (legacy) previously limited slope chart; now shown for all

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function smoothstep01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pickInitialCentroids(points, k) {
  const sorted = [...points].sort((a, b) => luminance(b) - luminance(a));
  const out = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.min(sorted.length - 1, Math.floor(((i + 0.5) * sorted.length) / k));
    out.push([...sorted[idx]]);
  }
  return out;
}

/** k-means on RGB points; returns centroids sorted by cluster size (largest first). */
function kMeansRgbs(points, k, maxIter = 40) {
  if (!points.length || k <= 0) return [];
  if (k === 1) {
    const s = points.reduce(
      (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
      [0, 0, 0]
    );
    const n = points.length;
    return [[Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)]];
  }

  let centroids = pickInitialCentroids(points, k);
  const assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const d = dist(points[i], centroids[j]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const a = assignments[i];
      sums[a][0] += points[i][0];
      sums[a][1] += points[i][1];
      sums[a][2] += points[i][2];
      sums[a][3] += 1;
    }

    let moved = false;
    for (let j = 0; j < k; j++) {
      const n = sums[j][3];
      if (n === 0) {
        centroids[j] = [...points[iter % points.length]];
        moved = true;
        continue;
      }
      const nc = [
        Math.round(sums[j][0] / n),
        Math.round(sums[j][1] / n),
        Math.round(sums[j][2] / n),
      ];
      if (dist(nc, centroids[j]) > 0.5) moved = true;
      centroids[j] = nc;
    }
    if (!changed && !moved) break;
  }

  const counts = Array(k).fill(0);
  for (const a of assignments) counts[a] += 1;
  const order = counts
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c - a.c)
    .map((x) => x.i);
  return order.map((i) => centroids[i]);
}

function sliceGrid58(posterGrid) {
  if (!posterGrid?.length || !posterGrid[0]?.length) return null;
  const slice = posterGrid.slice(0, GRID_ROWS);
  if (slice.some((row) => row.length < GRID_COLS)) return null;
  return slice.map((row) => row.slice(0, GRID_COLS).map((c) => [...c]));
}

function flatPointsFromGrid(grid58) {
  return grid58.flat();
}

function fallbackRgb(movie) {
  const rgb = movie?.dominantRgb;
  if (Array.isArray(rgb) && rgb.length >= 3) return [rgb[0], rgb[1], rgb[2]];
  const hex = movie?.dominantHex || "#888888";
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [136, 136, 136];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function renderPoster58Grid(grid58, fallbackHex) {
  const wrap = el("div", { class: "pa-grid-58" });
  if (grid58) {
    grid58.flat().forEach((rgb) => {
      const hex = rgbToHex(rgb);
      wrap.append(
        el("span", {
          class: "pa-swatch pa-swatch--cell",
          style: { background: hex },
          title: hex,
        })
      );
    });
  } else {
    for (let i = 0; i < GRID_ROWS * GRID_COLS; i++) {
      wrap.append(
        el("span", {
          class: "pa-swatch pa-swatch--cell",
          style: { background: fallbackHex },
          title: fallbackHex,
        })
      );
    }
    wrap.classList.add("is-fallback");
  }
  return wrap;
}

function renderDominant4(hexes) {
  const box = el("div", { class: "pa-dom pa-dom--4" });
  hexes.slice(0, 4).forEach((h) => {
    box.append(
      el("span", { class: "pa-swatch", style: { background: h }, title: h })
    );
  });
  while (box.children.length < 4) {
    box.append(el("span", { class: "pa-swatch is-empty" }));
  }
  return box;
}

function renderDominant2(hexes) {
  const box = el("div", { class: "pa-dom pa-dom--2" });
  hexes.slice(0, 2).forEach((h) => {
    box.append(
      el("span", { class: "pa-swatch", style: { background: h }, title: h })
    );
  });
  while (box.children.length < 2) {
    box.append(el("span", { class: "pa-swatch is-empty" }));
  }
  return box;
}

function renderDominant1(hex) {
  const safeHex = hex || "#888888";
  const group = classifyColor(safeHex);
  const cap = el("div", { class: "pa-dom1-cap" },
    el("span", { class: "pa-dom1-cap__hex" }, safeHex.toUpperCase()),
    el("span", { class: "pa-dom1-cap__group" }, group)
  );
  const bar = el("div", { class: "pa-dom pa-dom--1" },
    el("span", {
      class: "pa-swatch pa-swatch--hero",
      style: { background: safeHex },
      title: `${safeHex} · ${group}`,
    })
  );
  return el("div", { class: "pa-dom1-wrap" }, cap, bar);
}

function stageCard(label, hint, bodyEl) {
  return el(
    "div",
    { class: "pa-stage-card", role: "group", "aria-label": label },
    el(
      "div",
      { class: "pa-stage-card__cap" },
      el("span", { class: "pa-stage-card__label" }, label),
      hint
        ? el("span", { class: "pa-stage-card__hint" }, hint)
        : null
    ),
    el("div", { class: "pa-stage-card__body" }, bodyEl)
  );
}

function filmRoleLabel(index, total) {
  if (total <= 1) return "Film";
  if (total === 2) return index === 0 ? "Original" : "Remake";
  if (index === 0) return "Original";
  if (index === total - 1) return "Latest remake";
  return `Remake ${index}`;
}

function plural(n, one, many) {
  const k = Number(n) || 0;
  return k === 1 ? one : many;
}

function renderFamilyScrolly(family, moviesSorted) {
  const track = el("div", {
    class: "pa-scrolly-track",
    "data-count": String((moviesSorted || []).length || 0),
  });
  const sticky = el("div", { class: "pa-scrolly-sticky" });
  const stages = el("div", { class: "pa-scrolly-stages" });

  const posterStage = el("div", { class: "pa-stage pa-stage--poster" });
  const gridStage = el("div", { class: "pa-stage pa-stage--grid" });
  const tonesStage = el("div", { class: "pa-stage pa-stage--tones" });
  const finalStage = el("div", { class: "pa-stage pa-stage--final" });

  const makeGrid = (cls) => el("div", { class: `pa-stage-grid ${cls || ""}`.trim() });
  const gridPoster = makeGrid("pa-stage-grid--poster");
  const grid58 = makeGrid("pa-stage-grid--58");
  const grid4 = makeGrid("pa-stage-grid--4");
  const gridFinal = makeGrid("pa-stage-grid--final");

  function posterBox(node) {
    return el("div", { class: "pa-box pa-box--poster" }, node);
  }
  function gridBox(node) {
    return el("div", { class: "pa-box pa-box--grid" }, node);
  }
  function quadBox(hexes) {
    const wrap = el("div", { class: "pa-box pa-box--quad" });
    // 4 tones fill the same poster-sized box (2×2)
    const quad = el("div", { class: "pa-quad" });
    hexes.slice(0, 4).forEach((h) => quad.append(el("span", { style: { background: h } })));
    while (quad.children.length < 4) quad.append(el("span", { style: { background: "#ddd" } }));
    wrap.append(quad);
    return wrap;
  }
  function finalBar(hex) {
    const c = hex || "#888888";
    // Use style attribute string so CSS custom prop is applied reliably.
    return el("div", { class: "pa-final-bar", style: `--c:${c}` });
  }

  moviesSorted.forEach((movie, i) => {
    const url = posterUrl(movie.posterPath);
    const fallbackHex = movie.dominantHex || rgbToHex(fallbackRgb(movie)) || "#888888";

    const posterEl = url
      ? el("img", {
          class: "pa-poster-img",
          src: url,
          alt: movie.title || "Poster",
          loading: "lazy",
        })
      : el("div", { class: "pa-poster-img ph", style: { background: fallbackHex } });
    gridPoster.append(posterBox(posterEl));

    const gridWrap = gridBox(renderPoster58Grid(null, fallbackHex));
    grid58.append(gridWrap);

    const quadWrap = quadBox([fallbackHex, fallbackHex, fallbackHex, fallbackHex]);
    grid4.append(quadWrap);

    gridFinal.append(finalBar(fallbackHex));

    // Async upgrade: load poster palette grid (if available) and compute kmeans 4.
    loadMediaColors(movie.tmdbId).then((media) => {
      const grid58 = sliceGrid58(media?.posterGrid) || null;
      const safeGrid = renderPoster58Grid(grid58, fallbackHex);
      clear(gridWrap);
      gridWrap.append(safeGrid);

      if (grid58) {
        const pts = flatPointsFromGrid(grid58);
        const k4 = kMeansRgbs(pts, 4);
        const hex4 = k4.map((rgb) => rgbToHex(rgb));
        clear(quadWrap);
        quadWrap.append(quadBox(hex4).firstChild);
      }
    });
  });

  posterStage.append(gridPoster);
  gridStage.append(grid58);
  tonesStage.append(grid4);

  const slope = slopeChartForFamily({ ...family, movies: moviesSorted });
  const finalWrap = el("div", { class: "pa-final-wrap" }, gridFinal, slope || null);
  finalStage.append(finalWrap);

  stages.append(posterStage, gridStage, tonesStage, finalStage);
  sticky.append(stages);
  track.append(sticky);

  // Add scroll length inside modal: 4 stages with overlap.
  track.append(
    el("div", { class: "pa-scrolly-spacer", "aria-hidden": "true" })
  );

  function computeProgress(rootEl) {
    const r = track.getBoundingClientRect();
    const vh = window.innerHeight;
    const travel = Math.max(1, track.offsetHeight - vh);
    const scrolled = Math.min(Math.max(-r.top, 0), travel);
    return scrolled / travel;
  }

  function stageOpacities(p) {
    // 0..1 scroll progress mapped to 4 stages with soft overlaps
    const a = 1 - smoothstep01((p - 0.18) / 0.18);
    const b = smoothstep01((p - 0.12) / 0.22) * (1 - smoothstep01((p - 0.44) / 0.18));
    const c = smoothstep01((p - 0.38) / 0.22) * (1 - smoothstep01((p - 0.70) / 0.18));
    const d = smoothstep01((p - 0.64) / 0.24);
    return [a, b, c, d].map(clamp01);
  }

  let raf = 0;
  function tick(rootEl) {
    if (!rootEl || rootEl.hidden) return;
    const p = computeProgress(rootEl);
    const [o0, o1, o2, o3] = stageOpacities(p);
    posterStage.style.opacity = String(o0);
    gridStage.style.opacity = String(o1);
    tonesStage.style.opacity = String(o2);
    finalStage.style.opacity = String(o3);

    // subtle depth/scale for smoother feel
    posterStage.style.transform = `translateY(${(1 - o0) * 10}px) scale(${0.998 + o0 * 0.002})`;
    gridStage.style.transform = `translateY(${(1 - o1) * 10}px) scale(${0.996 + o1 * 0.004})`;
    tonesStage.style.transform = `translateY(${(1 - o2) * 10}px) scale(${0.996 + o2 * 0.004})`;
    finalStage.style.transform = `translateY(${(1 - o3) * 10}px) scale(${0.998 + o3 * 0.002})`;
  }

  function onScroll(rootEl) {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      tick(rootEl);
    });
  }

  // Hook is installed by openPosterAnalysis, which passes the modal root.
  track.__paAttachScroll = (rootEl) => {
    const scroller = rootEl; // .poster-analysis is scroll container
    const handler = () => onScroll(rootEl);
    scroller.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    // initial
    tick(rootEl);
    return () => {
      scroller.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  };

  return track;
}

function renderFilmRow(movie, { index, total }) {

  const url = posterUrl(movie.posterPath);
  const poster = url
    ? el("img", {
        class: "pa-poster",
        src: url,
        alt: movie.title || "Poster",
        loading: "lazy",
      })
    : el("div", { class: "pa-poster pa-poster--placeholder" });

  const dominantHex = movie.dominantHex || rgbToHex(fallbackRgb(movie));

  const gridSlot = el("div", { class: "pa-grid-slot" });
  gridSlot.append(renderPoster58Grid(null, dominantHex));

  const d4 = el("div", { class: "pa-stage-inner" });
  d4.append(renderDominant4([dominantHex, dominantHex, dominantHex, dominantHex]));

  const posterCol = el(
    "div",
    { class: "pa-row__poster-wrap" },
    el("span", { class: "pa-row__role" }, filmRoleLabel(index, total)),
    el(
      "div",
      { class: "pa-row__title-block" },
      el("h3", { class: "pa-row__title" }, movie.title || "—"),
      el(
        "span",
        { class: "pa-row__meta" },
        movie.year != null ? String(movie.year) : "—"
      )
    ),
    poster
  );

  const strip = el(
    "div",
    { class: "pa-row__strip" },
    stageCard("Poster", "Key art", posterCol),
    stageCard("Poster sample", "5 × 8 regions", gridSlot),
    stageCard("Four tones", "k-means", d4),
    stageCard("Final colour", "dataset", renderDominant1(dominantHex))
  );

  const row = el("article", { class: "pa-row" }, strip);

  loadMediaColors(movie.tmdbId).then((media) => {
    clear(d4);

    const full = media?.posterGrid;
    const grid58 = sliceGrid58(full);
    const points = grid58 ? flatPointsFromGrid(grid58) : [fallbackRgb(movie)];

    clear(gridSlot);
    gridSlot.append(renderPoster58Grid(grid58, dominantHex));
    if (!grid58) {
      gridSlot.classList.add("pa-grid-slot--stacked");
      gridSlot.append(
        el(
          "p",
          { class: "pa-poster-sample-note", role: "status" },
          "No poster sample grid in dataset — middle columns use the recorded dominant only."
        )
      );
    } else {
      gridSlot.classList.remove("pa-grid-slot--stacked");
    }

    const c4 = kMeansRgbs(points, Math.min(4, points.length)).map(rgbToHex);

    d4.append(renderDominant4(c4));
  });

  return row;
}

let shell = null;
let onKey = null;

function fmtBrightness(b) {
  if (b == null || !Number.isFinite(b)) return "—";
  return `${Math.round(b)}`;
}

function slopeChartForFamily(family) {
  let movies = [...(family?.movies || [])].filter((m) => m?.dominantHex && m?.year != null);
  if (movies.length < 2) return null;
  movies = movies.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

  const W = 560;
  const H = 190;
  const pad = { top: 18, right: 42, bottom: 18, left: 42 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const x = (i) => {
    if (movies.length <= 1) return pad.left;
    return pad.left + (i / (movies.length - 1)) * innerW;
  };
  const y = (v) => pad.top + (1 - Math.max(0, Math.min(100, v)) / 100) * innerH;
  const pts = movies.map((m, i) => ({
    i,
    year: m.year,
    hex: m.dominantHex,
    b: brightness(m.dominantHex),
    x: x(i),
    y: y(brightness(m.dominantHex)),
  }));

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "pa-slope");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Brightness over time from ${pts[0].year} to ${pts[pts.length - 1].year}.`);

  const mk = (tag, attrs = {}) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  // side axes
  svg.appendChild(mk("line", { x1: pad.left, x2: pad.left, y1: pad.top, y2: pad.top + innerH, class: "pa-slope__axis" }));
  svg.appendChild(mk("line", { x1: pad.left + innerW, x2: pad.left + innerW, y1: pad.top, y2: pad.top + innerH, class: "pa-slope__axis" }));

  // dashed gridlines (no numeric labels; sketch-like)
  const ticks = [85, 65, 45, 25];
  for (const t of ticks) {
    const yy = y(t);
    svg.appendChild(mk("line", { x1: pad.left, x2: pad.left + innerW, y1: yy, y2: yy, class: "pa-slope__grid" }));
  }

  // + / - markers like the sketch
  const plusL = mk("text", { x: pad.left - 16, y: pad.top + 10, class: "pa-slope__pm" }); plusL.textContent = "+";
  const minusL = mk("text", { x: pad.left - 16, y: pad.top + innerH, class: "pa-slope__pm" }); minusL.textContent = "−";
  const plusR = mk("text", { x: pad.left + innerW + 16, y: pad.top + 10, class: "pa-slope__pm pa-slope__pm--r" }); plusR.textContent = "+";
  const minusR = mk("text", { x: pad.left + innerW + 16, y: pad.top + innerH, class: "pa-slope__pm pa-slope__pm--r" }); minusR.textContent = "−";
  svg.appendChild(plusL); svg.appendChild(minusL); svg.appendChild(plusR); svg.appendChild(minusR);

  // slope polyline through every film
  const d = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  svg.appendChild(mk("polyline", { points: d, class: "pa-slope__line", fill: "none" }));

  // points (no visible years; show on hover via <title>)
  pts.forEach((p, i) => {
    const c = mk("circle", {
      cx: p.x,
      cy: p.y,
      r: 10,
      fill: p.hex,
      class: "pa-slope__dot",
      tabindex: "0",
      "data-year": p.year,
      "data-hex": String(p.hex || "").toUpperCase(),
      "data-bright": Math.round(p.b),
    });

    const onEnter = (event) => {
      const year = c.getAttribute("data-year") || "—";
      const hex = c.getAttribute("data-hex") || "—";
      const br = c.getAttribute("data-bright") || "—";
      showTooltip(
        event,
        `<span class="t-title">${hex}</span><span class="t-sub">${year} · brightness ${br}</span>`,
        { accent: hex }
      );
    };
    c.addEventListener("mouseenter", onEnter);
    c.addEventListener("mousemove", (event) => moveTooltip(event));
    c.addEventListener("mouseleave", () => hideTooltip());
    c.addEventListener("focus", (event) => onEnter(event));
    c.addEventListener("blur", () => hideTooltip());

    svg.appendChild(c);
  });

  const wrap = el(
    "section",
    { class: "pa-slope-wrap", "aria-label": "Brightness change" },
    el("h3", { class: "pa-slope-title" }, "Brightness slope"),
    svg
  );
  return wrap;
}

function buildShell() {
  const backdrop = el("div", {
    class: "poster-analysis__backdrop",
    onclick: () => closePosterAnalysis(),
  });
  const closeBtn = el(
    "button",
    {
      type: "button",
      class: "poster-analysis__close",
      "aria-label": "Close poster analysis",
      onclick: () => closePosterAnalysis(),
    },
    "Close"
  );
  const header = el("header", { class: "poster-analysis__header" });
  const rows = el("div", { class: "poster-analysis__rows" });
  const panel = el(
    "div",
    { class: "poster-analysis__panel" },
    el("div", { class: "poster-analysis__head-row" }, header, closeBtn),
    rows
  );
  const root = el("div", {
    class: "poster-analysis",
    id: "poster-analysis-root",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "poster-analysis-title",
  });
  root.append(backdrop, panel);
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  document.body.appendChild(root);
  return { root, header, rows, closeBtn };
}

export function closePosterAnalysis() {
  if (!shell) return;
  shell.root.hidden = true;
  shell.root.setAttribute("aria-hidden", "true");
  if (onKey) {
    document.removeEventListener("keydown", onKey);
    onKey = null;
  }
  document.body.style.overflow = "";
}

export function openPosterAnalysis({ familyId, families }) {
  const family = (families || []).find((f) => f.familyId === familyId);
  if (!family || !(family.movies || []).length) return;

  if (!shell) shell = buildShell();
  if (shell._detachScroll) {
    shell._detachScroll();
    shell._detachScroll = null;
  }

  clear(shell.header);
  clear(shell.rows);

  shell.header.append(
    el(
      "div",
      { class: "poster-analysis__titles" },
      el(
        "h2",
        { class: "poster-analysis__family", id: "poster-analysis-title" },
        family.familyTitle || "Remake family"
      ),
      el(
        "p",
        { class: "poster-analysis__dek" },
        `${(family.movies || []).length} ${plural((family.movies || []).length, "poster", "posters")} in this remake family. Scroll to watch the image reduce from poster → pixels → tones → a single colour.`
      )
    )
  );

  // Defensive: dedupe by tmdbId so repeated IDs don't render repeated posters.
  const uniq = [];
  const seen = new Set();
  for (const m of family.movies) {
    const k = m?.tmdbId != null ? String(m.tmdbId) : `${m?.title || ""}-${m?.year || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }
  const sorted = uniq.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  const scrolly = renderFamilyScrolly(family, sorted);
  shell.rows.append(scrolly);
  shell._detachScroll = typeof scrolly.__paAttachScroll === "function" ? scrolly.__paAttachScroll(shell.root) : null;

  // Slope chart is rendered inside the scrolly final stage for selected families.

  shell.root.hidden = false;
  shell.root.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  if (!onKey) {
    onKey = (e) => {
      if (e.key === "Escape") closePosterAnalysis();
    };
    document.addEventListener("keydown", onKey);
  }

  shell.closeBtn?.focus?.();
}

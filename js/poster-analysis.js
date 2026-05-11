import { el, clear, posterUrl, classifyColor, hexToRgb } from "./color.js";
import { loadMediaColors, rgbToHex } from "./case-study.js";
import { showTooltip, moveTooltip, hideTooltip } from "./tooltip.js";

const GRID_ROWS = 8;
const GRID_COLS = 5;

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

/** Poster modal subtitle: `Title, 1937 / Title, 1954 / …` in chronological order. */
function formatPosterModalFilmLine(moviesSorted) {
  const parts = (moviesSorted || []).map((m) => {
    const name = (m.title != null ? String(m.title) : "").trim() || "—";
    const year = m.year ?? "—";
    return `${name}, ${year}`;
  });
  return parts.join(" / ");
}

function renderFamilyScrolly(family, moviesSorted) {
  const posterN = (moviesSorted || []).length || 0;
  const track = el("div", {
    class: "pa-scrolly-track",
    "data-count": String(posterN),
  });
  if (posterN > 0) {
    track.style.setProperty("--pa-poster-count", String(Math.max(1, posterN)));
  }
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

  const comparison = keyDifferencesForFamily({ ...family, movies: moviesSorted });
  const finalWrap = el("div", { class: "pa-final-wrap" }, comparison || null);
  finalStage.append(finalWrap);

  stages.append(posterStage, gridStage, tonesStage, finalStage);
  sticky.append(stages);
  track.append(sticky);

  // Add scroll length inside modal: 4 stages with overlap.
  track.append(
    el("div", { class: "pa-scrolly-spacer", "aria-hidden": "true" })
  );

  /** Scroll progress inside the modal body (not the viewport — panel stays fixed). */
  function computeProgress(scrollParent) {
    if (!scrollParent) return 0;
    const travel = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
    return clamp01(scrollParent.scrollTop / travel);
  }

  function stageOpacities(p) {
    // Wider crossover bands so each stage lasts longer (pairs with taller .pa-scrolly-spacer)
    const a = 1 - smoothstep01((p - 0.14) / 0.2);
    const b =
      smoothstep01((p - 0.1) / 0.22) *
      (1 - smoothstep01((p - 0.42) / 0.2));
    const c =
      smoothstep01((p - 0.36) / 0.22) *
      (1 - smoothstep01((p - 0.68) / 0.2));
    const d = smoothstep01((p - 0.58) / 0.26);
    return [a, b, c, d].map(clamp01);
  }

  let raf = 0;
  function tick(scrollParent) {
    if (!scrollParent?.isConnected) return;
    const p = computeProgress(scrollParent);
    const [o0, o1, o2, o3] = stageOpacities(p);
    posterStage.style.opacity = String(o0);
    gridStage.style.opacity = String(o1);
    tonesStage.style.opacity = String(o2);
    finalStage.style.opacity = String(o3);

    const finalLayout = o3 > 0.5;
    stages.classList.toggle("pa-scrolly-stages--final-layout", finalLayout);
    posterStage.style.pointerEvents = o0 < 0.08 ? "none" : "";
    gridStage.style.pointerEvents = o1 < 0.08 ? "none" : "";
    tonesStage.style.pointerEvents = o2 < 0.08 ? "none" : "";
    finalStage.style.pointerEvents = o3 < 0.08 ? "none" : "";

    // subtle depth/scale for smoother feel
    posterStage.style.transform = `translateY(${(1 - o0) * 10}px) scale(${0.998 + o0 * 0.002})`;
    gridStage.style.transform = `translateY(${(1 - o1) * 10}px) scale(${0.996 + o1 * 0.004})`;
    tonesStage.style.transform = `translateY(${(1 - o2) * 10}px) scale(${0.996 + o2 * 0.004})`;
    finalStage.style.transform = `translateY(${(1 - o3) * 10}px) scale(${0.998 + o3 * 0.002})`;
  }

  function onScroll(scrollParent) {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      tick(scrollParent);
    });
  }

  /** Pass `.poster-analysis__rows` so the white panel does not scroll with content. */
  track.__paAttachScroll = (scrollParent) => {
    const handler = () => onScroll(scrollParent);
    scrollParent.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    tick(scrollParent);
    return () => {
      scrollParent.removeEventListener("scroll", handler);
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
    stageCard("Final color", "dataset", renderDominant1(dominantHex))
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

/** Element that opened the modal (atlas tile / search hits) — restore focus without scrolling the page */
let paPriorFocusEl = null;

/** Page scroll Y to restore; `overflow:hidden` alone is not enough on Safari / trackpad overscroll. */
let lockedBodyScrollY = null;

function capturePageScrollY() {
  const yWin = window.scrollY ?? window.pageYOffset ?? 0;
  if (yWin !== 0) return yWin;
  const rt = document.documentElement?.scrollTop ?? 0;
  if (rt !== 0) return rt;
  return document.body?.scrollTop ?? 0;
}

function lockBodyScroll() {
  document.documentElement.classList.add("pa-modal-scroll-quiet");
  lockedBodyScrollY = capturePageScrollY();
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${lockedBodyScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

/**
 * Releases body lock + restores viewport Y without chapter snap fighting the fixed-body unwind.
 */
function unlockBodyScroll(onDone) {
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  const raw = lockedBodyScrollY;
  lockedBodyScrollY = null;
  const top = Number.isFinite(raw) ? Math.max(0, raw) : 0;

  const apply = () => window.scrollTo({ left: 0, top, behavior: "auto" });
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(() => {
      apply();
      document.documentElement.classList.remove("pa-modal-scroll-quiet");
      onDone?.();
    });
  });
}

function blurModalFocus() {
  try {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !shell?.root.contains(a)) return;
    a.blur();
  } catch {
    /* ignore */
  }
}

function restorePriorFocusPreventScroll() {
  const target = paPriorFocusEl;
  paPriorFocusEl = null;
  if (!(target instanceof HTMLElement) || !target.isConnected) return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

/** HSL (CSS semantics): H 0–360, S/L 0–100 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function hexToHsl(hex) {
  const [r255, g255, b255] = hexToRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: (h * 360 + 360) % 360, s: s * 100, l: l * 100 };
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function lightDarkYearCaption(lightMovie, darkMovie) {
  const ly = lightMovie?.year ?? "—";
  const dy = darkMovie?.year ?? "—";
  return `Light: ${ly} · Dark: ${dy}`;
}

function bindPosterHover(elNode, movie) {
  const url = posterUrl(movie?.posterPath);
  if (!url || !elNode) return;
  elNode.classList.add("pa-cmp-hover");
  elNode.style.cursor = "pointer";
  const title = escapeHtml(movie.title || "Poster");
  const yearStr =
    movie.year != null ? escapeHtml(String(movie.year)) : "";
  const accent = movie.dominantHex || "#888888";
  const html = `<img class="intro-tip-poster" src="${url}" alt="" /><span class="t-title">${title}</span><span class="t-sub">${yearStr}</span>`;
  elNode.addEventListener("mouseenter", (e) =>
    showTooltip(e, html, { film: true, accent })
  );
  elNode.addEventListener("mousemove", moveTooltip);
  elNode.addEventListener("mouseleave", hideTooltip);
}

function keyDifferencesForFamily(family) {
  let movies = [...(family?.movies || [])].filter((m) => m?.dominantHex && m?.year != null);
  if (movies.length < 2) return null;
  movies.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

  const txtOn = (hex) =>
    relativeLuminance(hex) > 0.42
      ? { color: "#121212", textShadow: "none" }
      : { color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.35)" };

  function barRow(movie, pct, fillHex) {
    const w = Math.max(0, Math.min(100, pct));
    const yearLabel = movie.year ?? "—";
    const fill = el("span", {
      class: "pa-diff-fill",
      style: {
        width: `${w}%`,
        background: fillHex,
      },
    });
    bindPosterHover(fill, movie);
    return el(
      "div",
      { class: "pa-diff-row" },
      el("span", { class: "pa-diff-row__year" }, String(yearLabel)),
      el(
        "div",
        { class: "pa-diff-track", "aria-hidden": "true" },
        fill
      ),
      el("span", { class: "pa-diff-pct" }, `${Math.round(w)}%`)
    );
  }

  function sectionLabel(text) {
    return el("p", { class: "pa-cmp-section__label" }, text);
  }

  function colorCard(movie) {
    const hsl = hexToHsl(movie.dominantHex);
    const colorBg = el("div", {
      class: "pa-cmp-card__color-bg",
      style: { background: movie.dominantHex },
    });
    const colorTop = el(
      "div",
      { class: "pa-cmp-card__color-top" },
      colorBg
    );
    const pills = el(
      "div",
      { class: "pa-cmp-card__pills" },
      el("span", { class: "pa-cmp-pill" }, `H ${Math.round(hsl.h)}°`),
      el("span", { class: "pa-cmp-pill" }, `L ${Math.round(hsl.l)}%`)
    );
    return el(
      "div",
      { class: "pa-cmp-card pa-cmp-card--split" },
      colorTop,
      el(
        "div",
        { class: "pa-cmp-card__panel" },
        el(
          "code",
          { class: "pa-cmp-card__hex" },
          movie.dominantHex.toUpperCase()
        ),
        pills
      )
    );
  }

  const nMovies = movies.length;
  if (nMovies === 3 || nMovies === 4) {
    function peerDarkestAmongOthers(idx) {
      let ref = movies[0];
      let minLum = Infinity;
      for (let i = 0; i < nMovies; i++) {
        if (i === idx) continue;
        const L = relativeLuminance(movies[i].dominantHex);
        if (L < minLum) {
          minLum = L;
          ref = movies[i];
        }
      }
      return ref;
    }

    function buildGradientMulti(list) {
      const n = list.length;
      const hexes = list.map((m) => m.dominantHex);
      const bg =
        n <= 1
          ? hexes[0]
          : `linear-gradient(90deg, ${hexes
              .map((h, i) => `${h} ${(i / (n - 1)) * 100}%`)
              .join(", ")})`;
      return el(
        "div",
        { class: "pa-cmp-gradient" },
        el(
          "div",
          { class: "pa-cmp-gradient__bar-wrap" },
          el("div", {
            class: "pa-cmp-gradient__bar",
            style: { background: bg },
          })
        )
      );
    }

    function metricBlockMulti(title, list, valueFn) {
      const block = el(
        "div",
        { class: "pa-diff-metric" },
        el("h4", { class: "pa-diff-metric__title" }, title)
      );
      for (const m of list) {
        block.append(barRow(m, valueFn(m), m.dominantHex));
      }
      return block;
    }

    function pairContrastPair(a, b) {
      const lumA = relativeLuminance(a.dominantHex);
      const lumB = relativeLuminance(b.dominantHex);
      const lightFirst = lumA >= lumB;
      const mvLight = lightFirst ? a : b;
      const mvDark = lightFirst ? b : a;
      const hexLight = mvLight.dominantHex;
      const hexDark = mvDark.dominantHex;

      const halfL = el(
        "span",
        {
          class: "pa-diff-contrast-split__half pa-diff-contrast-split__half--a",
          style: { background: hexLight, ...txtOn(hexLight) },
        },
        String(mvLight.year ?? "—")
      );
      const halfR = el(
        "span",
        {
          class: "pa-diff-contrast-split__half pa-diff-contrast-split__half--b",
          style: { background: hexDark, ...txtOn(hexDark) },
        },
        String(mvDark.year ?? "—")
      );
      bindPosterHover(halfL, mvLight);
      bindPosterHover(halfR, mvDark);
      return el(
        "div",
        { class: "pa-cmp-pair-block" },
        el("div", { class: "pa-diff-contrast-split" }, halfL, halfR),
        el(
          "p",
          {
            class: "pa-diff-contrast__note pa-diff-contrast__note--compact",
          },
          lightDarkYearCaption(mvLight, mvDark)
        )
      );
    }

    const cards = el("div", {
      class: "pa-cmp-cards pa-cmp-cards--multi",
      "data-pa-cards": String(nMovies),
    });
    movies.forEach((m) => cards.append(colorCard(m)));

    const pairsEl = el("div", { class: "pa-cmp-pairs" });
    if (nMovies === 4) {
      pairsEl.append(
        pairContrastPair(movies[0], movies[1]),
        pairContrastPair(movies[2], movies[3])
      );
    } else {
      pairsEl.append(
        pairContrastPair(movies[0], movies[1]),
        pairContrastPair(movies[1], movies[2])
      );
    }

    const yStart = movies[0].year ?? "—";
    const yEnd = movies[nMovies - 1].year ?? "—";

    return el(
      "section",
      {
        class: "pa-cmp-wrap pa-cmp-wrap--dashboard",
        "aria-label": `Dominant color comparison (${yStart}–${yEnd})`,
      },
      el(
        "div",
        { class: "pa-cmp-section" },
        sectionLabel("Selected colors"),
        cards
      ),
      el(
        "div",
        { class: "pa-cmp-section" },
        sectionLabel("Luminance gradient"),
        buildGradientMulti(movies)
      ),
      el(
        "div",
        { class: "pa-cmp-section pa-cmp-section--keydiff" },
        sectionLabel("Key differences"),
        metricBlockMulti("Luminosity", movies, (m) => hexToHsl(m.dominantHex).l)
      ),
      el(
        "div",
        { class: "pa-cmp-section pa-cmp-section--contrast" },
        sectionLabel("Pairwise contrast"),
        pairsEl
      )
    );
  }

  const older = movies[0];
  const newer = movies[movies.length - 1];
  const hexO = older.dominantHex;
  const hexN = newer.dominantHex;
  const hslO = hexToHsl(hexO);
  const hslN = hexToHsl(hexN);
  const yO = older.year ?? "—";
  const yN = newer.year ?? "—";

  const lumO = relativeLuminance(hexO);
  const lumN = relativeLuminance(hexN);
  const lightFirst = lumO >= lumN;

  const movieLight = lightFirst ? older : newer;
  const movieDark = lightFirst ? newer : older;

  const hexLight = lightFirst ? hexO : hexN;
  const hexDark = lightFirst ? hexN : hexO;

  function metricBlockLuminosity(title, pctOlder, pctNewer) {
    return el(
      "div",
      { class: "pa-diff-metric" },
      el("h4", { class: "pa-diff-metric__title" }, title),
      barRow(older, pctOlder, hexO),
      barRow(newer, pctNewer, hexN)
    );
  }

  const hitL = el("div", {
    class: "pa-cmp-gradient__hit pa-cmp-gradient__hit--left",
  });
  const hitR = el("div", {
    class: "pa-cmp-gradient__hit pa-cmp-gradient__hit--right",
  });
  bindPosterHover(hitL, movieLight);
  bindPosterHover(hitR, movieDark);
  const gradientHits = el("div", { class: "pa-cmp-gradient__hits" }, hitL, hitR);

  const gradientBlock = el(
    "div",
    { class: "pa-cmp-gradient" },
    el(
      "div",
      { class: "pa-cmp-gradient__bar-wrap" },
      el("div", {
        class: "pa-cmp-gradient__bar",
        style: {
          background: `linear-gradient(90deg, ${hexLight} 0%, ${hexDark} 100%)`,
        },
      }),
      gradientHits
    )
  );

  const halfL = el(
    "span",
    {
      class: "pa-diff-contrast-split__half pa-diff-contrast-split__half--a",
      style: { background: hexLight, ...txtOn(hexLight) },
    },
    String(movieLight.year ?? "—")
  );
  const halfD = el(
    "span",
    {
      class: "pa-diff-contrast-split__half pa-diff-contrast-split__half--b",
      style: { background: hexDark, ...txtOn(hexDark) },
    },
    String(movieDark.year ?? "—")
  );
  bindPosterHover(halfL, movieLight);
  bindPosterHover(halfD, movieDark);

  const contrastSplit = el("div", { class: "pa-diff-contrast-split" }, [
    halfL,
    halfD,
  ]);

  return el(
    "section",
    {
      class: "pa-cmp-wrap",
      "aria-label": `Dominant color comparison ${yO} vs ${yN}`,
    },
    el(
      "div",
      { class: "pa-cmp-section" },
      sectionLabel("Selected colors"),
      el(
        "div",
        { class: "pa-cmp-cards" },
        colorCard(older),
        colorCard(newer)
      )
    ),
    el(
      "div",
      { class: "pa-cmp-section" },
      sectionLabel("Brightness slope"),
      gradientBlock
    ),
    el(
      "div",
      { class: "pa-cmp-section pa-cmp-section--keydiff" },
      sectionLabel("Key differences"),
      metricBlockLuminosity("Luminosity", hslO.l, hslN.l)
    ),
    el(
      "div",
      { class: "pa-cmp-section pa-cmp-section--contrast" },
      sectionLabel("Contrast between colors"),
      el(
        "div",
        { class: "pa-diff-contrast pa-diff-contrast--solo" },
        contrastSplit,
        el(
          "p",
          {
            class: "pa-diff-contrast__note pa-diff-contrast__note--compact",
          },
          lightDarkYearCaption(movieLight, movieDark)
        )
      )
    )
  );
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
  shell.rows.scrollTop = 0;
  blurModalFocus();
  shell.root.hidden = true;
  shell.root.setAttribute("aria-hidden", "true");
  if (onKey) {
    document.removeEventListener("keydown", onKey);
    onKey = null;
  }
  unlockBodyScroll(() =>
    requestAnimationFrame(() => restorePriorFocusPreventScroll())
  );
}

export function openPosterAnalysis({ familyId, families }) {
  const family = (families || []).find((f) => f.familyId === familyId);
  if (!family || !(family.movies || []).length) return;

  paPriorFocusEl =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (!shell) shell = buildShell();
  if (shell._detachScroll) {
    shell._detachScroll();
    shell._detachScroll = null;
  }

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
  const filmYearLine = formatPosterModalFilmLine(sorted);
  const nPosters = sorted.length;

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
        { class: "poster-analysis__remake-line", id: "poster-analysis-remakes" },
        filmYearLine
      )
    )
  );

  const scrolly = renderFamilyScrolly(family, sorted);
  shell.rows.append(scrolly);

  shell.root.hidden = false;
  shell.root.setAttribute("aria-hidden", "false");
  lockBodyScroll();
  shell.rows.scrollTop = 0;

  shell._detachScroll = typeof scrolly.__paAttachScroll === "function" ? scrolly.__paAttachScroll(shell.rows) : null;

  requestAnimationFrame(() => {
    shell.rows.scrollTop = 0;
  });

  if (!onKey) {
    onKey = (e) => {
      if (e.key === "Escape") closePosterAnalysis();
    };
    document.addEventListener("keydown", onKey);
  }

  try {
    shell.closeBtn?.focus?.({ preventScroll: true });
  } catch {
    shell.closeBtn?.focus?.();
  }
}

import { el, clear, classifyColor, hexToRgb, posterUrl } from "./color.js";

/**
 * Chapter 9 — Case study.
 * For each film in a remake family, render three real visual artifacts:
 *   · Poster           (image)
 *   · Poster palette   (10 × 5 grid of k-means dominant colours per region)
 *   · Trailer barcode  (1 vertical stripe per second, coloured by the most
 *                       repeated pixel of that second's frame)
 *
 * Media data lives in ./data/analisis/media_colors/<tmdbId>.json — only a
 * subset of films have been processed by `scripts/extract_media_colors.py`,
 * so we lazy-load per film and fall back to the dominantHex strip when
 * unavailable.
 */

/**
 * Two consolidated JSON files hold every film's media analysis.
 * We fetch each one at most once and keep them in memory for lookups.
 */
let postersPromise = null;
let trailersPromise = null;

function loadPosters() {
  if (!postersPromise) {
    postersPromise = fetch("./data/analisis/poster_palettes.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return postersPromise;
}

function loadTrailers() {
  if (!trailersPromise) {
    trailersPromise = fetch("./data/analisis/trailer_timelines.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return trailersPromise;
}

export async function loadMediaColors(tmdbId) {
  const id = Number(tmdbId);
  if (!id) return null;
  const [posters, trailers] = await Promise.all([loadPosters(), loadTrailers()]);
  const posterGrid = posters[id] || posters[String(id)];
  const flatTimeline = trailers[id] || trailers[String(id)];
  if (!posterGrid && !flatTimeline) return null;
  return {
    posterGrid: posterGrid || null,
    // Re-expand flat [[R,G,B], ...] → [{second, color:[R,G,B]}, ...]
    trailerTimeline: flatTimeline
      ? flatTimeline.map((color, second) => ({ second, color }))
      : null,
  };
}

export function rgbToHex([r, g, b]) {
  const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function metrics(hex) {
  const [r, g, b] = hexToRgb(hex || "#888888");
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const delta = max - min;
  const light = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  const br = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const warmth = (R - B + 1) / 2;
  return {
    brightness: Math.round(br * 100),
    saturation: Math.round(sat * 100),
    warmth: Math.round(warmth * 100),
  };
}

function metricRow(label, value) {
  return el(
    "div",
    { class: "case-metric" },
    el("span", { class: "label" }, label),
    el("span", { class: "bar", style: { "--v": String(value) } }),
    el("span", {}, String(value))
  );
}

/* ---------- the three media columns ---------- */

function renderPosterCol(movie) {
  const url = posterUrl(movie.posterPath);
  return el(
    "div",
    { class: "media-col media-col--poster" },
    el("p", { class: "label" }, "Poster"),
    url
      ? el("img", { src: url, alt: movie.title || "Poster", loading: "lazy" })
      : el("div", { class: "placeholder" })
  );
}

function renderPaletteCol(movie) {
  const col = el(
    "div",
    { class: "media-col media-col--palette" },
    el("p", { class: "label" }, "Poster palette")
  );
  const grid = el("div", { class: "palette-grid is-loading" });
  col.append(grid);

  loadMediaColors(movie.tmdbId).then((media) => {
    grid.classList.remove("is-loading");
    grid.textContent = "";

    const posterGrid = media?.posterGrid;
    if (posterGrid && posterGrid.length && posterGrid[0]?.length) {
      const rows = posterGrid.length;
      const cols = posterGrid[0].length;
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      posterGrid.flat().forEach((rgb) => {
        grid.append(el("span", { style: { background: rgbToHex(rgb) } }));
      });
    } else {
      // Fallback: render the single dominantHex as one swatch so the column
      // still carries meaning instead of being empty chrome.
      grid.classList.add("is-fallback");
      grid.append(
        el("span", {
          style: { background: movie.dominantHex || "#ddd" },
          title: "Detailed poster palette not processed for this film",
        })
      );
      grid.append(el("p", { class: "mini" }, "Detailed palette not processed for this film."));
    }
  });

  return col;
}

function renderTrailerCol(movie) {
  const col = el(
    "div",
    { class: "media-col media-col--trailer" },
    el("p", { class: "label" }, "Dominant color per scene in trailer")
  );
  const barcode = el("div", { class: "barcode is-loading" });
  col.append(barcode);

  loadMediaColors(movie.tmdbId).then((media) => {
    barcode.classList.remove("is-loading");
    barcode.textContent = "";

    const timeline = media?.trailerTimeline;
    if (timeline && timeline.length) {
      timeline.forEach((sample) => {
        barcode.append(
          el("span", {
            style: { background: rgbToHex(sample.color) },
            title: `second ${sample.second}`,
          })
        );
      });
      const duration = timeline[timeline.length - 1]?.second ?? timeline.length;
      col.append(el("p", { class: "mini" }, `${timeline.length} samples · ~${duration}s trailer`));
    } else {
      barcode.classList.add("is-empty");
      barcode.textContent = "Trailer analysis not available";
    }
  });

  return col;
}

/* ---------- one full row per film ---------- */

function renderRow(movie, role, sentimentScore) {
  if (!movie) {
    return el(
      "article",
      { class: "media-row" },
      el("header", { class: "media-row__header" }, el("p", { class: "role" }, role))
    );
  }

  const m = metrics(movie.dominantHex);

  const header = el(
    "header",
    { class: "media-row__header" },
    el(
      "p",
      { class: "role" },
      el("span", {}, role),
      el("span", {}, String(movie.year ?? ""))
    ),
    el("h4", {}, movie.title || ""),
    el("p", { class: "mini" }, `Dominant color · ${classifyColor(movie.dominantHex)}`)
  );

  const mediaGrid = el(
    "div",
    { class: "media-row__grid" },
    renderPosterCol(movie),
    renderPaletteCol(movie),
    renderTrailerCol(movie)
  );

  const metricsWrap = el(
    "div",
    { class: "media-row__metrics" },
    metricRow("Brightness", m.brightness),
    metricRow("Saturation", m.saturation),
    metricRow("Warmth", m.warmth)
  );

  if (sentimentScore !== null && sentimentScore !== undefined) {
    const pct = ((sentimentScore + 1) / 2) * 100;
    const labelText = movie.sentimentLabel
      ? `Summary tone (${String(movie.sentimentLabel)})`
      : "Summary tone (overview text)";
    metricsWrap.append(
      el(
        "div",
        { class: "case-metric is-sentiment" },
        el("span", { class: "label" }, labelText),
        el("span", { class: "bar" }, el("span", { class: "marker", style: { "--v": String(pct) } })),
        el("span", { class: "case-metric__value" }, `${sentimentScore.toFixed(2)} (−1 gloomy … +1 upbeat)`),
        el(
          "p",
          { class: "case-metric__hint" },
          "RoBERTa score on the TMDB overview (English). Only some films in the dataset have this."
        )
      )
    );
  }

  const row = el("article", { class: "media-row" }, header, mediaGrid, metricsWrap);
  if (movie.overview) row.append(el("p", { class: "case-overview" }, movie.overview));
  return row;
}

/* ---------- main ---------- */

export function renderCaseStudy(container, { families, selectedFilm, sentimentFeatures }) {
  clear(container);

  const family = (families || []).find((f) =>
    (f.movies || []).some((m) => Number(m.tmdbId) === Number(selectedFilm?.tmdbId))
  );
  const sorted = family ? [...family.movies].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)) : [];

  const sentimentMap = new Map();
  for (const item of sentimentFeatures || []) {
    if (String(item.sentimentLabel || "").toLowerCase() === "no_overview") continue;
    const id = Number(item.tmdbId);
    if (!Number.isFinite(id)) continue;
    sentimentMap.set(id, {
      score: Number(item.sentimentScores?.positive || 0) - Number(item.sentimentScores?.negative || 0),
      sentimentLabel: item.sentimentLabel || "",
    });
  }

  container.append(
    el(
      "p",
      { class: "small" },
      family ? family.familyTitle : "Search a film above to load a remake pair"
    )
  );

  if (!sorted.length) return;

  const roles = sorted.length === 2
    ? ["Original", "Remake"]
    : sorted.map((_, i, a) =>
        i === 0 ? "Original" : i === a.length - 1 ? "Latest remake" : `Remake ${i}`
      );

  const rows = el("div", { class: "case-rows" });
  sorted.forEach((movie, i) => {
    const meta = sentimentMap.get(Number(movie.tmdbId));
    const score = meta != null ? meta.score : null;
    const enriched = meta != null ? { ...movie, sentimentLabel: meta.sentimentLabel } : movie;
    rows.append(renderRow(enriched, roles[i], score));
  });
  container.append(rows);
}

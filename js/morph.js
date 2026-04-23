import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { clear, classifyColor, brightness, COLOR_GROUPS, COLOR_MAP } from "./color.js";
import { showTooltip, moveTooltip, hideTooltip } from "./tooltip.js";

/**
 * Sections 5–8 — morph figures share width 2040; height 760 except ch.05 scrolly (taller canvas).
 * Design goal: each chart explains one idea, with on-canvas titles + legible axes.
 */

const VIEW = { width: 2040, height: 760 };
/** Ch.04 pinned sentiment→scatter: same height as ch.03 timeline / morph embed for one visual size. */
const SENTIMENT_SCATTER_PINNED = {
  width: 2040,
  height: 640,
  margin: { top: 96, right: 22, bottom: 44, left: 92 },
};
/** Ch.05 scrolly only — taller than VIEW so the chart fills more vertical space on screen. */
const VIEW_SCROLLY_HEIGHT = 1020;
const MARGIN = { top: 124, right: 28, bottom: 60, left: 92 };
const ACCENT = "var(--accent)";
const INK = "#0a0a0a";
const MUTED = "#5c5c5c";
const RULE = "#e6e6e6";
const FONT = 'IBM Plex Sans, "Helvetica Neue", sans-serif';

/** First genre only, in the same order as stored on each film (TMDB / analytics). */
function formatGenreLine(genres) {
  if (!Array.isArray(genres) || !genres.length) return "—";
  return escape(String(genres[0]));
}

function showFilmTooltip(event, d) {
  const year = d.year != null ? d.year : "—";
  let sub = `${year} · ${formatGenreLine(d.genres)}`;
  if (d.toneScore != null && Number.isFinite(d.toneScore)) {
    const label = d.sentimentLabel ? String(d.sentimentLabel).replace(/^\w/, (c) => c.toUpperCase()) : "";
    const toneBit = label ? `${label} · score ${d.toneScore.toFixed(2)}` : `Tone score ${d.toneScore.toFixed(2)}`;
    sub += ` · ${toneBit}`;
  }
  showTooltip(
    event,
    `<span class="t-title">${escape(d.title)}</span><span class="t-sub">${sub}</span>`,
    { film: true }
  );
}

function smoothstep01(t, edge0, edge1) {
  if (t <= edge0) return 0;
  if (t >= edge1) return 1;
  const x = (t - edge0) / (edge1 - edge0);
  return x * x * (3 - 2 * x);
}

/** Fixed genre columns for ch.05 scrolly (order on the x-axis). */
const SCROLL_GENRE_ORDER = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Musical",
  "Romance",
  "Science fiction",
  "Thriller",
  "Western",
];

function canonicalScrollGenre(raw) {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const aliases = {
    "science fiction": "Science fiction",
    "science-fiction": "Science fiction",
    "sci-fi": "Science fiction",
    "sci fi": "Science fiction",
    musical: "Musical",
    music: "Musical",
  };
  if (aliases[s]) return aliases[s];
  for (const label of SCROLL_GENRE_ORDER) {
    if (label.toLowerCase() === s) return label;
  }
  return null;
}

/** First TMDB genre on the record that matches one of the 12 columns (scan full list). */
function bucketForFilm(d) {
  const list = Array.isArray(d.genres) ? d.genres : [];
  for (const g of list) {
    const c = canonicalScrollGenre(g);
    if (c) return c;
  }
  return null;
}

/**
 * Sticky scrolly: year×lightness → genre stacks → horizontal colour stripes (barcode).
 * @param {{ movies: unknown[], embedInParentScroll?: boolean, embedSpec?: { viewHeight: number, margin: { top: number, right: number, bottom: number, left: number } }, timelineAnchors?: Map<string, { x: number, y: number, r: number }>, getHandoffLerp?: () => number, timelineClick?: { handoffMax: number, laneForTmdb: (tmdbKey: string) => string | null, selectLane: (laneId: string) => void }, getTimelinePanelOpen?: () => boolean, timelineYearToX?: (year: number, panelOpen: boolean) => number }} opts
 */
export function renderMorphScrolly(
  container,
  {
    movies,
    embedInParentScroll = false,
    embedSpec = null,
    timelineAnchors = null,
    getHandoffLerp = null,
    timelineClick = null,
    getTimelinePanelOpen = null,
    timelineYearToX = null,
  } = {}
) {
  clear(container);

  const MIN_VOTES = 20;
  const radiusDomain = [5, 8.5];
  const radiusRange = [5, 18];
  const rScale = d3.scalePow().exponent(1.55).domain(radiusDomain).range(radiusRange).clamp(true);
  const neutralRadius = 8;
  const radiusFor = (d) =>
    d.voteAverage != null && d.voteCount >= MIN_VOTES ? rScale(d.voteAverage) : neutralRadius;
  const isRated = (d) => d.voteAverage != null && d.voteCount >= MIN_VOTES;

  const nodes = (movies || [])
    .filter((m) => m.year && m.dominantHex)
    .map((m) => ({
      id: String(m.tmdbId ?? `${m.title}-${m.year}`),
      year: m.year,
      lum: brightness(m.dominantHex),
      color: m.dominantHex,
      title: m.title,
      group: classifyColor(m.dominantHex),
      genres: Array.isArray(m.genres) ? m.genres : [],
      voteAverage:
        typeof m.voteAverage === "number" && m.voteAverage > 0 ? m.voteAverage : null,
      voteCount: typeof m.voteCount === "number" && m.voteCount > 0 ? m.voteCount : 0,
    }));

  if (!nodes.length) {
    if (embedInParentScroll) return { frame: () => {} };
    return;
  }

  const isEmbed = Boolean(embedInParentScroll);
  const em = embedSpec?.margin;
  const scrollH =
    isEmbed && embedSpec?.viewHeight ? embedSpec.viewHeight : VIEW_SCROLLY_HEIGHT;
  const top = isEmbed && em ? em.top : MARGIN.top;
  const bottom = isEmbed && em ? scrollH - em.bottom : scrollH - MARGIN.bottom;
  const left = isEmbed && em ? em.left : MARGIN.left;
  const right = isEmbed && em ? VIEW.width - em.right : VIEW.width - MARGIN.right;
  const yearExtent = d3.extent(nodes, (d) => d.year);
  const xTime = d3.scaleLinear().domain(yearExtent).nice().range([left, right]);
  const yTime = d3.scaleLinear().domain([0, 100]).nice().range([bottom, top]);
  const yByYear = d3.scaleLinear().domain(yearExtent).nice().range([bottom - 14, top + 10]);
  const decadeTickYearsY = d3.range(
    Math.floor(d3.min(nodes, (d) => d.year) / 10) * 10,
    Math.ceil(d3.max(nodes, (d) => d.year) / 10) * 10 + 1,
    10
  );

  const sim = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((d) => xTime(d.year)).strength(0.85))
    .force("y", d3.forceY((d) => yTime(d.lum)).strength(0.85))
    .force("collide", d3.forceCollide((d) => radiusFor(d) + 0.9).iterations(5))
    .stop();
  for (let i = 0; i < 480; i++) sim.tick();
  const pad = 2;
  for (const d of nodes) {
    const r = radiusFor(d);
    d.x = Math.max(left + r + pad, Math.min(right - r - pad, d.x));
    d.y = Math.max(top + r + pad, Math.min(bottom - r - pad, d.y));
  }
  const settle = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((d) => xTime(d.year)).strength(0.35))
    .force("y", d3.forceY((d) => yTime(d.lum)).strength(0.35))
    .force("collide", d3.forceCollide((d) => radiusFor(d) + 0.9).iterations(6))
    .stop();
  for (let i = 0; i < 140; i++) settle.tick();
  for (const d of nodes) {
    const r = radiusFor(d);
    d.x0 = Math.max(left + r + pad, Math.min(right - r - pad, d.x));
    d.y0 = Math.max(top + r + pad, Math.min(bottom - r - pad, d.y));
    d.r0 = radiusFor(d);
  }

  nodes.forEach((d) => {
    d.bucket = bucketForFilm(d);
  });

  const genreLabels = [...SCROLL_GENRE_ORDER];
  const xBand = d3.scaleBand().domain(genreLabels).range([left, right]).padding(0.38);
  const stackGap = 4;
  const rStack = (d) => Math.max(4.2, Math.min(11, radiusFor(d) * 0.62));

  genreLabels.forEach((lab) => {
    const col = nodes
      .filter((d) => d.bucket === lab)
      .sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
    const cx = xBand(lab) + xBand.bandwidth() / 2;
    let belowCenter = null;
    let belowR = 0;
    col.forEach((n) => {
      const rr = rStack(n);
      let cy = yByYear(n.year);
      if (belowCenter != null) {
        const maxCy = belowCenter - belowR - stackGap - rr;
        cy = Math.min(cy, maxCy);
      }
      cy = Math.min(cy, bottom - 14 - rr);
      cy = Math.max(cy, top + rr + 4);
      n.x1 = cx;
      n.y1 = cy;
      n.r1 = rr;
      belowCenter = cy;
      belowR = rr;
    });
  });

  nodes.forEach((d) => {
    if (!d.bucket) {
      d.x1 = d.x0;
      d.y1 = d.y0;
      d.r1 = d.r0;
    }
  });

  function computeBarcodeLayout() {
    const maxN =
      d3.max(genreLabels, (lab) => nodes.filter((d) => d.bucket === lab).length) || 1;
    const lineH = Math.max(1.55, Math.min(4.6, (bottom - top - 20) / maxN));
    const vGap = 0.34;
    const barMaxBottom = bottom - 2;
    genreLabels.forEach((lab) => {
      const col = nodes
        .filter((d) => d.bucket === lab)
        .sort((a, b) => a.year - b.year || String(a.title).localeCompare(String(b.title)));
      const bw = Math.max(4, xBand.bandwidth() - 2);
      const xLeft = xBand(lab) + 1;
      col.forEach((n) => {
        const cy = yByYear(n.year);
        n.barX = xLeft;
        n.barW = bw;
        n.barH = lineH;
        n.barY = cy - lineH / 2;
      });
      const sorted = [...col].sort((a, b) => a.barY - b.barY);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const n = sorted[i];
        const minY = prev.barY + prev.barH + vGap;
        if (n.barY < minY) n.barY = minY;
      }
      let maxExtent = d3.max(col, (n) => n.barY + n.barH);
      if (maxExtent > barMaxBottom) {
        const shiftUp = maxExtent - barMaxBottom;
        col.forEach((n) => {
          n.barY -= shiftUp;
        });
      }
    });
  }
  computeBarcodeLayout();

  const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgNode.setAttribute("viewBox", `0 0 ${VIEW.width} ${scrollH}`);
  svgNode.setAttribute("width", "100%");
  svgNode.setAttribute("height", "auto");
  svgNode.setAttribute("preserveAspectRatio", "xMidYMid meet");

  let track = null;
  if (!embedInParentScroll) {
    track = document.createElement("div");
    track.className = "morph-scrolly-track";
    const sticky = document.createElement("div");
    sticky.className = "morph-scrolly-sticky";
    sticky.appendChild(svgNode);
    track.appendChild(sticky);
    container.appendChild(track);
  } else {
    container.appendChild(svgNode);
  }

  const svg = d3.select(svgNode);

  const d0 = Math.floor(d3.min(nodes, (d) => d.year) / 10) * 10;
  const d1 = Math.ceil(d3.max(nodes, (d) => d.year) / 10) * 10;
  const decadeYears = d3.range(d0, d1 + 1, 10);

  const gBandsTime = svg.append("g").attr("class", "morph-bands-time");
  for (let i = 0; i < decadeYears.length - 1; i++) {
    const xa = Math.max(left, xTime(decadeYears[i]));
    const xb = Math.min(right, xTime(decadeYears[i + 1]));
    gBandsTime
      .append("rect")
      .attr("x", xa)
      .attr("y", top)
      .attr("width", Math.max(0, xb - xa))
      .attr("height", bottom - top)
      .attr("fill", i % 2 === 0 ? "#fafafa" : "#ffffff")
      .attr("stroke", "none");
  }

  const gBandsGenre = svg.append("g").attr("class", "morph-bands-genre").style("opacity", 0);
  genreLabels.forEach((lab, i) => {
    const xa = xBand(lab);
    const bw = xBand.bandwidth();
    gBandsGenre
      .append("rect")
      .attr("x", xa)
      .attr("y", top)
      .attr("width", bw)
      .attr("height", bottom - top)
      .attr("fill", i % 2 === 0 ? "#f6f6f4" : "#ffffff")
      .attr("stroke", "none");
  });

  svg
    .append("line")
    .attr("class", "morph-baseline")
    .attr("x1", left)
    .attr("x2", right)
    .attr("y1", bottom)
    .attr("y2", bottom)
    .attr("stroke", RULE)
    .attr("stroke-width", 1.5);
  svg
    .append("line")
    .attr("class", "morph-baseline-left")
    .attr("x1", left)
    .attr("x2", left)
    .attr("y1", top)
    .attr("y2", bottom)
    .attr("stroke", RULE)
    .attr("stroke-width", 1.5);

  const gHeaderTime = svg.append("g").attr("class", "morph-header-time");
  const gHeaderGenre = svg.append("g").attr("class", "morph-header-genre").style("opacity", 0);
  const gHeaderBarcode = svg.append("g").attr("class", "morph-header-barcode").style("opacity", 0);

  if (!isEmbed) {
    gHeaderTime
      .append("text")
      .attr("x", left)
      .attr("y", 42)
      .attr("fill", INK)
      .attr("font-family", FONT)
      .attr("font-size", 28)
      .attr("font-weight", 700)
      .text("Colour through the years");
    gHeaderTime
      .append("text")
      .attr("x", left)
      .attr("y", 78)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 17)
      .text("Scroll — the same films regroup into the twelve genre columns below.");

    gHeaderGenre
      .append("text")
      .attr("x", left)
      .attr("y", 42)
      .attr("fill", INK)
      .attr("font-family", FONT)
      .attr("font-size", 28)
      .attr("font-weight", 700)
      .text("Stacked by genre");
    gHeaderGenre
      .append("text")
      .attr("x", left)
      .attr("y", 78)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 17)
      .text(
        "Each film uses the first TMDB genre that matches the fixed list. The vertical scale is by decade (older toward the bottom)."
      );

    gHeaderBarcode
      .append("text")
      .attr("x", left)
      .attr("y", 42)
      .attr("fill", INK)
      .attr("font-family", FONT)
      .attr("font-size", 28)
      .attr("font-weight", 700)
      .text("Genre colour barcodes");
    gHeaderBarcode
      .append("text")
      .attr("x", left)
      .attr("y", 78)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 17)
      .text(
        "Horizontal stripes — one film per stripe, aligned to the same decade scale on the left."
      );
  } else {
    gHeaderTime.style("display", "none");
    gHeaderGenre.style("display", "none");
    gHeaderBarcode.style("display", "none");
  }

  const decadeTicks = d3.range(
    Math.ceil(d3.min(nodes, (d) => d.year) / 10) * 10,
    d3.max(nodes, (d) => d.year) + 1,
    10
  );
  const gAxisTimeX = svg
    .append("g")
    .attr("transform", `translate(0, ${bottom})`)
    .call(
      d3.axisBottom(xTime).tickValues(decadeTicks).tickFormat(d3.format("d")).tickSize(0)
    )
    .call((g) => g.select(".domain").remove());
  gAxisTimeX
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", "16px")
    .style("font-weight", "600");

  const gAxisTimeY = svg
    .append("g")
    .attr("transform", `translate(${left}, 0)`)
    .call(d3.axisLeft(yTime).ticks(6).tickSize(0))
    .call((g) => g.select(".domain").remove());
  gAxisTimeY
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", "16px")
    .style("font-weight", "500");

  const gAxisGenreY = svg
    .append("g")
    .attr("class", "morph-axis-genre-y")
    .attr("transform", `translate(${left}, 0)`)
    .call(
      d3
        .axisLeft(yByYear)
        .tickValues(decadeTickYearsY)
        .tickFormat((y) => `${y}s`)
        .tickSize(0)
    )
    .call((g) => g.select(".domain").remove());
  gAxisGenreY
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", "15px")
    .style("font-weight", "600");

  const gAxisGenre = svg.append("g").attr("class", "morph-axis-genre").style("opacity", 0);
  genreLabels.forEach((lab) => {
    const cx = xBand(lab) + xBand.bandwidth() / 2;
    const short =
      lab === "Science fiction"
        ? "Sci-fi"
        : lab.length > 11
          ? `${lab.slice(0, 10)}…`
          : lab;
    gAxisGenre
      .append("text")
      .attr("x", cx)
      .attr("y", scrollH - 22)
      .attr("text-anchor", "middle")
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 12)
      .attr("font-weight", 700)
      .attr("letter-spacing", "0.03em")
      .style("text-transform", "uppercase")
      .text(short);
  });

  svg
    .append("text")
    .attr("class", "morph-caption-time-y")
    .attr("transform", `translate(28, ${(top + bottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text("← Darker … lighter →");

  svg
    .append("text")
    .attr("class", "morph-caption-time-x")
    .attr("x", right)
    .attr("y", scrollH - 16)
    .attr("text-anchor", "end")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text("Release year →");

  const gDots = svg.append("g").attr("class", "morph-scrolly-dots");
  const marks = gDots
    .selectAll("rect")
    .data(nodes)
    .join("rect")
    .attr("x", (d) => d.x0 - d.r0)
    .attr("y", (d) => d.y0 - d.r0)
    .attr("width", (d) => 2 * d.r0)
    .attr("height", (d) => 2 * d.r0)
    .attr("rx", (d) => d.r0)
    .attr("ry", (d) => d.r0)
    .attr("fill", (d) => d.color)
    .attr("fill-opacity", (d) => (isRated(d) ? 0.92 : 0.4))
    .attr("stroke", "rgba(10,10,10,0.35)")
    .attr("stroke-width", 0.75)
    .attr("stroke-dasharray", (d) => (isRated(d) ? null : "2.5 2.5"))
    .style("cursor", "pointer")
    .on("mouseenter", (event, d) => showFilmTooltip(event, d))
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (event, d) => {
      if (!timelineClick) return;
      const hl = typeof getHandoffLerp === "function" ? getHandoffLerp() : 1;
      if (hl > timelineClick.handoffMax) return;
      event.stopPropagation();
      const lane = timelineClick.laneForTmdb(d.id);
      if (!lane) return;
      timelineClick.selectLane(lane);
    });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function frame(t) {
    const tt = reduceMotion ? 1 : t;
    const pStack = smoothstep01(tt, 0, 0.36);
    const pBar = smoothstep01(tt, 0.48, 0.94);

    const uTime = 1 - smoothstep01(tt, 0, 0.34);
    const uGenreStackHdr =
      smoothstep01(tt, 0.14, 0.36) * (1 - smoothstep01(tt, 0.48, 0.66));
    const uBarcodeHdr = smoothstep01(tt, 0.52, 0.78);
    const uGenreBands =
      smoothstep01(tt, 0.14, 0.34) * (1 - smoothstep01(tt, 0.42, 0.58)) + uBarcodeHdr * 0.92;
    const uAxisGenre = Math.max(
      smoothstep01(tt, 0.14, 0.34) * (1 - smoothstep01(tt, 0.42, 0.58)),
      uBarcodeHdr
    );

    const hlRaw = typeof getHandoffLerp === "function" ? getHandoffLerp() : 1;
    const hlSmooth = hlRaw * hlRaw * (3 - 2 * hlRaw);
    const chromeTime = Math.max(0.03, hlSmooth);

    gBandsTime.style("opacity", uTime * chromeTime);
    gAxisTimeX.style("opacity", uTime * chromeTime);
    gAxisTimeY.style("opacity", uTime * chromeTime);
    gAxisGenreY.style("opacity", uAxisGenre * Math.max(0.2, hlSmooth));
    svg.selectAll(".morph-caption-time-y, .morph-caption-time-x").style("opacity", uTime * chromeTime);
    gHeaderTime.style("opacity", uTime * chromeTime);
    gBandsGenre.style("opacity", Math.min(1, uGenreBands) * Math.max(0.15, hlSmooth));
    gAxisGenre.style("opacity", uAxisGenre * Math.max(0.15, hlSmooth));
    gHeaderGenre.style("opacity", uGenreStackHdr * Math.max(0.15, hlSmooth));
    gHeaderBarcode.style("opacity", uBarcodeHdr * Math.max(0.15, hlSmooth));

    marks.each(function (d) {
      const baseOp = isRated(d) ? 0.92 : 0.4;
      const sel = d3.select(this);
      let x;
      let y;
      let w;
      let h;
      let rx;
      let fillOp;
      let strokeOp;
      let strokeW;
      let dash;

      if (!d.bucket) {
        const op = baseOp * (1 - 0.94 * pStack);
        const r = d.r0;
        x = d.x0 - r;
        y = d.y0 - r;
        w = 2 * r;
        h = 2 * r;
        rx = r;
        fillOp = op;
        strokeOp = op;
        strokeW = 0.75;
        dash = isRated(d) ? null : "2.5 2.5";
      } else {
        const cxS = d.x0 + pStack * (d.x1 - d.x0);
        const cyS = d.y0 + pStack * (d.y1 - d.y0);
        const rS = d.r0 + pStack * (d.r1 - d.r0);
        const cxB = d.barX + d.barW / 2;
        const cyB = d.barY + d.barH / 2;
        const cx = cxS + pBar * (cxB - cxS);
        const cy = cyS + pBar * (cyB - cyS);
        const w0 = 2 * rS;
        const h0 = 2 * rS;
        w = w0 + pBar * (d.barW - w0);
        h = h0 + pBar * (d.barH - h0);
        rx = Math.min(rS * (1 - pBar) + pBar * 0.25, w / 2, h / 2);
        const thin = pBar > 0.88 ? 0.18 : 0.75;
        x = cx - w / 2;
        y = cy - h / 2;
        fillOp = baseOp;
        strokeOp = baseOp * (pBar > 0.9 ? 0.35 : 1);
        strokeW = thin;
        dash = pBar > 0.15 || isRated(d) ? null : "2.5 2.5";
      }

      const anc = timelineAnchors?.get(d.id);
      const hMove = hlRaw * hlRaw * (3 - 2 * hlRaw);
      if (anc && hlRaw < 1) {
        const panelOpen = typeof getTimelinePanelOpen === "function" ? getTimelinePanelOpen() : false;
        const anchorX =
          typeof timelineYearToX === "function" ? timelineYearToX(d.year, panelOpen) : anc.x;
        const cxm = x + w / 2;
        const cym = y + h / 2;
        const rm = Math.min(rx, w / 2, h / 2);
        const mx = anchorX + hMove * (cxm - anchorX);
        const my = anc.y + hMove * (cym - anc.y);
        const mr = anc.r + hMove * (rm - anc.r);
        x = mx - mr;
        y = my - mr;
        w = h = 2 * mr;
        rx = mr;
      } else if (!anc && hlRaw < 1) {
        const fadeIn = Math.min(1, Math.max(0, (hlRaw - 0.06) / 0.38));
        fillOp *= fadeIn;
        strokeOp *= fadeIn;
      }

      sel
        .attr("x", x)
        .attr("y", y)
        .attr("width", Math.max(0.5, w))
        .attr("height", Math.max(0.5, h))
        .attr("rx", Math.max(0, rx))
        .attr("ry", Math.max(0, rx))
        .attr("fill-opacity", fillOp)
        .attr("stroke-opacity", strokeOp)
        .attr("stroke-width", strokeW)
        .attr("stroke-dasharray", dash);
    });
  }

  function readProgress() {
    if (!track) return 0;
    const tr = track.getBoundingClientRect();
    const travel = Math.max(1, track.offsetHeight - window.innerHeight);
    const scrolled = Math.min(Math.max(-tr.top, 0), travel);
    return scrolled / travel;
  }

  let scheduled = false;
  function onScroll() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      frame(readProgress());
    });
  }

  frame(0);

  if (embedInParentScroll) {
    return { frame };
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
}

export function renderMorph(container, { stage, byDecade, movies, sentimentFeatures }) {
  clear(container);

  const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgNode.setAttribute("viewBox", `0 0 ${VIEW.width} ${VIEW.height}`);
  svgNode.setAttribute("width", "100%");
  svgNode.setAttribute("height", "auto");
  container.append(svgNode);
  const svg = d3.select(svgNode);

  if (stage === 0) drawColorOverTime(svg, movies);
  else if (stage === 1) drawGenreStacks(svg, buildGenreRows(movies));
  else if (stage === 2)
    drawSentimentStrip(svg, buildSentimentPoints(movies, sentimentFeatures), { embed: false });
  else drawScatter(svg, buildScatter(movies, sentimentFeatures), { embed: false });
}

function buildSentimentToScatterNodes(movies, sentimentFeatures) {
  const meta = sentimentFeatureByTmdb(sentimentFeatures);
  return (movies || [])
    .filter((m) => m.year && m.dominantHex && meta.has(Number(m.tmdbId)))
    .map((m, i) => {
      const { toneScore, sentimentLabel } = meta.get(Number(m.tmdbId));
      return {
        tmdbId: Number(m.tmdbId),
        year: m.year,
        lum: brightness(m.dominantHex),
        score: toneScore,
        toneScore,
        sentimentLabel,
        color: m.dominantHex,
        title: m.title,
        genres: Array.isArray(m.genres) ? m.genres : [],
        jitter: ((hash32(`${m.tmdbId}-${i}`) % 1000) / 1000 - 0.5) * 10,
      };
    });
}

/**
 * Pinned ch.04: year×sentiment strip morphs into brightness×sentiment scatter (same films, same y).
 * Copy lives in HTML; optional notes + scatter labels fade via frame().
 */
export function renderSentimentToScatterPinned(container, { movies, sentimentFeatures }) {
  clear(container);
  const PW = SENTIMENT_SCATTER_PINNED.width;
  const PH = SENTIMENT_SCATTER_PINNED.height;
  const PM = SENTIMENT_SCATTER_PINNED.margin;
  const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgNode.setAttribute("viewBox", `0 0 ${PW} ${PH}`);
  svgNode.setAttribute("width", "100%");
  svgNode.setAttribute("height", "100%");
  container.append(svgNode);
  const svg = d3.select(svgNode);

  const nodes = buildSentimentToScatterNodes(movies, sentimentFeatures);
  if (!nodes.length) return null;

  const left = PM.left;
  const right = PW - PM.right;
  const top = PM.top;
  const bottom = PH - PM.bottom;
  const yearExtent = d3.extent(nodes, (d) => d.year);
  const xYear = d3.scaleLinear().domain(yearExtent).nice().range([left, right]);
  const xLum = d3.scaleLinear().domain([0, 100]).range([left, right]);
  const y = d3.scaleLinear().domain([-1, 1]).range([bottom, top]);

  const d0 = Math.floor(yearExtent[0] / 10) * 10;
  const d1 = Math.ceil(yearExtent[1] / 10) * 10;
  const decadeYears = d3.range(d0, d1 + 1, 10);

  const gBands = svg.append("g").attr("class", "ss-bands");
  for (let i = 0; i < decadeYears.length - 1; i++) {
    const xa0 = Math.max(left, xYear(decadeYears[i]));
    const xa1 = Math.min(right, xYear(decadeYears[i + 1]));
    gBands
      .append("rect")
      .attr("x", xa0)
      .attr("y", top)
      .attr("width", Math.max(0, xa1 - xa0))
      .attr("height", bottom - top)
      .attr("fill", i % 2 === 0 ? "#fafafa" : "#ffffff")
      .attr("stroke", "none");
  }

  svg
    .append("line")
    .attr("class", "ss-zero")
    .attr("x1", left)
    .attr("x2", right)
    .attr("y1", y(0))
    .attr("y2", y(0))
    .attr("stroke", RULE)
    .attr("stroke-width", 1.5);

  const byDecade = d3
    .rollups(
      nodes,
      (v) => d3.mean(v, (p) => p.score),
      (p) => Math.floor(p.year / 10) * 10
    )
    .map(([decade, mean]) => ({ decade, mean }))
    .sort((a, b) => a.decade - b.decade);

  const meanLine = d3
    .line()
    .x((d) => xYear(d.decade + 5))
    .y((d) => y(d.mean))
    .curve(d3.curveMonotoneX);

  const gMean = svg.append("g").attr("class", "ss-mean");
  const meanPath = gMean
    .append("path")
    .datum(byDecade)
    .attr("fill", "none")
    .attr("stroke", ACCENT)
    .attr("stroke-width", 3)
    .attr("stroke-linecap", "round")
    .attr("d", meanLine);
  const meanLen = meanPath.node().getTotalLength();
  meanPath.attr("stroke-dasharray", `${meanLen}`).attr("stroke-dashoffset", `${meanLen}`);

  gMean
    .selectAll("circle.mean")
    .data(byDecade)
    .join("circle")
    .attr("class", "mean")
    .attr("cx", (d) => xYear(d.decade + 5))
    .attr("cy", (d) => y(d.mean))
    .attr("r", 5.5)
    .attr("fill", ACCENT)
    .attr("stroke", "#fff")
    .attr("stroke-width", 2)
    .style("opacity", 0);

  const notesG = svg.append("g").attr("class", "ss-notes");
  const noteY0 = 54;
  [
    "Blue line & blue dots on it: for each release decade we average the tone scores of every film in that decade,",
    "plot that one number at the decade’s centre, and connect the points — so it summarizes the era, not a single film.",
  ].forEach((txt, i) => {
    notesG
      .append("text")
      .attr("x", PM.left)
      .attr("y", noteY0 + i * 20)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 15)
      .attr("font-weight", 500)
      .text(txt);
  });

  const extremes = [...nodes]
    .map((p) => ({ ...p, dist: Math.abs(p.score) + Math.abs(p.lum - 50) / 80 }))
    .sort((a, b) => b.dist - a.dist)
    .slice(0, 3);

  const gLbl = svg.append("g").attr("class", "ss-scatter-lbl");
  gLbl
    .selectAll("text.lbl")
    .data(extremes)
    .join("text")
    .attr("class", "lbl")
    .attr("fill", INK)
    .attr("font-family", FONT)
    .attr("font-size", 16)
    .attr("font-weight", 700)
    .text((d) => `${d.title} (${d.year})`);

  const yAxisG = svg.append("g").attr("class", "ss-axis-y");
  const yAxisGen = d3
    .axisLeft(y)
    .tickValues([-1, 0, 1])
    .tickFormat((v) => (v >= 1 ? "Positive" : v <= -1 ? "Negative" : "Neutral"));
  yAxisG
    .attr("transform", `translate(${PM.left}, 0)`)
    .call(yAxisGen)
    .call((g) => g.select(".domain").attr("stroke", RULE))
    .call((g) => g.selectAll(".tick line").attr("stroke", RULE));
  yAxisG
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", "16px")
    .style("font-weight", "500");

  const xStripG = svg.append("g").attr("class", "ss-axis-x-strip");
  const xStripAxis = d3
    .axisBottom(xYear)
    .tickValues(decadeYears)
    .tickFormat((d) => String(Math.round(d)));
  xStripG
    .attr("transform", `translate(0, ${PH - PM.bottom})`)
    .call(xStripAxis)
    .call((g) => g.select(".domain").attr("stroke", RULE))
    .call((g) => g.selectAll(".tick line").attr("stroke", RULE));
  xStripG
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", "16px")
    .style("font-weight", "500");

  const brightnessTicks = [0, 20, 40, 60, 80, 100];
  const xScatG = svg.append("g").attr("class", "ss-axis-x-scatter");
  const xScatAxis = d3
    .axisBottom(xLum)
    .tickValues(brightnessTicks)
    .tickFormat((d) => String(Math.round(d)));
  xScatG
    .attr("transform", `translate(0, ${PH - PM.bottom})`)
    .call(xScatAxis)
    .call((g) => g.select(".domain").attr("stroke", RULE))
    .call((g) => g.selectAll(".tick line").attr("stroke", RULE));
  xScatG
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", "16px")
    .style("font-weight", "500");

  const capStrip = svg
    .append("text")
    .attr("class", "ss-cap-strip")
    .attr("x", PW - PM.right)
    .attr("y", PH - 16)
    .attr("text-anchor", "end")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text("Release year");

  const capScat = svg
    .append("text")
    .attr("class", "ss-cap-scatter")
    .attr("x", PW - PM.right)
    .attr("y", PH - 16)
    .attr("text-anchor", "end")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text("Poster brightness");

  const gDots = svg.append("g").attr("class", "ss-dots");
  const DOT_R0 = 5;
  const DOT_R1 = 5.5;

  const filmDots = gDots
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", DOT_R0)
    .attr("fill", (d) => d.color)
    .attr("fill-opacity", (d) => (d.color ? 0.92 : 0.55))
    .attr("stroke", "rgba(10,10,10,0.18)")
    .attr("stroke-width", 0.6)
    .style("cursor", "pointer")
    .on("mouseenter", (event, d) => showFilmTooltip(event, d))
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  function posFor(d, morph) {
    const jit = d.jitter * (1 - morph);
    const xS = xYear(d.year) + jit;
    const xE = xLum(d.lum);
    const cx = xS + morph * (xE - xS);
    const cy = y(d.score);
    return { cx, cy };
  }

  function updateLabels(morph) {
    gLbl.selectAll("text.lbl").each(function (d) {
      const { cx, cy } = posFor(d, morph);
      d3.select(this).attr("x", cx + 14).attr("y", cy + 4);
    });
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    frame(opts) {
      let morph = Math.max(0, Math.min(1, opts.morph));
      if (reduceMotion) morph = 1;
      const notesOp = Math.max(0, Math.min(1, opts.notes ?? 1));
      const lblOp = Math.max(0, Math.min(1, opts.scatterLbl ?? 0));
      const meanLineOp = Math.max(0, Math.min(1, opts.meanLine ?? 1));
      const stripOp = 1 - morph;

      gBands.style("opacity", stripOp * 0.92);
      gMean.style("opacity", stripOp);
      meanPath.attr("stroke-dashoffset", meanLen * (1 - meanLineOp));
      gMean.selectAll("circle.mean").style("opacity", meanLineOp);
      notesG.style("opacity", notesOp);
      xStripG.style("opacity", stripOp);
      capStrip.style("opacity", stripOp);
      xScatG.style("opacity", morph);
      capScat.style("opacity", morph);

      filmDots.each(function (d) {
        const { cx, cy } = posFor(d, morph);
        d3.select(this).attr("cx", cx).attr("cy", cy).attr("r", DOT_R0 + morph * (DOT_R1 - DOT_R0));
      });

      updateLabels(morph);
      gLbl.style("opacity", lblOp);
    },
  };
}

/* ---------- shared header + grid ---------- */

function plotBounds() {
  return {
    left: MARGIN.left,
    right: VIEW.width - MARGIN.right,
    top: MARGIN.top,
    bottom: VIEW.height - MARGIN.bottom,
  };
}

function drawMorphHeader(svg, title, subtitle) {
  const g = svg.append("g").attr("class", "morph-header");
  g.append("text")
    .attr("x", MARGIN.left)
    .attr("y", 42)
    .attr("fill", INK)
    .attr("font-family", FONT)
    .attr("font-size", 28)
    .attr("font-weight", 700)
    .attr("letter-spacing", "-0.02em")
    .text(title);
  g.append("text")
    .attr("x", MARGIN.left)
    .attr("y", 78)
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", 17)
    .attr("font-weight", 400)
    .text(subtitle);
}

function drawPlotGrid(svg, x, decadeYears) {
  const { top, bottom, left, right } = plotBounds();
  const bg = svg.append("g").attr("class", "plot-grid");
  const years = decadeYears || [];
  for (let i = 0; i < years.length - 1; i++) {
    const x0 = Math.max(left, x(years[i]));
    const x1 = Math.min(right, x(years[i + 1]));
    bg.append("rect")
      .attr("x", x0)
      .attr("y", top)
      .attr("width", Math.max(0, x1 - x0))
      .attr("height", bottom - top)
      .attr("fill", i % 2 === 0 ? "#fafafa" : "#ffffff")
      .attr("stroke", "none");
  }
  bg.append("line")
    .attr("x1", left)
    .attr("x2", right)
    .attr("y1", bottom)
    .attr("y2", bottom)
    .attr("stroke", RULE)
    .attr("stroke-width", 1.5);
  bg.append("line")
    .attr("x1", left)
    .attr("x2", left)
    .attr("y1", top)
    .attr("y2", bottom)
    .attr("stroke", RULE)
    .attr("stroke-width", 1.5);
}

/* =========================================================
   STAGE 0 — Color over time: year × luminosity (readable)
   Y = how light the dominant color reads (0 dark … 100 light).
   ========================================================= */

function hash32(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function drawColorOverTime(svg, movies) {
  const MIN_VOTES = 20;
  const radiusDomain = [5, 8.5];
  const radiusRange = [5, 18];
  const rScale = d3.scalePow().exponent(1.55).domain(radiusDomain).range(radiusRange).clamp(true);
  const neutralRadius = 8;

  const radiusFor = (d) =>
    d.voteAverage != null && d.voteCount >= MIN_VOTES ? rScale(d.voteAverage) : neutralRadius;
  const isRated = (d) => d.voteAverage != null && d.voteCount >= MIN_VOTES;

  const nodes = (movies || [])
    .filter((m) => m.year && m.dominantHex)
    .map((m) => ({
      id: String(m.tmdbId ?? `${m.title}-${m.year}`),
      year: m.year,
      lum: brightness(m.dominantHex),
      color: m.dominantHex,
      title: m.title,
      group: classifyColor(m.dominantHex),
      genres: Array.isArray(m.genres) ? m.genres : [],
      voteAverage:
        typeof m.voteAverage === "number" && m.voteAverage > 0 ? m.voteAverage : null,
      voteCount: typeof m.voteCount === "number" && m.voteCount > 0 ? m.voteCount : 0,
    }));

  if (!nodes.length) return;

  drawMorphHeader(
    svg,
    "Colour through the years",
    "Each dot is one remake. Horizontal: release year · Vertical: how light the dominant colour is · Fill: that colour · Size: TMDB popularity (score, when enough votes)"
  );

  const { top, bottom, left, right } = plotBounds();
  const yearExtent = d3.extent(nodes, (d) => d.year);
  const x = d3.scaleLinear().domain(yearExtent).nice().range([left, right]);
  const y = d3.scaleLinear().domain([0, 100]).nice().range([bottom, top]);

  const d0 = Math.floor(d3.min(nodes, (d) => d.year) / 10) * 10;
  const d1 = Math.ceil(d3.max(nodes, (d) => d.year) / 10) * 10;
  const decadeYears = d3.range(d0, d1 + 1, 10);
  drawPlotGrid(svg, x, decadeYears);

  const sim = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((d) => x(d.year)).strength(0.85))
    .force("y", d3.forceY((d) => y(d.lum)).strength(0.85))
    .force("collide", d3.forceCollide((d) => radiusFor(d) + 0.9).iterations(5))
    .stop();
  for (let i = 0; i < 480; i++) sim.tick();

  const pad = 2;
  for (const d of nodes) {
    const r = radiusFor(d);
    d.x = Math.max(left + r + pad, Math.min(right - r - pad, d.x));
    d.y = Math.max(top + r + pad, Math.min(bottom - r - pad, d.y));
  }
  const settle = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((d) => x(d.year)).strength(0.35))
    .force("y", d3.forceY((d) => y(d.lum)).strength(0.35))
    .force("collide", d3.forceCollide((d) => radiusFor(d) + 0.9).iterations(6))
    .stop();
  for (let i = 0; i < 140; i++) settle.tick();
  for (const d of nodes) {
    const r = radiusFor(d);
    d.x = Math.max(left + r + pad, Math.min(right - r - pad, d.x));
    d.y = Math.max(top + r + pad, Math.min(bottom - r - pad, d.y));
  }

  const filmDots = svg
    .selectAll("circle.film-dot")
    .data(nodes)
    .join("circle")
    .attr("class", "film-dot")
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", 0)
    .attr("fill", (d) => d.color)
    .attr("fill-opacity", (d) => (isRated(d) ? 0.92 : 0.4))
    .attr("stroke", "rgba(10,10,10,0.35)")
    .attr("stroke-width", 0.75)
    .attr("stroke-dasharray", (d) => (isRated(d) ? null : "2.5 2.5"))
    .style("cursor", "pointer");

  filmDots
    .on("mouseenter", (event, d) => showFilmTooltip(event, d))
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  filmDots
    .transition()
    .duration(420)
    .delay((_, i) => Math.min(i * 0.9, 400))
    .attr("r", (d) => radiusFor(d));

  const decadeTicks = d3.range(
    Math.ceil(d3.min(nodes, (d) => d.year) / 10) * 10,
    d3.max(nodes, (d) => d.year) + 1,
    10
  );

  svg
    .append("g")
    .attr("transform", `translate(0, ${bottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(decadeTicks)
        .tickFormat(d3.format("d"))
        .tickSize(0)
    )
    .call((g) => g.select(".domain").remove())
    .call((g) =>
      g
        .selectAll("text")
        .attr("fill", MUTED)
        .attr("font-family", FONT)
        .style("font-size", "16px")
        .style("font-weight", "600")
    );

  svg
    .append("g")
    .attr("transform", `translate(${left}, 0)`)
    .call(
      d3
        .axisLeft(y)
        .ticks(6)
        .tickSize(0)
    )
    .call((g) => g.select(".domain").remove())
    .call((g) =>
      g
        .selectAll("text")
        .attr("fill", MUTED)
        .attr("font-family", FONT)
        .style("font-size", "16px")
        .style("font-weight", "500")
    );

  svg
    .append("text")
    .attr("x", right)
    .attr("y", VIEW.height - 16)
    .attr("text-anchor", "end")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text("Release year →");

  svg
    .append("text")
    .attr("transform", `translate(28, ${(top + bottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text("← Darker colour … lighter colour →");
}

/* =========================================================
   STAGE 1 — Genre × colour groups (cleaner stack + legend)
   ========================================================= */

function buildGenreRows(movies) {
  const table = new Map();
  (movies || []).forEach((movie) => {
    const group = classifyColor(movie.dominantHex);
    (movie.genres || []).forEach((genre) => {
      if (!table.has(genre)) table.set(genre, new Map());
      const row = table.get(genre);
      row.set(group, (row.get(group) || 0) + 1);
    });
  });
  return [...table.entries()]
    .map(([genre, map]) => ({
      genre,
      total: [...map.values()].reduce((a, b) => a + b, 0),
      dist: COLOR_GROUPS.map((group) => ({ group, value: map.get(group) || 0 })),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function drawGenreStacks(svg, genreRows) {
  if (!genreRows.length) return;

  drawMorphHeader(
    svg,
    "Which hues show up in each genre?",
    "Bars are TMDB genres (top 8 by film count). Segments stack our seven chromatic families — counts of remakes whose dominant colour falls in each family."
  );

  const stackData = genreRows.map((genre) => {
    const out = { genre: genre.genre };
    genre.dist.forEach((d) => (out[d.group] = d.value));
    return out;
  });
  const series = d3.stack().keys(COLOR_GROUPS)(stackData);
  const x = d3
    .scaleBand()
    .domain(genreRows.map((d) => d.genre))
    .range([MARGIN.left, VIEW.width - MARGIN.right])
    .padding(0.28);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(genreRows, (d) => d.total) || 1])
    .nice()
    .range([VIEW.height - MARGIN.bottom, MARGIN.top]);

  svg
    .append("g")
    .selectAll("g.layer")
    .data(series)
    .join("g")
    .attr("class", "layer")
    .attr("fill", (d) => COLOR_MAP[d.key])
    .selectAll("rect")
    .data((d) => d)
    .join("rect")
    .attr("x", (d) => x(d.data.genre))
    .attr("width", x.bandwidth())
    .attr("y", y(0))
    .attr("height", 0)
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5)
    .transition()
    .duration(600)
    .attr("y", (d) => y(d[1]))
    .attr("height", (d) => Math.max(0, y(d[0]) - y(d[1])));

  axes(svg, x, y, { rotate: -28, xLabel: "Genre", yLabel: "Number of films" });

  const leg = svg.append("g").attr("transform", `translate(${VIEW.width - MARGIN.right - 220}, ${MARGIN.top + 8})`);
  COLOR_GROUPS.forEach((name, i) => {
    const row = leg.append("g").attr("transform", `translate(0, ${i * 28})`);
    row.append("rect").attr("width", 18).attr("height", 18).attr("fill", COLOR_MAP[name]).attr("rx", 3);
    row
      .append("text")
      .attr("x", 26)
      .attr("y", 14)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 15)
      .attr("font-weight", 600)
      .text(name);
  });
}

/* =========================================================
   STAGE 2 — Sentiment vs year
   ========================================================= */

function sentimentFeatureByTmdb(sentimentFeatures) {
  const map = new Map();
  for (const item of sentimentFeatures || []) {
    const id = Number(item.tmdbId);
    if (!Number.isFinite(id)) continue;
    if (String(item.sentimentLabel || "").toLowerCase() === "no_overview") continue;
    const pos = Number(item.sentimentScores?.positive || 0);
    const neg = Number(item.sentimentScores?.negative || 0);
    map.set(id, {
      toneScore: pos - neg,
      sentimentLabel: item.sentimentLabel || "",
    });
  }
  return map;
}

function buildSentimentPoints(movies, sentimentFeatures) {
  const meta = sentimentFeatureByTmdb(sentimentFeatures);
  return (movies || [])
    .filter((m) => m.year && meta.has(Number(m.tmdbId)))
    .map((m, i) => {
      const { toneScore, sentimentLabel } = meta.get(Number(m.tmdbId));
      return {
        year: m.year,
        score: toneScore,
        toneScore,
        sentimentLabel,
        title: m.title,
        color: m.dominantHex || null,
        genres: Array.isArray(m.genres) ? m.genres : [],
        jitter: ((hash32(`${m.tmdbId}-${i}`) % 1000) / 1000 - 0.5) * 10,
      };
    });
}

function drawSentimentStrip(svg, points, opts = {}) {
  const { embed = false } = opts;
  if (!points.length) return { notesGroup: null };

  const DOT_R = 5;
  let notesGroup = null;

  if (!embed) {
    drawMorphHeader(
      svg,
      "How plot summaries sound over time",
      `Each dot is one film with a scored overview (${points.length} films). Vertical: summary tone from the English text (−1…+1). Horizontal: release year. Dot fill: dominant poster colour; same size for all.`
    );
  }

  const noteY0 = embed ? 72 : 100;
  const noteMount = embed
    ? (notesGroup = svg.append("g").attr("class", "sentiment-embed-notes"))
    : svg;
  [
    "Blue line & blue dots on it: for each release decade we average the tone scores of every film in that decade,",
    "plot that one number at the decade’s centre, and connect the points — so it summarizes the era, not a single film.",
  ].forEach((line, i) => {
    noteMount
      .append("text")
      .attr("x", MARGIN.left)
      .attr("y", noteY0 + i * 22)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 15)
      .attr("font-weight", 500)
      .text(line);
  });
  if (!embed) notesGroup = null;

  const x = d3
    .scaleLinear()
    .domain(d3.extent(points, (d) => d.year))
    .nice()
    .range([MARGIN.left, VIEW.width - MARGIN.right]);
  const y = d3
    .scaleLinear()
    .domain([-1, 1])
    .range([VIEW.height - MARGIN.bottom, MARGIN.top]);

  const fillFor = (d) => d.color || "#c4c2be";

  svg
    .append("line")
    .attr("x1", MARGIN.left)
    .attr("x2", VIEW.width - MARGIN.right)
    .attr("y1", y(0))
    .attr("y2", y(0))
    .attr("stroke", RULE)
    .attr("stroke-width", 1.5);

  const byDecade = d3
    .rollups(
      points,
      (v) => d3.mean(v, (p) => p.score),
      (p) => Math.floor(p.year / 10) * 10
    )
    .map(([decade, mean]) => ({ decade, mean }))
    .sort((a, b) => a.decade - b.decade);

  const yearExtent = d3.extent(points, (d) => d.year);
  const decadeX0 = Math.floor(yearExtent[0] / 10) * 10;
  const decadeX1 = Math.ceil(yearExtent[1] / 10) * 10;
  const decadeTicks = d3.range(decadeX0, decadeX1 + 1, 10);

  const dots = svg
    .append("g")
    .selectAll("circle")
    .data(points)
    .join("circle")
    .attr("cx", (d) => x(d.year) + d.jitter)
    .attr("cy", (d) => y(d.score))
    .attr("r", 0)
    .attr("fill", (d) => fillFor(d))
    .attr("fill-opacity", (d) => (d.color ? 0.92 : 0.55))
    .attr("stroke", "rgba(10,10,10,0.18)")
    .attr("stroke-width", 0.6);

  dots
    .transition()
    .duration(480)
    .delay((_, i) => Math.min(i * 1.2, 500))
    .attr("r", DOT_R);

  dots
    .on("mouseenter", (event, d) => showFilmTooltip(event, d))
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  const line = d3
    .line()
    .x((d) => x(d.decade + 5))
    .y((d) => y(d.mean))
    .curve(d3.curveMonotoneX);

  const path = svg
    .append("path")
    .datum(byDecade)
    .attr("fill", "none")
    .attr("stroke", ACCENT)
    .attr("stroke-width", 3)
    .attr("stroke-linecap", "round")
    .attr("d", line);
  const len = path.node().getTotalLength();
  path
    .attr("stroke-dasharray", `${len}`)
    .attr("stroke-dashoffset", `${len}`)
    .transition()
    .duration(1000)
    .attr("stroke-dashoffset", 0);

  svg
    .append("g")
    .selectAll("circle.mean")
    .data(byDecade)
    .join("circle")
    .attr("class", "mean")
    .attr("cx", (d) => x(d.decade + 5))
    .attr("cy", (d) => y(d.mean))
    .attr("r", 5.5)
    .attr("fill", ACCENT)
    .attr("stroke", "#fff")
    .attr("stroke-width", 2);

  axes(svg, x, y, {
    xLabel: "Release year",
    xTickValues: decadeTicks,
    xTickFormat: (d) => String(Math.round(d)),
    yTickValues: [-1, 0, 1],
    yTickFormat: (v) => (v >= 1 ? "Positive" : v <= -1 ? "Negative" : "Neutral"),
  });

  return { notesGroup: embed ? notesGroup : null };
}

/* =========================================================
   STAGE 3 — Brightness × sentiment
   ========================================================= */

function buildScatter(movies, sentimentFeatures) {
  const meta = sentimentFeatureByTmdb(sentimentFeatures);
  return (movies || [])
    .filter((movie) => meta.has(Number(movie.tmdbId)) && movie.dominantHex)
    .slice(0, 650)
    .map((movie) => {
      const { toneScore, sentimentLabel } = meta.get(Number(movie.tmdbId));
      return {
        id: Number(movie.tmdbId),
        title: movie.title,
        year: movie.year,
        x: brightness(movie.dominantHex),
        y: toneScore,
        toneScore,
        sentimentLabel,
        color: movie.dominantHex,
        genres: Array.isArray(movie.genres) ? movie.genres : [],
      };
    });
}

function drawScatter(svg, points, opts = {}) {
  const { embed = false } = opts;

  if (!points.length) {
    if (!embed) {
      drawMorphHeader(svg, "Poster brightness vs. summary tone", "No scored films to plot.");
    }
    return { labelsGroup: null };
  }

  if (!embed) {
    drawMorphHeader(
      svg,
      "Poster brightness vs. summary tone",
      `Same ${points.length} scored films as above. Horizontal: how light the dominant poster colour reads (dark left … light right). Vertical: summary tone. Fill: that film’s poster colour — bright look vs. dark wording (or the reverse) is easy to spot.`
    );
  }

  const x = d3.scaleLinear().domain([0, 100]).range([MARGIN.left, VIEW.width - MARGIN.right]);
  const y = d3.scaleLinear().domain([-1, 1]).range([VIEW.height - MARGIN.bottom, MARGIN.top]);
  const brightnessTicks = [0, 20, 40, 60, 80, 100];

  svg
    .append("line")
    .attr("x1", MARGIN.left)
    .attr("x2", VIEW.width - MARGIN.right)
    .attr("y1", y(0))
    .attr("y2", y(0))
    .attr("stroke", RULE)
    .attr("stroke-width", 1.5);

  const dots = svg
    .append("g")
    .selectAll("circle")
    .data(points)
    .join("circle")
    .attr("cx", (d) => x(d.x))
    .attr("cy", (d) => y(d.y))
    .attr("r", 0)
    .attr("fill", (d) => d.color)
    .attr("fill-opacity", 0.88)
    .attr("stroke", "rgba(10,10,10,0.22)")
    .attr("stroke-width", 0.65);

  dots
    .transition()
    .duration(480)
    .delay((_, i) => Math.min(i * 1.5, 400))
    .attr("r", 5.5);

  dots
    .on("mouseenter", (event, d) => showFilmTooltip(event, d))
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  const extremes = [...points]
    .map((p) => ({ ...p, dist: Math.abs(p.y) + Math.abs(p.x - 50) / 80 }))
    .sort((a, b) => b.dist - a.dist)
    .slice(0, 3);

  const labelRoot = embed ? svg.append("g").attr("class", "scatter-embed-labels") : svg;
  labelRoot
    .selectAll("text.lbl")
    .data(extremes)
    .join("text")
    .attr("class", "lbl")
    .attr("x", (d) => x(d.x) + 14)
    .attr("y", (d) => y(d.y) + 4)
    .attr("fill", INK)
    .attr("font-family", FONT)
    .attr("font-size", 16)
    .attr("font-weight", 700)
    .text((d) => `${d.title} (${d.year})`);

  axes(svg, x, y, {
    xLabel: "Poster brightness",
    xTickValues: brightnessTicks,
    xTickFormat: (d) => String(Math.round(d)),
    yTickValues: [-1, 0, 1],
    yTickFormat: (v) => (v >= 1 ? "Positive" : v <= -1 ? "Negative" : "Neutral"),
  });

  return { labelsGroup: embed ? labelRoot : null };
}

/* ---------- axes ---------- */

function axes(svg, x, y, opts = {}) {
  const xAxisGen = d3.axisBottom(x);
  if (opts.xTickValues) xAxisGen.tickValues(opts.xTickValues);
  else xAxisGen.ticks(8);
  if (opts.xTickFormat) xAxisGen.tickFormat(opts.xTickFormat);

  const bottom = svg
    .append("g")
    .attr("transform", `translate(0, ${VIEW.height - MARGIN.bottom})`)
    .call(xAxisGen)
    .call((g) => g.select(".domain").attr("stroke", RULE))
    .call((g) => g.selectAll(".tick line").attr("stroke", RULE));

  bottom
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", "16px")
    .style("font-weight", "500");

  if (opts.rotate) {
    bottom
      .selectAll("text")
      .attr("transform", `translate(-2,10) rotate(${opts.rotate})`)
      .style("text-anchor", "end");
  }

  const yAxisGen = d3.axisLeft(y);
  if (opts.yTickValues) yAxisGen.tickValues(opts.yTickValues);
  else yAxisGen.ticks(5);
  if (opts.yTickFormat) yAxisGen.tickFormat(opts.yTickFormat);

  svg
    .append("g")
    .attr("transform", `translate(${MARGIN.left}, 0)`)
    .call(yAxisGen)
    .call((g) => g.select(".domain").attr("stroke", RULE))
    .call((g) => g.selectAll(".tick line").attr("stroke", RULE))
    .call((g) =>
      g
        .selectAll("text")
        .attr("fill", MUTED)
        .attr("font-family", FONT)
        .style("font-size", "16px")
        .style("font-weight", "500")
    );

  if (opts.xLabel) {
    svg
      .append("text")
      .attr("x", VIEW.width - MARGIN.right)
      .attr("y", VIEW.height - 16)
      .attr("text-anchor", "end")
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 15)
      .attr("font-weight", 700)
      .text(opts.xLabel);
  }
  if (opts.yLabel) {
    svg
      .append("text")
      .attr("transform", `translate(32, ${MARGIN.top + 140}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 15)
      .attr("font-weight", 700)
      .text(opts.yLabel);
  }
}

function escape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { clear, classifyColor, hueDegrees, brightness, COLOR_GROUPS, COLOR_MAP } from "./color.js";
import { showTooltip, moveTooltip, hideTooltip } from "./tooltip.js";
import {
  morphNicedYearDomain,
  morphDecadeStartsForBands,
  morphBottomDecadeTickYears,
  morphRawYearExtents,
  morphTimeScale,
} from "./shared-morph-time-axis.js";

const VIEW = { width: 2040, height: 760 };
/** Ch.03 scrolly only — taller than VIEW so the chart fills more vertical space on screen. */
const VIEW_SCROLLY_HEIGHT = 1020;
const MARGIN = { top: 124, right: 28, bottom: 60, left: 92 };
const ACCENT = "var(--accent)";
const INK = "#0a0a0a";
const MUTED = "#5c5c5c";
const RULE = "#e6e6e6";
const FONT = 'IBM Plex Sans, "Helvetica Neue", sans-serif';
const AXIS_TICK_PX = 16;
const AXIS_CAPTION_PX = 16;

function brightnessPlusMinusTick(v) {
  if (v >= 100) return "+";
  if (v <= 0) return "-";
  return "";
}

function formatGenreLine(genres) {
  if (!Array.isArray(genres) || !genres.length) return "—";
  return escape(String(genres[0]));
}

function showFilmTooltip(event, d) {
  const year = d.year != null ? d.year : "—";
  const sub = `${year} · ${formatGenreLine(d.genres)}`;
  showTooltip(
    event,
    `<span class="t-title">${escape(d.title)}</span><span class="t-sub">${sub}</span>`,
    { film: true, accent: d.color || d.dominantHex || null }
  );
}

function smoothstep01(t, edge0, edge1) {
  if (t <= edge0) return 0;
  if (t >= edge1) return 1;
  const x = (t - edge0) / (edge1 - edge0);
  return x * x * (3 - 2 * x);
}

const FALLBACK_GENRE_BUCKET = "Drama";

const SCROLL_GENRE_ORDER = [
  "Drama",
  "Comedy",
  "Thriller",
  "Action",
  "Crime",
  "Romance",
  "Science Fiction",
  "Horror",
];

function normalizeGenreKey(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function canonicalScrollGenre(raw) {
  if (raw == null) return null;
  const s = normalizeGenreKey(raw);
  const aliases = {
    "science fiction": "Science Fiction",
    "science-fiction": "Science Fiction",
    "sci-fi": "Science Fiction",
    "sci fi": "Science Fiction",
  };
  if (aliases[s]) return aliases[s];
  for (const label of SCROLL_GENRE_ORDER) {
    if (label.toLowerCase() === s) return label;
  }
  return null;
}

function heuristicBucketFromTmdbGenre(raw) {
  const s = normalizeGenreKey(raw);
  if (!s) return null;
  const MAP = {
    mystery: "Thriller",
    "film noir": "Crime",
    noir: "Crime",
    fantasy: "Science Fiction",
    adventure: "Action",
    animation: "Comedy",
    family: "Drama",
    war: "Drama",
    history: "Drama",
    documentary: "Drama",
    music: "Drama",
    musical: "Drama",
    western: "Action",
    "tv movie": "Drama",
    "tv film": "Drama",
    sport: "Drama",
    news: "Drama",
    "science fiction": "Science Fiction",
    "science-fiction": "Science Fiction",
    "sci-fi": "Science Fiction",
    "sci fi": "Science Fiction",
  };
  if (MAP[s]) return MAP[s];
  return null;
}

function genreToEightBucket(raw) {
  return canonicalScrollGenre(raw) ?? heuristicBucketFromTmdbGenre(raw);
}

/**
 * {@link FALLBACK_GENRE_BUCKET}.
 */
function bucketGenreForFilm(genresArray) {
  const list = Array.isArray(genresArray) ? genresArray : [];
  for (const g of list) {
    const b = genreToEightBucket(g);
    if (b) return b;
  }
  return FALLBACK_GENRE_BUCKET;
}

function bucketForFilm(d) {
  return bucketGenreForFilm(d.genres);
}

function genreColumnOrder(nodes) {
  const counts = new Map(
    SCROLL_GENRE_ORDER.map((g) => [g, 0])
  );
  for (const d of nodes) {
    const b = d.bucket;
    if (b && counts.has(b)) counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...SCROLL_GENRE_ORDER].sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca !== cb) return ca - cb;
    return SCROLL_GENRE_ORDER.indexOf(a) - SCROLL_GENRE_ORDER.indexOf(b);
  });
}

/**
 * @param {{ movies: unknown[], embedInParentScroll?: boolean, embedSpec?: { viewHeight: number, margin: { top: number, right: number, bottom: number, left: number } }, timelineAnchors?: Map<string, { x: number, y: number, r: number }>, getHandoffLerp?: () => number, timelineClick?: { handoffMax: number, laneForTmdb: (tmdbKey: string) => string | null, selectLane: (laneId: string) => void }, getTimelinePanelOpen?: () => boolean, timelineFilmToX?: (tmdbKey: string, panelOpen: boolean) => number, timelineYearToX?: (year: number, panelOpen: boolean) => number }} opts
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
    timelineFilmToX = null,
    timelineYearToX = null,
  } = {}
) {
  clear(container);

  const MIN_VOTES = 20;
  const filmDotRadius = 12;
  const radiusFor = () => filmDotRadius;
  const isRated = (d) => d.voteAverage != null && d.voteCount >= MIN_VOTES;
  const colorOrder = new Map(COLOR_GROUPS.map((g, i) => [g, i]));
  const colorSortKey = (d) => colorOrder.get(d.group) ?? 999;
  const LUM_BIN_SIZE = 4; // 0..100 in ~25 levels
  const quantLum = (lum) => Math.round(lum / LUM_BIN_SIZE) * LUM_BIN_SIZE;

  const nodes = (movies || [])
    .filter((m) => m.year && m.dominantHex)
    .map((m) => ({
      id: String(m.tmdbId ?? `${m.title}-${m.year}`),
      year: m.year,
      lum: brightness(m.dominantHex),
      lumQ: quantLum(brightness(m.dominantHex)),
      color: m.dominantHex,
      title: m.title,
      group: classifyColor(m.dominantHex),
      hue: hueDegrees(m.dominantHex),
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
  const yearExtentRaw = d3.extent(nodes, (d) => d.year);
  const domainNice = morphNicedYearDomain(yearExtentRaw);
  const xTime = morphTimeScale(left, right, domainNice);
  const yTime = d3.scaleLinear().domain([0, 100]).nice().range([bottom, top]);
  const yByLum = d3.scaleLinear().domain([0, 100]).nice().range([bottom - 14, top + 10]);
  const yAxisBright = d3.scaleLinear().domain([0, 100]).range([bottom, top]);

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

  const genreLabels = genreColumnOrder(nodes);
  const xBand = d3.scaleBand().domain(genreLabels).range([left, right]).padding(0.38);
  const stackGap = 4;
  const rStack = (d) => Math.max(4.2, Math.min(11, radiusFor(d) * 0.62));

  genreLabels.forEach((lab) => {
    const col = nodes
      .filter((d) => d.bucket === lab)
      .sort(
        (a, b) =>
          a.lumQ - b.lumQ ||
          colorSortKey(a) - colorSortKey(b) ||
          a.hue - b.hue ||
          a.lum - b.lum ||
          String(a.id).localeCompare(String(b.id))
      );
    const cx = xBand(lab) + xBand.bandwidth() / 2;
    let belowCenter = null;
    let belowR = 0;
    col.forEach((n) => {
      const rr = rStack(n);
      let cy = yByLum(n.lumQ);
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
    const plotH = bottom - top - 20;
    const lineH = Math.max(1.55, Math.min(4.8, plotH / maxN));
    const vGap = 0.34;
    const barMaxBottom = bottom - 2;

    genreLabels.forEach((lab) => {
      const col = nodes
        .filter((d) => d.bucket === lab)
        .sort(
          (a, b) =>
            a.lumQ - b.lumQ ||
            colorSortKey(a) - colorSortKey(b) ||
            a.hue - b.hue ||
            a.lum - b.lum ||
            String(a.id).localeCompare(String(b.id))
        );
      const bw = Math.max(4, xBand.bandwidth() - 2);
      const xLeft = xBand(lab) + 1;
      col.forEach((n) => {
        const cy = yByLum(n.lumQ);
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

  const yrExt = morphRawYearExtents(nodes);
  const decadeYears =
    yrExt != null ? morphDecadeStartsForBands(yrExt[0], yrExt[1]) : [];

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
      .attr("fill", "none")
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
      .attr("fill", "none")
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
      .text("Color through the years");
    gHeaderTime
      .append("text")
      .attr("x", left)
      .attr("y", 78)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 17)
      .text("Scroll — the same films regroup into eight genre columns below.");

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
        "Each film is assigned using its TMDB genres in order: the first that maps to one of the eight columns (direct match or mapped, e.g. Adventure→Action). Vertical scale is poster brightness (darker toward the bottom)."
      );

    gHeaderBarcode
      .append("text")
      .attr("x", left)
      .attr("y", 42)
      .attr("fill", INK)
      .attr("font-family", FONT)
      .attr("font-size", 28)
      .attr("font-weight", 700)
      .text("Genre color barcodes");
    gHeaderBarcode
      .append("text")
      .attr("x", left)
      .attr("y", 78)
      .attr("fill", MUTED)
      .attr("font-family", FONT)
      .attr("font-size", 17)
      .text(
        "Horizontal stripes — one film per stripe, aligned to the same brightness scale on the left."
      );
  } else {
    gHeaderTime.style("display", "none");
    gHeaderGenre.style("display", "none");
    gHeaderBarcode.style("display", "none");
  }

  const decadeTicks =
    yrExt != null ? morphBottomDecadeTickYears(yrExt[0], yrExt[1]) : [];
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
    .style("font-size", `${AXIS_TICK_PX}px`)
    .style("font-weight", "600");

  const gAxisTimeY = svg
    .append("g")
    .attr("transform", `translate(${left}, 0)`)
    .call(
      d3.axisLeft(yAxisBright).tickValues([0, 100]).tickFormat(brightnessPlusMinusTick).tickSize(0)
    )
    .call((g) => g.select(".domain").remove());
  gAxisTimeY
    .selectAll("text")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .style("font-size", `${AXIS_TICK_PX}px`)
    .style("font-weight", "500");

  const gAxisGenre = svg.append("g").attr("class", "morph-axis-genre").style("opacity", 0);
  genreLabels.forEach((lab) => {
    const cx = xBand(lab) + xBand.bandwidth() / 2;
    const short =
      lab === "Science Fiction"
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
    .attr("font-size", AXIS_CAPTION_PX)
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
    .attr("font-size", AXIS_CAPTION_PX)
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
    const tt0 = reduceMotion ? 1 : t;
    const HOLD_AT = 0.34;
    const HOLD_LEN = 0.22;
    let tt = tt0;
    if (tt0 > HOLD_AT && tt0 < HOLD_AT + HOLD_LEN) tt = HOLD_AT;
    else if (tt0 >= HOLD_AT + HOLD_LEN) tt = tt0 - HOLD_LEN;
    tt = Math.max(0, Math.min(1, tt / (1 - HOLD_LEN)));

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

    const yAxisOp = Math.max(uTime, uAxisGenre) * chromeTime;
    gBandsTime.style("opacity", uTime * chromeTime);
    gAxisTimeX.style("opacity", uTime * chromeTime);
    gAxisTimeY.style("opacity", yAxisOp);
    svg.selectAll(".morph-caption-time-y").style("opacity", yAxisOp);
    svg.selectAll(".morph-caption-time-x").style("opacity", uTime * chromeTime);
    gHeaderTime.style("opacity", uTime * chromeTime);
    gBandsGenre.style("opacity", Math.min(1, uGenreBands) * Math.max(0.15, hlSmooth));
    gAxisGenre.style("opacity", uAxisGenre * Math.max(0.15, hlSmooth));
    gHeaderGenre.style("opacity", uGenreStackHdr * Math.max(0.15, hlSmooth));
    gHeaderBarcode.style("opacity", uBarcodeHdr * Math.max(0.15, hlSmooth));

    const tooltipsOn = uTime > 0.65;
    marks.style("pointer-events", tooltipsOn ? "auto" : "none");
    if (!tooltipsOn) hideTooltip();

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
        const lumPoster = brightness(d.color);
        const lightPoster = lumPoster > 66;
        let strokeWide = pBar > 0.88 ? 0.22 : 0.75;
        if (pBar > 0.82 && lightPoster) strokeWide = Math.max(strokeWide, 0.48);
        x = cx - w / 2;
        y = cy - h / 2;
        fillOp = baseOp;
        strokeOp =
          baseOp *
          (pBar > 0.9 ? (lightPoster ? 0.52 : 0.38) : 1);
        strokeW = strokeWide;
        dash = pBar > 0.15 || isRated(d) ? null : "2.5 2.5";
      }

      const anc = timelineAnchors?.get(d.id);
      const hMove = hlRaw * hlRaw * (3 - 2 * hlRaw);
      if (anc && hlRaw < 1) {
        const panelOpen = typeof getTimelinePanelOpen === "function" ? getTimelinePanelOpen() : false;
        const anchorX =
          typeof timelineFilmToX === "function"
            ? timelineFilmToX(d.id, panelOpen)
            : typeof timelineYearToX === "function"
              ? timelineYearToX(d.year, panelOpen)
              : anc.x;
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
      .attr("fill", "none")
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


function drawColorOverTime(svg, movies) {
  const MIN_VOTES = 20;
  const filmDotRadius = 12;
  const radiusFor = () => filmDotRadius;
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
    "Color through the years",
    "Each dot is one remake. Horizontal: release year · Vertical: how light the dominant color is · Fill: that color"
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
        .style("font-size", `${AXIS_TICK_PX}px`)
        .style("font-weight", "600")
    );

  svg
    .append("g")
    .attr("transform", `translate(${left}, 0)`)
    .call(
      d3
        .axisLeft(y)
        .tickValues([0, 100])
        .tickFormat(brightnessPlusMinusTick)
        .tickSize(0)
    )
    .call((g) => g.select(".domain").remove())
    .call((g) =>
      g
        .selectAll("text")
        .attr("fill", MUTED)
        .attr("font-family", FONT)
        .style("font-size", `${AXIS_TICK_PX}px`)
        .style("font-weight", "500")
    );

  svg
    .append("text")
    .attr("x", right)
    .attr("y", VIEW.height - 16)
    .attr("text-anchor", "end")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", AXIS_CAPTION_PX)
    .attr("font-weight", 700)
    .text("Release year →");

  svg
    .append("text")
    .attr("transform", `translate(28, ${(top + bottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("fill", MUTED)
    .attr("font-family", FONT)
    .attr("font-size", AXIS_CAPTION_PX)
    .attr("font-weight", 700)
    .text("← Darker color … lighter color →");
}


function buildGenreRows(movies) {
  const table = new Map();
  SCROLL_GENRE_ORDER.forEach((g) => table.set(g, new Map()));

  (movies || []).forEach((movie) => {
    const bucket = bucketGenreForFilm(movie.genres);
    const group = classifyColor(movie.dominantHex);
    const row = table.get(bucket);
    if (!row) return;
    row.set(group, (row.get(group) || 0) + 1);
  });

  return SCROLL_GENRE_ORDER.map((genre) => {
    const map = table.get(genre);
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return {
      genre,
      total,
      dist: COLOR_GROUPS.map((group) => ({ group, value: map.get(group) || 0 })),
    };
  }).filter((r) => r.total > 0);
}

function drawGenreStacks(svg, genreRows) {
  if (!genreRows.length) return;

  drawMorphHeader(
    svg,
    "Which hues show up in each genre?",
    "Bars are counts for the eight genre columns. Each film is assigned by scanning TMDB genres in order (first match among the eight, or a mapped equivalent like Adventure→Action); if nothing matches, Drama."
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
    .attr("stroke", "rgba(15, 15, 15, 0.06)")
    .attr("stroke-width", 1)
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

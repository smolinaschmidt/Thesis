import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { el, clear } from "./color.js";
import { showTooltip, hideTooltip, moveTooltip } from "./tooltip.js";
import {
  VIEW_WIDTH,
  morphEligibleMovies,
  morphRawYearExtents,
  morphNicedYearDomain,
  morphDecadeStartsForBands,
  morphBottomDecadeTickYears,
  morphTimeScale,
  MORPH_CHART_FONT,
  MORPH_MUTED,
  MORPH_RULE,
} from "./shared-morph-time-axis.js";

/** Timeline + intro ch.01 atlas — same curated 12 remake families. */
export const FEATURED_LANES = [
  { laneId: "gatsby", label: "The Great Gatsby", familyTitles: ["Great Gatsby"] },
  { laneId: "starisborn", label: "A Star Is Born", familyTitles: ["Star Is Born"] },
  { laneId: "carrie", label: "Carrie", familyTitles: ["Carrie"] },
  { laneId: "psycho", label: "Psycho", familyTitles: ["Psycho"] },
  { laneId: "mermaid", label: "The Little Mermaid", familyTitles: ["Little Mermaid"] },
  {
    laneId: "chocolate",
    label: "Charlie / Willy Wonka",
    familyTitles: [
      "Willy Wonka The Chocolate Factory",
      "Charlie And The Chocolate Factory",
    ],
  },
  { laneId: "fahrenheit", label: "Fahrenheit 451", familyTitles: ["Fahrenheit 451"] },
  { laneId: "fly", label: "The Fly", familyTitles: ["Fly"] },
  {
    laneId: "dragontattoo",
    label: "Dragon Tattoo",
    familyTitles: ["Girl With The Dragon Tattoo"],
  },
  { laneId: "freaky", label: "Freaky Friday", familyTitles: ["Freaky Friday"] },
  { laneId: "rearwindow", label: "Rear Window", familyTitles: ["Rear Window"] },
  { laneId: "westside", label: "West Side Story", familyTitles: ["West Side Story"] },
];

/** Featured rows as minimal movie-shaped objects — only for axis fallback without analytics.movies */
function featuredRowsAsYearExtents(data) {
  return data.filter((d) => d.year);
}

/** Optional `movies`: same pool as morph scrolly (analytics.movies); shared domain + zebra + ticks when set. */
export function computeTimelineLayout(families, options = {}) {
  const byFamilyTitle = new Map(
    (families || []).map((f) => [(f.familyTitle || "").toLowerCase(), f])
  );

  const data = FEATURED_LANES.flatMap((lane) =>
    lane.familyTitles
      .flatMap(
        (title) => byFamilyTitle.get(title.toLowerCase())?.movies || []
      )
      .map((movie) => ({
        laneId: lane.laneId,
        laneLabel: lane.label,
        title: movie.title,
        year: movie.year,
        tmdbId: movie.tmdbId != null ? Number(movie.tmdbId) : null,
        dominant: movie.dominantHex || "#111",
        voteAverage:
          typeof movie.voteAverage === "number" && movie.voteAverage > 0
            ? movie.voteAverage
            : null,
        voteCount:
          typeof movie.voteCount === "number" && movie.voteCount > 0
            ? movie.voteCount
            : 0,
      }))
  ).filter((d) => d.year);

  if (!data.length) return null;

  const MIN_VOTES = 20;
  /** Uniform dot size (remakes timeline — “The first comparison”). */
  const filmDotRadius = 16;
  const radiusFor = () => filmDotRadius;
  const isRated = (d) => d.voteAverage != null && d.voteCount >= MIN_VOTES;

  const fullWidth = VIEW_WIDTH;
  const panelWidth = 320;
  const panelGap = 28;
  const height = 640;
  const margin = { top: 44, right: 22, bottom: 44, left: 220 };
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;
  const plotInnerHeight = plotBottom - plotTop;

  const chartRightFull = fullWidth - margin.right;
  const chartRightSplit = fullWidth - margin.right - panelWidth - panelGap;

  const eligible = morphEligibleMovies(options.movies);
  const yearlySource = eligible.length > 0 ? eligible : featuredRowsAsYearExtents(data);
  const rawExt = morphRawYearExtents(yearlySource);
  if (!rawExt) return null;

  const domainNice = morphNicedYearDomain(rawExt);
  const x = morphTimeScale(margin.left, chartRightFull, domainNice);

  const decadeBandStarts = morphDecadeStartsForBands(rawExt[0], rawExt[1]);
  const decadeTickYears = morphBottomDecadeTickYears(rawExt[0], rawExt[1]);

  const laneIds = FEATURED_LANES.filter((lane) =>
    data.some((d) => d.laneId === lane.laneId)
  ).map((lane) => lane.laneId);
  const labelById = new Map(FEATURED_LANES.map((lane) => [lane.laneId, lane.label]));
  const y = d3
    .scalePoint()
    .domain(laneIds)
    .range([margin.top, height - margin.bottom])
    .padding(0.42);

  return {
    data,
    x,
    decadeBandStarts,
    decadeTickYears,
    y,
    laneIds,
    labelById,
    fullWidth,
    height,
    margin,
    panelWidth,
    panelGap,
    chartRightFull,
    chartRightSplit,
    plotTop,
    plotBottom,
    plotInnerHeight,
    radiusFor,
    isRated,
    MIN_VOTES,
  };
}

/** X position by release year — same linear time axis as the morph “all films” view; panel narrows range. */
export function timelineDotX(TL, year, panelOpen) {
  if (!TL || year == null || !Number.isFinite(year)) return 0;
  const right = panelOpen ? TL.chartRightSplit : TL.chartRightFull;
  return TL.x.copy().range([TL.margin.left, right])(year);
}

export function renderTimeline(container, { families, movies = null, omitDots = false } = {}) {
  clear(container);

  const L = computeTimelineLayout(families, { movies });
  if (!L) return;

  const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.append(svgNode);
  const svg = d3.select(svgNode);

  const {
    data,
    x,
    decadeBandStarts,
    decadeTickYears,
    y,
    laneIds,
    labelById,
    fullWidth,
    height,
    margin,
    panelWidth,
    panelGap,
    chartRightFull,
    chartRightSplit,
    plotTop,
    plotBottom,
    plotInnerHeight,
    radiusFor,
    isRated,
  } = L;

  svg.attr("viewBox", `0 0 ${fullWidth} ${height}`);

  /** Matches morph (`morph-bands-time`): zebra by decade stripe. */
  const gBandsTime = svg.append("g").attr("class", "morph-bands-time");

  const baselineBottom = svg
    .append("line")
    .attr("class", "morph-baseline timeline-morph-shared")
    .attr("x1", margin.left)
    .attr("x2", chartRightFull)
    .attr("y1", plotBottom)
    .attr("y2", plotBottom)
    .attr("stroke", MORPH_RULE)
    .attr("stroke-width", 1.5);

  const baselineLeft = svg
    .append("line")
    .attr("class", "morph-baseline-left timeline-morph-shared")
    .attr("x1", margin.left)
    .attr("x2", margin.left)
    .attr("y1", plotTop)
    .attr("y2", plotBottom)
    .attr("stroke", MORPH_RULE)
    .attr("stroke-width", 1.5);

  // Transparent hit target over plot (bands sit behind).
  const chartBg = svg
    .append("rect")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", fullWidth - margin.left - margin.right)
    .attr("height", plotInnerHeight)
    .attr("fill", "transparent")
    .style("cursor", "default");

  const axisTimeX = svg.append("g").attr("class", "timeline-morph-axis-x");

  svg
    .append("text")
    .attr("class", "morph-caption-time-x timeline-caption-release-year")
    .attr("x", chartRightFull)
    .attr("y", height - 16)
    .attr("text-anchor", "end")
    .attr("fill", MORPH_MUTED)
    .attr("font-family", MORPH_CHART_FONT)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text("Release year →");

  /** Same decade bands + axis + baselines + caption x as morph scrolly (shared numbers / styling). */
  function drawMorphTimeAxis(chartRight, dur) {
    const left = margin.left;
    x.range([left, chartRight]);

    const bandData = decadeBandStarts.slice(0, -1).map((start, i) => ({
      start,
      end: decadeBandStarts[i + 1],
      i,
      key: `${start}_${decadeBandStarts[i + 1]}`,
    }));

    const bandRects = gBandsTime
      .selectAll("rect")
      .data(bandData, (d) => d.key)
      .join(
        (enter) =>
          enter
            .append("rect")
            .attr("y", plotTop)
            .attr("height", plotBottom - plotTop),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("fill", (d) => (d.i % 2 === 0 ? "#fafafa" : "#ffffff"))
      .attr("stroke", "none");

    bandRects.each(function (d) {
      const xa = Math.max(left, x(d.start));
      const xb = Math.min(chartRight, x(d.end));
      const sel = dur > 0 ? d3.select(this).transition().duration(dur) : d3.select(this);
      sel.attr("x", xa).attr("width", Math.max(0, xb - xa));
    });

    if (dur > 0) {
      baselineBottom.transition().duration(dur).attr("x1", left).attr("x2", chartRight);
    } else {
      baselineBottom.attr("x1", left).attr("x2", chartRight);
    }

    svg.select(".timeline-caption-release-year").attr("x", chartRight);

    const axisBottom = d3.axisBottom(x).tickValues(decadeTickYears).tickFormat(d3.format("d")).tickSize(0);

    axisTimeX.attr("transform", `translate(0, ${plotBottom})`).call(axisBottom).call((g) => g.select(".domain").remove());
    axisTimeX
      .selectAll("text")
      .attr("fill", MORPH_MUTED)
      .attr("font-family", MORPH_CHART_FONT)
      .style("font-size", "16px")
      .style("font-weight", "600");
  }

  const lanes = svg
    .append("g")
    .selectAll("line")
    .data(laneIds)
    .join("line")
    .attr("x1", margin.left)
    .attr("y1", (id) => y(id))
    .attr("y2", (id) => y(id))
    .attr("stroke", "#ecece8");

  const laneLabels = svg
    .append("g")
    .selectAll("text")
    .data(laneIds)
    .join("text")
    .attr("x", margin.left - 14)
    .attr("y", (id) => y(id))
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("fill", "#333")
    .attr("font-size", 15)
    .attr("font-weight", 600)
    .attr("letter-spacing", "0.06em")
    .style("text-transform", "uppercase")
    .text((id) => (labelById.get(id) || "").slice(0, 36));

  let dots = null;
  if (!omitDots) {
    dots = svg
      .append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", (d) => x(d.year))
      .attr("cy", (d) => y(d.laneId))
      .attr("r", 0)
      .attr("fill", (d) => d.dominant)
      .attr("fill-opacity", (d) => (isRated(d) ? 1 : 0.35))
      .attr("stroke", "#111")
      .attr("stroke-width", 0.85)
      .attr("stroke-dasharray", (d) => (isRated(d) ? null : "2 2"));

    dots
      .transition()
      .duration(700)
      .delay((_, i) => i * 18)
      .attr("r", radiusFor);
  }

  const fmtRating = (d) =>
    isRated(d) ? `★ ${d.voteAverage.toFixed(1)}` : "no TMDB rating";

  let selectedLaneId = null;

  const panelGroup = svg
    .append("g")
    .attr("class", "compare-panel")
    .attr("transform", `translate(${fullWidth}, ${plotTop})`)
    .style("pointer-events", "none")
    .style("opacity", 0);

  const cardsGroup = panelGroup.append("g");

  // Helpers: pick readable text color over a given fill.
  const luminance = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const textOn = (hex) => (luminance(hex) > 0.5 ? "#111" : "#fff");

  const normalizeHex = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    return m ? `#${m[1].toUpperCase()}` : "#000000";
  };

  function renderComparison() {
    cardsGroup.selectAll("*").remove();
    if (!selectedLaneId) return;

    const movies = data
      .filter((d) => d.laneId === selectedLaneId)
      .sort((a, b) => a.year - b.year);
    if (!movies.length) return;

    const n = movies.length;
    const stripeH = plotInnerHeight / n;

    const cards = cardsGroup
      .selectAll("g.card")
      .data(movies, (d) => `${d.laneId}-${d.year}-${d.title}`)
      .join("g")
      .attr("class", "card")
      .attr("transform", (_, i) => `translate(0, ${i * stripeH})`)
      .style("cursor", "pointer")
      .on("click", (event) => {
        event.stopPropagation();
        selectLane(null);
      });

    cards
      .append("rect")
      .attr("width", panelWidth)
      .attr("height", 0)
      .attr("fill", (d) => d.dominant)
      .attr("stroke", "none")
      .transition()
      .duration(450)
      .attr("height", stripeH);

    const midY = stripeH / 2;
    cards
      .append("text")
      .attr("x", 14)
      .attr("y", midY)
      .attr("dy", "0.35em")
      .attr("fill", (d) => textOn(d.dominant))
      .attr("font-size", 17)
      .attr("font-weight", 600)
      .attr("opacity", 0)
      .text((d) => d.year)
      .transition()
      .delay(200)
      .duration(350)
      .attr("opacity", 1);

    cards
      .append("text")
      .attr("x", panelWidth - 14)
      .attr("y", midY)
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .attr("fill", (d) => textOn(d.dominant))
      .attr("font-size", 12)
      .attr("letter-spacing", "0.08em")
      .style("text-transform", "uppercase")
      .attr("opacity", 0)
      .text((d) => normalizeHex(d.dominant))
      .transition()
      .delay(250)
      .duration(350)
      .attr("opacity", 0.9);
  }

  function applyLayout(animate) {
    const dur = animate ? 420 : 0;
    const open = Boolean(selectedLaneId);
    const chartRight = open ? chartRightSplit : chartRightFull;

    drawMorphTimeAxis(chartRight, dur);

    if (dur === 0) {
      // Do not use transitions on `dots` here: a zero-duration transition
      // still interrupts the radius tween and leaves circles at r=0.
      chartBg.attr("width", chartRight - margin.left);
      lanes.attr("x2", chartRight);
      if (dots) dots.attr("cx", (d) => x(d.year));
      const panelX = open ? chartRight + panelGap : fullWidth;
      panelGroup
        .style("pointer-events", open ? "auto" : "none")
        .attr("transform", `translate(${panelX}, ${plotTop})`)
        .style("opacity", open ? 1 : 0);
    } else {
      chartBg.transition().duration(dur).attr("width", chartRight - margin.left);
      lanes.transition().duration(dur).attr("x2", chartRight);
      if (dots)
        dots.interrupt().transition().duration(dur).attr("cx", (d) => x(d.year));
      const panelX = open ? chartRight + panelGap : fullWidth;
      panelGroup
        .style("pointer-events", open ? "auto" : "none")
        .transition()
        .duration(dur)
        .attr("transform", `translate(${panelX}, ${plotTop})`)
        .style("opacity", open ? 1 : 0);
    }
  }

  function resetHighlight() {
    lanes.attr("stroke", "#ecece8");
    if (dots) dots.attr("fill-opacity", (p) => (isRated(p) ? 1 : 0.35));
    laneLabels.attr("fill", "#333");
  }

  function highlightLane(laneId) {
    lanes.attr("stroke", (id) => (id === laneId ? "#111" : "#ecece8"));
    if (dots) {
      dots.attr("fill-opacity", (p) =>
        p.laneId === laneId ? (isRated(p) ? 1 : 0.35) : 0.12
      );
    }
    laneLabels.attr("fill", (id) => (id === laneId ? "var(--accent)" : "#333"));
  }

  function selectLane(laneId) {
    const next =
      laneId === null || laneId === undefined
        ? null
        : selectedLaneId === laneId
          ? null
          : laneId;
    selectedLaneId = next;
    if (selectedLaneId) {
      highlightLane(selectedLaneId);
    } else {
      resetHighlight();
    }
    renderComparison();
    applyLayout(true);
  }

  chartBg.on("click", () => {
    if (!selectedLaneId) return;
    selectLane(null);
  });

  if (dots) {
    dots
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        if (!selectedLaneId) highlightLane(d.laneId);
        showTooltip(
          event,
          `<span class="t-title">${d.title}</span><span class="t-sub">${d.year} · ${fmtRating(d)}</span>`
        );
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", () => {
        if (!selectedLaneId) resetHighlight();
        hideTooltip();
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        selectLane(d.laneId);
      });
  }

  laneLabels
    .on("mouseenter", (_, id) => {
      if (!selectedLaneId) highlightLane(id);
    })
    .on("mouseleave", () => {
      if (!selectedLaneId) resetHighlight();
    });

  applyLayout(false);

  return {
    /** Toggle comparison panel for this remake lane (same behaviour as clicking a dot). */
    selectLane: (laneId) => selectLane(laneId),
    isPanelOpen: () => Boolean(selectedLaneId),
  };
}

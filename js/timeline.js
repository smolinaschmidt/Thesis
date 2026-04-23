import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { el, clear } from "./color.js";
import { showTooltip, hideTooltip, moveTooltip } from "./tooltip.js";

// Timeline of most famous remake families
const FEATURED_LANES = [
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

export function computeTimelineLayout(families) {
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
  const radiusDomain = [5, 8.5];
  const radiusRange = [7, 22];
  const rScale = d3.scalePow().exponent(1.6).domain(radiusDomain).range(radiusRange).clamp(true);
  const neutralRadius = 11;

  const radiusFor = (d) =>
    d.voteAverage != null && d.voteCount >= MIN_VOTES
      ? rScale(d.voteAverage)
      : neutralRadius;
  const isRated = (d) => d.voteAverage != null && d.voteCount >= MIN_VOTES;

  const fullWidth = 2040;
  const panelWidth = 320;
  const panelGap = 28;
  const height = 640;
  const margin = { top: 44, right: 22, bottom: 44, left: 220 };
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;
  const plotInnerHeight = plotBottom - plotTop;

  const chartRightFull = fullWidth - margin.right;
  const chartRightSplit = fullWidth - margin.right - panelWidth - panelGap;

  const x = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .nice()
    .range([margin.left, chartRightFull]);

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
    neutralRadius,
    rScale,
  };
}

/** X position for a film year — full chart, or narrowed when the comparison panel is open. */
export function timelineDotX(TL, year, panelOpen) {
  if (!TL || year == null || !Number.isFinite(year)) return 0;
  const right = panelOpen ? TL.chartRightSplit : TL.chartRightFull;
  return TL.x.copy().range([TL.margin.left, right])(year);
}

export function renderTimeline(container, { families, omitDots = false } = {}) {
  clear(container);

  const L = computeTimelineLayout(families);
  if (!L) return;

  const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.append(svgNode);
  const svg = d3.select(svgNode);

  const {
    data,
    x,
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

  // Background: click empty chart area to clear selection (dots sit above).
  const chartBg = svg
    .append("rect")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", fullWidth - margin.left - margin.right)
    .attr("height", plotInnerHeight)
    .attr("fill", "transparent")
    .style("cursor", "default");

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

  const axisGroup = svg
    .append("g")
    .attr("transform", `translate(0, ${height - margin.bottom + 8})`);

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

  function styleAxis() {
    axisGroup.selectAll("path,line").attr("stroke", "#d8d8d2");
    axisGroup
      .selectAll("text")
      .attr("fill", "#333")
      .style("font-size", "13px")
      .style("font-weight", "500")
      .style("letter-spacing", "0.04em");
  }

  function applyLayout(animate) {
    const dur = animate ? 420 : 0;
    const open = Boolean(selectedLaneId);
    const chartRight = open ? chartRightSplit : chartRightFull;

    x.range([margin.left, chartRight]);

    const axis = d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"));

    if (dur === 0) {
      // Do not use transitions on `dots` here: a zero-duration transition
      // still interrupts the radius tween and leaves circles at r=0.
      chartBg.attr("width", chartRight - margin.left);
      lanes.attr("x2", chartRight);
      if (dots) dots.attr("cx", (d) => x(d.year));
      axisGroup.call(axis);
      styleAxis();
      const panelX = open ? chartRight + panelGap : fullWidth;
      panelGroup
        .style("pointer-events", open ? "auto" : "none")
        .attr("transform", `translate(${panelX}, ${plotTop})`)
        .style("opacity", open ? 1 : 0);
    } else {
      chartBg.transition().duration(dur).attr("width", chartRight - margin.left);
      lanes.transition().duration(dur).attr("x2", chartRight);
      if (dots) dots.interrupt().transition().duration(dur).attr("cx", (d) => x(d.year));
      axisGroup.transition().duration(dur).call(axis).on("end", styleAxis);
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

  // Legend: dot size encodes TMDB vote average (when enough votes).
  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", 22)
    .attr("dy", "0.35em")
    .attr("fill", "#111")
    .attr("font-size", 13)
    .attr("font-weight", 600)
    .style("letter-spacing", "0.06em")
    .style("text-transform", "uppercase")
    .text("size = TMDB rating");

  applyLayout(false);

  return {
    /** Toggle comparison panel for this remake lane (same behaviour as clicking a dot). */
    selectLane: (laneId) => selectLane(laneId),
    isPanelOpen: () => Boolean(selectedLaneId),
  };
}

/**
 * Shared time-x math + styling for morph scrolly and the remake timeline —
 * must stay in sync (same domains, zebra bands, bottom tick years).
 */
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export const VIEW_WIDTH = 2040;
export const MORPH_CHART_FONT = 'IBM Plex Sans, "Helvetica Neue", sans-serif';
export const MORPH_MUTED = "#5c5c5c";
export const MORPH_RULE = "#e6e6e6";

/** Matches renderMorphScrolly: only films with poster color + release year shape the axis. */
export function morphEligibleMovies(movies) {
  return (movies ?? []).filter((m) => m.year && m.dominantHex);
}

/** [min,max] calendar years across eligible titles (matches morph locals). */
export function morphRawYearExtents(eligibleMovies) {
  if (!eligibleMovies?.length) return null;
  return [d3.min(eligibleMovies, (d) => d.year), d3.max(eligibleMovies, (d) => d.year)];
}

/**
 * `.nice()`-expanded domain identical to morph’s
 * `d3.scaleLinear().domain(d3.extent(...)).nice().domain()`
 */
export function morphNicedYearDomain(extentYears) {
  if (!extentYears || extentYears[0] == null || extentYears[1] == null) return null;
  return d3.scaleLinear().domain(extentYears).nice().domain();
}

/** Decade start years for zebra bands (`d3.range(d0,d1+1,10)` in morph). */
export function morphDecadeStartsForBands(minYear, maxYear) {
  const d0 = Math.floor(minYear / 10) * 10;
  const d1 = Math.ceil(maxYear / 10) * 10;
  return d3.range(d0, d1 + 1, 10);
}

/** Bottom x-axis decade tick positions (tickValues) — morph `axisBottom(xTime).tickValues(decadeTicks)`. */
export function morphBottomDecadeTickYears(minYear, maxYear) {
  return d3.range(Math.ceil(minYear / 10) * 10, maxYear + 1, 10);
}

/**
 * Builds the same linear scale as morph embed (range [chartLeft, chartRight]).
 */
export function morphTimeScale(chartLeft, chartRight, nicedDomainYears) {
  return d3.scaleLinear().domain(nicedDomainYears).range([chartLeft, chartRight]);
}

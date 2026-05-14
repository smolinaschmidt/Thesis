import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export const VIEW_WIDTH = 2040;
export const MORPH_CHART_FONT = 'IBM Plex Sans, "Helvetica Neue", sans-serif';
export const MORPH_MUTED = "#5c5c5c";
export const MORPH_RULE = "#e6e6e6";

export function morphEligibleMovies(movies) {
  return (movies ?? []).filter((m) => m.year && m.dominantHex);
}

export function morphRawYearExtents(eligibleMovies) {
  if (!eligibleMovies?.length) return null;
  return [d3.min(eligibleMovies, (d) => d.year), d3.max(eligibleMovies, (d) => d.year)];
}

export function morphNicedYearDomain(extentYears) {
  if (!extentYears || extentYears[0] == null || extentYears[1] == null) return null;
  return d3.scaleLinear().domain(extentYears).nice().domain();
}

export function morphDecadeStartsForBands(minYear, maxYear) {
  const d0 = Math.floor(minYear / 10) * 10;
  const d1 = Math.ceil(maxYear / 10) * 10;
  return d3.range(d0, d1 + 1, 10);
}

export function morphBottomDecadeTickYears(minYear, maxYear) {
  return d3.range(Math.ceil(minYear / 10) * 10, maxYear + 1, 10);
}

export function morphTimeScale(chartLeft, chartRight, nicedDomainYears) {
  return d3.scaleLinear().domain(nicedDomainYears).range([chartLeft, chartRight]);
}

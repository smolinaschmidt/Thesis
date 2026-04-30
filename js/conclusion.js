import { el, clear } from "./color.js";

/**
 * Section 10 — conclusion + small multiples.
 * Each remake family reduced to a colored strip: one swatch per film,
 * in chronological order. Click a cell to load it in the case study.
 */
export function renderConclusion(
  container,
  { combined, analytics, families, onSelectFamily, showSentimentSummary = true } = {}
) {
  clear(container);

  let summary =
    `${analytics?.summary?.totalFamilies ?? 0} families · ${
      analytics?.summary?.totalMovies ?? combined?.summary?.totalMovies ?? 0
    } films`;
  if (showSentimentSummary) {
    summary += ` · ${combined?.sentiment?.summary?.moviesWithSentiment ?? 0} with scored plot summaries`;
  }
  container.append(el("p", { class: "small" }, summary));

  const items = [...(families || [])]
    .filter((f) => (f.movies || []).length > 0)
    .sort((a, b) => String(a.familyId || "").localeCompare(String(b.familyId || "")))
    .map((family) => {
      const sorted = [...(family.movies || [])].sort(
        (a, b) => (a.year ?? 9999) - (b.year ?? 9999)
      );
      const withYears = sorted.filter((m) => m.year != null);
      const years =
        withYears.length >= 2
          ? [withYears[0].year, withYears[withYears.length - 1].year]
          : withYears.length === 1
            ? [withYears[0].year, withYears[0].year]
            : null;
      return {
        id: family.familyId,
        title: family.familyTitle,
        years,
        strip: sorted.map((m) => m.dominantHex || "#d7d7d1"),
      };
    });

  const grid = el("div", { class: "small-multiples" });
  items.forEach((it) => {
    const cell = el(
      "button",
      {
        type: "button",
        class: "sm-cell",
        onclick: () => onSelectFamily?.(it.id),
      },
      el("div", { class: "sm-title", title: it.title }, it.title),
      el("div", { class: "sm-strip" }, ...it.strip.map((c) => el("span", { style: { color: c } }))),
      el(
        "div",
        { class: "sm-meta" },
        el("span", {}, it.years ? String(it.years[0]) : ""),
        el("span", {}, it.years ? String(it.years[1]) : "")
      )
    );
    grid.append(cell);
  });
  container.append(grid);
}

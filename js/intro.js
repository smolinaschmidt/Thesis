import { el, clear, posterUrl } from "./color.js";
import { showTooltip, hideTooltip, moveTooltip } from "./tooltip.js";
import { FEATURED_LANES } from "./timeline.js";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Intro ch.01 — same 12 remake families as `FEATURED_LANES` in the timeline,
 * laid out like the conclusion atlas (strip + years). Hover each swatch for the poster.
 */
export function renderIntro(container, { families }) {
  clear(container);

  const byFamilyTitle = new Map(
    (families || []).map((f) => [(f.familyTitle || "").toLowerCase(), f])
  );

  const cells = FEATURED_LANES.map((lane) => {
    const movies = lane.familyTitles.flatMap(
      (title) => byFamilyTitle.get(title.toLowerCase())?.movies || []
    );
    const sorted = [...movies].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

    const withYears = sorted.filter((m) => m.year != null);
    const yearsLo =
      withYears.length >= 2
        ? withYears[0].year
        : withYears.length === 1
          ? withYears[0].year
          : null;
    const yearsHi =
      withYears.length >= 2
        ? withYears[withYears.length - 1].year
        : withYears.length === 1
          ? withYears[0].year
          : null;

    const strip = el("div", { class: "sm-strip intro-atlas-strip" });

    if (sorted.length) {
      sorted.forEach((movie) => {
        const hex = movie.dominantHex || "#d7d7d1";
        const span = el("span", {
          style: { color: hex },
          tabindex: 0,
          "aria-label": movie.title ? `${movie.title} (${movie.year ?? "—"})` : "Film",
          class: "intro-atlas-swatch",
        });

        const tip = (event) => {
          const u = posterUrl(movie.posterPath);
          if (!u) {
            showTooltip(
              event,
              `<span class="t-title">${escapeHtml(movie.title)}</span><span class="t-sub">No poster · ${
                movie.year ?? "—"
              }</span>`,
              { film: true }
            );
          } else {
            showTooltip(
              event,
              `<img class="intro-tip-poster" src="${u}" alt="" /><span class="t-title">${escapeHtml(
                movie.title
              )}</span><span class="t-sub">${movie.year ?? "—"}</span>`,
              { film: true }
            );
          }
          moveTooltip(event);
        };

        span.addEventListener("mouseenter", tip);
        span.addEventListener("focus", tip);
        span.addEventListener("mousemove", moveTooltip);
        span.addEventListener("mouseleave", () => hideTooltip());
        span.addEventListener("blur", () => hideTooltip());

        strip.append(span);
      });
    } else {
      strip.append(
        el("span", {
          style: { color: "#d7d7d1" },
          class: "intro-atlas-swatch intro-atlas-swatch--placeholder",
          title: "No films in dataset",
        })
      );
    }

    return el(
      "div",
      { class: "sm-cell intro-atlas-cell" },
      el(
        "div",
        { class: "sm-title intro-atlas-title", title: lane.label },
        lane.label.length > 52 ? `${lane.label.slice(0, 50)}…` : lane.label
      ),
      strip,
      el(
        "div",
        { class: "sm-meta" },
        el("span", {}, yearsLo != null ? String(yearsLo) : "—"),
        el("span", {}, yearsHi != null ? String(yearsHi) : "—")
      )
    );
  });

  const grid = el(
    "div",
    {
      class: "viz-body intro-atlas intro-ch01-grid small-multiples",
      "aria-label": "Featured remake families",
    },
    ...cells
  );

  container.append(grid);
}

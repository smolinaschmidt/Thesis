import { el, clear, posterUrl } from "./color.js";

/**
 * Intro figure — posters from the Great Gatsby remake family (all versions)
 * + a palette strip from each film's dominant hex.
 */

function pickIntroFamily(families) {
  const list = [...(families || [])];
  const norm = (s) => String(s || "").toLowerCase().trim();
  const gatsby = list.find((f) => {
    const t = norm(f.familyTitle);
    return t === "great gatsby" || t.includes("great gatsby");
  });
  if (gatsby && (gatsby.movies || []).length > 0) return gatsby;
  return list
    .filter((f) => (f.movieCount || 0) > 1)
    .sort((a, b) => (b.movieCount || 0) - (a.movieCount || 0))[0];
}

function labelForFilm(sorted, movie, index) {
  const y = movie.year ?? "—";
  if (sorted.length === 1) return String(y);
  if (index === 0) return `Original · ${y}`;
  if (index === sorted.length - 1) return `Latest · ${y}`;
  return `Remake · ${y}`;
}

export function renderIntro(container, { families }) {
  clear(container);

  const family = pickIntroFamily(families);
  const sorted = family ? [...family.movies].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)) : [];

  const swatches = sorted.map((m) => m.dominantHex).filter(Boolean);

  const wrap = el("div", { class: "viz-body" });

  if (sorted.length > 0) {
    const articles = sorted.map((movie, i) => {
      const url = posterUrl(movie.posterPath);
      return el(
        "article",
        {},
        el("p", {}, labelForFilm(sorted, movie, i)),
        url
          ? el("img", { src: url, alt: movie.title || "Poster", loading: "lazy" })
          : el("div", { class: "placeholder" }),
        el("p", { class: "small" }, movie.title || "")
      );
    });
    const grid = el("div", { class: "intro-split" }, ...articles);
    grid.style.setProperty("--intro-cols", String(Math.min(sorted.length, 6)));
    wrap.append(grid);
  } else {
    wrap.append(el("div", { class: "placeholder large" }));
  }

  const palette = swatches.length ? swatches : ["#d9d7cf"];
  const bars = el("div", {
    class: "palette-bars",
    style: { "--palette-cols": String(palette.length) },
  });
  palette.forEach((hex, i) => {
    bars.append(el("span", { style: { color: hex, animationDelay: `${i * 90}ms` } }));
  });
  wrap.append(bars);

  container.append(wrap);
}

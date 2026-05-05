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

  // (Removed the "500 families · 1025 films" summary line per editorial request.)

  // Keep genre buckets consistent with the "Color by genre" chart.
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
  function bucketGenreForFilm(genresArray) {
    const list = Array.isArray(genresArray) ? genresArray : [];
    for (const g of list) {
      const b = genreToEightBucket(g);
      if (b) return b;
    }
    return FALLBACK_GENRE_BUCKET;
  }

  const allFamilies = [...(families || [])]
    .filter((f) => (f.movies || []).length > 0)
    .sort((a, b) =>
      String(a.familyTitle || "")
        .toLowerCase()
        .localeCompare(String(b.familyTitle || "").toLowerCase())
    );

  const items = allFamilies.map((family) => {
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

      const genres = new Set();
      sorted.forEach((m) => genres.add(bucketGenreForFilm(m.genres)));

      const decades = new Set();
      sorted.forEach((m) => {
        const y = m.year;
        if (typeof y === "number" && Number.isFinite(y)) decades.add(Math.floor(y / 10) * 10);
      });

      return {
        id: family.familyId,
        title: family.familyTitle,
        years,
        strip: sorted.map((m) => m.dominantHex || "#d7d7d1"),
        genres: [...genres],
        decades: [...decades],
      };
    });

  // Filter options
  const genreOptions = [...SCROLL_GENRE_ORDER];
  const decadeOptions = Array.from(
    new Set(items.flatMap((it) => it.decades || []))
  )
    .filter((d) => typeof d === "number" && Number.isFinite(d))
    .sort((a, b) => a - b);

  const state = {
    query: "",
    genre: "",
    decadeIdx: 0, // 0 = All, else decadeOptions[idx-1]
  };

  const controls = el(
    "div",
    { class: "atlas-controls" },
    el(
      "div",
      { class: "atlas-controls__left" },
      el(
        "label",
        { class: "atlas-control" },
        el("span", { class: "atlas-control__label" }, "Genre"),
        (() => {
          const select = el(
            "select",
            {
              class: "atlas-control__select",
              onchange: (e) => {
                state.genre = e.target.value || "";
                renderGrid();
              },
            },
            el("option", { value: "" }, "All")
          );
          genreOptions.forEach((g) => select.append(el("option", { value: g }, g)));
          return select;
        })()
      ),
      el(
        "label",
        { class: "atlas-control atlas-control--range" },
        el("span", { class: "atlas-control__label" }, "Decade"),
        (() => {
          const line = el("div", { class: "atlas-range" });
          const value = el("span", { class: "atlas-range__value" }, "All");
          const input = el("input", {
            class: "atlas-range__input",
            type: "range",
            min: "0",
            max: String(decadeOptions.length),
            step: "1",
            value: "0",
            oninput: (e) => {
              const v = Number(e.target.value);
              state.decadeIdx = Number.isFinite(v) ? v : 0;
              value.textContent =
                state.decadeIdx <= 0 ? "All" : String(decadeOptions[state.decadeIdx - 1]);
              renderGrid();
            },
          });
          line.append(input, value);
          return line;
        })()
      )
    ),
    el(
      "div",
      { class: "atlas-controls__right" },
      el(
        "label",
        { class: "atlas-control atlas-control--search" },
        el("span", { class: "atlas-control__label" }, "Search"),
        el("input", {
          class: "atlas-control__search",
          type: "search",
          placeholder: "Search a remake family…",
          autocomplete: "off",
          oninput: (e) => {
            state.query = (e.target.value || "").trim().toLowerCase();
            renderGrid();
          },
        })
      )
    )
  );
  container.append(controls);

  const grid = el("div", { class: "small-multiples" });
  container.append(grid);

  function renderGrid() {
    clear(grid);
    const decade =
      state.decadeIdx <= 0 ? null : decadeOptions[Math.max(0, state.decadeIdx - 1)];
    const filtered = items.filter((it) => {
      if (state.query && !String(it.title || "").toLowerCase().includes(state.query)) return false;
      if (state.genre && !(it.genres || []).includes(state.genre)) return false;
      if (decade != null && !(it.decades || []).includes(decade)) return false;
      return true;
    });

    filtered.forEach((it) => {
      const cell = el(
        "button",
        {
          type: "button",
          class: "sm-cell",
          onclick: () => onSelectFamily?.(it.id),
        },
        el("div", { class: "sm-title", title: it.title }, it.title),
        el(
          "div",
          { class: "sm-strip" },
          ...it.strip.map((c) => el("span", { style: { color: c } }))
        ),
        el(
          "div",
          { class: "sm-meta" },
          el("span", {}, it.years ? String(it.years[0]) : ""),
          el("span", {}, it.years ? String(it.years[1]) : "")
        )
      );
      grid.append(cell);
    });
  }

  renderGrid();
}

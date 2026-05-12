import { el, clear } from "./color.js";
import { renderIntro } from "./intro.js";
import { renderTimeline, computeTimelineLayout, timelineDotX } from "./timeline.js";
import { renderMorphScrolly } from "./morph.js";
import { renderConclusion } from "./conclusion.js";
import { openPosterAnalysis } from "./poster-analysis.js";

const CHAPTERS = [
  {
    id: "c1",
    num: "01",
    heading: "The same story, again.",
    lede:
      "Studios remake films. What they can't remake is the era.",
    body:
      "The palette of a poster isn't chosen at random, it's chosen from whatever was in the air. The film gets remade. The color gets reinvented. Sometimes barely, sometimes completely.",
    figWidth: "bleed",
    render: (c, ctx) => renderIntro(c, ctx),
  },
  {
    id: "c2",
    num: "02",
    heading: "A question of color.",
    lede: "How does the color identity of a story change across cinematic eras?",
    body:
      "These are aesthetic questions, but they are also measurable. Across 650 films we extract a single dominant color per poster — one number per film, one point on a map.",
    figWidth: "narrow",
    render: null,
  },
  {
    id: "c3",
    num: "03",
    heading: null,
    lede: null,
    body: null,
    figWidth: "bleed",
    render: (slot, ctx) => renderPinnedChapter3(slot, ctx),
  },
  {
    id: "c10",
    num: "04",
    heading: "The atlas of remakes.",
    lede: "Every story here has been told at least twice. The color is never the same.",
    body: "Each strip is a remake family. One film, multiple decades, one color per version. Filter, search, or click any title to go deeper.",
    // figWidth: "bleed",
    render: (c, ctx) =>
      renderConclusion(c, {
        analytics: ctx.analytics,
        families: ctx.families,
        onSelectFamily: ctx.onSelectFamily,
      }),
  },
];

const PINNED_NO_STATIC_COPY = new Set(["c3"]);

function visibleChapters() {
  return CHAPTERS.filter((ch) => ch.id !== "c2");
}

function chapterIndexById(id) {
  const i = visibleChapters().findIndex((ch) => ch.id === id);
  return i >= 0 ? i : 0;
}

const state = {
  analytics: null,
  families: [],
  selectedFilmId: null,
  rendered: new Set(),
};

/** Remake comparisons need at least two films in the family. */
function familiesRemakeOnly(families) {
  return (families || []).filter((f) => (f.movies || []).length > 1);
}

function normalizeFamilyTitle(title) {
  return String(title ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mergeFamiliesByTitle(families) {
  const merged = new Map();

  for (const family of families || []) {
    const key = normalizeFamilyTitle(family.familyTitle);
    if (!key) continue;

    const existing = merged.get(key);
    const movies = [...(family.movies || [])];

    if (!existing) {
      merged.set(key, {
        ...family,
        movies,
      });
      continue;
    }

    const seen = new Set(
      (existing.movies || []).map((movie) => String(movie?.tmdbId ?? `${movie?.title ?? ""}_${movie?.year ?? ""}`))
    );

    for (const movie of movies) {
      const movieKey = String(movie?.tmdbId ?? `${movie?.title ?? ""}_${movie?.year ?? ""}`);
      if (seen.has(movieKey)) continue;
      seen.add(movieKey);
      existing.movies.push(movie);
    }
  }

  return [...merged.values()].map((family) => ({
    ...family,
    movies: [...(family.movies || [])].sort(
      (a, b) => (a.year ?? 9999) - (b.year ?? 9999)
    ),
  }));
}

function tmdbIdsInFamilies(families) {
  const ids = new Set();
  for (const f of families || []) {
    for (const m of f.movies || []) {
      if (m.tmdbId != null) ids.add(Number(m.tmdbId));
    }
  }
  return ids;
}

function moviesThatBelongToRemakeFamilies(families, analyticsMovies) {
  const ids = tmdbIdsInFamilies(families);
  return (analyticsMovies || []).filter((m) => ids.has(Number(m.tmdbId)));
}

const essay = document.getElementById("essay");
const searchDock = document.getElementById("search-dock");
const searchInput = document.getElementById("search");
const datalist = document.getElementById("film-list");

function forceStartAtTop() {
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const resetScroll = () => window.scrollTo(0, 0);
  resetScroll();
  requestAnimationFrame(resetScroll);
}

forceStartAtTop();
window.addEventListener("load", forceStartAtTop, { once: true });
window.addEventListener("pageshow", (e) => {
  /** Only cold loads or full reloads; skip BFCache restores so scroll position survives back navigation — and never clashes with modal close. */
  if (!e.persisted) forceStartAtTop();
});

const CH3_COMPARISON_TITLE = "The first comparison.";
const CH3_COMPARISON_LEDE =
  "Same film. New decade. New palette.";
const CH3_COMPARISON_BODY =
  "Each row is one story, remade across time. Each dot is the color that decade chose for it. Some films barely shift. Others look like they belong to completely different genres. Press any dot to see its code.";

const CH3_MORPH_TITLE = "Color over time.";
const CH3_MORPH_LEDE =
  "Film posters used to be bright. Then, somewhere around the 2000s, they got darker and stayed there.";
const CH3_MORPH_BODY =
  "Each dot is a poster, placed by year and brightness. The drift downward isn't random, it tracks with how cinema learned to signal seriousness.";

const CH3_GENRE_TITLE = "Color by genre.";
const CH3_GENRE_P1 =
  'Genre has a palette. It\'s not accidental. Every stripe here is a poster. Stack them by genre and the columns start to separate.';
const CH3_GENRE_P2 =
  "Horror earns its darkness, romance keeps things warm and mid-range, comedy refuses to commit to anything. What looks like an aesthetic choice turns out to be a genre convention.";

function ch3Smoothstep01(t, edge0, edge1) {
  if (t <= edge0) return 0;
  if (t >= edge1) return 1;
  const x = (t - edge0) / (edge1 - edge0);
  return x * x * (3 - 2 * x);
}

function renderPinnedChapter3(slot, ctx) {
  clear(slot);
  slot.textContent = "";
  slot.className = "fig-slot ch3-figure-root";

  const root = el("div", { class: "ch3-scrolly-root" });
  const sticky = el("div", { class: "ch3-scrolly-sticky" });
  const num = el("p", { class: "ch3-pinned-num chapter-num" }, "02");
  const copyStack = el("div", { class: "ch3-copy-stack" });
  const copyA = el(
    "div",
    { class: "ch3-copy ch3-copy--a" },
    el("h2", { class: "ch3-pinned-h2" }, CH3_COMPARISON_TITLE),
    el("p", { class: "ch3-pinned-lede" }, CH3_COMPARISON_LEDE),
    el("p", { class: "ch3-pinned-body" }, CH3_COMPARISON_BODY)
  );
  const copyB = el(
    "div",
    { class: "ch3-copy ch3-copy--b" },
    el("h2", { class: "ch3-pinned-h2" }, CH3_MORPH_TITLE),
    el("p", { class: "ch3-pinned-lede" }, CH3_MORPH_LEDE),
    el("p", { class: "ch3-pinned-body" }, CH3_MORPH_BODY)
  );
  const copyC1 = el(
    "div",
    { class: "ch3-copy ch3-copy--c ch3-copy--c1" },
    el("h2", { class: "ch3-pinned-h2" }, CH3_GENRE_TITLE),
    el("p", { class: "ch3-pinned-lede" }, CH3_GENRE_P1)
  );
  const copyC2 = el(
    "div",
    { class: "ch3-copy ch3-copy--c ch3-copy--c2" },
    el("h2", { class: "ch3-pinned-h2" }, CH3_GENRE_TITLE),
    el("p", { class: "ch3-pinned-body" }, CH3_GENRE_P2)
  );
  copyStack.append(copyA, copyB, copyC1, copyC2);
  const viz = el("div", { class: "ch3-viz-layers" });
  const layerT = el("div", { class: "ch3-layer ch3-layer--timeline" });
  const layerM = el("div", { class: "ch3-layer ch3-layer--morph" });
  viz.append(layerT, layerM);
  sticky.append(num, copyStack, viz);
  root.append(sticky);
  slot.append(root);

  const timelineAnchors = new Map();
  const tmdbToLane = new Map();
  const TL = computeTimelineLayout(ctx.families, { movies: ctx.movies });
  if (TL) {
    for (const d of TL.data) {
      if (d.tmdbId != null && Number.isFinite(d.tmdbId)) {
        timelineAnchors.set(String(d.tmdbId), {
          x: TL.x(d.year),
          y: TL.y(d.laneId),
          r: TL.radiusFor(d),
        });
        tmdbToLane.set(Number(d.tmdbId), d.laneId);
      }
    }
  }

  const ch3Handoff = { lerp: 0 };
  const CH3_EMBED_SPEC = {
    viewHeight: 640,
    margin: { top: 44, right: 22, bottom: 44, left: 220 },
  };

  const timelineApiRaw = renderTimeline(layerT, {
    families: ctx.families,
    movies: ctx.movies,
    omitDots: true,
  });
  let lastCh3Mt = 0;

  const morphApi = renderMorphScrolly(layerM, {
    movies: ctx.movies,
    embedInParentScroll: true,
    embedSpec: CH3_EMBED_SPEC,
    timelineAnchors,
    getHandoffLerp: () => ch3Handoff.lerp,
    getTimelinePanelOpen: () => timelineApiRaw?.isPanelOpen?.() ?? false,
    timelineYearToX: TL != null ? (year, panelOpen) => timelineDotX(TL, year, panelOpen) : null,
    timelineClick:
      timelineApiRaw != null
        ? {
            handoffMax: 0.38,
            laneForTmdb: (id) => tmdbToLane.get(Number(id)) ?? null,
            selectLane: (laneId) => {
              timelineApiRaw.selectLane(laneId);
              morphApi?.frame(lastCh3Mt);
              requestAnimationFrame(() => morphApi?.frame(lastCh3Mt));
              setTimeout(() => morphApi?.frame(lastCh3Mt), 460);
            },
          }
        : null,
  });
  if (!morphApi) return;

  const COPY_OUT0 = 0.05;
  const COPY_OUT1 = 0.22;
  const CHROME_0 = 0.03;
  const CHROME_1 = 0.4;
  const MORPH_T0 = 0.36;

  function tick() {
    const r = root.getBoundingClientRect();
    const travel = Math.max(1, root.offsetHeight - window.innerHeight);
    const scrolled = Math.min(Math.max(-r.top, 0), travel);
    const p = scrolled / travel;

    const uA = 1 - ch3Smoothstep01(p, COPY_OUT0, COPY_OUT1);
    const uMorphBlock = 1 - uA;
    let mt = 0;
    if (p >= MORPH_T0) mt = (p - MORPH_T0) / (1 - MORPH_T0);
    const wGenre = ch3Smoothstep01(mt, 0.1, 0.32);
    const uGenrePanel = uMorphBlock * wGenre;
    const wGenreP2 =
      ch3Smoothstep01(mt, 0.45, 0.65) * ch3Smoothstep01(wGenre, 0.88, 1);
    const uC1 = uGenrePanel * (1 - wGenreP2);
    const uC2 = uGenrePanel * wGenreP2;
    const uB = uMorphBlock * (1 - wGenre);
    copyA.style.opacity = String(uA);
    copyB.style.opacity = String(uB);
    copyC1.style.opacity = String(uC1);
    copyC2.style.opacity = String(uC2);
    copyA.style.visibility = uA < 0.035 ? "hidden" : "visible";
    copyB.style.visibility = uB < 0.035 ? "hidden" : "visible";
    copyC1.style.visibility = uC1 < 0.035 ? "hidden" : "visible";
    copyC2.style.visibility = uC2 < 0.035 ? "hidden" : "visible";

    const uChrome = ch3Smoothstep01(p, CHROME_0, CHROME_1);
    ch3Handoff.lerp = uChrome;
    const uTim = 1 - uChrome;
    layerT.style.opacity = String(Math.max(0, Math.min(1, uTim)));
    layerM.style.opacity = "1";
    layerT.style.pointerEvents = uTim > 0.12 ? "auto" : "none";
    // Critical: prevent hover/tooltip events from invisible layers.
    layerM.style.pointerEvents = uChrome > 0.12 ? "auto" : "none";

    morphApi.frame(mt);
    lastCh3Mt = mt;
  }

  tick();
  let sched = false;
  function onScr() {
    if (sched) return;
    sched = true;
    requestAnimationFrame(() => {
      sched = false;
      tick();
    });
  }
  window.addEventListener("scroll", onScr, { passive: true });
  window.addEventListener("resize", onScr);
}

buildMasthead();
buildChapters();
setupRevealAnimations();
loadData().then(() => {
  setupDatalist();
  setupSearchVisibility();
  setupSearch();
  setupLazyRender();
});


function buildMasthead() {
  const dek =
    "This project examines how the color identity of the same story transforms across cinematic eras. By analyzing film remakes, it traces how visual palettes evolve over time and reflect changing aesthetic conventions.";
  const bylineSpans = [el("span", {}, "By Sofia Molina Schmidt")];

  const side = el(
    "aside",
    { class: "feel-side", "aria-hidden": "true" },
    el("div", { class: "feel-side__mark" })
  );

  const blob = el("div", { class: "feel-blob", "aria-hidden": "true" });

  const statTop = el(
    "div",
    { class: "feel-stat feel-stat--top", "aria-hidden": "true" },
    el("div", { class: "feel-stat__label" }, "450+"),
    el("div", { class: "feel-stat__sub" }, "remake families")
  );

  const statBottom = el(
    "div",
    { class: "feel-stat feel-stat--bottom", "aria-hidden": "true" },
    el("div", { class: "feel-stat__label" }, "1000+"),
    el("div", { class: "feel-stat__sub" }, "movies")
  );

  const statLeft = el(
    "div",
    { class: "feel-stat feel-stat--left", "aria-hidden": "true" },
    el("div", { class: "feel-stat__label" }, "TMDB"),
    el("div", { class: "feel-stat__sub" }, "dataset")
  );
  

  const hero = el(
    "div",
    { class: "feel-hero" },
    el("p", { class: "feel-kicker" }, "Remaking Color"),
    el("h1", { class: "feel-title", html: "Same story,<br/>different color." }),
    el("p", { class: "feel-dek" }, dek),
    el("p", { class: "byline" }, ...bylineSpans)
  );

  const stage = el(
    "div",
    { class: "feel-stage" },
    hero,
    el("div", { class: "feel-right" }, blob, statLeft, statTop, statBottom)
  );

  essay.append(
    el(
      "header",
      { class: "masthead" },
      side,
      stage
    )
  );

  // Hue wheel lightness: move mouse up/down to brighten/darken.
  const mast = essay.querySelector(".masthead");
  const wheel = mast?.querySelector?.(".feel-blob");
  if (mast && wheel) {
    const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!prefersReduce) {
      let targetB = 1.0;
      let currentB = 1.0;
      let targetRot = 0;
      let currentRot = 0;
      let targetX = 0;
      let currentX = 0;
      let targetY = 0;
      let currentY = 0;
      let raf = 0;

      const setVar = () => {
        wheel.style.setProperty("--wheelB", currentB.toFixed(3));
        wheel.style.setProperty("--wheelRot", `${currentRot.toFixed(2)}deg`);
        wheel.style.setProperty("--blobX", `${currentX.toFixed(1)}px`);
        wheel.style.setProperty("--blobY", `${currentY.toFixed(1)}px`);
      };

      const tick = () => {
        raf = 0;
        currentB += (targetB - currentB) * 0.10;
        currentX += (targetX - currentX) * 0.14;
        currentY += (targetY - currentY) * 0.14;
        // shortest-path angular easing
        let d = ((targetRot - currentRot + 540) % 360) - 180;
        currentRot = (currentRot + d * 0.10 + 360) % 360;
        setVar();
        if (
          Math.abs(targetB - currentB) + Math.abs(d) > 0.12 ||
          Math.abs(targetX - currentX) + Math.abs(targetY - currentY) > 0.6
        )
          raf = requestAnimationFrame(tick);
      };

      const onMove = (e) => {
        const r = mast.getBoundingClientRect();
        if (!r.height || !r.width) return;
        const nx = (e.clientX - r.left) / r.width; // 0..1
        const ny = (e.clientY - r.top) / r.height; // 0..1
        const x01 = Math.max(0, Math.min(1, nx));
        const y01 = Math.max(0, Math.min(1, ny));
        const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
        const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
        const maxPx = Math.min(34, r.width * 0.07);
        targetX = dx * maxPx;
        targetY = dy * maxPx * 0.75;
        // Top = brighter, bottom = darker. Make it more noticeable.
        targetB = 1.35 - y01 * 0.75; // ~[0.60..1.35]
        // Rotate wheel with mouse X.
        targetRot = x01 * 360;
        if (!raf) raf = requestAnimationFrame(tick);
      };

      mast.addEventListener("mousemove", onMove, { passive: true });
      mast.addEventListener(
        "mouseleave",
        () => {
          targetB = 1.0;
          targetRot = 0;
          targetX = 0;
          targetY = 0;
          if (!raf) raf = requestAnimationFrame(tick);
        },
        { passive: true }
      );
      setVar();
    }
  }
}

function buildChapters() {
  visibleChapters().forEach((ch, idx) => {
    let sectionClass = "chapter";
    if (ch.id === "c3") sectionClass = "chapter chapter--ch3-pinned";
    else if (ch.id === "c10") sectionClass = "chapter chapter--bleed-shell";
    else if (ch.id === "c1")
      sectionClass = "chapter chapter--bleed-shell chapter--pinned-copy-rhythm";
    const section = el("section", { class: sectionClass, id: ch.id, "data-index": String(idx) });
    const chapterNumDisplayed = String(idx + 1).padStart(2, "0");

    if (!PINNED_NO_STATIC_COPY.has(ch.id)) {
      if (ch.id === "c1") {
        const copy = el("div", { class: "ch01-intro-copy" });
        copy.append(el("p", { class: "chapter-num" }, chapterNumDisplayed));
        if (ch.heading) copy.append(el("h2", {}, ch.heading));
        if (ch.lede) copy.append(el("p", { class: "lede" }, ch.lede));
        if (ch.body) copy.append(el("p", { class: "body" }, ch.body));
        section.append(copy);
      } else {
        section.append(el("p", { class: "chapter-num" }, chapterNumDisplayed));
        if (ch.heading) section.append(el("h2", {}, ch.heading));
        if (ch.lede) section.append(el("p", { class: "lede" }, ch.lede));
        if (ch.body) section.append(el("p", { class: "body" }, ch.body));
      }
    }

    if (ch.render) {
      const slot = el("div", { class: "fig-slot loading-inline" }, "Rendering…");
      const figure = el(
        "figure",
        { class: `fig fig--${ch.figWidth || "wide"}`, "data-render": String(idx) },
        slot
      );
      section.append(figure);
    }

    essay.append(section);
  });
}

/* ---------------- data ---------------- */

async function loadData() {
  try {
    const [analytics, families] = await Promise.all([
      fetch("./data/analisis/analytics.json").then((r) => r.json()),
      fetch("./data/analisis/families.json").then((r) => r.json()),
    ]);
    state.analytics = analytics;
    state.families = mergeFamiliesByTitle(familiesRemakeOnly(families));

    const biggest = [...state.families].sort(
      (a, b) => (b.movies?.length || 0) - (a.movies?.length || 0)
    )[0];
    const firstMovie = biggest?.movies?.[0];
    if (firstMovie?.tmdbId) state.selectedFilmId = Number(firstMovie.tmdbId);
  } catch (err) {
    console.error("Failed to load analysis data", err);
  }
}

function setupDatalist() {
  clear(datalist);
  const allowed = tmdbIdsInFamilies(state.families);
  const movies = state.analytics?.movies || [];
  const options = movies
    .filter((m) => m.title && m.tmdbId != null && allowed.has(Number(m.tmdbId)))
    .map((m) => ({ id: Number(m.tmdbId), label: `${m.title} (${m.year ?? "—"})` }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 800);
  options.forEach((o) => datalist.append(el("option", { value: o.label })));
}

function setupSearchVisibility() {
  const section = document.getElementById("c10");
  if (!section) return;

  const setVisible = (on) => {
    searchDock.classList.toggle("is-visible", on);
  };

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        setVisible(entry.isIntersecting);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  io.observe(section);

  requestAnimationFrame(() => {
    const r = section.getBoundingClientRect();
    const vh = window.innerHeight;
    setVisible(r.top < vh * 0.92 && r.bottom > vh * 0.12);
  });
}

function setupSearch() {
  let timer = null;
  searchInput.addEventListener("input", (event) => {
    clearTimeout(timer);
    const value = event.target.value.trim().toLowerCase();
    timer = setTimeout(() => resolveSearch(value), 150);
  });
}

function resolveSearch(query) {
  if (!query) return;
  const allowed = tmdbIdsInFamilies(state.families);
  const movies = state.analytics?.movies || [];
  const match =
    movies.find((m) => `${m.title} (${m.year ?? "—"})`.toLowerCase() === query) ||
    movies.find((m) => (m.title || "").toLowerCase().includes(query));
  if (!match?.tmdbId || !allowed.has(Number(match.tmdbId))) return;
  state.selectedFilmId = Number(match.tmdbId);
  // Re-render the case study chapter
  renderChapter(chapterIndexById("c10"), true);
  document.getElementById("c10")?.scrollIntoView({ behavior: "smooth" });
}

/* ---------------- scroll reveal (Energy-style fade / lift) ---------------- */

function setupRevealAnimations() {
  const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduce) {
    document.querySelectorAll(".masthead, section.chapter, aside.chapter").forEach((el) => {
      el.classList.add("is-revealed");
    });
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.03, rootMargin: "0px 0px -12% 0px" }
  );

  document.querySelectorAll(".masthead, section.chapter, aside.chapter").forEach((el) => {
    io.observe(el);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll(".masthead, section.chapter, aside.chapter").forEach((el) => {
      if (el.classList.contains("is-revealed")) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.96 && r.bottom > 0) el.classList.add("is-revealed");
    });
  });
}

/* ---------------- lazy render ---------------- */

function setupLazyRender() {
  const figures = document.querySelectorAll("[data-render]");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const idx = Number(entry.target.getAttribute("data-render"));
        renderChapter(idx, false);
      });
    },
    { rootMargin: "200px 0px" }
  );
  figures.forEach((f) => io.observe(f));
}

function renderChapter(idx, force) {
  if (!state.analytics) return;
  if (!force && state.rendered.has(idx)) return;
  const chapter = visibleChapters()[idx];
  if (!chapter?.render) return;

  const fig = document.querySelector(`[data-render="${idx}"]`);
  const slot = fig?.querySelector(".fig-slot");
  if (!slot) return;

  slot.classList.remove("loading-inline");
  slot.textContent = "";

  chapter.render(slot, {
    analytics: state.analytics,
    movies: moviesThatBelongToRemakeFamilies(state.families, state.analytics?.movies || []),
    families: state.families,
    currentSelectedFilm: () =>
      (state.analytics?.movies || []).find(
        (m) => Number(m.tmdbId) === Number(state.selectedFilmId)
      ) || null,
    onSelectFamily: (familyId) => {
      const fam = (state.families || []).find((f) => f.familyId === familyId);
      const first = fam?.movies?.[0];
      if (!first?.tmdbId) return;
      state.selectedFilmId = Number(first.tmdbId);
      openPosterAnalysis({ familyId, families: state.families });
    },
  });

  state.rendered.add(idx);
}

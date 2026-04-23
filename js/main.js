import { el, clear } from "./color.js";
import { renderIntro } from "./intro.js";
import { renderTimeline, computeTimelineLayout, timelineDotX } from "./timeline.js";
import { renderMorph, renderMorphScrolly, renderSentimentToScatterPinned } from "./morph.js";
import { renderConclusion } from "./conclusion.js";
import { openPosterAnalysis } from "./poster-analysis.js";

/**
 * Editorial long-form — single centered column with figures that break out.
 * Each chapter has: number, italic serif heading, body, and an inline figure.
 * Figures are rendered lazily the first time they enter the viewport.
 */

const CHAPTERS = [
  {
    id: "c1",
    num: "01",
    heading: "The same story, again.",
    lede:
      "Every remake is a reinterpretation — of the story, of the time, and, in ways we rarely notice, of its color.",
    body:
      "A film remake is the same narrative dressed for a different decade. This essay asks what that redressing does to the image itself — and to how it feels.",
    figWidth: "bleed",
    render: (c, ctx) => renderIntro(c, ctx),
  },
  {
    id: "c2",
    num: "02",
    heading: "A question of color.",
    lede:
      "How does the color identity of a story change across cinematic eras? And what happens to its emotional tone?",
    body:
      "These are aesthetic questions, but they are also measurable. Across 650 films we extract a single dominant color and a single sentiment score — two numbers per movie, two coordinates on a map.",
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
    id: "c7",
    num: "04",
    heading: null,
    lede: null,
    body: null,
    figWidth: "bleed",
    render: (slot, ctx) => renderPinnedChapterSentimentScatter(slot, ctx),
  },
  {
    id: "c10",
    num: "05",
    heading: "The atlas of remakes.",
    lede: "Films don’t just change how they look. They change how they feel.",
    body: "Every family, reduced to a chromatic strip. Click any title to inspect it.",
    figWidth: "bleed",
    render: (c, ctx) =>
      renderConclusion(c, {
        combined: ctx.combined,
        analytics: ctx.analytics,
        families: ctx.families,
        onSelectFamily: ctx.onSelectFamily,
      }),
  },
];

/** Chapter ids with no static heading in <section>; copy lives inside pinned figures. */
const PINNED_NO_STATIC_COPY = new Set(["c3", "c7"]);

const state = {
  combined: null,
  analytics: null,
  families: [],
  sentimentFeatures: [],
  selectedFilmId: null,
  rendered: new Set(),
};

const essay = document.getElementById("essay");
const searchDock = document.getElementById("search-dock");
const searchInput = document.getElementById("search");
const datalist = document.getElementById("film-list");

function forceStartAtTop() {
  // Prevent browser/session history from restoring previous scroll position.
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const resetScroll = () => window.scrollTo(0, 0);
  resetScroll();
  requestAnimationFrame(resetScroll);
}

forceStartAtTop();
window.addEventListener("load", forceStartAtTop, { once: true });
window.addEventListener("pageshow", forceStartAtTop);

const CH3_COMPARISON_TITLE = "The first comparison";
const CH3_COMPARISON_LEDE =
  "Remake families hold the story constant. What changes is the decade, the filmmaker, the palette — the zeitgeist. Each lane is one family across time; each dot is a film, coloured by its dominant colour.";
const CH3_COMPARISON_BODY =
  "This shows how the same narrative can shift from the muted tones of the 1930s to the high-contrast or saturated palettes of the 2020s.";

const CH3_MORPH_TITLE = "Color over time.";
const CH3_MORPH_LEDE =
  "Now let’s shift the focus to the luminosity and density of film aesthetics across a century of cinema.";
const CH3_MORPH_BODY =
  "The vertical axis now measures how light or dark the film’s key color is—with higher dots representing brighter, more vibrant palettes and lower dots indicating \"moodier\" or darker frames.";
const CH3_MORPH_P3 =
  "The data illustrates a historical trend toward darker, more desaturated tones in modern posters compared to the mid-20th century.";

const CH3_GENRE_TITLE = "Color by genre.";
const CH3_GENRE_P1 =
  'Since each line reflects the dominant color of its movie poster, the visualization reveals distinct "color signatures" for different genres—such as the dark, moody palettes of Horror and Thriller versus the bright, eclectic spectrum found in Comedy.';
const CH3_GENRE_P2 =
  "By stacking these posters chronologically, the graph also illustrates the exponential growth of the film industry, showing how sparse distributions in the 1930s evolved into the dense, saturated blocks of color seen in the modern era.";

const CH7_SENT_TITLE = "Sentiment drifts.";
const CH7_SENT_P1 =
  "While our previous charts focused on the dominant colors of posters, we now layer in Natural Language Processing to analyze TMDB plot summaries, measuring how \"upbeat\" or \"heavy\" a film’s story actually is.";
const CH7_SENT_P2 =
  "The steady blue trend line tracks the emotional pulse of the industry across decades, allowing us to see if the \"moodier\" dark palettes we detected earlier align with more somber storytelling.";
const CH7_SENT_P3 =
  "By comparing the evolution of color with these emotional shifts, we can finally see a complete picture of the cinematic zeitgeist: how the look and the feel of movies move together to reflect the spirit of their time.";

const CH8_SCATTER_TITLE = "Color × Sentiment.";
const CH8_SCATTER_P1 =
  "By plotting poster brightness on the horizontal axis against narrative sentiment on the vertical axis, this chart directly visualizes the correlation between a film’s visuals and its actual story.";
const CH8_SCATTER_P2 =
  "Most films cluster along a diagonal where visuals match the vibe: bright posters typically signal upbeat stories, while dark tones suggest heavier themes.";
const CH8_SCATTER_P3 =
  "The real intrigue lies in the outliers—the \"visual subversions\" that defy expectations. These represent the deliberate visual choices where a gritty story is hidden behind a cheerful palette, or a positive tale is framed in moody shadows, highlighting the tension between a film’s true soul and its public face.";

function ch3Smoothstep01(t, edge0, edge1) {
  if (t <= edge0) return 0;
  if (t >= edge1) return 1;
  const x = (t - edge0) / (edge1 - edge0);
  return x * x * (3 - 2 * x);
}

function bindPinnedScroll(root, tick) {
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

/** Pinned ch.04: sentiment strip → brightness×sentiment scatter; one sticky chart frame, copy steps like ch.03. */
function renderPinnedChapterSentimentScatter(slot, ctx) {
  clear(slot);
  slot.textContent = "";
  slot.className = "fig-slot ch7-figure-root";

  const root = el("div", { class: "ch7-scrolly-root" });
  const sticky = el("div", { class: "ch7-scrolly-sticky" });
  const num = el("p", { class: "ch7-pinned-num chapter-num" }, "04");
  const copyStack = el("div", { class: "ch7-copy-stack" });
  const copyS1 = el(
    "div",
    { class: "ch7-copy ch7-copy--s1" },
    el("h2", { class: "ch7-pinned-h2" }, CH7_SENT_TITLE),
    el("p", { class: "ch7-pinned-lede" }, CH7_SENT_P1)
  );
  const copyS2 = el(
    "div",
    { class: "ch7-copy ch7-copy--s2" },
    el("h2", { class: "ch7-pinned-h2" }, CH7_SENT_TITLE),
    el("p", { class: "ch7-pinned-body" }, CH7_SENT_P2)
  );
  const copyS3 = el(
    "div",
    { class: "ch7-copy ch7-copy--s3" },
    el("h2", { class: "ch7-pinned-h2" }, CH7_SENT_TITLE),
    el("p", { class: "ch7-pinned-body" }, CH7_SENT_P3)
  );
  const copyC1 = el(
    "div",
    { class: "ch7-copy ch7-copy--c1" },
    el("h2", { class: "ch7-pinned-h2" }, CH8_SCATTER_TITLE),
    el("p", { class: "ch7-pinned-lede" }, CH8_SCATTER_P1)
  );
  const copyC2 = el(
    "div",
    { class: "ch7-copy ch7-copy--c2" },
    el("h2", { class: "ch7-pinned-h2" }, CH8_SCATTER_TITLE),
    el("p", { class: "ch7-pinned-body" }, CH8_SCATTER_P2)
  );
  const copyC3 = el(
    "div",
    { class: "ch7-copy ch7-copy--c3" },
    el("h2", { class: "ch7-pinned-h2" }, CH8_SCATTER_TITLE),
    el("p", { class: "ch7-pinned-body" }, CH8_SCATTER_P3)
  );
  copyStack.append(copyS1, copyS2, copyS3, copyC1, copyC2, copyC3);
  const viz = el("div", { class: "ch7-viz-layers" });
  const layer = el("div", { class: "ch7-layer" });
  viz.append(layer);
  sticky.append(num, copyStack, viz);
  root.append(sticky);
  slot.append(root);

  const chart = renderSentimentToScatterPinned(layer, {
    movies: ctx.movies,
    sentimentFeatures: ctx.sentimentFeatures,
  });
  if (!chart) return;

  function tick() {
    const r = root.getBoundingClientRect();
    const travel = Math.max(1, root.offsetHeight - window.innerHeight);
    const scrolled = Math.min(Math.max(-r.top, 0), travel);
    const p = scrolled / travel;

    const pSent = 1 - ch3Smoothstep01(p, 0.4, 0.48);
    const w12 = ch3Smoothstep01(p, 0.06, 0.19);
    const w23 = ch3Smoothstep01(p, 0.21, 0.36);
    const uS1 = pSent * (1 - w12);
    const uS2 = pSent * w12 * (1 - w23);
    const uS3 = pSent * w23;

    const pScat = ch3Smoothstep01(p, 0.44, 0.52);
    const wC12 = ch3Smoothstep01(p, 0.48, 0.6);
    const wC23 = ch3Smoothstep01(p, 0.62, 0.76);
    const uC1 = pScat * (1 - wC12);
    const uC2 = pScat * wC12 * (1 - wC23);
    const uC3 = pScat * wC23;

    const wMorph = ch3Smoothstep01(p, 0.26, 0.54);

    copyS1.style.opacity = String(uS1);
    copyS2.style.opacity = String(uS2);
    copyS3.style.opacity = String(uS3);
    copyC1.style.opacity = String(uC1);
    copyC2.style.opacity = String(uC2);
    copyC3.style.opacity = String(uC3);
    copyS1.style.visibility = uS1 < 0.035 ? "hidden" : "visible";
    copyS2.style.visibility = uS2 < 0.035 ? "hidden" : "visible";
    copyS3.style.visibility = uS3 < 0.035 ? "hidden" : "visible";
    copyC1.style.visibility = uC1 < 0.035 ? "hidden" : "visible";
    copyC2.style.visibility = uC2 < 0.035 ? "hidden" : "visible";
    copyC3.style.visibility = uC3 < 0.035 ? "hidden" : "visible";

    const meanLine = Math.min(1, (1 - uS1) * pSent);
    const notesOp = 0;
    const lblOp = uC1 * 0.35 + uC2 * 0.65 + uC3 * 1;

    chart.frame({ morph: wMorph, notes: notesOp, scatterLbl: lblOp, meanLine });
  }

  bindPinnedScroll(root, tick);
}

/** One pinned viewport: scroll swaps copy and crossfades timeline → morph, then drives morph like the old ch.05 track. */
function renderPinnedChapter3(slot, ctx) {
  clear(slot);
  slot.textContent = "";
  slot.className = "fig-slot ch3-figure-root";

  const root = el("div", { class: "ch3-scrolly-root" });
  const sticky = el("div", { class: "ch3-scrolly-sticky" });
  const num = el("p", { class: "ch3-pinned-num chapter-num" }, "03");
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
    el("p", { class: "ch3-pinned-body" }, CH3_MORPH_BODY),
    el("p", { class: "ch3-pinned-body" }, CH3_MORPH_P3)
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
  const TL = computeTimelineLayout(ctx.families);
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

  const timelineApiRaw = renderTimeline(layerT, { families: ctx.families, omitDots: true });
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
    layerM.style.pointerEvents = "auto";

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

/* ---------------- build ---------------- */

function buildMasthead() {
  essay.append(
    el(
      "header",
      { class: "masthead" },
      el("p", { class: "crumb" }, "Thesis · Data visualization · 2026"),
      el("h1", { html: "Remaking <em>Color.</em>" }),
      el(
        "p",
        { class: "dek" },
        "The same story, retold across time, never looks the same. A visual essay on color and sentiment in film remakes, 1930 to today."
      ),
      el(
        "p",
        { class: "byline" },
        el("span", {}, "By Sofia"),
        el("span", {}, "Color · Sentiment"),
        el("span", {}, "TMDB · 650 films")
      )
    )
  );
}

function buildChapters() {
  CHAPTERS.forEach((ch, idx) => {
    let sectionClass = "chapter";
    if (ch.id === "c3") sectionClass = "chapter chapter--ch3-pinned";
    else if (ch.id === "c7") sectionClass = "chapter chapter--pinned-morph";
    else if (ch.id === "c10") sectionClass = "chapter chapter--bleed-shell";
    else if (ch.id === "c1" || ch.id === "c2")
      sectionClass = "chapter chapter--bleed-shell chapter--pinned-copy-rhythm";
    const section = el("section", { class: sectionClass, id: ch.id, "data-index": String(idx) });

    if (!PINNED_NO_STATIC_COPY.has(ch.id)) {
      section.append(el("p", { class: "chapter-num" }, ch.num));
      if (ch.heading) section.append(el("h2", {}, ch.heading));
      if (ch.lede) section.append(el("p", { class: "lede" }, ch.lede));
      if (ch.body) section.append(el("p", { class: "body" }, ch.body));
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

    // Pull quote halfway through
    if (idx === 2) {
      essay.append(
        el(
          "aside",
          { class: "chapter" },
          el(
            "blockquote",
            { class: "pull" },
            "“A remake doesn't just retell a story — it repaints it.”"
          )
        )
      );
    }
  });
}

/* ---------------- data ---------------- */

async function loadData() {
  try {
    const [combined, analytics, families, sentimentFeatures] = await Promise.all([
      fetch("./data/analisis/combined_analysis.json").then((r) => r.json()),
      fetch("./data/analisis/analytics.json").then((r) => r.json()),
      fetch("./data/analisis/families.json").then((r) => r.json()),
      fetch("./data/analisis/sentiment_features.json").then((r) => r.json()),
    ]);
    state.combined = combined;
    state.analytics = analytics;
    state.families = families;
    state.sentimentFeatures = sentimentFeatures;

    const biggest = [...(families || [])]
      .filter((f) => (f.movieCount || 0) > 1)
      .sort((a, b) => (b.movieCount || 0) - (a.movieCount || 0))[0];
    const firstMovie = biggest?.movies?.[0];
    if (firstMovie?.tmdbId) state.selectedFilmId = Number(firstMovie.tmdbId);
  } catch (err) {
    console.error("Failed to load analysis data", err);
  }
}

function setupDatalist() {
  clear(datalist);
  const movies = state.analytics?.movies || [];
  const options = movies
    .filter((m) => m.title && m.tmdbId != null)
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
  const movies = state.analytics?.movies || [];
  const match =
    movies.find((m) => `${m.title} (${m.year ?? "—"})`.toLowerCase() === query) ||
    movies.find((m) => (m.title || "").toLowerCase().includes(query));
  if (!match?.tmdbId) return;
  state.selectedFilmId = Number(match.tmdbId);
  // Re-render the case study chapter
  renderChapter(4, true);
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
    { threshold: 0.07, rootMargin: "0px 0px -6% 0px" }
  );

  document.querySelectorAll(".masthead, section.chapter, aside.chapter").forEach((el) => {
    io.observe(el);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll(".masthead, section.chapter, aside.chapter").forEach((el) => {
      if (el.classList.contains("is-revealed")) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) el.classList.add("is-revealed");
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
  if (!state.combined || !state.analytics) return;
  if (!force && state.rendered.has(idx)) return;
  const chapter = CHAPTERS[idx];
  if (!chapter?.render) return;

  const fig = document.querySelector(`[data-render="${idx}"]`);
  const slot = fig?.querySelector(".fig-slot");
  if (!slot) return;

  slot.classList.remove("loading-inline");
  slot.textContent = "";

  chapter.render(slot, {
    combined: state.combined,
    analytics: state.analytics,
    movies: state.analytics.movies || [],
    families: state.families,
    sentimentFeatures: state.sentimentFeatures,
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

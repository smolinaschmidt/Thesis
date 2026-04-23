# Project structure

Plain static site (`html + css + js` modules) + Python pipeline for data.

## Root

- `index.html` — single page, loads `styles.css` + `js/main.js`.
- `styles.css` — cinematic, minimal UI. Data-driven color, neutral chrome.
- `package.json` — only holds a helper `start` script (Python static server).
- `README.md` — setup + narrative notes.
- `LICENSE` — project license.

## `js/` — one module per section, plus small helpers

- `main.js` — entry. Loads analysis JSON, builds the 10-step rail, runs the `IntersectionObserver` scroll trigger, wires the top-right search, and renders into the sticky `#visual` container.
- `color.js` — hue classification, hex↔rgb, `brightness`, `shade`, `posterUrl`, and the tiny `el()` / `clear()` DOM helpers used everywhere.
- `tooltip.js` — single shared tooltip (bound to `#tooltip` in `index.html`).
- `intro.js` — sections 1–2 (hook, posters, palette morph).
- `timeline.js` — section 3 (remake families across time, hover lanes).
- `method.js` — section 4 (two pipelines diagram).
- `morph.js` — sections 5–8 in one sticky D3 chart, four data stages:
  - 0 decade hue stacks
  - 1 genre hue stacks (same rectangles, re-keyed)
  - 2 sentiment dots + decade mean line
  - 3 brightness × sentiment scatter
- `case-study.js` — section 9 (search-driven original vs remake comparison).
- `conclusion.js` — section 10 (small multiples grid → clickable cells back into case study).

## `data/` — processed analysis artifacts

- `data/Final_Database.csv` — source CSV dataset.
- `data/poster/`, `data/trailers/` — media files.
- `data/analisis/` — all Python-generated analysis outputs.

### Inside `data/analisis/`

- `analytics.json`
- `families.json`
- `color_analysis.json`
- `genre_analysis.json`
- `sentiment_analysis.json`
- `combined_analysis.json`
- `sentiment_features.json`
- `movies_enriched.json`
- `movies_with_families.csv`
- `movies_with_families.json`
- `tmdb_cache.json`
- `data_quality_report.json`
- `poster_palettes.json` — `{tmdbId: 10×5 grid of [R,G,B]}` for every film
- `trailer_timelines.json` — `{tmdbId: [[R,G,B], …]}` (array index = second)
- `review/family_inference_review.csv`

## `scripts/` — Python pipeline

- `build_remake_families.py` — infer remake families from the base CSV.
- `enrich_tmdb_metadata.py` — enrich dataset with TMDB metadata.
- `build_sentiment_features.py` — language detection, translation, and sentiment extraction.
- `generate_color_analytics.py` — analysis snapshots consumed by the webpage.
- `extract_media_colors.py` — extract color artifacts from posters/trailers.
- `data_quality_report.py` — create quality/completeness report.
- `consolidate_media_colors.py` — merge legacy per-film JSONs into the two consolidated files (run once after a fresh extraction if you had the old folder structure).
- `run_pipeline.sh` — helper for pipeline execution.

## Run it

```bash
npm start                   # python3 -m http.server 5173
# or
python3 -m http.server 5173
```

Then open http://localhost:5173/.

D3 is imported as an ES module from a CDN inside `js/timeline.js`, `js/morph.js`. No build step, no `node_modules`.

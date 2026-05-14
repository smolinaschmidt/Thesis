"""
Extract visual color artifacts from movie posters.

For each movie in data/analisis/movies_enriched.json (1000+ films):
  1) Download poster (from TMDB) and extract an 8×5 per-cell k-means palette grid.

Outputs (written incrementally so interrupting a run never loses already-processed films):
  - data/analisis/poster_palettes.json    {tmdbId: 8×5 grid of [R,G,B]}
  - data/poster/poster_<tmdb_id>.jpg      cached poster

Usage:
  # Extract posters for all movies. Safe to resume.
  python3 scripts/extract_media_colors.py

  # Only films missing a valid 8×5 grid (catch-up).
  python3 scripts/extract_media_colors.py --only-missing

  # Coverage report vs analytics.json
  python3 scripts/report_poster_palette_coverage.py

  # Only a handful of films (useful for testing).
  python3 scripts/extract_media_colors.py --limit 20

  # Only the four thesis families.
  python3 scripts/extract_media_colors.py --featured-only

  # Force re-analysis of films that already have an artifact.
  python3 scripts/extract_media_colors.py --force
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import requests
from sklearn.cluster import KMeans


ROOT = Path(__file__).resolve().parent.parent
ENRICHED_INPUT = ROOT / "data" / "analisis" / "movies_enriched.json"
POSTER_PALETTES = ROOT / "data" / "analisis" / "poster_palettes.json"
POSTER_DIR = ROOT / "data" / "poster"

FEATURED_FAMILIES = {"Carrie", "Great Gatsby", "Star Is Born", "Little Mermaid"}
GRID_ROWS = 8
GRID_COLS = 5
GRID_LEGACY_ROWS = 10


def _looks_like_image(data: bytes) -> bool:
    if len(data) < 500:
        return False
    if data[:2] == b"\xff\xd8":
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:4] in (b"GIF87a", b"GIF89a"):
        return True
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    return False


def tmdb_poster_urls(poster_ref: str) -> list[str]:
    ref = (poster_ref or "").strip()
    if ref.startswith("http://") or ref.startswith("https://"):
        return [ref]
    if not ref.startswith("/"):
        ref = "/" + ref
    sizes = ("w500", "w780", "w342", "original")
    return [f"https://image.tmdb.org/t/p/{sz}{ref}" for sz in sizes]


def poster_grid_valid(grid: Any) -> bool:
    if not isinstance(grid, list) or len(grid) not in (GRID_ROWS, GRID_LEGACY_ROWS):
        return False
    for row in grid:
        if not isinstance(row, list) or len(row) != GRID_COLS:
            return False
        for cell in row:
            if not isinstance(cell, (list, tuple)) or len(cell) != 3:
                return False
            if not all(isinstance(x, (int, float)) for x in cell):
                return False
    return True

def load_movies() -> list[dict[str, Any]]:
    if not ENRICHED_INPUT.exists():
        raise FileNotFoundError(
            f"Missing {ENRICHED_INPUT}. Run enrich_tmdb_metadata.py first."
        )
    return json.loads(ENRICHED_INPUT.read_text(encoding="utf-8"))


def load_family_titles() -> dict[str, str]:
    path = ROOT / "data" / "analisis" / "families.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(f.get("familyId") or ""): str(f.get("familyTitle") or "") for f in payload}


# Color extraction

def dominant_rgb_from_pixels(pixels: np.ndarray) -> list[int]:
    km = KMeans(n_clusters=1, n_init=1, max_iter=24, random_state=0)
    km.fit(pixels.astype(np.float32))
    centroid = km.cluster_centers_[0]
    # Input expected as BGR from OpenCV -> convert to RGB
    return [int(centroid[2]), int(centroid[1]), int(centroid[0])]


def _poster_bgr(poster_path: Path) -> np.ndarray | None:
    img = cv2.imread(str(poster_path))
    if img is not None and img.size > 0:
        return img
    try:
        from PIL import Image

        rgb = np.array(Image.open(poster_path).convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def extract_poster_grid(poster_path: Path) -> list[list[list[int]]]:
    img = _poster_bgr(poster_path)
    if img is None:
        return []
    h, w = img.shape[:2]
    cell_h = h // GRID_ROWS
    cell_w = w // GRID_COLS
    if cell_h <= 0 or cell_w <= 0:
        return []
    grid: list[list[list[int]]] = []
    for r in range(GRID_ROWS):
        row: list[list[int]] = []
        for c in range(GRID_COLS):
            y1, y2 = r * cell_h, (r + 1) * cell_h
            x1, x2 = c * cell_w, (c + 1) * cell_w
            block = img[y1:y2, x1:x2]
            if block.size == 0:
                row.append([0, 0, 0])
                continue
            pixels = block.reshape(-1, 3)
            row.append(dominant_rgb_from_pixels(pixels))
        grid.append(row)
    return grid

# Downloads

def download_poster(urls: list[str], output_path: Path, *, force: bool = False) -> bool:
    """
    Try each URL until one yields image bytes. Reuse an existing file if it
    decodes unless `force`.
    Returns True when `output_path` contains a readable poster afterwards.
    """
    if (
        output_path.exists()
        and output_path.stat().st_size > 512
        and not force
        and _poster_bgr(output_path) is not None
    ):
        return True
    headers = {
        "User-Agent": (
            "RemakingColorPosterBot/1.0 "
            "(film colour research atlas; collage-based poster sampling)"
        ),
    }
    for url in urls:
        try:
            response = requests.get(url, timeout=45, headers=headers)
            if response.status_code != 200:
                continue
            data = response.content
            if not _looks_like_image(data):
                continue
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(data)
            if _poster_bgr(output_path) is not None:
                return True
            output_path.unlink(missing_ok=True)
        except Exception as exc:  # noqa: BLE001
            print(f"    poster fetch failed ({url[:64]}…): {exc}")
            continue
    return (
        output_path.exists()
        and output_path.stat().st_size > 512
        and _poster_bgr(output_path) is not None
    )

# Per-film pipeline

def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def process_movie(
    movie: dict[str, Any],
    *,
    poster_store: dict[str, Any],
    force: bool,
    only_missing: bool,
) -> bool:
    tmdb_id = movie.get("tmdbId")
    if not tmdb_id:
        return False
    tmdb_id = int(tmdb_id)
    key = str(tmdb_id)

    changed = False

    # --- Poster ---
    poster_file = POSTER_DIR / f"poster_{tmdb_id}.jpg"
    poster_ref = movie.get("posterPath")
    if poster_ref:
        existing = poster_store.get(key)
        skip_poster = only_missing and not force and poster_grid_valid(existing)
        if not skip_poster and (force or not poster_grid_valid(existing)):
            urls = tmdb_poster_urls(str(poster_ref))
            download_poster(urls, poster_file, force=force)
            if poster_file.exists() and _poster_bgr(poster_file) is not None:
                grid = extract_poster_grid(poster_file)
                if poster_grid_valid(grid):
                    poster_store[key] = grid
                    changed = True
                else:
                    print("    poster: could not produce a valid 8×5 grid")

    return changed

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Process only first N movies.")
    parser.add_argument(
        "--featured-only",
        action="store_true",
        help="Process only the thesis families: Carrie, Gatsby, Star Is Born, Little Mermaid.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-analyse even if a JSON artifact already exists for the film.",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Skip films that already have a valid 8×5 grid.",
    )
    args = parser.parse_args()

    movies = load_movies()

    if args.featured_only:
        family_titles = load_family_titles()
        movies = [
            m for m in movies
            if family_titles.get(str(m.get("familyId") or ""), "") in FEATURED_FAMILIES
        ]

    if args.limit and args.limit > 0:
        movies = movies[: args.limit]

    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    POSTER_PALETTES.parent.mkdir(parents=True, exist_ok=True)

    poster_store = _load_json(POSTER_PALETTES)

    if args.force:
        stale = [tid for tid, grid in poster_store.items() if not poster_grid_valid(grid)]
        for tid in stale:
            poster_store.pop(tid)
        if stale:
            print(f"dropped {len(stale)} invalid poster entries; will re-extract")

    total = len(movies)
    start = time.time()
    processed = 0
    changed_total = 0
    failed = 0

    for idx, movie in enumerate(movies, start=1):
        title = (movie.get("title") or "?")[:60]
        tmdb_id = movie.get("tmdbId")
        print(f"[{idx:>4}/{total}] {tmdb_id} · {title}", flush=True)
        try:
            changed = process_movie(
                movie,
                poster_store=poster_store,
                force=args.force,
                only_missing=args.only_missing,
            )
            processed += 1
            if changed:
                changed_total += 1
            if idx % 20 == 0 and changed_total:
                _write_json(POSTER_PALETTES, poster_store)
        except KeyboardInterrupt:
            print("\nInterrupted — flushing consolidated JSONs and exiting.")
            break
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"    ERROR: {exc}")

    _write_json(POSTER_PALETTES, poster_store)

    elapsed = time.time() - start
    print(
        f"\nDone. processed={processed} changed={changed_total} failed={failed} "
        f"total={total} elapsed={elapsed:.1f}s ({elapsed / max(1, total):.1f}s/film)"
    )
    print(f"  posters:  {len(poster_store)} films in {POSTER_PALETTES.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

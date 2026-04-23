"""
Consolidate the 654 per-film JSON artifacts in data/analisis/media_colors/
into two single files the frontend can load once:

  data/analisis/poster_palettes.json
      { "<tmdbId>": <10×5 grid of [R,G,B]>, ... }

  data/analisis/trailer_timelines.json
      { "<tmdbId>": [[R,G,B], [R,G,B], ...], ... }
      (index = second of the trailer; one entry per second)

Why: 654 small files clutter the repo and force the browser to do one fetch
per film. Two consolidated files are smaller on disk, faster to load,
and still easy to keep in sync with the pipeline.

Usage:
  python3 scripts/consolidate_media_colors.py
      write both consolidated files, leave per-film JSONs alone.

  python3 scripts/consolidate_media_colors.py --purge
      after writing the consolidated files, delete the per-film JSONs
      and the legacy index.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA_DIR = ROOT / "data" / "analisis" / "media_colors"
POSTER_OUT = ROOT / "data" / "analisis" / "poster_palettes.json"
TRAILER_OUT = ROOT / "data" / "analisis" / "trailer_timelines.json"


def timeline_to_flat(timeline: list[dict]) -> list[list[int]] | None:
    """
    Convert [{'second': n, 'color': [R,G,B]}, ...] → [[R,G,B], ...]
    where the array index == the second. Fills gaps with the previous
    color (trailers almost never have gaps, but be defensive).
    """
    if not timeline:
        return None
    max_sec = max(int(entry.get("second", 0)) for entry in timeline)
    colors: list[list[int] | None] = [None] * (max_sec + 1)
    for entry in timeline:
        sec = int(entry.get("second", 0))
        color = entry.get("color")
        if color and 0 <= sec <= max_sec:
            colors[sec] = [int(color[0]), int(color[1]), int(color[2])]
    # forward-fill any None gaps so the frontend doesn't have to care
    last = [0, 0, 0]
    for i, c in enumerate(colors):
        if c is None:
            colors[i] = last
        else:
            last = c
    return colors  # type: ignore[return-value]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--purge",
        action="store_true",
        help="Delete the per-film JSONs and legacy index.json after consolidating.",
    )
    args = parser.parse_args()

    if not MEDIA_DIR.exists():
        raise SystemExit(f"Missing folder: {MEDIA_DIR}")

    posters: dict[str, list] = {}
    trailers: dict[str, list] = {}
    per_film_files: list[Path] = []

    for path in sorted(MEDIA_DIR.glob("*.json")):
        if path.name == "index.json":
            continue
        per_film_files.append(path)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"skip (bad json): {path.name}")
            continue
        tmdb = str(data.get("tmdbId") or path.stem)

        grid = data.get("posterGrid")
        if grid:
            posters[tmdb] = grid

        timeline = data.get("trailerTimeline")
        flat = timeline_to_flat(timeline or [])
        if flat:
            trailers[tmdb] = flat

    POSTER_OUT.write_text(json.dumps(posters, separators=(",", ":")), encoding="utf-8")
    TRAILER_OUT.write_text(json.dumps(trailers, separators=(",", ":")), encoding="utf-8")

    size_posters = POSTER_OUT.stat().st_size / 1024
    size_trailers = TRAILER_OUT.stat().st_size / 1024
    print(f"{POSTER_OUT.relative_to(ROOT)}  {len(posters):>4} films  {size_posters:>7.1f} KB")
    print(f"{TRAILER_OUT.relative_to(ROOT)} {len(trailers):>4} films  {size_trailers:>7.1f} KB")

    if args.purge:
        removed = 0
        for path in per_film_files:
            path.unlink()
            removed += 1
        legacy_index = MEDIA_DIR / "index.json"
        if legacy_index.exists():
            legacy_index.unlink()
            removed += 1
        # Remove the now-empty folder too
        try:
            MEDIA_DIR.rmdir()
            print(f"removed {removed} files and empty folder {MEDIA_DIR.relative_to(ROOT)}")
        except OSError:
            print(f"removed {removed} files (folder kept — not empty)")


if __name__ == "__main__":
    main()

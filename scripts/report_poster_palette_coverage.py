#!/usr/bin/env python3
"""Report poster palette coverage vs analytics (which films lack a grid in poster_palettes.json)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANALYTICS = ROOT / "data" / "analisis" / "analytics.json"
POSTER_PALETTES = ROOT / "data" / "analisis" / "poster_palettes.json"
GRID_ROWS = 8
GRID_COLS = 5
GRID_LEGACY_ROWS = 10


def grid_ok(grid) -> bool:
    if not grid or len(grid) not in (GRID_ROWS, GRID_LEGACY_ROWS):
        return False
    return all(isinstance(row, list) and len(row) == GRID_COLS for row in grid)


def main() -> None:
    if not ANALYTICS.exists():
        print("Missing analytics.json", file=sys.stderr)
        sys.exit(1)
    movies = json.loads(ANALYTICS.read_text(encoding="utf-8")).get("movies") or []
    n = len(movies)
    store = {}
    if POSTER_PALETTES.exists():
        try:
            store = json.loads(POSTER_PALETTES.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    missing_grid: list[tuple[int, str, int | None]] = []
    no_poster_path: list[tuple[int, str]] = []
    bad_shape: list[tuple[int, str]] = []

    extractable = sum(
        1 for m in movies if m.get("tmdbId") is not None and m.get("posterPath")
    )

    for m in movies:
        tid = m.get("tmdbId")
        if tid is None:
            continue
        try:
            tid_i = int(tid)
        except (TypeError, ValueError):
            continue
        key = str(tid_i)
        title = str(m.get("title") or "?")
        year = m.get("year")
        has_path = bool(m.get("posterPath"))
        g = store.get(key)
        if not has_path:
            no_poster_path.append((tid_i, title))
            continue
        if key not in store or not g:
            yi = None
            if year is not None:
                try:
                    yi = int(float(year))
                except (TypeError, ValueError):
                    pass
            missing_grid.append((tid_i, title, yi))
        elif not grid_ok(g):
            bad_shape.append((tid_i, title))

    fixed = extractable - len(missing_grid) - len(bad_shape)
    print(f"Films total: {n}")
    print(f"With TMDB posterPath: {extractable} (eligible for extraction)")
    print(f"Valid {GRID_ROWS}×{GRID_COLS} (or legacy {GRID_LEGACY_ROWS}×{GRID_COLS}) grid in poster_palettes.json: {fixed}/{extractable}")
    print(f"  Missing grid:     {len(missing_grid)}")
    print(f"  Wrong grid shape: {len(bad_shape)}")
    print(f"  No posterPath:    {len(no_poster_path)}")
    if bad_shape:
        print("\nBad shape (re-run extract with --force):")
        for tid, title in bad_shape[:30]:
            print(f"  {tid}\t{title}")
    if missing_grid:
        print("\nMissing grid (run: python3 scripts/extract_media_colors.py --skip-trailers --only-missing):")
        for tid, title, year in missing_grid[:80]:
            ys = f" ({year})" if year else ""
            print(f"  {tid}\t{title}{ys}")
        if len(missing_grid) > 80:
            print(f"  … and {len(missing_grid) - 80} more")


if __name__ == "__main__":
    main()

"""
Consolidate per-film poster JSON artifacts in data/analisis/media_colors/
into a single file the frontend can load once:

"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA_DIR = ROOT / "data" / "analisis" / "media_colors"
POSTER_OUT = ROOT / "data" / "analisis" / "poster_palettes.json"


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

    POSTER_OUT.write_text(json.dumps(posters, separators=(",", ":")), encoding="utf-8")

    size_posters = POSTER_OUT.stat().st_size / 1024
    print(f"{POSTER_OUT.relative_to(ROOT)}  {len(posters):>4} films  {size_posters:>7.1f} KB")

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

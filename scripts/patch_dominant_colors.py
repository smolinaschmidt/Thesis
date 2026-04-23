"""
Patch the three data files that store `dominantHex` / `dominantRgb`
with the REAL colour extracted from each film's poster palette grid.

Until now those fields were filled by `build_remake_families.py` using
a deterministic hash of the title — i.e. a *synthetic* colour that does
not match the poster at all. That synthetic value leaks into the
front-end as "Dominant hue: Green" on posters that are clearly beige,
and contaminates the colour-over-time beeswarm.

This script:
  1. Reads `data/analisis/poster_palettes.json`.
  2. For every film, runs K-means (k=1) over all grid cells to get a
     single honest RGB centroid.
  3. Rewrites `dominantRgb` + `dominantHex` in:
       - data/analisis/families.json
       - data/analisis/movies_enriched.json
       - data/analisis/analytics.json
       - data/analisis/combined_analysis.json
  4. Flags the colour source as "poster_kmeans" so you can tell later
     that this film is no longer running on synthetic data.

It does not touch colour distributions in `color_analysis.json` — those
are aggregates computed elsewhere by `generate_color_analytics.py`.
Re-run that script afterwards if you want the aggregates to match.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans


ROOT = Path(__file__).resolve().parent.parent
POSTER_PALETTES = ROOT / "data" / "analisis" / "poster_palettes.json"

FILES_WITH_MOVIES = [
    ROOT / "data" / "analisis" / "families.json",
    ROOT / "data" / "analisis" / "movies_enriched.json",
    ROOT / "data" / "analisis" / "analytics.json",
    ROOT / "data" / "analisis" / "combined_analysis.json",
]


def rgb_to_hex(rgb: list[int]) -> str:
    r, g, b = [max(0, min(255, int(v))) for v in rgb]
    return f"#{r:02x}{g:02x}{b:02x}"


def compute_dominant(grid: list[list[list[int]]]) -> list[int] | None:
    if not grid:
        return None
    flat = np.array([c for row in grid for c in row], dtype=np.float32)
    if flat.size == 0:
        return None
    km = KMeans(n_clusters=1, n_init=1, max_iter=24, random_state=0)
    km.fit(flat)
    centroid = km.cluster_centers_[0]
    return [int(centroid[0]), int(centroid[1]), int(centroid[2])]


def patch_movie_dict(movie: dict, dominants: dict[str, dict]) -> bool:
    tmdb = str(movie.get("tmdbId") or "")
    info = dominants.get(tmdb)
    if not info:
        return False
    movie["dominantRgb"] = info["rgb"]
    movie["dominantHex"] = info["hex"]
    movie["colorSource"] = "poster_kmeans"
    return True


def patch_file(path: Path, dominants: dict[str, dict]) -> int:
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    touched = 0

    def walk(obj):
        nonlocal touched
        if isinstance(obj, dict):
            if "tmdbId" in obj and ("dominantHex" in obj or "dominantRgb" in obj or "title" in obj):
                if patch_movie_dict(obj, dominants):
                    touched += 1
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(data)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return touched


def main() -> None:
    if not POSTER_PALETTES.exists():
        raise SystemExit(f"Missing {POSTER_PALETTES}")

    posters = json.loads(POSTER_PALETTES.read_text(encoding="utf-8"))
    print(f"poster palettes loaded: {len(posters)} films")

    dominants: dict[str, dict] = {}
    for tmdb, grid in posters.items():
        rgb = compute_dominant(grid)
        if rgb is None:
            continue
        dominants[tmdb] = {"rgb": rgb, "hex": rgb_to_hex(rgb)}
    print(f"computed real dominants: {len(dominants)} films")

    for path in FILES_WITH_MOVIES:
        n = patch_file(path, dominants)
        print(f"  patched {n:>4} movie entries in {path.relative_to(ROOT)}")

    print(
        "\nNext: re-run `python3 scripts/generate_color_analytics.py` so the "
        "aggregated distributions in color_analysis.json match the real "
        "dominants."
    )


if __name__ == "__main__":
    main()

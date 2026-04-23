"""
Generate a compact data quality report from processed analytics.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "analisis"
ANALYTICS_PATH = PROCESSED / "analytics.json"
FAMILIES_PATH = PROCESSED / "families.json"
REPORT_PATH = PROCESSED / "data_quality_report.json"


def main() -> None:
    if not ANALYTICS_PATH.exists() or not FAMILIES_PATH.exists():
        raise FileNotFoundError("Missing analytics.json or families.json. Run pipeline first.")

    analytics = json.loads(ANALYTICS_PATH.read_text(encoding="utf-8"))
    families = json.loads(FAMILIES_PATH.read_text(encoding="utf-8"))

    movies = analytics.get("movies", [])
    total_movies = len(movies)

    missing = {
      "posterPath": sum(1 for movie in movies if not movie.get("posterPath")),
      "trailerKey": sum(1 for movie in movies if not movie.get("trailerKey")),
      "tmdbId": sum(1 for movie in movies if not movie.get("tmdbId")),
      "year": sum(1 for movie in movies if movie.get("year") is None),
      "genres": sum(1 for movie in movies if not movie.get("genres")),
    }

    family_size_distribution = {}
    unresolved_singletons = 0
    for family in families:
        size = int(family.get("movieCount", 0))
        family_size_distribution[size] = family_size_distribution.get(size, 0) + 1
        if size == 1:
            unresolved_singletons += 1

    completeness_pct = {
      key: round((1 - (value / total_movies)) * 100, 2) if total_movies else 0
      for key, value in missing.items()
    }

    report = {
      "generatedAt": analytics.get("generatedAt"),
      "totalMovies": total_movies,
      "totalFamilies": len(families),
      "missingCounts": missing,
      "completenessPercent": completeness_pct,
      "familySizeDistribution": dict(sorted(family_size_distribution.items(), key=lambda item: item[0])),
      "singletonFamilies": unresolved_singletons,
      "notes": [
        "Singleton families are expected before manual review consolidation.",
        "Trailer absence often reflects missing official trailer entries in TMDB metadata.",
      ],
    }

    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()


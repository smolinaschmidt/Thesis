"""
Generate cached analytics for frontend visual components.

Inputs:
  - data/analisis/movies_enriched.json (preferred)
  - data/analisis/movies_with_families.json (fallback)

Outputs:
  - data/analisis/analytics.json
  - data/analisis/families.json
"""

from __future__ import annotations

import colorsys
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "analisis"
ENRICHED_PATH = PROCESSED / "movies_enriched.json"
FAMILY_PATH = PROCESSED / "movies_with_families.json"
TMDB_CACHE_PATH = PROCESSED / "tmdb_cache.json"
POSTER_PALETTES_PATH = PROCESSED / "poster_palettes.json"
ANALYTICS_OUT = PROCESSED / "analytics.json"
FAMILIES_OUT = PROCESSED / "families.json"
COLOR_ANALYSIS_OUT = PROCESSED / "color_analysis.json"
GENRE_ANALYSIS_OUT = PROCESSED / "genre_analysis.json"
SENTIMENT_FEATURES_PATH = PROCESSED / "sentiment_features.json"
SENTIMENT_ANALYSIS_OUT = PROCESSED / "sentiment_analysis.json"
COMBINED_ANALYSIS_OUT = PROCESSED / "combined_analysis.json"

LOCAL_COLOR_FILES = {
    ("Carrie", 1976): ROOT / "colors_1976.json",
    ("Carrie", 2002): ROOT / "colors_2002.json",
    ("Carrie", 2013): ROOT / "colors_2013.json",
}


def deterministic_color(seed: str) -> list[int]:
    hashed = sum((idx + 1) * ord(ch) for idx, ch in enumerate(seed))
    r = 50 + (hashed * 53) % 180
    g = 40 + (hashed * 79) % 180
    b = 30 + (hashed * 97) % 180
    return [r, g, b]


def _family_assignments_from_build() -> tuple[dict[int, str], dict[tuple[str, int], str]]:
    """TMDB id → family_id and (normalized_title, year) → family_id from build output."""
    if not FAMILY_PATH.exists():
        return {}, {}
    rows = json.loads(FAMILY_PATH.read_text(encoding="utf-8"))
    by_tmdb: dict[int, str] = {}
    by_title_year: dict[tuple[str, int], str] = {}
    for row in rows:
        fid = row.get("family_id")
        if fid is None or fid == "":
            continue
        fid_s = str(fid)
        tid = row.get("tmdb_id")
        if tid is not None:
            try:
                by_tmdb[int(tid)] = fid_s
            except (TypeError, ValueError):
                pass
        nt = (row.get("normalized_title") or "").strip().lower()
        y = row.get("year")
        if nt and y is not None:
            try:
                by_title_year[(nt, int(float(y)))] = fid_s
            except (TypeError, ValueError):
                pass
    return by_tmdb, by_title_year


def load_input_records() -> list[dict[str, Any]]:
    family_by_tmdb, family_by_title_year = _family_assignments_from_build()

    if ENRICHED_PATH.exists():
        records = json.loads(ENRICHED_PATH.read_text(encoding="utf-8"))
        orphans = 0
        for row in records:
            fid = None
            tid = row.get("tmdbId") if row.get("tmdbId") is not None else row.get("tmdb_id")
            if tid is not None:
                try:
                    fid = family_by_tmdb.get(int(tid))
                except (TypeError, ValueError):
                    pass
            if fid is None:
                nt = (row.get("normalizedTitle") or row.get("normalized_title") or "").strip().lower()
                y = row.get("year")
                if nt and y is not None:
                    try:
                        fid = family_by_title_year.get((nt, int(float(y))))
                    except (TypeError, ValueError):
                        pass
            if fid is not None:
                row["familyId"] = fid
            else:
                orphans += 1
                try:
                    row["familyId"] = f"SGL{int(tid):08d}" if tid is not None else "SGL00000000"
                except (TypeError, ValueError):
                    row["familyId"] = "SGL00000000"
        if orphans and FAMILY_PATH.exists():
            print(
                f"Note: {orphans} enriched row(s) had no match in movies_with_families.json "
                f"(stale enrich vs CSV). Re-run enrich_tmdb_metadata.py after build_remake_families.py."
            )
        return records

    if FAMILY_PATH.exists():
        return json.loads(FAMILY_PATH.read_text(encoding="utf-8"))

    raise FileNotFoundError("Run build_remake_families.py first.")


def load_tmdb_ratings() -> dict[int, dict[str, Any]]:
    """Build `{tmdbId: {voteAverage, voteCount, popularity}}` from the TMDB cache.

    Lets us surface success signals in the frontend without an extra TMDB round-trip.
    """
    if not TMDB_CACHE_PATH.exists():
        return {}
    try:
        cache = json.loads(TMDB_CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    ratings: dict[int, dict[str, Any]] = {}
    for key, value in cache.items():
        if not key.startswith("movie:") or not key.endswith(":details") or not isinstance(value, dict):
            continue
        try:
            tmdb_id = int(key.split(":", 2)[1])
        except (ValueError, IndexError):
            continue
        ratings[tmdb_id] = {
            "voteAverage": value.get("vote_average"),
            "voteCount": value.get("vote_count"),
            "popularity": value.get("popularity"),
        }
    return ratings


def load_poster_palettes() -> dict[int, list[list[list[int]]]]:
    """Return `{tmdbId: grid}` where grid is a 2D list of [R,G,B] cells."""
    if not POSTER_PALETTES_PATH.exists():
        return {}
    try:
        raw = json.loads(POSTER_PALETTES_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    out: dict[int, list[list[list[int]]]] = {}
    for key, grid in raw.items():
        try:
            out[int(key)] = grid
        except (ValueError, TypeError):
            continue
    return out


def dominant_from_poster_grid(grid: list[list[list[int]]]) -> list[int] | None:
    """Saturation-weighted mean of every cell in the poster palette.

    Heavy greys, near-blacks, and near-whites are down-weighted so the
    resulting color reflects what the poster actually reads as chromatically,
    not the background of the image.
    """
    if not grid:
        return None
    total_weight = 0.0
    acc_r = acc_g = acc_b = 0.0
    for row in grid:
        for cell in row or []:
            if not cell or len(cell) < 3:
                continue
            r, g, b = cell[0], cell[1], cell[2]
            _, light, sat = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
            # Penalize greys (low saturation) and extremes (very dark / very
            # light). `+0.05` keeps every cell contributing at least a little
            # so we never divide by zero on a monochrome poster.
            lightness_gain = 1.0 - abs(light - 0.5) * 2.0
            weight = sat * max(lightness_gain, 0.0) + 0.05
            acc_r += r * weight
            acc_g += g * weight
            acc_b += b * weight
            total_weight += weight
    if total_weight <= 0:
        return None
    return [
        max(0, min(255, round(acc_r / total_weight))),
        max(0, min(255, round(acc_g / total_weight))),
        max(0, min(255, round(acc_b / total_weight))),
    ]


def local_color_for_movie(
    title: str,
    year: int | None,
    tmdb_id: int | None,
    poster_palettes: dict[int, list[list[list[int]]]],
) -> tuple[list[int], str]:
    # Preferred: saturation-weighted dominant color from the actual poster.
    if tmdb_id is not None:
        grid = poster_palettes.get(int(tmdb_id))
        if grid:
            rgb = dominant_from_poster_grid(grid)
            if rgb:
                return rgb, "poster_palette"

    # Secondary: trailer frame average for a small set of manually
    # annotated films (legacy).
    key = (title, year)
    color_file = LOCAL_COLOR_FILES.get(key)
    if color_file and color_file.exists():
        payload = json.loads(color_file.read_text(encoding="utf-8"))
        frames = payload.get("frames", [])
        if frames:
            rs = [frame["color"][0] for frame in frames]
            gs = [frame["color"][1] for frame in frames]
            bs = [frame["color"][2] for frame in frames]
            return (
                [round(sum(rs) / len(rs)), round(sum(gs) / len(gs)), round(sum(bs) / len(bs))],
                "trailer_sample",
            )

    # Last resort: deterministic seed so films without media still render.
    return deterministic_color(f"{title}-{year}"), "deterministic_seed"


def to_decade(year: int | None) -> int | None:
    if year is None:
        return None
    return (year // 10) * 10


def classify_color_group(rgb: list[int]) -> str:
    r = max(0, min(255, rgb[0])) / 255.0
    g = max(0, min(255, rgb[1])) / 255.0
    b = max(0, min(255, rgb[2])) / 255.0
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    hue_deg = hue * 360

    if sat < 0.18 or light < 0.14 or light > 0.88:
        return "Neutral"
    if hue_deg < 18 or hue_deg >= 345:
        return "Red"
    if hue_deg < 45:
        return "Orange"
    if hue_deg < 70:
        return "Yellow"
    if hue_deg < 165:
        return "Green"
    if hue_deg < 255:
        return "Blue"
    return "Purple"


def build_distribution(counter: Counter[str]) -> list[dict[str, Any]]:
    total = sum(counter.values()) or 1
    return [
        {
            "label": label,
            "movieCount": count,
            "percentage": round((count / total) * 100, 2),
        }
        for label, count in sorted(counter.items(), key=lambda item: item[1], reverse=True)
    ]


def load_sentiment_features() -> list[dict[str, Any]]:
    if not SENTIMENT_FEATURES_PATH.exists():
        return []
    payload = json.loads(SENTIMENT_FEATURES_PATH.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    return []


def _record_sort_key(record: dict[str, Any]) -> tuple:
    fam = str(record.get("familyId") or record.get("family_id") or "UNASSIGNED")
    y = record.get("year")
    if y is None or y == "":
        ysort = 9999
    else:
        try:
            ysort = int(float(y))
        except (TypeError, ValueError):
            ysort = 9999
    title = (record.get("title") or "").lower()
    return (fam, ysort, title)


def build() -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any], dict[str, Any], dict[str, Any]]:
    raw_records = load_input_records()
    raw_records = sorted(raw_records, key=_record_sort_key)
    tmdb_ratings = load_tmdb_ratings()
    poster_palettes = load_poster_palettes()
    movies: list[dict[str, Any]] = []
    families_grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for record in raw_records:
        title = record.get("title", "Unknown")
        year = record.get("year")
        family_id = record.get("familyId") or record.get("family_id") or "UNASSIGNED"
        genres = record.get("genres", [])
        if isinstance(genres, str):
            genres = [piece.strip() for piece in genres.split(",") if piece.strip()]

        tmdb_id = record.get("tmdbId") or record.get("tmdb_id")
        tmdb_id_int = None
        try:
            if tmdb_id is not None:
                tmdb_id_int = int(tmdb_id)
        except (TypeError, ValueError):
            tmdb_id_int = None
        rgb, source = local_color_for_movie(title, year, tmdb_id_int, poster_palettes)
        rating_info = tmdb_ratings.get(tmdb_id_int) if tmdb_id_int is not None else None
        vote_average = record.get("voteAverage")
        vote_count = record.get("voteCount")
        popularity = record.get("popularity")
        if rating_info:
            if vote_average is None:
                vote_average = rating_info.get("voteAverage")
            if vote_count is None:
                vote_count = rating_info.get("voteCount")
            if popularity is None:
                popularity = rating_info.get("popularity")

        movie = {
            "title": title,
            "year": year,
            "decade": to_decade(year),
            "tmdbId": tmdb_id,
            "tmdbLink": record.get("tmdbLink") or record.get("tmdb_link"),
            "familyId": family_id,
            "familyTitle": (record.get("normalizedTitle") or record.get("normalized_title") or title).title(),
            "genres": genres,
            "posterPath": record.get("posterPath") or record.get("poster_path"),
            "trailerKey": record.get("trailerKey") or record.get("trailer_key"),
            "overview": record.get("overview"),
            "dominantRgb": rgb,
            "dominantHex": "#{:02x}{:02x}{:02x}".format(*rgb),
            "colorSource": source,
            "voteAverage": vote_average,
            "voteCount": vote_count,
            "popularity": popularity,
        }
        movies.append(movie)
        families_grouped[family_id].append(movie)

    decade_counter = Counter(movie["decade"] for movie in movies if movie["decade"] is not None)
    genre_counter = Counter(genre for movie in movies for genre in movie["genres"])

    decades = [
        {"decade": decade, "movieCount": count}
        for decade, count in sorted(decade_counter.items(), key=lambda item: item[0])
    ]
    genres = [
        {"genre": genre, "movieCount": count}
        for genre, count in sorted(genre_counter.items(), key=lambda item: item[1], reverse=True)
    ]

    families = []
    for family_id, family_movies in sorted(families_grouped.items(), key=lambda item: item[0]):
        ordered = sorted(family_movies, key=lambda movie: movie["year"] if movie["year"] is not None else 9999)
        years = [movie["year"] for movie in ordered if movie["year"] is not None]
        family_title = ordered[0]["familyTitle"] if ordered else family_id
        families.append(
            {
                "familyId": family_id,
                "familyTitle": family_title,
                "movieCount": len(ordered),
                "yearRange": [min(years), max(years)] if years else [None, None],
                "movies": ordered,
            }
        )

    summary = {
        "totalMovies": len(movies),
        "totalFamilies": len(families),
        "decadeCount": len(decades),
        "genreCount": len(genres),
        "withTmdbId": sum(1 for movie in movies if movie["tmdbId"]),
        "withPoster": sum(1 for movie in movies if movie["posterPath"]),
        "withTrailer": sum(1 for movie in movies if movie["trailerKey"]),
    }

    analytics = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "movies": movies,
        "decades": decades,
        "genres": genres,
    }
    generated_at = analytics["generatedAt"]

    color_counter = Counter(classify_color_group(movie["dominantRgb"]) for movie in movies)
    colors_by_decade: dict[int, Counter[str]] = defaultdict(Counter)
    for movie in movies:
        if movie["decade"] is not None:
            colors_by_decade[movie["decade"]][classify_color_group(movie["dominantRgb"])] += 1

    color_analysis = {
        "generatedAt": generated_at,
        "summary": {
            "totalMovies": len(movies),
            "colorGroupCount": len(color_counter),
        },
        "distribution": build_distribution(color_counter),
        "byDecade": [
            {
                "decade": decade,
                "movieCount": sum(counter.values()),
                "distribution": build_distribution(counter),
            }
            for decade, counter in sorted(colors_by_decade.items(), key=lambda item: item[0])
        ],
    }

    genres_by_decade: dict[int, Counter[str]] = defaultdict(Counter)
    for movie in movies:
        if movie["decade"] is None:
            continue
        for genre in movie["genres"]:
            genres_by_decade[movie["decade"]][genre] += 1
    genre_analysis = {
        "generatedAt": generated_at,
        "summary": {
            "totalMovies": len(movies),
            "uniqueGenres": len(genre_counter),
        },
        "distribution": [
            {"genre": genre, "movieCount": count}
            for genre, count in sorted(genre_counter.items(), key=lambda item: item[1], reverse=True)
        ],
        "byDecade": [
            {
                "decade": decade,
                "genreMentions": sum(counter.values()),
                "distribution": [
                    {"genre": genre, "movieCount": count}
                    for genre, count in sorted(counter.items(), key=lambda item: item[1], reverse=True)
                ],
            }
            for decade, counter in sorted(genres_by_decade.items(), key=lambda item: item[0])
        ],
    }

    sentiments = load_sentiment_features()
    sentiment_label_counter = Counter(
        str(entry.get("sentimentLabel", "neutral")).lower() for entry in sentiments
    )
    sentiment_by_decade: dict[int, Counter[str]] = defaultdict(Counter)
    translated_count = 0
    for entry in sentiments:
        label = str(entry.get("sentimentLabel", "neutral")).lower()
        year = entry.get("year")
        if isinstance(year, int):
            sentiment_by_decade[to_decade(year)][label] += 1
        if entry.get("translatedToEnglish"):
            translated_count += 1

    sentiment_analysis = {
        "generatedAt": generated_at,
        "summary": {
            "totalMovies": len(movies),
            "moviesWithSentiment": len(sentiments),
            "translatedToEnglish": translated_count,
            "missingSentiment": max(0, len(movies) - len(sentiments)),
        },
        "distribution": build_distribution(sentiment_label_counter),
        "byDecade": [
            {
                "decade": decade,
                "movieCount": sum(counter.values()),
                "distribution": build_distribution(counter),
            }
            for decade, counter in sorted(sentiment_by_decade.items(), key=lambda item: item[0])
        ],
        "sourceFile": str(SENTIMENT_FEATURES_PATH.relative_to(ROOT)),
        "notes": [] if sentiments else ["sentiment_features.json not found; run build_sentiment_features.py."],
    }

    return analytics, families, color_analysis, genre_analysis, sentiment_analysis


def main() -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    analytics, families, color_analysis, genre_analysis, sentiment_analysis = build()
    combined_analysis = {
        "generatedAt": analytics["generatedAt"],
        "summary": {
            "totalMovies": analytics["summary"]["totalMovies"],
            "sources": ["color_analysis", "genre_analysis", "sentiment_analysis"],
        },
        "color": color_analysis,
        "genre": genre_analysis,
        "sentiment": sentiment_analysis,
    }
    ANALYTICS_OUT.write_text(json.dumps(analytics, indent=2), encoding="utf-8")
    FAMILIES_OUT.write_text(json.dumps(families, indent=2), encoding="utf-8")
    COLOR_ANALYSIS_OUT.write_text(json.dumps(color_analysis, indent=2), encoding="utf-8")
    GENRE_ANALYSIS_OUT.write_text(json.dumps(genre_analysis, indent=2), encoding="utf-8")
    SENTIMENT_ANALYSIS_OUT.write_text(json.dumps(sentiment_analysis, indent=2), encoding="utf-8")
    COMBINED_ANALYSIS_OUT.write_text(json.dumps(combined_analysis, indent=2), encoding="utf-8")
    print(f"Wrote {ANALYTICS_OUT}")
    print(f"Wrote {FAMILIES_OUT}")
    print(f"Wrote {COLOR_ANALYSIS_OUT}")
    print(f"Wrote {GENRE_ANALYSIS_OUT}")
    print(f"Wrote {SENTIMENT_ANALYSIS_OUT}")
    print(f"Wrote {COMBINED_ANALYSIS_OUT}")


if __name__ == "__main__":
    main()


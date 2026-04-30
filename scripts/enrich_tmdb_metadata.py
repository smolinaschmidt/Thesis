"""
Enrich inferred remake dataset with TMDB metadata.

Input:
  data/analisis/movies_with_families.csv

Outputs:
  data/analisis/movies_enriched.json
  data/analisis/tmdb_cache.json
"""

from __future__ import annotations

import csv
import json
import os
import time
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parent.parent
INPUT_CSV = ROOT / "data" / "analisis" / "movies_with_families.csv"
OUTPUT_JSON = ROOT / "data" / "analisis" / "movies_enriched.json"
CACHE_JSON = ROOT / "data" / "analisis" / "tmdb_cache.json"
TMDB_BASE = "https://api.themoviedb.org/3"


def load_cache() -> dict[str, Any]:
    if CACHE_JSON.exists():
        return json.loads(CACHE_JSON.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict[str, Any]) -> None:
    CACHE_JSON.parent.mkdir(parents=True, exist_ok=True)
    CACHE_JSON.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def tmdb_get(path: str, api_key: str) -> dict[str, Any]:
    resp = requests.get(
        f"{TMDB_BASE}{path}",
        params={"api_key": api_key},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def load_movies() -> list[dict[str, str]]:
    with INPUT_CSV.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def pick_trailer_key(videos_payload: dict[str, Any]) -> str | None:
    results = videos_payload.get("results", [])
    for video in results:
        if video.get("site") == "YouTube" and video.get("type") == "Trailer":
            return video.get("key")
    for video in results:
        if video.get("site") == "YouTube":
            return video.get("key")
    return None


def enrich_row(row: dict[str, str], api_key: str, cache: dict[str, Any]) -> dict[str, Any]:
    tmdb_id = (row.get("tmdb_id") or "").strip()
    details = {}
    videos = {}
    images = {}

    if tmdb_id:
        details_key = f"movie:{tmdb_id}:details"
        videos_key = f"movie:{tmdb_id}:videos"
        images_key = f"movie:{tmdb_id}:images"

        if details_key not in cache:
            cache[details_key] = tmdb_get(f"/movie/{tmdb_id}", api_key)
            time.sleep(0.06)
        if videos_key not in cache:
            cache[videos_key] = tmdb_get(f"/movie/{tmdb_id}/videos", api_key)
            time.sleep(0.06)

        details = cache.get(details_key, {})
        videos = cache.get(videos_key, {})

        # Some TMDB entries omit poster_path even though posters exist. Fall back
        # to the images endpoint to grab the first poster file_path.
        if (details.get("poster_path") is None) and images_key not in cache:
            try:
                cache[images_key] = tmdb_get(f"/movie/{tmdb_id}/images", api_key)
                time.sleep(0.06)
            except Exception:
                cache[images_key] = {}
        images = cache.get(images_key, {})

    genres = []
    if details.get("genres"):
        genres = [genre.get("name") for genre in details["genres"] if genre.get("name")]
    elif row.get("genres"):
        genres = [piece.strip() for piece in row["genres"].split(",") if piece.strip()]

    overview = details.get("overview")
    trailer_key = pick_trailer_key(videos) if videos else None
    poster_path = details.get("poster_path")
    if not poster_path and images.get("posters"):
        try:
            poster_path = images["posters"][0].get("file_path")
        except Exception:
            poster_path = poster_path

    return {
        "title": row.get("movie", ""),
        "year": int(float(row["year"])) if row.get("year") else None,
        "tmdbId": int(tmdb_id) if tmdb_id else None,
        "tmdbLink": row.get("tmdb_link", ""),
        "familyId": row.get("family_id", ""),
        "normalizedTitle": row.get("normalized_title", ""),
        "genres": genres,
        "posterPath": poster_path,
        "backdropPath": details.get("backdrop_path"),
        "overview": overview,
        "overviewLanguage": details.get("original_language"),
        "runtime": details.get("runtime"),
        "voteAverage": details.get("vote_average"),
        "releaseDate": details.get("release_date"),
        "trailerKey": trailer_key,
        "hasPoster": bool(poster_path),
        "hasTrailer": bool(trailer_key),
        "hasOverview": bool(overview and str(overview).strip()),
    }


def main() -> None:
    api_key = os.getenv("TMDB_API_KEY")
    if not api_key:
        raise RuntimeError("TMDB_API_KEY env variable is required.")

    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"Missing input file: {INPUT_CSV}")

    rows = load_movies()
    cache = load_cache()
    enriched: list[dict[str, Any]] = []

    for idx, row in enumerate(rows, start=1):
        if idx % 50 == 0:
            print(f"Processed {idx}/{len(rows)} movies...")
            save_cache(cache)
        try:
            enriched.append(enrich_row(row, api_key, cache))
        except Exception as error:
            print(f"TMDB enrich failed for '{row.get('movie')}' ({row.get('tmdb_id')}): {error}")
            enriched.append(
                {
                    "title": row.get("movie", ""),
                    "year": int(float(row["year"])) if row.get("year") else None,
                    "tmdbId": int(row["tmdb_id"]) if row.get("tmdb_id") else None,
                    "tmdbLink": row.get("tmdb_link", ""),
                    "familyId": row.get("family_id", ""),
                    "normalizedTitle": row.get("normalized_title", ""),
                    "genres": [piece.strip() for piece in row.get("genres", "").split(",") if piece.strip()],
                    "posterPath": None,
                    "backdropPath": None,
                    "overview": None,
                    "overviewLanguage": None,
                    "runtime": None,
                    "voteAverage": None,
                    "releaseDate": None,
                    "trailerKey": None,
                    "hasPoster": False,
                    "hasTrailer": False,
                    "hasOverview": False,
                }
            )

    OUTPUT_JSON.write_text(json.dumps(enriched, indent=2), encoding="utf-8")
    save_cache(cache)
    print(f"Enriched records: {len(enriched)}")
    print(f"Wrote {OUTPUT_JSON} and {CACHE_JSON}")


if __name__ == "__main__":
    main()


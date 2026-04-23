"""
Build sentiment features from TMDB overviews.

Pipeline:
  1) Detect overview language.
  2) Translate non-English text to English.
  3) Run RoBERTa sentiment model on English text.

Output:
  - data/analisis/sentiment_features.json

By default processes every row in movies_enriched.json (no cap). Use --resume to
only score films not yet present in the output file (faster after an interrupted run).

Usage:
  python3 scripts/build_sentiment_features.py
  python3 scripts/build_sentiment_features.py --resume
  python3 scripts/build_sentiment_features.py --limit 100   # dev / smoke test
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent.parent
ENRICHED_INPUT = ROOT / "data" / "analisis" / "movies_enriched.json"
OUT_FILE = ROOT / "data" / "analisis" / "sentiment_features.json"
# Hugging Face cache inside the repo so the script works in sandboxes / CI without ~/.cache writes
HF_CACHE_DIR = ROOT / "data" / ".hf_cache"


def ensure_hf_cache_env() -> None:
    HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(HF_CACHE_DIR))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(HF_CACHE_DIR))
    os.environ.setdefault("TRANSFORMERS_CACHE", str(HF_CACHE_DIR))


def load_dependencies():
    try:
        from deep_translator import GoogleTranslator
        from langdetect import detect, LangDetectException
        from transformers import pipeline
    except Exception as error:  # pragma: no cover
        raise RuntimeError(
            "Missing dependencies. Install: pip install transformers torch deep-translator langdetect"
        ) from error
    return GoogleTranslator, detect, LangDetectException, pipeline


def normalize_label(raw_label: str) -> str:
    label = raw_label.strip().lower()
    aliases = {
        "negative": "negative",
        "neutral": "neutral",
        "positive": "positive",
        "label_0": "negative",
        "label_1": "neutral",
        "label_2": "positive",
    }
    return aliases.get(label, "neutral")


def detect_language(text: str, detect_fn, lang_exception_cls) -> str:
    try:
        return str(detect_fn(text))
    except lang_exception_cls:
        return "unknown"
    except Exception:
        return "unknown"


def maybe_translate_to_english(text: str, source_language: str, translator) -> tuple[str, bool]:
    if not text.strip():
        return "", False
    if source_language in {"en", "unknown"}:
        return text, False
    try:
        translated = translator.translate(text)
        if isinstance(translated, str) and translated.strip():
            return translated, True
    except Exception:
        pass
    return text, False


def build_sentiment_entry(
    movie: dict[str, Any],
    detect_fn,
    lang_exception_cls,
    translator,
    sentiment_model,
) -> dict[str, Any]:
    overview = str(movie.get("overview") or "").strip()
    source_language = str(movie.get("overviewLanguage") or "").strip() or detect_language(
        overview, detect_fn, lang_exception_cls
    )
    text_used, translated = maybe_translate_to_english(overview, source_language, translator)

    sentiment_scores = {"negative": 0.0, "neutral": 0.0, "positive": 0.0}
    sentiment_label = "neutral"
    sentiment_conf = 0.0

    if text_used.strip():
        raw = sentiment_model(text_used[:512], top_k=None)
        if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], list):
            predictions = raw[0]
        elif isinstance(raw, list):
            predictions = raw
        else:
            predictions = []

        for item in predictions:
            if not isinstance(item, dict):
                continue
            normalized = normalize_label(str(item.get("label", "")))
            sentiment_scores[normalized] = float(item.get("score", 0.0))
        sentiment_label = max(sentiment_scores.items(), key=lambda pair: pair[1])[0]
        sentiment_conf = float(sentiment_scores[sentiment_label])
    else:
        sentiment_label = "no_overview"

    return {
        "tmdbId": movie.get("tmdbId"),
        "title": movie.get("title"),
        "year": movie.get("year"),
        "familyId": movie.get("familyId"),
        "sourceLanguage": source_language,
        "translatedToEnglish": translated,
        "textUsed": text_used,
        "sentimentLabel": sentiment_label,
        "sentimentScores": sentiment_scores,
        "sentimentConfidence": sentiment_conf,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Process only first N movies (testing)")
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Keep existing OUT_FILE rows and only score films whose tmdbId is missing",
    )
    args = parser.parse_args()

    if not ENRICHED_INPUT.exists():
        raise FileNotFoundError(f"Missing {ENRICHED_INPUT}. Run enrich_tmdb_metadata.py first.")

    ensure_hf_cache_env()
    GoogleTranslator, detect_fn, lang_exception_cls, pipeline = load_dependencies()
    sentiment_model = pipeline(
        "text-classification",
        model="cardiffnlp/twitter-roberta-base-sentiment-latest",
    )
    translator = GoogleTranslator(source="auto", target="en")

    movies = json.loads(ENRICHED_INPUT.read_text(encoding="utf-8"))
    if args.limit > 0:
        movies = movies[: args.limit]

    by_id: dict[int, dict[str, Any]] = {}
    if args.resume and OUT_FILE.exists():
        for row in json.loads(OUT_FILE.read_text(encoding="utf-8")):
            tid = row.get("tmdbId")
            if tid is not None:
                try:
                    by_id[int(tid)] = row
                except (TypeError, ValueError):
                    pass
        print(f"Resume: loaded {len(by_id)} existing records from {OUT_FILE.name}")

    to_process = []
    for m in movies:
        tid = m.get("tmdbId")
        if tid is None:
            continue
        try:
            tid_i = int(tid)
        except (TypeError, ValueError):
            continue
        if args.resume and tid_i in by_id:
            continue
        to_process.append(m)

    if not to_process:
        if by_id:
            ordered = _sort_records(by_id.values(), movies)
            OUT_FILE.write_text(json.dumps(ordered, indent=2), encoding="utf-8")
            print(f"Nothing new to score; wrote {len(ordered)} records -> {OUT_FILE}")
        else:
            print("No movies to process.")
        return

    print(
        f"Scoring {len(to_process)} films with RoBERTa "
        f"(enriched total {len(movies)}; with resume, skipping {len(movies) - len(to_process)} already done)."
    )

    for idx, movie in enumerate(to_process, start=1):
        if idx % 25 == 0 or idx == len(to_process):
            print(f"  … {idx}/{len(to_process)}")
        tid_i = int(movie["tmdbId"])
        by_id[tid_i] = build_sentiment_entry(
            movie, detect_fn, lang_exception_cls, translator, sentiment_model
        )

    ordered = _sort_records(by_id.values(), movies)
    OUT_FILE.write_text(json.dumps(ordered, indent=2), encoding="utf-8")
    scored = sum(1 for r in ordered if r.get("sentimentLabel") != "no_overview")
    print(f"Wrote {len(ordered)} sentiment records ({scored} with TMDB overview scored) -> {OUT_FILE}")


def _sort_records(records: Iterable[dict[str, Any]], movies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    order: list[int] = []
    seen: set[int] = set()
    for m in movies:
        tid = m.get("tmdbId")
        if tid is None:
            continue
        try:
            tid_i = int(tid)
        except (TypeError, ValueError):
            continue
        if tid_i not in seen:
            seen.add(tid_i)
            order.append(tid_i)
    by_t = {int(r["tmdbId"]): r for r in records if r.get("tmdbId") is not None}
    out = [by_t[i] for i in order if i in by_t]
    for tid, r in sorted(by_t.items()):
        if tid not in seen:
            out.append(r)
    return out


if __name__ == "__main__":
    main()


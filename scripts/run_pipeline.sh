#!/usr/bin/env bash
set -euo pipefail

python3 scripts/build_remake_families.py
python3 scripts/enrich_tmdb_metadata.py
python3 scripts/generate_color_analytics.py

echo "Pipeline complete."

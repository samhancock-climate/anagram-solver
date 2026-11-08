#!/usr/bin/env bash
# Streams one day of Wikipedia pageviews into a small "<Title> <views>" file. Called by refresh-data.sh (two at a time).
#   fetch-views-day.sh <yyyymmdd> <output-file>
set -euo pipefail
stamp="$1"; out="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
url="https://dumps.wikimedia.org/other/pageview_complete/${stamp:0:4}/${stamp:0:4}-${stamp:4:2}/pageviews-$stamp-user.bz2"
tmp="$out.part"
if curl -sfL "$url" | bzcat | grep -a '^en\.wikipedia ' | node --max-old-space-size=6000 "$ROOT/tools/aggregate-views.mjs" > "$tmp"; then
  mv "$tmp" "$out"; echo "   $stamp done"
else
  rm -f "$tmp"; echo "   $stamp skipped (download failed)"
fi

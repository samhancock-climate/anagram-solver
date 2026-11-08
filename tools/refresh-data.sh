#!/usr/bin/env bash
# Rebuilds public/data (word list + phrase list) from public sources. See tools/README.md.
#   tools/refresh-data.sh [sample-days]      # default 3 days of Wikipedia pageviews from last month (more = smoother ranking)
# Downloads ~700 MB per sample day, 2 at a time, streamed (only a ~20 MB summary per day is kept, in ~/.cache).
# Needs: curl, bzcat, node, unzip.
set -euo pipefail

DAYS="${1:-3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${AW_WORK:-$(mktemp -d "${TMPDIR:-/tmp}/aw-refresh-XXXXXX")}"
mkdir -p "$WORK"
echo "Working in $WORK"

echo "== keeping a copy of the current data for the diff"
rm -rf "$WORK/prev" && cp -R "$ROOT/public/data" "$WORK/prev"

echo "== word lists (SCOWL, British -ise spelling)"
for size in 35 50 60 70; do
  curl -sfL --max-time 180 "http://app.aspell.net/create?max_size=$size&spelling=GBs&max_variant=0&diacritic=strip&download=wordlist&encoding=utf-8&format=inline" -o "$WORK/scowl-$size.txt"
  grep -q '^---$' "$WORK/scowl-$size.txt" || { echo "SCOWL size $size download looks wrong"; exit 1; }
done

echo "== places (GeoNames)"
curl -sfL --max-time 180 https://download.geonames.org/export/dump/cities15000.zip -o "$WORK/cities15000.zip"
unzip -oq "$WORK/cities15000.zip" cities15000.txt -d "$WORK"

echo "== Wiktionary titles"
curl -sfL --max-time 600 https://dumps.wikimedia.org/enwiktionary/latest/enwiktionary-latest-all-titles-in-ns0.gz -o "$WORK/enwikt-titles.gz"

echo "== Wikipedia pageviews: $DAYS sample days from last month (2 downloads at a time)"
# Each finished day is kept in a cache folder, so re-runs and retries skip days already done.
CACHE_DIR="${AW_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/a-ragman-solver/views}"
mkdir -p "$CACHE_DIR"
read -r MONTH DAYLIST < <(node -e '
  const days = Number(process.argv[1]);
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const m = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0");
  const step = days > 1 ? Math.floor(24 / (days - 1)) : 0;
  console.log(m, Array.from({ length: days }, (_, i) => m + String(3 + i * step).padStart(2, "0")).join(","));
' "$DAYS")
rm -f "$WORK"/views-*.txt
TODO=()
IFS=',' read -ra STAMPS <<< "$DAYLIST"
for stamp in "${STAMPS[@]}"; do
  if [ -s "$CACHE_DIR/views-$stamp.txt" ]; then echo "   $stamp cached"; else TODO+=("$stamp"); fi
done
if [ ${#TODO[@]} -gt 0 ]; then
  # Wikimedia asks for no more than 2 connections; each one is limited to ~4 MB/s, so 2 in parallel halves the wait.
  printf '%s\n' "${TODO[@]}" | xargs -P 2 -I{} "$ROOT/tools/fetch-views-day.sh" {} "$CACHE_DIR/views-{}.txt"
fi
for stamp in "${STAMPS[@]}"; do
  [ -s "$CACHE_DIR/views-$stamp.txt" ] && cp "$CACHE_DIR/views-$stamp.txt" "$WORK/views-$stamp.txt"
done
ls "$WORK"/views-*.txt >/dev/null 2>&1 || { echo "no pageview days downloaded"; exit 1; }

echo "== building"
node --max-old-space-size=6000 "$ROOT/tools/build-data.mjs" "$WORK" "$ROOT/public/data"

echo "== checking"
node "$ROOT/tools/check-data.mjs"

echo "== what changed"
node "$ROOT/tools/diff-data.mjs" "$WORK/prev" "$ROOT/public/data"

echo "== bumping the service worker cache version"
node "$ROOT/tools/bump-cache.mjs"

echo
echo "Done. Review the diff above, run 'npm test && npm run test:e2e', then commit."
echo "Scratch files are in $WORK (safe to delete)."

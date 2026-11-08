# Rebuilding the cheat data

`data/words.txt` and `data/phrases.txt` are generated; the app only reads them. To refresh:

Download into a scratch folder (e.g. `/tmp/aw-data`), not inside the app:

- SCOWL British wordlists at sizes 35/50/60/70 -> `scowl-35.txt` ... `scowl-70.txt`
  `http://app.aspell.net/create?max_size=35&spelling=GBs&max_variant=0&diacritic=strip&download=wordlist&encoding=utf-8&format=inline`
- GeoNames: `https://download.geonames.org/export/dump/cities15000.zip` (unzip -> `cities15000.txt`)
- Wiktionary titles: `https://dumps.wikimedia.org/enwiktionary/latest/enwiktionary-latest-all-titles-in-ns0.gz` -> `enwikt-titles.gz`
- Several days of Wikipedia pageviews (~700 MB each, streamed, not kept): for each day
  `curl -L https://dumps.wikimedia.org/other/pageview_complete/<year>/<year-month>/pageviews-<yyyymmdd>-user.bz2 | bzcat | grep -a '^en\.wikipedia ' | node tools/aggregate-views.mjs > views-<yyyymmdd>.txt`

Then: `node --max-old-space-size=6000 tools/build-data.mjs <scratch-dir> public/data`

After changing data or code, bump `CACHE` in `public/sw.js` so installed copies update.

Licences/credits are shown in the app (Cheat panel -> Data sources): SCOWL (Kevin Atkinson), Wikipedia/Wiktionary (CC BY-SA 4.0), GeoNames (CC BY 4.0).

## One command

`tools/refresh-data.sh [sample-days]` does all of the above (default 3 sample days from last month, 2 downloads at a time, about 4-5 minutes; `tools/refresh-data.sh 5` averages more days. Finished days are cached in `~/.cache/a-ragman-solver/views`, so re-runs skip them), then runs
`tools/check-data.mjs`, prints a diff against the previous data (`tools/diff-data.mjs`) and bumps the service worker cache version.
Add answers that must always be found to `tools/extra-phrases.txt`; they survive every refresh.

---
name: refresh-phrase-data
description: Refresh the Cheat feature's word and phrase data (public/data) from SCOWL, Wikipedia pageviews, Wiktionary and GeoNames, or add hand-curated answers. Use when the user asks to update, refresh or rebuild the phrases/word list, add a missing answer to the cheat data, or check how old the data is.
---

# Refresh the phrase and word data

The Cheat button searches two generated files, `public/data/words.txt` and `public/data/phrases.txt`
(plus `meta.json` saying when they were built). They are rebuilt by `tools/refresh-data.sh`. Read
`tools/README.md` first if you need background on the sources and file formats.

## Quick case: add a missing answer (no download)

If the user just wants specific answers to be findable (e.g. "hot dog stand"):

1. Append the phrase(s) to `tools/extra-phrases.txt`, one per line (spaces or hyphens mark word breaks).
2. Rebuild from the scratch inputs if they still exist (`/tmp/aw-refresh` by default): 
   `node --max-old-space-size=6000 tools/build-data.mjs /tmp/aw-refresh public/data`.
   If they don't exist, tell the user a full refresh is needed and ask before downloading (step 3 below).
3. Continue at "Verify and finish" below.

## Full refresh (downloads ~700 MB per sample day, 2 at a time)

1. **Ask first.** Tell the user it downloads roughly 700 MB x the number of sample days (default 3, so ~2 GB,
   streamed, only a ~20 MB per-day summary is cached in `~/.cache/a-ragman-solver`) and takes about 4-5 minutes on a normal connection
   (days already in the cache are skipped; `tools/refresh-data.sh 5` averages more days but takes longer). Wait for a yes. Do not run it silently.
2. Check the working tree is clean enough to review (`git status`). Note `public/data/meta.json` for the old build date.
3. Run it in the background and wait for completion rather than polling:
   `tools/refresh-data.sh` (optionally `AW_WORK=/tmp/aw-refresh` to keep the scratch inputs).
   The script downloads the sources, builds, runs `tools/check-data.mjs`, prints a diff against the previous data
   and bumps the service worker cache version.
4. If the script fails, read the message. Typical causes: a download URL changed or a month's pageview file is not
   published yet (the script skips missing days but needs at least one; fetch at most 2 at a time, as Wikimedia asks), or `check-data.mjs` caught a regression
   (fewer entries than expected, a known phrase missing). Fix the cause; never loosen a check just to make it pass
   without telling the user why.

## Verify and finish

1. Read the diff output. Summarise for the user: old vs new counts, a few notable added and removed phrases, and the
   pageview days used (from `public/data/meta.json`). Flag anything odd (e.g. a sudden drop in count, junk at the top).
2. Run `npm test` and `npm run test:e2e` (the second needs Chrome; set `CHROME=` if it is not at the default path).
3. Make sure `tools/check-data.mjs` passes and `public/sw.js` has a bumped `CACHE` version
   (`tools/bump-cache.mjs` does this; the refresh script already ran it once, so do not bump twice).
4. Show `git status`/`git diff --stat`, then **ask before committing or pushing**. Suggested commit message:
   `Refresh cheat data (<built date>)`. Pushing to the main branch deploys the site (Cloudflare), so confirm first.

## Rules

- Data licences matter: Wikipedia/Wiktionary titles are CC BY-SA 4.0, GeoNames CC BY 4.0, SCOWL has a notice to keep.
  Do not add sources without also updating `public/privacy.html`, `NOTICE.md` and `public/data/LICENSE.md`.
- Never put API keys, tokens or personal data into the data files or scripts.
- Keep the app dependency-free; the tools use only Node built-ins, curl, bzcat and unzip.
- `public/data/*.txt` are generated: change `tools/` and rebuild instead of hand-editing them.

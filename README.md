# A RAGMAN Solver

An offline anagram helper for cryptic crosswords, built as a static PWA: no backend, no dependencies, no build step.

- Letter wheel with answer boxes that always stay on one line; locks, shuffle, place/return.
- Word lengths like `3,5` or `3-3,5` (hyphens are shown).
- History of every anagram you've tried, saved on your device.
- **Cheat**: offline search for phrases/names, single words and word combinations that fit your letters, word lengths and locked letters.
- Works fully offline once loaded (service worker); install it from Safari with Share -> Add to Home Screen.

## Layout

| Path | What |
|---|---|
| `public/` | The deployable site (this is what Cloudflare Pages serves) |
| `public/core.js`, `search.js` | Pure logic (no DOM): board rules, storage validation, search |
| `public/app.js`, `worker.js`, `sw.js` | UI, background search worker, service worker |
| `public/_headers` | Security headers incl. Content-Security-Policy (Cloudflare Pages format) |
| `public/data/` | Generated word + phrase lists |
| `tools/` | Data pipeline (`refresh-data.sh`), see `tools/README.md` |
| `tests/` | Unit tests and a headless-Chrome end-to-end test |
| `.claude/skills/refresh-phrase-data/` | Claude Code skill for refreshing the data |

## Develop

```
npm run serve        # http://localhost:8765 (add your Mac's LAN address to try it on a phone)
npm test             # unit tests (no dependencies)
npm run test:e2e     # headless Chrome; set CHROME=/path/to/chrome if not at the macOS default
```

After changing any file in `public/`, bump `CACHE` in `public/sw.js` (`node tools/bump-cache.mjs`) so installed copies update.
Service workers need HTTPS or `localhost`, so offline mode can't be tested over a plain `http://192.168...` address.

## Deploy (Cloudflare Pages)

1. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git -> pick this repository.
2. Framework preset: **None**. Build command: *(leave empty)*. Build output directory: **`public`**. Production branch: `main`.
3. Optional analytics: the Pages project -> Settings -> Web analytics -> Enable (cookieless; the CSP already allows its script).
4. Optional: add a custom domain under the project's Custom domains tab.

Every push to `main` deploys. Headers in `public/_headers` are applied automatically.

## Data and licences

Code: MIT (`LICENSE`). Generated data in `public/data/`: CC BY-SA 4.0, with attributions in `NOTICE.md`
and on the in-app Privacy & credits page.

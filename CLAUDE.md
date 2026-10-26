# DreamCycle

Sleep Cycle–style sleep tracker built as an installable web app (PWA) for iPhone. Vanilla JavaScript ES modules, no build step, no framework. See README.md for features and install steps.

## Commands

- `npm test`: unit tests for `js/analysis.js` (Node's built-in test runner)
- `npm start`: serve locally at http://localhost:8080
- `node scripts/smoke.mjs`: end-to-end test in headless Chrome (needs `npm install`; writes `screenshots/`)
- `npm run icons`: regenerate PNG icons

## Conventions

- Keep it dependency-free at runtime: everything in `js/`, `css/` and `index.html` is served as-is (GitHub Pages).
- `js/analysis.js` must stay pure (no DOM) so it can be tested in Node.
- After changing any served file, bump `CACHE` in `sw.js` so installed phones pick up the update.
- iOS constraints matter: audio and permission requests must start from a user tap, and the app only works while open on screen (no background execution).
- Data never leaves the phone. Nights live in IndexedDB (`dreamcycle` DB, `nights` store) in the compact format from `js/codec.js` (1 byte per reading, run-length-encoded stages, ~2 KB/night). `js/storage.js` loads them all into memory at startup, so views read synchronously. Settings and the night being tracked stay in `localStorage` (`dc.*` keys).
- Keep export/import backwards-compatible: `fromExport` must keep accepting v1 files (plain arrays) as well as v2 (base64).

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
- Data lives in `localStorage` on the phone (`dc.*` keys); keep export/import backwards-compatible.

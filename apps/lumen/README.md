# Lumen

A sleek, local-first ads dashboard for one person. Pulls campaign numbers into a single view, compares each window with the one before it, and lets you ask Claude questions about the numbers. Read-only: Lumen never changes anything in an ad account.

## Run
    npm install
    npm start        # opens the app with generated demo data
    npm test         # database, Meta connector and AI tests (no network)
    npm run dist:mac / dist:win

Set `LUMEN_USER_DATA=/some/folder` to run against a clean data folder.

## Connect Meta
Sources → Add Meta Ads. You need the ad account ID (number after `act_`) and a token with `ads_read`. Lumen tests the token, then pulls 90 days of daily campaign insights. "Result action types" is optional; blank counts lead and purchase style actions, taking the largest single type per row so nothing is double counted.

## Where things live
- `src/main.js` window, IPC, encrypted secrets (safeStorage), sync
- `src/db.js` SQLite via `node:sqlite` (no native modules)
- `src/connectors/` demo, meta; more are listed as planned
- `src/ai.js` Ask Lumen (Anthropic Messages API, your key)
- `src/renderer/` UI (no framework, SVG charts)

Data and keys stay on this computer, in the app's user-data folder.

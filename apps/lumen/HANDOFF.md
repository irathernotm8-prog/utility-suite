# Lumen — handoff

**What it is:** Electron (Mac + Windows) personal ads dashboard, part of the Utility Package. v0.1.0.

## State at first commit
- Built and unit-tested in a Linux VM on Node 22 (6 tests, `npm test`). The Electron window has NOT been launched yet.
- Meta connector is written against the Graph API insights docs but has never seen a live token.
- Ask Lumen is untested against the real Anthropic API.
- `node:sqlite` is used for storage; confirm Electron 44's bundled Node has it on first launch. If not, swap `src/db.js` for better-sqlite3 (same API surface used).

## First-launch checklist
1. `cd apps/lumen && npm install && npm start` — demo workspace should show KPIs, chart, campaign table.
2. Toggle theme in Settings; check light and dark, and the Windows title bar overlay colour (fixed dark, not theme-aware yet).
3. Sources → connect Meta with a real token; compare spend with Ads Manager for the same dates.
4. Settings → add Anthropic key; open Ask and try a question.

## Design decisions
- Renderer has no network (CSP `connect-src 'none'`); all calls happen in main.
- Secrets encrypted with safeStorage; renderer only sees "saved / not saved".
- Facts table keyed (workspace, source, campaign, date), so re-syncing is idempotent.
- Deltas compare the window with the equal-length window just before it.

## Roadmap
GA4, Google Ads, YouTube, Salesforce reports and Marketing Cloud; AI-assisted campaign drafts created PAUSED with explicit approval; GPT image generation; theme-aware Windows title bar.

## Shipping
Bump `version` in package.json, then `./utility publish` per PORTING docs.

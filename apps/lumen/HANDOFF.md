# Lumen — handoff

**What it is:** Electron (Mac + Windows) personal ads and analytics dashboard, part of the Utility Package. v0.2.0.

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


## 0.2.0 (this pass)
- Meta pinned to Graph API v26.0 (`API_VERSION` in `src/connectors/meta.js`; bump when Meta ships a new one). Fixes the "deprecated version" warning.
- New connectors, all unit-tested with mocked HTTP only and NOT yet run against live accounts: Google Ads (REST/GAQL, default v24), GA4 (Data API v1beta), YouTube (Data + Analytics APIs), Salesforce reports (client-credentials flow, picks the newest API version itself).
- Google sign-in (`src/google-auth.js`): PKCE + loopback listener on 127.0.0.1 with a client the user creates once; refresh token stored encrypted. One sign-in covers GA4, Google Ads and YouTube.
- AI providers (`src/ai.js`): Anthropic key, signed-in Claude Code CLI, signed-in Codex CLI. CLIs run through a login shell with read-only flags and the prompt on stdin. Subscription logins are never handled by Lumen itself.
- Storage: `series` (daily metric by dimension) and `snapshots` (latest report tables) beside `facts`. Overview totals only count ad sources (`AD_SOURCES` in `src/db.js`), so GA4/YouTube/Salesforce never inflate spend or conversions.
- UI: Analytics view (GA4, YouTube, Salesforce, plus GA4-vs-ad-platform campaign check), Guide (tutorials in `src/renderer/guide.js`), Edit button on sources, Sync all, AI provider settings.

## Unverified in 0.2.0
- Every live API call (Google Ads version number, GA4 metric names, YouTube Analytics metrics, Salesforce report parsing for matrix reports).
- `claude -p` / `codex exec` flags: written from memory of the CLIs; if a CLI rejects a flag, adjust `askCli` in `src/ai.js`.
- Google OAuth consent screen must be set to Production or the sign-in dies after 7 days.

## Next
Post and ad management (approval queue, paused drafts), social calendar, SFMC.

# Lumen — handoff

**What it is:** Electron (Mac + Windows) personal ads and analytics dashboard, part of the Utility Package. v0.3.0.

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


## 0.3.0 (posting + calendar)
- Calendar tab: month view, composer, drafts / scheduled / posted / needs-attention lists, AI caption drafts (3 options, never auto-posted).
- `src/publisher.js`: Facebook Page posts (text, link, photo), Instagram single-photo posts (container → status poll → publish), Page-token discovery, native scheduling, cancel, verify.
- `src/posts.js`: lifecycle + minute scheduler. Facebook posts 10 min to 30 days ahead are handed to Meta (published even if Lumen is closed). Everything else is held by Lumen; more than an hour overdue is marked Missed rather than posting late.
- New source: "Facebook & Instagram posting" (`meta-pages`): Page ID + a token with pages_manage_posts, pages_read_engagement, pages_show_list, instagram_basic, instagram_content_publish.
- Google and Salesforce sources are tucked under "More sources" in Sources (advanced setup). Code unchanged.
- Local photos are converted to JPEG and stored in the app's media folder; for Instagram a hidden unpublished copy is uploaded to the Page to get a public URL (best-effort; a public image URL field is the fallback).

## Unverified in 0.3.0
- Every live posting call. Test with a throwaway post (Facebook first, then Instagram) before relying on it.
- Instagram image URL via the Page-hosted copy (`images[0].source`).
- Whether Meta's photo-node `is_published` check works for scheduled photo posts; if not the post shows "due, check Facebook" after 30 minutes.
- Instagram scheduling is Lumen-side only (the API has no scheduling parameter). Lumen must be open at post time.

## Next
Ad management (approval queue, paused drafts, budget/pause), videos/Reels/Stories, carousels, post insights, SFMC.

## 0.4.0 (date range, rename fix, ads manager)
- Date range: shared picker (presets + custom) on Overview, Analytics and Ads; `localToday()` is the local calendar day; `summary()` returns `earliestData`.
- Workspace rename: Electron has no `window.prompt()`, so rename is now inline in Settings.
- Ads manager (`src/ads.js` API calls, `src/adsmgr.js` rules): campaign/ad set/ad tree with insights, on/off, rename, daily budget, end date, duplicate (paused), archive, Activity log with Undo, New campaign wizard (Traffic, Leads with Pixel, Awareness) with AI draft.
- Safety: nothing is created active; turning on needs confirmation; daily budget ceiling (Settings, default 500); typed confirm for large budget jumps; every change logged with before/after.
- Needs the Meta token to have `ads_management`, and the system user to have "Manage campaigns" on the ad account.
- Not supported: lifetime budgets, bid caps, saved audiences, lead forms, video/carousel creatives, other objectives.

## Unverified in 0.4.0
- All live Meta write calls (campaign/ad set/creative/ad creation payloads, `/copies`, adimages, status/budget updates) are tested only against mocks. Try a throwaway paused campaign first.
- Zero-decimal currency list (JPY, KRW, VND, CLP, PYG, ISK, UGX) is from memory.
- UI verified in a mocked browser only, not in Electron on Windows.

## 0.4.1 (preview and edit existing ads)
- Click an ad (or ⋯ → Preview & edit): Facebook/Instagram mockup that updates as you type; edit text, headline, description, link, button, photo. Meta creatives are immutable, so a save creates a new creative and repoints the ad (back into review). Undo in Activity repoints to the old creative.
- "Meta's exact preview" uses `/{ad}/previews` and opens the returned URL in the browser (the app CSP blocks iframes).
- Read-only (with explanation): boosted-post ads, flexible/dynamic creative, carousels, video.
- Unverified live: creative edit payload (object_story_spec round-trip), `/previews` response shape, image CDN fetch for the mockup.

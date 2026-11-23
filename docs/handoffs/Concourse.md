# Concourse: handoff for the Concourse chat

Concourse is the Utility Package's Microsoft Teams replacement: a stand-alone app with its own departures-board UI on top of Microsoft Graph (chats, channels, meetings and joining, a timetable calendar, self-assigned tasks with To Do sync). It lives in `apps/concourse` inside `~/Downloads/Utility Package`. `apps/concourse/README.md` has the feature list, the Microsoft setup and the code map.

Relay still embeds Teams web as a tab; Concourse is separate and doesn't touch Relay.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/concourse
npm install
npm start          # npm run demo for the pretend company
npm test           # 15 Node checks, no Electron, no network
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note concourse "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/concourse`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44.7 under Xvfb) against the demo company: every screen screenshotted in amber and cyan (`test/e2e/shoot.js`), and the whole API driven from the window (tasks local and To Do, create meeting, RSVP, new group chat, Meet now, join, mark unread). `npm test` covers the board model, PKCE sign-in against a fake Microsoft, the Graph client (paging, 429, 403) and a full account sync.
- **Not yet run against a real Microsoft 365 tenant, a Mac or Windows.** Check these first:
  1. **App registration.** Needs a client ID (Settings › Accounts, or `src/config.json` to bake it in). Redirect URI `http://localhost` under *Mobile and desktop*, *Allow public client flows* on. Loopback ports are random; Entra ignores the port for `http://localhost`.
  2. **Tenant consent.** If the work tenant blocks user consent, sign-in says so in plain English; Settings has an admin consent link. Channel posts (`ChannelMessage.Read.All`) almost always need admin approval and are asked for separately (Teams › Turn on channel reading).
  3. **Joining.** Default is the browser (most reliable). *Concourse window* loads Teams web in its own partition with a Chrome user agent, mic/camera allowed for Microsoft/Zoom/Google hosts, and screen share through `setDisplayMediaRequestHandler` with the system picker. If Teams web refuses the window on a real tenant, that's the user agent or a missing permission.
  4. **Mac:** mic/camera prompts come from `NSMicrophoneUsageDescription`/`NSCameraUsageDescription`; the menu-bar countdown uses `tray.setTitle`.
  5. **Windows:** frameless with `titleBarOverlay`; views leave 140 px on the right for the window buttons. Notifications have no Join button there (clicking a "Boarding now" one joins).

## Rules specific to Concourse

- **The window never touches Node or tokens.** Everything goes through `window.concourse.call(name, arg)` → the `api` table in `src/main.js`. Tokens stay in main; refresh tokens are encrypted with `safeStorage` in `accounts.bin`.
- **One model.** Status words, join links, departures, arrivals and the manifest come from `src/core/model.js` (also exposed to the window through preload). Keep it pure and tested.
- **Demo has the same shapes as Graph.** `src/demo.js` answers every call in `src/core/graph.js`. When you add a Graph call, add the demo one too, so `npm run demo`, the tests and the screenshots keep working.
- **Be gentle with Graph.** Polling (see `EVERY` in `src/sync.js`) only emits a change when the data's signature changes. Don't add per-chat polling beyond the open chat.
- No dependencies, no native modules. `src/suitelink.js` is a copy of `tools/suitelink.js` (owned by the Utility Package chat; the test checks they match).

## Utility Suite link

Offers `status`, `next`, `today`, `unread`, `join(eventId?)` (joins the given meeting, or the next one) and `open(view)`. Events: `unread` (count, when chats change) and `boarding` (a meeting's reminder fired). Uses Docket's `start({title})` for "Record with Docket" and Vantage's `open(url)` for joining in Vantage. If you rename or remove one, tell the Utility Package chat so Atoll can follow.

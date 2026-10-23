# Touchline: handoff for the Touchline chat

Touchline is the Utility Package's football app: scores, tables, match stats, squads, player careers and the Hall of Fame, for every league and every season. It replaces the Football Hub site (github.com/irathernotm8-prog/Football). This file goes in `docs/handoffs/Touchline.md` in the Utility Package. README.md has the feature list and code map.

## Bringing it into the Utility Package (one time, on the Mac)

1. Unzip `touchline-source.zip` somewhere (it has no `node_modules`).
2. In Terminal:
   ```bash
   cd ~/Downloads/Utility\ Package
   ./utility add /path/to/touchline-source
   cp apps/touchline/HANDOFF.md docs/handoffs/Touchline.md
   ./utility note touchline "First release: live scores, tables, match stats, squads, player careers for every season, Hall of Fame, XI Builder and match alerts"
   ./utility publish
   ```
3. In `suite.json`, Touchline can be `"macArch": "arm64"`. It has no native modules and no runtime npm dependencies.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/touchline
npm install
npm start
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note touchline "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/touchline`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb) against live data. `npm test` runs 12 checks on saved FotMob responses. `test/e2e/drive.js` opens every page and tab in the real window (Matchday, competitions, a table in every view, matches, stats with the full leader list, roll of honour, a 2022 World Cup bracket and group tables, a match on every tab, a team on every tab, a player on every tab, Henry's career with the Wikidata record, legends, Following, XI Builder, search, Settings, and the Day theme): 36 screenshots, no console errors. A run with FotMob switched off (`TOUCHLINE_FOTMOB_OFF=1`) showed ESPN scores and tables with the backup notice.
- A packaged Linux build started and loaded data, so the `build` config is right.
- **Not yet run on a Mac or Windows.** Check these first:
  1. **Notifications** on macOS: the first alert asks permission. Ad-hoc signed builds may need it allowed in System Settings › Notifications.
  2. **Title bar**: traffic lights at 16,18 with 86px left padding; on Windows the overlay buttons need the 150px right padding and follow the theme (`chrome()` in `main.js`).
  3. **Live widget**: on macOS it floats over full-screen apps when pinned (`setVisibleOnAllWorkspaces`). Check it can be dragged by its header and resized from the edges on both systems.
4. **Times** use the computer's time zone (shown at the bottom of Settings).

## Rules specific to Touchline

- **Never store seasons or squads in the source.** Competitions are FotMob ids in `store.js → DEFAULT_LEAGUES`; everything else is fetched. That's what keeps season rollover free.
- **All FotMob shapes go through `src/data/normalize.js`**, which is pure and tested against `test/fixtures/`. If FotMob changes a field, fix it there and add or refresh a fixture (save the raw response gzipped).
- **Bump `SCHEMA` in `src/data/index.js`** whenever a normalizer's output shape changes. The cache folder is `cache/data-v<SCHEMA>`, so saved copies from older versions are dropped instead of breaking a page.
- **Cache lifetimes live in `src/data/index.js`**: live matches 20–25 s, today 2 min, finished matches and past seasons weeks. Network failures serve the saved copy marked stale.
- **The window never touches the network or disk.** Everything goes through `window.tl` (preload) → IPC → `src/data`. Images use `tl-img://`, which only fetches from FotMob, ESPN and Wikimedia hosts and keeps them on disk.
- **Be polite to the free sources.** `http.js` paces FotMob (120 ms) and Wikidata (1.1 s), backs off on 429, and Wikidata gets a descriptive user-agent. Don't add bulk prefetching.
- **If FotMob starts refusing requests** (401/403 everywhere), the app falls back to ESPN for Matchday and tables. The likely cause is a new required header; look at `http.js → getBuffer` headers.
- **Legends are the only curated data.** To add one: append to `src/data/legends.json` (id, name, group GK/DEF/MID/FWD, nationality, career, national) and drop a 256px WebP in `src/renderer/legends/`. `clubAliases` maps club names so "Club legends" on team pages finds them.
- **Trophy art** lives in `src/renderer/trophies/<key>.webp` and is mapped by FotMob competition id in `ui.js → TROPHY`. Map by id, not name (FotMob's "Bundesliga" id 38 is Austria's). Competitions without art get a gold cup icon.
- **The live widget** is `src/widget.js` (window) and `src/renderer/widget.js` (page). It uses the same `data:day` call and cache as Matchday, so it costs no extra requests while the main window is open. Its state (open, pinned, filter, position) is `widget` in settings.json.
- No native modules and no runtime npm dependencies, so nothing special for Windows cross-builds.

## Testing

- `npm test`: quick Node checks, no network.
- `TOUCHLINE_USER_DATA=/tmp/tl-test npm start` gives a clean settings and cache folder.
- `TOUCHLINE_FOTMOB_OFF=1` makes every FotMob call fail, to check the ESPN backup and offline notices.
- Screenshots of every page (Linux): `TOUCHLINE_E2E=/tmp/shots TOUCHLINE_USER_DATA=/tmp/tl-e2e xvfb-run -a -s "-screen 0 1440x960x24" npx electron . --no-sandbox`. `TOUCHLINE_E2E_ONLY=<regex>` limits it to some steps. On a Mac, the same command without `xvfb-run` works.

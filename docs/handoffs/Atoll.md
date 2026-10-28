# Atoll: handoff for the Atoll chat

Atoll is the Utility Package's desktop island: a Dynamic Island for Mac and Windows with live activities (timers and focus, music, one live football match from Touchline), a shelf for files and recent copies, weather and a system glance. It lives in `apps/atoll` inside `~/Downloads/Utility Package`. `apps/atoll/README.md` has the feature list, where everything comes from on each system, and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/atoll
npm install
npm start          # ATOLL_DEMO=1 npm start uses a pretend music player
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note atoll "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/atoll`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb). `npm test` runs 14 Node checks: duration parsing, timers (pause, resume, extend, restore after a restart, a real one ringing on time), focus cycles and the stopwatch, choosing a player, Windows app names and the C# 5 rule, shaping Touchline matches from saved FotMob responses, goal / kick-off / full-time detection, the shelf and clipboard history, weather shaping, settings merging, and that every icon the pages use exists.
- `test/e2e/run.sh` drives the real windows (19 checks, 25 screenshots in `test/e2e/out`): the floating island compact, with a second activity in the bubble, every panel view, focus, stopwatch, typing a timer, the match picker and team search, play/pause reaching the player, a goal moment, a song change, a finished timer ringing and Stop, the settings window, and a pretend notched MacBook (`ATOLL_FAKE_NOTCH=1`).
- A packaged Linux build started, so the `build` config is right.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **Notch placement.** The island window sits at y = 0 over the menu bar (`enableLargerThanScreen`, level `screen-saver`, `type: 'panel'`). If macOS pushes it below the menu bar, that's the line to look at in `src/island.js → bounds()`. Notch width is guessed (186 pt, 200 pt on 16") and adjustable in Settings › Island.
  2. **Hover on an inactive panel.** The island opens on hover without taking focus; clicking into the timer field focuses it. Check that Escape and clicking elsewhere close it.
  3. **Music / Spotify permission.** The first poll asks to let Atoll control Music (and Spotify). If it's denied, the media view shows the player's error; re-allow in System Settings › Privacy & Security › Automation.
  4. **Music artwork** comes from AppleScript writing `raw data of artwork 1 of current track` to a file. Streaming tracks without local artwork show the placeholder.
  5. **Windows media.** `src/modules/media/win.js` uses WinRT from Windows PowerShell 5.1 (`AtollAwait` wraps `AsTask`). If nothing shows, run the `PRELUDE` then the `POLL` script in a PowerShell window to see the error. Thumbnails use `AsStreamForRead`.
  6. **Windows volume** uses the same Core Audio C# as Scene (`AtollAudio`).
  7. **Dragging files out** of the shelf uses `webContents.startDrag`; check it drops into Finder / Explorer and into apps.
  8. **Global shortcut** defaults to ⌘⌥Space / Ctrl+Alt+Space; Settings › General says if another app has it.

## Rules specific to Atoll

- **The pages never touch the disk, network or system.** Everything goes through `window.atoll.call(name, …)` → the `API` table in `main.js` → `src/modules/*`. Updates come back as `atoll:patch` with only the parts that changed.
- **Mac: the window is exactly the island's size.** The page works out the size it needs (`target()` / `windowFor()` in `renderer/island.js`) and asks main to resize: grow the window first, then animate; animate, then shrink.
- **Windows (and Linux): the window never resizes.** Resizing a transparent window there made the island jitter, so it's one fixed 820×380 sheet (`FIXED_SIZE` in `src/island.js`) that lets clicks through with `setIgnoreMouseEvents(true, { forward: true })`. The page hit-tests the pointer against the island and bubble and calls `hit` to take clicks only there. `ATOLL_FIXED=1/0` forces either mode for testing.
- **Views only redraw when something visible changed** (`viewKey()` / `headKey()`); song position, countdowns and the clock move in place in `tick()`.
- **Notch style works on every system.** On a notched Mac it hugs the notch; elsewhere it's a black tab flush with the top edge (default 140 px wide, Settings › Island › Tab width), and the title sits in the middle of the tab since no camera is in the way (`hw()` in the page is "a real notch").
- **Touchline data is vendored, not imported.** `src/touchline/vendor` is a copy of `apps/touchline/src/data/{http,cache,normalize,espn}.js`. After Touchline changes those, run `npm run sync-touchline` and bump `SCHEMA` in `src/touchline/index.js` if Touchline bumped its own.
- **Be polite to FotMob.** The live match polls every 20 s only while it's live, a few minutes before kick-off, and 15–20 min otherwise; the shared cache and pacing in `vendor/http.js` do the rest.
- **Timers live in the main process** (`src/modules/timers.js`, pure apart from `setTimeout`) and are saved to `state.json`, so they survive the island reloading and Atoll restarting.
- **Clipboard history stays in memory.** Never write it to disk.
- **Electron 44's clipboard is asynchronous in the main process** (`clipboard.readText()` returns a Promise). Always `await` it; 0.1.0 didn't, which crashed with "text.trim is not a function" every second. Uncaught errors are now logged to `atoll.log` in the app-data folder instead of showing a dialog.
- **Linux is only for tests.** It uses the pretend player (`media/demo.js`) and a pretend clipboard; `ATOLL_DEMO=1` does the same on a Mac or PC.
- No native modules and no runtime npm dependencies, so nothing special for Windows cross-builds.

## Add-ons and the Utility Suite link (0.2.0)

- Add-ons (Docket, Scene, Beam, Vitals, Relay) are **off by default** (`settings.addons`), so Atoll behaves exactly as before until one is turned on in Settings › Add-ons. `src/addons.js` connects only to enabled ones.
- They talk through **`src/suitelink.js`**, a copy of `tools/suitelink.js` in the Utility Package (each of the five apps has the same copy). Keep every copy identical; change `tools/suitelink.js` first and copy it out.
- What each app offers on the link (all added in their own `src/main.js`, marked "Utility Suite link"):
  - **docket**: `status`, `start({title})`, `stop`, `pause`, `resume`, `mark`, `open`; events `status` (≤ 1/s and on every start/stop/pause) and `detected` (a call started/ended).
  - **scene**: `list`, `activate(id)`, `previous`, `open`; event `switched`.
  - **beam**: `peers`, `transfers`, `send(peerId, paths)`, `sendText(peerId, text)`, `open`; events `peers`, `transfers` (≤ 2/s).
  - **vitals**: `stats`, `history`, `open`; event `tick` (every sample, only while someone's connected).
  - **relay**: `unread`, `recent`, `open(accountId)`; events `unread`, `mail` (from Relay's window: when an inbox's unread count goes up, it reads the newest unread email with the briefing scraper).
- Atoll finds installed apps where Utility Hub puts them (`/Applications/<App>.app` or `~/Applications`, `%LOCALAPPDATA%\Programs\Utility Suite\<App>\<App>.exe`) and opens them with `--hidden` (Beam, Vitals and Scene start to the tray; Docket and Relay show their window).
- Tested here: `npm test` runs the link (calls, errors, events, reconnect, stale socket) and the add-on hub against pretend apps; the e2e run drives every add-on view and moment against pretend apps on real sockets. The real Docket, Scene, Beam, Vitals and Relay were each started under Xvfb and answered on the link, and Docket started and stopped a recording from it. **Not yet run on a real Mac or Windows PC**: check the Windows named pipe (`\\.\pipe\utility-suite-<user>-<app>`) first.


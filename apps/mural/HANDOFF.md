# Mural: handoff for the Mural chat

Mural is the Utility Package's live-wallpaper app for Mac and Windows. It lives in `apps/mural`; `README.md` there has the
features, how it stays light, where windows go on each system, the format and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/mural
npm install
npm start
npm test
```
Ship: bump `version` in `package.json`, then `./utility note mural "what changed"` and `./utility publish`. Stay inside
`apps/mural`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb, WebGL through SwiftShader). `npm test`: 11 checks (sun maths
  against Houston's real sunrise/sunset, format defaults and traits, pause rules, quality and the governor, display
  lookup, zip round trip and unsafe paths, library import/save/export, settings, the MCP server answering, the helper
  scripts, built-in shaders). `test/e2e/render.js` renders all 21 built-ins in real wallpaper windows; `ui.js` drives the
  app (24 checks: thumbnails, apply, hover preview, Studio scene and shader, save-as-copy, compile errors, Performance,
  Settings, pause/freeze, covered, every plugin handler); `bridge.js` runs the MCP server against the app's bridge.
- A packaged Linux build ran, including copying built-ins out of `app.asar` (don't use `fs.cpSync` on built-ins: it
  fails inside asar; `library.js` has `copyDir`).
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **Mac window level.** Electron's `type: 'desktop'` puts the window at the desktop picture's level. It should sit
     above macOS's own wallpaper and below the icons. If you see the normal wallpaper instead, the helper's `behind` check
     (CGWindowList order) calls `moveTop()`; if that doesn't help, it's the level itself (`src/platform/mac.js`).
  2. **Mac clicks.** The JXA helper polls `NSEvent.pressedMouseButtons` at 25 Hz only while the wallpaper reacts to clicks.
     Check a click on the bare desktop ripples and a click in Finder windows/apps doesn't.
  3. **Windows WorkerW / 24H2.** `src/platform/win.js` → `Host()`. Classic layout: child of the WorkerW behind the icons.
     24H2+: child of Progman, z-ordered just below `SHELLDLL_DefView`. If the wallpaper covers the icons or is invisible,
     that's the place. The helper compiles with Add-Type on first run (a second or two); errors go to `mural.log`.
  4. **Windows painting.** `CalculateNativeWinOcclusion` is disabled so Chromium keeps painting a window that lives behind
     the icons. If the wallpaper freezes on its first frame, check that switch first.
  5. **Freezing.** Pausing attaches the DevTools protocol to the wallpaper page and sets it `frozen`. Check CPU drops to ~0
     in Activity Monitor / Task Manager when a full-screen window is up, and that it resumes instantly.
  6. **Free memory after a pause** (off by default) sets a still frame as the system wallpaper (System Events on Mac:
     needs Automation permission; SPI on Windows) and restores the original on quit or when turned off.
  7. **Plugin.** Settings › Claude & Codex. Then ask Claude for a wallpaper and check `preview` returns pictures.

## Rules specific to Mural

- **The runtime is shared.** `src/renderer/runtime/*` runs on the desktop, in the Studio, on Library cards and in
  offscreen previews. Change it once; it's ES modules (`runtime/package.json` says so).
- **Pages never touch the disk.** The app window calls `window.mural.call(name, …)` → `API` in `main.js`. Wallpaper
  windows only receive `wp:*` messages and report stats/errors.
- **Every wallpaper must be cheap when still.** A layer that isn't animated must be paintable by a `PAINT` function and
  cacheable (`paintKey` says when it changed). Particles and per-frame work belong in `drawLive`.
- **Sizes follow the screen, not pixels** (particles use min(W,H)/1000), so previews and thumbnails match the desktop.
- **Shader traits come from the code**: Mural only feeds the cursor if the source mentions `iMouse`/`iPointer`, clicks if
  it mentions `iClick`.
- **Built-ins are read-only**; saving one makes `user/<slug>` (Studio and the plugin both do this).
- **The Windows helper is C# 5** (Windows PowerShell's Add-Type): no `$""`, no `?.`, no `out var`, no lambdas; keep
  P/Invoke callbacks local and `GC.KeepAlive` them. `npm test` checks the obvious ones.
- `src/suitelink.js` is a copy of `tools/suitelink.js` — don't edit it here.

## Utility Suite link

Mural serves `mural`: `list`, `current`, `apply(id, displayKey?)`, `pause`, `resume`, `open(page?)`; event `changed`.
Nobody uses it yet. Natural next steps (other chats): Scene could switch the live wallpaper per scene, and Atoll could
offer pause/next from the island.

## Data

Your wallpapers: `~/Documents/Mural` (one folder each). App-data folder: `settings.json`, `state.json` (the original
wallpaper while Eco's still frame is in use), `thumbs/`, `still-*.png`, `bridge.json` (plugin's private connection),
`mcp/` (the installed MCP script), `ask/` (Ask Claude scratch), `mural-desktop.ps1` (Windows helper), `mural.log`.

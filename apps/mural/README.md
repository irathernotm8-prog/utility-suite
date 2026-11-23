# Mural

Live wallpapers for Mac and Windows: animated scenes, GPU shaders, videos, pictures and web pages; dynamic skies that
follow the real sun; wallpapers that react to the cursor and to clicks on the desktop; a Studio to build your own; and a
Claude/Codex plugin that can build, look at and tune them. Built so it doesn't cost you performance: every wallpaper
stops completely the moment its desktop can't be seen, and a CPU budget keeps the rest in check.

## What's in it

- **Library** — 21 built-in wallpapers (Fold in six colors, Aurora, Liquid Platinum/Gold, Nebula Drift, Gradient Flow,
  Synthwave, Daybreak Hills, Ocean Hours, Snowfall, Midnight Rain, Firefly Forest, Bokeh Lights, Sakura Breeze, Campfire
  Embers, Minimal Clock). Live preview on hover, favorites, one wallpaper everywhere or one per display. Drop in videos,
  pictures, web pages, `.frag` shaders, `.mural` packages, or Wallpaper Engine video/web folders.
- **Studio** — templates (time-of-day landscape, dynamic from four pictures, picture + effects, video, shader, blank);
  layers (sky, gradient, picture, video, landscape, waves, particles, glow, text & clock, shape) with depth that follows
  the cursor, motion, blend and time-of-day visibility; click effects; a shader editor with live compile errors and
  sliders; a time scrubber; undo; export; **Ask Claude**.
- **Performance** — live fps, work per frame, CPU and memory per display; frame cap, resolution, CPU budget, battery
  mode; pause rules; free memory after a long pause.
- **Settings** — displays, cursor/click reactions, location for the sun (city list or lat/lon; otherwise a guess from
  the time zone), rotation through favorites, open at login, Claude & Codex.

## How it stays light

1. Frames are capped (30 by default) and the renderer **sleeps** between them.
2. A still scene draws once and stops; cursor, clicks or the minute changing wake it. Still layers are flattened into
   one cached bitmap (redrawn about once a minute); layers that shift with the cursor are cached and only moved.
3. Shaders draw at half the screen's pixels (Fold at full, for its hairlines) and are scaled up. Nothing draws above 4K.
4. **Paused = frozen**: when a full-screen/maximized window hides the desktop, the screen locks, the computer sleeps or
   runs hot, or on battery (if chosen), the page stops drawing and is frozen through the DevTools protocol
   (`Page.setWebLifecycleState: frozen`) — no JavaScript, timers or frames at all.
5. A **governor** samples the wallpaper processes' CPU every 4 s; over budget it steps frame rate, then resolution, down;
   it steps back up after 30 s with room.
6. Optional: after N minutes paused, a still frame becomes the system wallpaper and the window closes (frees memory).

## Where it puts the wallpaper

- **Mac**: Electron `type: 'desktop'` windows (desktop level, every Space, click-through), above macOS's own picture and
  below the icons. A JXA helper (`osascript`, no permissions) reports clicks on the bare desktop and whether each screen
  is covered, and if macOS ever orders its picture above ours.
- **Windows**: a C# helper compiled by Windows PowerShell parents each window into Explorer's WorkerW (behind the icons);
  on Windows 11 24H2+ into Progman just below `SHELLDLL_DefView`. It also reports desktop clicks (only when the bare
  desktop is under the pointer) and covered monitors. Explorer repaints the normal wallpaper when Mural quits.
- **Linux** is only for tests (plain windows).

## The wallpaper format

A folder with `mural.json`; see `src/renderer/runtime/schema.js` for every layer kind and setting, and the plugin's
`mural_guide` tool for the full write-up. Types: `scene`, `shader` (Shadertoy-style `mainImage`; uniforms `iTime`,
`iResolution`, `iMouse`, `iPointer`, `iClick`, `iDaylight`, `iPhase`, `iParams`), `video`, `image` (both can carry a scene
overlay), `web` (any page; receives `{mural:'pointer'|'click'|'pause'|'resume'|'sky'}` messages).

## Claude / Codex plugin

Settings › Claude & Codex adds Mural to Claude Desktop, Claude Code and Codex in one click (same approach as Mixer).
Tools: `mural_guide`, `list_wallpapers`, `get_wallpaper`, `create_wallpaper`, `update_wallpaper` (with layer ops),
`preview` (renders offscreen and returns a picture — any hour, cursor position or click), `add_asset`, `apply`, `status`,
`set_performance`. The Studio's **Ask Claude** runs a headless Claude Code (or Codex) with only Mural's tools.

## Code map

```
src/main.js              protocol mural://, API table, tray, app window, offscreen previews, suite link, plugin bridge
src/host.js              one window per display, pause/freeze, input, metrics + governor, free-after
src/platform/{mac,win,demo}.js   placing windows on the desktop; clicks; covered screens
src/core/                store, library (import/export/save), policy (pause rules, quality, governor), zip
src/renderer/runtime/    the player shared by desktop, Studio and cards: player, scene, particles, shader, sun, schema
src/renderer/            app.html/css/js (Library, Performance, Settings), studio.js, wallpaper.html/js
src/builtin/<slug>/      the built-in wallpapers
src/connectors.js ai.js mcp-handlers.js, mcp/   the Claude/Codex plugin
test/run.js              unit checks;  test/e2e/{render,ui,bridge}.js  real windows under Xvfb
```

## Developing

```bash
npm install
npm start
npm test
# real windows (Linux/Xvfb; add the swiftshader flags for WebGL without a GPU):
MURAL_E2E=$PWD/test/e2e/ui.js MURAL_E2E_HOST=1 MURAL_E2E_SHOW=1 MURAL_USER_DATA=/tmp/m MURAL_LIBRARY=/tmp/ml \
  xvfb-run -a npx electron . --no-sandbox --ignore-gpu-blocklist --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

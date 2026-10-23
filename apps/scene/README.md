# Scene

Save and switch whole setups in one click. A scene is the apps that should be open, where every window sits on which display, the sites and files that open with them, what happens to everything else, and the volume, appearance, wallpaper and screen-awake state. Switch from the window, a global shortcut, the quick switcher, the menu bar / tray, or automatically when a monitor is plugged in, at a time of day, or when an app opens.

Part of the Utility Package. Electron 44, Mac and Windows, no native modules.

## What it does

- **Scenes page** — every scene as a card with a live preview of its layout, its shortcut and what it changes. Start from what's on screen now or a template (Work, Gaming, Match day, Deep work, Create, Movie night) that picks apps you actually have installed and lays them out on your displays.
- **Editor** — your displays drawn as they're arranged, with each window as a box: drag to move (it snaps to halves, thirds and edges, and across displays), drag an edge or corner to resize, double-click to fill the screen, or use the snap buttons (halves, thirds, two-thirds, quarters, fill, full screen, minimised). Tabs:
  - **Apps** — each app, its windows and their state, links or files to open with it (browsers get a new window), launch arguments, whether to open it if it isn't running, and which app ends up in front.
  - **Open** — links, files and folders that open with their usual app (`steam://`, `spotify:`, Zoom links all work).
  - **System** — leave / hide / quit everything else, volume, sound on/muted, light/dark, wallpaper, keep the screen awake.
  - **Actions** — run a Shortcut (Mac), a command, or wait, in order.
  - **Triggers** — display connected/disconnected, time of day on chosen days, an app opening; switch right away or ask first.
- **Switching** shows each step live (read windows, hide/quit others, open apps, wait for windows, place them, system, actions) and keeps the screen awake for scenes that ask. **Restore previous** puts things back as they were before the last switch and closes what that scene opened.
- **Desktop page** — what's on your screens right now. Click a window to snap it, drag it on the drawing to move the real one, tidy a display into a grid, or save it all as a scene.
- **Quick switcher** (default ⌃⌥Space / Ctrl+Alt+Space) — a small picker over anything: type, arrows, Enter or 1–9. When a shortcut or trigger fires while Scene is in the background, the same panel shows the switch's progress.
- **Automations** and **History** pages, Settings (theme, keep running, open at login, switcher shortcut, wait time, apps never to hide or quit, import/export scenes).

## Where things come from

| | Mac | Windows |
|---|---|---|
| Windows (title, frame, minimised, full screen) | System Events via JXA (`LIST_JXA` in `src/platform/mac.js`) — needs **Accessibility** | C# helper `SceneWin` compiled by Add-Type in a persistent PowerShell (`src/platform/win.js`); EnumWindows, DWM frame bounds, per-monitor DPI |
| Moving/resizing | System Events `position`/`size`, `AXMinimized`, `AXFullScreen` | `SetWindowPos` (border-compensated, twice for DPI changes), `ShowWindow` |
| Coordinates | already Electron DIPs | physical pixels, converted with `screen.screenToDipRect` / `dipToScreenRect` |
| Displays | Electron `screen` | Electron `screen` |
| Installed apps | `/Applications`, `/System/Applications`, `~/Applications` + `plutil` | `Get-StartApps` (Store apps launch through `shell:AppsFolder`) |
| Running apps | `ps` (no permission needed) | the window list |
| Launch / open with | `open -b <id>`; Chromium browsers `open -n … --args --new-window` | the exe directly (Chromium `--new-window`, Firefox `-new-window`), or `explorer shell:AppsFolder\<AUMID>` |
| Quit / hide others | `tell application id … to quit` (ignoring responses) / process `visible = false` | `WM_CLOSE` / minimise |
| Volume | `set volume` | Core Audio (`SceneAudio` in the same C# helper) |
| Appearance | System Events `dark mode` | `HKCU\…\Themes\Personalize` (`AppsUseLightTheme`, `SystemUsesLightTheme`) |
| Wallpaper | System Events, every desktop | `SystemParametersInfo(SPI_SETDESKWALLPAPER)` |
| Actions | `shortcuts run`, `zsh -lc` | `cmd /c` |
| Keep awake | Electron `powerSaveBlocker` | same |

Window positions are saved as fractions of a display's work area plus which display, so a layout survives resolution changes. When a saved display isn't there, `matchDisplays` tries the same id, then name + size, name, built-in, size, then left-to-right order; anything left goes to the main display (the switch says so).

## Code map

```
src/main.js            window, tray / menu bar, quick switcher, IPC, hotkeys, triggers, icons
src/store.js           scenes.json, settings.json, state.json, history.json in app data
src/core/plan.js       pure: displays, fractions, app identity, window matching, capture, switch plan, triggers, accelerators
src/core/engine.js     the switch, step by step; Desktop page arrange/tidy
src/core/templates.js  starter scenes, picks installed apps per platform
src/platform/mac.js    System Events (JXA), open, osascript, shortcuts, ps
src/platform/win.js    C# helper (windows + audio), Get-StartApps, reg.exe
src/platform/demo.js   a pretend computer (two displays, a dozen apps) for Linux and the e2e test
src/platform/run.js    run(), persistent PowerShell (same runner as Vitals)
src/renderer/          index.html, styles.css, app.js, canvas.js (the layout drawing), switcher.html/js
test/run.js            29 Node checks (SCENE_PWSH=/path/to/pwsh also compiles the C# helper)
test/e2e/              run.sh drives the real window under Xvfb on the pretend computer (34 checks, screenshots in out/)
build/make-icon.py     regenerates icon.png and the menu-bar template images
```

`SCENE_DEMO=1 npm start` runs on the pretend computer on any system.

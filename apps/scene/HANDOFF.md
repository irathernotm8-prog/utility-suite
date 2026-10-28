# Scene: handoff for the Scene chat

Scene is the Utility Package's workspace app: it saves and restores whole setups (apps, window positions on each display, links and files to open, what happens to other apps, volume, appearance, wallpaper, keep-awake, Shortcuts/commands) and switches between them from the window, global shortcuts, a quick switcher, the menu bar / tray, or triggers (display plugged in, time of day, app opens). It lives in `apps/scene` inside `~/Downloads/Utility Package`. `apps/scene/README.md` has the feature list, where everything comes from on Mac and Windows, and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/scene
npm install
npm start          # SCENE_DEMO=1 npm start runs on a pretend computer
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note scene "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/scene`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb) against `src/platform/demo.js`. `npm test` runs 29 Node checks: display matching, fractions, app identity across both systems, window matching, capture, the switch plan, triggers, accelerators, templates, fixtures of the Mac System Events listing and the Windows helper output, and a full switch + restore on the pretend computer. With `SCENE_PWSH=/path/to/pwsh` it also compiles the Windows C# helper through the real PowerShell runner (it does, on PowerShell 7).
- `test/e2e/run.sh` drives the real window (34 checks): templates, capture, clicking/dragging/resizing/double-clicking windows in the editor, hotkey recording, every tab, a real switch, Desktop snapping, Automations, History, Restore previous, the quick switcher and its HUD.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **Mac Accessibility.** Reading and moving windows goes through System Events, so Scene needs System Settings › Privacy & Security › Accessibility (the banner's Open Settings button prompts and opens the pane), and the first switch asks to let Scene control System Events. Without it apps still launch; placing is skipped and the switch says why. If moving windows fails, run `LIST_JXA` from `src/platform/mac.js` with `osascript -l JavaScript` in Terminal to see System Events' answer.
  2. **Mac full screen** uses `AXFullScreen`; leaving full screen waits ~1 s for the animation. Windows on other Spaces aren't listed by System Events (no public API), so a scene only sees windows on the current Space plus full-screen ones.
  3. **Windows helper.** The C# in `win.js` is compiled once per PowerShell session by Add-Type (Windows PowerShell 5.1 uses C# 5, so keep it free of newer syntax). If the window list is empty, run `[SceneWin]::List()` after the `PRELUDE` in a PowerShell window.
  4. **Windows DPI.** The helper runs per-monitor DPI aware and returns physical pixels; `main.js` converts with `screen.screenToDipRect` / `dipToScreenRect`. Mixed-scale setups (laptop at 150 %, monitor at 100 %) are the thing to test: `Place` calls `SetWindowPos` twice because crossing to another scale makes the window resize itself.
  5. **Windows Store apps** launch through `shell:AppsFolder\<AUMID>`; their windows belong to `ApplicationFrameHost`, so the helper reports the real app process instead.
  6. **Volume on Windows** uses Core Audio through the same helper (`SceneAudio`).

## Rules specific to Scene

- **The window never runs commands.** Everything goes through `window.scene.call(...)` → `ipcMain` handlers in `main.js` → `src/core/engine.js` / `src/platform/*`.
- **Planning stays pure** in `src/core/plan.js` with checks in `test/run.js`. The engine only orders steps and calls the platform.
- **Every platform module has the same shape** (`snapshot, runningApps, listApps, launch, place, quit, hide, focus, getVolume, setVolume, setMute, getAppearance, setAppearance, setWallpaper, listShortcuts, runShortcut, runCommand, supports`). Add a function to `demo.js` too so the e2e test keeps working.
- **Never call `app.getFileIcon` on macOS** (crashes Electron 44). Mac icons come from `plutil` + `sips`, cached in `userData/app-icons`.
- **Quitting is always the polite kind** (apps can still ask to save). System apps (`PROTECTED` in plan.js) and the user's keep-open list are never hidden or quit.
- **Triggers wait 20 s after any switch** and never re-fire for the active scene, so automations can't loop.
- Scenes, settings, state (active scene, the "previous" layout) and history are JSON in `app.getPath('userData')`.

## Utility Suite link (0.1.2)

Scene now offers a few things to other suite apps (Atoll's add-ons) over the **Utility Suite link**: `src/suitelink.js`, a copy of `tools/suitelink.js` in the Utility Package. Keep it identical to that file; the Utility Package chat owns it. It's a Unix socket in `~/Library/Application Support/Utility Suite/link` (mode 0600) on a Mac and a per-user named pipe on Windows, so only this user's apps can reach it. Everything is in `src/main.js` under "Utility Suite link".

- Offers: `list`, `activate(id)`, `previous`, `open`; event `switched`.
- Nothing changes when no other app is connected: events are only sent while something is listening.
- If you rename or remove one of these, tell the Utility Package chat so Atoll keeps working.

# Bench: handoff for the Bench chat

Bench is the Utility Package's test workspace for Claude. It has **desks**: a sandbox on this computer with per-app data, Mac/Linux VMs through Tart, Windows Sandbox, or another computer by VNC + SSH. It has a **live view** you can watch and use, **parallel smoke tests and test runs**, **findings**, and a **Claude/Codex plugin** (MCP) so Claude can launch, see, click, type, read errors and file bugs. It lives in `apps/bench` inside `~/Downloads/Utility Package`. `apps/bench/README.md` has the feature list, code map and where data lives.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/bench
npm install
npm start          # npm run demo adds a pretend VNC desktop
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note bench "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/bench`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44.7.0 under Xvfb):
  - `npm test`: 13 checks.
  - `test/e2e/run.js`: 40 checks. It starts the real Bench under Bench's own driver and uses every kind of Claude tool through the bridge against a pretend Utility Package of three apps (one with a renderer error, one that crashes): launch from source, inspect, type by ref, click by text and by coordinates, a menu shortcut, native Open dialog and message box, evaluate, logs, a web page, run_command, a 3-app parallel smoke test that sorts pass/warn/fail correctly, test suites side by side, the demo VNC desk, and a real x11vnc + sshd desk (commands and SFTP both ways).
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **Out-of-sight windows on macOS.** Hidden apps get opacity 0, click-through, off-screen, `app.dock.hide()`, and `show()`/`focus()` patched to never take focus. Launch flags turn off Chromium's occlusion throttling. If a hidden window's live view freezes, check `hooks.js → B.capture` (capturePage first, DevTools screenshot as a 4-second fallback). The desk's **On screen** mode is the workaround.
  2. **HOME override on macOS.** Node's `os.homedir()` follows `HOME`, and `--user-data-dir` moves app-data. Electron's `app.getPath('documents')` on a Mac may still point at the real Documents. Check an app that saves there (Docket, RO2, Facet) on a sandbox desk.
  3. **Electron fuses.** Bench needs `--inspect-brk`. Suite apps built by electron-builder allow it. Apps that switch off the `EnableNodeCliInspectArguments` fuse run "logs only", and Bench says so.
  4. **Tart** (Apple Silicon): first Mac VM desk → Tart download → `tart pull ghcr.io/cirruslabs/macos-tahoe-base:latest` (~20 GB) → clone → `tart run --no-graphics --vnc-experimental`. Bench parses the `vnc://` URL from Tart's output and waits for `tart ip`. SSH user `admin`/`admin`. Cmd is sent as `Super_L` over VNC; check Cmd shortcuts reach the VM.
  4b. A VM can't run a newer macOS than the Mac itself: Tahoe (macOS 26) images need a macOS 26 host, so `tart.defaultImage()` picks Sequoia on older Macs and the New desk sheet greys Tahoe out. Builds are installed by `ScreenDesk.launch({file})` (.dmg/.zip/.app/.pkg). It removes `/Applications/<name>` only after finding an app name, and always unmounts the DMG.
  5. **Windows Sandbox**: `desk.wsb` maps `desks/<id>/share` → `C:\Bench` and runs `bench-agent.ps1` hidden at sign-in. Only one sandbox can run at a time. Check the agent's screenshots, SendInput clicks and typing, and that `run` jobs and MSI installs don't block screenshots (both run in the background). A command whose child keeps running (e.g. `start notepad`) answers 2 s after the command exits, without waiting for the child. On Windows 11 24H2+, check that the process names Bench watches (`WindowsSandbox.exe`, `WindowsSandboxClient.exe`, `WindowsSandboxRemoteSession.exe`) still match.
  6. **Plugin**: Claude app → `claude_desktop_config.json` (restart Claude). Claude Code → `claude mcp add bench --scope user` (or `~/.claude.json`). Codex → `~/.codex/config.toml`. Same mechanism as Cadence. When the Claude app is linked to this Mac, cloud tasks reach Bench through the desktop app as well.
  7. **Login PATH**: Bench asks the login shell for `PATH` at start, so `npm`/`node` are found when opened from Finder (`host.loginPath()`).

## Rules specific to Bench

- **The window never runs commands.** Everything goes through `window.bench.call(...)` → `ipcMain` handlers in `app-main.js` → `src/core/*`.
- **hooks.js runs inside other apps.** It's turned into text (`benchHooks.toString()`), so it can't use anything from Bench's scope. Keep it compatible with older Electron (no optional catch binding assumptions, guard newer APIs). It must never change an app's behaviour unless Bench asks (hiding, dialogs).
- **Coordinates Claude sends are screenshot pixels.** `ElectronApp._pt` / `ScreenDesk._pt` scale by the last screenshot's scale. The live view deletes its own entries from `lastShot`, so watching never changes Claude's scale.
- **Never delete outside Bench's folders.** Use `store.safeRemove(target, roots)`. Desks are removed only as `desks/<id>`; VM disks only through Tart (`tart delete bench-<id>`).
- **Utility Hub is never in an "all apps" smoke test** (it installs and removes real apps). It's tested only when named.
- **Pure core modules** (`des`, `png`, `keys`, `rfb`, `apps`, `runs`, `findings`, `store`, `page-scripts`, `winsandbox` protocol) have no Electron imports, so `npm test` covers them. Add a check when you change one.
- Every Claude tool result says what changed (new errors, dialogs, windows). Keep that when adding tools, and record each action with `desks.record(...)` so the live view and activity feed show it.
- `ssh2` is pure JavaScript here: `.npmrc` has `omit=optional` and `build.npmRebuild` is false, so no native modules are built (Windows cross-builds stay simple).

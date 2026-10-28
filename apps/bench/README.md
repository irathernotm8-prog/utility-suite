# Bench

A desktop workspace for Claude to test apps on your Mac or PC, using this computer's power. Bench gives Claude (and you) **desks** to run things on, a **live view** of what's happening, and a **Claude plugin** to launch, see, click, type, read errors, smoke-test the whole Utility Suite in parallel and file bugs.

## What it does

- **Desks**
  - **Sandbox** (Mac and Windows): apps run on this computer, each with its own home, app-data and temp folders inside the desk (`--user-data-dir`, `HOME`/`USERPROFILE`/`APPDATA`/`TMPDIR`), so testing never touches your real data unless you ask for it (`data: "real"`). Windows stay **out of sight** by default (transparent, click-through, off-screen, not in the Dock/taskbar, and they never take focus), and you watch them in Bench instead. Data modes per launch: the desk's own (kept), fresh (thrown away when it quits), or your real data.
  - **Mac VM / Linux VM** (Mac with Apple Silicon): clean macOS Tahoe/Sequoia or Ubuntu through [Tart](https://github.com/cirruslabs/tart) (free for personal use), downloaded into Bench's own folder the first time. Each desk is an instant APFS clone, **Reset** goes back to the clean copy, and **Save as clean** makes the current state the new reset point. The screen comes over Tart's built-in VNC; commands and file copies over SSH (`admin`/`admin`).
  - **Windows Sandbox** (Windows 10/11 Pro/Enterprise/Education): a fresh Windows desktop every time. Bench maps the desk's `share` folder to `C:\Bench` and starts `bench-agent.ps1` at sign-in. The agent takes screenshots, moves the mouse, types and runs commands.
  - **Another computer**: any VNC screen (your Windows PC from the Mac, a Linux box), plus optional SSH for commands and copying builds.
- **Electron apps are fully controllable** (every Utility Suite app, installed or run from its source in `apps/<id>`, plus Slack, VS Code, Notion…). Bench starts the app paused under its own debugger and puts a small helper in before any app code runs (`src/core/hooks.js`). From then on Bench can:
  - list windows and take screenshots (even when a window is out of sight);
  - click, type, scroll, drag and press keys through each window's DevTools connection (works unfocused, with Mac editing commands);
  - give an **element list with refs** (`e12 button "Save" at 412,300`), and click, fill or pick dropdown options by ref or by visible text;
  - press **menu shortcuts through the app menu**, as macOS would;
  - catch **native dialogs** (Open, Save, message boxes, error boxes), which never show in screenshots. Bench holds them for Claude (`answer_dialog`) or for you (a card on the live view);
  - collect every console message, uncaught exception, renderer crash, hang, failed load and child-process crash.
- **Web pages** open in Bench's own browser window (Bench started with `--bench-shell`), driven the same way.
- **Live view**: the desk shows the app window (or the VM's whole screen) at up to 15 fps. Click and type straight into it. Claude's clicks show as a pink cursor with its name, and the activity feed lists everything Claude, you and Bench did.
- **Runs**: smoke-test many apps at once, each with fresh data and out of sight. Bench waits for windows, screenshots each one, collects errors and crashes, then closes it. You get pass/warn/fail tiles. Also runs `npm test` across app sources side by side. How many run at once comes from this computer's cores and free memory (`core/host.js → suggested()`).
- **Findings**: bugs filed by Claude (or you) with the app and version, steps, expected vs actual, a screenshot and the logs. **Copy for the app's chat** gives Markdown to paste into that app's chat.
- **Claude plugin**: an MCP server (`mcp/bench-mcp.js`) with one-click setup for the Claude app, Claude Code and Codex. It has 27 tools: `bench_overview`, `launch`, `list_sessions`, `screenshot`, `inspect`, `click`, `type`, `press_keys`, `scroll`, `drag`, `wait_for`, `menu`, `answer_dialog`, `evaluate`, `logs`, `run_command`, `copy_files`, `set_window`, `stop_session`, `desk_control`, `create_desk`, `smoke_test`, `run_tests`, `get_run`, `report_finding`, `list_findings`, `update_finding`. Every action result reports what changed: new console errors, dialogs waiting, windows opened or closed.

## Working on it

```bash
npm install
npm start
npm run demo            # adds a pretend VNC desktop and two sample findings (BENCH_USER_DATA=/tmp/x keeps it separate)
npm test                # 13 checks, no window (DES, PNG, keys, VNC client against the fake screen, Windows agent protocol, apps, runs, findings, MCP server)
xvfb-run -a node test/e2e/run.js /tmp/e2e     # 40 checks with the real Bench window, a pretend Utility Package and (as root, with x11vnc + sshd) a real VNC + SSH desk
xvfb-run -a node test/e2e/shots.js /tmp/shots dark   # screenshots of every screen
python3 build/make-icon.py                       # icon + tray icons
```

## Where things live

- App-data folder (`~/Library/Application Support/Bench`, `%APPDATA%\Bench`):
  - `settings.json`, `desks.json`, `findings.json` + `findings/<id>/` (screenshots, `logs.txt`), `runs.json` + `runs/<id>/` (smoke-test pictures, test output);
  - `desks/<id>/`: a sandbox desk's `home/`, `data/<app>/` (each app's app-data), `tmp/`; a Windows Sandbox desk's `share/` and `desk.wsb`;
  - `engines/` (Tart, ~20 MB), `vms/` (TART_HOME: the system images, 20–30 GB each, and every VM desk's disk);
  - `bridge.json` (the plugin's port + private token), `mcp/` (the MCP script the AI apps run).
- Screenshots you save: `~/Pictures/Bench`. Copies out of desks default to `~/Downloads/Bench`.

## Code map

```
src/main.js              entry: Bench, or Bench's browser window when started with --bench-shell (src/shell.js)
src/app-main.js          window, tray/menu bar, settings, IPC, live view frames + your input, desk thumbnails, demo
src/connectors.js        the plugin: local bridge (127.0.0.1 + token) and Claude app / Claude Code / Codex config writers
src/mcp-handlers.js      what each Claude tool does (and the activity it records)
mcp/                     the MCP server Claude/Codex start (copied to the app-data folder on connect)
src/core/electron-app.js runs one Electron app under Bench's control (debugger, hooks, input, inspect, dialogs, logs, quit)
src/core/hooks.js        the helper Bench puts inside an app's main process (windows, capture, input, menus, dialogs)
src/core/page-scripts.js element list with refs, find by text, wait for text (run inside app windows)
src/core/sandbox-desk.js sandbox desks: isolated environments, sessions (apps, commands, other apps)
src/core/screen-desk.js  VNC desks (Tart VMs and other computers): screen, input, SSH commands, copy and install builds
src/core/winsandbox.js   Windows Sandbox: .wsb, starting/stopping, the shared-folder agent client
src/assets/bench-agent.ps1  the agent inside Windows Sandbox
src/core/tart.js         Tart: download, system images, clone, run with VNC, IP, reset, save clean
src/core/rfb.js, des.js  VNC client (RFB 3.3–3.8, Raw/CopyRect/DesktopSize, VNC password)
src/core/ssh.js          SSH commands + SFTP copies (ssh2, pure JavaScript)
src/core/desks.js        desk records, live desk objects, activity log
src/core/runs.js         smoke tests and test-suite runs in parallel
src/core/findings.js     findings + Markdown
src/core/apps.js         installed Utility Suite apps, app sources in the Utility Package, launch commands
src/core/keys.js         key names → VNC keysyms, DevTools key events (with Mac editing commands), Windows VK codes
src/core/host.js         cores, memory, load, how many at once, the login shell's PATH
src/renderer/            the window (app, desk, views, sheets)
src/demo/fake-vnc.js     a pretend VNC desktop for the demo and tests
```

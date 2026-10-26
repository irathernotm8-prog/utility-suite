# Cadence: handoff for the Cadence chat

Cadence is the Utility Package's automation app: schedules, folder watches and manual runs that pull reports from sites (a real browser with saved sign-ins and a recorder), file them in folders named for the week, crunch the data, compare with last week, and build PowerPoint decks and PDF reports. Claude and Codex plug in two ways: as AI steps inside automations, and through Cadence's MCP plugin to build, test and run automations. It lives in `apps/cadence` inside `~/Downloads/Utility Package`. `apps/cadence/README.md` has the step list, templates syntax, code map and data folders.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/cadence
npm install
npm start
npm run demo                                  # demo data; add CADENCE_USER_DATA=/tmp/cadence-demo to keep it apart
npm test                                      # 25 Node checks, no network (one drives Playwright's Chromium if installed)
node test/e2e/site.js                         # a local "analytics site" on :4477 to try the Browser step and Record
LUMEN_DIR=../lumen xvfb-run node test/e2e/shots.js /tmp/shots   # (Linux) real runs incl. driving Lumen and filling a template
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note cadence "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/cadence`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- `npm test`: dates/ISO weeks, templates and filters, schedules (including month ends and catch-up), CSV quirks, Excel round trip, transforms/formulas/compare, catalog + every starter template valid, validation, a full weekly run (download with a secret header → week folder → read → compare → AI stand-in → PowerPoint with real charts, PDF/HTML, Markdown, Excel, Slack-style webhook), week-over-week on the second run, retries/keep-going/conditions, API/unzip/find/cleanup/script/run-another, scheduler catch-up, folder watch, cancel, test-up-to-a-step, the “Describe it” builder, and the MCP server end to end over stdio.
- `test/e2e/shots.js` (Linux, xvfb): starts the app on demo data against `test/e2e/site.js`, runs the weekly report for real twice (browser sign-in with a secret, choose “Last week”, click-and-download, file into the week folder, compare, PowerPoint), records a sign-in + export with the recorder, writes Claude Desktop and Codex configs into a scratch home, and screenshots every screen in dark and light.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **Menu bar / tray and login item:** close the window — Cadence should stay in the menu bar (Mac, template icon) or tray (Windows, `build/tray.png`) and the Mac dock icon should hide. Settings › Open at login uses `app.setLoginItemSettings({ openAsHidden, args: ['--hidden'] })`.
  2. **Schedules after sleep:** put the Mac to sleep over a scheduled time; on wake (`powerMonitor` resume/unlock) the run should catch up once. A `prevent-app-suspension` blocker is held while runs are going.
  3. **Claude Code / Codex discovery:** GUI apps on the Mac don't get the terminal PATH, so `src/core/ai.js` asks the login shell once and adds `~/.local/bin`, `~/.claude/local`, Homebrew, nvm, Volta and npm-global. On Windows it looks in `%APPDATA%\npm`, `~\.local\bin` and WinGet links, and runs `.cmd` shims through the shell. Connections › AI should show both as found.
  4. **Plugin install:** “Add to Claude Code” runs `claude mcp add cadence --scope user …` when the CLI is found (else edits `~/.claude.json`); “Add to Claude” edits `claude_desktop_config.json`; “Add to Codex” rewrites only the `[mcp_servers.cadence]` tables in `~/.codex/config.toml`. All keep a `.cadence-backup`. The server runs with Cadence's own Electron as Node (`ELECTRON_RUN_AS_NODE=1`) from the app-data `mcp/` folder, and starts Cadence hidden if it isn't running.
  5. **Secrets** use `safeStorage` (Keychain / DPAPI); the first save on a Mac may ask for keychain access.
  6. **PDF reports** print through a hidden window (`printToPDF`, A4).

## 0.2.0 — apps and PowerPoint templates

- **Use an app** (`app.use`, `src/apps.js`): for Electron/Chromium apps Cadence launches the app's own executable with `--remote-debugging-port=<free port>` (restarting it once if it's open, since it can only attach to apps it started) and drives the window over CDP with a tiny client on Node's built-in WebSocket. The Browser step and this step share `src/actions.js`; the Browser step's driver is Electron's webContents, this one is CDP. Afterwards: put the app back as it was (quit, and reopen normally if it had been open), leave it, or quit. Any app: `src/native.js` (System Events keystrokes/menus on Mac, WScript.Shell SendKeys on Windows, clipboard, AppleScript/PowerShell). Record works inside apps too (recorder injected with `Runtime.addBinding`).
- New actions: **Copy cards as a table** (`extractList`, e.g. Lumen's KPI tiles: `.kpi` with `Metric=.l, Value=.v, Change=.d`; also gives `values.<name>.<label>`), shortcut, keys, menu, focus, openFile, clipboard, appScript. Table headers drop sort arrows (↓↑).
- **Fill a PowerPoint template** (`doc.template`, `src/core/pptx.js`, `@xmldom/xmldom` + fflate): inspect (shapes with ids/names/positions incl. layout-inherited placeholders and groups, tables, charts, pictures, notes, theme) and fill (whole text, part of a sentence, tables in the template's row style with re-summed Total row, charts' caches + embedded workbook, pictures kept in their box, slides repeated per row incl. charts and notes, `{{ }}` anywhere). Numbers take the format of the text they replace. The editor shows a clickable wireframe of each slide; **Map with AI** sends the map + this automation's values (with examples from the last test) to Claude/Codex.
- **Make PowerPoint › Match the look of a PowerPoint**: theme accents and heading/body fonts from any .pptx.
- Starter template **Lumen numbers into your PowerPoint** (the targets match Lumen 0.7: `#rpBtn`, `.kpi .l/.v/.d`, `#tbl table`, `#chart`). If Lumen's markup changes, re-record or edit the actions.
- MCP: `inspect_powerpoint`, `list_apps`. Mac build adds `NSAppleEventsUsageDescription`.
- Verified here: Lumen 0.7.0 from source under Electron 44 (Linux): open with debugging, pick Last 7 days, copy KPI cards + campaign table + chart screenshot, fill a team template (text, KPI deltas, table, chart, picture), restore. Templates made by pptxgenjs and re-saved by LibreOffice both fill. **Not yet on a real Mac/Windows:** check that an installed Lumen.app / Lumen.exe opens with the debugging port (Electron fuses could disable it in other apps), that Accessibility/Automation prompts appear for shortcuts and menus, and a template saved by PowerPoint itself (map, fill, open in PowerPoint without a repair prompt).

## Rules specific to Cadence

- **The step catalog is the contract.** A new step type needs: an entry in `src/core/catalog.js` (fields, outputs, `doc`), an implementation in `src/core/steps/*.js` returning its outputs, a summary line in `stepSummary()` (`src/renderer/editor.js`), and a test in `test/run.js`. The editor, validation, “Describe it” and the MCP reference all read the catalog, so they pick it up automatically.
- **Steps receive rendered fields** (`{{ }}` already resolved) except those listed in `RAW_FIELDS` in `runner.js`. Use `x.resolvePath()` for every path (handles `~` and relative paths), `x.dir` for scratch files, `x.log()` for progress, and `x.signal` for cancel.
- **Never log secret values.** The runner redacts any secret a run touched, but don't put tokens in error messages either. Claude/Codex only ever see secret names.
- **Outputs that are tables** must be `{ columns, rows }`; history and the window get them trimmed by `summarize()`.
- **Keep step ids stable** when editing templates or migrating: run history and “Compare with last run” memory are keyed by step id.
- **Apps:** never send keystrokes to an app without focusing it first (`native.focus()`), and keep page actions behind a driver so the Browser and app steps stay identical. Don't keep debugging ports open after a run unless the step says “Leave it open”.
- **Templates:** never write into the template file; fills find shapes by id + name + kind (some tools reuse ids). Keep `formatLike()` the single place numbers get the template's format.
- The window never touches Node; everything goes through `window.cadence.call(...)` → `ipcMain` handlers in `src/main.js`.
- Data stays in the app-data folder (`flows/`, `runs.json`, `memory.json`, `secrets.json`, `profiles.json`, browser partitions `persist:cadence-<profile>`, `runs/<id>/`). Output goes wherever automations say (default `~/Documents/Cadence/<automation>`).

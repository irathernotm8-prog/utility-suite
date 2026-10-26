# Cadence

Automations that run on your schedule, for Mac and Windows. Pull a report from a site every Monday, file it in a folder named for the week, compare it with the week before, and turn it into PowerPoint slides or a PDF report — with Claude and Codex plugged in to build and run the harder ones.

## What it does

- **Triggers:** a schedule (every few minutes or hours, daily, weekly, monthly — first/last weekday too), a new file landing in a folder, a manual run, another automation, or Claude/Codex. Runs missed while the computer slept catch up when it wakes. Cadence keeps running in the menu bar / tray and opens at login, so schedules keep working after a restart.
- **Steps** (27 types):
  - Web: **Browser** (a real Chromium window with saved sign-in profiles; click, type, choose, wait, download, copy tables/text, screenshot, save as PDF — and **Record** to write the steps by clicking through the site), **Download a file**, **Call an API**, **Post to Slack / Teams**.
  - Apps: **Use an app** — for apps built on Electron or Chromium (every Utility Suite app such as Lumen, plus Slack, Notion, VS Code, Chrome…) Cadence opens the app with a private debugging connection and reads and clicks inside its window: set Lumen to “Last 7 days”, copy its KPI cards (**Copy cards as a table**) and campaign table, screenshot a chart, with **Record** to write the steps. For any other app: bring it to the front, shortcuts, typing, menu items (Mac), open a file in it, read the clipboard, AppleScript / PowerShell.
  - Files: make a folder (e.g. `~/Documents/Reports/{{week.label}}`), save/move/rename files, find files, unzip, write a text file, clean up old files (to the Trash).
  - Data: read CSV/Excel/JSON (several files stack into one table), shape it (filter, sort, group and total, calculated columns, % of total, total rows…), **compare with last run** (week-over-week change per row and totals), save as Excel/CSV, set named values.
  - Output: **Fill a PowerPoint template** — reads your own deck (every text box, table, chart and picture, where it sits, the theme fonts and colours), shows each slide as a clickable map, and each run writes a copy with the new data in the same places: whole text or just the number inside a sentence, tables refilled in the template's row styling (a “Total” row is re-summed), charts re-plotted and still editable, pictures swapped, a slide repeated per row, and `{{ }}` typed into the deck filled in. Numbers keep the template's format ($, %, decimals). **Map with AI** matches the boxes to this automation's data. **PowerPoint** (title, big numbers with deltas, real editable charts, tables, bullets, pictures; three looks and an accent colour, or the colours and fonts of any .pptx) and **reports** (PDF, HTML or Markdown with the same building blocks).
  - AI: **Ask AI** (Claude Code / Codex sign-in, or an Anthropic/OpenAI key; can reply as JSON for slides) and **AI agent task** (Claude Code or Codex working inside a folder).
  - Flow & system: only continue if…, notify me, open, wait, run a script (shell, Python, Node), run another automation.
- **Templates:** Lumen numbers into your PowerPoint, weekly report → slides, daily download, file new downloads by week, monthly Excel roll-up, weekly AI digest.
- **Describe it:** type what you want; Claude or Codex drafts the automation, Cadence checks it, and you review it in the editor.
- **Claude & Codex plugin:** an MCP server (`mcp/cadence-mcp.js`) with one-click install for the Claude app, Claude Code and Codex. Tools: `cadence_reference`, `cadence_context`, `list_automations`, `get_automation`, `create_automation`, `update_automation`, `set_enabled`, `run_automation`, `test_step`, `get_run`, `list_runs`, `cancel_run`, `delete_automation`, `inspect_powerpoint`, `list_apps`. New automations from the plugin start switched off.
- **Secrets** are encrypted with the system keychain (Electron `safeStorage`), used as `{{secrets.NAME}}`, redacted from every log, and only their names are shown to Claude/Codex.

## Working on it

```bash
npm install
npm start
npm run demo                 # demo automations and history (use CADENCE_USER_DATA=/tmp/x to keep it separate)
npm test                     # 25 checks, no network (the app check uses Playwright's Chromium when present)
LUMEN_DIR=../lumen xvfb-run node test/e2e/shots.js /tmp/shots   # real runs (local site, Lumen, template fill) + screenshots (Linux)
node test/e2e/site.js        # the local "analytics site" on :4477, to try the Browser step by hand
python3 build/make-icon.py   # regenerate the icon and tray icons
```

## Templates (`{{ }}`)

Any text field can use values from earlier steps and dates: `{{steps.<id>.<output>}}`, `{{week.label}}` (“Week of 2026-10-19”), `{{week.range}}`, `{{lastWeek.start}}`, `{{today}}`, `{{month.label}}`, `{{inputs.file}}`, `{{secrets.NAME}}`, `{{run.dir}}`. Filters: `date:"MMM D"`, `addDays:-7`, `number`, `currency`, `percent`, `change`, `compact`, `slug`, `safe`, `basename`, `stem`, `join`, `sum:"Col"`, `default:"…"` and more. A field that is exactly one `{{ }}` passes the raw value (a table or list). The full list is in `src/core/catalog.js` → `referenceText()` (also what Claude/Codex read).

## Code map

```
src/main.js             window, tray/menu bar, login item, settings, IPC, engine services (notify, PDF, trash, open)
src/actions.js          the actions both the Browser and Use an app steps run (click, type, copy tables/cards, download, screenshot, shortcuts…)
src/browser.js          Browser step (hidden Chromium + trusted input), Sign in windows, Record
src/apps.js             Use an app: finding apps, opening them with a debugging port, a small CDP client, restore/quit, Record in apps
src/native.js           shortcuts, typing, menus, clipboard, AppleScript/PowerShell for any app
src/recorder-core.js    the recorder (injected into the Record window or an app's window)
src/connectors.js       the plugin: local bridge (127.0.0.1 + token in bridge.json) and Claude/Codex config writers
src/mcp-handlers.js     what each plugin tool does (plain functions over the engine)
mcp/                    the MCP server Claude/Codex start (copied to the app-data folder on connect)
src/core/engine.js      automations, runs, queue (3 at once), scheduler tick (20 s + on wake), folder watchers (polling)
src/core/runner.js      one run: templating each step, retries, keep-going, logs, redaction, outputs
src/core/catalog.js     every step type: fields, outputs, docs (drives the editor, validation, AI and MCP)
src/core/steps/*.js     the step implementations
src/core/table.js       CSV/Excel/JSON, transforms, formulas, compare
src/core/pptx.js        PowerPoint templates: inspect (map, theme) and fill (text, tables, charts, pictures, repeated slides, {{ }})
src/core/template.js    {{ }} and filters        src/core/dates.js  weeks, formats
src/core/schedule.js    next run + wording       src/core/validate.js  checks + normalize
src/core/ai.js          Claude Code / Codex CLIs and API keys   src/core/ai-build.js  “Describe it”
src/core/store.js       flows/*.json, runs.json, memory.json, secrets.json, state.json, runs/<id>/
src/renderer/           the window (app, fields, flows, editor, runs, more, boot)
```

## Data

All in the app-data folder (`~/Library/Application Support/Cadence`, `%APPDATA%\Cadence`): `flows/` (one JSON per automation), `runs.json` (history), `memory.json` (last-run tables for comparisons), `secrets.json` (encrypted), `profiles.json` + browser partitions (sign-ins), `runs/<run id>/` (scratch files, kept 14 days by default), `deleted/` (deleted automations). Output goes wherever the steps say — by default `~/Documents/Cadence/<automation>`.

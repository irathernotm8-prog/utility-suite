# Cadence

Automations that run on your schedule, for Mac and Windows. Pull a report from a site every Monday, file it in a folder named for the week, compare it with the week before, and turn it into PowerPoint slides or a PDF report — with Claude and Codex plugged in to build and run the harder ones.

## What it does

- **Triggers:** a schedule (every few minutes or hours, daily, weekly, monthly — first/last weekday too), a new file landing in a folder, a manual run, another automation, or Claude/Codex. Runs missed while the computer slept catch up when it wakes. Cadence keeps running in the menu bar / tray and opens at login, so schedules keep working after a restart.
- **Steps** (25 types):
  - Web: **Browser** (a real Chromium window with saved sign-in profiles; click, type, choose, wait, download, copy tables/text, screenshot, save as PDF — and **Record** to write the steps by clicking through the site), **Download a file**, **Call an API**, **Post to Slack / Teams**.
  - Files: make a folder (e.g. `~/Documents/Reports/{{week.label}}`), save/move/rename files, find files, unzip, write a text file, clean up old files (to the Trash).
  - Data: read CSV/Excel/JSON (several files stack into one table), shape it (filter, sort, group and total, calculated columns, % of total, total rows…), **compare with last run** (week-over-week change per row and totals), save as Excel/CSV, set named values.
  - Output: **PowerPoint** (title, big numbers with deltas, real editable charts, tables, bullets, pictures; three looks and an accent colour) and **reports** (PDF, HTML or Markdown with the same building blocks).
  - AI: **Ask AI** (Claude Code / Codex sign-in, or an Anthropic/OpenAI key; can reply as JSON for slides) and **AI agent task** (Claude Code or Codex working inside a folder).
  - Flow & system: only continue if…, notify me, open, wait, run a script (shell, Python, Node), run another automation.
- **Templates:** weekly report → slides, daily download, file new downloads by week, monthly Excel roll-up, weekly AI digest.
- **Describe it:** type what you want; Claude or Codex drafts the automation, Cadence checks it, and you review it in the editor.
- **Claude & Codex plugin:** an MCP server (`mcp/cadence-mcp.js`) with one-click install for the Claude app, Claude Code and Codex. Tools: `cadence_reference`, `cadence_context`, `list_automations`, `get_automation`, `create_automation`, `update_automation`, `set_enabled`, `run_automation`, `test_step`, `get_run`, `list_runs`, `cancel_run`, `delete_automation`. New automations from the plugin start switched off.
- **Secrets** are encrypted with the system keychain (Electron `safeStorage`), used as `{{secrets.NAME}}`, redacted from every log, and only their names are shown to Claude/Codex.

## Working on it

```bash
npm install
npm start
npm run demo                 # demo automations and history (use CADENCE_USER_DATA=/tmp/x to keep it separate)
npm test                     # 18 engine checks, no Electron, no network
xvfb-run node test/e2e/shots.js /tmp/shots   # real run against a local site + screenshots (Linux)
node test/e2e/site.js        # the local "analytics site" on :4477, to try the Browser step by hand
python3 build/make-icon.py   # regenerate the icon and tray icons
```

## Templates (`{{ }}`)

Any text field can use values from earlier steps and dates: `{{steps.<id>.<output>}}`, `{{week.label}}` (“Week of 2026-10-19”), `{{week.range}}`, `{{lastWeek.start}}`, `{{today}}`, `{{month.label}}`, `{{inputs.file}}`, `{{secrets.NAME}}`, `{{run.dir}}`. Filters: `date:"MMM D"`, `addDays:-7`, `number`, `currency`, `percent`, `change`, `compact`, `slug`, `safe`, `basename`, `stem`, `join`, `sum:"Col"`, `default:"…"` and more. A field that is exactly one `{{ }}` passes the raw value (a table or list). The full list is in `src/core/catalog.js` → `referenceText()` (also what Claude/Codex read).

## Code map

```
src/main.js             window, tray/menu bar, login item, settings, IPC, engine services (notify, PDF, trash, open)
src/browser.js          Browser step (hidden Chromium + trusted input), Sign in windows, Record
src/recorder-preload.js runs inside the Record window: turns clicks/typing into actions
src/connectors.js       the plugin: local bridge (127.0.0.1 + token in bridge.json) and Claude/Codex config writers
src/mcp-handlers.js     what each plugin tool does (plain functions over the engine)
mcp/                    the MCP server Claude/Codex start (copied to the app-data folder on connect)
src/core/engine.js      automations, runs, queue (3 at once), scheduler tick (20 s + on wake), folder watchers (polling)
src/core/runner.js      one run: templating each step, retries, keep-going, logs, redaction, outputs
src/core/catalog.js     every step type: fields, outputs, docs (drives the editor, validation, AI and MCP)
src/core/steps/*.js     the step implementations
src/core/table.js       CSV/Excel/JSON, transforms, formulas, compare
src/core/template.js    {{ }} and filters        src/core/dates.js  weeks, formats
src/core/schedule.js    next run + wording       src/core/validate.js  checks + normalize
src/core/ai.js          Claude Code / Codex CLIs and API keys   src/core/ai-build.js  “Describe it”
src/core/store.js       flows/*.json, runs.json, memory.json, secrets.json, state.json, runs/<id>/
src/renderer/           the window (app, fields, flows, editor, runs, more, boot)
```

## Data

All in the app-data folder (`~/Library/Application Support/Cadence`, `%APPDATA%\Cadence`): `flows/` (one JSON per automation), `runs.json` (history), `memory.json` (last-run tables for comparisons), `secrets.json` (encrypted), `profiles.json` + browser partitions (sign-ins), `runs/<run id>/` (scratch files, kept 14 days by default), `deleted/` (deleted automations). Output goes wherever the steps say — by default `~/Documents/Cadence/<automation>`.

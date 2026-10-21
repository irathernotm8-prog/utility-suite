# Trace: handoff for the Trace chat

Trace is the Utility Package's charting, tracing, notes and screenshot-tutorial app. It lives in `apps/trace` inside `~/Downloads/Utility Package`. `apps/trace/README.md` has the feature list and code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/trace
npm install
npm start
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note trace "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/trace`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb): every view was driven and screenshotted, PDF export produced real PDFs, and screen and region capture worked (desktopCapturer + overlay). `npm test` has 17 checks (storage, folder scan, layout, routing, file rules).
- **Not yet run on a Mac or on Windows.** Check these first:
  1. First screenshot on a Mac asks for **Screen & System Audio Recording** permission. Trace explains this and has an Open Settings button. Ad-hoc signed builds may need the permission toggled off and on after an update.
  2. The region overlay and the capture bar use `type: 'panel'` on macOS so they float over full-screen apps without pulling Trace's main window forward. Confirm the overlay covers the menu bar, Esc cancels, and the bar stays put while you click in another app.
  3. Capturing from inside Trace hides the Trace window for a moment so the screenshot shows the app behind it.
  4. Windows: title-bar overlay colors follow the theme (`window:chrome`). The view bars leave 152px on the right for the window buttons.

## Rules specific to Trace

- **The window owns `project.json`; the main process only writes media files and their sidecars.** That way a screenshot arriving mid-edit can't overwrite unsaved changes. New screenshots reach the window through `trace:media-added`.
- **Screenshots are never edited.** Annotations and crop live in `media/<id>.json` and are drawn as SVG over the original (`T.annot.svg`). Flattened PNGs come from `T.annot.toPng` only when copying or saving.
- **Images are served through `trace-media://m/<projectId>/<file>`**, with project and file IDs checked against strict patterns in `store.js`. The renderer has no network (`connect-src 'none'`).
- **Undo** is per item: `app.mutate(item, fn, key)` snapshots the item before the change. Calls with the same key within 1.5s merge, so typing makes one undo step. Project-level changes (items list, capture groups) pass `{ project: true }` and skip history.
- **Layout** (`layout.js`): rank = longest path from a root. Each node sits under its closest parent, and subtrees are packed side by side so they can never overlap. Four or more leaf children stack in a column (org charts). Loops are found by DFS and drawn around the side. Keep `npm test`'s random-graph overlap check passing.
- Deleting a step that has one parent hands its children up to that parent. Alt+Delete deletes the whole branch.
- Notes HTML always goes through `T.sanitize` (allowlist) on save and on display.

## Testing

- `npm test`: quick Node checks.
- `TRACE_USER_DATA=/tmp/trace-test npm start` gives a clean library with the Welcome project.
- `TRACE_TEST_SAVE_DIR=/tmp/pdfs` skips the PDF save dialog (used for automated export checks).

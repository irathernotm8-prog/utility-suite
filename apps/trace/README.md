# Trace

Map how things connect, then walk down any path with a smooth zoom. Part of the Utility Package.

## What it does

- **Charts** of any kind: decision trees with If / And / Or, org charts, folder plans, workflows, or a blank canvas. Charts lay themselves out **vertically or horizontally** (press **O** to flip). You can switch any chart to free layout and place steps by hand.
- **Trace mode** (**T**): the camera flies to each step as you go. The panel shows that step's note and screenshots and your choices (number keys pick a branch). It also shows where the path *could* have gone. **Shift+T** traces the way from the top to the selected step.
- **Scenarios**: save a traced path ("What if the numbers don't match") and play it back, or present it.
- **Notes**: standalone notes (headings, checklists, quotes, code, links, images, Markdown shortcuts), plus a note on every step of a chart.
- **Where does this file go?**: folder nodes carry rules (`.pdf`, `invoice*`, `receipt`). Type a file name and Trace traces the way to the folder it belongs in. **Map a real folder** reads an existing folder (3 levels deep) into a chart with the file types found in each.
- **Screenshots**: a global shortcut (**Cmd/Ctrl+Shift+2**) drags out a region from any app, and **Cmd/Ctrl+Alt+Shift+2** repeats the last region. The floating **capture bar** stays on screen while you click through another app. Screenshots land in **Captures**, where you can group, reorder, annotate (arrows, boxes, highlight, text, numbered steps, blur, crop), copy or save them.
- **Guides**: step-by-step tutorials built from screenshots. Each step has a picture, a short line saying what to do, and details underneath.
- **Present** (**Cmd/Ctrl+Enter**): charts (a live trace or a scenario), notes (as slides split at headings), guides and screenshot slideshows.
- **Export PDF** (**Cmd/Ctrl+E**): notes, charts (fit to Letter/A4 or one big poster page, plus each step's notes and the scenarios), guides, or a whole project.
- **Search everything** (**Cmd/Ctrl+K**), including single steps inside charts.

## Code map

```
src/main.js           window, menu, IPC, trace-media:// protocol, PDF export, settings
src/store.js          projects on disk (plain Node; tested)
src/capture.js        global shortcuts, capture bar, region overlay (desktopCapturer)
src/folders.js        reads a real folder into a tree (tested)
src/renderer/
  app.js              shell: projects, sidebar, undo, saving, palette, settings, Overview, viewer, picker
  chart.js            chart editor, camera, trace mode, scenarios, inspector, find-file
  layout.js           layered layout, edge routing, smooth zoom (UMD; tested)
  rules.js            file rules for folder plans (UMD; tested)
  templates.js        chart templates and the Welcome project
  richtext.js         notes editor
  notes.js guide.js captures.js present.js annotate.js exporthtml.js
  overlay.html/.js    region picker drawn over a frozen screenshot
  bar.html/.js        floating capture bar
src/seed/             example screenshots for the Welcome guide (made-up "Northwind" app)
```

## Data

`~/Library/Application Support/Trace/Library/projects/<id>/` (Windows: `%APPDATA%\Trace\Library\...`)
- `project.json`: charts, notes, guides, capture groups
- `media/<id>.png` + `media/<id>.json`: original screenshots (never edited) and their annotations and crop

Settings → Library → Show opens it.

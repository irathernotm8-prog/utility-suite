# Fresh Desk 1.1

A fast, no-bloat file explorer for Mac and Windows, with **Tidy** built in. Part of the Utility Package.

## What it does

**Browse**
- Tabs, back/forward, a clickable path bar (click the empty part, or ⌘L / Ctrl+L, to type a path; `~` works).
- List, Grid (real thumbnails via Quick Look on Mac / Explorer on Windows) and Column views. Lists are virtualized, so huge folders stay quick.
- Sidebar: Favorites (drop a folder on the list to pin it), Recent folders, drives. Every favorite can have its own name, icon (99 to choose from) and color — you pick them when you add it, or right-click → Change Icon & Name. Drag favorites to reorder them.
- Preview pane: live previews of PDFs (every page), Word documents, Excel sheets (with sheet tabs), CSV/TSV, PowerPoint slide outlines, Markdown and RTF — plus images, video, audio, text and code, and size, dates and location. Quick Look shows the same at full size.
- Optional folder sizes in list view (Settings, or right-click empty space → Show Folder Sizes); sorting by size uses them.
- Quick Look with Space; arrow keys move through files.
- Search: typing filters this folder instantly; press Return (or the chip) to search subfolders too. `*.pdf` style wildcards work.
- Command palette (⌘K / Ctrl+K): every command, every place, every file in the folder.
- Watches the folders on screen and refreshes on its own.

**Do things**
- New folder / new text file, rename (Return on Mac, F2 everywhere, or slow-click), duplicate, compress / extract zip, copy path.
- Batch rename: select several items and press Rename — replace text, add text, number them ("Trip 01", "Trip 02"…) or change case, with a live preview. One Undo puts every name back.
- Drag a box over files to select them (start on empty space, or beside a name in list view; hold ⌘/Ctrl to add or remove).
- Cut / copy / paste, and native drag and drop to and from Finder, Explorer and other apps (hold ⌥/Alt to copy).
- **Open in Terminal** (⌃\`), open in your code editor, Open With…, Show in Finder/Explorer. Pick the terminal (Terminal, iTerm, Warp, Ghostty, Windows Terminal, PowerShell…) and editor in Settings.
- Move to Trash / Recycle Bin. Nothing is ever deleted permanently.
- **Undo (⌘Z / Ctrl+Z)** for moves, renames, copies, new items and Tidy runs — it survives restarts. "Recent changes" in the ⋯ menu undoes any earlier one.

**Tidy** (⌘⇧Y, or the Tidy button)
- Previews where every loose file in the current folder would go, then sorts only what you tick.
- Group by **Kind** (Documents, Spreadsheets, Images, Screenshots, Videos, Screen recordings, Audio, Archives, Installers, Fonts, Design, Code, Receipts & invoices), by **Year**, by **Month** or by **Extension**.
- **Clean up**: exact duplicate copies (the oldest copy stays), installers older than two weeks, unfinished downloads, empty folders, files over 1 GB, and files untouched for a year — each with a tick list and one "Move to Trash".
- Rules (first match wins), rule sets, "always send this file here" corrections, optional on-device content reading (receipts, matching spreadsheet headers), and the optional AI advisor (Assist locally, or OpenAI / Claude with a key used once and never saved). AI only suggests; you review before anything moves.
- Recently changed files can be left alone; unfinished downloads are never moved.

## Look

- Light, dark or match the system, with seven accent colors (Blue, Mint, Teal, Violet, Rose, Amber, Graphite) in Settings.
- **Pure black (OLED)** for dark mode — off by default.

## Keyboard

| | Mac | Windows |
|---|---|---|
| Open | ⌘O / ⌘↓ / double-click | Enter / double-click |
| Rename | Return / F2 | F2 |
| Up a folder | ⌘↑ | Backspace / Alt+↑ |
| Back / forward | ⌘[ / ⌘] | Alt+← / Alt+→ |
| Quick Look | Space | Space |
| Trash | ⌘⌫ | Delete |
| New folder | ⇧⌘N | Ctrl+Shift+N |
| Terminal here | ⌃\` | Ctrl+\` |
| Palette / Find / Go to path | ⌘K / ⌘F / ⌘L | Ctrl+K / Ctrl+F / Ctrl+L |
| Views | ⌘1 ⌘2 ⌘3 | Ctrl+1 2 3 |
| Hidden files | ⇧⌘. | Ctrl+H |
| Tidy | ⇧⌘Y | Ctrl+Shift+Y |

Type a few letters to jump to a file.

## Develop

```bash
npm install
npm start
npm test      # 48 tests: file operations, undo history, Tidy, rules, AI adapters, renderer smoke tests
```

Layout: `main.js` (window, menus, IPC), `preload.js` (the `desk` bridge), `lib/fsops.js` (explorer file operations), `lib/history.js` (one undo history), `lib/launch.js` (terminals, editors, zip), `lib/docpreview.js` + `lib/doc-worker.js` (document previews in a worker thread), `lib/organizer.js` + `lib/rules.js` + `lib/content*.js` + `lib/ai.js` (Tidy), `renderer/` (UI: `app.js` explorer, `docview.js` document previews (pdf.js for PDFs), `extras.js` favorite editor and batch rename, `glyphs.js` favorite icons, `tidy.js` Tidy, `review-model.js` shared plan helpers).

## Privacy and data

Preferences (`prefs.json`), window size, Tidy rule sets (`profiles.json`) and undo history (`history.json`) live in the app-data folder, never in the app or the repo. History stores paths, not file contents. API keys are never written to disk.

## Notes

- macOS asks before an app reads Desktop, Documents and Downloads the first time; allow it, or add Fresh Desk under System Settings → Privacy & Security → Files and Folders. Empty-looking folders with a "can't open" message mean this.
- Moving to another drive copies then removes the original, like Finder.
- Video preview plays formats Chromium supports (MP4/H.264, WebM, most MOV).

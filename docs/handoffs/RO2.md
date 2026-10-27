# RO2: handoff for the RO2 chat

RO2 is the Utility Package's quick design and photo editor (the light sibling of RO3): Canva-style pages with shapes, icons, text and photos, any size or aspect ratio, export to PNG/JPG/WebP/SVG/PDF, and on-device AI (background remover, magic eraser, magic grab, magic expand). It lives in `apps/ro2` inside `~/Downloads/Utility Package`. `README.md` has the feature list, data folders and code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/ro2
npm install
npm start
npm test        # quick checks (no window)
npm run e2e     # drives the real window, screenshots in test/e2e-out (Linux needs xvfb-run)
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note ro2 "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/ro2`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44.7.0 under Xvfb, CPU/WASM only, no GPU). `npm test` runs 9 checks; `npm run e2e` runs 45 checks through the real window with real clicks, drags and typing: shapes, snapping, resizing, colours and gradients, text editing and fonts, groups, lines, icons, photos, filters, frames, crop, align, shadows, undo/redo, backgrounds, layers, the photo library, pages, resize to a story, export to all five formats, save and reopen, and all four AI tools with the real models.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **WebGPU.** AI tools should say "Using the graphics card (WebGPU)" at the bottom of AI tools. If a model fails on the GPU, the worker rebuilds it on the CPU and retries (`ai.worker.js → run()`). LaMa's FFT ops may run partly on the CPU even with WebGPU; that's expected.
  2. **Title bar.** Mac uses `titleBarStyle: hidden` with traffic lights at 16,18 (the bar leaves 86 px on the left); Windows uses `titleBarOverlay` (150 px on the right). Check the design name box, File menu and buttons are clickable (they're `no-drag`).
  3. **HEIC/TIFF.** Converted by `sips` on a Mac and by Windows Imaging (PowerShell + PresentationCore) on Windows (`main.js → convertToJpeg`). Windows needs the HEIF extension for HEIC.
  4. **System fonts** come from `queryLocalFonts()` (permission granted in `main.js`). The font list shows them under "On this computer".
  5. **PDF export** renders each page's SVG in a hidden window and uses `printToPDF` with the CSS page size. Check fonts and gradients look right.
  6. **Photo search** uses Wikimedia Commons first, then Openverse (`main.js → library:search`). Openverse was very slow on test day, so Commons is primary.
  7. **Dropping files** from Finder / Explorer onto the page, the Home screen and a photo frame.

## Rules specific to RO2

- **The page never touches the disk or network.** Everything goes through `window.ro2` (`preload.js`) → `main.js`. AI model files are served at `ro2://models/<id>/<file>`; the app itself at `ro2://app/…` with cross-origin isolation (so WASM can use every core).
- **No runtime npm dependencies.** fabric, onnxruntime-web, Lucide and the fonts are vendored in `src/renderer/vendor` (`node tools/vendor.mjs` refreshes them at the pinned versions). Keep it that way so cross-builds stay simple.
- **Model files are the contract.** `src/models.js` is the catalog (id, file names, exact byte sizes; a model counts as installed only when sizes match). `ai.worker.js` loads them by those names. `npm test` checks both agree.
- **Assets by id.** Picture data lives once in the design's `assets`; objects carry `assetId`. Never put data URLs back into undo snapshots. New object properties that must be saved go in `PROPS` (`editor/fab.js`).
- **Origins are centre.** fabric 7 objects use `originX/Y: 'center'`, so `left/top` is the middle of the object.
- **LaMa outpainting** smears big edge-touching holes, so Magic expand grows a 48 px band at a time with a mirrored strip on the far side (`growSideways`). Change the band sizes in `VARIANTS`, not the approach.
- **Scaling text and rectangles is baked** into font size / width-height on release (`editor._bakeScale`), so corners stay round and text stays crisp.

# RO2

The quick, easy design and photo editor in the Utility Package. RO3 is the heavy photo/video editor; RO2 is the light one: make a post, a thumbnail, a flyer or a quick photo fix in a couple of minutes, with AI tools that run entirely on the computer.

## What it does

- **Home**: start from a size (Instagram post, story, YouTube thumbnail, presentation, A4 flyer…, or any custom size in px, in, cm or mm at 300 DPI), from one of 8 templates, or from a photo. Quick actions go straight to Remove a background, Magic eraser, Magic grab, Make a photo editable or Magic expand. Recent designs with thumbnails; rename, duplicate, show in folder, move to Trash.
- **Themes**: dark, light, or follow the system (sun/moon button in the title bar, or Settings).
- **Editor** (Canva-style): a page on a dark (or light) workspace, zoom and pan (pinch / ⌘-scroll / space-drag), snapping guides to the page and other objects, live size and angle while transforming, multiple pages, undo/redo per page, autosave.
  - **Elements**: 48 shapes (basic, stars & badges, arrows, callouts, organic), lines and arrows with caps and dash styles, 24 photo frames (drop a photo on a frame to fill it), 2,100+ Lucide icons with search, emoji, QR codes (editable: change the link, recolour).
  - **Text**: heading / subheading / body, 10 font pairings, 40 bundled fonts plus every font on the computer, size, colour (solid or gradient), bold, italic, underline, strikethrough, alignment, case, bullets, letter and line spacing, outline, highlight, shadow, curved text (Curve slider, −100 to 100).
  - **Photos**: free photo search (Wikimedia Commons, then Openverse; openly licensed, credits kept with the photo), uploads (JPG, PNG, WebP, GIF, SVG, AVIF, plus HEIC and TIFF converted on the fly), paste from the clipboard, drag and drop from Finder / Explorer.
  - **Photo tools**: crop (free or fixed ratios), shape frames, flip, 15 filters, 10 adjustments (brightness, contrast, saturation, warmth, tint, vibrance, hue, blur, sharpen, grain), set as page background.
  - **Effects**: shadows (presets + colour, blur, distance, direction, strength), borders/outlines, corner rounding, transparency.
  - **Arrange**: layers panel (reorder by drag, hide, lock, rename), align and distribute, group/ungroup, exact position, size and rotation.
  - **Brand**: brand kits with logos (PNG, SVG, JPG, WebP, GIF; drag onto the page), brand colours (also first in every colour picker; "From logo" picks them for you), heading / subheading / body fonts, and "Apply brand to this page" to restyle a design in one click.
  - **Background**: colours, gradients (linear/radial, editable stops), see-through, or a photo.
- **Resize**: change the whole design to any preset or custom size; content scales to fit (or keeps its size); optionally as a resized copy, or as several copies at once (pick many sizes; each becomes its own design on Home).
- **Export**: PNG (optionally transparent), JPG, WebP at 0.5×–4×, vector SVG (fonts embedded) and vector PDF (all pages in one file); one page or all; Copy as PNG.
- **AI tools** (on this computer, nothing uploaded; WebGPU on the graphics card, else every CPU core):
  - **Remove background** (ORMBG; IS-Net "whole scene" as an option) with guided-filter edge refinement, Keep/Remove brushes, click-to-keep/remove objects, new colour or blurred background, sticker outline.
  - **Magic eraser** (LaMa): brush, box or click-to-select an object (SlimSAM), shift-click to add, alt-click to subtract, choose Part / Object / Whole, grow edges & shadows, erase on release. Works without the model too (RO3's PatchMatch quick fill).
  - **Magic grab**: lift the selected object into its own layer and fill the hole behind it.
  - **Make editable**: takes a flat picture (a poster, a thumbnail, an AI image, a photo) apart. Text is read (Tesseract) and becomes real text boxes with a matched font, size, colour and alignment; objects (SlimSAM, auto-segmented) become their own photo layers with refined edges; flat shapes become recolourable vectors; the background behind everything is rebuilt (LaMa). Fix the words, switch pieces on or off and click to add anything missed before building. The original is kept as a hidden layer.
  - **Magic expand**: outpaint a photo to fill the page or 1:1, 4:5, 9:16, 16:9, 3:2 or bigger, band by band; Try again gives a different result.

## Where things are kept

| What | Where |
|---|---|
| Designs | `~/Documents/RO2/*.ro2` (one JSON file per design with its pictures inside; change in Settings) |
| AI models | app-data folder › `Models/<id>/` (ormbg 176 MB, lama 93 MB, slimsam 40 MB, ocr 3 MB, isnet 179 MB optional), downloaded on first use from Hugging Face / GitHub |
| Brand kits | app-data folder › `brand.json`, logos in `Brand/<kit id>/` |
| Settings, recent colours, Home index | app-data folder › `settings.json`, `index.json`; errors go to `ro2.log` |

App-data folder: `~/Library/Application Support/RO2` on a Mac, `%APPDATA%\RO2` on Windows.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/ro2
npm install
npm start
npm test            # quick checks: icons, fonts, model catalog, shapes, imports, designs store, brand kits
npm run e2e         # drives the real window and saves ~60 screenshots to test/e2e-out (Linux: needs xvfb-run)
```

`RO2_MODELS=/path/to/models npm run e2e` also runs the AI checks. `RO2_USER_DATA`, `RO2_DESIGNS` and `RO2_MODELS` point the app at other folders; `RO2_DEVTOOLS=1` opens DevTools.

## Code map

```
src/main.js            window, ro2:// protocol (pages + model files, cross-origin isolated), menus, IPC: designs,
                       files (HEIC/TIFF via sips / WIC), export (PDF via printToPDF), photo search, models
src/models.js          the AI model catalog and the resumable downloader
src/designs.js         .ro2 files and the Home index
src/brand.js           brand kits (brand.json + logo files), served at ro2://brand/
src/preload.js         window.ro2: the only bridge to the computer
src/renderer/
  index.html, styles.css
  js/main.js           boot, title bar, keyboard, drag & drop, paste, pages strip, zoom
  js/app.js            shared state; open/save; add images; run the AI studio and apply its result
  js/home.js           Home
  js/drawer.js         left rail + panel drawer
  js/ctxbar.js         the context bar, floating toolbar, right-click menu
  js/editor/           editor.js (canvas, pages, assets, history, snapping, zoom), fab.js (fabric setup,
                       handles, the Line object), shapes.js, objects.js, render.js (export/thumbnails), crop.js
  js/panels/           elements, text, photos (+uploads), background, ai, layers (+templates), props
                       (position, effects, curve), image (frames, filters), color (picker), brand
  js/modals/           new, resize, export, settings
  js/ai/               ai.worker.js (onnxruntime-web: removebg, SAM, LaMa inpaint/expand), client.js
                       (worker RPC, model download prompt), studio.js (the AI focus mode), patch.worker.js,
                       layerize.js (Make editable: OCR + auto-segment + build), layers-studio.js (its screen)
  js/templates.js, js/sizes.js, js/fonts.js, js/ui.js
  vendor/              fabric 7.4.0, onnxruntime-web 1.30.0, lucide-static 1.49.0, 40 fonts,
                       tesseract.js 7.0.0, qrcode-generator 2.0.4 (refresh: node tools/vendor.mjs)
build/make-icon.py     draws build/icon.svg + icon.png (and the title-bar mark)
```

## Notes

- No runtime npm dependencies and no native modules: everything the page needs is in `src/renderer/vendor`, so Windows cross-builds need nothing special.
- Images live once per design in `assets` (by id); objects point at them with `assetId`, which keeps undo snapshots small.
- Licenses: fabric.js MIT, ONNX Runtime MIT, Lucide ISC, tesseract.js Apache-2.0, qrcode-generator MIT, fonts SIL OFL 1.1 (in `vendor/fonts/licenses`), models Apache-2.0. Free photos carry their own CC licenses; RO2 keeps each photo's credit.

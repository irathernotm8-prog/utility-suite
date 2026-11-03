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

## What 0.4.0 added: AI design, HTML layers and video

- **HTML layers** (`js/html-layer.js`, `src/html.js`). A layer is a page of HTML/CSS/JS laid out at its own CSS size (usually the whole design), kept in `o.ro2Html = { html, w, h, animated, duration, poster, durationSet }` and shown on the canvas as a picture of one moment (the poster; for animations, the last frame). Main renders it in hidden, sandboxed `BrowserWindow`s on the `ro2-html` session (GET-only network, no navigation, no pop-ups), served at `ro2://html/<sha1>.html?mode=live|frame`. In frame mode a shim puts the page on RO2's clock: `performance.now`, `Date`, `requestAnimationFrame`, timers, CSS / Web Animations (paused and seeked) and `<video>` all follow `window.__ro2.seek(ms)`, so capture is exact and smooth at any fps. `data-duration="6"` on `<html>` sets the length; otherwise it's worked out from the animations (5 s for open-ended ones). Exports above 1× re-render HTML layers sharp (`sharpenHtml`). Edit in the HTML editor (double-click; `modals/html-editor.js`, plays live in a sandboxed iframe). **Make editable** for HTML (`js/html-to-layers.js` + `html.toLayers`) reads the laid-out DOM: text boxes keep font, size, colour, spacing and alignment; solid boxes become rounded rectangles; `<img>`/inline SVG become pictures/vectors; the rest is captured as one background picture with those elements hidden.
- Hidden HTML windows are **offscreen** (`offscreen: true`, then `setContentSize`, because new windows are clamped to the screen), so pages bigger than the screen (a story at 2×) render whole; `shot()` waits for a fresh paint before `capturePage`. The clock shim pauses CSS animations as soon as they appear (at load, and at each 1/60 s step of a seek), so one seek to any time is exact. `toLayers` must never wait on a page timer (they're frozen in frame mode).
- **Video** (`src/video.js`, `src/engine/`). The engine is **copied from RO3** (`ffmpeg.js`, `media.js`, `formats.js`, `timeline.js`, `color-grade.js`; each says "Shared with RO3" at the top). Change it in RO3 first, then copy it here; RO2-only changes (cache folder names, the stubbed image converter) are marked. Each page is a scene: still runs between moving layers are flattened to PNGs in the window (`video-export.js → pageLayers`), animated HTML is recorded frame by frame into QuickTime Animation (alpha) and video clips are trimmed, then FFmpeg overlays them (`composeScene`) into a scene MP4 and RO3's `renderProject` joins the scenes with xfade transitions and the music. **The engine keeps a transition on the clip it leaves**, so page *k*'s "transition in" is set on clip *k−1*. A see-through WebM (one page) goes straight from `composeScene` as VP9 `yuva420p`. GIF uses the engine's palette path. ffmpeg-static / ffprobe-static are the only runtime npm dependencies (unpacked from the asar); `utility publish` already installs the right FFmpeg for Windows cross-builds, as for RO3.
- **Lite timeline** (`js/timeline.js`, button left of the zoom bar): page blocks you drag to change duration, a transition chip between pages (20 transitions), fps, Preview (a 640 px quick render played in a modal), Export video, and one music track (volume, fade out). Stored as `page.duration`, `page.transition {type, duration}`, `doc.timeline {fps, music}`. Video clips are layers (`o.ro2Video`, `js/video-layer.js`): poster frame on the canvas, Trim / Sound in the bar; files are copied into `<designs>/Media` and served at `ro2://media/?f=` (Media, the work folder and previews only). "Open in RO3" after an export, for heavier editing.
- **AI design** (rail tab "AI design", `panels/assistant.js`): chat with Claude, GPT, Gemini, OpenRouter, xAI, Mistral, DeepSeek, Groq, Ollama, LM Studio or any OpenAI-compatible API (`src/llm.js`, keys encrypted with `safeStorage`), or route through the Claude Code / Codex CLIs on the computer (`src/ai.js`). Connect buttons install RO2 as an MCP plugin in **Claude Desktop** (every config copy, MSIX included), **Claude Code** (`claude mcp add` or `~/.claude.json`) and **Codex** (`~/.codex/config.toml`) (`src/connectors.js`, copied from Atrium). `mcp/ro2-mcp.js` is the stdio server; it reaches the running app over a local bridge (127.0.0.1, token in app-data `bridge.json`) and starts RO2 if needed.
- **Tools** (`mcp/tools.js`, 31; the same list for every AI) run **in the window** (`js/agent.js`): main forwards `agent:call`, the window answers `agent:reply` with MCP content (text + JPEG screenshots), one call at a time. Coordinates are design px, x/y = top-left. `ro2_guide` is written in main (`mcp/guide.js`) with the window's fonts, shapes and brand kit. Mutating calls show a pill at the top ("Claude is building a page in HTML"). Exports from an AI go to Downloads (or the folder it names), never over a file.
- Tests: `npm test` checks every tool has a handler, the guide, the engine and the build config. `E2E=test/e2e-ai.js E2E_OUT=test/e2e-ai-out npm run e2e` drives the **real MCP server over stdio** through the bridge: HTML layers (still and animated, screenshots at times, contact sheet, find/replace), HTML → layers, text/shape/icon/picture/grade, a video clip, timeline + music, PNG/MP4/GIF/see-through WebM exports (checked with ffprobe and frame differences), and the in-app assistant against a stand-in OpenAI-compatible server.

## What 0.3.0 added

- **Touch up** (studio mode `touchup` in `ai/studio.js`): Paint / Heal / Pick / Erase / Restore / Move view, with size, softness, opacity. A stroke is stamped at full strength into its own layer (`strokeLayer` → `applyStroke`) and merged on release, so opacity doesn't build up. Alt (Option) is the colour picker. Heal reuses the eraser path (`eraseNow`). Shortcuts B, J, E, R, H.
- **Colour grade** (`js/grade.js` + studio mode `grade`): looks are plain functions on 0..1 RGB; hue shift rotates a*/b* in Lab; palette swap moves each picture colour toward its new one in Lab with Gaussian weights; all of it is baked into a 33³ LUT (`gradeData`) so full-size pictures apply quickly. The photo keeps its ungraded original in `ro2GradeSrc` (an asset id, kept by `toFile` and copy/paste) and the settings in `ro2Grade`; reopening starts from the original, and "Reset all" + Apply restores it. "Apply to everything on this page" (`app.js → applyGrade`) regrades other photos from their own originals and passes shape, text, stroke, shadow and page-background colours through `gradeHex`.
- **Text reader is now PP-OCRv6** (model `ocrpro`: `det.onnx`, `rec.onnx`, `rec.yml` with the dictionary). `ai.worker.js → ocrPro` does DB detection (components → convex hull → minimum-area rectangle → unclip), straightened 48-px crops, CTC decoding with per-character positions. `layerize.js → readPro` turns lines into runs; `respace` puts back spaces that letter-spaced type loses (from empty ink columns); tilted lines (≥2.5°) go through `tiltedText`, which refines the angle from the ink and matches the font on a straightened mask; the text box gets that angle. Tesseract (`ocr`, now optional) is the fallback.
- **Magic grab** edges: the piece's alpha is guided-filtered against the picture on a slightly padded crop.

## What 0.2.0 added

- **Make editable** (AI tools, the photo's Edit menu, and a Home card): takes a flat picture apart. `ai/layerize.js` does the work, `ai/layers-studio.js` is its screen, `app.js → applyLayers` puts the result on the page.
  1. *Text*: tesseract.js reads the picture three times (as is; inverted grey in sparse mode for light-on-dark and spaced-out type; 40 % size for huge display type). Lines are split where words jump apart or change size, duplicates merged keeping the tighter box, then each line's ink band is found (an underline swept into the box is dropped). Fonts are matched by **rendering ~27 bundled faces and comparing the glyph shapes** (IoU at 36 px tall, with each font's letter spacing fitted first). After placing, `fitInk` renders the text box and nudges size, line height and spacing until its letters cover the same area as the original's.
  2. *Objects*: SlimSAM decoded on a 10×10 grid (`samAuto` in the worker), filtered, pieces of a word joined (`mergeRow`). Big flat regions touching the frame count as background. Flat pieces become vectors traced at full resolution from their own colour (rect, rounded rect with radius, ellipse, or a smoothed path); gradients and textured pieces become photo layers with guided-filter edges.
  3. *Photos* (detected by fine texture): if the background remover is installed its matte becomes one **Subject** layer and SAM pieces outside it are listed but switched off.
  4. *Background*: holes (text ink + objects) are grouped into parts and filled by LaMa one by one; `colourMatch` in the worker removes LaMa's colour shift at the seam (this also improves the Magic eraser).
  Dev loop: `RO2_MODELS=… test/lz.sh` (driver `test/layerize-dev.js`, `LZ_TPL=0,2,p` picks templates or the photo) saves source / studio / result / page / rebuilt-background shots in `test/layerize-out`.
- **Light theme** (Dark / Light / System in Settings, sun/moon in the title bar). Colours are CSS variables; `editor.applyTheme()` reads the workspace colours from them; `main.js app:theme` updates the native title bar.
- **Brand kits** (`src/brand.js`, rail tab "Brand"): logos stored under app-data `Brand/<kit>/`, colours (also first in every colour picker), heading / subheading / body fonts, "Apply brand to this page".
- **QR codes** (Elements → QR code; editable link via "Edit QR" in the bar), **curved text** (Curve slider; `Ro2CurvedText` in `editor/fab.js`), **several resized copies at once** (Resize → "Make resized copies").

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
- **Only FFmpeg comes from npm** (`ffmpeg-static`, `ffprobe-static`, as in RO3). fabric, onnxruntime-web, Lucide and the fonts are vendored in `src/renderer/vendor` (`node tools/vendor.mjs` refreshes them at the pinned versions). No native modules.
- **HTML runs sandboxed.** Never give the `ro2-html` session or its windows node, preload, file access or POST; keep `agent.js` the only place AI tools touch the design.
- **Model files are the contract.** `src/models.js` is the catalog (id, file names, exact byte sizes; a model counts as installed only when sizes match). `ai.worker.js` loads them by those names. `npm test` checks both agree.
- **Assets by id.** Picture data lives once in the design's `assets`; objects carry `assetId`. Never put data URLs back into undo snapshots. New object properties that must be saved go in `PROPS` (`editor/fab.js`).
- **Origins are centre.** fabric 7 objects use `originX/Y: 'center'`, so `left/top` is the middle of the object.
- **LaMa outpainting** smears big edge-touching holes, so Magic expand grows a 48 px band at a time with a mirrored strip on the far side (`growSideways`). Change the band sizes in `VARIANTS`, not the approach.
- **Make editable tuning** lives in `layerize.js`: the font list (`CANDIDATES`), OCR passes in `analyze`, object filters in `classify`. Check changes with `test/lz.sh` on several templates and the photo, and look at the `-bgfull` shots, not just the counts.
- **Scaling text and rectangles is baked** into font size / width-height on release (`editor._bakeScale`), so corners stay round and text stays crisp.

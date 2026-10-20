# RO3 — Rule of 3s

A personal photo editor, video editor and file converter for Mac and Windows.
Everything runs locally; nothing is uploaded anywhere.

## Run it

1. Install **Node.js 20 or newer** (LTS) from nodejs.org.
2. Open a terminal in this folder and run:

   ```
   npm install
   npm start
   ```

   `npm install` downloads Electron, FFmpeg and the image libraries for your machine (about 250 MB, one time).

## Shipping an update

RO3 lives in the Utility Package at `apps/ro3`. To ship a change: bump `version` in `package.json`, run `./utility note ro3 "what changed"` from the Utility Package folder, then `./utility publish`. Every computer's Utility Hub picks the update up from there.

## Build an installable app (for a friend)

> **Important:** always run `npm install` on the same computer you build on. Don't copy `node_modules` between a Mac and a PC, because each one downloads engine files made for its own system.

| Platform | Command | Output in `dist/` |
| --- | --- | --- |
| macOS | `npm run dist:mac` | `RO3-1.3.0-arm64.dmg` (drag to Applications) |
| Windows | `npm run dist:win` | `RO3 Setup 1.3.0.exe` installer + portable `RO3 1.3.0.exe` |

`./utility build ro3` in the Utility Package does the same for both platforms.

The app isn't code-signed, which is fine for personal use:

- **macOS:** the first time, right-click RO3 in Applications → Open → Open. If macOS still blocks it, run `xattr -cr /Applications/RO3.app`.
- **Windows:** if SmartScreen appears, click *More info* → *Run anyway*.

## What's inside

**New in 1.3 — Photo**
- **Filter galleries**, all with a live on-canvas preview (big images preview at reduced size and render full size on Apply), heavy maths running in the background:
  - *Blur:* Gaussian, Box, Motion, Radial (spin/zoom, click to place the centre), Tilt-Shift, Iris, Surface.
  - *Sharpen:* Unsharp Mask, Smart Sharpen, High Pass.
  - *Noise:* Add Noise (uniform/Gaussian, mono), Median, Reduce Noise, Dust & Scratches.
  - *Distort:* Twirl, Wave, Ripple, Zigzag, Spherize/Pinch, Polar Coordinates, Shear, Lens Correction (distortion, vignette, fringing).
  - *Stylize & Pixelate:* Oil Paint, Emboss, Find Edges, Glowing Edges, Wind, Solarize, Diffuse, Mosaic, Crystallize, Color Halftone.
  - *Render:* Clouds, Difference Clouds, Fibers, Lens Flare. *Other:* Maximum, Minimum, Offset, Color to Alpha.
  - Filter › Last Filter (Ctrl/Cmd+Alt+F) repeats the last one; the Filters panel has a search box.
- **Image › Adjustments:** Auto Contrast, Auto Color, Equalize, Desaturate, Shadows/Highlights (Photoshop-style, radius-based), Replace Color (click to pick), Neutralize Color Cast.
- **New adjustment layers:** Channel Mixer, Selective Color (CMYK per colour range, relative/absolute), **Color Lookup** (load .cube / .3dl LUTs; saved inside .ro3 projects) and **Color Grade** — a Lumetri-style panel (white balance, exposure, contrast, highlights/shadows/whites/blacks, vibrance, saturation, 11 creative looks, faded film, three-way colour wheels, RGB curves). The same grade engine powers the Video tab.
- **11 more blend modes:** Linear Burn, Linear Dodge (Add), Vivid Light, Linear Light, Pin Light, Hard Mix, Subtract, Divide, Darker Color, Lighter Color, Dissolve — all saved to and read from PSD.
- **Layer styles:** Inner Shadow, Inner Glow, Satin, Gradient Overlay and Bevel & Emboss join Drop Shadow, Outer Glow, Stroke and Color Overlay; copy, paste and clear styles (Layer › Layer Style Clipboard). All round-trip through PSD.
- **Retouching tools:** Healing Brush (Alt-click a source; it blends seamlessly), Patch, Content-Aware Move (move or extend), Red Eye, History Brush (paint back any history state), Sharpen brush, Color Replacement, Pencil.
- **Erasers:** Background Eraser (sample continuously or once, contiguous or not, protect foreground) and Magic Eraser.
- **Measure & crop:** Color Sampler (up to four pinned readouts), Ruler with **Straighten**, and **Perspective Crop**.
- **Shapes:** Triangle, Polygon and Star (sides / inner radius).
- **Pen pressure** for Brush and Eraser (size, opacity or both) on drawing tablets.
- **Info panel:** live histogram (RGB, luminosity or per channel) with mean, standard deviation, median and clipping, plus sampler readouts.
- **Command palette (Ctrl/Cmd+K):** search every menu command, tool and filter.
- **OpenRaster (.ora)** open and export — the layered format shared by Krita, GIMP and MyPaint.

**Photo**
- **Quick Selection (W):** paint over an object and the selection grows out to its edges. Shift adds, Alt subtracts. **Select and Mask** (Ctrl/Cmd+Alt+R) then refines the edge with smooth, feather, contrast and shift-edge controls and a live red overlay or black/white view. It can output a selection, a layer mask, a new layer, or a new layer with a mask.
- **Content-Aware Fill (Shift+Backspace)** and a content-aware **spot healing brush**: remove objects and blemishes. RO3 rebuilds the area from matching texture and structure around it.
- **Alt/Option = eyedropper:** while using the brush, fill, gradient, shape or text tool, hold Alt and click to pick a colour. A ring shows the new and old colours. **Brush resize gesture:** Alt+right-drag (Windows) or Ctrl+Option+drag (Mac). The **Color** panel has swatches and recent colours.
- **Polygonal lasso** (Shift+L) and **Pen tool** (P). The Pen draws paths: click for corners, drag for curves. A path can become a selection, or be filled or stroked onto its own layer.
- **Layer groups** (Ctrl/Cmd+G, ungroup Ctrl/Cmd+Shift+G): groups collapse, hide, have their own opacity and blend mode (including Pass Through), and move as one. Groups round-trip to Photoshop as folders.
- **Multi-select layers** (Shift- or Ctrl/Cmd-click) to move, merge, delete, **align** and **distribute** them. **Smart guides** (pink) snap to other layers' edges and centres while moving.
- **Distort, Perspective and Skew** in Transform: pick the mode or Ctrl/Cmd-drag a corner.
- **Liquify** (Ctrl/Cmd+Shift+X): push, bloat, pucker, twirl and reconstruct.
- **Text:** tracking, line height, all caps and underline.
- **Photoshop files:** open `.psd` with its layers, groups, masks, blend modes, clipping masks, adjustment layers and basic layer styles intact. Save or export back to a layered `.psd` that opens editable in Photoshop.
- **Adjustment layers (non-destructive):** Brightness/Contrast, Levels (with histogram and Auto), Curves (draggable points per channel, plus presets), Exposure, Vibrance, Hue/Saturation (with Colorize), Color Balance, Black & White, Photo Filter, Gradient Map, Invert, Posterize and Threshold. Each one has a mask you paint on, and you can tweak it at any time.
- **Layer styles:** drop shadow, outer glow, outside stroke and color overlay, live while you edit them. Rasterize a style to bake it into the pixels.
- **Clipping masks** (Ctrl/Cmd+Alt+G) and **layer locking** (Ctrl/Cmd+/).
- **Retouching:** spot healing brush (paint over a blemish and RO3 fills it from matching texture nearby), smudge, dodge, burn and sponge.
- **Select menu:** Color Range, Layer Pixels (Ctrl/Cmd-click a thumbnail), Reselect, and Modify › Expand / Contract / Feather / Border / Smooth. Save a selection as a mask, crop to a selection, or trim transparent edges.
- **Rulers and guides** (Ctrl/Cmd+R): drag guides out of the rulers. Moving and transforming snap to them, and dragging a guide back onto a ruler removes it. The ruler corner adds a guide at an exact position.
- **Full menu bar:** File, Edit, Image, Layer, Select, Filter and View menus, with Photoshop-style shortcuts.
- Related tools share one toolbar slot. Right-click or press-and-hold a slot to switch between them.
- Layers with opacity, 16 blend modes, reorder by drag, merge down, merge visible, flatten.
- **Transform (Ctrl/Cmd+T):** drag corners to scale (proportional by default, Shift for free, Alt from the center), drag outside the box to rotate (Shift snaps to 15°), and use flip and exact W/H/angle values. With a selection active, only the selected pixels are lifted and transformed.
- **Snapping:** moving and transforming snap to the canvas edges, center and the rule-of-thirds lines. Toggle it with the magnet in the status bar, or hold Ctrl/Cmd while dragging.
- **Move:** dragging inside a selection moves just those pixels. Alt-drag duplicates the layer as you move it.
- **Copy and paste:** pasting always creates a new layer. Copied pixels paste back in the same spot, and images from other apps paste centered. Copy merged (Ctrl/Cmd+Shift+C) copies everything visible. Paste as new image (Ctrl/Cmd+Shift+V) opens the clipboard as its own document.
- Selections: rectangle, ellipse, lasso, magic wand and **selection brush**, which paints a selection and Alt-paints to subtract. Each supports new, add, subtract and intersect modes, plus feather. You can also select all, invert, or copy a selection to a new layer.
- Layer masks: create one from a selection, then paint black to hide and white to reveal. Masks can be inverted, applied or disabled.
- Brush, eraser, blur brush, fill bucket, eyedropper and editable text layers.
- **Clone stamp:** Alt/Option-click a source, then paint to copy it. With Aligned on, the offset stays the same between strokes.
- **Gradient:** linear or radial, foreground to background or foreground to transparent. On a mask it makes a smooth fade.
- **Shapes:** rectangle with rounded corners, ellipse, line and arrow, each on its own layer.
- Colour adjustments with a live preview: exposure, contrast, highlights, shadows, saturation, hue, temperature and tint. They apply to the active layer, inside the selection if there is one.
- Filters: Gaussian blur, sharpen, auto tone, vignette, black & white, sepia, invert, posterize, pixelate and noise.
- Frames: border, rounded, polaroid, double line, film strip and mat. Each frame goes on its own layer, and the canvas can grow to fit it.
- Crop with aspect presets and a rule-of-thirds overlay. Rotate, flip, resize image and canvas size.
- Up to 40 undo steps, with a clickable History list.
- Export to PNG, JPG, WebP, AVIF, TIFF, GIF, BMP, ICO, PDF or **SVG**. SVG export traces the raster image into vector shapes in colour, black & white or posterized style, with a live preview.
- Save (Ctrl/Cmd+S saves straight back to the same file) and reopen layered work as `.ro3` projects.

**New in 1.3 — Video**
- **Color grade per clip** (and per overlay): the Lumetri-style panel — white balance, exposure, tone, vibrance/saturation, looks, colour wheels, curves, **.cube/.3dl LUTs**, vignette and sharpening. The viewer shows the exact grade (GPU, with a CPU fallback) and export bakes the same maths into a 3D LUT, so what you see is what you get. "Copy grade to all clips" matches a sequence in one click.
- **Video scopes:** waveform, RGB parade, vectorscope (with skin-tone line) and histogram. **Audio meters** with peak hold.
- **Keyframes** for overlays and titles: position, size, opacity and rotation with linear, ease, ease-in/out and hold curves; dragging an animated overlay keys it at the playhead.
- **Green / blue screen keying** for overlays (tolerance, edge softness, spill suppression), previewed live.
- **Effects:** blur, sharpen, denoise, film grain, glow, RGB split, echo/trails, choppy frame rate, find edges, **stabilize**, **reverse**, crop, Fit/Fill framing and **Ken Burns** pan & zoom.
- **Audio effects** on clips, overlays and music: Enhance Speech, presets (podcast, telephone, radio, music), 3-band EQ, high/low-pass, noise reduction, hum removal (50/60 Hz), de-ess, compressor, limiter, reverb, pitch shift and gain. EQ, filters and compressor preview live.
- **Mixer & auto-ducking:** levels for the main track, overlays and music, and music that dips automatically under dialogue. Audio crossfades can be constant power, constant gain or exponential.
- **58 transitions** in groups (dissolves, wipes and diagonals, push/slide-over/reveal, smooth and wind, iris and barn doors, slices and squeeze, stylized).
- **Captions track:** add (C), edit, drag and trim captions; import and save **SRT/VTT**; one caption style for all; burn them in on export or save a sidecar .srt.
- **Named markers → chapters:** double-click a marker to name it; Copy YouTube chapters, or embed chapters in MP4/MOV/MKV on export.
- **Editing:** slip (Alt-drag a clip), roll (Alt-drag an edge), rate stretch (Shift-drag the right edge), copy/paste clips, **paste effects** (Ctrl/Cmd+Alt+V), freeze frame (Shift+F).
- **Export presets:** YouTube 1080p/4K, TikTok · Reels · Shorts (9:16), Instagram 4:5 and 1:1, Vimeo, ProRes 422 HQ/LT, **DNxHR HQ**, H.265, **PNG sequence**, GIF and podcast MP3; loudness targets −14/−16/−23 LUFS; **23.976, 29.97 and 59.94 fps**.
- **Hand-off to other editors:** export the timeline as **FCPXML** (Final Cut Pro, DaVinci Resolve), **CMX 3600 EDL** or **OpenTimelineIO** (Timeline › Export Timeline).

**Video**
- Import video, audio and images; MKV/AVI/WMV etc. get an automatic preview copy so they play in the viewer (export always uses the originals).
- **Overlay track:** picture-in-picture video, logos and still images. Drag them in the viewer to place them (they snap to the thirds), and set size, opacity and fades. Overlapping overlays stack into lanes.
- **Titles:** lower third, centered title, caption and headline presets. You can edit the text, font, weight, color, background box, accent bar and shadow, and titles scale with the export resolution.
- **Per-clip effects:** speed from 0.25× to 8× (audio pitch is kept), brightness, contrast, saturation, hue, warmth, rotate 90°, flip, and fade in/out.
- **Markers** (M), **J/K/L shuttle** (tap L or J again for 2×/4×/8×), and **snapping** (N) to cuts, markers and the playhead.
- One main video track plus a music lane: drag to reorder, drag clip edges to trim, split at the playhead (S), duplicate, delete.
- 20 transitions (crossfade, dip to black, wipes, slides, circle, pixelize, zoom…), fade in/out from black, per-clip volume and mute, music fades.
- Render preview (fast 480p) shows transitions exactly. Export renders MP4, MKV, MOV, WebM, AVI, M4V, animated GIF, or audio only (MP3/WAV/M4A). Choose **H.264, H.265/HEVC or ProRes 422 HQ**, and optionally **normalize loudness** to −14 LUFS for social media.
- Save/open `.ro3v` projects. If a source file has moved, RO3 tells you which one.

**Reliability**
- **Autosave and crash recovery:** if RO3 closes unexpectedly, the next launch offers to recover the open image and video edit.
- RO3 asks before quitting with unsaved work, and saves are written safely, so a crash mid-save can't corrupt the file.
- File › Open Recent, double-click opening of `.ro3` / `.ro3v` files, and a single app window (opening a second file reuses it).
- Errors appear as a short message instead of failing silently.

**Quick Convert**
- Drop any mix of files, choose a format per file, convert in batch.
- Images ↔ any image format, including SVG trace and PSD (flattened); video ↔ any video format, video → GIF, video → audio, audio ↔ audio.
- *Copy streams when possible* makes MKV → MP4 (and similar) near-instant and lossless.
- Originals are never touched; outputs never overwrite (a `(1)` is added instead).

## Handy shortcuts

| | Photo | Video |
| --- | --- | --- |
| Tools | V move, Ctrl/Cmd+T transform, M rect, Shift+M ellipse, L lasso, Shift+L polygonal lasso, Q selection brush, W quick selection, Shift+W wand, P pen, Ctrl/Cmd+Shift+X liquify, C crop, Shift+C perspective crop, B brush, Shift+B pencil, Alt+B color replacement, E eraser, Shift+E background eraser, Alt+E magic eraser, J spot heal, Shift+J healing brush, Alt+J patch, S clone, Y history brush, R blur, Alt+R sharpen, Shift+R smudge, Shift+I color sampler, Alt+I ruler, O dodge, Shift+O burn, Alt+O sponge, Shift+G gradient, G fill, U shapes, T text, I eyedropper, H hand, Z zoom | T title, C caption, M marker, N snapping, J/K/L shuttle, Shift+F freeze frame, Ctrl/Cmd+C/V copy/paste clip, Ctrl/Cmd+Alt+V paste effects |
| Selection | Ctrl/Cmd+A all, Ctrl/Cmd+D deselect, Ctrl/Cmd+Shift+D reselect, Ctrl/Cmd+Shift+I invert, Ctrl/Cmd+Alt+R select and mask, Shift+F6 feather, Delete clears inside it, Shift+Delete content-aware fill | — |
| Layers | Ctrl/Cmd+E merge down, Ctrl/Cmd+Shift+E merge visible, Ctrl/Cmd+G group, Ctrl/Cmd+Shift+G ungroup, Ctrl/Cmd+Alt+G clipping mask, Ctrl/Cmd+/ lock, Ctrl/Cmd+I invert, Ctrl/Cmd+R rulers, Ctrl/Cmd+; guides | — |
| Clipboard | Ctrl/Cmd+C copy, X cut, V paste as new layer, Shift+C copy merged, Shift+V paste as new image | — |
| Transform | Enter apply, Esc cancel, arrows nudge | — |
| Editing | [ ] brush size, X swap colours, Ctrl/Cmd+J duplicate layer, ' thirds grid, Space+drag pan, Ctrl/Cmd+scroll zoom | Space play, S split, Delete remove, ←/→ frame step, Shift+←/→ 1 s, +/− timeline zoom |
| Everywhere | Ctrl/Cmd+K command palette, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (Mac) / Ctrl+Y (Win) redo, Ctrl/Cmd+S save, Ctrl/Cmd+Shift+S save as, Ctrl/Cmd+Alt+E export, Ctrl/Cmd+1/2/3 switch tabs | |

## Known limits

- HEIC/HEIF photos can't be opened (the bundled codecs don't include them). Convert them to JPG on your phone or Mac first.
- Vector tracing is great for logos, icons and flat art. Photos turn into stylised posters, which is a limit of tracing itself.
- Very large photos (over about 100 megapixels) will be slow in the editor.
- PSD: smart objects and text layers open as pixels. Groups nested inside groups are merged into their outer group. Color Lookup and Color Grade layers are flattened into pixels in the PSD (Photoshop can't store them).
- Timeline exports (FCPXML/EDL/OTIO) carry cuts, timing, speed, transitions, overlays, music and markers; titles, effects and grades stay in RO3.
- Playback in the viewer shows transitions as crossfades. Colour grades, LUTs, keying, Ken Burns, crop and blur preview exactly; grain, glow, RGB split, echo, stabilize, noise reduction, reverb and pitch appear in Render preview and Export.
- Keyframes are for overlays and titles; main-track clips animate with Ken Burns.
- RO3 has no AI features such as Select Subject, Generative Fill or auto-captions, and no 3D. Content-aware fill is pattern-based (the same family of technique Photoshop's original version used), so it is excellent on texture, sky, grass and walls and weaker at inventing complex objects.
- Liquify works on the layer's pixels; it doesn't warp the layer's mask.

## Project layout

```
main.js          window, menus, file dialogs, job runner
preload.js       safe bridge between UI and engine
engine/          conversion engine (FFmpeg, sharp, SVG/PSD, timeline renderer with overlays and titles)
src/             the interface — index.html, styles.css, js/ (photo, video, convert)
  js/photo-compose.js   layer compositor (masks, styles, clipping, adjustment layers)
  js/photo-adjust.js    adjustment maths and the Levels/Curves editors
  js/photo-psd.js       Photoshop import/export
  js/photo-filters.js   filter galleries (runs in js/filter-worker.js)
  js/color-grade.js     shared colour-grade / LUT engine (photo, video preview and export)
  js/glview.js          WebGL viewer layer for graded / keyed video
  vendor/ag-psd.js      PSD library (MIT)
engine/interchange.js  FCPXML, EDL and OpenTimelineIO export
engine/captions.js     SRT / VTT / chapters
engine/ora.js          OpenRaster read/write
scripts/         install and build checks
test/            npm run test:engine — converts sample media in every format, renders timelines
```

## Troubleshooting

**"Could not load the sharp module using the win32-x64 runtime"** (or darwin-arm64 / darwin-x64)
The image engine's files for your computer weren't installed. In the RO3 folder:

```
rmdir /s /q node_modules dist        (Mac: rm -rf node_modules dist)
del package-lock.json                (Mac: rm package-lock.json)
npm install
npm run check
npm run dist:win                     (Mac: npm run dist:mac)
```

`npm run check` should print `✔ RO3 dependencies OK`. The build checks this again and stops with a clear message, so it can no longer produce an installer that's missing the engine. Then run the new installer; it replaces the old copy.

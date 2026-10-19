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

## Build an installable app

> **Important:** always run `npm install` on the same computer you build on. Don't copy `node_modules` or `package-lock.json` between a Mac and a PC, because each one downloads engine files made for its own system.


Build on the computer you want the app for — a Mac build has to be made on a Mac, and a Windows build on Windows.

| Platform | Command | Output in `dist/` |
| --- | --- | --- |
| macOS | `npm run dist:mac` | `RO3-1.2.0-arm64.dmg` (drag to Applications) |
| Windows | `npm run dist:win` | `RO3 Setup 1.2.0.exe` installer + portable `RO3 1.2.0.exe` |

If you use the Utility Package, `./utility port ro3` then `./utility suite` does all of this for you.

The app isn't code-signed, which is fine for personal use:

- **macOS:** the first time, right-click RO3 in Applications → Open → Open. If macOS still blocks it, run `xattr -cr /Applications/RO3.app`.
- **Windows:** if SmartScreen appears, click *More info* → *Run anyway*.

## What's inside

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
| Tools | V move, Ctrl/Cmd+T transform, M rect, Shift+M ellipse, L lasso, Shift+L polygonal lasso, Q selection brush, W quick selection, Shift+W wand, P pen, Ctrl/Cmd+Shift+X liquify, C crop, B brush, E eraser, J spot heal, S clone, R blur, Shift+R smudge, O dodge, Shift+O burn, Alt+O sponge, Shift+G gradient, G fill, U shapes, T text, I eyedropper, H hand, Z zoom | T title, M marker, N snapping, J/K/L shuttle |
| Selection | Ctrl/Cmd+A all, Ctrl/Cmd+D deselect, Ctrl/Cmd+Shift+D reselect, Ctrl/Cmd+Shift+I invert, Ctrl/Cmd+Alt+R select and mask, Shift+F6 feather, Delete clears inside it, Shift+Delete content-aware fill | — |
| Layers | Ctrl/Cmd+E merge down, Ctrl/Cmd+Shift+E merge visible, Ctrl/Cmd+G group, Ctrl/Cmd+Shift+G ungroup, Ctrl/Cmd+Alt+G clipping mask, Ctrl/Cmd+/ lock, Ctrl/Cmd+I invert, Ctrl/Cmd+R rulers, Ctrl/Cmd+; guides | — |
| Clipboard | Ctrl/Cmd+C copy, X cut, V paste as new layer, Shift+C copy merged, Shift+V paste as new image | — |
| Transform | Enter apply, Esc cancel, arrows nudge | — |
| Editing | [ ] brush size, X swap colours, Ctrl/Cmd+J duplicate layer, ' thirds grid, Space+drag pan, Ctrl/Cmd+scroll zoom | Space play, S split, Delete remove, ←/→ frame step, Shift+←/→ 1 s, +/− timeline zoom |
| Everywhere | Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (Mac) / Ctrl+Y (Win) redo, Ctrl/Cmd+S save, Ctrl/Cmd+Shift+S save as, Ctrl/Cmd+Alt+E export, Ctrl/Cmd+1/2/3 switch tabs | |

## Known limits

- HEIC/HEIF photos can't be opened (the bundled codecs don't include them). Convert them to JPG on your phone or Mac first.
- Vector tracing is great for logos, icons and flat art. Photos turn into stylised posters, which is a limit of tracing itself.
- Very large photos (over about 100 megapixels) will be slow in the editor.
- PSD: smart objects and text layers open as pixels. Groups nested inside groups are merged into their outer group, and effects beyond the four supported styles are dropped. RO3 tells you when a file used them.
- Playback in the viewer shows transitions as crossfades and approximates color effects. Render preview and Export show the exact result.
- RO3 has no AI features such as Select Subject or Generative Fill, no 3D, and no keyframe animation. Content-aware fill is pattern-based (the same family of technique Photoshop's original version used), so it is excellent on texture, sky, grass and walls and weaker at inventing complex objects.
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
  vendor/ag-psd.js      PSD library (MIT)
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

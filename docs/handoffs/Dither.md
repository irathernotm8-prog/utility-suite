# Dither: handoff for the Dither chat

Dither is the Utility Package's pixel-art and pixel-animation studio, made for working with Claude and Codex. Effects are written as code, rounds of drafts are reviewed side by side, and there's a sprite and animation editor. The local model is the Stable Diffusion engine that Kiln runs, plus Pixel Art XL and Pixel snap. The MCP plugin returns a picture with every result. Dither lives in `apps/dither` inside `~/Downloads/Utility Package`, and `apps/dither/README.md` has the feature list, tools, code map and data folders.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/dither
npm install
npm start
npm test                                     # 19 Node checks, no network
xvfb-run node test/e2e/shots.js /tmp/shots   # (Linux) every screen in dark + light, the editor, recording, the sandbox, the real MCP → bridge → app path
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note dither "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/dither`. `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- `npm test` covers:
  - the PNG round trip, and GIF LZW decoded back, including the >4096-code reset and scaling
  - every drawing primitive, and every starter effect rendering repeatably within its palette
  - clear errors, including the per-render time budget
  - Pixel snap recovering a 16×16 sprite from a noisy 7.3× upscale
  - sprite ops, layers, frames and resize
  - contact, board and sprite sheets
  - the exported JS module imported and played on its own
  - projects: versions, feedback, boards and references
  - every plugin handler end to end (drafts → feedback → update with resolved notes → view → bake → record → export → sprites → pixelize)
  - the MCP server over stdio
- `test/e2e/shots.js` (Linux, xvfb) seeds a project, screenshots every screen in dark and light, and checks the following:
  - the pencil draws and undo/redo work
  - Record writes a GIF, a sheet and a WebM
  - an endless loop is stopped after 10 s and the sandbox can't reach the network
  - the real stdio MCP server → bridge → app path works (`create_drafts` shows up live on the board, and `draw_sprite` returns a picture)
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **The sandbox window**: `src/fxhost.js` loads `src/sandbox/fx.html` hidden, and its worker loads `../core/fxruntime.js` from inside `app.asar`. A packaged Linux build (`electron-builder --linux dir`) rendered, stopped an endless loop, recovered and installed the plugin script from `app.asar.unpacked`. If a Mac/Windows build can't start workers, `fx-page.js` falls back to rendering on the page by itself.
  2. **Plugin install**:
     - "Add to Claude" edits `claude_desktop_config.json`.
     - "Add to Claude Code" runs `claude mcp add dither --scope user …` when the CLI is found, and otherwise edits `~/.claude.json`.
     - "Add to Codex" rewrites only the `[mcp_servers.dither]` tables.
     - All of these keep a `.dither-backup`.
     - The script is copied to the app-data `mcp/` folder, so it survives updates.
  3. **Ask Claude**: this runs `claude -p --output-format stream-json --mcp-config <file> --strict-mcp-config --allowedTools mcp__dither`. On a Mac the app finds the CLI through the login shell's PATH (same approach as Cadence).
  4. **Local model**: with Kiln running Forge/A1111 (API on) or ComfyUI, Generate should find it on 7860/7861/8188. "Add it" downloads Pixel Art XL (~170 MB, Hugging Face) into each Kiln library's `Lora` folder (read from `<appData>/Kiln/kiln.json`, or `~/Downloads/Kiln/Kiln Files/Libraries/*/Lora`). It needs an SDXL checkpoint. The Windows PC's GPU is the better place to run it.
  5. **Picture import** uses `nativeImage` (BGRA → RGBA) except for PNGs, which use Dither's own decoder.

## 0.2.0 — detailed sprites (vectors, shading, critique)

- **`src/core/vector.js`** rasterizes an SVG subset the pixel-art way. Supported: rect, circle, ellipse, line, polyline, polygon, path (all commands), g/transform, fill/stroke/opacity, fill-rule, and linear and radial gradients (as banded dithering; `data-steps` and `data-dither` tune it). Fills are sampled at pixel centres, and strokes ≤1.5px are Bresenham lines with the L-corner pixel removed. `data-material` and `data-form` tags come back as `materials` and are stored on the sprite (`s.materials`).
- **`src/core/shade.js`**:
  - Regions are connected areas of one flat colour that has a material. Normals come from the form: a distance-field inflate for soft, bevel and facet, analytic for sphere, cylinder and flat.
  - Lighting is Lambert, calibrated so a surface facing the viewer lands on the base colour. Blinn specular adds glints and rim light is added at the edges. A contact shadow drops one step where another shape sits toward the light.
  - Ramps from `makeRamp` shift hue cool in the shadows and warm in the highlights. Transitions use Bayer dithering.
  - The selective outline is darker where the form turns away and lighter on the lit side. A majority clean-up then removes lone pixels, keeping deliberate glints.
- **`src/core/critic.js`**: checks for stray pixels, L-corner doubles in 1px lines, zigzags on the silhouette, pillow shading (lightness tracks distance-to-edge but not the light, checked per solid shape), near-duplicate colours (ΔE < 4.5), flat values, edge contrast, frame-to-frame volume pops and flicker. The score is 100 − 8 per major − 2 per minor.
- Sprite ops `svg` and `shade` (so they work inside `draw_sprite`). Plugin tools: `draw_svg`, `shade_sprite`, `make_ramp`, `critique`, plus `view` with `region`. The guide has a "work in passes" section, and the connect instructions point Claude at it for anything 32px and up.
- In the editor: **Shade** (materials and forms per flat colour, a light pad, transitions, outline mode and every-frame, with a live before/after) and **Critique** (a numbered panel with boxes on the canvas; click an issue to jump to it; marked stale after edits). **⋯ › Draw from SVG** and **Make a ramp**, and **Sprites › From SVG**. The window calls the same core code through `kit:*` IPC.
- Verified here: 16 Node checks, and the e2e run opens Shade on an SVG wizard, applies it and runs Critique (screens 17–21).

## 0.3.0 — Animate (video model → pixel sprite)

- The flow: a character (sprite, picture, or drawn on green via `engine.generate` with `background: 'green'`) → `animate.sourceImage` puts it on a 640² green screen → a video model → frames saved as a clip (`clips/<id>/`) → `clip2sprite.convert` → a normal sprite (`s.from = { clip, opts }`).
- **Engines** (`src/video.js`):
  - Local: Wan 2.2 TI2V 5B in ComfyUI (Kiln's). Graph: UNETLoader → ModelSamplingSD3 (shift 8), CLIPLoader `wan`, VAELoader, `Wan22ImageToVideoLatent`, KSampler 20 steps cfg 5 uni_pc, SaveImage. 24 fps, length = 4k+1 frames, sides rounded to 32. Files: `wan2.2_ti2v_5B_fp16` (10 GB, diffusion_models), `umt5_xxl_fp8_e4m3fn_scaled` (6.7 GB, text_encoders), `wan2.2_vae` (1.4 GB, vae). The installer downloads once (resumable) into the first Kiln library and hard-links into the others; ComfyUI needs a restart to see them. Needs a ComfyUI new enough to have the Wan 2.2 node — `localStatus` reports it if missing.
  - Cloud: fal.ai queue REST with the user's key (`safeStorage`-encrypted in settings as `falKeyEnc`; never returned to the window). `kling-3` → `fal-ai/kling-video/o3/standard/image-to-video`, `wan-i2v` → `fal-ai/wan-i2v`, or a custom endpoint id. Charged to the user's fal account.
  - **Not tested against a real GPU or real fal here.** Tests use `test/fixtures/fake-comfy.js` and a mocked fetch. Check the first real run on the PC (and expect Wan on a Mac to be slow, minutes per second of video). If fal changes a model id or its input names, edit `CLOUD` in `src/video.js`.
- **`src/core/clip2sprite.js`**: key (YCbCr chroma distance to the border colour, hard alpha, despill only within 2px of the screen, tinted rim pixels touching the screen dropped, small islands dropped) → align (`feet` | `x` | `none`) → `findLoop` (thumbnails anchored at bottom-centre; each candidate scored over a 4-frame window so a half-cycle in the opposite direction loses; prefers the latest local minimum near the best) → evenly picked frames → majority downsample → one shared palette → orphan clean-up → de-flicker → optional outline.
- Frame extraction runs in the sandbox window (`fxhost.frames`): `<video>` seek + canvas for MP4/WebM (H.264 verified in the e2e run), `ImageDecoder` for GIF/WebP.
- Plugin tools: `animate_status`, `animate_character` (waits up to `wait_seconds`, default 480, else returns `running`), `import_clip`, `list_clips`, `clip_to_sprite` (`keep:false` previews), `view` kind `clip`. The guide has an "Animating characters" section.
- Window: **Animate** (Cmd+4; References moved to Cmd+5) with source, presets, length, engine, progress/stop, clip cards, drag-and-drop import, the **Make a sprite** sheet and the **Video engines** sheet.
- Verified here: 19 Node checks; e2e screens 22–26 (empty view, engines, convert sheet of an imported H.264 clip, the kept sprite, clips after a local run on the stand-in ComfyUI, light theme).

## Rules specific to Dither

- **The kit is the contract.** `src/core/fxruntime.js` is shared by the sandbox, Node, the plugin and exported modules, so keep it plain ES5-ish JS with no imports. If you add a drawing call, document it in `guideText()` (`src/core/guide.js`) and in the lab's kit sheet (`kitSheet()` in `renderer/effects.js`), and add a test.
- **Effect code only runs in the sandbox** (`fxhost.render`). Never `eval` or `new Function` effect code in the window or the main process. Tests may use `FX.render` directly.
- **Every pixel-making tool returns a picture** (`image()` in `mcp-handlers.js`). Keep that true for new tools, because it's how the AI "trusts its eyes".
- **Versions are files.** Every `update_effect` writes `vN.js`. Never overwrite an old version. Feedback notes carry the version they were left on.
- **Sprite cels are RGBA.** The palette is a convenience list, not an index mode. Ops take palette slots (numbers), hex strings or `null` to erase.
- The window never touches Node. Everything goes through `window.dither.call(...)` → `ipcMain` handlers in `src/main.js`. Changes made by the plugin reach the window as `changed` events.
- Project data stays in the projects folder (`~/Documents/Dither/<Project>`). App data holds settings, the bridge token and the MCP copy.

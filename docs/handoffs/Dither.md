# Dither: handoff for the Dither chat

Dither is the Utility Package's pixel-art and pixel-animation studio, made for working with Claude and Codex. Effects are written as code, rounds of drafts are reviewed side by side, and there's a sprite and animation editor. The local model is the Stable Diffusion engine that Kiln runs, plus Pixel Art XL and Pixel snap. The MCP plugin returns a picture with every result. Dither lives in `apps/dither` inside `~/Downloads/Utility Package`, and `apps/dither/README.md` has the feature list, tools, code map and data folders.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/dither
npm install
npm start
npm test                                     # 24 Node checks, no network
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

## 0.5.1 — character fixes (joints, turnarounds, engine-checked exports)

- **Joint guessing** (`rig.guessJoints`): legs split by an outline line count as two legs (`outlineKey` = the dominant dark edge colour, `inner(y)` treats it as a gap); the crotch is a gap near the middle of the row (`midGap`), not just any two runs; T-pose arms: hand = far end of the arm band, wrist just inside, elbow halfway. On a 9-figure procedural set (front/side, chibi heads, T-pose, arms against the body, robes) mean joint error went 9.0% → 3.2% of figure height (scratch eval, not in the repo).
- **Robes / long dresses**: found when only the feet show below the hem (`robe: true` on the guess and on the view; note in the rig notes). Legs are placed inside the robe and every motion's thigh/shin/foot rotation, stretch and lift is damped to 30% for that view (`character.poseAt(anim, f, view, viewObj)` — every caller now passes the view object). Toggle: Rig panel checkbox “Robe or long dress”, `set_joints` `robe: true|false` (`joints` is now optional), `chars:joints(id, view, {}, { recut:false, robe })`.
- **Turnaround auto-pick** (`characters.autoPick(clip)`, IPC `chars:autoPick`, `character_view action:"pick"` with no `picks`): the pose model reads every frame; shoulder + hip spread ∝ cos(angle) against the widest frame (MediaPipe's z is too noisy); facing from the nose. When the two widest frames half a turn apart read the same way (the model mirrors backs into fronts) the clearer face is the front. Three-quarter views are chosen on the stretch of the clip between front/back and side. No model → silhouette widths and the order of the turn. The Pick views sheet pre-fills the suggestion; nothing is made until you press Make views.
- Verified here: 24 Node checks (adds robe vs one-leg side view, robe damping, auto-pick on a synthetic turn); e2e screens incl. the Rig robe toggle; on a 24-frame turn built from a real photo the pose model's auto-pick chose front 5 / ¾ 9 / side 13 / back 18 / back ¾ 15 (ideal 6 / 9 / 12 / 18 / 15).
- **Exports opened in the real engines** (`test/engines/`, optional): Spine 4.1 runtime (spine-core 4.1.55) loads every bone/slot/animation and resolves attachments; bones now use `transform: noScale` so stretched limbs don't skew children — worst bone error vs Dither's rig: side 0.03 px, front 0.66 px. Godot 4.3 headless loads both `.tscn` views (sprites textured) and the 28-animation `SpriteFrames`; fixes: floats always written with a decimal point (an integer first key made Godot treat the rotation track as int and ignore it) and `scale` tracks for limb stretch (front views) — worst error side ~0 px, front ≤ 2 px.

## 0.5.0 — characters (one picture → a rigged 2D character)

- **Pose model** (`src/vendor/mediapipe/`, ~19 MB, Apache 2.0): Tasks Vision 1.1.1 bundle + SIMD wasm + `pose_landmarker_lite.task`. Runs in the sandbox window: `fxhost.poses(frames, { video, fps, mask })` sends the files once as bytes, the page imports them from blob URLs (CSP now allows `blob:` scripts, `connect-src blob:` and `wasm-unsafe-eval`; the network is still blocked by `webRequest`). It needs WebGL even on the CPU delegate, so `main.js` appends `enable-unsafe-swiftshader` for machines without a GPU (the e2e run proves it in Xvfb). Segmentation masks come back with `mask:true` and are used to cut people out of photos/busy pictures (`characters.cutOut`; flat backdrops still go through the chroma keyer).
- **Rig** (`core/rig.js`): 19 joints (`_f` = near side in side views / the character's right = screen-left in front views). `guessJoints` (silhouette: neck = narrowest row 12–45%, crotch = first two-run row, arm positions from the silhouette edges in front views); `jointsFromLandmarks` (near side by mean z). `skeleton` → 16 bones (root at the feet, hips, torso, head, 3 per limb). `cut`: limbs own pixels inside their capsule (d/r ≤ 1) unless the pixel's colour isn't on the limb's bone line and it's inside the torso capsule; head above the neck, torso the rest; BFS colour fill under covered areas; joint caps for limb children; far limbs copied (`backLimbs: auto|copy|own`). `solve` = per-bone affine (rest → posed) with `r` (deg, clockwise), `x/y` (figure heights), `sl/sw` stretch. `render` = Scale2x×3, inverse-map at 8×, 8×8 majority, snap to palette; identity at rest. `bounds` gives one frame box per view across all animations.
- **Characters** (`core/character.js`): `characters/<id>.json` = `{ name, pixel, directions 1|4|8, views: { side|front|back|front34|back34: { sprite (parts sprite: layer per bone = draw order, frame 0 default skin, more frames = skins), joints, backLimbs } }, animations: [{ motion, amp, frames, fps, loop, events, keys: { view: [{ f, pose }] } }], skins, skin, attachments }`. Directions map to views (left/diagonal-left mirrored; missing views fall back via `FALLBACK`). `MOTIONS` are functions of t per view kind; keys add on top of a motion (`addPose`) or stand alone. `retarget` turns 33-point landmark sequences into local bone rotations (mirrors left-facing footage, near side by z, 1-2-1 smoothing, resampled).
- **Service** (`src/characters.js`) shared by IPC (`chars:*`) and the plugin. Tools: `create_character`, `set_joints`, `character_view` (add / mirror / turnaround via Animate preset `turnaround` / pick frames), `character_animation` (add/update/remove/pose/bake/clear_keys), `motion_from_video`, `character_skin` (skins, recolour, attach gear), `view kind:'character'`, `export kind:'character'` (sheets | spine | godot | all), `record`/`delete_item` kind `character`.
- **Exports** (`core/charexport.js`): baked sheets per direction (+ JSON: pivot, hitboxes, attach points, events; Godot `SpriteFrames` .tres with `&"anim_dir"` names; GIFs); Spine 4.1 JSON (y-up, CCW: angles/y flipped; rotate/translate/scale timelines relative to setup) + libgdx atlas; Godot 4 `.tscn` (Node2D per bone with no rest rotation, so our local rotations map 1:1; Sprite2D parts; AnimationPlayer with an AnimationLibrary; textures at `res://characters/<name>/parts <view>/`).
- **Window**: **Characters** (Cmd+7): list (walk previews), New character sheet, and the character editor with Rig / Animate / Directions / Skins & gear tabs, a view/direction picker, animation picker, frame strip with key dots and playback.
- **Limits worth knowing:** joints from the silhouette are a first guess for stylised art (robes, chibi, overlapping limbs) — expect to drag a few. The pose model reads realistic figures and video of people well, stylised pixel art poorly. Turnaround views come from a video model and need review. Spine translate keys are in world axes (fine for the root; small differences for a translated child). Spine/Godot exports were checked in the real runtimes in 0.5.1 (see above).
- Verified here: 24 Node checks; e2e screens 35–44 (empty list, new character, rig, parts, animate, pose key by dragging a bone, directions, skins & gear, light theme, list); on a real photo the pose model found the joints (confidence 1.0) and read 24/24 frames of a video into an animation.

## 0.4.0 — bigger, more detailed, more effects, tiles & scenes

- **Big canvases.** Sprites go to 2048×2048 (`SP.create`/`resize`, editor resize, import), `FX.Canvas` to 2048, effects to 1024. Editor (`renderer/editor.js`): the frame composite lives in `compCv` and only the dirty box (`E.dirty`, set by `setPx`/`markDirty`) is recomposed; `invalidate()` on any structural change; checkerboard is a pattern; grid only over the visible area; zoom steps go down to 12.5% (`ZOOMS`); the tile grid shows on canvases over 256px; cel undo is a changed-box diff (`diffCel` → kind `box`), capped at ~400 MB; previews/thumbnails of big sprites are shrunk (`smallSize`/`composeSmall`). Shape previews only redraw their box (`pbox`).
- **Tiles for Claude** (`core/resample.js`): `tileSize` (64/128/256 by size), `tiles`, `parseRegion` ("B2", "B2:C3", {x,y,w,h}), `overview` (shrunk picture with the grid and names). `SP.apply(..., { region })` (or per-op `region`) crops the box, runs the op in box coordinates (svg/shade/texture see a sprite of the box's size), pastes back. `view`, `draw_sprite`, `get_sprite` take `region`; big sprites return the overview and `bigNote` tells Claude how to work.
- **Downscale** (`resample.downscale`): per output cell, colour = argmax(share + keep·contrast·√share), with silhouette cells kept when ≥25% covered next to solid cells. `SP.scaled` copies every layer/frame. Tool `scale_sprite` (smaller only).
- **Detail** (`core/detail.js`): `texture` (10 kinds; a pattern step −2…+2 along `shade.makeRamp` of each colour), `normalMap` (chamfer distance → rounded height ×1.2·bulge + luma detail, 2 softening passes; RGB with green = up), `relight` (Lambert vs the flat-facing value, snapped to each colour's ramp), `smooth` (inside corners of runs ≥2 get the midpoint colour; transparency only with a background), `cleanup` (L-corner in 1px diagonals, lone strays). Sprite ops `texture`, `smooth`, `cleanup`, `relight`; tools `texture_sprite`, `polish_sprite`, `normal_map` (export writes a normal-map sprite sheet next to the colour layout). Editor: texture brush (T; computes the textured cel once per stroke via `kit:texture` and stamps it), tile preview toggle, ⋯ › Polish edges / Normal map & light / Check tile seams / Make a smaller copy.
- **Effects toolkit** (`fxruntime.js`): `particles` (analytic per particle from hashed seeds; `emit:'stream'` wraps age modulo 1 so t=0 and t=1 match), `trail`, `shockwave`, `bolt` (midpoint displacement; `g.lastBolt`), `flames` (periodic value noise `pnoise`, scrolled by one period → seamless), `Fluid` (stable fluids on a coarse grid: buoyancy, turbulence from smooth noise, wind relaxes toward a target, open edges so smoke leaves; `warm(n, feed)` before frame 0), `fluid` draw, `cycle`, `flash`, `dissolve`, per-frame `shake()`, `lnoise`. `Fluid` is passed into effect code (compile and exported modules). 21 starters in `core/fxlib2.js` (appended to `LIB`). Fluid loops are near-seamless only (said in their blurbs and the guide).
- **Tiles & scenes** (`core/tiles.js`, `core/scenes.js`): neighbour bits N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128, corners count only with both sides (`canon`) → 47; tiles are built per quarter from fill/top/left/outer/inner (+ optional bottom/right), flipped for the other quarters. A tileset is a sprite with `s.tileset = { tile, kind, cols, masks, count, terrain }` and the sheet in frame 0. Scenes are `scenes/<id>.json`: `{ w, h, length, background, layers: [{ kind:'sprite', sprite, frame, animate, x, y, depth, repeat } | { kind:'tiles', tileset, tile, rows, edges, x, y, depth }] }`; screen x = x − camX·depth. Exports: Tiled `.tsx` (Wang set `mixed`/`edge`) + `.tmj`, Godot 4 `.tres` (terrain_set mode 0 = corners+sides, 2 = sides; `terrains_peering_bit/*`), layers + `scene.json`, PNG, GIF pan. Tools `make_tileset`, `check_tile`, `create_scene`, `edit_scene`, `paint_scene`, `view kind:'scene'`, `record`/`export` kind `scene`/`tileset`. Window: **Tiles & scenes** (Cmd+6) with the tileset sheet (start a 5-frame pieces sprite, then build) and the scene editor (layers, depth, repeat, terrain painting on a cell grid, camera slider, Pan).
- **Not checked against the real apps:** the Godot `.tres` and Tiled `.tsx` follow their documented formats but weren't opened in Godot/Tiled here. Worth importing one of each the first time.
- Verified here: 23 Node checks; e2e screens 27–34 (tiles, scene, painting, pan, light theme, new tileset, 512px canvas with pencil + texture brush, normal map sheet, the bigger starter library), no console errors. 30 pencil moves on a 512px canvas take ~0.55 s in the headless run.

## Rules specific to Dither

- **The kit is the contract.** `src/core/fxruntime.js` is shared by the sandbox, Node, the plugin and exported modules, so keep it plain ES5-ish JS with no imports. If you add a drawing call, document it in `guideText()` (`src/core/guide.js`) and in the lab's kit sheet (`kitSheet()` in `renderer/effects.js`), and add a test.
- **Effect code only runs in the sandbox** (`fxhost.render`). Never `eval` or `new Function` effect code in the window or the main process. Tests may use `FX.render` directly.
- **Every pixel-making tool returns a picture** (`image()` in `mcp-handlers.js`). Keep that true for new tools, because it's how the AI "trusts its eyes".
- **Versions are files.** Every `update_effect` writes `vN.js`. Never overwrite an old version. Feedback notes carry the version they were left on.
- **Sprite cels are RGBA.** The palette is a convenience list, not an index mode. Ops take palette slots (numbers), hex strings or `null` to erase.
- The window never touches Node. Everything goes through `window.dither.call(...)` → `ipcMain` handlers in `src/main.js`. Changes made by the plugin reach the window as `changed` events.
- Project data stays in the projects folder (`~/Documents/Dither/<Project>`). App data holds settings, the bridge token and the MCP copy.

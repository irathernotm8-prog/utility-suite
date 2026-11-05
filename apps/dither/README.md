# Dither

A pixel-art and pixel-animation studio built for working with Claude, Codex and other AI agents. It follows the approach in Sprite Fusion's *How to make good pixel art effects with Claude*: effects are written as code, the AI makes several different drafts, you judge them with your own eyes, and the best ones are refined over a few rounds. Made for game sprites and VFX, and for small animations in the suite's apps and sites.

## What's in it

- **Drafts.** One board per idea. Claude makes 5–10 different takes (`create_drafts`), and they all play side by side. For each one you choose *Pick*, *Maybe* or *Pass* and can leave notes, optionally tied to a frame. Claude reads them back (`get_feedback`) and refines your picks (`update_effect`), marking the notes it addressed. **Next round** sends that request with one click.
- **Effects.** Pixel VFX written as code with Dither's drawing kit: pixel-perfect lines, shapes, fills, ordered dithering, a glow that uses no blur, outlines, mirroring, a 3×5 font, seeded randomness, noise, easing, and palettes and ramps. Effects can hold a frame for impact and loop seamlessly. The **Lab** has a live preview at integer scale, a frame strip, onion skin, speed and background options, sliders generated from `params`, and a code editor that runs as you type. It keeps every version, notes, recordings and exports.
- **Sprites.** A layered, multi-frame editor with pencil, eraser, fill, line, box, ellipse, a dither brush, colour picker, move and mirror drawing. It also has a palette, a timeline with per-frame timing and onion skin, undo and autosave. Claude draws on the same documents with ops; `pixels` rows of palette slots are the precise way to do it. **Bake** turns an effect's frames into an editable sprite.
- **Detailed sprites, in passes (0.2).** These are the tools that make 32–128px art look finished rather than flat.
  - **Draw from SVG:** vectors rasterized the way a pixel artist would. Fills land on pixel centres with no anti-aliasing, thin strokes become pixel-perfect 1px lines with no doubled corners, and gradients and opacity become a few flat bands with dithered seams. Shapes tagged with `data-material` and `data-form` are remembered for shading.
  - **Shade:** one light lit through hue-shifted ramps (cool shadows, warm highlights), with form from the shape (soft, sphere, cylinder, bevel, facet or flat). It adds highlights on shiny materials, rim light, contact shadows and a selective outline, then tidies stray pixels. Material presets include skin, cloth, leather, metal, gold, wood, stone, foliage, hair, gel, plastic, crystal and fur.
  - **Critique:** a pixel-art review that boxes and numbers stray pixels, doubled corners, jaggy edges, pillow shading, near-duplicate colours, flat values, weak edge contrast and animation flicker. It gives a score, and clicking an issue takes you to it.
  - **Close-ups:** `view` with a `region` shows a zoomed area with a pixel grid.
  - **Ramps:** make a hue-shifted ramp from any colour.
- **Animate (0.3).** Move a character with a video model, then turn the clip into pixel art — the approach behind Sorceress's Auto-Sprite.
  - Pick a sprite or a picture (or **Draw a character** on a green screen with Kiln's image engine). Dither puts it on a flat green screen and sends it with a motion preset (idle, walk, run, attack, cast, jump, hurt, defeat) or your own words. A guard is always added: the camera doesn't move, the background stays, no new shadows, and loops end where they start.
  - **On this computer:** Wan 2.2 TI2V 5B through the ComfyUI that Kiln runs, free and private. One click downloads the three model files (~18 GB) into Kiln's library. **Cloud:** your own fal.ai key (stored encrypted) with Kling 3.0 or Wan; the endpoint id is editable if fal renames it.
  - **Make a sprite:** the green screen is keyed out (chroma distance, edge-only despill, the compressed rim and stray specks removed), the character is held in place by its feet (or sideways only), the loop point is found, frames are picked evenly, scaled down with a majority vote, mapped to one shared palette and de-flickered. Live preview with height, frames, colours, palette, hold, screen removal and outline; **Keep** makes a normal sprite you can Shade and Critique.
  - **Import** any MP4, MOV, WebM, GIF or animated WebP (a 3D render, green-screen footage) and convert it the same way.
- **Characters (0.5): one picture → a rigged 2D character for games.**
  - **Picture → parts.** Drop in a full-body picture (a sprite, an AI image, concept art, even a photo). The background is keyed out (photos: the pose model's person mask cuts the figure out), pixel style brings it to a chosen height, and joints are found by an offline pose model (MediaPipe, bundled) or, for stylised art it can't read, from the silhouette. The picture is cut into head, torso, upper/lower arms, hands, thighs, shins and feet on a bone skeleton; what the front limbs covered is filled in, joints get overlap caps, and in side views the far arm/leg is copied from the near one when they overlap. Drag joints in the **Rig** tab (parts re-cut when you let go); parts live in an ordinary sprite (a layer per bone) so you can redraw any of them.
  - **Motion library**: idle, walk, run, jump, attack, cast, hurt, death and climb, each written for side and front/back views (¾ views use a softened side motion) — every character gets a full move set at once. **Pose editor**: click a bone, drag it round its joint; that frame gets a key that plays on top of the motion. **Motion from video**: the pose model reads a person in a clip or video file (act it out on your phone) and keys the bones.
  - **Pixel-safe rendering**: parts are blown up 8× with Scale2x (RotSprite), rotated there, voted back down and snapped to the character's own palette — rotation never invents colours, and the rest pose is the original picture.
  - **Directions**: side-scroller (right + mirrored left), or top-down 4 (down/up/right/left) and 8 (adds ¾ diagonals). Views come from more pictures, a mirror of another view, or a **turnaround** made with Animate's video model (Dither suggests a frame per view from the body angle; you confirm); missing views stand in with the nearest one.
  - **Skins & gear**: skins are extra frames of the parts sprites (draw replacement parts; empty layers fall back) and/or recolours; gear (a sword, a hat) is a sprite pinned to a bone with a grip point.
  - **Robes and long dresses** are recognised (only the feet show): the legs go inside and barely swing. Toggle it in the Rig panel.
  - **Export**: sprite sheets per direction (a row per animation, one frame size, a shared feet pivot) + JSON with hitboxes, hand/head/feet points and events + a Godot 4 SpriteFrames + GIF previews; **Spine 4.1** JSON + atlas per view; **Godot 4** .tscn per view (Node2D bones, Sprite2D parts, AnimationPlayer). Both were loaded in the real Spine 4.1 runtime and Godot 4.3 and match Dither's rig within 2 px.
- **Bigger and more detailed (0.4).**
  - **Big canvases** up to 2048×2048 (effects up to 1024): backdrops, splash art, big bosses. The editor only redraws what changed, zooms out below 1×, shows a tile grid, and undo stores just the changed box. Claude sees big sprites as an overview with named tiles (A1, B2 …) and works tile by tile: `view region:"B2"`, `draw_sprite region:"B2"` (coordinates start at the tile), `get_sprite region`.
  - **Smaller copies** (`scale_sprite`, editor ⋯ › Make a smaller copy): each new pixel takes the colour that matters most in its box, so eyes, outlines and highlights survive.
  - **Texture brush** and `texture_sprite`: stone, bricks, scales, bark, wood, weave, grass, metal, sand or noise, painted in each colour's own hue-shifted ramp so it stays on-palette.
  - **Polish edges** (`polish_sprite`): removes doubled corners in 1px diagonals and lone strays, and adds one in-between colour in the inside corners of stair-steps.
  - **Normal map & light** (`normal_map`): a normal map from the silhouette and values, exported as a sheet for 2D lights in Godot/Unity, and relighting from any direction (snapped back to each colour's ramp).
- **Effects toolkit (0.4).** `g.particles` (bursts and seamlessly looping streams, as a pure function of t), `g.trail`, `g.shockwave`, `g.bolt`, `g.flames` (periodic noise, loops with no seam), `Fluid` (a small smoke/steam/poison simulation), `g.cycle` (palette cycling), `g.flash`, `g.dissolve`, `shake()`, `pnoise`/`lnoise`. **21 new starter effects** use them: fireball, meteor impact, portal, shield bubble, level up, tornado, ice shatter, poison cloud, smoke puff, dust landing, water splash, waterfall, lava pool, torch, electric arc, healing aura, confetti, teleport, magic circle, snowfall and campfire with smoke.
- **Tiles & scenes (0.4).** Draw five tiles (fill, top edge, left edge, outer corner, inner corner) and **New tileset** builds the full 47-tile blob set (or the 16-tile sides set). `check_tile` and the editor's tile preview find seams (wrap by half or dither them together). **Scenes** are a camera over a wider world: sprite layers with parallax depth and repeat, terrain layers painted cell by cell (the right edge/corner tile is picked for you), animated sprites, a pan preview. Export tilesets for **Tiled** (.tsx with a Wang set) or **Godot 4** (.tres with terrain peering bits), and scenes as layers + `scene.json`, Tiled maps, PNG or a GIF pan.
- **References.** Drop in screenshots of things you like and note why. Claude can look at them with `view`.
- **Starter effects.** Nine working effects to read, remix and learn the kit from: explosion, slash, lightning, campfire loop, heal, black hole, rain, pickup sparkle and hit impact.
- **Generate & pixelize.** A local model, with no tokens and nothing leaving the computer. Dither uses the Stable Diffusion engine that Kiln runs (Forge, A1111, SD.Next or ComfyUI) with the free **Pixel Art XL** LoRA (one-click install into Kiln's library). **Pixel snap** then finds the hidden grid, takes one colour per cell, reduces the palette and clears the background. Pixelize does the same for any picture.
- **Output.** *Record* saves a GIF, a contact sheet or a WebM video into the project's `records/`. *Export* writes a sprite sheet PNG with Aseprite-style JSON (Phaser, Godot, Unity importers, PixiJS), GIFs, PNG frames, or a **standalone JS module** of an effect (no dependencies, no eval) for web games and sites:
  ```js
  import { createEffect } from './explosion.js';
  const fx = createEffect();                       // or createEffect({ params: { size: 18 }, seed: 3 })
  // each frame of your game loop:
  const alive = fx.drawAt(ctx, x - fx.w, y - fx.h, msSinceStart, 2);   // one-shots return false when done
  ```

## The plugin (Claude Desktop, Claude Code, Codex)

Use **Connections** to add it with one click; each config file is backed up first. The MCP server is `mcp/dither-mcp.js`. It runs with Dither's own Electron as Node and forwards calls to the running app over a private local bridge (127.0.0.1 plus a token in `bridge.json`), starting Dither hidden if it isn't open. Tools: `dither_guide`, `dither_context`, `create_project`, `set_active_project`, `list_library`, `get_library_effect`, `try_effect`, `create_drafts`, `create_effect`, `update_effect`, `get_effect`, `list_effects`, `get_feedback`, `view`, `list_references`, `create_sprite`, `draw_sprite`, `draw_svg`, `shade_sprite`, `make_ramp`, `critique`, `get_sprite`, `edit_sprite`, `bake_effect`, `record`, `export`, `pixelize_image`, `generate_image`, `animate_status`, `animate_character`, `import_clip`, `list_clips`, `clip_to_sprite`, `scale_sprite`, `texture_sprite`, `polish_sprite`, `normal_map`, `make_tileset`, `check_tile`, `create_scene`, `edit_scene`, `paint_scene`, `create_character`, `set_joints`, `character_view`, `character_animation`, `motion_from_video`, `character_skin`, `delete_item`.

Every tool that makes pixels returns a **picture**, either a numbered contact sheet or a board of every draft, so the AI sees what it drew. `get_sprite` can return a frame as rows of palette slots, so the AI can read pixels exactly. The full contract Claude reads is in `src/core/guide.js` and `mcp/guide-instructions.js`.

**Ask Claude** in the window runs your own Claude Code (or Codex) headless with only Dither's tools and streams what it does.

## Safety

Effect code never runs in the window or the main process. It runs in a hidden **sandboxed** window (Chromium sandbox, no Node, every network request blocked), in a worker with a time limit, so an endless loop is stopped after 10 s. The window and the plugin both render through it (`src/fxhost.js`, `src/sandbox/`).

## Working on it

```bash
npm install
npm start
npm test                                        # 24 Node checks: characters (joints, robes, cutting, turnaround auto-pick, rest pose = picture, RotSprite palette, FK, every motion, retargeting, skins, gear, Spine/Godot/sheet exports), the effects toolkit and 30 starters, big canvases and tile regions, detail tools, tilesets/scenes and their exports, the clip → sprite pipeline and both Animate engines (a stand-in ComfyUI and a mocked fal.ai), vectors, shading, the critic, PNG/GIF codecs, the kit, every starter effect, Pixel snap, sprites, sheets, the JS module, projects, the plugin handlers end to end, the MCP server over stdio
xvfb-run node test/e2e/shots.js /tmp/shots      # (Linux) seeds a project, clicks through every screen in dark + light, draws in the editor, records a GIF + WebM, checks the sandbox stops endless loops and blocks the network, imports a real H.264 clip, runs Animate on a stand-in ComfyUI, builds a scene and paints terrain, makes a character (drags a joint, keys a pose, adds views, skins, gear, exports), reads joints and motion from a real photo/video when DITHER_POSE_PHOTO is set, draws and texture-brushes on a 512px canvas, and drives the real MCP server → bridge → app
python3 build/make-icon.py                      # the icon
# test/engines/README.md: optional checks that load character exports in the real Spine 4.1 runtime and Godot 4.3
```

## Code map

| | |
|---|---|
| `src/core/fxruntime.js` | The pixel canvas, drawing kit, palettes, ramps, font, noise, easing and the effect player. Plain JS that runs in the sandbox, in Node and inside exported modules |
| `src/core/fxlib.js`, `fxlib2.js` | Starter effects (`fxlib2.js`: the ones built on the 0.4 toolkit) |
| `src/core/sprite.js` | Sprite documents (layers × frames of RGBA cels), drawing ops, compose, (de)serialise |
| `src/core/project.js` | Projects on disk, effects with versions and feedback, boards, references |
| `src/core/pixelsnap.js` | Grid detection (edge phase coherence), per-cell colour, k-means/palette mapping, background removal, orphan clean-up |
| `src/core/sheets.js` | Contact sheets, board sheets, sprite sheets + JSON |
| `src/core/vector.js` | SVG subset → pixels: pixel-centre fills, pixel-perfect strokes, dithered gradients/opacity, material tags |
| `src/core/shade.js` | Materials, hue-shifted ramps, normals from forms, lighting, contact shadows, selective outline, clean-up |
| `src/core/critic.js` | The pixel-art critic and zoomed crops |
| `src/core/rig.js` | Joints (silhouette / pose landmarks), skeleton, cutting parts (fill, caps, far limbs), forward kinematics, RotSprite rendering |
| `src/core/character.js` | Views and directions, the motion library, key interpolation, skins/attachments, rendering animations, retargeting video motion |
| `src/core/charexport.js` | Baked sheets + metadata + Godot SpriteFrames, Spine 4.1 JSON + atlas, Godot 4 scenes |
| `src/characters.js` | The character service (shared by the window and the plugin): create, joints, views, turnarounds, animations, video, skins, previews, exports |
| `src/vendor/mediapipe/` | MediaPipe Tasks Vision + Pose Landmarker lite (Apache 2.0), run offline in the sandbox |
| `src/core/resample.js` | Detail-keeping downscale, thumbnails, tile names and the overview picture for big canvases |
| `src/core/detail.js` | Textures, normal maps and relighting, selective anti-aliasing, corner clean-up |
| `src/core/tiles.js` | Autotile (47/16) from five pieces, terrain grids, seam check/fix, parallax render, Tiled/Godot exports |
| `src/core/scenes.js` | Scenes in a project: layer pictures, render for a camera, pans |
| `src/core/clip2sprite.js` | Clip → sprite: green-screen keyer, alignment, loop finder, downsampling, shared palette, de-flicker |
| `src/video.js` | Motion presets and the guard prompt, the Wan 2.2 ComfyUI graph, fal.ai queue (Kling 3.0 / Wan), resumable downloads |
| `src/animate.js` | Animate: source on green, generate, import, preview/keep, Wan install into Kiln |
| `src/core/png.js`, `gif.js` | PNG and animated GIF codecs (no dependencies) |
| `src/core/exporters.js` | Files: sheet, GIF, frames, contact sheet, JS module |
| `src/core/guide.js` | The guide the AI reads |
| `src/mcp-handlers.js` | Every plugin tool, as plain functions (tested without Electron) |
| `src/connectors.js` | Bridge + adding the plugin to Claude Desktop / Claude Code / Codex |
| `src/fxhost.js`, `src/sandbox/` | The sandboxed render window + worker, WebM recording, video/GIF frame extraction |
| `src/engine.js` | Local Stable Diffusion (A1111/Forge/ComfyUI), Pixel Art XL install into Kiln |
| `src/ai.js` | Finding Claude Code / Codex and running Ask |
| `src/renderer/` | The window: `drafts.js`, `effects.js` (list + lab), `sprites.js`, `editor.js`, `refs.js`, `animate.js`, `tiles.js` (tiles & scenes, scene editor), `characters.js` (characters and the character editor), `make.js`, `more.js` (starter effects, connections, settings), `player.js` |

## Data

- Projects: `~/Documents/Dither/<Project>/` (change it in Settings). Each has `dither.json` (boards, references), `sprites/*.dsprite`, `effects/<id>/` (`effect.json`, then `v1.js`, `v2.js` and so on), `refs/`, `clips/<id>/` (clip.json, frames, source.png), `scenes/<id>.json`, `characters/<id>.json` + `characters/sources/`, `records/`, `exports/` and `.trash/`.
- App data: `settings.json`, `bridge.json` (the plugin's private connection), `mcp/` (the installed MCP script) and `ask/` (scratch space for Ask).

# Dither

A pixel-art and pixel-animation studio built for working with Claude, Codex and other AI agents. It follows the approach in Sprite Fusion's *How to make good pixel art effects with Claude*: effects are written as code, the AI makes several different drafts, you judge them with your own eyes, and the best ones are refined over a few rounds. Made for game sprites and VFX, and for small animations in the suite's apps and sites.

## What's in it

- **Drafts.** One board per idea. Claude makes 5–10 different takes (`create_drafts`), and they all play side by side. For each one you choose *Pick*, *Maybe* or *Pass* and can leave notes, optionally tied to a frame. Claude reads them back (`get_feedback`) and refines your picks (`update_effect`), marking the notes it addressed. **Next round** sends that request with one click.
- **Effects.** Pixel VFX written as code with Dither's drawing kit: pixel-perfect lines, shapes, fills, ordered dithering, a glow that uses no blur, outlines, mirroring, a 3×5 font, seeded randomness, noise, easing, and palettes and ramps. Effects can hold a frame for impact and loop seamlessly. The **Lab** has a live preview at integer scale, a frame strip, onion skin, speed and background options, sliders generated from `params`, and a code editor that runs as you type. It keeps every version, notes, recordings and exports.
- **Sprites.** A layered, multi-frame editor with pencil, eraser, fill, line, box, ellipse, a dither brush, colour picker, move and mirror drawing. It also has a palette, a timeline with per-frame timing and onion skin, undo and autosave. Claude draws on the same documents with ops; `pixels` rows of palette slots are the precise way to do it. **Bake** turns an effect's frames into an editable sprite.
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

Use **Connections** to add it with one click; each config file is backed up first. The MCP server is `mcp/dither-mcp.js`. It runs with Dither's own Electron as Node and forwards calls to the running app over a private local bridge (127.0.0.1 plus a token in `bridge.json`), starting Dither hidden if it isn't open. Tools: `dither_guide`, `dither_context`, `create_project`, `set_active_project`, `list_library`, `get_library_effect`, `try_effect`, `create_drafts`, `create_effect`, `update_effect`, `get_effect`, `list_effects`, `get_feedback`, `view`, `list_references`, `create_sprite`, `draw_sprite`, `get_sprite`, `edit_sprite`, `bake_effect`, `record`, `export`, `pixelize_image`, `generate_image`, `delete_item`.

Every tool that makes pixels returns a **picture**, either a numbered contact sheet or a board of every draft, so the AI sees what it drew. `get_sprite` can return a frame as rows of palette slots, so the AI can read pixels exactly. The full contract Claude reads is in `src/core/guide.js` and `mcp/guide-instructions.js`.

**Ask Claude** in the window runs your own Claude Code (or Codex) headless with only Dither's tools and streams what it does.

## Safety

Effect code never runs in the window or the main process. It runs in a hidden **sandboxed** window (Chromium sandbox, no Node, every network request blocked), in a worker with a time limit, so an endless loop is stopped after 10 s. The window and the plugin both render through it (`src/fxhost.js`, `src/sandbox/`).

## Working on it

```bash
npm install
npm start
npm test                                        # 12 Node checks: PNG/GIF codecs, the kit, every starter effect, Pixel snap, sprites, sheets, the JS module, projects, the plugin handlers end to end, the MCP server over stdio
xvfb-run node test/e2e/shots.js /tmp/shots      # (Linux) seeds a project, clicks through every screen in dark + light, draws in the editor, records a GIF + WebM, checks the sandbox stops endless loops and blocks the network, and drives the real MCP server → bridge → app
python3 build/make-icon.py                      # the icon
```

## Code map

| | |
|---|---|
| `src/core/fxruntime.js` | The pixel canvas, drawing kit, palettes, ramps, font, noise, easing and the effect player. Plain JS that runs in the sandbox, in Node and inside exported modules |
| `src/core/fxlib.js` | Starter effects |
| `src/core/sprite.js` | Sprite documents (layers × frames of RGBA cels), drawing ops, compose, (de)serialise |
| `src/core/project.js` | Projects on disk, effects with versions and feedback, boards, references |
| `src/core/pixelsnap.js` | Grid detection (edge phase coherence), per-cell colour, k-means/palette mapping, background removal, orphan clean-up |
| `src/core/sheets.js` | Contact sheets, board sheets, sprite sheets + JSON |
| `src/core/png.js`, `gif.js` | PNG and animated GIF codecs (no dependencies) |
| `src/core/exporters.js` | Files: sheet, GIF, frames, contact sheet, JS module |
| `src/core/guide.js` | The guide the AI reads |
| `src/mcp-handlers.js` | Every plugin tool, as plain functions (tested without Electron) |
| `src/connectors.js` | Bridge + adding the plugin to Claude Desktop / Claude Code / Codex |
| `src/fxhost.js`, `src/sandbox/` | The sandboxed render window + worker, WebM recording |
| `src/engine.js` | Local Stable Diffusion (A1111/Forge/ComfyUI), Pixel Art XL install into Kiln |
| `src/ai.js` | Finding Claude Code / Codex and running Ask |
| `src/renderer/` | The window: `drafts.js`, `effects.js` (list + lab), `sprites.js`, `editor.js`, `refs.js`, `make.js`, `more.js` (starter effects, connections, settings), `player.js` |

## Data

- Projects: `~/Documents/Dither/<Project>/` (change it in Settings). Each has `dither.json` (boards, references), `sprites/*.dsprite`, `effects/<id>/` (`effect.json`, then `v1.js`, `v2.js` and so on), `refs/`, `records/`, `exports/` and `.trash/`.
- App data: `settings.json`, `bridge.json` (the plugin's private connection), `mcp/` (the installed MCP script) and `ask/` (scratch space for Ask).

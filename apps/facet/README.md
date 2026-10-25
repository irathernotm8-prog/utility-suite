# Facet

Make 3D models from a prompt or a picture, generated entirely on this computer. No accounts, no API keys, no tokens, no uploads: Facet downloads open models once and runs them on the machine's own GPU (NVIDIA CUDA on Windows, Metal on Apple Silicon) or, failing that, its CPU.

## What it does

- **Prompt → 3D.** Type a description and pick a style (Object, Character, Game asset, Low-poly, Figurine, Prop). Facet sketches 1–4 concept pictures with SD Turbo or SDXL Turbo; pick one and it becomes a model.
- **Picture → 3D.** Drop, paste or browse for a photo, render or drawing of one object. The background is removed automatically (IS-Net).
- **Views → 3D.** Two to four photos of the same object (front, left, back, right) go into Hunyuan3D 2 Multi-view for one consistent model.
- **Engines** (download the ones you want):
  | Label | Model | Notes |
  |---|---|---|
  | Fast | TripoSR (MIT) | Coloured mesh; seconds on a GPU, ~1–2 min on CPU |
  | Detailed | Hunyuan3D 2 mini Turbo | Much sharper geometry; 5 steps. Optional colour borrowed from TripoSR |
  | Detailed+ | Hunyuan3D 2 mini | Same model, 30 steps |
  | Best | Hunyuan3D 2 Turbo | Full-size model; wants ≥10 GB VRAM or a 24 GB Mac |
  | Multi-view | Hunyuan3D 2 MV Turbo | 2–4 photos |
- **AI-painted textures (Hunyuan3D Paint).** An optional 11 GB download: removes the lighting from the picture, generates six consistent views of the object guided by the mesh, and bakes them into a 1K or 2K texture, so the back and sides get real detail. Works on any engine's mesh. Best on an NVIDIA card with 12 GB+ (about 1–2 minutes); runs on Apple Silicon or the CPU, slowly.
- **Tripo cloud engine (optional).** With the person's own Tripo API key: picture → model or prompt → model on Tripo's servers (H3.1, H3.0 "Tripo 3.0", P1 low-poly), native PBR textures, downloaded into the library and turned to face forward. This is the only part of Facet that uploads anything or costs anything, and only when chosen.
- **Painted textures (from the picture).** Every model is UV-unwrapped and painted from the picture(s) it came from: each texel is projected into each view, coloured only where that view can actually see it, and the hidden sides are filled from their nearest painted neighbours (or from TripoSR's colour guess). The model is also turned to face +z, the convention in every engine.
- **Rigging.** Characters get a Mixamo-named humanoid skeleton (27 bones), skin weights measured along the surface, and Idle / Walk / Wave test clips, written as one skinned GLB. Eight markers (chin, wrists, elbows, knees, groin) are placed automatically and can be dragged before rigging. Unity Humanoid, Unreal's retargeter, Blender, Godot, Roblox and three.js read it directly, and Mixamo animations retarget onto it.
- **Viewer.** Orbit, turntable, shaded / clay / wireframe / normals, floor shadow, grid; for rigged models a Static/Rigged switch, clip player and bone overlay.
- **Export.** GLB (static or rigged), OBJ with .mtl and texture, STL (scaled to a chosen height in mm, z-up for slicers), PLY with vertex colour, game-ready (20k) and low-poly (5k) GLB, and **Export for…** presets for Unity, Unreal, Godot, Blender, Roblox (20k, re-rigged at that size), three.js and 3D printing, each with a one-line import tip.
- **Library.** Every model is a folder in `~/Documents/Facet` with `model.glb`, the input picture, the original source picture(s), a thumbnail and `facet.json`. Rename, favourite, notes, make again, add existing .glb/.obj/.stl/.ply files.

## How it runs

```
Electron window ──IPC──▶ main process ──stdin/stdout JSON lines──▶ Python worker (engine/facet_worker.py)
                          │                                           │
                          ├─ setup.js: uv → Python 3.11 → PyTorch      ├─ TripoSR (bundled code in engine/tsr)
                          ├─ models.js: Hugging Face downloads         ├─ hy3dgen (Hunyuan3D 2, from Tencent's GitHub)
                          └─ library.js: ~/Documents/Facet             └─ diffusers (SD/SDXL Turbo), rembg, trimesh
```

- **Engine setup** (Models › Set up engine) downloads `uv`, installs a private Python 3.11 and a virtual environment in the app-data folder, then PyTorch (CUDA 12.8 wheels on NVIDIA PCs, Metal-enabled wheels on Macs, CPU wheels otherwise), `engine/requirements.txt`, and `hy3dgen` from a pinned Tencent commit with `--no-deps`. The environment is versioned from the requirements; a Facet update that changes them shows "Update engine".
- **Models** are downloaded file-by-file from Hugging Face (resumable `.part` files, retries) into `<app data>/Models/<org>/<repo>/…`, exactly where the worker looks. A small manifest per model in `Models/.facet/` records what was fetched. The worker runs with `HF_HUB_OFFLINE=1`, so generation never touches the network.
- **The worker** keeps one model in memory at a time (two on GPUs with ≥20 GB), loads Hunyuan directly in half precision to avoid a float32 copy, and uses bfloat16 on CPU-only machines with under 20 GB RAM. Stopping a job kills and restarts the worker.

## Code map

| Path | What |
|---|---|
| `src/main.js` | Window, IPC, prompt styles, jobs (`imagine`, `make`), export, import |
| `src/setup.js` | Private Python/PyTorch environment |
| `src/models.js` | Catalog status, downloads, removal |
| `src/worker.js` | Python worker process and request queue |
| `src/library.js` | Library folders and `facet.json` |
| `src/tools.js` | Processes, resumable downloads, uv, hardware detection |
| `src/renderer/` | Window UI (ES modules): `app.js` shell, `create.js`, `library.js`, `models.js`, `settings.js`, `onboarding.js`, `viewer.js` (three.js, clips, bones), `rig-editor.js` (marker editor), `rigui.js` (rig sheet, Export for…), `vendor/` (three.js r180, MIT) |
| `engine/facet_worker.py` | All inference and mesh work; commands `hello`, `imagine`, `shape`, `export`, `rig_guess`, `rig` |
| `engine/texture.py` | UV unwrap (xatlas), view fitting by silhouette, visibility, texture bake |
| `engine/paint.py` | Hunyuan3D Paint loader and runner (device, steps, sizes; trusts hy3dgen's bundled custom pipeline) |
| `engine/torch_raster.py` | Pure-PyTorch replacement for Hunyuan's compiled `custom_rasterizer` (matches it pixel for pixel) |
| `src/tripo.js` | Tripo v3 API: upload, image/text-to-model, polling, download |
| `engine/rig.py` | Marker guess, skeleton, geodesic skin weights, clips, skinned GLB writer (pygltflib) |
| `engine/selftest.py` | Texture + rig check on a synthetic figure (run by `npm test` when the engine is set up) |
| `engine/catalog.json` | Models, files, sizes, licences, hardware needs |
| `engine/tsr/` | TripoSR (MIT), with marching cubes swapped to scikit-image and DINO config read locally |
| `build/make-icon.py` | Regenerates `build/icon.png` |

## Data

| What | Where |
|---|---|
| Library | `~/Documents/Facet` (change in Settings). Each model folder: `model.glb` (painted), `model-rigged.glb` once rigged, `input.png`, `source-*.png`, `thumb.png`, `facet.json` (including the rig markers) |
| Models | `<app data>/Models` (change in Models) |
| Python, PyTorch, uv, engine log | `<app data>/Engine` |
| Settings | `<app data>/facet.json` |
| Pasted pictures, prompt sketches | `<app data>/Scratch` |

`<app data>` is `~/Library/Application Support/Facet` on a Mac and `%APPDATA%\Facet` on Windows.

## Licences of the models

TripoSR: MIT. Hunyuan3D 2: Tencent Hunyuan Community Licence (free for personal use; not licensed in the EU, UK or South Korea). SD Turbo / SDXL Turbo: Stability AI Community Licence. IS-Net: Apache 2.0. Facet shows these on each model.

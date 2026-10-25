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
- **Viewer.** Orbit, turntable, shaded / clay / wireframe / normals, floor shadow, grid.
- **Export.** GLB, OBJ, STL (scaled to a chosen height in mm, z-up for slicers), PLY with vertex colour, plus game-ready (20k) and low-poly (5k) GLB.
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
| `src/renderer/` | Window UI (ES modules): `app.js` shell, `create.js`, `library.js`, `models.js`, `settings.js`, `onboarding.js`, `viewer.js` (three.js), `vendor/` (three.js r180, MIT) |
| `engine/facet_worker.py` | All inference and mesh work |
| `engine/catalog.json` | Models, files, sizes, licences, hardware needs |
| `engine/tsr/` | TripoSR (MIT), with marching cubes swapped to scikit-image and DINO config read locally |
| `build/make-icon.py` | Regenerates `build/icon.png` |

## Data

| What | Where |
|---|---|
| Library | `~/Documents/Facet` (change in Settings) |
| Models | `<app data>/Models` (change in Models) |
| Python, PyTorch, uv, engine log | `<app data>/Engine` |
| Settings | `<app data>/facet.json` |
| Pasted pictures, prompt sketches | `<app data>/Scratch` |

`<app data>` is `~/Library/Application Support/Facet` on a Mac and `%APPDATA%\Facet` on Windows.

## Licences of the models

TripoSR: MIT. Hunyuan3D 2: Tencent Hunyuan Community Licence (free for personal use; not licensed in the EU, UK or South Korea). SD Turbo / SDXL Turbo: Stability AI Community Licence. IS-Net: Apache 2.0. Facet shows these on each model.

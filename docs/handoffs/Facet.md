# Facet: handoff for the Facet chat

Facet is the Utility Package app that makes 3D models from a prompt or a picture, entirely on the computer it runs on. This file lives at `docs/handoffs/Facet.md`. README.md has the feature list, data folders and code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/facet
npm install
npm start          # FACET_USER_DATA=/tmp/facet-test npm start for a clean profile
npm test           # quick checks: catalog, engine files, renderer imports, icon
```

To ship: bump `version` in `package.json`, `./utility note facet "…"`, `./utility publish`.

## Rules specific to Facet

- **Nothing leaves the computer at generation time.** The worker runs with `HF_HUB_OFFLINE=1`. Network is used only by Models (downloads from Hugging Face / GitHub) and engine setup (uv, Python, PyTorch, PyPI). Keep it that way: no cloud APIs, no telemetry.
- **The catalog is the contract.** `engine/catalog.json` drives the Models view, downloads, fit badges and the Create engine list. A new model needs a catalog entry and, for a new engine, a branch in `engine/facet_worker.py` (`SHAPE_MODELS` or `IMAGE_MODELS`). `npm test` checks they match.
- **Model files live at `<Models>/<org>/<repo>/<path>`.** hy3dgen finds them through `HY3DGEN_MODELS`, diffusers by local path, TripoSR by local path plus `FACET_MODELS` for the DINO config. Do not switch to the Hugging Face cache layout.
- **The Python environment is versioned.** Changing `engine/requirements.txt`, the PyTorch choice or `HY3DGEN_SHA` in `src/setup.js` changes the environment version; users then see "Update engine". `transformers` must stay below 5 (TripoSR's ViT weights and hy3dgen use the 4.x module names).
- **TripoSR is vendored** (MIT) in `engine/tsr` with two edits marked `Facet:`: marching cubes via scikit-image (no torchmcubes compile) and the DINO config read from the models folder. Hunyuan3D (`hy3dgen`) is installed from Tencent's GitHub archive at a pinned commit, never vendored (its licence).
- **Orientation:** after clean-up every model is turned so the side in the front picture faces +z (`texture.face_front`, by silhouette overlap), and stands on y = 0. Rigging and the engine presets rely on that.
- **Textures:** `texture.bake` unwraps with xatlas and paints from the pictures; models with a texture are capped at 150k faces (`TEXTURED_MAX_FACES`) because unwrapping very dense meshes is slow. "Guess the hidden sides" (`colorize`) only supplies the fill colour for unseen areas.
- **Rigging:** joint names are Mixamo's (`mixamorig:*`) — keep them; Unity/Unreal/Mixamo mapping depends on it. The character's left is +x. Skin weights come from surface (graph) distance, so loose capes and long hair near an arm can follow the arm; the marker editor is the user's fix for odd guesses. A rigged export with a face limit (Roblox) re-rigs a reduced copy with the saved markers.
- **Hunyuan3D Paint (`texture: 'ai'`):** `engine/paint.py` runs hy3dgen's texgen with `torch_raster` registered as `custom_rasterizer` (no CUDA compile). The UNet loader that ships with the weights (`hunyuan3d-paint-v2-0-turbo/unet/modules.py`) is patched once, marked `# Facet v2`, to read the 3.7 GB safetensors instead of the 7 GB .bin (strict=False; missing tensors still fail). Shape models are unloaded before painting; cards under 14 GB use CPU offload. Meshes must face +z (Hunyuan's convention) — they do after `face_front`. `paint.paint` runs the pipeline's steps itself (not `pipe(mesh, image)`) so each stage and diffusion step reports progress; it paints a copy capped at `PAINT_MAX_FACES` (60k — xatlas unwrapping time explodes on raw Hunyuan meshes), and replaces hy3dgen's pure-Python `meshVerticeInpaint` (uncompiled fallback; ran for hours on dense meshes, the 0.3.0 "stuck at 85%" bug) with the vectorised `fast_vertex_inpaint`.
- **Tripo (`engine: 'tripo'`):** `src/tripo.js` talks to `https://openapi.tripo3d.com/v3` with the user's key (encrypted in `facet.json` › `tripo.key`, never sent to the window). The downloaded GLB goes through the worker's `orient` (face +z, floor, unit size, materials kept); without the engine it is kept as delivered. `FACET_TRIPO_BASE` points it at a mock for testing.
- **Vertex colours:** Facet keeps sRGB internally and writes linear colours into GLB (glTF's rule); `load_mesh` converts back when reading a GLB. OBJ/PLY get sRGB.
- **Memory:** one big model in memory at a time (two on ≥20 GB GPUs). Hunyuan is built directly in half precision. CPU-only machines with under 20 GB RAM use bfloat16 (slow on CPUs without native bf16, but it fits). Stopping a job kills the worker; the next request restarts it.
- No native Node modules. The Python side compiles nothing (all wheels).

## Not done yet / ideas

- Hunyuan3D 2.1 PBR paint (metal/roughness maps) — same approach as 2.0 paint, bigger download.
- Tripo multi-view and text-to-image inputs; showing the account's credit balance.
- Finger bones, and rig types for quadrupeds or props.
- AMD GPUs on Windows run on the CPU (no DirectML path).
- Batch mode (a folder of pictures → a folder of models).

## Testing without a GPU

`npm test` needs nothing. For a full run on a CPU-only box: set up the engine from Models, download TripoSR + the background remover, and use Picture mode at Low detail (about 1–3 minutes). Hunyuan on a CPU without native bfloat16 takes 20+ minutes.

# Kiln

Kiln installs and runs Stable Diffusion apps (Forge Neo, ComfyUI, A1111, reForge, SD.Next and Fooocus). It also manages models from CivitAI, Hugging Face or any link, generates images itself, and keeps everything separate per **profile**.

## What's in it

| Area | What it does |
|---|---|
| **Profiles** | Picker at launch, optional 4-digit PIN. Each profile has its own settings, model library (or a library shared with another profile), images folder, saved prompts, generation history, browser sign-ins (its own browser session) and CivitAI/HF keys (stored encrypted). |
| **Packages** | Catalog install (git clone, then uv-managed Python, then PyTorch for the detected GPU, then requirements), launch with toggle options plus extra args, live console with input, update check and update, repair, uninstall, and extensions/custom nodes (installed list, on/off, update, remove, browse the A1111 index or ComfyUI-Manager list, or install from a Git link). |
| **Connecting to a profile** | On every launch the package is linked to the *active* profile: A1111-family packages get model and output folders linked as junctions on Windows or symlinks elsewhere, ComfyUI gets `extra_model_paths.yaml` plus `--output-directory`, and Fooocus gets `config.txt` paths. |
| **Generate** | txt2img and img2img through the running package's API (`/sdapi/v1` for Forge/A1111/SD.Next, a built workflow for ComfyUI). Includes LoRA chips with weight sliders, tag autocomplete (Danbooru/e621 CSV), size presets, hires fix, seed reuse, live preview and progress, upscale, saved prompts. Images are saved to `<profile outputs>/Kiln/<date>/` with A1111-style `parameters` text in the PNG. |
| **Gallery** | The profile's outputs folder: search by prompt, favorites, multi-select, a viewer showing the settings, "Use settings", "Use as start image", copy, drag out, and move to trash. |
| **My models** | Library by type: previews, base model, trigger words, rename, move, delete, and "Find details on CivitAI" (SHA-256 lookup). Drop files in to copy them into the library. |
| **Find models** | CivitAI search (types, base model, sort, period, NSFW rule), model pages with versions and files, Hugging Face search, an Essentials list and repo file browser, and "Paste a link". |
| **Browser** | Relay's browser: tabs, bookmarks, incognito, ad blocking (Ghostery engine) and sign-in friendly identity. Package web UIs open here. Any model download on any site is filed into the library (CivitAI downloads are identified through the API). |

Model metadata uses Stability Matrix's `<name>.cm-info.json` and `<name>.preview.jpeg` sidecars, so either app can read what the other wrote.

## Run it

```bash
npm install
npm start
```

`KILN_USER_DATA=/some/dir npm start` runs with a separate settings folder, which is useful for testing.

## Where things live

| What | Where |
|---|---|
| App state (profiles list, libraries, packages, tools) | `userData/kiln.json` (`%APPDATA%\Kiln`, `~/Library/Application Support/Kiln`) |
| Kiln folder (default) | `~/Downloads/Kiln/Kiln Files` with `Packages/`, `Profiles/<id>/`, `Libraries/`, `Tools/` (uv, MinGit, Python) |
| A profile | `Kiln Files/Profiles/<id>/profile.json` (settings, prompts, history, bookmarks, downloads) and `Outputs/` |
| Thumbnails cache | `userData/thumbs` |

## Code map

```
src/main.js                 window, menu, app/profile/settings/prompts IPC
src/core.js                 global store, profiles, libraries, encrypted secrets
src/store.js                JSON stores with atomic writes
src/tools.js                processes, uv + Git download, GPU detection, PyTorch index
src/packages/catalog.js     package definitions: repo, Python, options, model/output folder maps
src/packages/manager.js     install / update / repair / launch / stop / console / extensions
src/packages/links.js       junction/symlink linking, ComfyUI yaml, Fooocus config
src/models/library.js       scanning, metadata, CivitAI hash lookup, move/delete
src/models/sources.js       CivitAI + Hugging Face APIs, link resolver, cm-info writer
src/models/downloads.js     one download manager for every source, filing into the library
src/generate/index.js       A1111/Forge/SD.Next + ComfyUI generation
src/generate/png.js         PNG text chunks (read/write), A1111/Comfy parameter parsing
src/gallery.js              outputs listing, image details, kiln:// file + thumbnail protocol
src/tags.js                 tag autocomplete
src/browser/                Relay's browser main-process side (adblock, identity)
src/renderer/               UI: app.js shell + one file per page
```

## Not done yet

- Kohya/OneTrainer (training) and InvokeAI aren't in the catalog. They're pip-based or need special setup.
- Generate doesn't do inpainting masks, ControlNet or a custom ComfyUI workflow editor. Use the package's own UI for those (it opens inside Kiln).
- AMD on Windows installs the CPU PyTorch build. SD.Next with `--use-directml` or ZLUDA is the way to go there.

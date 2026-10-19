# Kiln: handoff for the Kiln chat

Kiln is the Utility Package app for running Stable Diffusion. This file goes in `docs/handoffs/Kiln.md` in the Utility Package. README.md has the feature list and code map.

## Bringing it into the Utility Package (one time, on the Mac)

1. Copy the `kiln-source` folder to the Mac (it has no `node_modules`).
2. In Terminal:
   ```bash
   cd ~/Downloads/Utility\ Package
   ./utility add /path/to/kiln-source
   cp apps/kiln/HANDOFF.md docs/handoffs/Kiln.md
   ./utility note kiln "First release: replaces Stability Matrix with profiles, packages, model browser, Generate, gallery and the Relay browser"
   ./utility suite --apps kiln
   ```
3. In `suite.json`, Kiln can be `"macArch": "arm64"`. It has no native modules.

After that, work in `apps/kiln` like every other app. To ship a change, bump `version` in `package.json`, run `./utility note kiln "…"`, then build the suite.

## Rules specific to Kiln

- **Never delete through a link.** Package model and output folders are junctions or symlinks into a library. Use `links.removeAllLinks()` before trashing a package folder, and never `fs.rm` a linked folder recursively.
- **Profiles are separate on disk.** Each one has `Profiles/<id>/profile.json` and its own `Outputs/`. The model library is either its own or explicitly shared. Each profile's browser session is `persist:kiln-<profileId>`.
- **Stability Matrix compatibility.** Keep writing `.cm-info.json` and `.preview.jpeg` sidecars in Stability Matrix's format and keep its folder names (`StableDiffusion`, `Lora`, …), so an SM `Data/Models` folder keeps working as a library.
- **Packages are linked at launch to the active profile.** If you add a package to `src/packages/catalog.js`, give it `models` and `outputs` folder maps (or a config writer like ComfyUI and Fooocus have) and an `options` list.
- Secrets (CivitAI key, HF token) go through `core.encrypt` / `core.secret`. They are never sent to the window.

## Testing

- `npm test` runs quick Node checks: PNG text, A1111 parsing, folder linking.
- `KILN_USER_DATA=/tmp/kiln-test npm start` gives a clean settings folder. A fake Forge server (a `launch.py` that answers `/sdapi/v1/*`) is enough to exercise Generate end to end without a GPU.

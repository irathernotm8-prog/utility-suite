// Kiln — connecting a package's model and output folders to the active profile's library.
// Uses directory junctions on Windows (no admin rights or Developer Mode needed) and symlinks elsewhere.
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const PLACEHOLDER = /^((put|place)\b.*\bhere\b.*\.txt|\.gitkeep|\.keep|placeholder.*|readme\.md)$/i;

const norm = (p) => path.resolve(String(p || '').replace(/^\\\\\?\\/, '')).toLowerCase();

function lstat(p) { try { return fs.lstatSync(p); } catch { return null; } }
function isLink(p) { const s = lstat(p); return !!s && s.isSymbolicLink(); }
function readLink(p) { try { return fs.readlinkSync(p); } catch { return null; } }

function removeLink(p) {
  // Removes only the link itself, never what it points to
  try { fs.unlinkSync(p); return true; } catch {}
  try { fs.rmdirSync(p); return true; } catch {}
  return false;
}

function makeLink(linkPath, target) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, IS_WIN ? 'junction' : 'dir');
}

// Moves a real folder's contents into the target, then replaces it with a link.
function linkDir(linkPath, target, log = () => {}) {
  fs.mkdirSync(target, { recursive: true });
  // If the parent folder is itself a link into the library (Stability Matrix sometimes links whole
  // folders), linking here would make the library point at itself. Leave it alone.
  try {
    const parentReal = norm(fs.realpathSync(path.dirname(linkPath)));
    const targetReal = norm(fs.realpathSync(target));
    if (parentReal === targetReal || parentReal.startsWith(targetReal + path.sep) || targetReal.startsWith(parentReal + path.sep) && isLink(path.dirname(linkPath))) return 'nested';
  } catch {}
  const st = lstat(linkPath);
  if (!st) { makeLink(linkPath, target); return 'linked'; }
  if (st.isSymbolicLink()) {
    const cur = readLink(linkPath);
    if (cur && norm(path.resolve(path.dirname(linkPath), cur)) === norm(target)) return 'ok';
    if (!removeLink(linkPath)) { log(`Couldn’t replace the link at ${linkPath}`); return 'failed'; }
    makeLink(linkPath, target);
    return 'relinked';
  }
  if (!st.isDirectory()) { log(`Skipped ${linkPath}: it’s a file, not a folder`); return 'skipped'; }
  // Real folder: bring its files into the library, then link
  let moved = 0, kept = 0;
  for (const name of fs.readdirSync(linkPath)) {
    const from = path.join(linkPath, name);
    if (PLACEHOLDER.test(name)) { try { fs.rmSync(from, { force: true }); } catch {} continue; }
    const to = path.join(target, name);
    if (fs.existsSync(to)) { kept++; continue; }
    try { fs.renameSync(from, to); moved++; } catch (e) { kept++; if (e.code === 'EXDEV') log(`${name} is on a different drive from your library, so it was left in place. Move it into the library to use it with every package.`); }
  }
  if (kept) { log(`Kept ${linkPath} as a normal folder (${kept} item${kept > 1 ? 's' : ''} couldn’t be moved into the library)`); return 'kept'; }
  try { fs.rmdirSync(linkPath); } catch (e) { log(`Couldn’t link ${linkPath}: ${e.message}`); return 'failed'; }
  makeLink(linkPath, target);
  if (moved) log(`Moved ${moved} item${moved > 1 ? 's' : ''} from ${path.basename(linkPath)} into your library`);
  return 'linked';
}

function applyLinks(pkgPath, mapping, rootFor, log) {
  const results = {};
  for (const [rel, folder] of Object.entries(mapping || {})) {
    const linkPath = path.join(pkgPath, ...rel.split('/'));
    const target = rootFor(folder);
    try { results[rel] = linkDir(linkPath, target, log); }
    catch (e) { results[rel] = 'failed'; log(`Couldn’t link ${rel}: ${e.message}`); }
  }
  return results;
}

function removeLinks(pkgPath, mappings) {
  for (const mapping of mappings) for (const rel of Object.keys(mapping || {})) {
    const p = path.join(pkgPath, ...rel.split('/'));
    if (isLink(p)) removeLink(p);
  }
}
// Every link inside a package (two levels deep in common folders) — used before deleting a package
function removeAllLinks(pkgPath) {
  const walk = (dir, depth) => {
    let list = [];
    try { list = fs.readdirSync(dir); } catch { return; }
    for (const n of list) {
      const p = path.join(dir, n);
      if (isLink(p)) { removeLink(p); continue; }
      if (depth > 0 && lstat(p)?.isDirectory() && !/^(venv|\.venv|\.git|node_modules|repositories)$/i.test(n)) walk(p, depth - 1);
    }
  };
  walk(pkgPath, 3);
}

/* ---------- ComfyUI: extra_model_paths.yaml ---------- */
function writeComfyPaths(pkgPath, libRoot) {
  const q = (s) => JSON.stringify(s);
  const yaml = `# Written by Kiln for the active profile's library. Kiln rewrites this file each launch.
kiln:
  base_path: ${q(libRoot)}
  checkpoints: StableDiffusion
  diffusion_models: |
    DiffusionModels
    StableDiffusion
  unet: DiffusionModels
  loras: |
    Lora
    LyCORIS
  vae: VAE
  vae_approx: ApproxVAE
  embeddings: Embeddings
  text_encoders: TextEncoders
  clip: TextEncoders
  clip_vision: ClipVision
  controlnet: |
    ControlNet
    T2IAdapter
  ipadapter: IpAdapter
  upscale_models: |
    ESRGAN
    RealESRGAN
    SwinIR
  hypernetworks: Hypernetwork
  style_models: StyleModels
  gligen: GLIGEN
  animatediff_models: AnimateDiff
  ultralytics: Ultralytics
  ultralytics_bbox: Ultralytics/bbox
  ultralytics_segm: Ultralytics/segm
  sams: Sams
  model_patches: ModelPatches
  audio_encoders: AudioEncoders
`;
  fs.writeFileSync(path.join(pkgPath, 'extra_model_paths.yaml'), yaml);
}

/* ---------- Fooocus: config.txt paths ---------- */
function writeFooocusPaths(pkgPath, libRoot, outDir) {
  const file = path.join(pkgPath, 'config.txt');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const j = (f) => path.join(libRoot, f);
  Object.assign(cfg, {
    path_checkpoints: [j('StableDiffusion')], path_loras: [j('Lora'), j('LyCORIS')], path_embeddings: j('Embeddings'),
    path_vae_approx: j('ApproxVAE'), path_vae: j('VAE'), path_upscale_models: j('ESRGAN'), path_controlnet: j('ControlNet'),
    path_clip_vision: j('ClipVision'), path_outputs: path.join(outDir, 'Fooocus')
  });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 4));
}

module.exports = { linkDir, applyLinks, removeLinks, removeAllLinks, removeLink, isLink, writeComfyPaths, writeFooocusPaths };

// Kiln — the profile's gallery (its outputs folder), image settings, and the kiln:// file protocol.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, shell, protocol, nativeImage, app, clipboard } = require('electron');
const core = require('./core');
const png = require('./generate/png');

const IMG = /\.(png|jpe?g|webp|gif)$/i;
let cache = { root: null, at: 0, items: [] };

function scan(root, force) {
  if (!force && cache.root === root && Date.now() - cache.at < 8000) return cache.items;
  const items = [];
  const walk = (dir, depth) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) { try { isDir = fs.statSync(p).isDirectory(); } catch { continue; } }
      if (isDir) { if (depth > 0) walk(p, depth - 1); continue; }
      if (!IMG.test(e.name)) continue;
      try { const st = fs.statSync(p); items.push({ path: p, name: e.name, folder: path.relative(root, dir).split(path.sep)[0] || '', size: st.size, mtime: st.mtimeMs }); } catch {}
    }
  };
  walk(root, 5);
  items.sort((a, b) => b.mtime - a.mtime);
  cache = { root, at: Date.now(), items };
  return items;
}
function invalidate() { cache.at = 0; }

function list({ offset = 0, limit = 120, folder = '', query = '', favorites = false, force = false } = {}) {
  const a = core.active();
  if (!a) return { items: [], total: 0, folders: [] };
  let items = scan(a.outputsDir, force);
  const folders = [...new Set(items.map(i => i.folder))].filter(Boolean).sort();
  const meta = a.data.imageMeta || {};
  if (folder) items = items.filter(i => i.folder === folder);
  if (favorites) items = items.filter(i => meta[i.path]?.favorite);
  if (query) {
    const q = query.toLowerCase();
    const hist = historyIndex(a);
    items = items.filter(i => i.name.toLowerCase().includes(q) || (hist.get(i.path)?.positive || '').toLowerCase().includes(q));
  }
  return { items: items.slice(offset, offset + limit).map(i => ({ ...i, favorite: !!meta[i.path]?.favorite })), total: items.length, folders, root: a.outputsDir };
}
function historyIndex(a) {
  const m = new Map();
  for (const h of a.data.history || []) for (const p of h.images || []) m.set(p, h);
  return m;
}
function details(p) {
  const a = core.active();
  const out = { path: p, positive: '', negative: '', settings: {}, source: null };
  const h = a && historyIndex(a).get(p);
  if (h) {
    const q = h.params || {};
    Object.assign(out, { positive: h.positive || '', negative: h.negative || '', params: q, source: 'kiln', mode: h.mode, pkg: h.pkg });
    out.settings = { Steps: q.steps, Sampler: q.sampler, 'Schedule type': q.scheduler, 'CFG scale': q.cfg, Seed: h.seed, Size: `${q.width}x${q.height}`, Model: String(q.checkpoint || '').replace(/\s*\[[^\]]*\]$/, ''), VAE: q.vae, 'Made with': h.pkg, ...(h.mode === 'img2img' ? { 'Change amount': q.denoise } : q.hires ? { 'Hires upscale': `${q.hiresScale}× ${q.hiresUpscaler}` } : {}) };
  }
  try {
    if (/\.png$/i.test(p)) {
      const t = png.readText(fs.readFileSync(p));
      const parsed = t.parameters ? png.parseA1111(t.parameters) : t.prompt ? png.parseComfy(t.prompt) : null;
      if (parsed) {
        if (!h) Object.assign(out, parsed, { source: t.parameters ? 'a1111' : 'comfy' });
        out.raw = t.parameters || null;
      }
    }
  } catch {}
  try { const img = nativeImage.createFromPath(p); const s = img.getSize(); out.width = s.width; out.height = s.height; } catch {}
  out.favorite = !!a?.data.imageMeta?.[p]?.favorite;
  return out;
}

/* ---------- kiln:// protocol ---------- */
function allowedRoots() {
  const G = core.g();
  const roots = [core.dataRoot(), ...G.libraries.map(l => l.path)];
  for (const p of G.profiles) roots.push(core.outputsDir(p));
  return roots.filter(Boolean).map(r => path.resolve(r).toLowerCase() + path.sep);
}
function allowed(p) {
  const r = path.resolve(p).toLowerCase();
  return allowedRoots().some(root => r.startsWith(root));
}
function thumbsDir() { return core.ensureDir(path.join(app.getPath('userData'), 'thumbs')); }
async function thumbnail(p, w) {
  const st = fs.statSync(p);
  const key = crypto.createHash('sha1').update(`${p}|${st.mtimeMs}|${w}`).digest('hex');
  const file = path.join(thumbsDir(), key + '.jpg');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return fs.readFileSync(p);
  const s = img.getSize();
  if (s.width > w) img = img.resize({ width: w, quality: 'good' });
  const buf = img.toJPEG(82);
  fs.writeFile(file, buf, () => {});
  return buf;
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'kiln', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }]);
}
function handleProtocol() {
  protocol.handle('kiln', async (req) => {
    try {
      const u = new URL(req.url);
      const p = u.searchParams.get('p');
      if (!p || !allowed(p) || !fs.existsSync(p)) return new Response('Not found', { status: 404 });
      if (u.hostname === 'thumb') {
        const buf = await thumbnail(p, Number(u.searchParams.get('w')) || 384);
        return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' } });
      }
      const buf = await fs.promises.readFile(p);
      return new Response(buf, { headers: { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' } });
    } catch (e) { return new Response(String(e.message), { status: 500 }); }
  });
}

function register(ctx) {
  ipcMain.handle('gal:list', (_e, opts) => list(opts));
  ipcMain.handle('gal:details', (_e, p) => details(p));
  ipcMain.handle('gal:favorite', (_e, { path: p, on }) => {
    const a = core.active(); if (!a) return false;
    a.data.imageMeta = a.data.imageMeta || {};
    a.data.imageMeta[p] = { ...(a.data.imageMeta[p] || {}), favorite: !!on };
    if (!on) delete a.data.imageMeta[p].favorite;
    a.store.save();
    return !!on;
  });
  ipcMain.handle('gal:delete', async (_e, paths) => {
    for (const p of [].concat(paths)) if (allowed(p)) await shell.trashItem(p).catch(() => fs.promises.rm(p, { force: true }));
    invalidate();
    return true;
  });
  ipcMain.handle('gal:show', (_e, p) => { if (allowed(p)) shell.showItemInFolder(p); });
  ipcMain.handle('gal:open-folder', () => { const a = core.active(); if (a) shell.openPath(a.outputsDir); });
  ipcMain.handle('gal:copy', (_e, p) => { if (allowed(p)) { clipboard.writeImage(nativeImage.createFromPath(p)); return true; } return false; });
  ipcMain.handle('gal:read-data-url', (_e, p) => { if (!allowed(p)) return null; const b = fs.readFileSync(p); return `data:${MIME[path.extname(p).toLowerCase()] || 'image/png'};base64,${b.toString('base64')}`; });
  ipcMain.on('gal:drag', (e, p) => { if (allowed(p)) e.sender.startDrag({ file: p, icon: nativeImage.createFromPath(p).resize({ width: 96 }) }); });
  void ctx;
}

module.exports = { register, registerScheme, handleProtocol, invalidate, allowed };

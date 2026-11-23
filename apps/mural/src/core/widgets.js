// Mural — widgets: small interactive web pages that live on the desktop, above the wallpaper and the icons, below your
// apps. A widget *type* is a folder with widget.json + index.html (built-ins in src/widgets, yours and plugins in
// ~/Documents/Mural/Widgets). A widget *instance* is one placed on a display, with its own size, position, settings
// and saved data.
//
// widget.json
//   { "format": 1, "name": "Notes", "description": "…", "author": "", "page": "index.html",
//     "size": { "w": 280, "h": 240, "minW": 160, "minH": 120, "resizable": true },
//     "permissions": ["system", "open", "suite:scene", "network"],
//     "settings": [{ "key": "title", "label": "Title", "type": "text|toggle|select|color|range|list|textarea", "default": "…", "options": […], "min", "max", "step" }],
//     "tags": [] }
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeZip, readZip } = require('./zip');

const slugify = (s) => String(s || 'widget').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'widget';
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };
function copyDir(src, dest) { fs.mkdirSync(dest, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const a = path.join(src, e.name), b = path.join(dest, e.name); if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.writeFileSync(b, fs.readFileSync(a)); } }

/** What each permission lets a widget do, in words shown before you add it. */
const PERMISSIONS = {
  system: 'See CPU, memory and battery use',
  open: 'Open links, files and apps you set up in it',
  network: 'Fetch things from the internet',
  location: 'Know the place set in Mural (for weather)'
};
const permissionText = (p) => PERMISSIONS[p] || (String(p).startsWith('suite:') ? `Talk to ${String(p).slice(6).replace(/^./, (c) => c.toUpperCase())} (Utility Suite)` : p);

const SETTING_TYPES = ['text', 'textarea', 'toggle', 'select', 'color', 'range', 'list'];
function normalizeWidget(raw) {
  const m = raw && typeof raw === 'object' ? { ...raw } : {};
  m.format = 1; m.name = String(m.name || 'Widget').slice(0, 60); m.description = String(m.description || '').slice(0, 300);
  m.page = m.page || 'index.html';
  const sz = m.size || {}; const n = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : d));
  m.size = { w: n(sz.w, 260, 60, 3000), h: n(sz.h, 200, 40, 2000), minW: n(sz.minW, 80, 40, 3000), minH: n(sz.minH, 60, 30, 2000), resizable: sz.resizable !== false };
  m.permissions = (Array.isArray(m.permissions) ? m.permissions : []).map(String).filter((p) => PERMISSIONS[p] || /^suite:[a-z0-9-]+$/.test(p));
  m.settings = (Array.isArray(m.settings) ? m.settings : []).filter((f) => f && f.key && SETTING_TYPES.includes(f.type)).map((f) => ({ label: f.key, ...f }));
  m.tags = Array.isArray(m.tags) ? m.tags.map(String).slice(0, 10) : [];
  return m;
}
// ---------------------------------------------------------------------------------------------------- the grid
// Widgets snap to a grid of square cells laid over the usable part of the display (the work area: not under the menu
// bar, Dock or taskbar), so everything lines up with even gaps. Sizes are whole numbers of cells.
const GRID_SIZES = { small: { cell: 64, gap: 12 }, medium: { cell: 80, gap: 14 }, large: { cell: 100, gap: 16 } };
const GRID_MARGIN = 20;
/** area: the work area in the layer's own coordinates ({x, y, width, height}). size: small|medium|large|off */
function gridFor(area, size) {
  const g = GRID_SIZES[size]; if (!g) return { on: false };
  const step = g.cell + g.gap;
  const cols = Math.max(1, Math.floor((area.width - 2 * GRID_MARGIN + g.gap) / step));
  const rows = Math.max(1, Math.floor((area.height - 2 * GRID_MARGIN + g.gap) / step));
  const w = cols * step - g.gap, h = rows * step - g.gap;
  return { on: true, size, cell: g.cell, gap: g.gap, step, cols, rows, x0: Math.round(area.x + (area.width - w) / 2), y0: Math.round(area.y + (area.height - h) / 2) };
}
const spanOf = (px, G) => Math.max(1, Math.round((px + G.gap) / G.step));
const pxOf = (span, G) => span * G.step - G.gap;
/** Pixel rect -> cells {col,row,cols,rows}, inside the grid. minW/minH (px) set the smallest span. */
function snapToGrid(r, G, minW = 0, minH = 0) {
  const cols = Math.min(G.cols, Math.max(spanOf(r.w, G), Math.ceil((minW + G.gap) / G.step), 1));
  const rows = Math.min(G.rows, Math.max(spanOf(r.h, G), Math.ceil((minH + G.gap) / G.step), 1));
  const col = Math.max(0, Math.min(G.cols - cols, Math.round((r.x - G.x0) / G.step)));
  const row = Math.max(0, Math.min(G.rows - rows, Math.round((r.y - G.y0) / G.step)));
  return { col, row, cols, rows };
}
const cellsToPx = (c, G) => ({ x: G.x0 + c.col * G.step, y: G.y0 + c.row * G.step, w: pxOf(c.cols, G), h: pxOf(c.rows, G) });
const cellsOverlap = (a, b) => a.col < b.col + b.cols && b.col < a.col + a.cols && a.row < b.row + b.rows && b.row < a.row + a.rows;
/** The free spot nearest to `want` (cells) that doesn't overlap `taken`; null if the grid is full. */
function nearestFree(want, taken, G) {
  const fits = (c) => c.col >= 0 && c.row >= 0 && c.col + c.cols <= G.cols && c.row + c.rows <= G.rows && !taken.some((t) => cellsOverlap(c, t));
  if (fits(want)) return want;
  let best = null, bd = Infinity;
  for (let row = 0; row + want.rows <= G.rows; row++) for (let col = 0; col + want.cols <= G.cols; col++) {
    const c = { col, row, cols: want.cols, rows: want.rows }; if (!fits(c)) continue;
    const d = (col - want.col) ** 2 + (row - want.row) ** 2; if (d < bd) { bd = d; best = c; }
  }
  if (best) return best;
  if (want.cols > 1 || want.rows > 1) return nearestFree({ ...want, cols: Math.max(1, want.cols - 1), rows: Math.max(1, want.rows - 1) }, taken, G); // shrink to fit
  return null;
}

const defaultsOf = (m) => Object.fromEntries(m.settings.map((f) => [f.key, f.default !== undefined ? f.default : f.type === 'toggle' ? false : f.type === 'list' ? [] : '']));

class Widgets {
  constructor({ builtinDir, userDir, dataDir }) {
    this.builtinDir = builtinDir; this.userDir = userDir; this.dataDir = dataDir;
    this.file = path.join(dataDir, 'widgets.json'); this.storeDir = path.join(dataDir, 'widget-data');
    fs.mkdirSync(userDir, { recursive: true }); fs.mkdirSync(this.storeDir, { recursive: true });
    this.state = { instances: [], ...(readJSON(this.file) || {}) };
    if (!Array.isArray(this.state.instances)) this.state.instances = [];
  }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1)); fs.renameSync(tmp, this.file); }

  // ------------------------------------------------------------------------------------------------- types
  dirOf(type) { const m = /^(builtin|user)\/([a-z0-9-]+)$/.exec(String(type || '')); if (!m) return null; return path.join(m[1] === 'builtin' ? this.builtinDir : this.userDir, m[2]); }
  fileOf(type, rel) { const dir = this.dirOf(type); if (!dir) return null; const p = path.resolve(dir, String(rel || '').replace(/^\/+/, '')); return p === dir || p.startsWith(dir + path.sep) ? p : null; }
  read(type) {
    const dir = this.dirOf(type); if (!dir) return null;
    const raw = readJSON(path.join(dir, 'widget.json')); if (!raw) return null;
    return { type, dir, builtin: type.startsWith('builtin/'), manifest: normalizeWidget(raw) };
  }
  types() {
    const out = [];
    for (const [kind, dir] of [['builtin', this.builtinDir], ['user', this.userDir]]) {
      let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) {}
      for (const n of names.sort()) {
        if (!/^[a-z0-9-]+$/.test(n)) continue; const w = this.read(`${kind}/${n}`); if (!w) continue;
        out.push({ type: w.type, builtin: w.builtin, name: w.manifest.name, description: w.manifest.description, size: w.manifest.size, permissions: w.manifest.permissions.map((p) => ({ id: p, text: permissionText(p) })), settings: w.manifest.settings, tags: w.manifest.tags, author: w.manifest.author || '' });
      }
    }
    return out;
  }
  uniqueDir(name) { const base = slugify(name); let s = base, i = 2; while (fs.existsSync(path.join(this.userDir, s))) s = `${base}-${i++}`; const dir = path.join(this.userDir, s); fs.mkdirSync(dir, { recursive: true }); return { dir, type: `user/${s}` }; }
  /** Make or replace a widget type. files: { 'index.html': '…', … }. Saving a built-in makes your own copy. */
  saveType(type, manifest, files = {}) {
    const m = normalizeWidget(manifest);
    let target = type;
    if (!type || type.startsWith('builtin/')) {
      const src = type && this.dirOf(type); const made = this.uniqueDir(m.name); target = made.type;
      if (src && fs.existsSync(src)) copyDir(src, made.dir);
    }
    for (const [rel, text] of Object.entries(files)) { const f = this.fileOf(target, rel); if (!f) throw new Error('Bad file name ' + rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
    fs.writeFileSync(path.join(this.dirOf(target), 'widget.json'), JSON.stringify(m, null, 1));
    if (!fs.existsSync(this.fileOf(target, m.page))) fs.writeFileSync(this.fileOf(target, m.page), '<!doctype html><body></body>');
    return target;
  }
  removeType(type, trash) {
    if (!String(type).startsWith('user/')) throw new Error('Built-in widgets can’t be removed');
    this.state.instances = this.state.instances.filter((i) => i.type !== type); this.save();
    const dir = this.dirOf(type); return trash ? trash(dir) : fs.rmSync(dir, { recursive: true, force: true });
  }
  exportType(type, dest) {
    const dir = this.dirOf(type); if (!dir) throw new Error('Unknown widget'); const entries = [];
    const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else entries.push({ name: r, data: fs.readFileSync(p) }); } };
    walk(dir, ''); fs.writeFileSync(dest, writeZip(entries)); return dest;
  }
  /** A widget plugin: a folder with widget.json, or a .muralwidget / .zip of one. Returns the new type. */
  importPath(p) {
    const st = fs.statSync(p);
    if (st.isDirectory()) { const m = readJSON(path.join(p, 'widget.json')); if (!m) throw new Error('No widget.json in that folder'); const { dir, type } = this.uniqueDir(m.name); copyDir(p, dir); return type; }
    const entries = readZip(fs.readFileSync(p));
    const mf = entries.find((e) => e.name === 'widget.json') || entries.find((e) => /^[^/]+\/widget\.json$/.test(e.name));
    if (!mf) throw new Error('No widget.json inside');
    const root = mf.name.includes('/') ? mf.name.split('/')[0] + '/' : '';
    const m = JSON.parse(mf.data.toString('utf8')); const { dir, type } = this.uniqueDir(m.name);
    for (const e of entries) { if (root && !e.name.startsWith(root)) continue; const out = path.join(dir, e.name.slice(root.length)); if (!out.startsWith(dir + path.sep)) continue; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.data); }
    return type;
  }

  // ------------------------------------------------------------------------------------------------- instances
  instances(display = null) { return this.state.instances.filter((i) => !display || i.display === display); }
  instance(id) { return this.state.instances.find((i) => i.id === id) || (this.temps && this.temps.get(id)) || null; }
  /** An instance that's never saved: previews and the editor's live view. Its data lives in memory. */
  temp(type, settings, size, style) {
    const w = this.read(type); if (!w) throw new Error('Unknown widget ' + type);
    this.temps = this.temps || new Map(); this.tempData = this.tempData || new Map();
    const inst = { id: 't' + crypto.randomBytes(5).toString('hex'), type, display: 'preview', x: 0, y: 0, w: (size && size.w) || w.manifest.size.w, h: (size && size.h) || w.manifest.size.h, settings: { ...defaultsOf(w.manifest), ...(settings || {}) }, style: { glass: 'dark', opacity: 1, ...(style || {}) }, z: 0 };
    this.temps.set(inst.id, inst); if (this.temps.size > 40) this.temps.delete(this.temps.keys().next().value); return inst;
  }
  dropTemp(id) { if (this.temps) this.temps.delete(id); if (this.tempData) this.tempData.delete(id); }
  /** Put a widget on a display. bounds: the display's {width,height}; without x/y it finds an empty spot. */
  add(type, display, bounds, opts = {}) {
    const w = this.read(type); if (!w) throw new Error('Unknown widget ' + type);
    const size = { w: opts.w || w.manifest.size.w, h: opts.h || w.manifest.size.h };
    const spot = opts.x != null && opts.y != null ? { x: opts.x, y: opts.y } : this.freeSpot(display, size, bounds);
    const inst = { placed: Date.now(), id: 'w' + crypto.randomBytes(5).toString('hex'), type, display: String(display), x: spot.x, y: spot.y, w: size.w, h: size.h, settings: { ...defaultsOf(w.manifest), ...(opts.settings || {}) }, style: { glass: 'dark', opacity: 1, ...(opts.style || {}) }, z: Date.now() };
    this.state.instances.push(inst); this.save(); return inst;
  }
  update(id, patch) {
    const i = this.instance(id); if (!i) throw new Error('No such widget on the desktop');
    if (String(id).startsWith('t')) { if (patch.settings) i.settings = { ...i.settings, ...patch.settings }; if (patch.w) i.w = patch.w; if (patch.h) i.h = patch.h; return i; }
    for (const k of ['x', 'y', 'w', 'h', 'display', 'z']) if (patch[k] != null) i[k] = k === 'display' ? String(patch[k]) : Math.round(Number(patch[k]));
    if (['x', 'y', 'w', 'h', 'display'].some((k) => patch[k] != null)) delete i.g; // re-snapped on the next arrange
    if (patch.settings) i.settings = { ...i.settings, ...patch.settings };
    if (patch.style) i.style = { ...i.style, ...patch.style };
    this.save(); return i;
  }
  remove(id) { this.state.instances = this.state.instances.filter((i) => i.id !== id); this.save(); try { fs.unlinkSync(this.dataFile(id)); } catch (_) {} return true; }
  /**
   * Where each widget on a display goes. With the grid on, every widget gets whole cells (kept in inst.g so they stay
   * put when the grid changes size), older widgets keep their place and newer ones take the nearest free spot.
   * area: the work area in display coordinates; size: small|medium|large|off. Saves any change.
   */
  arrange(display, bounds, area, size, moved = null) {
    const G = gridFor(area, size); const list = this.instances(display).slice().sort((a, b) => (a.id === moved ? 1 : 0) - (b.id === moved ? 1 : 0) || (a.placed || 0) - (b.placed || 0));
    let changed = false; const taken = [];
    for (const i of list) {
      const t = this.read(i.type); const min = t ? t.manifest.size : { minW: 0, minH: 0 };
      if (!G.on) { const c = this.clamp(i, bounds); if (c.x !== i.x || c.y !== i.y || c.w !== i.w || c.h !== i.h) { Object.assign(i, { x: c.x, y: c.y, w: c.w, h: c.h }); changed = true; } continue; }
      let want = i.g && i.g.size === size && i.id !== moved ? { col: i.g.col, row: i.g.row, cols: i.g.cols, rows: i.g.rows } : snapToGrid(i, G, min.minW, min.minH);
      want.cols = Math.min(want.cols, G.cols); want.rows = Math.min(want.rows, G.rows);
      const spot = nearestFree(want, taken, G) || want;
      taken.push(spot);
      const px = cellsToPx(spot, G);
      const g = { size, ...spot };
      if (!i.g || JSON.stringify(i.g) !== JSON.stringify(g) || i.x !== px.x || i.y !== px.y || i.w !== px.w || i.h !== px.h) { i.g = g; Object.assign(i, px); changed = true; }
      if (!i.placed) { i.placed = Date.now(); changed = true; }
    }
    if (changed) this.save();
    return G;
  }
  /** Keep a widget fully on its display (after a resolution change or a move). */
  clamp(inst, bounds) {
    const w = Math.min(inst.w, bounds.width), h = Math.min(inst.h, bounds.height);
    const x = Math.max(0, Math.min(bounds.width - w, inst.x)), y = Math.max(0, Math.min(bounds.height - h, inst.y));
    return { ...inst, x, y, w, h };
  }
  /** First free spot scanning from the top right, on a 24 px grid, leaving room for the menu bar / edges. */
  freeSpot(display, size, bounds) {
    const W = (bounds && bounds.width) || 1440, H = (bounds && bounds.height) || 900, pad = 24, top = 48;
    const others = this.instances(display);
    const hit = (x, y) => others.some((o) => x < o.x + o.w + 12 && x + size.w + 12 > o.x && y < o.y + o.h + 12 && y + size.h + 12 > o.y);
    for (let x = W - size.w - pad; x >= pad; x -= 24) for (let y = top; y + size.h <= H - pad; y += 24) if (!hit(x, y)) return { x, y };
    return { x: Math.max(0, W - size.w - pad), y: top };
  }

  // ------------------------------------------------------------------------------------------------- per-widget data
  dataFile(id) { return path.join(this.storeDir, String(id).replace(/[^a-z0-9]/gi, '') + '.json'); }
  getData(id) { if (String(id).startsWith('t')) return { ...((this.tempData && this.tempData.get(id)) || {}) }; return readJSON(this.dataFile(id)) || {}; }
  setData(id, key, value) {
    if (String(id).startsWith('t')) { const d = this.getData(id); if (value == null) delete d[key]; else d[String(key)] = value; this.tempData.set(id, d); return true; }
    const d = this.getData(id); if (value === undefined || value === null) delete d[key]; else d[String(key)] = value;
    const s = JSON.stringify(d); if (s.length > 2 * 1024 * 1024) throw new Error('Widget storage is limited to 2 MB');
    fs.writeFileSync(this.dataFile(id), s); return true;
  }
}

module.exports = { Widgets, normalizeWidget, permissionText, PERMISSIONS, defaultsOf, gridFor, snapToGrid, cellsToPx, nearestFree, GRID_SIZES };

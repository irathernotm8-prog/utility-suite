// Dither — the sprite editor: pencil, eraser, fill, line, box, ellipse, dither brush, picker and move; mirror drawing,
// layers, a frame timeline with onion skin, a palette, undo, and autosave. Claude edits the same documents through
// the plugin, so changes from either side show up in the other.
'use strict';

const E = { tex: { kind: 'stone', scale: 4, size: 8 }, tiled: false, s: null, fi: 0, li: null, tool: 'pencil', c1: null, c2: null, zoom: 12, ox: 0, oy: 0, grid: true, onion: true, mirror: false, fillShapes: false, brush: 1, level: 0.5, undo: [], redo: [], saveT: null, drag: null, hover: null, previewP: null, cv: null };
const TOOLS = [['pencil', 'Pencil', 'B'], ['eraser', 'Eraser', 'E'], ['fill', 'Fill', 'G'], ['line', 'Line', 'L'], ['rect', 'Box', 'R'], ['ellipse', 'Ellipse', 'O'], ['dither', 'Dither brush', 'D'], ['picker', 'Pick colour', 'I'], ['move', 'Move', 'V'], ['texture', 'Texture brush', 'T']];
const TOOL_ICON = { pencil: 'pencil', eraser: 'eraser', fill: 'bucket', line: 'line', rect: 'square', ellipse: 'ellipse', dither: 'dither', picker: 'picker', move: 'move', texture: 'texture' };
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const hexOf = (d, i) => '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
const rgbOf = (h) => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

VIEWS.editor = {
  flush: true,
  head() { return `<button class="icon-btn" id="edBack" title="Sprites">${icon('back', 18)}</button><input class="title-input" id="edName" spellcheck="false"><span class="pill" id="edSize"></span><span class="save-state" id="edState"></span>`; },
  actions() { return `<button class="icon-btn" id="edUndo" title="Undo">${icon('undo', 17)}</button><button class="icon-btn" id="edRedo" title="Redo">${icon('redo', 17)}</button><button class="btn" id="edShade">${icon('sun', 15)}Shade</button><button class="btn" id="edCrit">${icon('critic', 15)}Critique</button><button class="btn" id="edAsk">${icon('chat', 15)}Ask Claude</button><button class="btn" id="edExport">${icon('export', 15)}Export</button><button class="btn" id="edMore">${icon('more', 15)}</button>`; },
  async render(view) {
    view.innerHTML = `<div class="editor"><div class="ed-tools" id="edTools"></div><div class="ed-center"><div class="ed-canvas" id="edCanvas"><canvas></canvas><div class="crit" id="edCrit2" hidden></div></div>
      <div class="ed-opts" id="edOpts"></div>
      <div class="timeline"><div class="tl-head"><span class="label">Frames</span><button class="icon-btn xs" id="tlAdd" title="New frame">${icon('plus', 14)}</button><button class="icon-btn xs" id="tlDup" title="Duplicate frame (N)">${icon('dup', 14)}</button><button class="icon-btn xs" id="tlDel" title="Delete frame">${icon('trash', 14)}</button><button class="icon-btn xs" id="tlLeft" title="Move left">${icon('back', 14)}</button><button class="icon-btn xs" id="tlRight" title="Move right">${icon('chevron', 14)}</button><span class="grow"></span><button class="btn xs ghost" id="tlTiming">${icon('clock', 13)}Timing</button><button class="icon-btn xs ${E.onion ? 'on' : ''}" id="tlOnion" title="Onion skin">${icon('onion', 15)}</button></div><div class="tl-frames" id="tlFrames"></div></div></div>
      <div class="ed-side"><div class="panel"><div class="panel-h">Preview<span class="grow"></span><span class="muted tiny tnum" id="pvInfo"></span></div><div class="ed-preview" id="edPreview"><canvas></canvas></div></div>
        <div class="panel"><div class="panel-h">Colour<span class="grow"></span><button class="icon-btn xs" id="palMenu" title="Palette">${icon('more', 14)}</button></div><div class="cur-colors"><button class="cc c1" id="cc1" title="Left button"></button><button class="cc c2" id="cc2" title="Right button"></button><button class="icon-btn xs" id="ccSwap" title="Swap (X)">${icon('refresh', 13)}</button><span class="grow"></span><span class="mono tiny" id="ccHex"></span></div><div class="palette" id="edPal"></div></div>
        <div class="panel grow-panel"><div class="panel-h">Layers<span class="grow"></span><button class="icon-btn xs" id="lyAdd" title="New layer">${icon('plus', 14)}</button></div><div class="layers" id="edLayers"></div></div></div></div>`;
    try { E.s = await call('sprites:get', S.arg); } catch (e) { view.innerHTML = `<div class="empty"><b>Couldn’t open that sprite</b><span>${esc(e.message)}</span></div>`; return; }
    E.fi = Math.min(E.fi, E.s.frames.length - 1); if (S.arg !== E.forId) { E.fi = 0; E.undo = []; E.redo = []; E.forId = S.arg; E.c1 = null; E.crit = null; }
    E.li = E.s.layers.some((l) => l.id === E.li) ? E.li : E.s.layers[E.s.layers.length - 1].id;
    if (!E.c1) { E.c1 = E.s.palette[Math.min(E.s.palette.length - 1, 7)] || '#ffffff'; E.c2 = E.s.palette[0] || '#000000'; }
    $('#edName').value = E.s.name; fitTitles(); $('#edSize').textContent = `${E.s.w}×${E.s.h}`;
    E.cv = $('#edCanvas canvas'); E.previewP = new Player($('#edPreview canvas'), { pad: 8, max: 8, bg: 'checker' });
    E.tileGrid = Math.max(E.s.w, E.s.h) > 256 ? (Math.max(E.s.w, E.s.h) <= 768 ? 128 : 256) : 0; E.dirty = true; E.onionKey = null;
    drawTools(); fitZoom(); drawOpts(); drawPalette(); drawLayers(); drawTimeline(); paint(); updatePreview(true); wireEditor();
    E.ro = new ResizeObserver(() => paint()); E.ro.observe($('#edCanvas'));
  },
  leave() { if (E.saveT) { clearTimeout(E.saveT); saveSprite(); } if (E.ro) E.ro.disconnect(); window.removeEventListener('keydown', edKeys); },
};

// ───────── document helpers
const layer = () => E.s.layers.find((l) => l.id === E.li);
const frame = () => E.s.frames[E.fi];
const key = (lid, fid) => `${lid}/${fid}`;
function cel(lid = E.li, fid = frame().id, create = true) { const k = key(lid, fid); let c = E.s.cels[k]; if (!c && create) { c = new Uint8ClampedArray(E.s.w * E.s.h * 4); E.s.cels[k] = c; } return c; }
function compose(fi, { skipHidden = true } = {}) {
  const out = new Uint8ClampedArray(E.s.w * E.s.h * 4); const f = E.s.frames[fi]; if (!f) return out;
  for (const l of E.s.layers) { if (skipHidden && !l.visible) continue; const c = E.s.cels[key(l.id, f.id)]; if (!c) continue; for (let i = 0; i < c.length; i += 4) if (c[i + 3]) { out[i] = c[i]; out[i + 1] = c[i + 1]; out[i + 2] = c[i + 2]; out[i + 3] = 255; } }
  return out;
}
function markDirty(x0, y0, x1, y1) { const d = E.dirty; if (d === true) return; if (!d) E.dirty = [x0, y0, x1, y1]; else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); } }
function setPx(c, x, y, rgb) { if (x < 0 || y < 0 || x >= E.s.w || y >= E.s.h) return; markDirty(x, y, x, y); const i = (y * E.s.w + x) * 4; if (!rgb) { c[i + 3] = 0; c[i] = c[i + 1] = c[i + 2] = 0; return; } c[i] = rgb[0]; c[i + 1] = rgb[1]; c[i + 2] = rgb[2]; c[i + 3] = 255; }
function plot(c, x, y, rgb, { brush = E.brush, dither = false } = {}) {
  const r = Math.floor((brush - 1) / 2); const pts = [];
  for (let dy = -r; dy < brush - r; dy++) for (let dx = -r; dx < brush - r; dx++) pts.push([x + dx, y + dy]);
  for (const [px, py] of pts) {
    if (dither && !((BAYER4[((py & 3) << 2) | (px & 3)] + 0.5) / 16 < E.level)) continue;
    setPx(c, px, py, rgb); if (E.mirror) setPx(c, E.s.w - 1 - px, py, rgb);
  }
}
function lineTo(c, x0, y0, x1, y1, rgb, o) { const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1; let err = dx + dy; for (;;) { plot(c, x0, y0, rgb, o); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } } }
function shape(c, kind, x0, y0, x1, y1, rgb) {
  const ax = Math.min(x0, x1), ay = Math.min(y0, y1), bx = Math.max(x0, x1), by = Math.max(y0, y1);
  if (kind === 'line') return lineTo(c, x0, y0, x1, y1, rgb, { brush: E.brush });
  if (kind === 'rect') { if (E.fillShapes) { for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) plot(c, x, y, rgb, { brush: 1 }); } else { lineTo(c, ax, ay, bx, ay, rgb); lineTo(c, ax, by, bx, by, rgb); lineTo(c, ax, ay, ax, by, rgb); lineTo(c, bx, ay, bx, by, rgb); } return; }
  // ellipse inside the box (pixel-centre test, outline = inside but with an outside neighbour)
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { if (!inside(x, y)) continue; if (E.fillShapes || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) plot(c, x, y, rgb, { brush: 1 }); }
}
function flood(c, x, y, rgb) {
  const w = E.s.w, h = E.s.h; if (x < 0 || y < 0 || x >= w || y >= h) return; const i0 = (y * w + x) * 4; const t = [c[i0], c[i0 + 1], c[i0 + 2], c[i0 + 3]];
  const same = (i) => (t[3] === 0 ? c[i + 3] === 0 : c[i + 3] && c[i] === t[0] && c[i + 1] === t[1] && c[i + 2] === t[2]);
  if (rgb && t[3] && rgb[0] === t[0] && rgb[1] === t[1] && rgb[2] === t[2]) return; if (!rgb && !t[3]) return;
  const seen = new Uint8Array(w * h); const st = [x, y];
  while (st.length) { const yy = st.pop(), xx = st.pop(); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = yy * w + xx; if (seen[k] || !same(k * 4)) continue; seen[k] = 1; setPx(c, xx, yy, rgb); st.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1); }
}

// ───────── undo
function snapCel() { const c = cel(); return { kind: 'cel', k: key(E.li, frame().id), before: c.slice() }; }
function pushUndo(u) { if (u.kind === 'cel' && u.before.length) u = diffCel(u); if (!u) return; E.undo.push(u); let bytes = 0; for (let i = E.undo.length - 1; i >= 0; i--) { bytes += undoBytes(E.undo[i]); if (bytes > 400e6 || E.undo.length - i > 120) { E.undo.splice(0, i + 1); break; } } E.redo = []; }
// a cel undo keeps only the box that changed (big canvases would otherwise copy megabytes per stroke)
function diffCel(u) { const cur = E.s.cels[u.k] || new Uint8ClampedArray(E.s.w * E.s.h * 4), b = u.before, w = E.s.w, h = E.s.h; let x0 = w, y0 = h, x1 = -1, y1 = -1; const a32 = new Uint32Array(b.buffer, b.byteOffset, w * h), c32 = new Uint32Array(cur.buffer, cur.byteOffset, w * h); for (let y = 0; y < h; y++) { const r = y * w; for (let x = 0; x < w; x++) if (a32[r + x] !== c32[r + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } } if (x1 < 0) return null; return { kind: 'box', k: u.k, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, before: cropCel(b, x0, y0, x1 - x0 + 1, y1 - y0 + 1) }; }
function cropCel(c, x, y, w, h) { const o = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) o.set(c.subarray(((y + j) * E.s.w + x) * 4, ((y + j) * E.s.w + x + w) * 4), j * w * 4); return o; }
function pasteCel(c, box, data) { for (let j = 0; j < box.h; j++) c.set(data.subarray(j * box.w * 4, (j + 1) * box.w * 4), ((box.y + j) * E.s.w + box.x) * 4); }
function undoBytes(u) { if (u.kind === 'doc') return Object.values(u.before.cels).reduce((a, c) => a + c.length, 0); return u.before ? u.before.length : 0; }
function snapDoc() { return { kind: 'doc', before: cloneDoc() }; }
function cloneDoc() { const cels = {}; for (const [k, v] of Object.entries(E.s.cels)) cels[k] = v.slice(); return { ...JSON.parse(JSON.stringify({ ...E.s, cels: {} })), cels }; }
function undo(dir = -1) {
  const from = dir < 0 ? E.undo : E.redo, to = dir < 0 ? E.redo : E.undo; const u = from.pop(); if (!u) return;
  if (u.kind === 'box') { let c = E.s.cels[u.k]; if (!c) c = E.s.cels[u.k] = new Uint8ClampedArray(E.s.w * E.s.h * 4); const cur = cropCel(c, u.x, u.y, u.w, u.h); pasteCel(c, u, u.before); to.push({ ...u, before: cur }); }
  else if (u.kind === 'cel') { const cur = E.s.cels[u.k] ? E.s.cels[u.k].slice() : new Uint8ClampedArray(E.s.w * E.s.h * 4); E.s.cels[u.k] = u.before; to.push({ kind: 'cel', k: u.k, before: cur }); }
  else { const cur = cloneDoc(); E.s = u.before; to.push({ kind: 'doc', before: cur }); E.fi = Math.min(E.fi, E.s.frames.length - 1); if (!E.s.layers.some((l) => l.id === E.li)) E.li = E.s.layers[E.s.layers.length - 1].id; drawLayers(); drawPalette(); }
  changedDoc(true);
}

// ───────── painting the canvas
const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48];
function fitZoom() { const box = $('#edCanvas').getBoundingClientRect(); const f = Math.min((box.width - 60) / E.s.w, (box.height - 40) / E.s.h); E.zoom = f >= 1 ? Math.min(48, Math.floor(f)) : ZOOMS.filter((z) => z <= f).pop() || 0.125; E.ox = Math.round((box.width - E.s.w * E.zoom) / 2); E.oy = Math.round((box.height - E.s.h * E.zoom) / 2); }
const tmpCv = document.createElement('canvas');
function toCanvas(data) { tmpCv.width = E.s.w; tmpCv.height = E.s.h; tmpCv.getContext('2d').putImageData(new ImageData(data, E.s.w, E.s.h), 0, 0); return tmpCv; }
// big canvases: the composite of the current frame lives in its own canvas and only the box that changed is redrawn;
// the checkerboard is a pattern and the grid only covers what's on screen
const compCv = document.createElement('canvas'), onionCv = document.createElement('canvas'), prevCv = document.createElement('canvas');
function composeRect(fi, x0, y0, w, h) {
  const out = new Uint8ClampedArray(w * h * 4); const f = E.s.frames[fi]; if (!f) return out; const W = E.s.w;
  for (const l of E.s.layers) { if (!l.visible) continue; const c = E.s.cels[key(l.id, f.id)]; if (!c) continue; for (let j = 0; j < h; j++) { let si = ((y0 + j) * W + x0) * 4, di = j * w * 4; for (let i = 0; i < w; i++, si += 4, di += 4) if (c[si + 3]) { out[di] = c[si]; out[di + 1] = c[si + 1]; out[di + 2] = c[si + 2]; out[di + 3] = 255; } } }
  return out;
}
function invalidate() { E.dirty = true; E.onionKey = null; }
function refreshComp() {
  const key2 = `${E.s.id}/${E.s.w}x${E.s.h}/${E.fi}`; if (E.compKey !== key2) { E.compKey = key2; E.dirty = true; }
  if (compCv.width !== E.s.w || compCv.height !== E.s.h) { compCv.width = E.s.w; compCv.height = E.s.h; E.dirty = true; }
  const d = E.dirty; if (!d) return; const x = d === true ? 0 : Math.max(0, d[0]), y = d === true ? 0 : Math.max(0, d[1]), w = d === true ? E.s.w : Math.min(E.s.w, d[2] + 1) - x, h = d === true ? E.s.h : Math.min(E.s.h, d[3] + 1) - y;
  if (w > 0 && h > 0) compCv.getContext('2d').putImageData(new ImageData(composeRect(E.fi, x, y, w, h), w, h), x, y); E.dirty = null;
}
function paint() {
  const host = $('#edCanvas'); if (!host || !E.s) return; const cv = E.cv; const dpr = devicePixelRatio || 1; const box = host.getBoundingClientRect();
  if (cv.width !== Math.round(box.width * dpr) || cv.height !== Math.round(box.height * dpr)) { cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr); cv.style.width = box.width + 'px'; cv.style.height = box.height + 'px'; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false; c.clearRect(0, 0, box.width, box.height);
  const z = E.zoom, W = E.s.w * z, H = E.s.h * z, X = E.ox, Y = E.oy;
  const st = getComputedStyle(document.documentElement); const ca = st.getPropertyValue('--check-a').trim(), cb = st.getPropertyValue('--check-b').trim();
  const sz = Math.max(4, Math.min(16, z)); const pk = `${ca}${cb}${sz}`; if (E.patKey !== pk) { const t = document.createElement('canvas'); t.width = t.height = sz * 2; const tc = t.getContext('2d'); tc.fillStyle = ca; tc.fillRect(0, 0, sz * 2, sz * 2); tc.fillStyle = cb; tc.fillRect(sz, 0, sz, sz); tc.fillRect(0, sz, sz, sz); E.pat = c.createPattern(t, 'repeat'); E.patKey = pk; }
  const vx0 = Math.max(X, 0), vy0 = Math.max(Y, 0), vx1 = Math.min(X + W, box.width), vy1 = Math.min(Y + H, box.height);
  c.save(); c.translate(X, Y); c.fillStyle = E.pat; c.fillRect(vx0 - X, vy0 - Y, Math.max(0, vx1 - vx0), Math.max(0, vy1 - vy0)); c.restore();
  if (E.tiled) { refreshComp(); c.globalAlpha = 0.35; for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) c.drawImage(compCv, X + dx * W, Y + dy * H, W, H); c.globalAlpha = 1; }
  if (E.onion && E.s.frames.length > 1) { const prev = (E.fi - 1 + E.s.frames.length) % E.s.frames.length; const ok = `${E.s.id}/${prev}/${E.s.w}x${E.s.h}`; if (E.onionKey !== ok) { onionCv.width = E.s.w; onionCv.height = E.s.h; onionCv.getContext('2d').putImageData(new ImageData(composeRect(prev, 0, 0, E.s.w, E.s.h), E.s.w, E.s.h), 0, 0); E.onionKey = ok; } c.globalAlpha = 0.25; c.drawImage(onionCv, X, Y, W, H); c.globalAlpha = 1; }
  refreshComp(); c.drawImage(compCv, X, Y, W, H);
  if (E.drag && E.drag.preview) { const p = E.drag.preview, b = E.drag.pbox; if (b) { prevCv.width = b[2]; prevCv.height = b[3]; const d = new Uint8ClampedArray(b[2] * b[3] * 4); for (let j = 0; j < b[3]; j++) d.set(p.subarray(((b[1] + j) * E.s.w + b[0]) * 4, ((b[1] + j) * E.s.w + b[0] + b[2]) * 4), j * b[2] * 4); prevCv.getContext('2d').putImageData(new ImageData(d, b[2], b[3]), 0, 0); c.drawImage(prevCv, X + b[0] * z, Y + b[1] * z, b[2] * z, b[3] * z); } }
  if (E.grid && z >= 6) { c.strokeStyle = 'rgba(140,135,160,.16)'; c.lineWidth = 1; c.beginPath(); const gx0 = Math.max(1, Math.floor((vx0 - X) / z)), gx1 = Math.min(E.s.w - 1, Math.ceil((vx1 - X) / z)), gy0 = Math.max(1, Math.floor((vy0 - Y) / z)), gy1 = Math.min(E.s.h - 1, Math.ceil((vy1 - Y) / z)); for (let x = gx0; x <= gx1; x++) { c.moveTo(X + x * z + 0.5, vy0); c.lineTo(X + x * z + 0.5, vy1); } for (let y = gy0; y <= gy1; y++) { c.moveTo(vx0, Y + y * z + 0.5); c.lineTo(vx1, Y + y * z + 0.5); } c.stroke(); }
  if (E.tileGrid && E.tileGrid * z >= 8) { c.strokeStyle = 'rgba(255,111,125,.35)'; c.beginPath(); for (let x = E.tileGrid; x < E.s.w; x += E.tileGrid) { c.moveTo(X + x * z + 0.5, vy0); c.lineTo(X + x * z + 0.5, vy1); } for (let y = E.tileGrid; y < E.s.h; y += E.tileGrid) { c.moveTo(vx0, Y + y * z + 0.5); c.lineTo(vx1, Y + y * z + 0.5); } c.stroke(); }
  if (E.mirror) { c.strokeStyle = 'rgba(255,111,125,.55)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(X + W / 2 + 0.5, Y); c.lineTo(X + W / 2 + 0.5, Y + H); c.stroke(); c.setLineDash([]); }
  c.strokeStyle = 'rgba(140,135,160,.35)'; c.strokeRect(X - 0.5, Y - 0.5, W + 1, H + 1);
  if (E.crit) for (const it of E.crit.issues) { if (it.x == null || (it.frame && it.frame !== E.fi + 1 && E.crit.frames > 1)) continue; const col = it.severity === 'major' ? '255,64,120' : '255,200,64'; const on = E.crit.focus === it.n; c.strokeStyle = `rgba(${col},${on ? 1 : 0.85})`; c.lineWidth = on ? 3 : 2; c.strokeRect(X + it.x * z - 2, Y + it.y * z - 2, (it.w || 1) * z + 4, (it.h || 1) * z + 4); c.fillStyle = `rgb(${col})`; c.font = '700 10px -apple-system, Segoe UI, sans-serif'; const t = String(it.n), tw = c.measureText(t).width + 6; c.fillRect(X + it.x * z - 2, Y + it.y * z - 15, tw, 13); c.fillStyle = '#1a0a14'; c.fillText(t, X + it.x * z + 1, Y + it.y * z - 5); c.lineWidth = 1; }
  if (E.hover && !E.drag && ['pencil', 'eraser', 'dither'].includes(E.tool)) { const r = Math.floor((E.brush - 1) / 2); c.strokeStyle = 'rgba(255,255,255,.8)'; c.strokeRect(X + (E.hover[0] - r) * z + 0.5, Y + (E.hover[1] - r) * z + 0.5, E.brush * z - 1, E.brush * z - 1); }
}

// ───────── pointer
function cellAt(e) { const r = E.cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left - E.ox) / E.zoom), Math.floor((e.clientY - r.top - E.oy) / E.zoom)]; }
function onDown(e) {
  if (e.button === 1 || E.space) { E.drag = { pan: true, x: e.clientX, y: e.clientY, ox: E.ox, oy: E.oy }; return; }
  const [x, y] = cellAt(e); const right = e.button === 2; const rgb = right ? (E.c2 ? rgbOf(E.c2) : null) : rgbOf(E.c1);
  const tool = e.altKey ? 'picker' : E.tool; if (!layer().visible && tool !== 'picker') { toast('That layer is hidden', 'Show it to draw on it', 'info', 2500); return; }
  if (tool === 'picker') { const comp = compose(E.fi); const i = (y * E.s.w + x) * 4; if (x >= 0 && y >= 0 && x < E.s.w && y < E.s.h && comp[i + 3]) { if (right) E.c2 = hexOf(comp, i); else E.c1 = hexOf(comp, i); drawPalette(); } return; }
  const u = snapCel(); const c = cel();
  if (tool === 'fill') { flood(c, x, y, rgb); pushUndo(u); changedDoc(); return; }
  if (tool === 'pencil' || tool === 'eraser' || tool === 'dither') { const col = tool === 'eraser' ? null : rgb; plot(c, x, y, col, { dither: tool === 'dither' }); E.drag = { tool, u, last: [x, y], col }; paint(); return; }
  if (tool === 'move') { E.drag = { tool, u, start: [x, y], base: c.slice() }; return; }
  if (tool === 'texture') { const d = E.drag = { tool, u, pts: [[x, y]], tex: null }; call('kit:texture', c.slice(), E.s.w, E.s.h, { kind: E.tex.kind, scale: E.tex.scale, seed: 7 }).then((r) => { d.tex = new Uint8ClampedArray(r.data); d.used = new Set(); let prev = null; for (const p of d.pts) { stampTex(d, prev || p, p); prev = p; } d.last = prev; paint(); if (!E.drag) finishTex(d); }).catch(fail); return; }
  E.drag = { tool, u, start: [x, y], rgb, preview: new Uint8ClampedArray(E.s.w * E.s.h * 4), pbox: shapeBox([x, y], [x, y]) }; const sd = E.dirty; shape(E.drag.preview, tool, x, y, x, y, rgb || [0, 0, 0]); E.dirty = sd; paint();
}
function onMove(e) {
  const [x, y] = cellAt(e); const d = E.drag;
  if (!d) { const h = x >= 0 && y >= 0 && x < E.s.w && y < E.s.h ? [x, y] : null; if (String(h) !== String(E.hover)) { E.hover = h; paint(); } $('#edPos').textContent = h ? `${x}, ${y}` : ''; return; }
  if (d.pan) { E.ox = d.ox + e.clientX - d.x; E.oy = d.oy + e.clientY - d.y; paint(); return; }
  if (d.tool === 'pencil' || d.tool === 'eraser' || d.tool === 'dither') { lineTo(cel(), d.last[0], d.last[1], x, y, d.col, { dither: d.tool === 'dither' }); d.last = [x, y]; paint(); return; }
  if (d.tool === 'texture') { if (d.tex) { stampTex(d, d.last || [x, y], [x, y]); d.last = [x, y]; paint(); } else d.pts.push([x, y]); return; }
  if (d.tool === 'move') { const c = cel(); const dx = x - d.start[0], dy = y - d.start[1]; c.fill(0); for (let yy = 0; yy < E.s.h; yy++) for (let xx = 0; xx < E.s.w; xx++) { const X = xx + dx, Y = yy + dy; if (X < 0 || Y < 0 || X >= E.s.w || Y >= E.s.h) continue; const a = (yy * E.s.w + xx) * 4, b = (Y * E.s.w + X) * 4; c[b] = d.base[a]; c[b + 1] = d.base[a + 1]; c[b + 2] = d.base[a + 2]; c[b + 3] = d.base[a + 3]; } E.dirty = true; paint(); return; }
  let [x1, y1] = [x, y]; if (e.shiftKey && d.tool !== 'line') { const s = Math.max(Math.abs(x - d.start[0]), Math.abs(y - d.start[1])); x1 = d.start[0] + Math.sign(x - d.start[0] || 1) * s; y1 = d.start[1] + Math.sign(y - d.start[1] || 1) * s; }
  d.end = [x1, y1]; const ob = d.pbox; d.pbox = shapeBox(d.start, [x1, y1]); if (ob) for (let j = ob[1]; j < ob[1] + ob[3]; j++) d.preview.fill(0, (j * E.s.w + ob[0]) * 4, (j * E.s.w + ob[0] + ob[2]) * 4); const sd = E.dirty; shape(d.preview, d.tool, d.start[0], d.start[1], x1, y1, d.rgb || [0, 0, 0]); E.dirty = sd; paint();
}
function shapeBox(a, b) { const r = E.brush + 1, x0 = Math.max(0, Math.min(a[0], b[0]) - r), y0 = Math.max(0, Math.min(a[1], b[1]) - r), x1 = Math.min(E.s.w - 1, Math.max(a[0], b[0]) + r), y1 = Math.min(E.s.h - 1, Math.max(a[1], b[1]) + r); return [x0, y0, Math.max(1, x1 - x0 + 1), Math.max(1, y1 - y0 + 1)]; }
function stampTex(d, a, b) { const c = cel(), r = Math.floor(E.tex.size / 2), w = E.s.w, steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, r / 2))); for (let k = 0; k <= steps; k++) { const cx = Math.round(a[0] + (b[0] - a[0]) * k / steps), cy = Math.round(a[1] + (b[1] - a[1]) * k / steps); for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) { if (x < 0 || y < 0 || x >= w || y >= E.s.h || (x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 > r * r) continue; const i = (y * w + x) * 4; if (!c[i + 3]) continue; if (c[i] !== d.tex[i] || c[i + 1] !== d.tex[i + 1] || c[i + 2] !== d.tex[i + 2]) d.used.add(hexOf(d.tex, i)); c[i] = d.tex[i]; c[i + 1] = d.tex[i + 1]; c[i + 2] = d.tex[i + 2]; markDirty(x, y, x, y); } } }
function finishTex(d) { for (const col of d.used || []) if (!E.s.palette.includes(col) && E.s.palette.length < 256) E.s.palette.push(col); pushUndo(d.u); drawPalette(); changedDoc(); }
function onUp() {
  const d = E.drag; E.drag = null; if (!d || d.pan) return;
  if (d.tool === 'texture') { if (d.tex) finishTex(d); return; }
  if (['line', 'rect', 'ellipse'].includes(d.tool)) { const [x1, y1] = d.end || d.start; shape(cel(), d.tool, d.start[0], d.start[1], x1, y1, d.rgb); }
  pushUndo(d.u); changedDoc();
}

// ───────── after any change: repaint, thumbnails, preview, autosave
function changedDoc(structural) { invalidate(); if (E.crit && !E.crit.stale) { E.crit.stale = true; drawCrit(); } paint(); if (structural) drawTimeline(); else drawThumb(E.fi); updatePreview(); setEdState('Editing…'); clearTimeout(E.saveT); E.saveT = setTimeout(saveSprite, 600); }
async function saveSprite() { E.saveT = null; if (!E.s) return; try { E.s.updatedAt = Date.now(); E.savedAt = Date.now(); await call('sprites:save', E.s); setEdState('Saved'); } catch (e) { setEdState('Not saved'); fail(e); } }
function setEdState(t) { const el = $('#edState'); if (el) el.textContent = t; }
let pvT = null; function updatePreview(now) { clearTimeout(pvT); pvT = setTimeout(() => { if (!E.previewP || !E.s) return; const sm = smallSize(160); E.previewP.set(E.s.frames.map((_, i) => composeSmall(i, sm)), { w: sm.w, h: sm.h, durations: E.s.frames.map((f) => f.duration), loop: true }); $('#pvInfo').textContent = `${E.s.frames.length} fr · ${E.s.frames.reduce((a, f) => a + f.duration, 0)} ms`; }, now ? 0 : 150); }

// ───────── panels
function drawTools() {
  $('#edTools').innerHTML = TOOLS.map(([k, l, s]) => `<button class="tool ${E.tool === k ? 'on' : ''}" data-tool="${k}" title="${l} (${s})">${icon(TOOL_ICON[k], 18)}</button>`).join('') + `<div class="tool-sep"></div><button class="tool ${E.mirror ? 'on' : ''}" id="tMirror" title="Mirror drawing (M)">${icon('mirror', 18)}</button><button class="tool ${E.grid ? 'on' : ''}" id="tGridE" title="Pixel grid">${icon('grid', 18)}</button><button class="tool ${E.tiled ? 'on' : ''}" id="tTiled" title="Tile preview: show the sprite repeated around itself (for seamless tiles)">${icon('repeat', 18)}</button><div class="tool-sep"></div><button class="tool" id="tZin" title="Zoom in (+)">${icon('zoomIn', 18)}</button><button class="tool" id="tZout" title="Zoom out (−)">${icon('zoomOut', 18)}</button><button class="tool tiny-t" id="tFit" title="Fit (0)">fit</button>`;
  $$('[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  $('#tMirror').onclick = () => { E.mirror = !E.mirror; drawTools(); paint(); }; $('#tGridE').onclick = () => { E.grid = !E.grid; drawTools(); paint(); }; $('#tTiled').onclick = () => { E.tiled = !E.tiled; drawTools(); paint(); };
  $('#tZin').onclick = () => zoomBy(1); $('#tZout').onclick = () => zoomBy(-1); $('#tFit').onclick = () => { fitZoom(); drawOpts(); paint(); };
}
function setTool(t) { E.tool = t; drawTools(); drawOpts(); }
function drawOpts() {
  const shapeT = ['rect', 'ellipse'].includes(E.tool), brushT = ['pencil', 'eraser', 'dither', 'line'].includes(E.tool);
  $('#edOpts').innerHTML = `<span class="eo-tool">${icon(TOOL_ICON[E.tool], 14)}${TOOLS.find((t) => t[0] === E.tool)[1]}</span>
    ${brushT ? `<span class="eo-l">Size</span><div class="seg sm">${[1, 2, 3, 4].map((n) => `<button data-b="${n}" class="${E.brush === n ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
    ${E.tool === 'dither' ? `<span class="eo-l">Density</span><input type="range" id="eoLvl" min="0.0625" max="1" step="0.0625" value="${E.level}"><span class="tnum small" id="eoLvlV">${Math.round(E.level * 16)}/16</span>` : ''}
    ${shapeT ? `<label class="chk"><input type="checkbox" id="eoFill" ${E.fillShapes ? 'checked' : ''}> Filled</label><span class="muted tiny">Shift for square/circle</span>` : ''}
    ${E.tool === 'texture' ? `<span class="eo-l">Pattern</span><select class="select sm" id="eoTex">${Object.keys(TEXKINDS).map((k) => `<option value="${k}" ${E.tex.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select><span class="eo-l">Scale</span><input type="range" id="eoTexS" min="2" max="12" step="1" value="${E.tex.scale}"><span class="eo-l">Brush</span><div class="seg sm">${[4, 8, 16, 32].map((n) => `<button data-tb="${n}" class="${E.tex.size === n ? 'on' : ''}">${n}</button>`).join('')}</div><span class="muted tiny">Paints the pattern in each colour’s own ramp</span>` : ''}${E.tool === 'move' ? `<span class="muted tiny">Drag to move this layer’s pixels</span>` : ''}${E.tool === 'picker' ? `<span class="muted tiny">Alt-click picks with any tool</span>` : ''}
    <span class="grow"></span><span class="muted tiny tnum" id="edPos"></span><span class="muted tiny tnum">${E.zoom < 1 ? Math.round(E.zoom * 100) + '%' : E.zoom + '×'}</span>`;
  $$('#edOpts [data-b]').forEach((b) => b.onclick = () => { E.brush = +b.dataset.b; drawOpts(); });
  const lv = $('#eoLvl'); if (lv) lv.oninput = () => { E.level = +lv.value; $('#eoLvlV').textContent = `${Math.round(E.level * 16)}/16`; };
  const fl = $('#eoFill'); if (fl) fl.onchange = () => { E.fillShapes = fl.checked; };
  const tk = $('#eoTex'); if (tk) { tk.onchange = () => { E.tex.kind = tk.value; }; $('#eoTexS').oninput = (e) => { E.tex.scale = +e.target.value; }; $$('#edOpts [data-tb]').forEach((b) => (b.onclick = () => { E.tex.size = +b.dataset.tb; drawOpts(); })); }
}
function zoomBy(d, at) { const box = $('#edCanvas').getBoundingClientRect(); const old = E.zoom; const steps = ZOOMS; let i = steps.findIndex((s) => s >= old); if (i < 0) i = steps.length - 1; E.zoom = steps[Math.max(0, Math.min(steps.length - 1, i + d))]; const px = at ? at[0] : box.width / 2, py = at ? at[1] : box.height / 2; E.ox = Math.round(px - (px - E.ox) * E.zoom / old); E.oy = Math.round(py - (py - E.oy) * E.zoom / old); drawOpts(); paint(); }
function drawPalette() {
  $('#cc1').style.background = E.c1; $('#cc2').style.background = E.c2 || 'transparent'; $('#cc2').classList.toggle('clear', !E.c2); $('#ccHex').textContent = E.c1;
  $('#edPal').innerHTML = E.s.palette.map((c, i) => `<button class="sw ${c.toLowerCase() === (E.c1 || '').toLowerCase() ? 'on' : ''}${c.toLowerCase() === (E.c2 || '').toLowerCase() ? ' on2' : ''}" data-i="${i}" style="background:${c}" title="${i.toString(36)} · ${c}"></button>`).join('') + `<button class="sw add" id="palAdd" title="Add a colour">${icon('plus', 12)}</button><input type="color" id="palPick" hidden>`;
  $$('#edPal [data-i]').forEach((b) => { b.onclick = () => { E.c1 = E.s.palette[+b.dataset.i]; drawPalette(); }; b.oncontextmenu = (e) => { e.preventDefault(); E.c2 = E.s.palette[+b.dataset.i]; drawPalette(); }; b.ondblclick = () => editSwatch(+b.dataset.i); });
  $('#palAdd').onclick = () => { const p = $('#palPick'); p.value = E.c1; p.onchange = () => { pushUndo(snapDoc()); E.s.palette.push(p.value); E.c1 = p.value; drawPalette(); changedDoc(); }; p.click(); };
}
function editSwatch(i) { const p = $('#palPick'); const old = E.s.palette[i]; p.value = old; p.onchange = () => { pushUndo(snapDoc()); const nv = p.value; E.s.palette[i] = nv; const [r, g, b] = rgbOf(old), n = rgbOf(nv); for (const c of Object.values(E.s.cels)) for (let k = 0; k < c.length; k += 4) if (c[k + 3] && c[k] === r && c[k + 1] === g && c[k + 2] === b) { c[k] = n[0]; c[k + 1] = n[1]; c[k + 2] = n[2]; } if (E.c1 === old) E.c1 = nv; drawPalette(); changedDoc(true); }; p.click(); }
function drawLayers() {
  $('#edLayers').innerHTML = [...E.s.layers].reverse().map((l) => `<div class="ly ${l.id === E.li ? 'on' : ''}" data-id="${l.id}"><button class="icon-btn xs ly-eye" title="Show/hide">${icon(l.visible ? 'eye' : 'eyeOff', 14)}</button><span class="grow ellip ly-name">${esc(l.name)}</span><button class="icon-btn xs ly-more">${icon('more', 13)}</button></div>`).join('');
  $$('#edLayers .ly').forEach((el) => { const l = E.s.layers.find((x) => x.id === el.dataset.id);
    el.onclick = () => { E.li = l.id; drawLayers(); }; $('.ly-eye', el).onclick = (e) => { e.stopPropagation(); l.visible = !l.visible; drawLayers(); changedDoc(true); };
    $('.ly-name', el).ondblclick = () => renameLayer(l);
    $('.ly-more', el).onclick = (e) => { e.stopPropagation(); const i = E.s.layers.indexOf(l); menu(e.currentTarget, [{ label: 'Rename…', icon: 'edit', run: () => renameLayer(l) }, { label: 'Move up', icon: 'up', disabled: i === E.s.layers.length - 1, run: () => { pushUndo(snapDoc()); E.s.layers.splice(i, 1); E.s.layers.splice(i + 1, 0, l); drawLayers(); changedDoc(true); } }, { label: 'Move down', icon: 'down', disabled: i === 0, run: () => { pushUndo(snapDoc()); E.s.layers.splice(i, 1); E.s.layers.splice(i - 1, 0, l); drawLayers(); changedDoc(true); } }, { label: 'Duplicate', icon: 'dup', run: () => { pushUndo(snapDoc()); const n = { ...l, id: 'l' + Math.random().toString(16).slice(2, 12), name: l.name + ' copy' }; E.s.layers.splice(i + 1, 0, n); for (const f of E.s.frames) { const c = E.s.cels[key(l.id, f.id)]; if (c) E.s.cels[key(n.id, f.id)] = c.slice(); } E.li = n.id; drawLayers(); changedDoc(true); } }, '-', { label: 'Delete layer', icon: 'trash', danger: true, disabled: E.s.layers.length < 2, run: () => { pushUndo(snapDoc()); E.s.layers.splice(i, 1); for (const k of Object.keys(E.s.cels)) if (k.startsWith(l.id + '/')) delete E.s.cels[k]; E.li = E.s.layers[Math.max(0, i - 1)].id; drawLayers(); changedDoc(true); } }], { width: 200, align: 'right' }); };
  });
}
async function renameLayer(l) { const n = await promptBox({ title: 'Rename layer', value: l.name, ok: 'Rename' }); if (n) { l.name = n; drawLayers(); changedDoc(); } }
function drawTimeline() {
  const sm = smallSize(92); const s = Math.max(1, Math.floor(46 / Math.max(sm.w, sm.h))), dw = Math.min(64, sm.w * s), dh = Math.round(dw * sm.h / sm.w);
  $('#tlFrames').innerHTML = E.s.frames.map((f, i) => `<button class="tf ${i === E.fi ? 'on' : ''}" data-i="${i}"><canvas width="${sm.w}" height="${sm.h}" style="width:${dw}px;height:${dh}px"></canvas><span class="tnum">${i + 1}<em>${f.duration}ms</em></span></button>`).join('');
  $$('#tlFrames .tf').forEach((b, i) => { drawThumb(i); b.onclick = () => { E.fi = i; $$('#tlFrames .tf').forEach((x, k) => x.classList.toggle('on', k === i)); paint(); }; b.ondblclick = () => setDuration(i); });
}
function drawThumb(i) { const b = $$('#tlFrames .tf')[i]; if (!b) return; const sm = smallSize(92); const c = $('canvas', b).getContext('2d'); c.clearRect(0, 0, sm.w, sm.h); c.putImageData(new ImageData(composeSmall(i, sm), sm.w, sm.h), 0, 0); }
// thumbnails and the preview of a big sprite are nearest-neighbour shrunk copies
function smallSize(max) { const k = Math.max(1, Math.ceil(Math.max(E.s.w, E.s.h) / max)); return { k, w: Math.ceil(E.s.w / k), h: Math.ceil(E.s.h / k) }; }
function composeSmall(i, sm) { const full = compose(i); if (sm.k === 1) return full; const o = new Uint8ClampedArray(sm.w * sm.h * 4); for (let y = 0; y < sm.h; y++) for (let x = 0; x < sm.w; x++) { const si = (Math.min(E.s.h - 1, y * sm.k) * E.s.w + Math.min(E.s.w - 1, x * sm.k)) * 4; o.set(full.subarray(si, si + 4), (y * sm.w + x) * 4); } return o; }
async function setDuration(i) { const v = await promptBox({ title: `Frame ${i + 1} duration`, label: 'Milliseconds', value: String(E.s.frames[i].duration), type: 'number', ok: 'Set' }); if (v && +v > 0) { E.s.frames[i].duration = Math.round(+v); changedDoc(true); } }
function newFrame(dup) { pushUndo(snapDoc()); const f = { id: 'f' + Math.random().toString(16).slice(2, 12), duration: frame().duration }; E.s.frames.splice(E.fi + 1, 0, f); if (dup) for (const l of E.s.layers) { const c = E.s.cels[key(l.id, frame().id)]; if (c) E.s.cels[key(l.id, f.id)] = c.slice(); } E.fi++; changedDoc(true); }

function wireEditor() {
  const cv = E.cv; cv.oncontextmenu = (e) => e.preventDefault();
  cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); onDown(e); }; cv.onpointermove = onMove; cv.onpointerup = onUp; cv.onpointerleave = () => { E.hover = null; paint(); };
  cv.onwheel = (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) { const r = cv.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]); } else { E.ox -= e.deltaX; paint(); } };
  $('#edBack').onclick = () => go('sprites');
  $('#edName').onchange = (e) => { E.s.name = e.target.value.trim() || E.s.name; changedDoc(); };
  $('#edUndo').onclick = () => undo(-1); $('#edRedo').onclick = () => undo(1);
  $('#ccSwap').onclick = swapColors; $('#cc2').onclick = () => { E.c2 = null; drawPalette(); };
  $('#lyAdd').onclick = () => { pushUndo(snapDoc()); const l = { id: 'l' + Math.random().toString(16).slice(2, 12), name: `Layer ${E.s.layers.length + 1}`, visible: true, opacity: 1 }; E.s.layers.push(l); E.li = l.id; drawLayers(); changedDoc(true); };
  $('#tlAdd').onclick = () => newFrame(false); $('#tlDup').onclick = () => newFrame(true);
  $('#tlDel').onclick = () => { if (E.s.frames.length < 2) return; pushUndo(snapDoc()); const [f] = E.s.frames.splice(E.fi, 1); for (const l of E.s.layers) delete E.s.cels[key(l.id, f.id)]; E.fi = Math.max(0, E.fi - 1); changedDoc(true); };
  $('#tlLeft').onclick = () => { if (E.fi < 1) return; pushUndo(snapDoc()); const [f] = E.s.frames.splice(E.fi, 1); E.s.frames.splice(--E.fi, 0, f); changedDoc(true); };
  $('#tlRight').onclick = () => { if (E.fi >= E.s.frames.length - 1) return; pushUndo(snapDoc()); const [f] = E.s.frames.splice(E.fi, 1); E.s.frames.splice(++E.fi, 0, f); changedDoc(true); };
  $('#tlOnion').onclick = (e) => { E.onion = !E.onion; e.currentTarget.classList.toggle('on', E.onion); paint(); };
  $('#tlTiming').onclick = async () => { const v = await promptBox({ title: 'Timing for every frame', label: 'Frames per second', value: String(Math.round(1000 / (E.s.frames[0].duration || 83))), type: 'number', ok: 'Apply' }); if (v && +v > 0) { pushUndo(snapDoc()); E.s.frames.forEach((f) => (f.duration = Math.round(1000 / +v))); changedDoc(true); } };
  $('#palMenu').onclick = (e) => menu(e.currentTarget, [{ header: true, label: 'Replace the palette (pixels stay)' }, ...Object.keys(S.info.palettes).map((p) => ({ label: p, hint: String(S.info.palettes[p].length), run: () => { pushUndo(snapDoc()); E.s.palette = S.info.palettes[p].slice(); drawPalette(); changedDoc(); } })), '-', { label: 'Add colours used in the sprite', icon: 'picker', run: () => { const used = new Set(); for (const c of Object.values(E.s.cels)) for (let k = 0; k < c.length; k += 4) if (c[k + 3]) used.add(hexOf(c, k)); const add = [...used].filter((h) => !E.s.palette.includes(h)); pushUndo(snapDoc()); E.s.palette.push(...add); drawPalette(); changedDoc(); toast(add.length ? `Added ${plural(add.length, 'colour')}` : 'Every colour is already in the palette'); } }, { label: 'Remove the left colour', icon: 'trash', run: () => { pushUndo(snapDoc()); E.s.palette = E.s.palette.filter((c) => c !== E.c1); drawPalette(); changedDoc(); } }], { width: 260, align: 'right' });
  $('#edShade').onclick = shadeSheet; $('#edCrit').onclick = runCritique;
  $('#edAsk').onclick = () => askClaude(`Look at my sprite “${E.s.name}” (id ${E.s.id}) with view, then `);
  $('#edExport').onclick = (e) => { saveSprite(); exportMenu(e.currentTarget, 'sprite', E.s.id, E.s.name); };
  $('#edMore').onclick = (e) => menu(e.currentTarget, [{ label: 'Draw from SVG…', icon: 'code', run: svgSheet }, { label: 'Make a ramp from the left colour', icon: 'palette', run: rampFromColor }, '-', { label: 'Polish edges (this frame)', icon: 'wand', run: polishFrame }, { label: 'Normal map & light…', icon: 'bulb', run: lightSheet }, { label: 'Check tile seams', icon: 'repeat', run: checkSeams }, { label: 'Make a smaller copy…', icon: 'shrink', run: smallerCopy }, '-', { label: 'Resize canvas…', icon: 'square', run: resizeSprite }, { label: 'Outline this layer (left colour)', icon: 'sprites', run: () => { const u = snapCel(); const c = cel(); const w = E.s.w, h = E.s.h, src = c.slice(); const rgb = rgbOf(E.c1); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (src[(y * w + x) * 4 + 3]) continue; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < w && Y < h && src[(Y * w + X) * 4 + 3]; })) setPx(c, x, y, rgb); } pushUndo(u); changedDoc(); } }, { label: 'Flip this frame horizontally', icon: 'mirror', run: () => { pushUndo(snapDoc()); for (const l of E.s.layers) { const c = E.s.cels[key(l.id, frame().id)]; if (!c) continue; const s0 = c.slice(); for (let y = 0; y < E.s.h; y++) for (let x = 0; x < E.s.w; x++) { const a = (y * E.s.w + x) * 4, b = (y * E.s.w + E.s.w - 1 - x) * 4; c[b] = s0[a]; c[b + 1] = s0[a + 1]; c[b + 2] = s0[a + 2]; c[b + 3] = s0[a + 3]; } } changedDoc(true); } }, { label: 'Clear this layer’s frame', icon: 'eraser', run: () => { const u = snapCel(); cel().fill(0); pushUndo(u); changedDoc(); } }, '-', { label: 'Record GIF + sheet', icon: 'record', run: async () => { await saveSprite(); filesDone(await call('record', { kind: 'sprite', id: E.s.id }).catch(fail), 'Recorded'); } }, { label: 'Copy this frame as an image (8×)', icon: 'copy', run: () => { call('clipboard:image', compose(E.fi), E.s.w, E.s.h, 8); toast('Copied'); } }], { width: 280, align: 'right' });
  window.addEventListener('keydown', edKeys); window.addEventListener('keyup', edKeyUp);
}
function swapColors() { const t = E.c1; E.c1 = E.c2 || E.c1; E.c2 = t; drawPalette(); }
async function resizeSprite() { const r = await promptBox({ title: 'Resize canvas', fields: [{ key: 'w', label: 'Width', type: 'number', value: E.s.w }, { key: 'h', label: 'Height', type: 'number', value: E.s.h }, { key: 'a', label: 'Keep pixels anchored', value: 'center', options: [{ value: 'center', label: 'Centre' }, { value: 'top-left', label: 'Top left' }, { value: 'bottom', label: 'Bottom (feet stay on the ground)' }] }], ok: 'Resize' }); if (!r) return; const w = Math.max(1, Math.min(2048, +r.w | 0)), h = Math.max(1, Math.min(2048, +r.h | 0)); pushUndo(snapDoc()); const dx = r.a === 'center' ? Math.floor((w - E.s.w) / 2) : 0, dy = r.a === 'center' ? Math.floor((h - E.s.h) / 2) : r.a === 'bottom' ? h - E.s.h : 0; for (const [k, c] of Object.entries(E.s.cels)) { const n = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < E.s.h; y++) for (let x = 0; x < E.s.w; x++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; n.set(c.subarray((y * E.s.w + x) * 4, (y * E.s.w + x) * 4 + 4), (Y * w + X) * 4); } E.s.cels[k] = n; } E.s.w = w; E.s.h = h; $('#edSize').textContent = `${w}×${h}`; fitZoom(); changedDoc(true); }
function edKeyUp(e) { if (e.key === ' ') E.space = false; }
function edKeys(e) {
  if (S.view !== 'editor' || $('#sheetHost').firstChild || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); return; } if (mod && k === 'y') { e.preventDefault(); undo(1); return; }
  if (mod) return;
  if (e.key === ' ') { E.space = true; e.preventDefault(); return; }
  const t = TOOLS.find((x) => x[2].toLowerCase() === k); if (t) { setTool(t[0]); return; }
  if (k === 'x') swapColors(); else if (k === 'm') { E.mirror = !E.mirror; drawTools(); paint(); } else if (k === 'n') newFrame(true);
  else if (k === ',' || k === 'arrowleft') { E.fi = (E.fi - 1 + E.s.frames.length) % E.s.frames.length; drawTimeline(); paint(); } else if (k === '.' || k === 'arrowright') { E.fi = (E.fi + 1) % E.s.frames.length; drawTimeline(); paint(); }
  else if (k === '=' || k === '+') zoomBy(1); else if (k === '-') zoomBy(-1); else if (k === '0') { fitZoom(); drawOpts(); paint(); } else if (k === '[') { E.brush = Math.max(1, E.brush - 1); drawOpts(); } else if (k === ']') { E.brush = Math.min(4, E.brush + 1); drawOpts(); }
}
// when Claude edits the sprite that's open, reload it (unless you're mid-stroke)
async function editorReloadIfExternal(id) { if (S.view !== 'editor' || !E.s || E.s.id !== id || E.drag || (E.savedAt && Date.now() - E.savedAt < 1500)) return; const s = await call('sprites:get', id); pushUndo(snapDoc()); E.s = s; E.fi = Math.min(E.fi, s.frames.length - 1); if (!s.layers.some((l) => l.id === E.li)) E.li = s.layers[s.layers.length - 1].id; drawLayers(); drawPalette(); drawTimeline(); paint(); updatePreview(true); $('#edSize').textContent = `${s.w}×${s.h}`; toast('Updated by Claude', s.name, 'info', 2500); }

// ───────── the detail kit in the editor: Shade, Critique, Draw from SVG, ramps
let KIT = null; const kit = async () => (KIT ||= await call('kit:info'));
const TEXKINDS = { stone: 1, bricks: 1, scales: 1, bark: 1, wood: 1, weave: 1, grass: 1, metal: 1, sand: 1, noise: 1 };
function flatColors(c) { const m = new Map(); for (let i = 0; i < c.length; i += 4) if (c[i + 3]) { const k = hexOf(c, i); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); }
async function shadeSheet() {
  const K = await kit(); const c = cel(); const flats = flatColors(c).filter(([, n]) => n >= 2).slice(0, 18);
  if (!flats.length) { toast('Nothing to shade on this layer', 'Lay down flat colours first (or Draw from SVG with data-material tags).', 'info'); return; }
  const mats = E.s.materials || {}; const st = { light: E.lastLight || 'top-left', dither: '', outline: 'selective', all: E.s.frames.length > 1 };
  const guess = (hex) => { if (mats[hex]) return mats[hex]; const [r, g, b] = rgbOf(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx < 45) return null; if (mx - mn < 24) return { material: 'metal' }; return { material: r > g && r > b && g > b * 1.1 && mx > 150 && mx - mn < 120 ? 'skin' : 'cloth' }; };
  const rows = flats.map(([hex, n]) => ({ hex, n, ...(guess(hex) || { material: '' }) }));
  const LP = ['top-left', 'top', 'top-right', 'left', 'front', 'right', 'bottom-left', null, 'bottom-right'];
  const el = openSheet(`<div class="sheet-head">${icon('sun', 20)}<div class="grow"><h3>Shade</h3><div class="muted small">Say what each flat colour is made of. One light, hue-shifted ramps, highlights, rim light, contact shadows and a selective outline.</div></div></div>
    <div class="sheet-body shade-body"><div class="sh-left"><div class="sh-rows">${rows.map((r, i) => `<div class="sh-row" data-i="${i}"><i class="sw" style="background:${r.hex}"></i><span class="mono tiny sh-hex">${r.hex}</span><span class="muted tiny">${r.n}px</span><span class="grow"></span><select class="select sm" data-k="material"><option value="">Leave as is</option>${K.materials.map((m) => `<option ${r.material === m ? 'selected' : ''}>${m}</option>`).join('')}</select><select class="select sm" data-k="form"><option value="">${r.material ? 'Form: auto' : '—'}</option>${K.forms.map((f) => `<option ${r.form === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>`).join('')}</div></div>
      <div class="sh-right"><div class="sh-prev"><div><div class="label">Before</div><div class="sh-box"><canvas id="shA"></canvas></div></div><div><div class="label">After</div><div class="sh-box"><canvas id="shB"></canvas></div></div></div>
        <div class="sh-ctrls"><div><div class="label">Light</div><div class="light-pad">${LP.map((l) => (l ? `<button data-l="${l}" class="${st.light === l ? 'on' : ''}" title="${l}">${l === 'front' ? '●' : '☀'}</button>` : '<span></span>')).join('')}</div></div>
        <div class="col" style="gap:10px"><div><div class="label">Transitions</div><div class="seg sm" id="shDith">${[['', 'Auto'], ['0', 'Hard'], ['0.4', 'Soft'], ['0.9', 'Dithered']].map(([v, l]) => `<button data-v="${v}" class="${st.dither === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div><div class="label">Outline</div><div class="seg sm" id="shOut">${[['selective', 'Selective'], ['dark', 'Dark'], ['keep', 'Keep mine'], ['none', 'None']].map(([v, l]) => `<button data-v="${v}" class="${st.outline === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${E.s.frames.length > 1 ? `<label class="chk"><input type="checkbox" id="shAll" ${st.all ? 'checked' : ''}> Every frame (${E.s.frames.length})</label>` : ''}</div></div></div></div>
    <div class="sheet-foot"><span class="muted small grow" id="shInfo"></span><button class="btn" id="shCancel">Cancel</button><button class="btn primary" id="shGo">${icon('sun', 15)}Shade</button></div>`, { width: 1040 });
  const pa = new Player($('#shA', el), { pad: 6, max: 10 }), pb = new Player($('#shB', el), { pad: 6, max: 10 }); pa.set([c], { w: E.s.w, h: E.s.h, durations: [100] });
  const opts = () => { const materials = {}; $$('.sh-row', el).forEach((row) => { const r = rows[+row.dataset.i]; const m = $('[data-k=material]', row).value; if (m) materials[r.hex] = { material: m, ...($('[data-k=form]', row).value ? { form: $('[data-k=form]', row).value } : {}) }; }); return { materials, light: st.light, outline: st.outline, ...(st.dither !== '' ? { dither: +st.dither } : {}) }; };
  let seq = 0, t = null; const preview = () => { clearTimeout(t); t = setTimeout(async () => { const my = ++seq; const o = opts(); if (!Object.keys(o.materials).length) { pb.set([c], { w: E.s.w, h: E.s.h, durations: [100] }); $('#shInfo', el).textContent = 'Pick a material for at least one colour.'; return; } try { const r = await call('kit:shade', c, E.s.w, E.s.h, o); if (my !== seq) return; pb.set([r.data], { w: E.s.w, h: E.s.h, durations: [100] }); $('#shInfo', el).textContent = `${r.regions} shapes lit · ${r.colors.length} colours`; } catch (e) { $('#shInfo', el).textContent = e.message; } }, 120); };
  $$('select', el).forEach((x) => (x.onchange = preview));
  $$('.light-pad [data-l]', el).forEach((b) => (b.onclick = () => { st.light = b.dataset.l; $$('.light-pad button', el).forEach((x) => x.classList.toggle('on', x === b)); preview(); }));
  $$('#shDith [data-v]', el).forEach((b) => (b.onclick = () => { st.dither = b.dataset.v; $$('#shDith button', el).forEach((x) => x.classList.toggle('on', x === b)); preview(); }));
  $$('#shOut [data-v]', el).forEach((b) => (b.onclick = () => { st.outline = b.dataset.v; $$('#shOut button', el).forEach((x) => x.classList.toggle('on', x === b)); preview(); }));
  const all = $('#shAll', el); if (all) all.onchange = () => { st.all = all.checked; };
  $('#shCancel', el).onclick = closeSheet;
  $('#shGo', el).onclick = async () => {
    const o = opts(); if (!Object.keys(o.materials).length) return; pushUndo(snapDoc()); const frames = st.all ? E.s.frames : [frame()];
    try { for (const f of frames) { const cc = E.s.cels[key(E.li, f.id)]; if (!cc) continue; const r = await call('kit:shade', cc, E.s.w, E.s.h, o); E.s.cels[key(E.li, f.id)] = new Uint8ClampedArray(r.data); for (const col of r.colors) if (!E.s.palette.includes(col) && E.s.palette.length < 256) E.s.palette.push(col); } }
    catch (e) { fail(e); return; }
    E.s.materials = { ...(E.s.materials || {}), ...o.materials }; E.lastLight = st.light; pa.dispose(); pb.dispose(); closeSheet(); drawPalette(); changedDoc(true); toast('Shaded', `${plural(frames.length, 'frame')} · light from ${st.light}. Run Critique next.`);
  };
  preview();
}
async function runCritique() {
  const frames = E.s.frames.map((_, i) => compose(i)); try { const r = await call('kit:critique', frames, E.s.w, E.s.h, {}); E.crit = { ...r, frames: frames.length, focus: null, stale: false }; drawCrit(); fitBeside(); paint(); } catch (e) { fail(e); }
}
function drawCrit() {
  const el = $('#edCrit2'); if (!el) return; const c = E.crit; if (!c) { el.hidden = true; return; } el.hidden = false; const s = c.summary;
  el.innerHTML = `<div class="crit-h"><div class="crit-score ${s.score >= 85 ? 'good' : s.score >= 60 ? 'ok' : 'bad'}">${s.score}</div><div class="grow"><b>${s.issues ? plural(s.issues, 'issue') : 'Looks clean'}</b><div class="muted tiny">${s.colors} colours · value range ${s.value_range}${c.stale ? ' · <b class="warn-t">changed since</b>' : ''}</div></div><button class="icon-btn xs" id="critRe" title="Run again">${icon('refresh', 13)}</button><button class="icon-btn xs" id="critX" title="Close">${icon('x', 13)}</button></div>
    <div class="crit-list">${c.issues.map((it) => `<button class="crit-it ${it.severity}${c.focus === it.n ? ' on' : ''}" data-n="${it.n}"><span class="crit-n">${it.n}</span><span class="grow"><b>${esc(it.type.replace('-', ' '))}</b>${it.frame && c.frames > 1 ? ` <span class="muted tiny">frame ${it.frame}</span>` : ''}<span class="crit-msg">${esc(it.message)}</span></span></button>`).join('') || '<div class="muted small" style="padding:10px">No stray pixels, jaggies, doubles or pillow shading found.</div>'}</div>`;
  $('#critX').onclick = () => { E.crit = null; drawCrit(); paint(); }; $('#critRe').onclick = runCritique;
  $$('.crit-it', el).forEach((b) => (b.onclick = () => { const it = c.issues.find((x) => x.n === +b.dataset.n); c.focus = it.n; if (it.frame && it.frame - 1 !== E.fi) { E.fi = it.frame - 1; drawTimeline(); } if (it.x != null) { const box = $('#edCanvas').getBoundingClientRect(); const cx = (box.width - 330) / 2; const fx = E.ox + (it.x + (it.w || 1) / 2) * E.zoom, fy = E.oy + (it.y + (it.h || 1) / 2) * E.zoom; if (fx < 20 || fx > box.width - 340 || fy < 20 || fy > box.height - 20) { E.ox = Math.round(cx - (it.x + (it.w || 1) / 2) * E.zoom); E.oy = Math.round(box.height / 2 - (it.y + (it.h || 1) / 2) * E.zoom); } } drawCrit(); paint(); }));
}
// keep the sprite visible next to the critique panel
function fitBeside() { const box = $('#edCanvas').getBoundingClientRect(); const free = box.width - 330; E.zoom = Math.max(1, Math.min(48, Math.floor(Math.min((free - 40) / E.s.w, (box.height - 40) / E.s.h)))); E.ox = Math.round((free - E.s.w * E.zoom) / 2); E.oy = Math.round((box.height - E.s.h * E.zoom) / 2); drawOpts(); }
async function svgSheet() {
  const el = openSheet(`<div class="sheet-head">${icon('code', 20)}<div class="grow"><h3>Draw from SVG</h3><div class="muted small">Paste SVG with viewBox="0 0 ${E.s.w} ${E.s.h}". Fills land on pixel centres, thin strokes become clean 1px lines, gradients and opacity become dithering. data-material tags are remembered for Shade.</div></div></div>
    <div class="sheet-body"><textarea class="input area mono" id="svgText" rows="12" spellcheck="false" placeholder='<svg viewBox="0 0 ${E.s.w} ${E.s.h}">\n  <circle cx="${E.s.w / 2}" cy="${E.s.h / 2}" r="${Math.round(E.s.w / 3)}" fill="#9aa4b0" data-material="metal" data-form="sphere"/>\n</svg>'></textarea>
    <div class="row"><button class="btn sm" id="svgOpen">${icon('folder', 14)}Open .svg file…</button><span class="grow"></span><label class="chk"><input type="checkbox" id="svgReplace"> Replace this layer’s frame</label><label class="chk"><input type="checkbox" id="svgSnap"> Snap to palette</label></div><div class="muted small" id="svgInfo"></div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" id="svgCancel">Cancel</button><button class="btn primary" id="svgGo">Draw</button></div>`, { width: 720 });
  $('#svgCancel', el).onclick = closeSheet;
  $('#svgOpen', el).onclick = async () => { const f = await call('dialog:files', { filters: [{ name: 'SVG', extensions: ['svg'] }] }); if (!f) return; const u = await call('image:dataUrl', f[0]); $('#svgText', el).value = decodeURIComponent(escape(atob(u.split(',')[1]))); };
  $('#svgGo', el).onclick = async () => {
    const src = $('#svgText', el).value.trim(); if (!src) return;
    try { const r = await call('kit:svg', src, E.s.w, E.s.h, { palette: E.s.palette, snap: $('#svgSnap', el).checked }); if (r.warnings.length) { $('#svgInfo', el).textContent = r.warnings.join(' '); if (!r.colors.length) return; }
      pushUndo(snapCel()); const c = cel(); if ($('#svgReplace', el).checked) c.fill(0); const d = r.data; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { c[i] = d[i]; c[i + 1] = d[i + 1]; c[i + 2] = d[i + 2]; c[i + 3] = 255; }
      for (const col of r.colors) if (!E.s.palette.includes(col) && E.s.palette.length < 256) E.s.palette.push(col); E.s.materials = { ...(E.s.materials || {}), ...r.materials };
      closeSheet(); drawPalette(); changedDoc(); toast('Drawn', Object.keys(r.materials).length ? `${plural(Object.keys(r.materials).length, 'material')} tagged — Shade is ready` : 'Tag shapes with data-material to shade them in one click'); } catch (e) { fail(e); }
  };
}
async function rampFromColor() { const ramp = await call('kit:ramp', E.c1, { steps: 5 }); pushUndo(snapDoc()); for (const c of ramp) if (!E.s.palette.includes(c)) E.s.palette.push(c); drawPalette(); changedDoc(); toast('Ramp added', ramp.join(' ')); }

// ───────── 0.4 detail tools in the editor
async function polishFrame() {
  const u = snapCel(); const c = cel(); try { const a = await call('kit:cleanup', c.slice(), E.s.w, E.s.h, {}); const b = await call('kit:smooth', a.data, E.s.w, E.s.h, {}); c.set(new Uint8ClampedArray(b.data)); for (const col of b.colors) if (!E.s.palette.includes(col) && E.s.palette.length < 256) E.s.palette.push(col); pushUndo(u); drawPalette(); changedDoc(); toast('Edges polished', `${plural(a.fixed, 'corner')} cleaned, ${plural(b.changed, 'pixel')} smoothed in inside corners. Undo if it’s too soft.`); } catch (e) { fail(e); }
}
async function checkSeams() {
  const comp = compose(E.fi); const r = await call('kit:seams', comp, E.s.w, E.s.h); E.tiled = true; drawTools(); paint();
  if (r.check.seamless) { toast('Tiles cleanly', 'No visible seams left/right or top/bottom. Tile preview is on.'); return; }
  const bad = [!r.check.left_right.ok && 'left/right', !r.check.top_bottom.ok && 'top/bottom'].filter(Boolean).join(' and ');
  const go2 = await confirmBox({ title: 'Seams found', text: `The ${bad} edges don’t meet. Wrap the tile by half so the seams sit in the middle where you can paint over them? (Tile preview is on so you can see it repeat.)`, ok: 'Wrap by half' });
  if (go2) { pushUndo(snapDoc()); for (const l of E.s.layers) { const c = E.s.cels[key(l.id, frame().id)]; if (!c) continue; const w = E.s.w, h = E.s.h, s0 = c.slice(), ox = Math.floor(w / 2), oy = Math.floor(h / 2); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = (y * w + x) * 4, b = (((y + oy) % h) * w + ((x + ox) % w)) * 4; c[b] = s0[a]; c[b + 1] = s0[a + 1]; c[b + 2] = s0[a + 2]; c[b + 3] = s0[a + 3]; } } changedDoc(true); }
}
async function smallerCopy() {
  const r = await promptBox({ title: 'Make a smaller copy', text: 'Every layer and frame, redrawn so eyes, outlines and highlights survive. Small versions always want a hand pass afterwards.', fields: [{ key: 'w', label: 'Width (height follows)', type: 'number', value: String(Math.max(8, Math.round(E.s.w / 2))) }, { key: 'mode', label: 'How', value: 'detail', options: [{ value: 'detail', label: 'Keep details (eyes, outlines, highlights)' }, { value: 'majority', label: 'Majority colour per block' }, { value: 'nearest', label: 'Nearest pixel' }] }], ok: 'Make copy' });
  if (!r || !(+r.w > 0)) return; await saveSprite(); try { const j = await call('tool', 'scale_sprite', { sprite: E.s.id, w: Math.min(E.s.w, +r.w), mode: r.mode }); await loadProject(); toast('Smaller copy made', `${j.size} from ${j.from}`); go('editor', j.sprite); } catch (e) { fail(e); }
}
async function lightSheet() {
  const LP = ['top-left', 'top', 'top-right', 'left', 'front', 'right', 'bottom-left', null, 'bottom-right']; const st = { light: 'right', bulge: 1 };
  const el = openSheet(`<div class="sheet-head">${icon('bulb', 20)}<div class="grow"><h3>Normal map &amp; light</h3><div class="muted small">A normal map built from the silhouette and values, for 2D lights in Godot or Unity — and a preview of the sprite lit from anywhere.</div></div></div>
    <div class="sheet-body"><div class="sh-prev three"><div><div class="label">Sprite</div><div class="sh-box"><canvas id="lmA"></canvas></div></div><div><div class="label">Normal map</div><div class="sh-box"><canvas id="lmN"></canvas></div></div><div><div class="label">Lit</div><div class="sh-box"><canvas id="lmL"></canvas></div></div></div>
      <div class="sh-ctrls"><div><div class="label">Light</div><div class="light-pad">${LP.map((l) => (l ? `<button data-l="${l}" class="${st.light === l ? 'on' : ''}" title="${l}">${l === 'front' ? '●' : '☀'}</button>` : '<span></span>')).join('')}</div></div>
      <div class="field" style="min-width:220px"><label>Roundness <b id="lmBv">1</b></label><input type="range" id="lmB" min="0.2" max="2" step="0.1" value="1"></div></div></div>
    <div class="sheet-foot"><button class="btn" id="lmExp">${icon('export', 15)}Export normal map sheet</button><span class="grow"></span><button class="btn" id="lmClose">Close</button><button class="btn primary" id="lmApply">${icon('check', 15)}Relight every frame</button></div>`, { width: 860 });
  const pv = (id, d) => new Player($(id, el), { pad: 6, max: 6, bg: 'checker' }).set([d], { w: E.s.w, h: E.s.h, durations: [100] });
  const comp = compose(E.fi); pv('#lmA', comp);
  const run = async () => { const r = await call('kit:normal', comp, E.s.w, E.s.h, { bulge: st.bulge, lights: [st.light] }); pv('#lmN', new Uint8ClampedArray(r.data)); pv('#lmL', new Uint8ClampedArray(r.lit[0])); };
  $$('.light-pad [data-l]', el).forEach((b) => (b.onclick = () => { st.light = b.dataset.l; $$('.light-pad button', el).forEach((x) => x.classList.toggle('on', x === b)); run(); }));
  $('#lmB', el).oninput = (e) => { st.bulge = +e.target.value; $('#lmBv', el).textContent = st.bulge; run(); };
  $('#lmClose', el).onclick = closeSheet;
  $('#lmExp', el).onclick = async () => { await saveSprite(); try { const j = await call('tool', 'normal_map', { sprite: E.s.id, export: true, bulge: st.bulge, light: st.light }); filesDone({ files: j.exported }, 'Normal map exported'); } catch (e) { fail(e); } };
  $('#lmApply', el).onclick = async () => { pushUndo(snapDoc()); for (const f of E.s.frames) for (const l of E.s.layers) { const c = E.s.cels[key(l.id, f.id)]; if (!c) continue; const r = await call('kit:relight', c.slice(), E.s.w, E.s.h, { light: st.light, bulge: st.bulge }); c.set(new Uint8ClampedArray(r.data)); for (const col of r.colors) if (!E.s.palette.includes(col) && E.s.palette.length < 256) E.s.palette.push(col); } closeSheet(); drawPalette(); changedDoc(true); toast('Relit', `Lit from ${st.light}. Undo to go back.`); };
  run();
}

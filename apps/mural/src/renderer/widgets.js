// Mural — the widgets layer page: lays out each widget as a sandboxed frame, relays what widgets ask for (checked in
// the main process), and handles arranging (drag, resize, remove).
import { skyAt } from './runtime/sun.js';

const H = window.muralLayer;
const layer = document.getElementById('layer');
const items = new Map(); // id -> { el, frame, inst, ready }
let editing = false, location = null, paused = false, platform = '', grid = { on: false };
const FREE = 8; // free placement (grid off) still snaps to 8 pt
const gridEl = document.getElementById('grid'), ghost = document.getElementById('ghost');

function post(it, msg) { try { it.frame.contentWindow.postMessage({ mw: 1, ...msg }, '*'); } catch (_) {} }
function initData(it) { return { id: it.inst.id, settings: it.inst.settings, style: it.inst.style, size: { w: it.inst.w, h: it.inst.h }, permissions: it.inst.permissions, platform, sky: sky(), paused }; }
function sky() { const s = skyAt(new Date(), location); return { phases: s.phases, daylight: s.daylight, altitude: s.altitude }; }

H.onLayout((l) => {
  editing = l.editing; location = l.location; platform = l.platform || ''; grid = l.grid || { on: false };
  drawGrid();
  document.body.classList.toggle('edit', editing);
  document.body.classList.toggle('none', !l.widgets.length);
  const seen = new Set();
  l.widgets.forEach((inst, z) => {
    seen.add(inst.id);
    let it = items.get(inst.id);
    if (!it) it = make(inst);
    const before = it.inst; it.inst = inst;
    if (!it.el.classList.contains('drag') && (before.x !== inst.x || before.y !== inst.y || before.w !== inst.w || before.h !== inst.h) && it.ready) { it.el.classList.add('settle'); setTimeout(() => it.el.classList.remove('settle'), 260); }
    place(it, z);
    if (it.ready && JSON.stringify(before.settings) !== JSON.stringify(inst.settings)) post(it, { ev: 'settings', data: inst.settings });
    if (it.ready && JSON.stringify(before.style) !== JSON.stringify(inst.style)) post(it, { ev: 'style', data: inst.style });
    if (it.ready && (before.w !== inst.w || before.h !== inst.h)) post(it, { ev: 'resize', data: { w: inst.w, h: inst.h } });
  });
  for (const [id, it] of items) if (!seen.has(id)) { it.el.remove(); items.delete(id); }
});

function make(inst) {
  const el = document.createElement('div'); el.className = 'w';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms'); frame.setAttribute('allow', 'clipboard-write');
  frame.src = inst.url;
  const shield = document.createElement('div'); shield.className = 'shield';
  const bar = document.createElement('div'); bar.className = 'bar';
  bar.innerHTML = '<button class="s" title="Settings">⚙︎</button><button class="x" title="Remove">✕</button>';
  const label = document.createElement('div'); label.className = 'label';
  const grip = document.createElement('div'); grip.className = 'grip';
  el.append(frame, shield, label, bar, grip); layer.appendChild(el);
  const it = { el, frame, inst, ready: false };
  items.set(inst.id, it);
  frame.addEventListener('load', () => { it.ready = true; post(it, { ev: 'init', data: initData(it) }); });
  bar.querySelector('.x').onclick = (e) => { e.stopPropagation(); H.remove(it.inst.id); };
  bar.querySelector('.s').onclick = (e) => { e.stopPropagation(); H.settings(it.inst.id); };
  shield.addEventListener('pointerdown', (e) => drag(e, it, 'move'));
  grip.addEventListener('pointerdown', (e) => drag(e, it, 'size'));
  el.addEventListener('pointerdown', () => { if (!editing) H.front(it.inst.id); }, true);
  return it;
}
function place(it, z) {
  const i = it.inst, el = it.el;
  el.style.left = i.x + 'px'; el.style.top = i.y + 'px'; el.style.width = i.w + 'px'; el.style.height = i.h + 'px'; el.style.zIndex = String(10 + z);
  el.style.opacity = String(i.style && i.style.opacity != null ? i.style.opacity : 1);
  el.className = `w g-${(i.style && i.style.glass) || 'dark'}${i.resizable ? ' rs' : ''}${el.classList.contains('drag') ? ' drag' : ''}${el.classList.contains('settle') ? ' settle' : ''}`;
  el.querySelector('.label').textContent = i.name;
}
// the grid: faint cells while arranging, and where a dragged widget will land
function drawGrid() {
  gridEl.innerHTML = '';
  if (!grid.on) return;
  gridEl.style.cssText = `left:${grid.x0}px;top:${grid.y0}px;width:${grid.cols * grid.step - grid.gap}px;height:${grid.rows * grid.step - grid.gap}px;grid-template-columns:repeat(${grid.cols},${grid.cell}px);grid-auto-rows:${grid.cell}px;gap:${grid.gap}px`;
  const n = grid.cols * grid.rows; const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) frag.appendChild(document.createElement('i'));
  gridEl.appendChild(frag);
}
function snapRect(r, it) {
  if (!grid.on) { const s = (v) => Math.round(v / FREE) * FREE; return { x: s(r.x), y: s(r.y), w: Math.max(it.inst.minW || 80, s(r.w)), h: Math.max(it.inst.minH || 60, s(r.h)) }; }
  const span = (px, min) => Math.max(1, Math.round((px + grid.gap) / grid.step), Math.ceil(((min || 0) + grid.gap) / grid.step));
  const cols = Math.min(grid.cols, span(r.w, it.inst.minW)), rows = Math.min(grid.rows, span(r.h, it.inst.minH));
  const col = Math.max(0, Math.min(grid.cols - cols, Math.round((r.x - grid.x0) / grid.step))), row = Math.max(0, Math.min(grid.rows - rows, Math.round((r.y - grid.y0) / grid.step)));
  return { x: grid.x0 + col * grid.step, y: grid.y0 + row * grid.step, w: cols * grid.step - grid.gap, h: rows * grid.step - grid.gap };
}
function drag(e, it, mode) {
  if (!editing) return; e.preventDefault(); e.stopPropagation();
  const t = e.currentTarget; t.setPointerCapture(e.pointerId);
  const sx = e.clientX, sy = e.clientY, start = { ...it.inst }; it.el.classList.add('drag');
  const W = innerWidth, Hh = innerHeight; let target = null;
  const moveFn = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    // the widget follows the pointer freely; the ghost shows the cells it will snap into
    const r = mode === 'move'
      ? { x: Math.max(0, Math.min(W - start.w, start.x + dx)), y: Math.max(0, Math.min(Hh - start.h, start.y + dy)), w: start.w, h: start.h }
      : { x: start.x, y: start.y, w: Math.max(40, Math.min(W - start.x, start.w + dx)), h: Math.max(30, Math.min(Hh - start.y, start.h + dy)) };
    Object.assign(it.inst, r); place(it, Number(it.el.style.zIndex) - 10);
    target = snapRect(r, it);
    const hit = [...items.values()].some((o) => o !== it && target.x < o.inst.x + o.inst.w && o.inst.x < target.x + target.w && target.y < o.inst.y + o.inst.h && o.inst.y < target.y + target.h);
    ghost.style.cssText = `display:block;left:${target.x}px;top:${target.y}px;width:${target.w}px;height:${target.h}px`; ghost.classList.toggle('busy', hit);
  };
  const up = () => {
    t.removeEventListener('pointermove', moveFn); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up);
    it.el.classList.remove('drag'); ghost.style.display = 'none';
    const r = target || snapRect(it.inst, it);
    it.el.classList.add('settle'); Object.assign(it.inst, r); place(it, Number(it.el.style.zIndex) - 10); setTimeout(() => it.el.classList.remove('settle'), 260);
    H.move(it.inst.id, r); // main finds the nearest free cells and sends the final layout back
    if (mode === 'size') post(it, { ev: 'resize', data: { w: r.w, h: r.h } });
  };
  t.addEventListener('pointermove', moveFn); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
}

// what widgets ask for: tie each message to the frame it came from, so a widget can only speak for itself
addEventListener('message', async (e) => {
  const m = e.data; if (!m || m.mw !== 1 || !m.id || !m.call) return;
  const it = [...items.values()].find((x) => x.frame.contentWindow === e.source); if (!it) return;
  try {
    let data = await H.call(it.inst.id, String(m.call), Array.isArray(m.args) ? m.args : []);
    if (m.call === 'system' && navigator.getBattery) { try { const b = await navigator.getBattery(); data = { ...data, battery: { level: b.level, charging: b.charging } }; } catch (_) {} }
    if (m.call === 'resize' && data) { it.inst.w = data.w; it.inst.h = data.h; place(it, Number(it.el.style.zIndex) - 10); }
    post(it, { re: m.id, ok: true, data });
  } catch (err) { post(it, { re: m.id, ok: false, error: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); }
});

H.onPause(() => { paused = true; for (const it of items.values()) post(it, { ev: 'pause' }); });
H.onResume(() => { paused = false; for (const it of items.values()) post(it, { ev: 'resume' }); for (const it of items.values()) post(it, { ev: 'sky', data: sky() }); });
setInterval(() => { if (!paused) for (const it of items.values()) post(it, { ev: 'sky', data: sky() }); }, 60000);
document.getElementById('doneBtn').onclick = () => H.done();
addEventListener('keydown', (e) => { if (e.key === 'Escape' && editing) H.done(); });
window.__muralWidgets = () => [...items.values()].map((x) => ({ id: x.inst.id, ready: x.ready, rect: x.el.getBoundingClientRect().toJSON() }));

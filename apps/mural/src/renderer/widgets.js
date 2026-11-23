// Mural — the widgets layer page: lays out each widget as a sandboxed frame, relays what widgets ask for (checked in
// the main process), and handles arranging (drag, resize, remove).
import { skyAt } from './runtime/sun.js';

const H = window.muralLayer;
const layer = document.getElementById('layer');
const items = new Map(); // id -> { el, frame, inst, ready }
let editing = false, location = null, paused = false, platform = '';
const GRID = 8;

function post(it, msg) { try { it.frame.contentWindow.postMessage({ mw: 1, ...msg }, '*'); } catch (_) {} }
function initData(it) { return { id: it.inst.id, settings: it.inst.settings, style: it.inst.style, size: { w: it.inst.w, h: it.inst.h }, permissions: it.inst.permissions, platform, sky: sky(), paused }; }
function sky() { const s = skyAt(new Date(), location); return { phases: s.phases, daylight: s.daylight, altitude: s.altitude }; }

H.onLayout((l) => {
  editing = l.editing; location = l.location; platform = l.platform || '';
  document.body.classList.toggle('edit', editing);
  document.body.classList.toggle('none', !l.widgets.length);
  const seen = new Set();
  l.widgets.forEach((inst, z) => {
    seen.add(inst.id);
    let it = items.get(inst.id);
    if (!it) it = make(inst);
    const before = it.inst; it.inst = inst;
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
  el.className = `w g-${(i.style && i.style.glass) || 'dark'}${i.resizable ? ' rs' : ''}${el.classList.contains('drag') ? ' drag' : ''}`;
  el.querySelector('.label').textContent = i.name;
}
const snap = (v) => Math.round(v / GRID) * GRID;
function drag(e, it, mode) {
  if (!editing) return; e.preventDefault(); e.stopPropagation();
  const t = e.currentTarget; t.setPointerCapture(e.pointerId);
  const sx = e.clientX, sy = e.clientY, start = { ...it.inst }; it.el.classList.add('drag');
  const W = innerWidth, Hh = innerHeight;
  const moveFn = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (mode === 'move') { it.inst.x = Math.max(0, Math.min(W - start.w, snap(start.x + dx))); it.inst.y = Math.max(0, Math.min(Hh - start.h, snap(start.y + dy))); }
    else { it.inst.w = Math.max(it.inst.minW || 80, Math.min(W - start.x, snap(start.w + dx))); it.inst.h = Math.max(it.inst.minH || 60, Math.min(Hh - start.y, snap(start.h + dy))); }
    place(it, Number(it.el.style.zIndex) - 10);
  };
  const up = () => {
    t.removeEventListener('pointermove', moveFn); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up);
    it.el.classList.remove('drag');
    H.move(it.inst.id, { x: it.inst.x, y: it.inst.y, w: it.inst.w, h: it.inst.h });
    if (mode === 'size') post(it, { ev: 'resize', data: { w: it.inst.w, h: it.inst.h } });
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

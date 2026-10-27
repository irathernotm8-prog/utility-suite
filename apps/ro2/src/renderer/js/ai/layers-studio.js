// Make editable: the full-window screen where RO2 shows what it found in a flat picture (text, objects, flat
// shapes), lets you fix the words, switch pieces on or off, click to add objects it missed, then builds the layers.
import { h, btn, ico, toggle, toast, toastErr, esc, clamp } from '../ui.js';
import { ensure, imageDataFromUrl, call } from './client.js';
import { analyze, build, objectAt } from './layerize.js';

const HUES = [158, 196, 268, 32, 330, 90, 220, 0, 52, 290];
export function openLayersStudio({ src }) {
  return new Promise(async (resolve) => {
    if (!(await ensure(['ocr', 'slimsam', 'lama'], 'Make editable'))) return resolve(null);
    let img; try { img = await imageDataFromUrl(src, 4096); } catch (e) { toastErr(e); return resolve(null); }
    new LayersStudio(img, resolve).mount();
  });
}

class LayersStudio {
  constructor(img, resolve) { this.img = img; this.resolve = resolve; this.W = img.width; this.H = img.height; this.res = null; this.key = 'L' + Math.random().toString(36).slice(2); this.opts = { rebuild: true, keepOriginal: true }; this.hover = null; this.adding = false; window.__layers = this; }
  mount() {
    this.el = h('div.studio');
    this.side = h('div.studio-side', { style: { width: '340px' } });
    this.view = h('div.studio-view'); this.canvas = h('canvas'); this.hint = h('div.hint', 'Reading the picture…'); this.view.append(this.canvas, this.hint);
    this.goB = btn('Make editable', () => this.finish(), { cls: 'primary', icon: 'layers', disabled: true });
    this.el.append(h('div.studio-top.drag', h('h3', { html: ico('layers') + 'Make editable' }), h('div', { style: { flex: 1 } }), h('div.no-drag', { style: { display: 'flex', gap: '6px' } }, btn('Cancel', () => this.close(null), { cls: 'ghost' }), this.goB)),
      h('div.studio-main', this.side, this.view));
    document.body.append(this.el);
    this.src = document.createElement('canvas'); this.src.width = this.W; this.src.height = this.H; this.src.getContext('2d').putImageData(this.img, 0, 0);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.view);
    this.keys = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(null); } if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') e.stopPropagation(); };
    addEventListener('keydown', this.keys, true);
    this.view.addEventListener('pointermove', (e) => this.onMove(e)); this.view.addEventListener('pointerdown', (e) => this.onDown(e));
    this.resize(); this.run();
  }
  close(r) { removeEventListener('keydown', this.keys, true); this.ro.disconnect(); this.el.remove(); call('reset').catch(() => {}); this.resolve(r); }
  resize() { const r = this.view.getBoundingClientRect(); const dpr = devicePixelRatio || 1; this.vw = r.width; this.vh = r.height; this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr; this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px'; const s = Math.min((r.width - 60) / this.W, (r.height - 60) / this.H); this.v = { s, x: (r.width - this.W * s) / 2, y: (r.height - this.H * s) / 2 }; this.draw(); }
  toImg(e) { const r = this.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - this.v.x) / this.v.s, y: (e.clientY - r.top - this.v.y) / this.v.s }; }
  async run() {
    this.side.innerHTML = ''; const note = h('div.small.muted', 'Starting…'); const bar = h('div.progress.indet', h('i'));
    this.side.append(h('div.p-title', 'Taking it apart'), bar, h('div', { style: { marginTop: '8px' } }, note), h('p.small.dim', { style: { marginTop: '14px', lineHeight: 1.5 } }, 'RO2 reads the words, finds each object and flat shape, and works out what was behind them. Everything stays on this computer.'));
    try {
      this.res = await analyze(this.img, { key: this.key, onProgress: (t) => { note.textContent = t; this.hint.textContent = t; } });
      this.items = [...this.res.texts, ...this.res.objects];
      this.res.objects.forEach((o, i) => { o.hue = HUES[i % HUES.length]; o.tint = this.tintOf(o); });
      this.goB.disabled = false; this.hint.textContent = 'Click a highlighted piece to switch it off · use Add object for anything missed';
      this.buildSide(); this.draw();
      if (!this.items.length) toast('RO2 didn’t find separate text or objects in this picture. Try Add object.', { type: 'info', ms: 5000 });
    } catch (e) { toastErr(e); this.close(null); }
  }
  tintOf(o) {
    const { aw, ah } = this.res; const c = document.createElement('canvas'); c.width = aw; c.height = ah; const x = c.getContext('2d'); const id = x.createImageData(aw, ah);
    const rgb = hsl(o.hue, 85, 55);
    for (let q = 0; q < o.mask.length; q++) if (o.mask[q]) { id.data[q * 4] = rgb[0]; id.data[q * 4 + 1] = rgb[1]; id.data[q * 4 + 2] = rgb[2]; id.data[q * 4 + 3] = 255; }
    x.putImageData(id, 0, 0); return c;
  }
  draw() {
    const c = this.canvas, x = c.getContext('2d'); const dpr = devicePixelRatio || 1;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
    x.setTransform(dpr * this.v.s, 0, 0, dpr * this.v.s, dpr * this.v.x, dpr * this.v.y);
    x.drawImage(this.src, 0, 0);
    if (!this.res) return;
    for (const o of this.res.objects) {
      const hot = this.hover === o; x.globalAlpha = !o.on ? 0.06 : hot ? 0.55 : 0.3; x.imageSmoothingEnabled = false; x.drawImage(o.tint, 0, 0, this.W, this.H); x.imageSmoothingEnabled = true;
    }
    x.globalAlpha = 1;
    for (const t of this.res.texts) {
      const hot = this.hover === t; x.lineWidth = (hot ? 3 : 2) / this.v.s; x.setLineDash(t.on ? [] : [6 / this.v.s, 4 / this.v.s]);
      x.strokeStyle = t.on ? (hot ? '#ffffff' : '#3fd2ea') : 'rgba(255,255,255,.4)'; x.strokeRect(t.x0 - 3, t.y0 - 3, t.x1 - t.x0 + 6, t.y1 - t.y0 + 6);
      if (t.on) { x.fillStyle = 'rgba(63,210,234,.12)'; x.fillRect(t.x0 - 3, t.y0 - 3, t.x1 - t.x0 + 6, t.y1 - t.y0 + 6); }
    }
    x.setLineDash([]);
  }
  itemAt(p) {
    for (const t of this.res.texts) if (p.x >= t.x0 - 4 && p.x <= t.x1 + 4 && p.y >= t.y0 - 4 && p.y <= t.y1 + 4) return t;
    const { aw, ah } = this.res; const q = Math.floor((p.y / this.H) * ah) * aw + Math.floor((p.x / this.W) * aw);
    const hits = this.res.objects.filter((o) => o.mask[q]); return hits.sort((a, b) => a.area - b.area)[0] || null;
  }
  onMove(e) { if (!this.res) return; const p = this.toImg(e); const it = this.adding ? null : this.itemAt(p); if (it !== this.hover) { this.hover = it; this.draw(); this.side.querySelectorAll('[data-item]').forEach((r) => r.classList.toggle('on', it && r.dataset.item === it.id)); } this.view.style.cursor = this.adding ? 'crosshair' : it ? 'pointer' : 'default'; }
  async onDown(e) {
    if (!this.res || e.button !== 0) return; const p = this.toImg(e); if (p.x < 0 || p.y < 0 || p.x >= this.W || p.y >= this.H) return;
    if (this.adding) {
      this.hint.textContent = 'Finding that object…';
      try { const o = await objectAt(this.res, this.key, p.x, p.y); if (o) { o.hue = HUES[this.res.objects.length % HUES.length]; o.tint = this.tintOf(o); this.res.objects.push(o); this.items.push(o); } else toast('Couldn’t pick out an object there.', { type: 'info' }); } catch (er) { toastErr(er); }
      this.adding = false; this.hint.textContent = 'Click a highlighted piece to switch it off'; this.buildSide(); this.draw(); return;
    }
    const it = this.itemAt(p); if (it) { it.on = !it.on; this.buildSide(); this.draw(); }
  }
  buildSide() {
    const s = this.side; s.innerHTML = ''; const R = this.res;
    s.append(h('div.p-title', 'What RO2 found'));
    s.append(h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
      h('button.btn.sm' + (this.adding ? '.on' : ''), { html: ico('mouse-pointer-click') + '<span>Add object</span>', title: 'Click on something in the picture to make it a layer', on: { click: () => { this.adding = !this.adding; this.hint.textContent = this.adding ? 'Click on the object to add' : 'Click a highlighted piece to switch it off'; this.buildSide(); } } }),
      h('button.btn.sm.ghost', { html: '<span>All on</span>', on: { click: () => { this.items.forEach((i) => (i.on = true)); this.buildSide(); this.draw(); } } }),
      h('button.btn.sm.ghost', { html: '<span>All off</span>', on: { click: () => { this.items.forEach((i) => (i.on = false)); this.buildSide(); this.draw(); } } })));
    const row = (it, body, label) => {
      const cb = h('input', { type: 'checkbox', checked: it.on, on: { change: () => { it.on = cb.checked; this.draw(); } } });
      const r = h('div.layer', { 'data-item': it.id, style: { height: 'auto', minHeight: '44px', padding: '6px', alignItems: 'flex-start' }, on: { mouseenter: () => { this.hover = it; this.draw(); }, mouseleave: () => { this.hover = null; this.draw(); } } }, h('label', { style: { paddingTop: '6px' } }, cb), body, label ? h('span.badge.dim', { style: { marginTop: '6px' } }, label) : null);
      return r;
    };
    s.append(h('div.sec', h('h4', `Text (${R.texts.length})`)));
    if (!R.texts.length) s.append(h('p.small.dim', 'No text found.'));
    for (const t of R.texts) {
      const ta = h('textarea.input', { rows: Math.min(4, t.text.split('\n').length), style: { width: '100%', height: 'auto', padding: '6px 8px', resize: 'vertical', fontFamily: `"${t.fontFamily}"`, fontWeight: t.fontWeight, fontSize: '13px', color: 'var(--text)' }, on: { input: () => { t.text = ta.value; } } }, t.text);
      ta.value = t.text;
      const info = h('div.tiny.dim', { style: { marginTop: '3px', display: 'flex', gap: '6px', alignItems: 'center' } }, h('i', { style: { width: '10px', height: '10px', borderRadius: '3px', background: t.color, display: 'inline-block', boxShadow: 'inset 0 0 0 1px rgba(127,127,127,.4)' } }), `${t.fontFamily} ${t.fontWeight} · ${Math.round(t.fontSize)} px${t.conf < 75 ? ' · check the words' : ''}`);
      s.append(row(t, h('div', { style: { flex: 1, minWidth: 0 } }, ta, info)));
    }
    s.append(h('div.sec', h('h4', `Objects (${R.objects.length})`)));
    if (!R.objects.length) s.append(h('p.small.dim', 'No separate objects found. Use Add object to pick one.'));
    for (const o of R.objects) {
      const th = document.createElement('canvas'); this.thumb(o, th);
      const kindSel = h('select.input', { style: { height: '28px', fontSize: '12px', marginTop: '4px' }, on: { change: () => { o.kind = kindSel.value; } } }, h('option', { value: 'photo', selected: o.kind === 'photo' }, 'Photo layer'), h('option', { value: 'shape', selected: o.kind === 'shape' }, 'Vector shape'));
      s.append(row(o, h('div', { style: { flex: 1, display: 'flex', gap: '8px', alignItems: 'center' } }, th, h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' } }, h('i', { style: { width: '10px', height: '10px', borderRadius: '50%', background: `hsl(${o.hue} 85% 55%)` } }), o.kind === 'shape' ? 'Flat shape' : o.subject ? 'Subject' : 'Object'), kindSel))));
    }
    s.append(h('div.sec', h('h4', 'Options')));
    s.append(toggle('Rebuild the background behind them', this.opts.rebuild, (v) => { this.opts.rebuild = v; }));
    s.append(toggle('Keep the original as a hidden layer', this.opts.keepOriginal, (v) => { this.opts.keepOriginal = v; }));
    s.append(h('p.tiny.dim', { style: { marginTop: '10px', lineHeight: 1.5 } }, 'Fonts are RO2’s closest match; change them after. Flat shapes become vectors you can recolour. Works best on graphics, posters, thumbnails and AI images with clear text.'));
  }
  thumb(o, c) {
    const { bbox } = o; const kx = this.W / this.res.aw, ky = this.H / this.res.ah;
    const x0 = bbox[0] * kx, y0 = bbox[1] * ky, w = (bbox[2] - bbox[0] + 1) * kx, hh = (bbox[3] - bbox[1] + 1) * ky; const k = 40 / Math.max(w, hh);
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k)); Object.assign(c.style, { width: c.width + 'px', height: c.height + 'px', borderRadius: '4px', background: 'repeating-conic-gradient(var(--chk-a) 0 25%, var(--chk-b) 0 50%) 0 0/8px 8px', flex: 'none' });
    const x = c.getContext('2d'); x.drawImage(this.src, x0, y0, w, hh, 0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.imageSmoothingEnabled = false; x.drawImage(o.tint, bbox[0], bbox[1], bbox[2] - bbox[0] + 1, bbox[3] - bbox[1] + 1, 0, 0, c.width, c.height);
  }
  async finish() {
    if (!this.res) return;
    const on = this.items.filter((i) => i.on); if (!on.length && !this.opts.rebuild) return toast('Switch on at least one piece.', { type: 'info' });
    this.goB.disabled = true; const box = h('div.working', h('div.box', h('b', 'Building the layers…'), h('div.progress.indet', { style: { marginTop: '10px' } }, h('i')), h('div.small.muted', { style: { marginTop: '8px' } }, '')));
    this.view.append(box); const note = box.querySelector('.small');
    try {
      const out = await build(this.img, this.res, { texts: this.res.texts, objects: this.res.objects, rebuild: this.opts.rebuild }, { onProgress: (t) => { note.textContent = t; } });
      out.keepOriginal = this.opts.keepOriginal;
      this.close(out);
    } catch (e) { toastErr(e); box.remove(); this.goB.disabled = false; }
  }
}
function hsl(hh, s, l) { s /= 100; l /= 100; const k = (n) => (n + hh / 30) % 12; const a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]; }
export { esc, clamp };

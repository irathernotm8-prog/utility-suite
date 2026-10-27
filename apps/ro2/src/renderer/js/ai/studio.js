// The AI studio: a full-window focus mode for one picture.
//   erase     Magic eraser: paint over (or click on) anything and it's gone, with the background rebuilt
//   removebg  Background remover with Keep / Remove brushes, click-to-keep, new backgrounds and a sticker outline
//   grab      Magic grab: lift an object out as its own layer and fill the hole behind it
//   expand    Magic expand: grow the picture past its edges to a new shape
import { h, btn, ico, slider, seg, toggle, toast, toastErr, clamp, confirmBox } from '../ui.js';
import { call, ensure, models, imageDataFromUrl, plain, dataUrlFrom, patchFill } from './client.js';
import { colorPicker } from '../panels/color.js';

const TITLES = { erase: ['Magic eraser', 'eraser'], removebg: ['Remove background', 'scissors'], grab: ['Magic grab', 'hand-grab'], expand: ['Magic expand', 'expand'] };
const MAX_SIDE = 6000;

export function openStudio({ src, mode, name, pageAspect }) {
  return new Promise(async (resolve) => {
    let orig;
    try { orig = await imageDataFromUrl(src, MAX_SIDE); } catch (e) { toastErr(e); resolve(null); return; }
    const S = new Studio(orig, mode, resolve, { name, pageAspect });
    S.mount();
  });
}

class Studio {
  constructor(orig, mode, resolve, opts) {
    window.__studio = this;
    this.orig = orig; this.mode = mode; this.resolve = resolve; this.opts = opts;
    this.W = orig.width; this.H = orig.height;
    this.work = cnv(this.W, this.H); this.work.x.putImageData(orig, 0, 0);       // current pixels
    this.origC = cnv(this.W, this.H); this.origC.x.putImageData(orig, 0, 0);    // untouched original
    this.mask = cnv(this.W, this.H);                                             // selection / paint mask (alpha)
    this.alpha = null;                                                           // removebg: cut-out matte (alpha channel)
    this.undoStack = []; this.redoStack = [];
    this.tool = mode === 'removebg' ? 'restore' : 'brush'; this.brush = 48; this.auto = mode === 'erase';
    this.view = { s: 1, x: 0, y: 0 }; this.busyN = 0; this.samKey = 'k' + Math.random().toString(36).slice(2);
    this.last = null; // last clicked object: {points, masks, pick}
    this.bg = { type: 'transparent', color: '#ffffff', blur: 18 }; this.outline = { on: false, width: 12, color: '#ffffff' };
    this.expand = { ratio: 'page', grow: 30, posX: 0.5, posY: 0.5 };
    this.grow = 1;
  }
  mount() {
    const [title, icon] = TITLES[this.mode];
    this.el = h('div.studio');
    this.side = h('div.studio-side');
    this.viewEl = h('div.studio-view');
    this.canvas = h('canvas'); this.cursor = h('div.cursor'); this.hint = h('div.hint');
    this.viewEl.append(this.canvas, this.cursor, this.hint);
    this.undoB = btn('', () => this.undo(), { icon: 'undo-2', cls: 'ghost icon', title: 'Undo' });
    this.redoB = btn('', () => this.redo(), { icon: 'redo-2', cls: 'ghost icon', title: 'Redo' });
    const cmp = btn('Hold to compare', null, { icon: 'split', cls: 'ghost' });
    cmp.addEventListener('pointerdown', () => { this.comparing = true; this.draw(); });
    addEventListener('pointerup', () => { if (this.comparing) { this.comparing = false; this.draw(); } });
    this.doneB = btn(this.mode === 'grab' ? 'Done' : 'Apply', () => this.finish(), { cls: 'primary', icon: 'check' });
    this.el.append(
      h('div.studio-top.drag', h('h3', { html: ico(icon) + title }), h('div', { style: { flex: 1 } }),
        h('div.no-drag', { style: { display: 'flex', gap: '6px' } }, this.undoB, this.redoB, this.mode !== 'expand' ? cmp : null, btn('Cancel', () => this.cancel(), { cls: 'ghost' }), this.doneB)),
      h('div.studio-main', this.side, this.viewEl));
    document.body.append(this.el);
    this.keys = (e) => this.onKey(e); addEventListener('keydown', this.keys, true);
    this.menuUndo = () => this.guard('u') && this.undo(); this.menuRedo = () => this.guard('r') && this.redo();
    document.addEventListener('studio-undo', this.menuUndo); document.addEventListener('studio-redo', this.menuRedo);
    this.ro = new ResizeObserver(() => { this.resize(); }); this.ro.observe(this.viewEl);
    this.wire();
    this.buildSide();
    this.resize(true);
    this.start();
  }
  guard(k) { const t = performance.now(); this._g = this._g || {}; if (this._g[k] && t - this._g[k] < 150) return false; this._g[k] = t; return true; }
  close(result) { removeEventListener('keydown', this.keys, true); document.removeEventListener('studio-undo', this.menuUndo); document.removeEventListener('studio-redo', this.menuRedo); this.ro.disconnect(); this.el.remove(); call('reset').catch(() => {}); this.resolve(result); }
  async cancel() { if (this.undoStack.length && !(await confirmBox('Leave without applying?', 'Your changes in this picture will be lost.', 'Leave'))) return; this.close(null); }
  onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (this.guard(e.shiftKey ? 'r' : 'u')) e.shiftKey ? this.redo() : this.undo(); }
    else if (e.key === '[') { this.setBrush(this.brush - 6); } else if (e.key === ']') { this.setBrush(this.brush + 6); }
    else if (e.code === 'Space') { this.space = true; e.preventDefault(); }
    else if (e.key === 'Enter' && this.mode === 'erase' && !this.auto) this.eraseNow();
    e.stopPropagation();
  }

  // ───── view ─────
  resize(fit) {
    const r = this.viewEl.getBoundingClientRect(); const dpr = devicePixelRatio || 1;
    this.vw = r.width; this.vh = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    if (fit || !this.fitted) this.fit();
    this.draw();
  }
  frame() { if (this.mode === 'expand') { const e = this.expandGeom(); return { w: e.W, h: e.H }; } return { w: this.W, h: this.H }; }
  fit() { const f = this.frame(); const s = Math.min((this.vw - 80) / f.w, (this.vh - 80) / f.h); this.view = { s, x: (this.vw - f.w * s) / 2, y: (this.vh - f.h * s) / 2 }; this.fitted = true; }
  toImg(e) { const r = this.canvas.getBoundingClientRect(); const off = this.mode === 'expand' ? this.expandGeom() : { ox: 0, oy: 0 }; return { x: (e.clientX - r.left - this.view.x) / this.view.s - off.ox, y: (e.clientY - r.top - this.view.y) / this.view.s - off.oy }; }
  draw() {
    const c = this.canvas, x = c.getContext('2d'); const dpr = devicePixelRatio || 1;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
    x.setTransform(dpr * this.view.s, 0, 0, dpr * this.view.s, dpr * this.view.x, dpr * this.view.y);
    x.imageSmoothingQuality = 'high';
    if (this.mode === 'expand') return this.drawExpand(x);
    if (this.comparing) { x.drawImage(this.origC.c, 0, 0); return; }
    if (this.mode === 'removebg' && this.alpha) {
      this.drawBgPreview(x);
    } else x.drawImage(this.work.c, 0, 0);
    // selection overlay
    if (this.mode !== 'removebg' && this.hasMask) {
      const t = this.tint || (this.tint = cnv(this.W, this.H));
      if (this.tintDirty !== false) { t.x.clearRect(0, 0, this.W, this.H); t.x.globalCompositeOperation = 'source-over'; t.x.drawImage(this.mask.c, 0, 0); t.x.globalCompositeOperation = 'source-in'; t.x.fillStyle = 'rgba(70,230,162,1)'; t.x.fillRect(0, 0, this.W, this.H); t.x.globalCompositeOperation = 'source-over'; this.tintDirty = false; }
      x.globalAlpha = 0.5; x.drawImage(t.c, 0, 0); x.globalAlpha = 1;
    }
  }
  drawBgPreview(x) {
    const cut = this.cutout(false);
    if (this.bg.type === 'color') { x.fillStyle = this.bg.color; x.fillRect(0, 0, this.W, this.H); }
    if (this.bg.type === 'blur') { x.save(); x.filter = `blur(${this.bg.blur * Math.max(this.W, this.H) / 1000}px)`; x.drawImage(this.origC.c, 0, 0); x.restore(); }
    if (this.outline.on) x.drawImage(this.outlined(cut).c, 0, 0); else x.drawImage(cut.c, 0, 0);
  }
  // the picture with the matte applied
  cutout(cache = true) {
    const k = this.cut || (this.cut = cnv(this.W, this.H));
    if (!this.cutDirty && cache) return k;
    k.x.globalCompositeOperation = 'copy'; k.x.drawImage(this.origC.c, 0, 0);
    k.x.globalCompositeOperation = 'destination-in'; k.x.drawImage(this.alpha.c, 0, 0); k.x.globalCompositeOperation = 'source-over';
    this.cutDirty = false; return k;
  }
  outlined(cut) {
    const o = this.outC || (this.outC = cnv(this.W, this.H)); const r = Math.max(1, this.outline.width * Math.max(this.W, this.H) / 1000);
    o.x.clearRect(0, 0, this.W, this.H);
    // a solid version of the matte (ignoring faint leftovers) so the outline is clean
    const sm = this.solidC || (this.solidC = cnv(this.W, this.H));
    if (this.solidFor !== this.alphaVersion) { const d = this.alpha.x.getImageData(0, 0, this.W, this.H); for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 110 ? 255 : 0; sm.x.putImageData(d, 0, 0); this.solidFor = this.alphaVersion; }
    const steps = 24; for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; o.x.drawImage(sm.c, Math.cos(a) * r, Math.sin(a) * r); }
    o.x.globalCompositeOperation = 'source-in'; o.x.fillStyle = this.outline.color; o.x.fillRect(0, 0, this.W, this.H);
    o.x.globalCompositeOperation = 'source-over'; o.x.drawImage(cut.c, 0, 0); return o;
  }

  // ───── input ─────
  wire() {
    const v = this.viewEl;
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const r = this.canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const f = Math.exp(-e.deltaY * (Math.abs(e.deltaY) < 50 ? 0.012 : 0.0025)); const s2 = clamp(this.view.s * f, 0.02, 30); this.view.x = mx - (mx - this.view.x) * (s2 / this.view.s); this.view.y = my - (my - this.view.y) * (s2 / this.view.s); this.view.s = s2; }
      else { this.view.x -= e.deltaX; this.view.y -= e.deltaY; }
      this.draw(); this.moveCursor(e);
    }, { passive: false });
    addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
    v.addEventListener('pointerdown', (e) => {
      if (this.busyN) return;
      v.setPointerCapture(e.pointerId);
      if (e.button === 1 || this.space || this.tool === 'pan') { this.pan = { x: e.clientX, y: e.clientY }; return; }
      if (e.button !== 0) return;
      if (this.mode === 'expand') { this.dragExpand = { x: e.clientX, y: e.clientY, px: this.expand.posX, py: this.expand.posY }; return; }
      const p = this.toImg(e);
      if (this.tool === 'click' || this.tool === 'keep' || this.tool === 'remove') { this.clickSelect(p, e); return; }
      if (this.tool === 'rect') { this.rect = { a: p, b: p }; return; }
      this.stroke = { pts: [p] }; this.pushUndo(); this.paint(p, p);
    });
    v.addEventListener('pointermove', (e) => {
      this.moveCursor(e);
      if (this.pan) { this.view.x += e.clientX - this.pan.x; this.view.y += e.clientY - this.pan.y; this.pan = { x: e.clientX, y: e.clientY }; this.draw(); return; }
      if (this.dragExpand) { const g = this.expandGeom(); const dx = (e.clientX - this.dragExpand.x) / this.view.s, dy = (e.clientY - this.dragExpand.y) / this.view.s; this.expand.posX = clamp(this.dragExpand.px + (g.W > this.W ? dx / (g.W - this.W) : 0), 0, 1); this.expand.posY = clamp(this.dragExpand.py + (g.H > this.H ? dy / (g.H - this.H) : 0), 0, 1); this.draw(); return; }
      const p = this.toImg(e);
      if (this.rect) { this.rect.b = p; this.drawRect(); return; }
      if (this.stroke) { const q = this.stroke.pts[this.stroke.pts.length - 1]; this.stroke.pts.push(p); this.paint(q, p); }
    });
    const up = () => {
      if (this.pan) { this.pan = null; return; }
      if (this.dragExpand) { this.dragExpand = null; return; }
      if (this.rect) { const { a, b } = this.rect; this.rect = null; if (Math.abs(a.x - b.x) > 3 && Math.abs(a.y - b.y) > 3) { this.pushUndo(); this.mask.x.fillStyle = '#fff'; this.mask.x.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); this.maskChanged(); if (this.auto) this.eraseNow(); } this.draw(); return; }
      if (this.stroke) { this.stroke = null; if (this.mode === 'removebg') { this.cutDirty = true; this.draw(); } else { this.maskChanged(); if (this.auto && this.mode === 'erase') this.eraseNow(); } }
    };
    v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
    v.addEventListener('pointerleave', () => { this.cursor.style.display = 'none'; });
  }
  moveCursor(e) {
    const brushy = ['brush', 'restore', 'erasebg'].includes(this.tool) && this.mode !== 'expand';
    if (!brushy || this.space) { this.cursor.style.display = 'none'; this.viewEl.style.cursor = this.space || this.tool === 'pan' ? 'grab' : this.mode === 'expand' ? 'move' : 'crosshair'; return; }
    const r = this.viewEl.getBoundingClientRect();
    Object.assign(this.cursor.style, { display: 'block', left: e.clientX - r.left + 'px', top: e.clientY - r.top + 'px', width: this.brush + 'px', height: this.brush + 'px' });
    this.viewEl.style.cursor = 'none';
  }
  setBrush(v) { this.brush = clamp(v, 4, 400); if (this.brushRow) this.brushRow.set(this.brush); }
  paint(a, b) {
    const r = this.brush / this.view.s;
    const target = this.mode === 'removebg' ? this.alpha.x : this.mask.x;
    target.save();
    target.globalCompositeOperation = this.mode === 'removebg' && this.tool === 'erasebg' ? 'destination-out' : 'source-over';
    target.strokeStyle = '#fff'; target.fillStyle = '#fff'; target.lineWidth = r; target.lineCap = 'round'; target.lineJoin = 'round';
    if (this.mode === 'removebg' && this.tool === 'restore') { // paint the original's own pixels back: full opacity
      target.strokeStyle = 'rgba(255,255,255,1)';
    }
    target.beginPath(); target.moveTo(a.x, a.y); target.lineTo(b.x + 0.01, b.y); target.stroke();
    target.restore();
    if (this.mode === 'removebg') { this.cutDirty = true; this.alphaVersion = (this.alphaVersion || 0) + 1; } else { this.hasMask = true; this.tintDirty = true; }
    this.draw();
  }
  drawRect() { this.draw(); const x = this.canvas.getContext('2d'); const { a, b } = this.rect; x.strokeStyle = '#46e6a2'; x.lineWidth = 2 / this.view.s; x.setLineDash([6 / this.view.s, 4 / this.view.s]); x.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); x.fillStyle = 'rgba(70,230,162,.15)'; x.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  maskChanged() { this.hasMask = this.maskArea() > 0; this.tintDirty = true; this.refreshSide(); this.draw(); }
  maskArea() { const d = this.mask.x.getImageData(0, 0, this.W, this.H).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; }
  maskBytes() { const d = this.mask.x.getImageData(0, 0, this.W, this.H).data; const m = new Uint8Array(this.W * this.H); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 40 ? 1 : 0; return m; }
  clearMask() { this.mask.x.clearRect(0, 0, this.W, this.H); this.hasMask = false; this.tintDirty = true; this.last = null; this.refreshSide(); this.draw(); }

  // ───── undo (snapshots of the pixels / matte / mask) ─────
  snap() { return { work: this.work.x.getImageData(0, 0, this.W, this.H), mask: this.mask.x.getImageData(0, 0, this.W, this.H), alpha: this.alpha ? this.alpha.x.getImageData(0, 0, this.W, this.H) : null }; }
  put(s) { this.work.x.putImageData(s.work, 0, 0); this.mask.x.putImageData(s.mask, 0, 0); if (s.alpha && this.alpha) this.alpha.x.putImageData(s.alpha, 0, 0); this.cutDirty = true; this.alphaVersion = (this.alphaVersion || 0) + 1; this.tintDirty = true; this.hasMask = this.maskArea() > 0; this.last = null; this.draw(); this.refreshSide(); }
  pushUndo() { this.undoStack.push(this.snap()); if (this.undoStack.length > (this.W * this.H > 8e6 ? 4 : 10)) this.undoStack.shift(); this.redoStack = []; this.syncUndo(); }
  undo() { if (!this.undoStack.length || this.busyN) return; this.redoStack.push(this.snap()); this.put(this.undoStack.pop()); this.syncUndo(); }
  redo() { if (!this.redoStack.length || this.busyN) return; this.undoStack.push(this.snap()); this.put(this.redoStack.pop()); this.syncUndo(); }
  syncUndo() { this.undoB.disabled = !this.undoStack.length; this.redoB.disabled = !this.redoStack.length; }

  // ───── busy ─────
  async busy(text, fn) {
    this.busyN++; const bar = h('i'); const note = h('div.small.muted', { style: { marginTop: '8px' } }, text);
    const box = h('div.working', h('div.box', h('b', text), h('div.progress.indet', { style: { marginTop: '10px' } }, bar), note));
    this.viewEl.append(box);
    try { return await fn((p) => { if (p && p.text) note.textContent = p.text; }); }
    catch (e) { toastErr(e); return null; }
    finally { box.remove(); this.busyN--; }
  }

  // ───── click to select (Segment Anything) ─────
  async samReady() {
    if (this.samOk) return true;
    if (!(await ensure(['slimsam'], 'Click to select'))) return false;
    const ok = await this.busy('Getting ready to select…', (onP) => call('samEmbed', { key: this.samKey, img: plain(this.orig) }, { onProgress: onP }));
    this.samOk = !!ok; this.refreshSide(); return this.samOk;
  }
  async clickSelect(p, e) {
    if (p.x < 0 || p.y < 0 || p.x >= this.W || p.y >= this.H) return;
    if (!(await this.samReady())) return;
    const negative = e.altKey || this.tool === 'remove';
    const refine = e.shiftKey && this.last;
    const points = refine ? [...this.last.points, { x: p.x, y: p.y, label: 1 }] : [{ x: p.x, y: p.y, label: 1 }];
    const res = await this.busy('Selecting…', () => call('samDecode', { key: this.samKey, points }));
    if (!res) return;
    // best by score, but skip masks that are almost the whole picture
    const ms = res.masks; let pick = 0;
    ms.forEach((m, i) => { const big = m.area > 0.97 * this.W * this.H; if (!big && (m.iou > ms[pick].iou || ms[pick].area > 0.97 * this.W * this.H)) pick = i; });
    this.pushUndo();
    if (this.mode === 'removebg') {
      const mk = toCanvasMask(ms[pick].mask, this.W, this.H);
      this.alpha.x.save(); this.alpha.x.globalCompositeOperation = negative ? 'destination-out' : 'source-over'; this.alpha.x.drawImage(mk.c, 0, 0); this.alpha.x.restore();
      this.cutDirty = true; this.alphaVersion = (this.alphaVersion || 0) + 1; this.draw(); return;
    }
    if (refine) this.mask.x.putImageData(this.last.before, 0, 0);
    const before = this.mask.x.getImageData(0, 0, this.W, this.H);
    const mk = toCanvasMask(ms[pick].mask, this.W, this.H);
    this.mask.x.save(); this.mask.x.globalCompositeOperation = negative ? 'destination-out' : 'source-over'; this.mask.x.drawImage(mk.c, 0, 0); this.mask.x.restore();
    this.last = negative ? null : { points, masks: ms, pick, before };
    this.maskChanged();
    if (this.auto && this.mode === 'erase' && !negative) this.eraseNow();
  }
  pickMask(i) {
    if (!this.last) return;
    this.pushUndo(); this.mask.x.putImageData(this.last.before, 0, 0);
    const mk = toCanvasMask(this.last.masks[i].mask, this.W, this.H); this.mask.x.drawImage(mk.c, 0, 0); this.last.pick = i; this.maskChanged();
  }

  // ───── modes ─────
  async start() {
    this.syncUndo();
    if (this.mode === 'removebg') await this.runRemoveBg();
    this.refreshSide();
  }
  async runRemoveBg(model) {
    model = model || this.bgModel || 'ormbg';
    if (!(await ensure([model], 'The background remover'))) { if (!this.alpha) this.close(null); return; }
    const res = await this.busy('Removing the background…', (onP) => call('removebg', { model, img: plain(this.orig), refine: this.refine !== false }, { onProgress: onP }));
    if (!res) { if (!this.alpha) this.close(null); return; }
    if (this.alpha) this.pushUndo();
    this.alpha = this.alpha || cnv(this.W, this.H);
    const id = this.alpha.x.createImageData(this.W, this.H);
    for (let i = 0; i < res.alpha.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = res.alpha[i]; }
    this.alpha.x.putImageData(id, 0, 0); this.cutDirty = true; this.alphaVersion = (this.alphaVersion || 0) + 1; this.bgModel = model; this.draw();
  }
  async eraseNow() {
    if (!this.hasMask || this.busyN) return;
    const hole = this.maskBytes();
    const useAI = await this.lamaReady();
    const img = this.work.x.getImageData(0, 0, this.W, this.H);
    const out = await this.busy('Erasing…', async (onP) => {
      if (useAI) return (await call('inpaint', { img: plain(img), hole, grow: this.grow }, { onProgress: onP })).data;
      return await this.quickFill(img, hole);
    });
    if (!out) return;
    if (!this.undoStack.length) this.pushUndo();
    this.work.x.putImageData(new ImageData(new Uint8ClampedArray(out), this.W, this.H), 0, 0);
    this.mask.x.clearRect(0, 0, this.W, this.H); this.hasMask = false; this.last = null; this.tintDirty = true; this.erased = true;
    this.draw(); this.refreshSide();
  }
  async lamaReady() {
    const m = (await models(true)).find((x) => x.id === 'lama');
    if (m.installed) return true;
    if (this.quick) return false;
    const ok = await ensure(['lama'], 'The magic eraser');
    if (!ok) { this.quick = true; toast('Using quick fill. Download the AI eraser in AI tools for much better results.', { type: 'info', ms: 5000 }); }
    return ok;
  }
  // PatchMatch on a crop around the hole (scaled down if large), for when the model isn't downloaded
  async quickFill(img, hole) {
    const W = this.W, H = this.H; let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const pad = Math.max(40, Math.round(Math.max(x1 - x0, y1 - y0) * 0.6));
    const rx = Math.max(0, x0 - pad), ry = Math.max(0, y0 - pad), rw = Math.min(W, x1 + pad) - rx, rh = Math.min(H, y1 + pad) - ry;
    const k = Math.min(1, 420 / Math.max(rw, rh)); const sw = Math.max(8, Math.round(rw * k)), sh = Math.max(8, Math.round(rh * k));
    const src = cnv(rw, rh); src.x.putImageData(img, -rx, -ry);
    const small = cnv(sw, sh); small.x.drawImage(src.c, 0, 0, sw, sh);
    const sm = new Uint8Array(sw * sh); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const X = Math.min(W - 1, rx + Math.floor(x / k)), Y = Math.min(H - 1, ry + Math.floor(y / k)); sm[y * sw + x] = hole[Y * W + X]; }
    const grown = new Uint8Array(sm); for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) if (sm[y * sw + x]) { grown[y * sw + x - 1] = grown[y * sw + x + 1] = grown[(y - 1) * sw + x] = grown[(y + 1) * sw + x] = 1; }
    const filled = await patchFill(small.x.getImageData(0, 0, sw, sh).data, sw, sh, grown);
    const f = cnv(sw, sh); f.x.putImageData(new ImageData(new Uint8ClampedArray(filled), sw, sh), 0, 0);
    const big = cnv(rw, rh); big.x.imageSmoothingQuality = 'high'; big.x.drawImage(f.c, 0, 0, rw, rh);
    const bd = big.x.getImageData(0, 0, rw, rh).data; const out = new Uint8ClampedArray(img.data);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const i = ((y + ry) * W + x + rx); if (!hole[i]) continue; const j = (y * rw + x) * 4; out[i * 4] = bd[j]; out[i * 4 + 1] = bd[j + 1]; out[i * 4 + 2] = bd[j + 2]; out[i * 4 + 3] = 255; }
    return out;
  }
  // grab: cut the selection out as its own picture and fill the hole behind it
  async grabNow() {
    if (!this.hasMask) return toast('Select the object first: click on it or paint over it.', { type: 'info' });
    const hole = this.maskBytes(); const W = this.W, H = this.H;
    let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const pw = x1 - x0 + 1, ph = y1 - y0 + 1;
    // the piece: original pixels, soft edged by the mask
    const piece = cnv(pw, ph); piece.x.drawImage(this.work.c, -x0, -y0);
    const m = cnv(pw, ph); m.x.filter = `blur(${Math.max(0.6, Math.max(W, H) / 2500)}px)`; m.x.drawImage(this.mask.c, -x0, -y0);
    piece.x.globalCompositeOperation = 'destination-in'; piece.x.drawImage(m.c, 0, 0);
    const useAI = await this.lamaReady();
    const img = this.work.x.getImageData(0, 0, W, H);
    const out = await this.busy('Lifting it out and filling in behind…', async (onP) => useAI ? (await call('inpaint', { img: plain(img), hole, grow: 1.5 }, { onProgress: onP })).data : await this.quickFill(img, hole));
    if (!out) return;
    const baseUrl = await dataUrlFrom(out, W, H, 'image/png');
    const pieceUrl = await new Promise((r) => piece.c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, 'image/png'));
    this.close({ base: baseUrl, piece: { dataUrl: pieceUrl, x: x0, y: y0, w: pw, h: ph }, scale: this.orig.width / this.W });
  }
  expandGeom() {
    const e = this.expand; let W = this.W, H = this.H;
    const ratio = e.ratio === 'page' ? (this.opts.pageAspect || 1) : e.ratio === 'grow' ? null : e.ratio;
    if (ratio) { if (W / H < ratio) W = Math.round(H * ratio); else H = Math.round(W / ratio); if (W === this.W && H === this.H) { W = Math.round(W * 1.25); H = Math.round(H * 1.25); } }
    else { W = Math.round(this.W * (1 + e.grow / 100)); H = Math.round(this.H * (1 + e.grow / 100)); }
    const max = 4096; if (Math.max(W, H) > max) { const k = max / Math.max(W, H); W = Math.round(W * k); H = Math.round(H * k); }
    const ox = Math.round((W - this.W) * e.posX), oy = Math.round((H - this.H) * e.posY);
    return { W, H, ox, oy };
  }
  drawExpand(x) {
    const g = this.expandGeom();
    if (this.expanded) { x.drawImage(this.expanded.c, 0, 0); return; }
    x.fillStyle = 'rgba(70,230,162,.10)'; x.fillRect(0, 0, g.W, g.H);
    x.strokeStyle = 'rgba(70,230,162,.9)'; x.lineWidth = 2 / this.view.s; x.setLineDash([8 / this.view.s, 6 / this.view.s]); x.strokeRect(0, 0, g.W, g.H); x.setLineDash([]);
    x.drawImage(this.work.c, g.ox, g.oy);
  }
  async expandNow() {
    if (!(await ensure(['lama'], 'Magic expand'))) return;
    const g = this.expandGeom();
    const res = await this.busy('Expanding…', (onP) => call('expand', { img: plain(this.work.x.getImageData(0, 0, this.W, this.H)), W: g.W, H: g.H, ox: g.ox, oy: g.oy, variant: (this.tries = (this.tries ?? -1) + 1) }, { onProgress: onP }));
    if (!res) return;
    this.pushUndo();
    const c = cnv(g.W, g.H); c.x.putImageData(new ImageData(new Uint8ClampedArray(res.data), g.W, g.H), 0, 0);
    this.expanded = c; this.expandedGeom = g; this.fit(); this.draw(); this.refreshSide();
  }

  // ───── finish ─────
  async finish() {
    if (this.busyN) return;
    if (this.mode === 'grab') return this.grabNow();
    if (this.mode === 'erase') {
      if (this.hasMask) { await this.eraseNow(); if (this.hasMask) return; }
      if (!this.erased) return this.close(null);
      const url = await dataUrlFrom(this.work.x.getImageData(0, 0, this.W, this.H).data, this.W, this.H, 'image/png');
      return this.close({ dataUrl: url });
    }
    if (this.mode === 'removebg') {
      if (!this.alpha) return this.close(null);
      const out = cnv(this.W, this.H); this.drawBgPreview(out.x);
      const url = await new Promise((r) => out.c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, 'image/png'));
      return this.close({ dataUrl: url, transparent: this.bg.type === 'transparent' });
    }
    if (this.mode === 'expand') {
      if (!this.expanded) { await this.expandNow(); if (!this.expanded) return; }
      const g = this.expandedGeom;
      const url = await new Promise((r) => this.expanded.c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, 'image/jpeg', 0.95));
      return this.close({ dataUrl: url, ...g, srcW: this.W, srcH: this.H, fillPage: this.expand.ratio === 'page' });
    }
  }

  // ───── side panel ─────
  refreshSide() { if (this._rs) cancelAnimationFrame(this._rs); this._rs = requestAnimationFrame(() => this.buildSide()); }
  async buildSide() {
    const s = this.side; s.innerHTML = '';
    const ms = await models();
    const has = (id) => ms.find((m) => m.id === id)?.installed;
    const toolBtn = (id, label, icon, title) => { const b = h('button' + (this.tool === id ? '.on' : ''), { title: title || label, on: { click: () => { this.tool = id; this.buildSide(); } } }); b.innerHTML = ico(icon) + label; return b; };
    this.brushRow = slider('Brush size', { min: 4, max: 300, value: this.brush, onInput: (v) => { this.brush = v; } });
    const hint = (t) => { this.hint.textContent = t; this.hint.style.display = t ? 'block' : 'none'; };
    if (this.mode === 'erase' || this.mode === 'grab') {
      s.append(h('div.p-title', this.mode === 'erase' ? 'Remove anything' : 'Pick what to grab'));
      s.append(h('div.tool-grid', toolBtn('brush', 'Brush', 'brush'), toolBtn('click', 'Click', 'mouse-pointer-click', 'Click on an object to select it'), toolBtn('rect', 'Box', 'square-dashed')));
      if (this.tool === 'brush') s.append(this.brushRow);
      if (this.tool === 'click') {
        s.append(h('div.note', { style: { marginTop: '12px' } }, h('b', 'Click'), ' an object to select it. ', h('b', 'Shift-click'), ' to add to it, ', h('b', 'Alt-click'), ' to take a part away.'));
        if (this.last) {
          s.append(h('div.sec', h('h4', 'Selection size')));
          s.append(seg([{ value: 0, label: 'Part' }, { value: 1, label: 'Object' }, { value: 2, label: 'Whole' }], this.last.pick, (v) => this.pickMask(v), { block: true }));
        }
        if (!has('slimsam')) s.append(h('p.small.muted', 'Needs the Click to select model (40 MB). It downloads when you first click.'));
      }
      if (this.mode === 'erase') {
        s.append(h('div', { style: { marginTop: '14px' } }, toggle('Erase as soon as I let go', this.auto, (v) => { this.auto = v; this.buildSide(); })));
        s.append(slider('Also remove edges & shadows', { min: 0, max: 4, step: 1, value: this.grow, fmt: (v) => ['Tight', 'Normal', 'More', 'Lots', 'Max'][v], onChange: (v) => { this.grow = v; } }));
        if (!this.auto || this.hasMask) s.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, btn('Erase', () => this.eraseNow(), { cls: 'primary block', icon: 'eraser', disabled: !this.hasMask }), btn('', () => this.clearMask(), { cls: 'icon', icon: 'x', title: 'Clear selection', disabled: !this.hasMask })));
        s.append(h('div.note', { style: { marginTop: '16px' } }, has('lama') ? [h('b', 'AI eraser is on. '), 'It rebuilds what was behind, using everything around it. Paint a little past the edges of what you want gone.'] : [h('b', 'Quick fill. '), 'Download the AI eraser (93 MB) for far better results. ', h('a', { on: { click: async () => { if (await ensure(['lama'], 'The magic eraser')) { this.quick = false; this.buildSide(); } } } }, 'Download')]));
        hint(this.tool === 'click' ? 'Click on what you want to remove' : this.tool === 'rect' ? 'Drag a box around what you want to remove' : 'Paint over what you want to remove');
      } else {
        s.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } }, btn('Grab it', () => this.grabNow(), { cls: 'primary block', icon: 'hand-grab', disabled: !this.hasMask }), btn('', () => this.clearMask(), { cls: 'icon', icon: 'x', title: 'Clear selection', disabled: !this.hasMask })));
        s.append(h('div.note', { style: { marginTop: '16px' } }, 'The object becomes its own layer you can move, resize or delete, and the space behind it is filled in.'));
        hint(this.hasMask ? 'Shift-click to add more, then press Grab it' : this.tool === 'click' ? 'Click on the object to grab' : 'Paint over the object to grab');
      }
    }
    if (this.mode === 'removebg') {
      s.append(h('div.p-title', 'Fine-tune'));
      s.append(h('div.tool-grid', toolBtn('restore', 'Keep', 'paintbrush', 'Paint to bring parts back'), toolBtn('erasebg', 'Remove', 'eraser', 'Paint to remove more'), toolBtn('keep', 'Click keep', 'mouse-pointer-click', 'Click an object to keep all of it')));
      s.append(h('div.tool-grid', { style: { marginTop: '6px' } }, toolBtn('remove', 'Click remove', 'mouse-pointer-2', 'Click an object to remove all of it'), toolBtn('pan', 'Move view', 'hand')));
      if (['restore', 'erasebg'].includes(this.tool)) s.append(this.brushRow);
      if (['keep', 'remove'].includes(this.tool)) s.append(h('p.small.muted', { style: { marginTop: '10px' } }, this.tool === 'keep' ? 'Click on any object to add all of it to the cut-out.' : 'Click on any object to take it out of the cut-out.'));
      s.append(h('div.sec', h('h4', 'New background')));
      const bgSeg = seg([{ value: 'transparent', label: 'None' }, { value: 'color', label: 'Colour' }, { value: 'blur', label: 'Blur' }], this.bg.type, (v) => { this.bg.type = v; this.buildSide(); this.draw(); }, { block: true });
      s.append(bgSeg);
      if (this.bg.type === 'color') { const sw = h('button.btn.block', { style: { marginTop: '8px', background: this.bg.color, color: '#000' }, on: { click: (e) => colorPicker(e.currentTarget, this.bg.color, (c) => { if (typeof c === 'string') { this.bg.color = c; sw.style.background = c; this.draw(); } }, { noGradient: true }) } }, 'Choose colour'); s.append(sw); }
      if (this.bg.type === 'blur') s.append(slider('Blur', { min: 2, max: 60, value: this.bg.blur, onInput: (v) => { this.bg.blur = v; this.draw(); } }));
      s.append(h('div.sec', h('h4', 'Sticker outline')));
      s.append(toggle('Outline around the cut-out', this.outline.on, (v) => { this.outline.on = v; this.buildSide(); this.draw(); }));
      if (this.outline.on) {
        s.append(slider('Thickness', { min: 2, max: 40, value: this.outline.width, onInput: (v) => { this.outline.width = v; this.draw(); } }));
        const ob = h('button.btn.block', { style: { background: this.outline.color, color: '#000' }, on: { click: (e) => colorPicker(e.currentTarget, this.outline.color, (c) => { if (typeof c === 'string') { this.outline.color = c; ob.style.background = c; this.draw(); } }, { noGradient: true }) } }, 'Outline colour'); s.append(ob);
      }
      s.append(h('div.sec', h('h4', 'Model')));
      const opts = [{ value: 'ormbg', label: 'Subjects' }]; opts.push({ value: 'isnet', label: 'Whole scene' });
      s.append(seg(opts, this.bgModel || 'ormbg', async (v) => { await this.runRemoveBg(v); this.buildSide(); }, { block: true }));
      s.append(h('p.small.dim', { style: { marginTop: '8px' } }, 'Subjects works best on people, pets and products. Whole scene keeps everything in the foreground.'));
      hint(this.tool === 'restore' ? 'Paint over parts to bring them back' : this.tool === 'erasebg' ? 'Paint over parts to remove them' : this.tool === 'keep' ? 'Click an object to keep it' : this.tool === 'remove' ? 'Click an object to remove it' : 'Drag to move around');
    }
    if (this.mode === 'expand') {
      s.append(h('div.p-title', 'New shape'));
      const ratios = [{ value: 'page', label: 'Fill page' }, { value: 1, label: '1:1' }, { value: 4 / 5, label: '4:5' }, { value: 9 / 16, label: '9:16' }, { value: 16 / 9, label: '16:9' }, { value: 3 / 2, label: '3:2' }, { value: 'grow', label: 'Bigger' }];
      const grid = h('div.chips'); for (const r of ratios) grid.append(h('button.chip' + (this.expand.ratio === r.value ? '.on' : ''), { on: { click: () => { this.expand.ratio = r.value; this.expanded = null; this.fit(); this.buildSide(); this.draw(); } } }, r.label));
      s.append(grid);
      if (this.expand.ratio === 'grow') s.append(slider('Grow by', { min: 10, max: 100, value: this.expand.grow, fmt: (v) => v + '%', onInput: (v) => { this.expand.grow = v; this.expanded = null; this.fit(); this.draw(); } }));
      s.append(h('p.small.muted', 'Drag the picture to choose where the new space goes.'));
      s.append(btn(this.expanded ? 'Try again' : 'Expand', () => this.expandNow(), { cls: 'primary block', icon: 'sparkles' }));
      if (this.expanded) s.append(h('p.small.dim', { style: { marginTop: '8px' } }, 'Happy with it? Press Apply. Otherwise try again for a different result.'));
      s.append(h('div.note', { style: { marginTop: '16px' } }, 'Works best on backgrounds like sky, walls, grass, water and textures. Faces and text at the edges may not extend well.'));
      hint(this.expanded ? '' : 'Drag the picture inside the frame');
    }
    s.append(h('div.sec', h('h4', 'Tips')));
    s.append(h('div.legend', h('span', h('kbd', 'Space'), ' + drag to move around'), h('span', h('kbd', '⌘/Ctrl'), ' + scroll or pinch to zoom'), this.mode !== 'expand' ? h('span', h('kbd', '['), ' ', h('kbd', ']'), ' brush size') : null));
    this.syncUndo();
  }
}
function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, x: c.getContext('2d', { willReadFrequently: true }) }; }
function toCanvasMask(m, w, h) { const k = cnv(w, h); const id = k.x.createImageData(w, h); for (let i = 0; i < m.length; i++) if (m[i]) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = 255; } k.x.putImageData(id, 0, 0); return k; }

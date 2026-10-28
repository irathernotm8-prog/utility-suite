// The editor: one fabric canvas showing the current page of the design, with zoom/pan, snapping, undo, pages and assets.
import { fabric, PROPS, Ro2Line, kindOf, uid } from './fab.js';
import { ensureFontsFor } from '../fonts.js';

let WORKSPACE = '#08090a'; let DIM = 'rgba(8,9,10,0.82)'; let EDGE = 'rgba(255,255,255,0.07)';
export const DEFAULT_BG = { color: '#ffffff' };
export const isClear = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(c);

// ───── gradients (stored as a simple spec in ro2Fill so the colour picker can edit them) ─────
export function makeGradient(spec) {
  const a = ((spec.angle ?? 90) * Math.PI) / 180;
  const coords = spec.type === 'radial'
    ? { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.7 }
    : { x1: 0.5 - Math.cos(a) / 2, y1: 0.5 - Math.sin(a) / 2, x2: 0.5 + Math.cos(a) / 2, y2: 0.5 + Math.sin(a) / 2 };
  return new fabric.Gradient({ type: spec.type === 'radial' ? 'radial' : 'linear', gradientUnits: 'percentage', coords, colorStops: spec.stops.map((s) => ({ offset: s.offset, color: s.color })) });
}
export const gradientCss = (spec) => spec.type === 'radial'
  ? `radial-gradient(circle, ${spec.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`
  : `linear-gradient(${(spec.angle ?? 90) + 90}deg, ${spec.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`;
// A fill value for an object: a colour string, or a gradient spec
export function fillOf(o) { if (o.ro2Fill) return o.ro2Fill; return typeof o.fill === 'string' ? o.fill : '#000000'; }

// Objects inside a multi-selection report positions relative to it; write them out in page coordinates.
function absolute(o, json) {
  if (!(o.group instanceof fabric.ActiveSelection)) return json;
  const t = fabric.util.qrDecompose(o.calcTransformMatrix());
  return { ...json, left: t.translateX, top: t.translateY, angle: t.angle, scaleX: t.scaleX, scaleY: t.scaleY, skewX: t.skewX, skewY: 0, flipX: false, flipY: false };
}

// Resize a whole design (all pages) to w × h. 'scale': things keep their place relative to the page
// (spreading out or closing up) and shrink/grow by the smaller ratio so nothing new overlaps; anything that
// covered the page still covers it. 'keep': sizes stay, positions re-centre.
export function resizeDocData(doc, w, h, mode = 'scale') {
  const W0 = doc.width, H0 = doc.height; const rx = w / W0, ry = h / H0, s = Math.min(rx, ry);
  const coverK = (o) => Math.max(w / Math.abs((o.width || 1) * (o.scaleX || 1)), h / Math.abs((o.height || 1) * (o.scaleY || 1)));
  const covers = (o) => !o.angle && Math.abs((o.width || 0) * (o.scaleX || 1)) >= W0 * 0.92 && Math.abs((o.height || 0) * (o.scaleY || 1)) >= H0 * 0.92;
  const move = (o) => {
    if (o.ro2Role === 'bgimage' || (mode === 'scale' && covers(o) && (o.type === 'Image' || o.type === 'image'))) { const k = coverK(o); return { ...o, left: w / 2, top: h / 2, scaleX: (o.scaleX || 1) * k, scaleY: (o.scaleY || 1) * k }; }
    if (mode === 'scale') return { ...o, left: o.left * rx, top: o.top * ry, scaleX: (o.scaleX || 1) * s, scaleY: (o.scaleY || 1) * s };
    return { ...o, left: o.left + (w - W0) / 2, top: o.top + (h - H0) / 2 };
  };
  doc.pages.forEach((p) => { p.objects = (p.objects || []).map(move); });
  doc.width = Math.round(w); doc.height = Math.round(h);
  return doc;
}

export class Editor extends EventTarget {
  constructor(host) {
    super();
    this.host = host;
    const el = document.createElement('canvas'); host.append(el);
    this.canvas = new fabric.Canvas(el, {
      width: host.clientWidth, height: host.clientHeight, backgroundColor: WORKSPACE, preserveObjectStacking: true,
      selectionColor: 'rgba(70,230,162,.08)', selectionBorderColor: 'rgba(70,230,162,.8)', selectionLineWidth: 1,
      stopContextMenu: true, fireRightClick: true, fireMiddleClick: true, uniformScaling: true, uniScaleKey: 'shiftKey', altActionKey: 'none', centeredKey: 'altKey',
      targetFindTolerance: 4, enableRetinaScaling: true, imageSmoothingEnabled: true, renderOnAddRemove: false,
    });
    this.doc = null; this.page = 0; this.assets = new Map(); this.assetByUrl = new Map();
    this.hist = new Map(); this.loading = false; this.guides = []; this.snap = true; this.readOnly = false; this.cropping = null;
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(host);
    this._wire();
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }
  get W() { return this.doc.width; } get H() { return this.doc.height; }
  get pageData() { return this.doc.pages[this.page]; }

  // ───── assets: image data lives once in a map; objects point at it by assetId ─────
  addAsset(dataUrl) {
    if (this.assetByUrl.has(dataUrl)) return this.assetByUrl.get(dataUrl);
    const id = 'a' + uid(); this.assets.set(id, dataUrl); this.assetByUrl.set(dataUrl, id); return id;
  }
  assetUrl(id) { return this.assets.get(id); }

  // ───── open / save ─────
  async open(doc) {
    this.doc = doc; this.page = 0; this.hist.clear();
    this.assets = new Map(Object.entries(doc.assets || {})); this.assetByUrl = new Map([...this.assets].map(([k, v]) => [v, k]));
    delete doc.assets;
    await this.loadPage(0);
    this.fit();
    this.emit('pages');
  }
  serializeObjects(list) {
    const strip = (o) => {
      if (o.type === 'Image' || o.type === 'image') { if (o.assetId) delete o.src; else if (o.src) { o.assetId = this.addAsset(o.src); delete o.src; } }
      (o.objects || []).forEach(strip); if (o.clipPath) strip(o.clipPath);
      return o;
    };
    return list.map((obj) => strip(absolute(obj, obj.toObject(PROPS))));
  }
  pageSnapshot() {
    const objs = this.canvas.getObjects().filter((o) => !o.ro2Role || o.ro2Role === 'bgimage');
    return { id: this.pageData.id, bg: this.pageData.bg, objects: this.serializeObjects(objs) };
  }
  syncPage() { if (this.doc && !this.loading) this.doc.pages[this.page] = { ...this.pageData, ...this.pageSnapshot() }; }
  resolveAssets(objs) {
    const walk = (o) => { if ((o.type === 'Image' || o.type === 'image') && o.assetId) o.src = this.assets.get(o.assetId) || o.src; (o.objects || []).forEach(walk); if (o.clipPath) walk(o.clipPath); return o; };
    return JSON.parse(JSON.stringify(objs)).map(walk);
  }
  // The whole design as one JSON string (with the assets it uses)
  toFile() {
    this.syncPage();
    const used = new Set(); const walk = (o) => { if (o.assetId) used.add(o.assetId); if (o.ro2GradeSrc) used.add(o.ro2GradeSrc); (o.objects || []).forEach(walk); if (o.clipPath) walk(o.clipPath); };
    this.doc.pages.forEach((p) => p.objects.forEach(walk));
    const assets = {}; for (const id of used) if (this.assets.has(id)) assets[id] = this.assets.get(id);
    return { ...this.doc, assets, updated: Date.now() };
  }

  async loadPage(i) {
    this.loading = true;
    this.page = i; const p = this.doc.pages[i];
    this.canvas.discardActiveObject();
    const objs = this.resolveAssets(p.objects || []);
    await ensureFontsFor(objs);
    const live = await fabric.util.enlivenObjects(objs);
    this.canvas.clear(); this.canvas.backgroundColor = WORKSPACE;
    this._bgRect = this._makeBg(p.bg || DEFAULT_BG, true);
    this.canvas.add(this._bgRect, ...live);
    live.forEach((o) => this._prep(o));
    this.loading = false;
    if (!this.hist.has(p.id)) this.hist.set(p.id, { stack: [JSON.stringify(this.pageSnapshot())], idx: 0 });
    this.canvas.requestRenderAll();
    this.emit('page', i); this.emit('selection', []);
  }
  _makeBg(bg, editor) {
    const r = new fabric.Rect({ left: this.W / 2, top: this.H / 2, width: this.W, height: this.H, strokeWidth: 0, selectable: false, evented: false, hoverCursor: 'default', objectCaching: false });
    r.ro2Role = 'bg';
    r.set('fill', this._bgFill(bg, editor));
    if (editor) r.shadow = new fabric.Shadow({ color: 'rgba(0,0,0,.55)', blur: 40, offsetX: 0, offsetY: 8 });
    return r;
  }
  makeBgObject(bg) { return this._makeBg(bg, false); }
  // In the editor a see-through page shows a checkerboard; exports stay transparent
  _bgFill(bg, editor) {
    if (bg.gradient) return makeGradient(bg.gradient);
    if (editor && isClear(bg.color)) {
      if (!this._checker) { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#e3e6e8'; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16); this._checker = c; }
      return new fabric.Pattern({ source: this._checker, repeat: 'repeat', patternTransform: [Math.max(1, this.W / 1200), 0, 0, Math.max(1, this.W / 1200), 0, 0] });
    }
    return bg.color || 'rgba(0,0,0,0)';
  }
  setBackground(bg, { commit = true } = {}) {
    this.pageData.bg = bg;
    this._bgRect.set('fill', this._bgFill(bg, true));
    this._bgRect.dirty = true; this.canvas.requestRenderAll();
    if (commit) this.commit(); this.emit('background', bg);
  }
  // Per-object setup when added or loaded
  _prep(o) {
    if (!o.id) o.id = uid();
    if (o instanceof fabric.Textbox) { o.set({ lockScalingFlip: true }); o.setControlsVisibility({ mt: false, mb: false }); }
    if (o instanceof fabric.FabricImage) o.setControlsVisibility({ mt: true, mb: true, ml: true, mr: true });
    if (o.ro2Role === 'bgimage') o.set({ selectable: true, hasControls: false, lockMovementX: true, lockMovementY: true, hoverCursor: 'default' });
    if (o.ro2Locked) this._applyLock(o, true);
    if (o.strokeWidth && o.strokeUniform === undefined) o.strokeUniform = true;
  }

  // ───── pages ─────
  async gotoPage(i) { if (i === this.page || i < 0 || i >= this.doc.pages.length) return; this.syncPage(); await this.loadPage(i); this.emit('pages'); }
  async addPage(after = this.page, copy = false) {
    this.syncPage();
    const src = this.doc.pages[after];
    const page = copy ? { ...JSON.parse(JSON.stringify(src)), id: uid() } : { id: uid(), bg: { ...(src.bg && !src.bg.gradient ? src.bg : DEFAULT_BG) }, objects: [] };
    if (copy) page.objects.forEach(function re(o) { o.id = uid(); (o.objects || []).forEach(re); });
    this.doc.pages.splice(after + 1, 0, page);
    await this.loadPage(after + 1); this.emit('pages'); this.emit('change');
  }
  async deletePage(i) {
    if (this.doc.pages.length < 2) return;
    this.syncPage(); this.doc.pages.splice(i, 1); this.hist.delete(this.doc.pages[i]?.id);
    await this.loadPage(Math.min(i, this.doc.pages.length - 1)); this.emit('pages'); this.emit('change');
  }
  async movePage(from, to) {
    this.syncPage(); const [p] = this.doc.pages.splice(from, 1); this.doc.pages.splice(to, 0, p);
    this.page = this.doc.pages.indexOf(this.doc.pages.find((x) => x.id === this.pageData?.id) || p);
    this.page = to; this.emit('pages'); this.emit('change');
  }

  // ───── history ─────
  commit() {
    if (this.loading || !this.doc) return;
    const h = this.hist.get(this.pageData.id); if (!h) return;
    const snap = JSON.stringify(this.pageSnapshot());
    if (h.stack[h.idx] === snap) return;
    h.stack.splice(h.idx + 1); h.stack.push(snap); if (h.stack.length > 80) h.stack.shift(); h.idx = h.stack.length - 1;
    this.syncPage(); this.emit('change'); this.emit('history');
  }
  canUndo() { const h = this.doc && this.hist.get(this.pageData.id); return !!h && h.idx > 0; }
  canRedo() { const h = this.doc && this.hist.get(this.pageData.id); return !!h && h.idx < h.stack.length - 1; }
  async _restore(snap) {
    const sel = this.canvas.getActiveObjects().map((o) => o.id);
    const p = JSON.parse(snap); this.pageData.objects = p.objects; this.pageData.bg = p.bg;
    await this.loadPage(this.page);
    const again = this.canvas.getObjects().filter((o) => sel.includes(o.id));
    if (again.length === 1) this.canvas.setActiveObject(again[0]);
    this.canvas.requestRenderAll(); this.emit('change'); this.emit('history'); this.emit('background', p.bg);
  }
  async undo() { const h = this.hist.get(this.pageData.id); if (!h || h.idx === 0) return; h.idx--; await this._restore(h.stack[h.idx]); }
  async redo() { const h = this.hist.get(this.pageData.id); if (!h || h.idx >= h.stack.length - 1) return; h.idx++; await this._restore(h.stack[h.idx]); }

  // ───── view ─────
  _resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    const first = !this._sized; this._sized = true;
    this.canvas.setDimensions({ width: w, height: h });
    if (first || this._autoFit) this.fit(); else this.canvas.requestRenderAll();
  }
  fit() {
    if (!this.doc) return;
    const cw = this.canvas.width, ch = this.canvas.height, pad = Math.min(64, Math.max(24, cw * 0.05));
    const z = Math.max(0.02, Math.min((cw - pad * 2) / this.W, (ch - pad * 2) / this.H, 8));
    this.canvas.setViewportTransform([z, 0, 0, z, (cw - this.W * z) / 2, (ch - this.H * z) / 2]);
    this._autoFit = true; this._afterView();
  }
  zoom() { return this.canvas.getZoom(); }
  setZoom(z, at) {
    z = Math.max(0.02, Math.min(16, z));
    const p = at || new fabric.Point(this.canvas.width / 2, this.canvas.height / 2);
    this.canvas.zoomToPoint(p, z); this._autoFit = false; this._afterView();
  }
  zoomBy(f, at) { this.setZoom(this.zoom() * f, at); }
  panBy(dx, dy) { const v = this.canvas.viewportTransform.slice(); v[4] += dx; v[5] += dy; this.canvas.setViewportTransform(v); this._autoFit = false; this._afterView(); }
  _afterView() { this.canvas.getObjects().forEach((o) => o.setCoords()); this.canvas.requestRenderAll(); this.emit('zoom', this.zoom()); this.emit('view'); }
  // screen rect (relative to host) of an object, for floating toolbars
  screenRect(o) {
    const r = o.getBoundingRect(); const v = this.canvas.viewportTransform;
    return { x: r.left * v[0] + v[4], y: r.top * v[3] + v[5], w: r.width * v[0], h: r.height * v[3] };
  }
  center() { return { x: this.W / 2, y: this.H / 2 }; }
  // where new things go: the middle of what's visible, or the page centre
  dropPoint() {
    const v = this.canvas.viewportTransform; const cx = (this.canvas.width / 2 - v[4]) / v[0], cy = (this.canvas.height / 2 - v[5]) / v[3];
    return { x: Math.max(0, Math.min(this.W, cx)), y: Math.max(0, Math.min(this.H, cy)) };
  }

  // ───── objects ─────
  add(o, { select = true, at, commit = true, index } = {}) {
    this._prep(o);
    if (at) o.set({ left: at.x, top: at.y });
    if (index != null) this.canvas.insertAt(index, o); else this.canvas.add(o);
    o.setCoords();
    if (select) this.canvas.setActiveObject(o);
    this.canvas.requestRenderAll();
    if (commit) this.commit();
    return o;
  }
  active() { return this.canvas.getActiveObject(); }
  selected() { return this.canvas.getActiveObjects(); }
  userObjects() { return this.canvas.getObjects().filter((o) => !o.ro2Role || o.ro2Role === 'bgimage'); }
  select(o) { if (!o) this.canvas.discardActiveObject(); else if (Array.isArray(o)) { if (o.length === 1) this.canvas.setActiveObject(o[0]); else if (o.length) this.canvas.setActiveObject(new fabric.ActiveSelection(o, { canvas: this.canvas })); } else this.canvas.setActiveObject(o); this.canvas.requestRenderAll(); this.emit('selection', this.selected()); }
  selectAll() { const objs = this.userObjects().filter((o) => o.selectable !== false && !o.ro2Locked && o.visible !== false && o.ro2Role !== 'bgimage'); this.select(objs); }
  set(o, props, { commit = true } = {}) {
    const list = o instanceof fabric.ActiveSelection ? o.getObjects() : Array.isArray(o) ? o : [o];
    for (const x of list) { x.set(props); x.dirty = true; x.setCoords(); }
    if (o instanceof fabric.ActiveSelection) o.setCoords();
    this.canvas.requestRenderAll(); if (commit) this.commit(); this.emit('modified', list);
  }
  remove(objs = this.selected()) {
    if (!objs.length) return;
    this.canvas.discardActiveObject(); this.canvas.remove(...objs); this.canvas.requestRenderAll(); this.commit(); this.emit('selection', []);
  }
  async clone(o) { const c = await o.clone(PROPS); c.id = uid(); if (c instanceof fabric.Group) c.getObjects().forEach((x) => { x.id = uid(); }); return c; }
  async duplicate() {
    const sel = this.selected(); if (!sel.length) return;
        this.canvas.discardActiveObject();
    const out = [];
    for (const o of sel) { const c = await this.clone(o); c.set({ left: o.left + 24, top: o.top + 24 }); this._unlockCopy(c); const idx = this.canvas.getObjects().indexOf(o); this.canvas.insertAt(idx + 1 + out.length, c); this._prep(c); out.push(c); }
    this.select(out); this.commit(); return out;
  }
  _unlockCopy(c) { if (c.ro2Role === 'bgimage') { c.ro2Role = undefined; c.set({ hasControls: true, lockMovementX: false, lockMovementY: false, hoverCursor: null }); } }
  // Copy / paste between pages and designs (as serialized objects + their assets)
  copy() {
    const sel = this.selected(); if (!sel.length) return null;
    const objs = this.serializeObjects(sel);
    const assets = {}; const walk = (o) => { if (o.assetId) assets[o.assetId] = this.assets.get(o.assetId); if (o.ro2GradeSrc) assets[o.ro2GradeSrc] = this.assets.get(o.ro2GradeSrc); (o.objects || []).forEach(walk); };
    objs.forEach(walk);
    this._clip = { objs, assets, n: 0 }; return this._clip;
  }
  async paste(clip = this._clip) {
    if (!clip) return;
    for (const [id, url] of Object.entries(clip.assets || {})) if (!this.assets.has(id)) { this.assets.set(id, url); this.assetByUrl.set(url, id); }
    clip.n = (clip.n || 0) + 1;
    const objs = this.resolveAssets(clip.objs); await ensureFontsFor(objs);
    const live = await fabric.util.enlivenObjects(objs);
    this.canvas.discardActiveObject();
    for (const o of live) { o.id = uid(); o.set({ left: o.left + 24 * clip.n, top: o.top + 24 * clip.n }); this._unlockCopy(o); this._prep(o); this.canvas.add(o); }
    this.select(live); this.commit();
  }

  // ───── arrange ─────
  _bottomIndex() { return 1; } // 0 is the page background
  bringForward() { for (const o of this.selected()) this.canvas.bringObjectForward(o, true); this._done(); }
  sendBackward() { for (const o of this.selected()) { if (this.canvas.getObjects().indexOf(o) > this._bottomIndex()) this.canvas.sendObjectBackwards(o, true); } this._done(); }
  bringToFront() { for (const o of this.selected()) this.canvas.bringObjectToFront(o); this._done(); }
  sendToBack() { const sel = this.selected(); for (let i = sel.length - 1; i >= 0; i--) this.canvas.moveObjectTo(sel[i], this._bottomIndex()); this._done(); }
  moveTo(o, index) { this.canvas.moveObjectTo(o, Math.max(this._bottomIndex(), index)); this._done(); }
  _done() { this.canvas.requestRenderAll(); this.commit(); this.emit('layers'); }
  // align to the page (one object) or to the selection bounds (several)
  align(how) {
    const act = this.active(); if (!act) return;
    const items = act instanceof fabric.ActiveSelection ? act.getObjects() : [act];
    const box = (o) => { const pts = o.getCoords(); const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
    const toPage = items.length === 1;
    let ref; if (toPage) ref = { x0: 0, x1: this.W, y0: 0, y1: this.H };
    else { const bs = items.map(box); ref = { x0: Math.min(...bs.map((b) => b.x0)), x1: Math.max(...bs.map((b) => b.x1)), y0: Math.min(...bs.map((b) => b.y0)), y1: Math.max(...bs.map((b) => b.y1)) }; }
    this.canvas.discardActiveObject();
    for (const o of items) {
      const b = box(o); let dx = 0, dy = 0;
      if (how === 'left') dx = ref.x0 - b.x0; if (how === 'right') dx = ref.x1 - b.x1; if (how === 'hcenter') dx = (ref.x0 + ref.x1) / 2 - (b.x0 + b.x1) / 2;
      if (how === 'top') dy = ref.y0 - b.y0; if (how === 'bottom') dy = ref.y1 - b.y1; if (how === 'vcenter') dy = (ref.y0 + ref.y1) / 2 - (b.y0 + b.y1) / 2;
      o.set({ left: o.left + dx, top: o.top + dy }); o.setCoords();
    }
    this.select(items); this.commit();
  }
  distribute(axis) {
    const act = this.active(); if (!(act instanceof fabric.ActiveSelection)) return;
    const items = act.getObjects().slice(); if (items.length < 3) return;
    this.canvas.discardActiveObject();
    const c = (o) => o.getCenterPoint();
    items.sort((a, b) => (axis === 'h' ? c(a).x - c(b).x : c(a).y - c(b).y));
    const first = c(items[0]), last = c(items[items.length - 1]);
    items.forEach((o, i) => { const t = i / (items.length - 1); const p = c(o); if (axis === 'h') o.set({ left: o.left + (first.x + (last.x - first.x) * t - p.x) }); else o.set({ top: o.top + (first.y + (last.y - first.y) * t - p.y) }); o.setCoords(); });
    this.select(items); this.commit();
  }
  group() {
    const act = this.active(); if (!(act instanceof fabric.ActiveSelection)) return;
    const objs = act.getObjects().slice(); const idx = Math.min(...objs.map((o) => this.canvas.getObjects().indexOf(o)));
    this.canvas.discardActiveObject(); this.canvas.remove(...objs);
    const g = new fabric.Group(objs, { subTargetCheck: false, interactive: false }); g.id = uid();
    this.canvas.insertAt(idx, g); this.select(g); this.commit(); return g;
  }
  ungroup() {
    const g = this.active(); if (!(g instanceof fabric.Group) || g instanceof fabric.ActiveSelection) return;
    const idx = this.canvas.getObjects().indexOf(g);
    const items = g.removeAll(); this.canvas.remove(g);
    items.forEach((o, i) => { this.canvas.insertAt(idx + i, o); this._prep(o); o.setCoords(); });
    this.select(items); this.commit();
  }
  _applyLock(o, on) {
    o.ro2Locked = on || undefined;
    o.set({ lockMovementX: on, lockMovementY: on, lockScalingX: on, lockScalingY: on, lockRotation: on, hasControls: !on, editable: o instanceof fabric.Textbox ? !on : undefined });
  }
  toggleLock() { const sel = this.selected(); const on = !sel.every((o) => o.ro2Locked); sel.forEach((o) => this._applyLock(o, on)); this.canvas.requestRenderAll(); this.commit(); this.emit('selection', sel); }
  flip(axis) { const sel = this.selected(); sel.forEach((o) => o.set(axis === 'x' ? { flipX: !o.flipX } : { flipY: !o.flipY })); this.canvas.requestRenderAll(); this.commit(); }
  nudge(dx, dy) { const a = this.active(); if (!a || a.lockMovementX) return; a.set({ left: a.left + dx, top: a.top + dy }); a.setCoords(); this.canvas.requestRenderAll(); this._nudged(); }
  _nudged = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => this.commit(), 350); this.emit('modified', this.selected()); }; })();

  // Change the design's size. mode: 'scale' (fit content to the new size) or 'keep' (keep sizes, re-centre)
  async resize(w, h, mode = 'scale') {
    this.syncPage();
    resizeDocData(this.doc, w, h, mode);
    this.hist.clear();
    await this.loadPage(this.page); this.fit(); this.emit('pages'); this.emit('change'); this.emit('resized');
  }

  // ───── wiring: snapping, guides, scale-to-size, events ─────
  _wire() {
    const c = this.canvas;
    const sel = () => this.emit('selection', this.selected());
    c.on('selection:created', sel); c.on('selection:updated', sel); c.on('selection:cleared', sel);
    c.on('object:modified', (e) => { this._bakeScale(e.target); this.guides = []; this.commit(); this.emit('modified', this.selected()); });
    c.on('text:editing:exited', (e) => { const t = e.target; if (t && !t.text.trim()) { c.remove(t); } this.commit(); });
    c.on('text:changed', () => this.emit('modified', this.selected()));
    c.on('object:moving', (e) => this._snapMove(e));
    c.on('object:scaling', (e) => { this._liveSize = e.target; this.emit('transform', e.target); });
    c.on('object:resizing', (e) => { this._liveSize = e.target; this.emit('transform', e.target); });
    c.on('object:rotating', (e) => { this._liveAngle = e.target; this.emit('transform', e.target); });
    c.on('mouse:up', () => { if (this.guides.length || this._liveSize || this._liveAngle) { this.guides = []; this._liveSize = this._liveAngle = null; c.requestRenderAll(); } this.emit('view'); });
    c.on('after:render', ({ ctx }) => { if (ctx === c.getContext() && this.doc) this._drawOverlay(ctx); });
    c.on('mouse:dblclick', (e) => { if (e.target && e.target instanceof fabric.FabricImage && !e.target.ro2Locked) this.emit('image-dblclick', e.target); else if (!e.target) this.emit('empty-dblclick'); });
    c.on('mouse:down', (e) => { if (e.e.button === 2) this.emit('contextmenu', { target: e.target, x: e.e.clientX, y: e.e.clientY }); });
    // pan & zoom: pinch/ctrl+wheel zooms at the pointer, two-finger scroll pans
    c.on('mouse:wheel', (opt) => {
      const e = opt.e; e.preventDefault(); e.stopPropagation();
      if (e.ctrlKey || e.metaKey) { const f = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.012 : 0.0025)); this.zoomBy(f, new fabric.Point(e.offsetX, e.offsetY)); }
      else this.panBy(-e.deltaX, -e.deltaY);
    });
    let panning = null; let space = false;
    addEventListener('keydown', (e) => { if (e.code === 'Space' && !this._typing(e)) { if (!space) { space = true; this.host.classList.add('panning'); c.skipTargetFind = true; c.selection = false; } e.preventDefault(); } });
    addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; this.host.classList.remove('panning'); c.skipTargetFind = false; c.selection = true; } });
    c.on('mouse:down:before', (o) => { const e = o.e; if (space || e.button === 1) { panning = { x: e.clientX, y: e.clientY }; c.selection = false; } });
    c.on('mouse:move', (o) => { if (!panning) return; const e = o.e; this.panBy(e.clientX - panning.x, e.clientY - panning.y); panning = { x: e.clientX, y: e.clientY }; });
    c.on('mouse:up', () => { if (panning) { panning = null; c.selection = !space; } });
  }
  _typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) || (this.active() && this.active().isEditing); }
  // Turn a resize into real size, so corners stay round and text keeps a crisp font size
  _bakeScale(o) {
    if (!o || o instanceof fabric.ActiveSelection) return;
    if (o instanceof fabric.Textbox && (o.scaleX !== 1 || o.scaleY !== 1)) {
      const s = o.scaleX; o.set({ fontSize: Math.max(1, Math.round(o.fontSize * s * 10) / 10), width: o.width * s, scaleX: 1, scaleY: 1 });
      if (o.styles) for (const line of Object.values(o.styles)) for (const ch of Object.values(line)) if (ch.fontSize) ch.fontSize *= s;
      o.initDimensions(); o.setCoords();
    } else if (o.ro2Curve && o instanceof fabric.IText && (o.scaleX !== 1 || o.scaleY !== 1)) {
      const s = o.scaleX; o.set({ fontSize: Math.max(1, o.fontSize * s), scaleX: 1, scaleY: 1 });
      import('./objects.js').then((m) => m.setCurve(this, o, o.ro2Curve)).then(() => this.commit());
    } else if ((o instanceof fabric.Rect) && (o.scaleX !== 1 || o.scaleY !== 1)) {
      o.set({ width: o.width * o.scaleX, height: o.height * o.scaleY, scaleX: 1, scaleY: 1 }); o.setCoords();
    } else if (o instanceof Ro2Line && o.scaleX !== 1) { o.set({ width: o.width * o.scaleX, scaleX: 1 }); o.setCoords(); }
  }
  _snapMove(e) {
    const o = e.target; this.guides = [];
    if (!this.snap || e.e.metaKey || e.e.ctrlKey) return;
    const tol = 7 / this.zoom(); o.setCoords();
    const bb = (x) => { const pts = x.getCoords(); const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; };
    const me = bb(o);
    const vx = [0, this.W / 2, this.W], vy = [0, this.H / 2, this.H];
    const moving = o instanceof fabric.ActiveSelection ? o.getObjects() : [o];
    for (const other of this.userObjects()) {
      if (moving.includes(other) || other.visible === false || other.ro2Role === 'bgimage') continue;
      const b = bb(other); vx.push(b.x0, b.cx, b.x1); vy.push(b.y0, b.cy, b.y1);
    }
    const best = (cands, vals) => { let r = null; for (const v of vals) for (const [k, m] of cands) { const d = v - m; if (Math.abs(d) <= tol && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, v, k }; } return r; };
    const sx = best([['x0', me.x0], ['cx', me.cx], ['x1', me.x1]], vx), sy = best([['y0', me.y0], ['cy', me.cy], ['y1', me.y1]], vy);
    if (sx) { o.set({ left: o.left + sx.d }); this.guides.push({ x: sx.v }); }
    if (sy) { o.set({ top: o.top + sy.d }); this.guides.push({ y: sy.v }); }
    if (sx || sy) o.setCoords();
  }
  _drawOverlay(ctx) {
    const v = this.canvas.viewportTransform, W = this.W, H = this.H;
    ctx.save(); ctx.transform(...v);
    // fade everything outside the page
    const big = 1e6 / v[0];
    ctx.beginPath(); ctx.rect(-big, -big, big * 2 + W, big * 2 + H); ctx.rect(0, 0, W, H);
    ctx.fillStyle = DIM; ctx.fill('evenodd');
    ctx.lineWidth = 1 / v[0]; ctx.strokeStyle = EDGE; ctx.strokeRect(0, 0, W, H);
    // snap guides
    if (this.guides.length) {
      ctx.strokeStyle = '#ff4fa3'; ctx.lineWidth = 1.2 / v[0]; ctx.setLineDash([4 / v[0], 3 / v[0]]);
      for (const g of this.guides) { ctx.beginPath(); if (g.x != null) { ctx.moveTo(g.x, -H * 0.05); ctx.lineTo(g.x, H * 1.05); } else { ctx.moveTo(-W * 0.05, g.y); ctx.lineTo(W * 1.05, g.y); } ctx.stroke(); }
      ctx.setLineDash([]);
    }
    ctx.restore();
    // live size / angle bubble
    const t = this._liveSize || this._liveAngle;
    if (t) {
      const r = this.screenRect(t);
      const label = this._liveAngle ? `${Math.round(((t.angle % 360) + 360) % 360)}°` : (() => { const w = t.getScaledWidth(), h = t.getScaledHeight(); return `${Math.round(w)} × ${Math.round(h)}`; })();
      ctx.save(); ctx.font = '700 11px UI, system-ui'; const tw = ctx.measureText(label).width + 14;
      const x = r.x + r.w / 2 - tw / 2, y = r.y + r.h + 40;
      ctx.fillStyle = 'rgba(18,21,24,.95)'; ctx.beginPath(); ctx.roundRect(x, y, tw, 22, 6); ctx.fill();
      ctx.fillStyle = '#e9eef1'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 7, y + 11.5); ctx.restore();
    }
  }
  // colours of the workspace around the page follow the app theme
  applyTheme() {
    const cs = getComputedStyle(document.documentElement);
    WORKSPACE = cs.getPropertyValue('--workspace').trim() || WORKSPACE; DIM = cs.getPropertyValue('--dim').trim() || DIM;
    EDGE = document.documentElement.dataset.theme === 'light' ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
    this.canvas.backgroundColor = WORKSPACE; this.canvas.requestRenderAll();
  }
  kindOf(o) { return kindOf(o); }
  dispose() { this._ro.disconnect(); this.canvas.dispose(); }
}
export { fabric };

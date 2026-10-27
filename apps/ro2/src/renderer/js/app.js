// Shared app state and the actions every part of the UI uses (open, save, add things, AI tools).
import { Editor, DEFAULT_BG } from './editor/editor.js';
import { fabric, uid } from './editor/fab.js';
import { makeImage, makeSvg, replaceImage, loadImage } from './editor/objects.js';
import { thumb } from './editor/render.js';
import { toast, toastErr, busy, debounce, h } from './ui.js';
import { openStudio } from './ai/studio.js';
import { ensureFont } from './fonts.js';
import { buildTemplate } from './templates.js';

export const app = {
  editor: null, file: null, view: 'home', settings: {}, info: {}, saving: false, dirty: false, lastThumb: 0, thumbUrl: null,
  listeners: {},
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
  emit(ev, d) { (this.listeners[ev] || []).forEach((f) => f(d)); },
};

export function ensureEditor() {
  if (app.editor) return app.editor;
  const ed = new Editor(document.getElementById('canvasHost'));
  ed.snap = app.settings.snap !== false;
  ed.on('change', () => { app.dirty = true; autosave(); app.emit('saved-state', 'unsaved'); });
  app.editor = ed;
  return ed;
}

// ───── designs ─────
export function blankDoc(w, h, name) {
  return { v: 1, id: uid(), name: name || 'Untitled design', width: Math.round(w), height: Math.round(h), pages: [{ id: uid(), bg: { ...DEFAULT_BG }, objects: [] }], created: Date.now(), updated: Date.now() };
}
export async function openDoc(doc, file = null) {
  const ed = ensureEditor();
  app.file = file; app.dirty = false; app.thumbUrl = doc.thumb || null;
  app.emit('view', 'editor');
  await ed.open(doc);
  app.emit('doc', doc);
  return ed;
}
export async function newDesign(w, h, name, { template, image } = {}) {
  const doc = blankDoc(w, h, name);
  if (template) doc.pages[0].bg = JSON.parse(JSON.stringify(template.bg));
  const ed = await openDoc(doc);
  if (template) {
    const objs = await buildTemplate(template, w, h);
    objs.forEach((o) => ed.add(o, { select: false, commit: false }));
    ed.commit();
  }
  if (image) await addImage(image.dataUrl, { name: image.name, fit: 'page' });
  await saveNow(true);
  return ed;
}
export async function openFile(file) {
  try {
    const txt = await window.ro2.designs.load(file);
    const doc = JSON.parse(txt);
    if (!doc.pages || !doc.width) throw new Error('That file is not an RO2 design.');
    await openDoc(doc, file);
  } catch (e) { toastErr(e); }
}
export const autosave = debounce(() => saveNow(false), 1600);
export async function saveNow(withThumb = true) {
  const ed = app.editor; if (!ed || !ed.doc || app.saving) return;
  app.saving = true; app.emit('saved-state', 'saving');
  try {
    if (withThumb || Date.now() - app.lastThumb > 6000 || !app.thumbUrl) { app.thumbUrl = await thumb(ed, 0).catch(() => app.thumbUrl); app.lastThumb = Date.now(); }
    const data = ed.toFile(); data.thumb = app.thumbUrl;
    app.file = await window.ro2.designs.save({ file: app.file, name: data.name, data: JSON.stringify(data) });
    app.dirty = false; app.emit('saved-state', 'saved');
  } catch (e) { app.emit('saved-state', 'error'); toastErr(e); }
  finally { app.saving = false; }
}
export async function renameDesign(name) {
  const ed = app.editor; if (!ed || !name) return;
  ed.doc.name = name;
  await saveNow(false);
  if (app.file) { try { app.file = await window.ro2.designs.rename(app.file, name); } catch (e) { toastErr(e); } }
}

// ───── adding things ─────
// Adds an image file (data URL) to the page. Over an existing photo frame, it fills the frame instead.
export async function addImage(dataUrl, { name, credit, fit = 'contain', at, svg } = {}) {
  const ed = ensureEditor();
  try {
    if (svg) { const g = await makeSvg(ed, svg, name); ed.add(g, { at: at || ed.dropPoint() }); return g; }
    const img = await makeImage(ed, dataUrl, { fit, name, credit });
    ed.add(img, { at: at || (fit === 'page' || fit === 'cover' ? ed.center() : ed.dropPoint()) });
    app.emit('uploads');
    return img;
  } catch (e) { toastErr(e); return null; }
}
export async function fillFrame(frame, dataUrl, { name, credit } = {}) {
  const ed = app.editor;
  const el = await loadImage(dataUrl);
  const shownW = frame.getScaledWidth(), shownH = frame.getScaledHeight();
  await frame.setSrc(dataUrl);
  // cover the frame's current box with the new picture, centred
  const k = Math.max(shownW / el.naturalWidth, shownH / el.naturalHeight);
  const cw = shownW / k, ch = shownH / k;
  frame.set({ cropX: (el.naturalWidth - cw) / 2, cropY: (el.naturalHeight - ch) / 2, width: cw, height: ch, scaleX: k * Math.sign(frame.scaleX || 1), scaleY: k });
  frame.assetId = ed.addAsset(dataUrl); frame.ro2Name = name || 'Photo'; frame.ro2Credit = credit; frame.ro2Placeholder = undefined;
  if (frame.ro2Frame) (await import('./panels/image.js')).applyFrame(frame, frame.ro2Frame);
  frame.dirty = true; frame.setCoords(); ed.canvas.requestRenderAll(); ed.commit(); ed.select(frame);
}
export async function addFiles(files, at) {
  const ed = ensureEditor();
  for (const f of files) {
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (ext === 'ro2') { await openFile(window.ro2.files.pathOf(f)); return; }
      let dataUrl, svg = null;
      if (['heic', 'heif', 'tif', 'tiff'].includes(ext)) dataUrl = await window.ro2.files.convertImage(new Uint8Array(await f.arrayBuffer()), ext);
      else if (ext === 'svg' || f.type === 'image/svg+xml') svg = await f.text();
      else if (f.type.startsWith('image/')) dataUrl = await new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsDataURL(f); });
      else { toast(`RO2 can't open ${f.name}.`, { type: 'err' }); continue; }
      const target = at && ed.canvas.getObjects().slice().reverse().find((o) => o instanceof fabric.FabricImage && o.ro2Frame && o.containsPoint(new fabric.Point(at.x, at.y)));
      if (target && dataUrl) await fillFrame(target, dataUrl, { name: f.name });
      else await addImage(dataUrl, { name: f.name, at, svg });
    } catch (e) { toastErr(e); }
  }
}

// ───── AI tools on a picture ─────
export async function runStudio(img, mode) {
  const ed = app.editor; if (!img || !(img instanceof fabric.FabricImage)) return toast('Select a photo first.', { type: 'info' });
  const src = ed.assetUrl(img.assetId) || img.getSrc();
  const res = mode === 'layers' ? await (await import('./ai/layers-studio.js')).openLayersStudio({ src }) : await openStudio({ src, mode, name: img.ro2Name, pageAspect: ed.W / ed.H });
  if (!res) return;
  if (mode === 'layers') return applyLayers(ed, img, res);
  const b = busy('Applying…'); let pick = img;
  try {
    if (mode === 'grab') {
      const el = img._originalElement || img.getElement(); const ratio = (el.naturalWidth || el.width) / (await loadImage(res.base)).naturalWidth;
      const p = res.piece;
      const lx = (p.x + p.w / 2) * ratio - (img.cropX || 0) - img.width / 2, ly = (p.y + p.h / 2) * ratio - (img.cropY || 0) - img.height / 2;
      const pt = fabric.util.transformPoint(new fabric.Point(lx, ly), img.calcTransformMatrix());
      const place = { left: pt.x, top: pt.y, scaleX: img.scaleX * ratio, scaleY: img.scaleY * ratio, angle: img.angle, flipX: img.flipX, flipY: img.flipY };
      await replaceImage(ed, img, res.base);
      const piece = await makeImage(ed, p.dataUrl, { fit: 'native', name: 'Grabbed object' });
      piece.set(place);
      const idx = ed.canvas.getObjects().indexOf(img);
      ed.add(piece, { index: idx + 1, commit: false }); ed.commit(); pick = piece;
      toast('Grabbed! Drag it anywhere.');
    } else if (mode === 'expand') {
      const el = img._originalElement || img.getElement(); const ratio = (el.naturalWidth || el.width) / res.srcW;
      const oldC = { x: (img.cropX || 0) + img.width / 2, y: (img.cropY || 0) + img.height / 2 };
      const newC = { x: (res.W / 2 - res.ox) * ratio, y: (res.H / 2 - res.oy) * ratio };
      const pt = fabric.util.transformPoint(new fabric.Point(newC.x - oldC.x, newC.y - oldC.y), img.calcTransformMatrix());
      const sx = img.scaleX * ratio, sy = img.scaleY * ratio;
      await img.setSrc(res.dataUrl);
      img.set({ cropX: 0, cropY: 0, width: res.W, height: res.H, scaleX: sx, scaleY: sy, left: pt.x, top: pt.y });
      img.assetId = ed.addAsset(res.dataUrl);
      if (img.ro2Frame) (await import('./panels/image.js')).applyFrame(img, img.ro2Frame);
      if (res.fillPage) { const k = Math.max(ed.W / res.W, ed.H / res.H); img.set({ scaleX: k, scaleY: k, left: ed.W / 2, top: ed.H / 2, angle: 0 }); }
      if (img.filters?.length) img.applyFilters();
      img.setCoords(); ed.canvas.requestRenderAll(); ed.commit();
    } else {
      await replaceImage(ed, img, res.dataUrl); ed.commit();
      if (mode === 'removebg') toast('Background removed.');
    }
    ed.select(pick); ed.emit('modified', [pick]);
  } catch (e) { toastErr(e); } finally { b.close(); }
}

// Render a text box, find its letters, and nudge size and line spacing so they cover the same area as the original's
// letters; leaves the ink centre's offset from the box centre in o.ro2InkOff
function inkOf(o) {
  const m = Math.min(1, 700 / Math.max(o.width, o.height)); const el = o.toCanvasElement({ multiplier: m, enableRetinaScaling: false });
  const x = el.getContext('2d', { willReadFrequently: true }); const d = x.getImageData(0, 0, el.width, el.height).data; let a = el.width, b = el.height, c = -1, e = -1;
  for (let y = 0; y < el.height; y++) for (let i = 0; i < el.width; i++) if (d[(y * el.width + i) * 4 + 3] > 100) { if (i < a) a = i; if (i > c) c = i; if (y < b) b = y; if (y > e) e = y; }
  if (c < 0) return null; return { w: (c - a + 1) / m, h: (e - b + 1) / m, cx: ((a + c + 1) / 2) / m - el.width / m / 2, cy: ((b + e + 1) / 2) / m - el.height / m / 2 };
}
function fitInk(o, L, s) {
  const tw = (L.ink[2] - L.ink[0]) * s, th = (L.ink[3] - L.ink[1]) * s;
  o.set({ width: Math.max(o.width, tw) * 3 + o.fontSize * 4 }); // no wrapping while measuring
  for (let it = 0; it < 3; it++) {
    const k = inkOf(o); if (!k) return;
    if (L.lines > 1) { const lineH = th / (L.lines + (L.lines - 1) * 0.25); const ratio = (th - lineH) / Math.max(1, k.h - lineH); o.set({ lineHeight: Math.max(0.6, Math.min(3, o.lineHeight * ratio)) }); }
    else { const r = th / Math.max(1, k.h); if (Math.abs(r - 1) > 0.02) o.set({ fontSize: o.fontSize * r }); }
    const k2 = inkOf(o); if (!k2) return;
    const wr = tw / Math.max(1, k2.w); if (Math.abs(wr - 1) > 0.03) o.set({ charSpacing: Math.max(-80, Math.min(800, o.charSpacing + ((tw - k2.w) / Math.max(1, Math.max(...o.text.split('\n').map((l) => l.length)) - 1) / o.fontSize) * 1000)) });
  }
  const k3 = inkOf(o); if (k3) o.set({ width: k3.w * 1.05 + o.fontSize * 0.5 });
  const f = inkOf(o); if (f) o.ro2InkOff = { x: f.cx, y: f.cy };
}

// Make editable: put the rebuilt background in the photo's place, then each piece on top, exactly where it was
async function applyLayers(ed, img, res) {
  const b = busy('Placing the layers…');
  try {
    const el = img._originalElement || img.getElement(); const ratio = (el.naturalWidth || el.width) / res.W;
    const M = img.calcTransformMatrix(); const s = Math.abs(img.scaleX) * ratio;
    const at = (x, y) => fabric.util.transformPoint(new fabric.Point(x * ratio - (img.cropX || 0) - img.width / 2, y * ratio - (img.cropY || 0) - img.height / 2), M);
    const base = { angle: img.angle || 0, originX: 'center', originY: 'center' };
    let idx = ed.canvas.getObjects().indexOf(img);
    if (res.keepOriginal) {
      const orig = await img.clone(); orig.id = uid(); orig.assetId = img.assetId; orig.ro2Name = (img.ro2Name || 'Photo') + ' (original)'; orig.visible = false;
      ed.add(orig, { index: idx, commit: false, select: false }); idx++;
    }
    await replaceImage(ed, img, res.background); img.ro2Name = 'Background';
    const made = [];
    for (const L of res.layers) {
      let o;
      if (L.kind === 'shape') {
        const p = at(L.x + L.w / 2, L.y + L.h / 2); const w = L.w * s, hh = L.h * s * Math.abs(img.scaleY / img.scaleX);
        if (L.type === 'rect') o = new fabric.Rect({ width: w, height: hh, rx: (L.rx || 0) * s, ry: (L.rx || 0) * s, fill: L.color, strokeWidth: 0 });
        else if (L.type === 'ellipse') o = new fabric.Ellipse({ rx: w / 2, ry: hh / 2, fill: L.color, strokeWidth: 0 });
        else { o = new fabric.Path(L.d, { fill: L.color, strokeWidth: 0 }); o.set({ scaleX: w / o.width, scaleY: hh / o.height }); }
        o.set({ ...base, left: p.x, top: p.y }); o.ro2Name = 'Shape';
      } else if (L.kind === 'photo') {
        o = await makeImage(ed, L.dataUrl, { fit: 'native', name: L.name || 'Object' });
        const p = at(L.x + L.w / 2, L.y + L.h / 2); o.set({ ...base, left: p.x, top: p.y, scaleX: img.scaleX * ratio, scaleY: img.scaleY * ratio, flipX: img.flipX, flipY: img.flipY });
      } else {
        await ensureFont(L.fontFamily, L.fontWeight);
        const fs = Math.max(4, L.fontSize * s); const p = at((L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2);
        o = new fabric.Textbox(L.text, { fontFamily: L.fontFamily, fontWeight: L.fontWeight, fontSize: fs, fill: L.color, textAlign: L.align || 'center', lineHeight: L.lineHeight || 1.2, charSpacing: L.charSpacing || 0,
          width: (L.x1 - L.x0) * s * 1.08 + fs * 0.4, splitByGrapheme: false, editingBorderColor: '#46e6a2', cursorColor: '#46e6a2', originX: 'center', originY: 'center' });
        if (L.ink && L.text === o.text) fitInk(o, L, s);
        const c = L.ink ? at((L.ink[0] + L.ink[2]) / 2, (L.ink[1] + L.ink[3]) / 2) : p;
        const off = o.ro2InkOff || { x: 0, y: 0 }; delete o.ro2InkOff; const a = ((img.angle || 0) * Math.PI) / 180;
        o.set({ ...base, left: c.x - (off.x * Math.cos(a) - off.y * Math.sin(a)), top: c.y - (off.x * Math.sin(a) + off.y * Math.cos(a)) }); o.ro2Name = 'Text';
      }
      idx++; ed.add(o, { index: idx, commit: false, select: false }); made.push(o);
    }
    ed.commit(); ed.canvas.requestRenderAll();
    ed.select(made.length ? made : img); ed.emit('modified', made);
    const nt = made.filter((o) => o.type === 'textbox').length;
    toast(made.length ? `Done: ${made.length} editable layer${made.length > 1 ? 's' : ''}.${nt ? ' Double-click text to change it.' : ' Drag them anywhere.'} The original is ${res.keepOriginal ? 'kept, hidden, in Layers' : 'replaced'}.` : 'Background rebuilt.', { ms: 5000 });
  } catch (e) { toastErr(e); } finally { b.close(); }
}

// Quick actions from Home: pick a photo, make a design its size, go straight into the tool
export async function quickPhoto(mode) {
  const files = await window.ro2.files.openImages({ single: true, title: 'Choose a photo' });
  const f = files[0]; if (!f) return; if (f.error) return toastErr(f.error);
  return photoDesign(f, mode);
}
export async function photoDesign(f, mode) {
  const el = await loadImage(f.dataUrl).catch((e) => { toastErr(e); return null; }); if (!el) return;
  const max = 4000; let w = el.naturalWidth, hh = el.naturalHeight; if (Math.max(w, hh) > max) { const k = max / Math.max(w, hh); w *= k; hh *= k; }
  const ed = await newDesign(w, hh, f.name.replace(/\.[^.]+$/, ''), { image: f });
  if (mode === 'removebg') ed.setBackground({ color: 'rgba(0,0,0,0)' });
  const img = ed.userObjects().find((o) => o instanceof fabric.FabricImage);
  if (mode && img) { ed.select(img); await runStudio(img, mode); }
  return ed;
}
export { h };

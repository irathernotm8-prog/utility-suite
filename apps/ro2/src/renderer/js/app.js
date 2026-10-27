// Shared app state and the actions every part of the UI uses (open, save, add things, AI tools).
import { Editor, DEFAULT_BG } from './editor/editor.js';
import { fabric, uid } from './editor/fab.js';
import { makeImage, makeSvg, replaceImage, loadImage } from './editor/objects.js';
import { thumb } from './editor/render.js';
import { toast, toastErr, busy, debounce, h } from './ui.js';
import { openStudio } from './ai/studio.js';
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
  const res = await openStudio({ src, mode, name: img.ro2Name, pageAspect: ed.W / ed.H });
  if (!res) return;
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

// Making things to put on the page: shapes, lines, text, images, icons, emoji and SVGs.
import { fabric, Ro2Line, uid } from './fab.js';
import { ensureFont, boldWeight } from '../fonts.js';
import { iconData } from '../ui.js';

export const DEFAULT_FILL = '#7c8b98';
const base = (ed) => Math.min(ed.W, ed.H);

export function makeShape(ed, s, { fill = DEFAULT_FILL, size } = {}) {
  const S = size || base(ed) * 0.34;
  const aw = s.w || 100, ah = s.h || 100; const k = S / Math.max(aw, ah);
  const w = aw * k, h = ah * k;
  let o;
  if (s.kind === 'rect') o = new fabric.Rect({ width: w, height: h, rx: Math.min(s.rx * k, Math.min(w, h) / 2), ry: Math.min(s.rx * k, Math.min(w, h) / 2), fill });
  else if (s.kind === 'circle') o = new fabric.Circle({ radius: w / 2, fill });
  else { o = new fabric.Path(s.d, { fill, fillRule: s.evenodd ? 'evenodd' : 'nonzero' }); o.set({ scaleX: w / o.width, scaleY: h / o.height }); }
  o.set({ strokeWidth: 0, stroke: '#1b1f23', strokeUniform: true, ro2Shape: s.id, ro2Name: s.name });
  return o;
}
export function makeLine(ed, l) {
  const len = base(ed) * 0.45; const lw = Math.max(2, Math.round(base(ed) / 160));
  return new Ro2Line({ width: len, lineWidth: lw, lineColor: '#1b1f23', dash: l.dash, startCap: l.start, endCap: l.end, ro2Name: l.name });
}
export const TEXT_PRESETS = {
  heading: { text: 'Add a heading', fontFamily: 'Poppins', fontWeight: 800, size: 0.085, lineHeight: 1.05 },
  subheading: { text: 'Add a subheading', fontFamily: 'Poppins', fontWeight: 600, size: 0.05, lineHeight: 1.15 },
  body: { text: 'Add a little bit of body text', fontFamily: 'Inter', fontWeight: 400, size: 0.03, lineHeight: 1.4 },
};
export async function makeText(ed, p) {
  const fs = Math.max(8, Math.round(base(ed) * (p.size || 0.05)));
  await ensureFont(p.fontFamily, p.fontWeight || 400);
  const t = new fabric.Textbox(p.text, {
    fontFamily: p.fontFamily, fontWeight: p.fontWeight || 400, fontSize: fs, fill: p.fill || '#111418', textAlign: p.textAlign || 'center',
    lineHeight: p.lineHeight || 1.2, charSpacing: p.charSpacing || 0, fontStyle: p.fontStyle || 'normal', width: Math.min(ed.W * 0.86, Math.max(fs * 4, measure(p.text, fs, p) + fs * 0.6)),
    splitByGrapheme: false, editingBorderColor: '#46e6a2', cursorColor: '#46e6a2', ro2Upper: p.upper || undefined,
  });
  if (p.stroke) t.set({ stroke: p.stroke, strokeWidth: p.strokeWidth || 2, paintFirst: 'stroke' });
  if (p.shadow) t.set({ shadow: new fabric.Shadow(p.shadow) });
  if (p.textBackgroundColor) t.set({ textBackgroundColor: p.textBackgroundColor });
  t.ro2Name = 'Text';
  return t;
}
function measure(text, fs, p) {
  const c = measure.c || (measure.c = document.createElement('canvas').getContext('2d'));
  c.font = `${p.fontStyle || 'normal'} ${p.fontWeight || 400} ${fs}px "${p.fontFamily}"`;
  return Math.max(...String(text).split('\n').map((l) => c.measureText(l).width + (p.charSpacing || 0) * fs / 1000 * l.length));
}
export const bold = (family) => boldWeight(family);

export function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That image could not be opened.')); im.src = src; });
}
// fit: 'contain' (sized to ~60% of the page), 'cover' (fill the page), 'native'
export async function makeImage(ed, dataUrl, { fit = 'contain', name, credit } = {}) {
  const el = await loadImage(dataUrl);
  const assetId = ed.addAsset(dataUrl);
  const img = new fabric.FabricImage(el, { ro2Name: name || 'Photo', assetId, ro2Credit: credit || undefined });
  const w = el.naturalWidth, h = el.naturalHeight;
  let s = 1;
  if (fit === 'contain') s = Math.min((ed.W * 0.62) / w, (ed.H * 0.62) / h);
  if (fit === 'cover') s = Math.max(ed.W / w, ed.H / h);
  if (fit === 'page') s = Math.min(ed.W / w, ed.H / h);
  img.set({ scaleX: s, scaleY: s });
  return img;
}
// Swap the picture inside an image object. Same pixel size (an AI edit): crop and placement stay exactly as they were.
// Different size: the new picture takes the old one's place at the same displayed width.
export async function replaceImage(ed, img, dataUrl) {
  const el = await loadImage(dataUrl);
  const old = img._originalElement || img.getElement(); const ow = old.naturalWidth || old.width, oh = old.naturalHeight || old.height;
  const shownW = img.getScaledWidth();
  const same = el.naturalWidth === ow && el.naturalHeight === oh;
  const crop = { cropX: img.cropX, cropY: img.cropY, width: img.width, height: img.height };
  await img.setSrc(dataUrl);
  if (same) img.set(crop);
  else { img.set({ cropX: 0, cropY: 0, width: el.naturalWidth, height: el.naturalHeight }); const k = shownW / el.naturalWidth; img.set({ scaleX: k, scaleY: k }); }
  img.assetId = ed.addAsset(dataUrl);
  if (img.filters && img.filters.length) img.applyFilters();
  img.dirty = true; img.setCoords(); ed.canvas.requestRenderAll();
  return img;
}

export async function makeIcon(ed, name, color = '#1b1f23') {
  const d = iconData(name); if (!d) throw new Error('Unknown icon');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d[0]}</svg>`;
  const g = await svgToObject(svg);
  const S = base(ed) * 0.22; const k = S / Math.max(g.width, g.height);
  g.set({ scaleX: k, scaleY: k, ro2Icon: name, ro2Name: name.replace(/-/g, ' ') });
  return g;
}
export async function svgToObject(svg) {
  const { objects, options } = await fabric.loadSVGFromString(svg);
  const list = objects.filter(Boolean);
  if (!list.length) throw new Error('That SVG has nothing RO2 can draw.');
  const g = list.length === 1 ? list[0] : fabric.util.groupSVGElements(list, options);
  if (g instanceof fabric.Group) g.set({ subTargetCheck: false, interactive: false });
  return g;
}
export async function makeSvg(ed, svgText, name) {
  const g = await svgToObject(svgText);
  const S = base(ed) * 0.5; const k = S / Math.max(g.width || 1, g.height || 1);
  g.set({ scaleX: k, scaleY: k, ro2Name: name || 'Graphic' });
  return g;
}
export async function makeEmoji(ed, ch) {
  const fs = Math.round(base(ed) * 0.18);
  const t = new fabric.Textbox(ch, { fontSize: fs, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif', textAlign: 'center', width: fs * 1.4, ro2Name: 'Emoji', fill: '#000' });
  return t;
}
// Every object's colour(s) that can be changed (shape fill, text, icon stroke, SVG fills)
export function colorsOf(o) {
  if (o instanceof Ro2Line) return [{ key: 'lineColor', value: o.lineColor }];
  if (o.ro2Icon) { const c = (o._objects || [o])[0]; return [{ key: 'stroke', value: c.stroke }]; }
  if (o instanceof fabric.Group) {
    const set = new Map();
    o.getObjects().forEach(function walk(x) { if (x instanceof fabric.Group) return x.getObjects().forEach(walk); if (typeof x.fill === 'string' && x.fill && x.fill !== 'none') set.set(x.fill.toLowerCase(), 'fill'); if (typeof x.stroke === 'string' && x.stroke && x.stroke !== 'none') set.set(x.stroke.toLowerCase(), 'stroke'); });
    return [...set.keys()].slice(0, 8).map((v) => ({ key: 'group', value: v }));
  }
  return [{ key: 'fill', value: o.ro2Fill || o.fill }];
}
export function setGroupColor(g, from, to) {
  g.getObjects().forEach(function walk(x) {
    if (x instanceof fabric.Group) return x.getObjects().forEach(walk);
    if (typeof x.fill === 'string' && x.fill.toLowerCase() === from) x.set('fill', to);
    if (typeof x.stroke === 'string' && x.stroke.toLowerCase() === from) x.set('stroke', to);
  });
  g.dirty = true;
}
export { uid };

// ───── QR codes: a white tile with the code as one vector path, both colours editable ─────
let qrLib = null;
export async function qrPath(text) {
  if (!qrLib) { qrLib = (await import('../../vendor/qrcode/qrcode.mjs')).default; qrLib.stringToBytes = (s) => [...new TextEncoder().encode(s)]; }
  const q = qrLib(0, 'M'); q.addData(String(text || ' '), 'Byte'); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let y = 0; y < n; y++) { let x = 0; while (x < n) { if (!q.isDark(y, x)) { x++; continue; } let e = x; while (e < n && q.isDark(y, e)) e++; d += `M${x} ${y}h${e - x}v1h${x - e}z`; x = e; } }
  return { d, n };
}
export async function makeQr(ed, text, { dark = '#111418', light = '#ffffff', size } = {}) {
  const { d, n } = await qrPath(text); const pad = 2; const S = size || Math.min(ed.W, ed.H) * 0.3;
  const bg = new fabric.Rect({ width: n + pad * 2, height: n + pad * 2, rx: 1.2, ry: 1.2, fill: light, left: 0, top: 0, strokeWidth: 0 });
  const p = new fabric.Path(d, { fill: dark, strokeWidth: 0 }); p.set({ left: 0, top: 0 });
  const g = new fabric.Group([bg, p], { subTargetCheck: false, interactive: false });
  const k = S / (n + pad * 2); g.set({ scaleX: k, scaleY: k, ro2Name: 'QR code' }); g.ro2Qr = String(text);
  return g;
}
// Rebuild a QR group for new text, keeping its place, size and colours
export async function updateQr(ed, g, text) {
  const [bg, p] = g.getObjects(); const shown = g.getScaledWidth();
  const n = await makeQr(ed, text, { dark: p.fill, light: bg.fill, size: shown });
  n.set({ left: g.left, top: g.top, angle: g.angle }); n.id = g.id;
  const idx = ed.canvas.getObjects().indexOf(g); ed.canvas.remove(g); ed.add(n, { index: idx });
  return n;
}

// ───── curved text ─────
import { Ro2CurvedText, PROPS } from './fab.js';
function arcPath(L, c) {
  const th = Math.max(0.05, (Math.min(100, Math.abs(c)) / 100) * Math.PI * 1.9); const R = L / th; const f = (n) => n.toFixed(2);
  if (c > 0) { const a0 = -Math.PI / 2 - th / 2, a1 = -Math.PI / 2 + th / 2; return `M ${f(R * Math.cos(a0))} ${f(R + R * Math.sin(a0))} A ${f(R)} ${f(R)} 0 ${th > Math.PI ? 1 : 0} 1 ${f(R * Math.cos(a1))} ${f(R + R * Math.sin(a1))}`; }
  const b0 = Math.PI / 2 + th / 2, b1 = Math.PI / 2 - th / 2; return `M ${f(R * Math.cos(b0))} ${f(-R + R * Math.sin(b0))} A ${f(R)} ${f(R)} 0 ${th > Math.PI ? 1 : 0} 0 ${f(R * Math.cos(b1))} ${f(-R + R * Math.sin(b1))}`;
}
// c: -100..100 (0 = straight). Turns a text box into curved text and back; returns the (possibly new) object.
export async function setCurve(ed, t, c) {
  c = Math.round(c);
  const replace = async (json) => {
    const [n] = await fabric.util.enlivenObjects([json]); n.id = t.id; const idx = ed.canvas.getObjects().indexOf(t);
    ed.canvas.remove(t); ed.canvas.insertAt(idx, n); ed._prep(n); n.setCoords(); ed.canvas.setActiveObject(n); return n;
  };
  if (!(t instanceof Ro2CurvedText)) {
    if (!c) return t;
    const json = t.toObject(PROPS); json.type = 'Ro2CurvedText'; delete json.width; delete json.minWidth; json.text = String(json.text).replace(/\n/g, ' '); json.styles = []; delete json.path;
    t = await replace(json);
  } else if (!c) {
    t.set({ path: null }); t.initDimensions();
    const json = t.toObject(PROPS); json.type = 'Textbox'; delete json.path; json.width = t.calcTextWidth() + t.fontSize * 0.4; json.ro2Curve = undefined;
    const n = await replace(json); ed.canvas.requestRenderAll(); return n;
  }
  t.set({ path: null }); t.initDimensions(); const L = t.calcTextWidth();
  t.set({ path: new fabric.Path(arcPath(L, c), { visible: false, fill: '', stroke: '' }), pathAlign: 'center', pathSide: 'left', pathStartOffset: 0, textAlign: 'center' });
  t.ro2Curve = c; t.setPathInfo?.(); t.initDimensions(); t.setCoords(); t.dirty = true; ed.canvas.requestRenderAll();
  return t;
}

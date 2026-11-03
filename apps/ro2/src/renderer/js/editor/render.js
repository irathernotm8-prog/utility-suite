// Drawing pages on their own (for export, thumbnails and the page strip), away from the editing canvas.
import { fabric } from './fab.js';
import { ensureFontsFor, bundledFonts } from '../fonts.js';
import { sharpenHtml } from '../html-layer.js';

async function staticPage(editor, page, { transparent = false, scale = 1 } = {}) {
  const el = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(el, { width: editor.W, height: editor.H, enableRetinaScaling: false, renderOnAddRemove: false, imageSmoothingEnabled: true });
  let objs = editor.resolveAssets(page.objects || []);
  if (scale > 1.05) objs = await sharpenHtml(objs, scale); // HTML layers re-drawn sharp for big exports
  await ensureFontsFor(objs);
  const live = await fabric.util.enlivenObjects(objs);
  if (!transparent) sc.add(editor.makeBgObject(page.bg || { color: '#ffffff' }));
  sc.add(...live.filter((o) => o.visible !== false));
  return sc;
}
const pageOf = (editor, i) => (i === editor.page ? { ...editor.pageData, ...editor.pageSnapshot() } : editor.doc.pages[i]);

// A canvas element of the page at `scale` × its design size
export async function pageCanvas(editor, i, { scale = 1, transparent = false, background } = {}) {
  const sc = await staticPage(editor, pageOf(editor, i), { transparent, scale });
  const out = sc.toCanvasElement(scale);
  sc.dispose();
  if (background) { // e.g. white under a JPG
    const c = document.createElement('canvas'); c.width = out.width; c.height = out.height; const x = c.getContext('2d');
    x.fillStyle = background; x.fillRect(0, 0, c.width, c.height); x.drawImage(out, 0, 0); return c;
  }
  return out;
}
export const toBlob = (canvas, type = 'image/png', q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image (it may be too large). Try a smaller size.'))), type, q));
export async function thumb(editor, i, max = 320) {
  const s = Math.min(1, max / Math.max(editor.W, editor.H));
  const c = await pageCanvas(editor, i, { scale: s });
  return c.toDataURL('image/webp', 0.82);
}
// Vector SVG of a page, with the fonts it uses embedded so it looks the same anywhere
export async function pageSvg(editor, i, { transparent = false } = {}) {
  const page = pageOf(editor, i);
  const sc = await staticPage(editor, page, { transparent });
  const used = new Set(); sc.getObjects().forEach(function walk(o) { if (o.fontFamily) used.add(o.fontFamily); (o._objects || []).forEach(walk); });
  let css = '';
  for (const f of bundledFonts()) {
    if (!used.has(f.family)) continue;
    for (const [w, file] of Object.entries(f.files)) {
      const buf = await (await fetch('vendor/fonts/' + file)).arrayBuffer();
      css += `@font-face{font-family:'${f.family}';font-weight:${w};src:url(data:font/woff2;base64,${b64(buf)}) format('woff2')}`;
    }
  }
  let svg = sc.toSVG({ width: editor.W, height: editor.H, viewBox: { x: 0, y: 0, width: editor.W, height: editor.H } });
  if (css) svg = svg.replace('<defs>', `<defs>\n<style type="text/css"><![CDATA[${css}]]></style>`);
  sc.dispose();
  return svg;
}
function b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
// Raster of the current selection only (for "Copy as PNG" / export selection)
export async function selectionCanvas(editor, scale = 2) {
  const objs = editor.selected(); if (!objs.length) return null;
  const json = editor.resolveAssets(editor.serializeObjects(objs));
  const live = await fabric.util.enlivenObjects(json);
  const g = new fabric.Group(live);
  const el = g.toCanvasElement({ multiplier: scale, enableRetinaScaling: false });
  return el;
}

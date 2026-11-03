// HTML layer → normal RO2 layers. The page is laid out by Chromium, so nothing is guessed: every text box keeps its
// font, size, colour, spacing and alignment; solid boxes become rounded rectangles; <img> and inline <svg> become
// pictures and vectors; whatever is left (gradients, shadows, canvas, effects) is one background picture.
import { fabric, uid } from './editor/fab.js';
import { loadImage, makeSvg } from './editor/objects.js';
import { ensureFont, bundledFonts } from './fonts.js';
import { busy, toast, toastErr } from './ui.js';

const famOk = (f) => bundledFonts().some((x) => x.family.toLowerCase() === String(f).toLowerCase());
const famName = (f) => (bundledFonts().find((x) => x.family.toLowerCase() === String(f).toLowerCase()) || {}).family || f;

export async function htmlToLayers(ed, o, { remove = false, t } = {}) {
  const hl = o.ro2Html; const b = busy('Turning the HTML into layers…');
  try {
    const tt = t != null ? t : hl.poster != null ? hl.poster : hl.animated ? Math.max(0, hl.duration - 1 / 30) : 0;
    const ex = await window.ro2.html.layers({ html: hl.html, w: hl.w, h: hl.h }, { t: tt * 1000, scale: Math.min(2, Math.max(1, (o.getScaledWidth() / hl.w) * 1.5)) });
    const el = o.getElement(); const k = el.naturalWidth / hl.w; const M = o.calcTransformMatrix();
    const sx = Math.abs(o.scaleX) * k, sy = Math.abs(o.scaleY) * k; const angle = o.angle || 0;
    const at = (x, y) => fabric.util.transformPoint(new fabric.Point(x * k - el.naturalWidth / 2, y * k - el.naturalHeight / 2), M);
    const place = (obj, r, { natW, natH } = {}) => { const c = at(r.x + r.w / 2, r.y + r.h / 2); obj.set({ left: c.x, top: c.y, angle: angle + (r.angle || 0), opacity: r.opacity ?? 1, ...(natW ? { scaleX: (r.w * sx) / natW, scaleY: (r.h * sy) / natH } : {}) }); obj.id = uid(); return obj; };
    const items = [];
    // what couldn't become a layer
    const bgUrl = 'data:image/png;base64,' + ex.background; const bgEl = await loadImage(bgUrl);
    if (hasInk(bgEl)) { const bg = new fabric.FabricImage(bgEl, { ro2Name: 'Background (from HTML)', assetId: ed.addAsset(bgUrl) }); place(bg, { x: 0, y: 0, w: hl.w, h: hl.h }, { natW: bgEl.naturalWidth, natH: bgEl.naturalHeight }); items.push({ z: -1, o: bg }); }
    for (const r of ex.boxes) {
      const rect = new fabric.Rect({ width: r.w * sx, height: r.h * sy, rx: Math.min(r.radius * sx, (r.w * sx) / 2), ry: Math.min(r.radius * sy, (r.h * sy) / 2), fill: r.fill === 'transparent' ? 'rgba(0,0,0,0)' : r.fill, stroke: r.stroke || null, strokeWidth: r.stroke ? r.strokeWidth * sx : 0, strokeUniform: true, ro2Name: 'Box' });
      items.push({ z: r.z, o: place(rect, r) });
    }
    for (const r of ex.images) {
      if (!r.dataUrl) continue;
      try {
        const im = await loadImage(r.dataUrl); const iw = im.naturalWidth, ih = im.naturalHeight; const img = new fabric.FabricImage(im, { ro2Name: 'Picture', assetId: ed.addAsset(r.dataUrl) });
        if (r.fit === 'cover') { const s = Math.max(r.w / iw, r.h / ih); const cw = r.w / s, ch = r.h / s; img.set({ cropX: (iw - cw) / 2, cropY: (ih - ch) / 2, width: cw, height: ch }); place(img, r, { natW: cw, natH: ch }); }
        else if (r.fit === 'contain') { const s = Math.min(r.w / iw, r.h / ih); place(img, { ...r, x: r.x + (r.w - iw * s) / 2, y: r.y + (r.h - ih * s) / 2, w: iw * s, h: ih * s }, { natW: iw, natH: ih }); }
        else place(img, r, { natW: iw, natH: ih });
        if (r.radius > 0) { const rl = (r.radius * sx) / img.scaleX; img.clipPath = new fabric.Rect({ width: img.width, height: img.height, rx: rl, ry: (r.radius * sy) / img.scaleY, originX: 'center', originY: 'center' }); }
        items.push({ z: r.z, o: img });
      } catch {}
    }
    for (const r of ex.svgs) {
      try { const g = await makeSvg(ed, r.svg, 'Icon'); const gw = g.width || 1, gh = g.height || 1; place(g, r, { natW: gw, natH: gh }); items.push({ z: r.z, o: g }); } catch {}
    }
    for (const r of ex.texts) {
      if (!r.color || !r.text.trim()) continue;
      const fam = famOk(r.family) ? famName(r.family) : r.family; await ensureFont(fam, r.weight).catch(() => {});
      const fs = r.size * sy; const slack = Math.max(4, r.w * 0.04);
      const tb = new fabric.Textbox(r.text.replace(/\n+$/, ''), { fontFamily: fam, fontWeight: r.weight, fontStyle: r.italic ? 'italic' : 'normal', fontSize: fs, fill: r.color, textAlign: ['left', 'center', 'right', 'justify'].includes(r.align) ? r.align : 'left', lineHeight: Math.max(0.6, r.lineHeight / 1.13), charSpacing: (r.spacing / r.size) * 1000, width: (r.w + slack) * sx, splitByGrapheme: false, underline: /underline/.test(r.decoration || ''), linethrough: /line-through/.test(r.decoration || ''), ro2Name: 'Text', editingBorderColor: '#46e6a2', cursorColor: '#46e6a2' });
      if (r.shadow) { try { tb.set({ shadow: new fabric.Shadow(r.shadow.split(/,(?![^(]*\))/)[0]) }); } catch {} }
      if (r.stroke) tb.set({ stroke: r.stroke.c, strokeWidth: r.stroke.w * sx, paintFirst: 'stroke' });
      const dx = tb.textAlign === 'right' ? -slack / 2 : tb.textAlign === 'center' ? 0 : slack / 2;
      items.push({ z: r.z, o: place(tb, { ...r, x: r.x + dx }) });
    }
    items.sort((a, c) => a.z - c.z);
    let idx = ed.canvas.getObjects().indexOf(o) + 1;
    for (const it of items) { ed.add(it.o, { index: idx++, commit: false, select: false }); }
    if (remove) ed.canvas.remove(o); else { o.visible = false; o.ro2Name = (o.ro2Name || 'HTML') + ' (original)'; }
    ed.commit(); ed.canvas.requestRenderAll(); ed.select(items.map((x) => x.o).filter((x) => !(x.ro2Name || '').startsWith('Background')));
    const nt = ex.texts.filter((x) => x.color).length;
    toast(`Made ${items.length} layers: ${nt} text box${nt === 1 ? '' : 'es'}, ${ex.boxes.length} shape${ex.boxes.length === 1 ? '' : 's'}, ${ex.images.length + ex.svgs.length} picture${ex.images.length + ex.svgs.length === 1 ? '' : 's'}.${remove ? '' : ' The HTML is kept hidden in Layers.'}`, { ms: 5000 });
    return { layers: items.map((x) => ({ id: x.o.id, kind: x.o.type, name: x.o.ro2Name })), texts: nt, boxes: ex.boxes.length, images: ex.images.length, svgs: ex.svgs.length };
  } catch (e) { toastErr(e); throw e; } finally { b.close(); }
}
function hasInk(im) { // skip an all-clear background
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true; return false;
}

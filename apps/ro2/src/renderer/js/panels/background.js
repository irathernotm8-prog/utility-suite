// Background: page colour, gradients, see-through, or a photo filling the page.
import { h, ico, toastErr } from '../ui.js';
import { app, ensureEditor } from '../app.js';
import { register } from '../drawer.js';
import { PALETTE, GRADIENTS, colorPicker, swatchCss } from './color.js';
import { gradientCss, isClear } from '../editor/editor.js';
import { makeImage } from '../editor/objects.js';
import { fabric } from '../editor/fab.js';

export async function setAsBackground(img) {
  const ed = app.editor; if (!img) return;
  const k = Math.max(ed.W / img.width, ed.H / img.height);
  img.set({ left: ed.W / 2, top: ed.H / 2, scaleX: k, scaleY: k, angle: 0, ro2Role: 'bgimage', hasControls: false, lockMovementX: true, lockMovementY: true, hoverCursor: 'default' });
  img.ro2Name = 'Background photo';
  ed.canvas.moveObjectTo(img, 1); img.setCoords(); ed.canvas.discardActiveObject(); ed.canvas.requestRenderAll(); ed.commit(); ed.emit('layers');
}
export function detachBackground(img) {
  const ed = app.editor;
  img.set({ ro2Role: undefined, hasControls: true, lockMovementX: false, lockMovementY: false, hoverCursor: null }); img.ro2Name = 'Photo';
  ed.select(img); ed.commit(); ed.emit('layers');
}
register('background', {
  label: 'Background', icon: 'paint-bucket',
  render(root) {
    const ed = ensureEditor(); const bg = ed.pageData.bg || {};
    root.append(h('div.p-title', 'Background'));
    const cur = h('button.btn.block', { style: { height: '46px', justifyContent: 'flex-start', gap: '12px' } });
    const paintCur = () => { const b = ed.pageData.bg || {}; cur.innerHTML = `<i style="width:28px;height:28px;border-radius:7px;display:block;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);background:${b.gradient ? gradientCss(b.gradient) : isClear(b.color) ? 'repeating-conic-gradient(#3a4148 0 25%, #262b30 0 50%) 0 0/10px 10px' : b.color}"></i><span>${b.gradient ? 'Gradient' : isClear(b.color) ? 'See-through' : String(b.color).toUpperCase()}</span><span class="dim small" style="margin-left:auto">Change</span>`; };
    paintCur();
    cur.onclick = () => colorPicker(cur, ed.pageData.bg.gradient || ed.pageData.bg.color || '#ffffff', (v, final) => { ed.setBackground(typeof v === 'string' ? { color: v } : { gradient: v }, { commit: final }); paintCur(); }, { docColors: docColors(ed), allowNone: true, title: 'Page background' });
    root.append(cur);
    root.append(h('div.sec', h('h4', 'Colours')));
    const sw = h('div.tiles.c6');
    sw.append(h('button.tile', { title: 'See-through (transparent PNG)', style: { background: 'repeating-conic-gradient(#3a4148 0 25%, #262b30 0 50%) 0 0/12px 12px' }, on: { click: () => { ed.setBackground({ color: 'rgba(0,0,0,0)' }); paintCur(); } } }));
    for (const c of PALETTE) sw.append(h('button.tile', { title: c, style: { background: c }, on: { click: () => { ed.setBackground({ color: c }); paintCur(); } } }));
    root.append(sw);
    root.append(h('div.sec', h('h4', 'Gradients')));
    const gg = h('div.tiles.c4');
    for (const [a, b] of GRADIENTS) { const spec = { type: 'linear', angle: 135, stops: [{ offset: 0, color: a }, { offset: 1, color: b }] }; gg.append(h('button.tile', { style: { background: gradientCss(spec) }, on: { click: () => { ed.setBackground({ gradient: spec }); paintCur(); } } })); }
    for (const [a, b] of GRADIENTS.slice(0, 4)) { const spec = { type: 'radial', stops: [{ offset: 0, color: a }, { offset: 1, color: b }] }; gg.append(h('button.tile', { style: { background: gradientCss(spec) }, on: { click: () => { ed.setBackground({ gradient: spec }); paintCur(); } } })); }
    root.append(gg);
    root.append(h('div.sec', h('h4', 'Photo background')));
    const bgImg = ed.userObjects().find((o) => o.ro2Role === 'bgimage');
    if (bgImg) root.append(h('div', { style: { display: 'flex', gap: '8px' } }, h('button.btn.sm', { html: ico('move') + '<span>Detach to edit</span>', on: { click: () => detachBackground(bgImg) } }), h('button.btn.sm.danger', { html: ico('trash-2') + '<span>Remove</span>', on: { click: () => { ed.canvas.remove(bgImg); ed.commit(); ed.emit('layers'); app.emit('refresh-panel'); } } })));
    else {
      root.append(h('button.btn.block', { html: ico('image-plus') + '<span>Choose a photo…</span>', on: { click: async () => { const f = (await window.ro2.files.openImages({ single: true }))[0]; if (!f) return; if (f.error) return toastErr(f.error); const img = await makeImage(ed, f.dataUrl, { fit: 'cover', name: 'Background photo' }); ed.add(img, { at: ed.center(), select: false, commit: false }); await setAsBackground(img); app.emit('refresh-panel'); } } }));
      root.append(h('p.tiny.dim', { style: { marginTop: '6px' } }, 'Or select any photo on the page and choose “Set as background”.'));
    }
  },
});
export function docColors(ed) {
  const set = new Set();
  const add = (c) => { if (typeof c === 'string' && c && !isClear(c)) set.add(c.toLowerCase()); };
  for (const o of ed.userObjects()) { (function walk(x) { add(x.fill); if (x.strokeWidth) add(x.stroke); add(x.lineColor); if (x.ro2Fill) x.ro2Fill.stops.forEach((s) => add(s.color)); (x._objects || []).forEach(walk); })(o); }
  if (ed.pageData.bg?.color) add(ed.pageData.bg.color);
  return [...set].slice(0, 16);
}
export { swatchCss, fabric };

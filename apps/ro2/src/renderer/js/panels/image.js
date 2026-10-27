// Photo tools: frames (shape masks), filters and adjustments.
import { fabric } from '../editor/fab.js';
import { byId, shapeSvg } from '../editor/shapes.js';
import { h, slider, btn, ico } from '../ui.js';

export const FRAMES = ['circle', 'rounded', 'squircle', 'arch', 'heart', 'star', 'star4', 'hexagon', 'diamond', 'triangle', 'pentagon', 'blob1', 'blob2', 'blob3', 'drop', 'scallop', 'flower', 'shield', 'burst', 'bubble', 'cloud', 'leaf', 'moon', 'pill'];

// Mask a picture with a shape. The mask sits in the picture's own space, so it moves and scales with it.
export function applyFrame(img, id) {
  if (!id) { img.clipPath = undefined; img.ro2Frame = undefined; img.dirty = true; return; }
  const s = byId(id); const w = img.width, hh = img.height; let c;
  if (s.kind === 'rect') { const r = s.rx >= 999 ? Math.min(w, hh) / 2 : Math.min(w, hh) * (s.rx / 100); c = new fabric.Rect({ width: w, height: hh, rx: r, ry: r }); }
  else if (s.kind === 'circle') c = new fabric.Ellipse({ rx: w / 2, ry: hh / 2 });
  else { c = new fabric.Path(s.d, { fillRule: s.evenodd ? 'evenodd' : 'nonzero' }); c.set({ scaleX: w / c.width, scaleY: hh / c.height }); }
  c.set({ left: 0, top: 0, originX: 'center', originY: 'center' });
  img.clipPath = c; img.ro2Frame = id; img.dirty = true;
}

// ───── filters ─────
const F = fabric.filters;
export const PRESETS = [
  { id: 'none', name: 'Original', make: () => [] },
  { id: 'vivid', name: 'Vivid', make: () => [new F.Saturation({ saturation: 0.35 }), new F.Contrast({ contrast: 0.12 })] },
  { id: 'warm', name: 'Warm', make: () => [warmth(0.35), new F.Saturation({ saturation: 0.1 })] },
  { id: 'cool', name: 'Cool', make: () => [warmth(-0.35)] },
  { id: 'mono', name: 'Mono', make: () => [new F.Grayscale()] },
  { id: 'noir', name: 'Noir', make: () => [new F.Grayscale(), new F.Contrast({ contrast: 0.35 }), new F.Brightness({ brightness: -0.05 })] },
  { id: 'fade', name: 'Fade', make: () => [new F.Contrast({ contrast: -0.22 }), new F.Saturation({ saturation: -0.2 }), new F.Brightness({ brightness: 0.06 })] },
  { id: 'vintage', name: 'Vintage', make: () => [new F.Vintage()] },
  { id: 'sepia', name: 'Sepia', make: () => [new F.Sepia()] },
  { id: 'kodachrome', name: 'Retro', make: () => [new F.Kodachrome()] },
  { id: 'technicolor', name: 'Techni', make: () => [new F.Technicolor()] },
  { id: 'polaroid', name: 'Polaroid', make: () => [new F.Polaroid()] },
  { id: 'drama', name: 'Drama', make: () => [new F.Contrast({ contrast: 0.3 }), new F.Saturation({ saturation: -0.15 }), new F.Brightness({ brightness: -0.06 })] },
  { id: 'dream', name: 'Dreamy', make: () => [new F.Brightness({ brightness: 0.08 }), new F.Contrast({ contrast: -0.12 }), new F.Saturation({ saturation: 0.15 }), warmth(0.12)] },
  { id: 'invert', name: 'Invert', make: () => [new F.Invert()] },
];
function warmth(t) { // + warmer, - cooler
  return new F.ColorMatrix({ matrix: [1 + t * 0.25, 0, 0, 0, 0, 0, 1 + t * 0.05, 0, 0, 0, 0, 0, 1 - t * 0.3, 0, 0, 0, 0, 0, 1, 0] });
}
export const ADJUST = [
  ['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100], ['warmth', 'Warmth', -100, 100],
  ['tint', 'Tint', -100, 100], ['vibrance', 'Vibrance', -100, 100], ['hue', 'Hue', -100, 100], ['blur', 'Blur', 0, 100], ['sharpen', 'Sharpen', 0, 100], ['grain', 'Grain', 0, 100],
];
export function buildFilters(img) {
  const a = img.ro2Adjust || {}; const p = PRESETS.find((x) => x.id === (img.ro2Filter || 'none')) || PRESETS[0];
  const list = [...p.make()];
  if (a.brightness) list.push(new F.Brightness({ brightness: a.brightness / 250 }));
  if (a.contrast) list.push(new F.Contrast({ contrast: a.contrast / 200 }));
  if (a.saturation) list.push(new F.Saturation({ saturation: a.saturation / 100 }));
  if (a.vibrance) list.push(new F.Vibrance({ vibrance: a.vibrance / 100 }));
  if (a.warmth) list.push(warmth(a.warmth / 100));
  if (a.tint) list.push(new F.ColorMatrix({ matrix: [1 + a.tint / 600, 0, 0, 0, 0, 0, 1 - a.tint / 400, 0, 0, 0, 0, 0, 1 + a.tint / 600, 0, 0, 0, 0, 0, 1, 0] }));
  if (a.hue) list.push(new F.HueRotation({ rotation: a.hue / 100 }));
  if (a.sharpen) { const k = a.sharpen / 100; list.push(new F.Convolute({ matrix: [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0] })); }
  if (a.blur) list.push(new F.Blur({ blur: a.blur / 250 }));
  if (a.grain) list.push(new F.Noise({ noise: a.grain * 1.6 }));
  img.filters = list; img.applyFilters(); img.dirty = true;
}
// Small previews of each filter preset, made from a thumbnail of the photo
export async function presetThumbs(src) {
  const im = new Image(); im.src = src; await im.decode();
  const k = 120 / Math.max(im.naturalWidth, im.naturalHeight);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const out = {};
  for (const p of PRESETS) {
    const fi = new fabric.FabricImage(c); fi.filters = p.make(); fi.applyFilters();
    const el = fi.getElement(); const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d').drawImage(el, 0, 0);
    out[p.id] = cc.toDataURL('image/jpeg', 0.8);
  }
  return out;
}
export function adjustPanel(root, img, ed) {
  root.append(h('div.p-title', 'Adjust & filters'));
  const grid = h('div.filters'); root.append(h('div.sec', h('h4', 'Filters')), grid);
  const src = ed.assetUrl(img.assetId) || img.getSrc();
  const draw = (thumbs) => {
    grid.innerHTML = '';
    for (const p of PRESETS) {
      const b = h('button' + ((img.ro2Filter || 'none') === p.id ? '.on' : ''), { on: { click: () => { img.ro2Filter = p.id === 'none' ? undefined : p.id; buildFilters(img); ed.canvas.requestRenderAll(); ed.commit(); draw(thumbs); } } }, thumbs ? h('img', { src: thumbs[p.id] }) : h('div', { style: { aspectRatio: 1, background: 'var(--panel-3)' } }), h('span', p.name));
      grid.append(b);
    }
  };
  draw(null); presetThumbs(src).then(draw).catch(() => {});
  root.append(h('div.sec', h('h4', 'Adjust'), h('a', { on: { click: () => { img.ro2Adjust = undefined; buildFilters(img); ed.canvas.requestRenderAll(); ed.commit(); root.innerHTML = ''; adjustPanel(root, img, ed); } } }, 'Reset')));
  const a = img.ro2Adjust || {};
  let t;
  for (const [key, label, min, max] of ADJUST) {
    const row = slider(label, { min, max, value: a[key] || 0, onInput: (v) => { img.ro2Adjust = { ...(img.ro2Adjust || {}), [key]: v }; clearTimeout(t); t = setTimeout(() => { buildFilters(img); ed.canvas.requestRenderAll(); }, 30); }, onChange: () => { buildFilters(img); ed.canvas.requestRenderAll(); ed.commit(); } });
    row.input.dataset.reset = 0; root.append(row);
  }
  root.append(h('p.tiny.dim', 'Double-click a slider to reset it.'));
}
export function framesGrid(onPick, current) {
  const g = h('div.tiles.c5');
  const none = h('button.tile' + (!current ? '.on' : ''), { title: 'No frame', html: ico('square'), on: { click: () => onPick(null) } }); g.append(none);
  for (const id of FRAMES) { const s = byId(id); g.append(h('button.tile', { title: s.name, html: shapeSvg(s, 'var(--text-2)'), on: { click: () => onPick(id) } })); }
  return g;
}
export { btn };

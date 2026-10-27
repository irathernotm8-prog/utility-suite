// Colour picker popover: swatches (this design, recent, defaults), a full picker with opacity, an eyedropper and gradients.
import { h, popover, closePopover, ico, slider, seg, clamp } from '../ui.js';
import { gradientCss } from '../editor/editor.js';

export const PALETTE = ['#000000', '#3d4249', '#7c8b98', '#c7cdd2', '#ffffff', '#ff5757', '#ff66c4', '#cb6ce6', '#8c52ff', '#5e17eb', '#0097b2', '#0cc0df', '#5ce1e6', '#38b6ff', '#5271ff', '#004aad', '#00bf63', '#7ed957', '#c1ff72', '#ffde59', '#ffbd59', '#ff914d', '#ff3131', '#b4846c'];
export const GRADIENTS = [
  ['#5ef2ad', '#3fd2ea'], ['#ff7eb3', '#ff758c'], ['#a18cd1', '#fbc2eb'], ['#f6d365', '#fda085'], ['#84fab0', '#8fd3f4'], ['#4facfe', '#00f2fe'],
  ['#fa709a', '#fee140'], ['#30cfd0', '#330867'], ['#0f2027', '#2c5364'], ['#ff9a9e', '#fecfef'], ['#667eea', '#764ba2'], ['#f83600', '#f9d423'],
  ['#000000', '#434343'], ['#e0eafc', '#cfdef3'], ['#11998e', '#38ef7d'], ['#ee0979', '#ff6a00'],
];
let recent = []; let brandColors = [];
export function setBrandColors(list) { brandColors = (list || []).map((c) => c.hex || c); }
export function setRecent(list) { recent = list || []; }
export function pushRecent(c) { if (typeof c !== 'string') return; recent = [c, ...recent.filter((x) => x !== c)].slice(0, 16); window.ro2.settings.set({ recentColors: recent }); }

const ctx = document.createElement('canvas').getContext('2d');
export function parse(c) {
  if (!c || c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  ctx.fillStyle = '#000'; ctx.fillStyle = c; const v = ctx.fillStyle;
  if (v[0] === '#') return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a: 1 };
  const m = v.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
}
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
export function toHex({ r, g, b }) { return '#' + hex2(r) + hex2(g) + hex2(b); }
export function toCss({ r, g, b, a }) { return a >= 0.999 ? toHex({ r, g, b }) : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`; }
function rgb2hsv({ r, g, b }) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0; if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; } return { h: hh, s: mx ? d / mx : 0, v: mx }; }
function hsv2rgb({ h: hh, s, v }) { const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c; let [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x]; return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }; }
export const swatchCss = (v) => (v && typeof v === 'object' && v.stops ? gradientCss(v) : v || 'transparent');

// value: '#rrggbb' | 'rgba()' | gradient spec {type, angle, stops:[{offset,color}]}
// onChange(value, final) — final is true when the user lets go (for undo)
export function colorPicker(anchor, value, onChange, { noGradient = false, docColors = [], allowNone = false, title } = {}) {
  let mode = value && typeof value === 'object' && value.stops ? 'gradient' : 'solid';
  let solid = typeof value === 'string' ? value : value?.stops?.[0]?.color || '#000000';
  let grad = value && value.stops ? JSON.parse(JSON.stringify(value)) : { type: 'linear', angle: 90, stops: [{ offset: 0, color: solid }, { offset: 1, color: '#ffffff' }] };
  let stopIdx = 0;
  const root = h('div.cp');
  const emit = (final) => onChange(mode === 'gradient' ? JSON.parse(JSON.stringify(grad)) : solid, final);
  function render() {
    root.innerHTML = '';
    if (title) root.append(h('div', { style: { fontWeight: 800, marginBottom: '8px' } }, title));
    if (!noGradient) root.append(seg([{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }], mode, (v) => { mode = v; if (v === 'gradient') { grad.stops[0].color = toHex(parse(solid)); } render(); emit(true); }, { block: true }));
    if (mode === 'solid') {
      root.append(pickerUI(solid, (c, final) => { solid = c; emit(final); if (final) pushRecent(c); }));
      const sw = (list, label, none) => { if (!list.length && !none) return; root.append(h('h5', label)); const g = h('div.sw'); if (none) g.append(h('button.none', { title: 'No colour', on: { click: () => { solid = 'transparent'; emit(true); render(); } } })); for (const c of list) g.append(h('button' + (c.toLowerCase() === String(solid).toLowerCase() ? '.on' : ''), { title: c, style: { background: c }, on: { click: () => { solid = c; emit(true); pushRecent(c); render(); } } })); root.append(g); };
      sw(brandColors.slice(0, 16), 'Brand colours');
      sw(docColors.filter((c) => typeof c === 'string').slice(0, 16), 'In this design', allowNone && !docColors.length);
      sw(recent.slice(0, 8), 'Recent');
      sw(PALETTE, 'Default colours', allowNone && docColors.length);
    } else {
      const bar = h('div.grad-bar', { style: { background: gradientCss({ ...grad, type: 'linear', angle: 0 }) } });
      grad.stops.forEach((s, i) => {
        const st = h('div.stop' + (i === stopIdx ? '.on' : ''), { style: { left: s.offset * 100 + '%', background: s.color } });
        st.addEventListener('pointerdown', (e) => {
          stopIdx = i; e.preventDefault(); const r = bar.getBoundingClientRect();
          const mv = (ev) => { s.offset = clamp((ev.clientX - r.left) / r.width, 0, 1); st.style.left = s.offset * 100 + '%'; bar.style.background = gradientCss({ ...grad, type: 'linear', angle: 0 }); emit(false); };
          const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); grad.stops.sort((a, b) => a.offset - b.offset); stopIdx = grad.stops.indexOf(s); emit(true); render(); };
          addEventListener('pointermove', mv); addEventListener('pointerup', up);
        });
        bar.append(st);
      });
      bar.addEventListener('dblclick', (e) => { const r = bar.getBoundingClientRect(); const off = clamp((e.clientX - r.left) / r.width, 0, 1); grad.stops.push({ offset: off, color: grad.stops[stopIdx].color }); grad.stops.sort((a, b) => a.offset - b.offset); stopIdx = grad.stops.findIndex((s) => s.offset === off); emit(true); render(); });
      root.append(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' } }, seg([{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }], grad.type, (v) => { grad.type = v; emit(true); render(); }),
        grad.stops.length > 2 ? h('button.btn.sm.ghost', { on: { click: () => { grad.stops.splice(stopIdx, 1); stopIdx = 0; emit(true); render(); } } }, 'Remove stop') : h('span.tiny.dim', 'Double-click the bar to add')));
      root.append(bar);
      if (grad.type === 'linear') root.append(slider('Angle', { min: 0, max: 360, value: grad.angle, fmt: (v) => v + '°', onInput: (v) => { grad.angle = v; emit(false); }, onChange: () => emit(true) }));
      root.append(pickerUI(grad.stops[stopIdx].color, (c, final) => { grad.stops[stopIdx].color = c; const st = root.querySelectorAll('.stop')[stopIdx]; if (st) st.style.background = c; bar.style.background = gradientCss({ ...grad, type: 'linear', angle: 0 }); emit(final); }));
      root.append(h('h5', 'Presets'));
      const g = h('div.sw'); for (const [a, b] of GRADIENTS) g.append(h('button', { style: { background: `linear-gradient(135deg, ${a}, ${b})` }, on: { click: () => { grad = { type: grad.type, angle: grad.angle, stops: [{ offset: 0, color: a }, { offset: 1, color: b }] }; stopIdx = 0; emit(true); render(); } } }));
      root.append(g);
    }
  }
  render();
  return popover(anchor, root, { cls: '' });
}

// The colour square, hue and opacity bars, hex box and eyedropper
function pickerUI(value, onChange) {
  let c = parse(value); let hsv = rgb2hsv(c); let a = c.a;
  const sv = h('div.sv'); const svDot = h('div.dot'); sv.append(svDot);
  const hue = h('div.hue'); const hueDot = h('div.dot'); hue.append(hueDot);
  const al = h('div.alpha'); const alFill = h('div.fill'); const alDot = h('div.dot'); al.append(alFill, alDot);
  const hex = h('input.input', { style: { flex: 1, height: '30px', fontFamily: 'ui-monospace, Menlo, monospace' } });
  const pct = h('input.input', { style: { width: '62px', height: '30px', textAlign: 'right' } });
  const out = () => toCss({ ...hsv2rgb(hsv), a });
  const paint = () => {
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`;
    svDot.style.left = hsv.s * 100 + '%'; svDot.style.top = (1 - hsv.v) * 100 + '%'; hueDot.style.left = (hsv.h / 360) * 100 + '%';
    const rgb = hsv2rgb(hsv); alFill.style.background = `linear-gradient(to right, transparent, ${toHex(rgb)})`; alDot.style.left = a * 100 + '%';
    if (document.activeElement !== hex) hex.value = toHex(rgb).toUpperCase(); if (document.activeElement !== pct) pct.value = Math.round(a * 100) + '%';
  };
  const drag = (el, fn) => el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); const r = el.getBoundingClientRect();
    const mv = (ev) => { fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); paint(); onChange(out(), false); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); onChange(out(), true); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); mv(e);
  });
  drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; if (a === 0) a = 1; });
  drag(hue, (x) => { hsv.h = x * 360; if (a === 0) a = 1; });
  drag(al, (x) => { a = Math.round(x * 100) / 100; });
  hex.addEventListener('change', () => { const p = parse(hex.value.startsWith('#') ? hex.value : '#' + hex.value); hsv = rgb2hsv(p); if (a === 0) a = 1; paint(); onChange(out(), true); });
  pct.addEventListener('change', () => { a = clamp((parseFloat(pct.value) || 0) / 100, 0, 1); paint(); onChange(out(), true); });
  const eye = h('button.btn.icon.sm', { title: 'Pick a colour from the screen', html: ico('pipette'), on: { click: async () => { if (!window.EyeDropper) return; try { const r = await new window.EyeDropper().open(); hsv = rgb2hsv(parse(r.sRGBHex)); a = 1; paint(); onChange(out(), true); } catch {} } } });
  paint();
  return h('div', { style: { marginTop: '10px' } }, sv, hue, al, h('div.row', eye, hex, pct));
}
export { closePopover };

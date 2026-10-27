// Detail panels for the selection: Position & size, and Effects (shadow, outline, corners, text spacing).
import { h, ico, slider, numField, seg, toggle, btn } from '../ui.js';
import { app } from '../app.js';
import { register, open as openPanel } from '../drawer.js';
import { fabric, kindOf, Ro2Line } from '../editor/fab.js';
import { colorPicker, parse, toCss, swatchCss } from './color.js';
import { docColors } from './background.js';

const ed = () => app.editor;
const sel = () => ed().selected();
const act = () => ed().active();

register('position', {
  label: 'Position', icon: 'move',
  render(root) {
    const o = act(); root.append(h('div.p-title', 'Position'));
    if (!o) { root.append(h('p.muted', 'Select something on the page.')); return; }
    const multi = o instanceof fabric.ActiveSelection;
    root.append(h('div.sec', h('h4', 'Arrange')));
    root.append(h('div.pos-grid',
      btn('Forward', () => ed().bringForward(), { icon: 'chevron-up', cls: 'sm' }), btn('Backward', () => ed().sendBackward(), { icon: 'chevron-down', cls: 'sm' }),
      btn('To front', () => ed().bringToFront(), { icon: 'chevrons-up', cls: 'sm' }), btn('To back', () => ed().sendToBack(), { icon: 'chevrons-down', cls: 'sm' })));
    root.append(h('div.sec', h('h4', multi ? 'Align to each other' : 'Align to page')));
    const al = (k, label, icon) => btn(label, () => { ed().align(k); fields(); }, { icon, cls: 'sm' });
    root.append(h('div.pos-grid', al('left', 'Left', 'align-start-vertical'), al('top', 'Top', 'align-start-horizontal'), al('hcenter', 'Centre', 'align-center-vertical'), al('vcenter', 'Middle', 'align-center-horizontal'), al('right', 'Right', 'align-end-vertical'), al('bottom', 'Bottom', 'align-end-horizontal')));
    if (multi && o.getObjects().length >= 3) {
      root.append(h('div.sec', h('h4', 'Space evenly')));
      root.append(h('div.pos-grid', btn('Across', () => ed().distribute('h'), { icon: 'align-horizontal-space-around', cls: 'sm' }), btn('Down', () => ed().distribute('v'), { icon: 'align-vertical-space-around', cls: 'sm' })));
    }
    root.append(h('div.sec', h('h4', 'Size & position')));
    const box = h('div'); root.append(box);
    let lockRatio = true;
    const fields = () => {
      box.innerHTML = ''; const a = act(); if (!a) return;
      const r = a.getBoundingRect(); const w = a.getScaledWidth(), hh = a.getScaledHeight();
      const setSize = (nw, nh) => {
        const k = kindOf(a);
        if (k === 'text') a.set({ width: nw / (a.scaleX || 1) });
        else if (a instanceof fabric.Rect) a.set({ width: nw / a.scaleX, height: nh / a.scaleY });
        else if (a instanceof Ro2Line) a.set({ width: nw });
        else a.set({ scaleX: (nw / a.width) * Math.sign(a.scaleX || 1), scaleY: nh / a.height });
        a.setCoords(); ed().canvas.requestRenderAll(); ed().commit(); fields();
      };
      const W = numField('W', w, (v) => setSize(v, lockRatio ? hh * (v / w) : hh), { min: 1 });
      const H = numField('H', hh, (v) => setSize(lockRatio ? w * (v / hh) : w, v), { min: 1 });
      const X = numField('X', r.left, (v) => { a.set({ left: a.left + (v - r.left) }); a.setCoords(); ed().canvas.requestRenderAll(); ed().commit(); fields(); });
      const Y = numField('Y', r.top, (v) => { a.set({ top: a.top + (v - r.top) }); a.setCoords(); ed().canvas.requestRenderAll(); ed().commit(); fields(); });
      const R = numField('°', a.angle || 0, (v) => { a.rotate(((v % 360) + 360) % 360); a.setCoords(); ed().canvas.requestRenderAll(); ed().commit(); fields(); }, { step: 1 });
      const lk = h('button.btn.icon.sm' + (lockRatio ? '.on' : ''), { title: 'Keep proportions', html: ico(lockRatio ? 'link' : 'unlink'), on: { click: () => { lockRatio = !lockRatio; fields(); } } });
      box.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'center' } }, W, H, lk), h('div.kv', { style: { marginTop: '8px' } }, X, Y), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '8px' } }, R,
        btn('', () => { ed().flip('x'); }, { icon: 'flip-horizontal-2', cls: 'sm', title: 'Flip horizontally' }), btn('', () => { ed().flip('y'); }, { icon: 'flip-vertical-2', cls: 'sm', title: 'Flip vertically' })));
      box.append(h('p.tiny.dim', { style: { marginTop: '8px' } }, `Page is ${ed().W} × ${ed().H} px. Drag a label to scrub its value.`));
    };
    fields();
    root._sync = fields;
  },
});

// ───── effects ─────
const SHADOWS = {
  none: null, soft: { color: 'rgba(0,0,0,0.25)', blur: 30, dist: 10, angle: 90 }, drop: { color: 'rgba(0,0,0,0.45)', blur: 6, dist: 8, angle: 45 },
  glow: { color: 'rgba(70,230,162,0.9)', blur: 28, dist: 0, angle: 0 }, hard: { color: 'rgba(0,0,0,1)', blur: 0, dist: 10, angle: 45 }, lift: { color: 'rgba(0,0,0,0.35)', blur: 50, dist: 24, angle: 90 },
};
const scaleOf = (o) => (Math.abs(o.scaleX || 1) + Math.abs(o.scaleY || 1)) / 2;
function shadowOf(o) { const s = o.shadow; if (!s) return null; const k = scaleOf(o); const dist = Math.hypot(s.offsetX, s.offsetY) * k; return { color: s.color, blur: s.blur * k, dist, angle: dist ? Math.round((Math.atan2(s.offsetY, s.offsetX) * 180) / Math.PI) : 45 }; }
function setShadow(list, sp, commit = true) {
  const base = Math.min(ed().W, ed().H) / 1000;
  for (const o of list) {
    if (!sp) o.set('shadow', null);
    else { const a = (sp.angle * Math.PI) / 180; const k = scaleOf(o); o.set('shadow', new fabric.Shadow({ color: sp.color, blur: (sp.blur * base) / k, offsetX: (Math.cos(a) * sp.dist * base) / k, offsetY: (Math.sin(a) * sp.dist * base) / k })); }
    o.dirty = true;
  }
  ed().canvas.requestRenderAll(); if (commit) ed().commit();
}
function colorBtn(label, value, onPick, opts = {}) {
  const b = h('button.btn.block', { style: { justifyContent: 'flex-start', gap: '10px' } });
  const paint = (v) => { b.innerHTML = `<i style="width:20px;height:20px;border-radius:6px;display:block;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);background:${swatchCss(v)}"></i><span>${label}</span>`; };
  paint(value);
  b.onclick = () => colorPicker(b, value, (v, final) => { value = v; paint(v); onPick(v, final); }, { docColors: docColors(ed()), ...opts });
  return b;
}
register('effects', {
  label: 'Effects', icon: 'wand-sparkles',
  render(root) {
    const o = act(); root.append(h('div.p-title', 'Effects'));
    if (!o) { root.append(h('p.muted', 'Select something on the page.')); return; }
    const list = o instanceof fabric.ActiveSelection ? o.getObjects() : [o];
    const k = kindOf(o); const first = list[0];
    // shadow
    root.append(h('div.sec', h('h4', 'Shadow')));
    const cur = shadowOf(first);
    const presets = h('div.chips');
    for (const [id, sp] of Object.entries(SHADOWS)) presets.append(h('button.chip', { on: { click: () => { setShadow(list, sp); rerender(); } } }, id[0].toUpperCase() + id.slice(1)));
    root.append(presets);
    if (cur) {
      const base = Math.min(ed().W, ed().H) / 1000; const sp = { ...cur, blur: cur.blur / base, dist: cur.dist / base };
      const apply = (commit) => setShadow(list, sp, commit);
      root.append(colorBtn('Shadow colour', sp.color, (v, f) => { if (typeof v === 'string') { sp.color = v; apply(f); } }, { noGradient: true }));
      root.append(slider('Blur', { min: 0, max: 100, value: sp.blur, onInput: (v) => { sp.blur = v; apply(false); }, onChange: () => apply(true) }));
      root.append(slider('Distance', { min: 0, max: 100, value: sp.dist, onInput: (v) => { sp.dist = v; apply(false); }, onChange: () => apply(true) }));
      root.append(slider('Direction', { min: -180, max: 180, value: sp.angle, fmt: (v) => v + '°', onInput: (v) => { sp.angle = v; apply(false); }, onChange: () => apply(true) }));
      const al = parse(sp.color).a;
      root.append(slider('Strength', { min: 0, max: 100, value: Math.round(al * 100), fmt: (v) => v + '%', onInput: (v) => { const c = parse(sp.color); c.a = v / 100; sp.color = toCss(c); apply(false); }, onChange: () => apply(true) }));
    }
    // outline
    if (k !== 'line' && k !== 'icon' && !(k === 'image' && first.ro2Frame)) {
      const isText = k === 'text';
      root.append(h('div.sec', h('h4', isText ? 'Outline' : 'Border')));
      const sw0 = first.strokeWidth || 0;
      const base = isText ? first.fontSize / 40 : Math.min(ed().W, ed().H) / 400;
      root.append(slider('Thickness', { min: 0, max: 40, value: Math.round(sw0 / base), onInput: (v) => { list.forEach((x) => { x.set({ strokeWidth: v * base, stroke: x.stroke || '#1b1f23', strokeUniform: !isText, paintFirst: isText ? 'stroke' : 'fill', strokeLineJoin: 'round' }); if (isText) x.initDimensions?.(); x.dirty = true; }); ed().canvas.requestRenderAll(); }, onChange: () => ed().commit() }));
      root.append(colorBtn(isText ? 'Outline colour' : 'Border colour', first.stroke || '#1b1f23', (v, f) => { if (typeof v !== 'string') return; list.forEach((x) => { x.set({ stroke: v }); if (!x.strokeWidth) x.set({ strokeWidth: base * 3, strokeUniform: !isText, paintFirst: isText ? 'stroke' : 'fill' }); x.dirty = true; }); ed().canvas.requestRenderAll(); if (f) ed().commit(); }, { noGradient: true }));
      if (!isText) root.append(h('div', { style: { marginTop: '8px' } }, seg([{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }], first.strokeDashArray ? (first.strokeDashArray[0] < 1 ? 'dotted' : 'dashed') : 'solid', (v) => { list.forEach((x) => { const w = x.strokeWidth || 2; x.set({ strokeDashArray: v === 'solid' ? null : v === 'dashed' ? [w * 3, w * 2] : [0.01, w * 2], strokeLineCap: v === 'dotted' ? 'round' : 'butt' }); x.dirty = true; }); ed().canvas.requestRenderAll(); ed().commit(); }, { block: true })));
    }
    if (first instanceof fabric.Rect) {
      root.append(h('div.sec', h('h4', 'Corner rounding')));
      const mx = Math.min(first.width, first.height) / 2;
      root.append(slider('Rounding', { min: 0, max: 100, value: Math.round((first.rx / mx) * 100), fmt: (v) => v + '%', onInput: (v) => { list.forEach((x) => { if (x instanceof fabric.Rect) { const m = Math.min(x.width, x.height) / 2; x.set({ rx: (m * v) / 100, ry: (m * v) / 100 }); x.dirty = true; } }); ed().canvas.requestRenderAll(); }, onChange: () => ed().commit() }));
    }
    if (k === 'text') {
      root.append(h('div.sec', h('h4', 'Spacing')));
      root.append(slider('Letter spacing', { min: -100, max: 800, value: first.charSpacing || 0, onInput: (v) => { list.forEach((x) => { x.set({ charSpacing: v }); x.initDimensions(); }); ed().canvas.requestRenderAll(); }, onChange: () => ed().commit() }));
      root.append(slider('Line spacing', { min: 0.5, max: 3, step: 0.05, value: first.lineHeight || 1.16, fmt: (v) => v.toFixed(2), onInput: (v) => { list.forEach((x) => { x.set({ lineHeight: v }); x.initDimensions(); }); ed().canvas.requestRenderAll(); }, onChange: () => ed().commit() }));
      if (list.length === 1) {
        root.append(h('div.sec', h('h4', 'Curve')));
        let cur = first; let busyC = false;
        const row = slider('Curve', { min: -100, max: 100, value: first.ro2Curve || 0, onInput: async (v) => { if (busyC || !first.ro2Curve) return; busyC = true; const { setCurve } = await import('../editor/objects.js'); cur = await setCurve(ed(), cur, v); busyC = false; }, onChange: async (v) => { const { setCurve } = await import('../editor/objects.js'); cur = await setCurve(ed(), cur, v); ed().commit(); ed().emit('selection', ed().selected()); } });
        row.input.dataset.reset = 0; root.append(row);
      }
      root.append(h('div.sec', h('h4', 'Highlight')));
      root.append(colorBtn('Highlight colour', first.textBackgroundColor || 'rgba(0,0,0,0)', (v, f) => { if (typeof v !== 'string') return; list.forEach((x) => { x.set({ textBackgroundColor: v === 'transparent' ? '' : v }); x.dirty = true; }); ed().canvas.requestRenderAll(); if (f) ed().commit(); }, { noGradient: true, allowNone: true }));
    }
    function rerender() { openPanel('effects'); }
  },
});
export { toggle };

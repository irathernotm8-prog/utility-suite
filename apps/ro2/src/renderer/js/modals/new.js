// New design: every size by category, or a custom size in px, inches, cm or mm.
import { h, ico, modal, btn, toast } from '../ui.js';
import { SIZE_CATS, UNITS } from '../sizes.js';
import { newDesign } from '../app.js';

export function openNew() {
  let cat = 'social'; let unit = 'px';
  const left = h('div.size-cats'); const right = h('div');
  const W = h('input.input', { value: 1080, style: { width: '100%' } }), H = h('input.input', { value: 1080, style: { width: '100%' } });
  const unitSel = h('select.input', { on: { change: () => { const pw = toPx(W.value), ph = toPx(H.value); unit = unitSel.value; W.value = fromPx(pw); H.value = fromPx(ph); } } }, ...Object.keys(UNITS).map((u) => h('option', { value: u }, u)));
  const toPx = (v) => Math.round((parseFloat(v) || 0) * UNITS[unit]); const fromPx = (p) => (unit === 'px' ? p : +(p / UNITS[unit]).toFixed(2));
  const create = (w, hh, name) => {
    if (!(w >= 16 && hh >= 16 && w <= 20000 && hh <= 20000)) return toast('Pick a size between 16 and 20,000 px.', { type: 'err' });
    m.close(); newDesign(w, hh, name);
  };
  const draw = () => {
    left.innerHTML = '';
    left.append(h('button' + (cat === 'custom' ? '.on' : ''), { html: ico('ruler') + '<span>Custom size</span>', on: { click: () => { cat = 'custom'; draw(); } } }));
    for (const c of SIZE_CATS) left.append(h('button' + (c.id === cat ? '.on' : ''), { html: ico(c.icon) + `<span>${c.name}</span>`, on: { click: () => { cat = c.id; draw(); } } }));
    right.innerHTML = '';
    if (cat === 'custom') {
      right.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto 1fr 90px', gap: '8px', alignItems: 'end' } },
        h('label', h('div.small.muted', { style: { marginBottom: '4px' } }, 'Width'), W), btn('', () => { const t = W.value; W.value = H.value; H.value = t; }, { icon: 'arrow-left-right', cls: 'icon ghost', title: 'Swap' }),
        h('label', h('div.small.muted', { style: { marginBottom: '4px' } }, 'Height'), H), h('label', h('div.small.muted', { style: { marginBottom: '4px' } }, 'Units'), unitSel)));
      right.append(h('p.small.dim', { style: { marginTop: '10px' } }, 'Inches, cm and mm are converted at 300 DPI (print quality).'));
      right.append(btn('Create design', () => create(toPx(W.value), toPx(H.value), `${toPx(W.value)} × ${toPx(H.value)}`), { cls: 'primary', icon: 'plus' }));
      return;
    }
    const list = h('div.size-list'); right.append(list);
    for (const [name, w, hh, note] of SIZE_CATS.find((c) => c.id === cat).items) {
      const k = 24 / Math.max(w, hh);
      list.append(h('div.size-opt', { on: { click: () => create(w, hh, name) } }, h('div.shape', h('i', { style: { width: Math.max(6, w * k) + 'px', height: Math.max(6, hh * k) + 'px' } })), h('div', h('b', name), h('span', `${w} × ${hh}${note ? ' · ' + note : ''}`))));
    }
  };
  draw();
  const m = modal({ title: 'New design', wide: true, body: h('div.size-groups', left, right) });
}

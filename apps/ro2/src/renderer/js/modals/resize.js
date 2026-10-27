// Resize: change the design to any size or aspect ratio, scaling the content to fit (or a resized copy).
import { h, ico, modal, btn, toggle, toast, toastErr, busy } from '../ui.js';
import { SIZE_CATS, UNITS } from '../sizes.js';
import { app, saveNow, openDoc } from '../app.js';
import { uid } from '../editor/fab.js';
import { Editor, resizeDocData } from '../editor/editor.js';
import { thumb } from '../editor/render.js';

export function openResize() {
  const ed = app.editor; let cat = 'social'; let pick = null; let mode = 'scale'; let copy = false; let unit = 'px'; const picks = [];
  const left = h('div.size-cats'); const right = h('div');
  const W = h('input.input', { value: ed.W, style: { width: '100%' } }), H = h('input.input', { value: ed.H, style: { width: '100%' } });
  const unitSel = h('select.input', { on: { change: () => { const pw = toPx(W.value), ph = toPx(H.value); unit = unitSel.value; W.value = fromPx(pw); H.value = fromPx(ph); } } }, ...Object.keys(UNITS).map((u) => h('option', { value: u, selected: u === 'px' }, u)));
  const toPx = (v) => Math.round((parseFloat(v) || 0) * UNITS[unit]); const fromPx = (p) => (unit === 'px' ? p : +(p / UNITS[unit]).toFixed(2));
  const draw = () => {
    left.innerHTML = '';
    for (const c of SIZE_CATS) left.append(h('button' + (c.id === cat ? '.on' : ''), { html: ico(c.icon) + `<span>${c.name}</span>`, on: { click: () => { cat = c.id; draw(); } } }));
    left.append(h('button' + (cat === 'custom' ? '.on' : ''), { html: ico('ruler') + '<span>Custom size</span>', on: { click: () => { cat = 'custom'; draw(); } } }));
    right.innerHTML = '';
    if (cat === 'custom') {
      right.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto 1fr 90px', gap: '8px', alignItems: 'end' } },
        h('label', h('div.small.muted', { style: { marginBottom: '4px' } }, 'Width'), W), btn('', () => { const t = W.value; W.value = H.value; H.value = t; }, { icon: 'arrow-left-right', cls: 'icon ghost', title: 'Swap' }),
        h('label', h('div.small.muted', { style: { marginBottom: '4px' } }, 'Height'), H), h('label', h('div.small.muted', { style: { marginBottom: '4px' } }, 'Units'), unitSel)));
      right.append(h('p.small.dim', { style: { marginTop: '10px' } }, 'Inches, cm and mm are converted at 300 DPI (print quality).'));
      pick = null; return;
    }
    const list = h('div.size-list'); right.append(list);
    for (const [name, w, hh, note] of SIZE_CATS.find((c) => c.id === cat).items) {
      const k = 24 / Math.max(w, hh);
      const on = copy ? picks.some((p) => p.name === name && p.w === w) : pick && pick.name === name;
      const o = h('div.size-opt' + (on ? '.on' : ''), { on: { click: () => {
        if (copy) { const i = picks.findIndex((p) => p.name === name && p.w === w); if (i >= 0) picks.splice(i, 1); else picks.push({ name, w, h: hh }); syncGo(); }
        else { pick = { name, w, h: hh }; W.value = fromPx(w); H.value = fromPx(hh); }
        draw(); } } },
        h('div.shape', h('i', { style: { width: Math.max(6, w * k) + 'px', height: Math.max(6, hh * k) + 'px' } })), h('div', h('b', name), h('span', `${w} × ${hh}${note ? ' · ' + note : ''}`)));
      list.append(o);
    }
  };
  draw();
  const opts = h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' } },
    h('div.seg', ...[['scale', 'Scale content to fit'], ['keep', 'Keep sizes']].map(([v, l]) => { const b = h('button' + (v === mode ? '.on' : ''), { on: { click: () => { mode = v; b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); } } }, l); return b; })),
    toggle('Make resized copies (pick several sizes)', copy, (v) => { copy = v; if (v && pick && !picks.length) picks.push(pick); syncGo(); draw(); }));
  const goB = btn('Resize', go, { cls: 'primary', icon: 'scaling' });
  const syncGo = () => { goB.querySelector('span').textContent = copy ? (picks.length > 1 ? `Make ${picks.length} copies` : 'Make a copy') : 'Resize'; };
  const m = modal({
    title: 'Resize design', wide: true,
    body: [h('div.size-groups', left, right), h('div', { style: { marginTop: '14px' } }, opts)],
    foot: [h('div.left.small.dim', `Now ${ed.W} × ${ed.H} px`), btn('Cancel', () => m.close(), { cls: 'ghost' }), goB],
  });
  async function many() { m.close(); await manyCopies(ed, picks.slice(), mode); }
  async function go() {
    if (copy && (picks.length > 1 || (picks.length === 1 && cat !== 'custom'))) return many();
    const w = pick ? pick.w : toPx(W.value), hh = pick ? pick.h : toPx(H.value);
    if (!(w >= 16 && hh >= 16 && w <= 20000 && hh <= 20000)) return toast('Pick a size between 16 and 20,000 px.', { type: 'err' });
    m.close();
    const b = busy('Resizing…');
    try {
      if (copy) {
        await saveNow(false);
        const data = ed.toFile(); data.id = uid(); data.name = `${data.name} (${pick ? pick.name : `${w}×${hh}`})`; data.thumb = null;
        await openDoc(data, null);
      }
      await app.editor.resize(w, hh, mode);
      if (pick && /^Untitled design/.test(app.editor.doc.name)) app.editor.doc.name = pick.name;
      app.emit('doc', app.editor.doc);
      await saveNow(true);
    } catch (e) { toastErr(e); } finally { b.close(); }
  }
}
// Several resized copies at once, each saved as its own design (shown on Home)
async function manyCopies(ed, picks, mode) {
  const b = busy(`Making ${picks.length} copies…`); const base = ed.doc.name.replace(/\s*\(.*\)$/, '');
  try {
    await saveNow(false);
    const src = ed.toFile();
    for (const [i, p] of picks.entries()) {
      b.set(i / picks.length, p.name);
      const data = JSON.parse(JSON.stringify(src)); data.id = uid(); data.name = `${base} (${p.name})`; data.created = data.updated = Date.now();
      resizeDocData(data, p.w, p.h, mode);
      const fake = Object.create(Editor.prototype); Object.assign(fake, { doc: data, page: -1, assets: new Map(Object.entries(data.assets || {})) });
      data.thumb = await thumb(fake, 0).catch(() => null);
      await window.ro2.designs.save({ name: data.name, data: JSON.stringify(data) });
    }
    toast(`Made ${picks.length} resized copies. They’re on Home.`, { action: { label: 'Go Home', run: () => document.getElementById('brand').click() } });
  } catch (e) { toastErr(e); } finally { b.close(); }
}

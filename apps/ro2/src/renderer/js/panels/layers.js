// Layers (top of the list = front of the page) and Templates.
import { h, ico, promptBox } from '../ui.js';
import { app, ensureEditor } from '../app.js';
import { register } from '../drawer.js';
import { kindOf, fabric } from '../editor/fab.js';
import { TEMPLATES, buildTemplate } from '../templates.js';
import { thumbOfTemplate } from '../home.js';

const KIND_ICON = { text: 'type', image: 'image', html: 'code-xml', video: 'clapperboard', line: 'minus', icon: 'smile', group: 'group', shape: 'shapes' };
function label(o) { const k = kindOf(o); if (k === 'text') return (o.text || '').replace(/\s+/g, ' ').slice(0, 40) || 'Text'; return o.ro2Name || (k === 'image' ? 'Photo' : k === 'shape' ? 'Shape' : k[0].toUpperCase() + k.slice(1)); }
register('layers', {
  label: 'Layers', icon: 'layers',
  render(root) {
    const ed = ensureEditor();
    root.append(h('div.p-title', 'Layers'));
    const objs = ed.userObjects().slice().reverse();
    if (!objs.length) { root.append(h('p.muted', 'Nothing on this page yet.')); return; }
    const sel = new Set(ed.selected());
    let drag = null;
    for (const o of objs) {
      const k = kindOf(o);
      const th = h('div.lt', { html: k === 'image' ? '' : ico(KIND_ICON[k] || 'square') });
      if (k === 'image') { try { th.style.backgroundImage = `url(${ed.assetUrl(o.assetId) || o.getSrc()})`; } catch {} }
      if (k === 'shape' && typeof o.fill === 'string') th.style.color = o.fill;
      const eye = h('button' + (o.visible === false ? '' : '.on'), { title: o.visible === false ? 'Show' : 'Hide', html: ico(o.visible === false ? 'eye-off' : 'eye'), on: { click: (e) => { e.stopPropagation(); o.visible = o.visible === false; if (!o.visible) ed.canvas.discardActiveObject(); ed.canvas.requestRenderAll(); ed.commit(); app.emit('refresh-panel'); } } });
      const lock = h('button' + (o.ro2Locked ? '.on' : ''), { title: o.ro2Locked ? 'Unlock' : 'Lock', html: ico(o.ro2Locked ? 'lock' : 'lock-open'), on: { click: (e) => { e.stopPropagation(); ed._applyLock(o, !o.ro2Locked); ed.canvas.requestRenderAll(); ed.commit(); app.emit('refresh-panel'); } } });
      const row = h('div.layer' + (sel.has(o) ? '.on' : '') + (o.visible === false ? '.hidden-l' : ''), { draggable: o.ro2Role !== 'bgimage',
        on: {
          click: (e) => { if (o.visible === false || o.ro2Role === 'bgimage') return; if (e.shiftKey || e.metaKey || e.ctrlKey) { const cur = ed.selected(); ed.select(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]); } else ed.select(o); app.emit('refresh-panel'); },
          dblclick: async () => { const n = await promptBox('Layer name', o.ro2Name || label(o)); if (n) { o.ro2Name = n; ed.commit(); app.emit('refresh-panel'); } },
          dragstart: () => { drag = o; row.classList.add('dragging'); },
          dragend: () => { drag = null; row.classList.remove('dragging'); },
          dragover: (e) => { if (!drag || drag === o) return; e.preventDefault(); const r = row.getBoundingClientRect(); const above = e.clientY < r.top + r.height / 2; row.classList.toggle('drop-above', above); row.classList.toggle('drop-below', !above); },
          dragleave: () => row.classList.remove('drop-above', 'drop-below'),
          drop: (e) => { e.preventDefault(); row.classList.remove('drop-above', 'drop-below'); if (!drag || drag === o) return; const r = row.getBoundingClientRect(); const above = e.clientY < r.top + r.height / 2; const all = ed.canvas.getObjects(); let idx = all.indexOf(o); const from = all.indexOf(drag); if (above) idx = idx + (from > idx ? 1 : 0); else idx = idx - (from < idx ? 1 : 0); ed.moveTo(drag, idx); app.emit('refresh-panel'); },
        } }, th, h('div.ln', label(o), h('small', o.ro2Role === 'bgimage' ? 'Background' : k)), eye, lock);
      root.append(row);
    }
    root.append(h('p.tiny.dim', { style: { marginTop: '10px' } }, 'Drag to reorder. Double-click to rename. Shift-click to select several.'));
  },
});

register('templates', {
  label: 'Templates', icon: 'layout-template',
  async render(root, _o, alive) {
    const ed = ensureEditor();
    root.append(h('div.p-title', 'Templates'));
    root.append(h('p.small.muted', { style: { marginTop: '-6px' } }, 'Adds the template to a new page of this design, resized to fit. Every part stays editable.'));
    const g = h('div.tiles.c2', { style: { gap: '10px' } }); root.append(g);
    for (const t of TEMPLATES) {
      const im = h('img', { style: { objectFit: 'contain' } });
      const tile = h('button.tile', { title: t.name, style: { aspectRatio: '1' }, on: { click: async () => {
        if (ed.userObjects().length) await ed.addPage(ed.page, false);
        ed.setBackground(JSON.parse(JSON.stringify(t.bg)), { commit: false });
        const objs = await buildTemplate(t, ed.W, ed.H); objs.forEach((o) => ed.add(o, { select: false, commit: false })); ed.commit();
      } } }, im, h('div.cap', t.name));
      g.append(tile);
      thumbOfTemplate(t).then((u) => { if (alive()) im.src = u; });
    }
  },
});
export { fabric };

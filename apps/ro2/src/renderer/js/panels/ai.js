// AI tools: one click to a cut-out, eraser, grab or expand, plus the models that power them.
import { h, ico, fmtBytes, btn, toastErr, confirmBox } from '../ui.js';
import { app, runStudio } from '../app.js';
import { register, refresh } from '../drawer.js';
import { models, onModelProgress, call } from '../ai/client.js';
import { fabric } from '../editor/fab.js';

export const TOOLS = [
  { mode: 'removebg', name: 'Remove background', icon: 'scissors', text: 'Cut out the subject in one click, then fine-tune, add a new background or a sticker outline.' },
  { mode: 'erase', name: 'Magic eraser', icon: 'eraser', text: 'Paint over or click on anything (people, text, wires, blemishes) and it disappears.' },
  { mode: 'grab', name: 'Magic grab', icon: 'hand-grab', text: 'Lift an object out into its own layer to move or resize it. The gap behind is filled in.' },
  { mode: 'layers', name: 'Make editable', icon: 'layers', text: 'Take a flat picture apart: real text you can retype, objects and shapes as their own layers, the background rebuilt.' },
  { mode: 'expand', name: 'Magic expand', icon: 'expand', text: 'Grow a photo past its edges to fill the page or a new shape.' },
];
let gpuInfo = null;
register('ai', {
  label: 'AI tools', icon: 'sparkles', ai: true,
  async render(root, _o, alive) {
    root.append(h('div.p-title', 'AI tools'));
    const img = app.editor && app.editor.active() instanceof fabric.FabricImage ? app.editor.active() : null;
    if (!img) root.append(h('div.note', { style: { marginBottom: '12px' } }, h('b', 'Select a photo on the page'), ' to use these. Or start from Home with ', h('b', 'Remove a background'), '.'));
    for (const t of TOOLS) {
      const c = h('div.ai-card' + (img ? '' : '.disabled'), { on: { click: () => img && runStudio(img, t.mode) } }, h('div.qi', { html: ico(t.icon) }), h('div', h('b', t.name), h('span', t.text)));
      root.append(c);
    }
    root.append(h('div.sec', h('h4', 'AI models on this computer')));
    const list = h('div'); root.append(list);
    const ms = await models(true); if (!alive()) return;
    const missing = ms.filter((m) => !m.installed && !m.optional);
    if (missing.length > 1) root.insertBefore(btn(`Download all (${fmtBytes(missing.reduce((s, m) => s + m.size, 0))})`, async () => { for (const m of missing) { const r = await window.ro2.models.download(m.id); if (!r.ok) { toastErr(r.error); break; } } refresh(['ai']); }, { cls: 'primary block', icon: 'download' }), list);
    for (const m of ms) {
      const bar = h('i', { style: { width: Math.round((m.progress || 0) * 100) + '%' } });
      const action = m.installed ? btn('', async () => { if (await confirmBox(`Remove ${m.name}?`, `It frees ${fmtBytes(m.size)}. You can download it again any time.`, 'Remove', true)) { await window.ro2.models.remove(m.id); refresh(['ai']); } }, { icon: 'trash-2', cls: 'ghost icon sm', title: 'Remove from this computer' })
        : m.downloading ? btn('', () => window.ro2.models.cancel(m.id), { icon: 'x', cls: 'ghost icon sm', title: 'Cancel' })
          : btn(fmtBytes(m.size), async () => { const r = await window.ro2.models.download(m.id); if (!r.ok && r.error !== 'cancelled') toastErr(r.error); refresh(['ai']); }, { icon: 'download', cls: 'sm' });
      const row = h('div.model-row', h('div.mi', h('b', m.name, ' ', m.installed ? h('span.badge', 'Ready') : m.optional ? h('span.badge.dim', 'Optional') : null), h('span', m.blurb), m.downloading ? h('div.progress', bar) : null, h('div.tiny.dim', { style: { marginTop: '3px' } }, `${m.source} · ${m.license}`)), action);
      row.dataset.id = m.id; list.append(row);
    }
    const off = onModelProgress((p) => { if (!alive()) return off(); const row = list.querySelector(`[data-id="${p.id}"]`); if (p.done || p.error) { off(); refresh(['ai']); return; } if (row) { let b = row.querySelector('.progress i'); if (!b) { row.querySelector('.mi').append(h('div.progress', b = h('i'))); } b.style.width = Math.round(p.progress * 100) + '%'; } });
    const where = h('p.tiny.dim', { style: { marginTop: '12px', lineHeight: 1.5 } }, 'Everything runs on this computer; your photos never leave it. ');
    root.append(where);
    if (!gpuInfo) gpuInfo = await call('info').catch(() => null);
    if (gpuInfo && alive()) where.append(gpuInfo.gpu ? 'Using the graphics card (WebGPU).' : `Using the processor (${gpuInfo.threads} threads).`);
  },
});

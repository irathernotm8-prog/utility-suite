// Settings and keyboard shortcuts.
import { h, modal, btn, toggle, MOD, toast, seg } from '../ui.js';
import { app } from '../app.js';
import { open as openPanel } from '../drawer.js';

export async function openSettings() {
  const info = await window.ro2.info(); const s = app.settings;
  const folder = h('span.small.muted', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px', display: 'inline-block' } }, info.designsFolder);
  const m = modal({
    title: 'Settings',
    body: [
      h('div.form-row', h('div', h('b', 'Theme'), h('div.small.muted', 'System follows your computer’s light or dark setting.')), seg([{ value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'system', label: 'System', icon: 'monitor' }], s.theme || 'dark', (v) => import('../main.js').then((m) => m.setTheme(v)))),
      h('div.form-row', h('div', h('b', 'Designs folder'), h('div', folder)), btn('Change…', async () => { const f = await window.ro2.designs.chooseFolder(); if (f) { folder.textContent = f; toast('New designs are saved there.'); app.emit('home-refresh'); } }, { cls: 'sm' })),
      h('div.form-row', h('div', h('b', 'Snap to guides'), h('div.small.muted', 'Line things up with the page and each other as you drag. Hold ⌘/Ctrl to move freely.')), toggle('', s.snap !== false, (v) => { s.snap = v; window.ro2.settings.set({ snap: v }); if (app.editor) app.editor.snap = v; })),
      h('div.form-row', h('div', h('b', 'AI models'), h('div.small.muted', 'Download or remove the background remover, eraser and selection models.')), btn('Manage', () => { m.close(); if (app.view === 'editor') openPanel('ai'); else toast('Open a design, then AI tools.', { type: 'info' }); }, { cls: 'sm' })),
      h('div.sec', h('h4', 'Keyboard shortcuts')),
      h('div.kbd-list', ...[
        ['Undo / redo', `${MOD}Z / ${MOD}⇧Z`], ['Duplicate', `${MOD}D`], ['Copy / paste', `${MOD}C / ${MOD}V`], ['Group / ungroup', `${MOD}G / ${MOD}⇧G`], ['Bring forward / send back', `${MOD}] / ${MOD}[`],
        ['Bold / italic / underline', `${MOD}B / I / U`], ['Add text', 'T'], ['Add rectangle / circle / line', 'R / O / L'], ['Nudge', 'Arrows (⇧ for 10px)'], ['Zoom', `${MOD}+ / ${MOD}− / ${MOD}0 fit`], ['Pan', 'Space + drag, or scroll'], ['Export', `${MOD}E`], ['Copy page as PNG', `${MOD}⇧C`],
      ].flatMap(([a, b]) => [h('span', a), h('kbd', b)])),
      h('p.tiny.dim', { style: { marginTop: '16px', lineHeight: 1.5 } }, `RO2 ${info.version}. Uses fabric.js (MIT), ONNX Runtime Web (MIT), Lucide icons (ISC), fonts under the SIL Open Font License, Openverse for free photos, and the ORMBG, IS-Net, LaMa and SlimSAM models (Apache 2.0).`),
    ],
    foot: [btn('Done', () => m.close(), { cls: 'primary' })],
  });
}

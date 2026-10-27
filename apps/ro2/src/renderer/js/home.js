// Home: start something new (size, template, photo) or pick up a recent design.
import { h, ico, menu, promptBox, confirmBox, toastErr, esc } from './ui.js';
import { app, newDesign, openFile, quickPhoto } from './app.js';
import { QUICK_SIZES } from './sizes.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { fabric } from './editor/fab.js';
import { makeGradient } from './editor/editor.js';

const tcache = new Map();
export async function thumbOfTemplate(t) {
  if (tcache.has(t.id)) return tcache.get(t.id);
  const p = (async () => {
    const k = 320 / Math.max(t.w, t.h); const el = document.createElement('canvas');
    const sc = new fabric.StaticCanvas(el, { width: t.w, height: t.h, enableRetinaScaling: false, renderOnAddRemove: false });
    const bg = new fabric.Rect({ left: t.w / 2, top: t.h / 2, width: t.w, height: t.h, strokeWidth: 0, fill: t.bg.gradient ? makeGradient(t.bg.gradient) : t.bg.color });
    sc.add(bg, ...(await buildTemplate(t)));
    const url = sc.toCanvasElement(k).toDataURL('image/webp', 0.85); sc.dispose(); return url;
  })();
  tcache.set(t.id, p); return p;
}
const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'Just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`; return new Date(t).toLocaleDateString(); };

export async function renderHome() {
  const root = document.getElementById('home'); root.innerHTML = '';
  const wrap = h('div.home-wrap'); root.append(wrap);
  const hero = h('div.hero',
    h('h1', 'What will you make today?'),
    h('p', 'Quick, simple designs and photo edits. RO3 is there when you need the heavy tools.'),
    h('div.hero-actions',
      h('button.btn.primary.lg', { html: ico('plus') + '<span>New design</span>', on: { click: () => import('./modals/new.js').then((m) => m.openNew()) } }),
      h('button.btn.lg', { html: ico('image') + '<span>Edit a photo</span>', on: { click: () => quickPhoto(null) } }),
      h('button.btn.lg.ghost', { html: ico('folder-open') + '<span>Open design…</span>', on: { click: async () => { const f = await window.ro2.designs.openDialog(); if (f) openFile(f); } } })),
    h('div.quick',
      qcard('scissors', 'Remove a background', 'One click cut-outs', () => quickPhoto('removebg')),
      qcard('eraser', 'Magic eraser', 'Make anything disappear', () => quickPhoto('erase')),
      qcard('hand-grab', 'Magic grab', 'Move things inside a photo', () => quickPhoto('grab')),
      qcard('expand', 'Magic expand', 'Grow a photo past its edges', () => quickPhoto('expand'))));
  wrap.append(hero);
  // sizes
  wrap.append(h('div.home-h', h('h2', 'Start with a size'), h('a', { on: { click: () => import('./modals/new.js').then((m) => m.openNew()) } }, 'All sizes & custom')));
  const pr = h('div.presets'); wrap.append(pr);
  for (const [name, w, hh] of QUICK_SIZES) {
    const k = 64 / Math.max(w, hh);
    pr.append(h('div.preset', { on: { click: () => newDesign(w, hh, name) } }, h('div.pv', h('i', { style: { width: w * k + 'px', height: hh * k + 'px' } })), h('b', name), h('span', `${w} × ${hh}`)));
  }
  // templates
  wrap.append(h('div.home-h', h('h2', 'Templates')));
  const tg = h('div.templates-row'); wrap.append(tg);
  for (const t of TEMPLATES) {
    const im = h('img');
    tg.append(h('div.tcard', { on: { click: () => newDesign(t.w, t.h, t.name, { template: t }) } }, h('div.th', im), h('b', t.name), h('span', `${t.tag} · ${t.w} × ${t.h}`)));
    thumbOfTemplate(t).then((u) => { im.src = u; }).catch(() => {});
  }
  // recent
  wrap.append(h('div.home-h', h('h2', 'Your designs'), h('a', { on: { click: async () => { const i = await window.ro2.info(); window.ro2.shell.reveal(i.designsFolder); } } }, 'Show folder')));
  const grid = h('div.designs'); wrap.append(grid);
  let list = [];
  try { list = await window.ro2.designs.list(); } catch (e) { toastErr(e); }
  if (!list.length) grid.replaceWith(h('div.empty', 'Designs you make are saved automatically and show up here.'));
  for (const d of list) {
    const more = h('button.btn.icon.sm.more', { html: ico('ellipsis'), on: { click: (e) => { e.stopPropagation(); menu(more, [
      { label: 'Open', icon: 'square-arrow-out-up-right', run: () => openFile(d.file) },
      { label: 'Rename', icon: 'pencil', run: async () => { const n = await promptBox('Rename design', d.name); if (n) { await window.ro2.designs.rename(d.file, n); renderHome(); } } },
      { label: 'Duplicate', icon: 'copy', run: async () => { await window.ro2.designs.duplicate(d.file); renderHome(); } },
      { label: 'Show in folder', icon: 'folder', run: () => window.ro2.shell.reveal(d.file) },
      '-', { label: 'Move to Trash', icon: 'trash-2', danger: true, run: async () => { if (await confirmBox('Move to Trash?', `“${d.name}” goes to the Trash; you can restore it from there.`, 'Move to Trash', true)) { await window.ro2.designs.remove(d.file); renderHome(); } } },
    ]); } } });
    const card = h('div.dcard', { on: { click: () => openFile(d.file), contextmenu: (e) => { e.preventDefault(); more.click(); } } },
      h('div.th', d.thumb ? h('img', { src: d.thumb }) : h('span.dim', { html: ico('image') })), more,
      h('div.meta', h('b', d.name), h('span', `${d.w || '?'} × ${d.h || '?'}${d.pages > 1 ? ` · ${d.pages} pages` : ''} · ${ago(d.updated)}`)));
    grid.append(card);
  }
}
function qcard(icon, title, text, fn) { return h('div.quick-card', { on: { click: fn } }, h('div.qi', { html: ico(icon) }), h('div', h('b', title), h('span', text))); }
export { esc };

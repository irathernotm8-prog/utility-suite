// Photos (free Openverse library) and Uploads (your own pictures).
import { h, ico, busy, toastErr, toast, esc, debounce } from '../ui.js';
import { app, ensureEditor, addImage, addFiles, fillFrame } from '../app.js';
import { register } from '../drawer.js';
import { draggable } from './elements.js';
import { fabric } from '../editor/fab.js';

const SUGGEST = ['Nature', 'Business', 'Technology', 'Office', 'City', 'People', 'Food', 'Sky', 'Abstract', 'Texture', 'Mountains', 'Ocean', 'Coffee', 'Houston', 'Football', 'Flowers', 'Network', 'Family', 'Workspace', 'Gradient'];
let state = { q: '', kind: 'photo', page: 1, results: [], pages: 1, loading: false, scroll: 0 };

export async function addLibraryPhoto(p, at) {
  const b = busy('Adding photo…');
  try {
    const url = await window.ro2.library.fetch(p.url).catch(() => window.ro2.library.fetch(p.thumb));
    const credit = { title: p.title, creator: p.creator, license: p.license, url: p.page, source: p.source };
    const ed = ensureEditor();
    const frame = at && ed.canvas.getObjects().slice().reverse().find((o) => o instanceof fabric.FabricImage && o.ro2Frame && o.containsPoint(new fabric.Point(at.x, at.y)));
    if (frame) await fillFrame(frame, url, { name: p.title || 'Photo', credit });
    else await addImage(url, { name: p.title || 'Photo', credit, at });
    if (p.license && !/CC0|PDM|public domain/i.test(p.license)) toast(`${p.license}: credit “${p.creator || p.source}” when you share this.`, { type: 'info', ms: 4500 });
  } catch (e) { toastErr(e); } finally { b.close(); }
}

register('photos', {
  label: 'Photos', icon: 'image',
  render(root) {
    const search = h('input.input', { placeholder: 'Search millions of free photos', value: state.q, on: { keydown: (e) => { if (e.key === 'Enter') go(search.value.trim()); } } });
    const kinds = h('div.chips');
    const kindBtn = (k, label) => h('button.chip' + (state.kind === k ? '.on' : ''), { on: { click: () => { state.kind = k; kinds.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.textContent === label)); if (state.q) go(state.q); } } }, label);
    kinds.append(kindBtn('photo', 'Photos'), kindBtn('illustration', 'Illustrations & art'));
    root.append(h('div.p-title', 'Photos'), h('div.search', { html: ico('search') }, search), kinds);
    const chips = h('div.chips'); for (const s of SUGGEST) chips.append(h('button.chip', { on: { click: () => { search.value = s; go(s); } } }, s));
    const grid = h('div.masonry'); const status = h('p.small.muted'); const more = h('button.btn.sm.block', { style: { marginTop: '8px', display: 'none' }, on: { click: () => load(state.page + 1) } }, 'Load more');
    root.append(chips, status, grid, more, h('p.tiny.dim', { style: { marginTop: '14px', lineHeight: 1.5 } }, 'Free, openly licensed photos from Wikimedia Commons and Openverse (public domain, CC0, CC BY and CC BY-SA). Some ask for a credit; RO2 tells you when you add one and keeps it in the photo’s details (the ⓘ button).'));
    const render = () => {
      grid.innerHTML = '';
      for (const p of state.results) {
        const im = h('img', { src: p.thumb, loading: 'lazy', alt: p.title || '', referrerpolicy: 'no-referrer' }); im.onerror = () => tile.remove();
        const tile = draggable(h('div.ph', im, h('div.cap', `${p.title || 'Photo'}${p.creator ? ' · ' + p.creator : ''}`)), { kind: 'photo', photo: p });
        if (p.w && p.h) im.style.aspectRatio = `${p.w} / ${p.h}`;
        grid.append(tile);
      }
      more.style.display = state.page < state.pages && state.results.length ? '' : 'none';
    };
    const load = async (page) => {
      if (state.loading) return; state.loading = true; status.textContent = 'Searching…';
      try {
        const r = await window.ro2.library.search({ q: state.q, page, kind: state.kind });
        state.page = page; state.pages = r.pages || 1; state.results = page === 1 ? r.results : state.results.concat(r.results);
        status.textContent = state.results.length ? '' : `No free photos found for “${state.q}”.`;
        render();
      } catch (e) { status.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
      finally { state.loading = false; }
    };
    const go = (q) => { if (!q) return; state.q = q; state.results = []; load(1); };
    if (state.results.length) render(); else if (!state.q) go('Nature');
  },
});

register('uploads', {
  label: 'Uploads', icon: 'cloud-upload',
  render(root) {
    root.append(h('div.p-title', 'Uploads'));
    const zone = h('div.drop-zone', { html: ico('image-up') + '<div><b>Upload photos or graphics</b></div><div class="small">or drag them anywhere onto the page</div><div class="tiny dim" style="margin-top:6px">JPG, PNG, WebP, GIF, SVG, HEIC, TIFF, AVIF</div>' });
    zone.onclick = async () => { const files = await window.ro2.files.openImages({}); for (const f of files) { if (f.error) toastErr(f.error); else await addImage(f.dataUrl, { name: f.name, svg: f.svg }); } };
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); }; zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
    root.append(zone);
    root.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
      h('button.btn.sm', { html: ico('clipboard-paste') + '<span>Paste from clipboard</span>', on: { click: async () => { const u = await window.ro2.clipboard.readImage(); if (u) addImage(u, { name: 'Pasted image' }); else toast('There is no picture on the clipboard.', { type: 'info' }); } } })));
    const ed = app.editor; if (!ed) return;
    // every picture already in this design, to reuse
    const seen = new Set(); const items = [];
    for (const [id, url] of ed.assets) { if (seen.has(url) || !url.startsWith('data:image')) continue; seen.add(url); items.push([id, url]); }
    root.append(h('div.sec', h('h4', `In this design (${items.length})`)));
    if (!items.length) root.append(h('p.small.dim', 'Pictures you add show up here so you can use them again.'));
    const g = h('div.tiles.c3'); for (const [id, url] of items.reverse()) g.append(draggable(h('button.tile', h('img', { src: url })), { kind: 'asset', id, name: 'Photo' })); root.append(g);
  },
});
export { esc, debounce };

'use strict';
/* Fresh Desk — explorer. Tidy lives in tidy.js and plugs in through window.Tidy. */
const $ = id => document.getElementById(id);
const {el, bytes, when, longDate} = U;
const {I} = Icons;
const ROW_H = 28;

const S = {
  env: null, prefs: null, places: {favorites: [], volumes: []},
  tabs: [], active: 0, clip: null, renaming: null, cache: new Map(),
  thumbs: new Map(), launchers: {terminals: [], editors: []}, nextId: 1, typeahead: '', typeTimer: 0, disk: null,
};
const isMac = () => S.env.platform === 'darwin';
const isWin = () => S.env.platform === 'win32';
const sep = () => S.env.sep;
const tab = () => S.tabs[S.active];
const mod = e => isMac() ? e.metaKey : e.ctrlKey;
const editable = n => n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
const short = combo => isMac() ? combo : combo.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/⌃/g, 'Ctrl+').replace(/⌫/g, 'Del');

function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(n => { if (!n.firstChild) n.innerHTML = I[n.dataset.icon] || ''; }); }

// ---------------------------------------------------------------- tabs & navigation
function newTab(path, {activate = true} = {}) {
  const t = {id: S.nextId++, path, back: [], fwd: [], listing: null, error: null, items: [], sel: new Set(), anchor: null, cursor: null, scrollTop: 0,
    search: {q: '', deep: false, results: null, running: false, id: null, summary: null}, loading: false};
  S.tabs.push(t);
  if (activate) S.active = S.tabs.length - 1;
  load(t);
  return t;
}
function closeTab(i = S.active) {
  if (S.tabs.length === 1) return;
  S.tabs.splice(i, 1);
  if (S.active >= S.tabs.length) S.active = S.tabs.length - 1;
  else if (i < S.active) S.active--;
  render(); savePrefsSoon();
}
function switchTab(i) { if (i < 0 || i >= S.tabs.length) return; S.active = i; if (window.Tidy?.isOpen()) Tidy.close(); render(); savePrefsSoon(); }

async function navigate(path, {push = true, select = null, newTab: inNew = false} = {}) {
  if (!path) return;
  if (inNew) { const t = newTab(path); if (select) t.pendingSelect = select; render(); return; }
  const t = tab();
  if (window.Tidy?.isOpen()) Tidy.close();
  if (push && t.path !== path) { t.back.push(t.path); t.fwd = []; }
  t.path = path; t.sel = new Set(); t.cursor = null; t.anchor = null; t.scrollTop = 0; t.pendingSelect = select;
  clearSearch(t, false);
  await load(t);
}
function back() { const t = tab(); if (!t.back.length) return; t.fwd.push(t.path); navigate(t.back.pop(), {push: false}); }
function forward() { const t = tab(); if (!t.fwd.length) return; t.back.push(t.path); navigate(t.fwd.pop(), {push: false}); }
function up() { const t = tab(); const p = t.listing?.parent ?? (t.path !== U.dirname(t.path, sep()) ? U.dirname(t.path, sep()) : null); if (p) navigate(p, {select: t.path}); }

async function list(path) {
  const r = await desk.list(path, {hidden: S.prefs.showHidden});
  S.cache.set(path, r);
  return r;
}
async function load(t, {keep = false} = {}) {
  t.loading = true;
  const wanted = t.path;
  try {
    const r = await list(wanted);
    if (t.path !== wanted) return;
    t.listing = r; t.error = null;
    if (keep) { const names = new Set(r.entries.map(e => e.path)); t.sel = new Set([...t.sel].filter(p => names.has(p))); if (t.cursor && !names.has(t.cursor)) t.cursor = null; }
  } catch (e) {
    if (t.path !== wanted) return;
    t.listing = null; t.error = e.message.replace(/^Error invoking remote method '\w+': (Error: )?/, '');
  } finally { t.loading = false; }
  if (t.pendingSelect) { const p = t.pendingSelect; t.pendingSelect = null; if (t.listing?.entries.some(e => e.path === p)) { t.sel = new Set([p]); t.cursor = t.anchor = p; t.scrollTo = p; } }
  refreshItems(t);
  if (t === tab()) { addRecent(t.path); render(); watchVisible(); diskSpace(); sizeFolders(t); }
  else renderTabs();
  savePrefsSoon();
}
async function reload(keep = true) { for (const t of S.tabs) if (t.listing || t.error) await load(t, {keep}); }

function addRecent(p) {
  if (S.prefs.showRecents === false) return;
  const r = S.prefs.recents.filter(x => x !== p); r.unshift(p);
  S.prefs.recents = r.slice(0, 12);
}

// ---------------------------------------------------------------- items, search, sort
function refreshItems(t) {
  const q = t.search.q.trim().toLowerCase();
  let items;
  if (t.search.deep && t.search.results) items = t.search.results.slice();
  else {
    items = (t.listing?.entries || []).slice();
    if (q) { const words = q.split(/\s+/); items = items.filter(e => words.every(w => e.name.toLowerCase().includes(w))); }
  }
  if (S.prefs.folderSizes && S.prefs.sort.key === 'size') items = items.map(e => e.isDir && S.dirSizes.get(e.path)?.bytes != null ? {...e, size: S.dirSizes.get(e.path).bytes, sizeIsDir: true} : e);
  items.sort(U.compareEntries(S.prefs.sort, S.prefs.foldersFirst));
  t.items = items;
}
function clearSearch(t = tab(), rerender = true) {
  if (t.search.id) desk.cancel(t.search.id);
  t.search = {q: '', deep: t.search.deep, results: null, running: false, id: null, summary: null};
  if (t === tab()) $('search').value = '';
  refreshItems(t);
  if (rerender) render();
}
const runFilter = U.debounce(() => { const t = tab(); if (t.search.deep) startDeepSearch(); else { refreshItems(t); renderContent(); renderStatus(); } }, 90);
async function startDeepSearch() {
  const t = tab(); const q = t.search.q.trim();
  if (t.search.id) desk.cancel(t.search.id);
  if (!q) { t.search.results = null; t.search.running = false; refreshItems(t); render(); return; }
  const id = `s${Date.now()}${Math.random()}`;
  Object.assign(t.search, {id, results: [], running: true, summary: null});
  refreshItems(t); render();
  try {
    const summary = await desk.search(t.path, q, id, {hidden: S.prefs.showHidden});
    if (t.search.id !== id) return;
    t.search.running = false; t.search.summary = summary;
  } catch (e) { if (t.search.id === id) { t.search.running = false; toast(e.message); } }
  if (t === tab()) renderStatus();
}
const flushSearch = U.debounce(() => { const t = tab(); refreshItems(t); renderContent(); renderStatus(); }, 60);
desk.on('search-batch', (id, batch) => {
  const t = S.tabs.find(x => x.search.id === id); if (!t) return;
  t.search.results.push(...batch);
  if (t === tab()) flushSearch();
});

// ---------------------------------------------------------------- rendering
function render() {
  document.body.classList.toggle('tidy-open', !!window.Tidy?.isOpen());
  renderPlaces(); renderToolbar(); renderTabs(); renderContent(); renderStatus(); renderPreviewSoon();
}

function placeItem(p, {icon, name, kind, color}) {
  const active = tab()?.path === p;
  const ic = el('span', {class: 'ic', html: (Glyphs.G[icon] || I[icon] || I.folder)});
  if (color && color !== 'accent') ic.style.color = color;
  const item = el('button', {class: 'place' + (active ? ' active' : ''), title: p, dataset: {path: p, kind},
    onclick: e => navigate(p, {newTab: mod(e)}),
    oncontextmenu: async e => { e.preventDefault(); placeMenu(p, kind, {name, icon}); }},
  ic, el('span', {class: 'place-name', text: name}));
  dropTarget(item, () => p);
  if (kind === 'fav') {
    // Drag favorites up and down to reorder them.
    item.draggable = true;
    item.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-fd-place', p); e.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('application/x-fd-place')) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const r = item.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      item.classList.toggle('ins-after', after); item.classList.toggle('ins-before', !after);
    });
    item.addEventListener('dragleave', () => item.classList.remove('ins-after', 'ins-before'));
    item.addEventListener('drop', e => {
      const from = e.dataTransfer.getData('application/x-fd-place');
      if (!from) return;
      e.preventDefault(); e.stopPropagation();
      const after = item.classList.contains('ins-after');
      item.classList.remove('ins-after', 'ins-before');
      moveFavorite(from, p, after);
    });
  }
  return item;
}
function favorites() {
  const unpinned = new Set(S.prefs.unpinned);
  const metaOf = p => S.prefs.favMeta?.[p] || {};
  const list = [...S.places.favorites.filter(f => !unpinned.has(f.path)), ...S.prefs.pins.map(p => ({name: U.basename(p) || p, path: p, icon: 'folder'}))]
    .map(f => { const m = metaOf(f.path); return {...f, baseName: f.name, baseIcon: f.icon, name: m.name || f.name, icon: m.icon || f.icon, color: m.color}; });
  const order = S.prefs.favOrder || [];
  const rank = p => { const i = order.indexOf(p); return i < 0 ? 1e6 : i; };
  return list.map((f, i) => ({f, i})).sort((a, b) => rank(a.f.path) - rank(b.f.path) || a.i - b.i).map(x => x.f);
}
function moveFavorite(from, to, after) {
  const paths = favorites().map(f => f.path).filter(p => p !== from);
  let i = paths.indexOf(to); if (i < 0) i = paths.length - 1;
  paths.splice(after ? i + 1 : i, 0, from);
  S.prefs.favOrder = paths;
  renderPlaces(); savePrefsSoon();
}
function renderPlaces() {
  const nav = $('places'); nav.replaceChildren();
  const section = (title, key, items, kind) => {
    const collapsed = (S.prefs.collapsed || []).includes(key);
    const head = el('button', {class: 'place-head', 'aria-expanded': String(!collapsed), onclick: () => { const c = new Set(S.prefs.collapsed || []); c.has(key) ? c.delete(key) : c.add(key); S.prefs.collapsed = [...c]; renderPlaces(); }}, title, el('span', {class: 'ic', html: I.chevronDown}));
    const box = el('div', {class: 'place-list' + (collapsed ? ' collapsed' : '')}, items.map(f => placeItem(f.path, {...f, kind})));
    nav.append(el('div', {class: 'place-section'}, head, box));
    return box;
  };
  const favs = favorites();
  const favBox = section('Favorites', 'fav', favs, 'fav');
  // Drop a folder on the Favorites list to pin it.
  favBox.addEventListener('dragover', e => { if (e.target === favBox && e.dataTransfer.types.includes('Files')) { e.preventDefault(); favBox.classList.add('drop'); } });
  favBox.addEventListener('dragleave', () => favBox.classList.remove('drop'));
  favBox.addEventListener('drop', e => { if (e.target !== favBox) return; e.preventDefault(); favBox.classList.remove('drop'); for (const f of e.dataTransfer.files) { const p = desk.pathForFile(f); if (p) pin(p); } });
  const favSet = new Set(favs.map(f => f.path));
  const recents = S.prefs.recents.filter(p => !favSet.has(p) && p !== S.env.home).slice(0, 5).map(p => ({name: U.basename(p) || p, path: p, icon: 'clock'}));
  if (recents.length && S.prefs.showRecents !== false) section('Recent', 'recent', recents, 'recent');
  section('Locations', 'loc', S.places.volumes, 'vol');
}
async function placeMenu(p, kind, info = {}) {
  const items = [{id: 'open', label: 'Open'}, {id: 'tab', label: 'Open in New Tab'}, {id: 'term', label: 'Open in Terminal'}, {type: 'separator'}];
  if (kind === 'fav') {
    const list = favorites(), i = list.findIndex(f => f.path === p);
    items.push({id: 'edit', label: 'Change Icon & Name…'}, {id: 'mvUp', label: 'Move Up', enabled: i > 0}, {id: 'mvDown', label: 'Move Down', enabled: i < list.length - 1}, {type: 'separator'}, {id: 'remove', label: 'Remove from Sidebar'});
  }
  if (kind === 'recent') items.push({id: 'pin', label: 'Add to Favorites…'}, {id: 'forget', label: 'Remove from Recent'}, {type: 'separator'}, {id: 'hideRecents', label: 'Hide Recent Folders'});
  if (kind === 'vol') items.push({id: 'pin', label: 'Add to Favorites…'});
  const id = await desk.menu(items);
  if (id === 'open') navigate(p); else if (id === 'tab') navigate(p, {newTab: true}); else if (id === 'term') desk.terminal(p).catch(err);
  else if (id === 'edit') { const f = favorites().find(x => x.path === p); Extras.editFavorite(p, {baseName: f?.baseName, baseIcon: f?.baseIcon}); }
  else if (id === 'mvUp' || id === 'mvDown') { const list = favorites(), i = list.findIndex(f => f.path === p), j = id === 'mvUp' ? i - 1 : i + 1; if (list[j]) moveFavorite(p, list[j].path, id === 'mvDown'); }
  else if (id === 'remove') { if (S.prefs.pins.includes(p)) S.prefs.pins = S.prefs.pins.filter(x => x !== p); else S.prefs.unpinned = [...new Set([...S.prefs.unpinned, p])]; const m = {...S.prefs.favMeta}; delete m[p]; S.prefs.favMeta = m; renderPlaces(); savePrefsSoon(); }
  else if (id === 'pin') pin(p);
  else if (id === 'hideRecents') setRecents(false);
  else if (id === 'forget') { S.prefs.recents = S.prefs.recents.filter(x => x !== p); renderPlaces(); savePrefsSoon(); }
}
function setRecents(on) {
  S.prefs.showRecents = on;
  if (!on) S.prefs.recents = []; else addRecent(tab().path);
  renderPlaces(); savePrefsSoon();
  toast(on ? 'Recent folders are back in the sidebar' : 'Recent folders hidden and cleared — turn them back on in Settings');
}
// Adding a favorite opens the editor so it gets a name, icon and color right away.
function pin(p) {
  if (favorites().some(f => f.path === p)) { toast(`“${U.basename(p)}” is already a favorite`); return; }
  Extras.editFavorite(p, {adding: true});
}
function pinPath(p) {
  if (S.places.favorites.some(f => f.path === p)) S.prefs.unpinned = S.prefs.unpinned.filter(x => x !== p);
  else if (!S.prefs.pins.includes(p)) S.prefs.pins.push(p);
  renderPlaces(); savePrefsSoon();
}

function crumbsFor(p) {
  const s = sep(); const out = [];
  if (s === '\\') {
    const parts = p.split('\\').filter(Boolean); let acc = '';
    parts.forEach((part, i) => { acc = i === 0 ? part + '\\' : U.join(acc, part, s); out.push({name: i === 0 ? part : part, path: acc}); });
  } else {
    const home = S.env.home;
    let start = '/', parts;
    if (p === home || p.startsWith(home + '/')) { out.push({name: U.basename(home), path: home, home: true}); start = home; parts = p.slice(home.length).split('/').filter(Boolean); }
    else { out.push({name: isMac() ? 'Macintosh HD' : '/', path: '/'}); parts = p.split('/').filter(Boolean); }
    let acc = start;
    for (const part of parts) { acc = U.join(acc, part, '/'); out.push({name: part, path: acc}); }
  }
  return out;
}
function renderToolbar() {
  const t = tab();
  $('back').disabled = !t.back.length; $('forward').disabled = !t.fwd.length;
  const c = $('crumbs'); c.replaceChildren();
  const crumbs = crumbsFor(t.path);
  // Long paths collapse the middle so the current folder always shows.
  const shown = crumbs.length > 5 ? [crumbs[0], {ellipsis: true, items: crumbs.slice(1, -3)}, ...crumbs.slice(-3)] : crumbs;
  shown.forEach((cr, i) => {
    if (i) c.append(el('span', {class: 'crumb-sep', html: I.chevron}));
    if (cr.ellipsis) { c.append(el('button', {class: 'crumb', text: '…', title: 'Show hidden path parts', onclick: async () => { const id = await desk.menu(cr.items.map(x => ({id: x.path, label: x.name}))); if (id) navigate(id); }})); return; }
    const last = i === shown.length - 1;
    const b = el('button', {class: 'crumb' + (last ? ' current' : ''), title: cr.path, onclick: e => last ? editPath() : navigate(cr.path, {newTab: mod(e)})},
      cr.home ? el('span', {class: 'ic', html: I.home}) : null, el('span', {text: cr.name}));
    dropTarget(b, () => cr.path);
    c.append(b);
  });
  c.onclick = e => { if (e.target === c) editPath(); };
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === S.prefs.view);
  $('tbPreview').classList.toggle('on', S.prefs.showPreview);
  document.body.classList.toggle('no-preview', !S.prefs.showPreview);
  if (document.activeElement !== $('search')) $('search').value = t.search.q;
  $('deepToggle').textContent = t.search.deep ? 'Subfolders' : 'This folder';
  $('deepToggle').classList.toggle('on', t.search.deep);
  document.title = `${U.basename(t.path) || t.path} — Fresh Desk`;
}
function editPath() {
  const input = $('pathInput');
  $('crumbs').hidden = true; input.hidden = false; input.value = tab().path; input.focus(); input.select();
}
function endEditPath() { $('pathInput').hidden = true; $('crumbs').hidden = false; }

function renderTabs() {
  const box = $('tabs');
  box.hidden = S.tabs.length < 2;
  document.body.classList.toggle('has-tabs', S.tabs.length > 1);
  if (box.hidden) return;
  box.replaceChildren(...S.tabs.map((t, i) => {
    const b = el('div', {class: 'tab' + (i === S.active ? ' active' : ''), role: 'tab', 'aria-selected': String(i === S.active), title: t.path, onclick: () => switchTab(i), onauxclick: e => { if (e.button === 1) closeTab(i); }},
      el('span', {class: 'tab-ic', html: Icons.folderIcon(14)}), el('span', {class: 'tab-name', text: U.basename(t.path) || t.path}),
      el('button', {class: 'tab-close', 'aria-label': 'Close tab', html: I.close, onclick: e => { e.stopPropagation(); closeTab(i); }}));
    dropTarget(b, () => t.path);
    return b;
  }), el('button', {class: 'tab-add', title: 'New tab', 'aria-label': 'New tab', html: I.plus, onclick: () => { newTab(tab().path); render(); }}));
}

// ---------- content views
function renderContent() {
  const t = tab(), root = $('content');
  root.dataset.view = S.prefs.view;
  if (t.error) {
    const perm = /EACCES|EPERM|permission|not permitted/i.test(t.error);
    root.replaceChildren(el('div', {class: 'empty'}, el('div', {class: 'empty-ic', html: I.warn}), el('h3', {text: perm ? 'Fresh Desk can’t open this folder' : 'This folder isn’t available'}),
      el('p', {text: perm && isMac() ? 'macOS needs your OK first. Open System Settings → Privacy & Security → Files and Folders (or Full Disk Access) and allow Fresh Desk.' : t.error}),
      el('button', {class: 'btn', text: 'Try again', onclick: () => load(t)})));
    return;
  }
  if (!t.listing && t.loading) { root.replaceChildren(el('div', {class: 'empty subtle'}, el('p', {text: 'Loading…'}))); return; }
  if (S.prefs.view === 'columns' && !(t.search.q && t.search.deep)) return renderColumns(root, t);
  if (S.prefs.view === 'grid') return renderGrid(root, t);
  return renderList(root, t);
}
function emptyState(t) {
  if (t.search.q) return el('div', {class: 'empty'}, el('div', {class: 'empty-ic', html: I.search}), el('h3', {text: t.search.running ? 'Searching…' : 'No matches'}), el('p', {text: t.search.deep ? `Nothing named like “${t.search.q}” in this folder or its subfolders.` : `Nothing here matches “${t.search.q}”. Press Return to search subfolders too.`}));
  return el('div', {class: 'empty'}, el('div', {class: 'empty-ic folder', html: Icons.folderIcon(56)}), el('h3', {text: 'This folder is empty'}), el('p', {text: t.listing?.hiddenCount ? `${t.listing.hiddenCount} hidden item${t.listing.hiddenCount > 1 ? 's' : ''} — ${short('⌘⇧.')} shows them.` : 'Drop files here, or press ' + short('⌘⇧N') + ' for a new folder.'}));
}
function iconFor(e, size) {
  const span = el('span', {class: 'fi', html: Icons.fileIcon(e, size)});
  if (e.kind === 'Application' || (e.ext === 'exe' && isWin())) {
    desk.icon(e.path, size > 32 ? 'large' : 'normal').then(src => { if (src) span.replaceChildren(el('img', {src, alt: '', draggable: 'false'})); });
  }
  return span;
}
const SORTS = [['name', 'Name'], ['mtime', 'Date Modified'], ['size', 'Size'], ['kind', 'Kind']];
function renderList(root, t) {
  const deep = t.search.deep && t.search.q;
  const head = el('div', {class: 'list-head' + (deep ? ' deep' : '')}, SORTS.map(([key, label]) => {
    const on = S.prefs.sort.key === key;
    return el('button', {class: 'col-' + key + (on ? ' on' : ''), onclick: () => { S.prefs.sort = {key, dir: on ? -S.prefs.sort.dir : (key === 'name' || key === 'kind' ? 1 : -1)}; for (const x of S.tabs) refreshItems(x); renderContent(); savePrefsSoon(); }},
      deep && key === 'kind' ? 'Where' : label, on ? el('span', {class: 'sort-dir', html: S.prefs.sort.dir === 1 ? I.chevronDown : I.chevronDown}) : null);
  }));
  head.querySelector('.on .sort-dir')?.classList.toggle('flip', S.prefs.sort.dir === -1);
  const spacer = el('div', {class: 'spacer'});
  const rows = el('div', {class: 'rows'});
  const scroller = el('div', {class: 'scroller'}, spacer, rows);
  root.replaceChildren(el('div', {class: 'list' + (deep ? ' deep' : '')}, head, scroller));
  if (!t.items.length) { scroller.append(emptyState(t)); bindArea(scroller, t); return; }
  spacer.style.height = `${t.items.length * ROW_H + 8}px`;
  const paint = () => {
    const top = scroller.scrollTop, h = scroller.clientHeight || 600;
    const start = Math.max(0, Math.floor(top / ROW_H) - 8), end = Math.min(t.items.length, Math.ceil((top + h) / ROW_H) + 8);
    rows.style.transform = `translateY(${start * ROW_H}px)`;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) frag.append(listRow(t, t.items[i], i, deep));
    rows.replaceChildren(frag);
    t.scrollTop = top;
  };
  scroller.addEventListener('scroll', () => requestAnimationFrame(paint), {passive: true});
  bindArea(scroller, t);
  scroller.scrollTop = t.scrollTop;
  paint();
  if (t.scrollTo) { scrollIntoView(t, t.scrollTo); t.scrollTo = null; }
}
function listRow(t, e, i, deep) {
  const sel = t.sel.has(e.path);
  const row = el('div', {class: 'row' + (sel ? ' sel' : '') + (t.cursor === e.path ? ' cursor' : '') + (S.clip?.mode === 'cut' && S.clip.paths.includes(e.path) ? ' cut' : '') + (e.hidden ? ' hidden-file' : ''), dataset: {i}, role: 'row', 'aria-selected': String(sel)});
  const name = el('div', {class: 'c-name'}, el('span', {class: 'grab', draggable: 'true'}, iconFor(e, 18), S.renaming === e.path ? null : el('span', {class: 'nm', text: e.name})));
  if (S.renaming === e.path) name.append(renameInput(e));
  if (e.isLink) name.append(el('span', {class: 'badge', text: 'alias'}));
  row.append(name,
    el('div', {class: 'c-date', text: when(e.mtime)}),
    el('div', {class: 'c-size', text: e.isDir ? dirSizeText(e) : bytes(e.size)}),
    el('div', {class: 'c-kind', text: deep ? relativeWhere(t, e) : e.kind}));
  if (e.isDir) dropTarget(row, () => e.path);
  return row;
}
// Folder sizes (optional): worked out a couple at a time for the folder on screen.
S.dirSizes = new Map();
function dirSizeText(e) {
  if (!S.prefs.folderSizes) return '—';
  const v = S.dirSizes.get(e.path);
  return v == null ? '…' : v.bytes == null ? '—' : bytes(v.bytes);
}
let sizeRun = 0;
async function sizeFolders(t) {
  if (!S.prefs.folderSizes || !t.listing) return;
  const run = ++sizeRun;
  for (const id of S.sizeJobs || []) desk.cancel(id);
  S.sizeJobs = new Set();
  const dirs = t.listing.entries.filter(e => e.isDir && !(S.dirSizes.get(e.path)?.mtime === e.mtime));
  const repaint = U.debounce(() => {
    if (tab() !== t) return;
    if (S.renaming) { document.querySelectorAll('#content .row').forEach(r => { const e = t.items[+r.dataset.i]; if (e?.isDir) r.querySelector('.c-size').textContent = dirSizeText(e); }); return; }
    refreshItems(t); renderContent();
  }, 250);
  const next = async () => {
    while (dirs.length && run === sizeRun) {
      const e = dirs.shift();
      const id = `ds${run}-${e.path}`;
      S.sizeJobs.add(id);
      try { const r = await desk.folderSize(e.path, id); S.dirSizes.set(e.path, {bytes: r.bytes, mtime: e.mtime}); } catch { S.dirSizes.set(e.path, {bytes: null, mtime: e.mtime}); }
      S.sizeJobs.delete(id);
      if (run !== sizeRun) return;
      if (S.dirSizes.size > 5000) S.dirSizes.delete(S.dirSizes.keys().next().value);
      repaint();
    }
  };
  await Promise.all([next(), next()]);
}
function relativeWhere(t, e) { const d = U.dirname(e.path, sep()); return d === t.path ? '—' : d.slice(t.path.length + 1) || d; }

function renderGrid(root, t) {
  const size = S.prefs.iconSize;
  const spacer = el('div', {class: 'spacer'}), rows = el('div', {class: 'grid-rows'});
  const scroller = el('div', {class: 'scroller grid'}, spacer, rows);
  root.replaceChildren(scroller);
  if (!t.items.length) { scroller.append(emptyState(t)); bindArea(scroller, t); return; }
  const tileW = size + 36, tileH = size + 52;
  const layout = () => { const w = scroller.clientWidth - 24 || 800; const cols = Math.max(1, Math.floor(w / tileW)); return {cols, rowsN: Math.ceil(t.items.length / cols)}; };
  const paint = () => {
    const {cols, rowsN} = layout(); t.gridCols = cols; t.grid = {cols, tileW, tileH};
    spacer.style.height = `${rowsN * tileH + 24}px`;
    const top = scroller.scrollTop, h = scroller.clientHeight || 600;
    const r0 = Math.max(0, Math.floor(top / tileH) - 2), r1 = Math.min(rowsN, Math.ceil((top + h) / tileH) + 2);
    rows.style.transform = `translateY(${r0 * tileH + 12}px)`;
    rows.style.gridTemplateColumns = `repeat(${cols}, ${tileW}px)`;
    const frag = document.createDocumentFragment();
    for (let i = r0 * cols; i < Math.min(t.items.length, r1 * cols); i++) frag.append(gridTile(t, t.items[i], i, size));
    rows.replaceChildren(frag);
    t.scrollTop = top;
  };
  scroller.addEventListener('scroll', () => requestAnimationFrame(paint), {passive: true});
  new ResizeObserver(() => requestAnimationFrame(paint)).observe(scroller);
  bindArea(scroller, t);
  scroller.scrollTop = t.scrollTop; paint();
  if (t.scrollTo) { scrollIntoView(t, t.scrollTo); t.scrollTo = null; }
}
const THUMB_KINDS = new Set(['Image', 'Video', 'PDF', 'Design', 'Presentation', 'Document', 'Spreadsheet', 'Font', 'Audio']);
function thumbFor(e, size) {
  const holder = el('span', {class: 'thumb'}, iconFor(e, Math.round(size * 0.82)));
  if (!e.isDir && THUMB_KINDS.has(e.kind) && (isMac() || isWin() || e.kind === 'Image')) {
    const key = `${e.path}|${e.mtime}|${size}`;
    const apply = src => { if (src) { holder.classList.add('has-img'); holder.replaceChildren(el('img', {src, alt: '', draggable: 'false', loading: 'lazy'})); } };
    if (S.thumbs.has(key)) apply(S.thumbs.get(key));
    else desk.thumb(e.path, Math.round(size * devicePixelRatio), e.mtime).then(src => { S.thumbs.set(key, src); if (S.thumbs.size > 1500) S.thumbs.delete(S.thumbs.keys().next().value); apply(src); }).catch(() => {});
  }
  return holder;
}
function gridTile(t, e, i, size) {
  const sel = t.sel.has(e.path);
  const tile = el('div', {class: 'tile' + (sel ? ' sel' : '') + (t.cursor === e.path ? ' cursor' : '') + (S.clip?.mode === 'cut' && S.clip.paths.includes(e.path) ? ' cut' : '') + (e.hidden ? ' hidden-file' : ''), dataset: {i}, draggable: S.renaming === e.path ? 'false' : 'true', 'aria-selected': String(sel)});
  const box = el('div', {class: 'tile-img'}, thumbFor(e, size)); box.style.height = `${size}px`;
  tile.append(box, S.renaming === e.path ? renameInput(e) : el('div', {class: 'tile-name', text: e.name}));
  if (e.isDir) dropTarget(tile, () => e.path);
  return tile;
}

// Column (Miller) view: one column per folder from the start of the path.
async function renderColumns(root, t) {
  const chain = crumbsFor(t.path).map(c => c.path);
  const wrap = el('div', {class: 'columns'});
  root.replaceChildren(wrap);
  const token = (root.colToken = (root.colToken || 0) + 1);
  const listings = [];
  for (let i = 0; i < chain.length - 1; i++) {
    let l = S.cache.get(chain[i]);
    if (!l) { try { l = await list(chain[i]); } catch { l = {path: chain[i], entries: []}; } }
    listings.push(l);
  }
  if (root.colToken !== token) return;
  listings.forEach((l, i) => {
    const entries = l.entries.slice().sort(U.compareEntries({key: 'name', dir: 1}, S.prefs.foldersFirst));
    const col = el('div', {class: 'col'}, entries.map(e => {
      const on = e.path === chain[i + 1];
      const r = el('div', {class: 'crow' + (on ? ' trail' : ''), title: e.name, onclick: ev => { if (e.isDir) navigate(e.path); else navigate(l.path, {select: e.path}); }, ondblclick: () => openEntry(e)},
        iconFor(e, 16), el('span', {class: 'nm', text: e.name}), e.isDir ? el('span', {class: 'ic chev', html: I.chevron}) : null);
      if (e.isDir) dropTarget(r, () => e.path);
      return r;
    }));
    wrap.append(col);
  });
  const last = el('div', {class: 'col current'});
  if (!t.items.length) last.append(emptyState(t));
  t.items.forEach((e, i) => {
    const sel = t.sel.has(e.path);
    const r = el('div', {class: 'crow' + (sel ? ' sel' : '') + (t.cursor === e.path ? ' cursor' : '') + (S.clip?.mode === 'cut' && S.clip.paths.includes(e.path) ? ' cut' : ''), dataset: {i}, draggable: S.renaming === e.path ? 'false' : 'true'},
      iconFor(e, 16), S.renaming === e.path ? renameInput(e) : el('span', {class: 'nm', text: e.name}), e.isDir ? el('span', {class: 'ic chev', html: I.chevron}) : null);
    if (e.isDir) dropTarget(r, () => e.path);
    last.append(r);
  });
  bindArea(last, t);
  wrap.append(last);
  wrap.scrollLeft = wrap.scrollWidth;
  const cur = last.querySelector('.cursor, .sel'); if (cur) cur.scrollIntoView({block: 'nearest'});
}

function scrollIntoView(t, p) {
  const i = t.items.findIndex(e => e.path === p); if (i < 0) return;
  const sc = $('content').querySelector('.scroller'); if (!sc) { $('content').querySelector('.col.current .cursor')?.scrollIntoView({block: 'nearest'}); return; }
  if (S.prefs.view === 'grid') {
    const cols = t.gridCols || 1, tileH = S.prefs.iconSize + 52, y = Math.floor(i / cols) * tileH + 12;
    if (y < sc.scrollTop) sc.scrollTop = y; else if (y + tileH > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + tileH - sc.clientHeight + 12;
  } else {
    const y = i * ROW_H;
    if (y < sc.scrollTop) sc.scrollTop = y; else if (y + ROW_H > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + ROW_H - sc.clientHeight + 4;
  }
}

// ---------- mouse: selection, open, context menu, drag
function bindArea(area, t) {
  area.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('input')) return;
    $('content').focus({preventScroll: true});
    S.dragPaths = null;
    const row = e.target.closest('[data-i]');
    // Empty space (or, in list view, the part of a row beside the name) starts a selection box.
    const listBlank = row && S.prefs.view === 'list' && !e.target.closest('.grab');
    if (!row || listBlank) { startMarquee(e, area, t, listBlank ? row : null); return; }
    selectFromClick(e, t, row);
  });
  area.addEventListener('click', e => {
    const row = e.target.closest('[data-i]');
    if (row?.dataset.pendingSingle) { delete row.dataset.pendingSingle; if (!mod(e) && !e.shiftKey) { const entry = t.items[+row.dataset.i]; if (t.sel.size > 1) { t.sel = new Set([entry.path]); t.anchor = entry.path; repaintSelection(); } else if (e.detail === 1 && e.target.closest('.nm, .tile-name') && t.sel.has(entry.path) && Date.now() - (t.lastClick || 0) > 500) slowClickRename(entry); } }
    t.lastClick = Date.now();
  });
  area.addEventListener('dblclick', e => {
    const row = e.target.closest('[data-i]'); if (!row || e.target.closest('input')) return;
    clearTimeout(S.slowTimer);
    const entry = t.items[+row.dataset.i];
    if (entry.isDir && mod(e)) navigate(entry.path, {newTab: true}); else openEntry(entry);
  });
  area.addEventListener('contextmenu', e => {
    e.preventDefault();
    const row = e.target.closest('[data-i]');
    if (row) { const entry = t.items[+row.dataset.i]; if (!t.sel.has(entry.path)) { t.sel = new Set([entry.path]); t.anchor = t.cursor = entry.path; repaintSelection(); } itemMenu(); }
    else { t.sel.clear(); repaintSelection(); folderMenu(); }
  });
  area.addEventListener('dragstart', e => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    e.preventDefault();
    const entry = t.items[+row.dataset.i];
    const paths = t.sel.has(entry.path) ? [...t.sel] : [entry.path];
    S.dragPaths = paths;
    desk.startDrag(paths);
  });
  dropTarget(area, () => t.path, true);
}
function selectFromClick(e, t, row) {
  const entry = t.items[+row.dataset.i];
  if (e.shiftKey && t.anchor) selectRange(t, t.anchor, entry.path, mod(e));
  else if (mod(e)) { t.sel.has(entry.path) ? t.sel.delete(entry.path) : t.sel.add(entry.path); t.anchor = entry.path; }
  else if (!t.sel.has(entry.path)) { t.sel = new Set([entry.path]); t.anchor = entry.path; }
  else row.dataset.pendingSingle = '1'; // collapse to single on click without drag
  t.cursor = entry.path;
  repaintSelection();
}

// ---------- selection box (drag on empty space to select everything it touches)
function startMarquee(e, area, t, rowUnder) {
  const view = S.prefs.view;
  const toLocal = (cx, cy) => { const r = area.getBoundingClientRect(); return {x: cx - r.left + area.scrollLeft, y: cy - r.top + area.scrollTop}; };
  const start = toLocal(e.clientX, e.clientY);
  const additive = mod(e) ? 'toggle' : e.shiftKey ? 'add' : null;
  const base = new Set(additive ? t.sel : []);
  let box = null, moved = false, last = {x: e.clientX, y: e.clientY}, raf = 0, lastHit = null;
  const hitsFor = r => {
    const out = [];
    if (view === 'list') {
      const i0 = Math.max(0, Math.floor((r.y0 - 4) / ROW_H)), i1 = Math.min(t.items.length - 1, Math.floor((r.y1 - 4) / ROW_H));
      for (let i = i0; i <= i1; i++) out.push(i);
    } else if (view === 'grid' && t.grid) {
      const {cols, tileW, tileH} = t.grid;
      for (let i = 0; i < t.items.length; i++) {
        const x = 12 + (i % cols) * tileW, y = 12 + Math.floor(i / cols) * tileH;
        if (y > r.y1) break;
        if (x + 8 < r.x1 && x + tileW - 8 > r.x0 && y + 8 < r.y1 && y + tileH - 8 > r.y0) out.push(i);
      }
    } else {
      for (const n of area.querySelectorAll('[data-i]')) {
        const nr = n.getBoundingClientRect(), a = area.getBoundingClientRect();
        const y = nr.top - a.top + area.scrollTop;
        if (y < r.y1 && y + nr.height > r.y0) out.push(+n.dataset.i);
      }
    }
    return out;
  };
  const update = () => {
    const cur = toLocal(last.x, last.y);
    const r = {x0: Math.min(start.x, cur.x), y0: Math.min(start.y, cur.y), x1: Math.max(start.x, cur.x), y1: Math.max(start.y, cur.y)};
    if (!box) { box = el('div', {class: 'marquee'}); area.append(box); }
    Object.assign(box.style, {left: `${r.x0}px`, top: `${r.y0}px`, width: `${r.x1 - r.x0}px`, height: `${r.y1 - r.y0}px`});
    const hits = hitsFor(r).map(i => t.items[i]?.path).filter(Boolean);
    const sel = new Set(base);
    for (const p of hits) { if (additive === 'toggle' && base.has(p)) sel.delete(p); else sel.add(p); }
    t.sel = sel;
    if (hits.length) { lastHit = hits[cur.y >= start.y ? hits.length - 1 : 0]; t.cursor = lastHit; }
    repaintSelection();
  };
  // Scroll while the pointer is held past the top or bottom edge.
  const autoScroll = () => {
    const r = area.getBoundingClientRect();
    const dy = last.y < r.top + 10 ? last.y - r.top - 10 : last.y > r.bottom - 10 ? last.y - r.bottom + 10 : 0;
    if (dy) { area.scrollTop += Math.max(-30, Math.min(30, dy)); update(); }
    raf = requestAnimationFrame(autoScroll);
  };
  const move = ev => {
    last = {x: ev.clientX, y: ev.clientY};
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
    if (!moved) { moved = true; document.body.classList.add('marqueeing'); raf = requestAnimationFrame(autoScroll); }
    update();
  };
  const up = ev => {
    removeEventListener('mousemove', move); removeEventListener('mouseup', up);
    cancelAnimationFrame(raf); box?.remove(); document.body.classList.remove('marqueeing');
    if (moved) { if (lastHit) t.anchor = lastHit; repaintSelection(); return; }
    // A plain click: on a row's blank part it selects the row; on empty space it clears.
    if (rowUnder) selectFromClick(ev, t, rowUnder);
    else if (!additive) { t.sel.clear(); t.cursor = null; repaintSelection(); }
  };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}
function slowClickRename(entry) { clearTimeout(S.slowTimer); S.slowTimer = setTimeout(() => { const t = tab(); if (t.sel.size === 1 && t.sel.has(entry.path) && !S.renaming) startRename(entry.path); }, 650); }
function selectRange(t, a, b, add) {
  const ia = t.items.findIndex(e => e.path === a), ib = t.items.findIndex(e => e.path === b);
  if (ia < 0 || ib < 0) return;
  if (!add) t.sel.clear();
  for (let i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) t.sel.add(t.items[i].path);
}
function repaintSelection() {
  const t = tab();
  document.querySelectorAll('#content [data-i]').forEach(n => {
    const e = t.items[+n.dataset.i]; if (!e) return;
    n.classList.toggle('sel', t.sel.has(e.path)); n.classList.toggle('cursor', t.cursor === e.path); n.setAttribute('aria-selected', String(t.sel.has(e.path)));
  });
  renderStatus(); renderPreviewSoon();
}
// Any element can accept files dropped from Fresh Desk or another app.
function dropTarget(node, dest, isArea = false) {
  node.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    if (isArea && e.target.closest('[data-i]') && e.target.closest('[data-i]') !== node) { if (e.target.closest('.row, .tile, .crow')?.classList.contains('drop')) return; }
    e.preventDefault(); e.stopPropagation();
    // Windows only allows "copy" for drags Fresh Desk starts itself; asking for "move" there makes
    // Windows refuse the drop. The effect is only the cursor badge — what happens is decided on drop.
    const allowed = e.dataTransfer.effectAllowed || 'all';
    const canMove = /^(all|move|copyMove|linkMove|uninitialized)$/.test(allowed);
    e.dataTransfer.dropEffect = e.altKey || !canMove ? (/copy|all|uninitialized/i.test(allowed) ? 'copy' : 'link') : 'move';
    document.querySelectorAll('.drop').forEach(n => n !== node && n.classList.remove('drop'));
    node.classList.add('drop');
  });
  node.addEventListener('dragleave', e => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop'); });
  node.addEventListener('drop', async e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); e.stopPropagation();
    node.classList.remove('drop');
    let paths = [...e.dataTransfer.files].map(f => desk.pathForFile(f)).filter(Boolean);
    const internal = S.dragPaths && (!paths.length || paths.every(p => S.dragPaths.includes(p)));
    if (!paths.length && S.dragPaths) paths = S.dragPaths;
    S.dragPaths = null;
    const to = dest();
    if (!paths.length || !to) return;
    const sources = paths.filter(p => p !== to && U.dirname(p, sep()) !== to || e.altKey);
    if (!sources.length) return;
    // Our own drags move (⌥/Alt copies). From other apps: move when they allow it, otherwise copy.
    const allowed = e.dataTransfer.effectAllowed || 'all';
    const copy = e.altKey || (!internal && !/^(all|move|copyMove|linkMove|uninitialized)$/.test(allowed));
    await transfer(copy ? 'copy' : 'move', sources, to);
  });
}

// ---------------------------------------------------------------- preview
const renderPreviewSoon = U.debounce(() => renderPreview(), 70);
let previewToken = 0;
function selected() { const t = tab(); return t.items.filter(e => t.sel.has(e.path)); }
async function renderPreview() {
  const box = $('preview');
  if (!S.prefs.showPreview || window.Tidy?.isOpen()) return;
  const token = ++previewToken;
  const t = tab(), sel = selected();
  if (sel.length > 1) {
    const total = sel.reduce((n, e) => n + (e.size || 0), 0);
    box.replaceChildren(el('div', {class: 'pv-stack'}, sel.slice(0, 3).map(e => iconFor(e, 72))), el('h2', {class: 'pv-name', text: `${sel.length} items`}),
      el('p', {class: 'pv-kind', text: `${sel.filter(e => e.isDir).length} folders · ${sel.filter(e => !e.isDir).length} files · ${bytes(total)}`}),
      el('div', {class: 'pv-actions'}, btn('Share', () => shareMenu()), btn('Compress', () => command('compress')), btn('Move to Trash', () => command('trash'))));
    return;
  }
  const e = sel[0] || (t.listing ? {name: U.basename(t.path) || t.path, path: t.path, isDir: true, kind: 'Folder', self: true} : null);
  if (!e) { box.replaceChildren(); return; }
  const media = el('div', {class: 'pv-media'});
  const meta = el('dl', {class: 'pv-meta'});
  const actions = el('div', {class: 'pv-actions'});
  box.replaceChildren(media, el('h2', {class: 'pv-name', text: e.name, title: e.name}), el('p', {class: 'pv-kind', text: e.isDir ? 'Folder' : `${e.kind} · ${bytes(e.size)}`}), actions, meta);
  fillMedia(media, e, 280, token);
  const info = await desk.info(e.path).catch(() => null);
  if (token !== previewToken || !info) return;
  const rows = [];
  if (e.isDir) rows.push(['Contains', info.items == null ? '—' : `${info.items} item${info.items === 1 ? '' : 's'}`]);
  rows.push(['Modified', longDate(info.mtime)], ['Created', longDate(info.ctime)]);
  if (!e.self) rows.push(['Where', U.dirname(e.path, sep())]);
  if (info.target) rows.push(['Points to', info.target]);
  for (const [k, v] of rows) meta.append(el('dt', {text: k}), el('dd', {text: v, title: v}));
  if (e.isDir) {
    const sizeDd = el('dd', {}, el('button', {class: 'link', text: 'Calculate', onclick: async () => {
      sizeDd.textContent = 'Calculating…';
      const id = `fs${Date.now()}`;
      try { const r = await desk.folderSize(e.path, id); sizeDd.textContent = `${bytes(r.bytes)} · ${r.files.toLocaleString()} files`; } catch (er) { sizeDd.textContent = '—'; }
    }}));
    meta.prepend(el('dt', {text: 'Size'}), sizeDd);
    actions.append(btn(e.self ? 'Open in Terminal' : 'Open', () => e.self ? desk.terminal(e.path).catch(err) : navigate(e.path)), btn('Terminal', () => desk.terminal(e.path).catch(err), 'ghost'));
    if (e.self) actions.firstChild.remove(), actions.prepend(btn('Tidy this folder', () => window.Tidy?.open(e.path)));
  } else {
    actions.append(btn('Open', () => openEntry(e)), btn('Share', () => shareMenu([e.path]), 'ghost'), btn('Quick Look', () => quickLook(), 'ghost'));
  }
}
function btn(label, fn, cls = '') { return el('button', {class: 'btn ' + cls, text: label, onclick: fn}); }
async function fillMedia(media, e, size, token, big = false) {
  const kind = e.kind;
  if (e.isDir) { media.append(el('div', {class: 'pv-icon', html: Icons.folderIcon(big ? 160 : 96)})); return; }
  if (kind === 'Image' && !/^(psd|raw|cr2|cr3|nef|arw|dng|heic|heif|tif|tiff)$/.test(e.ext) || (kind === 'Image' && isMac() && /^(heic|heif|tif|tiff)$/.test(e.ext))) {
    const img = el('img', {class: 'pv-img', src: U.fileUrl(e.path), alt: '', draggable: 'false'});
    img.onerror = () => thumbInto(media, e, size, big);
    img.onload = () => { const d = media.parentNode?.querySelector?.('.pv-kind'); if (d && img.naturalWidth) d.textContent = `${kind} · ${img.naturalWidth} × ${img.naturalHeight} · ${bytes(e.size)}`; };
    media.append(img); return;
  }
  if (kind === 'Video' && /^(mp4|m4v|webm|mov|ogg)$/.test(e.ext)) { media.append(el('video', {class: 'pv-video', src: U.fileUrl(e.path), controls: true, preload: 'metadata'})); return; }
  if (kind === 'Audio' && /^(mp3|wav|m4a|aac|ogg|opus|flac)$/.test(e.ext)) { await thumbInto(media, e, size, big); media.append(el('audio', {src: U.fileUrl(e.path), controls: true, preload: 'metadata'})); return; }
  if (window.DocView?.handles(e)) {
    const alive = big ? () => media.isConnected : () => token === previewToken && media.isConnected;
    if (await DocView.render(media, e, {big, alive})) return;
  }
  if (e.size < 5e6 && (/^(txt|md|markdown|log|csv|tsv|json|jsonc|xml|yml|yaml|toml|ini|cfg|conf|env|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|ps1|bat|cmd|html|htm|css|scss|vue|svelte|sql|lua|r|dart|srt|vtt|gitignore|lock)$/.test(e.ext) || (!e.ext && e.size < 200000))) {
    const r = await desk.readText(e.path).catch(() => null);
    if (token !== previewToken && !big) return;
    if (r && !r.binary) { media.classList.add('text'); media.append(el('pre', {class: 'pv-text', text: (r.text || '').slice(0, big ? 200000 : 6000) + (r.truncated ? '\n…' : '')})); return; }
  }
  await thumbInto(media, e, size, big);
}
async function thumbInto(media, e, size, big) {
  media.replaceChildren(el('div', {class: 'pv-icon'}, iconFor(e, big ? 160 : 96)));
  if (!(isMac() || isWin()) && e.kind !== 'Image') return;
  const src = await desk.thumb(e.path, Math.round((big ? 900 : size) * devicePixelRatio), e.mtime).catch(() => null);
  if (src) media.replaceChildren(el('img', {class: 'pv-img', src, alt: '', draggable: 'false'}));
}

function quickLook(close = false) {
  const ql = $('quicklook');
  if (close || !ql.hidden && close !== false) { if (!ql.hidden) { ql.hidden = true; ql.replaceChildren(); $('content').focus(); return; } }
  const e = selected()[0] || tab().items.find(x => x.path === tab().cursor);
  if (!e) return;
  const media = el('div', {class: 'ql-media'});
  const body = el('div', {class: 'ql-box'},
    el('div', {class: 'ql-bar'}, el('span', {class: 'ql-title', text: e.name}), el('span', {class: 'ql-sub', text: e.isDir ? 'Folder' : `${e.kind} · ${bytes(e.size)}`}),
      el('span', {class: 'grow'}), btn(e.isDir ? 'Open' : `Open`, () => { quickLook(true); openEntry(e); }), el('button', {class: 'tb', 'aria-label': 'Close', html: I.close, onclick: () => quickLook(true)})),
    media);
  ql.replaceChildren(body); ql.hidden = false;
  ql.onclick = ev => { if (ev.target === ql) quickLook(true); };
  fillMedia(media, e, 900, previewToken, true);
}

// ---------------------------------------------------------------- operations
function err(e) { toast((e && e.message || String(e)).replace(/^Error invoking remote method '\w+': (Error: )?/, ''), {error: true}); }
async function openEntry(e) {
  if (!e) return;
  if (e.isDir) return navigate(e.path);
  try { await desk.open(e.path); } catch (x) { err(x); }
}
function targetsOrCurrent() { const s = [...tab().sel]; return s.length ? s : []; }
async function transfer(kind, sources, dest) {
  try {
    const results = await desk.transfer(kind, sources, dest);
    report(results, kind === 'copy' ? 'Copied' : 'Moved', U.basename(dest) || dest);
  } catch (e) { err(e); }
  await reload();
}
function report(results, verb, where) {
  const ok = results.filter(r => r.ok && r.to), bad = results.filter(r => !r.ok);
  if (bad.length) toast(`${ok.length ? `${verb} ${ok.length}. ` : ''}${bad.length} couldn’t be ${verb.toLowerCase()}: ${bad[0].error}`, {error: true});
  else if (ok.length) toast(`${verb} ${ok.length === 1 ? '“' + U.basename(ok[0].to) + '”' : ok.length + ' items'}${where ? ' to ' + where : ''}`, {undo: true});
}
async function newFolder() {
  try { const p = await desk.newFolder(tab().path); await load(tab(), {keep: true}); select(p); startRename(p); } catch (e) { err(e); }
}
async function newFile() {
  try { const p = await desk.newFile(tab().path); await load(tab(), {keep: true}); select(p); startRename(p); } catch (e) { err(e); }
}
function select(p) { const t = tab(); t.sel = new Set([p]); t.cursor = t.anchor = p; scrollIntoView(t, p); repaintSelection(); }
// Inline rename. The field survives re-renders (scrolling, folder sizes, live
// refresh) by keeping its draft in S, and it won't give up just because a menu
// closing or the window refocusing briefly stole focus.
function startRename(p) {
  S.renaming = p; S.renameDraft = null; S.renameStarted = Date.now();
  renderContent();
  const focusIt = (tries = 0) => {
    const i = document.querySelector('#content input.rename');
    if (!i) { if (tries < 20) setTimeout(() => focusIt(tries + 1), 25); return; }
    i.focus();
    const isDir = tab().items.find(e => e.path === p)?.isDir;
    const dot = i.value.lastIndexOf('.');
    i.setSelectionRange(0, dot > 0 && !isDir ? dot : i.value.length);
  };
  // After a context menu closes, the window hands focus back a moment later — wait for that.
  setTimeout(() => requestAnimationFrame(() => focusIt()), 60);
}
function renameInput(e) {
  const input = el('input', {class: 'rename', value: S.renameDraft ?? e.name, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'New name'});
  const finish = async commit => {
    if (S.renaming !== e.path) return;
    const name = (S.renameDraft ?? input.value);
    S.renaming = null; S.renameDraft = null;
    if (commit && name.trim() && name !== e.name) {
      try { const to = await desk.rename(e.path, name); await load(tab(), {keep: true}); select(to); $('content').focus(); return; } catch (x) { err(x); }
    }
    renderContent(); $('content').focus();
  };
  input.addEventListener('input', () => { S.renameDraft = input.value; });
  input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } });
  input.addEventListener('keyup', ev => ev.stopPropagation());
  input.addEventListener('blur', () => setTimeout(() => {
    // Removed by a re-render (Chromium can report the blur before the node is gone): the new field takes over.
    if (!input.isConnected || S.renaming !== e.path) return;
    if (document.activeElement?.classList?.contains('rename')) return;
    // Focus bounced away right after starting (menu closing, window refocus): take it back.
    if (Date.now() - (S.renameStarted || 0) < 800 && S.renameDraft == null) { input.focus(); return; }
    finish(true);
  }, 0));
  for (const ev of ['mousedown', 'click', 'dblclick', 'dragstart']) input.addEventListener(ev, x => { x.stopPropagation(); if (ev === 'dragstart') x.preventDefault(); });
  // Rebuilt while renaming (scroll, refresh): keep typing where you were.
  if (S.renameDraft != null) requestAnimationFrame(() => { if (input.isConnected && document.activeElement !== input) { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); } });
  return input;
}
async function trash(paths = targetsOrCurrent()) {
  if (!paths.length) return;
  const results = await desk.trash(paths).catch(e => (err(e), []));
  const ok = results.filter(r => r.ok).length, bad = results.filter(r => !r.ok);
  if (bad.length) toast(`${bad.length} couldn’t be moved to the Trash: ${bad[0].error}`, {error: true});
  else if (ok) toast(`Moved ${ok === 1 ? '“' + U.basename(results[0].path) + '”' : ok + ' items'} to the ${isWin() ? 'Recycle Bin' : 'Trash'}`);
  await reload();
}
async function undo() {
  try {
    const r = await desk.undo();
    if (!r.label) { toast('Nothing to undo'); return; }
    const bad = r.results.filter(x => !x.ok);
    toast(bad.length ? `Undid part of “${r.label}”. ${bad.length} item${bad.length > 1 ? 's' : ''}: ${bad[0].error}` : `Undid ${r.label.charAt(0).toLowerCase() + r.label.slice(1)}`, {error: !!bad.length});
  } catch (e) { err(e); }
  await reload();
  if (window.Tidy?.isOpen()) Tidy.refresh();
}
async function compress() { const p = targetsOrCurrent(); if (!p.length) return; toast('Compressing…'); try { const z = await desk.compress(p); await load(tab(), {keep: true}); select(z); toast(`Created “${U.basename(z)}”`, {undo: true}); } catch (e) { err(e); } }
async function extract(e) { toast('Extracting…'); try { const d = await desk.extract(e.path); await load(tab(), {keep: true}); select(d); toast(`Extracted to “${U.basename(d)}”`, {undo: true}); } catch (x) { err(x); } }
function setClip(mode) { const p = targetsOrCurrent(); if (!p.length) return; S.clip = {mode, paths: p}; desk.copyText(p.join('\n')); toast(`${mode === 'cut' ? 'Cut' : 'Copied'} ${p.length === 1 ? '“' + U.basename(p[0]) + '”' : p.length + ' items'} — paste with ${short('⌘V')}`); repaintCut(); }
function repaintCut() { renderContent(); }
async function paste() {
  if (!S.clip) return toast('Nothing to paste');
  const {mode, paths} = S.clip; if (mode === 'cut') S.clip = null;
  await transfer(mode === 'cut' ? 'move' : 'copy', paths, tab().path);
}

// ---------------------------------------------------------------- menus
async function itemMenu() {
  const sel = selected(); if (!sel.length) return;
  const one = sel.length === 1 ? sel[0] : null;
  const term = isMac() ? 'Finder' : isWin() ? 'File Explorer' : 'Files';
  const items = [
    {id: 'open', label: one?.isDir ? 'Open' : 'Open', accel: isMac() ? 'Cmd+O' : 'Enter'},
    one?.isDir ? {id: 'openTab', label: 'Open in New Tab'} : null,
    one && !one.isDir ? {id: 'openWith', label: 'Open With…'} : null,
    {type: 'separator'},
    one?.isDir ? {id: 'terminal', label: 'Open in Terminal', accel: 'Ctrl+`'} : null,
    {id: 'editor', label: `Open in ${editorLabel()}`},
    {id: 'reveal', label: `Show in ${term}`},
    {id: 'quicklook', label: 'Quick Look', accel: 'Space'},
    {type: 'separator'},
    ...(await shareItems(sel.map(e => e.path))),
    {type: 'separator'},
    {id: 'rename', label: one ? 'Rename…' : `Rename ${sel.length} Items…`, accel: isMac() ? 'Enter' : 'F2'},
    {id: 'duplicate', label: 'Duplicate', accel: isMac() ? 'Cmd+D' : 'Ctrl+D'},
    {id: 'compress', label: one ? `Compress “${one.name}”` : `Compress ${sel.length} items`},
    one && one.ext === 'zip' ? {id: 'extract', label: 'Extract Here'} : null,
    {type: 'separator'},
    {id: 'cut', label: 'Cut', accel: isMac() ? 'Cmd+X' : 'Ctrl+X'}, {id: 'copy', label: 'Copy', accel: isMac() ? 'Cmd+C' : 'Ctrl+C'},
    {id: 'copyPath', label: sel.length > 1 ? 'Copy Paths' : 'Copy Path', accel: isMac() ? 'Alt+Cmd+C' : 'Ctrl+Alt+C'},
    one?.isDir ? {id: 'pin', label: 'Add to Favorites…'} : null,
    {type: 'separator'},
    {id: 'trash', label: isWin() ? 'Delete (Recycle Bin)' : 'Move to Trash', accel: isMac() ? 'Cmd+Backspace' : 'Delete'},
  ].filter(Boolean);
  const id = await desk.menu(items);
  if (await handleShare(id, sel.map(e => e.path))) return;
  if (id === 'openTab') navigate(one.path, {newTab: true});
  else if (id === 'pin') pin(one.path);
  else if (id === 'extract') extract(one);
  else if (id) command(id);
}
// ---------- sharing: the Mac share sheet (AirDrop, Messages, Mail…) and Beam
async function shareItems(paths) {
  const items = [];
  if (isMac()) items.push({type: 'share', label: 'Share', paths});
  const b = (await desk.beamStatus().catch(() => null)) || {installed: false, running: false, peers: []};
  const what = paths.length === 1 ? '' : ` ${paths.length} Items`;
  if (b.running) {
    const devices = b.peers.map(p => ({id: 'beam:' + p.id, label: `${p.name}${p.os ? ` · ${({mac: 'Mac', windows: 'PC', linux: 'Linux', ios: 'iPhone', android: 'Android'})[p.os] || p.os}` : ''}`}));
    items.push({label: `Beam${what} To`, submenu: [...(devices.length ? devices : [{label: 'No devices nearby', enabled: false}]), {type: 'separator'}, {id: 'beamOpen', label: 'Open in Beam…'}]});
  } else if (b.installed) items.push({id: 'beamOpen', label: `Send${what} with Beam…`});
  else if (!isMac()) items.push({label: 'Send with Beam (install Beam from Utility Hub)', enabled: false});
  return items;
}
async function handleShare(id, paths) {
  if (!id) return false;
  if (id.startsWith('beam:')) {
    try { await desk.beamSend(id.slice(5), paths); toast(`Sending ${paths.length === 1 ? '“' + U.basename(paths[0]) + '”' : paths.length + ' items'} with Beam`); }
    catch (e) { err(e); }
    return true;
  }
  if (id === 'beamOpen') { try { await desk.beamOpen(paths); } catch (e) { err(e); } return true; }
  return false;
}
async function shareMenu(paths = selected().map(e => e.path)) {
  if (!paths.length) return toast('Select something to share first');
  const items = await shareItems(paths);
  // On a Mac the share sheet is the first entry; open the menu with it ready.
  const id = await desk.menu(items.length ? items : [{label: 'Nothing to share with', enabled: false}]);
  await handleShare(id, paths);
}

async function folderMenu() {
  const t = tab();
  const id = await desk.menu([
    {id: 'newFolder', label: 'New Folder', accel: isMac() ? 'Shift+Cmd+N' : 'Ctrl+Shift+N'}, {id: 'newFile', label: 'New Text File'},
    {id: 'paste', label: S.clip ? `Paste ${S.clip.paths.length === 1 ? '“' + U.basename(S.clip.paths[0]) + '”' : S.clip.paths.length + ' items'}` : 'Paste', enabled: !!S.clip},
    {type: 'separator'},
    {id: 'terminalHere', label: 'Open in Terminal', accel: 'Ctrl+`'}, {id: 'editorHere', label: `Open in ${editorLabel()}`},
    {id: 'tidy', label: 'Tidy This Folder…'},
    {type: 'separator'},
    {label: 'Sort By', submenu: SORTS.map(([k, l]) => ({id: 'sort:' + k, label: l, checked: S.prefs.sort.key === k}))},
    {label: 'View', submenu: [['list', 'as List'], ['grid', 'as Grid'], ['columns', 'as Columns']].map(([v, l]) => ({id: 'view:' + v, label: l, checked: S.prefs.view === v}))},
    {id: 'toggleHidden', label: 'Show Hidden Files', checked: S.prefs.showHidden},
    {id: 'foldersFirst', label: 'Keep Folders on Top', checked: S.prefs.foldersFirst},
    {type: 'separator'},
    {id: 'copyPathHere', label: 'Copy Folder Path'}, {id: 'pinHere', label: 'Add Folder to Favorites…'},
    {id: 'folderSizes', label: 'Show Folder Sizes', checked: !!S.prefs.folderSizes},
  ]);
  if (!id) return;
  if (id.startsWith('sort:')) { S.prefs.sort = {key: id.slice(5), dir: id.slice(5) === 'name' || id.slice(5) === 'kind' ? 1 : -1}; for (const x of S.tabs) refreshItems(x); renderContent(); savePrefsSoon(); }
  else if (id.startsWith('view:')) setView(id.slice(5));
  else if (id === 'terminalHere') desk.terminal(t.path).catch(err);
  else if (id === 'editorHere') desk.editor(t.path).catch(err);
  else if (id === 'copyPathHere') { desk.copyText(t.path); toast('Copied folder path'); }
  else if (id === 'pinHere') pin(t.path);
  else if (id === 'folderSizes') { S.prefs.folderSizes = !S.prefs.folderSizes; savePrefsSoon(); if (S.prefs.folderSizes) sizeFolders(tab()); renderContent(); }
  else if (id === 'foldersFirst') { S.prefs.foldersFirst = !S.prefs.foldersFirst; for (const x of S.tabs) refreshItems(x); renderContent(); savePrefsSoon(); }
  else command(id);
}
function editorLabel() { return S.launchers.editors.find(x => x.id === S.prefs.editor)?.label || S.launchers.editors[0]?.label || 'Editor'; }
async function moreMenu() {
  const id = await desk.menu([
    {id: 'newFolder', label: 'New Folder'}, {id: 'newFile', label: 'New Text File'}, {id: 'newTab', label: 'New Tab'},
    {type: 'separator'},
    {id: 'toggleHidden', label: 'Show Hidden Files', checked: S.prefs.showHidden},
    {id: 'tidy', label: 'Tidy This Folder…'}, {id: 'palette', label: 'Command Palette…', accel: isMac() ? 'Cmd+K' : 'Ctrl+K'},
    {id: 'history', label: 'Recent Changes…'},
    {type: 'separator'}, {id: 'settings', label: 'Settings…'},
  ]);
  if (id) command(id);
}
async function historyMenu() {
  const list = await desk.history();
  if (!list.length) return toast('No changes to undo');
  const id = await desk.menu(list.slice(0, 15).map(b => ({id: b.id, label: `Undo: ${b.label} · ${when(b.time)}`})));
  if (!id) return;
  const r = await desk.undo(id).catch(e => (err(e), null));
  if (r) { const bad = r.results.filter(x => !x.ok); toast(bad.length ? `${bad.length} item${bad.length > 1 ? 's' : ''} couldn’t be undone: ${bad[0].error}` : `Undid ${r.label}`, {error: !!bad.length}); }
  await reload();
}

// ---------------------------------------------------------------- commands & keys
function setView(v) { S.prefs.view = v; $('zoom').hidden = v !== 'grid'; render(); savePrefsSoon(); }
function command(id) {
  const t = tab(), sel = selected(), one = sel.length === 1 ? sel[0] : null;
  const inEdit = editable(document.activeElement);
  if (inEdit && ['cut', 'copy', 'paste', 'undo', 'redo', 'selectAll'].includes(id)) { desk.editCmd?.(id); return; }
  switch (id) {
    case 'open': return sel.length ? sel.forEach(e => openEntry(e)) : null;
    case 'openWith': return one && desk.openWith(one.path).catch(err);
    case 'terminal': return desk.terminal(one?.isDir ? one.path : t.path).catch(err);
    case 'editor': return desk.editor(one ? one.path : t.path).catch(err);
    case 'reveal': return desk.reveal(one ? one.path : t.path);
    case 'quicklook': return quickLook();
    case 'rename': return sel.length > 1 ? Extras.batchRename(sel) : one && startRename(one.path);
    case 'duplicate': return sel.length && desk.duplicate(sel.map(e => e.path)).then(r => { report(r, 'Duplicated'); return reload(); }).catch(err);
    case 'compress': return compress();
    case 'copyPath': { const p = sel.length ? sel.map(e => e.path) : [t.path]; desk.copyText(p.join('\n')); return toast(p.length > 1 ? `Copied ${p.length} paths` : 'Copied path'); }
    case 'cut': return setClip('cut');
    case 'copy': return setClip('copy');
    case 'paste': return paste();
    case 'trash': return trash();
    case 'undo': return undo();
    case 'selectAll': t.sel = new Set(t.items.map(e => e.path)); return repaintSelection();
    case 'newFolder': return newFolder();
    case 'newFile': return newFile();
    case 'newTab': newTab(t.path); return render();
    case 'closeTab': return closeTab();
    case 'nextTab': return switchTab((S.active + 1) % S.tabs.length);
    case 'prevTab': return switchTab((S.active - 1 + S.tabs.length) % S.tabs.length);
    case 'back': return back();
    case 'forward': return forward();
    case 'up': return up();
    case 'goHome': return navigate(S.env.paths.home);
    case 'goDesktop': return navigate(S.env.paths.desktop);
    case 'goDownloads': return navigate(S.env.paths.downloads);
    case 'goto': return editPath();
    case 'find': $('search').focus(); return $('search').select();
    case 'palette': return openPalette();
    case 'viewList': return setView('list');
    case 'viewGrid': return setView('grid');
    case 'viewColumns': return setView('columns');
    case 'togglePreview': S.prefs.showPreview = !S.prefs.showPreview; render(); return savePrefsSoon();
    case 'toggleHidden': S.prefs.showHidden = !S.prefs.showHidden; savePrefsSoon(); toast(S.prefs.showHidden ? 'Showing hidden files' : 'Hiding hidden files'); return reload();
    case 'share': return shareMenu();
    case 'folderSizes': S.prefs.folderSizes = !S.prefs.folderSizes; savePrefsSoon(); if (S.prefs.folderSizes) sizeFolders(t); return renderContent();
    case 'pinHere': return pin(t.path);
    case 'batchRename': return sel.length ? (sel.length > 1 ? Extras.batchRename(sel) : startRename(sel[0].path)) : toast('Select some files first');
    case 'toggleRecents': return setRecents(S.prefs.showRecents === false);
    case 'tidy': return window.Tidy?.isOpen() ? Tidy.close() : window.Tidy?.open(t.path);
    case 'settings': return openSettings();
    case 'history': return historyMenu();
    case 'refresh': return reload();
  }
}
desk.on('command', id => command(id));

function moveCursor(t, delta, extend) {
  if (!t.items.length) return;
  let i = t.items.findIndex(e => e.path === t.cursor);
  if (i < 0) i = delta > 0 ? -1 : t.items.length;
  const n = Math.max(0, Math.min(t.items.length - 1, i + delta));
  const p = t.items[n].path;
  if (extend && t.anchor) selectRange(t, t.anchor, p, false);
  else { t.sel = new Set([p]); t.anchor = p; }
  t.cursor = p;
  scrollIntoView(t, p); repaintSelection();
  if (S.prefs.view === 'columns') renderContent();
  if (!$('quicklook').hidden) quickLook(false);
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented) return;
  const pal = !$('palette').hidden, ql = !$('quicklook').hidden;
  if (document.querySelector('dialog[open]')) return;
  if (pal) return;
  if (ql) {
    if (e.key === ' ' || e.key === 'Escape') { e.preventDefault(); quickLook(true); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); const t = tab(); moveCursor(t, e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1, false); return; }
  }
  const active = document.activeElement;
  if (editable(active)) return;
  if (window.Tidy?.isOpen() && !e.metaKey && !e.ctrlKey) { if (e.key === 'Escape') Tidy.close(); return; }
  const t = tab(), M = mod(e), k = e.key;
  // On macOS the menu bar owns most ⌘ shortcuts.
  if (isMac()) {
    if (e.ctrlKey) return;
    if (e.metaKey) {
      if (k === 'Backspace') { e.preventDefault(); return command('trash'); }
      if (k === 'ArrowUp') { e.preventDefault(); return up(); }
      if (k === 'ArrowDown') { e.preventDefault(); return command('open'); }
      return;
    }
  } else {
    const combos = {
      'C-t': 'newTab', 'C-w': 'closeTab', 'C-S-n': 'newFolder', 'C-A-n': 'newFile', 'C-o': 'open', 'C-d': 'duplicate', 'C-x': 'cut', 'C-c': 'copy', 'C-v': 'paste', 'C-z': 'undo',
      'C-a': 'selectAll', 'C-f': 'find', 'C-k': 'palette', 'C-l': 'goto', 'C-S-g': 'goto', 'C-1': 'viewList', 'C-2': 'viewGrid', 'C-3': 'viewColumns', 'C-S-p': 'togglePreview', 'C-h': 'toggleHidden',
      'C-S-.': 'toggleHidden', 'C-S-e': 'editor', 'C-S-s': 'share', 'C-A-c': 'copyPath', 'C-S-y': 'tidy', 'C-,': 'settings', 'C-`': 'terminal', 'C-Tab': 'nextTab', 'C-S-Tab': 'prevTab', 'A-ArrowLeft': 'back', 'A-ArrowRight': 'forward', 'A-ArrowUp': 'up',
      'F5': 'refresh', 'F2': 'rename', 'Delete': 'trash', 'C-r': 'refresh',
    };
    // Match by physical key so Caps Lock, Shift and keyboard layouts don't change the shortcut.
    const c = e.code || '';
    const base = c.startsWith('Key') ? c.slice(3).toLowerCase() : c.startsWith('Digit') ? c.slice(5) : ({Period: '.', Comma: ',', Backquote: '`'})[c] || k;
    const key = (e.ctrlKey ? 'C-' : '') + (e.altKey ? 'A-' : '') + (e.shiftKey && (e.ctrlKey || e.altKey) ? 'S-' : '') + base;
    if (combos[key]) { e.preventDefault(); return command(combos[key]); }
    if (k === 'Backspace' && !M) { e.preventDefault(); return up(); }
  }
  if (k === 'F2') { e.preventDefault(); return command('rename'); }
  const view = S.prefs.view;
  if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); return moveCursor(t, (k === 'ArrowDown' ? 1 : -1) * (view === 'grid' ? (t.gridCols || 1) : 1), e.shiftKey); }
  if (k === 'ArrowRight' || k === 'ArrowLeft') {
    e.preventDefault();
    if (view === 'grid') return moveCursor(t, k === 'ArrowRight' ? 1 : -1, e.shiftKey);
    if (view === 'columns') { const cur = t.items.find(x => x.path === t.cursor); if (k === 'ArrowRight' && cur?.isDir) return navigate(cur.path).then(() => { const n = tab(); if (n.items[0]) { n.sel = new Set([n.items[0].path]); n.cursor = n.anchor = n.items[0].path; renderContent(); renderPreviewSoon(); } }); if (k === 'ArrowLeft') return up(); }
    return;
  }
  if (k === 'Home') { e.preventDefault(); return moveCursor(t, -1e9, e.shiftKey); }
  if (k === 'End') { e.preventDefault(); return moveCursor(t, 1e9, e.shiftKey); }
  if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); return moveCursor(t, (k === 'PageDown' ? 1 : -1) * 15, e.shiftKey); }
  if (k === 'Enter') { e.preventDefault(); return isMac() ? command('rename') : command('open'); }
  if (k === ' ') { e.preventDefault(); return quickLook(); }
  if (k === 'Escape') { if (t.search.q) return clearSearch(); t.sel.clear(); return repaintSelection(); }
  if (k.length === 1 && !e.altKey && !e.metaKey && !e.ctrlKey && /\S/.test(k)) {
    // Type to select: jump to the first name starting with what you type.
    clearTimeout(S.typeTimer); S.typeahead += k.toLowerCase(); S.typeTimer = setTimeout(() => S.typeahead = '', 900);
    const hit = t.items.find(x => x.name.toLowerCase().startsWith(S.typeahead)) || t.items.find(x => x.name.toLowerCase().includes(S.typeahead));
    if (hit) { t.sel = new Set([hit.path]); t.cursor = t.anchor = hit.path; scrollIntoView(t, hit.path); repaintSelection(); }
  }
});
// Mouse back/forward buttons.
window.addEventListener('mouseup', e => { if (e.button === 3) { e.preventDefault(); back(); } if (e.button === 4) { e.preventDefault(); forward(); } });

// ---------------------------------------------------------------- palette
const PALETTE_COMMANDS = [
  ['newFolder', 'New folder', '⌘⇧N'], ['newFile', 'New text file', '⌘⌥N'], ['newTab', 'New tab', '⌘T'], ['terminal', 'Open in Terminal', '⌃`'], ['editor', 'Open in code editor', '⌘⇧E'],
  ['reveal', 'Show in Finder / Explorer', ''], ['copyPath', 'Copy path', '⌘⌥C'], ['tidy', 'Tidy this folder', '⌘⇧Y'], ['toggleHidden', 'Show / hide hidden files', '⌘⇧.'],
  ['togglePreview', 'Show / hide preview', '⌘⇧P'], ['toggleRecents', 'Show / hide recent folders in sidebar', ''], ['folderSizes', 'Show / hide folder sizes', ''], ['pinHere', 'Add this folder to Favorites', ''], ['batchRename', 'Rename selected items…', ''], ['share', 'Share / AirDrop / Beam selection…', '⌘⇧S'], ['viewList', 'View as list', '⌘1'], ['viewGrid', 'View as grid', '⌘2'], ['viewColumns', 'View as columns', '⌘3'],
  ['undo', 'Undo last change', '⌘Z'], ['history', 'Recent changes (undo any)', ''], ['compress', 'Compress selection', ''], ['duplicate', 'Duplicate selection', '⌘D'],
  ['trash', 'Move selection to Trash', '⌘⌫'], ['goto', 'Go to folder by path…', '⌘⇧G'], ['settings', 'Settings', '⌘,'], ['refresh', 'Refresh', ''],
];
let paletteItems = [], paletteIndex = 0;
function openPalette() {
  $('palette').hidden = false; $('paletteInput').value = ''; paletteIndex = 0; buildPalette(); $('paletteInput').focus();
}
function closePalette() { $('palette').hidden = true; $('content').focus(); }
function buildPalette() {
  const q = $('paletteInput').value.trim();
  const t = tab();
  const looksPath = /^(~|\/|[A-Za-z]:\\)/.test(q);
  const candidates = [];
  if (looksPath) candidates.push({group: 'Go', label: `Go to ${q}`, icon: 'forward', run: () => navigate(q.replace(/^~/, S.env.home))});
  for (const [id, label, keys] of PALETTE_COMMANDS) candidates.push({group: 'Commands', label, keys: short(keys), icon: 'chevron', run: () => command(id)});
  const placeList = [...S.places.favorites, ...S.prefs.pins.map(p => ({name: U.basename(p), path: p, icon: 'folder'})), ...S.prefs.recents.map(p => ({name: U.basename(p) || p, path: p, icon: 'clock'})), ...S.places.volumes];
  const seen = new Set();
  for (const p of placeList) { if (seen.has(p.path)) continue; seen.add(p.path); candidates.push({group: 'Places', label: p.name, sub: p.path, icon: p.icon || 'folder', run: () => navigate(p.path)}); }
  for (const e of t.items.slice(0, 3000)) candidates.push({group: 'In this folder', label: e.name, sub: e.kind, entry: e, run: () => { select(e.path); if (e.isDir) navigate(e.path); } });
  let scored = candidates.map(c => ({c, s: U.fuzzy(q, c.label + (c.group === 'Places' ? ' ' + c.sub : ''))})).filter(x => x.s > 0);
  if (q) scored.sort((a, b) => b.s - a.s); else scored = scored.filter(x => x.c.group !== 'In this folder');
  paletteItems = scored.slice(0, 60).map(x => x.c);
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  const listEl = $('paletteList'); listEl.replaceChildren();
  let lastGroup = null;
  paletteItems.forEach((c, i) => {
    if (!q && c.group !== lastGroup) { listEl.append(el('div', {class: 'pal-group', text: c.group})); lastGroup = c.group; }
    listEl.append(el('div', {class: 'pal-item' + (i === paletteIndex ? ' on' : ''), role: 'option', onmousemove: () => { if (paletteIndex !== i) { paletteIndex = i; highlightPalette(); } }, onclick: () => runPalette(i)},
      c.entry ? iconFor(c.entry, 16) : el('span', {class: 'ic', html: I[c.icon] || I.chevron}),
      el('span', {class: 'pal-label', text: c.label}), c.sub ? el('span', {class: 'pal-sub', text: '\u200E' + c.sub + '\u200E'}) : null, c.keys ? el('kbd', {text: c.keys}) : null));
  });
  if (!paletteItems.length) listEl.append(el('div', {class: 'pal-empty', text: 'No matches'}));
}
function highlightPalette() { [...$('paletteList').querySelectorAll('.pal-item')].forEach((n, i) => n.classList.toggle('on', i === paletteIndex)); $('paletteList').querySelectorAll('.pal-item')[paletteIndex]?.scrollIntoView({block: 'nearest'}); }
function runPalette(i) { const c = paletteItems[i]; closePalette(); c?.run(); }
$('paletteInput').addEventListener('input', () => { paletteIndex = 0; buildPalette(); });
$('paletteInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1); highlightPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); highlightPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
});
$('palette').addEventListener('mousedown', e => { if (e.target === $('palette')) closePalette(); });

// ---------------------------------------------------------------- settings
const ACCENTS = [['blue', 'Blue'], ['mint', 'Mint'], ['teal', 'Teal'], ['violet', 'Violet'], ['rose', 'Rose'], ['amber', 'Amber'], ['graphite', 'Graphite']];
function accentPicker() {
  const box = el('div', {class: 'swatches accents'});
  for (const [id, label] of ACCENTS) {
    const b = el('button', {type: 'button', class: 'swatch accent-' + id + ((S.prefs.accent || 'blue') === id ? ' on' : ''), title: label, 'aria-label': label,
      onclick: () => { S.prefs.accent = id; box.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); applyTheme(); }});
    box.append(b);
  }
  return box;
}
async function openSettings() {
  const d = $('settingsDialog');
  const L = S.launchers;
  const pick = (id, label, options, value) => el('label', {class: 'field'}, el('span', {text: label}), el('select', {id}, options.map(([v, l]) => { const o = el('option', {value: v, text: l}); if (v === value) o.selected = true; return o; })));
  const check = (id, label, on, hint) => el('label', {class: 'check'}, el('input', {type: 'checkbox', id, checked: on}), el('span', {}, label, hint ? el('small', {text: hint}) : null));
  d.replaceChildren(el('form', {method: 'dialog', class: 'settings'},
    el('h2', {text: 'Settings'}),
    pick('setTheme', 'Appearance', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], S.prefs.theme),
    el('div', {class: 'field'}, el('span', {text: 'Accent color'}), accentPicker()),
    check('setOled', 'Pure black background (OLED)', !!S.prefs.oled, 'True black in dark mode — easier on OLED screens'),
    pick('setTerminal', 'Terminal app', L.terminals.map(x => [x.id, x.label]), S.prefs.terminal || L.terminals[0]?.id),
    pick('setEditor', 'Code editor', L.editors.map(x => [x.id, x.label]), S.prefs.editor || L.editors[0]?.id),
    check('setFolders', 'Keep folders on top', S.prefs.foldersFirst),
    check('setHidden', 'Show hidden files', S.prefs.showHidden, 'Dotfiles and system files'),
    check('setRecents', 'Show recent folders in the sidebar', S.prefs.showRecents !== false, 'Turning this off also clears the list'),
    check('setSizes', 'Show folder sizes in list view', !!S.prefs.folderSizes, 'Adds up each folder in the background'),
    el('p', {class: 'muted small', text: `Fresh Desk ${S.env.version} · part of the Utility Package. Nothing is ever deleted permanently; removals go to the ${isWin() ? 'Recycle Bin' : 'Trash'}.`}),
    el('div', {class: 'dialog-actions'}, el('button', {class: 'btn ghost', value: 'cancel', text: 'Cancel'}), el('button', {class: 'btn primary', value: 'save', text: 'Save'}))));
  const before = {accent: S.prefs.accent, oled: S.prefs.oled};
  const oledBox = d.querySelector('#setOled');
  oledBox.onchange = () => { S.prefs.oled = oledBox.checked; applyTheme(); };
  d.onclose = async () => {
    if (d.returnValue !== 'save') { Object.assign(S.prefs, before); applyTheme(); return; }
    S.prefs.oled = $('setOled').checked;
    const sizesOn = $('setSizes').checked && !S.prefs.folderSizes; S.prefs.folderSizes = $('setSizes').checked;
    if (sizesOn) sizeFolders(tab());
    const hiddenChanged = S.prefs.showHidden !== $('setHidden').checked;
    if ((S.prefs.showRecents !== false) !== $('setRecents').checked) { S.prefs.showRecents = $('setRecents').checked; if (!S.prefs.showRecents) S.prefs.recents = []; else addRecent(tab().path); }
    Object.assign(S.prefs, {theme: $('setTheme').value, terminal: $('setTerminal').value, editor: $('setEditor').value, foldersFirst: $('setFolders').checked, showHidden: $('setHidden').checked});
    applyTheme();
    await savePrefs();
    for (const x of S.tabs) refreshItems(x);
    if (hiddenChanged) await reload(); else render();
  };
  d.showModal();
}

// ---------------------------------------------------------------- status, toast, prefs, watch
function renderStatus() {
  const t = tab(); if (!t) return;
  const sel = selected();
  let left;
  if (t.search.q && t.search.deep) left = t.search.running ? `Searching… ${t.items.length} found` : `${t.items.length}${t.search.summary?.truncated ? '+' : ''} found in subfolders`;
  else if (t.search.q) left = `${t.items.length} of ${t.listing?.entries.length || 0} items`;
  else left = `${t.items.length} item${t.items.length === 1 ? '' : 's'}`;
  if (sel.length) { const size = sel.reduce((n, e) => n + (e.size || 0), 0); left += ` · ${sel.length} selected${size ? ', ' + bytes(size) : ''}`; }
  if (S.clip) left += ` · ${S.clip.paths.length} on clipboard`;
  $('statusLeft').textContent = left;
  $('statusRight').textContent = S.disk ? `${bytes(S.disk.free)} available` : '';
  $('zoom').hidden = S.prefs.view !== 'grid' || !!window.Tidy?.isOpen();
}
async function diskSpace() { S.disk = await desk.diskSpace(tab().path).catch(() => null); renderStatus(); }

let toastTimer;
function toast(message, {undo: canUndo = false, error = false} = {}) {
  const t = $('toast');
  t.replaceChildren(...[el('span', {class: 'ic', html: error ? I.warn : I.check}), el('span', {class: 'toast-msg', text: message}),
    canUndo ? el('button', {class: 'toast-btn', text: 'Undo', onclick: () => { t.hidden = true; undo(); }}) : null].filter(Boolean));
  t.className = error ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, error ? 7000 : 4200);
}

async function savePrefs() {
  S.prefs.tabs = S.tabs.map(t => t.path); S.prefs.activeTab = S.active;
  try { S.prefs = {...S.prefs, ...await desk.savePrefs(S.prefs)}; } catch {}
}
const savePrefsSoon = U.debounce(savePrefs, 600);
function watchVisible() {
  const t = tab(); const dirs = new Set(S.tabs.map(x => x.path));
  if (S.prefs.view === 'columns') crumbsFor(t.path).slice(-4).forEach(c => dirs.add(c.path));
  desk.watch([...dirs]);
}
desk.on('dir-changed', async d => {
  S.cache.delete(d);
  for (const t of S.tabs) if (t.path === d && !S.renaming) await load(t, {keep: true});
  if (S.prefs.view === 'columns' && tab().path !== d && crumbsFor(tab().path).some(c => c.path === d)) renderContent();
});
desk.on('theme', dark => { document.documentElement.classList.toggle('dark', dark); applyTheme(); });
// Accent color, pure-black (OLED) mode, and matching Windows caption buttons.
function applyTheme() {
  const root = document.documentElement;
  root.dataset.accent = S.prefs.accent || 'blue';
  root.classList.toggle('oled', !!S.prefs.oled);
  if (isWin()) {
    const cs = getComputedStyle(root);
    const hex = v => { const m = v.trim().match(/^#([0-9a-f]{6})$/i); return m ? '#' + m[1] : null; };
    const bg = hex(cs.getPropertyValue('--bg')), fg = hex(cs.getPropertyValue('--fg'));
    if (bg && fg) desk.setChrome({bg, fg});
  }
}
desk.on('open-path', async p => {
  const info = await desk.info(p).catch(() => null); if (!info) return;
  if (info.isDir) navigate(p, {newTab: true}); else navigate(U.dirname(p, sep()), {newTab: true, select: p});
});

// ---------------------------------------------------------------- resizers, toolbar wiring
function resizer(handle, prop, min, max, invert) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const start = e.clientX, from = S.prefs[prop];
    const move = ev => { S.prefs[prop] = Math.max(min, Math.min(max, from + (ev.clientX - start) * (invert ? -1 : 1))); applyWidths(); };
    const upFn = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', upFn); savePrefsSoon(); document.body.classList.remove('resizing'); };
    document.body.classList.add('resizing');
    addEventListener('mousemove', move); addEventListener('mouseup', upFn);
  });
}
function applyWidths() {
  document.documentElement.style.setProperty('--side-w', `${S.prefs.sidebarWidth}px`);
  document.documentElement.style.setProperty('--preview-w', `${S.prefs.previewWidth}px`);
}

function wire() {
  hydrateIcons();
  $('back').onclick = back; $('forward').onclick = forward;
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  $('tbTerminal').onclick = () => command('terminal');
  $('tbPreview').onclick = () => command('togglePreview');
  $('tbMore').onclick = moreMenu;
  $('sideTidy').onclick = () => command('tidy');
  $('sideSettings').onclick = openSettings;
  $('search').addEventListener('input', () => { tab().search.q = $('search').value; runFilter(); });
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const t = tab(); if (!t.search.deep) { t.search.deep = true; renderToolbar(); } startDeepSearch(); }
    if (e.key === 'Escape') { e.preventDefault(); clearSearch(); $('content').focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('content').focus(); moveCursor(tab(), 1, false); }
  });
  $('deepToggle').onclick = e => { e.preventDefault(); const t = tab(); t.search.deep = !t.search.deep; t.search.results = null; if (t.search.deep && t.search.q) startDeepSearch(); else { if (t.search.id) desk.cancel(t.search.id); refreshItems(t); render(); } };
  $('pathInput').addEventListener('keydown', async e => {
    if (e.key === 'Escape') { endEditPath(); $('content').focus(); }
    if (e.key === 'Enter') {
      const v = $('pathInput').value.trim().replace(/^~(?=$|[\\/])/, S.env.home);
      const info = await desk.info(v).catch(() => null);
      if (!info) { toast(`Can’t find “${v}”`, {error: true}); return; }
      endEditPath();
      if (info.isDir) navigate(v); else navigate(U.dirname(v, sep()), {select: v});
    }
  });
  $('pathInput').addEventListener('blur', endEditPath);
  $('zoom').addEventListener('input', () => { S.prefs.iconSize = +$('zoom').value; renderContent(); savePrefsSoon(); });
  $('content').addEventListener('focus', () => document.body.classList.add('content-focus'));
  $('content').addEventListener('blur', () => document.body.classList.remove('content-focus'));
  resizer($('sideResizer'), 'sidebarWidth', 160, 340, false);
  resizer($('previewResizer'), 'previewWidth', 220, 520, true);
  window.addEventListener('focus', () => document.body.classList.remove('blurred'));
  window.addEventListener('blur', () => document.body.classList.add('blurred'));
  // Double-click the toolbar's empty space to zoom the window on macOS.
  $('toolbar').addEventListener('dblclick', e => { if (e.target === $('toolbar')) desk.editCmd?.('zoomWindow'); });
}

async function start() {
  S.env = await desk.init();
  S.prefs = S.env.prefs;
  document.body.classList.add(S.env.platform);
  document.documentElement.classList.toggle('dark', S.env.dark);
  applyTheme();
  applyWidths();
  $('zoom').value = S.prefs.iconSize;
  wire();
  const [places, launchers] = await Promise.all([desk.places(), desk.launchers().catch(() => ({terminals: [], editors: []}))]);
  S.places = places; S.launchers = launchers;
  const restore = (S.prefs.tabs || []).filter(Boolean);
  const start = restore.length ? restore : [S.env.paths.home];
  for (const p of start) newTab(p, {activate: false});
  S.active = Math.min(Math.max(0, S.prefs.activeTab || 0), S.tabs.length - 1);
  for (const p of S.env.open || []) desk.on && (await (async () => { const info = await desk.info(p).catch(() => null); if (info) navigate(info.isDir ? p : U.dirname(p, sep()), {newTab: true, select: info.isDir ? null : p}); })());
  render();
  $('content').focus();
}
window.App = {shareItems, S, tab, navigate, render, renderStatus, renderPlaces, savePrefsSoon, pin, pinPath, favorites, toast, err, reload, iconFor, btn, command, isMac, isWin, sep, selected, refreshItems, short};
start().catch(e => { document.body.textContent = 'Fresh Desk could not start: ' + e.message; });

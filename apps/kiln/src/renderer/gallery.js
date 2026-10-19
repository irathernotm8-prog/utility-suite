/* Kiln — Gallery: this profile's images, with their settings and quick reuse. */
(() => {
  const { $, $$, esc } = K;
  let el = null;
  const st = { items: [], total: 0, folders: [], folder: '', q: '', fav: false, offset: 0, size: 190, selecting: false, sel: new Set(), viewer: null };
  const PAGE = 150;

  function mount(e) {
    el = e;
    el.innerHTML = `<div class="gal-bar">
        <div class="search" style="flex:1;max-width:380px">${ic('search', 15)}<input class="input" id="galQ" placeholder="Search prompts and file names"></div>
        <select class="input" id="galF" style="width:auto;min-width:150px"></select>
        <button class="chip" id="galFav">${ic('heart', 13)} Favorites</button>
        <div class="spacer"></div>
        <input type="range" id="galSize" min="120" max="340" value="190" style="width:110px;accent-color:var(--celadon)" title="Thumbnail size">
        <button class="btn sm" id="galSel">${ic('check', 13)} Select</button>
        <button class="btn sm" id="galFolder">${ic('folder', 13)} Open folder</button>
      </div>
      <div class="scroll" id="galScroll"><div class="gal-grid" id="galGrid"></div><div class="load-more" id="galMore"></div></div>`;
    $('#galQ', el).oninput = K.debounce((ev) => { st.q = ev.target.value; load(true); }, 250);
    $('#galF', el).onchange = (ev) => { st.folder = ev.target.value; load(true); };
    $('#galFav', el).onclick = () => { st.fav = !st.fav; $('#galFav', el).classList.toggle('on', st.fav); load(true); };
    $('#galSize', el).oninput = (ev) => { st.size = Number(ev.target.value); $('#galGrid', el).style.setProperty('--gsize', st.size + 'px'); };
    $('#galSel', el).onclick = () => toggleSelect();
    $('#galFolder', el).onclick = () => kiln.gal.openFolder();
    $('#galScroll', el).onscroll = (ev) => { const s = ev.target; if (s.scrollTop + s.clientHeight > s.scrollHeight - 600 && st.items.length < st.total && !st.loading) more(); };
  }
  function reset() { st.items = []; st.folder = ''; st.q = ''; st.fav = false; st.sel.clear(); st.selecting = false; }

  async function load(resetList = false, force = false) {
    if (resetList) { st.offset = 0; st.items = []; }
    st.loading = true;
    const r = await kiln.gal.list({ offset: 0, limit: Math.max(PAGE, st.items.length || PAGE), folder: st.folder, query: st.q, favorites: st.fav, force });
    st.items = r.items; st.total = r.total; st.folders = r.folders; st.root = r.root;
    st.loading = false;
    render();
  }
  async function more() {
    st.loading = true;
    const r = await kiln.gal.list({ offset: st.items.length, limit: PAGE, folder: st.folder, query: st.q, favorites: st.fav });
    st.items.push(...r.items);
    st.loading = false;
    render();
  }
  function render() {
    const f = $('#galF', el);
    f.innerHTML = `<option value="">All folders</option>` + st.folders.map(x => `<option value="${esc(x)}" ${x === st.folder ? 'selected' : ''}>${esc(x)}</option>`).join('');
    const grid = $('#galGrid', el);
    grid.classList.toggle('selecting', st.selecting);
    if (!st.items.length) {
      grid.innerHTML = '';
      $('#galMore', el).innerHTML = `<div class="empty">${ic('image', 44)}<h3>${st.q || st.fav || st.folder ? 'Nothing matches' : 'Your gallery is empty'}</h3><p>${st.q || st.fav || st.folder ? 'Try a different search or folder.' : 'Images you make in Kiln, or in a package’s own web UI, land here for this profile.'}</p>${st.q || st.fav || st.folder ? '' : `<button class="btn primary" id="galGen">${ic('wand', 15)} Generate something</button>`}</div>`;
      $('#galGen', el)?.addEventListener('click', () => K.go('generate'));
      return;
    }
    grid.innerHTML = st.items.map((i, n) => `<button class="gal-item ${st.sel.has(i.path) ? 'sel' : ''}" data-n="${n}" title="${esc(i.name)}"><img src="${kiln.file(i.path, st.size > 220 ? 512 : 320)}" loading="lazy" alt="" data-fallback draggable="true"><span class="check"></span>${i.favorite ? `<span class="fav">${ic('heart', 15)}</span>` : ''}</button>`).join('');
    $('#galMore', el).innerHTML = st.items.length < st.total ? `<span class="muted small">${st.items.length} of ${st.total}</span>` : `<span class="muted small">${st.total} image${st.total === 1 ? '' : 's'}</span>`;
    $$('.gal-item', grid).forEach(b => {
      const it = st.items[Number(b.dataset.n)];
      b.onclick = (e) => { if (st.selecting || e.shiftKey || e.ctrlKey || e.metaKey) { if (!st.selecting) toggleSelect(true); st.sel.has(it.path) ? st.sel.delete(it.path) : st.sel.add(it.path); b.classList.toggle('sel'); selBar(); } else openViewer(Number(b.dataset.n)); };
      b.oncontextmenu = (e) => { e.preventDefault(); itemMenu(it, e.clientX, e.clientY); };
      $('img', b).ondragstart = (e) => { e.preventDefault(); kiln.gal.startDrag(it.path); };
    });
  }
  function toggleSelect(on) {
    st.selecting = on ?? !st.selecting;
    if (!st.selecting) st.sel.clear();
    $('#galSel', el).classList.toggle('primary', st.selecting);
    render(); selBar();
  }
  function selBar() {
    const b = $('#galSel', el);
    b.innerHTML = st.selecting ? `${ic('x', 13)} Done${st.sel.size ? ` (${st.sel.size})` : ''}` : `${ic('check', 13)} Select`;
    let bar = $('#galSelBar', el);
    if (st.selecting && st.sel.size) {
      if (!bar) { bar = document.createElement('div'); bar.id = 'galSelBar'; bar.className = 'stage-actions'; bar.style.cssText = 'position:absolute;left:50%;right:auto;top:auto;bottom:18px;transform:translateX(-50%)'; el.appendChild(bar); }
      bar.innerHTML = `<button class="btn sm" id="gsFav">${ic('heart', 13)} Favorite</button><button class="btn sm danger" id="gsDel">${ic('trash', 13)} Move ${st.sel.size} to trash</button>`;
      $('#gsFav', bar).onclick = async () => { for (const p of st.sel) await kiln.gal.favorite(p, true); toggleSelect(false); load(); };
      $('#gsDel', bar).onclick = async () => { if (!await K.confirm(`Move ${st.sel.size} image${st.sel.size > 1 ? 's' : ''} to the trash?`, '', { ok: 'Move to trash', danger: true })) return; await kiln.gal.remove([...st.sel]); toggleSelect(false); load(true, true); };
    } else bar?.remove();
  }
  function itemMenu(it, x, y) {
    K.menu(x, y, [
      { label: 'Open', icon: 'expand', onClick: () => openViewer(st.items.indexOf(it)) },
      { label: 'Use these settings in Generate', icon: 'history', onClick: () => reuse(it.path) },
      { label: 'Use as starting image', icon: 'image', onClick: () => asInit(it.path) },
      { label: it.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', onClick: () => fav(it) },
      { label: 'Copy image', icon: 'copy', onClick: () => kiln.gal.copy(it.path).then(() => K.toast('Copied', 'ok')) },
      { label: 'Show in folder', icon: 'folder', onClick: () => kiln.gal.show(it.path) }, '-',
      { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => del(it) }
    ]);
  }
  async function reuse(p) { const d = await kiln.gal.details(p); K.go('generate', { reuse: d }); K.toast('Settings loaded into Generate'); }
  async function asInit(p) { K.go('generate', { init: await kiln.gal.dataUrl(p) }); }
  async function fav(it) { it.favorite = await kiln.gal.favorite(it.path, !it.favorite); render(); if (st.viewer) renderViewer(); }
  async function del(it) { await kiln.gal.remove(it.path); const i = st.items.indexOf(it); st.items.splice(i, 1); st.total--; render(); if (st.viewer) { if (!st.items.length) closeViewer(); else { st.viewer.n = Math.min(i, st.items.length - 1); renderViewer(); } } K.toast('Moved to the trash'); }

  /* ---------- viewer ---------- */
  function openViewer(n) {
    closeViewer();
    const v = document.createElement('div');
    v.className = 'viewer';
    document.body.appendChild(v);
    st.viewer = { el: v, n };
    renderViewer();
    document.addEventListener('keydown', viewerKey);
  }
  function closeViewer() { st.viewer?.el.remove(); st.viewer = null; document.removeEventListener('keydown', viewerKey); }
  function viewerKey(e) {
    if (!st.viewer || e.target.closest('input, textarea')) return;
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'Delete') del(st.items[st.viewer.n]);
    if (e.key.toLowerCase() === 'f') fav(st.items[st.viewer.n]);
  }
  function step(d) { const n = st.viewer.n + d; if (n < 0 || n >= st.items.length) return; st.viewer.n = n; renderViewer(); if (n > st.items.length - 10 && st.items.length < st.total) more(); }
  async function renderViewer() {
    const v = st.viewer; if (!v) return;
    const it = st.items[v.n];
    v.el.innerHTML = `<div class="viewer-img"><button class="icon-btn viewer-close" title="Close (Esc)">${ic('x', 20)}</button>
        ${v.n > 0 ? `<button class="viewer-nav l" data-d="-1">${ic('chevronLeft', 20)}</button>` : ''}
        <img src="${kiln.file(it.path)}" alt="" draggable="true">
        ${v.n < st.items.length - 1 ? `<button class="viewer-nav r" data-d="1">${ic('chevronRight', 20)}</button>` : ''}</div>
      <div class="viewer-side"><div class="scroll" id="vSide"><div class="row"><span class="spinner"></span></div></div></div>`;
    $('.viewer-close', v.el).onclick = closeViewer;
    $$('[data-d]', v.el).forEach(b => b.onclick = () => step(Number(b.dataset.d)));
    $('.viewer-img img', v.el).ondragstart = (e) => { e.preventDefault(); kiln.gal.startDrag(it.path); };
    const d = await kiln.gal.details(it.path);
    if (st.viewer !== v || st.items[v.n] !== it) return;
    const s = d.settings || {};
    const keys = Object.keys(s).filter(k => s[k] !== undefined && s[k] !== null && s[k] !== '' && !/^(positive|negative|_)/.test(k) && typeof s[k] !== 'object');
    $('#vSide', v.el).innerHTML = `
      <div class="row" style="margin-bottom:14px"><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</b><button class="icon-btn ${it.favorite ? 'on' : ''}" id="vFav" title="Favorite (F)">${ic('heart', 17)}</button></div>
      <div class="row wrap" style="margin-bottom:16px">
        <button class="btn sm primary" id="vReuse">${ic('history', 13)} Use settings</button>
        <button class="btn sm" id="vInit">${ic('image', 13)} Use as start</button>
        <button class="btn sm" id="vCopy">${ic('copy', 13)} Copy</button>
        <button class="btn sm" id="vShow">${ic('folder', 13)} Show</button>
        <button class="btn sm danger" id="vDel" title="Move to trash (Delete)">${ic('trash', 13)}</button>
      </div>
      ${d.positive ? `<div class="field"><span class="row">Prompt<span class="spacer"></span><button class="btn ghost sm" id="vCpP">${ic('copy', 12)} Copy</button><button class="btn ghost sm" id="vSvP">${ic('bookmark', 12)} Save</button></span><div class="prompt-read">${esc(d.positive)}</div></div>` : `<p class="muted">No prompt saved in this image.</p>`}
      ${d.negative ? `<div class="field"><span>Leave out</span><div class="prompt-read">${esc(d.negative)}</div></div>` : ''}
      <dl class="kv">${d.width ? `<dt>Pixels</dt><dd>${d.width} × ${d.height}</dd>` : ''}${keys.map(k => `<dt>${esc(k)}</dt><dd>${esc(String(s[k]))}</dd>`).join('')}<dt>Saved</dt><dd>${new Date(it.mtime).toLocaleString()}</dd><dt>File</dt><dd>${K.fmtBytes(it.size)} · ${esc(it.folder || 'outputs')}</dd></dl>`;
    const side = $('#vSide', v.el);
    $('#vFav', side).onclick = () => fav(it);
    $('#vReuse', side).onclick = () => { closeViewer(); K.go('generate', { reuse: d }); };
    $('#vInit', side).onclick = () => { closeViewer(); asInit(it.path); };
    $('#vCopy', side).onclick = () => kiln.gal.copy(it.path).then(() => K.toast('Copied', 'ok'));
    $('#vShow', side).onclick = () => kiln.gal.show(it.path);
    $('#vDel', side).onclick = () => del(it);
    $('#vCpP', side)?.addEventListener('click', () => { navigator.clipboard.writeText(d.positive); K.toast('Prompt copied', 'ok'); });
    $('#vSvP', side)?.addEventListener('click', () => window.Prompts.edit({ positive: d.positive, negative: d.negative }));
  }

  async function show(prm = {}) {
    $('#galGrid', el).style.setProperty('--gsize', st.size + 'px');
    await load(false, true);
    if (prm.open) { const n = st.items.findIndex(i => i.path === prm.open); if (n >= 0) openViewer(n); }
  }

  K.register('gallery', { title: 'Gallery', mount, show, reset, hide: closeViewer });
})();

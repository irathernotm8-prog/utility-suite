/* Relay — Downloads tab */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const d = { list: [], filter: 'all', query: '', folder: '', el: null, side: null, loaded: false };

  const KINDS = {
    video:   { label: 'Video',     icon: 'film',    color: '#e5484d' },
    audio:   { label: 'Audio',     icon: 'music',   color: '#a855f7' },
    image:   { label: 'Images',    icon: 'image',   color: '#10b5a0' },
    comic:   { label: 'Comics',    icon: 'book',    color: '#f97316' },
    pdf:     { label: 'PDFs',      icon: 'file',    color: '#ef4444' },
    doc:     { label: 'Documents', icon: 'note',    color: '#1f7bff' },
    archive: { label: 'Archives',  icon: 'archive', color: '#64748b' },
    other:   { label: 'Other',     icon: 'file',    color: '#8a869b' }
  };
  const FILTERS = [
    ['all', 'All downloads', 'download'], ['active', 'In progress', 'refresh'],
    ['media', 'Video & audio', 'film'], ['reading', 'Images, comics & PDFs', 'book'],
    ['doc', 'Documents', 'note'], ['archive', 'Archives', 'archive'], ['other', 'Other', 'file']
  ];
  const playable = (x) => x.kind === 'video' || x.kind === 'audio';
  const readable = (x) => x.kind === 'image' || x.kind === 'comic' || x.kind === 'pdf' || (x.kind === 'archive' && /\.zip$/i.test(x.name));
  const isActive = (x) => x.state === 'progressing' || x.state === 'paused';
  function matches(x, f) {
    if (f === 'all') return true;
    if (f === 'active') return isActive(x);
    if (f === 'media') return playable(x);
    if (f === 'reading') return x.kind === 'image' || x.kind === 'comic' || x.kind === 'pdf';
    return x.kind === f;
  }
  function size(n) {
    if (!n && n !== 0) return '';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
  }
  function dayLabel(ts) {
    const dt = new Date(ts), now = new Date();
    const a = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()), b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((b - a) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? dt.toLocaleDateString(undefined, { weekday: 'long' }) : dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: dt.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  async function load() {
    [d.list, d.folder] = await Promise.all([relay.downloads.list(), relay.downloads.folder()]);
    d.loaded = true;
  }
  function activeCount() { return d.list.filter(isActive).length; }

  /* ---------- sidebar ---------- */
  function renderSidebar(side) {
    if (!side) return;
    d.side = side;
    if (R().state.ui.platform !== 'downloads') return;
    const short = d.folder.replace(/^\/Users\/[^/]+/, '~');
    side.innerHTML = `<div class="home-side">
      <nav class="side-nav">${FILTERS.map(([k, l, i]) => {
        const n = d.list.filter(x => matches(x, k)).length;
        return `<button data-f="${k}" class="${d.filter === k ? 'active' : ''}">${ic(i, 17)}<span>${l}</span>${n ? `<span class="pill">${n}</span>` : ''}</button>`;
      }).join('')}</nav>
      <div class="dl-folder">
        <div class="side-title" style="padding:0 0 8px">Saving to</div>
        <button class="dl-path" id="dlOpenFolder" title="${esc(d.folder)}">${ic('folder', 16)}<span>${esc(short)}</span></button>
        <div class="dl-folder-actions">
          <button class="btn ghost" id="dlChange">Change…</button>
          <button class="btn ghost" id="dlClear">Clear history</button>
        </div>
      </div>
    </div>`;
    $$('[data-f]', side).forEach(b => b.onclick = () => { d.filter = b.dataset.f; renderSidebar(side); render(d.el); });
    $('#dlOpenFolder', side).onclick = () => relay.downloads.openFolder();
    $('#dlChange', side).onclick = async () => { const f = await relay.downloads.chooseFolder(); if (f) { d.folder = f; R().toast('New downloads will be saved to ' + f.replace(/^\/Users\/[^/]+/, '~')); renderSidebar(side); } };
    $('#dlClear', side).onclick = () => R().openModal({
      title: 'Clear download history?', subtitle: 'Your files stay where they are — only the list in Relay is cleared.', icon: 'download', color: 'var(--downloads)', body: '',
      actions: [{ label: 'Cancel' }, { label: 'Only missing files', onClick: async () => { d.list = await relay.downloads.clear('missing'); refresh(); } }, { label: 'Clear all', cls: 'brand', style: '--c:var(--downloads)', onClick: async () => { d.list = await relay.downloads.clear('all'); refresh(); } }]
    });
  }

  /* ---------- main ---------- */
  async function render(el) {
    if (!el) return;
    d.el = el;
    if (R().state.ui.platform !== 'downloads') return;
    if (!d.loaded) { await load(); renderSidebar(d.side || $('#sidebar')); }
    const q = d.query.trim().toLowerCase();
    const items = d.list.filter(x => matches(x, d.filter) && (!q || x.name.toLowerCase().includes(q) || (x.sourceLabel || '').toLowerCase().includes(q)));
    const groups = [];
    for (const x of items) {
      const g = dayLabel(x.startedAt);
      if (!groups.length || groups[groups.length - 1].label !== g) groups.push({ label: g, items: [] });
      groups[groups.length - 1].items.push(x);
    }
    const keepFocus = document.activeElement?.id === 'dlSearch';
    el.innerHTML = `<div class="home-scroll dl-view">
      <header class="brief-head">
        <div>
          <div class="hero-date">${ic('download', 14)} Downloads</div>
          <h1>${activeCount() ? `Downloading ${activeCount()} file${activeCount() === 1 ? '' : 's'}…` : 'Everything you’ve downloaded'}</h1>
          <p>Files from your inboxes, storage, the browser and the player all land in one folder. Videos and audio can open in Relay Player; images, comics and PDFs in Relay Reader.</p>
        </div>
        <div class="hero-actions">
          <div class="search">${ic('search', 15)}<input id="dlSearch" placeholder="Search downloads" value="${esc(d.query)}"></div>
          <button class="btn" id="dlFolderBtn">${ic('folder', 15)} Open folder</button>
        </div>
      </header>
      ${groups.length ? groups.map(g => `
        <section class="dl-group">
          <div class="dl-day">${esc(g.label)}</div>
          <div class="dl-list">${g.items.map(rowHTML).join('')}</div>
        </section>`).join('') : `<div class="card-empty tall card">${ic('download', 24)}<span>${d.list.length ? 'Nothing matches.' : 'Nothing downloaded yet. Attachments, files from Drive or Dropbox, and anything you save in the browser will show up here.'}</span></div>`}
    </div>`;
    const s = $('#dlSearch', el);
    s.oninput = () => { d.query = s.value; render(el); };
    if (keepFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    $('#dlFolderBtn', el).onclick = () => relay.downloads.openFolder();
    bind(el);
  }

  function rowHTML(x) {
    const K = KINDS[x.kind] || KINDS.other;
    const pct = x.total ? Math.min(100, Math.round(x.received / x.total * 100)) : 0;
    const missing = x.state === 'completed' && x.exists === false;
    const status = isActive(x)
      ? `${size(x.received)}${x.total ? ` of ${size(x.total)}` : ''} · ${x.state === 'paused' ? 'Paused' : pct + '%'}`
      : x.state === 'completed' ? `${size(x.total || x.received)}${missing ? ' · <b class="warn">File moved or deleted</b>' : ''}`
      : x.state === 'cancelled' ? 'Cancelled' : 'Failed';
    const primary = !isActive(x) && x.state === 'completed' && !missing
      ? playable(x) ? `<button class="btn brand sm-btn" data-play="${x.id}" style="--c:${K.color}">${ic('play', 13)} Play</button>`
      : readable(x) ? `<button class="btn brand sm-btn" data-read="${x.id}" style="--c:${K.color}">${ic('book', 13)} Read</button>`
      : `<button class="btn sm-btn" data-open="${x.id}">Open</button>` : '';
    return `<div class="dl-row ${missing ? 'missing' : ''} ${x.state}" data-id="${x.id}" ${x.state === 'completed' && !missing ? 'draggable="true" title="Drag into any page to upload it"' : ''}>
      <span class="dl-ic" style="--c:${K.color}">${ic(K.icon, 18)}</span>
      <div class="dl-main">
        <div class="dl-name" title="${esc(x.name)}">${esc(x.name)}</div>
        <div class="dl-meta">${status}${x.sourceLabel ? ` · <span class="dl-src" style="--c:${esc(x.sourceColor || 'var(--muted)')}"><i></i>${esc(x.sourceLabel)}</span>` : ''} · ${new Date(x.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
        ${isActive(x) ? `<div class="dl-bar"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      <div class="dl-actions">
        ${isActive(x) ? `<button class="icon-btn sm" data-ctl="${x.state === 'paused' ? 'resume' : 'pause'}|${x.id}" title="${x.state === 'paused' ? 'Resume' : 'Pause'}">${ic(x.state === 'paused' ? 'play' : 'pause', 14)}</button>
          <button class="icon-btn sm" data-ctl="cancel|${x.id}" title="Cancel">${ic('x', 14)}</button>` : ''}
        ${primary}
        ${!isActive(x) && !missing && x.state === 'completed' ? `<button class="icon-btn sm" data-show="${x.id}" title="Show in Finder">${ic('folder', 15)}</button>` : ''}
        <button class="icon-btn sm" data-more="${x.id}" title="More">${ic('dots', 16)}</button>
      </div>
    </div>`;
  }

  function bind(el) {
    const get = (id) => d.list.find(x => x.id === id);
    $$('[data-play]', el).forEach(b => b.onclick = () => { const x = get(b.dataset.play); window.Player?.open({ src: x.path, title: x.name, kind: x.kind }); });
    $$('[data-read]', el).forEach(b => b.onclick = () => window.Reader?.open(get(b.dataset.read).path));
    $$('[data-open]', el).forEach(b => b.onclick = async () => { const r = await relay.downloads.open(b.dataset.open); if (r) R().toast(r, 'error'); });
    $$('[data-show]', el).forEach(b => b.onclick = () => relay.downloads.show(b.dataset.show));
    $$('[data-ctl]', el).forEach(b => b.onclick = () => { const [a, id] = b.dataset.ctl.split('|'); relay.downloads.control(id, a); });
    $$('.dl-row[draggable]', el).forEach(r => r.ondragstart = (e) => { e.preventDefault(); relay.startDrag(get(r.dataset.id).path); });
    $$('.dl-row', el).forEach(r => r.ondblclick = (e) => { if (!e.target.closest('button')) { const x = get(r.dataset.id); if (x.state === 'completed') primaryAction(x); } });
    $$('[data-more]', el).forEach(b => b.onclick = (e) => {
      const x = get(b.dataset.more);
      const r = e.currentTarget.getBoundingClientRect();
      const done = x.state === 'completed' && x.exists !== false;
      R().popMenu(r.right - 230, r.bottom + 4, [
        ...(done && playable(x) ? [{ label: 'Play in Relay Player', icon: 'play', onClick: () => window.Player?.open({ src: x.path, title: x.name, kind: x.kind }) }] : []),
        ...(done && readable(x) ? [{ label: 'Read in Relay Reader', icon: 'book', onClick: () => window.Reader?.open(x.path) }] : []),
        ...(done && (playable(x) || readable(x)) && !x.inLibrary ? [{ label: 'Move to Library', icon: 'library', onClick: async () => { if (await window.Library?.addFromDownload(x.path, x.name)) { d.list = await relay.downloads.list(); refresh(); } } }] : []),
        ...(done ? [{ label: 'Open with default app', icon: 'external', onClick: () => relay.downloads.open(x.id) }, { label: 'Show in Finder', icon: 'folder', onClick: () => relay.downloads.show(x.id) }] : []),
        ...(x.url && /^https?:/.test(x.url) ? [{ label: 'Copy download link', icon: 'link', onClick: () => { navigator.clipboard.writeText(x.url); R().toast('Link copied'); } }] : []),
        '-',
        { label: 'Remove from history', icon: 'x', onClick: async () => { d.list = await relay.downloads.remove(x.id); refresh(); } },
        ...(x.exists !== false ? [{ label: 'Move file to Trash', icon: 'trash', danger: true, onClick: async () => { d.list = await relay.downloads.del(x.id); refresh(); R().toast('Moved to Trash'); } }] : [])
      ]);
    });
  }
  function primaryAction(x) {
    if (playable(x)) window.Player?.open({ src: x.path, title: x.name, kind: x.kind });
    else if (readable(x)) window.Reader?.open(x.path);
    else relay.downloads.open(x.id);
  }

  function refresh() { R().renderTabs?.(); renderSidebar(d.side); render(d.el); }

  // live progress
  relay.downloads.onUpdate((item) => {
    const i = d.list.findIndex(x => x.id === item.id);
    if (i >= 0) d.list[i] = item; else d.list.unshift(item);
    R().renderTabs?.();
    if (R().state.ui.platform !== 'downloads') return;
    const row = d.el && $(`.dl-row[data-id="${item.id}"]`, d.el);
    if (row && isActive(item)) {
      const tmp = document.createElement('div'); tmp.innerHTML = rowHTML(item);
      row.replaceWith(tmp.firstElementChild); bind(d.el);
    } else render(d.el);
    renderSidebar(d.side);
  });
  load().then(() => R().renderTabs?.());

  window.Downloads = { render, renderSidebar, activeCount, primaryAction, find: (path) => d.list.find(x => x.path === path) };
})();

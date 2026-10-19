// Crate — app shell: state, layout, navigation, player, dialogs
const api = window.crate;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const fmtLong = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`; };
const fmtSize = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const S = {
  app: null, settings: {}, tracks: [], byId: new Map(), albums: [], playlists: [], stats: {}, root: '',
  view: { name: 'songs', arg: null }, sel: new Set(), anchor: null, query: '', sort: { key: 'addedAt', dir: -1 },
  jobs: [], inspector: false, toolsBusy: false
};
const viewRenderers = {};

/* ---------------- data ---------------- */
async function refresh() {
  const snap = await api.call('lib:snapshot');
  S.tracks = snap.tracks; S.albums = snap.albums; S.playlists = snap.playlists; S.stats = snap.stats; S.root = snap.root;
  S.byId = new Map(S.tracks.map((t) => [t.id, t]));
  for (const id of [...S.sel]) if (!S.byId.has(id)) S.sel.delete(id);
  renderRail();
  // don't rebuild pages with text fields the user may be typing in
  if (S.view.name === 'download') Download.paintResults();
  else if (S.view.name !== 'settings') renderView({ keepScroll: true });
  if (window.Inspector) Inspector.render();
  Player.sync();
}

function artUrl(t, v) { return t && t.hasArt ? `crate://art/${t.id}?v=${v ?? t.artV ?? 0}` : ''; }
function artEl(t, cls = '', size = '') {
  const u = artUrl(t);
  return `<div class="art ${u ? '' : 'ph'} ${cls}" ${size ? `style="width:${size}px;height:${size}px"` : ''}>${u ? `<img src="${u}" loading="lazy" draggable="false" alt="">` : ''}</div>`;
}
function albumOf(t) {
  const k = `${(t.albumArtist || primaryArtist(t.artist) || '').toLowerCase()}\u0000${(t.album || '').toLowerCase()}`;
  return S.albums.find((a) => a.key === k);
}
const primaryArtist = (a) => String(a || '').split(/\s*(?:,|&| x | and |;|\/)\s*/i)[0].trim();
function needsAttention(t) {
  const issues = [];
  if (!t.artist) issues.push('No artist');
  if (!t.hasArt) issues.push('No artwork');
  if (!t.album) issues.push('No album');
  if (t.album && !t.track) issues.push('No track number');
  if (/official|lyric|video|\(audio\)|\[|\|/i.test(t.title)) issues.push('Messy title');
  return issues;
}

/* ---------------- layout ---------------- */
function mount() {
  const plat = api.platform === 'darwin' ? 'mac' : api.platform === 'win32' ? 'win' : 'linux';
  document.getElementById('app').innerHTML = `
    <div class="app ${plat}" id="shell">
      <header class="titlebar">
        <div class="brand"><img class="brand-mark" src="crate-mark.svg" alt="">Crate</div>
        <label class="search">${icon('search', 16)}<input id="q" placeholder="Search songs, artists, albums" spellcheck="false"></label>
        <div class="tb-right">
          <button class="tb-btn" id="tb-dl" title="Download (⌘D)">${icon('download')}<span>Download</span><span class="badge" id="dl-badge" hidden></span></button>
          <button class="tb-btn" id="tb-insp" title="Info & edit">${icon('panel')}</button>
        </div>
      </header>
      <nav class="rail" id="rail"></nav>
      <main class="main" id="main"></main>
      <aside class="inspector" id="inspector"></aside>
      <footer class="player" id="player"></footer>
    </div>`;
  $('#q').addEventListener('input', (e) => { S.query = e.target.value; if (!['songs', 'albums', 'artists', 'attention', 'recent', 'loved', 'playlist'].includes(S.view.name)) go('songs'); else renderView(); });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; S.query = ''; renderView(); e.target.blur(); } });
  $('#tb-dl').onclick = () => go('download');
  $('#tb-insp').onclick = () => toggleInspector();
}

function toggleInspector(force) {
  S.inspector = force ?? !S.inspector;
  $('#shell').classList.toggle('insp-open', S.inspector);
  $('#tb-insp').classList.toggle('on', S.inspector);
  if (S.inspector) Inspector.render();
}

function renderRail() {
  const att = S.tracks.filter((t) => needsAttention(t).length).length;
  const active = S.jobs.filter((j) => ['queued', 'working'].includes(j.status)).length;
  const recentCut = Date.now() - 14 * 864e5;
  const n = (name, ic, label, extra = '', arg = null) => {
    const on = S.view.name === name && (arg == null || S.view.arg === arg);
    return `<button class="nav ${on ? 'on' : ''}" data-go="${name}" ${arg ? `data-arg="${esc(arg)}"` : ''}>${icon(ic)}<span class="label">${esc(label)}</span>${extra}</button>`;
  };
  $('#rail').innerHTML = `
    <h6>Library</h6>
    ${n('songs', 'music', 'Songs', `<span class="count">${S.tracks.length}</span>`)}
    ${n('albums', 'disc', 'Albums', `<span class="count">${S.albums.length}</span>`)}
    ${n('artists', 'mic', 'Artists')}
    ${n('recent', 'clock', 'Recently added', `<span class="count">${S.tracks.filter((t) => t.addedAt > recentCut).length || ''}</span>`)}
    ${n('loved', 'heart', 'Loved', `<span class="count">${S.tracks.filter((t) => t.loved).length || ''}</span>`)}
    ${n('attention', 'alert', 'Needs a touch-up', att ? `<span class="count" style="color:var(--gold)">${att}</span>` : '')}
    <h6>Get & send</h6>
    ${n('download', 'download', 'Download', active ? `<span class="badge">${active}</span>` : '')}
    ${n('export', 'phone', 'Send to phone')}
    <h6>Playlists <button id="new-pl" title="New playlist">${icon('plus', 15)}</button></h6>
    ${S.playlists.map((p) => n('playlist', 'list', p.name, `<span class="count">${p.trackIds.length || ''}</span>`, p.id)).join('') || '<div class="rail-foot" style="padding-top:2px">Drag songs here, or press + to make one.</div>'}
    <div class="spacer"></div>
    ${n('settings', 'settings', 'Settings')}
    <div class="rail-foot">${plural(S.stats.tracks || 0, 'song')} · ${fmtLong(S.stats.duration)} · ${fmtSize(S.stats.size || 0)}</div>`;
  $$('#rail [data-go]').forEach((b) => {
    b.onclick = () => go(b.dataset.go, b.dataset.arg || null);
    if (b.dataset.go === 'playlist') {
      b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('crate/tracks')) { e.preventDefault(); b.classList.add('drop'); } });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', async (e) => {
        b.classList.remove('drop');
        const ids = JSON.parse(e.dataTransfer.getData('crate/tracks') || '[]');
        if (!ids.length) return;
        e.preventDefault(); e.stopPropagation();
        await api.call('lib:playlist-save', { id: b.dataset.arg, add: ids });
        toast(`Added ${plural(ids.length, 'song')} to ${S.playlists.find((p) => p.id === b.dataset.arg)?.name || 'the playlist'}`);
      });
      b.oncontextmenu = (e) => { e.preventDefault(); playlistMenu(e, b.dataset.arg); };
    }
  });
  const np = $('#new-pl'); if (np) np.onclick = (e) => { e.stopPropagation(); newPlaylist(); };
  const badge = $('#dl-badge'); badge.hidden = !active; badge.textContent = active;
}

async function newPlaylist(addIds = []) {
  const name = await prompt_('New playlist', 'Name', '', 'Create');
  if (!name) return;
  const p = await api.call('lib:playlist-save', { name, add: addIds });
  go('playlist', p.id);
}

function playlistMenu(e, id) {
  const p = S.playlists.find((x) => x.id === id);
  menu(e, [
    { label: 'Play', icon: 'play', run: () => Player.playList(p.trackIds, 0) },
    { label: 'Rename…', icon: 'edit', run: async () => { const n = await prompt_('Rename playlist', 'Name', p.name, 'Rename'); if (n) api.call('lib:playlist-save', { id, name: n }); } },
    '-',
    { label: 'Delete playlist', icon: 'trash', danger: true, run: async () => { if (await confirm_(`Delete “${p.name}”?`, 'The songs stay in your library.', 'Delete')) { await api.call('lib:playlist-delete', id); if (S.view.arg === id) go('songs'); } } }
  ]);
}

/* ---------------- navigation ---------------- */
function go(name, arg = null) {
  if (S.view.name !== name || S.view.arg !== arg) S.scroll = 0;
  S.view = { name, arg };
  renderRail();
  renderView();
}
function renderView({ keepScroll = false } = {}) {
  const main = $('#main');
  const prev = main.querySelector('.view, .table');
  const top = keepScroll && prev ? (main.querySelector('.table') || prev).scrollTop : 0;
  const fn = viewRenderers[S.view.name] || viewRenderers.songs;
  fn(main, S.view.arg);
  if (keepScroll && top) { const sc = main.querySelector('.table') || main.querySelector('.view'); if (sc) sc.scrollTop = top; }
}

/* ---------------- toasts, menus, modals ---------------- */
function toast(msg, { error = false, action, ms = 3800 } = {}) {
  const el = h(`<div class="toast ${error ? 'err' : ''}"><span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}</div>`);
  if (action) el.querySelector('button').onclick = () => { action.run(); el.remove(); };
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? ms + 3000 : ms);
}
const fail = (e) => toast(e.message || String(e), { error: true });

let openMenu = null;
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
function menu(e, items) {
  closeMenu();
  const el = h(`<div class="menu"></div>`);
  for (const it of items) {
    if (it === '-') { el.append(h('<hr>')); continue; }
    if (it.section) { el.append(h(`<div class="sublabel">${esc(it.section)}</div>`)); continue; }
    if (!it) continue;
    const b = h(`<button class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : '<span style="width:16px"></span>'}<span>${esc(it.label)}</span></button>`);
    b.onclick = () => { closeMenu(); it.run(); };
    el.append(b);
  }
  document.body.append(el);
  const r = el.getBoundingClientRect();
  const x = Math.min(e.clientX, innerWidth - r.width - 8); const y = Math.min(e.clientY, innerHeight - r.height - 8);
  el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
  openMenu = el;
  e.stopPropagation();
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);

function modal({ title, body, wide = false, foot = '', onClose }) {
  const el = h(`<div class="scrim"><div class="modal ${wide ? 'wide' : ''}"><div class="modal-h"><h2>${esc(title)}</h2><button class="btn ghost icon sm" data-x>${icon('x', 16)}</button></div><div class="modal-b"></div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div></div>`);
  const b = el.querySelector('.modal-b');
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
  const close = () => { el.remove(); document.removeEventListener('keydown', key, true); onClose && onClose(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  el.querySelector('[data-x]').onclick = close;
  document.body.append(el);
  return { el, body: b, close };
}
function confirm_(title, text, ok = 'OK', danger = true) {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title, body: `<p style="margin:0;color:var(--ink-2)">${esc(text)}</p>`, foot: `<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`, onClose: () => { if (!done) res(false); } });
    m.el.querySelector('[data-no]').onclick = () => { m.close(); };
    m.el.querySelector('[data-ok]').onclick = () => { done = true; m.close(); res(true); };
    m.el.querySelector('[data-ok]').focus();
  });
}
function prompt_(title, label, value = '', ok = 'OK') {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title, body: `<label class="field"><span>${esc(label)}</span><input class="in" value="${esc(value)}"></label>`, foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>${esc(ok)}</button>`, onClose: () => { if (!done) res(null); } });
    const inp = m.el.querySelector('input'); inp.focus(); inp.select();
    const okf = () => { done = true; const v = inp.value.trim(); m.close(); res(v || null); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') okf(); };
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-ok]').onclick = okf;
  });
}

/* ---------------- player ---------------- */
const Player = {
  audio: new Audio(), queue: [], index: -1, shuffle: false, repeat: 'off', counted: false,
  init() {
    const a = this.audio;
    a.preload = 'auto';
    a.volume = S.settings.volume ?? 0.8;
    a.addEventListener('timeupdate', () => this.tick());
    a.addEventListener('play', () => this.paint());
    a.addEventListener('pause', () => this.paint());
    a.addEventListener('ended', () => this.ended());
    a.addEventListener('error', () => { if (this.current()) toast('Couldn\'t play that file.', { error: true }); });
    if (navigator.mediaSession) {
      navigator.mediaSession.setActionHandler('play', () => a.play());
      navigator.mediaSession.setActionHandler('pause', () => a.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('seekto', (d) => { a.currentTime = d.seekTime; });
    }
    this.paint();
  },
  current() { return S.byId.get(this.queue[this.index]); },
  playList(ids, i = 0) {
    ids = ids.filter((id) => S.byId.has(id));
    if (!ids.length) return;
    if (this.shuffle) { const first = ids[i]; const rest = ids.filter((_, k) => k !== i).sort(() => Math.random() - 0.5); ids = [first, ...rest]; i = 0; }
    this.queue = ids; this.index = i; this.load(true);
  },
  load(autoplay) {
    const t = this.current(); if (!t) return;
    this.audio.src = `crate://audio/${t.id}?m=${t.modifiedAt}`;
    this.counted = false;
    if (autoplay) this.audio.play().catch(() => {});
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
      if (t.hasArt) fetch(artUrl(t)).then((r) => r.blob()).then((b) => {
        if (this.current() !== t) return;
        if (this.artBlob) URL.revokeObjectURL(this.artBlob);
        this.artBlob = URL.createObjectURL(b);
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [{ src: this.artBlob, sizes: '1000x1000', type: 'image/jpeg' }] });
      }).catch(() => {});
    }
    this.paint(); renderPlayingMarks();
  },
  toggle() { if (!this.current()) { const ids = visibleIds(); if (ids.length) this.playList(ids, 0); return; } this.audio.paused ? this.audio.play() : this.audio.pause(); },
  next() { if (this.index < this.queue.length - 1) { this.index++; this.load(true); } else if (this.repeat === 'all' && this.queue.length) { this.index = 0; this.load(true); } },
  prev() { if (this.audio.currentTime > 3 || this.index === 0) { this.audio.currentTime = 0; return; } this.index--; this.load(true); },
  ended() { if (this.repeat === 'one') { this.audio.currentTime = 0; this.audio.play(); } else this.next(); },
  tick() {
    const a = this.audio; const t = this.current();
    if (t && !this.counted && a.currentTime > Math.min(30, (a.duration || 60) * 0.5)) { this.counted = true; api.call('lib:played', t.id).catch(() => {}); }
    const p = a.duration ? (a.currentTime / a.duration) * 100 : 0;
    const r = $('#seek'); if (r && !this.dragging) { r.value = p; r.style.setProperty('--p', p + '%'); }
    const c = $('#t-cur'); if (c) c.textContent = fmtTime(a.currentTime);
    const d = $('#t-dur'); if (d) d.textContent = fmtTime(a.duration || (t && t.duration));
  },
  sync() { // library changed: keep the queue valid, refresh labels
    if (this.index >= 0 && !this.current()) { this.queue = this.queue.filter((id) => S.byId.has(id)); this.index = Math.min(this.index, this.queue.length - 1); }
    this.paint();
  },
  paint() {
    const t = this.current(); const a = this.audio;
    $('#player').innerHTML = `
      <div class="np">${t ? artEl(t) : '<div class="art ph" style="width:48px;height:48px"></div>'}<div class="t"><b>${t ? esc(t.title) : 'Nothing playing'}</b><small>${t ? esc([t.artist, t.album].filter(Boolean).join(' — ')) : 'Pick a song to start'}</small></div></div>
      <div class="transport">
        <div class="btns">
          <button class="pbtn ${this.shuffle ? 'on' : ''}" id="p-shuf" title="Shuffle">${icon('shuffle', 16)}</button>
          <button class="pbtn" id="p-prev" title="Previous">${icon('prev', 17)}</button>
          <button class="pbtn main" id="p-play" title="Play/Pause (Space)">${icon(a.paused ? 'play' : 'pause', 18)}</button>
          <button class="pbtn" id="p-next" title="Next">${icon('next', 17)}</button>
          <button class="pbtn ${this.repeat !== 'off' ? 'on' : ''}" id="p-rep" title="Repeat: ${this.repeat}">${icon('repeat', 16)}${this.repeat === 'one' ? '<small style="position:absolute;font-size:9px;font-weight:700;margin:12px 0 0 12px">1</small>' : ''}</button>
        </div>
        <div class="seek"><span id="t-cur">${fmtTime(a.currentTime)}</span><input type="range" class="range" id="seek" min="0" max="100" step="0.1" value="0"><span id="t-dur">${fmtTime(a.duration || (t && t.duration))}</span></div>
      </div>
      <div class="pright">
        ${t ? `<button class="pbtn ${t.loved ? 'on' : ''}" id="p-love" title="Love">${icon(t.loved ? 'heartFill' : 'heart', 16)}</button>` : ''}
        <button class="pbtn" id="p-mute" title="Mute">${icon(a.muted || a.volume === 0 ? 'mute' : 'volume', 17)}</button>
        <input type="range" class="range" id="vol" min="0" max="1" step="0.01" value="${a.volume}" style="--p:${a.volume * 100}%">
      </div>`;
    $('#p-play').onclick = () => this.toggle();
    $('#p-next').onclick = () => this.next();
    $('#p-prev').onclick = () => this.prev();
    $('#p-shuf').onclick = () => { this.shuffle = !this.shuffle; this.paint(); };
    $('#p-rep').onclick = () => { this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; this.paint(); };
    $('#p-mute').onclick = () => { a.muted = !a.muted; this.paint(); };
    const love = $('#p-love'); if (love) love.onclick = () => api.call('lib:update', { ids: [t.id], patch: { loved: !t.loved } });
    const seek = $('#seek');
    seek.oninput = () => { this.dragging = true; seek.style.setProperty('--p', seek.value + '%'); };
    seek.onchange = () => { this.dragging = false; if (a.duration) a.currentTime = (seek.value / 100) * a.duration; };
    const vol = $('#vol');
    vol.oninput = () => { a.volume = +vol.value; a.muted = false; vol.style.setProperty('--p', vol.value * 100 + '%'); };
    vol.onchange = () => { api.call('settings:set', { volume: a.volume }).catch(() => {}); this.paint(); };
    const np = $('#player .np'); if (t) { np.style.cursor = 'pointer'; np.onclick = () => { const al = albumOf(t); al ? go('album', al.key) : go('songs'); }; }
    this.tick();
  }
};
function renderPlayingMarks() {
  const cur = Player.current();
  $$('.tr[data-id]').forEach((r) => r.classList.toggle('playing', !!cur && r.dataset.id === cur.id));
}

/* ---------------- shared track helpers ---------------- */
function visibleIds() { return (window.Views && Views.lastIds) || S.tracks.map((t) => t.id); }

function trackMenu(e, ids) {
  const one = ids.length === 1 ? S.byId.get(ids[0]) : null;
  const al = one && albumOf(one);
  menu(e, [
    { label: 'Play', icon: 'play', run: () => Player.playList(ids, 0) },
    { label: 'Play next', icon: 'queue', run: () => { if (!Player.current()) return Player.playList(ids, 0); Player.queue.splice(Player.index + 1, 0, ...ids); toast('Playing next'); } },
    '-',
    { label: ids.length > 1 ? `Edit ${ids.length} songs` : 'Edit info', icon: 'edit', run: () => { S.sel = new Set(ids); toggleInspector(true); renderView({ keepScroll: true }); } },
    one ? { label: 'Edit audio (trim, fade, volume)…', icon: 'scissors', run: () => Editor.open(one.id) } : null,
    { label: 'Find song info…', icon: 'wand', run: () => Lookup.song(ids) },
    one && al ? { label: 'Go to album', icon: 'disc', run: () => go('album', al.key) } : null,
    '-',
    { section: 'Add to playlist' },
    ...S.playlists.slice(0, 8).map((p) => ({ label: p.name, icon: 'list', run: async () => { await api.call('lib:playlist-save', { id: p.id, add: ids }); toast(`Added to ${p.name}`); } })),
    { label: 'New playlist…', icon: 'plus', run: () => newPlaylist(ids) },
    S.view.name === 'playlist' ? { label: 'Remove from this playlist', icon: 'x', run: () => { const p = S.playlists.find((x) => x.id === S.view.arg); api.call('lib:playlist-save', { id: p.id, trackIds: p.trackIds.filter((x) => !ids.includes(x)) }); } } : null,
    '-',
    one ? { label: api.platform === 'darwin' ? 'Show in Finder' : 'Show in folder', icon: 'folder', run: () => api.call('lib:reveal', one.id) } : null,
    one && one.source && one.source.url ? { label: 'Open source page', icon: 'external', run: () => api.call('app:open-url', one.source.url) } : null,
    { label: ids.length > 1 ? `Delete ${ids.length} songs…` : 'Delete song…', icon: 'trash', danger: true, run: () => deleteTracks(ids) }
  ]);
}

async function deleteTracks(ids) {
  const where = api.platform === 'darwin' ? 'the Trash' : 'the Recycle Bin';
  if (!(await confirm_(ids.length > 1 ? `Delete ${ids.length} songs?` : `Delete “${S.byId.get(ids[0])?.title}”?`, `The MP3${ids.length > 1 ? 's go' : ' goes'} to ${where}.`, 'Delete'))) return;
  await api.call('lib:remove', { ids, deleteFiles: true }).catch(fail);
  ids.forEach((id) => S.sel.delete(id));
  toast(ids.length > 1 ? `Deleted ${ids.length} songs` : 'Deleted');
}

/* ---------------- drag & drop import ---------------- */
function setupDrop() {
  let depth = 0; let zone = null;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !e.dataTransfer.types.includes('crate/tracks');
  window.addEventListener('dragenter', (e) => {
    if (!isFiles(e) || document.querySelector('.scrim') || (e.target.closest && e.target.closest('[data-artdrop]'))) return;
    depth++;
    if (!zone) { zone = h(`<div class="dropzone"><div>Drop to add to your library<small>MP3s are added as they are; other audio (M4A, FLAC, WAV…) is converted to MP3</small></div></div>`); document.body.append(zone); }
  });
  window.addEventListener('dragleave', (e) => { if (!isFiles(e)) return; depth--; if (depth <= 0 && zone) { zone.remove(); zone = null; depth = 0; } });
  window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (zone) { zone.remove(); zone = null; } depth = 0;
    if (!isFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean);
    if (paths.length) importPaths(paths);
  });
}

async function importPaths(paths) {
  toast('Adding to your library…');
  try {
    const r = await api.call('lib:import', paths);
    if (r.added.length) toast(`Added ${plural(r.added.length, 'song')}${r.failed.length ? ` · ${r.failed.length} couldn't be read` : ''}`, { action: { label: 'Show', run: () => go('recent') } });
    else if (r.failed.length) toast(`Couldn't add those files: ${r.failed[0].error}`, { error: true });
    else toast('No audio files there.', { error: true });
  } catch (e) { fail(e); }
}
async function importDialog() {
  const paths = await api.call('app:choose-files', { title: 'Add music files', filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'aif', 'aiff', 'ogg', 'opus', 'webm', 'wma', 'mp4'] }] });
  if (paths.length) importPaths(paths);
}

/* ---------------- delegated buttons (no inline handlers under the CSP) ---------------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { go(nav.dataset.nav); return; }
  const d = e.target.closest('[data-do]');
  if (!d) return;
  ({
    import: importDialog,
    'search-online': () => Download.searchFor(S.query),
    'albums-all': () => { Send.albums = new Set(S.albums.map((a) => a.key)); renderView(); },
    'albums-none': () => { Send.albums = new Set(); renderView(); }
  }[d.dataset.do] || (() => {}))();
});

/* ---------------- keyboard ---------------- */
function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.scrim')) return;
  if (e.key === ' ' && !typing(e)) { e.preventDefault(); Player.toggle(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i' && !typing(e)) { e.preventDefault(); toggleInspector(); }
  if ((e.key === 'Backspace' || e.key === 'Delete') && !typing(e) && S.sel.size && ['songs', 'recent', 'loved', 'attention', 'album', 'artist', 'playlist'].includes(S.view.name)) { e.preventDefault(); deleteTracks([...S.sel]); }
});

api.on('menu', (what) => {
  if (document.querySelector('.scrim') && !['playpause'].includes(what)) return;
  ({
    download: () => go('download'), import: importDialog, export: () => go('export'), songs: () => go('songs'), albums: () => go('albums'), artists: () => go('artists'),
    find: () => $('#q').focus(), playpause: () => Player.toggle(), next: () => Player.next(), prev: () => Player.prev()
  }[what] || (() => {}))();
});
api.on('lib:changed', () => refresh().catch(() => {}));
api.on('lib:progress', (p) => { if (p.kind === 'import' && !p.done && p.total > 3 && p.index % 5 === 0) toast(`Adding ${p.index + 1} of ${p.total}: ${p.name}`, { ms: 1500 }); });
api.on('dl:update', (j) => { if (window.Download) Download.onJob(j); });

/* ---------------- boot ---------------- */
async function boot() {
  S.app = await api.call('app:state');
  S.settings = S.app.settings;
  document.documentElement.dataset.theme = S.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : S.settings.theme;
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', (m) => { if (S.settings.theme === 'system') document.documentElement.dataset.theme = m.matches ? 'light' : 'dark'; });
  mount();
  Player.init();
  setupDrop();
  S.jobs = await api.call('dl:list');
  await refresh();
  if (!S.app.tools.ready) go('download');
  else if (!S.tracks.length) go('download');
}
window.addEventListener('DOMContentLoaded', () => boot().catch((e) => { document.body.innerHTML = `<pre style="padding:30px;color:#f66">${esc(e.stack || e)}</pre>`; }));

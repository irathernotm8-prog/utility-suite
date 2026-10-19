// Crate — library views: songs, albums, album, artists, artist, recent, loved, needs a touch-up, playlists
const ROW_H = 48;

const Views = {
  lastIds: null,

  matches(t, q) {
    if (!q) return true;
    const hay = `${t.title} ${t.artist} ${t.album} ${t.albumArtist} ${t.genre} ${t.year}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  },

  sorted(list) {
    const { key, dir } = S.sort;
    const val = (t) => (key === 'title' ? t.title.toLowerCase() : key === 'artist' ? (t.artist || '~').toLowerCase() : key === 'album' ? `${(t.album || '~').toLowerCase()}\u0000${String(t.disc || 1).padStart(2, '0')}${String(t.track || 99).padStart(3, '0')}`
      : key === 'genre' ? (t.genre || '~').toLowerCase() : key === 'year' ? t.year || '0' : key === 'duration' ? t.duration || 0 : key === 'plays' ? t.plays || 0 : t.addedAt || 0);
    return [...list].sort((a, b) => { const x = val(a); const y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.album || '').localeCompare(b.album || '') || (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0); });
  },

  /* ---------- the song table (virtualized) ---------- */
  table(main, { title, sub, tracks, actions = '', empty, issues = false, keepOrder = false }) {
    const list = keepOrder ? tracks : this.sorted(tracks);
    this.lastIds = list.map((t) => t.id);
    const col = (k, label, cls = '') => `<button data-sort="${k}" class="${S.sort.key === k ? 'on' : ''} ${cls}">${label}${S.sort.key === k ? icon(S.sort.dir > 0 ? 'up' : 'down', 12) : ''}</button>`;
    main.innerHTML = `
      <div class="view flush">
        <div class="head"><div><h1>${esc(title)}</h1><div class="sub">${sub ?? `${plural(list.length, 'song')} · ${fmtLong(list.reduce((s, t) => s + (t.duration || 0), 0))}`}</div></div>
          <div class="actions">${actions}${list.length ? `<button class="btn primary" data-act="play">${icon('play', 15)}Play</button><button class="btn icon" data-act="shuffle" title="Shuffle">${icon('shuffle', 16)}</button>` : ''}</div></div>
        ${list.length ? `<div class="table" tabindex="0">
          <div class="thead"><span></span><span></span>${keepOrder ? '<span>Title</span><span>Album</span><span>Genre</span><span class="num">Year</span><span class="num">Time</span>' : `${col('title', 'Title')}${col('album', 'Album')}${col('genre', 'Genre')}${col('year', 'Year', 'num')}${col('duration', 'Time', 'num')}`}<span></span><span></span></div>
          <div class="vpad" style="height:${list.length * ROW_H}px"></div>
        </div>` : `<div class="view">${empty || '<div class="empty"><h2>Nothing here yet</h2></div>'}</div>`}
      </div>`;
    const play = main.querySelector('[data-act="play"]'); if (play) play.onclick = () => { Player.shuffle = false; Player.playList(this.lastIds, 0); };
    const shuf = main.querySelector('[data-act="shuffle"]'); if (shuf) shuf.onclick = () => { Player.shuffle = true; Player.playList(this.lastIds, Math.floor(Math.random() * this.lastIds.length)); };
    $$('[data-sort]', main).forEach((b) => (b.onclick = () => { const k = b.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : k === 'addedAt' || k === 'plays' || k === 'year' ? -1 : 1 }; renderView(); }));
    const box = main.querySelector('.table');
    if (!box) return;
    const pad = box.querySelector('.vpad');
    const rowHtml = (t, i) => {
      const iss = issues ? needsAttention(t) : [];
      const cur = Player.current();
      return `<div class="tr ${S.sel.has(t.id) ? 'sel' : ''} ${cur && cur.id === t.id ? 'playing' : ''}" data-id="${t.id}" data-i="${i}" draggable="true" style="position:absolute;left:0;right:0;top:${i * ROW_H}px">
        <span class="idx"><span class="n">${keepOrder ? i + 1 : (t.track || '')}</span><button class="play-on-hover pbtn" style="width:26px;height:26px" data-play>${icon('play', 13)}</button></span>
        ${artEl(t, '', 36)}
        <span class="cell"><div class="t-title cell">${esc(t.title)}</div><div class="t-sub">${esc(t.artist || 'Unknown artist')}${iss.length ? ` · <span style="color:var(--gold)">${esc(iss.join(', '))}</span>` : ''}</div></span>
        <span class="cell"><div class="cell">${esc(t.album || '')}</div>${t.album && t.albumArtist && t.albumArtist !== t.artist ? `<div class="t-sub">${esc(t.albumArtist)}</div>` : ''}</span>
        <span class="cell muted">${esc(t.genre || '')}</span>
        <span class="num muted">${esc(t.year || '')}</span>
        <span class="num muted">${fmtTime(t.duration)}</span>
        <span class="flags">${t.loved ? `<span style="color:var(--accent)">${icon('heartFill', 13)}</span>` : ''}${t.original ? `<span title="Audio edited (original kept)" style="color:var(--mute)">${icon('scissors', 13)}</span>` : ''}${!issues && needsAttention(t).length ? `<span class="dot-warn" title="${esc(needsAttention(t).join(', '))}"></span>` : ''}</span>
        <button class="more" data-more>${icon('more', 16)}</button>
      </div>`;
    };
    let lastRange = '';
    const draw = (force) => {
      const top = Math.max(0, box.scrollTop - 32);
      const from = Math.max(0, Math.floor(top / ROW_H) - 8);
      const to = Math.min(list.length, Math.ceil((top + box.clientHeight) / ROW_H) + 8);
      const key = `${from}-${to}`;
      if (!force && key === lastRange) return;
      lastRange = key;
      pad.innerHTML = list.slice(from, to).map((t, k) => rowHtml(t, from + k)).join('');
    };
    this.redraw = () => draw(true);
    let raf = 0;
    box.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => draw(false)); });
    new ResizeObserver(() => draw(true)).observe(box);
    draw(true);

    const select = (id, i, e) => {
      if (e.shiftKey && S.anchor != null) {
        const a = this.lastIds.indexOf(S.anchor); const lo = Math.min(a, i); const hi = Math.max(a, i);
        if (!(e.metaKey || e.ctrlKey)) S.sel.clear();
        for (let k = lo; k <= hi; k++) S.sel.add(this.lastIds[k]);
      } else if (e.metaKey || e.ctrlKey) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.anchor = id; }
      else { S.sel = new Set([id]); S.anchor = id; }
      draw(true); Inspector.render();
    };
    pad.addEventListener('mousedown', (e) => {
      const r = e.target.closest('.tr'); if (!r) return;
      if (e.target.closest('[data-play]') || e.target.closest('[data-more]')) return;
      if (e.button === 2 && S.sel.has(r.dataset.id)) return;
      if (e.button === 0 && S.sel.has(r.dataset.id) && S.sel.size > 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey) { r.dataset.pending = '1'; return; }
      select(r.dataset.id, +r.dataset.i, e);
    });
    pad.addEventListener('click', (e) => {
      const r = e.target.closest('.tr'); if (!r) return;
      if (e.target.closest('[data-play]')) { Player.playList(this.lastIds, +r.dataset.i); return; }
      if (e.target.closest('[data-more]')) { if (!S.sel.has(r.dataset.id)) select(r.dataset.id, +r.dataset.i, {}); trackMenu(e, [...S.sel]); return; }
      if (r.dataset.pending) { delete r.dataset.pending; select(r.dataset.id, +r.dataset.i, {}); }
    });
    pad.addEventListener('dblclick', (e) => { const r = e.target.closest('.tr'); if (r && !e.target.closest('button')) Player.playList(this.lastIds, +r.dataset.i); });
    pad.addEventListener('contextmenu', (e) => { const r = e.target.closest('.tr'); if (!r) return; e.preventDefault(); if (!S.sel.has(r.dataset.id)) select(r.dataset.id, +r.dataset.i, {}); trackMenu(e, [...S.sel]); });
    pad.addEventListener('dragstart', (e) => {
      const r = e.target.closest('.tr'); if (!r) return;
      const ids = S.sel.has(r.dataset.id) ? [...S.sel] : [r.dataset.id];
      e.dataTransfer.setData('crate/tracks', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    box.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(this.lastIds); draw(true); Inspector.render(); }
      if (e.key === 'Enter' && S.sel.size) { const i = this.lastIds.indexOf([...S.sel][0]); Player.playList(this.lastIds, Math.max(0, i)); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = S.anchor ? this.lastIds.indexOf(S.anchor) : -1;
        const i = Math.max(0, Math.min(this.lastIds.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
        select(this.lastIds[i], i, { shiftKey: e.shiftKey });
        const y = i * ROW_H; if (y < box.scrollTop + 32) box.scrollTop = y - 32; else if (y + ROW_H > box.scrollTop + box.clientHeight) box.scrollTop = y + ROW_H - box.clientHeight;
      }
    });
  }
};

const emptyLibrary = `<div class="empty"><div class="big">${icon('music', 30)}</div><h2>Your crate is empty</h2><p>Paste a YouTube link (a song, an album or a playlist) on the Download page, or drop MP3s and other audio files anywhere in this window.</p><div class="row" style="justify-content:center"><button class="btn primary" data-nav="download">${icon('download', 16)}Download music</button><button class="btn" data-do="import">${icon('import', 16)}Add files</button></div></div>`;

viewRenderers.songs = (main) => {
  const tracks = S.tracks.filter((t) => Views.matches(t, S.query));
  Views.table(main, { title: S.query ? `Results for “${S.query}”` : 'Songs', tracks, empty: S.query ? `<div class="empty"><h2>No matches</h2><p>Nothing in your library matches “${esc(S.query)}”. Try the Download page to find it online.</p><button class="btn primary" data-do="search-online">${icon('search', 16)}Search online</button></div>` : emptyLibrary, actions: `<button class="btn" data-do="import">${icon('import', 16)}Add files</button>` });
};
viewRenderers.recent = (main) => {
  const cut = Date.now() - 14 * 864e5;
  const saved = S.sort; S.sort = { key: 'addedAt', dir: -1 };
  Views.table(main, { title: 'Recently added', tracks: S.tracks.filter((t) => t.addedAt > cut && Views.matches(t, S.query)), empty: '<div class="empty"><h2>Nothing new in the last two weeks</h2></div>' });
  S.sort = saved;
};
viewRenderers.loved = (main) => Views.table(main, { title: 'Loved', tracks: S.tracks.filter((t) => t.loved && Views.matches(t, S.query)), empty: `<div class="empty"><div class="big">${icon('heart', 28)}</div><h2>No loved songs yet</h2><p>Tap the heart in the player to keep favorites here.</p></div>` });
viewRenderers.attention = (main) => {
  const tracks = S.tracks.filter((t) => needsAttention(t).length && Views.matches(t, S.query));
  Views.table(main, {
    title: 'Needs a touch-up', issues: true, tracks,
    sub: tracks.length ? `${plural(tracks.length, 'song')} missing artwork, an album, track numbers, or with a messy title — fix them before they hit your phone` : '',
    actions: tracks.length ? `<button class="btn" id="fix-all">${icon('wand', 16)}Find info for all</button>` : '',
    empty: `<div class="empty"><div class="big" style="color:var(--good)">${icon('check', 30)}</div><h2>Everything's tidy</h2><p>Every song has an artist, album, track number and artwork.</p></div>`
  });
  const b = $('#fix-all'); if (b) b.onclick = () => Lookup.batch(tracks.map((t) => t.id));
};
viewRenderers.playlist = (main, id) => {
  const p = S.playlists.find((x) => x.id === id);
  if (!p) return go('songs');
  const tracks = p.trackIds.map((x) => S.byId.get(x)).filter(Boolean).filter((t) => Views.matches(t, S.query));
  Views.table(main, { title: p.name, tracks, keepOrder: true, actions: `<button class="btn icon" id="pl-more">${icon('more', 16)}</button>`, empty: `<div class="empty"><div class="big">${icon('list', 28)}</div><h2>Empty playlist</h2><p>Drag songs onto “${esc(p.name)}” in the sidebar, or right-click a song → Add to playlist.</p></div>` });
  const m = $('#pl-more'); if (m) m.onclick = (e) => playlistMenu(e, id);
};

/* ---------- albums ---------- */
function albumCard(a) {
  const t = a.artTrackId && S.byId.get(a.artTrackId);
  return `<button class="album-card" data-album="${esc(a.key)}">${t ? artEl(t) : '<div class="art ph"></div>'}<span class="play" data-play>${icon('play', 16)}</span><span><b>${esc(a.album)}</b><small>${esc(a.albumArtist || 'Unknown artist')}${a.year ? ' · ' + esc(a.year) : ''}</small></span></button>`;
}
function wireAlbumCards(root) {
  $$('.album-card', root).forEach((c) => {
    const a = S.albums.find((x) => x.key === c.dataset.album);
    c.querySelector('.art').style.position = 'relative';
    c.querySelector('.art').append(c.querySelector('.play'));
    c.onclick = (e) => { if (e.target.closest('[data-play]')) Player.playList(a.trackIds, 0); else go('album', a.key); };
    c.oncontextmenu = (e) => { e.preventDefault(); menu(e, [
      { label: 'Play', icon: 'play', run: () => Player.playList(a.trackIds, 0) },
      { label: 'Edit album info', icon: 'edit', run: () => { S.sel = new Set(a.trackIds); toggleInspector(true); go('album', a.key); } },
      { label: 'Find album info & artwork…', icon: 'wand', run: () => Lookup.album(a.trackIds, `${a.albumArtist} ${a.album}`) },
      '-',
      { label: 'Delete album…', icon: 'trash', danger: true, run: () => deleteTracks(a.trackIds) }
    ]); };
    c.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); c.classList.add('drop'); } });
    c.addEventListener('dragleave', () => c.classList.remove('drop'));
    c.addEventListener('drop', (e) => { c.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) { e.preventDefault(); setAlbumArt(a.trackIds, { path: api.pathFor(f) }); } });
  });
}
async function setAlbumArt(ids, art) {
  try { await api.call('lib:update', { ids, patch: {}, art }); toast('Artwork updated'); } catch (e) { fail(e); }
}

viewRenderers.albums = (main) => {
  const list = S.albums.filter((a) => !S.query || `${a.album} ${a.albumArtist}`.toLowerCase().includes(S.query.toLowerCase()));
  const sort = S.albumSort || 'recent';
  list.sort((a, b) => sort === 'name' ? a.album.localeCompare(b.album) : sort === 'artist' ? (a.albumArtist || '').localeCompare(b.albumArtist || '') || a.album.localeCompare(b.album) : sort === 'year' ? (b.year || '0').localeCompare(a.year || '0') : b.addedAt - a.addedAt);
  const loose = S.tracks.filter((t) => !t.album).length;
  main.innerHTML = `<div class="view">
    <div class="head"><div><h1>Albums</h1><div class="sub">${plural(list.length, 'album')}${loose ? ` · ${plural(loose, 'song')} not in an album yet` : ''}</div></div>
      <div class="actions"><div class="seg">${['recent', 'name', 'artist', 'year'].map((k) => `<button data-s="${k}" class="${sort === k ? 'on' : ''}">${{ recent: 'Recent', name: 'Title', artist: 'Artist', year: 'Year' }[k]}</button>`).join('')}</div></div></div>
    ${list.length ? `<div class="grid-albums">${list.map(albumCard).join('')}</div>` : S.tracks.length ? `<div class="empty"><div class="big">${icon('disc', 30)}</div><h2>No albums yet</h2><p>Select songs, open Info (⌘I) and give them an album name, or use “Find song info” to fill it in from the catalog. Downloading a YouTube album or playlist with “Save as an album” sets it up for you.</p></div>` : emptyLibrary}
  </div>`;
  $$('[data-s]', main).forEach((b) => (b.onclick = () => { S.albumSort = b.dataset.s; renderView(); }));
  wireAlbumCards(main);
  Views.lastIds = list.flatMap((a) => a.trackIds);
};

viewRenderers.album = (main, key) => {
  const a = S.albums.find((x) => x.key === key);
  if (!a) return go('albums');
  const tracks = a.trackIds.map((id) => S.byId.get(id));
  const artT = a.artTrackId && S.byId.get(a.artTrackId);
  const discs = new Set(tracks.map((t) => t.disc || 1)).size > 1;
  const missingNums = tracks.some((t) => !t.track);
  Views.lastIds = a.trackIds;
  main.innerHTML = `<div class="view">
    <button class="btn ghost sm" data-nav="albums" style="margin:-8px 0 10px -10px">${icon('back', 15)}Albums</button>
    <div class="album-hero">
      <div class="art ${artT ? '' : 'ph'}" data-artdrop title="Drop an image or click to change the cover">${artT ? `<img src="${artUrl(artT)}" alt="">` : ''}<div class="art-drop">${icon('image', 22)}<br>Drop an image or click to change</div></div>
      <div style="min-width:0">
        <div class="kicker">${tracks.length === 1 ? 'Single' : tracks.length <= 6 ? 'EP' : 'Album'}</div>
        <h1>${esc(a.album)}</h1>
        <div class="by">${esc(a.albumArtist || 'Unknown artist')}</div>
        <div class="meta">${[a.year, a.genre, plural(tracks.length, 'song'), fmtLong(a.duration)].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="actions">
          <button class="btn primary" data-a="play">${icon('play', 15)}Play</button>
          <button class="btn" data-a="edit">${icon('edit', 15)}Edit album</button>
          <button class="btn" data-a="lookup">${icon('wand', 15)}Find album info</button>
          ${missingNums ? `<button class="btn" data-a="number">${icon('sort', 15)}Number tracks in this order</button>` : ''}
          <button class="btn icon" data-a="more">${icon('more', 16)}</button>
        </div>
      </div>
    </div>
    <div class="tracklist" id="tracklist">${tracks.map((t, i) => {
      const head = discs && (i === 0 || (tracks[i - 1].disc || 1) !== (t.disc || 1)) ? `<div class="disc-h">Disc ${t.disc || 1}</div>` : '';
      return `${head}<div class="tr ${S.sel.has(t.id) ? 'sel' : ''}" data-id="${t.id}" data-i="${i}" draggable="true">
        <span class="idx"><span class="n">${t.track || '–'}</span><button class="play-on-hover pbtn" style="width:26px;height:26px" data-play>${icon('play', 13)}</button></span>
        <span class="cell"><div class="t-title cell">${esc(t.title)}</div>${t.artist && t.artist !== a.albumArtist ? `<div class="t-sub">${esc(t.artist)}</div>` : ''}</span>
        <span class="cell muted">${t.plays ? plural(t.plays, 'play') : ''}${t.original ? ` ${icon('scissors', 12)}` : ''}</span>
        <span class="num muted">${fmtTime(t.duration)}</span>
        <span class="grip" title="Drag to reorder">${icon('grip', 14)}</span>
        <button class="more" data-more>${icon('more', 16)}</button>
      </div>`;
    }).join('')}</div>
    <p class="muted" style="margin-top:14px;font-size:12px">Drag songs to change the order — Crate renumbers them (1 of ${tracks.length}, 2 of ${tracks.length}…) so your phone plays them in this order.</p>
  </div>`;
  const act = (k) => main.querySelector(`[data-a="${k}"]`);
  act('play').onclick = () => Player.playList(a.trackIds, 0);
  act('edit').onclick = () => { S.sel = new Set(a.trackIds); toggleInspector(true); renderView({ keepScroll: true }); };
  act('lookup').onclick = () => Lookup.album(a.trackIds, `${a.albumArtist} ${a.album}`);
  if (act('number')) act('number').onclick = async () => { await api.call('lib:reorder', a.trackIds).catch(fail); toast('Tracks numbered'); };
  act('more').onclick = (e) => menu(e, [
    { label: 'Change cover…', icon: 'image', run: () => Inspector.chooseArt(a.trackIds) },
    { label: 'Use the first song\'s artwork for all', icon: 'image', disabled: !artT, run: () => setAlbumArt(a.trackIds, { trackId: artT.id }) },
    { label: 'Number tracks in this order', icon: 'sort', run: () => api.call('lib:reorder', a.trackIds).then(() => toast('Tracks numbered')).catch(fail) },
    '-',
    { label: api.platform === 'darwin' ? 'Show in Finder' : 'Show in folder', icon: 'folder', run: () => api.call('lib:reveal', a.trackIds[0]) },
    { label: 'Delete album…', icon: 'trash', danger: true, run: () => deleteTracks(a.trackIds) }
  ]);
  // cover drop / click
  const cover = main.querySelector('[data-artdrop]');
  cover.onclick = () => Inspector.chooseArt(a.trackIds);
  cover.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); cover.classList.add('drop'); } });
  cover.addEventListener('dragleave', () => cover.classList.remove('drop'));
  cover.addEventListener('drop', (e) => { cover.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); e.stopPropagation(); setAlbumArt(a.trackIds, { path: api.pathFor(f) }); } });
  // rows
  const list = $('#tracklist');
  list.addEventListener('click', (e) => {
    const r = e.target.closest('.tr'); if (!r) return;
    if (e.target.closest('[data-play]')) return Player.playList(a.trackIds, +r.dataset.i);
    if (e.target.closest('[data-more]')) { if (!S.sel.has(r.dataset.id)) S.sel = new Set([r.dataset.id]); return trackMenu(e, [...S.sel]); }
    if (e.metaKey || e.ctrlKey) { S.sel.has(r.dataset.id) ? S.sel.delete(r.dataset.id) : S.sel.add(r.dataset.id); }
    else if (e.shiftKey && S.anchor) { const x = a.trackIds.indexOf(S.anchor); const y = +r.dataset.i; S.sel = new Set(a.trackIds.slice(Math.min(x, y), Math.max(x, y) + 1)); }
    else S.sel = new Set([r.dataset.id]);
    S.anchor = r.dataset.id;
    $$('.tr', list).forEach((x) => x.classList.toggle('sel', S.sel.has(x.dataset.id)));
    Inspector.render();
  });
  list.addEventListener('dblclick', (e) => { const r = e.target.closest('.tr'); if (r) Player.playList(a.trackIds, +r.dataset.i); });
  list.addEventListener('contextmenu', (e) => { const r = e.target.closest('.tr'); if (!r) return; e.preventDefault(); if (!S.sel.has(r.dataset.id)) S.sel = new Set([r.dataset.id]); trackMenu(e, [...S.sel]); });
  let dragId = null;
  list.addEventListener('dragstart', (e) => { const r = e.target.closest('.tr'); dragId = r.dataset.id; r.classList.add('dragging'); e.dataTransfer.setData('crate/tracks', JSON.stringify([dragId])); e.dataTransfer.setData('crate/reorder', dragId); });
  list.addEventListener('dragend', () => { dragId = null; $$('.tr', list).forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const r = e.target.closest('.tr'); if (!r) return;
    e.preventDefault();
    const after = e.offsetY > r.offsetHeight / 2 || e.clientY - r.getBoundingClientRect().top > r.offsetHeight / 2;
    $$('.tr', list).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    r.classList.add(after ? 'drop-after' : 'drop-before');
  });
  list.addEventListener('drop', async (e) => {
    if (!dragId) return;
    const r = e.target.closest('.tr'); if (!r) return;
    e.preventDefault(); e.stopPropagation();
    const after = r.classList.contains('drop-after');
    const order = a.trackIds.filter((x) => x !== dragId);
    let at = order.indexOf(r.dataset.id); if (after) at++;
    if (r.dataset.id === dragId) return;
    order.splice(at, 0, dragId);
    try { await api.call('lib:reorder', order); } catch (err) { fail(err); }
  });
};

/* ---------- artists ---------- */
function artistIndex() {
  const map = new Map();
  for (const t of S.tracks) {
    const name = t.albumArtist || primaryArtist(t.artist) || 'Unknown artist';
    const k = name.toLowerCase();
    let a = map.get(k); if (!a) { a = { key: k, name, ids: [], artId: null }; map.set(k, a); }
    a.ids.push(t.id); if (!a.artId && t.hasArt) a.artId = t.id;
  }
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
}
viewRenderers.artists = (main) => {
  const list = artistIndex().filter((a) => !S.query || a.name.toLowerCase().includes(S.query.toLowerCase()));
  main.innerHTML = `<div class="view"><div class="head"><div><h1>Artists</h1><div class="sub">${plural(list.length, 'artist')}</div></div></div>
    ${list.length ? `<div class="artist-list">${list.map((a) => `<button class="artist-card" data-k="${esc(a.key)}">${a.artId ? artEl(S.byId.get(a.artId)) : '<div class="art ph"></div>'}<b>${esc(a.name)}</b><small>${plural(a.ids.length, 'song')}</small></button>`).join('')}</div>` : emptyLibrary}</div>`;
  $$('.artist-card', main).forEach((c) => (c.onclick = () => go('artist', c.dataset.k)));
};
viewRenderers.artist = (main, key) => {
  const a = artistIndex().find((x) => x.key === key);
  if (!a) return go('artists');
  const albums = S.albums.filter((al) => (al.albumArtist || '').toLowerCase() === key);
  const loose = a.ids.map((id) => S.byId.get(id)).filter((t) => !t.album);
  Views.lastIds = a.ids;
  main.innerHTML = `<div class="view">
    <button class="btn ghost sm" data-nav="artists" style="margin:-8px 0 10px -10px">${icon('back', 15)}Artists</button>
    <div class="head"><div><h1>${esc(a.name)}</h1><div class="sub">${plural(albums.length, 'album')} · ${plural(a.ids.length, 'song')}</div></div><div class="actions"><button class="btn primary" id="ar-play">${icon('play', 15)}Play all</button></div></div>
    ${albums.length ? `<div class="grid-albums">${albums.map(albumCard).join('')}</div>` : ''}
    ${loose.length ? `<div class="section-h">Songs not in an album</div><div class="tracklist">${loose.map((t, i) => `<div class="tr" data-id="${t.id}" style="grid-template-columns:40px 1fr 64px 28px"><span class="idx">${artEl(t, '', 32)}</span><span class="cell"><div class="t-title">${esc(t.title)}</div><div class="t-sub">${esc(t.artist)}</div></span><span class="num muted">${fmtTime(t.duration)}</span><button class="more" data-more>${icon('more', 16)}</button></div>`).join('')}</div>` : ''}
  </div>`;
  $('#ar-play').onclick = () => Player.playList(a.ids, 0);
  wireAlbumCards(main);
  $$('.tracklist .tr', main).forEach((r) => {
    r.ondblclick = () => Player.playList(loose.map((t) => t.id), loose.findIndex((t) => t.id === r.dataset.id));
    r.onclick = (e) => { S.sel = new Set([r.dataset.id]); if (e.target.closest('[data-more]')) trackMenu(e, [r.dataset.id]); Inspector.render(); };
    r.oncontextmenu = (e) => { e.preventDefault(); S.sel = new Set([r.dataset.id]); trackMenu(e, [r.dataset.id]); };
  });
};

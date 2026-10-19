// Crate — Download: paste a link or search, pick songs (or a whole album/playlist), watch the queue
const isUrl = (s) => /^(https?:\/\/|www\.|youtu\.be\/|music\.youtube|soundcloud\.com|[\w-]+\.bandcamp\.com)/i.test(String(s).trim());

const Download = {
  input: '', mode: 'songs', result: null, busy: false, error: null, setup: null,

  inLibrary(videoId) { return videoId && S.tracks.find((t) => t.source && t.source.videoId === videoId); },

  onJob(j) {
    if (!j) { api.call('dl:list').then((l) => { S.jobs = l; this.paintQueue(); renderRail(); }); return; }
    const i = S.jobs.findIndex((x) => x.id === j.id);
    const prev = i >= 0 ? S.jobs[i] : null;
    if (i >= 0) S.jobs[i] = j; else S.jobs.unshift(j);
    if (prev && prev.status !== j.status) {
      renderRail();
      if (j.status === 'error' && S.view.name !== 'download') toast(`Download failed: ${j.error}`, { error: true, action: { label: 'Open', run: () => go('download') } });
      const active = S.jobs.filter((x) => ['queued', 'working'].includes(x.status)).length;
      if (j.status === 'done' && !active && S.view.name !== 'download') toast('Downloads finished', { action: { label: 'Show', run: () => go('recent') } });
    }
    this.paintQueue();
  },

  searchFor(q) { this.input = q; go('download'); this.submit(); },

  async submit() {
    const v = this.input.trim();
    if (!v || this.busy) return;
    this.busy = true; this.error = null; this.result = null; this.paintResults();
    try {
      if (isUrl(v)) {
        const r = await api.call('dl:probe', /^https?:/i.test(v) ? v : 'https://' + v);
        this.result = { kind: r.kind, data: r };
        if (r.kind === 'playlist') {
          const guess = /album|full ep|\bep\b|deluxe/i.test(r.title) || r.isAlbum;
          const t = r.title.replace(/\s*[\(\[]?\s*(full\s+album|full\s+ep|album|official\s+audio|playlist)\s*[\)\]]?\s*/ig, ' ').trim();
          const parts = t.split(/\s+[-–—]\s+/);
          this.album = { asAlbum: guess, album: parts.length > 1 ? parts.slice(1).join(' - ') : t, albumArtist: parts.length > 1 ? parts[0] : r.uploader, year: '', genre: '', artUrl: '', artThumb: '', picked: new Set(r.entries.map((e) => e.id)) };
        }
      } else {
        const res = await api.call('dl:search', { q: v, site: this.mode === 'albums' ? 'playlists' : this.mode === 'soundcloud' ? 'soundcloud' : 'youtube' });
        this.result = { kind: 'search', data: res };
      }
    } catch (e) { this.error = e.message; }
    this.busy = false;
    this.paintResults();
  },

  enqueue(items, options = {}) {
    return api.call('dl:enqueue', { items, options }).then((added) => {
      const skipped = added.filter((a) => a.status === 'skipped').length;
      if (skipped === added.length) toast(added.length > 1 ? 'Those are already in your library' : 'Already in your library', { action: { label: 'Download again', run: () => added.forEach((a) => api.call('dl:retry', { id: a.id, force: true })) } });
      else toast(`Downloading ${plural(added.length - skipped, 'song')}${skipped ? ` (${skipped} already in your library)` : ''}`);
    }).catch(fail);
  },

  /* ---------- painting ---------- */
  render(main) {
    const tools = S.app.tools;
    main.innerHTML = `<div class="view"><div class="dl-top">
      <div class="head" style="margin-bottom:4px"><div><h1>Download</h1><div class="sub">Paste a link from YouTube, YouTube Music, SoundCloud, Bandcamp and more — or search. Every song becomes a tagged ${S.settings.quality === 'v0' ? 'VBR' : S.settings.quality + ' kbps'} MP3 in your library.</div></div></div>
      ${tools.ready ? '' : `<div class="notice" id="setup">${icon('download', 20)}<div style="flex:1"><b>One-time setup</b><p>Crate uses two free tools to download: <b>yt-dlp</b> (the downloader) and <b>Deno</b> (lets yt-dlp read YouTube). They're about 80 MB and live in Crate's own folder. FFmpeg is already built in.</p><div id="setup-act"><button class="btn primary" id="setup-go">${icon('download', 15)}Set up downloads</button></div></div></div>`}
      <div class="urlbar"><input class="in" id="dl-in" placeholder="Paste a link, or search for a song, artist or album" value="${esc(this.input)}" spellcheck="false" ${tools.ready ? '' : 'disabled'}><button class="btn" id="dl-paste" title="Paste" ${tools.ready ? '' : 'disabled'}>${icon('link', 16)}Paste</button><button class="btn primary" id="dl-go" ${tools.ready ? '' : 'disabled'}>${icon('search', 16)}Go</button></div>
      <div class="row wrap"><div class="seg" id="dl-mode">${[['songs', 'Songs'], ['albums', 'Albums & playlists'], ['soundcloud', 'SoundCloud']].map(([k, l]) => `<button data-m="${k}" class="${this.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="muted" style="font-size:12px">Searching uses the selected source. Links work from any of them.</span>
        <span style="flex:1"></span><button class="btn sm ghost" data-nav="settings">${icon('settings', 14)}Quality & tagging</button></div>
    </div>
    <div class="dl-cols" style="margin-top:18px">
      <div id="dl-results"></div>
      <div><h4>Queue <span style="flex:1"></span><button class="btn sm ghost" id="dl-clear">Clear finished</button></h4><div class="queue" id="dl-queue"></div></div>
    </div></div>`;
    const inp = $('#dl-in');
    inp.oninput = () => { this.input = inp.value; };
    inp.onkeydown = (e) => { if (e.key === 'Enter') this.submit(); };
    inp.addEventListener('paste', () => setTimeout(() => { this.input = inp.value; if (isUrl(inp.value)) this.submit(); }, 0));
    $('#dl-go').onclick = () => this.submit();
    $('#dl-paste').onclick = async () => { const t = (await api.call('app:clipboard')).trim(); if (t) { inp.value = this.input = t; this.submit(); } };
    $$('#dl-mode [data-m]').forEach((b) => (b.onclick = () => { this.mode = b.dataset.m; $$('#dl-mode button').forEach((x) => x.classList.toggle('on', x === b)); if (this.input && !isUrl(this.input)) this.submit(); }));
    $('#dl-clear').onclick = () => api.call('dl:clear');
    const sg = $('#setup-go'); if (sg) sg.onclick = () => this.installTools();
    if (tools.ready && !this.input) setTimeout(() => inp.focus(), 50);
    this.paintResults(); this.paintQueue();
  },

  async installTools() {
    const box = $('#setup-act'); if (!box) return;
    box.innerHTML = '<div class="row"><span class="spin"></span><span id="setup-stage">Starting…</span></div><div class="bar" style="margin-top:8px"><i id="setup-bar"></i></div>';
    const off = api.on('tools:progress', (p) => { const s = $('#setup-stage'); if (s) s.textContent = p.stage; const b = $('#setup-bar'); if (b) b.style.width = `${Math.round((p.progress || 0) * 100)}%`; });
    try {
      S.app.tools = await api.call('tools:install', {});
      off();
      if (!S.app.tools.ready) throw new Error('The tools downloaded but won\'t run. Try again from Settings → Download tools.');
      toast('Downloads are ready');
      renderView();
    } catch (e) { off(); box.innerHTML = `<p style="color:var(--bad)">${esc(e.message)}</p><button class="btn primary" id="setup-go">Try again</button>`; $('#setup-go').onclick = () => this.installTools(); }
  },

  paintResults() {
    const el = $('#dl-results'); if (!el) return;
    if (this.busy) { el.innerHTML = `<div class="row muted" style="padding:20px 4px"><span class="spin"></span>${isUrl(this.input) ? 'Reading the link…' : 'Searching…'}</div>`; return; }
    if (this.error) { el.innerHTML = `<div class="notice" style="border-color:color-mix(in srgb,var(--bad) 40%,var(--line));background:color-mix(in srgb,var(--bad) 8%,var(--panel))"><span style="color:var(--bad)">${icon('alert', 20)}</span><div><b>That didn't work</b><p style="margin:0">${esc(this.error)}</p></div></div>`; return; }
    const r = this.result;
    if (!r) {
      el.innerHTML = `<div class="card"><h3>How it works</h3><ol class="steps">
        <li>Paste a song link — or a YouTube <b>album</b> or <b>playlist</b> link to grab it all.</li>
        <li>Crate cleans the title (no “Official Video”), looks the song up in the iTunes catalog for album, year, genre and real cover art, and saves an MP3.</li>
        <li>Touch up anything in <b>Info</b> (⌘I), trim intros and outros in <b>Edit audio</b>, then <b>Send to phone</b>.</li></ol></div>`;
      return;
    }
    if (r.kind === 'single') return this.paintSingle(el, r.data);
    if (r.kind === 'playlist') return this.paintPlaylist(el, r.data);
    // search results
    if (!r.data.length) { el.innerHTML = '<p class="muted">No results. Try different words.</p>'; return; }
    el.innerHTML = `<h4 style="margin:0 0 6px;font:700 15px var(--display)">${this.mode === 'albums' ? 'Albums & playlists' : 'Results'}</h4><div class="results">${r.data.map((x, i) => {
      const lib = x.kind !== 'playlist' && this.inLibrary(x.id);
      return `<div class="result" data-i="${i}"><div class="thumb" style="background-image:url('${esc(x.thumb)}')">${x.duration ? `<small>${fmtTime(x.duration)}</small>` : ''}</div>
        <div style="min-width:0"><b>${esc(x.title)}</b><small>${esc(x.uploader || '')}${x.kind === 'playlist' && x.count ? ` · ${plural(x.count, 'song')}` : ''}</small></div>
        <div class="act">${lib ? `<span class="chip good">${icon('check', 12)}In library</span>` : ''}${x.kind === 'playlist' ? `<button class="btn sm" data-open>Open</button>` : `<button class="btn sm ${lib ? '' : 'primary'}" data-dl>${icon('download', 14)}${lib ? 'Again' : 'Get'}</button>`}<button class="btn sm ghost icon" data-ext title="Open in browser">${icon('external', 14)}</button></div></div>`;
    }).join('')}</div>`;
    $$('.result', el).forEach((row) => {
      const x = r.data[+row.dataset.i];
      const d = row.querySelector('[data-dl]'); if (d) d.onclick = () => this.enqueue([x], { force: !!this.inLibrary(x.id) });
      const o = row.querySelector('[data-open]'); if (o) o.onclick = () => { this.input = x.url; $('#dl-in').value = x.url; this.submit(); };
      row.querySelector('[data-ext]').onclick = () => api.call('app:open-url', x.url);
    });
  },

  async paintSingle(el, d) {
    const lib = this.inLibrary(d.id);
    el.innerHTML = `<div class="pl-head"><div class="thumb" style="background-image:url('${esc(d.thumb)}')"></div><div style="flex:1;min-width:0">
      <b style="font-size:15px">${esc(d.title)}</b><div class="muted">${esc(d.uploader)} · ${fmtTime(d.duration)}</div>
      <div class="muted" style="margin-top:8px;font-size:12.5px" id="guess">Working out the song info…</div>
      <div class="row" style="margin-top:12px">${lib ? `<span class="chip good">${icon('check', 12)}Already in your library</span>` : ''}<button class="btn primary" id="get">${icon('download', 15)}${lib ? 'Download again' : 'Download MP3'}</button></div></div></div>`;
    $('#get').onclick = () => this.enqueue([d], { force: !!lib });
    try {
      const c = d.track && d.artist ? { title: d.track, artist: d.artist } : await api.call('meta:clean', { title: d.title, uploader: d.uploader });
      const g = $('#guess'); if (g) g.innerHTML = `Saves as <b style="color:var(--ink)">${esc(c.artist || 'Unknown artist')} — ${esc(c.title)}</b>${S.settings.autoLookup ? ', then fills in the album, year, genre and cover from the catalog when it finds a match' : ''}. You can edit everything after.`;
    } catch {}
  },

  paintPlaylist(el, d) {
    const A = this.album;
    const picked = d.entries.filter((e) => A.picked.has(e.id));
    el.innerHTML = `<div class="pl-head"><div class="thumb" style="background-image:url('${esc(A.artThumb || d.thumb)}');${A.artThumb ? 'aspect-ratio:1;width:96px' : ''}"></div><div style="flex:1;min-width:0">
        <b style="font-size:15px">${esc(d.title)}</b><div class="muted">${esc(d.uploader || '')} · ${plural(d.entries.length, 'video')}</div>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="as-album" ${A.asAlbum ? 'checked' : ''}><span>Save as an album<small>Every song gets the same album, album artist, year and cover, numbered in playlist order. Leave off for a mixtape-style playlist — each song is tagged on its own.</small></span></label>
      </div></div>
      <div id="album-opts" ${A.asAlbum ? '' : 'hidden'}>
        <div class="album-opts">
          <label class="field"><span>Album</span><input class="in" data-f="album" value="${esc(A.album)}"></label>
          <label class="field"><span>Album artist</span><input class="in" data-f="albumArtist" value="${esc(A.albumArtist)}"></label>
          <label class="field"><span>Year</span><input class="in" data-f="year" value="${esc(A.year)}" maxlength="4"></label>
          <label class="field"><span>Genre</span><input class="in" data-f="genre" value="${esc(A.genre)}" list="genres-dl"></label>
        </div>
        <datalist id="genres-dl">${GENRES.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="find-album">${icon('wand', 14)}Find album info & cover</button>${A.artUrl ? `<span class="chip good">${icon('check', 12)}Catalog cover, titles and track numbers will be used</span>` : '<span class="muted" style="font-size:12px">Without a catalog match, each song keeps its own video thumbnail as the cover.</span>'}</div>
      </div>
      <div class="row" style="margin-top:14px"><b>${picked.length} of ${d.entries.length} selected</b><button class="btn sm ghost" id="pick-all">All</button><button class="btn sm ghost" id="pick-none">None</button><span style="flex:1"></span><button class="btn primary" id="get-all" ${picked.length ? '' : 'disabled'}>${icon('download', 15)}Download ${plural(picked.length, 'song')}</button></div>
      <div class="pl-entries">${d.entries.map((e, i) => {
        const lib = this.inLibrary(e.id);
        return `<label class="pl-entry"><input type="checkbox" data-id="${esc(e.id)}" ${A.picked.has(e.id) ? 'checked' : ''}><span class="n">${i + 1}</span><span class="cell" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}${lib ? ` <span class="chip good" style="height:18px">In library</span>` : ''}</span><span class="d">${fmtTime(e.duration)}</span></label>`;
      }).join('')}</div>`;
    $('#as-album').onchange = (e) => { A.asAlbum = e.target.checked; $('#album-opts').hidden = !A.asAlbum; };
    $$('[data-f]', el).forEach((i) => (i.oninput = () => { A[i.dataset.f] = i.value; }));
    $$('.pl-entry input', el).forEach((c) => (c.onchange = () => { c.checked ? A.picked.add(c.dataset.id) : A.picked.delete(c.dataset.id); this.paintPlaylist(el, d); }));
    $('#pick-all').onclick = () => { A.picked = new Set(d.entries.map((e) => e.id)); this.paintPlaylist(el, d); };
    $('#pick-none').onclick = () => { A.picked = new Set(); this.paintPlaylist(el, d); };
    $('#find-album').onclick = () => {
      Lookup.searchModal({
        title: 'Find album info', term: `${A.albumArtist} ${A.album}`.trim(), kind: 'meta:albums',
        render: (r) => `<span><b>${esc(r.album)}</b><small>${esc(r.albumArtist)}</small><small>${esc([r.year, r.genre, plural(r.trackTotal, 'song')].filter(Boolean).join(' · '))}</small></span><span></span>`,
        onPick: (r, m) => { m.close(); Object.assign(A, { album: r.album, albumArtist: r.albumArtist, year: r.year, genre: r.genre, artUrl: r.art, artThumb: r.thumb, trackTotal: r.trackTotal, collectionId: r.collectionId }); this.paintPlaylist(el, d); }
      });
    };
    $('#get-all').onclick = () => {
      const items = d.entries.filter((e) => A.picked.has(e.id));
      const options = A.asAlbum ? {
        asAlbum: true, album: A.album.trim(), albumArtist: A.albumArtist.trim(), year: A.year.trim(), genre: A.genre.trim(), artUrl: A.artUrl, collectionId: A.collectionId,
        trackNumbers: Object.fromEntries(items.map((e, i) => [e.id, i + 1])), trackTotal: A.trackTotal && A.trackTotal >= items.length ? A.trackTotal : items.length
      } : {};
      if (A.asAlbum && !options.album) return toast('Give the album a name first', { error: true });
      this.enqueue(items, options);
    };
  },

  paintQueue() {
    const el = $('#dl-queue'); if (!el) return;
    if (!S.jobs.length) { el.innerHTML = '<p class="muted" style="margin:0">Nothing downloading. Songs you add show up here.</p>'; return; }
    el.innerHTML = S.jobs.slice(0, 80).map((j) => {
      const pct = Math.round((j.progress || 0) * 100);
      const st = j.status === 'error' ? `<div class="st err">${esc(j.error)}</div>`
        : j.status === 'done' ? `<div class="st">${icon('check', 13)}In your library</div>`
          : j.status === 'skipped' ? `<div class="st">Already in your library</div>`
            : j.status === 'canceled' ? '<div class="st">Canceled</div>'
              : `<div class="st">${j.status === 'working' ? '<span class="spin" style="width:12px;height:12px"></span>' : ''}${esc(j.stage)}${j.status === 'working' ? ` · ${pct}%` : ''}</div><div class="bar"><i style="width:${pct}%"></i></div>`;
      const act = ['queued', 'working'].includes(j.status) ? `<button class="btn sm ghost icon" data-cancel="${j.id}" title="Cancel">${icon('x', 14)}</button>`
        : j.status === 'error' || j.status === 'canceled' ? `<button class="btn sm" data-retry="${j.id}">${icon('refresh', 13)}Retry</button>`
          : j.status === 'skipped' ? `<button class="btn sm ghost" data-force="${j.id}">Get again</button>`
            : j.status === 'done' ? `<button class="btn sm ghost icon" data-show="${j.trackId}" title="Show in library">${icon('external', 14)}</button>` : '';
      return `<div class="job ${j.status}"><div class="thumb" style="background-image:url('${esc(j.thumb)}')"></div><div style="min-width:0"><b>${esc(j.title)}</b>${st}</div><div>${act}</div></div>`;
    }).join('');
    $$('[data-cancel]', el).forEach((b) => (b.onclick = () => api.call('dl:cancel', b.dataset.cancel)));
    $$('[data-retry]', el).forEach((b) => (b.onclick = () => api.call('dl:retry', { id: b.dataset.retry })));
    $$('[data-force]', el).forEach((b) => (b.onclick = () => api.call('dl:retry', { id: b.dataset.force, force: true })));
    $$('[data-show]', el).forEach((b) => (b.onclick = () => { const t = S.byId.get(b.dataset.show); if (!t) return; S.sel = new Set([t.id]); const al = albumOf(t); al ? go('album', al.key) : go('recent'); toggleInspector(true); }));
  }
};
viewRenderers.download = (main) => Download.render(main);

// Crate — Send to phone
const Send = {
  target: null, scope: 'all', albums: new Set(), playlists: new Set(), singles: true, onlyNew: true, running: false, result: null,

  render(main) {
    const tg = S.app.exportTargets || {};
    const am = tg.appleMusic;
    if (!this.target) this.target = am ? 'apple' : 'folder';
    const isMac = api.platform === 'darwin';
    const folder = S.settings.exportFolder;
    const ids = this.ids();
    main.innerHTML = `<div class="view">
      <div class="head"><div><h1>Send to phone</h1><div class="sub">Your MP3s already carry their tags, artwork and lyrics, so they look right in any music app.</div></div></div>
      <div class="targets">
        <button class="target ${this.target === 'apple' ? 'on' : ''}" data-t="apple" ${am ? '' : 'disabled style="opacity:.55"'}><div class="ti">${icon('apple', 22)}</div><div><b>${am ? am.label : 'Apple Music'} → iPhone</b><small>${am ? `Adds the songs to ${am.label}, then sync your iPhone.` : `Open the ${isMac ? 'Music' : 'iTunes / Apple Music'} app once so Crate can find it.`}</small></div></button>
        <button class="target ${this.target === 'folder' ? 'on' : ''}" data-t="folder"><div class="ti">${icon('usb', 22)}</div><div><b>Folder, USB drive or Android</b><small>Copies Artist/Album folders and playlists (.m3u8) to any folder${folder ? ` — now <span class="code">${esc(folder.split(/[\\/]/).slice(-2).join('/'))}</span>` : ''}.</small></div></button>
      </div>
      <div class="dl-cols">
        <div>
          <h4>What to send</h4>
          <div class="seg" style="margin-bottom:12px">${[['all', 'Everything'], ['albums', 'Albums'], ['playlists', 'Playlists'], ['selected', `Selected (${S.sel.size})`]].map(([k, l]) => `<button data-s="${k}" class="${this.scope === k ? 'on' : ''}" ${k === 'selected' && !S.sel.size ? 'disabled' : ''}>${l}</button>`).join('')}</div>
          ${this.scope === 'albums' ? this.albumPicker() : this.scope === 'playlists' ? this.playlistPicker() : this.scope === 'selected' ? `<p class="muted">${plural(S.sel.size, 'song')} you selected in the library.</p>` : `<p class="muted">All ${plural(S.tracks.length, 'song')} in your library.</p>`}
          <label class="check" style="margin-top:14px"><input type="checkbox" id="only-new" ${this.onlyNew ? 'checked' : ''}><span>Only songs that are new or changed since the last send<small>${this.target === 'apple' ? 'Stops duplicates piling up in Apple Music.' : 'Skips files that are already there and unchanged.'}</small></span></label>
          ${this.target === 'folder' ? `
            <div class="set-row" style="margin-top:10px"><div class="l"><b>Folder</b><small>${folder ? esc(folder) : 'Pick a folder — a USB drive, an SD card, or a synced cloud folder.'}</small></div><div class="r"><button class="btn sm" id="pick-folder">${icon('folder', 14)}${folder ? 'Change' : 'Choose'}</button></div></div>
            <div class="set-row"><div class="l"><b>Layout</b><small>Artist/Album folders keep large libraries tidy; flat suits car stereos.</small></div><div class="r"><div class="seg">${[['artist-album', 'Artist / Album'], ['flat', 'One folder']].map(([k, l]) => `<button data-st="${k}" class="${S.settings.exportStructure === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>` : ''}
          <div class="row" style="margin-top:16px"><button class="btn primary" id="send" ${ids.length && !this.running && (this.target === 'apple' ? am : folder) ? '' : 'disabled'}>${icon('phone', 15)}Send ${plural(ids.length, 'song')}</button><span class="muted">${fmtSize(ids.reduce((s, id) => s + (S.byId.get(id)?.size || 0), 0))}</span></div>
          <div id="send-status" style="margin-top:14px"></div>
        </div>
        <div class="card">${this.target === 'apple' ? `
          <h3>Getting them onto your iPhone</h3>
          <ol class="steps">
            <li>Press <b>Send</b>. ${am ? am.label : 'Music'} picks the songs up within a few seconds — albums, covers and track order included.</li>
            <li>${isMac ? 'Plug in your iPhone, open <b>Finder</b>, select the iPhone in the sidebar → <b>Music</b> → tick <b>Sync music onto iPhone</b> → <b>Apply</b>.' : 'Plug in your iPhone, open the <b>Apple Devices</b> app (or iTunes) → <b>Music</b> → <b>Sync music</b> → <b>Apply</b>.'}</li>
            <li>With an Apple Music subscription and <b>Sync Library</b> on, they upload to iCloud and show up on your phone without a cable.</li>
          </ol>
          <p class="muted" style="margin-top:12px;font-size:12px">Edit a song again later? Send it again — the Music app adds the new copy; delete the old one there.</p>` : `
          <h3>Getting them onto your phone</h3>
          <ol class="steps">
            <li><b>Android:</b> ${isMac ? 'Macs don\'t show Android phones as a folder. Send to a folder here, then copy it over with <a href="#" data-url="https://openmtp.ganeshrvel.com">OpenMTP</a>, or send into a Google Drive / Dropbox folder and download on the phone.' : 'send to a folder, then plug in the phone (File transfer mode) and drag the folder into its <b>Music</b> folder in File Explorer.'}</li>
            <li><b>USB drive or SD card:</b> pick it as the folder and send straight to it.</li>
            <li>Playlists are written as <span class="code">.m3u8</span> files next to the music, which most players pick up.</li>
          </ol>`}
        </div>
      </div></div>`;
    $$('[data-t]', main).forEach((b) => (b.onclick = () => { this.target = b.dataset.t; this.render(main); }));
    $$('[data-s]', main).forEach((b) => (b.onclick = () => { this.scope = b.dataset.s; this.render(main); }));
    $$('[data-st]', main).forEach((b) => (b.onclick = async () => { S.app = await api.call('settings:set', { exportStructure: b.dataset.st }); S.settings = S.app.settings; this.render(main); }));
    $$('[data-url]', main).forEach((a) => (a.onclick = (e) => { e.preventDefault(); api.call('app:open-url', a.dataset.url); }));
    $('#only-new').onchange = (e) => { this.onlyNew = e.target.checked; };
    const pf = $('#pick-folder'); if (pf) pf.onclick = async () => { const p = await api.call('app:choose-folder', { title: 'Send music to…', defaultPath: folder || undefined }); if (p) { S.app = await api.call('settings:set', { exportFolder: p }); S.settings = S.app.settings; this.render(main); } };
    $$('[data-pick-album]', main).forEach((c) => (c.onchange = () => { c.checked ? this.albums.add(c.dataset.pickAlbum) : this.albums.delete(c.dataset.pickAlbum); this.render(main); }));
    $$('[data-pick-pl]', main).forEach((c) => (c.onchange = () => { c.checked ? this.playlists.add(c.dataset.pickPl) : this.playlists.delete(c.dataset.pickPl); this.render(main); }));
    const sg = $('[data-pick-singles]', main); if (sg) sg.onchange = () => { this.singles = sg.checked; this.render(main); };
    $('#send').onclick = () => this.run();
    if (this.result) this.paintResult();
  },

  albumPicker() {
    const loose = S.tracks.filter((t) => !t.album).length;
    return `<div class="row" style="margin-bottom:8px"><button class="btn sm ghost" data-do="albums-all">All</button><button class="btn sm ghost" data-do="albums-none">None</button></div><div class="pick-list">${S.albums.map((a) => { const t = a.artTrackId && S.byId.get(a.artTrackId); return `<label class="pick"><input type="checkbox" data-pick-album="${esc(a.key)}" ${this.albums.has(a.key) ? 'checked' : ''}>${t ? artEl(t) : '<div class="art ph"></div>'}<span style="min-width:0"><b>${esc(a.album)}</b><small>${esc(a.albumArtist)}</small></span><small class="muted">${a.trackIds.length}</small></label>`; }).join('')}
      ${loose ? `<label class="pick"><input type="checkbox" data-pick-singles ${this.singles ? 'checked' : ''}><div class="art ph"></div><span><b>Songs not in an album</b><small>Singles and loose tracks</small></span><small class="muted">${loose}</small></label>` : ''}</div>`;
  },
  playlistPicker() {
    if (!S.playlists.length) return '<p class="muted">No playlists yet. Make one from the sidebar.</p>';
    return `<div class="pick-list">${S.playlists.map((p) => `<label class="pick" style="grid-template-columns:22px 1fr auto"><input type="checkbox" data-pick-pl="${p.id}" ${this.playlists.has(p.id) ? 'checked' : ''}><span><b>${esc(p.name)}</b></span><small class="muted">${p.trackIds.length}</small></label>`).join('')}</div>`;
  },

  ids() {
    if (this.scope === 'selected') return [...S.sel];
    if (this.scope === 'albums') return [...S.albums.filter((a) => this.albums.has(a.key)).flatMap((a) => a.trackIds), ...(this.singles ? S.tracks.filter((t) => !t.album).map((t) => t.id) : [])];
    if (this.scope === 'playlists') return [...new Set(S.playlists.filter((p) => this.playlists.has(p.id)).flatMap((p) => p.trackIds))];
    return S.tracks.map((t) => t.id);
  },

  async run() {
    const ids = this.ids(); if (!ids.length) return;
    this.running = true; this.result = null;
    $('#send').disabled = true;
    const st = $('#send-status');
    st.innerHTML = `<div class="row"><span class="spin"></span><span id="send-name">Starting…</span><button class="btn sm ghost" id="send-cancel">Cancel</button></div><div class="bar" style="margin-top:8px"><i id="send-bar"></i></div>`;
    $('#send-cancel').onclick = () => api.call('export:cancel');
    const off = api.on('export:progress', (p) => { const n = $('#send-name'); if (n) n.textContent = p.done ? 'Finishing…' : `${p.index + 1} of ${p.total} · ${p.name}`; const b = $('#send-bar'); if (b) b.style.width = `${p.total ? Math.round((p.index / p.total) * 100) : 100}%`; });
    try {
      this.result = await api.call('export:run', {
        mode: this.target, folder: S.settings.exportFolder, trackIds: ids, onlyNew: this.onlyNew, structure: S.settings.exportStructure,
        playlists: true, playlistIds: this.scope === 'playlists' ? [...this.playlists] : S.playlists.map((p) => p.id)
      });
    } catch (e) { this.result = { error: e.message }; }
    off(); this.running = false;
    renderView();
  },

  paintResult() {
    const r = this.result; const st = $('#send-status'); if (!st || !r) return;
    if (r.error) { st.innerHTML = `<p style="color:var(--bad)">${esc(r.error)}</p>`; return; }
    st.innerHTML = `<div class="notice" style="border-color:color-mix(in srgb,var(--good) 40%,var(--line));background:color-mix(in srgb,var(--good) 8%,var(--panel))"><span style="color:var(--good)">${icon('check', 20)}</span><div style="flex:1"><b>${r.copied ? `Sent ${plural(r.copied, 'song')}` : 'Nothing new to send'}</b><p style="margin:0">${[r.skipped ? `${r.skipped} already there` : '', r.playlists ? plural(r.playlists, 'playlist') : '', r.failed.length ? `${r.failed.length} failed (${esc(r.failed[0].error)})` : ''].filter(Boolean).join(' · ') || (this.target === 'apple' ? 'Check the Music app — then sync your iPhone.' : '')}</p></div>${this.target === 'folder' ? `<button class="btn sm" id="open-dest">${icon('folder', 14)}Open folder</button>` : ''}</div>`;
    const o = $('#open-dest'); if (o) o.onclick = () => api.call('export:open', r.dest);
  }
};
viewRenderers.export = (main) => Send.render(main);

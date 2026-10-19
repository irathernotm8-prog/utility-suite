// Crate — Settings
const Settings = {
  async set(patch) {
    try { S.app = await api.call('settings:set', patch); S.settings = S.app.settings; } catch (e) { fail(e); }
  },

  render(main) {
    const s = S.settings; const t = S.app.tools;
    const toggle = (k, label, hint) => `<label class="set-row" style="cursor:pointer"><div class="l"><b>${label}</b><small>${hint}</small></div><div class="r"><input type="checkbox" data-b="${k}" ${s[k] ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px"></div></label>`;
    const sample = { artist: 'Daft Punk', albumArtist: 'Daft Punk', album: 'Discovery', title: 'One More Time', track: 1, year: '2001', genre: 'Dance' };
    main.innerHTML = `<div class="view">
      <div class="head"><div><h1>Settings</h1><div class="sub">Crate ${esc(S.app.version)}</div></div></div>

      <div class="set-sec"><h3>Library</h3>
        <div class="set-row"><div class="l"><b>Library folder</b><small class="selectable">${esc(S.root)}</small></div><div class="r"><button class="btn sm" id="show-lib">${icon('folder', 14)}Show</button><button class="btn sm" id="move-lib">Change…</button></div></div>
        ${toggle('organize', 'Keep files organized', 'Renames and files songs into folders whenever you change their info, using the pattern below.')}
        <div class="set-row"><div class="l"><b>File names</b><small>Tokens: <span class="code">{albumartist}</span> <span class="code">{artist}</span> <span class="code">{album}</span> <span class="code">{track}</span> <span class="code">{title}</span> <span class="code">{year}</span> <span class="code">{genre}</span> · <span class="code">/</span> makes a folder</small>
          <input class="in" id="pattern" value="${esc(s.pattern)}" style="margin-top:8px"><small id="pattern-ex" style="margin-top:6px"></small></div>
          <div class="r" style="align-self:flex-end"><button class="btn sm" id="organize-now">Rename all files now</button></div></div>
        <div class="set-row"><div class="l"><b>Rescan the folder</b><small>Picks up MP3s you copied in yourself and forgets songs you deleted outside Crate. Runs on its own each time Crate opens.</small></div><div class="r"><button class="btn sm" id="rescan">${icon('refresh', 14)}Rescan</button></div></div>
      </div>

      <div class="set-sec"><h3>Downloads</h3>
        <div class="set-row"><div class="l"><b>MP3 quality</b><small>320 kbps is the best MP3 can do and what most people want. YouTube's audio tops out around 160 kbps Opus, so higher settings stop bad conversions rather than add detail.</small></div><div class="r"><select class="in" id="quality" style="width:170px">${[['320', '320 kbps (best)'], ['256', '256 kbps'], ['192', '192 kbps (smaller)'], ['v0', 'VBR V0 (~245 kbps)']].map(([v, l]) => `<option value="${v}" ${s.quality === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
        ${toggle('cleanTitles', 'Clean up titles', 'Splits “Artist - Song (Official Video)” into a proper artist and title, and moves “ft.” into the title.')}
        ${toggle('autoLookup', 'Fill in song info from the catalog', 'Looks songs up in the iTunes catalog for album, track number, year and genre. Skipped when saving a playlist as an album you named.')}
        ${toggle('preferCatalogArt', 'Use real album covers', 'Prefers the catalog\'s album cover over the video thumbnail when there\'s a match.')}
        ${toggle('normalize', 'Even out loudness', 'Matches every new download to streaming loudness (−14 LUFS). Leave off to keep songs exactly as uploaded.')}
        <div class="set-row"><div class="l"><b>Downloads at once</b><small>More is faster on a good connection.</small></div><div class="r"><div class="seg">${[1, 2, 3, 4].map((n) => `<button data-c="${n}" class="${+s.concurrency === n ? 'on' : ''}">${n}</button>`).join('')}</div></div></div>
        <div class="set-row"><div class="l"><b>Use your browser's sign-in</b><small>For age-restricted videos, or when YouTube asks to “confirm you're not a bot”. Crate reads that browser's YouTube cookies for the download only. ${api.platform === 'darwin' ? 'Safari needs Full Disk Access for Crate; Chrome may ask for your Mac password once.' : ''}</small></div><div class="r"><select class="in" id="cookies" style="width:150px">${[['', 'Off'], ['chrome', 'Chrome'], ['safari', 'Safari'], ['firefox', 'Firefox'], ['edge', 'Edge'], ['brave', 'Brave'], ['opera', 'Opera'], ['vivaldi', 'Vivaldi']].filter(([v]) => api.platform === 'darwin' || v !== 'safari').map(([v, l]) => `<option value="${v}" ${s.cookiesBrowser === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      </div>

      <div class="set-sec"><h3>Download tools</h3>
        <div class="toolstat"><div><b>yt-dlp</b><span>${esc(t.ytdlp || 'not installed')}</span></div><div><b>Deno</b><span>${esc(t.deno || 'not installed')}</span></div><div><b>FFmpeg</b><span>${esc(t.ffmpeg || 'missing')}</span></div></div>
        <div class="set-row"><div class="l"><b>Update download tools</b><small>YouTube changes often. Crate updates yt-dlp on its own every few days; if downloads start failing, update now.</small></div><div class="r"><button class="btn sm" id="tools-up">${icon('refresh', 14)}${t.ytdlp ? 'Update now' : 'Install'}</button></div></div>
      </div>

      <div class="set-sec"><h3>Appearance</h3>
        <div class="set-row"><div class="l"><b>Theme</b></div><div class="r"><div class="seg">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']].map(([v, l]) => `<button data-th="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
      </div>
      <p class="muted" style="max-width:760px;font-size:12px">Download only music you have the right to keep — your own uploads, free releases, or where the artist and site allow it.</p>
    </div>`;
    $('#show-lib').onclick = () => api.call('lib:open-root');
    $('#move-lib').onclick = async () => {
      const p = await api.call('app:choose-folder', { title: 'Choose the library folder', defaultPath: S.root });
      if (!p || p === S.root) return;
      if (!(await confirm_('Switch library folder?', `Crate will use “${p}” as its library and add any MP3s already in it. Songs in the current folder stay where they are (switch back any time).`, 'Switch', false))) return;
      await this.set({ libraryRoot: p }); await refresh(); toast('Library folder changed');
    };
    $$('[data-b]', main).forEach((c) => (c.onchange = () => this.set({ [c.dataset.b]: c.checked })));
    const pat = $('#pattern');
    const ex = () => { const v = pat.value || '{albumartist}/{album}/{track} {title}'; $('#pattern-ex').innerHTML = `e.g. <span class="code">${esc(renderPatternPreview(v, sample))}</span>`; };
    pat.oninput = ex; ex();
    pat.onchange = () => this.set({ pattern: pat.value.trim() || '{albumartist}/{album}/{track} {title}' });
    $('#organize-now').onclick = async (e) => {
      if (!(await confirm_('Rename all files?', 'Every MP3 in the library is moved and renamed to match the pattern. Tags are not changed.', 'Rename', false))) return;
      e.target.disabled = true;
      try { const r = await api.call('lib:organize'); toast(r.moved ? `Renamed ${plural(r.moved, 'file')}` : 'Everything already matches'); } catch (err) { fail(err); }
      e.target.disabled = false;
    };
    $('#rescan').onclick = async (e) => { e.target.disabled = true; try { const r = await api.call('lib:scan'); toast(`Found ${r.added} new · removed ${r.removed} missing · ${plural(r.total, 'song')}`); } catch (err) { fail(err); } e.target.disabled = false; };
    $('#quality').onchange = (e) => this.set({ quality: e.target.value });
    $('#cookies').onchange = (e) => this.set({ cookiesBrowser: e.target.value });
    $$('[data-c]', main).forEach((b) => (b.onclick = async () => { await this.set({ concurrency: +b.dataset.c }); renderView(); }));
    $$('[data-th]', main).forEach((b) => (b.onclick = async () => {
      await this.set({ theme: b.dataset.th });
      document.documentElement.dataset.theme = b.dataset.th === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : b.dataset.th;
      renderView();
    }));
    $('#tools-up').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span>Updating…';
      const off = api.on('tools:progress', (p) => { b.innerHTML = `<span class="spin"></span>${Math.round((p.progress || 0) * 100)}%`; });
      try { S.app.tools = await api.call('tools:install', { force: true }); toast('Download tools are up to date'); } catch (err) { fail(err); }
      off(); renderView();
    };
  }
};

function renderPatternPreview(pattern, t) {
  const pad = (n) => String(n).padStart(2, '0');
  const v = { artist: t.artist, albumartist: t.albumArtist, album: t.album, title: t.title, track: pad(t.track), disc: '1', year: t.year, genre: t.genre };
  return pattern.split('/').map((seg) => seg.replace(/\{(\w+)\}/g, (_, k) => v[k.toLowerCase()] ?? '').trim()).filter(Boolean).join('/') + '.mp3';
}
viewRenderers.settings = (main) => Settings.render(main);

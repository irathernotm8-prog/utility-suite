// Crate — the Info panel (edit tags for one song or many) and catalog lookups
const FIELDS = [
  ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'],
  ['track', '#'], ['trackTotal', 'of'], ['disc', 'Disc'], ['discTotal', 'of'],
  ['year', 'Year'], ['genre', 'Genre'], ['composer', 'Composer'], ['comment', 'Comment'], ['lyrics', 'Lyrics']
];
const GENRES = ['Hip-Hop/Rap', 'R&B/Soul', 'Pop', 'Rock', 'Alternative', 'Dance', 'Electronic', 'Country', 'Latin', 'Reggae', 'Afrobeats', 'Jazz', 'Classical', 'Soundtrack', 'Gospel', 'Metal', 'Indie', 'K-Pop', 'Blues', 'Funk', 'House', 'Drill', 'Amapiano'];

const Inspector = {
  dirty: {},
  ids: [],

  render() {
    const el = $('#inspector');
    if (!el || !S.inspector) return;
    const ids = [...S.sel].filter((id) => S.byId.has(id));
    const same = ids.length === this.ids.length && ids.every((x, i) => x === this.ids[i]);
    if (same && Object.keys(this.dirty).length) return; // don't wipe unsaved edits on a refresh
    this.ids = ids; this.dirty = {};
    if (!ids.length) { el.innerHTML = `<div class="insp-empty">${icon('info', 28)}<p>Select a song (or several) to see and edit its info.</p><p style="font-size:12px">Tip: select a whole album and edit Album, Year, Genre or artwork for every song at once.</p></div>`; return; }
    const ts = ids.map((id) => S.byId.get(id));
    const one = ts.length === 1 ? ts[0] : null;
    const common = (k) => { const v = ts[0][k]; return ts.every((t) => String(t[k] ?? '') === String(v ?? '')) ? (v || '') : null; };
    const val = (k) => { const c = common(k); return c === null ? '' : (k.match(/track|disc/) && !c ? '' : c); };
    const ph = (k, label) => (common(k) === null ? 'Mixed' : k === 'albumArtist' ? (primaryArtist(common('artist') || '') || label) : '');
    const input = (k, label, extra = '') => `<label class="field"><span>${label}</span><input class="in ${common(k) === null ? 'mixed' : ''}" data-k="${k}" value="${esc(val(k))}" placeholder="${esc(ph(k, label))}" ${extra}></label>`;
    const artT = ts.find((t) => t.hasArt);
    const artMixed = ts.some((t) => t.hasArt !== ts[0].hasArt) || (ts.length > 1 && new Set(ts.map((t) => t.album)).size > 1);
    const genres = [...new Set([...S.tracks.map((t) => t.genre).filter(Boolean), ...GENRES])].sort();
    el.innerHTML = `<div class="insp">
      <div class="insp-head"><h3>${one ? 'Song info' : `${ts.length} songs`}</h3><button class="btn ghost icon sm" id="insp-x" title="Close (⌘I)">${icon('x', 16)}</button></div>
      <div class="insp-art art ${artT ? '' : 'ph'}" data-artdrop>${artT ? `<img src="${artUrl(artT)}" alt="">` : ''}
        ${artMixed && artT ? '<span class="chip" style="position:absolute;top:8px;left:8px">Showing one of several</span>' : ''}
        <div class="art-tools"><button class="btn sm" data-art="choose">${icon('image', 14)}Change</button><button class="btn sm" data-art="find">${icon('search', 14)}Find</button>${artT ? `<button class="btn sm" data-art="remove">${icon('trash', 14)}</button>` : ''}</div>
      </div>
      ${one && one.source && one.source.originalTitle && one.source.originalTitle !== one.title ? `<div class="muted" style="font-size:12px;margin-top:-6px">From “${esc(one.source.originalTitle)}”</div>` : ''}
      <div class="row" style="align-items:flex-end">${input('title', 'Title', ts.length > 1 ? 'disabled title="Select one song to rename it"' : '')}${one ? `<button class="btn icon" id="clean" title="Clean up the title (drops “Official Video”, moves “ft.” into the title)">${icon('wand', 16)}</button>` : ''}</div>
      ${input('artist', 'Artist')}
      ${input('album', 'Album')}
      ${input('albumArtist', 'Album artist')}
      <div class="grid4">${input('track', 'Track', 'inputmode="numeric"')}${input('trackTotal', 'of', 'inputmode="numeric"')}${input('disc', 'Disc', 'inputmode="numeric"')}${input('discTotal', 'of', 'inputmode="numeric"')}</div>
      <div class="grid2">${input('year', 'Year', 'inputmode="numeric" maxlength="4"')}${input('genre', 'Genre', 'list="genres"')}</div>
      <datalist id="genres">${genres.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
      ${input('composer', 'Composer')}
      <label class="field"><span>Comment</span><input class="in ${common('comment') === null ? 'mixed' : ''}" data-k="comment" value="${esc(val('comment'))}" placeholder="${common('comment') === null ? 'Mixed' : ''}"></label>
      ${one ? `<label class="field"><span>Lyrics</span><textarea class="in" data-k="lyrics" rows="4" placeholder="Paste lyrics — they show on your phone in most music apps">${esc(one.lyrics || '')}</textarea></label>` : ''}
      <div class="insp-actions">
        ${one ? `<button class="btn" id="i-edit">${icon('scissors', 15)}Edit audio</button>` : `<button class="btn" id="i-number">${icon('sort', 15)}Number 1–${ts.length}</button>`}
        <button class="btn" id="i-find">${icon('wand', 15)}Find info</button>
      </div>
      ${one ? `<div class="fileinfo"><b>File</b> ${esc(one.file)}<br><b>Quality</b> ${one.bitrate} kbps MP3 · ${fmtTime(one.duration)} · ${fmtSize(one.size || 0)}${one.original ? '<br><b>Edited</b> trimmed/faded copy — the original is kept, so you can undo it in Edit audio' : ''}${one.source && one.source.url ? `<br><b>Source</b> <a href="#" id="i-src">${esc(one.source.site || 'Link')}${one.source.uploader ? ' · ' + esc(one.source.uploader) : ''}</a>` : ''}<br><b>Played</b> ${one.plays || 0} times</div>` : ''}
      <div class="dirty-bar" id="dirty" hidden><button class="btn" id="i-reset">Discard</button><button class="btn primary" id="i-save">${icon('check', 15)}Save${ts.length > 1 ? ` to ${ts.length} songs` : ''}</button></div>
    </div>`;
    $('#insp-x').onclick = () => toggleInspector(false);
    $$('[data-k]', el).forEach((inp) => {
      inp.addEventListener('input', () => { this.dirty[inp.dataset.k] = inp.value; inp.classList.remove('mixed'); $('#dirty').hidden = false; });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.tagName === 'INPUT') { e.preventDefault(); this.save(); } if (e.key === 'Escape') { this.dirty = {}; this.ids = []; this.render(); } });
    });
    $('#i-save').onclick = () => this.save();
    $('#i-reset').onclick = () => { this.dirty = {}; this.ids = []; this.render(); };
    const clean = $('#clean');
    if (clean) clean.onclick = async () => {
      const c = await api.call('meta:clean', { title: one.source?.originalTitle || one.title, uploader: one.source?.uploader || one.artist });
      const set = (k, v) => { const i = $(`[data-k="${k}"]`, el); if (v && i.value !== v) { i.value = v; this.dirty[k] = v; } };
      set('title', c.title); if (!one.artist || /topic|vevo/i.test(one.artist)) set('artist', c.artist);
      $('#dirty').hidden = !Object.keys(this.dirty).length;
      if (!Object.keys(this.dirty).length) toast('The title already looks clean');
    };
    const ed = $('#i-edit'); if (ed) ed.onclick = () => Editor.open(one.id);
    const num = $('#i-number'); if (num) num.onclick = async () => { const order = (Views.lastIds || []).filter((id) => S.sel.has(id)); await api.call('lib:reorder', order.length === ts.length ? order : ids).catch(fail); toast(`Numbered 1–${ts.length}`); };
    $('#i-find').onclick = () => (ts.length > 1 && new Set(ts.map((t) => t.album)).size === 1 && ts[0].album ? Lookup.album(ids, `${ts[0].albumArtist || ts[0].artist} ${ts[0].album}`) : Lookup.song(ids));
    const src = $('#i-src'); if (src) src.onclick = (e) => { e.preventDefault(); api.call('app:open-url', one.source.url); };
    // artwork
    const box = $('.insp-art', el);
    box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => { box.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); e.stopPropagation(); this.setArt(ids, { path: api.pathFor(f) }); } });
    $$('[data-art]', el).forEach((b) => (b.onclick = () => {
      const k = b.dataset.art;
      if (k === 'choose') this.chooseArt(ids);
      if (k === 'find') Lookup.art(ids, `${ts[0].albumArtist || ts[0].artist || ''} ${ts[0].album || ts[0].title}`.trim());
      if (k === 'remove') this.setArt(ids, { remove: true });
    }));
  },

  async save() {
    const patch = { ...this.dirty };
    if (!Object.keys(patch).length) return;
    const ids = this.ids;
    this.dirty = {};
    try {
      await api.call('lib:update', { ids, patch });
      toast(ids.length > 1 ? `Saved to ${ids.length} songs` : 'Saved');
      this.ids = []; // re-render with fresh values on the next refresh
    } catch (e) { this.dirty = patch; fail(e); }
  },

  async setArt(ids, art) {
    try { await api.call('lib:update', { ids, patch: {}, art }); toast(art.remove ? 'Artwork removed' : 'Artwork updated'); this.ids = []; } catch (e) { fail(e); }
  },

  async chooseArt(ids) {
    const m = modal({ title: 'Change artwork', body: `
      <p class="muted" style="margin:0">Artwork is cropped to a square and saved inside each MP3, so it shows on your phone.</p>
      <div class="row wrap"><button class="btn" data-c="file">${icon('image', 16)}Choose an image…</button><button class="btn" data-c="find">${icon('search', 16)}Search album artwork</button></div>
      <label class="field"><span>…or paste an image link</span><div class="row"><input class="in" id="art-url" placeholder="https://…jpg"><button class="btn" data-c="url">Use</button></div></label>` });
    m.el.querySelector('[data-c="file"]').onclick = async () => {
      const [p] = await api.call('app:choose-files', { title: 'Choose artwork', multi: false, filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'] }] });
      if (p) { m.close(); this.setArt(ids, { path: p }); }
    };
    m.el.querySelector('[data-c="find"]').onclick = () => { m.close(); const t = S.byId.get(ids[0]); Lookup.art(ids, `${t.albumArtist || t.artist || ''} ${t.album || t.title}`.trim()); };
    m.el.querySelector('[data-c="url"]').onclick = () => { const u = $('#art-url').value.trim(); if (/^https?:/.test(u)) { m.close(); this.setArt(ids, { url: u }); } };
  }
};

/* ---------------- catalog lookups ---------------- */
const Lookup = {
  searchModal({ title, term, kind, render, onPick, foot = '' }) {
    const m = modal({ title, wide: false, foot, body: `<div class="row"><input class="in" id="lk-q" value="${esc(term)}"><button class="btn primary" id="lk-go">${icon('search', 15)}Search</button></div><div class="matches" id="lk-res"><div class="row muted"><span class="spin"></span>Searching the catalog…</div></div>` });
    const run = async () => {
      const q = $('#lk-q', m.el).value.trim(); if (!q) return;
      const box = $('#lk-res', m.el);
      box.innerHTML = '<div class="row muted"><span class="spin"></span>Searching the catalog…</div>';
      try {
        const res = await api.call(kind, q);
        if (!res.length) { box.innerHTML = '<p class="muted">No matches. Try fewer words, or just the artist and title.</p>'; return; }
        box.innerHTML = res.map((r, i) => `<button class="match" data-i="${i}"><div class="art">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : ''}</div>${render(r)}</button>`).join('');
        $$('.match', box).forEach((b) => (b.onclick = () => onPick(res[+b.dataset.i], m)));
      } catch (e) { box.innerHTML = `<p style="color:var(--bad)">${esc(e.message)}</p>`; }
    };
    $('#lk-go', m.el).onclick = run;
    $('#lk-q', m.el).onkeydown = (e) => { if (e.key === 'Enter') run(); };
    run();
    return m;
  },

  song(ids) {
    if (ids.length > 1) return this.batch(ids);
    const t = S.byId.get(ids[0]);
    this.searchModal({
      title: 'Find song info', term: `${t.artist || ''} ${t.title}`.trim(), kind: 'meta:songs',
      render: (r) => `<span><b>${esc(r.title)}</b><small>${esc(r.artist)} — ${esc(r.album)}</small><small>${esc([r.year, r.genre, r.track ? `track ${r.track} of ${r.trackTotal}` : ''].filter(Boolean).join(' · '))}</small></span><span class="muted">${fmtTime(r.duration)}</span>`,
      onPick: (r, m) => {
        m.body.innerHTML = `<div class="match" style="pointer-events:none"><div class="art"><img src="${esc(r.thumb)}" alt=""></div><span><b>${esc(r.title)}</b><small>${esc(r.artist)} — ${esc(r.album)} (${esc(r.year)})</small></span><span></span></div>
          <p class="muted" style="margin:4px 0 0">Use from this match:</p>
          ${[['title', `Title: ${r.title}`, false], ['artist', `Artist: ${r.artist}`, !t.artist], ['album', `Album: ${r.album} · track ${r.track} of ${r.trackTotal}`, true], ['year', `Year: ${r.year}`, true], ['genre', `Genre: ${r.genre}`, true], ['art', 'Album artwork', true]]
            .map(([k, label, on]) => `<label class="check"><input type="checkbox" data-u="${k}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
          <div class="row" style="justify-content:flex-end"><button class="btn primary" id="lk-apply">${icon('check', 15)}Apply</button></div>`;
        $('#lk-apply', m.el).onclick = async () => {
          const on = (k) => $(`[data-u="${k}"]`, m.el).checked;
          const patch = {};
          if (on('title')) patch.title = r.title;
          if (on('artist')) patch.artist = r.artist;
          if (on('album')) Object.assign(patch, { album: r.album, albumArtist: r.albumArtist, track: r.track, trackTotal: r.trackTotal, disc: r.disc, discTotal: r.discTotal });
          if (on('year')) patch.year = r.year;
          if (on('genre')) patch.genre = r.genre;
          m.close();
          try { await api.call('lib:update', { ids, patch, art: on('art') && r.art ? { url: r.art } : undefined }); toast('Song info updated'); Inspector.ids = []; } catch (e) { fail(e); }
        };
      }
    });
  },

  album(ids, term) {
    this.searchModal({
      title: 'Find album info', term, kind: 'meta:albums',
      render: (r) => `<span><b>${esc(r.album)}</b><small>${esc(r.albumArtist)}</small><small>${esc([r.year, r.genre, plural(r.trackTotal, 'song')].filter(Boolean).join(' · '))}</small></span><span></span>`,
      onPick: (r, m) => {
        m.body.innerHTML = `<div class="match" style="pointer-events:none"><div class="art"><img src="${esc(r.thumb)}" alt=""></div><span><b>${esc(r.album)}</b><small>${esc(r.albumArtist)} · ${esc(r.year)} · ${esc(r.genre)}</small></span><span></span></div>
          <p style="margin:4px 0 0;color:var(--ink-2)">Crate sets the album, album artist, year, genre and artwork on all ${plural(ids.length, 'song')}, and matches each song to the album's track list to fill in track and disc numbers.</p>
          <label class="check"><input type="checkbox" id="lk-titles"><span>Also use the album's song titles<small>Fixes spelling and adds “(feat. …)” the way the album lists them</small></span></label>
          <div class="row" style="justify-content:flex-end"><button class="btn primary" id="lk-apply">${icon('check', 15)}Apply to ${plural(ids.length, 'song')}</button></div>`;
        $('#lk-apply', m.el).onclick = async (e) => {
          e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span>Applying…';
          try {
            const res = await api.call('meta:apply-album', { ids, collectionId: r.collectionId, renameTitles: $('#lk-titles', m.el).checked });
            m.close(); Inspector.ids = [];
            toast(res.matched === res.total ? 'Album info applied — every song matched the track list' : `Album info applied · ${res.matched} of ${res.total} songs matched the track list (number the rest by dragging them in the album)`);
          } catch (err) { m.close(); fail(err); }
        };
      }
    });
  },

  art(ids, term) {
    this.searchModal({
      title: 'Find artwork', term, kind: 'meta:albums',
      render: (r) => `<span><b>${esc(r.album)}</b><small>${esc(r.albumArtist)}${r.year ? ' · ' + esc(r.year) : ''}</small></span><span class="muted">Use</span>`,
      onPick: (r, m) => { m.close(); Inspector.setArt(ids, { url: r.art }); }
    });
  },

  async batch(ids) {
    const rows = ids.map((id) => ({ t: S.byId.get(id), match: undefined }));
    const m = modal({ title: `Find info for ${plural(ids.length, 'song')}`, wide: true, body: '<div id="bt"></div>', foot: `<div class="left"><label class="check"><input type="checkbox" id="bt-art" checked><span>Use catalog artwork</span></label><label class="check"><input type="checkbox" id="bt-onlymissing" checked><span>Only where artwork is missing</span></label></div><button class="btn" data-x2>Cancel</button><button class="btn primary" id="bt-apply" disabled>Apply</button>` });
    let stop = false;
    m.el.querySelector('[data-x2]').onclick = () => { stop = true; m.close(); };
    const draw = () => {
      const done = rows.filter((r) => r.match !== undefined).length;
      $('#bt', m.el).innerHTML = `${done < rows.length ? `<div class="row muted" style="margin-bottom:8px"><span class="spin"></span>Checking ${done + 1} of ${rows.length}…</div>` : `<p class="muted" style="margin:0 0 8px">${rows.filter((r) => r.match).length} of ${rows.length} found in the catalog. Untick any that look wrong.</p>`}
        <div class="pick-list" style="max-height:440px">${rows.map((r, i) => `<label class="pick" style="grid-template-columns:22px 40px 1fr 1fr"><input type="checkbox" data-i="${i}" ${r.match ? 'checked' : 'disabled'}>${artEl(r.t)}<span><b>${esc(r.t.title)}</b><small>${esc(r.t.artist || 'No artist')}${r.t.album ? ' — ' + esc(r.t.album) : ''}</small></span>
          <span>${r.match === undefined ? '<span class="muted">…</span>' : r.match ? `<b>${esc(r.match.album)}</b><small>${esc([r.match.artist, r.match.year, r.match.genre, `#${r.match.track}`].filter(Boolean).join(' · '))}</small>` : '<small class="muted">No confident match — use Find song info on it</small>'}</span></label>`).join('')}</div>`;
      $('#bt-apply', m.el).disabled = done < rows.length || !rows.some((r) => r.match);
    };
    draw();
    for (const r of rows) {
      if (stop) return;
      try { r.match = await api.call('meta:best', { artist: r.t.artist, title: r.t.title, duration: r.t.duration }); } catch { r.match = null; }
      draw();
    }
    $('#bt-apply', m.el).onclick = async (e) => {
      const useArt = $('#bt-art', m.el).checked; const onlyMissing = $('#bt-onlymissing', m.el).checked;
      const chosen = $$('input[data-i]', m.el).filter((x) => x.checked).map((x) => rows[+x.dataset.i]);
      e.target.disabled = true;
      let n = 0;
      for (const r of chosen) {
        e.target.innerHTML = `<span class="spin"></span>${++n} of ${chosen.length}`;
        const mt = r.match;
        const patch = { album: mt.album, albumArtist: mt.albumArtist, year: mt.year, genre: mt.genre, track: mt.track, trackTotal: mt.trackTotal, disc: mt.disc, discTotal: mt.discTotal };
        if (!r.t.artist) patch.artist = mt.artist;
        const art = useArt && mt.art && (!onlyMissing || !r.t.hasArt) ? { url: mt.art } : undefined;
        try { await api.call('lib:update', { ids: [r.t.id], patch, art }); } catch {}
      }
      m.close(); Inspector.ids = [];
      toast(`Updated ${plural(chosen.length, 'song')}`);
    };
  }
};

/* Relay — Library: Books & Comics, Movies & Shows, Music.
   Your files live in plain folders inside "Relay Files"; this tab turns them into a poster wall
   with custom covers, resume points, series/seasons/albums, and favorites. */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const PDFJS = '../../node_modules/pdfjs-dist/build/pdf.min.mjs';
  const PDFJS_WORKER = '../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs';

  const SECTIONS = {
    continue: { label: 'Continue', icon: 'clock', color: 'var(--library)' },
    books: { label: 'Books & Comics', icon: 'book', color: '#f97316', noun: 'book', folder: 'Books & Comics',
      blurb: 'PDFs, comics (.cbz) and folders of pages. Put a series in its own folder and Relay groups the volumes.' },
    video: { label: 'Movies & Shows', icon: 'film', color: '#e5484d', noun: 'video', folder: 'Movies & Shows',
      blurb: 'A video on its own is a movie. A folder of episodes (S01E01…) or Season folders becomes a show.' },
    music: { label: 'Music', icon: 'music', color: '#a855f7', noun: 'track', folder: 'Music',
      blurb: 'Albums come from your folders and the songs’ own tags, with their built-in artwork.' },
    favorites: { label: 'Favorites', icon: 'heart', color: '#ec4899' }
  };
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('relay-library') || '{}'); } catch { return {}; } })();
  const L = {
    section: prefs.section || 'books', sort: prefs.sort || 'added', vfilter: 'all', query: '', detail: null,
    data: {}, loading: {}, el: null, side: null, root: null, failed: new Set(), queued: new Set(), queue: [], working: false
  };
  const savePrefs = () => { try { localStorage.setItem('relay-library', JSON.stringify({ section: L.section, sort: L.sort })); } catch {} };
  const items = (k) => L.data[k]?.items || [];
  const on = () => R().state.ui.platform === 'library';

  async function load(kind, force = false) {
    if (L.data[kind] && !force) return L.data[kind];
    if (L.loading[kind]) return L.loading[kind];
    L.loading[kind] = relay.library.scan(kind).then(d => { L.data[kind] = d; return d; }).finally(() => { delete L.loading[kind]; });
    return L.loading[kind];
  }
  const loadAll = (force) => Promise.all(['books', 'video', 'music'].map(k => load(k, force)));

  /* ---------- helpers ---------- */
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const fmtDur = (s) => { if (!s) return ''; s = Math.round(s); if (s < 60) return `${s} sec`; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} hr ${m} min` : `${m} min`; };
  const fmtTime = (s) => { s = Math.floor(s || 0); const m = Math.floor(s / 60), x = s % 60; return `${m}:${String(x).padStart(2, '0')}`; };
  const pctOf = (it) => {
    if (it.type === 'show') return it.watched ? Math.round(it.watched / it.count * 100) : 0;
    if (it.type === 'series') return 0;
    const p = it.progress;
    if (!p) return 0;
    if (p.total) return Math.min(100, Math.round(((p.page || 0) + 1) / p.total * 100));
    if (p.dur) return p.done ? 100 : Math.min(100, Math.round(p.pos / p.dur * 100));
    return 0;
  };
  const autoFor = (it) => it.auto || it.volumes?.[0]?.auto || it.episodes?.[0]?.auto || null;
  function kindOfItem(it) { return it.__kind; }
  function tag(all) { for (const k of ['books', 'video', 'music']) for (const it of items(k)) it.__kind = k; return all; }

  function coverHTML(it, kind, cls = '') {
    const auto = !it.cover && autoFor(it);
    const icon = kind === 'music' ? 'music' : kind === 'video' ? (it.type === 'show' ? 'tv' : 'film') : 'book';
    const ph = `<div class="lib-ph" style="--h:${hue(it.title)}">${ic(icon, 22)}<b>${esc(it.title)}</b>${it.year ? `<small>${it.year}</small>` : ''}</div>`;
    return `<div class="lib-cover ${cls}" ${auto ? `data-auto-src="${esc(auto.src)}"` : ''}>
      ${ph}${it.cover ? `<img src="${esc(it.cover)}" alt="" loading="lazy" decoding="async" data-fallback>` : ''}
    </div>`;
  }
  function badge(it, kind) {
    if (it.type === 'series') return `${it.count} vol${it.count === 1 ? '' : 's'}`;
    if (it.type === 'show') return `${it.seasons.length > 1 ? it.seasons.length + ' seasons · ' : ''}${it.count} ep${it.count === 1 ? '' : 's'}`;
    if (it.type === 'album') return `${it.count} song${it.count === 1 ? '' : 's'}`;
    if (kind === 'books') return it.ext === 'folder' ? 'Pages' : it.ext.toUpperCase();
    return '';
  }
  function subline(it, kind) {
    const bits = [];
    if (kind === 'music') bits.push(it.sub || it.artist || 'Unknown artist');
    else if (it.sub) bits.push(it.sub);
    if (it.year) bits.push(it.year);
    if (kind === 'books' && it.progress?.total && it.type === 'book') bits.push(`p. ${it.progress.page + 1} of ${it.progress.total}`);
    if (kind === 'video' && it.type === 'movie' && it.progress?.dur && !it.progress.done) bits.push(`${fmtTime(it.progress.dur - it.progress.pos)} left`);
    if (it.type === 'show' && it.watched) bits.push(`${it.watched}/${it.count} watched`);
    return bits.join(' · ');
  }
  function cardHTML(it, kind) {
    const pct = pctOf(it);
    const b = badge(it, kind);
    return `<div class="lib-card ${kind}" data-kind="${kind}" data-key="${esc(it.key)}" tabindex="0" title="${esc(it.title)}">
      <div class="lib-art">
        ${coverHTML(it, kind)}
        ${b ? `<span class="lib-badge">${esc(b)}</span>` : ''}
        ${it.favorite ? `<span class="lib-fav">${ic('heart', 13)}</span>` : ''}
        <button class="lib-play" data-play title="${kind === 'books' ? 'Read' : 'Play'}">${ic(kind === 'books' ? 'book' : 'play', 18)}</button>
        ${pct && pct < 100 ? `<i class="lib-prog"><i style="width:${pct}%"></i></i>` : ''}
        ${pct >= 100 ? `<span class="lib-done">${ic('check', 12)}</span>` : ''}
      </div>
      <div class="lib-t">${esc(it.title)}</div>
      <div class="lib-s">${esc(subline(it, kind)) || '&nbsp;'}</div>
    </div>`;
  }

  /* ---------- sidebar ---------- */
  function counts() {
    return {
      continue: continueList().length,
      books: items('books').length, video: items('video').length, music: items('music').length,
      favorites: ['books', 'video', 'music'].reduce((n, k) => n + items(k).filter(x => x.favorite).length, 0)
    };
  }
  function renderSidebar(side) {
    if (!side) return;
    L.side = side;
    if (!on()) return;
    const n = counts();
    const short = (L.root || '').replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/, '~');
    side.innerHTML = `<div class="home-side">
      <nav class="side-nav">${Object.entries(SECTIONS).map(([k, s]) => `
        <button data-sec="${k}" class="${L.section === k && !L.detail ? 'active' : L.section === k ? 'active' : ''}" style="--c:${s.color}">${ic(s.icon, 17)}<span>${s.label}</span>${n[k] ? `<span class="pill">${n[k]}</span>` : ''}</button>`).join('')}
      </nav>
      <div class="dl-folder lib-side-note">
        <div class="side-title" style="padding:0 0 8px">Your files live in</div>
        <button class="dl-path" id="libRoot" title="${esc(L.root || '')}">${ic('folder', 16)}<span>${esc(short || 'Relay Files')}</span></button>
        <div class="dl-folder-actions"><button class="btn ghost" id="libChange">Change…</button><button class="btn ghost" id="libRescan">Rescan</button></div>
      </div>
    </div>`;
    $$('[data-sec]', side).forEach(b => b.onclick = () => { L.section = b.dataset.sec; L.detail = null; L.query = ''; savePrefs(); renderSidebar(side); render(L.el); });
    $('#libRoot', side).onclick = () => relay.library.openFolder();
    $('#libRescan', side).onclick = async () => { await loadAll(true); refresh(); R().toast('Library updated'); };
    $('#libChange', side).onclick = async () => {
      const r = await relay.library.chooseRoot();
      if (r) { L.root = r; L.data = {}; await loadAll(true); refresh(); R().toast('Relay Files is now ' + r.replace(/^\/Users\/[^/]+/, '~')); }
    };
  }

  /* ---------- lists ---------- */
  function sorted(list) {
    const by = {
      added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
      opened: (a, b) => (Math.max(b.openedAt || 0, b.progress?.at || 0)) - (Math.max(a.openedAt || 0, a.progress?.at || 0)) || (b.addedAt - a.addedAt),
      year: (a, b) => (b.year || 0) - (a.year || 0)
    }[L.sort] || (() => 0);
    return [...list].sort(by);
  }
  function filtered(list) {
    const q = L.query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(it => [it.title, it.sub, it.artist, it.year, ...(it.tracks || []).map(t => t.title), ...(it.episodes || []).map(e => e.title)].some(x => String(x || '').toLowerCase().includes(q)));
  }
  function continueList() {
    const out = [];
    for (const it of items('books')) {
      const p = it.progress;
      if (p && p.total && p.page > 0 && p.page < p.total - 1) out.push({ it, kind: 'books', at: p.at });
      else if (it.type === 'series' && p) out.push({ it, kind: 'books', at: p.at });
    }
    for (const it of items('video')) {
      const p = it.progress;
      if (it.type === 'movie' && p && !p.done && p.pos > 10) out.push({ it, kind: 'video', at: p.at });
      if (it.type === 'show' && p && (it.watched < it.count)) out.push({ it, kind: 'video', at: p.at });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 30);
  }

  /* ---------- main ---------- */
  async function render(el) {
    if (!el) return;
    L.el = el;
    if (!on()) return;
    if (!L.root) { const r = await relay.library.root(); L.root = r.root; }
    const kinds = ['continue', 'favorites'].includes(L.section) ? ['books', 'video', 'music'] : [L.section];
    const missing = kinds.filter(k => !L.data[k]);
    if (missing.length) {
      if (!el.firstChild) el.innerHTML = `<div class="home-scroll lib-view"><div class="card-empty tall card">${ic('library', 24)}<span>Loading your library…</span></div></div>`;
      await Promise.all(missing.map(k => load(k)));
      tag();
      renderSidebar(L.side || $('#sidebar'));
      if (!on()) return;
    }
    tag();
    if (L.detail) return renderDetail(el);
    const sec = SECTIONS[L.section];
    const keepFocus = document.activeElement?.id === 'libSearch';
    let grid = '', count = 0, emptyMsg = '';
    if (L.section === 'continue') {
      const list = continueList();
      count = list.length;
      grid = list.map(x => cardHTML(x.it, x.kind)).join('');
      emptyMsg = 'Start a book, a movie or a show and it’ll wait for you here.';
    } else if (L.section === 'favorites') {
      const list = sorted(filtered(['books', 'video', 'music'].flatMap(k => items(k).filter(x => x.favorite))));
      count = list.length;
      grid = list.map(it => cardHTML(it, it.__kind)).join('');
      emptyMsg = 'Right-click anything in your library and choose Favorite.';
    } else {
      let list = items(L.section);
      if (L.section === 'video' && L.vfilter !== 'all') list = list.filter(x => x.type === L.vfilter);
      list = sorted(filtered(list));
      count = list.length;
      grid = list.map(it => cardHTML(it, L.section)).join('');
      emptyMsg = items(L.section).length ? 'Nothing matches.' : `Nothing here yet. Drop files onto this window, press <b>Add</b>, or put them in <b>Relay Files › ${esc(sec.folder)}</b>.`;
    }
    const title = L.section === 'continue' ? 'Pick up where you left off' : L.section === 'favorites' ? 'Your favorites' : sec.label;
    el.innerHTML = `<div class="home-scroll lib-view" id="libScroll">
      <header class="brief-head lib-head">
        <div>
          <div class="hero-date" style="color:${sec.color}">${ic('library', 14)} Library</div>
          <h1>${esc(title)}</h1>
          <p>${sec.blurb || (L.section === 'continue' ? 'Books in progress, movies you paused and the next episode of your shows.' : 'Everything you’ve marked as a favorite.')}</p>
        </div>
        <div class="hero-actions">
          ${['continue'].includes(L.section) ? '' : `<div class="search">${ic('search', 15)}<input id="libSearch" placeholder="Search ${esc(sec.label.toLowerCase())}" value="${esc(L.query)}"></div>
          <select id="libSort" class="lib-sort" title="Sort">
            ${[['added', 'Recently added'], ['opened', 'Recently opened'], ['title', 'Title'], ['year', 'Year']].map(([v, l]) => `<option value="${v}" ${L.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>`}
          ${SECTIONS[L.section].folder ? `<button class="btn" id="libFolder" title="Show this folder in Finder">${ic('folder', 15)}</button>
          <button class="btn brand" id="libAdd" style="--c:${sec.color}">${ic('plus', 15)} Add</button>` : ''}
        </div>
      </header>
      ${L.section === 'video' ? `<div class="lib-chips">${[['all', 'All'], ['movie', 'Movies'], ['show', 'Shows']].map(([v, l]) => `<button data-vf="${v}" class="${L.vfilter === v ? 'on' : ''}">${l}<span>${v === 'all' ? items('video').length : items('video').filter(x => x.type === v).length}</span></button>`).join('')}</div>` : ''}
      ${count ? `<div class="lib-grid ${L.section === 'music' ? 'square' : ''}">${grid}</div>` : `<div class="card-empty tall card lib-empty">${ic(sec.icon, 26)}<span>${emptyMsg}</span></div>`}
      <div class="lib-drop" id="libDrop"><div>${ic('download', 26)}<b>Drop to add to ${esc(SECTIONS[L.section].folder ? sec.label : 'your library')}</b><small>Files are copied into Relay Files</small></div></div>
    </div>`;
    const s = $('#libSearch', el);
    if (s) { s.oninput = () => { L.query = s.value; render(el); }; if (keepFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    const so = $('#libSort', el); if (so) so.onchange = () => { L.sort = so.value; savePrefs(); render(el); };
    $('#libFolder', el)?.addEventListener('click', () => relay.library.openFolder(L.section));
    $('#libAdd', el)?.addEventListener('click', async () => { const added = await relay.library.add(L.section); if (added.length) { await load(L.section, true); refresh(); R().toast(`Added ${added.length} item${added.length === 1 ? '' : 's'}`); } });
    $$('[data-vf]', el).forEach(b => b.onclick = () => { L.vfilter = b.dataset.vf; render(el); });
    bindCards(el);
    bindDrop(el);
    pumpCovers(el);
  }

  const findItem = (kind, key) => items(kind).find(x => x.key === key);
  function bindCards(el) {
    $$('.lib-card', el).forEach(c => {
      const it = findItem(c.dataset.kind, c.dataset.key);
      if (!it) return;
      const kind = c.dataset.kind;
      c.onclick = (e) => { if (e.target.closest('[data-play]')) { e.stopPropagation(); return quickPlay(it, kind); } openItem(it, kind); };
      c.onkeydown = (e) => { if (e.key === 'Enter') openItem(it, kind); };
      c.oncontextmenu = (e) => { e.preventDefault(); itemMenu(it, kind, e.clientX, e.clientY); };
      // drop an image on a poster to make it the cover
      c.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files') || [...e.dataTransfer.types].includes('text/uri-list')) { e.preventDefault(); e.stopPropagation(); c.classList.add('cover-drop'); } };
      c.ondragleave = () => c.classList.remove('cover-drop');
      c.ondrop = async (e) => {
        c.classList.remove('cover-drop');
        const f = [...e.dataTransfer.files][0];
        const p = f && relay.pathForFile(f);
        const url = !p && (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0];
        if (p && /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(p)) { e.preventDefault(); e.stopPropagation(); await setCover(it, kind, p); }
        else if (url && /^https?:/.test(url)) { e.preventDefault(); e.stopPropagation(); await setCover(it, kind, url.trim()); }
      };
    });
  }
  function bindDrop(el) {
    const view = $('.lib-view', el);
    const drop = $('#libDrop', el);
    if (!view) return;
    view.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); drop.classList.add('on'); } };
    view.ondragleave = (e) => { if (!view.contains(e.relatedTarget)) drop.classList.remove('on'); };
    view.ondrop = async (e) => {
      drop.classList.remove('on');
      const paths = [...(e.dataTransfer?.files || [])].map(f => relay.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      e.preventDefault(); e.stopPropagation();
      document.body.classList.remove('dropping');
      const groups = {};
      for (const p of paths) {
        const k = SECTIONS[L.section]?.folder ? L.section : (await relay.library.kindFor(p)) || 'books';
        (groups[k] = groups[k] || []).push(p);
      }
      let n = 0;
      for (const [k, ps] of Object.entries(groups)) { n += (await relay.library.importFiles(k, ps, false)).length; await load(k, true); }
      refresh();
      R().toast(n ? `Added ${n} item${n === 1 ? '' : 's'} to your library` : 'Nothing new to add');
    };
  }

  /* ---------- opening things ---------- */
  function openItem(it, kind) {
    if (it.type === 'series' || it.type === 'show' || it.type === 'album') { L.detail = { kind, key: it.key }; render(L.el); $('#libScroll', L.el)?.scrollTo(0, 0); return; }
    quickPlay(it, kind);
  }
  function quickPlay(it, kind) {
    relay.library.opened(kind, it.key);
    it.openedAt = Date.now();
    if (kind === 'books') {
      if (it.type === 'series') { const v = nextVolume(it); return readBook(v); }
      return readBook(it);
    }
    if (kind === 'video') {
      if (it.type === 'show') { const i = nextEpisodeIndex(it); return playEpisodes(it, i); }
      return window.Player?.open({ src: it.path, title: it.title + (it.year ? ` (${it.year})` : ''), kind: 'video' });
    }
    if (kind === 'music') return playAlbum(it, 0);
  }
  function readBook(b) {
    if (!b) return;
    if (b.ext === 'epub') { relay.library.openExternal(b.path); R().toast('EPUB books open in Apple Books'); return; }
    if (b.ext === 'cbr') { R().toast('.cbr comics need converting to .cbz first — they’re RAR files', 'error'); return; }
    window.Reader?.open(b.path);
  }
  function nextVolume(s) {
    const cur = s.volumes.find(v => v.key === s.progress?.volume);
    if (!cur) return s.volumes[0];
    const done = cur.progress && cur.progress.total && cur.progress.page >= cur.progress.total - 1;
    return done ? (s.volumes[s.volumes.indexOf(cur) + 1] || cur) : cur;
  }
  function nextEpisodeIndex(show) {
    const eps = show.episodes;
    const last = show.progress?.episode ? eps.findIndex(e => e.key === show.progress.episode) : -1;
    if (last < 0) return 0;
    if (!eps[last].progress?.done) return last;
    return Math.min(last + 1, eps.length - 1);
  }
  function epTitle(show, e) { return `${show.title} · S${e.season}${e.episode != null ? 'E' + String(e.episode).padStart(2, '0') : ''}${e.title ? ' — ' + e.title : ''}`; }
  function playEpisodes(show, i) {
    relay.library.opened('video', show.key);
    window.Player?.open(show.episodes.map(e => ({ src: e.path, title: epTitle(show, e), kind: 'video' })), i);
  }
  function playAlbum(a, i, shuffle = false) {
    relay.library.opened('music', a.key);
    let tracks = a.tracks.map(t => ({ src: t.path, title: t.title, sub: t.artist || a.sub, kind: 'audio', art: a.cover || null }));
    if (shuffle) { tracks = tracks.sort(() => Math.random() - 0.5); i = 0; }
    window.Player?.open(tracks, i);
  }

  /* ---------- detail: series / show / album ---------- */
  function renderDetail(el) {
    const { kind, key } = L.detail;
    const it = findItem(kind, key);
    if (!it) { L.detail = null; return render(el); }
    const sec = SECTIONS[kind];
    let body = '', primary = '', meta = [];
    if (it.type === 'series') {
      const nv = nextVolume(it);
      primary = `<button class="btn brand" id="ldPlay" style="--c:${sec.color}">${ic('book', 15)} ${it.progress ? 'Continue' : 'Start reading'}${nv ? ` · ${esc(nv.title)}` : ''}</button>`;
      meta = [`${it.count} volume${it.count === 1 ? '' : 's'}`];
      body = `<div class="lib-grid">${it.volumes.map(v => cardHTML({ ...v, type: 'book' }, 'books').replace('class="lib-card books"', `class="lib-card books" data-vol="${esc(v.key)}"`)).join('')}</div>`;
    } else if (it.type === 'show') {
      const ni = nextEpisodeIndex(it); const ne = it.episodes[ni];
      primary = `<button class="btn brand" id="ldPlay" style="--c:${sec.color}">${ic('play', 15)} ${it.progress ? 'Continue' : 'Play'} · S${ne.season}${ne.episode != null ? 'E' + String(ne.episode).padStart(2, '0') : ''}</button>`;
      meta = [`${it.seasons.length} season${it.seasons.length === 1 ? '' : 's'}`, `${it.count} episodes`, it.watched ? `${it.watched} watched` : ''];
      body = it.seasons.map(sn => `
        <section class="ld-season"><h3>Season ${sn}</h3>
          <div class="ld-eps">${it.episodes.filter(e => e.season === sn).map(e => {
            const pct = e.progress?.done ? 100 : e.progress?.dur ? Math.round(e.progress.pos / e.progress.dur * 100) : 0;
            return `<div class="ld-ep" data-ep="${esc(e.key)}">
              <div class="ld-thumb">${coverHTML({ ...e, title: e.title || `Episode ${e.episode ?? ''}` }, 'video', 'wide')}${pct && pct < 100 ? `<i class="lib-prog"><i style="width:${pct}%"></i></i>` : ''}<span class="ld-ep-play">${ic('play', 16)}</span></div>
              <div class="ld-ep-t"><b>${e.episode != null ? `${e.episode}. ` : ''}${esc(e.title || 'Episode ' + (e.episode ?? ''))}</b><small>${pct >= 100 ? `${ic('check', 12)} Watched` : e.progress?.pos ? `${fmtTime(e.progress.dur - e.progress.pos)} left` : ''}</small></div>
            </div>`;
          }).join('')}</div>
        </section>`).join('');
    } else if (it.type === 'album') {
      primary = `<button class="btn brand" id="ldPlay" style="--c:${sec.color}">${ic('play', 15)} Play</button><button class="btn" id="ldShuffle">${ic('shuffle', 15)} Shuffle</button>`;
      meta = [it.sub || it.artist, it.year, `${it.count} song${it.count === 1 ? '' : 's'}`, fmtDur(it.duration)];
      body = `<div class="ld-tracks">${it.tracks.map((t, i) => `
        <button class="ld-track" data-tr="${i}"><span class="n">${t.track ?? i + 1}</span><span class="t"><b>${esc(t.title)}</b>${t.artist && t.artist !== it.sub ? `<small>${esc(t.artist)}</small>` : ''}</span><span class="d">${t.duration ? fmtTime(t.duration) : ''}</span></button>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="home-scroll lib-view lib-detail" id="libScroll">
      <button class="link lib-back" id="ldBack">${ic('chevronLeft', 15)} ${esc(SECTIONS[L.section]?.label || sec.label)}</button>
      <header class="ld-head ${kind}">
        <div class="ld-art lib-card ${kind}" data-kind="${kind}" data-key="${esc(it.key)}">${coverHTML(it, kind)}</div>
        <div class="ld-info">
          <div class="hero-date" style="color:${sec.color}">${ic(sec.icon, 14)} ${it.type === 'series' ? 'Series' : it.type === 'show' ? 'TV show' : 'Album'}</div>
          <h1>${esc(it.title)}</h1>
          <p class="ld-meta">${meta.filter(Boolean).map(esc).join(' · ')}</p>
          ${it.notes ? `<p class="ld-notes">${esc(it.notes)}</p>` : ''}
          <div class="ld-actions">${primary}
            <button class="btn" id="ldCover">${ic('image', 15)} Cover</button>
            <button class="btn" id="ldEdit">${ic('edit', 15)} Details</button>
            <button class="icon-btn" id="ldFav" title="${it.favorite ? 'Remove from favorites' : 'Favorite'}" style="${it.favorite ? 'color:#ec4899' : ''}">${ic('heart', 17)}</button>
            <button class="icon-btn" id="ldMore" title="More">${ic('dots', 17)}</button>
          </div>
        </div>
      </header>
      ${body}
      <div class="lib-drop" id="libDrop"><div>${ic('download', 26)}<b>Drop to add to ${esc(sec.label)}</b><small>Files are copied into Relay Files</small></div></div>
    </div>`;
    $('#ldBack', el).onclick = () => { L.detail = null; render(el); };
    $('#ldPlay', el).onclick = () => quickPlay(it, kind);
    $('#ldShuffle', el)?.addEventListener('click', () => playAlbum(it, 0, true));
    $('#ldCover', el).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); coverMenu(it, kind, r.left, r.bottom + 4); };
    $('#ldEdit', el).onclick = () => editDetails(it, kind);
    $('#ldFav', el).onclick = () => toggleFav(it, kind);
    $('#ldMore', el).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); itemMenu(it, kind, r.right - 230, r.bottom + 4, true); };
    $$('[data-ep]', el).forEach(r => {
      const i = it.episodes.findIndex(e => e.key === r.dataset.ep);
      r.onclick = () => playEpisodes(it, i);
      r.oncontextmenu = (e) => { e.preventDefault(); const ep = it.episodes[i]; R().popMenu(e.clientX, e.clientY, [
        { label: 'Play', icon: 'play', onClick: () => playEpisodes(it, i) },
        { label: ep.progress?.done ? 'Mark as unwatched' : 'Mark as watched', icon: 'check', onClick: async () => { await relay.media.saveProgress({ file: ep.path, pos: ep.progress?.done ? 0 : 1e9, dur: ep.progress?.dur || 1 }); await load('video', true); refresh(); } },
        { label: 'Show in Finder', icon: 'folder', onClick: () => relay.library.show(ep.path) }]); };
    });
    $$('[data-tr]', el).forEach(b => b.onclick = () => playAlbum(it, +b.dataset.tr));
    // volumes behave like normal book cards
    $$('[data-vol]', el).forEach(c => {
      const v = it.volumes.find(x => x.key === c.dataset.vol);
      c.onclick = () => { relay.library.opened('books', it.key); readBook(v); };
      c.oncontextmenu = (e) => { e.preventDefault(); itemMenu({ ...v, type: 'book' }, 'books', e.clientX, e.clientY); };
    });
    const art = $('.ld-art', el);
    art.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); art.classList.add('cover-drop'); };
    art.ondragleave = () => art.classList.remove('cover-drop');
    art.ondrop = async (e) => {
      e.preventDefault(); e.stopPropagation(); art.classList.remove('cover-drop');
      const f = [...e.dataTransfer.files][0]; const p = f && relay.pathForFile(f);
      const url = !p && (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0];
      if (p || url) setCover(it, kind, p || url.trim());
    };
    bindDrop(el);
    pumpCovers(el);
  }

  /* ---------- menus & edits ---------- */
  function coverMenu(it, kind, x, y) {
    R().popMenu(x, y, [
      { label: 'Choose an image…', icon: 'image', onClick: async () => { if (await relay.library.pickCover(kind, it.key)) { await load(kind, true); refresh(); R().toast('Cover updated'); } } },
      { label: 'Use an image from the web…', icon: 'link', onClick: () => coverFromUrl(it, kind) },
      ...(it.coverKind === 'custom' ? [{ label: 'Use automatic cover', icon: 'refresh', onClick: async () => { await relay.library.resetCover(kind, it.key); await load(kind, true); refresh(); } }] : []),
      '-',
      { html: '<small class="lib-tip">Tip: drag any image — or one from a web page — onto a poster</small>' }
    ]);
  }
  function itemMenu(it, kind, x, y, inDetail = false) {
    const playLabel = kind === 'books' ? (it.type === 'series' ? 'Continue reading' : 'Read') : it.type === 'album' ? 'Play album' : it.type === 'show' ? 'Play next episode' : 'Play';
    R().popMenu(x, y, [
      { label: playLabel, icon: kind === 'books' ? 'book' : 'play', onClick: () => quickPlay(it, kind) },
      ...(!inDetail && ['series', 'show', 'album'].includes(it.type) ? [{ label: 'Open', icon: 'arrowRight', onClick: () => openItem(it, kind) }] : []),
      ...(it.type === 'album' ? [{ label: 'Shuffle', icon: 'shuffle', onClick: () => playAlbum(it, 0, true) }] : []),
      ...(kind === 'video' && it.type === 'movie' && it.progress ? [{ label: it.progress.done ? 'Mark as unwatched' : 'Mark as watched', icon: 'check', onClick: async () => { await relay.media.saveProgress({ file: it.path, pos: it.progress.done ? 0 : 1e9, dur: it.progress.dur || 1 }); await load('video', true); refresh(); } }] : []),
      '-',
      { label: it.favorite ? 'Remove from favorites' : 'Favorite', icon: 'heart', onClick: () => toggleFav(it, kind) },
      { label: 'Change cover…', icon: 'image', onClick: () => coverMenu(it, kind, x, y) },
      { label: 'Edit details…', icon: 'edit', onClick: () => editDetails(it, kind) },
      { label: 'Show in Finder', icon: 'folder', onClick: () => relay.library.show(it.path) },
      '-',
      { label: 'Move to Trash…', icon: 'trash', danger: true, onClick: () => trash(it, kind) }
    ]);
  }
  async function toggleFav(it, kind) {
    await relay.library.meta(kind, it.key, { favorite: it.favorite ? null : true });
    it.favorite = !it.favorite;
    refresh();
  }
  async function setCover(it, kind, from) {
    try { await relay.library.setCover(kind, it.key, from); await load(kind, true); refresh(); R().toast('Cover updated'); }
    catch (e) { R().toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); }
  }
  function coverFromUrl(it, kind) {
    R().openModal({
      title: 'Cover from the web', subtitle: 'Paste a link to an image — right-click a poster or cover online and choose “Copy Image Address”.', icon: 'image', color: SECTIONS[kind].color,
      body: `<div class="field"><label>Image link</label><input class="input" id="lcUrl" placeholder="https://…/poster.jpg" autocomplete="off"></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Use image', cls: 'brand', onClick: async (m) => { const u = $('#lcUrl', m || document).value.trim(); if (/^https?:/.test(u)) await setCover(it, kind, u); } }],
      onMount: (m) => setTimeout(() => $('#lcUrl', m)?.focus(), 50)
    });
  }
  function editDetails(it, kind) {
    const subLabel = kind === 'music' ? 'Artist' : kind === 'books' ? 'Author / writer' : 'Tagline';
    R().openModal({
      title: 'Edit details', subtitle: 'Only changes how it shows in Relay — your files aren’t renamed.', icon: 'edit', color: SECTIONS[kind].color,
      body: `<div class="lib-form"><div class="field"><label>Title</label><input class="input" id="leTitle" value="${esc(it.title)}"></div>
        <div class="lib-form-row"><div class="field"><label>${subLabel}</label><input class="input" id="leSub" value="${esc(it.sub || it.artist || '')}"></div>
        <div class="field" style="width:110px"><label>Year</label><input class="input" id="leYear" inputmode="numeric" value="${esc(it.year || '')}"></div></div>
        <div class="field"><label>Notes</label><textarea class="input" id="leNotes" rows="3" placeholder="Anything you want to remember">${esc(it.notes || '')}</textarea></div></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'brand', onClick: async (m) => {
        const root = m || document;
        const y = parseInt($('#leYear', root).value, 10);
        await relay.library.meta(kind, it.key, { title: $('#leTitle', root).value.trim() || null, sub: $('#leSub', root).value.trim() || null, year: y > 1800 && y < 2200 ? y : null, notes: $('#leNotes', root).value.trim() || null });
        await load(kind, true); refresh();
      } }]
    });
  }
  function trash(it, kind) {
    R().openModal({
      title: `Move “${it.title}” to the Trash?`, subtitle: it.isDir ? 'The whole folder goes to the Trash. You can put it back from there.' : 'The file goes to the Trash. You can put it back from there.',
      icon: 'trash', color: 'var(--danger)', body: '',
      actions: [{ label: 'Cancel' }, { label: 'Move to Trash', cls: 'brand', style: '--c:var(--danger)', onClick: async () => { await relay.library.trash(it.path); L.detail = null; await load(kind, true); refresh(); } }]
    });
  }

  /* ---------- automatic covers (first page / a frame of the video) ---------- */
  function pumpCovers(el) {
    for (const node of $$('[data-auto-src]', el)) {
      const src = node.dataset.autoSrc;
      if (L.failed.has(src) || L.queued.has(src)) continue;
      const it = ['books', 'video', 'music'].flatMap(k => items(k)).flatMap(x => [x, ...(x.volumes || []), ...(x.episodes || [])]).find(x => x.auto?.src === src);
      if (!it?.auto) continue;
      L.queued.add(src);
      L.queue.push(it.auto);
    }
    work();
  }
  async function work() {
    if (L.working) return;
    L.working = true;
    while (L.queue.length) {
      const job = L.queue.shift();
      let url = null;
      try { url = await makeThumb(job); } catch { url = null; }
      if (!url) { L.failed.add(job.src); continue; }
      // patch everything showing that source (card, series/show poster, detail)
      for (const k of ['books', 'video', 'music']) for (const x of items(k)) for (const y of [x, ...(x.volumes || []), ...(x.episodes || [])]) {
        if (y.auto?.src === job.src) { y.cover = url; y.coverKind = 'auto'; y.auto = null; }
        if (!x.cover && (x.volumes?.[0] === y || x.episodes?.[0] === y) && y.cover === url) { x.cover = url; x.coverKind = 'auto'; }
      }
      $$(`[data-auto-src="${CSS.escape(job.src)}"]`).forEach(n => {
        n.removeAttribute('data-auto-src');
        if (!n.querySelector('img')) n.insertAdjacentHTML('beforeend', `<img src="${esc(url)}" alt="" decoding="async">`);
      });
      await new Promise(r => setTimeout(r, 30));
    }
    L.working = false;
  }
  const fileUrl = (p) => 'file://' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  function toJpeg(source, w, h, max = 480) {
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d', { alpha: false }).drawImage(source, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', 0.84);
    c.width = c.height = 0;
    return out;
  }
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
  let pdfLib = null;
  async function makeThumb(job) {
    let dataUrl = null;
    if (job.type === 'image') {
      const img = await loadImg(fileUrl(job.from));
      dataUrl = toJpeg(img, img.naturalWidth, img.naturalHeight);
    } else if (job.type === 'zip') {
      const r = await relay.library.zipFirst(job.src);
      if (!r) return null;
      const u = URL.createObjectURL(new Blob([r.data]));
      try { const img = await loadImg(u); dataUrl = toJpeg(img, img.naturalWidth, img.naturalHeight); } finally { URL.revokeObjectURL(u); }
    } else if (job.type === 'pdf') {
      if (!pdfLib) { pdfLib = await import(PDFJS); pdfLib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, location.href).href; }
      const bytes = await relay.library.fileBytes(job.src);
      if (!bytes) return null;
      const task = pdfLib.getDocument({ data: bytes });
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 520 / Math.max(vp1.width, vp1.height) });
        const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
        dataUrl = c.toDataURL('image/jpeg', 0.84); c.width = c.height = 0;
      } finally { task.destroy().catch(() => {}); }
    } else if (job.type === 'video') {
      dataUrl = await videoFrame(job.src);
    }
    if (!dataUrl) return null;
    return relay.library.saveThumb({ src: job.src, mtime: job.mtime, dataUrl });
  }
  function videoFrame(src) {
    return new Promise((res) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.playsInline = true;
      let tries = 0;
      const done = (val) => { clearTimeout(t); v.removeAttribute('src'); try { v.load(); } catch {} res(val); };
      const t = setTimeout(() => done(null), 15000);
      v.onerror = () => done(null);
      v.onloadedmetadata = () => { if (!v.videoWidth) return done(null); v.currentTime = Math.min(Math.max(v.duration * 0.12, 3), 420); };
      v.onseeked = () => {
        const out = toJpeg(v, v.videoWidth, v.videoHeight, 560);
        // skip near-black frames (fades, title cards) once
        const probe = document.createElement('canvas'); probe.width = 16; probe.height = 9;
        const g = probe.getContext('2d'); g.drawImage(v, 0, 0, 16, 9);
        const px = g.getImageData(0, 0, 16, 9).data; let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
        if (sum / (px.length / 4) < 40 && tries++ < 1) { v.currentTime = Math.min(v.duration * 0.33, v.currentTime + 120); return; }
        done(out);
      };
      v.src = fileUrl(src);
    });
  }

  function refresh() {
    renderSidebar(L.side || $('#sidebar'));
    if (on()) render(L.el);
  }
  relay.library.onChanged(async () => {
    const kinds = Object.keys(L.data);
    await Promise.all(kinds.map(k => load(k, true)));
    if (on()) refresh();
  });

  // Downloads → library hand-off
  async function addFromDownload(path, name) {
    const kind = await relay.library.kindFor(path);
    if (!kind) { R().toast('That kind of file doesn’t go in the library', 'error'); return null; }
    const done = await relay.library.importFiles(kind, [path], true);
    if (done.length) { L.data[kind] = null; delete L.data[kind]; R().toast(`Moved ${name || 'it'} to ${SECTIONS[kind].label}`, '', { label: 'View', onClick: () => { L.section = kind; L.detail = null; R().setPlatform('library'); } }); }
    return done[0] || null;
  }

  window.Library = { render, renderSidebar, addFromDownload, reload: () => loadAll(true).then(refresh) };
})();

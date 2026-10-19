/* Relay — built-in browser with tabs, bookmarks, incognito and ad blocking */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const NORMAL = 'persist:relay-browser', INCOG = 'relay-incognito';
  const ENGINES = {
    google: { label: 'Google', url: 'https://www.google.com/search?q=' },
    duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' }
  };
  const TILE = ['#6d4aff', '#ff4f9a', '#ff6b3d', '#ffb03b', '#22c55e', '#10b5a0', '#0ea5e9', '#1f7bff', '#a855f7', '#e5484d'];
  const tileColor = (s) => TILE[[...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE.length];

  const b = { tabs: [], active: null, el: null, side: null, built: false, saveT: null, pollT: null, restored: false };

  const st = () => R().state;
  const bm = () => (st().browser.bookmarks = st().browser.bookmarks || []);
  const activeTab = () => b.tabs.find(t => t.id === b.active);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

  function toURL(input) {
    const s = input.trim();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data):/i.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
    const eng = ENGINES[st().settings.searchEngine] || ENGINES.google;
    return eng.url + encodeURIComponent(s);
  }

  /* ---------- tabs ---------- */
  function restore() {
    if (b.restored) return;
    b.restored = true;
    const saved = st().browser.tabs || [];
    saved.forEach(t => b.tabs.push({ id: R().uid(), url: t.url, title: t.title || hostOf(t.url), favicon: t.favicon || '', incognito: false }));
    if (!b.tabs.length) b.tabs.push({ id: R().uid(), url: '', title: 'New tab', incognito: false });
    b.active = b.tabs[Math.min(st().browser.activeIndex || 0, b.tabs.length - 1)].id;
  }
  function persist() {
    clearTimeout(b.saveT);
    b.saveT = setTimeout(() => {
      const normal = b.tabs.filter(t => !t.incognito && t.url);
      const act = activeTab();
      relay.browser.save({ tabs: normal.map(t => ({ url: t.url, title: t.title, favicon: t.favicon })), activeIndex: Math.max(0, normal.indexOf(act)) });
    }, 500);
  }

  function openTab(url = '', { incognito = false, background = false } = {}) {
    restore();
    const t = { id: R().uid(), url: url ? toURL(url) : '', title: url ? hostOf(toURL(url)) : (incognito ? 'Incognito tab' : 'New tab'), favicon: '', incognito };
    const cur = activeTab();
    const idx = cur ? b.tabs.indexOf(cur) + 1 : b.tabs.length;
    b.tabs.splice(idx, 0, t);
    if (!background) b.active = t.id;
    if (st().ui.platform !== 'browser') R().setPlatform('browser'); else update();
    if (!background && !url) setTimeout(() => focusOmni(), 60);
    persist();
    return t;
  }

  async function closeTab(id) {
    const t = b.tabs.find(x => x.id === id);
    if (!t) return;
    const i = b.tabs.indexOf(t);
    t.wrap?.remove();
    b.tabs.splice(i, 1);
    if (t.incognito && !b.tabs.some(x => x.incognito)) { await relay.browser.clearIncognito(); R().toast('Incognito session cleared'); }
    if (!b.tabs.length) b.tabs.push({ id: R().uid(), url: '', title: 'New tab', incognito: false });
    if (b.active === id) b.active = (b.tabs[i] || b.tabs[i - 1]).id;
    update(); persist();
  }

  function activate(id) { b.active = id; update(); persist(); }

  async function ensureWv(t) {
    if (t.wv || !t.url) return t;
    if (t.creating) return t.creating;
    t.creating = (async () => {
      const partition = t.incognito ? INCOG : NORMAL;
      const { preload } = await relay.prepareSession(partition, 'auto');
      const wrap = document.createElement('div');
      wrap.className = 'br-wrap';
      wrap.dataset.tab = t.id;
      wrap.innerHTML = '<div class="loading-bar"></div>';
      const wv = document.createElement('webview');
      wv.setAttribute('partition', partition);
      wv.setAttribute('preload', preload);
      wv.setAttribute('webpreferences', 'sandbox=yes');
      wv.setAttribute('allowpopups', '');
      wv.setAttribute('src', t.url);
      wrap.appendChild(wv);
      $('#brViews', b.el).appendChild(wrap);
      t.wrap = wrap; t.wv = wv;
      const sync = () => { if (t.id === b.active) updateBar(); renderSidebar(b.side); };
      wv.addEventListener('did-start-loading', () => { t.loading = true; t.error = null; wrap.classList.add('loading'); sync(); });
      wv.addEventListener('did-stop-loading', () => { t.loading = false; wrap.classList.remove('loading'); refreshCount(t); sync(); });
      wv.addEventListener('page-title-updated', (e) => { t.title = e.title; sync(); persist(); });
      wv.addEventListener('page-favicon-updated', (e) => { t.favicon = e.favicons?.[0] || ''; sync(); persist(); });
      const nav = (e) => { if (e.isMainFrame === false) return; if (e.type === 'did-navigate') { t.media = []; t.hasVideo = false; } t.url = e.url; if (document.activeElement !== $('#brOmni', b.el)) sync(); else renderSidebar(b.side); persist(); };
      wv.addEventListener('did-navigate', nav);
      wv.addEventListener('did-navigate-in-page', nav);
      wv.addEventListener('did-fail-load', (e) => {
        if (!e.isMainFrame || e.errorCode === -3) return;
        t.error = { code: e.errorCode, desc: e.errorDescription, url: e.validatedURL };
        sync();
      });
      wv.addEventListener('dom-ready', () => { t.ready = true; });
      return t;
    })();
    await t.creating;
    t.creating = null;
    return t;
  }

  async function navigate(input, t = activeTab()) {
    const url = toURL(input);
    if (!url || !t) return;
    t.url = url; t.error = null;
    if (!t.wv) { await ensureWv(t); update(); }
    else t.wv.loadURL(url).catch(() => {});
    persist();
  }

  async function refreshCount(t = activeTab()) {
    if (!t?.wv || !t.ready) return;
    try { t.blocked = await relay.adblock.count(t.wv.getWebContentsId()); } catch { t.blocked = 0; }
    if (t.id === b.active) {
      const n = $('#brShield .n', b.el);
      if (n) n.textContent = t.blocked ? String(t.blocked) : '';
    }
    scanMedia(t);
  }

  /* ---------- media on the page → Relay Player ---------- */
  const YT = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i;
  const POP_OUT = `(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!v) return false; if (document.pictureInPictureElement) { document.exitPictureInPicture(); return true; } v.requestPictureInPicture(); return true; })()`;
  const SCAN = `(() => {
    const out = [];
    const add = (u, kind, title) => { if (u && /^https?:/.test(u) && !out.some(x => x.url === u)) out.push({ url: u, kind, title: (title || '').trim().slice(0, 80) }); };
    document.querySelectorAll('video, audio').forEach(m => {
      const k = m.tagName === 'AUDIO' ? 'audio' : 'video';
      add(m.currentSrc || m.src, /\\.m3u8/i.test(m.currentSrc || m.src) ? 'hls' : k, m.title || m.getAttribute('aria-label') || document.title);
      m.querySelectorAll('source').forEach(s => add(s.src, /\\.m3u8/i.test(s.src) ? 'hls' : k, document.title));
    });
    const og = document.querySelector('meta[property="og:video:secure_url"], meta[property="og:video:url"], meta[property="og:video"]');
    if (og && /\\.(mp4|webm|m3u8|mov)(\\?|$)/i.test(og.content)) add(og.content, /\\.m3u8/i.test(og.content) ? 'hls' : 'video', document.title);
    document.querySelectorAll('a[href]').forEach(a => { if (out.length < 30 && /\\.(mp4|m4v|webm|mov|mp3|m4a|flac|wav|ogg|m3u8)(\\?|$)/i.test(a.href)) add(a.href, /\\.(mp3|m4a|flac|wav|ogg)(\\?|$)/i.test(a.href) ? 'audio' : /\\.m3u8/i.test(a.href) ? 'hls' : 'video', a.textContent || a.href.split('/').pop()); });
    return { items: out, videos: document.querySelectorAll('video').length };
  })()`;
  async function scanMedia(t = activeTab()) {
    if (!t?.wv || !t.ready) return;
    let dom = { items: [], videos: 0 }, sniffed = [];
    try { dom = await t.wv.executeJavaScript(SCAN); } catch {}
    try { sniffed = await relay.media.found(t.wv.getWebContentsId()); } catch {}
    const all = [...dom.items];
    for (const s of sniffed) if (!all.some(x => x.url === s.url)) all.push({ url: s.url, kind: s.kind, title: '' });
    t.media = all; t.hasVideo = dom.videos > 0;
    if (t.id === b.active) updateMediaBtn(t);
  }
  function updateMediaBtn(t) {
    const btn = b.el && $('#brMedia', b.el);
    if (!btn) return;
    const yt = YT.test(t?.url || '');
    btn.hidden = !(t?.media?.length || t?.hasVideo || yt);
    $('.n', btn).textContent = t?.media?.length ? String(t.media.length) : '';
  }
  function mediaName(m, t) {
    let name = m.title && m.title !== t.title ? m.title : '';
    try { const f = decodeURIComponent(new URL(m.url).pathname.split('/').pop() || ''); if (!name && f && f.length < 60) name = f; } catch {}
    return name || (m.kind === 'hls' ? 'Video stream' : m.kind === 'audio' ? 'Audio' : 'Video');
  }
  async function mediaMenu(e) {
    const t = activeTab();
    const r = e.currentTarget.getBoundingClientRect();
    await scanMedia(t);
    const part = t.incognito ? INCOG : NORMAL;
    const yt = YT.test(t.url || '');
    const items = [{ html: `<div class="cast-pop-h"><b>${ic('film', 16)} Play in Relay Player</b><small>${t.media?.length ? 'Media found on this page:' : yt ? 'Watch this video full-window in Relay Player.' : 'This video streams in pieces, so it can’t leave the page — but you can pop it out.'}</small></div>` }];
    if (yt) items.push({ label: 'Watch in Relay Player (cinema view)', icon: 'play', onClick: () => window.Player?.open({ src: t.url, title: t.title, web: true }) });
    (t.media || []).slice(0, 12).forEach(m => items.push({ label: `${mediaName(m, t)}${m.kind === 'hls' ? ' · stream' : ''}`, icon: m.kind === 'audio' ? 'music' : 'film',
      onClick: () => window.Player?.open({ src: m.url, title: mediaName(m, t), partition: part, referer: t.url, kind: m.kind }) }));
    if (t.hasVideo) items.push('-', { label: 'Pop out video (picture in picture)', icon: 'pip', onClick: () => t.wv.executeJavaScript(POP_OUT, true).catch(() => {}) });
    items.push({ html: `<div class="cast-pop-h"><small>Copy-protected services (Netflix, Disney+, Max, Prime Video…) can only play on their own page — use Pop out for those.</small></div>` });
    R().popMenu(r.right - 300, r.bottom + 6, items);
  }

  /* ---------- rendering ---------- */
  function build(el) {
    el.innerHTML = `
      <div class="br-bar" id="brBar">
        <button class="icon-btn" id="brBack" title="Back (⌘[)">${ic('chevronLeft', 18)}</button>
        <button class="icon-btn" id="brFwd" title="Forward (⌘])">${ic('chevronRight', 18)}</button>
        <button class="icon-btn" id="brReload" title="Reload (⌘R)">${ic('refresh', 16)}</button>
        <form class="omni" id="brOmniForm">
          <span class="omni-ic" id="brOmniIc"></span>
          <input id="brOmni" spellcheck="false" autocomplete="off" />
          <button type="button" class="icon-btn sm" id="brStar" title="Bookmark">${ic('star', 15)}</button>
        </form>
        <button class="media-btn" id="brMedia" title="Play this page’s video in Relay Player" hidden>${ic('film', 16)}<span class="n"></span></button>
        <button class="shield" id="brShield" title="Ads & trackers blocked on this page">${ic('shield', 16)}<span class="n"></span></button>
        <button class="icon-btn" id="brMenu" title="More">${ic('dots', 18)}</button>
      </div>
      <div class="br-views" id="brViews">
        <div class="br-start" id="brStart"></div>
        <div class="br-error" id="brError" hidden></div>
      </div>`;
    $('#brBack', el).onclick = () => activeTab()?.wv?.goBack();
    $('#brFwd', el).onclick = () => activeTab()?.wv?.goForward();
    $('#brReload', el).onclick = () => { const t = activeTab(); if (t?.loading) t.wv.stop(); else if (t?.wv) t.wv.reload(); };
    const omni = $('#brOmni', el);
    omni.onfocus = () => setTimeout(() => omni.select(), 0);
    omni.onkeydown = (e) => { if (e.key === 'Escape') { omni.value = activeTab()?.url || ''; omni.blur(); } };
    $('#brOmniForm', el).onsubmit = (e) => { e.preventDefault(); navigate(omni.value); omni.blur(); };
    $('#brStar', el).onclick = toggleBookmark;
    $('#brShield', el).onclick = shieldMenu;
    $('#brMedia', el).onclick = mediaMenu;
    $('#brMenu', el).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); moreMenu(r.right - 220, r.bottom + 4); };
    b.built = true;
  }

  function render(el) {
    restore();
    b.el = el;
    if (!b.built || !$('#brBar', el)) { b.built = false; build(el); }
    update();
    clearInterval(b.pollT);
    b.pollT = setInterval(() => { if (st().ui.platform === 'browser') refreshCount(); else clearInterval(b.pollT); }, 2500);
  }

  function update() {
    if (!b.el || st().ui.platform !== 'browser') { renderSidebar(b.side); return; }
    const t = activeTab();
    if (t && t.url && !t.wv) ensureWv(t).then(() => update());
    b.tabs.forEach(x => x.wrap?.classList.toggle('active', x === t));
    const start = $('#brStart', b.el);
    start.hidden = !!(t && t.url);
    if (!start.hidden) renderStart(start, t);
    const err = $('#brError', b.el);
    err.hidden = !t?.error;
    if (t?.error) err.innerHTML = `<div class="detail-empty">${ic('globe', 34)}<h3>Can’t reach this page</h3><p>${esc(hostOf(t.error.url) || t.error.url)} — ${esc(t.error.desc)}</p><button class="btn" id="brRetry">${ic('refresh', 14)} Try again</button></div>`;
    $('#brRetry', b.el)?.addEventListener('click', () => { t.error = null; t.wv?.reload(); update(); });
    updateBar();
    renderSidebar(b.side);
    window.AI?.updateContext?.();
  }

  function updateBar() {
    const t = activeTab();
    if (!b.el || !t) return;
    const bar = $('#brBar', b.el);
    bar.classList.toggle('incog', !!t.incognito);
    $('#brViews', b.el).classList.toggle('incog', !!t.incognito);
    let back = false, fwd = false;
    if (t.wv && t.ready) { try { back = t.wv.canGoBack(); fwd = t.wv.canGoForward(); } catch {} }
    $('#brBack', b.el).disabled = !back;
    $('#brFwd', b.el).disabled = !fwd;
    $('#brReload', b.el).innerHTML = ic(t.loading ? 'x' : 'refresh', 16);
    const omni = $('#brOmni', b.el);
    if (document.activeElement !== omni) omni.value = t.url || '';
    const eng = (ENGINES[st().settings.searchEngine] || ENGINES.google).label;
    omni.placeholder = t.incognito ? `Search ${eng} privately or type a URL` : `Search ${eng} or type a URL`;
    const secure = /^https:/.test(t.url || '');
    $('#brOmniIc', b.el).innerHTML = t.incognito ? `<span class="incog-chip">${ic('eyeOff', 13)} Incognito</span>` : t.url ? ic(secure ? 'lock' : 'globe', 14) : ic('search', 14);
    const starred = t.url && bm().some(x => x.url === t.url);
    $('#brStar', b.el).classList.toggle('on', !!starred);
    $('#brStar', b.el).hidden = !t.url;
    updateMediaBtn(t);
    const shield = $('#brShield', b.el);
    const on = st().settings.adblockBrowser !== false;
    shield.classList.toggle('off', !on);
    $('.n', shield).textContent = on && t.blocked ? String(t.blocked) : '';
  }

  function renderStart(el, t) {
    const marks = bm();
    const hr = new Date().getHours();
    const hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const name = (st().settings.userName || '').trim();
    el.className = 'br-start' + (t?.incognito ? ' incog' : '');
    el.innerHTML = t?.incognito ? `
      <div class="bs-inner">
        <div class="incog-badge">${ic('eyeOff', 30)}</div>
        <h1>You’re incognito</h1>
        <p>Pages you visit in incognito tabs aren’t saved, and their cookies and sign-ins are wiped when you close your last incognito tab. Downloads and bookmarks you make are kept.</p>
        <form class="bs-search" id="bsForm">${ic('search', 18)}<input id="bsInput" placeholder="Search privately or type a URL" autocomplete="off"></form>
      </div>` : `
      <div class="bs-inner">
        <h1>${hello}${name ? `, <span>${esc(name)}</span>` : ''}</h1>
        <form class="bs-search" id="bsForm">${ic('search', 18)}<input id="bsInput" placeholder="Search ${(ENGINES[st().settings.searchEngine] || ENGINES.google).label} or type a URL" autocomplete="off"></form>
        <div class="bs-marks">${marks.map(m => `
          <button class="bs-mark" data-url="${esc(m.url)}" title="${esc(m.url)}">
            <span class="bs-ic" style="--c:${tileColor(hostOf(m.url))}">${m.favicon ? `<img src="${esc(m.favicon)}" data-fallback>` : ''}<i>${esc((m.title || hostOf(m.url))[0]?.toUpperCase() || '?')}</i></span>
            <span class="bs-t">${esc(m.title || hostOf(m.url))}</span>
          </button>`).join('')}
          <button class="bs-mark add" id="bsAdd"><span class="bs-ic">${ic('plus', 18)}</span><span class="bs-t">Add</span></button>
        </div>
        <div class="bs-note">${ic('shield', 14)} ${st().settings.adblockBrowser !== false ? 'Ads and trackers are blocked' : 'Ad blocking is off'} · Links from your inboxes open here</div>
      </div>`;
    $('#bsForm', el).onsubmit = (e) => { e.preventDefault(); navigate($('#bsInput', el).value); };
    $$('[data-url]', el).forEach(x => {
      x.onclick = (e) => (e.metaKey ? openTab(x.dataset.url, { background: true }) : navigate(x.dataset.url));
      x.oncontextmenu = (e) => { e.preventDefault(); const m = bm().find(y => y.url === x.dataset.url); bookmarkMenu(m, e.clientX, e.clientY); };
    });
    $('#bsAdd', el)?.addEventListener('click', () => editBookmark());
    setTimeout(() => { if (st().ui.platform === 'browser' && !t?.url) $('#bsInput', el)?.focus(); }, 30);
  }

  /* ---------- sidebar ---------- */
  function tabRow(t) {
    const fav = t.favicon ? `<img src="${esc(t.favicon)}" data-fallback>` : '';
    return `<div class="br-tab ${t.id === b.active ? 'active' : ''} ${t.incognito ? 'incog' : ''}" data-tab="${t.id}" title="${esc(t.title || t.url || 'New tab')}">
      <span class="br-fav">${t.loading ? '<i class="spinner"></i>' : ic(t.incognito ? 'eyeOff' : 'globe', 14) + fav}</span>
      <span class="br-tt">${esc(t.title || hostOf(t.url) || 'New tab')}</span>
      <button class="icon-btn sm br-x" data-close="${t.id}" title="Close tab (⌘W)">${ic('x', 13)}</button>
    </div>`;
  }
  function renderSidebar(side) {
    if (!side) return;
    b.side = side;
    if (st().ui.platform !== 'browser') return;
    restore();
    const normal = b.tabs.filter(t => !t.incognito), incog = b.tabs.filter(t => t.incognito);
    side.innerHTML = `<div class="home-side">
      <div class="side-head"><div class="side-title" style="--c:var(--browser)"><span class="dot"></span>Tabs</div><span class="side-title">${normal.length}</span></div>
      <div class="br-tabs">${normal.map(tabRow).join('')}</div>
      <div class="br-new">
        <button id="brNewTab">${ic('plus', 15)} New tab</button>
        <button id="brNewIncog" class="incog">${ic('eyeOff', 15)} Incognito</button>
      </div>
      ${incog.length ? `<div class="side-head" style="padding-top:14px"><div class="side-title" style="--c:#8b5cf6"><span class="dot"></span>Incognito</div><span class="side-title">${incog.length}</span></div>
        <div class="br-tabs">${incog.map(tabRow).join('')}</div>` : ''}
      <div class="side-head" style="padding-top:16px"><div class="side-title">Bookmarks</div></div>
      <div class="mini-notes br-marks">${bm().map(m => `<button data-bm="${esc(m.id)}" title="${esc(m.url)}"><span class="br-fav">${ic('star', 14)}${m.favicon ? `<img src="${esc(m.favicon)}" data-fallback>` : ''}</span><span>${esc(m.title || hostOf(m.url))}</span></button>`).join('') || '<div class="upc-empty">Star a page to save it here</div>'}</div>
    </div>`;
    $$('.br-tab', side).forEach(el => {
      el.onclick = (e) => { if (!e.target.closest('[data-close]')) activate(el.dataset.tab); };
      el.onauxclick = (e) => { if (e.button === 1) closeTab(el.dataset.tab); };
      el.oncontextmenu = (e) => { e.preventDefault(); tabMenu(el.dataset.tab, e.clientX, e.clientY); };
    });
    $$('[data-close]', side).forEach(x => x.onclick = (e) => { e.stopPropagation(); closeTab(x.dataset.close); });
    $('#brNewTab', side).onclick = () => openTab();
    $('#brNewIncog', side).onclick = () => openTab('', { incognito: true });
    $$('[data-bm]', side).forEach(x => {
      const m = bm().find(y => y.id === x.dataset.bm);
      x.onclick = (e) => (e.metaKey ? openTab(m.url, { background: true }) : (activeTab()?.url ? openTab(m.url) : navigate(m.url)));
      x.oncontextmenu = (e) => { e.preventDefault(); bookmarkMenu(m, e.clientX, e.clientY); };
    });
  }

  function tabMenu(id, x, y) {
    const t = b.tabs.find(z => z.id === id);
    R().popMenu(x, y, [
      { label: 'Reload', icon: 'refresh', onClick: () => t.wv?.reload() },
      { label: 'Duplicate', icon: 'copy', onClick: () => openTab(t.url, { incognito: t.incognito }) },
      ...(t.url ? [{ label: 'Open in default browser', icon: 'external', onClick: () => relay.openExternal(t.url) }, { label: 'Copy link', icon: 'link', onClick: () => { navigator.clipboard.writeText(t.url); R().toast('Link copied'); } }] : []),
      '-',
      { label: 'Close other tabs', icon: 'x', onClick: () => b.tabs.filter(z => z.id !== id && z.incognito === t.incognito).forEach(z => closeTab(z.id)) },
      { label: 'Close tab', icon: 'x', danger: true, onClick: () => closeTab(id) }
    ]);
  }

  /* ---------- bookmarks ---------- */
  async function saveBookmarks() { await relay.browser.save({ bookmarks: bm() }); renderSidebar(b.side); const t = activeTab(); if (!t?.url && b.el) renderStart($('#brStart', b.el), t); updateBar(); }
  function toggleBookmark() {
    const t = activeTab();
    if (!t?.url) return;
    const i = bm().findIndex(m => m.url === t.url);
    if (i >= 0) { bm().splice(i, 1); R().toast('Bookmark removed'); }
    else { bm().push({ id: R().uid(), title: (t.title || hostOf(t.url)).slice(0, 60), url: t.url, favicon: t.favicon || '' }); R().toast('Bookmarked'); }
    saveBookmarks();
  }
  function bookmarkMenu(m, x, y) {
    if (!m) return;
    R().popMenu(x, y, [
      { label: 'Open in new tab', icon: 'plus', onClick: () => openTab(m.url) },
      { label: 'Open in incognito tab', icon: 'eyeOff', onClick: () => openTab(m.url, { incognito: true }) },
      { label: 'Edit…', icon: 'edit', onClick: () => editBookmark(m) },
      '-',
      { label: 'Remove', icon: 'trash', danger: true, onClick: () => { st().browser.bookmarks = bm().filter(z => z.id !== m.id); saveBookmarks(); } }
    ]);
  }
  function editBookmark(m) {
    const d = m ? { ...m } : { id: R().uid(), title: '', url: '' };
    R().openModal({
      title: m ? 'Edit bookmark' : 'Add bookmark', icon: 'star', color: 'var(--browser)',
      body: `<div class="field"><label>Name</label><input class="input" id="bkT" value="${esc(d.title)}" placeholder="e.g. Lyte Fiber CRM"></div>
             <div class="field"><label>Address</label><input class="input" id="bkU" value="${esc(d.url)}" placeholder="example.com"></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'brand', style: '--c:var(--browser)', onClick: (mm) => {
        d.url = toURL($('#bkU', mm).value); d.title = $('#bkT', mm).value.trim() || hostOf(d.url);
        if (!d.url) { R().toast('Add an address', 'error'); return false; }
        const i = bm().findIndex(z => z.id === d.id);
        if (i >= 0) bm()[i] = d; else bm().push(d);
        saveBookmarks();
      } }]
    });
  }

  /* ---------- menus ---------- */
  function shieldMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const on = st().settings.adblockBrowser !== false;
    const t = activeTab();
    R().popMenu(r.right - 260, r.bottom + 6, [
      { html: `<div class="shield-pop"><div class="sp-big ${on ? '' : 'off'}">${ic('shield', 22)}</div><div><b>${on ? `${t?.blocked || 0} blocked on this page` : 'Ad blocking is off'}</b><small>Ads and trackers, using the same lists as uBlock Origin</small></div></div>` },
      { label: on ? 'Turn off ad blocking' : 'Turn on ad blocking', icon: on ? 'x' : 'shield', onClick: async () => {
          st().settings = await relay.saveSettings({ adblockBrowser: !on });
          b.tabs.forEach(x => x.wv?.reload());
          R().toast(on ? 'Ad blocking off in the browser' : 'Ad blocking on');
          updateBar();
        } }
    ]);
  }
  function moreMenu(x, y) {
    const t = activeTab();
    R().popMenu(x, y, [
      { label: 'New tab', icon: 'plus', onClick: () => openTab() },
      { label: 'New incognito tab', icon: 'eyeOff', onClick: () => openTab('', { incognito: true }) },
      '-',
      ...(t?.url ? [
        { label: 'Find on page…', icon: 'search', onClick: () => R().openFind?.() },
        { label: 'Open in default browser', icon: 'external', onClick: () => relay.openExternal(t.url) },
        { label: 'Ask AI about this page', icon: 'sparkles', onClick: () => { R().toggleAI(true); } },
        '-'] : []),
      { label: 'Search engine…', icon: 'search', onClick: () => R().openSettings('general') },
      { label: 'Clear browsing data…', icon: 'trash', danger: true, onClick: () => R().openModal({
          title: 'Clear browsing data?', subtitle: 'Signs you out of sites in the Relay browser and clears cookies and cache. Your inbox accounts aren’t affected.',
          icon: 'trash', color: 'var(--danger)', body: '',
          actions: [{ label: 'Cancel' }, { label: 'Clear', cls: 'brand', style: '--c:var(--danger)', onClick: async () => { await relay.browser.clearData(); b.tabs.forEach(z => !z.incognito && z.wv?.reload()); R().toast('Browsing data cleared'); } }]
        }) }
    ]);
  }

  function focusOmni() {
    const t = activeTab();
    if (!t?.url) { $('#bsInput', b.el)?.focus(); return; }
    $('#brOmni', b.el)?.focus();
  }

  // Menu / keyboard commands while the Browser tab is showing
  function command(cmd) {
    const t = activeTab();
    switch (cmd) {
      case 'new-tab': return openTab();
      case 'incognito': return openTab('', { incognito: true });
      case 'close-tab': return t && closeTab(t.id);
      case 'open-location': return focusOmni();
      case 'back': return t?.wv?.goBack();
      case 'forward': return t?.wv?.goForward();
      case 'reload': return t?.wv?.reload();
    }
  }

  // Page text for the AI assistant
  async function pageContext() {
    const t = activeTab();
    if (!t?.wv) return null;
    try {
      const r = await t.wv.executeJavaScript(`({ title: document.title, url: location.href, sel: String(getSelection() || ''), text: (document.querySelector('article, main, [role=main]') || document.body).innerText.slice(0, 14000) })`);
      return { label: `Web · ${hostOf(r.url)}`, text: `Title: ${r.title}\nURL: ${r.url}\n\n${r.sel ? `[Selected text]\n${r.sel}\n\n` : ''}${r.text}` };
    } catch { return null; }
  }

  window.Browser = {
    render, renderSidebar, openTab, command, pageContext,
    activeWebview: () => activeTab()?.wv || null,
    activeTitle: () => activeTab()?.title || '',
    isIncognito: () => !!activeTab()?.incognito
  };
})();

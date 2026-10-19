/* Kiln — built-in browser (ported from Relay): tabs, bookmarks, incognito, ad blocking.
   Each profile has its own signed-in session, so CivitAI and Hugging Face logins stay separate. */
(() => {
  const { $, $$, esc } = K;
  const ENGINES = { google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=', bing: 'https://www.bing.com/search?q=' };
  const TILE = ['#4f8f7d', '#5a74c4', '#c47a3a', '#b0577a', '#7d68c4', '#a8902f', '#3f93a8', '#6a9a3a'];
  const tileColor = (s) => TILE[[...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE.length];
  const INCOG = 'kiln-incognito';
  const b = { tabs: [], active: null, el: null, built: false, partition: null, restored: false, saveT: null, pollT: null };

  const bs = () => (K.state.browserState = K.state.browserState || { tabs: [], bookmarks: [] });
  const marks = () => (bs().bookmarks = bs().bookmarks || []);
  const activeTab = () => b.tabs.find(t => t.id === b.active);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(u || '');

  function toURL(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data):/i.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
    return (ENGINES[K.state.settings.searchEngine] || ENGINES.google) + encodeURIComponent(s);
  }

  function reset() {
    for (const t of b.tabs) t.wrap?.remove();
    b.tabs = []; b.active = null; b.restored = false; b.partition = null; b.built = false;
  }
  function restore() {
    if (b.restored) return;
    b.restored = true;
    for (const t of bs().tabs || []) b.tabs.push({ id: K.uid(), url: t.url, title: t.title || hostOf(t.url), favicon: t.favicon || '', incognito: false });
    if (!b.tabs.length) b.tabs.push({ id: K.uid(), url: '', title: 'New tab', incognito: false });
    b.active = b.tabs[Math.min(bs().activeIndex || 0, b.tabs.length - 1)].id;
  }
  function persist() {
    clearTimeout(b.saveT);
    b.saveT = setTimeout(() => {
      const normal = b.tabs.filter(t => !t.incognito && t.url && !isLocal(t.url));
      const act = activeTab();
      const patch = { tabs: normal.map(t => ({ url: t.url, title: t.title, favicon: t.favicon })), activeIndex: Math.max(0, normal.indexOf(act)) };
      Object.assign(bs(), patch);
      kiln.browser.save(patch);
    }, 600);
  }

  function openTab(url = '', { incognito = false, background = false, title } = {}) {
    restore();
    const u = url ? toURL(url) : '';
    const t = { id: K.uid(), url: u, title: title || (u ? hostOf(u) : incognito ? 'Incognito tab' : 'New tab'), favicon: '', incognito };
    const cur = activeTab();
    b.tabs.splice(cur ? b.tabs.indexOf(cur) + 1 : b.tabs.length, 0, t);
    if (!background) b.active = t.id;
    if (!background && K.state.page !== 'browser') K.go('browser'); else update();
    if (!background && !url) setTimeout(focusOmni, 60);
    persist();
    return t;
  }
  // Open a link, reusing a tab that already shows that site (handy for package web UIs)
  function openUrl(url, opts = {}) {
    restore();
    const existing = isLocal(url) ? b.tabs.find(t => t.url && new URL(t.url).origin === new URL(url).origin) : null;
    if (existing) { if (!opts.background) { b.active = existing.id; if (K.state.page !== 'browser') K.go('browser'); else update(); } return existing; }
    const blank = activeTab();
    if (blank && !blank.url && !opts.background) { navigate(url, blank); if (opts.title) blank.title = opts.title; if (K.state.page !== 'browser') K.go('browser'); else update(); return blank; }
    const t = openTab(url, opts);
    if (opts.background && !opts.quiet) K.toast(`Opened ${opts.title || hostOf(url)} in a browser tab`, '', { label: 'Show', onClick: () => { b.active = t.id; K.go('browser'); } });
    return t;
  }
  async function closeTab(id) {
    const t = b.tabs.find(x => x.id === id);
    if (!t) return;
    const i = b.tabs.indexOf(t);
    t.wrap?.remove();
    b.tabs.splice(i, 1);
    if (t.incognito && !b.tabs.some(x => x.incognito)) { await kiln.browser.clearIncognito(); K.toast('Incognito session cleared'); }
    if (!b.tabs.length) b.tabs.push({ id: K.uid(), url: '', title: 'New tab', incognito: false });
    if (b.active === id) b.active = (b.tabs[i] || b.tabs[i - 1]).id;
    update(); persist();
  }
  function activate(id) { b.active = id; update(); persist(); }

  async function ensureWv(t) {
    if (t.wv || !t.url) return t;
    if (t.creating) return t.creating;
    t.creating = (async () => {
      const partition = t.incognito ? INCOG : (b.partition = b.partition || await kiln.browser.partition(false));
      const { preload } = await kiln.browser.prepare(partition);
      const wrap = document.createElement('div');
      wrap.className = 'br-wrap';
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
      const sync = () => { renderTabs(); if (t.id === b.active) updateBar(); };
      wv.addEventListener('did-start-loading', () => { t.loading = true; t.error = null; wrap.classList.add('loading'); sync(); });
      wv.addEventListener('did-stop-loading', () => { t.loading = false; wrap.classList.remove('loading'); refreshCount(t); sync(); });
      wv.addEventListener('page-title-updated', (e) => { t.title = e.title; sync(); persist(); });
      wv.addEventListener('page-favicon-updated', (e) => { t.favicon = e.favicons?.[0] || ''; sync(); persist(); });
      const nav = (e) => { if (e.isMainFrame === false) return; t.url = e.url; if (document.activeElement !== $('#brOmni', b.el)) sync(); persist(); };
      wv.addEventListener('did-navigate', nav);
      wv.addEventListener('did-navigate-in-page', nav);
      wv.addEventListener('did-fail-load', (e) => { if (!e.isMainFrame || e.errorCode === -3) return; t.error = { code: e.errorCode, desc: e.errorDescription, url: e.validatedURL }; update(); });
      wv.addEventListener('dom-ready', () => { t.ready = true; });
      wv.addEventListener('found-in-page', (e) => { const n = $('#brFindN', b.el); if (n && e.result.finalUpdate) n.textContent = e.result.matches ? `${e.result.activeMatchOrdinal}/${e.result.matches}` : 'None'; });
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
    if (!t.wv) { await ensureWv(t); update(); } else t.wv.loadURL(url).catch(() => {});
    persist();
  }
  async function refreshCount(t = activeTab()) {
    if (!t?.wv || !t.ready) return;
    try { t.blocked = await kiln.browser.blockedCount(t.wv.getWebContentsId()); } catch { t.blocked = 0; }
    if (t.id === b.active) { const n = $('#brShield .n', b.el); if (n) n.textContent = t.blocked && K.state.settings.adblock !== false ? String(t.blocked) : ''; }
  }

  /* ---------- view ---------- */
  function build(el) {
    el.innerHTML = `<div class="br"><div class="br-tabs" id="brTabs"></div>
      <div class="br-bar" id="brBar">
        <button class="icon-btn" id="brBack" title="Back">${ic('chevronLeft', 18)}</button>
        <button class="icon-btn" id="brFwd" title="Forward">${ic('chevronRight', 18)}</button>
        <button class="icon-btn" id="brReload" title="Reload">${ic('refresh', 16)}</button>
        <form class="omni" id="brOmniForm"><span class="lock" id="brOmniIc"></span><input id="brOmni" spellcheck="false" autocomplete="off"><button type="button" class="icon-btn sm" id="brStar" title="Bookmark">${ic('star', 15)}</button></form>
        <button class="shield" id="brShield" title="Ads and trackers blocked">${ic('shield', 16)}<span class="n"></span></button>
        <button class="icon-btn" id="brMenu" title="More">${ic('dots', 18)}</button>
      </div>
      <div class="br-views" id="brViews"><div class="br-start" id="brStart"></div><div class="br-error" id="brError" hidden></div></div></div>`;
    $('#brBack', el).onclick = () => activeTab()?.wv?.goBack();
    $('#brFwd', el).onclick = () => activeTab()?.wv?.goForward();
    $('#brReload', el).onclick = () => { const t = activeTab(); if (t?.loading) t.wv.stop(); else t?.wv?.reload(); };
    const omni = $('#brOmni', el);
    omni.onfocus = () => setTimeout(() => omni.select(), 0);
    omni.onkeydown = (e) => { if (e.key === 'Escape') { omni.value = activeTab()?.url || ''; omni.blur(); } };
    $('#brOmniForm', el).onsubmit = (e) => { e.preventDefault(); navigate(omni.value); omni.blur(); };
    $('#brStar', el).onclick = toggleBookmark;
    $('#brShield', el).onclick = shieldMenu;
    $('#brMenu', el).onclick = (e) => K.menuAt(e.currentTarget, moreItems(), 'right');
    el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); findBar(); } });
    b.built = true;
  }
  function mount(el) { b.el = el; }
  function show() {
    restore();
    if (!b.built) build(b.el);
    update();
    clearInterval(b.pollT);
    b.pollT = setInterval(() => { if (K.state.page === 'browser') refreshCount(); else clearInterval(b.pollT); }, 2500);
  }
  function update() {
    if (!b.el || !b.built) return;
    const t = activeTab();
    if (t && t.url && !t.wv) ensureWv(t).then(() => update());
    b.tabs.forEach(x => x.wrap?.classList.toggle('on', x === t));
    const start = $('#brStart', b.el);
    start.hidden = !!(t && t.url);
    if (!start.hidden) renderStart(start, t);
    const err = $('#brError', b.el);
    err.hidden = !t?.error;
    if (t?.error) {
      const local = isLocal(t.error.url);
      err.innerHTML = `<div class="empty">${ic('globe', 38)}<h3>${local ? 'The package isn’t answering' : 'Can’t reach this page'}</h3><p>${local ? 'It may still be starting, or it stopped. Check its console in Packages.' : `${esc(hostOf(t.error.url) || t.error.url)}: ${esc(t.error.desc)}`}</p><div class="row"><button class="btn" id="brRetry">${ic('refresh', 14)} Try again</button>${local ? `<button class="btn" id="brPk">${ic('terminal', 14)} Packages</button>` : ''}</div></div>`;
      $('#brRetry', b.el).onclick = () => { t.error = null; t.wv?.reload(); update(); };
      $('#brPk', b.el)?.addEventListener('click', () => K.go('packages', { tab: 'console' }));
    }
    renderTabs(); updateBar();
  }
  function renderTabs() {
    const box = b.el && $('#brTabs', b.el);
    if (!box) return;
    box.innerHTML = b.tabs.map(t => `<div class="br-tab ${t.id === b.active ? 'on' : ''} ${t.incognito ? 'incog' : ''}" data-tab="${t.id}" title="${esc(t.title || t.url || 'New tab')}" role="tab" tabindex="0">
      <span class="fav">${t.loading ? '<span class="spinner" style="width:13px;height:13px"></span>' : (t.incognito ? ic('eyeOff', 13) : isLocal(t.url) ? ic('pkg', 13) : ic('globe', 13)) + (t.favicon && !t.incognito ? `<img src="${esc(t.favicon)}" alt="" data-fallback>` : '')}</span>
      <span class="tt">${esc(t.title || hostOf(t.url) || 'New tab')}</span><button class="icon-btn sm x" data-close="${t.id}" title="Close tab">${ic('x', 13)}</button></div>`).join('') + `<button class="br-newtab" id="brNew" title="New tab (Ctrl+T)">${ic('plus', 16)}</button>`;
    $$('.br-tab', box).forEach(x => {
      x.onclick = (e) => { if (!e.target.closest('[data-close]')) activate(x.dataset.tab); };
      x.onauxclick = (e) => { if (e.button === 1) closeTab(x.dataset.tab); };
      x.oncontextmenu = (e) => { e.preventDefault(); tabMenu(x.dataset.tab, e.clientX, e.clientY); };
    });
    $$('[data-close]', box).forEach(x => x.onclick = (e) => { e.stopPropagation(); closeTab(x.dataset.close); });
    $('#brNew', box).onclick = () => openTab();
  }
  function updateBar() {
    const t = activeTab();
    if (!b.el || !t || !$('#brBar', b.el)) return;
    $('#brBar', b.el).classList.toggle('incog', !!t.incognito);
    let back = false, fwd = false;
    if (t.wv && t.ready) { try { back = t.wv.canGoBack(); fwd = t.wv.canGoForward(); } catch {} }
    $('#brBack', b.el).disabled = !back; $('#brFwd', b.el).disabled = !fwd;
    $('#brReload', b.el).innerHTML = ic(t.loading ? 'x' : 'refresh', 16);
    const omni = $('#brOmni', b.el);
    if (document.activeElement !== omni) omni.value = t.url || '';
    omni.placeholder = t.incognito ? 'Search privately or type a web address' : 'Search or type a web address';
    $('#brOmniIc', b.el).innerHTML = t.incognito ? `<span class="incog-chip">${ic('eyeOff', 12)} Incognito</span>` : t.url ? ic(/^https:/.test(t.url) ? 'lock' : 'globe', 14) : ic('search', 14);
    const starred = t.url && marks().some(x => x.url === t.url);
    $('#brStar', b.el).classList.toggle('on', !!starred);
    $('#brStar', b.el).hidden = !t.url;
    const sh = $('#brShield', b.el);
    sh.classList.toggle('off', K.state.settings.adblock === false);
  }
  function renderStart(el, t) {
    const running = K.state.running.filter(r => r.url && r.state === 'running');
    el.className = 'br-start' + (t?.incognito ? ' incog' : '');
    el.innerHTML = t?.incognito ? `<div class="bs-inner"><h1>You’re incognito</h1><p>Pages you visit here aren’t saved, and sign-ins are wiped when you close your last incognito tab. Downloads still land in your library.</p>
        <form class="bs-search" id="bsForm">${ic('search', 18)}<input id="bsInput" placeholder="Search privately or type a web address" autocomplete="off"></form></div>`
      : `<div class="bs-inner"><h1>Browse for models</h1><p class="muted" style="margin:-10px 0 0">Download a model on any site and Kiln files it into ${esc(K.state.profile.name)}’s library.</p>
        <form class="bs-search" id="bsForm">${ic('search', 18)}<input id="bsInput" placeholder="Search or type a web address" autocomplete="off"></form>
        <div class="bs-marks">${running.map(r => `<button class="bs-mark" data-url="${esc(r.url)}"><span class="bs-ic" style="--c:#e2661c">${ic('pkg', 22)}</span><span class="bs-t">${esc(r.name)}</span></button>`).join('')}${marks().map(m => `
          <button class="bs-mark" data-url="${esc(m.url)}" data-bm="${esc(m.id)}" title="${esc(m.url)}"><span class="bs-ic" style="--c:${tileColor(hostOf(m.url))}"><i style="font-style:normal">${esc((m.title || hostOf(m.url))[0]?.toUpperCase() || '?')}</i></span><span class="bs-t">${esc(m.title || hostOf(m.url))}</span></button>`).join('')}
          <button class="bs-mark" id="bsAdd"><span class="bs-ic">${ic('plus', 18)}</span><span class="bs-t">Add</span></button></div>
        <div class="muted small row">${ic('shield', 13)} ${K.state.settings.adblock !== false ? 'Ads and trackers are blocked' : 'Ad blocking is off'} · sign-ins are kept for this profile only</div></div>`;
    $('#bsForm', el).onsubmit = (e) => { e.preventDefault(); navigate($('#bsInput', el).value); };
    $$('[data-url]', el).forEach(x => {
      x.onclick = () => navigate(x.dataset.url);
      if (x.dataset.bm) x.oncontextmenu = (e) => { e.preventDefault(); bookmarkMenu(marks().find(m => m.id === x.dataset.bm), e.clientX, e.clientY); };
    });
    $('#bsAdd', el)?.addEventListener('click', () => editBookmark());
    setTimeout(() => { if (K.state.page === 'browser' && !t?.url) $('#bsInput', el)?.focus(); }, 30);
  }
  function tabMenu(id, x, y) {
    const t = b.tabs.find(z => z.id === id);
    K.menu(x, y, [
      { label: 'Reload', icon: 'refresh', onClick: () => t.wv?.reload() },
      { label: 'Duplicate', icon: 'copy', onClick: () => openTab(t.url, { incognito: t.incognito }) },
      ...(t.url ? [{ label: 'Open in default browser', icon: 'external', onClick: () => kiln.app.openExternal(t.url) }, { label: 'Copy link', icon: 'link', onClick: () => { navigator.clipboard.writeText(t.url); K.toast('Link copied'); } }] : []), '-',
      { label: 'Close other tabs', icon: 'x', onClick: () => b.tabs.filter(z => z.id !== id).forEach(z => closeTab(z.id)) },
      { label: 'Close tab', icon: 'x', danger: true, onClick: () => closeTab(id) }
    ]);
  }
  async function saveBookmarks() { await kiln.browser.save({ bookmarks: marks() }); update(); }
  function toggleBookmark() {
    const t = activeTab(); if (!t?.url) return;
    const i = marks().findIndex(m => m.url === t.url);
    if (i >= 0) { marks().splice(i, 1); K.toast('Bookmark removed'); }
    else { marks().push({ id: K.uid(), title: (t.title || hostOf(t.url)).slice(0, 60), url: t.url }); K.toast('Bookmarked', 'ok'); }
    saveBookmarks();
  }
  function bookmarkMenu(m, x, y) {
    if (!m) return;
    K.menu(x, y, [
      { label: 'Open in new tab', icon: 'plus', onClick: () => openTab(m.url) },
      { label: 'Edit…', icon: 'edit', onClick: () => editBookmark(m) }, '-',
      { label: 'Remove', icon: 'trash', danger: true, onClick: () => { bs().bookmarks = marks().filter(z => z.id !== m.id); saveBookmarks(); } }
    ]);
  }
  function editBookmark(m) {
    const d = m ? { ...m } : { id: K.uid(), title: '', url: '' };
    K.modal({ title: m ? 'Edit bookmark' : 'Add bookmark',
      body: `<label class="field"><span>Name</span><input class="input" id="bkT" value="${esc(d.title)}" placeholder="e.g. CivitAI"></label><label class="field"><span>Address</span><input class="input" id="bkU" value="${esc(d.url)}" placeholder="civitai.com"></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: (mm) => {
        d.url = toURL($('#bkU', mm).value); d.title = $('#bkT', mm).value.trim() || hostOf(d.url);
        if (!d.url) { K.toast('Add an address', 'error'); return false; }
        const i = marks().findIndex(z => z.id === d.id);
        if (i >= 0) marks()[i] = d; else marks().push(d);
        saveBookmarks();
      } }] });
  }
  function shieldMenu(e) {
    const on = K.state.settings.adblock !== false;
    const t = activeTab();
    K.menuAt(e.currentTarget, [
      { html: `<div class="menu-h">${on ? `${t?.blocked || 0} ads and trackers blocked on this page` : 'Ad blocking is off'}</div>` },
      { label: on ? 'Turn off ad blocking' : 'Turn on ad blocking', icon: on ? 'x' : 'shield', onClick: async () => { await K.saveSettings({ adblock: !on }); b.tabs.forEach(x => x.wv?.reload()); updateBar(); } }
    ], 'right');
  }
  function moreItems() {
    const t = activeTab();
    return [
      { label: 'New tab', icon: 'plus', hint: 'Ctrl+T', onClick: () => openTab() },
      { label: 'New incognito tab', icon: 'eyeOff', onClick: () => openTab('', { incognito: true }) }, '-',
      ...(t?.url ? [{ label: 'Find on page', icon: 'search', hint: 'Ctrl+F', onClick: findBar }, { label: 'Open in default browser', icon: 'external', onClick: () => kiln.app.openExternal(t.url) }, '-'] : []),
      { label: 'Clear browsing data…', icon: 'trash', danger: true, onClick: async () => {
        if (!await K.confirm('Clear browsing data?', `Signs ${K.state.profile.name} out of sites in Kiln’s browser and clears its cookies and cache. Other profiles aren’t affected.`, { ok: 'Clear', danger: true })) return;
        await kiln.browser.clearData(); b.tabs.forEach(z => !z.incognito && z.wv?.reload()); K.toast('Browsing data cleared', 'ok');
      } }
    ];
  }
  function findBar() {
    const t = activeTab(); if (!t?.wv) return;
    let fb = $('#brFind', b.el);
    if (!fb) {
      fb = document.createElement('div'); fb.className = 'br-findbar'; fb.id = 'brFind';
      fb.innerHTML = `<input class="input sm" id="brFindQ" placeholder="Find on page" style="width:200px"><span class="small muted" id="brFindN" style="min-width:40px;text-align:center"></span><button class="icon-btn sm" id="brFindP">${ic('chevronUp', 14)}</button><button class="icon-btn sm" id="brFindNx">${ic('chevronDown', 14)}</button><button class="icon-btn sm" id="brFindX">${ic('x', 14)}</button>`;
      $('#brViews', b.el).appendChild(fb);
      const q = $('#brFindQ', fb);
      const go = (fwd = true) => { const w = activeTab()?.wv; if (w && q.value) w.findInPage(q.value, { forward: fwd, findNext: true }); };
      q.oninput = () => { const w = activeTab()?.wv; if (w) { if (q.value) w.findInPage(q.value); else w.stopFindInPage('clearSelection'); } };
      q.onkeydown = (e) => { if (e.key === 'Enter') go(!e.shiftKey); if (e.key === 'Escape') close(); };
      const close = () => { activeTab()?.wv?.stopFindInPage('clearSelection'); fb.remove(); };
      $('#brFindP', fb).onclick = () => go(false); $('#brFindNx', fb).onclick = () => go(true); $('#brFindX', fb).onclick = close;
    }
    $('#brFindQ', fb).focus();
  }
  function focusOmni() { const t = activeTab(); if (!t?.url) $('#bsInput', b.el)?.focus(); else $('#brOmni', b.el)?.focus(); }
  function command(cmd) {
    const t = activeTab();
    if (cmd === 'new-tab') return openTab();
    if (cmd === 'close-tab') return t && closeTab(t.id);
    if (cmd === 'reload') return t?.wv?.reload();
  }

  // Main-process events from inside web pages
  kiln.browser.onOpen((d) => openTab(d.url, { incognito: d.incognito, background: d.background }));
  kiln.browser.onDownloadModel(async (d) => {
    try {
      const r = await kiln.link.resolve(d.url);
      if (r.kind === 'civitai') return window.Discover.civDetail({ id: r.modelId, name: 'CivitAI model', type: '', creator: '', versions: [], stats: {}, tags: [] }, r.versionId);
      if (r.kind === 'file') return window.Downloads.startModel({ url: r.url, name: r.name, type: r.suggestedType, source: 'browser' });
    } catch (e) { K.fail(e); }
  });

  K.register('browser', { title: 'Browser', mount, show, reset });
  window.Browser = { openUrl, openTab, command, reset };
})();

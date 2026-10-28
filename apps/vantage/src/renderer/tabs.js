/* Vantage — tabs, split view (up to four pages on one screen) and the web views themselves. */
(() => {
  const NEWTAB = 'vantage://newtab';
  const LAYOUTS = { one: 1, cols2: 2, rows2: 2, main3: 3, cols3: 3, grid4: 4 };
  const LAYOUT_NAMES = { one: 'One page', cols2: 'Two side by side', rows2: 'Two stacked', main3: 'One big and two', cols3: 'Three columns', grid4: 'Grid of four' };
  const PAGE_TITLES = { newtab: 'New Tab', settings: 'Settings', history: 'History', bookmarks: 'Bookmarks', downloads: 'Downloads', library: 'Library', vault: 'Passwords' };
  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  const ENGINES = {
    google: { label: 'Google', url: 'https://www.google.com/search?q=' },
    duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
    brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q=' },
    startpage: { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=' }
  };
  const DARK_CSS = `html{filter:invert(.9) hue-rotate(180deg)!important;background:#fff!important}
    img,video,picture,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}`;

  Object.assign(V, {
    layout: 'one', panes: [], focus: 0, split: { x: 0.5, y: 0.5, a: 1 / 3, b: 2 / 3 }, closed: [], focusMode: false,
    LAYOUTS, LAYOUT_NAMES, ENGINES, NEWTAB, PAGE_TITLES, sites: new Map()
  });

  const tabById = (id) => V.tabs.find(t => t.id === id);
  const activeTab = () => tabById(V.panes[V.focus]) || V.tabs[0];
  const isInternal = (u) => /^vantage:\/\//i.test(u || '');
  const internalKind = (u) => (String(u).replace(/^vantage:\/\//i, '').split(/[/?#:]/)[0] || 'newtab').toLowerCase();
  const partitionFor = (t) => V.isPrivate ? V.parts.private : t.container ? `persist:vantage-c-${t.container}` : V.parts.normal;
  const searchUrl = (q) => (ENGINES[V.settings.searchEngine] || ENGINES.google).url + encodeURIComponent(q);

  function toURL(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    if (/^vantage:\/\//i.test(s)) return s.toLowerCase();
    if (/^(about|data|view-source|file|blob|mailto):/i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(s)) return 'http://' + s;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(s)) return 'http://' + s;
    if (/^(\/|~\/)\S/.test(s) && !/\s/.test(s)) return 'file://' + s;
    if (!/\s/.test(s) && /^[^/\s]+\.[a-z][a-z0-9-]{1,}(:\d+)?([/?#].*)?$/i.test(s)) return 'https://' + s;
    return searchUrl(s);
  }

  function makeTab({ url = NEWTAB, title = '', favicon = '', pinned = false, container = null, sleeping = false } = {}) {
    const t = { id: uid(), url, title, favicon, pinned, container, sleeping, loading: false, lastActive: Date.now(), blocked: 0, infobars: [], audible: false, muted: false };
    t.kind = isInternal(url) ? 'internal' : 'web';
    t.page = t.kind === 'internal' ? internalKind(url) : null;
    if (t.kind === 'internal') { t.title = PAGE_TITLES[t.page] || 'Vantage'; t.sleeping = false; }
    return t;
  }

  /* ---------------- views ---------------- */
  function ensureView(t) {
    if (t.view) return t.view;
    const v = document.createElement('div');
    v.className = 'view off';
    v.dataset.tab = t.id;
    v.innerHTML = `<div class="pane-head"></div><div class="infobars"></div><div class="view-body"></div>
      <div class="load-line"></div><div class="status-bubble" hidden></div><div class="view-overlay" hidden></div>`;
    $('#views').appendChild(v);
    v.addEventListener('mousedown', () => focusTab(t), true);
    t.view = v;
    renderPaneHead(t);
    return v;
  }
  const bodyOf = (t) => ensureView(t).querySelector('.view-body');

  function mount(t) {
    ensureView(t);
    if (t.kind === 'internal') {
      if (t.wv) { t.wv.remove(); t.wv = null; t.wcId = null; }
      if (t.mounted !== t.page) { t.mounted = t.page; V.renderInternal?.(t, bodyOf(t)); }
      return;
    }
    if (t.mounted && t.mounted !== 'web') { bodyOf(t).innerHTML = ''; t.mounted = null; }
    if (!t.wv) createWebview(t);
  }

  function createWebview(t) {
    const body = bodyOf(t);
    body.innerHTML = '';
    const wv = document.createElement('webview');
    wv.setAttribute('partition', partitionFor(t));
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, spellcheck=yes');
    wv.setAttribute('src', t.url);
    body.appendChild(wv);
    t.wv = wv; t.mounted = 'web'; t.sleeping = false; t.ready = false;
    const sync = (bar = true) => { renderTab(t); renderPaneHead(t); if (bar && t === activeTab()) V.updateToolbar?.(); };
    wv.addEventListener('did-attach', () => { try { t.wcId = wv.getWebContentsId(); } catch {} });
    wv.addEventListener('dom-ready', () => {
      t.ready = true;
      try { t.wcId = wv.getWebContentsId(); } catch {}
      applySite(t);
      if (t.muted) wv.setAudioMuted(true);
    });
    wv.addEventListener('did-start-loading', () => { t.loading = true; t.view.classList.add('loading'); sync(); });
    wv.addEventListener('did-stop-loading', () => { t.loading = false; t.view.classList.remove('loading'); sync(); refreshBlocked(t); });
    wv.addEventListener('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) { clearErr(t); t.blocked = 0; } });
    const nav = (e) => {
      if (e.isMainFrame === false) return;
      const prevHost = hostOf(t.url);
      t.url = e.url;
      if (!V.isPrivate) vantage.history.visit({ url: e.url, title: t.title });
      if (hostOf(e.url) !== prevHost) { applySite(t); t.infobars = t.infobars.filter(b => b.keep); renderInfobars(t); }
      sync(); persist();
    };
    wv.addEventListener('did-navigate', nav);
    wv.addEventListener('did-navigate-in-page', nav);
    wv.addEventListener('page-title-updated', (e) => { t.title = e.title; if (!V.isPrivate) vantage.history.title({ url: t.url, title: e.title }); sync(false); if (t === activeTab()) document.title = e.title || 'Vantage'; persist(); });
    wv.addEventListener('page-favicon-updated', (e) => { t.favicon = e.favicons?.[0] || ''; sync(false); persist(); });
    wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) showError(t, e.errorCode, e.errorDescription, e.validatedURL); });
    wv.addEventListener('render-process-gone', (e) => { if (e.details?.reason !== 'clean-exit') showError(t, 'crashed', e.details?.reason || 'crashed', t.url); });
    wv.addEventListener('update-target-url', (e) => {
      const b = t.view.querySelector('.status-bubble');
      if (e.url) { b.textContent = decodeURI(e.url).slice(0, 180); b.hidden = false; } else b.hidden = true;
    });
    wv.addEventListener('found-in-page', (e) => V.onFound?.(t, e.result));
    wv.addEventListener('media-started-playing', () => { t.audible = true; renderTab(t); });
    wv.addEventListener('media-paused', () => { t.audible = false; renderTab(t); });
    wv.addEventListener('enter-html-full-screen', () => { t.view.classList.add('html-fs'); document.body.classList.add('html-fs'); });
    wv.addEventListener('leave-html-full-screen', () => { t.view.classList.remove('html-fs'); document.body.classList.remove('html-fs'); });
    wv.addEventListener('focus', () => { focusTab(t); closePopover(); V.hideSuggest?.(); });
    wv.addEventListener('did-change-theme-color', (e) => { t.theme = e.themeColor; renderPaneHead(t); });
  }

  async function refreshBlocked(t) {
    if (!t.wcId) return;
    try { t.blocked = await vantage.page.adblockCount(t.wcId); } catch {}
    if (t === activeTab()) V.updateShield?.();
  }
  vantage.adblock.onCount(({ wcId, n }) => {
    const t = V.tabs.find(x => x.wcId === wcId);
    if (t) { t.blocked = n; if (t === activeTab()) V.updateShield?.(); }
  });

  /* ---------------- per-site: zoom, dark pages ---------------- */
  async function siteInfo(host, fresh = false) {
    if (!host) return {};
    if (!fresh && V.sites.has(host)) return V.sites.get(host);
    const s = await vantage.site.get(host).catch(() => ({}));
    V.sites.set(host, s);
    return s;
  }
  async function applySite(t) {
    if (!t.wv || !t.ready) return;
    const host = hostOf(t.url);
    const s = await siteInfo(host);
    try { t.wv.setZoomFactor(s.zoom || 1); } catch {}
    t.zoom = s.zoom || 1;
    if (t.darkKey) { try { await t.wv.removeInsertedCSS(t.darkKey); } catch {} t.darkKey = null; }
    if (s.dark) { try { t.darkKey = await t.wv.insertCSS(DARK_CSS, { cssOrigin: 'user' }); } catch {} }
    if (t === activeTab()) V.updateToolbar?.();
  }
  async function setSite(t, patch) {
    const host = hostOf(t.url);
    if (!host) return;
    const s = await vantage.site.set(host, patch);
    V.sites.set(host, { ...(V.sites.get(host) || {}), ...s, ...patch });
    for (const x of V.tabs) if (hostOf(x.url) === host) applySite(x);
  }
  function zoom(dir) {
    const t = activeTab();
    if (!t?.wv) return;
    const cur = t.zoom || 1;
    let next = 1;
    if (dir > 0) next = ZOOMS.find(z => z > cur + 0.001) || ZOOMS[ZOOMS.length - 1];
    else if (dir < 0) next = [...ZOOMS].reverse().find(z => z < cur - 0.001) || ZOOMS[0];
    setSite(t, { zoom: next === 1 ? null : next });
    toast(`Zoom ${Math.round(next * 100)}%`);
  }

  /* ---------------- errors ---------------- */
  function clearErr(t) { const o = t.view?.querySelector('.view-overlay.err'); if (o) { o.hidden = true; o.classList.remove('err'); o.innerHTML = ''; } t.error = null; }
  function showError(t, code, desc, url) {
    t.error = { code, desc, url };
    t.loading = false;
    const o = t.view.querySelector('.view-overlay');
    const host = hostOf(url);
    let title = 'This page didn’t load', text = desc || 'Something went wrong.', icon = 'alert';
    const extra = [];
    if (code === 'crashed') { title = 'This page stopped working'; text = 'It may have run out of memory. Reloading usually fixes it.'; }
    else if (code === -105 || code === -137) { title = `Can’t find ${host || 'this site'}`; text = 'Check the address for typos, or your internet connection.'; }
    else if (code === -106) { title = 'You’re offline'; text = 'Connect to the internet, then try again.'; icon = 'cloud'; }
    else if (code === -130 || code === -111 || code === -115) { title = 'The VPN isn’t connected'; text = 'The kill switch is stopping pages from loading outside the VPN. Reconnect, or turn the VPN off.'; icon = 'vpn'; extra.push(['Open VPN', () => V.openVpn?.()]); }
    else if (code === -118 || code === -7) { title = `${host || 'The site'} is taking too long`; text = 'The site may be down or very slow.'; }
    else if (code === -102) { title = `${host || 'The site'} refused to connect`; }
    else if (code <= -200 && code >= -299) { title = 'This connection isn’t private'; text = `${host} has a certificate problem (${desc}). Someone could be trying to read what you send.`; icon = 'shieldOff'; }
    if (/^https:/i.test(url) && V.settings.httpsUpgrade !== false && typeof code === 'number' && (code <= -100 && code > -400) && code !== -105 && code !== -106 && code !== -130) {
      extra.push(['Continue with http://', async () => { await vantage.site.allowHttp(hostOf(url)); navigate('http://' + url.slice(8), t); }]);
    }
    o.className = 'view-overlay err';
    o.innerHTML = `<div class="page-err"><div class="pe-ic">${ic(icon, 30)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p><p class="muted-sm mono">${esc(String(code))} · ${esc(url || '')}</p>
      <div class="pe-act"><button class="btn brand" data-retry>${ic('refresh', 15)} Try again</button>${extra.map((x, i) => `<button class="btn" data-x="${i}">${esc(x[0])}</button>`).join('')}</div></div>`;
    o.hidden = false;
    $('[data-retry]', o).onclick = () => { clearErr(t); t.wv ? t.wv.reload() : mount(t); };
    $$('[data-x]', o).forEach(b => b.onclick = () => extra[+b.dataset.x][1]());
    renderTab(t);
    if (t === activeTab()) V.updateToolbar?.();
  }

  /* ---------------- layout ---------------- */
  function rectsFor(layout, s = V.split) {
    switch (layout) {
      case 'cols2': return [[0, 0, s.x, 1], [s.x, 0, 1 - s.x, 1]];
      case 'rows2': return [[0, 0, 1, s.y], [0, s.y, 1, 1 - s.y]];
      case 'main3': return [[0, 0, s.x, 1], [s.x, 0, 1 - s.x, s.y], [s.x, s.y, 1 - s.x, 1 - s.y]];
      case 'cols3': return [[0, 0, s.a, 1], [s.a, 0, s.b - s.a, 1], [s.b, 0, 1 - s.b, 1]];
      case 'grid4': return [[0, 0, s.x, s.y], [s.x, 0, 1 - s.x, s.y], [0, s.y, s.x, 1 - s.y], [s.x, s.y, 1 - s.x, 1 - s.y]];
      default: return [[0, 0, 1, 1]];
    }
  }
  function dividersFor(layout, s = V.split) {
    switch (layout) {
      case 'cols2': return [{ d: 'v', k: 'x', at: s.x, from: 0, to: 1 }];
      case 'rows2': return [{ d: 'h', k: 'y', at: s.y, from: 0, to: 1 }];
      case 'main3': return [{ d: 'v', k: 'x', at: s.x, from: 0, to: 1 }, { d: 'h', k: 'y', at: s.y, from: s.x, to: 1 }];
      case 'cols3': return [{ d: 'v', k: 'a', at: s.a, from: 0, to: 1 }, { d: 'v', k: 'b', at: s.b, from: 0, to: 1 }];
      case 'grid4': return [{ d: 'v', k: 'x', at: s.x, from: 0, to: 1 }, { d: 'h', k: 'y', at: s.y, from: 0, to: 1 }];
      default: return [];
    }
  }
  function paneBoxes() {
    const box = $('#views');
    const W = box.clientWidth, H = box.clientHeight;
    const G = V.panes.length > 1 ? (V.focusMode ? 4 : 8) : 0;
    return rectsFor(V.layout).map(([x, y, w, h]) => {
      const L = x * W + (x > 0.001 ? G / 2 : 0), T = y * H + (y > 0.001 ? G / 2 : 0);
      const R = (x + w) * W - (x + w < 0.999 ? G / 2 : 0), B = (y + h) * H - (y + h < 0.999 ? G / 2 : 0);
      return { left: Math.round(L), top: Math.round(T), width: Math.round(R - L), height: Math.round(B - T) };
    });
  }
  function applyLayout() {
    const boxes = paneBoxes();
    const multi = V.panes.length > 1;
    document.body.classList.toggle('multi', multi);
    for (const t of V.tabs) {
      if (!t.view) continue;
      const i = V.panes.indexOf(t.id);
      if (i < 0) { t.view.classList.add('off'); continue; }
      const b = boxes[i];
      t.view.classList.remove('off');
      Object.assign(t.view.style, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });
      t.view.classList.toggle('focused', i === V.focus);
      t.view.dataset.n = i + 1;
    }
    // hidden views keep the focused pane's size, so background tabs lay out at a real size
    const fb = boxes[V.focus] || boxes[0];
    for (const t of V.tabs) if (t.view && V.panes.indexOf(t.id) < 0) Object.assign(t.view.style, { left: fb.left + 'px', top: fb.top + 'px', width: fb.width + 'px', height: fb.height + 'px' });
    renderDividers();
  }
  function renderDividers() {
    const el = $('#dividers');
    const box = $('#views');
    const W = box.clientWidth, H = box.clientHeight;
    el.innerHTML = dividersFor(V.layout).map((d, i) => d.d === 'v'
      ? `<div class="divider v" data-i="${i}" style="left:${d.at * W - 5}px;top:${d.from * H}px;height:${(d.to - d.from) * H}px"></div>`
      : `<div class="divider h" data-i="${i}" style="top:${d.at * H - 5}px;left:${d.from * W}px;width:${(d.to - d.from) * W}px"></div>`).join('');
    $$('.divider', el).forEach(div => {
      div.onmousedown = (e) => startDrag(e, dividersFor(V.layout)[+div.dataset.i]);
      div.ondblclick = () => { evenOut(); };
    });
  }
  function startDrag(e, d) {
    e.preventDefault();
    const box = $('#views').getBoundingClientRect();
    const shield = $('#dragShield');
    shield.hidden = false; shield.style.cursor = d.d === 'v' ? 'col-resize' : 'row-resize';
    const move = (ev) => {
      let f = d.d === 'v' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      const min = 0.12;
      let lo = min, hi = 1 - min;
      if (d.k === 'a') hi = V.split.b - min;
      if (d.k === 'b') lo = V.split.a + min;
      V.split[d.k] = Math.max(lo, Math.min(hi, f));
      applyLayout();
    };
    const up = () => { shield.hidden = true; removeEventListener('mousemove', move); removeEventListener('mouseup', up); persist(); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }
  function evenOut() { V.split = { x: 0.5, y: 0.5, a: 1 / 3, b: 2 / 3 }; applyLayout(); persist(); }
  new ResizeObserver(() => applyLayout()).observe(document.getElementById('views'));

  function layoutFor(n, cur) {
    if (n <= 1) return 'one';
    if (n === 2) return ['cols2', 'rows2'].includes(cur) ? cur : 'cols2';
    if (n === 3) return ['main3', 'cols3'].includes(cur) ? cur : 'main3';
    return 'grid4';
  }
  function mru(exclude = []) { return V.tabs.filter(t => !exclude.includes(t.id)).sort((a, b) => b.lastActive - a.lastActive); }

  function setLayout(name) {
    const n = LAYOUTS[name] || 1;
    const panes = V.panes.slice(0, n);
    const pool = mru(panes);
    while (panes.length < n) {
      let next = pool.shift();
      if (!next) { next = makeTab(); V.tabs.push(next); }
      panes.push(next.id);
    }
    V.panes = panes; V.layout = name;
    V.focus = Math.min(V.focus, n - 1);
    panes.forEach(id => mount(tabById(id)));
    applyLayout(); renderTabs(); V.updateToolbar?.(); persist();
  }
  // put a tab (or a new page) into a new pane next to what's showing
  function openInSplit(target) {
    let t = typeof target === 'string' ? tabById(target) : null;
    if (!t) { t = makeTab({ url: target ? toURL(target) : NEWTAB, container: activeTab()?.container }); insertTab(t); }
    const at = V.panes.indexOf(t.id);
    if (at >= 0) { setFocus(at); return t; }
    const n = V.panes.length;
    if (n >= 4) { V.panes[3] = t.id; V.focus = 3; }
    else {
      V.layout = n === 1 ? 'cols2' : n === 2 ? (V.layout === 'rows2' ? 'main3' : 'cols3') : 'grid4';
      V.panes.push(t.id); V.focus = V.panes.length - 1;
    }
    t.lastActive = Date.now();
    mount(t); applyLayout(); renderTabs(); V.updateToolbar?.(); persist();
    return t;
  }
  function closePane(i) {
    if (V.panes.length <= 1) return;
    V.panes.splice(i, 1);
    V.layout = layoutFor(V.panes.length, V.layout);
    V.focus = Math.min(V.focus, V.panes.length - 1);
    applyLayout(); renderTabs(); V.updateToolbar?.(); persist();
  }
  function maximizePane(i) {
    const id = V.panes[i];
    V.panes = [id]; V.layout = 'one'; V.focus = 0;
    applyLayout(); renderTabs(); V.updateToolbar?.(); persist();
  }
  function swapPanes() { if (V.panes.length < 2) return; V.panes.push(V.panes.shift()); V.focus = (V.focus + V.panes.length - 1) % V.panes.length; applyLayout(); renderTabs(); persist(); }

  /* ---------------- focus & switching ---------------- */
  function setFocus(i) {
    if (i < 0 || i >= V.panes.length) return;
    V.focus = i;
    const t = activeTab();
    if (t) { t.lastActive = Date.now(); document.title = t.title || 'Vantage'; }
    applyLayout(); renderTabs(); V.updateToolbar?.(); V.syncFind?.(); persist();
  }
  function focusTab(t) {
    const i = V.panes.indexOf(t.id);
    if (i >= 0 && i !== V.focus) setFocus(i);
  }
  function showTab(id, { pane } = {}) {
    const t = tabById(id);
    if (!t) return;
    t.lastActive = Date.now();
    const i = V.panes.indexOf(id);
    if (i >= 0 && pane === undefined) V.focus = i;
    else {
      const p = pane ?? V.focus;
      if (i >= 0) V.panes[i] = V.panes[p];   // swap places with what was there
      V.panes[p] = id; V.focus = p;
    }
    mount(t);
    applyLayout(); renderTabs(); V.updateToolbar?.(); V.syncFind?.(); persist();
    document.title = t.title || 'Vantage';
    if (t.kind === 'internal' && t.page === 'newtab') setTimeout(() => V.focusOmni?.(), 30);
  }

  function insertTab(t, { after } = {}) {
    const ref = after ? tabById(after) : activeTab();
    let idx = ref ? V.tabs.indexOf(ref) + 1 : V.tabs.length;
    // links opened from the same tab line up after each other
    if (ref && after) while (V.tabs[idx] && V.tabs[idx].openerId === ref.id) idx++;
    if (!t.pinned) idx = Math.max(idx, V.tabs.filter(x => x.pinned).length);
    V.tabs.splice(idx, 0, t);
    return t;
  }
  function openTab(url = '', { background = false, container, fromWcId, pane } = {}) {
    const opener = fromWcId != null ? V.tabs.find(x => x.wcId === fromWcId) : null;
    const t = makeTab({ url: url ? toURL(url) : NEWTAB, container: container ?? opener?.container ?? null });
    if (opener) t.openerId = opener.id;
    insertTab(t, { after: opener?.id });
    if (background) { t.lastActive = Date.now() - 1000; ensureView(t); mount(t); applyLayout(); renderTabs(); persist(); }
    else showTab(t.id, { pane });
    return t;
  }
  function navigate(input, t = activeTab()) {
    const url = toURL(input);
    if (!url || !t) return;
    if (/^mailto:/i.test(url)) return vantage.openExternal(url);
    clearErr(t);
    if (isInternal(url)) {
      const kind = internalKind(url);
      const existing = V.tabs.find(x => x.kind === 'internal' && x.page === kind && kind !== 'newtab' && x !== t);
      if (existing) return showTab(existing.id);
      t.kind = 'internal'; t.page = kind; t.url = url; t.title = PAGE_TITLES[kind] || 'Vantage'; t.favicon = '';
      mount(t);
    } else {
      const wasInternal = t.kind === 'internal';
      t.kind = 'web'; t.page = null; t.url = url;
      if (wasInternal) { t.title = hostOf(url) || url; t.favicon = ''; }
      if (wasInternal || !t.wv) { t.mounted = null; mount(t); }
      else t.wv.loadURL(url).catch(() => {});
    }
    renderTab(t); renderPaneHead(t); V.updateToolbar?.(); persist();
  }

  function closeTab(id, { record = true } = {}) {
    const t = tabById(id);
    if (!t) return;
    const idx = V.tabs.indexOf(t);
    if (record && !(t.kind === 'internal' && t.page === 'newtab')) {
      V.closed.push({ url: t.url, title: t.title, favicon: t.favicon, container: t.container, index: idx, pinned: t.pinned });
      if (V.closed.length > 30) V.closed.shift();
    }
    if (V.tabs.length === 1) { V.tabs = []; vantage.closeWindow(); return; }
    t.view?.remove();
    V.tabs.splice(idx, 1);
    const p = V.panes.indexOf(id);
    if (p >= 0) {
      const opener = t.openerId && tabById(t.openerId);
      const repl = (opener && !V.panes.includes(opener.id) ? opener : null) || mru(V.panes)[0];
      if (repl) { V.panes[p] = repl.id; repl.lastActive = Date.now(); mount(repl); }
      else if (V.panes.length > 1) { V.panes.splice(p, 1); V.layout = layoutFor(V.panes.length, V.layout); V.focus = Math.min(V.focus, V.panes.length - 1); }
    }
    if (V.find?.tabId === id) V.closeFind?.();
    applyLayout(); renderTabs(); V.updateToolbar?.(); persist();
  }
  function reopenClosed() {
    const c = V.closed.pop();
    if (!c) return;
    const t = makeTab({ url: c.url, title: c.title, favicon: c.favicon, container: c.container, pinned: c.pinned });
    V.tabs.splice(Math.min(c.index, V.tabs.length), 0, t);
    showTab(t.id);
  }
  function duplicate(t) { const n = makeTab({ url: t.url, title: t.title, favicon: t.favicon, container: t.container }); insertTab(n, { after: t.id }); showTab(n.id); }
  function togglePin(t) {
    t.pinned = !t.pinned;
    V.tabs.splice(V.tabs.indexOf(t), 1);
    const pins = V.tabs.filter(x => x.pinned).length;
    V.tabs.splice(t.pinned ? pins : pins, 0, t);
    renderTabs(); persist();
  }
  function toggleMute(t = activeTab()) { if (!t?.wv) return; t.muted = !t.muted; t.wv.setAudioMuted(t.muted); renderTab(t); }
  function sleepTab(t) {
    if (!t.wv || V.panes.includes(t.id)) return;
    t.wv.remove(); t.wv = null; t.wcId = null; t.ready = false; t.mounted = null; t.sleeping = true; t.audible = false;
    renderTab(t);
  }
  function stepTab(d) {
    const t = activeTab(); if (!t) return;
    const i = V.tabs.indexOf(t);
    showTab(V.tabs[(i + d + V.tabs.length) % V.tabs.length].id);
  }

  // sleeping tabs: pages you haven't looked at for a while give back their memory, and come back when you click them
  setInterval(() => {
    const mins = V.settings.sleepAfterMin;
    if (!mins) return;
    const cutoff = Date.now() - mins * 60000;
    for (const t of V.tabs) if (t.wv && !V.panes.includes(t.id) && !t.audible && t.lastActive < cutoff) sleepTab(t);
  }, 60000);

  /* ---------------- tab strip ---------------- */
  const containerOf = (t) => V.settings.containers?.find(c => c.id === t.container);
  function tabHTML(t) {
    const p = V.panes.indexOf(t.id);
    const c = containerOf(t);
    const icon = t.loading ? '<span class="spin"></span>' : t.kind === 'internal' ? `<span class="fav int">${ic({ newtab: 'home', settings: 'settings', history: 'clock', bookmarks: 'star', downloads: 'download', library: 'library', vault: 'key' }[t.page] || 'globe', 14)}</span>` : faviconHTML(t);
    return `<div class="tab ${t.pinned ? 'pinned' : ''} ${p === V.focus ? 'active' : ''} ${p >= 0 ? 'shown' : ''} ${t.sleeping ? 'sleeping' : ''} ${t.error ? 'error' : ''}" draggable="true" data-id="${t.id}" title="${esc(t.title || t.url)}" ${c ? `style="--cc:${esc(c.color)}"` : ''}>
      ${icon}
      ${t.pinned ? '' : `<span class="tt">${esc(t.title || hostOf(t.url) || 'New Tab')}</span>`}
      ${t.audible || t.muted ? `<button class="aud ${t.muted ? 'muted' : ''}" data-mute title="${t.muted ? 'Unmute' : 'Mute'}">${ic(t.muted ? 'mute' : 'volume', 13)}</button>` : ''}
      ${p >= 0 && V.panes.length > 1 ? `<span class="pn">${p + 1}</span>` : ''}
      ${t.pinned ? '' : `<button class="tx" data-close title="Close tab (⌘W)">${ic('x', 12)}</button>`}
      ${c ? '<span class="cbar"></span>' : ''}
    </div>`;
  }
  function renderTabs() {
    const el = $('#tabs');
    el.innerHTML = V.tabs.map(tabHTML).join('');
    $$('.tab', el).forEach(bindTab);
    const a = $('.tab.active', el);
    if (a && !V.settings.tabsOnSide) { const r = a.getBoundingClientRect(), er = el.getBoundingClientRect(); if (r.right > er.right || r.left < er.left) a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function renderTab(t) {
    const old = $(`#tabs .tab[data-id="${t.id}"]`);
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = tabHTML(t);
    const n = tmp.firstElementChild;
    old.replaceWith(n);
    bindTab(n);
  }
  function bindTab(el) {
    const t = tabById(el.dataset.id);
    el.onmousedown = (e) => { if (e.button === 0 && !e.target.closest('[data-close],[data-mute]')) showTab(t.id); };
    el.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } };
    el.oncontextmenu = (e) => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); };
    $('[data-close]', el)?.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.id); });
    $('[data-mute]', el)?.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(t); });
    el.ondragstart = (e) => {
      e.dataTransfer.setData('vantage/tab', t.id);
      if (t.kind === 'web') e.dataTransfer.setData('text/uri-list', t.url);
      e.dataTransfer.effectAllowed = 'move';
      V.draggingTab = t.id;
      setTimeout(showDropLayer, 0);
    };
    el.ondragend = () => { V.draggingTab = null; hideDropLayer(); };
  }
  // reorder by dragging along the strip
  const tabsEl = $('#tabs');
  tabsEl.addEventListener('dragover', (e) => { if (V.draggingTab) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
  tabsEl.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('vantage/tab');
    const t = tabById(id);
    if (!t) return;
    e.preventDefault();
    const side = V.settings.tabsOnSide;
    const els = $$('.tab', tabsEl).filter(x => x.dataset.id !== id);
    let idx = els.length;
    for (let i = 0; i < els.length; i++) { const r = els[i].getBoundingClientRect(); if (side ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2) { idx = i; break; } }
    const rest = V.tabs.filter(x => x.id !== id);
    rest.splice(idx, 0, t);
    V.tabs = rest;
    const pins = V.tabs.filter(x => x.pinned);
    V.tabs = [...pins, ...V.tabs.filter(x => !x.pinned)];
    renderTabs(); persist();
  });

  function tabMenu(t, x, y) {
    const shown = V.panes.includes(t.id);
    const i = V.tabs.indexOf(t);
    popMenu(x, y, [
      { label: 'New Tab to the Right', icon: 'plus', onClick: () => { const n = makeTab({ container: t.container }); V.tabs.splice(i + 1, 0, n); showTab(n.id); } },
      '-',
      { label: 'Reload', icon: 'refresh', onClick: () => { if (t.wv) t.wv.reload(); else mount(t); } },
      { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(t) },
      { label: t.pinned ? 'Unpin' : 'Pin', icon: 'pin', onClick: () => togglePin(t) },
      t.kind === 'web' ? { label: t.muted ? 'Unmute Site' : 'Mute Tab', icon: t.muted ? 'volume' : 'mute', onClick: () => toggleMute(t) } : null,
      '-',
      !shown ? { label: 'Open in Split View', icon: 'split', onClick: () => openInSplit(t.id) } : null,
      shown && V.panes.length > 1 ? { label: 'Close This Pane', icon: 'layout1', onClick: () => closePane(V.panes.indexOf(t.id)) } : null,
      t.kind === 'web' ? { label: 'Move to New Window', icon: 'window', onClick: () => { vantage.newWindow({ urls: [t.url] }); closeTab(t.id, { record: false }); } } : null,
      t.wv && !shown ? { label: 'Put to Sleep', icon: 'sleep', onClick: () => sleepTab(t) } : null,
      t.kind === 'web' ? { label: 'Copy Link', icon: 'link', onClick: () => { navigator.clipboard.writeText(t.url); toast('Link copied'); } } : null,
      '-',
      { label: 'Close Tab', icon: 'x', onClick: () => closeTab(t.id) },
      { label: 'Close Other Tabs', onClick: () => V.tabs.filter(x => x !== t && !x.pinned).forEach(x => closeTab(x.id)) },
      { label: 'Close Tabs to the Right', onClick: () => V.tabs.slice(i + 1).filter(x => !x.pinned).forEach(x => closeTab(x.id)) },
      V.closed.length ? { label: 'Reopen Closed Tab', icon: 'refresh', hint: '⇧⌘T', onClick: reopenClosed } : null
    ]);
  }

  /* ---------------- pane headers (split view & focus mode) ---------------- */
  function renderPaneHead(t) {
    const h = t.view?.querySelector('.pane-head');
    if (!h) return;
    const c = containerOf(t);
    h.innerHTML = `${t.loading ? '<span class="spin"></span>' : t.kind === 'internal' ? `<span class="fav int">${ic('home', 13)}</span>` : faviconHTML(t, 14)}
      <span class="ph-title">${esc(t.title || hostOf(t.url) || 'New Tab')}</span>
      ${c ? `<span class="ph-cont" style="--cc:${esc(c.color)}">${esc(c.name)}</span>` : ''}
      <span class="ph-host">${esc(hostOf(t.url))}</span>
      <button class="ph-btn" data-ph="back" title="Back">${ic('back', 13)}</button>
      <button class="ph-btn" data-ph="max" title="Show only this page">${ic('maximize', 13)}</button>
      <button class="ph-btn" data-ph="close" title="Remove from split view">${ic('x', 13)}</button>`;
    h.onmousedown = (e) => { if (!e.target.closest('.ph-btn')) focusTab(t); };
    h.ondblclick = () => maximizePane(V.panes.indexOf(t.id));
    $$('.ph-btn', h).forEach(b => b.onclick = () => {
      const i = V.panes.indexOf(t.id);
      if (b.dataset.ph === 'max') maximizePane(i);
      if (b.dataset.ph === 'close') closePane(i);
      if (b.dataset.ph === 'back' && t.wv?.canGoBack()) t.wv.goBack();
    });
    h.draggable = true;
    h.ondragstart = (e) => { e.dataTransfer.setData('vantage/tab', t.id); V.draggingTab = t.id; setTimeout(showDropLayer, 0); };
    h.ondragend = () => { V.draggingTab = null; hideDropLayer(); };
  }

  /* ---------------- drag a tab into split view ---------------- */
  function showDropLayer() {
    if (!V.draggingTab) return;
    const layer = $('#dropLayer');
    const boxes = paneBoxes();
    const zones = boxes.map((b, i) => `<div class="dz" data-p="${i}" style="left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px"><span>${ic('layout1', 18)} Show here</span></div>`);
    if (V.panes.length < 4) {
      const box = $('#views');
      zones.push(`<div class="dz add" data-add style="right:0;top:0;width:${Math.round(box.clientWidth * 0.22)}px;height:${box.clientHeight}px"><span>${ic('split', 18)} Add to split view</span></div>`);
    }
    layer.innerHTML = zones.join('');
    layer.hidden = false;
    $$('.dz', layer).forEach(z => {
      z.ondragover = (e) => { e.preventDefault(); $$('.dz', layer).forEach(x => x.classList.toggle('hot', x === z)); };
      z.ondragleave = () => z.classList.remove('hot');
      z.ondrop = (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('vantage/tab');
        hideDropLayer();
        if (!id) return;
        if (z.dataset.add !== undefined) openInSplit(id);
        else showTab(id, { pane: +z.dataset.p });
      };
    });
  }
  function hideDropLayer() { const l = $('#dropLayer'); l.hidden = true; l.innerHTML = ''; }
  // links or text dropped onto the stage from other apps open in a tab
  $('#stage').addEventListener('dragover', (e) => { if (!V.draggingTab && [...e.dataTransfer.types].some(x => x === 'text/uri-list' || x === 'text/plain')) e.preventDefault(); });
  $('#stage').addEventListener('drop', (e) => {
    if (V.draggingTab) return;
    const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (u) { e.preventDefault(); openTab(u.split('\n')[0].trim()); }
  });

  /* ---------------- infobars (permission asks, save password, …) ---------------- */
  function infobar(t, bar) {
    t.infobars = t.infobars.filter(b => b.id !== bar.id);
    t.infobars.push(bar);
    renderInfobars(t);
  }
  function dropInfobar(t, id) { t.infobars = t.infobars.filter(b => b.id !== id); renderInfobars(t); }
  function renderInfobars(t) {
    const el = t.view?.querySelector('.infobars');
    if (!el) return;
    el.innerHTML = t.infobars.map(b => `<div class="infobar ${b.cls || ''}" data-ib="${esc(b.id)}">
      <span class="ib-ic">${ic(b.icon || 'alert', 16)}</span><span class="ib-t">${b.html || esc(b.text)}</span>
      ${(b.actions || []).map((a, i) => `<button class="btn ${a.cls || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}
      <button class="icon-btn sm" data-x title="Dismiss">${ic('x', 14)}</button></div>`).join('');
    $$('.infobar', el).forEach(n => {
      const b = t.infobars.find(x => x.id === n.dataset.ib);
      $$('[data-a]', n).forEach(btn => btn.onclick = async () => { const r = await b.actions[+btn.dataset.a].onClick?.(n); if (r !== false) dropInfobar(t, b.id); });
      $('[data-x]', n).onclick = () => { b.onDismiss?.(); dropInfobar(t, b.id); };
      b.mount?.(n);
    });
  }

  /* ---------------- session ---------------- */
  let saveT = null;
  function persist() {
    if (V.restoring) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const tabs = V.tabs.map(t => ({ url: t.url, title: t.title, favicon: t.favicon && t.favicon.length < 2000 ? t.favicon : '', pinned: t.pinned, container: t.container }));
      vantage.saveState({ tabs, panes: V.panes.map(id => V.tabs.findIndex(t => t.id === id)), focus: V.focus, layout: V.layout, split: V.split, focusMode: V.focusMode });
    }, 600);
  }
  function restore(saved, urls) {
    V.restoring = true;
    if (saved?.tabs?.length) {
      V.tabs = saved.tabs.map(x => makeTab({ ...x, sleeping: !isInternal(x.url) }));
      V.layout = LAYOUTS[saved.layout] ? saved.layout : 'one';
      V.panes = (saved.panes || [0]).map(i => V.tabs[i]?.id).filter(Boolean).slice(0, LAYOUTS[V.layout]);
      if (V.panes.length !== LAYOUTS[V.layout]) { V.layout = layoutFor(V.panes.length || 1, V.layout); if (!V.panes.length) V.panes = [V.tabs[0].id]; }
      V.focus = Math.min(saved.focus || 0, V.panes.length - 1);
      if (saved.split) V.split = { ...V.split, ...saved.split };
    }
    if (!V.tabs.length) { const t = makeTab(); V.tabs.push(t); V.panes = [t.id]; }
    for (const u of urls || []) { const t = makeTab({ url: toURL(u) }); V.tabs.push(t); V.panes[V.focus] = t.id; }
    V.tabs.forEach(t => ensureView(t));
    V.panes.forEach(id => mount(tabById(id)));
    V.restoring = false;
    applyLayout(); renderTabs(); V.updateToolbar?.(); persist();
  }

  /* ---------------- internal pages ---------------- */
  function openInternal(kind) {
    const [k, section] = String(kind).split(':');
    const existing = V.tabs.find(t => t.kind === 'internal' && t.page === k);
    if (existing) { if (section) existing.section = section; existing.mounted = null; showTab(existing.id); return existing; }
    const cur = activeTab();
    if (cur && cur.kind === 'internal' && cur.page === 'newtab') { cur.section = section; navigate('vantage://' + k, cur); return cur; }
    const t = openTab('vantage://' + k);
    t.section = section;
    t.mounted = null; mount(t);
    return t;
  }
  function isShown(kind) { return V.panes.some(id => { const t = tabById(id); return t && t.kind === 'internal' && t.page === kind; }); }

  Object.assign(V, {
    toURL, searchUrl, makeTab, tabById, activeTab, openTab, closeTab, showTab, navigate, reopenClosed, duplicate, togglePin, toggleMute, sleepTab, stepTab,
    setLayout, openInSplit, closePane, maximizePane, swapPanes, evenOut, setFocus, focusTab, applyLayout, renderTabs, renderTab, renderPaneHead,
    infobar, dropInfobar, renderInfobars, persist, restore, openInternal, isShown, zoom, setSite, siteInfo, applySite, mount, partitionFor, layoutFor
  });
})();

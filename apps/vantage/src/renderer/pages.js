/* Vantage — built-in pages: New Tab, Settings, History, Bookmarks, Downloads, and the Library and
   Passwords screens (which came over from Relay). */
(() => {
  const pages = {};
  V.renderInternal = (t, body) => {
    body.innerHTML = '';
    body.className = 'view-body internal page-' + t.page;
    (pages[t.page] || pages.notfound)(t, body);
  };
  V.refreshInternal = (kind) => {
    for (const t of V.tabs) if (t.kind === 'internal' && t.page === kind && t.view) { t.mounted = null; V.mount(t); }
  };
  const sections = (items, cur) => `<nav class="side-nav">${items.map(([k, label, icon]) => `<button data-sec="${k}" class="${k === cur ? 'active' : ''}">${ic(icon, 17)}<span>${label}</span></button>`).join('')}</nav>`;

  /* ---------------- New Tab ---------------- */
  pages.newtab = async (t, body) => {
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const eng = (V.ENGINES[V.settings.searchEngine] || V.ENGINES.google).label;
    body.innerHTML = `<div class="nt ${V.isPrivate ? 'private' : ''}">
      <div class="nt-glow"></div>
      <div class="nt-center">
        ${V.isPrivate ? `<div class="nt-priv">${ic('mask', 34)}<h1>Private window</h1><p>Pages you open here aren’t saved to history, and cookies and site data are erased when you close the last private window. Downloads and bookmarks you make are kept.</p></div>`
          : `<div class="nt-clock" id="ntClock"></div><h1 class="nt-greet">${greet}</h1>`}
        <form class="nt-search" id="ntSearch">${ic('search', 18)}<input id="ntQ" placeholder="Search ${esc(eng)} or type an address" autocomplete="off" spellcheck="false"></form>
        <div class="nt-tiles" id="ntTiles"></div>
        <div class="nt-stats" id="ntStats"></div>
      </div>
    </div>`;
    const clock = $('#ntClock', body);
    const tick = () => { if (!clock.isConnected) return clearInterval(iv); clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    const iv = setInterval(tick, 10000); if (clock) tick();
    $('#ntSearch', body).onsubmit = (e) => { e.preventDefault(); const q = $('#ntQ', body).value.trim(); if (q) V.navigate(q, t); };
    $('#ntQ', body).onfocus = () => { V.focusOmni(); };
    if (V.isPrivate) { $('#ntTiles', body).remove(); return; }
    const top = await vantage.history.top(8).catch(() => []);
    const pinned = V.bookmarks.filter(b => b.folder === 'Bar').slice(0, 8 - Math.min(top.length, 4));
    const tiles = [...pinned.map(b => ({ url: b.url, title: b.title })), ...top.filter(x => !pinned.some(b => hostOf(b.url) === x.host)).map(x => ({ url: x.url, title: x.title || x.host }))].slice(0, 8);
    const tilesEl = $('#ntTiles', body);
    if (!tilesEl) return;
    tilesEl.innerHTML = tiles.map(x => `<a class="nt-tile" data-url="${esc(x.url)}" title="${esc(x.url)}"><span class="nt-ic" style="--c:${tileColor(hostOf(x.url))}"><span class="nt-letter">${esc((hostOf(x.url)[0] || '?').toUpperCase())}</span><img src="${esc(new URL(x.url).origin)}/favicon.ico" alt="" class="nt-fav" draggable="false"></span><span>${esc((x.title || hostOf(x.url)).slice(0, 22))}</span></a>`).join('')
      || `<div class="nt-empty">Sites you visit often show up here.</div>`;
    $$('.nt-tile', tilesEl).forEach(a => {
      a.onclick = (e) => (e.metaKey || e.ctrlKey ? V.openTab(a.dataset.url, { background: true }) : V.navigate(a.dataset.url, t));
      a.onauxclick = (e) => { if (e.button === 1) V.openTab(a.dataset.url, { background: true }); };
    });
    const st = await vantage.adblock.status().catch(() => ({}));
    const statsEl = $('#ntStats', body);
    if (statsEl) statsEl.innerHTML = `<span>${ic('shieldCheck', 14)} ${(st.total || 0).toLocaleString()} ads & trackers blocked</span>
      <span class="${V.vpn.status === 'on' ? 'on' : ''}">${ic('vpn', 14)} ${V.vpn.status === 'on' ? `VPN on${V.vpn.loc ? ' · ' + esc(V.vpn.loc) : ''}` : 'VPN off'}</span>`;
  };

  /* ---------------- Library & Passwords (from Relay) ---------------- */
  pages.library = (t, body) => {
    body.innerHTML = `<div class="ip"><aside class="sidebar ip-side"></aside><section class="ip-main"><div class="library home"></div></section></div>`;
    const side = $('.ip-side', body), main = $('.ip-main > .library', body);
    window.Library.renderSidebar(side);
    window.Library.render(main);
  };
  pages.vault = (t, body) => {
    body.innerHTML = `<div class="ip"><aside class="sidebar ip-side"></aside><section class="ip-main"><div class="vault"></div></section></div>`;
    const side = $('.ip-side', body), main = $('.ip-main > .vault', body);
    window.Vault.renderSidebar(side);
    window.Vault.render(main);
  };

  /* ---------------- History ---------------- */
  pages.history = async (t, body) => {
    body.innerHTML = `<div class="ip"><aside class="sidebar ip-side">
        <div class="side-head"><div class="side-title">${ic('clock', 14)} History</div></div>
        ${sections([['all', 'All history', 'clock'], ['today', 'Today', 'sun'], ['week', 'Last 7 days', 'calendar']], t.hsec || 'all')}
        <div class="side-foot"><button class="btn danger" id="hClear">${ic('trash', 14)} Clear browsing data…</button></div>
      </aside><section class="ip-main page-scroll"><div class="pg-head"><h1>History</h1><div class="search">${ic('search', 15)}<input id="hQ" placeholder="Search history" value="${esc(t.hq || '')}"></div></div><div id="hList" class="h-list"></div></section></div>`;
    $$('[data-sec]', body).forEach(b => b.onclick = () => { t.hsec = b.dataset.sec; t.mounted = null; V.mount(t); });
    $('#hClear', body).onclick = () => V.clearDataModal();
    const q = $('#hQ', body);
    let timer;
    q.oninput = () => { t.hq = q.value; clearTimeout(timer); timer = setTimeout(load, 150); };
    async function load() {
      const since = t.hsec === 'today' ? new Date().setHours(0, 0, 0, 0) : t.hsec === 'week' ? Date.now() - 7 * 86400000 : 0;
      let rows = await vantage.history.search({ q: q.value, limit: 1500 });
      rows = rows.filter(r => r.t >= since);
      const groups = new Map();
      for (const r of rows) {
        const d = new Date(r.t); const key = d.toDateString();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const today = new Date().toDateString(), yest = new Date(Date.now() - 86400000).toDateString();
      $('#hList', body).innerHTML = [...groups].map(([k, list]) => `<div class="h-day"><h3>${k === today ? 'Today' : k === yest ? 'Yesterday' : new Date(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        ${list.map(r => `<div class="h-row" data-url="${esc(r.url)}"><span class="h-time">${new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${faviconHTML({ url: r.url, title: r.title }, 16)}<span class="h-title">${esc(r.title || r.url)}</span><span class="h-host">${esc(hostOf(r.url))}</span><button class="icon-btn sm" data-del title="Remove from history">${ic('x', 13)}</button></div>`).join('')}</div>`).join('')
        || `<div class="pg-empty">${ic('clock', 28)}<p>${q.value ? 'No matches.' : 'Pages you visit will show up here.'}</p></div>`;
      $$('.h-row', body).forEach(r => {
        r.onclick = (e) => { if (e.target.closest('[data-del]')) return; e.metaKey || e.ctrlKey ? V.openTab(r.dataset.url, { background: true }) : V.openTab(r.dataset.url); };
        r.onauxclick = (e) => { if (e.button === 1) V.openTab(r.dataset.url, { background: true }); };
        $('[data-del]', r).onclick = async () => { await vantage.history.del({ urls: [r.dataset.url] }); r.remove(); };
      });
    }
    load();
  };

  V.clearDataModal = () => {
    openModal({
      title: 'Clear browsing data', icon: 'trash', color: 'var(--danger)',
      body: `<div class="field"><label>Time range</label><select class="select" id="cdR"><option value="3600000">Last hour</option><option value="86400000">Last 24 hours</option><option value="604800000">Last 7 days</option><option value="0" selected>All time</option></select></div>
        <label class="check"><input type="checkbox" id="cdH" checked> Browsing history</label>
        <label class="check"><input type="checkbox" id="cdC" checked> Cached images and files</label>
        <label class="check"><input type="checkbox" id="cdK"> Cookies and site data <span class="muted-sm">(signs you out of most sites)</span></label>
        <label class="check"><input type="checkbox" id="cdD"> Download list <span class="muted-sm">(files stay on disk)</span></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Clear', cls: 'brand', style: '--c:var(--danger)', onClick: async (m) => {
        const r = +$('#cdR', m).value;
        await vantage.data.clear({ since: r ? Date.now() - r : 0, history: $('#cdH', m).checked, cache: $('#cdC', m).checked, cookies: $('#cdK', m).checked, downloadsList: $('#cdD', m).checked });
        if ($('#cdD', m).checked) V.loadDownloads();
        V.refreshInternal('history'); toast('Browsing data cleared');
      } }]
    });
  };

  /* ---------------- Bookmarks ---------------- */
  pages.bookmarks = (t, body) => {
    const folders = [...new Set(V.bookmarks.map(b => b.folder || 'Bar'))].sort((a, b) => (a === 'Bar' ? -1 : b === 'Bar' ? 1 : a.localeCompare(b)));
    const cur = t.bsec && folders.includes(t.bsec) ? t.bsec : 'all';
    const label = (f) => f === 'Bar' ? 'Bookmarks bar' : f.replace(/^Bar\//, '');
    body.innerHTML = `<div class="ip"><aside class="sidebar ip-side">
        <div class="side-head"><div class="side-title">${ic('star', 14)} Bookmarks</div></div>
        ${sections([['all', 'All bookmarks', 'star'], ...folders.map(f => [f, label(f), 'folder'])], cur)}
        <div class="side-foot"><button class="btn" id="bImp">${ic('download', 14)} Import…</button></div>
      </aside><section class="ip-main page-scroll"><div class="pg-head"><h1>${esc(cur === 'all' ? 'Bookmarks' : label(cur))}</h1><div class="search">${ic('search', 15)}<input id="bQ" placeholder="Search bookmarks"></div></div><div id="bList" class="h-list"></div></section></div>`;
    $$('[data-sec]', body).forEach(b => b.onclick = () => { t.bsec = b.dataset.sec; t.mounted = null; V.mount(t); });
    $('#bImp', body).onclick = () => V.openInternal('settings:import');
    const draw = () => {
      const q = $('#bQ', body).value.toLowerCase();
      const list = V.bookmarks.filter(b => (cur === 'all' || (b.folder || 'Bar') === cur) && (!q || (b.title || '').toLowerCase().includes(q) || b.url.toLowerCase().includes(q)));
      $('#bList', body).innerHTML = list.map(b => `<div class="h-row" data-id="${b.id}">${faviconHTML({ url: b.url, title: b.title }, 16)}<span class="h-title">${esc(b.title || b.url)}</span><span class="h-host">${esc(hostOf(b.url))}</span><span class="chip">${esc(label(b.folder || 'Bar'))}</span><button class="icon-btn sm" data-more>${ic('dots', 14)}</button></div>`).join('')
        || `<div class="pg-empty">${ic('star', 28)}<p>No bookmarks here yet. Press ⌘D on any page.</p></div>`;
      $$('.h-row', body).forEach(r => {
        const b = V.bookmarks.find(x => x.id === r.dataset.id);
        r.onclick = (e) => { if (e.target.closest('[data-more]')) return; V.openTab(b.url, { background: e.metaKey || e.ctrlKey }); };
        r.oncontextmenu = $('[data-more]', r).onclick = (e) => { e.preventDefault(); e.stopPropagation(); bmMenu(b, e.clientX, e.clientY); };
      });
    };
    const bmMenu = (b, x, y) => popMenu(x, y, [
      { label: 'Open in New Tab', icon: 'plus', onClick: () => V.openTab(b.url, { background: true }) },
      { label: 'Open in Split View', icon: 'split', onClick: () => V.openInSplit(b.url) },
      { label: 'Rename…', icon: 'edit', onClick: () => openModal({ title: 'Rename bookmark', icon: 'star', body: `<input class="input" id="rnT" value="${esc(b.title)}">`, actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'brand', onClick: async (m) => { V.bookmarks = await vantage.bookmarks.save({ id: b.id, title: $('#rnT', m).value }); draw(); } }] }) },
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { V.bookmarks = await vantage.bookmarks.del(b.id); draw(); } }
    ]);
    $('#bQ', body).oninput = draw;
    draw();
  };

  /* ---------------- Downloads ---------------- */
  pages.downloads = async (t, body) => {
    body.innerHTML = `<div class="ip"><aside class="sidebar ip-side">
        <div class="side-head"><div class="side-title">${ic('download', 14)} Downloads</div></div>
        ${sections([['all', 'All downloads', 'download'], ['active', 'In progress', 'bolt'], ['video', 'Video', 'film'], ['audio', 'Audio', 'music'], ['image', 'Images', 'image'], ['doc', 'Documents', 'file'], ['archive', 'Apps & archives', 'archive']], t.dsec || 'all')}
        <div class="side-foot"><div class="dl-folder"><span class="label">Saving to</span><span class="mono muted-sm" id="dFolder"></span></div><button class="btn" id="dOpen">${ic('folder', 14)} Open folder</button></div>
      </aside><section class="ip-main page-scroll"><div class="pg-head"><h1>Downloads</h1><div class="search">${ic('search', 15)}<input id="dQ" placeholder="Search downloads"></div><button class="btn ghost" id="dClear">Clear list</button></div>
      <div class="dl-banner">${ic('bolt', 16)}<span>${V.settings.fastDownloads !== false ? `Fast downloads are on: large files come down over up to <b>${V.settings.downloadConnections || 8}</b> connections at once, and pick up where they left off.` : 'Fast downloads are off.'}</span><a data-settings>Change</a></div>
      <div id="dList" class="dl-page"></div></section></div>`;
    $('#dFolder', body).textContent = await vantage.downloads.folder();
    $$('[data-sec]', body).forEach(b => b.onclick = () => { t.dsec = b.dataset.sec; t.mounted = null; V.mount(t); });
    $('#dOpen', body).onclick = () => vantage.downloads.openFolder();
    $('#dClear', body).onclick = async () => { V.downloads = await vantage.downloads.clear(); V.updateDlButton(); draw(); };
    $('[data-settings]', body).onclick = () => V.openInternal('settings:downloads');
    const draw = () => {
      const el = $('#dList', body);
      if (!el) return;
      const q = $('#dQ', body).value.toLowerCase();
      const sec = t.dsec || 'all';
      const list = V.downloads.filter(d => (sec === 'all' || (sec === 'active' ? ['progressing', 'paused'].includes(d.state) : d.kind === sec || (sec === 'doc' && d.kind === 'pdf'))) && (!q || d.name.toLowerCase().includes(q) || (d.url || '').toLowerCase().includes(q)));
      el.innerHTML = list.map(V.dlRowHTML).join('') || `<div class="pg-empty">${ic('download', 28)}<p>Nothing here.</p></div>`;
      V.bindDl(el);
    };
    $('#dQ', body).oninput = draw;
    draw();
    V.onDownloadUpdate = () => { if (V.isShown('downloads')) draw(); };
  };

  /* ---------------- Settings ---------------- */
  const SET_SECTIONS = [
    ['general', 'General', 'settings'], ['tabs', 'Tabs & split view', 'split'], ['privacy', 'Privacy & ad blocking', 'shieldCheck'],
    ['vpn', 'VPN', 'vpn'], ['passwords', 'Passwords', 'key'], ['downloads', 'Downloads', 'download'], ['library', 'Library', 'library'],
    ['containers', 'Containers', 'container'], ['import', 'Import', 'upload'], ['about', 'About', 'sparkles']
  ];
  pages.settings = (t, body) => {
    const cur = SET_SECTIONS.some(s => s[0] === t.section) ? t.section : 'general';
    body.innerHTML = `<div class="ip"><aside class="sidebar ip-side"><div class="side-head"><div class="side-title">${ic('settings', 14)} Settings</div></div>${sections(SET_SECTIONS, cur)}</aside>
      <section class="ip-main page-scroll"><div class="set-wrap" id="setBody"></div></section></div>`;
    $$('[data-sec]', body).forEach(b => b.onclick = () => { t.section = b.dataset.sec; t.mounted = null; V.mount(t); });
    settingsPages[cur]($('#setBody', body), t);
  };
  const S = () => V.settings;
  const set = async (patch) => { V.settings = await vantage.settings.set(patch); V.applySettings?.(); };
  const row = (title, desc, control) => `<div class="set-row"><div class="sr-t"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div><div class="sr-c">${control}</div></div>`;
  const toggle = (id, on) => `<input type="checkbox" class="switch" id="${id}" ${on ? 'checked' : ''}>`;
  const select = (id, opts, val) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const card = (title, inner, icon) => `<div class="set-card">${title ? `<h2>${icon ? ic(icon, 18) : ''}${title}</h2>` : ''}${inner}</div>`;
  const bindToggle = (el, id, fn) => { const x = $('#' + id, el); if (x) x.onchange = () => fn(x.checked); };
  const bindSelect = (el, id, fn) => { const x = $('#' + id, el); if (x) x.onchange = () => fn(x.value); };

  const settingsPages = {
    async general(el) {
      const isDef = await vantage.defaultBrowser.status().catch(() => false);
      el.innerHTML = `<h1>General</h1>
        ${card('', `${row('Default browser', isDef ? 'Vantage opens your links.' : 'Open links from other apps in Vantage.', isDef ? '<span class="chip ok">Default</span>' : '<button class="btn brand" id="sDef">Make default</button>')}`)}
        ${card('Look', `${row('Theme', '', select('sTheme', [['system', 'Match the system'], ['dark', 'Dark'], ['light', 'Light']], S().theme))}
          ${row('Bookmarks bar', 'Show your bookmarks under the address bar.', toggle('sBm', S().bookmarksBar !== false))}`, 'palette')}
        ${card('Search', `${row('Search engine', 'Used by the address bar.', select('sEng', Object.entries(V.ENGINES).map(([k, v]) => [k, v.label]), S().searchEngine))}
          ${row('Search suggestions', 'Ask the search engine for suggestions as you type.', toggle('sSug', S().suggestions !== false))}`, 'search')}
        ${card('Starting up', `${row('When Vantage opens', '', select('sStart', [['restore', 'Continue where you left off'], ['newtab', 'Open a new tab']], S().startup))}`, 'home')}`;
      $('#sDef', el)?.addEventListener('click', async () => { const ok = await vantage.defaultBrowser.set(); toast(ok ? 'Vantage is now your default browser' : 'Confirm in the system prompt or settings'); setTimeout(() => settingsPages.general(el), 1500); });
      bindSelect(el, 'sTheme', v => set({ theme: v }));
      bindToggle(el, 'sBm', v => set({ bookmarksBar: v }));
      bindSelect(el, 'sEng', v => set({ searchEngine: v }));
      bindToggle(el, 'sSug', v => set({ suggestions: v }));
      bindSelect(el, 'sStart', v => set({ startup: v }));
    },
    tabs(el) {
      el.innerHTML = `<h1>Tabs & split view</h1>
        ${card('Tabs', `${row('Tabs on the side', 'A vertical list of tabs on the left, handy with lots of tabs.', toggle('tSide', S().tabsOnSide))}
          ${row('Put inactive tabs to sleep', 'Tabs you haven’t looked at give back their memory, and reload when you click them.', select('tSleep', [[0, 'Never'], [10, 'After 10 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour'], [240, 'After 4 hours']], S().sleepAfterMin))}`, 'window')}
        ${card('Split view', `<p class="set-p">Show up to four pages on one screen. Pick a layout from the ${ic('split', 14)} button or with ⌘⌥1–6, drag tabs onto the page to place them, and drag the gaps to resize. <b>Focus mode</b> (⇧⌘F) goes full screen and hides the toolbar until you move to the top edge.</p>
          <div class="layouts big">${Object.keys(V.LAYOUTS).map((k, i) => `<button class="lay" data-l="${k}">${ic({ one: 'layout1', cols2: 'layoutCols2', rows2: 'layoutRows2', main3: 'layoutMain3', cols3: 'layoutCols3', grid4: 'layoutGrid4' }[k], 34)}<span>${V.LAYOUT_NAMES[k]}</span><kbd>⌘⌥${i + 1}</kbd></button>`).join('')}</div>`, 'split')}`;
      bindToggle(el, 'tSide', v => set({ tabsOnSide: v }));
      bindSelect(el, 'tSleep', v => set({ sleepAfterMin: +v }));
      $$('[data-l]', el).forEach(b => b.onclick = () => V.setLayout(b.dataset.l));
    },
    async privacy(el) {
      const st = await vantage.adblock.status();
      const a = S().adblock || {};
      el.innerHTML = `<h1>Privacy & ad blocking</h1>
        <div class="stat-hero">${ic('shieldCheck', 28)}<div><b>${(st.total || 0).toLocaleString()}</b><span>ads and trackers blocked since ${new Date(st.since || Date.now()).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div></div>
        ${card('Ad blocking', `${row('Block ads and trackers', 'Uses Ghostery’s engine with uBlock Origin / EasyList–compatible lists, updated every few days.', toggle('pAb', a.enabled !== false))}
          ${row('Strength', 'Strict also hides cookie banners, pop-ups and other annoyances.', select('pStr', [['strict', 'Strict (recommended)'], ['standard', 'Ads and trackers only']], a.strict === false ? 'standard' : 'strict'))}
          ${row('Update the lists now', st.ready ? 'Lists are loaded.' : 'Loading…', '<button class="btn" id="pUpd">Update</button>')}
          <div class="set-sub"><b>Sites where ads are allowed</b>${(a.allow || []).length ? `<div class="chips">${a.allow.map(h => `<span class="chip">${esc(h)}<button data-un="${esc(h)}">${ic('x', 11)}</button></span>`).join('')}</div>` : '<span class="muted-sm">None. Use the shield in the address bar to pause blocking on a site.</span>'}</div>
          <div class="set-sub"><b>Your own filters</b><span class="muted-sm">One per line, uBlock Origin syntax (e.g. <code>||example.com/ads^</code> or <code>example.com##.banner</code>).</span><textarea class="textarea mono" id="pCustom" rows="5" spellcheck="false">${esc(a.custom || '')}</textarea><div><button class="btn" id="pSaveCustom">Apply filters</button></div></div>`, 'shieldCheck')}
        ${card('Connections', `${row('Always use secure connections', 'Upgrade http:// pages to https://. If a site doesn’t support it you can continue anyway.', toggle('pHttps', S().httpsUpgrade !== false))}
          ${row('Secure DNS', 'Look up sites over an encrypted connection so your network can’t see or change them.', select('pDns', [['automatic', 'On when available'], ['secure', 'Always (strict)'], ['off', 'Off']], S().secureDns))}
          ${row('DNS provider', '', select('pDnsP', [['cloudflare', 'Cloudflare (1.1.1.1)'], ['google', 'Google'], ['quad9', 'Quad9 (blocks malware)'], ['nextdns', 'NextDNS']], S().dnsProvider))}
          ${row('Ask sites not to sell or share your data', 'Sends Global Privacy Control and Do Not Track.', toggle('pGpc', S().gpc !== false))}`, 'lock')}
        ${card('Browsing data', `${row('Clear history, cache and cookies', '', '<button class="btn danger" id="pClear">Clear…</button>')}`, 'trash')}`;
      bindToggle(el, 'pAb', v => set({ adblock: { enabled: v } }));
      bindSelect(el, 'pStr', v => { set({ adblock: { strict: v === 'strict' } }); toast('Reloading the filter lists…'); });
      $('#pUpd', el).onclick = async () => { toast('Updating filter lists…'); await vantage.adblock.reload(); toast('Filter lists updated'); };
      $$('[data-un]', el).forEach(b => b.onclick = async () => { await vantage.adblock.site(b.dataset.un, false); V.settings = await vantage.settings.get(); settingsPages.privacy(el); });
      $('#pSaveCustom', el).onclick = async () => { await set({ adblock: { custom: $('#pCustom', el).value } }); toast('Filters applied'); };
      bindToggle(el, 'pHttps', v => set({ httpsUpgrade: v }));
      bindSelect(el, 'pDns', v => set({ secureDns: v }));
      bindSelect(el, 'pDnsP', v => set({ dnsProvider: v }));
      bindToggle(el, 'pGpc', v => set({ gpc: v }));
      $('#pClear', el).onclick = () => V.clearDataModal();
    },
    async vpn(el) {
      const s = await vantage.vpn.state();
      const v = S().vpn || {};
      const p = v.proxy || {};
      el.innerHTML = `<h1>VPN</h1>
        <div class="stat-hero ${s.status === 'on' ? '' : 'off'}">${ic('vpn', 28)}<div><b>${s.status === 'on' ? 'Connected' : s.status === 'connecting' ? 'Connecting…' : s.status === 'error' ? 'Not connected' : 'Off'}</b>
          <span>${s.status === 'on' ? `${esc({ warp: 'Cloudflare WARP', wireguard: s.wireguardName || 'WireGuard', proxy: 'Proxy' }[s.mode] || '')}${s.ip ? ` · IP ${esc(s.ip)}` : ''}${s.loc ? ` · ${esc(s.loc)}` : ''}` : s.status === 'error' ? esc(s.error) : 'Only Vantage’s traffic goes through the VPN. Other apps on this computer aren’t affected.'}</span></div>
          <span class="spacer"></span>${s.status === 'on' || s.status === 'connecting' ? '<button class="btn" id="vOff">Disconnect</button>' : ''}</div>
        ${card('Cloudflare WARP', `<p class="set-p">Free, fast and private: your IP address is hidden from the sites you visit and your traffic is encrypted to Cloudflare. Your apparent location stays about the same, so it won’t unlock other countries’ catalogs. Vantage sets up a free WARP device the first time.</p>
          <div class="btn-row"><button class="btn brand" data-go="warp">${s.mode === 'warp' && s.status === 'on' ? 'Connected' : 'Connect with WARP'}</button>${s.hasWarp ? '<button class="btn ghost" id="vResetWarp">Get a new WARP identity</button>' : ''}</div>`, 'bolt')}
        ${card('WireGuard', `<p class="set-p">Use any VPN provider that gives WireGuard configs (Proton VPN — including its free plan — Mullvad, IVPN, Windscribe, or your own server). Download a <code>.conf</code> for the country you want, then import it.</p>
          ${s.hasWireGuard ? `<div class="set-sub"><b>Current config</b><span class="muted-sm">${esc(s.wireguardName || 'Imported config')} · stored encrypted with your ${V.platform === 'darwin' ? 'Mac’s keychain' : 'Windows account'}</span></div>` : ''}
          <div class="btn-row"><button class="btn" id="vImp">${ic('upload', 14)} ${s.hasWireGuard ? 'Replace config…' : 'Import .conf file…'}</button><button class="btn ghost" id="vPaste">Paste config</button>${s.hasWireGuard ? '<button class="btn brand" data-go="wireguard">Connect</button>' : ''}</div>`, 'vpn')}
        ${card('Proxy', `<div class="row"><div class="field" style="flex:.6"><label>Type</label>${select('vpT', [['socks5', 'SOCKS5'], ['http', 'HTTP'], ['https', 'HTTPS']], p.type || 'socks5')}</div><div class="field"><label>Host</label><input class="input" id="vpH" value="${esc(p.host || '')}" placeholder="proxy.example.com"></div><div class="field" style="flex:.5"><label>Port</label><input class="input" id="vpP" value="${esc(p.port || '')}" placeholder="1080"></div></div>
          <div class="row"><div class="field"><label>Username <span class="muted-sm">(optional)</span></label><input class="input" id="vpU" value="${esc(p.user || '')}"></div><div class="field"><label>Password</label><input class="input" type="password" id="vpW" placeholder="${p.user ? '••••••••' : ''}"></div></div>
          <div class="btn-row"><button class="btn" id="vpSave">Save</button><button class="btn brand" data-go="proxy">Connect through proxy</button></div>`, 'link')}
        ${card('Protection', `${row('Kill switch', 'If the VPN drops, pages stop loading instead of going out without it.', toggle('vKill', v.killSwitch !== false))}
          ${row('Stop WebRTC leaks', 'Keeps video-call and peer-to-peer features from revealing your real IP while the VPN is on.', toggle('vRtc', v.webrtc !== false))}`, 'shieldCheck')}
        <p class="muted-sm set-note">WireGuard runs through <a data-ext="https://github.com/whyvl/wireproxy">wireproxy</a> (open source), downloaded once the first time you connect.</p>`;
      $('#vOff', el)?.addEventListener('click', async () => { await vantage.vpn.disconnect(); settingsPages.vpn(el); });
      $$('[data-go]', el).forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = 'Connecting…';
        const r = await vantage.vpn.connect(b.dataset.go);
        if (r.status === 'error') toast(r.error, 'error'); else toast('VPN connected');
        settingsPages.vpn(el);
      });
      $('#vResetWarp', el)?.addEventListener('click', async () => { await vantage.vpn.resetWarp(); toast('A new WARP identity is made next time you connect'); settingsPages.vpn(el); });
      $('#vImp', el).onclick = async () => { try { const r = await vantage.vpn.importFile(); if (r) { toast('Config imported'); settingsPages.vpn(el); } } catch (e) { toast(cleanErr(e), 'error'); } };
      $('#vPaste', el).onclick = () => openModal({ title: 'Paste a WireGuard config', icon: 'vpn', wide: true, body: `<div class="field"><label>Name</label><input class="input" id="wgN" placeholder="e.g. Proton · Netherlands"></div><textarea class="textarea mono" id="wgT" rows="12" placeholder="[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …"></textarea>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'brand', onClick: async (m) => { try { await vantage.vpn.importText({ text: $('#wgT', m).value, name: $('#wgN', m).value.trim() || 'WireGuard' }); toast('Config saved'); settingsPages.vpn(el); } catch (e) { toast(cleanErr(e), 'error'); return false; } } }] });
      $('#vpSave', el).onclick = async () => {
        const pw = $('#vpW', el).value;
        await vantage.vpn.proxy({ type: $('#vpT', el).value, host: $('#vpH', el).value, port: $('#vpP', el).value, user: $('#vpU', el).value, pass: pw ? pw : undefined });
        V.settings = await vantage.settings.get(); toast('Proxy saved');
      };
      bindToggle(el, 'vKill', x => set({ vpn: { killSwitch: x } }));
      bindToggle(el, 'vRtc', x => set({ vpn: { webrtc: x } }));
      $$('[data-ext]', el).forEach(a => a.onclick = () => V.openTab(a.dataset.ext));
    },
    async passwords(el) {
      const st = await relay.vault.status();
      const relayVault = await relay.vault.relayExists().catch(() => false);
      const v = S().vault || {};
      el.innerHTML = `<h1>Passwords</h1>
        <div class="stat-hero ${st.unlocked ? '' : 'off'}">${ic(st.unlocked ? 'unlock' : 'lock', 28)}<div><b>${!st.exists ? 'No vault yet' : st.unlocked ? 'Vault unlocked' : 'Vault locked'}</b><span>${st.exists ? `${st.count ?? ''} saved logins · encrypted with your master password (AES-256)` : 'Set up a vault to save and fill passwords.'}</span></div><span class="spacer"></span><button class="btn brand" id="wOpen">Open vault</button></div>
        ${card('Autofill', `${row('Fill passwords on sign-in pages', 'A small menu appears under sign-in fields with your saved logins for that site.', toggle('wAf', v.autofill !== false))}
          ${row('Offer to save passwords', 'After you sign in somewhere new, Vantage asks whether to save it.', toggle('wSave', v.offerToSave !== false))}
          <div class="set-sub"><b>Never save on</b>${(v.never || []).length ? `<div class="chips">${v.never.map(h => `<span class="chip">${esc(h)}<button data-un="${esc(h)}">${ic('x', 11)}</button></span>`).join('')}</div>` : '<span class="muted-sm">No sites.</span>'}</div>`, 'key')}
        ${card('Bring passwords over', `${relayVault ? row('From Relay', 'Import everything saved in Relay’s vault on this computer.', '<button class="btn" id="wRelay">Import from Relay…</button>') : ''}
          ${row('From Google, Chrome, 1Password, Bitwarden…', 'Export a .csv from the other app, then import it here.', '<button class="btn" id="wCsv">Import .csv…</button>')}`, 'download')}`;
      $('#wOpen', el).onclick = () => V.openInternal('vault');
      bindToggle(el, 'wAf', x => set({ vault: { autofill: x } }));
      bindToggle(el, 'wSave', x => set({ vault: { offerToSave: x } }));
      $$('[data-un]', el).forEach(b => b.onclick = async () => { await set({ vault: { never: (S().vault.never || []).filter(h => h !== b.dataset.un) } }); settingsPages.passwords(el); });
      $('#wRelay', el)?.addEventListener('click', async () => { if (await window.Vault.ensureUnlocked()) window.Vault.openRelayImport(); });
      $('#wCsv', el).onclick = () => V.openInternal('vault');
    },
    async downloads(el) {
      const folder = await vantage.downloads.folder();
      el.innerHTML = `<h1>Downloads</h1>
        ${card('Fast downloads', `<p class="set-p">Big files are split into parts that download at the same time over several connections, then joined. Most servers send each connection at full speed, so this is often several times faster than a normal browser. Paused or interrupted downloads continue where they stopped, even after quitting.</p>
          ${row('Fast downloads', '', toggle('dFast', S().fastDownloads !== false))}
          ${row('Connections per file', 'More helps on fast connections; some servers limit how many they allow.', `<div class="range-row"><input type="range" min="2" max="16" step="1" id="dConn" value="${S().downloadConnections || 8}"><b id="dConnV">${S().downloadConnections || 8}</b></div>`)}`, 'bolt')}
        ${card('Where files go', `${row('Download folder', `<span class="mono">${esc(folder)}</span>`, '<button class="btn" id="dChoose">Change…</button>')}
          ${row('Ask where to save each file', '', toggle('dAsk', S().askWhereToSave))}`, 'folder')}`;
      bindToggle(el, 'dFast', x => set({ fastDownloads: x }));
      const r = $('#dConn', el); r.oninput = () => { $('#dConnV', el).textContent = r.value; }; r.onchange = () => set({ downloadConnections: +r.value });
      $('#dChoose', el).onclick = async () => { const f = await vantage.downloads.chooseFolder(); if (f) settingsPages.downloads(el); };
      bindToggle(el, 'dAsk', x => set({ askWhereToSave: x }));
    },
    async library(el) {
      const r = await relay.library.root();
      el.innerHTML = `<h1>Library</h1>
        ${card('', `<p class="set-p">Books & comics, movies & shows and music from plain folders, with covers, series, resume points and favorites. It used to live in Relay and moved here; Vantage keeps using the same folder, so nothing had to move.</p>
          ${row('Library folder', `<span class="mono">${esc(r.root)}</span>`, '<button class="btn" id="lChoose">Change…</button>')}
          <div class="btn-row"><button class="btn brand" id="lOpen">${ic('library', 14)} Open Library</button><button class="btn ghost" id="lFolder">${ic('folder', 14)} Show folder</button></div>`, 'library')}`;
      $('#lChoose', el).onclick = async () => { const x = await relay.library.chooseRoot(); if (x) { settingsPages.library(el); window.Library?.reload(); } };
      $('#lOpen', el).onclick = () => V.openInternal('library');
      $('#lFolder', el).onclick = () => relay.library.openFolder();
    },
    containers(el) {
      const list = (S().containers || []).map(c => ({ ...c }));
      const COLORS = ['#4f8cff', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b'];
      const draw = () => {
        el.innerHTML = `<h1>Containers</h1>
          ${card('', `<p class="set-p">A container keeps its own cookies and sign-ins, separate from your other tabs, so you can be signed in to two accounts on the same site at once (say, work and personal). Right-click the ${ic('plus', 13)} button or a link to open something in a container.</p>
            <div class="cont-list">${list.map((c, i) => `<div class="cont-row"><span class="cdot" style="--cc:${esc(c.color)}"></span><input class="input" data-n="${i}" value="${esc(c.name)}">
              <div class="swatches">${COLORS.map(x => `<button class="swatch ${x === c.color ? 'active' : ''}" style="--c:${x}" data-c="${i}" data-col="${x}"></button>`).join('')}</div>
              <button class="btn ghost" data-open="${i}">Open tab</button><button class="icon-btn sm" data-del="${i}">${ic('trash', 14)}</button></div>`).join('')}</div>
            <div class="btn-row"><button class="btn" id="cAdd">${ic('plus', 14)} Add container</button></div>`, 'container')}`;
        $$('[data-n]', el).forEach(x => x.onchange = () => { list[+x.dataset.n].name = x.value.trim() || 'Container'; save(); });
        $$('[data-c]', el).forEach(x => x.onclick = () => { list[+x.dataset.c].color = x.dataset.col; save(); draw(); });
        $$('[data-del]', el).forEach(x => x.onclick = () => { list.splice(+x.dataset.del, 1); save(); draw(); });
        $$('[data-open]', el).forEach(x => x.onclick = () => V.openTab('', { container: list[+x.dataset.open].id }));
        $('#cAdd', el).onclick = () => { list.push({ id: Math.random().toString(36).slice(2, 8), name: 'New container', color: COLORS[list.length % COLORS.length] }); save(); draw(); };
      };
      const save = () => set({ containers: list });
      draw();
    },
    async import(el) {
      const sources = await vantage.bookmarks.importSources().catch(() => []);
      const relayVault = await relay.vault.relayExists().catch(() => false);
      el.innerHTML = `<h1>Import</h1>
        ${card('Bookmarks', sources.length ? sources.map(s => row(`From ${esc(s)}`, '', `<button class="btn" data-src="${esc(s)}">Import</button>`)).join('') : '<p class="set-p">No other browsers’ bookmarks were found on this computer.</p>', 'star')}
        ${card('Passwords', `${relayVault ? row('From Relay', 'Everything saved in Relay’s vault.', '<button class="btn" id="iRelay">Import…</button>') : ''}
          ${row('From a .csv export', 'Google Password Manager, Chrome, 1Password, Bitwarden, LastPass…', '<button class="btn" id="iCsv">Open Vault</button>')}`, 'key')}`;
      $$('[data-src]', el).forEach(b => b.onclick = async () => { try { const r = await vantage.bookmarks.import(b.dataset.src); toast(`Imported ${r.added} bookmark${r.added === 1 ? '' : 's'}`); } catch (e) { toast(cleanErr(e), 'error'); } });
      $('#iRelay', el)?.addEventListener('click', async () => { if (await window.Vault.ensureUnlocked()) window.Vault.openRelayImport(); });
      $('#iCsv', el).onclick = () => V.openInternal('vault');
    },
    async about(el) {
      const i = await vantage.info();
      el.innerHTML = `<h1>About</h1>
        <div class="about"><img src="../../build/icon.png" alt="" width="96" height="96"><div><h2>Vantage</h2><p>Version ${esc(i.version)} · Chromium ${esc(i.chrome)} · Electron ${esc(i.electron)}</p><p class="muted-sm">Part of the Utility Suite. Updates come through Utility Hub.</p></div></div>
        ${card('Keyboard shortcuts', `<div class="kbd-grid">${[
          ['New tab', '⌘T'], ['Reopen closed tab', '⇧⌘T'], ['Address bar', '⌘L'], ['Command palette', '⌘K'], ['Find in page', '⌘F'],
          ['Split layouts', '⌘⌥1–6'], ['Next / previous pane', '⌘⌥] / ⌘⌥['], ['Focus mode', '⇧⌘F'], ['Reader view', '⌥⌘R'],
          ['Bookmark page', '⌘D'], ['History', '⌘Y'], ['Downloads', '⇧⌘J'], ['Library', '⇧⌘L'], ['Passwords', '⌥⌘K'], ['VPN on/off', '⇧⌘U'],
          ['Screenshot', '⇧⌘2'], ['Search tabs', '⇧⌘A'], ['New private window', '⇧⌘N']
        ].map(([a, k]) => `<span>${a}</span><kbd>${V.platform === 'darwin' ? k : k.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+')}</kbd>`).join('')}</div>`, 'command')}
        <p class="muted-sm set-note">Data lives in <span class="mono">${esc(i.userData)}</span>.</p>`;
    }
  };

  pages.notfound = (t, body) => { body.innerHTML = `<div class="pg-empty">${ic('alert', 28)}<p>There’s no page called “${esc(t.page)}”.</p></div>`; };
})();

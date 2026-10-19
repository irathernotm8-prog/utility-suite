/* Slate — built-in browser (adapted from Relay): sign in to your banks, download statements,
   and every download lands in the statement inbox. Pages stay alive while you use the rest of Slate. */
(() => {
  const X = Slate;
  const { S, $, $$, esc, toast, modal } = X;
  const b = { tabs: [], active: null, host: null, prep: null, restored: false, saveT: null };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  // No favicon services: shortcuts get a letter tile, so nothing is requested until you open a site yourself
  const letter = (title, u) => esc(((title || hostOf(u) || '?').replace(/^www\./, '').trim()[0] || '?').toUpperCase());
  const marks = () => (S.store.browser.bookmarks = S.store.browser.bookmarks || []);
  const activeTab = () => b.tabs.find(t => t.id === b.active);

  function toURL(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s)) return s;
    if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
    return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }
  function persist() {
    clearTimeout(b.saveT);
    b.saveT = setTimeout(() => slate.save({ browser: { tabs: b.tabs.filter(t => t.url).map(t => ({ url: t.url, title: t.title })), bookmarks: marks() } }), 400);
  }
  function restore() {
    if (b.restored) return;
    b.restored = true;
    (S.store.browser.tabs || []).slice(0, 8).forEach(t => b.tabs.push({ id: X.uid(), url: t.url, title: t.title || hostOf(t.url) }));
    if (!b.tabs.length) b.tabs.push({ id: X.uid(), url: '', title: 'New tab' });
    b.active = b.tabs[0].id;
  }

  /* ---------- host element (lives outside the view so pages survive navigation) ---------- */
  function ensureHost() {
    if (b.host) return b.host;
    const host = document.createElement('div');
    host.className = 'view flush';
    host.id = 'browserHost';
    host.style.cssText = 'position:absolute;inset:0;z-index:2;background:var(--surface)';
    host.innerHTML = `
      <div class="br-tabs" id="brTabs"></div>
      <div class="br-chrome">
        <div class="br-top">
          <button class="icon-btn" id="brBack" title="Back">${ic('chevronLeft', 18)}</button>
          <button class="icon-btn" id="brFwd" title="Forward">${ic('chevronRight', 18)}</button>
          <button class="icon-btn" id="brReload" title="Reload">${ic('refresh', 16)}</button>
          <form class="omni" id="brForm"><span class="lock" id="brLock">${ic('search', 14)}</span><input id="brOmni" spellcheck="false" autocomplete="off" placeholder="Search or type a bank’s address"><button type="button" class="icon-btn sm" id="brStar" title="Add to shortcuts">${ic('star', 15)}</button></form>
          <button class="btn sm" id="brRead" title="Read every account on this credit report page" hidden>${ic('download', 15)} Read accounts from this page</button>
          <button class="btn sm" id="brPdf" title="Save this page as a PDF in your statement inbox">${ic('filePdf', 15)} Save page as PDF</button>
          <button class="btn sm ghost" id="brInbox" title="Statement inbox">${ic('inbox', 15)} Inbox</button>
        </div>
        <div class="loading-line" id="brLoad"></div>
        <div class="br-marks" id="brMarks"></div>
      </div>
      <div class="br-views" id="brViews"><div class="br-start" id="brStart"></div></div>`;
    $('.main').appendChild(host);
    b.host = host;
    $('#brBack', host).onclick = () => activeTab()?.wv?.goBack();
    $('#brFwd', host).onclick = () => activeTab()?.wv?.goForward();
    $('#brReload', host).onclick = () => { const t = activeTab(); if (t?.loading) t.wv.stop(); else t?.wv?.reload(); };
    const omni = $('#brOmni', host);
    omni.onfocus = () => setTimeout(() => omni.select(), 0);
    omni.onkeydown = (e) => { if (e.key === 'Escape') { omni.value = activeTab()?.url || ''; omni.blur(); } };
    $('#brForm', host).onsubmit = (e) => { e.preventDefault(); navigate(omni.value); omni.blur(); };
    $('#brStar', host).onclick = toggleMark;
    $('#brPdf', host).onclick = async () => {
      const t = activeTab();
      if (!t?.wv) return toast('Open a page first', 'error');
      try { const name = await slate.browser.savePdf(t.wv.getWebContentsId()); if (name) toast(`Saved to your statement inbox: ${name}`); } catch (e) { toast('Couldn’t save this page as a PDF', 'error'); }
    };
    $('#brInbox', host).onclick = () => X.go('statements');
    $('#brRead', host).onclick = async () => {
      const t = activeTab(); if (!t?.wv) return;
      try {
        // all frames' text (reports often sit in iframes)
        const text = await t.wv.executeJavaScript(`(() => { const parts = [document.body.innerText]; for (const f of document.querySelectorAll('iframe')) { try { parts.push(f.contentDocument.body.innerText); } catch (e) {} } return parts.join('\\n'); })()`);
        X.views.importer.open(await slate.creditReport.fromText(text), { source: 'page' });
      } catch (e) { toast('Couldn’t read this page', 'error'); }
    };
    return host;
  }

  async function ensureWv(t) {
    if (t.wv || !t.url) return t;
    if (!b.prep) b.prep = await slate.browser.prepare();
    const wv = document.createElement('webview');
    wv.setAttribute('partition', b.prep.partition);
    wv.setAttribute('preload', 'file://' + b.prep.preload);
    wv.setAttribute('webpreferences', 'sandbox=yes');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('plugins', '');
    wv.setAttribute('src', t.url);
    $('#brViews', b.host).appendChild(wv);
    t.wv = wv;
    const sync = () => { if (t.id === b.active) bar(); tabs(); };
    wv.addEventListener('did-start-loading', () => { t.loading = true; sync(); });
    wv.addEventListener('did-stop-loading', () => { t.loading = false; sync(); });
    wv.addEventListener('page-title-updated', (e) => { t.title = e.title; sync(); persist(); });
    wv.addEventListener('page-favicon-updated', (e) => { t.favicon = e.favicons?.[0] || ''; sync(); });
    const nav = (e) => { if (e.isMainFrame === false) return; t.url = e.url; if (document.activeElement !== $('#brOmni', b.host)) sync(); persist(); };
    wv.addEventListener('did-navigate', nav);
    wv.addEventListener('did-navigate-in-page', nav);
    wv.addEventListener('dom-ready', () => { t.ready = true; sync(); });
    wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) toast(`Couldn’t open ${hostOf(e.validatedURL) || 'that page'}: ${e.errorDescription}`, 'error'); });
    return t;
  }

  async function navigate(input, t = activeTab()) {
    const url = toURL(input);
    if (!url || !t) return;
    t.url = url;
    t.title = t.title && t.title !== 'New tab' ? t.title : hostOf(url);
    if (!t.wv) await ensureWv(t); else t.wv.loadURL(url).catch(() => {});
    update(); persist();
  }
  function openTab(url = '') {
    restore();
    ensureHost();
    const cur = activeTab();
    // reuse an empty current tab
    if (cur && !cur.url && url) { navigate(url, cur); return cur; }
    const t = { id: X.uid(), url: '', title: url ? hostOf(toURL(url)) : 'New tab' };
    b.tabs.splice(cur ? b.tabs.indexOf(cur) + 1 : b.tabs.length, 0, t);
    b.active = t.id;
    if (url) navigate(url, t); else { update(); setTimeout(() => $('#brStartQ', b.host)?.focus(), 40); }
    return t;
  }
  function closeTab(id) {
    const t = b.tabs.find(x => x.id === id);
    if (!t) return;
    const i = b.tabs.indexOf(t);
    t.wv?.remove();
    b.tabs.splice(i, 1);
    if (!b.tabs.length) b.tabs.push({ id: X.uid(), url: '', title: 'New tab' });
    if (b.active === id) b.active = (b.tabs[i] || b.tabs[i - 1]).id;
    update(); persist();
  }

  /* ---------- rendering ---------- */
  function tabs() {
    if (!b.host) return;
    $('#brTabs', b.host).innerHTML = b.tabs.map(t => `<div class="br-tab ${t.id === b.active ? 'on' : ''}" data-tab="${t.id}" title="${esc(t.title || t.url)}">
      ${t.loading ? `<span style="width:15px;display:grid;place-items:center">${ic('refresh', 12)}</span>` : t.url ? (t.favicon ? `<img src="${esc(t.favicon)}" alt="" data-fb="hide">` : `<span class="lt">${letter(t.title, t.url)}</span>`) : ic('globe', 14)}
      <span class="tt">${esc(t.title || hostOf(t.url) || 'New tab')}</span><button class="icon-btn sm x" data-close="${t.id}" title="Close tab">${ic('x', 12)}</button></div>`).join('') +
      `<button class="icon-btn br-newtab" id="brNew" title="New tab">${ic('plus', 16)}</button>`;
    $$('[data-tab]', b.host).forEach(el => {
      el.onclick = (e) => { if (e.target.closest('[data-close]')) return; b.active = el.dataset.tab; update(); };
      el.onauxclick = (e) => { if (e.button === 1) closeTab(el.dataset.tab); };
    });
    $$('[data-close]', b.host).forEach(x => x.onclick = (e) => { e.stopPropagation(); closeTab(x.dataset.close); });
    $('#brNew', b.host).onclick = () => openTab('');
    fallbacks(b.host);
  }
  function bar() {
    const t = activeTab();
    if (!b.host || !t) return;
    let back = false, fwd = false;
    if (t.wv && t.ready) { try { back = t.wv.canGoBack(); fwd = t.wv.canGoForward(); } catch {} }
    $('#brBack', b.host).disabled = !back;
    $('#brFwd', b.host).disabled = !fwd;
    $('#brReload', b.host).innerHTML = ic(t.loading ? 'x' : 'refresh', 16);
    $('#brLoad', b.host).classList.toggle('on', !!t.loading);
    const omni = $('#brOmni', b.host);
    if (document.activeElement !== omni) omni.value = t.url || '';
    $('#brLock', b.host).innerHTML = ic(t.url ? (/^https:/.test(t.url) ? 'lock' : 'globe') : 'search', 14);
    $('#brStar', b.host).hidden = !t.url;
    $('#brStar', b.host).style.color = marks().some(m => hostOf(m.url) === hostOf(t.url)) ? 'var(--accent)' : '';
    $('#brPdf', b.host).disabled = !t.url;
    $('#brRead', b.host).hidden = !/(annualcreditreport|experian|equifax|transunion|creditkarma|myfico|creditwise|credit-journey|creditjourney)\./i.test(hostOf(t.url) + '.');
  }
  function markBar() {
    $('#brMarks', b.host).innerHTML = marks().map(m => `<button data-mark="${esc(m.id)}" title="${esc(m.url)}"><span class="lt">${letter(m.title, m.url)}</span>${esc(m.title)}</button>`).join('') + `<button id="brMarkAdd" title="Add a shortcut">${ic('plus', 14)}</button>`;
    $$('[data-mark]', b.host).forEach(x => {
      const m = marks().find(y => y.id === x.dataset.mark);
      x.onclick = (e) => (e.metaKey || e.ctrlKey ? openTab(m.url) : activeTab()?.url ? openTab(m.url) : navigate(m.url));
      x.oncontextmenu = (e) => { e.preventDefault(); X.menu(e.clientX, e.clientY, [{ label: 'Open in new tab', icon: 'plus', onClick: () => openTab(m.url) }, { label: 'Edit…', icon: 'edit', onClick: () => editMark(m) }, '-', { label: 'Remove', icon: 'trash', danger: true, onClick: () => { S.store.browser.bookmarks = marks().filter(y => y.id !== m.id); persist(); markBar(); start(); } }]); };
    });
    $('#brMarkAdd', b.host).onclick = () => editMark();
    fallbacks(b.host);
  }
  function start() {
    const el = $('#brStart', b.host);
    const t = activeTab();
    el.hidden = !!t?.url;
    if (el.hidden) return;
    const acctLinks = X.accounts().filter(a => a.loginUrl && !marks().some(m => hostOf(m.url) === hostOf(a.loginUrl)));
    el.innerHTML = `<div style="max-width:900px"><h1>Get your statements</h1>
      <p class="lede">Sign in on your bank’s own site, then download a statement, a CSV or a QFX file. It goes straight to your statement inbox. Your sign-ins are remembered here and nowhere else.</p>
      <form class="omni" id="brStartForm" style="height:44px;max-width:640px"><span class="lock">${ic('search', 16)}</span><input id="brStartQ" placeholder="Search or type a bank’s address" autocomplete="off"></form>
      <div class="tiles">${[...marks(), ...acctLinks.map(a => ({ id: 'acc-' + a.id, title: a.name, url: a.loginUrl }))].map(m => `<button class="tile" data-go="${esc(m.url)}"><span class="fav">${letter(m.title, m.url)}</span><span>${esc(m.title)}</span></button>`).join('')}
        <button class="tile" id="brTileAdd"><span class="fav">${ic('plus', 16)}</span><span>Add a shortcut</span></button></div>
      <p class="muted small" style="margin-top:28px">Tip: if a bank only shows a statement as a web page, use <b>Save page as PDF</b> at the top. Right-click a download link and choose <b>Save Linked File to Statement Inbox</b> if clicking it opens the file instead.</p></div>`;
    $('#brStartForm', el).onsubmit = (e) => { e.preventDefault(); navigate($('#brStartQ', el).value); };
    $$('[data-go]', el).forEach(x => x.onclick = () => navigate(x.dataset.go));
    $('#brTileAdd', el).onclick = () => editMark();
    fallbacks(el);
  }
  // favicon fallbacks, attached in script (inline handlers are blocked)
  function fallbacks(root) {
    $$('img[data-fb]', root).forEach(img => {
      if (img.dataset.bound) return; img.dataset.bound = '1';
      img.addEventListener('error', () => { const k = img.dataset.fb; if (k === 'hide') img.style.visibility = 'hidden'; else if (k === 'none') img.style.display = 'none'; else img.replaceWith(document.createTextNode(img.dataset.letter || '?')); });
    });
  }
  function update() {
    if (!b.host) return;
    const t = activeTab();
    if (t?.url && !t.wv) ensureWv(t).then(update);
    b.tabs.forEach(x => x.wv?.classList.toggle('on', x === t));
    tabs(); bar(); start(); fallbacks(b.host);
  }

  function toggleMark() {
    const t = activeTab(); if (!t?.url) return;
    const i = marks().findIndex(m => hostOf(m.url) === hostOf(t.url));
    if (i >= 0) { marks().splice(i, 1); toast('Removed from shortcuts'); }
    else { marks().push({ id: X.uid(), title: (t.title || hostOf(t.url)).split(/[|\-–:]/)[0].trim().slice(0, 30), url: t.url }); toast('Added to shortcuts'); }
    persist(); markBar(); bar();
  }
  function editMark(m) {
    const d = m ? { ...m } : { id: X.uid(), title: '', url: '' };
    modal({ title: m ? 'Edit shortcut' : 'Add a shortcut',
      body: `<div class="field"><label>Name</label><input class="input" id="mkT" value="${esc(d.title)}" placeholder="e.g. Empower 401(k)"></div><div class="field"><label>Address</label><input class="input" id="mkU" value="${esc(d.url)}" placeholder="empower.com"></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: (mm) => {
        d.url = toURL($('#mkU', mm).value); d.title = $('#mkT', mm).value.trim() || hostOf(d.url);
        if (!d.url) { toast('Add an address', 'error'); return false; }
        const i = marks().findIndex(z => z.id === d.id); if (i >= 0) marks()[i] = d; else marks().push(d);
        persist(); markBar(); start();
      } }] });
  }

  function render(el) {
    restore();
    el.innerHTML = '';
    const host = ensureHost();
    host.hidden = false;
    markBar();
    update();
  }
  function leave() { if (b.host) b.host.hidden = true; }
  function command(cmd) {
    const t = activeTab();
    if (cmd === 'close-tab') return t && closeTab(t.id);
    if (cmd === 'reload') return t?.wv?.reload();
  }

  slate.on.downloading(({ name }) => { if (b.host && !b.host.hidden) toast(`Downloading ${name}…`); });

  X.views.browser = { render, leave, openTab, command, flush: true };
})();

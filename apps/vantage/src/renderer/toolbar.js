/* Vantage — toolbar, address bar, popovers (shield, VPN, split, downloads, passwords, site, menu),
   bookmarks bar, find in page, command palette, infobars and keyboard commands. */
(() => {
  const omni = $('#omni');
  const active = () => V.activeTab();
  const isWeb = (t) => t && t.kind === 'web';

  /* ---------------- icons ---------------- */
  const setIc = (id, name, size = 17) => { const el = $(id); if (el) el.insertAdjacentHTML('afterbegin', ic(name, size)); };
  setIc('#newTab', 'plus', 16); setIc('#btnBack', 'back'); setIc('#btnFwd', 'fwd'); setIc('#btnReload', 'refresh', 16);
  setIc('#btnSplit', 'split'); setIc('#btnDownloads', 'download'); setIc('#btnVault', 'key'); setIc('#btnLibrary', 'library');
  setIc('#btnMenu', 'dots'); setIc('#omniStar', 'star', 15); setIc('#omniReader', 'reader', 15);

  /* ---------------- toolbar state ---------------- */
  const pretty = (u) => {
    if (!u) return '';
    if (/^vantage:\/\/newtab/i.test(u)) return '';
    try { const x = new URL(u); if (/^https?:$/.test(x.protocol)) return decodeURI(x.host.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname) + x.search + x.hash); } catch {}
    return u;
  };
  function updateToolbar() {
    const t = active();
    if (!t) return;
    if (document.activeElement !== omni) omni.value = pretty(t.url);
    const canBack = !!(t.wv && t.ready && t.wv.canGoBack()), canFwd = !!(t.wv && t.ready && t.wv.canGoForward());
    $('#btnBack').disabled = !canBack; $('#btnFwd').disabled = !canFwd;
    $('#btnReload').innerHTML = ic(t.loading ? 'x' : 'refresh', 16);
    $('#btnReload').title = t.loading ? 'Stop loading' : 'Reload (⌘R)';
    const site = $('#omniSite');
    let icon = 'search', cls = '';
    if (t.kind === 'internal') { icon = t.page === 'newtab' ? 'search' : 'shieldCheck'; cls = 'internal'; }
    else if (/^https:/i.test(t.url)) { icon = 'lock'; cls = 'secure'; }
    else if (/^http:/i.test(t.url)) { icon = 'alert'; cls = 'insecure'; }
    else if (/^file:/i.test(t.url)) icon = 'file';
    site.className = 'omni-site ' + cls;
    site.innerHTML = ic(icon, 14) + (cls === 'insecure' ? '<span>Not secure</span>' : '');
    const bm = V.bookmarks.find(b => b.url === t.url);
    $('#omniStar').classList.toggle('on', !!bm);
    $('#omniStar').hidden = !isWeb(t);
    $('#omniReader').hidden = !isWeb(t) || !/^https?:/.test(t.url) || hostOf(t.url).startsWith('google.');
    const z = $('#omniZoom');
    z.hidden = !t.zoom || Math.abs(t.zoom - 1) < 0.01;
    z.textContent = Math.round((t.zoom || 1) * 100) + '%';
    updateShield();
    document.body.classList.toggle('loading', !!t.loading);
    document.title = t.title || 'Vantage';
  }
  function updateShield() {
    const t = active();
    const el = $('#omniShield');
    if (!isWeb(t) || !/^https?:/.test(t.url)) { el.hidden = true; return; }
    el.hidden = false;
    const off = V.settings.adblock?.enabled === false || (V.settings.adblock?.allow || []).some(h => hostOf(t.url) === h || hostOf(t.url).endsWith('.' + h));
    el.className = 'omni-shield ' + (off ? 'off' : '');
    el.innerHTML = ic(off ? 'shieldOff' : 'shieldCheck', 15) + (t.blocked && !off ? `<span>${t.blocked > 999 ? '999+' : t.blocked}</span>` : '');
  }

  /* ---------------- address bar & suggestions ---------------- */
  const sug = { items: [], sel: -1, q: '', seq: 0, typed: '' };
  function focusOmni() { omni.focus(); omni.select(); }
  // on a web page, focusing the address bar lists recent sites; on New Tab the page itself is the list, so wait for typing
  omni.addEventListener('focus', () => { const t = active(); omni.value = t && t.kind === 'web' ? t.url : ''; setTimeout(() => omni.select(), 0); document.body.classList.add('omni-focus'); if (t?.kind === 'web') buildSuggest(''); });
  omni.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== omni) { hideSuggest(); document.body.classList.remove('omni-focus'); const t = active(); if (t) omni.value = pretty(t.url); } }, 150); });
  omni.addEventListener('input', (e) => {
    const deleting = e.inputType && e.inputType.startsWith('delete');
    sug.typed = omni.value;
    buildSuggest(omni.value, !deleting);
  });
  omni.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!sug.items.length) return;
      sug.sel = (sug.sel + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length;
      renderSuggest();
      const it = sug.items[sug.sel];
      omni.value = it.kind === 'search' ? it.text : it.url;
    } else if (e.key === 'Escape') {
      const t = active(); omni.value = t && t.kind === 'web' ? t.url : ''; hideSuggest(); omni.select();
    } else if (e.key === 'Tab' && omni.selectionEnd > omni.selectionStart && omni.selectionEnd === omni.value.length) {
      e.preventDefault(); omni.setSelectionRange(omni.value.length, omni.value.length);
    }
  });
  $('#omniForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const it = sug.sel >= 0 ? sug.items[sug.sel] : null;
    go(it || { kind: 'typed', text: omni.value }, e);
  });
  function go(it, ev) {
    const alt = ev?.altKey || ev?.metaKey;
    hideSuggest(); omni.blur();
    if (it.kind === 'tab') return V.showTab(it.id);
    const target = it.kind === 'search' ? V.searchUrl(it.text) : it.url || it.text;
    if (!String(target).trim()) return;
    if (alt) V.openTab(target);
    else V.navigate(target);
    setTimeout(() => active()?.wv?.focus(), 50);
  }
  async function buildSuggest(q, complete = false) {
    const seq = ++sug.seq;
    // suggestions off: no drop-down at all, just the address bar
    if (V.settings.suggestions === false) { hideSuggest(); return; }
    const ql = q.trim().toLowerCase();
    const items = [];
    const seen = new Set();
    const add = (it) => { const k = it.kind === 'search' ? 's:' + it.text : it.kind === 'tab' ? 't:' + it.id : it.url.replace(/\/$/, ''); if (seen.has(k)) return; seen.add(k); items.push(it); };
    if (ql) {
      const asUrl = V.toURL(q);
      if (!/^https:\/\/(www\.)?(google|duckduckgo|bing|search\.brave|startpage)\./.test(asUrl) || /^[a-z]+:\/\//i.test(q)) add({ kind: 'url', url: asUrl, title: 'Open ' + pretty(asUrl), icon: 'globe' });
      add({ kind: 'search', text: q.trim(), title: q.trim(), icon: 'search' });
      for (const t of V.tabs) if (t.kind === 'web' && (t.title.toLowerCase().includes(ql) || t.url.toLowerCase().includes(ql)) && t !== active()) add({ kind: 'tab', id: t.id, url: t.url, title: t.title, icon: 'window', tab: t });
      for (const b of V.bookmarks) if ((b.title || '').toLowerCase().includes(ql) || b.url.toLowerCase().includes(ql)) add({ kind: 'bookmark', url: b.url, title: b.title || b.url, icon: 'star' });
    }
    const hist = await vantage.history.frecent({ q: ql, limit: ql ? 6 : 8 }).catch(() => []);
    if (seq !== sug.seq) return;
    for (const h of hist) add({ kind: 'history', url: h.url, title: h.title || pretty(h.url), icon: 'clock' });
    sug.items = items.slice(0, 12); sug.sel = -1;
    // complete the address inline, like typing "you" → "youtube.com"
    if (complete && ql && !/\s/.test(ql)) {
      const hit = hist.map(h => pretty(h.url)).find(p => p.toLowerCase().startsWith(ql));
      if (hit) {
        const host = hit.split('/')[0];
        const fill = host.toLowerCase().startsWith(ql) && host.length > ql.length ? host : null;
        if (fill && omni.value === q) { omni.value = q + fill.slice(q.length); omni.setSelectionRange(q.length, fill.length); }
      }
    }
    renderSuggest();
    if (ql && V.settings.engineSuggestions !== false && !V.isPrivate) {
      const remote = await vantage.suggest(q.trim()).catch(() => []);
      if (seq !== sug.seq) return;
      const at = Math.max(1, items.findIndex(i => i.kind === 'search') + 1);
      const extra = remote.filter(r => r.toLowerCase() !== ql).slice(0, 4).map(r => ({ kind: 'search', text: r, title: r, icon: 'search' }));
      sug.items.splice(at, 0, ...extra.filter(x => !seen.has('s:' + x.text)));
      sug.items = sug.items.slice(0, 12);
      renderSuggest();
    }
  }
  function renderSuggest() {
    const box = $('#suggest');
    if (document.activeElement !== omni || !sug.items.length) { box.hidden = true; return; }
    const r = $('#omniForm').getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = (r.bottom + 6) + 'px'; box.style.width = r.width + 'px';
    const eng = (V.ENGINES[V.settings.searchEngine] || V.ENGINES.google).label;
    box.innerHTML = sug.items.map((it, i) => `<div class="sg ${i === sug.sel ? 'on' : ''}" data-i="${i}">
      <span class="sg-ic">${it.kind === 'tab' ? faviconHTML(it.tab, 15) : ic(it.icon, 15)}</span>
      <span class="sg-t">${esc(it.title)}</span>
      <span class="sg-u">${it.kind === 'search' ? `${esc(eng)} search` : it.kind === 'tab' ? 'Switch to tab' : esc(pretty(it.url))}</span>
    </div>`).join('');
    box.hidden = false;
    $$('.sg', box).forEach(n => { n.onmousedown = (e) => { e.preventDefault(); go(sug.items[+n.dataset.i], e); }; });
  }
  function hideSuggest() { $('#suggest').hidden = true; sug.items = []; sug.sel = -1; }

  /* ---------------- nav buttons ---------------- */
  $('#btnBack').onclick = () => active()?.wv?.goBack();
  $('#btnFwd').onclick = () => active()?.wv?.goForward();
  $('#btnReload').onclick = () => { const t = active(); if (!t) return; if (t.loading) t.wv?.stop(); else if (t.wv) t.wv.reload(); else { t.mounted = null; V.mount(t); } };
  $('#newTab').onclick = () => V.openTab();
  $('#newTab').oncontextmenu = (e) => {
    e.preventDefault();
    popMenu(e.clientX, e.clientY, [
      { label: 'New Tab', icon: 'plus', hint: '⌘T', onClick: () => V.openTab() },
      { label: 'New Window', icon: 'window', hint: '⌘N', onClick: () => vantage.newWindow({}) },
      { label: 'New Private Window', icon: 'mask', hint: '⇧⌘N', onClick: () => vantage.newWindow({ isPrivate: true }) },
      '-', { html: '<div class="label">New tab in a container</div>' },
      ...(V.settings.containers || []).map(c => ({ label: c.name, icon: 'container', onClick: () => V.openTab('', { container: c.id }) })),
      { label: 'Manage containers…', icon: 'settings', onClick: () => V.openInternal('settings:containers') }
    ]);
  };
  $('#omniZoom').onclick = () => V.zoom(0);
  $('#omniReader').onclick = () => readerView();
  $('#btnLibrary').onclick = () => V.openInternal('library');

  /* ---------------- bookmarks ---------------- */
  function renderBookmarksBar() {
    const bar = $('#bmbar');
    const on = V.settings.bookmarksBar !== false && !V.isPrivate;
    document.body.classList.toggle('has-bmbar', on);
    if (!on) { bar.innerHTML = ''; return; }
    const items = V.bookmarks.filter(b => b.folder === 'Bar');
    const folders = [...new Set(V.bookmarks.filter(b => (b.folder || '').startsWith('Bar/')).map(b => b.folder.split('/')[1]))];
    const others = V.bookmarks.filter(b => !(b.folder || 'Bar').startsWith('Bar'));
    bar.innerHTML = folders.map(f => `<button class="bm folder" data-folder="Bar/${esc(f)}">${ic('folder', 14)}<span>${esc(f)}</span></button>`).join('') +
      items.map(b => `<button class="bm ${V.settings.bookmarkNames === false || b.hideName || !String(b.title || '').trim() ? 'icon-only' : ''}" data-id="${b.id}" title="${esc(b.title ? b.title + '\n' : '')}${esc(b.url)}" draggable="true">${bmIconHTML(b, 15)}<span>${esc(b.title || '')}</span></button>`).join('') +
      (others.length ? `<span class="bm-fill"></span><button class="bm folder" data-folder="__other">${ic('folder', 14)}<span>Other bookmarks</span></button>` : '') +
      (!V.bookmarks.length ? `<span class="bm-empty">Bookmark pages with ⌘D, or <a data-import>import from Chrome</a></span>` : '');
    $$('.bm[data-id]', bar).forEach(el => {
      const b = V.bookmarks.find(x => x.id === el.dataset.id);
      el.onclick = (e) => (e.metaKey || e.ctrlKey ? V.openTab(b.url, { background: true }) : V.navigate(b.url));
      el.onauxclick = (e) => { if (e.button === 1) V.openTab(b.url, { background: true }); };
      el.oncontextmenu = (e) => { e.preventDefault(); bookmarkMenu(b, e.clientX, e.clientY); };
      el.ondragstart = (e) => { e.dataTransfer.setData('vantage/bm', b.id); e.dataTransfer.setData('text/uri-list', b.url); };
      el.ondragover = (e) => { if ([...e.dataTransfer.types].includes('vantage/bm')) e.preventDefault(); };
      el.ondrop = async (e) => {
        const id = e.dataTransfer.getData('vantage/bm'); if (!id || id === b.id) return;
        const ids = items.map(x => x.id).filter(x => x !== id);
        ids.splice(ids.indexOf(b.id), 0, id);
        V.bookmarks = await vantage.bookmarks.reorder(ids); renderBookmarksBar();
      };
    });
    $$('.bm.folder', bar).forEach(el => el.onclick = () => {
      const f = el.dataset.folder;
      const list = f === '__other' ? others : V.bookmarks.filter(b => b.folder === f || (b.folder || '').startsWith(f + '/'));
      const r = el.getBoundingClientRect();
      popMenu(r.left, r.bottom + 4, list.slice(0, 40).map(b => ({ label: b.title || b.url, iconHTML: bmIconHTML(b, 15), onClick: () => V.navigate(b.url) })).concat(list.length > 40 ? ['-', { label: `All ${list.length}…`, onClick: () => V.openInternal('bookmarks') }] : []));
    });
    $('[data-import]', bar)?.addEventListener('click', () => V.openInternal('settings:import'));
    fillBookmarkIcons();
  }
  // bookmarks without an icon get the site's own, fetched once and saved with the bookmark
  const iconTried = new Set();
  let iconRun = null;
  function fillBookmarkIcons() {
    if (iconRun || V.isPrivate) return;
    const need = V.bookmarks.filter(b => !b.icon && !b.iconType && !iconTried.has(b.id) && /^https?:/.test(b.url))
      .sort((a, b) => ((a.folder || 'Bar') === 'Bar' ? 0 : 1) - ((b.folder || 'Bar') === 'Bar' ? 0 : 1)).slice(0, 60);
    if (!need.length) return;
    iconRun = (async () => {
      for (const b of need) {
        iconTried.add(b.id);
        const data = await vantage.favicon.get(b.url).catch(() => null);
        if (data && V.bookmarks.some(x => x.id === b.id && !x.icon)) V.bookmarks = await vantage.bookmarks.save({ id: b.id, icon: data });
      }
    })().finally(() => { iconRun = null; });
  }
  V.fillBookmarkIcons = fillBookmarkIcons;
  function bookmarkMenu(b, x, y) {
    popMenu(x, y, [
      { label: 'Open in New Tab', icon: 'plus', onClick: () => V.openTab(b.url, { background: true }) },
      { label: 'Open in Split View', icon: 'split', onClick: () => V.openInSplit(b.url) },
      { label: 'Open in Private Window', icon: 'mask', onClick: () => vantage.newWindow({ isPrivate: true, urls: [b.url] }) },
      '-',
      { label: 'Edit…', icon: 'edit', onClick: () => editBookmark(b) },
      { label: 'Change Icon…', icon: 'palette', onClick: () => iconPicker(b, async (patch) => { V.bookmarks = await vantage.bookmarks.save({ id: b.id, ...patch }); renderBookmarksBar(); }) },
      { label: b.hideName ? 'Show Name' : 'Show Icon Only', icon: 'star', onClick: async () => { V.bookmarks = await vantage.bookmarks.save({ id: b.id, hideName: !b.hideName }); renderBookmarksBar(); } },
      { label: 'Copy Link', icon: 'link', onClick: () => navigator.clipboard.writeText(b.url) },
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { V.bookmarks = await vantage.bookmarks.del(b.id); renderBookmarksBar(); updateToolbar(); } }
    ]);
  }
  function folderOptions(cur) {
    const fs = [...new Set(['Bar', 'Other', ...V.bookmarks.map(b => b.folder || 'Bar')])];
    return fs.map(f => `<option value="${esc(f)}" ${f === cur ? 'selected' : ''}>${esc(f === 'Bar' ? 'Bookmarks bar' : f.replace(/^Bar\//, 'Bookmarks bar › '))}</option>`).join('');
  }
  function editBookmark(b) {
    openModal({
      title: 'Edit bookmark', icon: 'star', body: `<div class="bm-edit-ic"><span id="bIc">${bmIconHTML(b, 40)}</span><button class="btn sm" id="bIcB">${ic('palette', 14)} Change icon…</button></div>
        <div class="field"><label>Name <span class="muted-sm">(leave blank for just the icon)</span></label><input class="input" id="bT" value="${esc(b.title)}"></div>
        <div class="field"><label>Address</label><input class="input" id="bU" value="${esc(b.url)}"></div>
        <div class="field"><label>Folder</label><select class="select" id="bF">${folderOptions(b.folder)}</select></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'brand', onClick: async (m) => {
        V.bookmarks = await vantage.bookmarks.save({ id: b.id, title: $('#bT', m).value.trim(), url: V.toURL($('#bU', m).value), folder: $('#bF', m).value });
        renderBookmarksBar(); updateToolbar();
      } }],
      onMount: (m) => { $('#bIcB', m).onclick = () => { const vals = { t: $('#bT', m).value, u: $('#bU', m).value, f: $('#bF', m).value };
        iconPicker(b, async (patch) => { V.bookmarks = await vantage.bookmarks.save({ id: b.id, ...patch, title: vals.t.trim(), url: V.toURL(vals.u) || b.url, folder: vals.f }); renderBookmarksBar(); updateToolbar(); }); }; }
    });
  }

  /* ---------------- icon picker: site icon, emoji, symbol, letter or your own picture ---------------- */
  const EMOJI = ['⭐️','🔥','❤️','🎵','🎬','📺','🎮','⚽️','🏀','📚','📰','💼','💰','📈','🛒','🍔','☕️','✈️','🏠','💡','🚀','🧠','🎨','📷','🧩','🐶','🌿','🌙','☀️','⚡️','🔒','📬','🗓️','🧪','💻','🤖','🎧','🏆','🎯','🍿'];
  const GLYPHS = ['star','heart','home','mail','chat','calendar','music','film','tv','play','game','ball','book','news','library','briefcase','chart','cart','code','coffee','plane','rocket','leaf','paw','bulb','camera','image','cloud','globe','wifi','key','lock','sparkles','flag','folder','note','bolt','box'];
  const SWATCHES = ['#3fa9f5','#6a7dff','#8b6dff','#c04bff','#ff4f9a','#e5484d','#ff7a45','#ffb03b','#22c55e','#14b8a6','#0ea5e9','#64748b','#111827'];
  function iconPicker(target, onSave) {
    const st = { iconType: target.iconType || 'site', emoji: target.emoji || '⭐️', glyph: target.glyph || 'star', color: target.color || tileColor(hostOf(target.url)), letter: target.letter || letterOf(target), image: target.image || '', icon: target.icon || '' };
    const preview = () => bmIconHTML({ ...target, ...st, iconType: st.iconType === 'site' ? '' : st.iconType }, 56);
    const body = () => `<div class="ip-wrap">
        <div class="ip-prev" id="ipPrev">${preview()}</div>
        <div class="seg wide ip-tabs">${[['site', 'Site icon'], ['emoji', 'Emoji'], ['glyph', 'Symbol'], ['letter', 'Letter'], ['image', 'Picture']].map(([k, l]) => `<button data-k="${k}" class="${st.iconType === k ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="ip-pane" id="ipPane"></div></div>`;
    openModal({
      title: 'Choose an icon', subtitle: target.title || hostOf(target.url), icon: 'palette', body: body(),
      actions: [{ label: 'Cancel' }, { label: 'Use this icon', cls: 'brand', onClick: async () => {
        const patch = { iconType: st.iconType === 'site' ? null : st.iconType, emoji: st.emoji, glyph: st.glyph, color: st.color, letter: st.letter, image: st.iconType === 'image' ? st.image : null };
        if (st.iconType === 'site') patch.icon = st.icon || null;
        await onSave(patch);
      } }],
      onMount: (m) => {
        const pane = $('#ipPane', m);
        const refresh = () => { $('#ipPrev', m).innerHTML = preview(); };
        const swatches = () => `<div class="ip-sw">${SWATCHES.map(c => `<button class="swatch ${c === st.color ? 'active' : ''}" style="--c:${c}" data-c="${c}"></button>`).join('')}<label class="swatch custom" title="Any color"><input type="color" value="${esc(st.color)}" data-cc></label></div>`;
        const bindSw = () => {
          $$('[data-c]', pane).forEach(b => b.onclick = () => { st.color = b.dataset.c; draw(); });
          const cc = $('[data-cc]', pane); if (cc) cc.oninput = () => { st.color = cc.value; refresh(); };
        };
        const draw = () => {
          $$('.ip-tabs button', m).forEach(b => b.classList.toggle('active', b.dataset.k === st.iconType));
          if (st.iconType === 'site') {
            pane.innerHTML = `<p class="set-p">The icon the site itself uses. Vantage fetches the sharpest one it offers.</p><button class="btn" id="ipRe">${ic('refresh', 14)} Fetch it again</button>`;
            $('#ipRe', pane).onclick = async () => { $('#ipRe', pane).textContent = 'Fetching…'; const d = await vantage.favicon.get(target.url, true).catch(() => null); if (d) { st.icon = d; refresh(); toast('Got the site’s icon'); } else toast('That site doesn’t offer an icon', 'error'); draw(); };
          } else if (st.iconType === 'emoji') {
            pane.innerHTML = `<div class="ip-grid emoji">${EMOJI.map(e => `<button data-e="${e}" class="${e === st.emoji ? 'on' : ''}">${e}</button>`).join('')}</div><div class="field"><label>Or type any emoji</label><input class="input" id="ipE" value="${esc(st.emoji)}" maxlength="8"></div>`;
            $$('[data-e]', pane).forEach(b => b.onclick = () => { st.emoji = b.dataset.e; draw(); });
            $('#ipE', pane).oninput = (e) => { st.emoji = e.target.value.trim() || '⭐️'; refresh(); };
          } else if (st.iconType === 'glyph') {
            pane.innerHTML = `<div class="ip-grid glyph" style="--c:${esc(st.color)}">${GLYPHS.map(g => `<button data-g="${g}" class="${g === st.glyph ? 'on' : ''}">${ic(g, 20)}</button>`).join('')}</div>${swatches()}`;
            $$('[data-g]', pane).forEach(b => b.onclick = () => { st.glyph = b.dataset.g; draw(); });
            bindSw();
          } else if (st.iconType === 'letter') {
            pane.innerHTML = `<div class="field"><label>Letters (up to 2)</label><input class="input" id="ipL" value="${esc(st.letter)}" maxlength="2"></div>${swatches()}`;
            $('#ipL', pane).oninput = (e) => { st.letter = e.target.value || letterOf(target); refresh(); };
            bindSw();
          } else {
            pane.innerHTML = `<p class="set-p">Any picture from your computer. It’s cropped to a square.</p><label class="btn">${ic('image', 14)} Choose a picture…<input type="file" accept="image/*" id="ipF" hidden></label>`;
            $('#ipF', pane).onchange = (e) => {
              const f = e.target.files[0]; if (!f) return;
              const img = new Image();
              img.onload = () => {
                const c = document.createElement('canvas'); c.width = c.height = 128;
                const k = Math.min(img.width, img.height);
                c.getContext('2d').drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, 128, 128);
                st.image = c.toDataURL('image/png'); refresh(); URL.revokeObjectURL(img.src);
              };
              img.src = URL.createObjectURL(f);
            };
          }
          refresh();
        };
        $$('.ip-tabs button', m).forEach(b => b.onclick = () => { st.iconType = b.dataset.k; draw(); });
        draw();
      }
    });
  }
  V.iconPicker = iconPicker;
  async function toggleBookmark() {
    const t = active();
    if (!isWeb(t)) return;
    const existing = V.bookmarks.find(b => b.url === t.url);
    if (!existing) {
      V.bookmarks = await vantage.bookmarks.save({ title: t.title || hostOf(t.url), url: t.url, folder: 'Bar' });
      renderBookmarksBar(); updateToolbar();
      const fresh = V.bookmarks.find(x => x.url === t.url);
      vantage.favicon.get(t.url).then(async (d) => { if (d && fresh) { V.bookmarks = await vantage.bookmarks.save({ id: fresh.id, icon: d }); renderBookmarksBar(); } }).catch(() => {});
    }
    const b = V.bookmarks.find(x => x.url === t.url);
    popover($('#omniStar'), {
      width: 320, html: `<div class="pop-h">${ic('star', 16)}<b>${existing ? 'Edit bookmark' : 'Bookmark added'}</b></div>
        <div class="pop-b"><div class="field"><label>Name <span class="muted-sm">(leave blank for just the icon)</span></label><input class="input" id="pbT" value="${esc(b.title)}"></div>
        <div class="field"><label>Folder</label><select class="select" id="pbF">${folderOptions(b.folder)}</select></div></div>
        <div class="pop-f"><button class="btn danger" id="pbDel">Remove</button><button class="btn ghost" id="pbIc" title="Change icon">${ic('palette', 14)}</button><span class="spacer"></span><button class="btn brand" id="pbOk">Done</button></div>`,
      onMount: (p, close) => {
        const save = async () => { V.bookmarks = await vantage.bookmarks.save({ id: b.id, title: $('#pbT', p).value.trim(), folder: $('#pbF', p).value }); renderBookmarksBar(); };
        $('#pbOk', p).onclick = async () => { await save(); close(); };
        $('#pbT', p).onkeydown = async (e) => { if (e.key === 'Enter') { await save(); close(); } };
        $('#pbIc', p).onclick = () => { close(); const bb = V.bookmarks.find(x => x.id === b.id) || b; iconPicker(bb, async (patch) => { V.bookmarks = await vantage.bookmarks.save({ id: b.id, ...patch }); renderBookmarksBar(); }); };
        $('#pbDel', p).onclick = async () => { V.bookmarks = await vantage.bookmarks.del(b.id); renderBookmarksBar(); updateToolbar(); close(); };
        setTimeout(() => $('#pbT', p).select(), 30);
      }
    });
  }
  $('#omniStar').onclick = toggleBookmark;
  vantage.bookmarks.onChanged((list) => { V.bookmarks = list; renderBookmarksBar(); updateToolbar(); V.refreshInternal?.('bookmarks'); V.refreshInternal?.('newtab'); });

  /* ---------------- ad-blocking shield ---------------- */
  $('#omniShield').onclick = async () => {
    const t = active(); if (!isWeb(t)) return;
    const host = hostOf(t.url);
    const st = await vantage.adblock.status();
    const allowed = (V.settings.adblock?.allow || []).some(h => host === h || host.endsWith('.' + h));
    const globalOff = V.settings.adblock?.enabled === false;
    popover($('#omniShield'), {
      width: 300, html: `<div class="shield-pop ${allowed || globalOff ? 'off' : ''}">
        <div class="sp-big">${ic(allowed || globalOff ? 'shieldOff' : 'shieldCheck', 26)}<div><b>${globalOff ? 'Ad blocking is off' : allowed ? `Paused on ${esc(host)}` : `${t.blocked || 0} blocked on this page`}</b>
        <span>${(st.total || 0).toLocaleString()} ads and trackers blocked since ${new Date(st.since || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div></div>
        ${globalOff ? '' : `<label class="switch-row"><span>Block ads and trackers on ${esc(host)}</span><input type="checkbox" class="switch" id="spToggle" ${allowed ? '' : 'checked'}></label>`}
        <div class="pop-f"><button class="btn ghost" id="spSettings">${ic('settings', 14)} Settings</button><span class="spacer"></span>${st.ready ? '' : '<span class="muted-sm">Loading lists…</span>'}</div></div>`,
      onMount: (p, close) => {
        $('#spToggle', p)?.addEventListener('change', async (e) => {
          await vantage.adblock.site(host, !e.target.checked);
          V.settings = await vantage.settings.get();
          close(); t.wv?.reload(); updateShield();
          toast(e.target.checked ? `Blocking ads on ${host} again` : `Ads allowed on ${host}`);
        });
        $('#spSettings', p).onclick = () => { close(); V.openInternal('settings:privacy'); };
      }
    });
  };

  /* ---------------- site info ---------------- */
  const PERM_LABEL = { media: ['Camera & microphone', 'camera'], geolocation: ['Location', 'mapPin'], notifications: ['Notifications', 'bell'], 'clipboard-read': ['Read clipboard', 'copy'], midi: ['MIDI devices', 'music'], 'display-capture': ['Screen sharing', 'tv'], 'idle-detection': ['Idle detection', 'clock'], hid: ['HID devices', 'box'], serial: ['Serial ports', 'box'], usb: ['USB devices', 'box'] };
  $('#omniSite').onclick = async () => {
    const t = active();
    if (!isWeb(t)) { focusOmni(); return; }
    const host = hostOf(t.url);
    const s = await V.siteInfo(host, true);
    const secure = /^https:/.test(t.url);
    const perms = Object.entries(s.perms || {});
    popover($('#omniSite'), {
      width: 330, align: 'left', html: `<div class="pop-h">${ic(secure ? 'lock' : 'alert', 16)}<b>${esc(host || t.url)}</b></div>
        <div class="pop-b">
          <div class="site-sec ${secure ? 'ok' : 'warn'}">${secure ? 'Connection is secure. What you send to this site is encrypted.' : 'This connection isn’t secure. Don’t enter passwords or card numbers here.'}</div>
          ${perms.length ? `<div class="label" style="margin-top:4px">Permissions</div>${perms.map(([k, v]) => `<div class="perm-row">${ic((PERM_LABEL[k] || [k, 'check'])[1], 15)}<span>${esc((PERM_LABEL[k] || [k])[0])}</span><span class="spacer"></span><span class="chip ${v === 'allow' ? 'ok' : 'no'}">${v === 'allow' ? 'Allowed' : 'Blocked'}</span><button class="icon-btn sm" data-forget="${esc(k)}" title="Ask again next time">${ic('x', 13)}</button></div>`).join('')}` : ''}
          <label class="switch-row"><span>${ic('moon', 15)} Dark pages on this site</span><input type="checkbox" class="switch" id="siDark" ${s.dark ? 'checked' : ''}></label>
          <div class="zoom-row"><span>${ic('search', 15)} Zoom</span><span class="spacer"></span><button class="icon-btn sm" id="siZo">${ic('minus', 14)}</button><b id="siZv">${Math.round((t.zoom || 1) * 100)}%</b><button class="icon-btn sm" id="siZi">${ic('plus', 14)}</button></div>
        </div>
        <div class="pop-f"><button class="btn ghost" id="siClear">${ic('trash', 14)} Clear site data</button><span class="spacer"></span><button class="btn ghost" id="siCopy">${ic('link', 14)} Copy link</button></div>`,
      onMount: (p, close) => {
        $$('[data-forget]', p).forEach(b => b.onclick = async () => { await vantage.site.forgetPermission({ host, permission: b.dataset.forget }); V.sites.delete(host); b.closest('.perm-row').remove(); });
        $('#siDark', p).onchange = (e) => V.setSite(t, { dark: e.target.checked || null });
        $('#siZi', p).onclick = () => { V.zoom(1); setTimeout(() => { $('#siZv', p).textContent = Math.round((active().zoom || 1) * 100) + '%'; }, 150); };
        $('#siZo', p).onclick = () => { V.zoom(-1); setTimeout(() => { $('#siZv', p).textContent = Math.round((active().zoom || 1) * 100) + '%'; }, 150); };
        $('#siCopy', p).onclick = () => { navigator.clipboard.writeText(t.url); toast('Link copied'); close(); };
        $('#siClear', p).onclick = async () => {
          close();
          if (!await confirmModal(`Clear data for ${host}?`, 'You’ll be signed out of this site and its saved data (cookies, storage) is removed.', 'Clear', true)) return;
          await vantage.site.clearData({ origin: new URL(t.url).origin, partition: V.partitionFor(t) });
          t.wv?.reload(); toast(`Cleared ${host}`);
        };
      }
    });
  };

  /* ---------------- split view picker ---------------- */
  const LAYOUT_IC = { one: 'layout1', cols2: 'layoutCols2', rows2: 'layoutRows2', main3: 'layoutMain3', cols3: 'layoutCols3', grid4: 'layoutGrid4' };
  $('#btnSplit').onclick = () => {
    popover($('#btnSplit'), {
      width: 300, html: `<div class="pop-h">${ic('split', 16)}<b>Split view</b><span class="spacer"></span><span class="muted-sm">⌘⌥1–6</span></div>
        <div class="layouts">${Object.keys(V.LAYOUTS).map((k, i) => `<button class="lay ${V.layout === k ? 'on' : ''}" data-l="${k}" title="${V.LAYOUT_NAMES[k]} (⌘⌥${i + 1})">${ic(LAYOUT_IC[k], 30)}<span>${V.LAYOUT_NAMES[k]}</span></button>`).join('')}</div>
        <div class="pop-b tight"><div class="hint">Drag any tab onto the page to place it. Drag the gaps to resize; double-click a gap to even out.</div></div>
        <div class="pop-f"><button class="btn ghost" id="slFocus">${ic('maximize', 14)} Focus mode</button><span class="spacer"></span>${V.panes.length > 1 ? `<button class="btn ghost" id="slSwap">${ic('swap', 14)} Rotate</button>` : ''}</div>`,
      onMount: (p, close) => {
        $$('[data-l]', p).forEach(b => b.onclick = () => { V.setLayout(b.dataset.l); close(); });
        $('#slFocus', p).onclick = () => { close(); toggleFocusMode(); };
        $('#slSwap', p)?.addEventListener('click', () => { V.swapPanes(); });
      }
    });
  };

  /* ---------------- focus mode: pages fill the whole screen ---------------- */
  async function toggleFocusMode(on = !V.focusMode) {
    V.focusMode = on;
    document.body.classList.toggle('focus-mode', on);
    document.body.classList.remove('reveal');
    await vantage.fullscreen(on);
    V.applyLayout(); V.persist();
    if (on) toast('Focus mode — move to the top edge for the toolbar, ⇧⌘F to leave');
  }
  $('#focusReveal').addEventListener('mouseenter', () => { if (V.focusMode) document.body.classList.add('reveal'); });
  for (const id of ['#strip', '#toolbar', '#bmbar']) $(id).addEventListener('mouseleave', (e) => {
    if (!V.focusMode || $('#popRoot').children.length || document.activeElement === omni) return;
    const to = e.relatedTarget;
    if (to && (to.closest?.('#strip') || to.closest?.('#toolbar') || to.closest?.('#bmbar') || to.closest?.('#suggest'))) return;
    document.body.classList.remove('reveal');
  });
  vantage.onFullscreen((fs) => {
    document.body.classList.toggle('fullscreen', fs);
    if (!fs && V.focusMode) { V.focusMode = false; document.body.classList.remove('focus-mode', 'reveal'); V.applyLayout(); V.persist(); }
  });

  /* ---------------- downloads ---------------- */
  V.downloads = [];
  async function loadDownloads() { V.downloads = await vantage.downloads.list(); updateDlButton(); }
  function updateDlButton() {
    const live = V.downloads.filter(d => d.state === 'progressing');
    const b = $('#btnDownloads');
    b.classList.toggle('busy', live.length > 0);
    const tot = live.reduce((a, d) => a + (d.total || 0), 0), got = live.reduce((a, d) => a + (d.received || 0), 0);
    b.style.setProperty('--p', live.length ? Math.round((tot ? got / tot : 0) * 100) : 0);
    b.dataset.n = live.length > 1 ? live.length : '';
  }
  vantage.downloads.onUpdate((d) => {
    const i = V.downloads.findIndex(x => x.id === d.id);
    if (i >= 0) V.downloads[i] = d; else V.downloads.unshift(d);
    updateDlButton();
    V.onDownloadUpdate?.(d);
    if (popClose?.anchor === $('#btnDownloads')) renderDlPop();
  });
  vantage.downloads.onRemoved((id) => { V.downloads = V.downloads.filter(d => d.id !== id); updateDlButton(); V.onDownloadUpdate?.(); });
  vantage.downloads.onStarted(({ name, wcId }) => {
    // a link that turned out to be a download leaves the tab where it was (a fresh tab goes back to New Tab)
    const t = wcId != null && V.tabs.find(x => x.wcId === wcId);
    if (t && t.wv) {
      let committed = '';
      try { committed = t.wv.getURL(); } catch {}
      if (committed !== t.url) {
        if (!committed || committed === 'about:blank') { if (t.openerId && V.tabs.length > 1 && !t.wv.canGoBack()) V.closeTab(t.id, { record: false }); else V.navigate('vantage://newtab', t); }
        else { t.url = committed; t.loading = false; V.renderTab(t); V.updateToolbar(); V.persist(); }
      }
    } toast(`Downloading ${name}`); $('#btnDownloads').classList.add('bump'); setTimeout(() => $('#btnDownloads').classList.remove('bump'), 700); });
  vantage.downloads.onDone((d) => {
    const rec = V.downloads.find(x => x.id === d.id);
    const extra = rec?.engine === 'fast' && rec.total ? ` · ${fmtBytes(rec.total)}` : '';
    toast(`Downloaded ${d.name}${extra}`, '', { label: 'Open', onClick: () => vantage.downloads.open(d.id) });
    vantage.notify({ title: 'Download finished', body: d.name });
  });
  function dlRowHTML(d) {
    const pct = d.total ? Math.min(100, Math.round(d.received / d.total * 100)) : 0;
    const live = d.state === 'progressing';
    const eta = live && d.speed && d.total ? fmtEta((d.total - d.received) / d.speed) : '';
    const status = live ? `${fmtBytes(d.received)} of ${fmtBytes(d.total) || '?'} · ${fmtSpeed(d.speed)}${d.connections > 1 ? ` · ${d.connections} connections` : ''}${eta ? ' · ' + eta : ''}`
      : d.state === 'paused' ? `Paused · ${fmtBytes(d.received)} of ${fmtBytes(d.total)}`
      : d.state === 'completed' ? (d.exists ? `${fmtBytes(d.total)} · ${hostOf(d.url) || ''}` : 'Moved or deleted')
      : d.state === 'interrupted' ? `Failed${d.error ? ' · ' + d.error : ''}` : 'Cancelled';
    return `<div class="dl ${d.state} ${d.exists === false ? 'gone' : ''}" data-id="${d.id}" draggable="${d.state === 'completed' && d.exists}">
      <span class="dl-ic">${ic({ video: 'film', audio: 'music', image: 'image', pdf: 'file', archive: 'archive', comic: 'book', doc: 'file' }[d.kind] || 'download', 18)}</span>
      <div class="dl-m"><div class="dl-n">${esc(d.name)}</div>${live || d.state === 'paused' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}<div class="dl-s">${esc(status)}${d.engine === 'fast' && d.state === 'completed' ? ` <span class="chip bolt">${ic('bolt', 11)} fast</span>` : ''}</div></div>
      <div class="dl-a">
        ${live ? `<button class="icon-btn sm" data-a="pause" title="Pause">${ic('pause', 14)}</button>` : ''}
        ${d.state === 'paused' || d.state === 'interrupted' ? `<button class="icon-btn sm" data-a="resume" title="Resume">${ic('play', 14)}</button>` : ''}
        ${live || d.state === 'paused' ? `<button class="icon-btn sm" data-a="cancel" title="Cancel">${ic('x', 14)}</button>` : ''}
        ${d.state === 'completed' && d.exists ? `<button class="icon-btn sm" data-a="show" title="Show in folder">${ic('folder', 14)}</button>` : ''}
      </div></div>`;
  }
  function bindDl(root) {
    $$('.dl', root).forEach(row => {
      const id = row.dataset.id;
      const d = V.downloads.find(x => x.id === id);
      row.ondblclick = () => { if (d?.state === 'completed') vantage.downloads.open(id); };
      $$('[data-a]', row).forEach(b => b.onclick = (e) => {
        e.stopPropagation();
        const a = b.dataset.a;
        if (a === 'show') vantage.downloads.show(id); else vantage.downloads.control(id, a);
      });
      row.ondragstart = (e) => { e.preventDefault(); if (d) vantage.startDrag(d.path); };
      row.oncontextmenu = (e) => { e.preventDefault(); if (d) V.downloadMenu(d, e.clientX, e.clientY); };
    });
  }
  V.dlRowHTML = dlRowHTML; V.bindDl = bindDl;
  V.downloadMenu = (d, x, y) => {
    const done = d.state === 'completed' && d.exists;
    popMenu(x, y, [
      done ? { label: 'Open', icon: 'external', onClick: () => vantage.downloads.open(d.id) } : null,
      done ? { label: 'Show in Folder', icon: 'folder', onClick: () => vantage.downloads.show(d.id) } : null,
      done && /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(d.name) ? { label: 'Play in Vantage Player', icon: 'play', onClick: () => window.Player?.open([{ src: d.path, title: d.name }]) } : null,
      done && /\.(pdf|cbz|zip|jpe?g|png|gif|webp)$/i.test(d.name) ? { label: 'Open in Vantage Reader', icon: 'book', onClick: () => window.Reader?.open(d.path) } : null,
      done ? { label: 'Move to Library', icon: 'library', onClick: () => window.Library?.addFromDownload(d.path, d.name).then(() => loadDownloads()) } : null,
      { label: 'Copy Download Link', icon: 'link', onClick: () => navigator.clipboard.writeText(d.url) },
      d.pageUrl ? { label: 'Go to Page', icon: 'globe', onClick: () => V.openTab(d.pageUrl) } : null,
      ['interrupted', 'cancelled'].includes(d.state) ? { label: 'Download Again', icon: 'refresh', onClick: () => vantage.downloads.control(d.id, 'retry') } : null,
      '-',
      { label: 'Remove from List', icon: 'x', onClick: async () => { V.downloads = await vantage.downloads.remove(d.id); updateDlButton(); V.onDownloadUpdate?.(); } },
      done ? { label: 'Move to Trash', icon: 'trash', danger: true, onClick: async () => { V.downloads = await vantage.downloads.del(d.id); updateDlButton(); V.onDownloadUpdate?.(); } } : null
    ]);
  };
  function renderDlPop() {
    const p = $('#popRoot .dl-pop');
    if (!p) return;
    const list = V.downloads.slice(0, 7);
    $('.dl-list', p).innerHTML = list.length ? list.map(dlRowHTML).join('') : `<div class="pop-empty">${ic('download', 22)}<span>Nothing downloaded yet</span></div>`;
    bindDl(p);
  }
  $('#btnDownloads').onclick = () => {
    popover($('#btnDownloads'), {
      width: 380, cls: 'dl-pop', html: `<div class="pop-h">${ic('download', 16)}<b>Downloads</b><span class="spacer"></span><button class="btn ghost sm" id="dpFolder">${ic('folder', 14)}</button></div>
        <div class="dl-list"></div><div class="pop-f"><span class="muted-sm">${V.settings.fastDownloads !== false ? `${ic('bolt', 12)} Fast downloads: up to ${V.settings.downloadConnections || 8} connections` : ''}</span><span class="spacer"></span><button class="btn ghost" id="dpAll">Show all</button></div>`,
      onMount: (p, close) => {
        renderDlPop();
        $('#dpFolder', p).onclick = () => vantage.downloads.openFolder();
        $('#dpAll', p).onclick = () => { close(); V.openInternal('downloads'); };
      }
    });
  };

  /* ---------------- VPN ---------------- */
  V.vpn = { mode: 'off', status: 'off' };
  function renderVpnPill() {
    const s = V.vpn, b = $('#btnVpn');
    b.className = 'vpn-pill ' + (s.status === 'on' ? 'on' : s.status === 'connecting' ? 'busy' : s.status === 'error' ? 'err' : '');
    $('.t', b).textContent = s.status === 'on' ? (s.loc ? `VPN · ${s.loc}` : 'VPN') : s.status === 'connecting' ? 'Connecting…' : s.status === 'error' ? 'VPN blocked' : 'VPN';
    b.title = s.status === 'on' ? `Connected through ${modeName(s.mode)}${s.ip ? ` · ${s.ip}` : ''}` : s.status === 'error' ? s.error : 'VPN is off — click to connect (⇧⌘U)';
  }
  const modeName = (m) => ({ warp: 'Cloudflare WARP', wireguard: V.vpn.wireguardName || 'WireGuard', proxy: 'your proxy' }[m] || 'VPN');
  vantage.vpn.onState((s) => { V.vpn = { ...V.vpn, ...s }; renderVpnPill(); if (popClose?.anchor === $('#btnVpn')) renderVpnPop(); V.refreshInternal?.('settings'); });
  function renderVpnPop() {
    const p = $('#popRoot .vpn-pop');
    if (!p) return;
    const s = V.vpn;
    const on = s.status === 'on' || s.status === 'connecting';
    const pick = V.settings.vpn?.mode && V.settings.vpn.mode !== 'off' ? V.settings.vpn.mode : (s.hasWireGuard ? 'wireguard' : 'warp');
    V._vpnPick = V._vpnPick || pick;
    p.innerHTML = `<div class="vpn-hero ${s.status}">
        <button class="vpn-power" id="vpPower" title="${on ? 'Disconnect' : 'Connect'}">${ic('vpn', 30)}</button>
        <div><b>${s.status === 'on' ? 'Protected' : s.status === 'connecting' ? (s.progress || 'Connecting…') : s.status === 'error' ? 'Not connected' : 'VPN is off'}</b>
        <span>${s.status === 'on' ? `${esc(modeName(s.mode))}${s.ip ? ` · ${esc(s.ip)}` : ''}${s.loc ? ` · ${esc(s.loc)}` : ''}` : s.status === 'error' ? esc(s.error) : 'Vantage’s traffic only. Other apps aren’t affected.'}</span></div>
      </div>
      <div class="seg wide vpn-modes">${[['warp', 'Cloudflare WARP'], ['wireguard', 'WireGuard'], ['proxy', 'Proxy']].map(([k, l]) => `<button data-m="${k}" class="${V._vpnPick === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="pop-b tight"><div class="hint">${V._vpnPick === 'warp' ? 'Free and fast. Hides your IP address from sites; your location stays roughly the same.'
        : V._vpnPick === 'wireguard' ? (s.hasWireGuard ? `Using <b>${esc(s.wireguardName || 'your config')}</b>. Pick a server in another country to change your location.` : 'Import a WireGuard config from Proton VPN, Mullvad, IVPN or your own server.')
        : V.settings.vpn?.proxy?.host ? `Through ${esc(V.settings.vpn.proxy.type)}://${esc(V.settings.vpn.proxy.host)}:${esc(V.settings.vpn.proxy.port)}` : 'Add a SOCKS5 or HTTP proxy in settings.'}</div></div>
      <div class="pop-f">${V._vpnPick === 'wireguard' ? `<button class="btn ghost" id="vpImport">${ic('upload', 14)} ${s.hasWireGuard ? 'Change config' : 'Import config'}</button>` : ''}
        <button class="btn ghost" id="vpSettings">${ic('settings', 14)}</button><span class="spacer"></span>
        ${s.status === 'on' ? `<button class="btn ghost" id="vpCheck">Check</button>` : ''}
        <button class="btn ${on ? '' : 'brand'}" id="vpGo">${on ? 'Disconnect' : 'Connect'}</button></div>`;
    $$('[data-m]', p).forEach(b => b.onclick = () => { V._vpnPick = b.dataset.m; renderVpnPop(); });
    const go = async () => {
      if (on) { await vantage.vpn.disconnect(); return; }
      if (V._vpnPick === 'wireguard' && !s.hasWireGuard) { const r = await vantage.vpn.importFile(); if (!r) return; V.vpn = { ...V.vpn, ...r }; }
      if (V._vpnPick === 'proxy' && !V.settings.vpn?.proxy?.host) { closePopover(); V.openInternal('settings:vpn'); return; }
      V.vpn.status = 'connecting'; renderVpnPop();
      const r = await vantage.vpn.connect(V._vpnPick);
      V.vpn = { ...V.vpn, ...r }; renderVpnPop(); renderVpnPill();
      if (r.status === 'error') toast(r.error, 'error');
    };
    $('#vpPower', p).onclick = go; $('#vpGo', p).onclick = go;
    $('#vpImport', p)?.addEventListener('click', async () => { const r = await vantage.vpn.importFile().catch(e => { toast(cleanErr(e), 'error'); }); if (r) { V.vpn = { ...V.vpn, ...r }; renderVpnPop(); toast('WireGuard config saved'); } });
    $('#vpSettings', p).onclick = () => { closePopover(); V.openInternal('settings:vpn'); };
    $('#vpCheck', p)?.addEventListener('click', async () => { V.vpn = await vantage.vpn.check(); renderVpnPop(); renderVpnPill(); });
  }
  $('#btnVpn').onclick = () => { V._vpnPick = null; popover($('#btnVpn'), { width: 360, cls: 'vpn-pop', html: '', onMount: () => renderVpnPop() }); };
  V.openVpn = () => $('#btnVpn').click();
  async function toggleVpn() {
    if (V.vpn.status === 'on' || V.vpn.status === 'connecting') { await vantage.vpn.disconnect(); toast('VPN off'); return; }
    const mode = V.settings.vpn?.lastMode || (V.vpn.hasWireGuard ? 'wireguard' : 'warp');
    toast('Connecting VPN…');
    const r = await vantage.vpn.connect(mode);
    if (r.status === 'error') toast(r.error, 'error'); else toast(`VPN on · ${modeName(mode)}`);
  }

  /* ---------------- passwords ---------------- */
  $('#btnVault').onclick = async () => {
    const st = await relay.vault.status();
    const t = active();
    let matches = [];
    if (st.unlocked && isWeb(t)) matches = await relay.vault.matches(t.url).catch(() => []);
    popover($('#btnVault'), {
      width: 330, html: `<div class="pop-h">${ic('key', 16)}<b>Passwords</b><span class="spacer"></span>${st.unlocked ? `<button class="btn ghost sm" id="pvLock">${ic('lock', 13)} Lock</button>` : ''}</div>
        <div class="pop-b">${!st.exists ? `<div class="pop-empty">${ic('key', 22)}<span>Set up your vault to save and fill passwords.</span></div>`
          : !st.unlocked ? `<div class="pop-empty">${ic('lock', 22)}<span>${st.count ?? ''} passwords, locked</span><button class="btn brand" id="pvUnlock">${st.touchIdEnabled ? ic('fingerprint', 15) + ' Unlock with Touch ID' : 'Unlock'}</button></div>`
          : matches.length ? `<div class="label">For ${esc(hostOf(t.url))}</div>${matches.map(m => `<button class="pv-row" data-fill="${m.id}"><span class="fav letter" style="--c:${tileColor(m.host)}">${esc((m.name || m.host || '?')[0].toUpperCase())}</span><span class="pv-m"><b>${esc(m.username || '(no username)')}</b><span>${esc(m.name || m.host)}</span></span><span class="chip">Fill</span></button>`).join('')}`
          : `<div class="pop-empty">${ic('search', 20)}<span>${isWeb(t) ? `Nothing saved for ${esc(hostOf(t.url))}` : 'Open a sign-in page to fill a password'}</span></div>`}</div>
        <div class="pop-f"><button class="btn ghost" id="pvGen">${ic('dice', 14)} Strong password</button><span class="spacer"></span><button class="btn ghost" id="pvOpen">Open vault</button></div>`,
      onMount: (p, close) => {
        $('#pvUnlock', p)?.addEventListener('click', async () => { close(); if (await window.Vault.ensureUnlocked()) $('#btnVault').click(); });
        $('#pvLock', p)?.addEventListener('click', async () => { await relay.vault.lock(); close(); toast('Vault locked'); });
        $$('[data-fill]', p).forEach(b => b.onclick = async () => { close(); const r = await relay.vault.fill(b.dataset.fill, t.wcId); if (!r.ok) toast('Couldn’t find a sign-in form on this page', 'error'); });
        $('#pvGen', p).onclick = () => { const pw = genPassword(); navigator.clipboard.writeText(pw); toast('Strong password copied'); close(); };
        $('#pvOpen', p).onclick = () => { close(); V.openInternal('vault'); };
      }
    });
  };
  function genPassword(n = 20) {
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '-_.!@#%+='];
    const all = sets.join(''); const r = (m) => crypto.getRandomValues(new Uint32Array(1))[0] % m;
    const out = sets.map(s => s[r(s.length)]); while (out.length < n) out.push(all[r(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = r(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  }
  const tabByWc = (wcId) => V.tabs.find(t => t.wcId === wcId);
  relay.vault.onOfferSave((info) => {
    const t = tabByWc(info.wcId);
    if (!t || V.isPrivate) return;
    V.infobar(t, {
      id: 'save-pw', icon: 'key', cls: 'accent',
      html: `${info.update ? 'Update the saved password' : 'Save this password'} for <b>${esc(info.username || info.host)}</b> on ${esc(info.host)}?`,
      actions: [
        { label: 'Never for this site', cls: 'ghost', onClick: async () => { await relay.vault.saveCaptured(info.token, true); toast(`Won’t ask on ${info.host}`); } },
        { label: info.update ? 'Update' : 'Save', cls: 'brand', onClick: async () => {
          if (!await window.Vault.ensureUnlocked()) return false;
          const r = await relay.vault.saveCaptured(info.token, false);
          toast(r.ok ? (r.updated ? 'Password updated' : 'Password saved to your vault') : 'That sign-in expired', r.ok ? '' : 'error');
        } }
      ]
    });
  });
  relay.vault.onUnlockRequest(async () => { await window.Vault.ensureUnlocked(); });
  relay.vault.onFillRequest(async ({ wcId }) => {
    if (!await window.Vault.ensureUnlocked()) return;
    const t = tabByWc(wcId);
    const list = await relay.vault.matches(t?.url || '').catch(() => []);
    if (!list.length) return toast(`Nothing saved for ${hostOf(t?.url || '')}`, 'error');
    if (list.length === 1) { const r = await relay.vault.fill(list[0].id, wcId); if (!r.ok) toast('Couldn’t find a sign-in form', 'error'); return; }
    openModal({ title: 'Fill which login?', icon: 'key', body: list.map(m => `<button class="pv-row" data-id="${m.id}"><span class="pv-m"><b>${esc(m.username)}</b><span>${esc(m.name || m.host)}</span></span></button>`).join(''),
      actions: [{ label: 'Cancel' }], onMount: (m, close) => $$('[data-id]', m).forEach(b => b.onclick = async () => { close(); await relay.vault.fill(b.dataset.id, wcId); }) });
  });

  /* ---------------- permission requests ---------------- */
  const PERM_ASK = { media: (m) => (m.includes('video') && m.includes('audio') ? 'use your camera and microphone' : m.includes('video') ? 'use your camera' : 'use your microphone'), geolocation: () => 'know your location', notifications: () => 'show notifications', 'clipboard-read': () => 'see what you copy', midi: () => 'use MIDI devices', midiSysex: () => 'control MIDI devices', 'display-capture': () => 'see your screen', 'idle-detection': () => 'know when you’re away', 'storage-access': () => 'use its cookies here', 'top-level-storage-access': () => 'use its cookies here' };
  vantage.perm.onAsk((q) => {
    const t = tabByWc(q.wcId) || active();
    if (!t) return vantage.perm.answer({ id: q.id, allow: false });
    const what = (PERM_ASK[q.permission] || (() => `use ${q.permission}`))(q.mediaTypes || []);
    const icon = q.permission === 'media' ? 'camera' : q.permission === 'geolocation' ? 'mapPin' : q.permission === 'notifications' ? 'bell' : 'shield';
    let answered = false;
    const answer = (allow, remember) => { answered = true; vantage.perm.answer({ id: q.id, allow, remember }); if (remember) V.sites.delete(q.host); };
    V.infobar(t, {
      id: 'perm-' + q.id, icon, html: `<b>${esc(q.host)}</b> wants to ${esc(what)}`,
      onDismiss: () => { if (!answered) answer(false, false); },
      actions: [
        { label: 'Block', cls: 'ghost', onClick: () => answer(false, true) },
        { label: 'Allow once', cls: '', onClick: () => answer(true, false) },
        { label: 'Allow', cls: 'brand', onClick: () => answer(true, true) }
      ]
    });
  });

  /* ---------------- find in page ---------------- */
  V.find = null;
  function openFind() {
    const t = active();
    if (!t?.wv) return;
    if (V.find && V.find.tabId !== t.id) closeFind();
    let bar = t.view.querySelector('.findbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'findbar';
      bar.innerHTML = `${ic('search', 14)}<input placeholder="Find in page" spellcheck="false"><span class="fc"></span>
        <button class="icon-btn sm" data-f="prev" title="Previous (⇧⌘G)">${ic('chevronDown', 15, 'flip')}</button><button class="icon-btn sm" data-f="next" title="Next (⌘G)">${ic('chevronDown', 15)}</button><button class="icon-btn sm" data-f="x" title="Close (Esc)">${ic('x', 14)}</button>`;
      t.view.appendChild(bar);
      const input = $('input', bar);
      input.oninput = () => runFind(true);
      input.onkeydown = (e) => { if (e.key === 'Enter') runFind(false, !e.shiftKey); if (e.key === 'Escape') closeFind(); };
      $('[data-f=prev]', bar).onclick = () => runFind(false, false);
      $('[data-f=next]', bar).onclick = () => runFind(false, true);
      $('[data-f=x]', bar).onclick = closeFind;
      if (V.find?.text) input.value = V.find.text;
    }
    V.find = { tabId: t.id, text: $('input', bar).value };
    const input = $('input', bar); input.focus(); input.select();
  }
  function runFind(fresh, forward = true) {
    const t = V.tabById(V.find?.tabId);
    const bar = t?.view.querySelector('.findbar');
    if (!t?.wv || !bar) return;
    const text = $('input', bar).value;
    V.find.text = text;
    if (!text) { t.wv.stopFindInPage('clearSelection'); $('.fc', bar).textContent = ''; return; }
    t.wv.findInPage(text, { forward, findNext: !fresh });
  }
  function closeFind() {
    const t = V.tabById(V.find?.tabId);
    if (t) { t.view.querySelector('.findbar')?.remove(); t.wv?.stopFindInPage('clearSelection'); }
    V.find = null;
  }
  V.onFound = (t, r) => { const fc = t.view.querySelector('.findbar .fc'); if (fc) fc.textContent = r.matches ? `${r.activeMatchOrdinal} of ${r.matches}` : 'No results'; };
  V.closeFind = closeFind;
  V.syncFind = () => { if (V.find && V.find.tabId !== active()?.id) { /* keep the bar on its own pane */ } };

  /* ---------------- reader view ---------------- */
  async function readerView() {
    const t = active();
    if (!t?.wcId) return;
    const o = t.view.querySelector('.view-overlay');
    if (o.classList.contains('reader') && !o.hidden) { o.hidden = true; o.classList.remove('reader'); o.innerHTML = ''; return; }
    toast('Opening reader view…');
    const a = await vantage.page.reader(t.wcId);
    if (!a?.content) return toast('This page doesn’t look like an article', 'error');
    const dark = document.documentElement.dataset.theme === 'dark';
    const size = +(localStorage.getItem('vantage-reader-size') || 19);
    const css = `body{margin:0;background:${dark ? '#121417' : '#fbf9f5'};color:${dark ? '#e4e6ea' : '#1f1d1a'};font:${size}px/1.65 Charter,"Iowan Old Style",Georgia,serif}
      main{max-width:700px;margin:0 auto;padding:56px 28px 120px}h1{font:700 2em/1.2 -apple-system,system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 .3em}
      .by{font:14px -apple-system,system-ui,sans-serif;color:${dark ? '#9aa1ab' : '#7a746b'};margin-bottom:2.2em}img,video,figure{max-width:100%;height:auto;border-radius:6px}
      a{color:${dark ? '#7cc4ff' : '#1f6fc4'}}pre,code{font-size:.82em;background:${dark ? '#1c1f24' : '#f0ece4'};border-radius:5px}pre{padding:12px;overflow:auto}
      blockquote{margin:1em 0;padding-left:1em;border-left:3px solid ${dark ? '#333' : '#ddd'};color:${dark ? '#b8bcc4' : '#555'}}`;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; media-src https:"><base href="${esc(t.url)}" target="_blank"><style>${css}</style></head>
      <body><main><h1>${esc(a.title || t.title)}</h1><div class="by">${esc([a.byline, a.siteName || hostOf(t.url)].filter(Boolean).join(' · '))}</div>${a.content}</main></body></html>`;
    o.className = 'view-overlay reader';
    o.innerHTML = `<div class="reader-bar"><b>${ic('reader', 15)} Reader view</b><span class="spacer"></span>
      <button class="icon-btn sm" data-r="-" title="Smaller text">A−</button><button class="icon-btn sm" data-r="+" title="Larger text">A+</button>
      <button class="btn sm" data-r="x">Close</button></div><iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`;
    $('iframe', o).srcdoc = doc;
    o.hidden = false;
    $$('[data-r]', o).forEach(b => b.onclick = () => {
      if (b.dataset.r === 'x') { o.hidden = true; o.classList.remove('reader'); o.innerHTML = ''; return; }
      localStorage.setItem('vantage-reader-size', Math.max(14, Math.min(28, size + (b.dataset.r === '+' ? 2 : -2))));
      o.hidden = true; o.classList.remove('reader'); readerView();
    });
  }

  /* ---------------- menu ---------------- */
  $('#btnMenu').onclick = () => {
    const r = $('#btnMenu').getBoundingClientRect();
    const t = active();
    popMenu(r.right - 250, r.bottom + 6, [
      { label: 'New Tab', icon: 'plus', hint: '⌘T', onClick: () => V.openTab() },
      { label: 'New Window', icon: 'window', hint: '⌘N', onClick: () => vantage.newWindow({}) },
      { label: 'New Private Window', icon: 'mask', hint: '⇧⌘N', onClick: () => vantage.newWindow({ isPrivate: true }) },
      '-',
      { label: 'History', icon: 'clock', hint: '⌘Y', onClick: () => V.openInternal('history') },
      { label: 'Bookmarks', icon: 'star', hint: '⌥⌘B', onClick: () => V.openInternal('bookmarks') },
      { label: 'Downloads', icon: 'download', hint: '⇧⌘J', onClick: () => V.openInternal('downloads') },
      { label: 'Library', icon: 'library', hint: '⇧⌘L', onClick: () => V.openInternal('library') },
      { label: 'Passwords', icon: 'key', hint: '⌥⌘K', onClick: () => V.openInternal('vault') },
      '-',
      { label: 'Save to Read Later', icon: 'readLater', hint: '⇧⌘D', onClick: () => readLater(), disabled: !isWeb(t) },
      { label: 'Mini Player', icon: 'miniPlayer', hint: '⌥⌘M', onClick: () => V.popOutMini?.(t), disabled: !t?.wv },
      '-',
      { html: `<div class="zoom-row"><span>Zoom</span><span class="spacer"></span><button class="icon-btn sm" data-z="-1">${ic('minus', 14)}</button><b>${Math.round((t?.zoom || 1) * 100)}%</b><button class="icon-btn sm" data-z="1">${ic('plus', 14)}</button><button class="icon-btn sm" data-z="fs" title="Focus mode">${ic('maximize', 14)}</button></div>`,
        mount: (m) => $$('[data-z]', m).forEach(b => b.onclick = () => { if (b.dataset.z === 'fs') { $('#menuRoot').innerHTML = ''; toggleFocusMode(); } else { V.zoom(+b.dataset.z); setTimeout(() => { const z = b.parentElement.querySelector('b'); if (z) z.textContent = Math.round((active()?.zoom || 1) * 100) + '%'; }, 120); } }) },
      { label: 'Find in Page…', icon: 'search', hint: '⌘F', onClick: openFind, disabled: !t?.wv },
      { label: 'Reader View', icon: 'reader', hint: '⌥⌘R', onClick: readerView, disabled: !t?.wv },
      { label: 'Take Screenshot', icon: 'camera', hint: '⇧⌘2', onClick: () => screenshot(), disabled: !t?.wcId },
      { label: 'Print…', icon: 'printer', hint: '⌘P', onClick: () => t?.wv?.print(), disabled: !t?.wv },
      '-',
      { label: 'Command Palette', icon: 'command', hint: '⌘K', onClick: () => palette() },
      { label: 'Clear Browsing Data…', icon: 'trash', onClick: () => V.clearDataModal?.() },
      { label: 'Settings', icon: 'settings', hint: '⌘,', onClick: () => V.openInternal('settings') }
    ]);
  };
  async function screenshot(copy = false) {
    const t = active();
    if (!t?.wcId) return;
    const r = await vantage.page.screenshot({ wcId: t.wcId, copy });
    if (r?.copied) toast('Screenshot copied');
    else if (r?.path) toast('Screenshot saved to Downloads', '', { label: 'Show', onClick: () => vantage.downloads.openFolder() });
  }

  /* ---------------- command palette ---------------- */
  function palette(mode) {
    const actions = [
      ['New tab', 'plus', () => V.openTab()], ['New private window', 'mask', () => vantage.newWindow({ isPrivate: true })],
      ['Reopen closed tab', 'refresh', () => V.reopenClosed()], ['Split: two side by side', 'layoutCols2', () => V.setLayout('cols2')],
      ['Split: grid of four', 'layoutGrid4', () => V.setLayout('grid4')], ['Split: one big and two', 'layoutMain3', () => V.setLayout('main3')],
      ['One page', 'layout1', () => V.setLayout('one')], ['Focus mode', 'maximize', () => toggleFocusMode()],
      ['Turn VPN on/off', 'vpn', toggleVpn], ['Reader view', 'reader', readerView], ['Take screenshot', 'camera', () => screenshot()],
      ['Copy screenshot', 'camera', () => screenshot(true)], ['History', 'clock', () => V.openInternal('history')], ['Bookmarks', 'star', () => V.openInternal('bookmarks')],
      ['Downloads', 'download', () => V.openInternal('downloads')], ['Library', 'library', () => V.openInternal('library')], ['Passwords', 'key', () => V.openInternal('vault')],
      ['Settings', 'settings', () => V.openInternal('settings')], ['Clear browsing data', 'trash', () => V.clearDataModal?.()],
      ['Toggle bookmarks bar', 'star', () => cmd('toggle-bookmarks-bar')], ['Tabs on the side', 'panel', () => cmd('toggle-side-tabs')],
      ['Minimize this tab to its icon', 'minus', () => { const t = active(); if (t) V.toggleCollapse(t, true); }], ['Expand all tabs', 'expand', () => { V.tabs.forEach(x => { x.collapsed = false; }); V.renderTabs(); V.persist(); }],
      ['Save to Read Later', 'readLater', () => readLater()], ['Mini player', 'miniPlayer', () => V.popOutMini?.(active())],
      ['Customize New Tab', 'customize', () => cmd('customize-newtab')], ['Sign-in help', 'key', () => signinHelp()],
      ['Open in Vantage Player…', 'play', () => cmd('open-player')], ['Open in Vantage Reader…', 'book', () => cmd('open-reader')]
    ];
    openModal({
      title: mode === 'tabs' ? 'Search tabs' : 'Go anywhere', icon: 'command', wide: true,
      body: `<input class="input lg" id="palQ" placeholder="${mode === 'tabs' ? 'Search open tabs' : 'Tabs, bookmarks, history, actions…'}" autocomplete="off" spellcheck="false"><div class="pal-list" id="palL"></div>`,
      actions: [],
      onMount: (m, close) => {
        const q = $('#palQ', m), list = $('#palL', m);
        let rows = [], sel = 0;
        const render = async () => {
          const s = q.value.trim().toLowerCase();
          const match = (x) => !s || String(x).toLowerCase().includes(s);
          rows = [];
          for (const t of V.tabs) if (match(t.title) || match(t.url)) rows.push({ k: 'Tab', title: t.title || t.url, sub: hostOf(t.url), fav: t, run: () => V.showTab(t.id) });
          if (mode !== 'tabs') {
            for (const [title, icon, run] of actions) if (match(title)) rows.push({ k: 'Action', title, icon, run });
            for (const b of V.bookmarks) if (s && (match(b.title) || match(b.url))) rows.push({ k: 'Bookmark', title: b.title || b.url, sub: hostOf(b.url), icon: 'star', run: () => V.navigate(b.url) });
            if (s) { const h = await vantage.history.frecent({ q: s, limit: 6 }); for (const x of h) rows.push({ k: 'History', title: x.title || x.url, sub: hostOf(x.url), icon: 'clock', run: () => V.navigate(x.url) }); }
            if (s) rows.push({ k: 'Search', title: q.value.trim(), icon: 'search', run: () => V.openTab(q.value.trim()) });
          }
          rows = rows.slice(0, 40); sel = 0; draw();
        };
        const draw = () => {
          list.innerHTML = rows.map((r, i) => `<button class="pal-row ${i === sel ? 'on' : ''}" data-i="${i}">${r.fav ? faviconHTML(r.fav, 16) : ic(r.icon || 'globe', 16)}<span class="pt">${esc(r.title)}</span><span class="ps">${esc(r.sub || '')}</span><span class="pk">${r.k}</span></button>`).join('') || '<div class="pop-empty"><span>No matches</span></div>';
          $$('.pal-row', list).forEach(b => b.onclick = () => { close(); rows[+b.dataset.i].run(); });
          $('.pal-row.on', list)?.scrollIntoView({ block: 'nearest' });
        };
        q.oninput = render;
        q.onkeydown = (e) => {
          if (e.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); draw(); e.preventDefault(); }
          if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
          if (e.key === 'Enter' && rows[sel]) { close(); rows[sel].run(); }
        };
        render();
      }
    });
  }

  /* ---------------- read later ---------------- */
  async function readLater(t = active()) {
    if (!isWeb(t) || !/^https?:/.test(t.url)) return toast('Open a web page to save it for later', 'error');
    await vantage.readLater.add({ url: t.url, title: t.title });
    toast('Saved to Read Later — it’s on your New Tab page', '', { label: 'Undo', onClick: () => vantage.readLater.remove(t.url) });
  }

  /* ---------------- Google sign-in blocked: try another browser identity (from Relay) ---------------- */
  const MODE_NAME = { auto: 'Automatic', firefox: 'Firefox', safari: 'Safari', edge: 'Edge', chrome: 'Chrome' };
  let lastBlock = 0;
  V.onSigninBlocked = async (t) => {
    if (!t?.wcId || Date.now() - lastBlock < 4000) return;
    lastBlock = Date.now();
    const r = await vantage.signin.blocked(t.wcId);
    if (r.next) {
      V.infobar(t, { id: 'signin', icon: 'key', cls: 'accent', keep: true, html: `Google turned that sign-in away. Trying again as <b>${MODE_NAME[r.next]}</b>…`, actions: [{ label: 'Sign-in help', cls: 'ghost', onClick: () => { signinHelp(t); } }] });
      setTimeout(() => V.dropInfobar(t, 'signin'), 9000);
    } else signinHelp(t, true);
  };
  function signinHelp(t = active(), blocked = false) {
    let pick = V.settings.signinMode || 'auto';
    const modes = [['auto', 'Automatic', 'Firefox on Google’s sign-in page, Edge on Microsoft’s'], ['safari', 'Safari', 'Looks like Safari on a Mac'], ['firefox', 'Firefox', 'Looks like Firefox'], ['edge', 'Edge', 'Best for Microsoft accounts'], ['chrome', 'Chrome', 'Looks like Google Chrome']];
    openModal({
      title: blocked ? 'Sign-in was blocked' : 'Sign-in trouble?', icon: 'key',
      subtitle: 'Google and Microsoft sometimes refuse sign-in from browsers they don’t recognize. Vantage can present itself as another browser on their sign-in pages only.',
      body: `<div class="mode-list" id="modeList">${modes.map(([v, l, d]) => `<button data-v="${v}" class="${v === pick ? 'active' : ''}"><span class="radio"></span><span><b>${l}</b><small>${d}</small></span></button>`).join('')}</div>
        <div class="tip">${ic('sparkles', 15)}<span>If Google asks for a passkey or security key, choose <b>“Try another way”</b> and use your password or phone prompt instead.</span></div>`,
      actions: [{ label: 'Cancel' },
        { label: 'Start over', onClick: async () => { await vantage.signin.set({ mode: pick, wcId: t?.wcId, restart: true }); toast('Starting the sign-in again'); } },
        { label: 'Use this', cls: 'brand', onClick: async () => { await vantage.signin.set({ mode: pick, wcId: t?.wcId, restart: /accounts\.google\.com/.test(t?.url || '') }); toast(`Sign-in pages now see ${MODE_NAME[pick]}`); } }],
      onMount: (m) => $$('#modeList button', m).forEach(b => b.onclick = () => { pick = b.dataset.v; $$('#modeList button', m).forEach(x => x.classList.toggle('active', x === b)); })
    });
  }
  V.signinHelp = signinHelp;

  /* ---------------- keyboard & menu commands ---------------- */
  function cmd(name, arg) {
    const t = active();
    switch (name) {
      case 'new-tab': return V.openTab();
      case 'reopen-tab': return V.reopenClosed();
      case 'close-tab': return t && V.closeTab(t.id);
      case 'focus-omnibox': if (V.focusMode) document.body.classList.add('reveal'); return focusOmni();
      case 'reload': if (t?.wv) t.wv.reload(); else if (t) { t.mounted = null; V.mount(t); } return;
      case 'hard-reload': return t?.wv?.reloadIgnoringCache();
      case 'stop': if (t?.loading) t.wv?.stop(); return;
      case 'back': return t?.wv?.canGoBack() && t.wv.goBack();
      case 'forward': return t?.wv?.canGoForward() && t.wv.goForward();
      case 'home': return V.navigate('vantage://newtab');
      case 'find': return openFind();
      case 'find-next': return V.find ? runFind(false, true) : openFind();
      case 'find-prev': return V.find ? runFind(false, false) : openFind();
      case 'palette': return palette(arg);
      case 'layout': return V.setLayout(arg);
      case 'pane': return V.setFocus((V.focus + arg + V.panes.length) % V.panes.length);
      case 'swap-panes': return V.swapPanes();
      case 'even-panes': return V.evenOut();
      case 'focus-mode': return toggleFocusMode();
      case 'reader-view': return readerView();
      case 'toggle-dark': if (isWeb(t)) V.siteInfo(hostOf(t.url)).then(s => V.setSite(t, { dark: s.dark ? null : true })); return;
      case 'toggle-bookmarks-bar': return setSetting({ bookmarksBar: V.settings.bookmarksBar === false });
      case 'toggle-side-tabs': return setSetting({ tabsOnSide: !V.settings.tabsOnSide });
      case 'zoom': return V.zoom(arg);
      case 'devtools': return t?.wcId && vantage.page.devtools(t.wcId);
      case 'view-source': return isWeb(t) && V.openTab('view-source:' + t.url);
      case 'open-internal': return V.openInternal(arg);
      case 'clear-data': return V.clearDataModal?.();
      case 'bookmark': return toggleBookmark();
      case 'open-player': return relay.media.pick('player').then(f => f.length && window.Player?.open(f.map(p => ({ src: p, title: p.split(/[\\/]/).pop() }))));
      case 'open-reader': return relay.media.pick('reader').then(f => f[0] && window.Reader?.open(f[0]));
      case 'toggle-vpn': return toggleVpn();
      case 'toggle-adblock-site': if (isWeb(t)) $('#omniShield').click(); return;
      case 'mute': return V.toggleMute(t);
      case 'pip': return t?.wv?.executeJavaScript(`(() => { const v = [...document.querySelectorAll('video')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0]; if (!v) return false; if (document.pictureInPictureElement) document.exitPictureInPicture(); else v.requestPictureInPicture(); return true; })()`, true).then(ok => { if (!ok) toast('No video on this page', 'error'); }).catch(() => {});
      case 'tab-step': return V.stepTab(arg);
      case 'tab-index': { const x = arg < 0 ? V.tabs[V.tabs.length - 1] : V.tabs[arg]; return x && V.showTab(x.id); }
      case 'duplicate-tab': return t && V.duplicate(t);
      case 'pin-tab': return t && V.togglePin(t);
      case 'save-page': return t?.wcId && vantage.page.save(arg?.wcId || t.wcId);
      case 'print': return t?.wv?.print();
      case 'screenshot': return screenshot();
      case 'open-in-split': return V.openInSplit(arg.url);
      case 'read-later': return readLater(arg?.wcId != null ? (tabByWc(arg.wcId) || t) : t);
      case 'mini-player': return V.popOutMini?.(arg?.wcId != null ? (tabByWc(arg.wcId) || t) : t);
      case 'customize-newtab': { const nt = V.tabs.find(x => x.kind === 'internal' && x.page === 'newtab'); if (nt) V.showTab(nt.id); else V.openTab(); setTimeout(() => V.customizeNewTab?.(), 80); return; }
    }
  }
  vantage.onCmd((name, arg) => {
    // commands from a page's right-click menu act on that page's tab
    if (arg && arg.wcId != null && ['reader-view', 'save-page', 'screenshot', 'read-later'].includes(name)) { const t = tabByWc(arg.wcId); if (t && V.panes.includes(t.id)) V.setFocus(V.panes.indexOf(t.id)); }
    cmd(name, arg);
  });
  vantage.onOpenTab(({ url, background, fromWcId, container }) => V.openTab(url, { background, fromWcId, container }));
  async function setSetting(patch) { V.settings = await vantage.settings.set(patch); }
  vantage.settings.onChanged((s) => { V.settings = s; V.applySettings?.(); });

  Object.assign(V, { readLater, updateToolbar, updateShield, focusOmni, hideSuggest, renderBookmarksBar, openFind, readerView, palette, toggleFocusMode, toggleVpn, loadDownloads, updateDlButton, renderVpnPill, setSetting, cmd, genPassword });
})();

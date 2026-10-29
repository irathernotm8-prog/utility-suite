/* Vantage — New Tab: a dashboard you can shape. Clock and weather, a search box that can also search
   YouTube, Wikipedia, Reddit and more, your shortcuts with real site icons (or ones you pick), "Jump back in"
   with page previews, Read Later, a privacy summary, and a notepad. Backgrounds: aurora, picture of the day,
   your own picture, or plain. Everything is switched on and off from Customize. */
(() => {
  const NT = () => ({ widgets: {}, ...(V.settings.newtab || {}) });
  const W = (k) => NT().widgets?.[k] !== false;
  const MODES = [
    ['web', null, 'search', (q) => V.toURL(q)],
    ['youtube', 'YouTube', 'play', (q) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q)],
    ['images', 'Images', 'image', (q) => 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q)],
    ['maps', 'Maps', 'mapPin', (q) => 'https://www.google.com/maps/search/' + encodeURIComponent(q)],
    ['wiki', 'Wikipedia', 'book', (q) => 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(q)],
    ['reddit', 'Reddit', 'chat', (q) => 'https://www.reddit.com/search/?q=' + encodeURIComponent(q)],
    ['github', 'GitHub', 'code', (q) => 'https://github.com/search?q=' + encodeURIComponent(q)]
  ];
  const ACCENTS = [['ocean', '#3fa9f5', 'Ocean'], ['teal', '#14c4ad', 'Teal'], ['violet', '#8b6dff', 'Violet'], ['rose', '#ff5f8f', 'Rose'], ['amber', '#ffa526', 'Amber'], ['lime', '#3fc46a', 'Lime'], ['graphite', '#7b8796', 'Graphite']];
  V.ACCENTS = ACCENTS;
  const WEATHER = { 0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅️', 'Partly cloudy'], 3: ['☁️', 'Cloudy'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Drizzle'], 61: ['🌧️', 'Rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'], 71: ['🌨️', 'Snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow'], 80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['🌨️', 'Snow showers'], 95: ['⛈️', 'Thunderstorms'], 96: ['⛈️', 'Thunderstorms'], 99: ['⛈️', 'Thunderstorms'] };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`; const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d} days ago`; };
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
  const setNT = async (patch) => { V.settings = await vantage.settings.set({ newtab: patch }); };

  V.renderNewTab = async (t, body) => {
    const nt = NT();
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const eng = (V.ENGINES[V.settings.searchEngine] || V.ENGINES.google).label;
    t.ntMode = t.ntMode || 'web';
    if (V.isPrivate) {
      body.innerHTML = `<div class="nt private bg-plain"><div class="nt-bg"><div class="aur a1"></div><div class="aur a2"></div></div><div class="nt-inner center">
        <div class="nt-priv">${ic('mask', 38)}<h1>Private window</h1><p>Pages you open here aren’t saved to history, and cookies and site data are erased when you close the last private window. Downloads and bookmarks you make are kept.</p></div>
        <form class="nt-search" id="ntSearch">${ic('search', 19)}<input id="ntQ" placeholder="Search ${esc(eng)} or type an address" autocomplete="off" spellcheck="false"></form></div></div>`;
      $('#ntSearch', body).onsubmit = (e) => { e.preventDefault(); const q = $('#ntQ', body).value.trim(); if (q) V.navigate(q, t); };
      return;
    }
    const bg = nt.bg || 'aurora';
    const photo = (bg === 'daily' || (bg === 'image' && nt.image));
    body.innerHTML = `<div class="nt bg-${bg} ${photo ? 'photo' : ''}">
      <div class="nt-bg">${bg === 'aurora' ? '<div class="aur a1"></div><div class="aur a2"></div><div class="aur a3"></div>' : ''}${bg === 'image' && nt.image ? `<img class="nt-wall" src="${esc(nt.image)}" alt="">` : ''}</div>
      <div class="nt-scrim"></div>
      <div class="nt-inner">
        <header class="nt-top">
          ${W('clock') ? `<div class="nt-time"><div class="nt-clock" id="ntClock"></div><div class="nt-date"><span id="ntDate"></span> · ${greet}</div></div>` : '<div></div>'}
          ${W('weather') ? `<button class="nt-weather glass" id="ntWeather" title="Weather — change the place in Customize"><span class="muted-sm">Weather…</span></button>` : ''}
        </header>
        <section class="nt-hero">
          <form class="nt-search" id="ntSearch"><span class="nt-mode-ic" id="ntModeIc">${ic('search', 19)}</span><input id="ntQ" autocomplete="off" spellcheck="false"><kbd class="nt-kbd">Tab ⇥</kbd></form>
          <div class="nt-modes" id="ntModes">${MODES.map(([k, l, i]) => `<button data-m="${k}" class="${t.ntMode === k ? 'on' : ''}">${ic(i, 13)}<span>${esc(l || eng)}</span></button>`).join('')}</div>
        </section>
        ${W('shortcuts') ? `<section class="nt-dial" id="ntDial"></section>` : ''}
        <section class="nt-widgets" id="ntWidgets">
          ${W('jump') ? `<div class="nt-card glass jump" id="ntJump"><div class="nc-h">${ic('clock', 15)}<b>Jump back in</b><span class="spacer"></span><button class="nc-link" data-go="history">History</button></div><div class="jump-row" id="ntJumpRow"></div></div>` : ''}
          ${W('readLater') ? `<div class="nt-card glass later" id="ntLater"><div class="nc-h">${ic('readLater', 15)}<b>Read later</b><span class="nc-n" id="ntLaterN"></span></div><div class="later-list" id="ntLaterList"></div></div>` : ''}
          ${W('privacy') ? `<div class="nt-card glass privacy" id="ntPriv"><div class="nc-h">${ic('shieldCheck', 15)}<b>Privacy</b><span class="spacer"></span><button class="nc-link" data-go="settings:privacy">Settings</button></div><div id="ntPrivBody"></div></div>` : ''}
          ${W('notes') ? `<div class="nt-card glass notes" id="ntNotes"><div class="nc-h">${ic('note', 15)}<b>Notes</b><span class="spacer"></span><span class="muted-sm" id="ntNoteSaved"></span></div><textarea id="ntNote" spellcheck="true" placeholder="Jot something down. It’s saved as you type and shows on every New Tab."></textarea></div>` : ''}
        </section>
        <footer class="nt-foot"><span class="nt-credit" id="ntCredit"></span><span class="spacer"></span><button class="nt-cust glass" id="ntCust">${ic('customize', 15)} Customize</button></footer>
      </div>
      <aside class="nt-drawer" id="ntDrawer" ${t.ntDrawer ? '' : 'hidden'}></aside>
    </div>`;
    const root = $('.nt', body);
    $$('[data-go]', body).forEach(b => b.onclick = () => V.openInternal(b.dataset.go));

    /* clock */
    const clock = $('#ntClock', body);
    if (clock) {
      const tick = () => {
        if (!clock.isConnected) return clearInterval(iv);
        const d = new Date();
        clock.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !nt.clock24 }).replace(/\s?[AP]M$/i, '');
        $('#ntDate', body).textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      };
      const iv = setInterval(tick, 5000); tick();
    }

    /* search with modes */
    const q = $('#ntQ', body);
    const setMode = (m) => {
      t.ntMode = m;
      const [, l, i] = MODES.find(x => x[0] === m) || MODES[0];
      q.placeholder = m === 'web' ? `Search ${eng} or type an address` : `Search ${l}`;
      $('#ntModeIc', body).innerHTML = ic(i, 19);
      $$('#ntModes button', body).forEach(b => b.classList.toggle('on', b.dataset.m === m));
    };
    setMode(t.ntMode);
    $$('#ntModes button', body).forEach(b => b.onclick = () => { setMode(b.dataset.m); q.focus(); });
    q.onkeydown = (e) => {
      if (e.key === 'Tab' && !e.altKey && !e.metaKey) { e.preventDefault(); const i = MODES.findIndex(x => x[0] === t.ntMode); setMode(MODES[(i + (e.shiftKey ? MODES.length - 1 : 1)) % MODES.length][0]); }
    };
    $('#ntSearch', body).onsubmit = (e) => {
      e.preventDefault();
      const v = q.value.trim(); if (!v) return;
      const mode = MODES.find(x => x[0] === t.ntMode) || MODES[0];
      V.navigate(mode[3](v), t);
    };

    /* background: picture of the day */
    if (bg === 'daily') {
      vantage.newtab.daily().then((d) => {
        if (!d || !root.isConnected) return;
        const img = new Image(); img.className = 'nt-wall'; img.alt = '';
        img.onload = () => { $('.nt-bg', root).appendChild(img); requestAnimationFrame(() => img.classList.add('in')); };
        img.src = d.url;
        const c = $('#ntCredit', body); if (c && d.credit) { c.textContent = d.credit; c.title = 'Bing picture of the day'; }
      }).catch(() => {});
    }

    if (W('weather')) loadWeather(body).catch(() => { const el = $('#ntWeather', body); if (el) { el.innerHTML = `<span class="nw-emo">🌡️</span><span class="nw-m"><span>Weather unavailable</span><span class="nw-hl">Set a city in Customize</span></span>`; el.onclick = () => V.customizeNewTab(); } });
    if (W('shortcuts')) renderDial(t, body);
    if (W('jump')) renderJump(t, body);
    if (W('readLater')) renderLater(body);
    if (W('privacy')) renderPrivacy(body);
    if (W('notes')) {
      const ta = $('#ntNote', body);
      ta.value = await vantage.notes.get().catch(() => '');
      let tm;
      ta.oninput = () => { clearTimeout(tm); $('#ntNoteSaved', body).textContent = ''; tm = setTimeout(async () => { await vantage.notes.set(ta.value); const s = $('#ntNoteSaved', body); if (s) s.textContent = 'Saved'; }, 450); };
    }
    $('#ntCust', body).onclick = () => toggleDrawer(t, body);
    if (t.ntDrawer) renderDrawer(t, body);
  };

  /* ---------------- weather (Open-Meteo: free, no account) ---------------- */
  async function loadWeather(body) {
    const nt = NT();
    const key = 'vantage-weather:' + (nt.city || 'auto') + ':' + (nt.units || 'auto');
    let w = store(key);
    if (!w || Date.now() - w.t > 30 * 60000) {
      let place = null;
      if (nt.city) {
        const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(nt.city)}`)).json();
        const r = g.results?.[0];
        if (r) place = { name: r.name, cc: r.country_code, lat: r.latitude, lon: r.longitude };
      } else {
        const ip = store('vantage-ip-place');
        if (ip && Date.now() - ip.t < 6 * 3600000) place = ip.place;
        else {
          const r = await (await fetch('https://ipwho.is/')).json();
          if (r.success !== false && r.latitude != null) { place = { name: r.city, cc: r.country_code, lat: r.latitude, lon: r.longitude }; store('vantage-ip-place', { t: Date.now(), place }); }
        }
      }
      if (!place) throw new Error('no place');
      const f = nt.units === 'f' || (nt.units !== 'c' && ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW'].includes(place.cc));
      const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1${f ? '&temperature_unit=fahrenheit' : ''}`)).json();
      w = { t: Date.now(), place: place.name, temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, day: j.current.is_day, hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]), unit: f ? 'F' : 'C' };
      store(key, w);
    }
    const el = $('#ntWeather', body);
    if (!el) return;
    let [emo, label] = WEATHER[w.code] || ['🌡️', ''];
    if (!w.day && (w.code === 0 || w.code === 1)) emo = '🌙';
    el.innerHTML = `<span class="nw-emo">${emo}</span><span class="nw-m"><b>${w.temp}°</b><span>${esc(label)} · ${esc(w.place || '')}</span><span class="nw-hl">H ${w.hi}° · L ${w.lo}°</span></span>`;
    el.onclick = () => V.openTab('https://www.google.com/search?q=' + encodeURIComponent('weather ' + (w.place || '')));
  }

  /* ---------------- shortcuts ---------------- */
  async function dialItems() {
    const nt = NT();
    if (nt.shortcuts === 'custom' && Array.isArray(nt.dial)) return nt.dial.slice(0, 12);
    const top = await vantage.history.top(10).catch(() => []);
    const pinned = V.bookmarks.filter(b => (b.folder || 'Bar') === 'Bar').slice(0, 5);
    const seen = new Set();
    const out = [];
    for (const b of pinned) { const h = hostOf(b.url); if (seen.has(h)) continue; seen.add(h); out.push({ id: 'b' + b.id, url: b.url, title: b.title, iconType: b.iconType, emoji: b.emoji, glyph: b.glyph, color: b.color, letter: b.letter, image: b.image, icon: b.icon }); }
    for (const x of top) { if (seen.has(x.host) || /^(accounts|login|signin|auth)\./.test(x.host) || /login\.microsoftonline|appleid\.apple/.test(x.host)) continue; seen.add(x.host); out.push({ id: 'h' + x.host, url: x.url, title: x.title || x.host }); }
    return out.slice(0, 7);
  }
  const shortName = (x) => { const t = (x.title || '').split(/\s[-–|·:]\s/)[0].trim(); return (t && t.length <= 24 ? t : hostOf(x.url).replace(/\.(com|org|net|io|co|tv|app)$/i, '')) || hostOf(x.url); };
  async function renderDial(t, body) {
    const el = $('#ntDial', body);
    if (!el) return;
    const items = await dialItems();
    const custom = NT().shortcuts === 'custom';
    el.innerHTML = items.map((x, i) => `<a class="nt-tile" data-i="${i}" title="${esc(x.title || '')}\n${esc(x.url)}" draggable="${custom}">
        <span class="nt-ic glass" data-ic="${i}" style="--c:${esc(x.color || tileColor(hostOf(x.url)))}">${bmIconHTML(x, 30)}</span><span class="nt-tl">${esc(shortName(x))}</span>
        <button class="nt-tile-more" data-more="${i}" title="Edit">${ic('dots', 13)}</button></a>`).join('')
      + (items.length < 12 ? `<button class="nt-tile add" id="ntAdd"><span class="nt-ic glass">${ic('plus', 22)}</span><span class="nt-tl">Add</span></button>` : '');
    // real site icons for anything that hasn't got one yet
    items.forEach((x, i) => {
      if (x.iconType || x.icon) return;
      vantage.favicon.get(x.url).then((d) => { if (!d) return; const s = $(`[data-ic="${i}"]`, el); if (s) s.innerHTML = bmIconHTML({ ...x, icon: d }, 30); }).catch(() => {});
    });
    const toCustom = async (list) => { await setNT({ shortcuts: 'custom', dial: list.map(({ id, url, title, iconType, emoji, glyph, color, letter, image, icon }) => ({ id: id || uid(), url, title, iconType, emoji, glyph, color, letter, image, icon: icon && icon.length < 200000 ? icon : undefined })) }); renderDial(t, body); };
    $$('.nt-tile[data-i]', el).forEach(a => {
      const x = items[+a.dataset.i];
      a.onclick = (e) => { if (e.target.closest('[data-more]')) return; e.metaKey || e.ctrlKey ? V.openTab(x.url, { background: true }) : V.navigate(x.url, t); };
      a.onauxclick = (e) => { if (e.button === 1) V.openTab(x.url, { background: true }); };
      const menu = (e) => {
        e.preventDefault(); e.stopPropagation();
        popMenu(e.clientX, e.clientY, [
          { label: 'Open in New Tab', icon: 'plus', onClick: () => V.openTab(x.url, { background: true }) },
          { label: 'Open in Split View', icon: 'split', onClick: () => V.openInSplit(x.url) },
          '-',
          { label: 'Edit…', icon: 'edit', onClick: () => editTile(x, async (patch) => { const list = items.map(y => (y === x ? { ...y, ...patch } : y)); await toCustom(list); }) },
          { label: 'Change Icon…', icon: 'palette', onClick: () => V.iconPicker(x, async (patch) => { const list = items.map(y => (y === x ? { ...y, ...patch, icon: patch.icon === null ? undefined : (patch.icon || y.icon) } : y)); await toCustom(list); }) },
          { label: 'Remove', icon: 'trash', danger: true, onClick: async () => { await toCustom(items.filter(y => y !== x)); } }
        ]);
      };
      a.oncontextmenu = menu;
      $('[data-more]', a).onclick = menu;
      if (custom) {
        a.ondragstart = (e) => { e.dataTransfer.setData('vantage/dial', a.dataset.i); };
        a.ondragover = (e) => { if ([...e.dataTransfer.types].includes('vantage/dial')) { e.preventDefault(); a.classList.add('drop'); } };
        a.ondragleave = () => a.classList.remove('drop');
        a.ondrop = async (e) => { e.preventDefault(); a.classList.remove('drop'); const from = +e.dataTransfer.getData('vantage/dial'), to = +a.dataset.i; if (from === to) return; const list = items.slice(); const [m] = list.splice(from, 1); list.splice(to, 0, m); await toCustom(list); };
      }
    });
    $('#ntAdd', el)?.addEventListener('click', () => editTile({ url: '', title: '' }, async (patch) => {
      const url = V.toURL(patch.url); if (!url) return;
      await toCustom([...items, { id: uid(), url, title: patch.title || hostOf(url) }]);
    }, true));
  }
  function editTile(x, onSave, isNew = false) {
    openModal({
      title: isNew ? 'Add a shortcut' : 'Edit shortcut', icon: 'star',
      body: `<div class="field"><label>Name</label><input class="input" id="dtT" value="${esc(x.title || '')}" placeholder="e.g. Football Hub"></div>
        <div class="field"><label>Address</label><input class="input" id="dtU" value="${esc(x.url || '')}" placeholder="example.com"></div>`,
      actions: [{ label: 'Cancel' }, { label: isNew ? 'Add' : 'Save', cls: 'brand', onClick: async (m) => {
        const u = $('#dtU', m).value.trim(); if (!u) { toast('Add an address', 'error'); return false; }
        await onSave({ title: $('#dtT', m).value.trim(), url: V.toURL(u) });
      } }]
    });
  }

  /* ---------------- jump back in ---------------- */
  async function renderJump(t, body) {
    const row = $('#ntJumpRow', body);
    if (!row) return;
    const open = new Set(V.tabs.map(x => x.url));
    const seen = new Set();
    const items = [];
    for (const c of [...V.closed].reverse()) { if (!/^https?:/.test(c.url) || seen.has(c.url) || open.has(c.url)) continue; seen.add(c.url); items.push({ url: c.url, title: c.title, when: 'Closed recently', closed: true }); if (items.length >= 3) break; }
    const hist = await vantage.history.search({ q: '', limit: 120 }).catch(() => []);
    const byHost = new Map();
    for (const h of hist) {
      const key = h.url.replace(/#.*$/, '');
      if (seen.has(key) || open.has(h.url) || /\/search\?|google\.[a-z.]+\/(search|url)|accounts\.google|\/signin|\/login/i.test(h.url)) continue;
      const host = hostOf(h.url);
      if ((byHost.get(host) || 0) >= 2) continue;
      byHost.set(host, (byHost.get(host) || 0) + 1);
      seen.add(key);
      items.push({ url: h.url, title: h.title, when: ago(h.t) });
      if (items.length >= 10) break;
    }
    if (!items.length) { row.innerHTML = `<div class="nc-empty">Pages you visit show up here with a preview, so you can pick up where you left off.</div>`; return; }
    const thumbs = await vantage.thumbs.get(items.map(x => x.url)).catch(() => ({}));
    row.innerHTML = items.map((x, i) => `<a class="jump-card" data-i="${i}" title="${esc(x.title || x.url)}">
        <span class="jc-shot" style="--c:${tileColor(hostOf(x.url))}">${thumbs[x.url] ? `<img src="${thumbs[x.url]}" alt="" draggable="false">` : `<span class="jc-big" data-ic="${i}">${bmIconHTML({ url: x.url, title: x.title }, 34)}</span>`}</span>
        <span class="jc-m"><span class="jc-t">${bmIconHTML({ url: x.url, title: x.title, icon: '' }, 14)}<b>${esc(x.title || hostOf(x.url))}</b></span><span class="jc-s">${esc(hostOf(x.url))} · ${esc(x.when)}</span></span></a>`).join('');
    items.forEach((x, i) => {
      vantage.favicon.get(x.url).then((d) => {
        if (!d) return;
        const card = $(`.jump-card[data-i="${i}"]`, row); if (!card) return;
        const small = $('.jc-t .fav', card); if (small) small.outerHTML = bmIconHTML({ url: x.url, icon: d }, 14);
        const big = $(`[data-ic="${i}"]`, card); if (big) big.innerHTML = bmIconHTML({ url: x.url, icon: d }, 34);
      }).catch(() => {});
    });
    $$('.jump-card', row).forEach(a => {
      const x = items[+a.dataset.i];
      a.onclick = (e) => (e.metaKey || e.ctrlKey ? V.openTab(x.url, { background: true }) : V.navigate(x.url, t));
      a.onauxclick = (e) => { if (e.button === 1) V.openTab(x.url, { background: true }); };
    });
  }

  /* ---------------- read later ---------------- */
  async function renderLater(body) {
    const el = $('#ntLaterList', body);
    if (!el) return;
    const list = await vantage.readLater.list().catch(() => []);
    $('#ntLaterN', body).textContent = list.length ? list.length : '';
    el.innerHTML = list.slice(0, 6).map((x, i) => `<div class="later-row" data-i="${i}">${bmIconHTML({ url: x.url, title: x.title }, 18)}<span class="lr-m"><b>${esc(x.title || x.url)}</b><span>${esc(hostOf(x.url))} · ${esc(ago(x.at))}</span></span><button class="icon-btn sm" data-done title="Done — remove">${ic('check', 14)}</button></div>`).join('')
      + (list.length > 6 ? `<div class="muted-sm later-more">${list.length - 6} more</div>` : '')
      || `<div class="nc-empty">Save pages for later with <kbd>⇧⌘D</kbd> or the ⋯ menu. They wait here.</div>`;
    $$('.later-row', el).forEach(r => {
      const x = list[+r.dataset.i];
      vantage.favicon.get(x.url).then((d) => { const f = $('.fav', r); if (d && f) f.outerHTML = bmIconHTML({ url: x.url, icon: d }, 18); }).catch(() => {});
      r.onclick = (e) => { if (e.target.closest('[data-done]')) return; V.openTab(x.url, { background: e.metaKey || e.ctrlKey }); };
      $('[data-done]', r).onclick = async (e) => { e.stopPropagation(); r.classList.add('gone'); await vantage.readLater.remove(x.url); };
    });
  }
  vantage.readLater.onChanged(() => { for (const t of V.tabs) if (t.kind === 'internal' && t.page === 'newtab' && t.view) { const b = t.view.querySelector('.view-body'); if (b && $('#ntLaterList', b)) renderLater(b); } });
  vantage.notes.onChanged((text) => { for (const t of V.tabs) if (t.kind === 'internal' && t.page === 'newtab' && t.view) { const ta = t.view.querySelector('#ntNote'); if (ta && document.activeElement !== ta) ta.value = text; } });

  /* ---------------- privacy ---------------- */
  async function renderPrivacy(body) {
    const el = $('#ntPrivBody', body);
    if (!el) return;
    const st = await vantage.adblock.status().catch(() => ({}));
    const week = st.week || [];
    const max = Math.max(1, ...week.map(d => d.n));
    const weekTotal = week.reduce((a, d) => a + d.n, 0);
    const vpnOn = V.vpn?.status === 'on';
    el.innerHTML = `<div class="pv-big"><b>${(st.total || 0).toLocaleString()}</b><span>ads & trackers blocked${st.since ? ` since ${new Date(st.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</span></div>
      <div class="pv-bars" title="${weekTotal.toLocaleString()} this week">${week.map(d => `<span style="--h:${Math.max(4, Math.round(d.n / max * 100))}%" title="${new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}: ${d.n.toLocaleString()}"><i></i><em>${new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</em></span>`).join('')}</div>
      <div class="pv-row"><span class="pv-dot ${vpnOn ? 'on' : ''}"></span><span>${vpnOn ? `VPN on${V.vpn.loc ? ' · ' + esc(V.vpn.loc) : ''}` : 'VPN off'}</span><span class="spacer"></span><button class="btn sm ${vpnOn ? '' : 'brand'}" id="ntVpn">${vpnOn ? 'Turn off' : 'Turn on'}</button></div>`;
    $('#ntVpn', el).onclick = async () => { await V.toggleVpn(); setTimeout(() => renderPrivacy(body), 400); };
  }

  /* ---------------- Customize ---------------- */
  function toggleDrawer(t, body) {
    t.ntDrawer = !t.ntDrawer;
    const d = $('#ntDrawer', body);
    if (!d) return;
    d.hidden = !t.ntDrawer;
    if (t.ntDrawer) renderDrawer(t, body);
  }
  V.customizeNewTab = () => {
    const t = V.activeTab();
    if (!(t?.kind === 'internal' && t.page === 'newtab')) return;
    const body = t.view?.querySelector('.view-body');
    if (body && !t.ntDrawer) toggleDrawer(t, body);
  };
  function renderDrawer(t, body) {
    const d = $('#ntDrawer', body);
    if (!d) return;
    const nt = NT(), s = V.settings;
    const rerender = () => { t.mounted = null; V.mount(t); };
    const widgets = [['clock', 'Clock and date'], ['weather', 'Weather'], ['shortcuts', 'Shortcuts'], ['jump', 'Jump back in'], ['readLater', 'Read later'], ['privacy', 'Privacy'], ['notes', 'Notes']];
    d.innerHTML = `<div class="nd-h"><b>Customize</b><span class="spacer"></span><button class="icon-btn" id="ndX" title="Close">${ic('x', 16)}</button></div>
      <div class="nd-b">
        <div class="nd-sec"><div class="label">Background</div><div class="nd-bgs">
          ${[['aurora', 'Aurora'], ['daily', 'Picture of the day'], ['image', 'Your picture'], ['plain', 'Plain']].map(([k, l]) => `<button class="nd-bg ${nt.bg === k ? 'on' : ''} bgp-${k}" data-bg="${k}">${k === 'image' && nt.image ? `<img src="${esc(nt.image)}" alt="">` : ''}<span>${l}</span></button>`).join('')}
        </div>${nt.bg === 'image' ? `<button class="btn sm" id="ndPick">${ic('image', 14)} Choose another picture…</button>` : ''}</div>
        <div class="nd-sec"><div class="label">Accent color</div><div class="ip-sw">${ACCENTS.map(([k, c, l]) => `<button class="swatch ${s.accent === k || (!s.accent && k === 'ocean') ? 'active' : ''}" style="--c:${c}" data-acc="${k}" title="${l}"></button>`).join('')}<label class="swatch custom ${s.accent === 'custom' ? 'active' : ''}" title="Any color"><input type="color" id="ndAccC" value="${esc(s.accentCustom || '#3fa9f5')}"></label></div></div>
        <div class="nd-sec"><div class="label">Show</div>${widgets.map(([k, l]) => `<label class="switch-row"><span>${l}</span><input type="checkbox" class="switch" data-w="${k}" ${W(k) ? 'checked' : ''}></label>`).join('')}</div>
        <div class="nd-sec"><div class="label">Shortcuts</div><div class="seg wide"><button data-sc="auto" class="${nt.shortcuts !== 'custom' ? 'active' : ''}">Most visited</button><button data-sc="custom" class="${nt.shortcuts === 'custom' ? 'active' : ''}">My shortcuts</button></div>
          <p class="hint">Right-click a shortcut to rename it, give it an icon, or remove it. In My shortcuts you can drag them into any order.</p></div>
        <div class="nd-sec"><div class="label">Weather</div><div class="field"><input class="input" id="ndCity" placeholder="City (blank = where you are)" value="${esc(nt.city || '')}"></div>
          <div class="seg wide"><button data-u="auto" class="${(nt.units || 'auto') === 'auto' ? 'active' : ''}">Auto</button><button data-u="c" class="${nt.units === 'c' ? 'active' : ''}">°C</button><button data-u="f" class="${nt.units === 'f' ? 'active' : ''}">°F</button></div></div>
        <label class="switch-row"><span>24-hour clock</span><input type="checkbox" class="switch" id="ndH24" ${nt.clock24 ? 'checked' : ''}></label>
      </div>`;
    $('#ndX', d).onclick = () => toggleDrawer(t, body);
    $$('[data-bg]', d).forEach(b => b.onclick = async () => {
      if (b.dataset.bg === 'image' && !nt.image) { const u = await vantage.newtab.pickImage(); if (!u) return; V.settings = await vantage.settings.get(); return rerender(); }
      await setNT({ bg: b.dataset.bg }); rerender();
    });
    $('#ndPick', d)?.addEventListener('click', async () => { const u = await vantage.newtab.pickImage(); if (u) { V.settings = await vantage.settings.get(); rerender(); } });
    $$('[data-acc]', d).forEach(b => b.onclick = async () => { V.settings = await vantage.settings.set({ accent: b.dataset.acc }); V.applySettings(); renderDrawer(t, body); });
    $('#ndAccC', d).oninput = (e) => { document.documentElement.style.setProperty('--accent', e.target.value); };
    $('#ndAccC', d).onchange = async (e) => { V.settings = await vantage.settings.set({ accent: 'custom', accentCustom: e.target.value }); V.applySettings(); renderDrawer(t, body); };
    $$('[data-w]', d).forEach(x => x.onchange = async () => { await setNT({ widgets: { [x.dataset.w]: x.checked } }); rerender(); });
    $$('[data-sc]', d).forEach(b => b.onclick = async () => {
      if (b.dataset.sc === 'custom' && !(nt.dial || []).length) { const items = await dialItems(); await setNT({ shortcuts: 'custom', dial: items.map(x => ({ ...x, id: uid() })) }); }
      else await setNT({ shortcuts: b.dataset.sc });
      rerender();
    });
    $('#ndCity', d).onchange = async (e) => { await setNT({ city: e.target.value.trim() }); rerender(); };
    $$('[data-u]', d).forEach(b => b.onclick = async () => { await setNT({ units: b.dataset.u }); rerender(); });
    $('#ndH24', d).onchange = async (e) => { await setNT({ clock24: e.target.checked }); rerender(); };
  }
})();

// Touchline — app shell: titlebar, rail, router, live status and click handling.
(() => {
  const { esc, $ } = UI;
  const Views = (window.Views = window.Views || {});
  const app = document.getElementById('app');

  const hist = [];        // [{ name, params, scroll }]
  let pos = -1;
  let cleanup = [];
  let renderToken = 0;
  let liveCount = 0;

  /* ---------- routing ---------- */
  const parse = (s) => { const [name, ...rest] = String(s).split(':'); return { name, params: rest.map(UI.unattr) }; };

  function go(name, params = [], { replace = false, force = false } = {}) {
    if (!Views[name]) name = 'today';
    const main = $('.main');
    if (pos >= 0 && hist[pos]) hist[pos].scroll = main ? main.scrollTop : 0;
    const entry = { name, params: params.map(String), scroll: 0 };
    const cur = hist[pos];
    if (cur && cur.name === name && cur.params.join(':') === entry.params.join(':') && !force) return;
    if (replace && pos >= 0) hist[pos] = entry; else { hist.splice(pos + 1); hist.push(entry); pos = hist.length - 1; }
    show(force);
  }
  function back() { if (pos > 0) { hist[pos].scroll = $('.main').scrollTop; pos--; show(); } }
  function forward() { if (pos < hist.length - 1) { hist[pos].scroll = $('.main').scrollTop; pos++; show(); } }
  function refresh() { show(true); }

  async function show(force = false) {
    const entry = hist[pos];
    cleanup.forEach((f) => { try { f(); } catch {} }); cleanup = [];
    const token = ++renderToken;
    const main = $('.main');
    main.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'page fade-in';
    main.appendChild(page);
    updateChrome(entry);
    const view = Views[entry.name];
    const ctx = {
      force,
      alive: () => token === renderToken,
      every(ms, fn) { const t = setInterval(() => { if (token === renderToken && !document.hidden) fn(); }, ms); cleanup.push(() => clearInterval(t)); },
      onCleanup(fn) { cleanup.push(fn); },
      replaceParams(params) { entry.params = params.map(String); updateChrome(entry); },
      wide(on = true) { page.classList.toggle('wide', on); }
    };
    try {
      const done = await view.render(page, entry.params, ctx);
      if (typeof done === 'function') cleanup.push(done);
    } catch (err) {
      if (token === renderToken) { page.innerHTML = UI.error(err); }
    }
    if (token === renderToken && entry.scroll) requestAnimationFrame(() => { main.scrollTop = entry.scroll; });
  }

  /* ---------- shell ---------- */
  function shell() {
    const plat = UI.info.platform === 'darwin' ? 'mac' : UI.info.platform === 'win32' ? 'win' : 'linux';
    app.className = `app ${plat}`;
    app.innerHTML = `
      <header class="titlebar">
        <div class="brand"><img src="../../build/icon.png" alt="">Touchline</div>
        <div class="nav-arrows">
          <button class="tb-btn" id="nav-back" title="Back">${icon('chevronLeft', 18)}</button>
          <button class="tb-btn" id="nav-fwd" title="Forward">${icon('chevronRight', 18)}</button>
        </div>
        <button class="tb-search" id="open-search">${icon('search', 15)}<span>Search players, teams, competitions</span><kbd>${plat === 'mac' ? '⌘K' : 'Ctrl K'}</kbd></button>
        <div class="tb-spacer"></div>
        <button class="tb-status" id="tb-status" hidden></button>
        <button class="tb-btn" id="tb-widget" title="Live widget (${plat === 'mac' ? '⌘⇧L' : 'Ctrl+Shift+L'})">${icon('pip', 18)}</button>
        <button class="tb-btn" id="tb-refresh" title="Refresh">${icon('refresh', 17)}</button>
        <button class="tb-btn" data-go="settings" title="Settings">${icon('settings', 18)}</button>
      </header>
      <nav class="rail" id="rail"></nav>
      <main class="main"></main>`;
    $('#nav-back').onclick = back;
    $('#nav-fwd').onclick = forward;
    $('#tb-refresh').onclick = refresh;
    const wb = $('#tb-widget');
    wb.onclick = async () => wb.classList.toggle('on', await window.tl.widget.toggle());
    window.tl.widget.state().then((s) => wb.classList.toggle('on', !!s.open));
    window.tl.widget.onChange((on) => wb.classList.toggle('on', !!on));
    $('#open-search').onclick = () => Palette.open();
    renderRail();
  }

  const NAV = [
    ['today', 'calendar', 'Matchday'],
    ['leagues', 'trophy', 'Competitions'],
    ['following', 'star', 'Following'],
    ['legends', 'legend', 'Legends'],
    ['builder', 'pitch', 'XI Builder']
  ];

  function renderRail() {
    const s = UI.store;
    const cur = hist[pos] || {};
    const leagues = (s.following.leagues || []).slice(0, 12);
    const teams = s.following.teams || [];
    $('#rail').innerHTML = `
      ${NAV.map(([r, ic, label]) => `<button class="rail-item ${cur.name === r ? 'active' : ''}" data-go="${r}">${icon(ic, 18)}${label}${r === 'today' && liveCount ? `<span class="badge">${liveCount} live</span>` : ''}</button>`).join('')}
      ${teams.length ? `<div class="rail-head">Your teams</div>${teams.map((t) => `<button class="rail-link ${cur.name === 'team' && String(cur.params[0]) === String(t.id) ? 'active' : ''}" data-go="team:${t.id}">${UI.crest(UI.teamLogo(t.id), t.name)}<span>${esc(t.name)}</span></button>`).join('')}` : ''}
      <div class="rail-head">Competitions <button data-go="leagues">Edit</button></div>
      ${leagues.map((l) => `<button class="rail-link ${cur.name === 'league' && String(cur.params[0]) === String(l.id) ? 'active' : ''}" data-go="league:${l.id}">${UI.crest(UI.leagueLogo(l.id), l.name)}<span>${esc(l.name)}</span></button>`).join('')}
      ${(s.following.leagues || []).length > 12 ? `<button class="rail-link muted" data-go="leagues"><span style="padding-left:27px">All ${(s.following.leagues || []).length} followed…</span></button>` : ''}
      <div class="rail-foot"><button class="rail-item ${cur.name === 'settings' ? 'active' : ''}" data-go="settings">${icon('settings', 18)}Settings</button></div>`;
  }

  function updateChrome(entry) {
    $('#nav-back').disabled = pos <= 0;
    $('#nav-fwd').disabled = pos >= hist.length - 1;
    renderRail();
    document.title = 'Touchline';
  }

  /* ---------- live + connection status ---------- */
  async function pollStatus() {
    try {
      const day = await UI.api('day', null, {});
      const ids = new Set((UI.store.following.leagues || []).map((l) => Number(l.id)));
      const mine = UI.myTeamIds();
      liveCount = day.leagues.flatMap((l) => l.matches.filter((m) => m.state === 'live' && (ids.has(l.primaryId) || mine.has(m.home.id) || mine.has(m.away.id)))).length;
      const st = $('#tb-status');
      if (day._meta?.backup || day._meta?.stale) { st.hidden = false; st.className = 'tb-status offline'; st.innerHTML = `${icon('wifiOff', 14)}Offline`; }
      else if (liveCount) { st.hidden = false; st.className = 'tb-status live'; st.innerHTML = `<span class="live-dot"></span>${liveCount} live now`; st.onclick = () => go('today', [UI.today(), 'live']); }
      else st.hidden = true;
      renderRail();
    } catch {
      const st = $('#tb-status'); st.hidden = false; st.className = 'tb-status offline'; st.innerHTML = `${icon('wifiOff', 14)}Offline`;
    }
  }

  /* ---------- delegated clicks ---------- */
  document.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-follow]');
    if (f) {
      e.preventDefault(); e.stopPropagation();
      const [kind, id, name] = f.dataset.follow.split(':');
      UI.store = await window.tl.store.follow(kind, { id: Number(id), name: UI.unattr(name || '') });
      const on = UI.following(kind, id);
      if (f.classList.contains('btn')) { f.classList.toggle('following', on); f.innerHTML = `${icon(on ? 'starFill' : 'star', 15)}${on ? 'Following' : 'Follow'}`; }
      else { f.classList.toggle('on', on); f.innerHTML = icon(on ? 'starFill' : 'star', 16); }
      UI.toast(on ? `Following ${UI.unattr(name || '')}` : `Unfollowed ${UI.unattr(name || '')}`);
      renderRail();
      return;
    }
    const ext = e.target.closest('[data-href]');
    if (ext) { e.preventDefault(); window.tl.app.openExternal(ext.dataset.href); return; }
    const r = e.target.closest('[data-retry]');
    if (r) { refresh(); return; }
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); const { name, params } = parse(g.dataset.go); go(name, params); }
  });

  // mouse back/forward buttons
  window.addEventListener('mouseup', (e) => { if (e.button === 3) back(); if (e.button === 4) forward(); });
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); Palette.open(); }
    if (e.altKey && e.key === 'ArrowLeft') back();
    if (e.altKey && e.key === 'ArrowRight') forward();
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); Palette.open(); }
  });

  window.App = { go, back, forward, refresh, renderRail, get current() { return hist[pos]; } };

  /* ---------- boot ---------- */
  function applyTheme(dark) {
    const t = UI.store.theme;
    document.documentElement.dataset.theme = t === 'light' ? 'light' : t === 'dark' ? 'dark' : (dark ? 'dark' : 'light');
  }

  (async () => {
    UI.info = await window.tl.app.info();
    UI.store = await window.tl.store.get();
    applyTheme(UI.info.dark);
    window.tl.app.onTheme((dark) => applyTheme(dark));
    window.tl.app.onNav(({ route, id }) => go(route, id != null ? [id] : []));
    window.tl.app.onMenu((m) => { if (m === 'search') Palette.open(); if (m === 'back') back(); if (m === 'forward') forward(); if (m === 'refresh') refresh(); });
    UI.applyTheme = applyTheme;
    shell();
    const start = UI.store.startPage && Views[UI.store.startPage] ? UI.store.startPage : 'today';
    go(start);
    pollStatus();
    setInterval(() => { if (!document.hidden) pollStatus(); }, 60 * 1000);
  })();
})();

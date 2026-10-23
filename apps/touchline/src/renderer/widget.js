// Touchline — the live widget window: today's matches for your competitions and
// teams, compact, refreshing every 30 seconds while anything is live.
(() => {
  const { esc, $ } = UI;
  const root = document.getElementById('w');
  let st = null;            // widget state (filter, pinned)
  let date = UI.today();
  let data = null;
  let loading = false;
  let lastAt = 0;
  let timer = null;
  let onToday = true;        // follows the calendar across midnight
  const prev = new Map();   // matchId -> "h-a" score, for goal flashes
  const flash = new Map();  // matchId -> until (ms)

  function applyTheme(dark) {
    const t = UI.store.theme;
    document.documentElement.dataset.theme = t === 'light' ? 'light' : t === 'dark' ? 'dark' : (dark ? 'dark' : 'light');
  }

  function shell() {
    root.innerHTML = `
      <div class="w-head">
        <img class="logo" src="../../build/icon.png" alt="">
        <div class="ttl">Matchday <span class="n" id="w-live"></span></div>
        <div class="grow" style="flex:1"></div>
        <button class="icon-btn ${st.pinned ? 'on' : ''}" id="w-pin" title="${st.pinned ? 'Stays on top · click to unpin' : 'Keep on top of other windows'}">${icon(st.pinned ? 'pin' : 'pinOff', 15)}</button>
        <button class="icon-btn" id="w-app" title="Open Touchline">${icon('external', 15)}</button>
        <button class="icon-btn" id="w-close" title="Close widget">${icon('x', 15)}</button>
      </div>
      <div class="w-bar">
        ${UI.seg([['today', 'All'], ['live', 'Live'], ['mine', 'My teams']], st.filter, 'wf')}
        <div class="day"><button class="icon-btn" id="w-prev" title="Previous day">${icon('chevronLeft', 14)}</button><span id="w-day"></span><button class="icon-btn" id="w-next" title="Next day">${icon('chevronRight', 14)}</button></div>
      </div>
      <div class="w-body" id="w-body"><div class="w-empty">Loading…</div></div>
      <div class="w-foot"><span class="grow" id="w-status"></span><button class="icon-btn" id="w-refresh" title="Refresh">${icon('refresh', 13)}</button></div>`;
    UI.onSeg(root, 'wf', async (v) => { st.filter = v; st = await window.tl.widget.set({ filter: v }); draw(); });
    $('#w-pin').onclick = async () => { st = await window.tl.widget.pin(!st.pinned); const b = $('#w-pin'); b.classList.toggle('on', st.pinned); b.innerHTML = icon(st.pinned ? 'pin' : 'pinOff', 15); b.title = st.pinned ? 'Stays on top · click to unpin' : 'Keep on top of other windows'; };
    $('#w-app').onclick = () => window.tl.widget.openApp();
    $('#w-close').onclick = () => window.tl.widget.close();
    $('#w-refresh').onclick = () => load(true);
    $('#w-prev').onclick = () => setDay(UI.addDays(date, -1));
    $('#w-next').onclick = () => setDay(UI.addDays(date, 1));
    $('#w-body').addEventListener('click', (e) => {
      const r = e.target.closest('[data-match]');
      if (r) { window.tl.widget.openMatch(Number(r.dataset.match)); return; }
      const l = e.target.closest('[data-league]');
      if (l) window.tl.widget.openApp();
    });
    dayLabel();
  }

  function dayLabel() {
    const t = UI.today();
    $('#w-day').textContent = date === t ? 'Today' : date === UI.addDays(t, 1) ? 'Tomorrow' : date === UI.addDays(t, -1) ? 'Yesterday' : new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function setDay(d) { date = d; onToday = d === UI.today(); data = null; dayLabel(); $('#w-body').innerHTML = '<div class="w-empty">Loading…</div>'; load(); }

  async function load(force = false) {
    if (loading) return;
    loading = true;
    $('#w-refresh').classList.add('spin');
    const want = date;
    try {
      const d = await UI.api('day', date === UI.today() ? null : date, { force });
      if (want !== date) return;
      data = d; lastAt = Date.now();
      draw();
    } catch (err) {
      if (!data) $('#w-body').innerHTML = `<div class="w-empty"><b>Can't load matches</b>${esc(err.message || '')}</div>`;
      status(true);
    } finally {
      loading = false;
      $('#w-refresh').classList.remove('spin');
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    const all = data ? data.leagues.flatMap((l) => l.matches) : [];
    const busy = all.some((m) => m.state === 'live' || (m.state === 'pre' && Math.abs(Date.parse(m.kickoff) - Date.now()) < 10 * 60 * 1000));
    timer = setTimeout(() => load(), busy && date === UI.today() ? 30 * 1000 : 2 * 60 * 1000);
  }

  function status(failed) {
    const el = $('#w-status');
    if (!el) return;
    const m = data?._meta || {};
    if (failed || m.stale) el.innerHTML = `<span class="off">${icon('wifiOff', 12)}Offline</span> · saved ${esc(UI.ago(m.at || lastAt))}`;
    else if (m.backup) el.innerHTML = `<span class="off">${icon('info', 12)}ESPN backup</span> · ${esc(UI.time(new Date(lastAt).toISOString()))}`;
    else el.textContent = `Updated ${UI.time(new Date(lastAt).toISOString())}`;
  }

  function row(m, mine, showDate = false) {
    const key = `${m.home.score ?? ''}-${m.away.score ?? ''}`;
    const was = prev.get(m.id);
    if (was && was !== key && m.state === 'live') flash.set(m.id, Date.now() + 6000);
    prev.set(m.id, key);
    const fl = (flash.get(m.id) || 0) > Date.now();
    const hw = m.state === 'post' && m.home.score > m.away.score, aw = m.state === 'post' && m.away.score > m.home.score;
    const reds = (n) => (n ? '<i class="red"></i>'.repeat(Math.min(n, 2)) : '');
    const when = m.state === 'live' ? `<span class="m live"><span class="live-dot"></span>${esc(m.label)}</span>` : m.state === 'post' ? `<span class="m">${esc(m.label || 'FT')}</span>` : m.state === 'off' ? '<span class="m">—</span>' : `<span class="m">${showDate ? esc(UI.date(m.kickoff, { month: 'short', day: 'numeric' })) : ''}</span>`;
    const score = m.state === 'pre' ? `<span class="s pre">${esc(UI.time(m.kickoff))}</span>` : m.state === 'off' ? `<span class="s off">${esc(m.label === 'Postponed' ? 'PPD' : 'Off')}</span>` : `<span class="s ${m.state === 'live' ? 'live' : ''}">${m.home.score ?? 0}–${m.away.score ?? 0}</span>`;
    const name = (t) => esc(t.short || t.name);
    return `<div class="w-row ${fl ? 'flash' : ''}" ${m.source === 'espn' ? '' : `data-match="${m.id}"`} title="${esc(`${m.home.name} v ${m.away.name}`)}">
      ${when}
      <div class="t h ${hw ? 'won' : ''} ${mine.has(m.home.id) ? 'mine' : ''}">${reds(m.home.red)}<span>${name(m.home)}</span>${UI.crest(m.home.logo, m.home.name)}</div>
      ${score}
      <div class="t ${aw ? 'won' : ''} ${mine.has(m.away.id) ? 'mine' : ''}">${UI.crest(m.away.logo, m.away.name)}<span>${name(m.away)}</span>${reds(m.away.red)}</div>
    </div>`;
  }

  function draw() {
    if (!data) return;
    const followed = UI.store.following.leagues || [];
    const order = new Map(followed.map((l, i) => [Number(l.id), i]));
    const mine = UI.myTeamIds();
    const isMine = (m) => mine.has(m.home.id) || mine.has(m.away.id);
    let leagues = data.leagues.map((l) => ({ ...l, matches: l.matches.filter((m) => {
      if (st.filter === 'mine') return isMine(m);
      if (!order.has(l.primaryId) && !isMine(m)) return false;
      if (st.filter === 'live') return m.state === 'live';
      return true;
    }) })).filter((l) => l.matches.length);
    leagues.sort((a, b) => (order.get(a.primaryId) ?? 1e4) - (order.get(b.primaryId) ?? 1e4) || a.rank - b.rank);

    const liveN = data.leagues.flatMap((l) => l.matches).filter((m) => m.state === 'live' && (order.has(m.primaryLeagueId) || isMine(m))).length;
    $('#w-live').innerHTML = liveN ? `<span class="live-dot"></span>${liveN} live` : '';

    let html = '';
    if (st.filter === 'today' && date === UI.today()) {
      // live first, so the useful bit is always at the top
      const live = leagues.flatMap((l) => l.matches.filter((m) => m.state === 'live').map((m) => ({ ...m, lg: l })));
      if (live.length && leagues.length > 1) html += `<div class="w-sub">Live now</div>${live.map((m) => row(m, mine)).join('')}`;
      if (live.length && leagues.length > 1) leagues = leagues.map((l) => ({ ...l, matches: l.matches.filter((m) => m.state !== 'live') })).filter((l) => l.matches.length);
    }
    html += leagues.map((l) => `<div class="w-league" data-league="${l.primaryId}">${UI.crest(l.logo, l.name)}<span>${esc(l.name)}</span></div>${l.matches.map((m) => row(m, mine)).join('')}`).join('');

    if (!html) {
      const t = UI.today();
      if (st.filter === 'mine' && !mine.size) html = '<div class="w-empty"><b>No teams followed</b>Follow a team in Touchline and its matches show here.</div>';
      else if (st.filter === 'mine') { html = `<div class="w-empty"><b>None of your teams play ${date === t ? 'today' : 'this day'}</b></div><div id="w-upnext"></div>`; nextForTeams(mine); }
      else if (st.filter === 'live') {
        const next = data.leagues.flatMap((l) => l.matches.map((m) => ({ ...m, lg: l }))).filter((m) => m.state === 'pre' && (order.has(m.lg.primaryId) || isMine(m))).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).slice(0, 6);
        html = `<div class="w-empty"><b>Nothing live right now</b>${next.length ? '' : 'No more matches today in your competitions.'}</div>${next.length ? `<div class="w-sub">Next up</div>${next.map((m) => row(m, mine)).join('')}` : ''}`;
      } else html = `<div class="w-empty"><b>No matches ${date === t ? 'today' : 'this day'}</b>${st.filter === 'mine' ? 'None of your teams play.' : 'Nothing in your competitions.'}</div>`;
    }
    const body = $('#w-body');
    const scroll = body.scrollTop;
    body.innerHTML = html;
    body.scrollTop = scroll;
    status(false);
  }

  // "My teams" with no match today: show each team's next fixture instead
  async function nextForTeams(mine) {
    const list = [];
    for (const id of mine) {
      try { const T = await UI.api('team', id); if (T.next) list.push(T.next); } catch {}
    }
    const box = $('#w-upnext');
    if (!box || st.filter !== 'mine') return;
    const seen = new Set();
    const rows = list.filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
    box.innerHTML = rows.length ? `<div class="w-sub">Next up</div>${rows.map((m) => row({ ...m, home: { ...m.home, red: 0 }, away: { ...m.away, red: 0 } }, mine, true)).join('')}` : '';
  }

  (async () => {
    UI.info = await window.tl.app.info();
    UI.store = await window.tl.store.get();
    st = await window.tl.widget.state();
    applyTheme(UI.info.dark);
    window.tl.app.onTheme(async (dark) => { UI.store = await window.tl.store.get(); applyTheme(dark); draw(); });
    window.tl.widget.onFollows((s) => { UI.store = s; draw(); });
    shell();
    load();
    // a new day starts while the widget is open
    setInterval(() => { const t = UI.today(); if (onToday && date !== t) setDay(t); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastAt > 60000) load(); });
  })();
})();

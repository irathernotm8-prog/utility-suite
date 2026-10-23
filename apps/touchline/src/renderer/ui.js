// Touchline — shared helpers and building blocks for every view.
// Views render HTML strings; clicks are handled by delegation in app.js:
//   data-go="team:8456"            open a page
//   data-follow="teams:8456:Name"  follow / unfollow
(() => {
  window.__errors = [];
  window.addEventListener('error', (e) => { if (e.message) window.__errors.push(`${e.message} @ ${e.filename}:${e.lineno}`); });
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(`unhandled: ${e.reason?.message || e.reason}`));
  const UI = (window.UI = {});
  UI.store = null;            // settings + follows (kept in sync by app.js)
  UI.info = {};

  UI.$ = (sel, root = document) => root.querySelector(sel);
  UI.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (UI.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  UI.attr = (s) => esc(String(s ?? '').replace(/:/g, '꞉'));
  UI.unattr = (s) => String(s ?? '').replace(/꞉/g, ':');

  /* ---------- data ---------- */
  UI.api = async (name, ...args) => {
    const r = await window.tl.data[name](...args);
    if (!r || !r.ok) { const e = new Error(r?.error || 'Could not load'); e.status = r?.status; throw e; }
    return r.data;
  };

  /* ---------- images ---------- */
  UI.src = (url) => {
    if (!url) return '';
    if (document.documentElement.dataset.theme === 'light') url = url.replace('/leaguelogo/dark/', '/leaguelogo/');
    return `tl-img://i/?u=${encodeURIComponent(url)}`;
  };
  const initials = (n) => String(n || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  UI.initials = initials;
  UI.crest = (url, name = '', cls = '') => url
    ? `<img class="crest ${cls}" src="${UI.src(url)}" alt="" loading="lazy" data-fb="${esc(initials(name))}">`
    : `<span class="crest fallback ${cls}">${esc(initials(name))}</span>`;
  UI.photo = (url, name = '', cls = '') => url
    ? `<img class="avatar ${cls}" src="${UI.src(url)}" alt="" loading="lazy" data-fb="${esc(initials(name))}">`
    : `<span class="avatar fallback ${cls}" style="display:inline-grid;place-items:center;font-weight:700;color:var(--mute)">${esc(initials(name))}</span>`;
  UI.flag = (ccode) => (ccode ? `<img class="flag" src="${UI.src(`https://images.fotmob.com/image_resources/logo/teamlogo/${String(ccode).toLowerCase()}.png`)}" alt="" loading="lazy" data-fb="">` : '');
  UI.leagueLogo = (id) => `https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${id}.png`;
  UI.teamLogo = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}_small.png`;
  UI.playerPhoto = (id) => `https://images.fotmob.com/image_resources/playerimages/${id}.png`;
  // broken images become initials
  document.addEventListener('error', (e) => {
    const im = e.target;
    if (!(im instanceof HTMLImageElement) || !im.hasAttribute('data-fb')) return;
    const span = document.createElement('span');
    span.className = `${im.className} fallback`;
    span.style.cssText = 'display:inline-grid;place-items:center;font-weight:700;font-size:10px;color:var(--mute);background:var(--raise);border-radius:50%';
    span.textContent = im.getAttribute('data-fb');
    if (!span.textContent) { im.style.visibility = 'hidden'; return; }
    im.replaceWith(span);
  }, true);

  /* ---------- formatting ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  UI.ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  UI.today = () => UI.ymd(new Date());
  UI.addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() + n); return UI.ymd(d); };
  UI.time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  UI.date = (iso, o = { weekday: 'short', day: 'numeric', month: 'short' }) => (iso ? new Date(iso).toLocaleDateString([], o) : '');
  UI.fullDate = (iso) => UI.date(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  UI.dayLabel = (ymd) => {
    const t = UI.today();
    if (ymd === t) return 'Today';
    if (ymd === UI.addDays(t, 1)) return 'Tomorrow';
    if (ymd === UI.addDays(t, -1)) return 'Yesterday';
    return new Date(`${ymd}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  };
  UI.ago = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  UI.money = (v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'string') return v;
    if (v >= 1e6) return `€${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}m`;
    if (v >= 1e3) return `€${Math.round(v / 1e3)}k`;
    return `€${v}`;
  };
  UI.age = (birth) => { if (!birth) return null; const b = new Date(birth), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };
  UI.n = (v, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d));
  UI.ratingColor = (r) => { const x = Number(r); if (!x) return 'var(--line-2)'; if (x >= 8) return '#2fd27e'; if (x >= 7) return '#a6e05a'; if (x >= 6.5) return '#f2c94c'; if (x >= 6) return '#f59e4c'; return '#ff6b6b'; };
  UI.rating = (r) => (r ? `<span class="rating" style="background:${UI.ratingColor(r)}">${Number(r).toFixed(1)}</span>` : '');
  UI.ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  /* ---------- follows ---------- */
  UI.following = (kind, id) => !!UI.store?.following?.[kind]?.some((x) => Number(x.id) === Number(id));
  UI.followBtn = (kind, id, name, extra = '') => {
    const on = UI.following(kind, id);
    return `<button class="btn ${on ? 'following' : ''}" data-follow="${kind}:${id}:${UI.attr(name)}" ${extra}>${icon(on ? 'starFill' : 'star', 15)}${on ? 'Following' : 'Follow'}</button>`;
  };
  UI.myTeamIds = () => new Set((UI.store?.following?.teams || []).map((t) => Number(t.id)));

  /* ---------- building blocks ---------- */
  UI.scoreChip = (m) => {
    if (m.state === 'pre') return `<span class="score pre">${esc(UI.time(m.kickoff))}</span>`;
    if (m.state === 'off') return `<span class="score off">${esc(m.label || 'Off')}</span>`;
    return `<span class="score ${m.state === 'live' ? 'live' : ''}">${m.home.score ?? 0}<span style="opacity:.5">–</span>${m.away.score ?? 0}</span>`;
  };

  UI.whenCell = (m) => {
    if (m.state === 'live') return `<span class="when live"><span class="live-dot"></span>${esc(m.label)}</span>`;
    if (m.state === 'post') return `<span class="when">${esc(m.label || 'FT')}</span>`;
    if (m.state === 'off') return `<span class="when">—</span>`;
    return `<span class="when">${esc(UI.date(m.kickoff, { day: 'numeric', month: 'short' }))}</span>`;
  };

  UI.matchRow = (m, { showDate = false, mine = UI.myTeamIds() } = {}) => {
    const hw = m.state === 'post' && m.home.score > m.away.score, aw = m.state === 'post' && m.away.score > m.home.score;
    const go = m.source === 'espn' ? '' : `data-go="match:${m.id}"`;
    const reds = (n) => (n ? '<i class="red"></i>'.repeat(Math.min(n, 3)) : '');
    const when = m.state === 'live' ? UI.whenCell(m) : showDate ? `<span class="when">${esc(UI.date(m.kickoff, { day: 'numeric', month: 'short' }))}${m.state === 'post' && m.label && m.label !== 'FT' ? ` · ${esc(m.label)}` : ''}</span>` : m.state === 'pre' ? '<span class="when"></span>' : UI.whenCell(m);
    return `<div class="mrow" ${go}>
      ${when}
      <div class="team home ${hw ? 'won' : ''} ${mine.has(m.home.id) ? 'mine' : ''}">${reds(m.home.red)}<span>${esc(m.home.name)}</span>${UI.crest(m.home.logo, m.home.name)}</div>
      <div style="text-align:center">${UI.scoreChip(m)}${m.aggregate ? `<div class="agg">agg ${esc(m.aggregate)}</div>` : ''}</div>
      <div class="team away ${aw ? 'won' : ''} ${mine.has(m.away.id) ? 'mine' : ''}">${UI.crest(m.away.logo, m.away.name)}<span>${esc(m.away.name)}</span>${reds(m.away.red)}</div>
      <span class="icon-btn fav">${m.source === 'espn' ? '' : icon('chevronRight', 16)}</span>
    </div>`;
  };

  UI.form = (list = []) => `<span class="form">${list.map((f) => `<b class="${esc(f.r)}" title="${esc(f.score || '')}">${esc(f.r)}</b>`).join('')}</span>`;

  UI.seg = (opts, value, name) => `<div class="seg" data-seg="${name}">${opts.map(([v, label]) => `<button data-v="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
  UI.tabs = (opts, value, name) => `<div class="tabs" data-seg="${name}">${opts.map(([v, label]) => `<button data-v="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
  // wire a seg/tabs group: calls fn(value)
  UI.onSeg = (root, name, fn) => {
    const el = root.querySelector(`[data-seg="${name}"]`);
    if (!el) return;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      fn(b.dataset.v);
    });
  };

  UI.loading = (rows = 6, h = 46) => `<div class="card" style="padding:8px">${Array.from({ length: rows }, () => `<div class="skel" style="height:${h - 12}px;margin:6px"></div>`).join('')}</div>`;
  UI.heroLoading = () => `<div class="hero"><div class="skel" style="width:92px;height:92px;border-radius:20px"></div><div style="flex:1"><div class="skel" style="height:30px;width:40%"></div><div class="skel" style="height:16px;width:25%;margin-top:12px"></div></div></div>`;
  UI.empty = (title, sub = '', ic = 'ball') => `<div class="empty">${icon(ic, 34)}<h3>${esc(title)}</h3><div>${esc(sub)}</div></div>`;
  UI.error = (err, what = 'this') => {
    const offline = !navigator.onLine || /fetch|network|timed out|ENOTFOUND|ECONN|net::|ERR_INTERNET/i.test(err?.message || '');
    return `<div class="card">${UI.empty(offline ? "You're offline" : `Couldn't load ${what}`, offline ? 'Touchline shows anything it has already seen. This page hasn’t been saved yet.' : (err?.message || ''), offline ? 'wifiOff' : 'info')}<div style="text-align:center;padding-bottom:28px"><button class="btn" data-retry>${icon('refresh', 15)}Try again</button></div></div>`;
  };
  UI.staleNotice = (meta) => {
    if (!meta) return '';
    if (meta.backup) return `<div class="notice">${icon('info', 16)}<span>FotMob isn't answering right now, so this is ${esc(meta.backup)}'s data. Links to matches and players come back when FotMob does.</span></div>`;
    if (meta.stale) return `<div class="notice">${icon('wifiOff', 16)}<span>Couldn't refresh. Showing what was saved ${esc(UI.ago(meta.at))}.</span></div>`;
    return '';
  };

  UI.toast = (msg) => {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    UI.$('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  };

  UI.sheet = (title, bodyHtml) => {
    const o = UI.$('#overlay');
    o.innerHTML = `<div class="scrim"><div class="sheet"><div class="card-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>${icon('x', 16)}</button></div><div class="body">${bodyHtml}</div></div></div>`;
    const close = () => { o.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    o.querySelector('.scrim').addEventListener('mousedown', (e) => { if (e.target.classList.contains('scrim') || e.target.closest('[data-close]')) close(); });
    o.addEventListener('click', (e) => { if (e.target.closest('[data-go]')) close(); }, { once: true });
    return { el: o.querySelector('.body'), close };
  };

  // Position groups (FotMob position ids and labels)
  UI.posGroup = (s) => {
    const p = String(s || '').toUpperCase();
    if (/GK|KEEP/.test(p)) return 'GK';
    if (/CB|LB|RB|WB|DEF|BACK/.test(p)) return 'DEF';
    if (/ST|CF|LW|RW|FW|ATT|STRIK|WING|FORW/.test(p)) return 'FWD';
    return 'MID';
  };
})();

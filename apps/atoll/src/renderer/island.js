// Atoll — the island page. Three shapes: compact (live activities around the notch, or a small pill),
// peek (a moment: a timer ringing, a goal, a new song) and open (the full panel with Home, Music, Timers,
// Match and Shelf). The page decides the size it needs and asks the main process to fit the window to it.
(() => {
  'use strict';
  const A = window.atoll;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isl = $('#island'), cmp = $('#compact'), peekEl = $('#peek'), head = $('#head'), viewEl = $('#view'), bubble = $('#bubble');

  let S = null;                         // everything the main process knows (see main.js snapshot())
  let mode = 'compact', view = 'home', sub = { timers: 'timers', match: 'today' };
  let pinned = false, dragging = 0, hoverT = null, leaveT = null, peekT = null, burstNow = null, burstQ = [], gen = 0, lastWin = { w: 0, h: 0 };
  let battery = null, artRGB = null, artFor = null, pickerData = null, pickerQ = '', teamResults = null, teamQ = '', lastErr = null, ringing = null;
  const DUR = 480;

  // ---------------------------------------------------------------- formatting
  const fmt = (ms, up = true) => { const t = Math.max(0, up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
  const fmtS = (sec) => fmt((sec || 0) * 1000, false);
  const fmtWatch = (ms) => { const cs = Math.floor(ms / 10) % 100; return `${fmt(ms, false)}<span style="color:var(--mut);font-size:.6em">.${String(cs).padStart(2, '0')}</span>`; };
  const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
  const ampm = () => (new Date().toLocaleTimeString([], { hour: 'numeric' }).match(/[AP]M/i) || [''])[0];
  const dateStr = () => new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const kickoff = (iso) => { if (!iso) return ''; const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  const koTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M$/i, (_, x) => x.toLowerCase()) : '');
  const koDay = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date().toDateString() === d.toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }); };
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };
  const crestUrl = (u) => (u ? `atoll-img://c/?u=${encodeURIComponent(u)}` : '');
  const crest = (u, cls = '') => (u ? `<img class="crest ${cls}" src="${crestUrl(u)}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="crest ${cls}"></span>`);
  const mods = () => S.settings.modules;
  const geo = () => S.geo || { style: 'float', notchWidth: 0, notchHeight: 0 };
  const notch = () => geo().style === 'notch';
  const hw = () => notch() && !!geo().notch;   // a real camera notch (MacBook) rather than a notch-style tab

  function ring(pct, size, color, stroke = 3, inner = '', cls = '') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
    return `<div class="ring ${cls}" style="width:${size}px;height:${size}px;color:${color}"><svg class="rg" width="${size}" height="${size}"><circle class="trk" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/><circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke="currentColor" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>${inner}</div>`;
  }

  // ---------------------------------------------------------------- live values
  const timerLeft = (t) => (t.state === 'running' ? Math.max(0, t.endsAt - Date.now()) : t.left);
  function leadTimer() {
    const T = S.timers; if (!T || !mods().timers) return null;
    const ring_ = T.list.find((t) => t.state === 'done'); if (ring_) return { kind: 'timer', t: ring_ };
    const run = T.list.filter((t) => t.state === 'running').sort((a, b) => a.endsAt - b.endsAt)[0]; if (run) return { kind: 'timer', t: run };
    if (T.focus) return { kind: 'focus', f: T.focus };
    const p = T.list.find((t) => t.state === 'paused'); if (p) return { kind: 'timer', t: p };
    if (T.watch.running) return { kind: 'watch' };
    return null;
  }
  const focusLeft = (f) => (f.running ? Math.max(0, f.endsAt - Date.now()) : f.left);
  const watchMs = () => { const w = S.timers.watch; return w.before + (w.running ? Date.now() - w.startedAt : 0); };
  const np = () => (mods().media ? S.media?.now : null);
  const mediaPos = () => { const n = S.media?.now; if (!n) return 0; return Math.min(n.duration || Infinity, n.position + (n.state === 'playing' ? (Date.now() - n.at) / 1000 : 0)); };
  const liveMatch = () => (mods().match ? S.match?.cur : null);

  /** Which live activities exist right now, in the user's priority order. */
  function activities() {
    const out = [];
    const r = rec(); if (r) out.push({ k: 'docket', r });
    for (const k of S.settings.priority.concat(['timers', 'match', 'media']).filter((v, i, a) => a.indexOf(v) === i)) {
      if (k === 'timers') { const l = leadTimer(); if (l) out.push({ k: 'timers', l }); }
      if (k === 'match') { const m = liveMatch(); if (m && (m.state === 'live' || (m.state === 'post' && Date.now() - Date.parse(m.kickoff) < 3.2 * 3600e3) || (m.state === 'pre' && Date.parse(m.kickoff) - Date.now() < 30 * 60e3))) out.push({ k: 'match', m }); }
      if (k === 'media') { const n = np(); if (n && n.state === 'playing') out.push({ k: 'media', n }); }
    }
    const bl = beamLive(); if (bl.length) out.push({ k: 'beam', list: bl });
    if (dragging && !out.length) out.push({ k: 'drop' });
    return out;
  }

  // ---------------------------------------------------------------- compact
  function wings(a) {
    if (!a) return null;
    if (a.k === 'drop') return { l: `<span class="c-shelf">${icon('tray', 17)}</span>`, r: '<span class="sub">Drop</span>' };
    if (a.k === 'docket') return { l: `<span class="recdot ${a.r.paused ? 'paused' : ''}"></span>`, mid: `<span class="sub ell">${esc(a.r.title || 'Taking notes')}</span>`, r: `<span class="val tnum" style="color:var(--red)">${a.r.paused ? 'Paused' : fmt(recElapsed(a.r) * 1000, false)}</span>` };
    if (a.k === 'beam') { const p = beamPct(a.list); return { l: ring(p, 20, 'var(--shelf)', 2.6), mid: `<span class="sub ell">${a.list[0].dir === 'out' ? 'To' : 'From'} ${esc(a.list[0].peer || '')}</span>`, r: `<span class="val tnum" style="color:var(--shelf)">${Math.round(p * 100)}%</span>` }; }
    if (a.k === 'media') {
      const n = a.n;
      return { l: n.art ? `<img class="art-sm" src="${n.art}" alt="">` : `<span class="art-sm" style="display:grid;place-items:center;color:var(--media)">${icon('music', 13)}</span>`, mid: `<span class="sub ell">${esc(n.title)}</span>`, r: `<span class="eq ${n.state === 'playing' ? '' : 'paused'}"><i></i><i></i><i></i><i></i></span>` };
    }
    if (a.k === 'timers') {
      const l = a.l;
      if (l.kind === 'timer') { const t = l.t; const left = timerLeft(t); const done = t.state === 'done'; return { l: ring(done ? 1 : left / t.duration, 20, 'var(--timer)', 2.6, '', done ? 'ringing' : ''), mid: `<span class="sub ell">${esc(t.label)}</span>`, r: `<span class="val tnum c-timer">${done ? 'Done' : fmt(left)}</span>` }; }
      if (l.kind === 'focus') { const f = l.f; const left = focusLeft(f); return { l: ring(1 - left / f.duration, 20, f.phase === 'work' ? 'var(--focus)' : 'var(--match)', 2.6), mid: `<span class="sub">${f.phase === 'work' ? 'Focus' : 'Break'}</span>`, r: `<span class="val tnum" style="color:${f.phase === 'work' ? 'var(--focus)' : 'var(--match)'}">${fmt(left)}</span>` }; }
      return { l: `<span class="c-sky">${icon('stopwatch', 17)}</span>`, mid: '<span class="sub">Stopwatch</span>', r: `<span class="val tnum c-sky">${fmt(watchMs(), false)}</span>` };
    }
    if (a.k === 'match') {
      const m = a.m; const live = m.state === 'live';
      const hs = m.state === 'pre' ? '' : m.home.score ?? 0, as = m.state === 'pre' ? '' : m.away.score ?? 0;
      const tag = live ? `<span class="sub tnum" style="color:var(--match)">${esc(m.label || '')}</span>` : m.state === 'pre' ? `<span class="sub">${esc(kickoff(m.kickoff))}</span>` : `<span class="sub">${esc(m.label || 'FT')}</span>`;
      if (hw()) return { l: `${crest(m.home.logo)}<span class="val tnum">${hs}</span>`, r: `<span class="val tnum">${as}</span>${crest(m.away.logo)}${live ? '<span class="livedot"></span>' : ''}` };
      return { l: crest(m.home.logo), mid: `<span class="val tnum">${esc(m.home.short)} ${m.state === 'pre' ? 'v' : `${hs}–${as}`} ${esc(m.away.short)}</span> ${tag}`, r: crest(m.away.logo) };
    }
    return null;
  }
  function bubbleHTML(a) {
    if (!a) return '';
    if (a.k === 'docket') return '<span class="recdot"></span>';
    if (a.k === 'beam') return ring(beamPct(a.list), 20, 'var(--shelf)', 2.6);
    if (a.k === 'media') return a.n.art ? `<img src="${a.n.art}" style="width:62%;height:62%;border-radius:5px;object-fit:cover">` : `<span class="c-media">${icon('music', 14)}</span>`;
    if (a.k === 'timers') { const l = a.l; if (l.kind === 'timer') return ring(l.t.state === 'done' ? 1 : timerLeft(l.t) / l.t.duration, 20, 'var(--timer)', 2.6); if (l.kind === 'focus') return ring(1 - focusLeft(l.f) / l.f.duration, 20, 'var(--focus)', 2.6); return `<span class="c-sky">${icon('stopwatch', 15)}</span>`; }
    if (a.k === 'match') return a.m.state === 'live' ? `<span class="val tnum" style="font-size:11px;font-weight:700">${a.m.home.score ?? 0}-${a.m.away.score ?? 0}</span>` : crest(a.m.home.logo);
    return '';
  }

  const measurer = document.createElement('div');
  measurer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;font:inherit';
  document.body.appendChild(measurer);
  const width = (html) => { measurer.innerHTML = html || ''; return Math.ceil(measurer.getBoundingClientRect().width); };

  /** Size and markup of the compact island right now. */
  function compactModel() {
    const g = geo(); const acts = activities(); const a = acts[0], b = acts[1];
    const w = wings(a);
    if (notch()) {
      const h = g.notchHeight || 32, gapw = g.notchWidth;
      if (!w) return { w: gapw, h, html: '', gapw, bubble: null };
      const side = Math.max(width(w.l), width(w.r)) + 16;
      // no camera in the way: the middle of the tab carries the title (song, timer label, teams)
      const mid = !hw() && w.mid ? `<div class="gap ell" style="display:flex;align-items:center;justify-content:center;gap:6px;overflow:hidden">${w.mid}</div>` : '<div class="gap"></div>';
      const midW = !hw() && w.mid ? Math.max(gapw, Math.min(220, width(w.mid) + 12)) : gapw;
      return { w: midW + side * 2, h, gapw: midW, html: `<div class="wing l" style="width:${side - 10}px">${w.l}</div>${mid}<div class="wing r" style="width:${side - 10}px">${w.r}</div>`, bubble: b ? bubbleHTML(b) : null, bubbleKey: b?.k };
    }
    const h = 32;
    if (!w) {
      const idle = S.settings.idle;
      if (idle === 'hide') return { w: 120, h: 5, html: '', idle: 'hide' };
      if (idle === 'dot') return { w: 64, h: 12, html: '', idle: 'dot' };
      const html = `<div class="idle-clock tnum">${esc(clock())}<span>${esc(dateStr())}</span></div>`;
      return { w: width(html) + 30, h, html, idle: 'clock' };
    }
    const mid = w.mid ? `<div class="grow ell" style="display:flex;align-items:center;gap:6px;justify-content:${a.k === 'match' ? 'center' : 'flex-start'}">${w.mid}</div>` : '<div class="grow"></div>';
    const midW = Math.min(a.k === 'media' ? 150 : 170, width(w.mid || ''));
    const W = Math.max(150, width(w.l) + width(w.r) + midW + 44);
    return { w: W, h, html: `<div class="wing l">${w.l}</div>${mid}<div class="wing r">${w.r}</div>`, bubble: b ? bubbleHTML(b) : null, bubbleKey: b?.k };
  }

  // ---------------------------------------------------------------- peek (bursts)
  function burstModel(b) {
    const g = geo(); const top = hw() ? g.notchHeight : 0;
    const base = { h: top + 78, pt: top + 10 };
    if (b.kind === 'timer') return { ...base, w: 420, c: 'var(--timer)', html: `${ring(1, 46, 'var(--timer)', 3.5, icon('timer', 20), 'ringing')}<div class="grow"><div class="pk-t ell">${esc(b.label)}</div><div class="pk-s">Timer done</div></div><div class="pk-actions"><button class="btn sm" data-act="timerExtend" data-id="${b.id}">+1 min</button><button class="btn sm acc" style="--c:var(--timer)" data-act="stopRing" data-id="${b.id}">Stop</button></div>`, sticky: true };
    if (b.kind === 'focus') return { ...base, w: 400, html: `${ring(1, 46, b.to === 'work' ? 'var(--focus)' : 'var(--match)', 3.5, icon(b.to === 'work' ? 'focus' : 'sparkle', 19))}<div class="grow"><div class="pk-t">${esc(b.label)}</div><div class="pk-s">${b.to === 'work' ? `Session ${b.cycle}` : 'Step away for a bit'}</div></div><button class="btn sm" data-act="focusSkip">Skip</button>`, ms: 6000 };
    if (b.kind === 'track') return { ...base, w: 380, html: `${b.art ? `<img class="pk-art" src="${b.art}" alt="">` : `<div class="pk-art" style="display:grid;place-items:center;background:#1c1c1f;color:var(--media)">${icon('music', 22)}</div>`}<div class="grow"><div class="pk-t ell">${esc(b.title)}</div><div class="pk-s ell">${esc(b.artist)}</div></div><span class="eq"><i></i><i></i><i></i><i></i></span>`, ms: 3800 };
    if (b.kind === 'goal') {
      const m = b.match; const team = b.side === 'home' ? m.home : m.away;
      return { ...base, h: top + 92, w: 460, html: `${crest(team.logo, 'xl')}<div class="grow"><div class="pk-big disp goal">GOAL!</div><div class="pk-s ell" style="margin-top:4px">${esc(b.scorer || team.name)}${b.minute ? ` ${esc(b.minute)}'` : ''}${b.penalty ? ' (pen)' : ''}${b.ownGoal ? ' (og)' : ''}</div></div><div style="text-align:center"><div class="score tnum">${m.home.score ?? 0}–${m.away.score ?? 0}</div><div class="pk-s">${esc(m.home.short)} · ${esc(m.away.short)}</div></div>`, ms: 8000 };
    }
    if (b.kind === 'kickoff' || b.kind === 'fulltime') {
      const m = b.match;
      return { ...base, w: 420, html: `<span style="color:var(--match)">${icon('whistle', 26)}</span><div class="grow"><div class="pk-t">${b.kind === 'kickoff' ? 'Kick-off' : 'Full-time'}</div><div class="pk-s ell">${esc(m.league?.name || '')}</div></div>${crest(m.home.logo, 'md')}<div class="score tnum">${b.kind === 'kickoff' ? 'v' : `${m.home.score ?? 0}–${m.away.score ?? 0}`}</div>${crest(m.away.logo, 'md')}`, ms: 6000 };
    }
    if (b.kind === 'meeting') return { ...base, w: 440, html: `<div class="rec-ring idle sm">${icon('mic', 20)}</div><div class="grow"><div class="pk-t ell">${esc(b.meeting.app || 'A')} call started</div><div class="pk-s ell">${esc(b.meeting.title || 'Want Docket to take notes?')}</div></div><div class="pk-actions"><button class="btn sm" data-act="peekDismiss">Not now</button><button class="btn sm acc" style="--c:var(--red)" data-act="docket" data-cmd="start">Take notes</button></div>`, ms: 20000 };
    if (b.kind === 'mail') { const m = b.mail; return { ...base, w: 420, html: `<div class="pk-art" style="display:grid;place-items:center;background:#1c1c1f;color:${esc(m.color || 'var(--sky)')};width:46px;height:46px">${icon('mail', 22)}</div><div class="grow"><div class="pk-t ell">${esc(m.from || 'New email')}</div><div class="pk-s ell">${esc(m.subject || m.account || '')}</div></div><span class="np-a" style="font-size:11px">${esc(m.account || '')}</span>`, ms: 6000 }; }
    return { ...base, w: 300, html: esc(b.label || ''), ms: 3000 };
  }
  function onBurst(b) {
    if (b.kind === 'timer' || b.kind === 'focus') sound(b.kind === 'timer' ? 'ring' : 'soft');
    if (b.kind === 'goal') sound('goal');
    if (b.kind === 'timer') ringing = b.id;
    if (b.kind === 'meeting') sound('soft');
    if (mode === 'open') { if (b.kind === 'meeting' || b.kind === 'mail') { toast(b.kind === 'meeting' ? `${b.meeting.app || 'A'} call started` : `Email from ${b.mail.from || b.mail.account || 'Relay'}`); return; } if (b.kind !== 'track') toast(b.kind === 'goal' ? `Goal! ${b.match.home.short} ${b.match.home.score}–${b.match.away.score} ${b.match.away.short}` : b.kind === 'timer' ? `${b.label} — done` : b.label || ''); if (b.kind === 'timer') renderView(); return; }
    burstQ.push(b); if (!burstNow) nextBurst();
  }
  function nextBurst() {
    clearTimeout(peekT);
    burstNow = burstQ.shift() || null;
    if (!burstNow) { if (mode === 'peek') setMode('compact'); return; }
    const m = burstModel(burstNow);
    peekEl.style.setProperty('--pt', `${m.pt}px`);
    peekEl.innerHTML = m.html;
    setMode('peek');
    if (!m.sticky) peekT = setTimeout(nextBurst, m.ms);
  }

  // ---------------------------------------------------------------- sizes and the window
  function target() {
    const g = geo();
    if (mode === 'open') {
      const hh = notch() ? Math.max(g.notchHeight, 36) : 44;
      const body = { home: 184, media: 196, timers: 214, match: 232, shelf: 214, docket: 196, scene: 196, beam: 214, vitals: 206, relay: 214 }[view] || 184;
      return { w: notch() ? 660 : 640, h: hh + body, r: notch() ? 30 : 30, hh };
    }
    if (mode === 'peek' && burstNow) { const m = burstModel(burstNow); return { w: m.w, h: m.h, r: notch() ? 26 : 28 }; }
    const c = compactModel();
    return { w: c.w, h: c.h, r: notch() ? Math.min(12, c.h / 3) : c.h / 2, compact: c };
  }
  function windowFor(t) {
    const big = mode !== 'compact';
    const side = big ? 34 : notch() ? 12 : 2;
    const bub = t.compact?.bubble ? t.h + 8 : 0;
    return { w: Math.ceil(t.w + 2 * (side + bub)), h: Math.ceil(t.h + (big ? 44 : notch() ? 0 : 2)), expanded: mode === 'open' };
  }

  let lastT = null;
  function layout(force = false) {
    const t = target();
    const key = `${mode}|${t.w}|${t.h}|${t.r}`;
    if (mode === 'compact') renderCompact(t.compact);
    if (!force && lastT === key) return;
    lastT = key;
    const want = windowFor(t);
    const my = ++gen;
    const grow = want.w > lastWin.w || want.h > lastWin.h;
    const apply = () => {
      if (my !== gen) return;   // a newer layout already ran
      isl.style.width = `${t.w}px`; isl.style.height = `${t.h}px`;
      isl.style.setProperty('--r-b', `${t.r}px`); isl.style.setProperty('--r', mode === 'compact' && !notch() ? '999px' : `${t.r}px`);
      document.documentElement.style.setProperty('--iw', `${t.w}px`);
      if (t.hh) head.style.setProperty('--hh', `${t.hh}px`);
      placeBubble(t);
      requestAnimationFrame(rehit);
    };
    if (geo().fixed) { apply(); setTimeout(rehit, DUR + 40); return; }   // Windows/Linux: the window never resizes
    if (grow) { const w = { w: Math.max(want.w, lastWin.w), h: Math.max(want.h, lastWin.h), expanded: want.expanded }; lastWin = w; A.call('size', w).then(() => requestAnimationFrame(apply)); }
    else apply();
    setTimeout(() => { if (my !== gen) return; lastWin = want; A.call('size', want); }, DUR + 40);
  }
  function placeBubble(t) {
    const c = t.compact;
    if (mode !== 'compact' || !c?.bubble) { bubble.classList.remove('on'); return; }
    const d = t.h;
    bubble.style.width = bubble.style.height = `${d}px`;
    bubble.style.left = `calc(50% + ${t.w / 2 + 8}px)`;
    if (bubble.dataset.html !== c.bubble) { bubble.innerHTML = c.bubble; bubble.dataset.html = c.bubble; }
    bubble.dataset.k = c.bubbleKey || '';
    bubble.classList.add('on');
  }
  function renderCompact(c) {
    if (!c) return;
    const html = c.html;
    if (cmp.dataset.html !== html) { cmp.innerHTML = html; cmp.dataset.html = html; }
    cmp.style.setProperty('--gapw', `${c.gapw || 0}px`);
    cmp.style.setProperty('--cp', notch() ? '10px' : '12px');
    isl.dataset.idle = c.idle || '';
    if (!notch() && c.idle === 'hide') { isl.style.background = 'rgba(255,255,255,.18)'; } else isl.style.background = '';
    if (!notch() && c.idle === 'dot') isl.style.background = '#000';
  }

  function setMode(m) {
    if (mode === m) { layout(); return; }
    const was = mode; mode = m;
    isl.classList.toggle('compact', m === 'compact'); isl.classList.toggle('peek', m === 'peek'); isl.classList.toggle('open', m === 'open');
    if (m === 'open') { renderHead(); renderView(true); }
    if ((m === 'open') !== (was === 'open')) A.call('expanded', m === 'open');
    layout(true);
  }
  function open(v) {
    clearTimeout(leaveT); clearTimeout(hoverT);
    if (v) view = v;
    if (!enabledViews().includes(view)) view = 'home';
    if (mode === 'peek') { clearTimeout(peekT); burstNow = null; burstQ = []; }
    if (view === 'match') loadPicker();
    if (mode === 'open') { renderHead(); renderView(true); layout(); return; }
    setMode('open');
  }
  function close() {
    clearTimeout(leaveT); clearTimeout(hoverT);
    if (mode !== 'open') return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (burstQ.length) nextBurst(); else setMode('compact');
  }

  // ---------------------------------------------------------------- panel header
  const VIEWS = [['home', 'home', 'Home'], ['media', 'music', 'Music'], ['timers', 'timer', 'Timers'], ['match', 'ball', 'Match'], ['shelf', 'tray', 'Shelf']];
  const enabledViews = () => VIEWS.filter(([k]) => k === 'home' || mods()[k]).map(([k]) => k).concat(ADDON_VIEWS.filter(([k]) => addonOn(k)).map(([k]) => k));
  let lastViewKey = '', lastHeadKey = '';
  /** What the current view shows, minus values that move on their own (song position, countdowns). */
  function viewKey() {
    const n = S.media?.now;
    const media = n ? [n.player, n.state, n.title, n.artist, n.album, n.art ? n.art.length : 0, n.canNext, n.canPrev, n.canSeek, Math.round(n.duration || 0)] : null;
    const vol = S.media?.volume ? [S.media.volume.volume, S.media.volume.muted] : null;
    const T = S.timers; const timers = T ? [T.list.map((t) => [t.id, t.state, t.label, t.duration, t.state === 'running' ? t.endsAt : t.left]), T.focus && [T.focus.phase, T.focus.running, T.focus.cycle, T.focus.endsAt], [T.watch.running, T.watch.before, T.watch.laps.length]] : null;
    const dk = S.addons?.docket; const dst = dk?.data?.status;
    const addonPart = (id) => { const a = S.addons?.[id]; if (!a) return null; return [a.up, a.installed, a.launching, id === 'docket' ? dst && [dst.recording, dst.paused, dst.title, dst.line, dst.detected && dst.detected.app] : a.data]; };
    const parts = { media: [media, vol, S.media?.running, S.media?.error], timers, match: S.match, shelf: S.shelf, settings: S.settings, weather: S.glance?.weather, docket: addonPart('docket'), scene: addonPart('scene'), beam: [addonPart('beam'), beamPick, S.shelf?.items.length], vitals: addonPart('vitals'), relay: addonPart('relay') };
    const use = { home: ['media', 'timers', 'match', 'shelf', 'weather', 'settings'], media: ['media', 'settings'], timers: ['timers', 'settings'], match: ['match'], shelf: ['shelf', 'settings'], docket: ['docket'], scene: ['scene'], beam: ['beam'], vitals: ['vitals'], relay: ['relay'] }[view] || [];
    return view + '|' + sub.timers + sub.match + '|' + JSON.stringify(use.map((k) => parts[k]));
  }
  function headKey() {
    const w = S.glance?.weather;
    return JSON.stringify([view, pinned, enabledViews(), !!leadTimer(), liveMatch()?.state, np()?.state, S.shelf?.items.length, w && [w.temp, w.icon], geo().style, Math.floor(Date.now() / 60e3), !!rec(), beamLive().length, (ad('relay').data?.accounts || []).some((a) => a.unread && a.platform !== 'chats')]);
  }
  function renderHead() {
    lastHeadKey = headKey();
    const vs = VIEWS.filter(([k]) => enabledViews().includes(k));
    const dot = (k) => {
      if (k === 'timers' && leadTimer()) return '<span class="dot" style="--c:var(--timer)"></span>';
      if (k === 'match' && liveMatch()?.state === 'live') return '<span class="dot" style="--c:var(--match)"></span>';
      if (k === 'media' && np()?.state === 'playing') return '<span class="dot" style="--c:rgb(var(--art))"></span>';
      if (k === 'shelf' && S.shelf.items.length) return '<span class="dot" style="--c:var(--shelf)"></span>';
      if (k === 'docket' && rec()) return '<span class="dot" style="--c:var(--red)"></span>';
      if (k === 'beam' && beamLive().length) return '<span class="dot" style="--c:var(--shelf)"></span>';
      if (k === 'relay' && (ad('relay').data?.accounts || []).some((a) => a.unread && a.platform !== 'chats')) return '<span class="dot" style="--c:var(--sky)"></span>';
      return '';
    };
    const addonTabs = ADDON_VIEWS.filter(([k]) => addonOn(k)).map(([k, ic, label]) => `<button class="tab ${view === k ? 'on' : ''}" data-view="${k}" title="${label}">${icon(ic, 17)}${dot(k)}</button>`).join('');
    const tabs = `<div class="tabs">${vs.map(([k, ic, label]) => `<button class="tab ${view === k ? 'on' : ''}" data-view="${k}" title="${label}">${icon(ic, 17)}${dot(k)}</button>`).join('')}</div>`;
    const w = S.glance.weather;
    const wx = mods().weather && w ? `<span class="wx-ic ${w.icon}">${icon(w.icon, 15)}</span><span class="tnum">${w.temp}°</span>` : '';
    const right = `<div class="head-r">${addonTabs ? `<div class="tabs addon-tabs">${addonTabs}</div>` : ''}${hw() && !addonTabs ? `<span class="head-mid" style="flex:none;margin-right:6px">${wx}</span>` : ''}<button class="ib ${pinned ? 'on' : ''}" data-act="pin" title="${pinned ? 'Stays open · click to let it close' : 'Keep open'}">${icon(pinned ? 'pin' : 'pinOff', 16)}</button><button class="ib" data-act="settings" title="Settings">${icon('gear', 16)}</button></div>`;
    const mid = hw() ? `<div class="grow"></div><div class="notchgap" style="--gapw:${geo().notchWidth}px"></div><div class="grow"></div>` : `<div class="head-mid tnum">${esc(clock())} ${esc(ampm())} · ${esc(dateStr())}${wx ? ` · ${wx}` : ''}</div>`;
    head.innerHTML = tabs + mid + right;
  }

  // ---------------------------------------------------------------- views
  function renderView(fresh = false) {
    if (mode !== 'open') return;
    const fn = { home: vHome, media: vMedia, timers: vTimers, match: vMatch, shelf: vShelf, docket: vDocket, scene: vScene, beam: vBeam, vitals: vVitals, relay: vRelay }[view] || vHome;
    const keepFocus = document.activeElement && viewEl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' ? { id: document.activeElement.id, v: document.activeElement.value, s: document.activeElement.selectionStart } : null;
    lastViewKey = viewKey();
    viewEl.innerHTML = `<div class="view-in" ${fresh ? '' : 'style="animation:none"'}>${fn()}</div>`;
    if (keepFocus?.id) { const el = document.getElementById(keepFocus.id); if (el) { el.value = keepFocus.v; el.focus(); try { el.setSelectionRange(keepFocus.s, keepFocus.s); } catch (_) {} } }
    if (view === 'shelf') thumbs();
    tick();
  }

  // ---- home
  function vHome() {
    const cards = [];
    if (mods().media) cards.push(cardMedia());
    if (mods().timers) cards.push(cardTimer());
    if (mods().match) cards.push(cardMatch());
    if (mods().weather && cards.length < 3) cards.push(cardWeather());
    if (cards.length < 3 && mods().shelf) cards.push(cardShelf());
    const cols = cards.length === 3 ? '1.35fr 1fr 1fr' : cards.length === 2 ? '1.3fr 1fr' : '1fr';
    return `<div class="home" style="grid-template-columns:${cols}">${cards.join('')}<div class="strip">${strip()}</div></div>`;
  }
  function strip() {
    const out = [`<span class="st"><b class="tnum">${esc(clock())}</b> ${esc(dateStr())}</span>`];
    const w = S.glance.weather;
    if (mods().weather && w && !(!mods().media || !mods().timers || !mods().match)) out.push(`<span class="st"><span class="wx-ic ${w.icon}">${icon(w.icon, 14)}</span><b class="tnum">${w.temp}°</b> ${esc(w.label)} · H ${w.hi}° L ${w.lo}°</span>`);
    if (mods().system) {
      if (battery) out.push(`<span class="st">${icon(battery.charging ? 'bolt' : 'battery', 14)}<b class="tnum">${Math.round(battery.level * 100)}%</b></span>`);
      const sys = S.glance.sys;
      if (sys) {
        if (sys.cpu != null) out.push(`<span class="st" title="Processor">${icon('cpu', 14)}<span class="meter" style="--c:var(--sky)"><i style="width:${sys.cpu}%"></i></span><b class="tnum">${sys.cpu}%</b></span>`);
        if (sys.mem) out.push(`<span class="st" title="Memory in use">${icon('memory', 14)}<span class="meter" style="--c:var(--focus)"><i style="width:${sys.mem.pct}%"></i></span><b class="tnum">${sys.mem.pct}%</b></span>`);
      }
    }
    return out.join('');
  }
  function cardMedia() {
    const n = np();
    if (!n) return `<div class="card click" data-view="media"><div class="card-h">${icon('music', 13)} Now playing</div><div class="empty"><b>Nothing playing</b>${S.platform === 'darwin' ? 'Play something in Music or Spotify.' : 'Play something in any app that shows in Windows media controls.'}</div></div>`;
    const pct = n.duration ? (mediaPos() / n.duration) * 100 : 0;
    return `<div class="card"><div class="mini-np">${n.art ? `<img class="art" src="${n.art}" alt="" data-view="media" style="cursor:pointer">` : `<div class="art" style="display:grid;place-items:center;color:var(--media)" data-view="media">${icon('music', 24)}</div>`}<div class="grow"><div class="np-t ell">${esc(n.title)}</div><div class="np-a ell">${esc(n.artist)}</div>
      <div class="ctl"><button class="ib sm" data-act="media" data-cmd="prev" ${n.canPrev ? '' : 'disabled'}>${icon('prev', 15)}</button><button class="ib" data-act="media" data-cmd="toggle">${icon(n.state === 'playing' ? 'pause' : 'play', 20)}</button><button class="ib sm" data-act="media" data-cmd="next" ${n.canNext ? '' : 'disabled'}>${icon('next', 15)}</button></div></div></div>
      <div class="pbar"><i data-live="mbar" style="width:${pct}%"></i></div></div>`;
  }
  function cardTimer() {
    const l = leadTimer();
    if (!l) return `<div class="card"><div class="card-h">${icon('timer', 13)} Timer</div><div class="presets">${S.settings.presets.slice(0, 5).map((m) => `<button class="chip" data-act="quick" data-min="${m}">${m < 60 ? `${m}m` : `${m / 60}h`}</button>`).join('')}<button class="chip" data-act="focusStart" style="color:var(--focus)">Focus</button></div></div>`;
    if (l.kind === 'timer') { const t = l.t; return `<div class="card click" data-view="timers"><div class="card-h" style="color:var(--timer)">${icon('timer', 13)} ${esc(t.label)}</div><div style="display:flex;align-items:center;gap:12px">${ring(t.state === 'done' ? 1 : timerLeft(t) / t.duration, 46, 'var(--timer)', 4, '', t.state === 'done' ? 'ringing' : '')}<div><div class="big-time tnum" data-live="timer" data-id="${t.id}">${t.state === 'done' ? 'Done' : fmt(timerLeft(t))}</div><div class="np-a">${t.state === 'paused' ? 'Paused' : t.state === 'done' ? 'Finished' : 'Running'}${S.timers.list.length > 1 ? ` · +${S.timers.list.length - 1}` : ''}</div></div></div></div>`; }
    if (l.kind === 'focus') { const f = l.f; return `<div class="card click" data-view="timers" data-sub="focus"><div class="card-h" style="color:var(--focus)">${icon('focus', 13)} ${f.phase === 'work' ? `Focus · ${f.cycle}` : 'Break'}</div><div style="display:flex;align-items:center;gap:12px">${ring(1 - focusLeft(f) / f.duration, 46, f.phase === 'work' ? 'var(--focus)' : 'var(--match)', 4)}<div class="big-time tnum" data-live="focus">${fmt(focusLeft(f))}</div></div></div>`; }
    return `<div class="card click" data-view="timers" data-sub="watch"><div class="card-h" style="color:var(--sky)">${icon('stopwatch', 13)} Stopwatch</div><div class="big-time tnum" data-live="watch">${fmtWatch(watchMs())}</div></div>`;
  }
  function cardMatch() {
    const m = S.match.cur, f = S.match.follow;
    if (!f) return `<div class="card click" data-view="match"><div class="card-h">${icon('ball', 13)} Live match</div><div class="empty"><b>Pick a game</b>Follow your team or one of today's matches.</div></div>`;
    if (!m) {
      const nx = S.match.next;
      if (nx) return `<div class="card click" data-view="match"><div class="card-h">${icon('ball', 13)} Next up</div><div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:2px">${crest(nx.home.logo, 'md')}<span class="mid-time" style="font-size:15px">${esc(nx.home.short)} v ${esc(nx.away.short)}</span>${crest(nx.away.logo, 'md')}</div><div class="np-a" style="text-align:center;margin-top:8px">${esc(kickoff(nx.kickoff))}</div></div>`;
      return `<div class="card click" data-view="match"><div class="card-h">${icon('ball', 13)} ${esc(f.team?.name || 'Match')}</div><div class="empty">${S.match.loading ? 'Loading…' : S.match.error ? esc(S.match.error) : 'No match today.'}</div></div>`;
    }
    const live = m.state === 'live';
    return `<div class="card click" data-view="match"><div class="card-h" style="${live ? 'color:var(--match)' : ''}">${live ? '<span class="livedot"></span>' : icon('ball', 13)} <span class="ell">${esc(m.league?.name || '')}</span></div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:6px;text-align:center"><div>${crest(m.home.logo, 'md')}<div class="np-a ell">${esc(m.home.short)}</div></div><div class="mid-time tnum">${m.state === 'pre' ? 'v' : `${m.home.score ?? 0}–${m.away.score ?? 0}`}</div><div>${crest(m.away.logo, 'md')}<div class="np-a ell">${esc(m.away.short)}</div></div></div>
      <div class="np-a" style="text-align:center;margin-top:4px;${live ? 'color:var(--match);font-weight:600' : ''}">${live ? esc(m.label) : m.state === 'pre' ? esc(kickoff(m.kickoff)) : esc(m.detail || m.label)}</div></div>`;
  }
  function cardWeather() {
    const w = S.glance.weather;
    if (!w) return `<div class="card click" data-act="settings" data-section="weather"><div class="card-h">${icon('sun', 13)} Weather</div><div class="empty"><b>Choose a city</b>Atoll shows the forecast here.</div></div>`;
    return `<div class="card"><div class="card-h">${icon('sun', 13)} <span class="ell">${esc(w.place)}</span></div><div class="wx"><span class="wx-ic ${w.icon}">${icon(w.icon, 30)}</span><div><div class="tmp tnum">${w.temp}°</div><div class="np-a">${esc(w.label)}</div></div></div><div class="hours">${w.hours.slice(0, 4).map((h) => `<div><span>${new Date(h.t).toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/, '')}</span><span class="wx-ic ${h.icon}">${icon(h.icon, 13)}</span><b class="tnum">${h.temp}°</b></div>`).join('')}</div></div>`;
  }
  function cardShelf() {
    const n = S.shelf.items.length, c = S.shelf.clips.length;
    return `<div class="card click" data-view="shelf"><div class="card-h">${icon('tray', 13)} Shelf</div><div class="empty"><b>${n ? `${n} file${n === 1 ? '' : 's'}` : 'Drop files on the island'}</b>${c ? `${c} copied item${c === 1 ? '' : 's'}` : 'They wait here until you drag them out.'}</div></div>`;
  }

  // ---- media
  function vMedia() {
    const n = S.media.now;
    const vol = S.media.volume?.volume;
    const volRow = vol != null ? `<div class="vol">${icon(S.media.volume.muted ? 'mute' : vol < 40 ? 'volumeLow' : 'volume', 16)}<input class="slider" type="range" min="0" max="100" value="${vol}" style="--v:${vol}%" data-act="sysvol" title="System volume"></div>` : '';
    if (!n) {
      const running = S.media.running || [];
      return `<div class="media"><div class="art-lg art-ph">${icon('music', 40)}</div><div class="meta"><div class="t">Nothing playing</div><div class="a">${S.platform === 'darwin' ? (running.length ? `${esc(running.join(' and '))} ${running.length > 1 ? 'are' : 'is'} open but stopped.` : 'Atoll follows Music and Spotify.') : 'Atoll follows anything that shows in the Windows media controls: Spotify, Apple Music, browsers and more.'}</div>
        ${S.platform === 'darwin' ? `<div style="display:flex;gap:8px;margin-top:14px">${S.settings.macPlayers.map((p) => `<button class="btn sm" data-act="mediaOpen" data-p="${esc(p)}">Open ${esc(p)}</button>`).join('')}</div>` : ''}${S.media.error ? `<div class="a" style="margin-top:10px;color:var(--mut);font-size:11.5px">${esc(S.media.error.slice(0, 140))}</div>` : ''}${volRow}</div></div>`;
    }
    const pos = mediaPos(), pct = n.duration ? (pos / n.duration) * 100 : 0;
    return `<div class="media">${n.art ? `<img class="art-lg ${n.state === 'playing' ? '' : 'paused'}" src="${n.art}" alt="">` : `<div class="art-lg art-ph ${n.state === 'playing' ? '' : 'paused'}">${icon('music', 40)}</div>`}
      <div class="meta"><div class="src">${icon('music', 12)} ${esc(n.player)}${n.album ? ` · <span class="ell" style="text-transform:none;letter-spacing:0;font-weight:500">${esc(n.album)}</span>` : ''}</div><div class="t ell">${esc(n.title)}</div><div class="a ell">${esc(n.artist)}</div>
      <div class="scrub ${n.canSeek ? '' : 'off'}" data-act="seek"><div class="trk"><div class="fill" data-live="mfill" style="width:${pct}%"></div></div></div>
      <div class="times tnum"><span data-live="mpos">${fmtS(pos)}</span><span data-live="mrem">-${fmtS(Math.max(0, (n.duration || 0) - pos))}</span></div>
      <div class="transport"><button class="ib" data-act="media" data-cmd="prev" ${n.canPrev ? '' : 'disabled'} title="Previous">${icon('prev', 22)}</button><button class="ib play" data-act="media" data-cmd="toggle" title="Play/Pause">${icon(n.state === 'playing' ? 'pause' : 'play', 30)}</button><button class="ib" data-act="media" data-cmd="next" ${n.canNext ? '' : 'disabled'} title="Next">${icon('next', 22)}</button></div>
      ${volRow}</div></div>`;
  }

  // ---- timers
  function subSeg(kind, opts) { return `<div class="seg">${opts.map(([k, l]) => `<button class="${sub[kind] === k ? 'on' : ''}" data-act="sub" data-kind="${kind}" data-k="${k}">${l}</button>`).join('')}</div>`; }
  function vTimers() {
    const seg = subSeg('timers', [['timers', 'Timers'], ['focus', 'Focus'], ['watch', 'Stopwatch']]);
    if (sub.timers === 'focus') return vFocus(seg);
    if (sub.timers === 'watch') return vWatch(seg);
    const list = S.timers.list.slice().sort((a, b) => (a.state === 'done' ? -1 : b.state === 'done' ? 1 : timerLeft(a) - timerLeft(b)));
    return `<div class="timers"><div class="side">${seg}
      <div class="add"><input id="t-time" class="field tnum ${lastErr ? 'err' : ''}" placeholder="5:00" style="flex:.8" title="${esc(lastErr || 'Minutes, m:ss, 90s or 1h 15m')}"><input id="t-label" class="field" placeholder="Label" style="flex:1.2"><button class="round-btn acc" data-act="addTimer" title="Start">${icon('play', 14)}</button></div>
      <div class="presets">${S.settings.presets.map((m) => `<button class="chip" data-act="quick" data-min="${m}">${m < 60 ? `${m} min` : `${m / 60} h`}</button>`).join('')}</div></div>
      <div class="tlist">${list.length ? list.map(timerRow).join('') : `<div class="dropzone" style="border-style:solid;border-color:transparent;background:rgba(255,255,255,.04)">${icon('timer', 26)}<span>No timers running.<br>Type a time or tap a preset.</span></div>`}</div></div>`;
  }
  function timerRow(t) {
    const left = timerLeft(t), done = t.state === 'done';
    return `<div class="trow ${t.state}">${ring(done ? 1 : left / t.duration, 40, 'var(--timer)', 3.5, done ? `<span style="color:var(--timer)">${icon('bell', 16)}</span>` : '', done ? 'ringing' : '')}<div class="grow"><div class="lbl ell">${esc(t.label)}</div><div class="tm tnum" data-live="timer" data-id="${t.id}">${done ? 'Done' : fmt(left)}</div></div>
      <div class="acts">${done ? `<button class="round-btn" data-act="timerRestart" data-id="${t.id}" title="Again">${icon('restart', 15)}</button><button class="round-btn acc" data-act="stopRing" data-id="${t.id}" title="Stop">${icon('check', 16)}</button>` : `<button class="round-btn" data-act="timerExtend" data-id="${t.id}" title="Add a minute"><span style="font-size:11px;font-weight:700">+1</span></button><button class="round-btn acc" data-act="timerToggle" data-id="${t.id}" title="${t.state === 'running' ? 'Pause' : 'Resume'}">${icon(t.state === 'running' ? 'pause' : 'play', 14)}</button><button class="round-btn" data-act="timerRemove" data-id="${t.id}" title="Cancel">${icon('x', 14)}</button>`}</div></div>`;
  }
  function vFocus(seg) {
    const f = S.timers.focus, plan = S.settings.focus;
    const color = !f || f.phase === 'work' ? 'var(--focus)' : 'var(--match)';
    const left = f ? focusLeft(f) : plan.work * 60e3, dur = f ? f.duration : plan.work * 60e3;
    const cyc = f ? ((f.cycle - 1) % plan.every) + (f.phase === 'work' ? 0 : 1) : 0;
    return `<div style="display:flex;flex-direction:column;height:100%;gap:6px">${seg}<div class="focus-box">${ring(1 - left / dur, 132, color, 7, `<div style="text-align:center"><div class="big-time tnum disp" data-live="focus">${fmt(left)}</div><div class="phase" style="color:${color}">${!f ? 'Ready' : f.phase === 'work' ? 'Focus' : f.phase === 'long' ? 'Long break' : 'Break'}</div></div>`)}
      <div class="grow"><div class="np-t">${f ? (f.phase === 'work' ? `Session ${f.cycle}` : 'Recharge') : 'Focus sessions'}</div><div class="np-a">${plan.work} min focus, ${plan.short} min breaks, a ${plan.long} min break every ${plan.every}.</div>
        <div class="dots">${Array.from({ length: plan.every }, (_, i) => `<i class="${i < cyc ? 'on' : ''}"></i>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:14px">${!f ? `<button class="btn acc" style="--c:var(--focus)" data-act="focusStart">${icon('play', 12)} Start</button>` : `${f.running ? `<button class="btn" data-act="focusPause">${icon('pause', 12)} Pause</button>` : `<button class="btn acc" style="--c:var(--focus)" data-act="focusStart">${icon('play', 12)} Resume</button>`}<button class="btn" data-act="focusSkip">${icon('skip', 13)} Skip</button><button class="btn ghost" data-act="focusStop">End</button>`}</div></div></div></div>`;
  }
  function vWatch(seg) {
    const w = S.timers.watch;
    return `<div style="display:flex;flex-direction:column;height:100%;gap:6px">${seg}<div class="watch-box"><div style="min-width:230px"><div class="tnum disp" style="font-size:46px;font-weight:600;letter-spacing:.5px;line-height:1.1" data-live="watch">${fmtWatch(watchMs())}</div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn acc" style="--c:${w.running ? 'var(--red)' : 'var(--match)'}" data-act="watchToggle">${w.running ? 'Stop' : w.before ? 'Resume' : 'Start'}</button><button class="btn" data-act="${w.running ? 'watchLap' : 'watchReset'}" ${!w.running && !w.before ? 'disabled' : ''}>${w.running ? 'Lap' : 'Reset'}</button></div></div>
      <div class="laps tnum">${w.laps.map((l, i) => `<div><span>Lap ${w.laps.length - i}</span><span>${fmt(l.split, false)}</span><span style="color:var(--mut)">${fmt(l.total, false)}</span></div>`).join('') || '<div style="border:0;color:var(--mut)">Laps show here.</div>'}</div></div></div>`;
  }

  // ---- match
  function vMatch() {
    const f = S.match.follow;
    if (!f || sub.match === 'pick' || sub.match === 'team') return vPicker();
    const m = S.match.cur;
    const bar = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="np-a ell grow">${f.mode === 'team' ? `Following ${esc(f.team.name)}` : 'Pinned match'}${S.match.error ? ` · <span style="color:var(--mut)">${esc(S.match.error)}</span>` : ''}</span><button class="btn sm ghost" data-act="matchRefresh">${icon('refresh', 13)}</button><button class="btn sm" data-act="sub" data-kind="match" data-k="pick">Change</button></div>`;
    if (!m) {
      const nx = S.match.next;
      return `<div style="display:flex;flex-direction:column;height:100%">${bar}<div class="nextup">${S.match.loading ? '<div class="np-a">Loading…</div>' : nx ? `<div class="np-a">Next match · ${esc(nx.league || '')}</div><div style="display:flex;align-items:center;gap:16px">${crest(nx.home.logo, 'lg')}<div class="mid-time">${esc(nx.home.short)} <span style="color:var(--mut)">v</span> ${esc(nx.away.short)}</div>${crest(nx.away.logo, 'lg')}</div><div class="st" style="font-weight:600">${esc(kickoff(nx.kickoff))}</div>` : `<div class="np-a">${esc(f.team?.name || 'This team')} has no match coming up.</div>`}</div></div>`;
    }
    const live = m.state === 'live';
    const evs = m.events.slice().reverse(); evMatch = m;
    return `<div style="display:flex;flex-direction:column;height:100%">${bar}<div class="match" style="flex:1;min-height:0">
      <div class="board"><div class="comp">${m.league?.logo ? `<img src="${crestUrl(m.league.logo)}" style="width:14px;height:14px;object-fit:contain" onerror="this.remove()">` : ''}<span class="ell">${esc(m.league?.name || '')}${m.league?.round ? ` · ${esc(m.league.round)}` : ''}</span></div>
        <div class="teams"><div class="team">${crest(m.home.logo, 'lg')}<div class="nm">${esc(m.home.name)}${m.home.red ? '<span class="red"></span>' : ''}</div></div><div class="sc tnum disp">${m.state === 'pre' ? '<span style="font-size:22px;color:var(--fg-2)">v</span>' : `${m.home.score ?? 0}<span style="color:var(--mut);margin:0 4px">–</span>${m.away.score ?? 0}`}</div><div class="team">${crest(m.away.logo, 'lg')}<div class="nm">${esc(m.away.name)}${m.away.red ? '<span class="red"></span>' : ''}</div></div></div>
        <div class="st ${live ? 'live' : ''}">${live ? '<span class="livedot"></span>' : ''}${esc(live ? m.detail || m.label : m.state === 'pre' ? `Kick-off ${kickoff(m.kickoff)}` : m.detail || m.label)}</div>${m.penalties ? `<div class="np-a">Pens ${esc(m.penalties.join('–'))}</div>` : m.aggregate ? `<div class="np-a">Agg ${esc(m.aggregate)}</div>` : ''}</div>
      <div class="evts">${evs.length ? evs.map(evRow).join('') : `<div class="empty" style="padding:8px">${m.state === 'pre' ? `${m.venue ? esc(m.venue) + '<br>' : ''}Goals and cards will show here.` : 'No goals or cards yet.'}</div>`}</div></div></div>`;
  }
  let evMatch = null;
  function evRow(e) {
    if (e.kind === 'period') return `<div class="evt period">${esc(e.label)}${e.score ? ` · ${e.score[0]}–${e.score[1]}` : ''}</div>`;
    const ic = e.kind === 'goal' ? `<span style="color:var(--match)">${icon('ball', 15)}</span>` : e.kind === 'yellow' ? '<span class="yc"></span>' : e.kind === 'red' || e.kind === 'secondYellow' ? '<span class="rc"></span>' : e.kind === 'missedPen' ? `<span style="color:var(--red)">${icon('x', 14)}</span>` : `<span style="color:var(--mut)">${icon('info', 14)}</span>`;
    const what = e.kind === 'goal' ? `${esc(e.player)}${e.penalty ? '<small>pen</small>' : ''}${e.ownGoal ? '<small>og</small>' : ''}${e.assist ? `<small>${esc(e.assist)}</small>` : ''}` : e.kind === 'var' ? esc(e.label || 'VAR') : e.kind === 'missedPen' ? `${esc(e.player)}<small>missed pen</small>` : esc(e.player);
    return `<div class="evt"><span class="min tnum">${esc(e.minute)}${e.added ? `+${esc(e.added)}` : ''}'</span>${ic}<span class="who ell">${what}</span><span class="np-a tnum" style="font-size:11.5px;font-weight:600">${e.kind === 'goal' && e.score ? `${e.score[0]}–${e.score[1]}` : ''}</span>${crest(e.home ? evMatch?.home.logo : evMatch?.away.logo)}</div>`;
  }
  function vPicker() {
    const k = sub.match === 'team' ? 'team' : 'pick';
    const seg = `<div class="seg"><button class="${k === 'pick' ? 'on' : ''}" data-act="sub" data-kind="match" data-k="pick">Today</button><button class="${k === 'team' ? 'on' : ''}" data-act="sub" data-kind="match" data-k="team">Follow a team</button></div>`;
    const back = S.match.follow ? `<button class="btn sm ghost" data-act="sub" data-kind="match" data-k="today">Back</button>` : '';
    if (k === 'team') {
      const res = teamResults;
      return `<div class="picker"><div class="bar">${seg}<input id="m-team" class="field grow" placeholder="Search a team: Arsenal, Inter Miami, Brazil…" value="${esc(teamQ)}">${back}</div>
        <div class="list">${!res ? `<div class="empty" style="padding:8px">Atoll finds your team's match every day and shows what's next in between.${S.match.follow?.mode === 'team' ? `<button class="btn sm" data-act="matchClear">Stop following ${esc(S.match.follow.team.name)}</button>` : ''}</div>` : res.length ? res.map((t, i) => `<div class="trow-team" data-act="followTeam" data-i="${i}">${crest(t.logo, 'md')}<div class="grow"><div class="np-t" style="font-size:13px">${esc(t.name)}</div><div class="np-a" style="font-size:11.5px">${esc(t.country || '')}</div></div>${icon('chevronRight', 16)}</div>`).join('') : '<div class="empty" style="padding:8px">No teams found.</div>'}</div></div>`;
    }
    const q = pickerQ.trim().toLowerCase();
    let body = '<div class="empty" style="padding:8px">Loading today’s matches…</div>';
    if (pickerData?.error) body = `<div class="empty" style="padding:8px"><b>Can’t load matches</b>${esc(pickerData.error)}<button class="btn sm" data-act="pickerReload">Try again</button></div>`;
    else if (pickerData?.rows) {
      const groups = pickerData.rows.map((l) => ({ ...l, matches: l.matches.filter((m) => !q || `${m.home.name} ${m.away.name} ${l.name}`.toLowerCase().includes(q)) })).filter((l) => l.matches.length);
      body = groups.length ? groups.slice(0, 40).map((l) => `<div class="lg">${l.logo ? `<img src="${crestUrl(l.logo)}" alt="" onerror="this.remove()">` : ''}<span class="ell">${esc(l.name)}</span></div>${l.matches.map((m) => `<div class="mrow" data-act="followMatch" data-id="${m.id}"><div class="h"><span class="ell">${esc(m.home.name)}</span>${crest(m.home.logo)}</div><div class="mid tnum ${m.state === 'live' ? 'live' : ''}">${m.state === 'pre' ? `${esc(koTime(m.kickoff))}<small>${esc(koDay(m.kickoff))}</small>` : `${m.home.score ?? 0} – ${m.away.score ?? 0}<small>${esc(m.label || '')}</small>`}</div><div class="a">${crest(m.away.logo)}<span class="ell">${esc(m.away.name)}</span></div></div>`).join('')}`).join('') : '<div class="empty" style="padding:8px">No matches match that.</div>';
      if (pickerData.backup) body = `<div class="np-a" style="padding:2px 6px 6px">Backup scores from ${esc(pickerData.backup)}.</div>` + body;
    }
    return `<div class="picker"><div class="bar">${seg}<input id="m-q" class="field grow" placeholder="Filter by team or competition" value="${esc(pickerQ)}">${back}</div><div class="list">${body}</div></div>`;
  }
  async function loadPicker(force) {
    if (pickerData && !force && Date.now() - pickerData.at < 60e3) return;
    try { const r = await A.call('matchList'); pickerData = { ...r, at: Date.now() }; } catch (e) { pickerData = { error: String(e.message || e).replace(/^Error invoking remote method 'atoll': (Error: )?/, ''), at: Date.now() }; }
    if (view === 'match') renderView();
  }

  // ---------------------------------------------------------------- add-ons (Docket, Scene, Beam, Vitals, Relay)
  const ADDON_VIEWS = [['docket', 'mic', 'Docket'], ['scene', 'layers', 'Scene'], ['beam', 'send', 'Beam'], ['vitals', 'gauge', 'Vitals'], ['relay', 'mail', 'Relay']];
  const addonOn = (id) => !!S.settings.addons?.[id];
  const ad = (id) => (S.addons && S.addons[id]) || { up: false, installed: null, data: {} };
  const rec = () => { const s = addonOn('docket') ? ad('docket').data?.status : null; return s && s.recording ? s : null; };
  const recElapsed = (s) => (s.elapsed || 0) + (s.paused ? 0 : Math.max(0, (Date.now() - (s.at || Date.now())) / 1000));
  const beamLive = () => (addonOn('beam') ? (ad('beam').data?.transfers || []).filter((t) => t.status === 'active') : []);
  const beamPct = (list) => { const b = list.reduce((x, t) => x + (t.bytes || 0), 0), tot = list.reduce((x, t) => x + (t.total || 0), 0); return tot ? b / tot : 0; };

  /** Shown in an add-on's view when its app isn't running. */
  function notUp(id, ic, color) {
    const s = ad(id), name = ADDON_VIEWS.find((v) => v[0] === id)[2];
    const body = s.launching ? `Opening ${name}…` : s.installed === false ? `${name} isn’t installed on this computer. Add it from Utility Hub, then it shows up here.` : `${name} isn’t running. Atoll connects as soon as it opens.`;
    return `<div class="nextup"><span style="color:${color}">${icon(ic, 30)}</span><div class="np-t">${esc(name)}</div><div class="np-a" style="max-width:380px">${esc(body)}</div>${s.installed !== false && !s.launching ? `<button class="btn acc" style="--c:${color}" data-act="addonLaunch" data-id="${id}">Open ${esc(name)}</button>` : ''}</div>`;
  }

  // ---- Docket
  function vDocket() {
    const s = ad('docket');
    if (!s.up) return notUp('docket', 'mic', 'var(--red)');
    const st = s.data.status || {};
    if (st.recording) {
      return `<div class="docket"><div class="rec-ring ${st.paused ? 'paused' : ''}">${icon('mic', 30)}</div>
        <div class="grow"><div class="src" style="color:var(--red)"><span class="recdot ${st.paused ? 'paused' : ''}"></span>${st.paused ? 'Paused' : 'Taking notes'}</div>
          <div class="t ell">${esc(st.title || 'Meeting')}</div><div class="big-time tnum disp" data-live="rec">${fmt(recElapsed(st) * 1000, false)}</div>
          ${st.line ? `<div class="np-a ell" style="margin-top:4px">“${esc(st.line)}”</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:12px">${st.paused ? `<button class="btn" data-act="docket" data-cmd="resume">${icon('play', 12)} Resume</button>` : `<button class="btn" data-act="docket" data-cmd="pause">${icon('pause', 12)} Pause</button>`}<button class="btn" data-act="docket" data-cmd="mark">${icon('flag', 13)} Mark</button><button class="btn acc" style="--c:var(--red)" data-act="docket" data-cmd="stop">${icon('stop', 12)} Stop and summarize</button><button class="btn ghost" data-act="docket" data-cmd="open">Open Docket</button></div></div></div>`;
    }
    const det = st.detected;
    return `<div class="docket"><div class="rec-ring idle">${icon('mic', 30)}</div><div class="grow">
      ${det ? `<div class="src" style="color:var(--red)">${icon('video', 12)} ${esc(det.app || 'Call')} call detected</div><div class="t ell">${esc(det.title || 'Meeting in progress')}</div>` : `<div class="src">${icon('mic', 12)} Docket</div><div class="t">Not taking notes</div><div class="np-a">Docket transcribes on this computer and keeps one to-do list from every meeting.</div>`}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn acc" style="--c:var(--red)" data-act="docket" data-cmd="start">${icon('mic', 13)} ${det ? 'Take notes' : 'Start notes'}</button><button class="btn ghost" data-act="docket" data-cmd="open">Open Docket</button></div></div></div>`;
  }

  // ---- Scene
  const SCENE_C = { amber: ['#ffb648', '#ff8a5c'], rose: ['#ff6f91', '#c86bff'], violet: ['#9d86ff', '#5b8cff'], blue: ['#4fa3ff', '#38d4e0'], teal: ['#2fd3c0', '#4fa3ff'], green: ['#56d67a', '#2fd3c0'], red: ['#ff5f5f', '#ffb648'], slate: ['#9aa3b5', '#6d7790'] };
  function vScene() {
    const s = ad('scene');
    if (!s.up) return notUp('scene', 'layers', 'var(--timer)');
    const l = s.data.list || { scenes: [] };
    if (!l.scenes.length) return `<div class="nextup"><span style="color:var(--timer)">${icon('layers', 30)}</span><div class="np-t">No scenes yet</div><div class="np-a">Make one in Scene and it shows up here.</div><button class="btn" data-act="sceneOpen">Open Scene</button></div>`;
    return `<div style="display:flex;flex-direction:column;height:100%;gap:8px"><div style="display:flex;align-items:center;gap:8px"><span class="np-a grow">${l.busy ? 'Switching…' : l.activeId ? `Now: <b style="color:var(--fg)">${esc((l.scenes.find((x) => x.id === l.activeId) || {}).name || '')}</b>` : 'Pick a scene to switch everything at once'}</span>${l.hasPrevious ? `<button class="btn sm" data-act="scenePrev">${icon('restart', 13)} Back to before</button>` : ''}<button class="btn sm ghost" data-act="sceneOpen">Open Scene</button></div>
      <div class="scenes">${l.scenes.map((x) => { const c = SCENE_C[x.color] || SCENE_C.violet; return `<button class="scn ${x.id === l.activeId ? 'on' : ''}" data-act="sceneGo" data-id="${esc(x.id)}" style="--c:${c[0]};--c2:${c[1]}"><span class="sw">${esc((x.name || '?').slice(0, 1).toUpperCase())}</span><span class="ell">${esc(x.name)}</span>${x.id === l.activeId ? icon('check', 14) : ''}</button>`; }).join('')}</div></div>`;
  }

  // ---- Beam
  let beamPick = null;
  function vBeam() {
    const s = ad('beam');
    if (!s.up) return notUp('beam', 'send', 'var(--shelf)');
    const peers = s.data.peers || [], tr = s.data.transfers || [];
    const devIc = (p) => (p.dev === 'phone' ? 'phone' : p.dev === 'tablet' ? 'tablet' : p.dev === 'desktop' ? 'desktop' : 'laptop');
    const files = S.shelf.items.length;
    const pick = peers.find((p) => p.id === beamPick);
    const devs = peers.length ? `<div class="peers">${peers.map((p) => `<div class="peer ${p.id === beamPick ? 'on' : ''}" data-act="beamPick" data-peer="${esc(p.id)}" title="Drop files here to send them to ${esc(p.name)}"><div class="pav">${icon(devIc(p), 24)}</div><div class="nm ell">${esc(p.name)}</div></div>`).join('')}</div>` : `<div class="dropzone" style="border-style:solid;border-color:transparent;background:rgba(255,255,255,.04)">${icon('send', 24)}<span>No devices nearby yet. Open Beam on your other computers, or scan its code with your phone.</span></div>`;
    const bar = pick ? `<div class="beam-bar"><span class="np-a grow">Send to <b style="color:var(--fg)">${esc(pick.name)}</b>: drop files on it, or</span><button class="btn sm" data-act="beamClip">${icon('clipboard', 13)} What I copied</button><button class="btn sm" data-act="beamShelf" ${files ? '' : 'disabled'}>${icon('tray', 13)} Shelf files${files ? ` (${files})` : ''}</button></div>` : `<div class="beam-bar"><span class="np-a grow">${peers.length ? 'Drop files on a device to send them, or pick one for more.' : ''}</span><button class="btn sm ghost" data-act="beamOpen">Open Beam</button></div>`;
    const list = tr.length ? `<div class="xfers">${tr.slice(0, 3).map((t) => { const pct = t.total ? Math.round((100 * t.bytes) / t.total) : 0; return `<div class="xfer"><span style="color:var(--shelf)">${icon(t.dir === 'out' ? 'send' : 'reveal', 14)}</span><span class="ell grow">${t.dir === 'out' ? 'To' : 'From'} ${esc(t.peer || '')}${t.label ? ` · ${esc(t.label)}` : ''}</span><span class="np-a tnum">${t.status === 'asking' ? 'Waiting for you in Beam' : t.status === 'waiting' ? 'Waiting for them' : `${pct}%`}</span><span class="meter" style="--c:var(--shelf);width:60px"><i style="width:${pct}%"></i></span></div>`; }).join('')}</div>` : '';
    return `<div style="display:flex;flex-direction:column;height:100%;gap:8px">${devs}${bar}${list}</div>`;
  }

  // ---- Vitals
  function spark(vals, color, max = 100) {
    const v = (vals || []).slice(-40); if (v.length < 2) return '<svg class="spk"></svg>';
    const w = 120, h = 30, step = w / (v.length - 1);
    const pts = v.map((x, i) => `${(i * step).toFixed(1)},${(h - (Math.max(0, Math.min(max, x ?? 0)) / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
    return `<svg class="spk" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}" fill-opacity=".14" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const bytes = (n) => { if (n == null) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`; };
  function vVitals() {
    const s = ad('vitals');
    if (!s.up) return notUp('vitals', 'gauge', 'var(--match)');
    const t = s.data.stats || {}, h = s.data.history || {};
    const tile = (label, ic, val, unit, hist, color, sub = '') => `<div class="vt"><div class="card-h" style="margin:0 0 4px">${icon(ic, 13)} ${label}</div><div class="vv tnum"><b>${val == null ? '—' : val}</b>${val == null ? '' : `<small>${unit}</small>`}</div>${spark(hist, color)}<div class="np-a ell" style="font-size:11px">${sub}</div></div>`;
    const temp = t.temp != null ? Math.round(t.temp) : t.gpu?.temp != null ? Math.round(t.gpu.temp) : null;
    return `<div class="vitals">${tile('Processor', 'cpu', t.cpu, '%', h.cpu, '#64d2ff', t.thermal ? `Thermal: ${esc(t.thermal)}` : '')}${tile('Memory', 'memory', t.mem?.pct, '%', h.mem, '#bf5af2', t.mem ? `${bytes(t.mem.used)} of ${bytes(t.mem.total)}${t.mem.pressure && t.mem.pressure !== 'normal' ? ` · ${esc(t.mem.pressure)}` : ''}` : '')}${tile('Graphics', 'display', t.gpu?.util, '%', h.gpu, '#30d158', esc(t.gpu?.name || ''))}${tile('Temperature', 'gauge', temp, '°C', h.temp, '#ff9f0a', t.net ? `↓ ${bytes(t.net.rx)}/s · ↑ ${bytes(t.net.tx)}/s` : '')}
      <div class="strip" style="grid-column:1/-1"><span class="st">${icon('gauge', 14)} Live from Vitals${t.uptime ? ` · up ${Math.floor(t.uptime / 3600)} h` : ''}</span><span class="grow"></span><button class="btn sm ghost" data-act="vitalsOpen">Open Vitals</button></div></div>`;
  }

  // ---- Relay
  function vRelay() {
    const s = ad('relay');
    if (!s.up) return notUp('relay', 'mail', 'var(--sky)');
    const acc = (s.data.accounts || []).filter((a) => a.platform !== 'chats' || a.unread);
    const recent = s.data.recent || [];
    const chips = acc.length ? `<div class="accts">${acc.map((a) => `<button class="acct" data-act="relayOpen" data-id="${esc(a.id)}"><span class="cdot" style="background:${esc(a.color || '#64d2ff')}"></span><span class="ell">${esc(a.name || a.email || a.platform)}</span>${a.unread ? `<b class="tnum">${a.unread > 999 ? '999+' : a.unread}</b>` : ''}</button>`).join('')}</div>` : '<div class="np-a">No inboxes in Relay yet.</div>';
    const list = recent.length ? `<div class="mails">${recent.slice(0, 8).map((m) => `<div class="mail" data-act="relayOpen" data-id="${esc(m.accountId)}"><span class="cdot" style="background:${esc(m.color || '#64d2ff')}"></span><div class="grow"><div class="ell"><b>${esc(m.from || m.account || 'New email')}</b> <span class="np-a">· ${esc(m.account || '')}</span></div><div class="np-a ell">${esc(m.subject || 'New message')}</div></div><span class="ago">${ago(m.at || Date.now())}</span></div>`).join('')}</div>` : '<div class="empty" style="padding:8px">New email shows here as it arrives while Relay is open.</div>';
    return `<div style="display:flex;flex-direction:column;height:100%;gap:8px"><div style="display:flex;align-items:flex-start;gap:8px">${chips}<span class="grow"></span><button class="btn sm ghost" data-act="relayOpen">Open Relay</button></div>${list}</div>`;
  }

  // ---- shelf
  function vShelf() {
    const items = S.shelf.items, clips = S.shelf.clips;
    const files = items.length ? `<div class="files">${items.map((i) => `<div class="ftile" draggable="true" data-file="${i.id}" title="${esc(i.path)}"><div class="th k-${i.kind}" data-thumb="${i.kind === 'image' ? i.id : ''}">${icon({ image: 'image', video: 'video', audio: 'audio', pdf: 'doc', archive: 'archive', doc: 'doc', sheet: 'doc', slides: 'doc', code: 'file', folder: 'folder' }[i.kind] || 'file', 22)}</div><div class="nm ell">${esc(i.name)}</div><button class="x" data-act="shelfRemove" data-id="${i.id}" title="Remove from shelf">${icon('x', 11)}</button><button class="rv" data-act="shelfReveal" data-id="${i.id}" title="Show in folder">${icon('reveal', 11)}</button></div>`).join('')}</div>` : `<div class="dropzone">${icon('tray', 26)}<span>Drag files onto the island to keep them here.<br>Drag them out into any app or folder.</span></div>`;
    const cl = !S.settings.clipboard ? `<div class="empty" style="padding:6px"><b>Clipboard history is off</b><button class="btn sm" data-act="clipOn">Turn on</button></div>` : clips.length ? `<div class="clips">${clips.map((c) => `<div class="clip" data-act="clipCopy" data-id="${c.id}" title="Click to copy"><span class="tx">${esc(c.text)}</span><span class="ago">${ago(c.at)}</span><button class="ib sm x" data-act="clipForget" data-id="${c.id}" title="Forget">${icon('x', 12)}</button></div>`).join('')}</div>` : '<div class="empty" style="padding:6px">Text you copy shows here. It’s kept in memory only.</div>';
    return `<div class="shelf"><div style="display:flex;flex-direction:column;gap:6px;min-height:0"><div class="card-h" style="margin:0">${icon('tray', 13)} Files <span class="grow"></span>${items.length ? '<button class="btn sm ghost" data-act="shelfClear">Clear</button>' : ''}</div>${files}</div>
      <div style="display:flex;flex-direction:column;gap:6px;min-height:0"><div class="card-h" style="margin:0">${icon('clipboard', 13)} Copied <span class="grow"></span>${clips.length ? '<button class="btn sm ghost" data-act="clipClear">Clear</button>' : ''}</div>${cl}</div></div>`;
  }
  const thumbCache = new Map();
  function thumbs() {
    for (const el of viewEl.querySelectorAll('[data-thumb]')) {
      const id = el.dataset.thumb; if (!id) continue;
      const put = (u) => { if (u) el.innerHTML = `<img src="${u}" alt="">`; };
      if (thumbCache.has(id)) put(thumbCache.get(id));
      else A.call('shelfThumb', id).then((u) => { thumbCache.set(id, u); put(u); }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- ticking
  function tick() {
    if (mode === 'compact') { const a = activities()[0]; if (a && (a.k === 'timers' || a.k === 'match' || a.k === 'docket' || a.k === 'beam') || (!a && !notch())) layout(); }
    if (mode !== 'open') return;
    for (const el of viewEl.querySelectorAll('[data-live]')) {
      const k = el.dataset.live;
      if (k === 'timer') { const t = S.timers.list.find((x) => x.id === el.dataset.id); if (t) { el.textContent = t.state === 'done' ? 'Done' : fmt(timerLeft(t)); const r = el.closest('.trow, .card')?.querySelector('.ring .bar'); if (r && t.state !== 'done') setRing(r, timerLeft(t) / t.duration); } }
      else if (k === 'focus' && S.timers.focus) { el.textContent = fmt(focusLeft(S.timers.focus)); const r = el.closest('.ring, .card')?.querySelector('.bar'); if (r) setRing(r, 1 - focusLeft(S.timers.focus) / S.timers.focus.duration); }
      else if (k === 'watch') el.innerHTML = fmtWatch(watchMs());
      else if (k === 'rec') { const r = rec(); if (r) el.textContent = fmt(recElapsed(r) * 1000, false); }
      else if (S.media.now) {
        const n = S.media.now, p = mediaPos(), pct = n.duration ? (p / n.duration) * 100 : 0;
        if (k === 'mbar' || k === 'mfill') { if (!seeking) el.style.width = `${pct}%`; }
        if (k === 'mpos' && !seeking) el.textContent = fmtS(p);
        if (k === 'mrem' && !seeking) el.textContent = `-${fmtS(Math.max(0, (n.duration || 0) - p))}`;
      }
    }
  }
  function setRing(bar, frac) { const c = Number(bar.getAttribute('stroke-dasharray')); bar.setAttribute('stroke-dashoffset', String(c * (1 - Math.max(0, Math.min(1, frac))))); }
  setInterval(tick, 250);
  setInterval(() => { if (mode === 'compact' && !notch() && !activities().length) layout(); if (mode === 'open' && view === 'home') { const st = viewEl.querySelector('.strip'); if (st) st.innerHTML = strip(); } }, 15e3);

  // ---------------------------------------------------------------- artwork colour
  function artColor(url) {
    if (!url || url === artFor) return;
    artFor = url;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 24; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data; let best = null, bs = -1;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const sat = mx ? (mx - mn) / mx : 0; const lum = mx / 255;
          if (lum < .25 || sat < .25) continue;
          const key = `${r >> 5},${g >> 5},${b >> 5}`; const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0 }; e.n++; e.r += r; e.g += g; e.b += b; e.s += sat * lum; buckets.set(key, e);
        }
        for (const e of buckets.values()) { const score = e.n * (e.s / e.n); if (score > bs) { bs = score; best = e; } }
        artRGB = best ? [best.r / best.n, best.g / best.n, best.b / best.n].map((v) => Math.round(Math.min(255, v * 1.15))) : [255, 55, 95];
      } catch (_) { artRGB = [255, 55, 95]; }
      document.documentElement.style.setProperty('--art', artRGB.join(', '));
    };
    img.src = url;
  }

  // ---------------------------------------------------------------- sounds (made here, no audio files)
  let actx = null;
  function sound(kind) {
    const s = S.settings.sound; if (s === 'none') return;
    try {
      actx = actx || new AudioContext();
      const now = actx.currentTime;
      const note = (f, t, d, type = 'sine', g = .18) => { const o = actx.createOscillator(), v = actx.createGain(); o.type = type; o.frequency.value = f; v.gain.setValueAtTime(0, now + t); v.gain.linearRampToValueAtTime(g, now + t + .015); v.gain.exponentialRampToValueAtTime(.0001, now + t + d); o.connect(v).connect(actx.destination); o.start(now + t); o.stop(now + t + d + .05); };
      const tune = s === 'bell' ? [[880, 0, 1.4, 'triangle'], [1320, .0, 1.2, 'sine', .08], [880, .5, 1.4, 'triangle']] : s === 'pulse' ? [[660, 0, .12, 'square', .06], [660, .18, .12, 'square', .06], [660, .36, .12, 'square', .06]] : [[1046.5, 0, .5], [1318.5, .12, .5], [1568, .24, .8]];
      const goal = [[784, 0, .25, 'triangle'], [988, .12, .25, 'triangle'], [1175, .24, .5, 'triangle'], [1568, .36, .7, 'sine', .12]];
      const soft = [[880, 0, .5, 'sine', .12], [1174.7, .14, .7, 'sine', .1]];
      for (const n of kind === 'goal' ? goal : kind === 'soft' ? soft : tune) note(n[0], n[1], n[2], n[3], n[4]);
    } catch (_) {}
  }
  setInterval(() => { if (!ringing) return; const t = S.timers.list.find((x) => x.id === ringing); if (!t || t.state !== 'done' || Date.now() - (t.doneAt || 0) > 60e3) { ringing = null; return; } sound('ring'); }, 2200);

  // ---------------------------------------------------------------- toasts
  function toast(text) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = text; isl.appendChild(el); setTimeout(() => el.remove(), 2600); }

  // ---------------------------------------------------------------- input
  isl.addEventListener('mouseenter', () => {
    clearTimeout(leaveT);
    if (mode === 'open' || S.settings.expandOn !== 'hover') return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => { if (mode !== 'peek' || !burstNow?.sticky) open(); }, mode === 'peek' ? 500 : S.settings.hoverDelay);
  });
  isl.addEventListener('mouseleave', () => {
    clearTimeout(hoverT);
    if (mode !== 'open' || pinned || dragging) return;
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'range' && document.activeElement.value;
    if (typing) return;
    leaveT = setTimeout(close, 420);
  });
  cmp.addEventListener('click', () => open(defaultView()));
  bubble.addEventListener('click', () => { const k = bubble.dataset.k; open(k === 'timers' ? 'timers' : k === 'match' ? 'match' : k === 'media' ? 'media' : 'home'); });
  peekEl.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) return; const b = burstNow; if (!b) return; open(b.kind === 'goal' || b.kind === 'kickoff' || b.kind === 'fulltime' ? 'match' : b.kind === 'track' ? 'media' : b.kind === 'meeting' ? 'docket' : b.kind === 'mail' ? 'relay' : 'timers'); });
  function defaultView() { const a = activities()[0]; if (!a) return 'home'; return a.k === 'timers' ? 'timers' : a.k; }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mode === 'peek') stopBurst(); else close(); } });

  head.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view]'); if (t) { view = t.dataset.view; renderHead(); renderView(true); layout(); if (view === 'match') loadPicker(); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'pin') { pinned = !pinned; renderHead(); }
    if (a.dataset.act === 'settings') { A.call('openSettings'); close(); }
  });

  function stopBurst() { if (burstNow?.kind === 'timer') A.call('timerRemove', burstNow.id); ringing = null; nextBurst(); }
  async function act(a, el, e) {
    const id = el.dataset.id;
    switch (a) {
      case 'media': return A.call('media', el.dataset.cmd);
      case 'mediaOpen': return A.call('media', 'open', el.dataset.p);
      case 'quick': return A.call('timerAdd', Number(el.dataset.min) * 60e3, '');
      case 'addTimer': return addTimer();
      case 'timerToggle': case 'timerRemove': case 'timerRestart': return A.call(a, id);
      case 'timerExtend': if (mode === 'peek') { ringing = null; nextBurst(); } return A.call('timerExtend', id, 60e3);
      case 'stopRing': ringing = null; if (mode === 'peek') nextBurst(); return A.call('timerRemove', id);
      case 'focusStart': case 'focusPause': case 'focusSkip': case 'focusStop': case 'watchToggle': case 'watchLap': case 'watchReset': if (mode === 'peek' && a === 'focusSkip') nextBurst(); return A.call(a);
      case 'sub': sub[el.dataset.kind] = el.dataset.k; renderView(); layout(); if (el.dataset.k === 'pick') loadPicker(); if (el.dataset.k === 'team') setTimeout(() => $('#m-team')?.focus(), 30); return;
      case 'followMatch': { const row = pickerData?.rows?.flatMap((l) => l.matches).find((m) => String(m.id) === String(id)); if (row) { await A.call('matchFollowMatch', row); sub.match = 'today'; renderView(); } return; }
      case 'followTeam': { const t = teamResults?.[Number(el.dataset.i)]; if (t) { await A.call('matchFollowTeam', t); sub.match = 'today'; teamResults = null; teamQ = ''; renderView(); } return; }
      case 'matchClear': await A.call('matchClear'); sub.match = 'pick'; return renderView();
      case 'matchRefresh': return A.call('matchRefresh');
      case 'pickerReload': pickerData = null; renderView(); return loadPicker(true);
      case 'shelfRemove': e.stopPropagation(); return A.call('shelfRemove', id);
      case 'shelfReveal': e.stopPropagation(); return A.call('shelfReveal', id);
      case 'shelfClear': return A.call('shelfClear');
      case 'clipCopy': el.classList.add('copied'); toast('Copied'); return A.call('clipCopy', id);
      case 'clipForget': e.stopPropagation(); return A.call('clipForget', id);
      case 'clipClear': return A.call('clipClear');
      case 'clipOn': return A.call('setSettings', { clipboard: true });
      case 'settings': A.call('openSettings', el.dataset.section || null); return close();
      case 'addonLaunch': try { await A.call('addonLaunch', el.dataset.id); } catch (err) { toast(errMsg(err)); } return;
      case 'peekDismiss': return nextBurst();
      case 'docket': { if (mode === 'peek') nextBurst(); try { await A.call('addonCall', 'docket', el.dataset.cmd); if (el.dataset.cmd === 'start') toast('Docket is taking notes'); } catch (err) { toast(errMsg(err)); } return; }
      case 'sceneGo': try { toast('Switching…'); const r = await A.call('addonCall', 'scene', 'activate', id); if (r && r.ok === false) toast(r.error || 'Scene couldn’t finish switching'); } catch (err) { toast(errMsg(err)); } return;
      case 'scenePrev': try { await A.call('addonCall', 'scene', 'previous'); } catch (err) { toast(errMsg(err)); } return;
      case 'sceneOpen': return A.call('addonCall', 'scene', 'open').catch((err) => toast(errMsg(err)));
      case 'beamPick': beamPick = beamPick === el.dataset.peer ? null : el.dataset.peer; return renderView();
      case 'beamClip': try { await A.call('beamClipboard', beamPick); toast('Sent what you copied'); } catch (err) { toast(errMsg(err)); } return;
      case 'beamShelf': try { const n = await A.call('beamShelf', beamPick); toast(`Sending ${n} file${n === 1 ? '' : 's'}`); } catch (err) { toast(errMsg(err)); } return;
      case 'beamOpen': return A.call('addonCall', 'beam', 'open').catch((err) => toast(errMsg(err)));
      case 'vitalsOpen': return A.call('addonCall', 'vitals', 'open').catch((err) => toast(errMsg(err)));
      case 'relayOpen': A.call('addonCall', 'relay', 'open', el.dataset.id || null).catch((err) => toast(errMsg(err))); return close();
      default: return null;
    }
  }
  const errMsg = (e) => String((e && e.message) || e).replace(/^Error invoking remote method 'atoll': (Error: )?/, '');
  async function addTimer() {
    const t = $('#t-time'), l = $('#t-label');
    const text = (t?.value || '').trim(); if (!text) { t?.focus(); return; }
    try { await A.call('timerAddText', text, l?.value || ''); lastErr = null; t.value = ''; if (l) l.value = ''; }
    catch (e) { lastErr = String(e.message || e).replace(/^Error invoking remote method 'atoll': (Error: )?/, ''); t.classList.add('err'); t.title = lastErr; toast(lastErr); }
  }
  function onClick(e) {
    const v = e.target.closest('[data-view]');
    const a = e.target.closest('[data-act]');
    if (a && (!v || v.contains(a))) { e.preventDefault(); act(a.dataset.act, a, e); return; }
    if (v) { view = v.dataset.view; if (v.dataset.sub) sub.timers = v.dataset.sub; renderHead(); renderView(true); layout(); if (view === 'match') loadPicker(); }
  }
  viewEl.addEventListener('click', onClick);
  peekEl.addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (a) act(a.dataset.act, a, e); });
  viewEl.addEventListener('dblclick', (e) => { const f = e.target.closest('[data-file]'); if (f) A.call('shelfOpen', f.dataset.file); });
  viewEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 't-time' || e.target.id === 't-label')) addTimer();
    if (e.target.id === 't-time' && lastErr) { lastErr = null; e.target.classList.remove('err'); }
  });
  let searchT = null;
  viewEl.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'm-q') { pickerQ = t.value; clearTimeout(searchT); searchT = setTimeout(() => renderView(), 120); }
    if (t.id === 'm-team') { teamQ = t.value; clearTimeout(searchT); searchT = setTimeout(async () => { if (teamQ.trim().length < 2) { teamResults = null; return renderView(); } try { teamResults = await A.call('matchSearch', teamQ); } catch (_) { teamResults = []; } renderView(); }, 300); }
    if (t.dataset.act === 'sysvol') { t.style.setProperty('--v', `${t.value}%`); clearTimeout(t._t); t._t = setTimeout(() => A.call('media', 'sysvolume', Number(t.value)), 60); }
  });
  // seeking: drag along the bar
  let seeking = false;
  viewEl.addEventListener('pointerdown', (e) => {
    const s = e.target.closest('.scrub'); if (!s || !S.media.now?.duration) return;
    seeking = true; s.setPointerCapture(e.pointerId);
    const at = (ev) => { const r = s.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
    const show = (f) => { const fill = s.querySelector('.fill'); if (fill) fill.style.width = `${f * 100}%`; const p = viewEl.querySelector('[data-live="mpos"]'); if (p) p.textContent = fmtS(f * S.media.now.duration); };
    show(at(e));
    const move = (ev) => show(at(ev));
    const up = (ev) => { s.removeEventListener('pointermove', move); s.removeEventListener('pointerup', up); seeking = false; A.call('media', 'seek', at(ev) * S.media.now.duration); };
    s.addEventListener('pointermove', move); s.addEventListener('pointerup', up);
  });
  // shelf: drag files out
  viewEl.addEventListener('dragstart', (e) => { const f = e.target.closest('[data-file]'); if (!f) return; e.preventDefault(); A.drag(f.dataset.file); });

  // Windows/Linux: the window is a fixed transparent sheet that lets clicks through; take them only over the island.
  let px = -1, py = -1, hitOn = false;
  function inside(el, x, y, pad) { if (!el) return false; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad; }
  function rehit() {
    if (!S || !geo().fixed) return;
    const on = px >= 0 && (inside(isl, px, py, mode === 'compact' ? 6 : 2) || (bubble.classList.contains('on') && inside(bubble, px, py, 4)) || dragging > 0);
    if (on !== hitOn) { hitOn = on; A.call('hit', on); }
  }
  window.addEventListener('mousemove', (e) => { px = e.clientX; py = e.clientY; rehit(); }, { passive: true });
  document.addEventListener('mouseleave', () => { px = py = -1; rehit(); });

  // files dragged onto the island
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragging++; px = e.clientX; py = e.clientY; rehit(); if (!(mode === 'open' && view === 'beam')) isl.classList.add('dragging'); if (dragging === 1 && mods().shelf && !(mode === 'open' && view === 'beam')) { clearTimeout(leaveT); if (mode !== 'open') { view = 'shelf'; open('shelf'); } else if (view !== 'shelf') { view = 'shelf'; renderHead(); renderView(); layout(); } } else clearTimeout(leaveT); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; const p = e.target.closest && e.target.closest('[data-peer]'); viewEl.querySelectorAll('.peer.drop').forEach((x) => { if (x !== p) x.classList.remove('drop'); }); if (p) p.classList.add('drop'); } });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragging = Math.max(0, dragging - 1); if (!dragging) isl.classList.remove('dragging'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); dragging = 0; isl.classList.remove('dragging');
    const paths = Array.from(e.dataTransfer?.files || []).map((f) => A.pathFor(f)).filter(Boolean);
    const peer = e.target.closest && e.target.closest('[data-peer]');
    if (peer && paths.length) { try { await A.call('addonCall', 'beam', 'send', peer.dataset.peer, paths); toast(`Sending ${paths.length} file${paths.length === 1 ? '' : 's'}`); } catch (err) { toast(errMsg(err)); } return; }
    if (paths.length) { const n = await A.call('shelfAdd', paths); toast(n ? `${n} on the shelf` : 'Already on the shelf'); }
  });

  // ---------------------------------------------------------------- updates from main
  A.on('patch', (p) => {
    const prevGeo = JSON.stringify(S.geo);
    Object.assign(S, p);
    if (p.settings || p.geo) applyGeo(prevGeo !== JSON.stringify(S.geo));
    if (p.media?.now?.art) artColor(p.media.now.art);
    if (mode === 'open') {
      const activeInput = document.activeElement && document.activeElement.tagName === 'INPUT' && viewEl.contains(document.activeElement);
      const rel = { timers: ['timers'], media: ['media'], match: ['match'], shelf: ['shelf', 'settings'], home: ['timers', 'media', 'match', 'glance', 'shelf'], docket: ['addons'], scene: ['addons'], beam: ['addons', 'shelf'], vitals: ['addons'], relay: ['addons'] }[view] || [];
      // Only redraw when something you can see changed. Song position, the clock and live numbers are moved in place
      // by tick(); redrawing the whole view for them made the island flicker (worst on Windows, where the media
      // timeline reports often).
      const key = viewKey();
      if (rel.some((k) => k in p) && key !== lastViewKey && !(activeInput && view !== 'timers' && view !== 'match') && !seeking) renderView();
      else if (view === 'home' && p.glance) { const st = viewEl.querySelector('.strip'); if (st) st.innerHTML = strip(); }
      const hk = headKey();
      if (hk !== lastHeadKey) renderHead();
    }
    if (mode === 'compact') layout();
    if (mode === 'peek' && burstNow?.kind === 'timer' && p.timers && !S.timers.list.some((t) => t.id === burstNow.id && t.state === 'done')) { ringing = null; nextBurst(); }
  });
  A.on('burst', onBurst);
  A.on('open', (d) => open(d?.view || defaultView()));
  A.on('close', () => close());
  A.on('blur', () => { if (mode === 'open' && !pinned) close(); });

  function applyGeo(changed) {
    document.body.classList.toggle('notch', notch());
    document.body.classList.toggle('float', !notch());
    document.body.classList.toggle('win', S.platform === 'win32');
    if (changed) { lastT = null; layout(true); if (mode === 'open') renderHead(); }
  }

  // ---------------------------------------------------------------- start
  (async () => {
    S = await A.call('state');
    applyGeo(true);
    if (S.media?.now?.art) artColor(S.media.now.art);
    try { if (navigator.getBattery) { const b = await navigator.getBattery(); const upd = () => { battery = { level: b.level, charging: b.charging }; }; upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); } } catch (_) {}
    layout(true);
    window.__atoll = { open, close, setMode, get mode() { return mode; }, get view() { return view; }, setSub: (k, v) => { sub[k] = v; renderView(); layout(); }, loadPicker, burst: onBurst, setTeams: (r, q) => { teamResults = r; teamQ = q; renderView(); } };
  })();
})();

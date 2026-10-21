// Docket — the window: sidebar, meetings, live notes, summaries, to-dos, ask, settings.
(function () {
  'use strict';
  const { h, icon, toast } = U;
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);

  const S = {
    settings: {}, platform: '', version: '', home: '', providers: {}, perms: {},
    meetings: [], todos: [], view: 'home', meetingId: null, tab: 'summary',
    live: null, detected: null, engine: new DE.Engine(), search: '', hits: null,
    todoFilter: 'open', todoMine: false, todoGroup: 'meeting',
    ask: [], asking: false, meetingAsk: {}, summarizing: new Set(), jobs: {}, aiCli: {}
  };
  const cache = new Map(); // id → full meeting
  const isMac = () => S.platform === 'darwin';
  const mod = () => (isMac() ? '⌘' : 'Ctrl+');
  const me = (m) => (m && m.speakers && m.speakers.me) || S.settings.myName || 'You';
  const spk = (m, ch) => (m.speakers && m.speakers[ch]) || (ch === 'me' ? 'You' : ch === 'them' ? 'Them' : 'Speaker');

  // ================================================================ data
  async function getMeeting(id) {
    if (S.live && S.live.meeting.id === id) return S.live.meeting;
    if (cache.has(id)) return cache.get(id);
    const m = await api.loadMeeting(id);
    cache.set(id, m);
    return m;
  }
  const saveTimers = {};
  function saveSoon(m, ms = 700) {
    clearTimeout(saveTimers[m.id]);
    saveTimers[m.id] = setTimeout(() => saveNow(m), ms);
    upsertMeta(m);
  }
  async function saveNow(m) {
    clearTimeout(saveTimers[m.id]); delete saveTimers[m.id];
    try { await api.saveMeeting(m); } catch (e) { toast('Could not save: ' + e.message, { bad: true }); }
  }
  async function flushAll() {
    const ids = Object.keys(saveTimers);
    for (const id of ids) { const m = (S.live && S.live.meeting.id === id) ? S.live.meeting : cache.get(id); if (m) await saveNow(m); }
  }
  function upsertMeta(m) {
    const words = (m.segments || []).reduce((n, x) => n + (x.text ? x.text.split(/\s+/).length : 0), 0);
    const meta = { id: m.id, title: m.title, startedAt: m.startedAt, durationMs: m.durationMs, app: m.app, status: m.status, source: m.source, hasSummary: !!(m.summary && m.summary.text), gist: m.summary && m.summary.text ? m.summary.text.slice(0, 160) : '', words, hasAudio: !!m.audio };
    const i = S.meetings.findIndex((x) => x.id === m.id);
    if (i >= 0) S.meetings[i] = meta; else S.meetings.unshift(meta);
    S.meetings.sort((a, b) => b.startedAt - a.startedAt);
    renderListSoon();
  }
  const renderListSoon = U.debounce(() => renderSide(), 120);

  // ================================================================ theme
  function applyTheme() {
    const t = S.settings.theme;
    const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.platform = S.platform;
    api.windowChrome(dark ? '#0f0e0c' : '#f7f5f1', dark ? '#a9a39a' : '#4c4740').catch(() => {});
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // ================================================================ speech engine
  const engineKey = () => DE.modelId(S.settings) + '|' + S.settings.model + '|' + S.settings.device;
  const modelReady = () => !!(S.settings.modelReady || {})[engineKey()];
  function loadEngine(quiet) {
    const p = S.engine.ensure(S.settings);
    p.then(async () => {
      if (!modelReady()) { const r = await api.setSettings({ modelReady: { ...(S.settings.modelReady || {}), [engineKey()]: true } }); S.settings = r.settings; }
      if (!quiet) toast('Speech model ready ' + (S.engine.state.device === 'webgpu' ? 'on your GPU' : 'on your CPU'));
      render();
    }).catch((e) => { if (!quiet) toast('Speech model could not load: ' + e.message, { bad: true }); render(); });
    return p;
  }
  S.engine.on(() => updateEngineBits());
  function engineLine() {
    const e = S.engine.state;
    const m = DE.MODELS[S.settings.model] || DE.MODELS.balanced;
    if (e.status === 'loading') return e.total ? `Downloading ${m.label} model · ${Math.round(e.loaded / e.total * 100)}% of ${U.mb(e.total)}` : `Loading ${m.label} model…`;
    if (e.status === 'ready') return `${m.label} model ready · ${e.device === 'webgpu' ? 'GPU' : 'CPU'}`;
    if (e.status === 'error') return 'Speech model error: ' + e.error;
    return modelReady() ? `${m.label} model downloaded` : `${m.label} model not downloaded yet (~${m.mb.gpu} MB)`;
  }
  function updateEngineBits() {
    for (const el of document.querySelectorAll('[data-engine-line]')) el.textContent = engineLine();
    const e = S.engine.state;
    for (const el of document.querySelectorAll('[data-engine-bar]')) { el.style.width = (e.status === 'loading' && e.total ? Math.round(e.loaded / e.total * 100) : e.status === 'ready' ? 100 : 0) + '%'; el.parentElement.hidden = e.status !== 'loading'; }
    for (const el of document.querySelectorAll('[data-queue]')) el.textContent = e.queue ? `Transcribing ${e.queue} part${e.queue > 1 ? 's' : ''}…` : '';
  }

  // ================================================================ live notes
  async function start(opts = {}) {
    if (S.live) { openMeeting(S.live.meeting.id, 'transcript'); return; }
    if (S.jobs.starting) return; S.jobs.starting = true;
    try {
      if (isMac()) await api.askMic().catch(() => {});
      loadEngine(true);
      const m = await api.createMeeting({ app: opts.app || '', source: 'live' });
      if (opts.title) { m.title = opts.title; }
      const rec = new DE.Recorder();
      const live = S.live = { meeting: m, rec, pending: 0, auto: !!opts.auto, line: '', startedAt: Date.now(), result: null };
      cache.set(m.id, m);
      let res;
      try {
        res = await rec.start({
          micId: S.settings.micId, system: S.settings.captureSystem, keepAudio: S.settings.keepAudio,
          onSegment: (seg) => onSegment(live, seg),
          onAudio: (buf) => api.appendAudio(m.id, buf)
        });
      } catch (e) {
        S.live = null;
        await api.deleteMeeting(m.id).catch(() => {}); cache.delete(m.id);
        S.meetings = S.meetings.filter((x) => x.id !== m.id);
        captureProblem(String(e.message || e), true);
        render(); return;
      }
      live.result = res;
      m.audio = S.settings.keepAudio ? 'audio.webm' : null;
      m.status = 'recording';
      m.startedAt = Date.now();
      await saveNow(m); upsertMeta(m);
      for (const w of res.warnings) captureProblem(w, false);
      live.timer = setInterval(() => tick(), 500);
      openMeeting(m.id, 'transcript');
      tick();
    } finally { S.jobs.starting = false; }
  }
  function captureProblem(w, fatal) {
    const mac = isMac();
    if (/^mic:/.test(w) || (fatal && /mic/.test(w))) toast(fatal ? 'Docket couldn\'t hear your microphone or the call.' : 'Your microphone isn\'t available, so only the call is being transcribed.', { bad: true, action: { label: 'Fix', fn: () => api.openPerm('mic') } });
    else if (/^system:/.test(w)) {
      if (S.platform === 'linux') return;
      toast(mac ? 'The call\'s audio is off: allow Docket under Screen & System Audio Recording, then restart Docket.' : 'Couldn\'t capture the call\'s audio, so only your microphone is being transcribed.', { bad: true, ms: 9000, action: mac ? { label: 'Open Settings', fn: async () => { await api.requestScreen(); api.openPerm('screen'); } } : null });
    }
  }
  async function onSegment(live, seg) {
    live.pending++;
    tick();
    const r = await S.engine.transcribe(seg.pcm, S.settings);
    live.pending--;
    const text = DT.cleanText(r.text, seg);
    const m = live.meeting;
    if (text) {
      m.segments = DT.addSegment(m.segments || [], { id: Math.random().toString(36).slice(2, 10), t0: seg.t0, t1: seg.t1, ch: seg.ch, text });
      live.line = (seg.ch === 'me' ? me(m) : spk(m, seg.ch)) + ': ' + text;
      saveSoon(m, 1500);
      if (S.view === 'meeting' && S.meetingId === m.id) refreshTranscript(m);
    } else if (r.error) console.warn('transcribe', r.error);
    if (live.stopping && live.pending === 0) live.drained && live.drained();
    tick();
  }
  function tick() {
    const live = S.live; if (!live) return;
    const t = live.rec.elapsed();
    for (const el of document.querySelectorAll('.live-timer')) el.textContent = U.clock(t);
    const lv = live.rec.levels;
    for (const el of document.querySelectorAll('[data-level]')) {
      const v = Math.min(1, Math.sqrt((lv[el.dataset.level] || 0) * 18));
      el.style.setProperty('--lv', v.toFixed(3));
    }
    for (const el of document.querySelectorAll('[data-live-status]')) el.textContent = live.stopping ? 'Finishing the transcript…' : live.rec.paused ? 'Paused' : live.pending ? `Listening · transcribing ${live.pending}` : 'Listening';
    api.recState({ recording: true, paused: !!live.rec.paused, elapsed: t, line: live.line, meetingId: live.meeting.id, title: live.meeting.title, auto: live.auto, stopping: !!live.stopping });
  }
  async function pause() { if (!S.live || S.live.stopping) return; await S.live.rec.pause(); toast('Paused. Nothing is being recorded.'); renderSide(); tick(); refreshLiveBits(); }
  async function resume() { if (!S.live) return; await S.live.rec.resume(); renderSide(); tick(); refreshLiveBits(); }
  function mark() {
    const live = S.live; if (!live) return;
    const t = live.rec.elapsed();
    live.meeting.marks = [...(live.meeting.marks || []), { t, label: '' }];
    saveSoon(live.meeting);
    toast('Marked ' + U.clock(t));
    if (S.view === 'meeting' && S.meetingId === live.meeting.id) refreshTranscript(live.meeting);
  }
  async function stop(opts = {}) {
    const live = S.live; if (!live || live.stopping) return;
    live.stopping = true; tick(); renderSide(); refreshLiveBits();
    const m = live.meeting;
    const secs = await live.rec.stop();
    clearInterval(live.timer);
    if (live.pending) await new Promise((r) => { live.drained = r; setTimeout(r, opts.quitting ? 4000 : 10 * 60 * 1000); });
    m.durationMs = Math.round(secs * 1000); m.endedAt = Date.now(); m.status = 'ready';
    if (m.audio) await api.finishAudio(m.id, m.durationMs).catch(() => {});
    await saveNow(m);
    S.live = null;
    api.recState({ recording: false, paused: false, elapsed: 0, line: '', meetingId: null });
    upsertMeta(m);
    if (opts.quitting) { api.stopped(); return; }
    render();
    if (!(m.segments || []).length) toast('No speech was picked up in that recording.', { bad: true });
    else if (S.settings.autoSummary && S.settings.aiProvider !== 'off') summarize(m.id, true);
    api.stopped();
  }

  // ================================================================ import / re-transcribe
  async function importFile(file) {
    if (!file) file = await api.pickImport();
    if (!file) return;
    loadEngine(true);
    const m = await api.createMeeting({ source: 'import', status: 'transcribing' });
    cache.set(m.id, m);
    S.jobs[m.id] = { done: 0, total: 0, phase: 'Reading the file…' };
    upsertMeta(m); openMeeting(m.id, 'transcript');
    try {
      const r = await api.readImport(m.id, file);
      m.title = r.title; m.audio = r.name; m.sourceFile = file;
      await transcribeAudio(m, r.bytes, r.mtime);
    } catch (e) {
      delete S.jobs[m.id]; m.status = 'ready'; await saveNow(m);
      toast('Couldn\'t transcribe that file: ' + e.message, { bad: true }); render();
    }
  }
  async function retranscribe(m) {
    if (!m.audio) return;
    if (!confirm('Transcribe this meeting again from its recording? The current transcript will be replaced, and your voice and the call won\'t be told apart any more.')) return;
    loadEngine(true);
    S.jobs[m.id] = { done: 0, total: 0, phase: 'Reading the recording…' }; render();
    try {
      const bytes = await (await fetch(`docket://data/${m.id}/${m.audio}`)).arrayBuffer();
      await transcribeAudio(m, bytes, null);
    } catch (e) { delete S.jobs[m.id]; toast('Couldn\'t transcribe: ' + e.message, { bad: true }); render(); }
  }
  async function transcribeAudio(m, bytes, mtime) {
    const job = S.jobs[m.id];
    job.phase = 'Decoding audio…'; refreshJob(m);
    const { pcm, duration } = await DE.decodeFile(bytes);
    m.durationMs = Math.round(duration * 1000);
    if (mtime && m.source === 'import') m.startedAt = Math.round(mtime - m.durationMs);
    const segs = DE.segmentAll(pcm);
    job.total = segs.length; job.phase = 'Transcribing';
    m.segments = []; m.status = 'transcribing'; saveSoon(m); refreshJob(m);
    await Promise.all(segs.map(async (seg) => {
      const r = await S.engine.transcribe(seg.pcm, S.settings);
      job.done++;
      const text = DT.cleanText(r.text, seg);
      if (text) { m.segments = DT.addSegment(m.segments, { id: Math.random().toString(36).slice(2, 10), t0: seg.t0, t1: seg.t1, ch: 'mix', text }); }
      refreshJob(m);
      if (S.view === 'meeting' && S.meetingId === m.id) refreshTranscript(m);
      saveSoon(m, 2000);
    }));
    delete S.jobs[m.id];
    m.status = 'ready';
    await saveNow(m); upsertMeta(m); render();
    if (!m.segments.length) toast('No speech was found in that recording.', { bad: true });
    else if (S.settings.autoSummary && S.settings.aiProvider !== 'off') summarize(m.id, true);
  }
  function refreshJob(m) {
    const j = S.jobs[m.id]; const el = document.querySelector(`[data-job="${m.id}"]`);
    if (!el || !j) return;
    el.querySelector('.job-text').textContent = j.total ? `${j.phase} · ${j.done} of ${j.total} parts` : j.phase;
    el.querySelector('.job-bar i').style.width = (j.total ? Math.round(j.done / j.total * 100) : 3) + '%';
  }

  // ================================================================ AI
  const providerName = () => ({ 'claude-cli': 'Claude', anthropic: 'Claude', 'codex-cli': 'ChatGPT', off: '' }[S.settings.aiProvider] || 'AI');
  async function summarize(id, auto) {
    if (S.summarizing.has(id)) return;
    if (S.settings.aiProvider === 'off') { toast('Turn on AI in Settings to get summaries.', { action: { label: 'Settings', fn: () => go('settings') } }); return; }
    const m = await getMeeting(id);
    S.summarizing.add(id); render();
    try {
      await saveNow(m);
      const r = await api.summarize(id);
      m.summary = r.summary;
      if (!m.titleEdited && r.summary.title) m.title = r.summary.title;
      S.todos = r.todos;
      await saveNow(m); upsertMeta(m);
      if (S.view === 'meeting' && S.meetingId === id) S.tab = 'summary';
      if (auto) api.notify('Notes ready: ' + m.title, r.added ? `${r.added} to-do${r.added > 1 ? 's' : ''} added.` : 'Summary is ready.').catch(() => {});
      else toast(r.added ? `Summary ready · ${r.added} to-do${r.added > 1 ? 's' : ''} added` : 'Summary ready');
    } catch (e) {
      toast('Summary failed: ' + e.message, { bad: true, ms: 9000, action: { label: 'Settings', fn: () => go('settings') } });
    } finally { S.summarizing.delete(id); render(); }
  }

  // ================================================================ navigation
  function go(view) { S.view = view; if (view !== 'meeting') S.meetingId = null; render(); }
  async function openMeeting(id, tab) {
    S.view = 'meeting'; S.meetingId = id;
    try { const m = await getMeeting(id); S.tab = tab || (S.live && S.live.meeting.id === id ? 'transcript' : (m.summary ? 'summary' : (m.segments || []).length ? 'transcript' : 'summary')); }
    catch (e) { toast(e.message, { bad: true }); S.view = 'home'; }
    render();
  }

  // ================================================================ render: sidebar
  function render() { renderSide(); renderMain(); }
  function renderSide() {
    const side = $('#side');
    const keepFocus = document.activeElement && document.activeElement.id === 'search';
    const caret = keepFocus ? document.activeElement.selectionStart : 0;
    const scroll = side.querySelector('.side-list') ? side.querySelector('.side-list').scrollTop : 0;
    side.innerHTML = '';
    side.append(h('.side-top', h('.brand', h('span.brand-mark'), 'Docket')));
    side.append(recordCard());
    const open = S.todos.filter((t) => !t.done).length;
    side.append(h('nav.side-nav',
      navBtn('home', 'home', 'Meetings'),
      navBtn('todos', 'list', 'To-dos', open ? h('span.badge', String(open)) : null),
      navBtn('ask', 'ask', 'Ask your meetings')
    ));
    const search = h('input#search.search', { type: 'search', placeholder: 'Search notes and transcripts', value: S.search, spellcheck: false });
    search.addEventListener('input', U.debounce(async () => {
      S.search = search.value.trim();
      S.hits = S.search ? await api.searchMeetings(S.search) : null;
      renderSide();
    }, 180));
    side.append(h('.search-wrap', icon('search', 14), search, h('kbd.search-kbd', mod() + 'K')));
    const list = h('.side-list');
    let items = S.meetings;
    if (S.hits) { const ids = new Map(S.hits.map((x) => [x.id, x.snippet])); items = items.filter((x) => ids.has(x.id)).map((x) => ({ ...x, snippet: ids.get(x.id) })); }
    if (!items.length) list.append(h('.side-empty', S.hits ? 'Nothing matches that.' : 'Your meetings will appear here.'));
    let day = '';
    for (const m of items) {
      const d = U.dayLabel(m.startedAt);
      if (d !== day) { day = d; list.append(h('.side-day', d)); }
      const isLive = S.live && S.live.meeting.id === m.id;
      list.append(h('button.m-item' + (S.view === 'meeting' && S.meetingId === m.id ? '.on' : ''), { on: { click: () => openMeeting(m.id) } },
        h('.m-title', isLive ? h('span.rec-dot') : null, m.title),
        h('.m-meta', [U.timeOf(m.startedAt), isLive ? 'live' : U.dur(m.durationMs), m.app].filter(Boolean).join(' · '),
          S.summarizing.has(m.id) || S.jobs[m.id] ? h('span.m-busy', S.jobs[m.id] ? 'transcribing' : 'summarizing') : null),
        m.snippet ? h('.m-snip', m.snippet) : null
      ));
    }
    side.append(list);
    list.scrollTop = scroll;
    side.append(h('.side-foot',
      h('button.foot-btn', { title: 'Transcribe a recording', on: { click: () => importFile() } }, icon('upload', 15), 'Transcribe a file'),
      h('button.icon-btn' + (S.view === 'settings' ? '.on' : ''), { title: 'Settings', on: { click: () => go('settings') } }, icon('gear', 17))
    ));
    if (keepFocus) { const s = $('#search'); s.focus(); try { s.setSelectionRange(caret, caret); } catch (_) {} }
  }
  function navBtn(view, ic, label, extra) {
    return h('button.nav-btn' + (S.view === view ? '.on' : ''), { on: { click: () => go(view) } }, icon(ic, 16), h('span', label), extra);
  }
  function recordCard() {
    const live = S.live;
    if (!live) {
      const det = S.detected;
      return h('.rec-card',
        det ? h('.det', h('span.det-dot'), h('span', h('b', det.app), ' call detected')) : null,
        h('button.rec-btn', { on: { click: () => start(det ? { app: det.app, title: det.title } : {}) } },
          h('span.rec-btn-ic', icon('mic', 17)), h('span.rec-btn-txt', h('b', 'Start taking notes'), h('small', S.settings.shortcut ? shortcutLabel(S.settings.shortcut) : 'Zoom, Teams, Meet or in person'))),
        !modelReady() && S.engine.state.status !== 'ready' ? h('.rec-hint', h('span', { 'data-engine-line': '' }, engineLine()), h('.bar-track', { hidden: S.engine.state.status !== 'loading' }, h('i', { 'data-engine-bar': '' }))) : null
      );
    }
    const paused = live.rec.paused;
    return h('.rec-card.live' + (paused ? '.paused' : ''),
      h('.live-head', h('span.rec-dot.big'), h('span.live-timer', U.clock(live.rec.elapsed())), h('span.grow'), h('span.live-status', { 'data-live-status': '' }, 'Listening')),
      h('button.live-title', { on: { click: () => openMeeting(live.meeting.id, 'transcript') } }, live.meeting.title),
      h('.levels',
        h('.lv', h('span', me(live.meeting)), h('.lv-bar', { 'data-level': 'me' }, h('i')), live.result && !live.result.mic ? h('em', 'off') : null),
        h('.lv', h('span', 'Call'), h('.lv-bar', { 'data-level': 'them' }, h('i')), live.result && !live.result.system ? h('em', 'off') : null)),
      h('.live-btns',
        h('button.btn.sm', { disabled: !!live.stopping, on: { click: () => (paused ? resume() : pause()) } }, icon(paused ? 'play' : 'pause', 14), paused ? 'Resume' : 'Pause'),
        h('button.btn.sm', { disabled: !!live.stopping, title: 'Mark this moment (' + mod() + 'M)', on: { click: mark } }, icon('flag', 14)),
        h('button.btn.sm.stop', { disabled: !!live.stopping, on: { click: () => stop() } }, icon('stop', 14), live.stopping ? 'Finishing…' : 'Stop'))
    );
  }
  const shortcutLabel = (acc) => acc.replace('CommandOrControl', isMac() ? '⌘' : 'Ctrl').replace(/Shift/g, isMac() ? '⇧' : 'Shift').replace(/Alt/g, isMac() ? '⌥' : 'Alt').replace(/\+/g, isMac() ? '' : '+');
  function refreshLiveBits() { const c = $('.rec-card'); if (c) c.replaceWith(recordCard()); tick(); }

  // ================================================================ render: main
  function renderMain() {
    const main = $('#main');
    const prev = main.querySelector('.scroll');
    const keep = prev && prev.dataset.key;
    const top = prev ? prev.scrollTop : 0;
    if (S.view !== 'meeting') stopAudio();
    main.innerHTML = '';
    const v = S.view === 'meeting' ? viewMeeting() : S.view === 'todos' ? viewTodos() : S.view === 'ask' ? viewAsk() : S.view === 'settings' ? viewSettings() : viewHome();
    if (v instanceof Promise) v.then((el) => { main.innerHTML = ''; main.append(el); restore(); }); else { main.append(v); restore(); }
    function restore() { const s = main.querySelector('.scroll'); if (s && keep && s.dataset.key === keep) s.scrollTop = top; updateEngineBits(); tick(); }
  }
  const bar = (...kids) => h('.view-bar', ...kids);

  // ---------------------------------------------------------------- home
  function viewHome() {
    const wrap = h('.view');
    wrap.append(bar(h('.vb-title', 'Meetings'), h('.grow'), h('button.btn.sm', { on: { click: () => importFile() } }, icon('upload', 14), 'Transcribe a file')));
    const sc = h('.scroll.home', { 'data-key': 'home' });
    const name = S.settings.myName && S.settings.myName !== 'You' ? ', ' + S.settings.myName.split(' ')[0] : '';
    sc.append(h('.hero', h('h1.serif', U.greet() + name + '.'), h('p.muted', S.meetings.length ? `${S.meetings.length} meeting${S.meetings.length > 1 ? 's' : ''} in your notes · ${S.todos.filter((t) => !t.done).length} open to-dos` : 'Docket listens to your calls, writes the notes, and keeps one to-do list from all of them.')));
    if (!S.settings.onboarded) sc.append(setupCard());
    const open = S.todos.filter((t) => !t.done).sort(todoSort).slice(0, 6);
    if (open.length) {
      sc.append(h('.sec-head', h('h3', 'Up next'), h('button.link-btn', { on: { click: () => go('todos') } }, 'All to-dos', icon('chev', 13))));
      sc.append(h('.card.todo-card', open.map((t) => todoRow(t, { meeting: true }))));
    }
    if (S.meetings.length) {
      sc.append(h('.sec-head', h('h3', 'Recent meetings')));
      const grid = h('.m-grid');
      for (const m of S.meetings.slice(0, 9)) {
        grid.append(h('button.m-card', { on: { click: () => openMeeting(m.id) } },
          h('.mc-top', h('span.mc-day', U.dayLabel(m.startedAt) + ' · ' + U.timeOf(m.startedAt)), m.app ? h('span.app-chip', m.app) : null),
          h('.mc-title.serif', m.title),
          h('.mc-gist', m.gist || (m.words ? `${m.words.toLocaleString()} words transcribed` : m.status === 'recording' ? 'Recording now' : 'No transcript')),
          h('.mc-foot', U.dur(m.durationMs), m.hasSummary ? h('span.ok-chip', icon('spark', 11), 'Summary') : null)));
      }
      sc.append(grid);
    } else if (S.settings.onboarded) {
      sc.append(howItWorks());
    }
    wrap.append(sc);
    return wrap;
  }
  function howItWorks() {
    return h('.how',
      h('.how-step', h('.how-n', '1'), h('b', 'Start notes when a call begins'), h('span', `Click Start, press ${shortcutLabel(S.settings.shortcut || '')}, or let Docket notice the Zoom, Teams or Meet window.`)),
      h('.how-step', h('.how-n', '2'), h('b', 'It transcribes as you talk'), h('span', 'Your mic and the call\'s audio are transcribed separately on this computer. Jot your own notes alongside.')),
      h('.how-step', h('.how-n', '3'), h('b', 'Get a summary and to-dos'), h('span', 'When you stop, ' + (providerName() || 'AI') + ' writes the summary, decisions and action items, and they join your to-do list.')));
  }
  function setupCard() {
    const e = S.engine.state;
    const ready = modelReady() || e.status === 'ready';
    const perms = S.perms || {};
    const mac = isMac();
    const steps = [
      { done: ready, title: 'Download the speech model', body: h('span', 'Transcription runs on this computer, so it needs a one-time download. ', h('span.muted', { 'data-engine-line': '' }, engineLine())),
        act: ready ? null : h('button.btn.sm.primary', { disabled: e.status === 'loading', on: { click: () => loadEngine() } }, e.status === 'loading' ? 'Downloading…' : 'Download'), extra: h('.bar-track', { hidden: e.status !== 'loading' }, h('i', { 'data-engine-bar': '' })) },
      mac ? { done: perms.mic === 'granted' && perms.screen === 'granted', title: 'Allow microphone and call audio', body: 'macOS asks once for the Microphone and for Screen & System Audio Recording (that\'s how Docket hears the other people on the call; nothing on your screen is recorded).',
        act: h('button.btn.sm', { on: { click: async () => { await api.askMic(); S.perms = await api.requestScreen(); if (S.perms.screen !== 'granted') api.openPerm('screen'); render(); } } }, 'Allow') } : null,
      { done: S.settings.aiProvider !== 'off' && S.aiCli[S.settings.aiProvider] !== false, title: 'Choose who writes your summaries', body: S.settings.aiProvider === 'claude-cli' ? (S.aiCli['claude-cli'] === false ? 'Docket uses the Claude Code CLI signed in on this computer, but it isn\'t installed. Install it or pick another option.' : 'Using Claude through the Claude Code CLI on this computer (your Claude plan, no API key).') : S.providers[S.settings.aiProvider],
        act: h('button.btn.sm', { on: { click: () => go('settings') } }, 'Change') }
    ].filter(Boolean);
    return h('.card.setup',
      h('.setup-head', h('h3', 'Get set up'), h('span.muted', `${steps.filter((s) => s.done).length} of ${steps.length} done`), h('.grow'),
        h('button.btn.sm.ghost', { on: { click: async () => { const r = await api.setSettings({ onboarded: true }); S.settings = r.settings; render(); } } }, 'Done')),
      steps.map((s) => h('.setup-step' + (s.done ? '.done' : ''), h('.ss-check', s.done ? icon('check', 13) : null), h('.ss-body', h('b', s.title), h('div.small', s.body), s.extra || null), s.act || null)));
  }

  // ---------------------------------------------------------------- meeting
  async function viewMeeting() {
    let m;
    try { m = await getMeeting(S.meetingId); } catch (e) { return h('.view', h('.empty', e.message)); }
    const isLive = !!(S.live && S.live.meeting.id === m.id);
    const wrap = h('.view.meeting');
    const tabs = h('.seg.tabs',
      ['summary', 'transcript', 'notes'].map((t) => h('button' + (S.tab === t ? '.on' : ''), { on: { click: () => { S.tab = t; renderMain(); } } },
        { summary: 'Summary', transcript: 'Transcript', notes: 'My notes' }[t],
        t === 'transcript' && (m.segments || []).length ? h('span.tab-n', String((m.segments || []).length)) : null)));
    wrap.append(bar(tabs, h('.grow'),
      !isLive && (m.segments || []).length ? h('button.btn.sm' + (m.summary ? '.ghost' : '.primary'), { disabled: S.summarizing.has(m.id), on: { click: () => summarize(m.id) } }, icon(m.summary ? 'refresh' : 'spark', 14), S.summarizing.has(m.id) ? 'Summarizing…' : m.summary ? 'Redo summary' : 'Summarize') : null,
      h('button.icon-btn', { title: 'Copy notes as Markdown', on: { click: async () => { await saveNow(m); await api.copyMeeting(m.id); toast('Notes copied'); } } }, icon('copy', 16)),
      h('button.icon-btn', { title: 'Export notes', on: { click: async () => { await saveNow(m); const p = await api.exportMeeting(m.id); if (p) toast('Saved ' + p.split(/[\\/]/).pop()); } } }, icon('export', 16)),
      h('button.icon-btn', { title: 'More', on: { click: (e) => meetingMenu(e.currentTarget, m, isLive) } }, icon('more', 18))));
    const body = h('.m-body');
    const sc = h('.scroll.m-main', { 'data-key': 'm-' + m.id + '-' + S.tab });
    // Title block
    const title = h('textarea.m-h1.serif', { rows: 1, value: m.title, spellcheck: false, on: {
      input: (e) => { m.title = e.target.value.replace(/\n/g, ' '); m.titleEdited = true; autosize(e.target); saveSoon(m); },
      keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } } });
    setTimeout(() => autosize(title), 0);
    sc.append(h('.m-head', title, h('.m-meta-row',
      h('span.meta', icon('cal', 13), U.dateLong(m.startedAt) + ' · ' + U.timeOf(m.startedAt)),
      isLive ? h('span.meta.live-chip', h('span.rec-dot'), h('span.live-timer', '0:00')) : m.durationMs ? h('span.meta', icon('clock', 13), U.dur(m.durationMs)) : null,
      appPicker(m),
      m.source === 'import' ? h('span.meta', icon('upload', 13), 'Imported') : null)));
    const job = S.jobs[m.id];
    if (job) sc.append(h('.job', { 'data-job': m.id }, h('.job-text', job.phase), h('.job-bar', h('i')), h('.small.muted', { 'data-engine-line': '' }, engineLine())));
    if (S.tab === 'summary') sc.append(summaryTab(m, isLive));
    if (S.tab === 'transcript') sc.append(transcriptTab(m, isLive));
    if (S.tab === 'notes') sc.append(notesTab(m, isLive));
    body.append(sc, rail(m, isLive));
    wrap.append(body);
    if (m.audio && !isLive && !job) wrap.append(player(m)); else stopAudio();
    setTimeout(() => refreshJob(m), 0);
    return wrap;
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  function appPicker(m) {
    const sel = h('select.meta-select', { title: 'Where the meeting happened', on: { change: (e) => { m.app = e.target.value; saveSoon(m); } } },
      ['', 'Zoom', 'Microsoft Teams', 'Google Meet', 'Webex', 'Slack', 'Phone', 'In person'].map((a) => h('option', { value: a, selected: m.app === a }, a || 'Add place')));
    return h('span.meta', icon('user', 13), sel);
  }
  function meetingMenu(anchor, m, isLive) {
    popMenu(anchor, [
      { label: 'Show in folder', fn: () => api.revealMeeting(m.id) },
      m.audio && !isLive ? { label: 'Transcribe again from the recording', fn: () => retranscribe(m) } : null,
      m.audio && !isLive ? { label: 'Delete the recording, keep the notes', fn: async () => { if (!confirm('Delete the audio for this meeting? The transcript and notes stay.')) return; await api.removeAudio(m.id); m.audio = null; await saveNow(m); render(); } } : null,
      { sep: true },
      !isLive ? { label: 'Delete meeting', danger: true, fn: async () => {
        if (!confirm(`Delete "${m.title}"? It goes to the Trash with its recording. Open to-dos from it are removed.`)) return;
        S.todos = await api.deleteMeeting(m.id); cache.delete(m.id); S.meetings = S.meetings.filter((x) => x.id !== m.id); go('home');
      } } : null
    ].filter(Boolean));
  }
  function popMenu(anchor, items) {
    document.querySelectorAll('.menu').forEach((x) => x.remove());
    const r = anchor.getBoundingClientRect();
    const menu = h('.menu', items.map((it) => it.sep ? h('.menu-sep') : h('button.menu-item' + (it.danger ? '.danger' : ''), { on: { click: () => { menu.remove(); it.fn(); } } }, it.label)));
    document.body.append(menu);
    const w = menu.offsetWidth;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }

  // ---- summary tab
  function summaryTab(m, isLive) {
    const box = h('.tab-body.summary');
    const s = m.summary;
    if (S.summarizing.has(m.id)) {
      box.append(h('.thinking', h('.spinner'), h('div', h('b', `${providerName()} is reading the transcript…`), h('div.small.muted', `${(m.segments || []).reduce((n, x) => n + x.text.split(/\s+/).length, 0).toLocaleString()} words. Longer meetings take a minute.`))));
      if (!s) return box;
    }
    if (!s) {
      if (isLive) box.append(h('.empty-card', icon('wave', 22), h('b', 'Taking notes'), h('span', 'The summary appears when you stop. Meanwhile, the Transcript tab fills in as people talk, and you can jot your own points under My notes.')));
      else if (!(m.segments || []).length) box.append(h('.empty-card', icon('wave', 22), h('b', 'No transcript yet'), h('span', S.jobs[m.id] ? 'Transcribing now…' : 'Nothing was transcribed for this meeting.')));
      else box.append(h('.empty-card', icon('spark', 22), h('b', 'Ready to summarize'),
        h('span', S.settings.aiProvider === 'off' ? 'AI is off, so there is no summary. You can still read the transcript, and suggested to-dos are on the right.' : `${providerName()} will write a summary, decisions and action items from the transcript.`),
        S.settings.aiProvider === 'off' ? h('button.btn.sm', { on: { click: () => go('settings') } }, 'Turn on AI') : h('button.btn.primary', { on: { click: () => summarize(m.id) } }, icon('spark', 14), 'Summarize')));
      return box;
    }
    box.append(h('p.lede.serif', s.text));
    const list = (title, items, cls) => items && items.length ? h('section.s-sec' + (cls || ''), h('h4', title), h('ul', items.map((x) => h('li', x)))) : null;
    U.add(box, [list('Key points', s.keyPoints), list('Decisions', s.decisions, '.decisions'), list('Open questions', s.openQuestions)]);
    if (s.chapters && s.chapters.length) box.append(h('section.s-sec', h('h4', 'Chapters'), h('.chapters', s.chapters.map((c) => h('button.chapter', { on: { click: () => { if (m.audio) seek(c.t); else { S.tab = 'transcript'; renderMain(); setTimeout(() => scrollToTime(c.t), 50); } } } }, h('span.ts', c.t != null ? U.clock(c.t) : '—'), c.title)))));
    box.append(h('.s-foot.small.muted', `Summarized by ${({ 'claude-cli': 'Claude (CLI)', anthropic: 'Claude (API)', 'codex-cli': 'ChatGPT (Codex CLI)' })[s.provider] || 'AI'} · ${U.timeOf(s.at || Date.now())}. Transcripts can mishear names and numbers, so check anything important.`));
    box.append(askBox(m));
    return box;
  }
  function askBox(m) {
    const hist = S.meetingAsk[m.id] = S.meetingAsk[m.id] || [];
    const box = h('section.ask-inline', h('h4', 'Ask about this meeting'));
    const msgs = h('.ask-msgs', hist.map((x) => msg(x, m)));
    const input = h('input.ask-input', { placeholder: 'e.g. What did they say about the launch date?' });
    const send = async () => {
      const q = input.value.trim(); if (!q) return;
      hist.push({ role: 'user', text: q }); input.value = '';
      hist.push({ role: 'assistant', text: '', pending: true });
      renderAsk();
      try { await saveNow(m); const r = await api.ask({ question: q, history: hist.slice(0, -2), meetingIds: [m.id] }); hist[hist.length - 1] = { role: 'assistant', text: r.answer }; }
      catch (e) { hist[hist.length - 1] = { role: 'assistant', text: 'Couldn\'t answer: ' + e.message, bad: true }; }
      renderAsk();
    };
    function renderAsk() { msgs.innerHTML = ''; hist.forEach((x) => msgs.append(msg(x, m))); }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    box.append(msgs, h('.ask-row', input, h('button.icon-btn', { title: 'Ask', on: { click: send } }, icon('send', 16))));
    return box;
  }
  function msg(x, m) {
    if (x.pending) return h('.msg.bot', h('.typing', h('i'), h('i'), h('i')));
    return h('.msg.' + (x.role === 'user' ? 'me' : 'bot') + (x.bad ? '.bad' : ''), x.role === 'user' ? x.text : md(x.text, m), x.used && x.used.length ? h('.used', 'From ', x.used.map((u) => h('button.chip-btn', { on: { click: () => openMeeting(u.id) } }, u.title))) : null);
  }
  // Tiny Markdown: paragraphs, bullets, **bold**, and [mm:ss] links that jump in the recording.
  function md(text, m) {
    const out = h('.md');
    const blocks = String(text || '').split(/\n{2,}/);
    for (const b of blocks) {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) out.append(h('ul', lines.map((l) => h('li', inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), m)))));
      else out.append(h('p', inline(lines.join(' '), m)));
    }
    return out;
  }
  function inline(s, m) {
    const frag = document.createDocumentFragment();
    const re = /(\*\*[^*]+\*\*|\[\d{1,2}:\d{2}(?::\d{2})?\])/g;
    let last = 0, x;
    while ((x = re.exec(s))) {
      if (x.index > last) frag.append(s.slice(last, x.index));
      const tok = x[0];
      if (tok.startsWith('**')) frag.append(h('b', tok.slice(2, -2)));
      else { const t = tok.slice(1, -1).split(':').map(Number).reduce((a, n) => a * 60 + n, 0); frag.append(m && (m.audio || (m.segments || []).length) ? h('button.ts-link', { on: { click: () => (m.audio ? seek(t) : scrollToTime(t)) } }, tok.slice(1, -1)) : tok); }
      last = x.index + tok.length;
    }
    if (last < s.length) frag.append(s.slice(last));
    return frag;
  }

  // ---- transcript tab
  function transcriptTab(m, isLive) {
    const box = h('.tab-body.transcript');
    const names = h('.spk-row', h('span.small.muted', 'Speakers'),
      ['me', 'them', 'mix'].filter((ch) => ch !== 'mix' || (m.segments || []).some((x) => x.ch === 'mix')).filter((ch) => ch === 'mix' || m.source !== 'import').map((ch) => {
        const inp = h('input.spk-name.ch-' + ch, { value: spk(m, ch), size: Math.max(4, spk(m, ch).length), title: ch === 'me' ? 'Your microphone' : ch === 'them' ? 'Everyone on the call' : 'Imported recording', on: {
          input: (e) => { m.speakers = { ...(m.speakers || {}), [ch]: e.target.value.trim() || (ch === 'me' ? 'You' : ch === 'them' ? 'Them' : 'Speaker') }; e.target.size = Math.max(4, e.target.value.length); saveSoon(m); },
          change: () => refreshTranscript(m, true) } });
        return h('label.spk', h('span.spk-dot.ch-' + ch), inp);
      }));
    box.append(names);
    const list = h('.tlist', { id: 'tlist' });
    fillTranscript(list, m, isLive);
    box.append(list);
    if (isLive) box.append(h('.listening', h('span.pulse'), h('span', { 'data-live-status': '' }, 'Listening'), h('span.grow'), h('span.small.muted', { 'data-engine-line': '' }, engineLine())));
    if (isLive) setTimeout(() => { const s = $('.m-main'); if (s) s.scrollTop = s.scrollHeight; }, 0);
    return box;
  }
  function fillTranscript(list, m, isLive) {
    list.innerHTML = '';
    const segs = m.segments || [];
    const marks = (m.marks || []).slice().sort((a, b) => a.t - b.t);
    if (!segs.length && !marks.length) { list.append(h('.empty-line.muted', isLive ? 'Lines appear here a few seconds after people speak.' : 'No transcript.')); return; }
    let mi = 0, prevCh = null, prevT = -99;
    for (const seg of segs) {
      while (mi < marks.length && marks[mi].t <= seg.t0) list.append(markRow(m, marks[mi++]));
      const cont = seg.ch === prevCh && seg.t0 - prevT < 20;
      prevCh = seg.ch; prevT = seg.t1;
      const text = h('div.t-text', { contentEditable: 'plaintext-only', spellcheck: false, on: {
        blur: (e) => { const v = e.target.textContent.trim(); if (v !== seg.text) { if (v) seg.text = v; else m.segments = m.segments.filter((x) => x !== seg); saveSoon(m); } } } }, seg.text);
      list.append(h('.t-row' + (cont ? '.cont' : '') + '.ch-' + seg.ch, { 'data-t': seg.t0 },
        h('button.t-time', { title: m.audio ? 'Play from here' : '', on: { click: () => m.audio && !isLive ? seek(seg.t0) : null } }, U.clock(seg.t0)),
        h('.t-main', cont ? null : h('.t-who.ch-' + seg.ch, spk(m, seg.ch)), text)));
    }
    while (mi < marks.length) list.append(markRow(m, marks[mi++]));
  }
  function markRow(m, mk) {
    return h('.t-mark', h('button.t-time', { on: { click: () => m.audio && seek(mk.t) } }, U.clock(mk.t)), icon('flag', 13),
      h('input.mark-label', { value: mk.label || '', placeholder: 'Marked moment — add a label', on: { input: (e) => { mk.label = e.target.value; saveSoon(m); } } }));
  }
  function refreshTranscript(m, force) {
    const list = $('#tlist'); if (!list) return;
    if (!force && document.activeElement && list.contains(document.activeElement)) return;
    const sc = $('.m-main');
    const atBottom = sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
    fillTranscript(list, m, !!(S.live && S.live.meeting.id === m.id));
    if (sc && atBottom && S.live && S.live.meeting.id === m.id) sc.scrollTop = sc.scrollHeight;
    const n = document.querySelector('.tabs .tab-n'); if (n) n.textContent = String((m.segments || []).length);
  }
  function scrollToTime(t) {
    const rows = [...document.querySelectorAll('.t-row')];
    const row = rows.reverse().find((r) => +r.dataset.t <= t + 0.5) || rows[rows.length - 1];
    if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1400); }
  }

  // ---- my notes tab
  function notesTab(m, isLive) {
    const box = h('.tab-body.notes');
    const ta = h('textarea.notes-area', { value: m.notes || '', placeholder: isLive ? 'Jot what matters as it happens. The summary makes sure these points are covered.\n\nTip: ' + mod() + 'M marks the moment in the transcript.' : 'Your own notes for this meeting.', on: {
      input: (e) => { m.notes = e.target.value; saveSoon(m); } } });
    box.append(h('.notes-tools',
      isLive ? h('button.btn.sm', { on: { click: () => { const t = '[' + U.clock(S.live.rec.elapsed()) + '] '; insertAt(ta, (ta.value && !ta.value.endsWith('\n') ? '\n' : '') + t); } } }, icon('clock', 14), 'Insert time') : null,
      h('span.small.muted', 'Plain text. Saved as you type.')), ta);
    setTimeout(() => { if (isLive) ta.focus(); }, 0);
    return box;
  }
  function insertAt(ta, s) { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + s + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + s.length; ta.focus(); ta.dispatchEvent(new Event('input')); }

  // ---- right rail: to-dos from this meeting, suggestions, marks
  function rail(m, isLive) {
    const r = h('aside.rail');
    const mine = S.todos.filter((t) => t.meetingId === m.id).sort(todoSort);
    r.append(h('.rail-head', h('h4', 'To-dos'), h('span.small.muted', mine.length ? `${mine.filter((t) => !t.done).length} open` : '')));
    if (mine.length) r.append(h('.rail-list', mine.map((t) => todoRow(t, { compact: true }))));
    else if (!isLive) r.append(h('.rail-empty.small.muted', m.summary ? 'No action items came out of this meeting.' : 'Action items show up here after the summary.'));
    r.append(addTodoInput({ meetingId: m.id, placeholder: 'Add a to-do' }));
    if (!m.summary && !isLive && (m.segments || []).length) {
      const have = new Set(S.todos.filter((t) => t.meetingId === m.id).map((t) => t.text.toLowerCase()));
      const sug = DT.suggestTodos(m.segments, { me: 'Me', them: spk(m, 'them') }).filter((x) => !have.has(x.text.toLowerCase()));
      if (sug.length) {
        r.append(h('.rail-head.sub', h('h4', 'Suggested'), h('span.small.muted', 'found without AI')));
        r.append(h('.rail-list', sug.slice(0, 8).map((x) => h('.sug',
          h('.sug-text', x.text, h('.sug-meta', [x.owner, x.due, U.clock(x.t)].filter(Boolean).join(' · '))),
          h('button.icon-btn.sm', { title: 'Add to to-dos', on: { click: async () => { const made = await api.addTodos([{ ...x, meetingId: m.id, source: 'suggested' }]); S.todos = S.todos.concat(made); renderMain(); renderSide(); } } }, icon('plus', 15))))));
      }
    }
    if ((m.marks || []).length) {
      r.append(h('.rail-head.sub', h('h4', 'Marked moments')));
      r.append(h('.rail-list', m.marks.map((mk) => h('button.mark-chip', { on: { click: () => { if (m.audio && !isLive) seek(mk.t); S.tab = 'transcript'; renderMain(); setTimeout(() => scrollToTime(mk.t), 60); } } }, icon('flag', 12), h('span.ts', U.clock(mk.t)), mk.label || 'Marked'))));
    }
    return r;
  }

  // ---- audio player
  let audio = null, audioId = null;
  function stopAudio() { if (audio) { audio.pause(); audio = null; audioId = null; } }
  function player(m) {
    if (!audio || audioId !== m.id) { stopAudio(); audio = new Audio(`docket://data/${m.id}/${m.audio}`); audioId = m.id; audio.preload = 'metadata'; }
    const a = audio;
    const play = h('button.play', { title: 'Play / pause (space)' }, icon(a.paused ? 'play' : 'pause', 16));
    const cur = h('span.p-time', U.clock(a.currentTime));
    const total = () => (isFinite(a.duration) && a.duration > 0 ? a.duration : (m.durationMs || 0) / 1000);
    const len = h('span.p-time.muted', U.clock(total()));
    const range = h('input.p-range', { type: 'range', min: 0, max: 1000, value: total() ? Math.round(a.currentTime / total() * 1000) : 0 });
    const speeds = [1, 1.25, 1.5, 2];
    const sp = h('button.btn.sm.ghost.p-speed', { title: 'Speed' }, a.playbackRate + '×');
    play.onclick = () => (a.paused ? a.play() : a.pause());
    sp.onclick = () => { a.playbackRate = speeds[(speeds.indexOf(a.playbackRate) + 1) % speeds.length]; sp.textContent = a.playbackRate + '×'; };
    range.oninput = () => { if (total()) a.currentTime = range.value / 1000 * total(); };
    const upd = () => { cur.textContent = U.clock(a.currentTime); len.textContent = U.clock(total()); if (total() && document.activeElement !== range) range.value = Math.round(a.currentTime / total() * 1000); highlight(a.currentTime); };
    a.ontimeupdate = upd; a.onloadedmetadata = upd; a.ondurationchange = upd;
    a.onplay = () => { play.replaceChildren(icon('pause', 16)); }; a.onpause = () => { play.replaceChildren(icon('play', 16)); };
    a.onerror = () => { cur.textContent = 'Recording unavailable'; };
    return h('.player', play, cur, range, len, sp);
  }
  function seek(t) { if (!audio) return; audio.currentTime = Math.max(0, t - 0.3); audio.play().catch(() => {}); if (S.tab === 'transcript') scrollToTime(t); }
  let lastHi = null;
  function highlight(t) {
    if (S.tab !== 'transcript' || !audio || audio.paused) return;
    const rows = document.querySelectorAll('.t-row');
    let hit = null; for (const r of rows) { if (+r.dataset.t <= t + 0.2) hit = r; else break; }
    if (hit !== lastHi) { if (lastHi) lastHi.classList.remove('playing'); if (hit) hit.classList.add('playing'); lastHi = hit; }
  }

  // ---------------------------------------------------------------- to-dos
  function todoSort(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = /^\d{4}/.test(a.due) ? a.due : '9999', bd = /^\d{4}/.test(b.due) ? b.due : '9999';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }
  const isMine = (t) => { const o = (t.owner || '').toLowerCase(); const n = (S.settings.myName || '').toLowerCase(); return !o || o === 'me' || o === 'you' || (n && n !== 'you' && (o === n || o === n.split(' ')[0])); };
  function viewTodos() {
    const wrap = h('.view');
    const seg = (key, opts) => h('.seg', opts.map(([v, l]) => h('button' + (S[key] === v ? '.on' : ''), { on: { click: () => { S[key] = v; renderMain(); } } }, l)));
    wrap.append(bar(h('.vb-title', 'To-dos'), h('.grow'),
      h('label.toggle-chip' + (S.todoMine ? '.on' : ''), h('input', { type: 'checkbox', checked: S.todoMine, on: { change: (e) => { S.todoMine = e.target.checked; renderMain(); } } }), 'Mine only'),
      seg('todoGroup', [['meeting', 'By meeting'], ['due', 'By due date']]),
      seg('todoFilter', [['open', 'Open'], ['done', 'Done'], ['all', 'All']])));
    const sc = h('.scroll.todos', { 'data-key': 'todos' });
    sc.append(h('.todo-add-wrap', addTodoInput({ placeholder: 'Add a to-do… (e.g. "Send the deck to Maria friday")', big: true })));
    let list = S.todos.filter((t) => S.todoFilter === 'all' || (S.todoFilter === 'done' ? t.done : !t.done));
    if (S.todoMine) list = list.filter(isMine);
    list.sort(todoSort);
    if (!list.length) sc.append(h('.empty-card', icon('check', 22), h('b', S.todoFilter === 'done' ? 'Nothing finished yet' : 'All clear'), h('span', S.todos.length ? 'Nothing here with these filters.' : 'Action items from your meetings collect here. You can add your own too.')));
    const groups = new Map();
    for (const t of list) {
      let k;
      if (S.todoGroup === 'meeting') k = t.meetingId || '_';
      else k = !t.due ? 'No date' : U.overdue(t.due) && !t.done ? 'Overdue' : /^\d{4}/.test(t.due) ? U.dueLabel(t.due) : 'Later';
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
    }
    for (const [k, items] of groups) {
      let head;
      if (S.todoGroup === 'meeting') {
        const m = S.meetings.find((x) => x.id === k);
        head = m ? h('button.g-head', { on: { click: () => openMeeting(m.id, 'summary') } }, h('span.g-title.serif', m.title), h('span.muted.small', U.dayLabel(m.startedAt)), icon('chev', 13)) : h('.g-head', h('span.g-title.serif', 'Added by you'));
      } else head = h('.g-head' + (k === 'Overdue' ? '.bad' : ''), h('span.g-title.serif', k));
      sc.append(h('section.group', head, h('.card.todo-card', items.map((t) => todoRow(t, { meeting: S.todoGroup !== 'meeting' })))));
    }
    wrap.append(sc);
    return wrap;
  }
  function todoRow(t, opts = {}) {
    const m = t.meetingId ? S.meetings.find((x) => x.id === t.meetingId) : null;
    const row = h('.todo' + (t.done ? '.done' : '') + (opts.compact ? '.compact' : ''));
    const cb = h('button.cb' + (t.done ? '.on' : ''), { title: t.done ? 'Mark as not done' : 'Mark as done', on: { click: async () => { const u = await api.updateTodo(t.id, { done: !t.done }); Object.assign(t, u); row.classList.add('ticking'); setTimeout(() => { renderMain(); renderSide(); }, t.done ? 380 : 0); } } }, icon('check', 12));
    const text = h('div.td-text', { contentEditable: 'plaintext-only', spellcheck: true, on: {
      keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
      blur: async (e) => { const v = e.target.textContent.trim(); if (v && v !== t.text) { Object.assign(t, await api.updateTodo(t.id, { text: v })); } else if (!v) e.target.textContent = t.text; } } }, t.text);
    const owner = chip(t, 'owner', t.owner ? (/^me$/i.test(t.owner) ? 'Me' : t.owner) : '', 'user', 'Who');
    const due = chip(t, 'due', U.dueLabel(t.due), 'cal', 'When', U.overdue(t.due) && !t.done);
    const chips = h('.td-chips',
      t.owner ? owner : null, t.due ? due : null,
      opts.meeting && m ? h('button.td-chip.meet', { title: 'Open the meeting', on: { click: () => { openMeeting(m.id, 'transcript').then(() => t.t != null && setTimeout(() => scrollToTime(t.t), 80)); } } }, icon('note', 11), m.title) : null,
      !opts.meeting && t.t != null && m && m.hasAudio ? h('button.td-chip', { title: 'Play where it was said', on: { click: () => { if (S.meetingId === m.id && audio) seek(t.t); else openMeeting(m.id, 'transcript').then(() => setTimeout(() => { seek(t.t); scrollToTime(t.t); }, 150)); } } }, icon('play', 10), U.clock(t.t)) : null,
      t.owner ? null : owner, t.due ? null : due);
    const del = h('button.icon-btn.xs.td-del', { title: 'Delete', on: { click: async () => { await api.deleteTodos([t.id]); S.todos = S.todos.filter((x) => x.id !== t.id); renderMain(); renderSide(); } } }, icon('x', 13));
    row.append(cb, h('.td-main', text, chips), del);
    return row;
  }
  function chip(t, field, label, ic, ph, bad) {
    const b = h('button.td-chip' + (label ? '' : '.empty') + (bad ? '.bad' : ''), { title: field === 'due' ? 'Due date' : 'Owner' }, icon(ic, 11), label || ph);
    b.onclick = () => {
      const inp = h('input.td-chip-input', { value: field === 'owner' ? t.owner : t.due, placeholder: field === 'due' ? 'YYYY-MM-DD or "Friday"' : 'Name, or Me' });
      if (field === 'due') { inp.type = /^\d{4}-\d{2}-\d{2}$/.test(t.due) || !t.due ? 'date' : 'text'; }
      const done = async () => { const v = inp.value.trim(); if (v !== (t[field] || '')) Object.assign(t, await api.updateTodo(t.id, { [field]: v })); renderMain(); };
      inp.onblur = done; inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = t[field] || ''; inp.blur(); } };
      b.replaceWith(inp); inp.focus();
    };
    return b;
  }
  function addTodoInput({ meetingId = null, placeholder, big }) {
    const inp = h('input.todo-add' + (big ? '.big' : ''), { placeholder });
    inp.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      const raw = inp.value.trim();
      const parsed = parseQuickTodo(raw);
      const made = await api.addTodos([{ ...parsed, meetingId, source: 'manual' }]);
      S.todos = S.todos.concat(made); inp.value = '';
      renderMain(); renderSide();
      setTimeout(() => { const n = big ? $('.todo-add.big') : document.querySelector('.rail .todo-add'); if (n) n.focus(); }, 0);
    });
    return h('.todo-add-row', icon('plus', 15), inp);
  }
  // "Send deck to Maria friday" → due = the coming Friday
  function parseQuickTodo(s) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let due = '', text = s;
    const m = s.match(/\s+(?:by |on |due )?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)$/i);
    if (m) {
      const w = m[1].toLowerCase(), d = new Date();
      if (w === 'tomorrow') d.setDate(d.getDate() + 1);
      else if (w === 'next week') d.setDate(d.getDate() + (8 - d.getDay()) % 7 || 7);
      else if (w !== 'today') { const k = days.indexOf(w); d.setDate(d.getDate() + ((k - d.getDay() + 7) % 7 || 7)); }
      due = iso(d); text = s.slice(0, m.index).trim();
    }
    return { text, due, owner: '' };
  }

  // ---------------------------------------------------------------- ask across meetings
  function viewAsk() {
    const wrap = h('.view.askv');
    wrap.append(bar(h('.vb-title', 'Ask your meetings'), h('.grow'), S.ask.length ? h('button.btn.sm.ghost', { on: { click: () => { S.ask = []; renderMain(); } } }, 'Clear') : null));
    const sc = h('.scroll.ask-scroll', { 'data-key': 'ask' });
    if (!S.ask.length) {
      sc.append(h('.ask-hero', h('h2.serif', 'What do you want to know?'), h('p.muted', `${providerName() || 'AI'} reads the meetings that match your question and answers from them, with times you can jump to.`),
        h('.ask-sugs', ['What did I promise people this week?', 'What did we decide about pricing?', 'Summarize my meetings from yesterday', 'Who asked me for something I haven\'t done?'].map((q) => h('button.chip-btn.big', { on: { click: () => sendAsk(q) } }, q)))));
    } else sc.append(h('.ask-msgs.page', S.ask.map((x) => msg(x, null))));
    const input = h('textarea.ask-input.page', { rows: 1, placeholder: 'Ask about any meeting…', on: { keydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAsk(input.value); } }, input: (e) => autosize(e.target) } });
    wrap.append(sc, h('.ask-dock', h('.ask-row.page', input, h('button.btn.primary.sm', { disabled: S.asking, on: { click: () => sendAsk(input.value) } }, icon('send', 14), 'Ask'))));
    setTimeout(() => { input.focus(); sc.scrollTop = sc.scrollHeight; }, 0);
    return wrap;
  }
  async function sendAsk(q) {
    q = String(q || '').trim(); if (!q || S.asking) return;
    if (S.settings.aiProvider === 'off') { toast('Turn on AI in Settings first.', { action: { label: 'Settings', fn: () => go('settings') } }); return; }
    if (!S.meetings.length) { toast('There are no meetings to ask about yet.'); return; }
    S.asking = true;
    S.ask.push({ role: 'user', text: q }, { role: 'assistant', pending: true });
    renderMain();
    await flushAll();
    try {
      const r = await api.ask({ question: q, history: S.ask.slice(0, -2).filter((x) => !x.pending) });
      S.ask[S.ask.length - 1] = { role: 'assistant', text: r.answer, used: r.used };
    } catch (e) { S.ask[S.ask.length - 1] = { role: 'assistant', text: 'Couldn\'t answer: ' + e.message, bad: true }; }
    S.asking = false;
    if (S.view === 'ask') renderMain();
  }

  // ---------------------------------------------------------------- settings
  async function set(patch, rerender = true) {
    const r = await api.setSettings(patch);
    S.settings = r.settings;
    if (!r.shortcutOk && 'shortcut' in patch) toast('That shortcut is taken by another app. Try a different one.', { bad: true });
    if ('theme' in patch) applyTheme();
    if (rerender) render();
    return r;
  }
  function viewSettings() {
    const wrap = h('.view');
    wrap.append(bar(h('.vb-title', 'Settings'), h('.grow'), h('span.small.muted', 'Docket ' + S.version)));
    const sc = h('.scroll.settings', { 'data-key': 'settings' });
    const s = S.settings;
    const row = (label, help, control) => h('.set-row', h('.set-label', h('b', label), help ? h('span', help) : null), h('.set-ctl', control));
    const toggle = (key, after) => h('label.switch', h('input', { type: 'checkbox', checked: !!s[key], on: { change: async (e) => { await set({ [key]: e.target.checked }); after && after(); } } }), h('i'));
    const select = (key, opts, after) => h('select.select', { on: { change: async (e) => { await set({ [key]: e.target.value }); after && after(); } } }, opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)));

    // Transcription
    const e = S.engine.state;
    const presets = h('.presets', Object.entries(DE.MODELS).map(([k, m]) => h('button.preset' + (s.model === k ? '.on' : ''), { on: { click: async () => { await set({ model: k }); if (modelReady()) loadEngine(true); } } },
      h('b', m.label), h('span', m.note), h('em', '~' + m.mb.gpu + ' MB'), (s.modelReady || {})[DE.modelId({ ...s, model: k }) + '|' + k + '|' + s.device] ? h('i.ok-chip', icon('check', 11), 'Downloaded') : null)));
    sc.append(h('section.set-card', h('h3', icon('wave', 16), 'Transcription'), h('p.set-intro', 'Speech-to-text runs on this computer with Whisper. Audio never leaves your machine; only the text is sent when you summarize.'),
      presets,
      h('.engine-status', h('span', { 'data-engine-line': '' }, engineLine()), h('.grow'), e.status === 'ready' ? null : h('button.btn.sm' + (modelReady() ? '' : '.primary'), { disabled: e.status === 'loading', on: { click: () => loadEngine() } }, e.status === 'loading' ? 'Downloading…' : modelReady() ? 'Load now' : 'Download')),
      h('.bar-track', { hidden: e.status !== 'loading' }, h('i', { 'data-engine-bar': '' })),
      row('Language', 'English models are faster and more accurate for English-only calls.', select('language', [['en', 'English'], ['auto', 'Detect automatically'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ar', 'Arabic'], ['ur', 'Urdu'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean']], () => modelReady() && loadEngine(true))),
      row('Run on', 'The GPU is much faster. Use CPU only if transcripts come out garbled.', select('device', [['auto', 'GPU when available'], ['cpu', 'CPU only']], () => modelReady() && loadEngine(true)))));

    // Audio
    const mics = h('select.select', { on: { change: (ev) => set({ micId: ev.target.value }, false) } }, h('option', { value: 'default' }, 'System default'));
    navigator.mediaDevices.enumerateDevices().then((ds) => { for (const d of ds.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default')) mics.append(h('option', { value: d.deviceId, selected: s.micId === d.deviceId }, d.label || 'Microphone')); }).catch(() => {});
    const perms = S.perms || {};
    sc.append(h('section.set-card', h('h3', icon('mic', 16), 'Audio'),
      row('Your name', 'How you appear in transcripts and how the AI knows which to-dos are yours.', h('input.text', { value: s.myName === 'You' ? '' : s.myName, placeholder: 'You', on: { change: (ev) => set({ myName: ev.target.value.trim() || 'You' }, false) } })),
      row('Microphone', 'Your side of the conversation.', mics),
      row('Capture the call\'s audio', isMac() ? 'Hears everyone else on Zoom, Teams or Meet. macOS needs Screen & System Audio Recording permission for this.' : 'Hears everyone else on Zoom, Teams or Meet through your speakers or headphones.', toggle('captureSystem')),
      isMac() ? row('Permissions', null, h('.perm-line',
        h('span.perm' + (perms.mic === 'granted' ? '.ok' : ''), 'Microphone: ' + (perms.mic === 'granted' ? 'allowed' : 'not allowed')),
        h('span.perm' + (perms.screen === 'granted' ? '.ok' : ''), 'Call audio: ' + (perms.screen === 'granted' ? 'allowed' : 'not allowed')),
        perms.mic === 'granted' && perms.screen === 'granted' ? null : h('button.btn.sm', { on: { click: async () => { await api.askMic(); S.perms = await api.requestScreen(); if (S.perms.screen !== 'granted') api.openPerm('screen'); render(); } } }, 'Allow…'))) : null,
      row('Keep recordings', 'Saves the audio (about 15 MB an hour) so you can replay any line. Turn off to keep only the text.', toggle('keepAudio'))));

    // AI
    const prov = select('aiProvider', [['claude-cli', 'Claude — Claude Code CLI (your Claude plan)'], ['anthropic', 'Claude — Anthropic API key'], ['codex-cli', 'ChatGPT — Codex CLI (your ChatGPT plan)'], ['off', 'Off — transcripts only']], () => checkCli());
    const cliState = S.aiCli[s.aiProvider];
    sc.append(h('section.set-card', h('h3', icon('spark', 16), 'Summaries and to-dos'),
      h('p.set-intro', 'When a meeting ends, the transcript (text only) goes to the AI you pick here for a summary, decisions and action items.'),
      row('Written by', s.aiProvider.endsWith('-cli') ? (cliState === false ? h('span.bad-text', `The ${s.aiProvider === 'claude-cli' ? 'claude' : 'codex'} command isn't installed (or isn't on your PATH). Install it and sign in once in Terminal.`) : cliState ? `Found ${cliState}.` : 'Uses the signed-in CLI on this computer. No API key needed.') : null, prov),
      s.aiProvider === 'anthropic' ? row('API key', s.hasKey ? 'Saved and encrypted on this computer.' : 'From console.anthropic.com. Stored encrypted on this computer.', h('input.text', { type: 'password', placeholder: s.hasKey ? '••••••••••••' : 'sk-ant-…', on: { change: (ev) => set({ key: ev.target.value }) } })) : null,
      s.aiProvider !== 'off' ? row('Model', 'Leave blank for the default.', h('input.text', { value: s.aiProvider === 'anthropic' ? s.aiModel : s.cliModel, placeholder: s.aiProvider === 'anthropic' ? 'claude-sonnet-5-5' : 'default', on: { change: (ev) => set(s.aiProvider === 'anthropic' ? { aiModel: ev.target.value.trim() } : { cliModel: ev.target.value.trim() }, false) } })) : null,
      s.aiProvider !== 'off' ? row('Summarize automatically', 'As soon as a meeting ends.', toggle('autoSummary')) : null));

    // Meetings
    sc.append(h('section.set-card', h('h3', icon('bolt', 16), 'Starting and stopping'),
      row('Watch for calls', 'Notices Zoom, Teams, Google Meet, Webex and Slack huddle windows. ' + (isMac() ? 'Uses the same permission as call audio.' : ''), select('watch', [['notify', 'Ask me when a call starts'], ['auto', 'Start notes automatically'], ['off', 'Off']], async () => { if (isMac() && S.settings.watch !== 'off' && (S.perms || {}).screen !== 'granted') { S.perms = await api.requestScreen(); render(); } api.restartWatch(); })),
      row('Shortcut', 'Start or stop notes from anywhere.', shortcutInput()),
      row('Floating bar', 'A small timer with pause, mark and stop that floats over your call when Docket is in the background.', toggle('floatingBar'))));

    sc.append(h('section.set-card', h('h3', icon('folder', 16), 'Notes and look'),
      row('Notes folder', 'Every meeting is a folder with meeting.json, a readable notes.md and the recording.', h('.path-line', h('code', S.home), h('button.btn.sm', { on: { click: () => api.openHome() } }, 'Open'))),
      row('Appearance', null, select('theme', [['system', 'Match system'], ['dark', 'Dark'], ['light', 'Light']]))));
    sc.append(h('p.small.muted.center', 'Docket ' + S.version + ' · part of the Utility Suite · Speech recognition by Whisper (OpenAI) via Transformers.js'));
    wrap.append(sc);
    return wrap;
  }
  function shortcutInput() {
    const inp = h('input.text.kbd-input', { value: S.settings.shortcut ? shortcutLabel(S.settings.shortcut) : '', placeholder: 'Click, then press keys', readOnly: true });
    inp.addEventListener('keydown', async (e) => {
      e.preventDefault();
      if (e.key === 'Backspace' || e.key === 'Delete') { await set({ shortcut: '' }, false); inp.value = ''; return; }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const parts = [];
      if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (parts.length < 2 && !(parts.length === 1 && e.key.length > 1)) { toast('Use at least two modifier keys, like ' + (isMac() ? '⌘⇧⌥D' : 'Ctrl+Shift+Alt+D') + '.'); return; }
      const k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const acc = [...parts, k].join('+');
      const r = await set({ shortcut: acc }, false);
      inp.value = shortcutLabel(acc); inp.blur();
      if (r.shortcutOk) toast('Shortcut set');
    });
    return inp;
  }
  async function checkCli() {
    const p = S.settings.aiProvider;
    if (!p.endsWith('-cli')) return;
    const r = await api.detectAi(p).catch(() => ({ installed: false }));
    S.aiCli[p] = r.installed ? (r.version || true) : false;
    if (S.view === 'settings' || S.view === 'home') renderMain();
  }

  // ================================================================ commands (menu, tray, shortcut, bar)
  window.docket = {
    command(cmd, arg) {
      if (cmd === 'start') return start(arg || {});
      if (cmd === 'stop') return stop(arg || {});
      if (cmd === 'pause') return pause();
      if (cmd === 'resume') return resume();
      if (cmd === 'mark') return mark();
      if (cmd === 'view') return go(arg || 'home');
      if (cmd === 'import') return importFile(typeof arg === 'string' ? arg : undefined);
      if (cmd === 'find') { const s = $('#search'); if (s) s.focus(); return; }
      if (cmd === 'export' && S.view === 'meeting') return api.exportMeeting(S.meetingId);
    }
  };
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(), cmd = e.metaKey || e.ctrlKey;
    if (cmd && k === 'k') { e.preventDefault(); $('#search') && $('#search').focus(); }
    if (e.key === ' ' && audio && S.view === 'meeting' && !/input|textarea|select/i.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
    if (e.key === 'Escape' && document.activeElement && document.activeElement.id === 'search') { S.search = ''; S.hits = null; renderSide(); }
  });
  // Drop a recording anywhere to transcribe it.
  let dragN = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { dragN++; document.body.classList.add('dropping'); } });
  window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dropping'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragN = 0; document.body.classList.remove('dropping');
    const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
    const p = api.pathForFile(f);
    if (p && /\.(mp3|m4a|wav|webm|mp4|mov|ogg|aac|flac|mkv)$/i.test(p)) importFile(p); else toast('Drop an audio or video file to transcribe it.');
  });
  api.onDetected((d) => { S.detected = d; if (!S.live) renderSide(); });
  api.onFlush(async () => { await flushAll(); });
  window.addEventListener('beforeunload', () => { flushAll(); });

  // ================================================================ boot
  (async function boot() {
    const b = await api.bootstrap();
    Object.assign(S, { settings: b.settings, platform: b.platform, version: b.version, home: b.home, meetings: b.meetings, todos: b.todos, perms: b.permissions, providers: b.providers, detected: b.detected || null });
    // A meeting still marked "recording" means Docket closed mid-call: keep what was saved.
    for (const mm of S.meetings.filter((x) => x.status === 'recording')) {
      try { const m = await api.loadMeeting(mm.id); m.status = 'ready'; if (!m.durationMs && m.segments && m.segments.length) m.durationMs = Math.round(m.segments[m.segments.length - 1].t1 * 1000); if (m.audio) await api.finishAudio(m.id, m.durationMs).catch(() => {}); await api.saveMeeting(m); upsertMeta(m); } catch (_) {}
    }
    applyTheme();
    render();
    document.body.classList.add('ready');
    if (!b.shortcutOk && b.settings.shortcut) toast('The shortcut ' + shortcutLabel(b.settings.shortcut) + ' is used by another app. Pick another in Settings.');
    checkCli();
    if (modelReady()) setTimeout(() => loadEngine(true), 2500);
  })().catch((e) => { document.body.innerHTML = '<pre style="padding:40px;color:#e66">Docket failed to start: ' + String(e && e.stack || e).replace(/</g, '&lt;') + '</pre>'; });
})();

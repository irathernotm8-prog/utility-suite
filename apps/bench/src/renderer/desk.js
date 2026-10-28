// Bench — one desk, open: what's running, a live view of the app window (or the whole screen of a VM) that you can
// click and type into, Claude's actions as they happen (with a ghost cursor), logs and details.
'use strict';
const Desk = {
  st: null,
  desk() { return S.desks.find((d) => d.id === S.deskId); },
  isSandbox() { const d = this.desk(); return d && d.kind === 'sandbox'; },

  async render() {
    const d = this.desk(); if (!d) { S.deskId = null; return renderDesks(); }
    const prev = this.st && this.st.desk === d.id ? this.st : null;
    this.st = prev || { desk: d.id, session: null, win: null, tab: 'activity', level: 'all', logs: [], logSeq: 0, sessions: [], frame: null, dialogs: [], pendingCmd: false, follow: true };
    this.head();
    const v = $('#view'); v.className = 'flush';
    v.innerHTML = `<div class="desk-view a-${esc(d.color || 'pink')}">
      <div class="desk-left">
        <div class="sessions-bar" id="sessBar"></div>
        <div class="stage-wrap" id="stageWrap"><div class="stage-inner" id="stageInner"></div><div class="stage-tools" id="stageTools"></div><div class="stage-hud" id="stageHud"></div></div>
        <form class="cmd-bar" id="cmdBar">${icon('terminal', 16)}<input id="cmdIn" ${d.kind === 'vnc' && !(d.remote && d.remote.sshUser) ? 'disabled' : ''} placeholder="${d.kind === 'vnc' && !(d.remote && d.remote.sshUser) ? 'Add SSH to this desk to run commands on it' : d.kind === 'sandbox' ? 'Run a command on this computer, in the desk’s folder (npm test, a script…)' : d.kind === 'windows-sandbox' ? 'Run a command inside Windows Sandbox (cmd)' : 'Run a command inside the desk (over SSH)'}" autocomplete="off" spellcheck="false"><button class="btn sm" type="submit">Run</button></form>
      </div>
      <div class="desk-right">
        <div class="panel-tabs"><div class="seg full" id="rTabs"><button data-tab="activity">Activity</button><button data-tab="logs">Logs</button><button data-tab="details">Details</button></div></div>
        <div class="panel-body" id="panelBody"></div>
      </div>
    </div>`;
    $('#rTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { this.st.tab = b.dataset.tab; this.renderPanel(); } });
    $('#cmdBar').addEventListener('submit', (e) => { e.preventDefault(); this.runCmd(); });
    if (!S.activity[d.id] || !S.activity[d.id].loaded) { const a = await call('desks:activity', d.id).catch(() => []); const cur = S.activity[d.id] || []; const ids = new Set(cur.map((x) => x.id)); S.activity[d.id] = [...a.filter((x) => !ids.has(x.id)), ...cur].sort((x, y) => x.t - y.t); S.activity[d.id].loaded = true; }
    await this.refreshSessions();
    this.renderStageEmpty();
    this.renderPanel();
    this.watch();
    new ResizeObserver(() => this.layout()).observe($('#stageWrap'));
    hydrateIcons(v);
  },
  head() {
    const d = this.desk(); if (!d) return;
    const sb = d.kind === 'sandbox'; const running = d.state === 'running'; const busy = ['starting', 'stopping', 'preparing'].includes(d.state);
    const right = sb
      ? `<button class="btn" data-act="desk-hide" title="Where this desk’s app windows go">${icon(d.hidden !== false ? 'eyeOff' : 'eye', 15)}${d.hidden !== false ? 'Out of sight' : 'On screen'}</button><button class="btn primary" data-act="launch" data-id="${d.id}">${icon('plus', 15)}Launch</button><button class="icon-btn" data-act="desk-menu" data-id="${d.id}">${icon('more')}</button>`
      : `${running ? `<button class="btn" data-act="desk-stop" data-id="${d.id}">${icon('stop', 14)}${d.kind === 'vnc' ? 'Disconnect' : 'Stop'}</button>` : `<button class="btn" data-act="desk-start" data-id="${d.id}" ${busy || d.preparing ? 'disabled' : ''}>${busy ? '<span class="spin"></span>' : icon('play', 14)}${d.kind === 'vnc' ? 'Connect' : 'Start'}</button>`}<button class="btn primary" data-act="launch" data-id="${d.id}" ${running ? '' : 'disabled'}>${icon('plus', 15)}Open or install</button><button class="icon-btn" data-act="desk-menu" data-id="${d.id}">${icon('more')}</button>`;
    head(esc(d.name), `${esc(d.kindLabel)} · ${sb ? 'apps run here with their own data' : esc(STATE_LABEL[d.state] || d.state)}${d.detail && !sb ? ' · ' + esc(d.detail) : ''}`, right, true);
    hydrateIcons($('#head'));
  },
  leave() { window.bench.send('live:unwatch'); this.ghostEl = null; },
  watch() { const s = this.st; window.bench.send('live:watch', { desk: s.desk, session: s.session, win: s.win, dpr: window.devicePixelRatio || 1 }); },
  onDesk() { this.head(); if (!this.isSandbox()) this.renderSessions(); },
  onState() { this.head(); if (!this.isSandbox()) { this.renderSessions(); if (this.desk().state !== 'running') this.renderStageEmpty(); } },

  // ── sessions
  async refreshSessions() {
    const d = this.desk(); if (!d || !this.st) return;
    if (d.kind === 'sandbox') {
      const list = await call('desk:sessions', d.id).catch(() => []);
      const before = new Set(this.st.sessions.map((s) => s.id));
      this.st.sessions = list;
      const fresh = list.filter((s) => !before.has(s.id) && s.state !== 'exited');
      const cur = list.find((s) => s.id === this.st.session);
      if (this.st.pendingCmd && fresh.find((s) => s.kind === 'command')) { this.select(fresh.find((s) => s.kind === 'command').id, true); this.st.pendingCmd = false; }
      else if (fresh.find((s) => s.kind === 'electron')) this.select(fresh.find((s) => s.kind === 'electron').id, true);
      else if (!cur) { const pick = list.slice().reverse().find((s) => s.state !== 'exited' && s.kind === 'electron') || list.slice().reverse().find((s) => s.state !== 'exited'); if (pick) this.select(pick.id, true); }
      this.st.dialogs = []; for (const s of list) for (const dl of s.dialogs || []) this.st.dialogs.push({ ...dl, session: s.id, app: s.name });
    }
    this.renderSessions(); this.renderDialogs();
    if (this.st.tab === 'details') this.renderPanel();
  },
  select(id, quiet) {
    if (!this.st) return;
    this.st.session = id; this.st.win = null; this.st.logs = []; this.st.logSeq = 0; this.st.frame = null;
    this.renderSessions(); this.watch(); this.loadLogs();
    if (!quiet || this.st.tab !== 'activity') this.renderPanel();
  },
  renderSessions() {
    const bar = $('#sessBar'); const d = this.desk(); if (!bar || !d) return;
    if (d.kind !== 'sandbox') {
      const live = d.live || {}; const sz = live.screen;
      bar.innerHTML = d.state === 'running' ? `<span class="sess on">${icon(KIND_ICON[d.kind], 14)}${esc(d.kindLabel)}${sz ? ` <span class="ver">${sz.width}×${sz.height}</span>` : ''}</span>${live.ip ? `<span class="sess">${icon('globe', 14)}${esc(live.ip)}</span>` : ''}<span class="sess">${icon('terminal', 14)}${live.commands ? 'Commands ready' : d.kind === 'vnc' ? 'Screen only (no SSH)' : 'Commands not ready yet'}</span>` : `<span class="muted small" style="padding:6px 2px">${d.state === 'stopped' ? (d.kind === 'vnc' ? 'Not connected.' : 'Stopped. Start it to see its desktop.') : esc(d.detail || '')}</span>`;
      hydrateIcons(bar); return;
    }
    const list = this.st.sessions;
    const live = list.filter((s) => s.state !== 'exited'); const dead = list.filter((s) => s.state === 'exited').slice(-4).reverse();
    bar.innerHTML = [...live, ...dead].map((s) => `<span class="sess ${s.id === this.st.session ? 'on' : ''} ${s.state === 'exited' ? 'dead' : ''}" data-act="sess" data-sid="${s.id}" title="${esc(s.kind === 'command' ? s.command : s.name)}">
        <span class="dot ${s.state === 'exited' ? (s.exit && (s.exit.code || s.exit.signal) ? 'bad' : '') : s.kind === 'command' ? 'busy' : 'on'}"></span>${s.kind === 'command' ? icon('terminal', 13) : ''}<span class="ellip" style="max-width:160px">${esc(s.name)}</span>${s.meta && s.meta.version ? `<span class="ver">${esc(s.meta.version)}</span>` : ''}${s.errors ? `<span class="err">${s.errors}</span>` : ''}
        ${s.state !== 'exited' ? `<button class="icon-btn" data-act="sess-stop" data-sid="${s.id}" title="${s.kind === 'command' ? 'Stop' : 'Quit'}">${icon('close', 13)}</button>` : `<button class="icon-btn" data-act="sess-forget" data-sid="${s.id}" title="Remove from the list">${icon('close', 13)}</button>`}
      </span>`).join('') + `<button class="btn sm ghost" data-act="launch" data-id="${d.id}">${icon('plus', 14)}Launch</button>`;
    hydrateIcons(bar);
  },

  // ── stage
  renderStageEmpty(msg) {
    const inner = $('#stageInner'); if (!inner) return; const d = this.desk();
    this.st.frame = null; this.ghostEl = null;
    let title, text, btn = '';
    if (d.kind === 'sandbox') {
      const s = this.st.sessions.find((x) => x.id === this.st.session);
      if (s && s.kind === 'command') { title = s.state === 'exited' ? `${s.exit && s.exit.code === 0 ? 'Finished' : 'Stopped'}` : 'Running a command'; text = `${esc(s.command)} — its output is in Logs.`; }
      else if (msg && /quit|without a view/.test(msg)) { title = esc(msg); text = 'Its logs are still here. Launch it again to keep testing.'; btn = `<button class="btn primary" data-act="launch" data-id="${d.id}">${icon('plus', 15)}Launch</button>`; }
      else { title = 'Nothing open on this desk'; text = 'Launch a Utility Suite app, an app’s source folder, any Electron app or a web page. It gets its own data here' + (d.hidden !== false ? ' and its windows stay out of sight; you see them here.' : '.'); btn = `<button class="btn primary" data-act="launch" data-id="${d.id}">${icon('plus', 15)}Launch</button>`; }
    } else if (d.state === 'running') { title = 'Connecting to the screen…'; text = ''; }
    else if (['starting', 'preparing', 'stopping'].includes(d.state)) { title = esc(d.detail || STATE_LABEL[d.state]); text = d.kind === 'windows-sandbox' ? 'Windows Sandbox opens in its own window too.' : 'This can take a minute.'; btn = '<span class="spin" style="width:20px;height:20px"></span>'; }
    else { title = d.kind === 'vnc' ? 'Not connected' : 'This desk is stopped'; text = d.error ? esc(d.error) : d.kind === 'mac-vm' ? 'Start it to boot a clean macOS desktop. Claude can start it too.' : d.kind === 'linux-vm' ? 'Start it to boot Ubuntu.' : d.kind === 'windows-sandbox' ? 'Start it for a fresh Windows desktop.' : 'Connect to see and use its screen.'; btn = `<button class="btn primary" data-act="desk-start" data-id="${d.id}">${icon('play', 14)}${d.kind === 'vnc' ? 'Connect' : 'Start'}</button>`; }
    inner.innerHTML = `<div class="stage-empty">${deskArt(d)}<h3>${title}</h3><p>${text}</p>${btn}</div>`;
    $('#stageTools').innerHTML = ''; this.renderHud();
    hydrateIcons(inner);
  },
  onFrame(f) {
    if (!this.st || !$('#stageInner')) return;
    if (f.empty) { if (this.st.frame || !$('.stage-empty')) this.renderStageEmpty(f.empty); this.st.windows = f.windows || []; return; }
    const first = !this.st.frame || !$('#stageInner .appwin');
    const winChanged = this.st.frame && (this.st.frame.win !== f.win || (f.windows && JSON.stringify((this.st.frame.windows || []).map((w) => w.id + w.title)) !== JSON.stringify(f.windows.map((w) => w.id + w.title))));
    this.st.frame = f; if (f.session && !this.st.session) this.st.session = f.session;
    if (first || winChanged) this.buildWindow(f);
    const img = $('#scrImg'); if (img) img.src = f.url;
    const t = $('#winTitle'); if (t && f.title != null) t.textContent = f.title;
    if (first || winChanged || this._lastSize !== `${f.winWidth || f.screenWidth}x${f.winHeight || f.screenHeight}`) this.layout();
  },
  buildWindow(f) {
    const d = this.desk(); const sb = d.kind === 'sandbox';
    const s = this.st.sessions.find((x) => x.id === f.session) || {};
    const wins = (f.windows || []).filter((w) => w.visible);
    $('#stageInner').innerHTML = `<div class="appwin ${sb ? '' : 'full'}" id="appwin">
      ${sb ? `<div class="tb"><span class="lights"><i></i><i></i><i></i></span><b>${esc(s.name || '')}</b><span class="ellip muted" id="winTitle">${esc(f.title || '')}</span>
        ${wins.length > 1 ? `<span class="wtabs">${wins.map((w) => `<button class="${w.id === f.win ? 'on' : ''}" data-act="pick-win" data-win="${w.id}">${esc(w.title || 'Window ' + w.id)}</button>`).join('')}</span>` : ''}</div>` : ''}
      <div class="scr" id="scr" tabindex="0"><img id="scrImg" alt="" draggable="false"></div>
    </div>`;
    this.ghostEl = null;
    this.bindInput();
    const tools = $('#stageTools');
    tools.innerHTML = `${sb && s.id ? `<button class="icon-btn sm" data-act="sess-visible" title="${s.hidden ? 'Show this app’s windows on your screen' : 'Put this app’s windows out of sight'}">${icon(s.hidden ? 'eye' : 'eyeOff', 16)}</button>` : ''}
      <button class="icon-btn sm" data-act="stage-shot" title="Save a screenshot to Pictures › Bench">${icon('camera', 16)}</button>
      ${sb ? `<button class="icon-btn sm" data-act="stage-menu" title="App menu">${icon('list', 16)}</button>` : ''}
      <button class="icon-btn sm" data-act="file-finding" title="File a finding about what’s on screen">${icon('bug', 16)}</button>`;
    hydrateIcons(tools); this.renderHud(); this.renderDialogs();
  },
  layout() {
    const f = this.st && this.st.frame; const wrap = $('#stageWrap'); const win = $('#appwin'); const scr = $('#scr');
    if (!f || !wrap || !win || !scr) return;
    const sb = this.isSandbox(); const W = f.winWidth || f.screenWidth || f.width, Hh = f.winHeight || f.screenHeight || f.height;
    this._lastSize = `${W}x${Hh}`;
    const availW = wrap.clientWidth - 44, availH = wrap.clientHeight - 44 - (sb ? 30 : 0) - 34;
    const k = Math.min(sb ? 1 : 10, availW / W, availH / Hh);
    const w = Math.max(80, Math.floor(W * k)), h = Math.max(60, Math.floor(Hh * k));
    scr.style.width = w + 'px'; scr.style.height = h + 'px'; win.style.width = w + 'px';
    this.st.view = { w, h, W, H: Hh };
  },
  toDesk(ev) { const r = $('#scr').getBoundingClientRect(); const v = this.st.view; return { x: ((ev.clientX - r.left) / r.width) * v.W, y: ((ev.clientY - r.top) / r.height) * v.H }; },
  bindInput() {
    const scr = $('#scr'); if (!scr) return; const self = this; let lastMove = 0;
    const send = (o) => { const f = self.st.frame; if (!f) return; window.bench.send('live:input', { desk: self.st.desk, session: f.session, win: f.win, ...o }); };
    const mask = (b) => ((b & 1) ? 1 : 0) | ((b & 4) ? 2 : 0) | ((b & 2) ? 4 : 0);
    const mods = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
    scr.addEventListener('mousedown', (e) => { e.preventDefault(); scr.focus(); const p = self.toDesk(e); send({ type: 'mouse', action: 'down', ...p, button: e.button, buttons: e.buttons, buttonsMask: mask(e.buttons), clicks: e.detail || 1, mods: mods(e) }); });
    scr.addEventListener('mouseup', (e) => { const p = self.toDesk(e); send({ type: 'mouse', action: 'up', ...p, button: e.button, buttons: e.buttons, buttonsMask: mask(e.buttons), clicks: e.detail || 1, mods: mods(e) }); });
    scr.addEventListener('mousemove', (e) => { const now = performance.now(); if (now - lastMove < (e.buttons ? 16 : 50)) return; lastMove = now; const p = self.toDesk(e); send({ type: 'mouse', action: 'move', ...p, button: e.button, buttons: e.buttons, buttonsMask: mask(e.buttons), mods: mods(e) }); });
    scr.addEventListener('wheel', (e) => { e.preventDefault(); const p = self.toDesk(e); send({ type: 'wheel', ...p, dx: e.deltaX, dy: e.deltaY }); }, { passive: false });
    scr.addEventListener('contextmenu', (e) => e.preventDefault());
    const key = (action) => (e) => { if (e.isComposing) return; e.preventDefault(); e.stopPropagation(); send({ type: 'key', action, key: e.key, code: e.code, keyCode: e.keyCode, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey }); };
    scr.addEventListener('keydown', key('down')); scr.addEventListener('keyup', key('up'));
    scr.addEventListener('paste', (e) => { const t = e.clipboardData.getData('text'); if (t && self.isSandbox()) { e.preventDefault(); call('desk:menuClick', self.st.desk, self.st.frame.session, ['Edit', 'Paste']).catch(() => {}); } });
  },
  renderHud() {
    const hud = $('#stageHud'); if (!hud || !this.st) return;
    const acts = (S.activity[this.st.desk] || []).filter((a) => /claude|codex/i.test(a.who));
    const last = acts[acts.length - 1];
    const working = last && Date.now() - last.t < 10000;
    const d = this.desk();
    hud.innerHTML = `${working ? `<span class="hud-pill claude">${icon('spark', 14)}<b>${esc(last.who)}</b><span class="ellip" style="max-width:340px">${esc(last.text)}</span></span>` : ''}<span class="grow"></span>
      ${this.st.frame ? `<span class="hud-pill">${this.isSandbox() ? `${icon(d.hidden !== false ? 'eyeOff' : 'eye', 14)}${d.hidden !== false ? 'Out of sight · live here' : 'On screen'}` : `${icon('keyboard', 14)}Click the screen to use it`}</span>` : ''}`;
    clearTimeout(this._hudT); if (working) this._hudT = setTimeout(() => this.renderHud(), 10500);
  },
  ghost(e) {
    const f = this.st && this.st.frame; const v = this.st && this.st.view; const scr = $('#scr');
    if (!f || !v || !scr || e.x == null) return;
    if (this.isSandbox() && ((e.session && e.session !== f.session) || (e.win && e.win !== f.win))) return;
    const r = scr.getBoundingClientRect(); const wr = $('#stageWrap').getBoundingClientRect();
    const px = r.left - wr.left + (e.x / v.W) * r.width, py = r.top - wr.top + (e.y / v.H) * r.height;
    if (!this.ghostEl || !this.ghostEl.isConnected) { this.ghostEl = document.createElement('div'); this.ghostEl.className = 'ai-cursor'; this.ghostEl.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3.5 18.5 12l-6 1.6L9.4 19.5z"/></svg><span class="tag"></span>`; $('#stageWrap').appendChild(this.ghostEl); this.ghostEl.style.left = px + 'px'; this.ghostEl.style.top = py + 'px'; }
    this.ghostEl.querySelector('.tag').textContent = e.who === 'You' ? 'You' : e.who;
    this.ghostEl.style.display = e.who === 'You' ? 'none' : '';
    requestAnimationFrame(() => { this.ghostEl.style.left = px + 'px'; this.ghostEl.style.top = py + 'px'; });
    setTimeout(() => { const rp = document.createElement('div'); rp.className = 'ripple'; rp.style.left = px + 'px'; rp.style.top = py + 'px'; $('#stageWrap') && $('#stageWrap').appendChild(rp); setTimeout(() => rp.remove(), 800); }, 330);
    clearTimeout(this._ghostT); this._ghostT = setTimeout(() => { if (this.ghostEl) this.ghostEl.style.opacity = '0'; }, 6000); this.ghostEl.style.opacity = '1';
  },

  // ── dialogs the app is waiting on
  onDialog(e) { if (e.dialog.pending) { this.st.dialogs = this.st.dialogs.filter((x) => x.id !== e.dialog.id || x.session !== e.session); const s = this.st.sessions.find((x) => x.id === e.session); this.st.dialogs.push({ ...e.dialog, session: e.session, app: s ? s.name : '' }); this.renderDialogs(); } else this.refreshSessions(); },
  renderDialogs() {
    const wrap = $('#stageWrap'); if (!wrap) return; $$('.dialog-card', wrap).forEach((x) => x.remove());
    const dl = (this.st.dialogs || []).find((x) => !this.st.session || x.session === this.st.session); if (!dl) return;
    const c = document.createElement('div'); c.className = 'dialog-card';
    const what = dl.kind === 'open' ? 'wants you to pick a file' : dl.kind === 'save' ? 'wants to know where to save' : 'is asking';
    c.innerHTML = `<h4>${icon('dialog', 17)}${esc(dl.app || 'The app')} ${what}</h4><p>${esc(dl.title || '')}${dl.message ? (dl.title ? ' — ' : '') + esc(dl.message) : ''}${dl.detail ? `<br><span class="muted">${esc(dl.detail)}</span>` : ''}<br><span class="muted small">Native dialogs never show in screenshots, so Bench holds them here for you or Claude to answer.</span></p>
      <div class="row">${dl.kind === 'message' ? (dl.buttons.length ? dl.buttons : ['OK']).map((b, i) => `<button class="btn sm ${i === (dl.defaultId || 0) ? 'primary' : ''}" data-act="dlg-answer" data-btn="${i}">${esc(b)}</button>`).join('') : `<button class="btn sm" data-act="dlg-cancel">Cancel</button><button class="btn sm primary" data-act="dlg-pick">${dl.kind === 'open' ? 'Choose file…' : 'Choose where…'}</button>`}</div>`;
    c.dataset.id = dl.id; c.dataset.session = dl.session; c.dataset.kind = dl.kind;
    wrap.appendChild(c); hydrateIcons(c);
  },
  async answer(ans) {
    const c = $('.dialog-card'); if (!c) return;
    await call('desk:answer', this.st.desk, c.dataset.session, { id: +c.dataset.id, kind: c.dataset.kind, ...ans });
    this.st.dialogs = this.st.dialogs.filter((x) => !(x.id === +c.dataset.id && x.session === c.dataset.session)); c.remove(); this.renderDialogs();
  },

  // ── right panel
  renderPanel() {
    const body = $('#panelBody'); if (!body || !this.st) return;
    $$('#rTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.st.tab));
    if (this.st.tab === 'activity') this.renderActivity();
    else if (this.st.tab === 'logs') { body.innerHTML = `<div class="logbar"><div class="seg" id="lvl"><button data-l="all">All</button><button data-l="warnings">Warnings</button><button data-l="errors">Errors</button></div><span class="grow"></span><button class="icon-btn sm" data-act="logs-copy" title="Copy">${icon('copy', 15)}</button></div><div class="loglines" id="logLines"></div>`; $$('#lvl button').forEach((b) => b.classList.toggle('on', b.dataset.l === this.st.level)); $('#lvl').onclick = (e) => { const b = e.target.closest('button'); if (b) { this.st.level = b.dataset.l; this.renderPanel(); } }; this.renderLogs(); if (!this.st.logSeq) this.loadLogs(); }
    else this.renderDetails();
    hydrateIcons(body);
  },
  renderActivity() {
    const body = $('#panelBody'); const list = (S.activity[this.st.desk] || []).filter((a) => a.action !== 'progress' || a === (S.activity[this.st.desk] || []).slice(-1)[0]).slice(-160).reverse();
    body.innerHTML = list.length ? `<div class="activity" id="actList">${list.map((a) => this.actRow(a)).join('')}</div>` : `<div class="empty">${icon('clock', 30)}<div>Nothing yet. What you and Claude do on this desk shows up here.</div></div>`;
  },
  actRow(a, fresh) {
    const ai = /claude|codex/i.test(a.who); const you = a.who === 'You';
    const s = this.st.sessions.find((x) => x.id === a.session);
    return `<div class="act ${a.ok === false ? 'bad' : ''} ${fresh ? 'fresh' : ''}"><div class="who ${ai ? 'claude' : you ? 'you' : ''}">${icon(ai ? 'spark' : you ? 'user' : 'desk', 14)}</div><div><div class="t">${esc(a.text)}</div><div class="m">${esc(a.who)} · ${clock(a.t)}${s ? ' · ' + esc(s.name) : ''}</div></div></div>`;
  },
  onActivity(e) {
    if (!this.st) return;
    if (this.st.tab === 'activity') { const l = $('#actList'); if (l) { if (e.action === 'progress' && l.firstElementChild && l.firstElementChild.dataset.progress) l.firstElementChild.remove(); l.insertAdjacentHTML('afterbegin', this.actRow(e, true)); if (e.action === 'progress') l.firstElementChild.dataset.progress = '1'; while (l.children.length > 200) l.lastElementChild.remove(); hydrateIcons(l); } else this.renderActivity(); }
    if (e.x != null && !e.quiet) this.ghost(e);
    this.renderHud();
    if (/launched|stop|dialog|command-done/.test(e.action)) this.refreshSessions();
  },
  async loadLogs() {
    if (!this.st) return; const r = await call('desk:logs', this.st.desk, this.st.session, 0).catch(() => null); if (!r) return;
    this.st.logs = r.items; this.st.logSeq = r.seq; if (this.st.tab === 'logs') this.renderLogs();
  },
  logRow(e) { return `<div class="ll ${e.level}"><span class="tm">${clock(e.t)}</span><span class="tx"><span class="src">${esc(e.source === 'window' ? `window${e.win ? ' ' + e.win : ''}` : e.source)}</span>${esc(e.text)}</span></div>`; },
  filterLog(e) { const l = this.st.level; return l === 'all' || (l === 'errors' ? e.level === 'error' : e.level === 'error' || e.level === 'warning'); },
  renderLogs() { const el = $('#logLines'); if (!el) return; const items = this.st.logs.filter((e) => this.filterLog(e)).slice(-600); el.innerHTML = items.length ? items.map((e) => this.logRow(e)).join('') : `<div class="muted small" style="padding:20px 4px">${this.st.session ? 'Nothing logged yet.' : 'Pick something running to see its logs.'}</div>`; const pb = $('#panelBody'); pb.scrollTop = pb.scrollHeight; },
  onLog(e) {
    if (!this.st) return;
    if ((e.session || null) !== (this.st.session || null) && !(e.session === null && !this.isSandbox())) { if (e.entry.level === 'error') this.refreshSessionsSoon(); return; }
    this.st.logs.push(e.entry); if (this.st.logs.length > 2000) this.st.logs.splice(0, 500); this.st.logSeq = e.entry.seq;
    if (this.st.tab === 'logs' && this.filterLog(e.entry)) { const el = $('#logLines'); const pb = $('#panelBody'); if (el) { const atEnd = pb.scrollHeight - pb.scrollTop - pb.clientHeight < 40; if (el.querySelector('.muted')) el.innerHTML = ''; el.insertAdjacentHTML('beforeend', this.logRow(e.entry)); if (atEnd) pb.scrollTop = pb.scrollHeight; } }
    if (e.entry.level === 'error') this.refreshSessionsSoon();
  },
  refreshSessionsSoon() { clearTimeout(this._rs); this._rs = setTimeout(() => this.refreshSessions(), 400); },
  renderDetails() {
    const body = $('#panelBody'); const d = this.desk(); const s = this.st.sessions.find((x) => x.id === this.st.session);
    const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    let html = '';
    if (s) {
      html += `<div><h4>${esc(s.name)}</h4>${kv([
        ['Kind', s.kind === 'electron' ? (s.controlled ? 'Electron app · Bench can see and control it' : 'Electron app · logs only') : s.kind === 'command' ? 'Command' : 'App (logs only)'],
        s.meta && s.meta.version ? ['Version', esc(s.meta.version)] : null,
        s.meta && s.meta.source ? ['From', { installed: 'Installed app', project: 'Its source folder', web: 'Bench’s browser', path: 'A path you picked' }[s.meta.source] || esc(s.meta.source)] : null,
        s.kind === 'command' ? ['Command', `<span class="path">${esc(s.command)}</span>`] : null,
        s.kind === 'command' ? ['Folder', `<span class="path">${esc(s.cwd)}</span>`] : null,
        s.meta && s.meta.data ? ['Data', s.meta.data === 'fresh' ? 'Fresh (thrown away when it quits)' : s.meta.data === 'real' ? 'Your real data' : 'This desk’s own'] : null,
        s.meta && s.meta.userData ? ['App data', `<span class="path">${esc(s.meta.userData)}</span>`] : null,
        ['State', esc(s.state) + (s.exit ? ` (${s.exit.signal || 'code ' + s.exit.code})` : '')],
        s.pid ? ['Process', s.pid] : null,
        s.electron ? ['Electron', esc(s.electron)] : null,
        s.firstWindowMs ? ['First window', fmtMs(s.firstWindowMs)] : null,
        ['Problems', `${s.errors || 0} errors · ${s.warnings || 0} warnings${s.crashes ? ` · ${s.crashes} crashes` : ''}`],
        s.windows && s.windows.length ? ['Windows', s.windows.map((w) => `${w.id} “${esc(w.title)}” ${w.width}×${w.height}`).join('<br>')] : null,
      ])}</div>`;
    }
    const kinds = { sandbox: 'Sandbox', 'mac-vm': 'Mac VM', 'linux-vm': 'Linux VM', 'windows-sandbox': 'Windows Sandbox', vnc: 'Another computer' };
    html += `<div><h4>Desk</h4>${kv([
      ['Kind', kinds[d.kind]],
      d.kind === 'sandbox' ? ['Windows', d.hidden !== false ? 'Out of sight (shown here)' : 'On your screen'] : null,
      d.vm && d.kind !== 'windows-sandbox' ? ['System', esc(d.vm.image || '')] : null,
      d.vm && d.vm.cpu ? ['Cores', d.vm.cpu] : null, d.vm && d.vm.memoryGB ? ['Memory', d.vm.memoryGB + ' GB'] : null,
      d.vm && d.vm.cleanSaved ? ['Clean copy', 'Saved ' + ago(d.vm.cleanSaved)] : null,
      d.remote ? ['Address', esc(`${d.remote.host}:${d.remote.vncPort}`)] : null,
      d.remote && d.remote.sshUser ? ['SSH', esc(`${d.remote.sshUser}@${d.remote.host}:${d.remote.sshPort}`)] : null,
      ['Created', new Date(d.created).toLocaleDateString()],
      d.notes ? ['Notes', esc(d.notes)] : null,
    ])}<div class="row" style="margin-top:10px"><button class="btn sm" data-act="desk-folder">${icon('folder', 14)}Desk folder</button>${d.kind === 'sandbox' ? `<button class="btn sm" data-act="desk-hide">${icon(d.hidden !== false ? 'eye' : 'eyeOff', 14)}${d.hidden !== false ? 'Show windows' : 'Hide windows'}</button>` : ''}</div></div>`;
    body.innerHTML = `<div class="info-list">${html}</div>`;
  },

  async runCmd() {
    const inp = $('#cmdIn'); const cmd = inp.value.trim(); if (!cmd) return;
    inp.value = ''; this.st.pendingCmd = true; this.st.tab = 'logs';
    const t = toast({ kind: 'busy', title: 'Running', text: cmd, ms: 600000 });
    try {
      const r = await call('desk:run', this.st.desk, cmd);
      t.remove();
      if (!this.isSandbox()) { this.st.logs.push({ seq: 0, t: Date.now(), level: r.code === 0 ? 'info' : 'error', source: 'command', text: `$ ${cmd}\n${r.output || '(no output)'}\n(exit code ${r.code})` }); this.renderPanel(); }
      else toast({ kind: r.code === 0 ? 'ok' : 'bad', title: r.code === 0 ? 'Command finished' : `Command failed (code ${r.code})`, text: cmd });
    } catch (e) { t.remove(); toast({ kind: 'bad', title: 'Command failed', text: e.message }); }
  },

  async act(a, el) {
    if (!this.st) return false;
    switch (a) {
      case 'sess': this.select(el.dataset.sid); return true;
      case 'sess-stop': await call('desk:quit', this.st.desk, el.dataset.sid); await this.refreshSessions(); return true;
      case 'sess-forget': await call('desk:forget', this.st.desk, el.dataset.sid); if (this.st.session === el.dataset.sid) this.st.session = null; await this.refreshSessions(); return true;
      case 'pick-win': this.st.win = +el.dataset.win; this.watch(); return true;
      case 'sess-visible': { const s = this.st.sessions.find((x) => x.id === (this.st.frame && this.st.frame.session)); if (s) { await call('desk:visible', this.st.desk, s.id, !!s.hidden); s.hidden = !s.hidden; this.buildWindow(this.st.frame); this.layout(); } return true; }
      case 'desk-hide': { const d = this.desk(); await call('desks:update', d.id, { hidden: d.hidden === false }); return true; }
      case 'stage-shot': { const f = await call('desk:shot', this.st.desk, this.st.frame && this.st.frame.session, this.st.frame && this.st.frame.win); toast({ kind: 'ok', title: 'Screenshot saved', text: f }); return true; }
      case 'stage-menu': { const items = await call('desk:menu', this.st.desk, this.st.frame && this.st.frame.session); const flat = []; const walk = (list, p) => { for (const it of list || []) { if (it.submenu) walk(it.submenu, p.concat(it.label)); else if (it.label && it.enabled !== false) flat.push({ label: [...p, it.label].join(' › ') + (it.accelerator ? `   ${it.accelerator.replace(/CmdOrCtrl|CommandOrControl/, window.bench.platform === 'darwin' ? '⌘' : 'Ctrl')}` : ''), run: () => call('desk:menuClick', this.st.desk, this.st.frame.session, [...p, it.label]) }); } }; walk(items, []); menu(el, flat.length ? flat.slice(0, 40) : [{ label: 'This app has no menu', disabled: true, run: () => {} }]); return true; }
      case 'file-finding': Sheets.finding({ desk: this.st.desk, session: this.st.frame && this.st.frame.session }); return true;
      case 'dlg-answer': await this.answer({ button: +el.dataset.btn }); return true;
      case 'dlg-cancel': await this.answer({ cancel: true }); return true;
      case 'dlg-pick': { const c = $('.dialog-card'); if (c.dataset.kind === 'open') { const p = await call('dialog:pick', 'file'); if (p) await this.answer({ paths: [p] }); } else { const p = await call('dialog:save'); if (p) await this.answer({ path: p }); } return true; }
      case 'desk-folder': await call('desk:folder', this.st.desk); return true;
      case 'logs-copy': await call('clipboard:write', this.st.logs.filter((e) => this.filterLog(e)).map((e) => `${clock(e.t)} [${e.level}] ${e.source}: ${e.text}`).join('\n')); toast({ kind: 'ok', title: 'Logs copied' }); return true;
    }
    return false;
  },
};

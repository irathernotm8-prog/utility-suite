// Bench — Runs (smoke tests and test suites), Findings, Claude, Virtual machines and Settings.
'use strict';
const Views = {
  // ───────── runs
  async runs() {
    head('Runs', 'smoke tests and test suites, as many at once as this computer allows');
    if (!S.catalog) S.catalog = await call('catalog:apps').catch(() => ({ installed: [], projects: [] }));
    const c = S.catalog; const h = S.host;
    this.runOpts = this.runOpts || { source: c.installed.length ? 'installed' : 'projects', pick: 'all', apps: [], parallel: h.limits.apps, wait: 4, tests: 'all', projects: [], testPar: h.limits.tests, script: 'test' };
    const o = this.runOpts;
    const pool = o.source === 'installed' ? c.installed : c.projects.filter((p) => !p.hub);
    const testable = c.projects.filter((p) => p.scripts.includes(o.script));
    $('#view').innerHTML = `
      <div class="run-actions">
        <div class="big-card feature">
          <h3>${icon('flask', 18)}Smoke test apps</h3>
          <p>Opens each app with fresh data and its windows out of sight, waits for it to settle, takes a picture of every window and collects console errors and crashes. Then it closes them.</p>
          <div class="opts"><div class="seg" id="srcSeg"><button data-v="installed" ${c.installed.length ? '' : 'disabled'}>Installed (${c.installed.length})</button><button data-v="projects" ${c.projects.length ? '' : 'disabled'}>From source (${c.projects.filter((p) => !p.hub).length})</button></div>
            <div class="seg" id="pickSeg"><button data-v="all">All</button><button data-v="some">Choose…</button></div></div>
          ${o.pick === 'some' ? `<div class="chiprow" id="appChips">${pool.map((a) => `<button class="chip ${o.apps.includes(a.id) ? 'on' : ''}" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join('') || '<span class="muted small">Nothing found</span>'}</div>` : ''}
          <div class="opts"><span class="label">At once</span><div class="chiprow" id="parChips">${[1, 2, 4, 6, 8, 12].filter((n) => n <= Math.max(h.limits.apps, 2) * 2 || n <= 4).map((n) => `<button class="chip ${o.parallel === n ? 'on' : ''}" data-n="${n}">${n}${n === h.limits.apps ? ' <small>suggested</small>' : ''}</button>`).join('')}</div></div>
          <div class="opts"><span class="label">Settle for</span><div class="chiprow" id="waitChips">${[2, 4, 8, 15].map((n) => `<button class="chip ${o.wait === n ? 'on' : ''}" data-n="${n}">${n} s</button>`).join('')}</div><span class="grow"></span><button class="btn primary" data-act="run-smoke" ${pool.length ? '' : 'disabled'}>${icon('play', 14)}Start</button></div>
        </div>
        <div class="big-card">
          <h3>${icon('terminal', 18)}Run test suites</h3>
          <p>Runs <span class="mono">npm test</span> in each app’s source folder side by side and shows which pass, with the failing lines.${c.pkgDir ? '' : ' Set the Utility Package folder in Settings first.'}</p>
          <div class="opts"><div class="seg" id="tPickSeg"><button data-v="all">All with tests (${testable.length})</button><button data-v="some">Choose…</button></div></div>
          ${o.tests === 'some' ? `<div class="chiprow" id="projChips">${testable.map((p) => `<button class="chip ${o.projects.includes(p.id) ? 'on' : ''}" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('') || '<span class="muted small">No projects with a test script</span>'}</div>` : ''}
          <div class="opts"><span class="label">At once</span><div class="chiprow" id="tParChips">${[1, 2, 4, 8, 12].map((n) => `<button class="chip ${o.testPar === n ? 'on' : ''}" data-n="${n}">${n}${n === h.limits.tests ? ' <small>suggested</small>' : ''}</button>`).join('')}</div><span class="grow"></span><button class="btn" data-act="run-tests" ${testable.length ? '' : 'disabled'}>${icon('play', 14)}Start</button></div>
        </div>
      </div>
      <div class="section-title">${icon('clock', 15)}Recent runs</div>
      <div id="runsBox"></div>`;
    const segSet = (id, val) => $$(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === val));
    segSet('srcSeg', o.source); segSet('pickSeg', o.pick); segSet('tPickSeg', o.tests);
    $('#srcSeg').onclick = (e) => { const b = e.target.closest('button'); if (b && !b.disabled) { o.source = b.dataset.v; o.apps = []; this.runs(); } };
    $('#pickSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { o.pick = b.dataset.v; this.runs(); } };
    $('#tPickSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { o.tests = b.dataset.v; this.runs(); } };
    const chipToggle = (id, arr) => { const el = $('#' + id); if (el) el.onclick = (e) => { const b = e.target.closest('button[data-id]'); if (!b) return; const i = arr.indexOf(b.dataset.id); if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.id); b.classList.toggle('on'); }; };
    chipToggle('appChips', o.apps); chipToggle('projChips', o.projects);
    const numChips = (id, key) => { $('#' + id).onclick = (e) => { const b = e.target.closest('button[data-n]'); if (!b) return; o[key] = +b.dataset.n; $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b)); }; };
    numChips('parChips', 'parallel'); numChips('waitChips', 'wait'); numChips('tParChips', 'testPar');
    this.runsUpdate(); hydrateIcons($('#view'));
  },
  runsUpdate() {
    const box = $('#runsBox'); if (!box) return;
    if (!S.runs.length) { box.innerHTML = `<div class="empty">${icon('runs', 30)}<div>No runs yet. Start one above, or ask Claude to smoke-test the suite.</div></div>`; hydrateIcons(box); return; }
    if (!S.runId || !S.runs.find((r) => r.id === S.runId)) S.runId = S.runs[0].id;
    box.innerHTML = `<div style="display:grid;grid-template-columns:320px minmax(0,1fr);gap:16px;align-items:start"><div class="run-list">${S.runs.slice(0, 30).map((r) => `<div class="run-row ${r.id === S.runId ? 'on' : ''}" data-act="pick-run" data-id="${r.id}">
        ${r.state === 'running' ? '<span class="spin"></span>' : icon(r.kind === 'smoke' ? 'flask' : 'terminal', 17)}
        <div class="meta"><b class="ellip">${esc(r.label)}</b><span>${esc(r.who)} · ${ago(r.started)}${r.ms ? ' · ' + fmtMs(r.ms) : ''}</span></div>
        ${this.counts(r)}</div>`).join('')}</div><div id="runDetail"></div></div>`;
    this.runDetail(); hydrateIcons(box);
  },
  counts(r) {
    const c = r.counts || r.items.reduce((m, i) => ((m[i.status] = (m[i.status] || 0) + 1), m), {});
    return `<span class="counts">${c.pass ? `<span class="pill ok">${c.pass}</span>` : ''}${c.warn ? `<span class="pill warn">${c.warn}</span>` : ''}${c.fail ? `<span class="pill bad">${c.fail}</span>` : ''}${r.state === 'running' ? `<span class="pill">${(c.running || 0) + (c.queued || 0)} to go</span>` : ''}</span>`;
  },
  async runDetail() {
    const el = $('#runDetail'); if (!el) return; const r = await call('runs:get', S.runId).catch(() => null); if (!r || !$('#runDetail')) return;
    const head2 = `<div class="row" style="margin-bottom:12px"><b style="font-size:15px">${esc(r.label)}</b><span class="muted small">${r.parallel} at a time${r.state === 'running' ? '' : ` · ${fmtMs(r.ms)}`}</span><span class="grow"></span>${r.state === 'running' ? `<button class="btn sm" data-act="run-cancel" data-id="${r.id}">${icon('stop', 13)}Stop</button>` : `<button class="btn sm ghost" data-act="run-remove" data-id="${r.id}">${icon('trash', 14)}Remove</button>`}</div>`;
    if (r.kind === 'smoke') {
      el.innerHTML = head2 + `<div class="tiles">${r.items.map((it) => `<div class="tile ${it.status}">
        <div class="shot" ${it.shots && it.shots[0] ? `data-act="zoom-file" data-file="${esc(it.shots[0].file)}"` : ''}>${it.shots && it.shots[0] ? `<img data-file="${esc(it.shots[0].file)}" alt="">` : `<div class="ph">${it.status === 'running' ? '<span class="spin"></span>Opening…' : it.status === 'queued' ? icon('clock', 20) + 'Waiting' : icon('window', 20) + (it.fatal ? 'No picture' : '')}</div>`}</div>
        <div class="tb2"><div class="nm"><span class="ellip">${esc(it.name)}</span><span class="v">${esc(it.version || '')}</span><span class="grow"></span>${this.statusPill(it.status)}</div>
          <div class="note">${[it.windowMs ? `Window in ${fmtMs(it.windowMs)}` : '', it.windows ? `${it.windows.length} window${it.windows.length === 1 ? '' : 's'}` : '', it.warnings ? `${it.warnings} warnings` : '', it.source === 'project' ? 'from source' : ''].filter(Boolean).join(' · ') || esc(it.note || '')}</div>
          ${it.fatal || (it.crashes && it.crashes.length) || (it.errors && it.errors.length) ? `<div class="errs">${esc([it.fatal, ...(it.crashes || []), ...(it.errors || []).slice(0, 6)].filter(Boolean).join('\n'))}</div>` : ''}
        </div></div>`).join('')}</div>`;
      for (const img of $$('img[data-file]', el)) call('file:dataUrl', img.dataset.file).then((u) => { img.src = u; }).catch(() => {});
    } else {
      el.innerHTML = head2 + `<div class="tests">${r.items.map((it, i) => `<div class="trow"><div class="h" data-act="toggle-out" data-i="${i}">${this.statusPill(it.status)}<b>${esc(it.name)}</b><span class="muted small ellip grow">${esc(it.fatal || it.summary || it.note || '')}</span><span class="muted small">${it.ms ? fmtMs(it.ms) : ''}</span></div>${it.output && (it.status === 'fail' || this.openOut === i) ? `<pre>${esc(it.output.slice(-8000))}</pre>` : ''}</div>`).join('')}</div>`;
    }
    hydrateIcons(el);
  },
  statusPill(s) { return { pass: '<span class="pill ok">Pass</span>', warn: '<span class="pill warn">Errors</span>', fail: '<span class="pill bad">Fail</span>', running: '<span class="pill acc"><span class="spin" style="width:10px;height:10px"></span>Running</span>', queued: '<span class="pill">Waiting</span>', skipped: '<span class="pill">Skipped</span>' }[s] || `<span class="pill">${esc(s)}</span>`; },

  // ───────── findings
  findings() {
    const all = S.findings; const f = S.findingFilter;
    const list = all.filter((x) => f === 'all' || (f === 'open' ? x.status === 'open' : x.status !== 'open'));
    head('Findings', `${all.filter((x) => x.status === 'open').length} open`, `<button class="btn" data-act="new-finding">${icon('plus', 15)}New finding</button>`);
    if (!S.findingId || !list.find((x) => x.id === S.findingId)) S.findingId = list[0] ? list[0].id : null;
    const v = $('#view'); v.className = 'flush';
    v.innerHTML = `<div class="find-filter"><div class="seg" id="fSeg"><button data-v="open">Open</button><button data-v="closed">Closed</button><button data-v="all">All</button></div></div>
      <div class="find-view" style="flex:1;min-height:0"><div class="find-list">${list.map((x) => `<div class="fitem ${x.id === S.findingId ? 'on' : ''} ${x.status !== 'open' ? 'done' : ''}" data-act="pick-finding" data-id="${x.id}"><span class="sev ${x.severity}"></span><div class="grow" style="min-width:0"><b>${esc(x.title)}</b><span>#${x.number} · ${esc(x.app || 'Unknown app')}${x.version ? ' ' + esc(x.version) : ''} · ${esc(x.who)} · ${ago(x.created)}</span></div></div>`).join('') || `<div class="empty">${icon('bug', 30)}<div>${f === 'open' ? 'Nothing open. Bugs Claude finds while testing land here.' : 'Nothing here.'}</div></div>`}</div>
      <div class="fdetail" id="fDetail"></div></div>`;
    $$('#fSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === f));
    $('#fSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.findingFilter = b.dataset.v; S.findingId = null; this.findings(); } };
    this.findingDetail(); hydrateIcons(v);
  },
  findingDetail() {
    const el = $('#fDetail'); const x = S.findings.find((q) => q.id === S.findingId); if (!el) return;
    if (!x) { el.innerHTML = ''; return; }
    const sev = { high: 'bad', medium: 'warn', low: 'info' }[x.severity];
    el.innerHTML = `<h2>${esc(x.title)}</h2>
      <div class="meta-row"><span class="pill ${sev}">${esc(x.severity)}</span><span class="pill ${x.status === 'open' ? 'acc' : x.status === 'fixed' ? 'ok' : ''}">${esc({ open: 'Open', fixed: 'Fixed', wontfix: 'Won’t fix', dismissed: 'Dismissed' }[x.status])}</span><span class="muted small">#${x.number} · ${esc(x.app || 'Unknown app')}${x.version ? ' ' + esc(x.version) : ''} · found by ${esc(x.who)} on ${esc(x.deskName || 'a desk')} · ${new Date(x.created).toLocaleString()}</span></div>
      <div class="row" style="margin-bottom:16px"><button class="btn sm primary" data-act="finding-copy" data-id="${x.id}">${icon('copy', 14)}Copy for the app’s chat</button>${x.status === 'open' ? `<button class="btn sm" data-act="finding-status" data-id="${x.id}" data-s="fixed">${icon('check', 14)}Mark fixed</button><button class="btn sm" data-act="finding-status" data-id="${x.id}" data-s="dismissed">Dismiss</button>` : `<button class="btn sm" data-act="finding-status" data-id="${x.id}" data-s="open">Reopen</button>`}<span class="grow"></span><button class="icon-btn sm" data-act="finding-delete" data-id="${x.id}" title="Delete">${icon('trash', 15)}</button></div>
      ${x.shots && x.shots.length ? x.shots.map((f) => `<img class="fshot" data-file="${esc(f)}" data-act="zoom-file" alt="">`).join('') : ''}
      ${x.steps && x.steps.length ? `<div class="fbox"><h4>Steps</h4><ol>${x.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
      ${x.expected ? `<div class="fbox"><h4>Expected</h4><p>${esc(x.expected)}</p></div>` : ''}
      ${x.actual ? `<div class="fbox"><h4>What happened</h4><p>${esc(x.actual)}</p></div>` : ''}
      ${x.notes ? `<div class="fbox"><h4>Notes</h4><p>${esc(x.notes)}</p></div>` : ''}
      ${x.logExcerpt ? `<div class="fbox"><h4>Errors from the logs</h4><pre>${esc(x.logExcerpt)}</pre></div>` : ''}
      ${x.logFile ? `<button class="link-btn" data-act="reveal" data-path="${esc(x.logFile)}">${icon('folder', 14)}Full logs</button>` : ''}`;
    for (const img of $$('img[data-file]', el)) call('file:dataUrl', img.dataset.file).then((u) => { img.src = u; }).catch(() => {});
    hydrateIcons(el);
  },

  // ───────── claude
  async claude() {
    S.claude = await call('claude:status').catch(() => S.claude);
    const c = S.claude; const b = c.bridge || {};
    head('Claude', b.connected ? `${esc(b.client || 'Claude')} connected` : 'not connected right now');
    const card = (key, name, sub, st, extra = '') => `<div class="conn"><h4>${icon(key === 'codex' ? 'code' : key === 'code' ? 'terminal' : 'spark', 17)}${name}${st.added ? (st.current ? '<span class="pill ok">Added</span>' : '<span class="pill warn">Needs refresh</span>') : ''}</h4><p>${sub}</p>${extra}
      <div class="row">${st.added ? `<button class="btn sm" data-act="claude-connect" data-w="${key}">${icon('refresh', 13)}Refresh</button><button class="btn sm ghost" data-act="claude-disconnect" data-w="${key}">Remove</button>` : `<button class="btn sm primary" data-act="claude-connect" data-w="${key}" ${st.installed === false && key !== 'desktop' ? '' : ''}>${icon('plug', 14)}Add Bench</button>`}${st.cmd ? `<button class="icon-btn sm" data-act="copy" data-text="${esc(st.cmd)}" title="Copy the command to add it yourself">${icon('copy', 14)}</button>` : ''}</div></div>`;
    $('#view').innerHTML = `
      <div class="claude-hero">
        <div class="big-card feature"><h3>${icon('spark', 18)}A workspace Claude can use</h3>
          <p>Once Bench is added, Claude can open apps on your desks and see their windows. It can click and type, use menus, answer file dialogs and read every console error and crash. It can run commands and smoke-test the whole suite in parallel on this computer. When something is broken, it files a finding with a screenshot and the logs. Everything it does shows up live on the desk.</p>
          <div class="row"><span class="dot ${b.connected ? 'on' : ''}"></span><span class="small">${b.connected ? `${esc(b.client || 'Claude')} is using Bench right now` : b.lastSeen ? `Last used by ${esc(b.client || 'Claude')} ${ago(b.lastSeen)}` : 'Not used yet'}</span></div>
        </div>
        <div class="big-card"><h3>${icon('info', 18)}Try asking</h3>
          ${['Smoke-test every Utility Suite app in Bench and file findings for anything broken.', 'Open Lumen from source on the Bench sandbox, click through every tab and report UI bugs.', 'Run npm test for all the apps in Bench and tell me which fail.', 'Start the Mac VM desk, install the latest RO2 build and check that it opens.'].map((p) => `<div class="prompt"><span>${esc(p)}</span><button class="icon-btn xs" data-act="copy" data-text="${esc(p)}">${icon('copy', 13)}</button></div>`).join('')}
        </div>
      </div>
      <div class="conn-grid">
        ${card('desktop', 'Claude app', `The Claude desktop app, including tasks that run in the cloud while this computer is linked.${c.desktop.store ? ' Found the Microsoft Store version; Bench writes the settings copy it reads.' : ''} Quit Claude fully (from the ${window.bench.platform === 'darwin' ? 'menu bar' : 'system tray'}) and reopen it after adding.`, c.desktop, c.desktop.json ? `<button class="link-btn" data-act="copy" data-text="${esc(c.desktop.json)}">${icon('copy', 13)}Copy the settings to paste yourself (Claude › Settings › Developer › Edit Config)</button>` : '')}
        ${card('code', 'Claude Code', c.code.installed ? 'Adds Bench to Claude Code for every project (user scope).' : 'Claude Code isn’t installed here; Bench adds itself to ~/.claude.json so it’s there when you install it.', c.code)}
        ${card('codex', 'Codex', 'Adds Bench to ~/.codex/config.toml (Codex CLI, IDE extension and app).', c.codex)}
      </div>
      <div class="section-title">${icon('gear', 15)}What Claude may do</div>
      <div class="panel"><div class="set-row"><div class="meta"><b>Run commands on this computer</b><span>On sandbox desks, Claude’s commands (npm test, builds, scripts) run on this computer as you. VM desks always run commands inside the VM.</span></div><button class="switch ${S.init.settings.allowCommands ? 'on' : ''}" data-act="toggle-setting" data-key="allowCommands"></button></div>
        <div class="set-row"><div class="meta"><b>The bridge</b><span>Claude reaches Bench through a private connection on this computer only (127.0.0.1, with a secret key in Bench’s app-data folder).</span></div><span class="pill ${b.running ? 'ok' : 'bad'}">${b.running ? 'On' : 'Off'}</span></div></div>
      <div class="section-title">${icon('list', 15)}Tools Claude gets</div>
      <div class="tool-chips">${['bench_overview', 'launch', 'list_sessions', 'screenshot', 'inspect', 'click', 'type', 'press_keys', 'scroll', 'drag', 'wait_for', 'menu', 'answer_dialog', 'evaluate', 'logs', 'run_command', 'copy_files', 'set_window', 'stop_session', 'desk_control', 'create_desk', 'smoke_test', 'run_tests', 'get_run', 'report_finding', 'list_findings', 'update_finding'].map((t) => `<span>${t}</span>`).join('')}</div>`;
    hydrateIcons($('#view'));
  },

  // ───────── virtual machines
  async engines() {
    head('Virtual machines', 'clean desktops for testing installs and other systems');
    $('#view').innerHTML = '<div class="empty"><span class="spin"></span></div>';
    S.engines = await call('engines:status').catch((e) => ({ error: e.message }));
    const e = S.engines; if (e.error) { $('#view').innerHTML = `<div class="notice warn">${icon('alert')}${esc(e.error)}</div>`; return; }
    const t = e.tart, w = e.winsb;
    const osIc = { mac: 'apple', linux: 'linux' };
    $('#view').innerHTML = `
      <div class="panel"><h3>${icon('apple', 17)}Mac and Linux VMs ${t.supported ? (t.installed ? `<span class="pill ok">Ready</span>` : '<span class="pill">Not set up</span>') : '<span class="pill">Not on this computer</span>'}</h3>
        <p>${t.supported ? `Clean macOS and Ubuntu desktops in virtual machines, using Apple’s own virtualization through <b>Tart</b> (free for personal use). Each desk gets its own copy, made instantly. Reset puts it back in seconds.${t.installed ? ` ${esc(t.version || '')}` : ' Bench downloads Tart (about 20 MB) the first time.'}` : esc(t.why)}</p>
        ${t.supported ? `<div id="tartRow">${t.installed ? '' : `<button class="btn primary" data-act="install-tart">${icon('download', 14)}Set up Tart</button>`}</div>
          <div class="section-title" style="margin-top:16px">Systems</div>
          ${e.images.map((im) => `<div class="img-row" data-img="${im.id}"><div class="os">${icon(osIc[im.os], 19)}</div><div class="meta"><b>${esc(im.label)}</b><span>${esc(im.sub)} · ${esc(im.download)} to download, about ${im.disk} GB per desk once used</span></div>
            <div class="img-act">${im.pulled ? `<span class="pill ok">Downloaded</span><button class="icon-btn sm" data-act="img-remove" data-id="${im.id}" title="Remove the download">${icon('trash', 15)}</button>` : `<button class="btn sm" data-act="img-pull" data-id="${im.id}">${icon('download', 14)}Download</button>`}</div></div>`).join('')}
          <div class="row" style="margin-top:12px"><span class="small muted">Stored in</span><span class="path">${esc(t.home)}</span></div>` : ''}
      </div>
      <div class="panel"><h3>${icon('winlogo', 16)}Windows Sandbox ${w.supported ? (w.installed ? '<span class="pill ok">Available</span>' : '<span class="pill warn">Switched off</span>') : '<span class="pill">Windows only</span>'}</h3>
        <p>${w.supported ? (w.installed ? 'A clean Windows desktop that starts fresh every time and is thrown away when it closes. Windows allows one at a time. Bench’s helper runs inside it so you and Claude can see and use its screen and run commands.' : `${esc(w.why)} Turning it on needs an administrator prompt and a restart.`) : 'On a Windows 10/11 Pro PC, Bench uses Windows Sandbox for clean, throwaway Windows desktops.'}</p>
        ${w.supported && !w.installed ? `<button class="btn primary" data-act="enable-winsb">${icon('power', 14)}Turn on Windows Sandbox</button>` : ''}
      </div>
      <div class="panel"><h3>${icon('monitor', 17)}Another computer</h3><p>Any computer with screen sharing (VNC) on your network: your Windows PC from the Mac, or the other way round. Add SSH so Claude can run commands and copy builds there. Create one with New desk › Another computer.</p></div>`;
    for (const [k, p] of Object.entries(S.engineProgress)) if (p) this.engineProgress({ key: k, ...p });
    hydrateIcons($('#view'));
  },
  engineProgress(p) {
    const target = p.key === 'tart' ? $('#tartRow') : $(`.img-row[data-img="${p.key}"] .img-act`);
    if (!target) return;
    if (p.done) { this.engines(); return; }
    target.innerHTML = `<div style="width:220px" class="col"><span class="small muted ellip">${esc(p.label || 'Working…')}${p.pct != null ? ` · ${Math.round(p.pct * 100)}%` : ''}</span><div class="bar ${p.pct == null ? 'indet' : ''}"><i style="width:${p.pct != null ? Math.round(p.pct * 100) : 30}%"></i></div></div>`;
  },

  // ───────── settings
  async settings() {
    head('Settings');
    const st = S.init.settings; const h = await call('host:info').catch(() => S.host);
    const c = S.catalog || (S.catalog = await call('catalog:apps').catch(() => ({ installed: [], projects: [] })));
    $('#view').innerHTML = `
      <div class="panel"><h3>Appearance</h3>
        <div class="set-row"><div class="meta"><b>Theme</b></div><div class="seg" id="themeSeg"><button data-v="system">System</button><button data-v="light">Light</button><button data-v="dark">Dark</button></div></div></div>
      <div class="panel"><h3>Utility Package</h3><p>Where your apps’ source lives, so Bench and Claude can run any app from source and run its tests.</p>
        <div class="set-row"><div class="meta"><b>Folder</b><span class="path">${esc(c.pkgDir || 'Not found — choose the folder that has suite.json and apps/')}</span></div><button class="btn sm" data-act="pick-pkg">${icon('folder', 14)}Choose…</button></div>
        <div class="set-row"><div class="meta"><b>Found</b><span>${c.projects.length} app sources · ${c.installed.length} Utility Suite apps installed on this computer</span></div></div></div>
      <div class="panel"><h3>Running</h3>
        <div class="set-row"><div class="meta"><b>Apps at once</b><span>For smoke tests. Suggested for this computer: ${h.limits.apps}.</span></div><div class="chiprow" id="parApps">${['auto', 2, 4, 6, 8, 12].map((n) => `<button class="chip ${String(st.parallelApps || 'auto') === String(n) ? 'on' : ''}" data-n="${n}">${n === 'auto' ? 'Auto' : n}</button>`).join('')}</div></div>
        <div class="set-row"><div class="meta"><b>Test suites at once</b><span>Suggested: ${h.limits.tests}.</span></div><div class="chiprow" id="parTests">${['auto', 2, 4, 8, 12].map((n) => `<button class="chip ${String(st.parallelTests || 'auto') === String(n) ? 'on' : ''}" data-n="${n}">${n === 'auto' ? 'Auto' : n}</button>`).join('')}</div></div>
        <div class="set-row"><div class="meta"><b>Live view</b><span>Frames per second when watching a desk.</span></div><div class="chiprow" id="fps">${[4, 8, 15].map((n) => `<button class="chip ${st.liveFps === n ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}</div></div>
        <div class="set-row"><div class="meta"><b>Keep running in the background</b><span>Closing the window leaves Bench in the ${window.bench.platform === 'darwin' ? 'menu bar' : 'system tray'}, so Claude can still use it.</span></div><button class="switch ${st.background ? 'on' : ''}" data-act="toggle-setting" data-key="background"></button></div>
        <div class="set-row"><div class="meta"><b>Default desk for Claude</b><span>Used when Claude doesn’t name one.</span></div><select class="select" id="defDesk">${S.desks.map((d) => `<option value="${d.id}" ${(st.defaultDesk || (S.desks.find((x) => x.kind === 'sandbox') || {}).id) === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div></div>
      <div class="panel"><h3>About</h3><div class="set-row"><div class="meta"><b>Bench ${esc(S.init.version)}</b><span>Part of the Utility Suite. Data lives in Bench’s app-data folder; screenshots you save go to Pictures › Bench.</span></div></div></div>`;
    $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === (st.theme || 'system')));
    const set = async (patch) => { S.init.settings = await call('settings:set', patch); applyTheme(); };
    $('#themeSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { set({ theme: b.dataset.v }).then(() => this.settings()); } };
    const chips = (id, key) => { $('#' + id).onclick = (e) => { const b = e.target.closest('button[data-n]'); if (!b) return; set({ [key]: b.dataset.n === 'auto' ? null : +b.dataset.n }).then(() => this.settings()); }; };
    chips('parApps', 'parallelApps'); chips('parTests', 'parallelTests'); chips('fps', 'liveFps');
    $('#defDesk').onchange = (e) => set({ defaultDesk: e.target.value });
    hydrateIcons($('#view'));
  },

  async act(a, el) {
    switch (a) {
      case 'run-smoke': { const o = this.runOpts; const apps = o.pick === 'some' ? o.apps : 'all'; if (o.pick === 'some' && !apps.length) throw new Error('Pick at least one app'); const r = await call('runs:smoke', { apps, source: o.source, parallel: o.parallel, wait_seconds: o.wait }); S.runId = r.id; await refreshRuns(); return true; }
      case 'run-tests': { const o = this.runOpts; const projects = o.tests === 'some' ? o.projects : 'all'; if (o.tests === 'some' && !projects.length) throw new Error('Pick at least one project'); const r = await call('runs:tests', { projects, parallel: o.testPar, script: o.script }); S.runId = r.id; await refreshRuns(); return true; }
      case 'pick-run': S.runId = el.dataset.id; this.runsUpdate(); return true;
      case 'run-cancel': await call('runs:cancel', el.dataset.id); return true;
      case 'run-remove': await call('runs:remove', el.dataset.id); S.runId = null; await refreshRuns(); return true;
      case 'toggle-out': this.openOut = this.openOut === +el.dataset.i ? null : +el.dataset.i; this.runDetail(); return true;
      case 'zoom-file': { const img = el.tagName === 'IMG' ? el : el.querySelector('img'); if (img && img.src) zoomImage(img.src); return true; }
      case 'pick-finding': S.findingId = el.dataset.id; $$('.fitem').forEach((x) => x.classList.toggle('on', x.dataset.id === S.findingId)); this.findingDetail(); return true;
      case 'finding-copy': await call('findings:copy', el.dataset.id); toast({ kind: 'ok', title: 'Copied as Markdown', text: 'Paste it into that app’s chat.' }); return true;
      case 'finding-status': await call('findings:update', el.dataset.id, { status: el.dataset.s }); return true;
      case 'finding-delete': Sheets.confirm({ title: 'Delete this finding?', text: 'Its screenshot and logs are deleted too.', ok: 'Delete', danger: true, run: () => call('findings:remove', el.dataset.id) }); return true;
      case 'new-finding': Sheets.finding({}); return true;
      case 'reveal': await call('shell:reveal', el.dataset.path); return true;
      case 'claude-connect': { const r = await call('claude:connect', el.dataset.w); S.claude = { ...S.claude, ...r }; toast({ kind: 'ok', title: 'Bench added', text: el.dataset.w === 'desktop' ? 'Restart the Claude app to pick it up.' : el.dataset.w === 'code' ? 'Start a new Claude Code session to use it.' : 'Start a new Codex session to use it.' }); this.claude(); return true; }
      case 'claude-disconnect': await call('claude:disconnect', el.dataset.w); this.claude(); return true;
      case 'copy': await call('clipboard:write', el.dataset.text); toast({ kind: 'ok', title: 'Copied' }); return true;
      case 'toggle-setting': { const k = el.dataset.key; S.init.settings = await call('settings:set', { [k]: !S.init.settings[k] }); el.classList.toggle('on', !!S.init.settings[k]); return true; }
      case 'install-tart': await call('engines:installTart'); this.engines(); return true;
      case 'img-pull': call('engines:pull', el.dataset.id).then(() => this.engines()).catch((e) => toast({ kind: 'bad', title: 'Download failed', text: e.message })); this.engineProgress({ key: el.dataset.id, label: 'Starting…', pct: null }); return true;
      case 'img-remove': Sheets.confirm({ title: 'Remove this download?', text: 'Desks already made from it keep working; new ones download it again.', ok: 'Remove', danger: true, run: async () => { await call('engines:removeImage', el.dataset.id); this.engines(); } }); return true;
      case 'enable-winsb': await call('engines:enableWinSandbox'); toast({ kind: 'ok', title: 'Restart Windows to finish', text: 'Windows Sandbox is ready after a restart.' }); return true;
      case 'pick-pkg': { const p = await call('dialog:pick', 'folder'); if (p) { await call('settings:set', { packageDir: p }); S.init.settings.packageDir = p; S.catalog = null; this.settings(); } return true; }
    }
    return false;
  },
};

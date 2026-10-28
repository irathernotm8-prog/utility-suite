// Bench — sheets: a new desk, launching something, filing a finding, renaming and confirming.
'use strict';
const Sheets = {
  open(html, { wide = false } = {}) {
    this.close();
    const s = document.createElement('div'); s.className = 'scrim';
    s.innerHTML = `<div class="sheet" style="${wide ? 'width:min(980px,calc(100vw - 48px))' : ''}">${html}</div>`;
    s.addEventListener('mousedown', (e) => { if (e.target === s) this.close(); });
    $('#sheetHost').appendChild(s); hydrateIcons(s);
    return s;
  },
  close() { $('#sheetHost').innerHTML = ''; },
  confirm({ title, text, ok = 'OK', danger = false, run }) {
    const s = this.open(`<div class="sheet-head"><h2>${esc(title)}</h2></div><div class="sheet-body"><p style="margin:0;color:var(--fg-2)">${esc(text)}</p></div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-x="no">Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-x="yes">${esc(ok)}</button></div>`);
    s.querySelector('.sheet').style.width = 'min(460px, calc(100vw - 48px))';
    s.querySelector('[data-x="no"]').onclick = () => this.close();
    s.querySelector('[data-x="yes"]').onclick = async (e) => { e.target.disabled = true; try { await run(); this.close(); } catch (err) { e.target.disabled = false; toast({ kind: 'bad', title: 'That didn’t work', text: err.message }); } };
  },
  rename(d) {
    const s = this.open(`<div class="sheet-head"><h2>Rename desk</h2></div><div class="sheet-body"><input class="input" id="rn" style="width:100%" value="${esc(d.name)}"><div class="field" style="margin-top:14px"><label>Color</label>${this.swatches(d.color)}</div></div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-x="no">Cancel</button><button class="btn primary" data-x="yes">Save</button></div>`);
    s.querySelector('.sheet').style.width = 'min(460px, calc(100vw - 48px))';
    let color = d.color; s.querySelector('.swatches').onclick = (e) => { const b = e.target.closest('.swatch'); if (b) { color = b.dataset.c; $$('.swatch', s).forEach((x) => x.classList.toggle('on', x === b)); } };
    s.querySelector('[data-x="no"]').onclick = () => this.close();
    s.querySelector('[data-x="yes"]').onclick = async () => { await call('desks:update', d.id, { name: $('#rn').value.trim() || d.name, color }); this.close(); };
    setTimeout(() => $('#rn').select(), 30);
  },
  swatches(cur) { return `<div class="swatches">${['pink', 'violet', 'sky', 'mint', 'amber', 'rose', 'slate'].map((c) => `<button class="swatch a-${c} ${c === cur ? 'on' : ''}" data-c="${c}" title="${c}"></button>`).join('')}</div>`; },

  // ───────── new desk
  async newDesk() {
    const eng = S.engines || (S.engines = await call('engines:status').catch(() => null));
    const h = S.host; const plat = window.bench.platform;
    const tartOk = eng && eng.tart.supported; const winOk = eng && eng.winsb.supported && eng.winsb.installed;
    const kinds = [
      { k: 'sandbox', ic: 'stack', t: 'Sandbox', s: 'Apps run on this computer with their own data. Fast, many at once.', ok: true },
      { k: 'mac-vm', ic: 'apple', t: 'Mac VM', s: tartOk ? 'A clean macOS desktop. Test installs and first launch.' : (eng && eng.tart.why) || 'Needs a Mac with Apple Silicon', ok: tartOk },
      { k: 'linux-vm', ic: 'linux', t: 'Linux VM', s: tartOk ? 'Ubuntu in a VM, for builds and command-line tests.' : 'Needs a Mac with Apple Silicon', ok: tartOk },
      { k: 'windows-sandbox', ic: 'winlogo', t: 'Windows Sandbox', s: winOk ? 'A fresh Windows desktop every time.' : plat === 'win32' ? 'Turn it on in Virtual machines first' : 'Needs a Windows PC (Pro)', ok: winOk },
      { k: 'vnc', ic: 'monitor', t: 'Another computer', s: 'Any screen you can reach by VNC, plus SSH for commands.', ok: true },
    ];
    const o = this.nd = { kind: 'sandbox', name: '', color: null, hidden: true, image: (eng && eng.images.find((i) => i.id === 'macos-tahoe' && !i.needsNewerMac)) ? 'macos-tahoe' : 'macos-sequoia', cpu: h.limits.vmCpu || 4, memoryGB: h.limits.vmMemGB || 8, display: '1440x900', host: '', vncPort: 5900, vncPassword: '', sshUser: '', sshPassword: '', os: 'windows' };
    const s = this.open(`<div class="sheet-head"><h2>New desk</h2><button class="icon-btn" data-x="close">${icon('close')}</button></div>
      <div class="sheet-body"><div class="choices c5" id="kinds">${kinds.map((x) => `<button class="choice ${x.k === o.kind ? 'on' : ''}" data-k="${x.k}" ${x.ok ? '' : 'disabled'}><span class="tick">${icon('check', 12)}</span><span class="ch-ic">${icon(x.ic, 18)}</span><span class="ch-title">${x.t}</span><span class="ch-sub">${esc(x.s)}</span></button>`).join('')}</div>
      <div id="ndForm" style="margin-top:20px"></div></div>
      <div class="sheet-foot"><span class="hint grow" id="ndHint"></span><button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="create">${icon('plus', 15)}Create desk</button></div>`, { wide: true });
    $$('[data-x="close"]', s).forEach((b) => (b.onclick = () => this.close()));
    $('#kinds').onclick = (e) => { const b = e.target.closest('.choice'); if (!b || b.disabled) return; o.kind = b.dataset.k; $$('#kinds .choice').forEach((x) => x.classList.toggle('on', x === b)); this.ndForm(); };
    s.querySelector('[data-x="create"]').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const spec = { kind: o.kind, name: $('#ndName').value.trim(), color: o.color || undefined };
        if (o.kind === 'sandbox') spec.hidden = o.hidden;
        if (o.kind === 'mac-vm' || o.kind === 'linux-vm') Object.assign(spec, { image: o.kind === 'linux-vm' ? 'ubuntu' : o.image, cpu: o.cpu, memoryGB: o.memoryGB, display: o.kind === 'mac-vm' ? o.display : undefined });
        if (o.kind === 'windows-sandbox') Object.assign(spec, { memoryGB: o.memoryGB, network: $('#ndNet').classList.contains('on') ? 'on' : 'off' });
        if (o.kind === 'vnc') Object.assign(spec, { host: $('#ndHost').value.trim(), vncPort: +$('#ndPort').value || 5900, vncPassword: $('#ndPass').value, sshUser: $('#ndSshUser').value.trim(), sshPassword: $('#ndSshPass').value, os: $('#ndOs').value });
        if (o.kind === 'vnc' && !spec.host) throw new Error('Enter the computer’s address');
        const d = await call('desks:create', spec);
        this.close(); await refreshDesks(); go('desks', { desk: d.id });
        if (o.kind === 'mac-vm' || o.kind === 'linux-vm') toast({ kind: 'busy', title: 'Getting the VM ready', text: 'The first one downloads the system (it can take a while). You can keep working meanwhile.', ms: 8000 });
      } catch (err) { e.target.disabled = false; toast({ kind: 'bad', title: 'Couldn’t create the desk', text: err.message }); }
    };
    this.ndForm();
  },
  ndForm() {
    const o = this.nd; const f = $('#ndForm'); const h = S.host; const eng = S.engines;
    const defName = { sandbox: 'Sandbox', 'mac-vm': 'Mac VM', 'linux-vm': 'Linux VM', 'windows-sandbox': 'Windows Sandbox', vnc: 'My PC' }[o.kind];
    const chipsN = (id, list, cur, fmt) => `<div class="chiprow" id="${id}">${list.map((n) => `<button class="chip ${n === cur ? 'on' : ''}" data-n="${n}">${fmt ? fmt(n) : n}</button>`).join('')}</div>`;
    const maxCpu = h.cores; const maxMem = Math.floor(h.totalMem / 1024 ** 3);
    let extra = '';
    if (o.kind === 'sandbox') extra = `<div class="form-row"><div class="label">App windows<small>You always see them here</small></div><div class="seg" id="ndHid"><button data-v="1" class="${o.hidden ? 'on' : ''}">${icon('eyeOff', 14)}Out of sight</button><button data-v="0" class="${o.hidden ? '' : 'on'}">${icon('eye', 14)}On my screen</button></div></div>
      <div class="notice">${icon('info')}<span>Apps on a sandbox desk get their own home, app-data and temp folders inside the desk, so testing doesn’t touch your real data. It’s the same computer, though: for a truly clean system, use a VM desk.</span></div>`;
    if (o.kind === 'mac-vm') extra = `<div class="form-row"><div class="label">System</div><div class="choices c2" id="ndImg">${(eng ? eng.images.filter((i) => i.os === 'mac') : []).map((im) => `<button class="choice ${im.id === o.image ? 'on' : ''}" data-id="${im.id}" ${im.needsNewerMac ? 'disabled title="This Mac needs macOS 26 to run it"' : ''}><span class="tick">${icon('check', 12)}</span><span class="ch-title">${esc(im.label)}</span><span class="ch-sub">${esc(im.sub)}<br>${im.pulled ? 'Downloaded' : `${esc(im.download)} download, once`}</span></button>`).join('')}</div></div>`;
    if (o.kind === 'mac-vm' || o.kind === 'linux-vm') extra += `<div class="form-row"><div class="label">Cores<small>This computer has ${maxCpu}</small></div>${chipsN('ndCpu', [2, 4, 6, 8].filter((n) => n <= maxCpu), o.cpu)}</div>
      <div class="form-row"><div class="label">Memory<small>This computer has ${maxMem} GB</small></div>${chipsN('ndMem', [4, 8, 12, 16].filter((n) => n < maxMem), o.memoryGB, (n) => n + ' GB')}</div>
      ${o.kind === 'mac-vm' ? `<div class="form-row"><div class="label">Screen</div><div class="chiprow" id="ndDisp">${['1280x800', '1440x900', '1920x1200'].map((n) => `<button class="chip ${n === o.display ? 'on' : ''}" data-n="${n}">${n.replace('x', '×')}</button>`).join('')}</div></div>` : ''}
      <div class="notice">${icon('info')}<span>Sign-in inside the VM is <b>admin</b> / <b>admin</b>. Bench uses it to run commands and copy builds in.</span></div>`;
    if (o.kind === 'windows-sandbox') extra = `<div class="form-row"><div class="label">Memory</div>${chipsN('ndMem', [4, 8, 12, 16].filter((n) => n < maxMem), o.memoryGB, (n) => n + ' GB')}</div>
      <div class="form-row"><div class="label">Internet<small>Off keeps it fully offline</small></div><button class="switch on" id="ndNet" type="button"></button></div>`;
    if (o.kind === 'vnc') extra = `<div class="form-row"><div class="label">Address</div><div class="row"><input class="input grow" id="ndHost" placeholder="192.168.1.20 or my-pc.local"><input class="input" id="ndPort" style="width:96px" value="5900" title="VNC port"></div></div>
      <div class="form-row"><div class="label">VNC password<small>Screen sharing’s password</small></div><input class="input" id="ndPass" type="password"></div>
      <div class="form-row"><div class="label">SSH<small>Optional, for commands and copying files</small></div><div class="row"><input class="input grow" id="ndSshUser" placeholder="User name"><input class="input grow" id="ndSshPass" type="password" placeholder="Password"></div></div>
      <div class="form-row"><div class="label">System</div><select class="select" id="ndOs"><option value="windows">Windows</option><option value="mac">macOS</option><option value="linux">Linux</option><option value="unknown">Something else</option></select></div>`;
    f.innerHTML = `<div class="form-row"><div class="label">Name</div><input class="input" id="ndName" placeholder="${defName}" value="${esc(o.name)}"></div>
      <div class="form-row"><div class="label">Color</div>${this.swatches(o.color || 'pink')}</div>${extra}`;
    $('#ndName').oninput = (e) => { o.name = e.target.value; };
    f.querySelector('.swatches').onclick = (e) => { const b = e.target.closest('.swatch'); if (b) { o.color = b.dataset.c; $$('.swatch', f).forEach((x) => x.classList.toggle('on', x === b)); } };
    const bindChips = (id, key, num = true) => { const el = $('#' + id); if (el) el.onclick = (e) => { const b = e.target.closest('[data-n]'); if (!b) return; o[key] = num ? +b.dataset.n : b.dataset.n; $$(`#${id} [data-n]`).forEach((x) => x.classList.toggle('on', x === b)); }; };
    bindChips('ndCpu', 'cpu'); bindChips('ndMem', 'memoryGB'); bindChips('ndDisp', 'display', false);
    if ($('#ndImg')) $('#ndImg').onclick = (e) => { const b = e.target.closest('.choice'); if (b) { o.image = b.dataset.id; $$('#ndImg .choice').forEach((x) => x.classList.toggle('on', x === b)); } };
    if ($('#ndHid')) $('#ndHid').onclick = (e) => { const b = e.target.closest('button'); if (b) { o.hidden = b.dataset.v === '1'; $$('#ndHid button').forEach((x) => x.classList.toggle('on', x === b)); } };
    if ($('#ndNet')) $('#ndNet').onclick = (e) => e.currentTarget.classList.toggle('on');
    $('#ndHint').textContent = o.kind === 'mac-vm' ? 'The first Mac VM downloads macOS once (about 20 GB).' : '';
    hydrateIcons(f);
  },

  // ───────── launch
  async launch(deskId) {
    const d = S.desks.find((x) => x.id === deskId) || S.desks[0]; if (!d) return;
    const sb = d.kind === 'sandbox';
    const c = S.catalog = await call('catalog:apps').catch(() => ({ installed: [], projects: [] }));
    const L = this.ln = { tab: sb ? 'suite' : 'install', pick: null, from: c.installed.length ? 'installed' : 'projects', data: 'desk', hidden: d.hidden !== false, url: '', path: '', cmd: '' };
    const tabs = sb ? [['suite', 'Utility Suite', 'grid'], ['app', 'Any app', 'window'], ['web', 'Web page', 'globe'], ['cmd', 'Command', 'terminal']] : [['install', 'Install a build', 'download'], ['open', 'Open an app', 'window'], ['web', 'Web page', 'globe'], ['cmd', 'Command', 'terminal']];
    const s = this.open(`<div class="sheet-head"><h2>${sb ? 'Launch on' : 'Open on'} ${esc(d.name)}</h2><button class="icon-btn" data-x="close">${icon('close')}</button></div>
      <div class="sheet-body"><div class="seg full" id="lnTabs" style="margin-bottom:16px">${tabs.map(([k, t, ic]) => `<button data-t="${k}" class="${k === L.tab ? 'on' : ''}">${icon(ic, 14)}${t}</button>`).join('')}</div><div id="lnBody"></div></div>
      <div class="sheet-foot">${sb ? `<span class="label">Data</span><div class="seg" id="lnData"><button data-v="desk" class="on" title="Kept between launches on this desk">Desk’s own</button><button data-v="fresh" title="Brand new, thrown away when it quits">Fresh</button><button data-v="real" title="Your normal data">My real data</button></div>` : ''}<span class="grow"></span><button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="go">${icon('play', 14)}${sb ? 'Launch' : 'Open'}</button></div>`, { wide: true });
    $$('[data-x="close"]', s).forEach((b) => (b.onclick = () => this.close()));
    $('#lnTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { L.tab = b.dataset.t; $$('#lnTabs button').forEach((x) => x.classList.toggle('on', x === b)); this.lnBody(d); } };
    if ($('#lnData')) $('#lnData').onclick = (e) => { const b = e.target.closest('button'); if (b) { L.data = b.dataset.v; $$('#lnData button').forEach((x) => x.classList.toggle('on', x === b)); } };
    s.querySelector('[data-x="go"]').onclick = (e) => this.lnGo(d, e.target);
    this.lnBody(d);
  },
  lnBody(d) {
    const L = this.ln; const c = S.catalog; const b = $('#lnBody'); const sb = d.kind === 'sandbox';
    if (L.tab === 'suite') {
      const list = L.from === 'installed' ? c.installed : c.projects.filter((p) => !p.hub || true);
      b.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="seg" id="lnFrom"><button data-v="installed" ${c.installed.length ? '' : 'disabled'}>Installed (${c.installed.length})</button><button data-v="projects" ${c.projects.length ? '' : 'disabled'}>From source (${c.projects.length})</button></div><span class="hint grow">${L.from === 'projects' ? 'Runs the app straight from apps/&lt;id&gt; in the Utility Package, the way npm start does.' : 'The apps Utility Hub installed on this computer.'}</span></div>
        <div class="app-pick" id="lnApps">${list.map((a) => `<button class="app-tile ${L.pick === a.id ? 'on' : ''}" data-id="${esc(a.id)}"><span class="ai" style="background:${appColor(a.name)}">${esc(a.name.slice(0, 2))}</span><span class="grow" style="min-width:0"><b class="ellip">${esc(a.name)}</b><span class="ellip">${esc(a.version || '')}${L.from === 'projects' ? (a.electron ? ' · ready' : a.hasDeps ? ' · no Electron' : ' · installs packages first') : ''}</span></span></button>`).join('') || `<div class="muted small">${L.from === 'projects' ? 'No Utility Package folder found. Set it in Settings.' : 'No Utility Suite apps installed on this computer.'}</div>`}</div>`;
      $('#lnFrom') && $$('#lnFrom button').forEach((x) => x.classList.toggle('on', x.dataset.v === L.from));
      $('#lnFrom').onclick = (e) => { const x = e.target.closest('button'); if (x && !x.disabled) { L.from = x.dataset.v; L.pick = null; this.lnBody(d); } };
      $('#lnApps').onclick = (e) => { const x = e.target.closest('.app-tile'); if (x) { L.pick = x.dataset.id; $$('#lnApps .app-tile').forEach((q) => q.classList.toggle('on', q === x)); } };
      $('#lnApps').ondblclick = (e) => { const x = e.target.closest('.app-tile'); if (x) { L.pick = x.dataset.id; this.lnGo(d, $('[data-x="go"]')); } };
    } else if (L.tab === 'app' || L.tab === 'open') {
      b.innerHTML = `<div class="field"><label>${sb ? 'An app or an app’s source folder' : 'App name or path inside the desk'}</label><div class="row"><input class="input grow" id="lnPath" placeholder="${sb ? (window.bench.platform === 'darwin' ? '/Applications/Slack.app or ~/Projects/my-app' : 'C:\\…\\App.exe or a project folder') : d.kind === 'windows-sandbox' ? 'C:\\Windows\\notepad.exe' : 'Safari, TextEdit or /Applications/X.app'}" value="${esc(L.path)}">${sb ? `<button class="btn" data-x="browse-app">${icon('window', 14)}App…</button><button class="btn" data-x="browse-dir">${icon('folder', 14)}Folder…</button>` : ''}</div>
        <span class="hint">${sb ? 'Electron apps (Slack, VS Code, Discord, Notion and every Utility Suite app) can be seen and controlled. Other apps run with their output captured.' : 'Opens it on the desk’s screen.'}</span></div>`;
      $('#lnPath').oninput = (e) => { L.path = e.target.value; };
      if (sb) { $('[data-x="browse-app"]').onclick = async () => { const p = await call('dialog:pick', 'app'); if (p) { L.path = p; $('#lnPath').value = p; } }; $('[data-x="browse-dir"]').onclick = async () => { const p = await call('dialog:pick', 'folder'); if (p) { L.path = p; $('#lnPath').value = p; } }; }
    } else if (L.tab === 'install') {
      b.innerHTML = `<div class="field"><label>A build from this computer</label><div class="row"><input class="input grow" id="lnFile" placeholder="${d.kind === 'windows-sandbox' ? 'A .zip, .exe or .msi' : 'A .dmg, .zip, .app or .pkg'}" value="${esc(L.path)}"><button class="btn" data-x="browse-file">${icon('folder', 14)}Choose…</button></div>
        <span class="hint">Bench copies it into the desk, installs it and opens it, just like a first install on a new computer. Utility Package builds are in its releases folder.</span></div>`;
      $('#lnFile').oninput = (e) => { L.path = e.target.value; };
      $('[data-x="browse-file"]').onclick = async () => { const p = await call('dialog:pick', 'file'); if (p) { L.path = p; $('#lnFile').value = p; } };
    } else if (L.tab === 'web') {
      b.innerHTML = `<div class="field"><label>Address</label><input class="input" id="lnUrl" placeholder="https://… , localhost:5173 or a local .html file" value="${esc(L.url)}"><span class="hint">${sb ? 'Opens in Bench’s own browser window on this desk, so Claude can see, click and read console errors like any app.' : 'Opens in the desk’s default browser.'}</span></div>`;
      $('#lnUrl').oninput = (e) => { L.url = e.target.value; };
    } else {
      b.innerHTML = `<div class="field"><label>Command</label><input class="input mono" id="lnCmd" placeholder="npm test" value="${esc(L.cmd)}"></div>${sb ? `<div class="field" style="margin-top:12px"><label>In folder</label><div class="row"><input class="input grow mono" id="lnCwd" placeholder="The desk’s folder"><button class="btn" data-x="browse-cwd">${icon('folder', 14)}Choose…</button></div></div>` : ''}`;
      $('#lnCmd').oninput = (e) => { L.cmd = e.target.value; };
      if (sb) $('[data-x="browse-cwd"]').onclick = async () => { const p = await call('dialog:pick', 'folder'); if (p) $('#lnCwd').value = p; };
    }
    hydrateIcons(b);
  },
  async lnGo(d, btn) {
    const L = this.ln; const sb = d.kind === 'sandbox'; let spec = {};
    if (L.tab === 'suite') { if (!L.pick) return toast({ kind: 'bad', title: 'Pick an app' }); spec = L.from === 'installed' ? { app: L.pick } : { project: L.pick }; const all = L.from === 'installed' ? S.catalog.installed : S.catalog.projects; const a = all.find((x) => x.id === L.pick); if (L.from === 'installed' && a) spec.app = a.name; }
    else if (L.tab === 'app' || L.tab === 'open') { if (!L.path.trim()) return toast({ kind: 'bad', title: 'Enter an app' }); spec = sb ? { path: L.path.trim() } : { app: L.path.trim() }; }
    else if (L.tab === 'install') { if (!L.path.trim()) return toast({ kind: 'bad', title: 'Choose a build' }); spec = { file: L.path.trim() }; }
    else if (L.tab === 'web') { if (!L.url.trim()) return toast({ kind: 'bad', title: 'Enter an address' }); spec = { url: L.url.trim() }; }
    else { if (!L.cmd.trim()) return toast({ kind: 'bad', title: 'Enter a command' }); spec = { command: L.cmd.trim() }; const cwd = $('#lnCwd') && $('#lnCwd').value.trim(); if (cwd) spec.cwd = cwd; }
    if (sb) { spec.data = L.data; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Opening…';
    this.close();
    if (S.deskId !== d.id) go('desks', { desk: d.id });
    const t = toast({ kind: 'busy', title: `Opening ${spec.app || spec.project || (spec.path || '').split(/[\\/]/).pop() || spec.url || spec.file || spec.command}…`, ms: 300000 });
    try { const r = await call('desk:launch', d.id, spec); t.remove(); if (r && r.note) toast({ kind: 'ok', title: 'Opened', text: r.note }); else if (r && r.text) toast({ kind: 'ok', title: r.text }); }
    catch (err) { t.remove(); toast({ kind: 'bad', title: 'Couldn’t open it', text: err.message }); }
  },

  // ───────── finding (filed by you)
  finding({ desk, session }) {
    const s = this.open(`<div class="sheet-head"><h2>New finding</h2><button class="icon-btn" data-x="close">${icon('close')}</button></div>
      <div class="sheet-body"><div class="form-row"><div class="label">Title</div><input class="input" id="fnT" placeholder="What’s wrong, in a line"></div>
      <div class="form-row"><div class="label">App</div><input class="input" id="fnA" placeholder="Lumen"></div>
      <div class="form-row"><div class="label">Severity</div><div class="seg" id="fnS"><button data-v="high">High</button><button data-v="medium" class="on">Medium</button><button data-v="low">Low</button></div></div>
      <div class="form-row"><div class="label">Steps<small>One per line</small></div><textarea class="textarea" id="fnSteps" rows="4"></textarea></div>
      <div class="form-row"><div class="label">Expected</div><input class="input" id="fnE"></div>
      <div class="form-row"><div class="label">What happened</div><textarea class="textarea" id="fnW" rows="3"></textarea></div></div>
      <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="save">File it</button></div>`);
    $$('[data-x="close"]', s).forEach((b) => (b.onclick = () => this.close()));
    let sev = 'medium'; $('#fnS').onclick = (e) => { const b = e.target.closest('button'); if (b) { sev = b.dataset.v; $$('#fnS button').forEach((x) => x.classList.toggle('on', x === b)); } };
    const sess = desk && Desk.st ? Desk.st.sessions.find((x) => x.id === session) : null; if (sess) $('#fnA').value = sess.name;
    s.querySelector('[data-x="save"]').onclick = async () => {
      const title = $('#fnT').value.trim(); if (!title) return toast({ kind: 'bad', title: 'Give it a title' });
      await call('findings:add', { title, app: $('#fnA').value.trim(), version: sess && sess.meta ? sess.meta.version : '', severity: sev, steps: $('#fnSteps').value, expected: $('#fnE').value.trim(), actual: $('#fnW').value.trim(), desk, deskName: (S.desks.find((x) => x.id === desk) || {}).name || '' });
      this.close(); toast({ kind: 'ok', title: 'Finding filed' });
    };
    setTimeout(() => $('#fnT').focus(), 30);
  },
  act() { return false; },
};

// Activity, Phone & tablet, Devices and Settings.
'use strict';

// ───────── Activity: everything sent and received
VIEWS.activity = {
  title: 'Activity',
  head() {
    const n = S.history.length;
    return `<h1>Activity <small>${n ? plural(n, 'transfer') : ''}</small></h1>`;
  },
  actions() {
    const f = S.filter;
    return `<div class="seg" id="hf">${[['all', 'All'], ['out', 'Sent'], ['in', 'Received']].map(([k, l]) => `<button data-k="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn sm" id="openRecv2"><span data-icon="inbox" data-size="15"></span>Received folder</button>
      <button class="icon-btn sm" id="hmore" title="More">${icon('more', 17)}</button>`;
  },
  render(view) {
    const live = [...S.transfers.values()].filter(t => LIVE.includes(t.status) || (t.status === 'failed' && t.retryable));
    const liveIds = new Set(live.map(t => t.tid));
    let list = S.history.filter(h => !liveIds.has(h.tid));
    if (S.filter !== 'all') list = list.filter(h => h.dir === S.filter);
    const filteredLive = S.filter === 'all' ? live : live.filter(t => t.dir === S.filter);
    if (!list.length && !filteredLive.length) {
      view.innerHTML = `<div class="empty"><span class="tile xl a-blue">${icon('activity', 26)}</span><b>${S.history.length ? 'Nothing here' : 'Nothing sent or received yet'}</b><span>Everything you send and receive shows up here, with where it went, how fast it moved and a way to find it again.</span></div>`;
      return;
    }
    let html = '';
    if (filteredLive.length) html += `<div class="day">Now</div><div class="list">${filteredLive.map(t => hrow(t, true)).join('')}</div>`;
    let day = '';
    let group = [];
    const flush = () => { if (group.length) html += `<div class="day">${esc(day)}</div><div class="list">${group.join('')}</div>`; group = []; };
    for (const h of list) {
      const d = dayLabel(h.ended || h.started);
      if (d !== day) { flush(); day = d; }
      group.push(hrow(h, false));
    }
    flush();
    view.innerHTML = html;
    view.querySelectorAll('[data-act]').forEach(b => b.onclick = (e) => { e.stopPropagation(); hact(b); });
  },
  after() {
    $$('#hf button').forEach(b => b.onclick = () => { S.filter = b.dataset.k; render(); });
    $('#openRecv2').onclick = () => call('openReceived').catch(fail);
    $('#hmore').onclick = (e) => menu(e.currentTarget, [
      { label: 'Clear activity', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: 'Clear activity?', text: 'This only clears the list. Received files stay where they are.', ok: 'Clear', danger: true })) call('clearHistory').catch(fail); } },
    ]);
  },
};

function hrow(t, live) {
  const pill = {
    done: ['ok', t.dir === 'out' ? 'Sent' : 'Received'], failed: ['bad', 'Failed'], cancelled: ['', 'Cancelled'], declined: ['warn', 'Declined'], interrupted: ['warn', 'Interrupted'],
    active: ['acc', `${t.total ? Math.floor((t.bytes / t.total) * 100) : 0}%`], waiting: ['acc', 'Waiting'], asking: ['warn', 'Needs you'], preparing: ['acc', 'Preparing'],
  }[t.status] || ['', t.status];
  const who = t.dir === 'out' ? `to ${t.peer.name}` : `from ${t.peer.name}`;
  const acts = [];
  if (live && LIVE.includes(t.status)) acts.push(`<button class="btn xs" data-act="cancel">Cancel</button>`);
  if (t.status === 'asking') acts.push(`<button class="btn xs primary" data-act="review">Review</button>`);
  if (t.retryable) acts.push(`<button class="btn xs" data-act="retry">${icon('refresh', 13)}Retry</button>`);
  if (t.status === 'done' && t.dir === 'in' && t.saved && t.saved.length) {
    acts.push(`<button class="icon-btn xs" data-act="show" title="Show in folder">${icon('reveal', 15)}</button>`);
    if (t.saved.length === 1) acts.push(`<button class="icon-btn xs" data-act="open" title="Open">${icon('external', 15)}</button>`);
  }
  if (t.kind === 'text' && t.text) acts.push(`<button class="icon-btn xs" data-act="copy" title="Copy">${icon('copy', 15)}</button>`);
  if (t.kind === 'text' && isLink(t.text)) acts.push(`<button class="icon-btn xs" data-act="url" title="Open link">${icon('globe', 15)}</button>`);
  if (!live) acts.push(`<button class="icon-btn xs" data-act="remove" title="Remove from the list">${icon('x', 15)}</button>`);
  const sub = [
    `<span>${esc(who)}</span>`,
    t.kind === 'text' ? `<span class="ellip" style="max-width:340px">· “${esc(String(t.text || '').slice(0, 80))}”</span>` : `<span>· ${plural(t.count || 0, 'file')}</span>`,
    t.phone ? `<span class="pill" style="height:18px">${icon('qr', 11)}phone link</span>` : '',
    t.error && t.status !== 'done' ? `<span style="color:var(--bad)">· ${esc(t.error)}</span>` : '',
  ].join('');
  const dur2 = t.ended && t.started ? (t.ended - t.started) / 1000 : null;
  return `<div class="lrow hrow" data-tid="${esc(t.tid)}">
    <span class="x-dir ${t.dir}" style="width:32px;height:32px">${icon(t.kind === 'text' ? (isLink(t.text) ? 'link' : 'text') : t.dir === 'out' ? 'arrowUp' : 'arrowDown', 16)}</span>
    <div class="l-main"><div class="l-title row" style="gap:8px"><span class="ellip">${esc(whatOf(t))}</span><span class="pill ${pill[0]}">${esc(pill[1])}</span></div><div class="l-sub">${sub}</div></div>
    <div class="l-meta">${t.kind !== 'text' ? `<b>${human(t.total)}</b>` : '<b>&nbsp;</b>'}<span>${t.status === 'active' ? `${human(t.speed)}/s` : t.avg ? `${human(t.avg)}/s` : dur2 != null && t.status === 'done' && t.kind !== 'text' ? dur(dur2) : ''} · ${clock(t.ended || t.started)}</span></div>
    <div class="l-act">${acts.join('')}</div></div>`;
}
async function hact(b) {
  const tid = b.closest('[data-tid]').dataset.tid;
  const t = S.transfers.get(tid) || S.history.find(x => x.tid === tid);
  if (!t) return;
  try {
    switch (b.dataset.act) {
      case 'cancel': await call('cancel', tid); break;
      case 'retry': await call('retry', tid); break;
      case 'show': await call('show', t.saved[0]); break;
      case 'open': await call('open', t.saved[0]); break;
      case 'copy': await call('copy', t.text); toast('Copied'); break;
      case 'url': await call('openUrl', t.text.trim()); break;
      case 'remove': await call('removeHistory', tid); break;
      case 'review': { const a = S.asking.find(x => x.t.tid === tid); if (a) askSheet(a); break; }
    }
  } catch (e) { fail(e); }
}

// ───────── Phone & tablet
VIEWS.phone = {
  title: 'Phone & tablet',
  head() { return `<h1>Phone &amp; tablet <small>No app needed</small></h1>`; },
  actions() {
    const p = S.phone; if (!p) return '';
    return `<span class="small muted">Phone link</span><button class="switch ${p.enabled ? 'on' : ''}" id="pon" title="Turn the phone link on or off"></button>`;
  },
  render(view) {
    const p = S.phone;
    if (!p) { view.innerHTML = '<div class="empty"><span class="spin"></span></div>'; call('phone').then(x => { S.phone = x; refresh(['phone']); }, fail); return; }
    const qr = p.qr ? qrSvg(p.qr) : '';
    view.innerHTML = `<div class="phone-grid">
      <div class="card qr-card ${p.enabled && p.url ? '' : 'off'}">
        <div class="qr-box">${qr}<img class="qr-logo" src="../../build/icon.png" alt=""></div>
        ${p.enabled ? (p.url ? `<div class="qr-url" id="purl" title="Click to copy">${esc(p.url)}</div>` : '<div class="muted small">Not connected to a network.</div>') : '<div class="muted small">The phone link is off.</div>'}
        ${p.addresses.length > 1 ? `<select class="select" id="paddr" style="width:100%">${p.addresses.map(a => `<option value="${esc(a.address)}" ${a.address === p.address ? 'selected' : ''}>${esc(a.address)} — ${esc(a.name)}</option>`).join('')}</select>` : ''}
        <div class="steps">
          <div><i>1</i><span>Open the camera on your iPhone, iPad or Android and point it at the code.</span></div>
          <div><i>2</i><span>Tap the link. A Beam page opens in the browser — add it to your home screen to keep it.</span></div>
          <div><i>3</i><span>Send photos, videos and files here, or download what you put up on the right.</span></div>
        </div>
        <div class="row" style="width:100%"><span class="hint grow" style="text-align:left">Works on the same Wi-Fi. Anyone with the link can send to this computer while it’s on.</span><button class="btn xs" id="pnew">${icon('refresh', 13)}New link</button></div>
      </div>
      <div class="col" style="gap:14px;min-width:0">
        <div class="section-title" style="margin:0">Put up for your phone</div>
        <div class="dropzone" id="pdrop">${icon('download', 26)}<b>Drop files here</b><span class="small">They show up on the phone page to download. Nothing is copied — they're served from where they are.</span><button class="btn sm" id="ppick" style="margin-top:6px">${icon('plus', 15)}Choose files</button></div>
        ${p.shared.length ? `<div class="list">${p.shared.map(x => `<div class="lrow" data-id="${esc(x.id)}"><span class="tile sm a-blue">${icon(fileIcon(x.name), 14)}</span><div class="l-main"><div class="l-title ellip">${esc(x.name)}</div><div class="l-sub">${human(x.size)}${x.downloads ? ` · downloaded ${plural(x.downloads, 'time')}` : ''}</div></div><div class="l-act"><button class="icon-btn xs" data-un="${esc(x.id)}" title="Take down">${icon('x', 15)}</button></div></div>`).join('')}</div>
          <div class="row"><span class="grow"></span><button class="btn xs ghost" id="punall">Take all down</button></div>` : ''}
        <div class="section-title" style="margin:6px 0 0">Text for your phone</div>
        <div class="row"><input class="input grow" id="ptext" placeholder="A link, an address, a code…"><button class="btn" id="ptsend">Put up</button></div>
        ${p.texts.length ? `<div class="list">${p.texts.map(x => `<div class="lrow"><span class="tile sm a-indigo">${icon(isLink(x.text) ? 'link' : 'text', 14)}</span><div class="l-main"><div class="l-title ellip">${esc(x.text)}</div></div><div class="l-act"><button class="icon-btn xs" data-unt="${esc(x.id)}">${icon('x', 15)}</button></div></div>`).join('')}</div>` : ''}
      </div></div>`;
  },
  after() {
    const p = S.phone; if (!p) return;
    const set = (x) => { S.phone = x; refresh(['phone']); };
    const pon = $('#pon'); if (pon) pon.onclick = () => call('phoneEnable', !p.enabled).then(set, fail);
    const purl = $('#purl'); if (purl) purl.onclick = () => call('copy', p.url).then(() => toast('Link copied'));
    const pa = $('#paddr'); if (pa) pa.onchange = () => call('phone', pa.value).then(set, fail);
    $('#pnew').onclick = async () => { if (await confirmBox({ title: 'Make a new link?', text: 'The old code and any saved shortcut on your phone stop working.', ok: 'New link' })) call('phoneLink').then(set, fail); };
    $('#ppick').onclick = async () => { const paths = await call('pick', 'files').catch(fail); if (paths && paths.length) call('phoneShare', paths).then(set, fail); };
    const dz = $('#pdrop');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const paths = droppedPaths(e); if (paths.length) call('phoneShare', paths).then(set, fail); });
    $$('[data-un]').forEach(b => b.onclick = () => call('phoneUnshare', b.dataset.un).then(set, fail));
    const ua = $('#punall'); if (ua) ua.onclick = () => call('phoneUnshare', null).then(set, fail);
    const send = () => { const v = $('#ptext').value; if (v.trim()) call('phoneText', v).then(set, fail); };
    $('#ptsend').onclick = send; $('#ptext').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    $$('[data-unt]').forEach(b => b.onclick = () => call('phoneUntext', b.dataset.unt).then(set, fail));
  },
};
function qrSvg(q) {
  const n = q.n, m = 2; let d = '';
  q.rows.forEach((row, y) => { for (let x = 0; x < n; x++) if (row[x] === '1') d += `M${x + m} ${y + m}h1v1h-1z`; });
  return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges"><path d="${d}" fill="#0a1124"/></svg>`;
}

// ───────── Devices: trusted devices and saved addresses
VIEWS.devices = {
  title: 'Devices',
  actions() { return `<button class="btn sm" id="dadd"><span data-icon="plus" data-size="15"></span>Add by address</button>`; },
  render(view) {
    const st = S.settings;
    const near = new Map(S.peers.map(p => [p.id, p]));
    const trusted = st.trusted || [];
    const others = S.peers.filter(p => !p.trusted);
    view.innerHTML = `<div class="set-wrap">
      <p class="lead">Trusted devices send straight in without asking${st.autoAcceptTrusted === false ? ' (auto-accept is off in Settings)' : ''}. Each pair of devices has a safety code: if it's the same on both screens, you're talking to the real thing.</p>
      <div class="section-title">Trusted</div>
      ${trusted.length ? `<div class="list">${trusted.map(t => { const p = near.get(t.id); return `<div class="lrow"><span class="tile md ${tintOf(t.id)}">${icon(devIcon(t), 17)}</span>
        <div class="l-main"><div class="l-title">${esc(p ? p.name : t.name)}</div><div class="l-sub"><span class="dot ${p ? 'on' : ''}" style="width:6px;height:6px"></span>${p ? 'Nearby' : 'Not nearby'}${osName(t.os) ? ` · ${osName(t.os)}` : ''}${p ? ` · code <span class="code">${esc(p.code)}</span>` : ''}</div></div>
        <div class="l-act"><button class="btn xs" data-untrust="${esc(t.id)}">Remove</button></div></div>`; }).join('')}</div>`
        : `<div class="list"><div class="lrow"><span class="tile md a-mint">${icon('shield', 17)}</span><div class="l-main"><div class="l-title">No trusted devices yet</div><div class="l-sub">Tick “Always accept” when a device sends to you, or trust it from Nearby.</div></div><span></span></div></div>`}
      ${others.length ? `<div class="section-title">Nearby, not trusted</div><div class="list">${others.map(p => `<div class="lrow"><span class="tile md ${tintOf(p.id)}">${icon(devIcon(p), 17)}</span>
        <div class="l-main"><div class="l-title">${esc(p.name)}</div><div class="l-sub">${esc([osName(p.os), p.address].filter(Boolean).join(' · '))} · code <span class="code">${esc(p.code)}</span></div></div>
        <div class="l-act"><button class="btn xs" data-trust="${esc(p.id)}">${icon('shield', 13)}Trust</button></div></div>`).join('')}</div>` : ''}
      <div class="section-title">Saved addresses</div>
      ${(st.saved || []).length ? `<div class="list">${st.saved.map(a => { const p = S.peers.find(x => x.via === 'saved' && `${x.address}:${x.port}` === a) || S.peers.find(x => a.startsWith(x.address + ':')); return `<div class="lrow"><span class="tile md a-sky">${icon('globe', 17)}</span>
        <div class="l-main"><div class="l-title mono">${esc(a)}</div><div class="l-sub">${p ? `<span class="dot on" style="width:6px;height:6px"></span>${esc(p.name)}` : 'Not answering right now'}</div></div>
        <div class="l-act"><button class="icon-btn xs" data-rmaddr="${esc(a)}" title="Forget">${icon('x', 15)}</button></div></div>`; }).join('')}</div>`
        : `<p class="hint">Devices Beam finds by itself don't need an address. Add one only for a computer on another subnet or VLAN.</p>`}
      </div>`;
  },
  after() {
    $('#dadd').onclick = addAddressSheet;
    $$('[data-untrust]').forEach(b => b.onclick = () => call('untrust', b.dataset.untrust).then(t => { S.settings.trusted = t; render(); }, fail));
    $$('[data-trust]').forEach(b => b.onclick = () => { const p = S.peers.find(x => x.id === b.dataset.trust); if (p) trustSheet(p); });
    $$('[data-rmaddr]').forEach(b => b.onclick = () => call('removeAddress', b.dataset.rmaddr).then(() => { S.settings.saved = S.settings.saved.filter(x => x !== b.dataset.rmaddr); render(); }, fail));
  },
};

// ───────── Settings
VIEWS.settings = {
  title: 'Settings',
  render(view) {
    const s = S.settings;
    const sw = (k, on) => `<button class="switch ${on ? 'on' : ''}" data-sw="${k}"></button>`;
    const seg = (k, opts) => `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    view.innerHTML = `<div class="set-wrap">
      <div class="section-title">This computer</div>
      <div class="set-group">
        <div class="set-row"><div class="s-main"><div class="s-title">Name</div><div class="s-sub">What other devices see.</div></div><input class="input" id="sname" value="${esc(s.name)}" maxlength="60"></div>
        <div class="set-row"><div class="s-main"><div class="s-title">Received files go to</div><div class="s-sub">Folders keep their structure. Nothing is ever overwritten — a second copy gets a number.</div></div>
          <span class="path-pill" title="${esc(S.receiveDir)}">${icon('folder', 15)}<span class="ellip">${esc(S.receiveDir)}</span></span><button class="btn sm" id="sdir">Change…</button></div>
      </div>
      <div class="section-title">Receiving</div>
      <div class="set-group">
        <div class="set-row"><div class="s-main"><div class="s-title">Who can send to you</div><div class="s-sub">“Off” also hides this computer from others. You can always send.</div></div>${seg('receive', [['everyone', 'Everyone nearby'], ['trusted', 'Trusted only'], ['off', 'Off']])}</div>
        <div class="set-row"><div class="s-main"><div class="s-title">Accept from trusted devices without asking</div><div class="s-sub">Like AirDrop between your own devices.</div></div>${sw('autoAcceptTrusted', s.autoAcceptTrusted !== false)}</div>
        <div class="set-row"><div class="s-main"><div class="s-title">Copy received text and links to the clipboard</div></div>${sw('copyText', s.copyText)}</div>
        <div class="set-row"><div class="s-main"><div class="s-title">Show received files in the folder when they arrive</div></div>${sw('openFolderWhenDone', s.openFolderWhenDone)}</div>
      </div>
      <div class="section-title">Speed</div>
      <div class="set-group">
        <div class="set-row"><div class="s-main"><div class="s-title">Connections per transfer</div><div class="s-sub">Big files are split and sent over several connections at once. Auto suits most networks; more can help on fast Wi-Fi with lag.</div></div>${seg('streams', [[0, 'Auto'], [2, '2'], [4, '4'], [8, '8']])}</div>
        <div class="set-row"><div class="s-main"><div class="s-title">Keep the computer awake while files move</div></div>${sw('keepAwake', s.keepAwake)}</div>
      </div>
      <div class="section-title">App</div>
      <div class="set-group">
        <div class="set-row"><div class="s-main"><div class="s-title">Open at login</div><div class="s-sub">Starts quietly in the ${B.platform === 'darwin' ? 'menu bar' : 'tray'} so others can send to you.</div></div>${sw('openAtLogin', s.openAtLogin)}</div>
        <div class="set-row"><div class="s-main"><div class="s-title">Keep running when the window is closed</div><div class="s-sub">Otherwise closing the window quits Beam and nothing can arrive.</div></div>${sw('background', s.background)}</div>
        <div class="set-row"><div class="s-main"><div class="s-title">Notifications</div></div>${sw('notify', s.notify)}</div>
        ${B.platform === 'win32' ? `<div class="set-row"><div class="s-main"><div class="s-title">“Beam” in Explorer’s Send to menu</div><div class="s-sub">Right-click files › Send to › Beam.</div></div>${sw('sendTo', s.sendTo)}</div>` : ''}
        <div class="set-row"><div class="s-main"><div class="s-title">Appearance</div></div>${seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      </div>
      <div class="section-title">About</div>
      <div class="set-group">
        <div class="set-row"><div class="s-main"><div class="s-title">This computer’s address</div><div class="s-sub">For “Add by address” on a computer that can’t see this one.</div></div><div class="col" style="gap:4px;align-items:flex-end">${(S.addresses || []).map(a => `<span class="mono">${esc(a.address)}${S.port !== 47821 ? ':' + S.port : ''} <span class="muted">${esc(a.name)}</span></span>`).join('') || '<span class="muted">Not connected</span>'}</div></div>
        ${B.platform === 'win32' ? `<div class="set-row"><div class="s-main"><div class="s-title">Other devices can’t see this PC?</div><div class="s-sub">Windows asks once whether Beam may use the network — allow it on <b>Private networks</b>. Also make sure this network is set to Private in Settings › Network &amp; internet.</div></div></div>` : ''}
        ${B.platform === 'darwin' ? `<div class="set-row"><div class="s-main"><div class="s-title">Other devices can’t see this Mac?</div><div class="s-sub">macOS asks once to let Beam find devices on your local network — allow it, or turn Beam on in System Settings › Privacy &amp; Security › Local Network.</div></div></div>` : ''}
        <div class="set-row"><div class="s-main"><div class="s-title">Beam ${esc(S.version)}</div><div class="s-sub">Files go straight between devices on your network, encrypted end to end (X25519 + AES-256-GCM). Nothing goes through the internet.</div></div></div>
      </div></div>`;
  },
  after() {
    $$('[data-sw]').forEach(b => b.onclick = () => { const k = b.dataset.sw; const on = !b.classList.contains('on'); setSettings({ [k]: on }); });
    $$('[data-seg]').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { const k = g.dataset.seg; let v = b.dataset.v; if (k === 'streams') v = Number(v); setSettings({ [k]: v }); }));
    const n = $('#sname');
    n.addEventListener('change', () => setSettings({ name: n.value }));
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.blur(); });
    $('#sdir').onclick = async () => { const p = await call('pick', 'dir').catch(fail); if (p && p[0]) { await setSettings({ receiveDir: p[0] }); S.receiveDir = p[0]; render(); } };
  },
};

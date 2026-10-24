// Start-up: load state, listen for the engine, first-run welcome.
'use strict';

function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function welcome() {
  const el = openSheet(`<div class="sheet-body ask" style="padding-bottom:6px">
      <img src="../../build/icon.png" alt="" style="width:76px;height:76px;filter:drop-shadow(0 10px 24px rgba(40,90,255,.35))">
      <h3>Welcome to Beam</h3>
      <div class="ask-what" style="max-width:380px">Send files, folders, text and links straight to your other computers and phones — no cloud, no cables, as fast as your network goes.</div>
      <div class="field" style="width:100%;text-align:left;margin-top:6px"><label>What should other devices call this computer?</label><input class="input" id="wname" value="${esc(S.settings.name)}" maxlength="60"></div>
      <div class="steps" style="margin-top:4px">
        <div><i>1</i><span>Install Beam on your other Mac or PC from Utility Hub. Devices on the same network find each other.</span></div>
        <div><i>2</i><span>Drop files on a device to send. The first time, they’ll be asked to accept — tick “Always accept” for your own devices.</span></div>
        <div><i>3</i><span>Phones don’t need an app: scan the code in Phone &amp; tablet.</span></div>
      </div></div>
    <div class="sheet-foot"><span class="hint grow">Received files go to ${esc(S.receiveDir)}</span><button class="btn primary" id="wgo">Get started</button></div>`, { width: 500, cls: 'sticky' });
  const done = () => { setSettings({ name: el.querySelector('#wname').value, onboarded: true }); closeSheet(); };
  el.querySelector('#wgo').onclick = done;
  el.querySelector('#wname').addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
}

(async () => {
  if (B.platform === 'win32') document.documentElement.classList.add('win');
  const st = await call('state');
  Object.assign(S, { me: st.me, settings: st.settings, peers: st.peers, history: st.history, staged: st.staged, receiveDir: st.receiveDir, addresses: st.addresses, port: st.port, version: st.version, demo: st.demo });
  S.transfers = new Map(st.transfers.map(t => [t.tid, t]));
  if (S.staged.length) S.stagedInfo = await call('inspect', S.staged).catch(() => []);
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $$('#nav button').forEach(b => b.onclick = () => go(b.dataset.view));
  go(location.hash ? location.hash.slice(1) : 'nearby');
  hydrateIcons(document);
  document.body.classList.add('ready');

  B.on('peers', (p) => {
    const before = S.peers.map(x => x.id).join();
    S.peers = p;
    if (S.view === 'nearby') { VIEWS.nearby.place(); $('#headLeft').innerHTML = VIEWS.nearby.head(); VIEWS.nearby.renderStaged(); side(); }
    else if (S.view === 'devices') render();
    else side();
    void before;
  });
  let tickPending = false;
  B.on('transfer', (t) => {
    const prev = S.transfers.get(t.tid);
    S.transfers.set(t.tid, t);
    const statusChanged = !prev || prev.status !== t.status;
    if (statusChanged && ['done', 'failed', 'declined', 'cancelled'].includes(t.status) && t.dir === 'out') {
      if (t.status === 'done') toast(t.kind === 'text' ? `Sent to ${t.peer.name}` : `Sent ${whatOf(t)}`, t.kind === 'text' ? '' : `${human(t.total)} to ${t.peer.name}${t.avg ? ` · ${human(t.avg)}/s` : ''}`);
      else if (t.status === 'declined') toast(`${t.peer.name} declined`, t.error || '', 'info', 6000);
      else if (t.status === 'failed') toast('Couldn’t send', t.error || '', 'bad', 8000);
    }
    if (statusChanged && t.dir === 'in' && t.status === 'cancelled' && S.askOpen === t.tid) doneAsk(t.tid);
    if (tickPending) return;
    tickPending = true;
    requestAnimationFrame(() => {
      tickPending = false;
      if (S.view === 'nearby') VIEWS.nearby.tick();
      else if (S.view === 'activity') render();
      side();
    });
  });
  B.on('transfers', (list) => {
    const ids = new Set(list.map(t => t.tid));
    for (const [tid, t] of S.transfers) if (!ids.has(tid) && !LIVE.includes(t.status)) S.transfers.delete(tid);
    refresh(['nearby', 'activity']);
  });
  B.on('history', (h) => { S.history = h; refresh(['activity']); });
  B.on('incoming', (a) => { S.asking.push(a); if (!S.askOpen) askSheet(a); });
  B.on('asked', (tid) => doneAsk(tid));
  B.on('text', ({ from, text, copied }) => toast(isLink(text) ? `Link from ${from}` : `Text from ${from}`, (copied ? 'Copied — ' : '') + text.slice(0, 160), 'ok', 7000, isLink(text) ? [{ label: 'Open', run: () => call('openUrl', text.trim()) }] : [{ label: 'Copy', run: () => call('copy', text) }]));
  B.on('received', (t) => { if (t.saved && t.saved.length) toast(`Received ${whatOf(t)}`, `From ${t.peer.name}${t.avg ? ` · ${human(t.avg)}/s` : ''}`, 'ok', 7000, [{ label: 'Show', run: () => call('show', t.saved[0]) }]); });
  B.on('stage', async (list) => { S.staged = list; S.stagedInfo = await call('inspect', list).catch(() => []); if (S.view !== 'nearby') go('nearby'); else refresh(['nearby']); });
  B.on('settings', (s) => { S.settings = s; applyTheme(); side(); if (S.view === 'devices') render(); });
  B.on('phone', (p) => { S.phone = p; refresh(['phone']); });
  B.on('theme', () => applyTheme());

  for (const t of st.asking || []) S.asking.push({ t, meta: { list: [], code: '' } });
  if (!S.settings.onboarded && !S.demo) welcome();
  else if (S.asking.length) askSheet(S.asking[0]);
  // keep “3 min ago” and speeds fresh
  setInterval(() => { if (S.view === 'activity' && !$('.menu')) render(); }, 30000);
})();

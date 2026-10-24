// Cadence window: live updates from the main process, and start-up.
'use strict';

function applyThemeNow() { const t = S.settings.theme; const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }

let flowsT = null;
C.on('flows:changed', () => { clearTimeout(flowsT); flowsT = setTimeout(async () => { await loadFlows(); if (S.view === 'flows') render(); }, 150); });
let runT = {};
C.on('run:update', (snap) => {
  upsertRun(snap); renderNext();
  if (S.view === 'editor') Editor.onRun(snap);
  if (S.view === 'run' && S.runId === snap.id) {
    if (runT[snap.id]) return;
    runT[snap.id] = setTimeout(async () => { delete runT[snap.id]; try { S.runDetail = await call('runs:get', snap.id); if (S.view === 'run' && S.runId === snap.id) render(); } catch {} }, ['done', 'failed', 'cancelled'].includes(snap.status) ? 0 : 350);
  }
  if (S.view === 'runs' || S.view === 'flows') { clearTimeout(runT._list); runT._list = setTimeout(render, 300); }
});
C.on('nav', (v) => { if (v === 'new') newMenu($('#newBtn') || $('#nav')); else if (v === 'import') importFlow(); else go(v); });
C.on('ai:activity', (a) => { toast(a.msg, 'From Claude / Codex', 'info'); });
C.on('bridge:status', (b) => { S.bridge = b; $('#aiDot').classList.toggle('on', !!b.connected); $('#aiDot').title = b.connected ? `${b.client || 'An assistant'} is connected` : ''; });
C.on('settings:changed', (s) => { S.settings = s; if (S.view === 'settings') render(); });
setInterval(() => { renderNext(); if (S.view === 'flows') render(); }, 60e3);

$$('#nav button').forEach((b) => b.onclick = () => { if (b.dataset.view === 'runs') S.runFilter = null; go(b.dataset.view); });

(async () => {
  try {
    [S.info, S.cat, S.settings] = await Promise.all([call('app:info'), call('catalog'), call('settings:get')]);
    document.documentElement.classList.toggle('win', C.platform === 'win32');
    document.documentElement.classList.toggle('mac', C.platform === 'darwin');
    applyThemeNow(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeNow);
    const [, , profiles, sec] = await Promise.all([loadFlows(), loadRuns(), call('profiles:list'), call('secrets:list')]);
    S.profiles = profiles; S.secrets = sec.list;
    call('ai:status').then((a) => { S.ai = a; }).catch(() => {});
    call('connectors:status').then((c) => { S.bridge = c.bridge; $('#aiDot').classList.toggle('on', !!c.bridge.connected); }).catch(() => {});
    renderNext(); hydrateIcons();
    const start = new URLSearchParams(location.search).get('view');
    go(start || 'flows');
    document.body.classList.add('ready');
  } catch (e) { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:30px;white-space:pre-wrap">${esc(e.stack || e)}</pre>`; }
})();

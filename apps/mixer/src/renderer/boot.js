// Mixer window: live updates from the main process (including everything Claude does through the plugin) and start-up.
'use strict';
function applyThemeNow() { const t = S.settings.theme; const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; if (S.view === 'arrange') { drawThumbs(); drawEditor(); } }

let chT = null;
D.on('song:changed', (s) => {
  if (s.quiet) { S.history = s.history; updateUndo(); return; }
  S.remoteMark++; applySnapshot(s);
  if (s.by && s.by !== 'you' && s.label) S.activity.unshift({ msg: s.label, by: s.by, at: Date.now() }), (S.activity = S.activity.slice(0, 20)), renderAiCard();
  clearTimeout(chT); chT = setTimeout(() => { if (!$('#popHost').firstChild && !TL.dragging && !ED.drag) refresh(); }, 60);
});
D.on('song:switched', (s) => { S.remoteMark++; applySnapshot(s); S.check = null; render(); });
D.on('ai:activity', (a) => { activityToast(a.msg, `From ${byWho(S.bridge.client || 'Claude')}`); });
D.on('bridge:status', (b) => { S.bridge = b; $('#aiDot').classList.toggle('on', !!b.connected); renderAiCard(); });
D.on('transport', async (cmd) => { if (cmd.action === 'stop') Player.stop(); else if (cmd.action === 'play') { await commitChain; try { await Player.play(cmd.from || 0); } catch (e) { fail(e); } } });
D.on('nav', (v) => { if (v === 'new-song') newSong(); else if (v === 'import') importDialog({ atBeat: Math.floor(Player.position()) }); else if (v === 'export') exportSheet(); else if (v === 'undo') undo(); else if (v === 'redo') redo(); else go(v); });
setInterval(renderAiCard, 60e3);

$$('#nav button').forEach((b) => b.onclick = () => go(b.dataset.view));
$('#songBtn').onclick = (e) => songMenu(e.currentTarget);

(async () => {
  try {
    [S.info, S.settings] = await Promise.all([call('app:info'), call('settings:get')]);
    Player.metronome = !!S.settings.metronome;
    document.documentElement.classList.toggle('win', D.platform === 'win32'); document.documentElement.classList.toggle('mac', D.platform === 'darwin');
    applyThemeNow(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeNow);
    applySnapshot(await call('song:get'));
    call('songs:list').then((r) => { $('#songCount').textContent = r.list.length || ''; }).catch(() => {});
    call('connectors:status').then((c) => { S.bridge = c.bridge; $('#aiDot').classList.toggle('on', !!c.bridge.connected); renderAiCard(); }).catch(() => {});
    call('ai:status').then((a) => { S.ai = a; }).catch(() => {});
    renderAiCard(); hydrateIcons();
    const start = new URLSearchParams(location.search).get('view');
    go(start || 'arrange');
    document.body.classList.add('ready');
  } catch (e) { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:30px;white-space:pre-wrap">${esc(e.stack || e)}</pre>`; }
})();

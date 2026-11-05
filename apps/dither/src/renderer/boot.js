// Dither window: live updates from the main process (including everything Claude does through the plugin) and start-up.
'use strict';

function applyThemeNow() { const t = S.settings.theme; const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; if (S.view && VIEWS[S.view]) { for (const p of Players.set) p.draw(); } }

let chT = null; const pending = new Set();
D.on('changed', (c) => {
  if (c.kind === 'effect' || c.kind === 'feedback') Frames.drop(c.id);
  if (c.kind === 'sprite') editorReloadIfExternal(c.id);
  pending.add(c.kind);
  clearTimeout(chT); chT = setTimeout(async () => {
    const kinds = new Set(pending); pending.clear(); await loadProject();
    if (S.view === 'lab' && kinds.has('effect') && !Lab.dirty) { if (Lab.id && effectById(Lab.id)?.current !== Lab.version) loadLabCode(); else drawLabNotes(); return; }
    if (S.view === 'lab' || S.view === 'editor' || $('#sheetHost').firstChild) return;
    if (S.view === 'animate') { if (kinds.has('clip')) drawClips(); return; }
    if (['drafts', 'effects', 'sprites', 'refs', 'tiles', 'characters'].includes(S.view)) render();
    if (S.view === 'character' && kinds.has('character') && !CHS.drag) { try { const fresh = await call('chars:get', CHS.c.id); if (fresh.updatedAt > (CHS.c.updatedAt || 0) + 500) { CHS.c = fresh; drawCE(); } } catch {} }
    if (S.view === 'scene' && kinds.has('scene') && !TS.saveT) { const cur = TS.scene; try { const fresh = await call('scenes:get', cur.id); if (fresh.updatedAt > (cur.updatedAt || 0) + 800) { TS.scene = fresh; drawSceneLayers(); drawSceneProps(); paintScene(); } } catch {} }
  }, 250);
});
D.on('ai:activity', (a) => { S.activity.unshift({ ...a, by: S.bridge.client }); S.activity = S.activity.slice(0, 20); renderAiCard(); toast(a.msg, `From ${byWho(S.bridge.client || 'Claude')}`, 'info', 3500); if (a.ref && a.ref.board) S.boardId = a.ref.board; });
D.on('bridge:status', (b) => { S.bridge = b; $('#aiDot').classList.toggle('on', !!b.connected); renderAiCard(); });
D.on('project:switched', async () => { Frames.clear(); await loadProject(); if (!['lab', 'editor'].includes(S.view)) render(); else go('drafts'); });
D.on('nav', (v) => { if (v === 'new-sprite') { go('sprites'); newSprite(); } else if (v === 'new-effect') { go('effects'); newEffectMenu(); } else if (v === 'new-project') newProject(); else if (v === 'pixelize') go('make'); else if (v === 'animate') go('animate'); else if (v === 'tiles') go('tiles'); else if (v === 'characters') go('characters'); else go(v); });
setInterval(renderAiCard, 60e3);

$$('#nav button').forEach((b) => b.onclick = () => go(b.dataset.view));
$('#projBtn').onclick = (e) => projectMenu(e.currentTarget);

(async () => {
  try {
    [S.info, S.settings] = await Promise.all([call('app:info'), call('settings:get')]);
    document.documentElement.classList.toggle('win', D.platform === 'win32'); document.documentElement.classList.toggle('mac', D.platform === 'darwin');
    applyThemeNow(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeNow);
    await loadProject();
    call('connectors:status').then((c) => { S.bridge = c.bridge; $('#aiDot').classList.toggle('on', !!c.bridge.connected); renderAiCard(); }).catch(() => {});
    call('ai:status').then((a) => { S.ai = a; }).catch(() => {});
    renderAiCard(); hydrateIcons();
    const start = new URLSearchParams(location.search).get('view');
    go(start || ((S.project.boards || []).length || !S.effects.length ? 'drafts' : 'effects'));
    document.body.classList.add('ready');
  } catch (e) { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:30px;white-space:pre-wrap">${esc(e.stack || e)}</pre>`; }
})();

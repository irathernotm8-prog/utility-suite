// Atrium — start-up: load state, wire the top bar, keyboard shortcuts, events from the main process.
'use strict';
function applyAppTheme() { const t = S.settings.theme; const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }
(async function boot() {
  S.info = await call('app:info'); S.settings = await call('settings:get'); S.lib = await call('library:all');
  document.documentElement.classList.add(S.info.platform === 'darwin' ? 'mac' : S.info.platform === 'win32' ? 'win' : 'linux');
  applyAppTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppTheme);
  hydrateIcons();
  await loadSite(); S.device = S.settings.device || 'desktop'; S.panel = S.settings.editorPanel || 'layers';
  updateTop(); setDevice(S.device); $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  $$('#rail button').forEach((b) => { b.classList.toggle('on', b.dataset.panel === S.panel); b.onclick = () => { setPanel(b.dataset.panel); call('settings:set', { editorPanel: S.panel }).catch(() => {}); }; });
  $$('[data-rtab]').forEach((b) => b.onclick = () => setRtab(b.dataset.rtab));
  setRtab('inspect'); renderLeft(); await loadFrame();

  // top bar
  $('#homeBtn').onclick = () => showView(S.view === 'home' ? 'builder' : 'home');
  $('#siteBtn').onclick = (e) => siteMenu(e.currentTarget);
  $('#pageBtn').onclick = (e) => pageMenu(e.currentTarget);
  $$('#deviceSeg button').forEach((b) => b.onclick = () => setDevice(b.dataset.device));
  $$('#modeSeg button').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $('#undoBtn').onclick = () => attempt(async () => { const l = await call('site:undo'); if (l) { toast('Undone', l, 'ok', 2200); await refreshSite(); } });
  $('#redoBtn').onclick = () => attempt(async () => { const l = await call('site:redo'); if (l) { toast('Redone', l, 'ok', 2200); await refreshSite(); } });
  $('#historyBtn').onclick = () => historySheet();
  $('#auditBtn').onclick = () => auditSheet();
  $('#phoneBtn').onclick = () => phoneSheet();
  $('#openBtn').onclick = () => call('preview:open', S.page);
  $('#exportBtn').onclick = () => exportSheet();
  $('#publishBtn').onclick = () => publishSheet();
  $('#settingsBtn').onclick = () => showView(S.view === 'prefs' ? 'builder' : 'prefs');
  $('#aiBusyStop').onclick = () => call('chat:stop');
  addEventListener('resize', () => layoutFrame());
  new ResizeObserver(() => layoutFrame()).observe($('#canvas'));

  // drop images anywhere → assets
  let dragN = 0;
  addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragN++; document.body.classList.add('drop-files'); } });
  addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) document.body.classList.remove('drop-files'); });
  addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  addEventListener('drop', async (e) => { dragN = 0; document.body.classList.remove('drop-files'); const files = [...e.dataTransfer.files].map((f) => A.pathFor(f)).filter(Boolean); if (!files.length) return; e.preventDefault(); const r = await attempt(() => call('assets:add', files)); if (r) { toast(`Added ${plural(r.length, 'file')}`, r.join(', ')); if (S.panel === 'assets') renderLeft(); } });

  // keyboard
  addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (e.key === 'Escape') closeMenus();
    if (!mod || typing) return;
    if (e.key === 'k') { e.preventDefault(); setRtab('ai'); setTimeout(() => $('#chatText') && $('#chatText').focus(), 30); }
  });

  // events from the main process
  A.on('nav', (v) => {
    if (v === 'settings') showView('prefs'); else if (v === 'home') showView('home'); else if (v === 'new-site') newSiteSheet(); else if (v === 'new-page') newPageSheet();
    else if (v === 'import') importSheet(); else if (v === 'export') exportSheet(); else if (v === 'publish') publishSheet(); else if (v === 'audit') auditSheet();
    else if (v === 'undo') $('#undoBtn').click(); else if (v === 'redo') $('#redoBtn').click(); else if (v === 'toggle-mode') setMode(S.mode === 'edit' ? 'view' : 'edit');
    else if (v === 'ai') { setRtab('ai'); setTimeout(() => $('#chatText') && $('#chatText').focus(), 30); }
    else if (v.startsWith('device:')) setDevice(v.slice(7));
  });
  A.on('site:changed', (e) => { refreshSoon(); if (e.by && e.by !== 'you' && e.section) S.pendingScroll = null; });
  A.on('site:switched', async () => { S.page = 'index'; S.sel = null; await loadSite(); updateTop(); await loadFrame(); renderLeft(); renderRight(); if (S.rtab === 'ai') { $('#rightBody').innerHTML = ''; renderRight(); } if (S.view === 'home') renderHome(); });
  A.on('chat:event', (e) => { if (e.kind === 'done' || e.kind === 'error') { addChat(e); return; } if (!S.aiBusy) setBusy(true); addChat(e); });
  A.on('ai:activity', (a) => { if (S.aiBusy) $('#aiBusyText').textContent = a.msg; else toast(a.msg, 'From your AI', 'info', 3000); if (a.ref && a.ref.page) { /* AI added a page */ refreshSoon(); } });
  A.on('bridge:status', (b) => { S.bridge = b; });
  A.on('thumbs:changed', () => { if (S.view === 'home') renderHome(); });
  document.body.classList.add('ready');
})().catch((e) => { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:30px;color:#f66">${esc(e.stack || e.message)}</pre>`; });

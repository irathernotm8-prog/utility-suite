/* Slate — app shell: navigation, boot, drag & drop, settings */
(() => {
  const { S, $, $$, esc, save, toast, modal, opts } = Slate;
  const NAV = [
    ['overview', 'Overview', 'overview'], ['accounts', 'Accounts', 'bank'], ['cards', 'Cards', 'card'], ['calendar', 'Calendar', 'calendar'],
    ['planner', 'Planner', 'target'], ['credit', 'Credit score', 'gauge'], '-', ['statements', 'Statements', 'inbox'], ['browser', 'Browser', 'globe'], ['report', 'Monthly report', 'report']
  ];
  let current = null;

  function renderNav() {
    const inbox = S.statements.filter(s => s.status === 'inbox').length;
    $('#nav').innerHTML = NAV.map(n => n === '-' ? '<div class="sep"></div>' : `<button data-v="${n[0]}" class="${current === n[0] ? 'on' : ''}" ${current === n[0] ? 'aria-current="page"' : ''}>${ic(n[2], 17)}<span>${n[1]}</span>${n[0] === 'statements' && inbox ? `<span class="badge" title="${inbox} in your inbox">${inbox}</span>` : ''}</button>`).join('');
    $$('#nav [data-v]').forEach(b => b.onclick = () => go(b.dataset.v));
  }

  function go(view, arg) {
    if (!Slate.views[view]) return;
    const prev = current;
    if (prev && prev !== view) Slate.views[prev].leave?.();
    current = view;
    S.store.ui.view = view;
    slate.save({ ui: { view } });
    renderNav();
    const el = $('#view');
    const v = Slate.views[view];
    el.className = 'view' + (v.flush ? ' flush' : '');
    $('#topbar').hidden = !!v.flush;
    if (!v.keep || prev !== view || !el.dataset.v || el.dataset.v !== view) { el.innerHTML = ''; el.scrollTop = 0; }
    el.dataset.v = view;
    v.render(el, arg);
  }
  const refresh = () => { if (current) Slate.views[current].render($('#view')); renderNav(); };

  function applyTheme() {
    const t = S.store.settings.theme;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  async function openSettings() {
    const st = S.store.settings;
    const folder = await slate.statements.folder();
    modal({
      title: 'Settings',
      body: `
        <div class="grid2">
          <div class="field"><label>Your name</label><input class="input" id="stName" value="${esc(st.name)}" placeholder="Shown on reports"></div>
          <div class="field"><label>Look</label><select class="input" id="stTheme">${opts([['dark', 'Slate (dark)'], ['light', 'Paper (light)'], ['system', 'Match my Mac']], st.theme)}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Monthly savings goal</label><input class="input money" id="stGoal" value="${st.monthlyGoal || ''}" placeholder="$0"><span class="hint">Optional. Shows on the planner next to what you planned.</span></div>
          <div class="field"><label>Renewal reminder</label><select class="input" id="stLead">${opts([[30, '30 days before a fee'], [45, '45 days before a fee'], [60, '60 days before a fee']], st.renewalLeadDays)}</select></div>
        </div>
        <div class="field"><label>Statements folder</label>
          <div class="row"><input class="input" id="stFolder" value="${esc(folder)}" readonly><button class="btn" id="stChoose">Change…</button><button class="btn ghost" id="stOpen">Open</button></div>
          <span class="hint">Downloads from Slate’s browser land in the Inbox folder here. Filed statements are sorted by institution and year.</span></div>
        <label class="check" style="margin-bottom:6px"><input type="checkbox" id="stWatch" ${st.watchDownloads ? 'checked' : ''}> Also pick up statements I download in other browsers</label>
        <div class="hint muted small" style="margin:0 0 16px 25px">Copies new PDF, CSV and OFX files from your Downloads folder into the inbox. The originals stay where they are.</div>
        <div class="field" style="margin-top:16px"><label>Bank connections</label>
          <div class="row"><span class="small muted" style="flex:1">${Slate.views.connections.state().connected ? `Connected through SimpleFIN · ${Slate.views.connections.state().accounts.length} account${Slate.views.connections.state().accounts.length === 1 ? '' : 's'} · updated ${Slate.views.connections.ago(Slate.views.connections.state().lastSync)}` : 'Off. Optional: update balances automatically through SimpleFIN Bridge'}</span><button class="btn" id="stBank">${Slate.views.connections.state().connected ? 'Connection…' : 'Set up…'}</button></div></div>
        <hr class="rule">
        <div class="row wrap"><button class="btn" id="stExport">${ic('download', 15)} Back up data…</button><button class="btn" id="stImport">${ic('upload', 15)} Restore a backup…</button><button class="btn ghost danger" id="stClear">Sign out of all sites in the browser</button></div>
        <div class="row" style="margin-top:12px"><span class="small muted" style="flex:1">${Object.keys(S.overrides).length ? `${Object.keys(S.overrides).length} card${Object.keys(S.overrides).length === 1 ? '' : 's'} use an image you picked instead of Slate’s` : 'All cards use Slate’s built-in images'}</span>${Object.keys(S.overrides).length ? '<button class="btn" id="stResetImg">Reset card images</button>' : ''}</div>
        <p class="muted small" style="margin:12px 0 0">Everything stays on this computer. Slate has no account, no analytics and no servers of its own; it only goes online when you open a site in its browser or turn on a bank connection. It never sees your bank passwords.</p>`,
      actions: [{ label: 'Done', cls: 'primary', onClick: (m) => {
        st.name = $('#stName', m).value.trim();
        st.theme = $('#stTheme', m).value;
        st.monthlyGoal = Slate.num($('#stGoal', m).value) || 0;
        st.renewalLeadDays = Number($('#stLead', m).value);
        slate.save({ settings: st });
        applyTheme(); refresh();
      } }],
      onMount: (m) => {
        $('#stChoose', m).onclick = async () => { const f = await slate.statements.chooseFolder(); if (f) $('#stFolder', m).value = f; };
        $('#stOpen', m).onclick = () => slate.statements.openFolder();
        $('#stWatch', m).onchange = async (e) => { st.watchDownloads = await slate.statements.watchDownloads(e.target.checked); };
        $('#stBank', m).onclick = () => { setTimeout(() => Slate.views.connections.setup(), 10); document.getElementById('modalRoot').classList.remove('on'); };
        $('#stExport', m).onclick = async () => { const p = await slate.exportData(); if (p) toast('Backup saved'); };
        $('#stImport', m).onclick = async () => { try { await slate.importData(); } catch (e) { toast(e.message, 'error'); } };
        $('#stResetImg', m)?.addEventListener('click', async () => { const n = await slate.cardImage.resetAll(); S.overrides = {}; toast(`${n} card image${n === 1 ? '' : 's'} reset to Slate’s`); refresh(); });
        $('#stClear', m).onclick = async () => { await slate.browser.clear(); toast('Signed out of all sites in Slate’s browser'); };
      }
    });
  }

  /* ---------- drag & drop statements anywhere ---------- */
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e) || e.target.closest?.('[data-own-drop]')) return; dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    dragDepth = 0; document.body.classList.remove('dragging');
    if (!hasFiles(e) || e.target.closest?.('[data-own-drop]')) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map(f => slate.pathForFile(f)).filter(Boolean);
    const n = await slate.statements.importPaths(paths);
    if (n) { toast(`Added ${n} file${n > 1 ? 's' : ''} to your statement inbox`); if (current !== 'statements') go('statements'); }
    else toast('Slate takes PDF, CSV, OFX/QFX and Excel statements', 'error');
  });

  async function boot() {
    document.body.classList.toggle('win', slate.platform !== 'darwin');
    $('#app').classList.toggle('win', slate.platform !== 'darwin');
    $('#settingsBtn').innerHTML = `${ic('settings', 17)}<span>Settings</span>`;
    const [store, cat, overrides, list, paths] = await Promise.all([slate.load(), slate.catalog(), slate.cardImage.overrides(), slate.statements.list(), slate.paths()]);
    await Slate.views.connections.load().catch(() => {});
    S.store = store; S.catalog = cat.cards; S.catalogMeta = cat; S.overrides = overrides; S.statements = list; S.paths = paths;
    applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    $('#settingsBtn').onclick = openSettings;
    slate.on.toast(({ msg, kind }) => toast(msg, kind));
    slate.on.statements((l) => { S.statements = l; renderNav(); if (current === 'statements' || current === 'overview') Slate.views[current].render($('#view')); });
    slate.on.accounts((a) => { S.store.accounts = a; if (['accounts', 'overview', 'planner', 'statements'].includes(current)) refresh(); });
    slate.on.wallet((w) => { S.store.wallet = w; if (['cards', 'overview', 'calendar'].includes(current)) refresh(); });
    slate.on.cardCandidate((c) => Slate.views.cards.useCandidate(c));
    slate.on.openTab(({ url }) => { if (current !== 'browser') go('browser'); Slate.views.browser.openTab(url); });
    slate.on.nav((cmd) => {
      if (Slate.views[cmd]) return go(cmd);
      if (cmd === 'settings') return openSettings();
      if (cmd === 'add-statements') return slate.statements.pick().then(n => { if (n) { toast(`Added ${n} file${n > 1 ? 's' : ''} to your inbox`); go('statements'); } });
      if (cmd === 'export') return slate.exportData().then(p => p && toast('Backup saved'));
      if (cmd === 'new-tab') { go('browser'); return Slate.views.browser.openTab(''); }
      if (current === 'browser') return Slate.views.browser.command(cmd);
    });
    go(Slate.views[store.ui.view] ? store.ui.view : 'overview');
  }

  Slate.go = go;
  Slate.refresh = refresh;
  Slate.renderNav = renderNav;
  boot();
})();

'use strict';
/* global hub */
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = (n) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

  let S = null;            // last state from the main process
  let tab = 'apps';
  let progress = null;     // live progress of the running operation
  let openNotes = new Set();
  let oldCopies = null;    // results of "Find old copies"
  let welcomeDismissed = false;

  const isMac = () => S?.hub.platform === 'darwin';
  const isWin = () => S?.hub.platform === 'win32';
  const finder = () => (isMac() ? 'Finder' : 'File Explorer');

  // ───────── data ─────────
  let refreshing = null;
  async function load() {
    if (refreshing) return refreshing;
    refreshing = hub.state().then((s) => { S = s; progress = s.busy; render(); }).finally(() => { refreshing = null; });
    return refreshing;
  }
  hub.on('changed', () => load());
  hub.on('progress', (p) => { progress = p; renderProgressOnly(); });
  hub.on('toast', ({ text, kind }) => toast(text, kind));
  hub.on('menu', (m) => { if (m === 'add-packages') addPackages(); });

  const rowsBy = (fn) => (S?.rows || []).filter(fn);
  const installed = () => rowsBy((r) => r.installedVersion || r.path);
  const updates = () => rowsBy((r) => r.status === 'update');
  const available = () => rowsBy((r) => !r.path && r.status === 'available');
  const isBusy = (id) => progress && progress.id === id;
  const isQueued = (id) => (S?.queued || []).some((q) => q.id === id);

  // ───────── rendering ─────────
  function iconHTML(r, cls = '') {
    return r.icon ? `<img class="${cls}" src="${esc(r.icon)}" alt="" data-letter="${esc((r.name || '?')[0])}">` : `<div class="letter ${cls}" aria-hidden="true">${esc((r.name || '?')[0])}</div>`;
  }

  function render() {
    if (!S) return;
    document.documentElement.classList.toggle('mac', isMac());
    renderDock();
    renderBanners();
    renderTabs();
    if (tab === 'apps') renderApps();
    else if (tab === 'updates') renderUpdates();
    else renderSettings();
    maybeWelcome();
  }

  function renderDock() {
    const dock = $('#dock');
    if (!S.rows.length) { dock.innerHTML = '<div class="dock-empty">Your apps appear here once you add a Utility Suite download.</div>'; return; }
    dock.innerHTML = S.rows.map((r) => {
      const on = !!r.path;
      const tag = r.status === 'update' ? `<span class="peg-tag num">${esc(r.availableVersion)}</span>` : '';
      const label = `${r.name}: ${on ? `installed${r.installedVersion ? ' ' + r.installedVersion : ''}` : 'not installed'}${r.status === 'update' ? `, update ${r.availableVersion} available` : ''}`;
      return `<button class="peg ${on ? 'on' : 'off'} ${isBusy(r.id) ? 'busy' : ''}" data-action="jump" data-id="${esc(r.id)}" title="${esc(label)}" aria-label="${esc(label)}">
        <span class="peg-icon">${iconHTML(r)}${tag}</span><span class="peg-name">${esc(r.name)}</span></button>`;
    }).join('');
  }

  function renderBanners() {
    const out = [];
    if (S.hub.update) {
      out.push(`<div class="banner"><div class="banner-text"><div class="banner-title">Utility Hub ${esc(S.hub.update.version)} is ready</div>
        <div class="banner-sub">The hub closes, updates itself and reopens in a few seconds.</div></div>
        <div class="banner-actions"><button class="btn signal" data-action="update-hub">Update and reopen</button></div></div>`);
    }
    for (const src of S.sources) {
      if (src.fromBundle && !S.hub.installed) continue; // the welcome screen covers these
      if (src.unopened) {
        out.push(`<div class="banner"><div class="banner-text"><div class="banner-title">Utility Suite ${esc(src.suiteVersion)} is in ${esc(src.where)}</div>
          <div class="banner-sub">${esc(baseName(src.path))}</div></div>
          <div class="banner-actions"><button class="btn quiet" data-action="dismiss" data-stamp="${esc(src.stamp)}">Not now</button>
          <button class="btn signal" data-action="import" data-path="${esc(src.path)}">Add its packages</button></div></div>`);
      } else if (src.news.length) {
        const list = src.news.map((n) => `${n.name} ${n.version}${n.current ? ` (you have ${n.current})` : ''}`).join(', ');
        out.push(`<div class="banner"><div class="banner-text"><div class="banner-title">New packages in ${esc(src.where)}</div>
          <div class="banner-sub">${esc(list)}</div></div>
          <div class="banner-actions"><button class="btn quiet" data-action="dismiss" data-stamp="${esc(src.stamp)}">Not now</button>
          <button class="btn signal" data-action="import" data-path="${esc(src.path)}">Add packages</button></div></div>`);
      }
    }
    $('#banners').innerHTML = out.join('');
  }

  function renderTabs() {
    const u = updates().length;
    const tabs = [
      ['apps', 'Apps', `<span class="count num">${S.rows.length}</span>`],
      ['updates', 'Updates', u ? `<span class="count hot num">${u}</span>` : ''],
      ['settings', 'Settings', ''],
    ];
    $('#tabs').innerHTML = tabs.map(([k, label, extra]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-action="tab" data-tab="${k}">${label}${extra}</button>`).join('');
  }

  function versionCell(r) {
    if (r.status === 'update') return `<span class="num"><strong>${esc(r.installedVersion)}</strong><span class="arrow">to</span><span class="new">${esc(r.availableVersion)}</span></span>`;
    if (r.path) return `<span class="num"><span class="dot" aria-hidden="true"></span> ${r.installedVersion ? `<strong>${esc(r.installedVersion)}</strong>` : 'Installed'}</span>`;
    if (r.status === 'missing') return 'Package removed';
    return `<span class="num">${esc(r.availableVersion)}${r.size ? ` <span class="pick-desc">(${fmtSize(r.size)})</span>` : ''}</span>`;
  }

  function actionsCell(r) {
    if (isBusy(r.id)) return progressHTML();
    if (isQueued(r.id)) return '<span class="progress-step">Waiting…</span>';
    const busyHub = S.busy && S.busy.id === 'hub';
    const more = `<button class="btn quiet" data-action="more" data-id="${esc(r.id)}" aria-label="More for ${esc(r.name)}" ${busyHub ? 'disabled' : ''}>•••</button>`;
    if (r.status === 'update') return `<button class="btn signal" data-action="install" data-id="${esc(r.id)}">Update</button>${more}`;
    if (r.path) return `<button class="btn ghost" data-action="open" data-id="${esc(r.id)}">Open</button>${more}`;
    if (r.status === 'missing') return more;
    return `<button class="btn" data-action="install" data-id="${esc(r.id)}">Install</button>${more}`;
  }

  function progressHTML() {
    const f = progress?.fraction;
    return `<div class="progress" role="status"><div class="progress-step">${esc(progress?.step || progress?.label || 'Working')}</div>
      <div class="bar ${f == null ? 'indet' : ''}"><i style="${f == null ? '' : `width:${Math.round(f * 100)}%`}"></i></div></div>`;
  }

  function rowHTML(r) {
    const notesOpen = openNotes.has(r.id) && r.notes?.length;
    const sep = r.separate?.length ? `<div class="warn-line">Also installed separately (${esc(r.separate.map((s) => s.version || s.name).join(', '))}). ${r.path ? 'Updating' : 'Installing'} removes that copy.</div>` : '';
    const newer = r.status === 'newer' ? `<div class="warn-line">This computer has a newer version than the hub's package (${esc(r.availableVersion)}).</div>` : '';
    return `<div class="row" id="row-${esc(r.id)}" data-id="${esc(r.id)}">
      ${iconHTML(r)}
      <div class="row-main"><div class="row-name">${esc(r.name)}${r.running ? '<span class="pill">Running</span>' : ''}</div><div class="row-desc">${esc(r.description)}</div></div>
      <div class="row-meta">${versionCell(r)}</div>
      <div class="row-actions">${actionsCell(r)}</div>
      ${notesOpen ? `<div class="notes"><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
      ${sep}${newer}
    </div>`;
  }

  function groupHTML(title, rows, action = '') {
    if (!rows.length) return '';
    return `<section class="group"><div class="group-head"><h2>${title}</h2>${action}</div><div class="list">${rows.map(rowHTML).join('')}</div></section>`;
  }

  function emptyHTML() {
    return `<div class="empty"><h2>Add your apps</h2>
      ${S.online?.enabled
        ? `<p>${S.online.error ? 'The update server can\'t be reached right now. Check your connection, or add' : 'Nothing has been published yet. You can also add'} a Utility Suite download from this computer (the .${isWin() ? 'zip' : 'dmg'} file, or the folder it opens to), or drop it onto this window.</p>
           <button class="btn" data-action="refresh">Check for updates</button> <button class="btn ghost" data-action="add-packages">Add packages…</button>`
        : `<p>Bring a Utility Suite download over to this computer (the .${isWin() ? 'zip' : 'dmg'} file, or the folder it opens to), then add it here. You can also drop it onto this window.</p>
           <button class="btn" data-action="add-packages">Add packages…</button>`}</div>`;
  }

  function renderApps() {
    if (!S.rows.length) { $('#view').innerHTML = emptyHTML(); return; }
    const inst = installed();
    const avail = available();
    const missing = rowsBy((r) => !r.path && r.status === 'missing');
    const installAll = avail.length > 1 ? `<button class="btn ghost" data-action="install-all">Install all ${avail.length}</button>` : '';
    const updateAll = updates().length > 1 ? `<button class="btn signal" data-action="update-all">Update all ${updates().length}</button>` : '';
    $('#view').innerHTML =
      groupHTML('On this computer', inst, updateAll) +
      groupHTML('Ready to install', avail, installAll) +
      groupHTML('Removed from the hub', missing);
  }

  function renderUpdates() {
    const u = updates();
    if (!u.length) {
      const last = S.rows.length ? 'Every installed app is on the newest version the hub has.' : 'No apps yet.';
      $('#view').innerHTML = `<div class="empty"><h2>No updates</h2><p>${last} New versions show up here after you add a newer Utility Suite download.</p>
        <button class="btn ghost" data-action="refresh">Check for packages</button></div>`;
      return;
    }
    u.forEach((r) => { if (r.notes?.length) openNotes.add(r.id); });
    $('#view').innerHTML = groupHTML(`${u.length} update${u.length === 1 ? '' : 's'} ready`, u, u.length > 1 ? '<button class="btn signal" data-action="update-all">Update all</button>' : '');
  }

  function checkbox(key, title, sub, checked) {
    return `<label class="setting"><input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''}>
      <span class="setting-text"><span class="setting-title">${title}</span><br><span class="setting-sub">${sub}</span></span></label>`;
  }

  function renderSettings() {
    const s = S.settings;
    const folders = (s.watchFolders || []).map((f) => `<div class="setting"><span class="setting-text"><span class="setting-title">${esc(baseName(f))}</span><br><span class="setting-sub">${esc(f)}</span></span>
      <button class="btn quiet" data-action="unwatch" data-path="${esc(f)}">Stop watching</button></div>`).join('');
    const copies = oldCopies === null ? '' : oldCopies.length === 0
      ? '<p class="copies">No old copies found.</p>'
      : `<div class="list copies">${oldCopies.map((c, i) => `<label class="setting"><input type="checkbox" data-copy="${i}" checked>
          <span class="setting-text"><span class="setting-title">${esc(c.name)}</span> <span class="pill">${esc(c.kind)}</span><br><span class="setting-sub">${esc(c.path || '')}</span></span></label>`).join('')}
          <div class="setting"><span class="setting-text setting-sub">${isWin() ? 'Separately installed versions are uninstalled; files go to the Recycle Bin.' : 'Copies go to the Trash.'} App settings and data are kept.</span>
          <button class="btn danger" data-action="remove-copies">Remove selected</button></div></div>`;

    $('#view').innerHTML = `<div class="settings">
      <section class="section"><h2>Updates from the internet</h2>
        ${S.online?.configured ? `<p>New versions are published to <b>${esc(S.online.label)}</b>. The hub checks when it opens and every 15 minutes, and downloads only the apps you update.</p>
        <div class="list">
          ${checkbox('onlineUpdates', 'Check for updates automatically', S.online.lastChecked ? `Last checked ${new Date(S.online.lastChecked).toLocaleString()}${S.online.error ? ` (${S.online.error === 'offline' ? 'offline' : 'failed: ' + esc(S.online.error)})` : ''}.` : 'Not checked yet.', s.onlineUpdates !== false)}
          <div class="setting"><span class="setting-text"><span class="setting-title">Check now</span><br><span class="setting-sub">Also looks in Downloads, connected disks and watched folders.</span></span>
            <button class="btn ghost" data-action="refresh">Check for updates</button></div>
        </div>` : '<p>This copy of the hub isn\'t connected to an update server. Updates come from downloads you add (below).</p>'}
      </section>

      <section class="section"><h2>Where new packages come from</h2>
        <p>The hub looks in these places when it opens and every couple of minutes, and tells you when a newer Utility Suite turns up.${isMac() ? ' Connected disks are checked too.' : ''}</p>
        <div class="list">
          ${checkbox('scanDownloads', 'Downloads and Desktop', 'Spot a suite download as soon as it lands.', s.scanDownloads !== false)}
          ${folders}
          <div class="setting"><span class="setting-text"><span class="setting-title">Watch another folder</span><br><span class="setting-sub">For example a Google Drive, OneDrive or Dropbox folder you drop new suites into, so every computer picks them up.</span></span>
            <button class="btn ghost" data-action="watch">Add folder…</button></div>
        </div></section>

      <section class="section"><h2>Installing</h2><div class="list">
        ${isWin() ? checkbox('desktopShortcuts', 'Desktop shortcuts', 'Put a shortcut on the desktop for each app. Start Menu shortcuts are always made.', s.desktopShortcuts !== false) : ''}
        ${isWin() ? checkbox('removeSeparateInstalls', 'Replace separately installed versions', 'If an app was installed with its own Setup file, uninstall that copy when the hub installs or updates it.', s.removeSeparateInstalls !== false) : ''}
        ${checkbox('keepPackages', 'Keep packages after installing', `Lets you reinstall without the download. Uses ${fmtSize(S.library.bytes) || 'no'} space right now.`, s.keepPackages !== false)}
        <div class="setting"><span class="setting-text"><span class="setting-title">Package storage</span><br><span class="setting-sub">${S.library.count} package${S.library.count === 1 ? '' : 's'}, ${fmtSize(S.library.bytes) || '0 MB'}</span></span>
          <button class="btn ghost" data-action="show-library">Show in ${finder()}</button></div>
      </div></section>

      <section class="section"><h2>Old copies</h2>
        <p>Find versions of these apps that weren't installed by the hub${isWin() ? ': separate installs, portable copies, unzipped folders and old setup files' : ', such as copies outside Applications'}.</p>
        <button class="btn ghost" data-action="find-copies">Find old copies</button>
        ${copies}
      </section>

      <section class="section"><h2>Utility Hub</h2><div class="list">
        <div class="setting"><span class="setting-text"><span class="setting-title">Version <span class="num">${esc(S.hub.version)}</span></span><br>
          <span class="setting-sub">${S.hub.installed ? 'Installed on this computer.' : S.hub.dev ? 'Running from the project folder.' : 'Running from the download, not installed yet.'}</span></span>
          ${S.hub.canManageSelf && !S.hub.installed ? '<button class="btn" data-action="welcome">Install Utility Hub</button>' : ''}</div>
        ${S.hub.installed && S.hub.canManageSelf ? `<div class="setting"><span class="setting-text"><span class="setting-title">Remove Utility Hub</span><br><span class="setting-sub">You can keep the apps it installed or remove them too.</span></span>
          <button class="btn danger" data-action="remove-hub">Remove…</button></div>` : ''}
      </div></section>
    </div>`;
  }

  function renderProgressOnly() {
    if (!S) return;
    if (progress && progress.id && document.getElementById(`row-${progress.id}`)) {
      const cell = $(`#row-${CSS.escape(progress.id)} .row-actions`);
      if (cell) cell.innerHTML = progressHTML();
    }
    const w = $('#welcome-progress');
    if (w && progress) w.innerHTML = progressHTML();
    if (progress?.id === 'import' || progress?.id === 'cleanup') {
      let el = $('#global-progress');
      if (!el) { el = document.createElement('div'); el.id = 'global-progress'; el.className = 'banner'; $('#banners').prepend(el); }
      el.innerHTML = `<div class="banner-text"><div class="banner-title">${esc(progress.label)}</div></div>${progressHTML()}`;
    }
  }

  // ───────── welcome (running from the download) ─────────
  function maybeWelcome() {
    if (!S.hub.welcome || welcomeDismissed || $('#welcome')) return;
    const src = S.sources.find((s) => s.apps?.length);
    const choices = src
      ? src.apps.map((a) => ({ id: a.id, name: a.name, description: a.description, version: a.version, ok: a.action !== 'incompatible', reason: a.reason, icon: a.icon || S.rows.find((r) => r.id === a.id)?.icon }))
      : S.rows.filter((r) => r.availableVersion).map((r) => ({ id: r.id, name: r.name, description: r.description, version: r.availableVersion, ok: true, icon: r.icon }));
    const already = (id) => S.rows.find((r) => r.id === id && r.path);
    const picks = choices.map((c) => `<label class="pick ${c.ok ? '' : 'disabled'}">
        <input type="checkbox" data-pick="${esc(c.id)}" ${c.ok ? 'checked' : 'disabled'}>
        ${iconHTML(c)}
        <span><strong>${esc(c.name)}</strong><br><span class="pick-desc">${esc(c.ok ? c.description : c.reason)}</span></span>
        <span class="num pick-desc">${already(c.id) ? 'Replaces installed' : esc(c.version)}</span></label>`).join('');
    const where = isMac() ? 'Applications' : 'your user folder (no administrator needed), with Start Menu shortcuts';
    $('#modal-root').innerHTML = `<div class="scrim" id="welcome"><div class="modal welcome" role="dialog" aria-modal="true" aria-labelledby="wt">
      <h2 id="wt">Set up Utility Hub on this computer</h2>
      <p>The hub installs into ${where}. Pick the apps to install now; you can add or remove apps any time from the hub.</p>
      ${choices.length ? `<div>${picks}</div>` : '<p>No app packages came with this copy of the hub. You can add them after setup.</p>'}
      <p class="pick-desc">Existing settings, accounts and files for these apps are kept.</p>
      <div id="welcome-progress"></div>
      <div class="modal-actions"><button class="btn quiet" data-action="welcome-later">Not now</button>
        <button class="btn" data-action="welcome-install">Install ${choices.length ? 'hub and selected apps' : 'Utility Hub'}</button></div>
    </div></div>`;
  }

  // ───────── small UI pieces ─────────
  function toast(text, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), kind === 'error' ? 9000 : 4500);
  }

  function modal({ title, body, confirm, danger, check }) {
    return new Promise((resolve) => {
      $('#modal-root').innerHTML = `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
        <h2 id="mt">${esc(title)}</h2><p>${esc(body)}</p>
        ${check ? `<label class="check"><input type="checkbox" id="modal-check"> ${esc(check)}</label>` : ''}
        <div class="modal-actions"><button class="btn ghost" data-m="no">Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-m="yes">${esc(confirm)}</button></div></div></div>`;
      const root = $('#modal-root');
      const done = (v) => { const c = $('#modal-check')?.checked; root.innerHTML = ''; resolve(v ? { ok: true, checked: !!c } : null); };
      root.querySelector('[data-m="yes"]').focus();
      root.onclick = (e) => { const m = e.target.closest('[data-m]'); if (m) done(m.dataset.m === 'yes'); else if (e.target.classList.contains('scrim')) done(false); };
      root.onkeydown = (e) => { if (e.key === 'Escape') done(false); };
    });
  }

  function closeMenu() { document.querySelector('.menu')?.remove(); }
  function openMenu(anchor, r) {
    closeMenu();
    const items = [];
    if (r.path) items.push(['open', 'Open'], ['reveal', `Show in ${finder()}`]);
    if (r.notes?.length) items.push(['notes', openNotes.has(r.id) ? 'Hide what\'s new' : 'What\'s new']);
    if (r.path && r.availableVersion && r.status !== 'update') items.push(['install', r.status === 'newer' ? `Install hub version ${r.availableVersion}` : 'Reinstall']);
    if (r.availableVersion && S.settings.keepPackages !== false) items.push(['remove-package', 'Delete package from the hub']);
    if (r.path) items.push(['-'], ['uninstall', 'Uninstall…', 'danger']);
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = items.map(([a, label, cls]) => (a === '-' ? '<hr>' : `<button role="menuitem" class="${cls || ''}" data-action="${a}" data-id="${esc(r.id)}">${esc(label)}</button>`)).join('');
    document.body.append(m);
    const b = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(b.right - w, innerWidth - w - 8))}px`;
    m.style.top = `${b.bottom + h + 8 > innerHeight ? b.top - h - 4 : b.bottom + 4}px`;
    m.querySelector('button')?.focus();
  }

  const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop();
  const row = (id) => S.rows.find((r) => r.id === id);

  async function confirmClose(r, verb) {
    if (!r.running) return true;
    return !!(await modal({ title: `${r.name} is open`, body: `It will close so it can be ${verb}. Save any open work first.`, confirm: `Close and ${verb === 'updated' ? 'update' : verb === 'removed' ? 'remove' : 'install'}` }));
  }

  async function addPackages() {
    if (isWin()) {
      // Windows can't pick a file or folder in one dialog
      const r = await modal({ title: 'Add packages', body: 'Choose the Utility Suite .zip you brought over, or the folder it was unzipped to.', confirm: 'Choose the .zip…', check: 'I unzipped it already (choose a folder instead)' });
      if (r) await hub.pickPackages(r.checked ? 'folder' : 'file');
    } else await hub.pickPackages('any');
  }

  // ───────── events ─────────
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) { if (!e.target.closest('.menu')) closeMenu(); return; }
    const { action, id } = el.dataset;
    if (action !== 'more') closeMenu();
    const r = id ? row(id) : null;
    try {
      switch (action) {
        case 'tab': tab = el.dataset.tab; oldCopies = tab === 'settings' ? oldCopies : null; render(); $('#view').focus(); break;
        case 'jump': tab = 'apps'; render(); document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); break;
        case 'refresh': {
          el.disabled = true;
          await hub.refresh();
          await load();
          const n = updates().length;
          if (S.online?.enabled && S.online.error) toast(S.online.error === 'offline' ? 'You\'re offline, so only Downloads and connected disks were checked.' : `Couldn't check online: ${S.online.error}`, 'info');
          else toast(n ? `${n} update${n === 1 ? '' : 's'} ready.` : 'Everything is up to date.', 'info');
          break;
        }
        case 'add-packages': await addPackages(); break;
        case 'import': await hub.importPath(el.dataset.path); break;
        case 'dismiss': await hub.dismissSource(el.dataset.stamp); break;
        case 'install':
          if (r && (await confirmClose(r, r.path ? 'updated' : 'installed'))) await hub.install(id);
          break;
        case 'install-all': await hub.installMany(available().map((x) => x.id)); break;
        case 'update-all': {
          const list = updates();
          const open = list.filter((x) => x.running);
          if (open.length && !(await modal({ title: 'Some apps are open', body: `${open.map((x) => x.name).join(', ')} will close so they can be updated. Save any open work first.`, confirm: 'Close and update all' }))) break;
          await hub.installMany(list.map((x) => x.id));
          break;
        }
        case 'open': await hub.open(id); break;
        case 'reveal': await hub.reveal(id); break;
        case 'more': if (document.querySelector('.menu')) closeMenu(); else openMenu(el, r); break;
        case 'notes': openNotes.has(id) ? openNotes.delete(id) : openNotes.add(id); render(); break;
        case 'uninstall': {
          const ok = await modal({ title: `Uninstall ${r.name}?`, body: `${r.name} is removed from this computer. Its settings and files stay, so reinstalling later picks up where you left off.`, confirm: 'Uninstall', danger: true });
          if (ok && (await confirmClose(r, 'removed'))) await hub.uninstall(id);
          break;
        }
        case 'remove-package': {
          const ok = await modal({ title: `Delete the ${r.name} package?`, body: `Frees ${fmtSize(r.size) || 'some'} of space. ${r.path ? `${r.name} stays installed, but you'll need the download again to reinstall it.` : 'You\'ll need the download again to install it.'}`, confirm: 'Delete package', danger: true });
          if (ok) await hub.removePackage(id);
          break;
        }
        case 'update-hub': await hub.updateHub(); break;
        case 'welcome': welcomeDismissed = false; S.hub.welcome = true; maybeWelcome(); break;
        case 'welcome-later': welcomeDismissed = true; $('#modal-root').innerHTML = ''; break;
        case 'welcome-install': {
          const ids = [...document.querySelectorAll('[data-pick]')].filter((c) => c.checked).map((c) => c.dataset.pick);
          el.disabled = true;
          el.previousElementSibling.disabled = true;
          await hub.installHub(ids);
          break;
        }
        case 'watch': await hub.addWatchFolder(); break;
        case 'unwatch': await hub.removeWatchFolder(el.dataset.path); break;
        case 'show-library': await hub.showLibrary(); break;
        case 'find-copies': el.disabled = true; el.textContent = 'Looking…'; oldCopies = await hub.findOldCopies(); render(); break;
        case 'remove-copies': {
          const picked = [...document.querySelectorAll('[data-copy]')].filter((c) => c.checked).map((c) => oldCopies[+c.dataset.copy]);
          if (!picked.length) break;
          await hub.removeOldCopies(picked);
          oldCopies = await hub.findOldCopies();
          render();
          break;
        }
        case 'remove-hub': {
          const n = installed().length;
          const r2 = await modal({ title: 'Remove Utility Hub?', body: 'Apps you keep still work; you just won\'t be able to update them from the hub.', confirm: 'Remove Utility Hub', danger: true, check: n ? `Also uninstall the ${n} app${n === 1 ? '' : 's'} (their settings and files are kept)` : null });
          if (r2) await hub.removeHub(r2.checked);
          break;
        }
        default: break;
      }
    } catch (err) {
      toast(cleanError(err), 'error');
    } finally {
      if (action === 'refresh') el.disabled = false;
    }
  });

  document.addEventListener('change', async (e) => {
    const key = e.target.dataset?.setting;
    if (key) await hub.setSettings({ [key]: e.target.checked });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); addPackages(); }
  });

  // drag and drop a download onto the window
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop').hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    try { await hub.importPath(hub.pathForFile(f)); } catch (err) { toast(cleanError(err), 'error'); }
  });

  // an icon that can't load (offline, say) becomes the app's letter tile
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.letter) return;
    const tile = document.createElement('div');
    tile.className = `letter ${img.className}`;
    tile.setAttribute('aria-hidden', 'true');
    tile.textContent = img.dataset.letter;
    img.replaceWith(tile);
  }, true);

  const cleanError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  load();
})();

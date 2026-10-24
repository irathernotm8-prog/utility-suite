// Get apps, App library, Android versions and Settings.
'use strict';

const TILE_COLORS = ['#49e08a', '#63a8ff', '#ff8a5c', '#a78bfa', '#ff6f91', '#ffbf47', '#1fc6b4', '#9aa3b5'];
function tile(name, size = 46) {
  const s = String(name || '?');
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const col = TILE_COLORS[h % TILE_COLORS.length];
  return `<span class="ai" style="width:${size}px;height:${size}px;background:linear-gradient(140deg, ${col}, color-mix(in srgb, ${col} 55%, #000))">${esc(s.replace(/^(com|org|net|io|app|me|de)\./, '')[0].toUpperCase())}</span>`;
}
function targetId() {
  const t = S.init.settings.installTarget;
  if (t && S.devices.some((d) => d.id === t)) return t;
  const r = running()[0] || S.devices[0];
  return r ? r.id : null;
}
function targetSelect(id = 'appTarget') {
  if (!S.devices.length) return `<span class="small muted">No devices yet</span>`;
  const cur = targetId();
  const list = [...S.devices].sort((a, b) => (S.states[b.id] === 'running') - (S.states[a.id] === 'running'));
  return `<span class="target"><span class="small muted">Install to</span><select class="select" id="${id}">${list.map((d) => `<option value="${d.id}" ${d.id === cur ? 'selected' : ''}>${S.states[d.id] === 'running' ? '● ' : ''}${esc(d.name)}</option>`).join('')}</select></span>`;
}
function renderTargets() {
  const sel = $('#appTarget'); if (!sel) return;
  const wrap = sel.closest('.target'); if (!wrap) return;
  wrap.outerHTML = targetSelect();
  bindTarget();
}
function bindTarget() {
  const sel = $('#appTarget'); if (!sel) return;
  sel.onchange = () => { S.init.settings.installTarget = sel.value; call('settings:set', { installTarget: sel.value }); if (S.view === 'apps' && !S.browser) renderAppsBody(); };
}
const targetDev = () => S.devices.find((d) => d.id === targetId());

// ───────────────────────── Get apps
function renderApps() {
  head('Get apps', '', targetSelect());
  bindTarget();
  if (S.browser) return renderBrowser();
  renderAppsBody();
}
function renderAppsBody() {
  const v = $('#view');
  const t = targetDev();
  const play = t && t.image.tag === 'google_apis_playstore';
  v.innerHTML = `
    <div class="search-hero" style="margin-bottom:6px">${icon('search', 19)}<input id="appQ" placeholder="Search free apps on F-Droid" value="${esc(S.query)}"><button class="btn sm primary" data-a="search">Search</button></div>
    <div class="hint" style="margin:0 2px 18px">F-Droid apps are open source and signed by F-Droid. For Play Store apps, use the options below.</div>
    <div id="appResults">${resultsHtml()}</div>
    ${S.results ? '' : `
    <div class="feature">
      <div class="feature-card play">
        <h3>${icon('store', 18)}Play Store apps</h3>
        ${play ? `<p><b>${esc(t.name)}</b> has Google Play. Open the Play Store on it, sign in once with a Google account, and install anything you would on a phone.</p><div class="row"><button class="btn primary" data-a="openPlay">${icon('external', 15)}Open Play Store on ${esc(t.name)}</button></div>`
          : `<p>${t ? `<b>${esc(t.name)}</b> doesn't include Google Play.` : 'Pick a device above.'} Aurora Store downloads Play Store apps anonymously, no Google account needed. Or make a device with a <b>Google Play</b> Android version.</p><div class="row"><button class="btn primary" data-a="fdroid" data-pkg="com.aurora.store" ${t ? '' : 'disabled'}>${icon('download', 15)}Install Aurora Store</button></div>`}
      </div>
      <div class="feature-card drop-zone" id="appDrop" style="margin:0;justify-content:center;text-align:center">
        <h3 style="justify-content:center">${icon('upload', 18)}Drop app files here</h3>
        <p>APK, APKM (APKMirror), XAPK (APKPure) and APKS bundles. They go into your library and install on ${t ? `<b>${esc(t.name)}</b>` : 'a device'}. You can also drop them straight onto a phone window.</p>
      </div>
    </div>
    <div class="section-title">${icon('sparkle', 15)}<span class="grow">Good first apps</span><span class="small muted">From F-Droid</span></div>
    <div class="app-grid">${S.init.starters.map((a) => `<div class="app-tile">${tile(a.name)}<div class="meta"><span class="tag">${esc(a.tag)}</span><b>${esc(a.name)}</b><span title="${esc(a.summary)}">${esc(a.summary)}</span></div><button class="btn sm" data-a="fdroid" data-pkg="${a.id}" ${t ? '' : 'disabled'}>Install</button></div>`).join('')}</div>
    <div class="section-title">${icon('globe', 15)}<span class="grow">APK sites</span><span class="small muted">Open inside Droid. Apps you download install on the selected device.</span></div>
    <div class="sites">${S.init.sites.map((s) => `<button class="site" data-a="site" data-url="${esc(s.url)}"><b>${icon('globe', 15)}${esc(s.name)}</b><span>${esc(s.blurb)}</span></button>`).join('')}</div>`}`;
  hydrateIcons(v);
  $$('img[data-fallback]', v).forEach((img) => { img.onerror = () => img.replaceWith(document.createRange().createContextualFragment(tile(img.dataset.fallback, 48))); });
  bindApps();
}
function resultsHtml() {
  if (S.searching) return `<div class="row muted" style="margin:10px 0 20px"><span class="spin"></span>Searching F-Droid…</div>`;
  if (!S.results) return '';
  const t = targetDev();
  return `<div class="section-title"><span class="grow">${S.results.length} result${S.results.length === 1 ? '' : 's'} for “${esc(S.query)}”</span><button class="link-btn" data-a="clear">Clear search</button></div>
    ${S.results.length ? S.results.map((r) => `<div class="result">${r.icon ? `<img class="ai" src="${esc(r.icon)}" alt="" data-fallback="${esc(r.name)}">` : tile(r.name, 48)}
      <div class="meta"><b>${esc(r.name)}</b> <span class="pkg">${esc(r.id)}</span><p>${esc(r.summary)}</p></div>
      <button class="btn sm" data-a="about" data-pkg="${esc(r.id)}" data-name="${esc(r.name)}">Details</button>
      <button class="btn sm primary" data-a="fdroid" data-pkg="${esc(r.id)}" ${t ? '' : 'disabled'}>${icon('download', 14)}Install</button></div>`).join('')
      : `<div class="empty">Nothing on F-Droid matches. Try the APK sites below for Play Store apps.</div>`}
    <div class="section-title">${icon('globe', 15)}<span class="grow">Not here? Search the APK sites</span></div>
    <div class="sites">${S.init.sites.filter((s) => s.id !== 'fdroid').map((s) => `<button class="site" data-a="site" data-url="${esc(siteSearch(s.id, S.query))}"><b>${icon('search', 15)}${esc(s.name)}</b><span>Search “${esc(S.query)}” on ${esc(s.name)}</span></button>`).join('')}</div>`;
}
function siteSearch(id, q) {
  const e = encodeURIComponent(q);
  return { apkmirror: `https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${e}`, apkpure: `https://apkpure.com/search?q=${e}`, uptodown: `https://en.uptodown.com/android/search/${e}` }[id] || 'https://www.apkmirror.com/';
}
function bindApps() {
  const v = $('#view');
  const q = $('#appQ');
  if (q) q.onkeydown = (e) => { if (e.key === 'Enter') doSearch(q.value); };
  v.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, t = targetId();
    try {
      if (a === 'search') return doSearch($('#appQ').value);
      if (a === 'clear') { S.results = null; S.query = ''; return renderAppsBody(); }
      if (a === 'fdroid') { b.disabled = true; b.innerHTML = '<span class="spin"></span>Installing'; await call('apps:fdroid', b.dataset.pkg, t); b.innerHTML = `${icon('check', 14)}Installed`; return; }
      if (a === 'openPlay') return call('apps:openPlay', t, null).catch((err) => toast({ kind: 'bad', title: 'Start the device first', text: err.message }));
      if (a === 'site') { S.browser = { url: b.dataset.url }; return renderApps(); }
      if (a === 'about') return aboutApp(b.dataset.pkg, b.dataset.name);
    } catch (err) {
      if (a === 'fdroid') { b.disabled = false; b.innerHTML = `${icon('download', 14)}Retry`; }
      toast({ kind: 'bad', title: 'Install failed', text: err.message });
    }
  };
  const dz = $('#appDrop');
  if (dz) dropZone(dz, async (paths) => { const added = await call('library:addPaths', paths); const t = targetId(); if (t) for (const f of added) call('library:install', f, t).catch(() => {}); });
}
async function doSearch(q) {
  q = (q || '').trim(); if (!q) return;
  S.query = q; S.searching = true; S.results = [];
  renderAppsBody();
  try { S.results = await call('apps:search', q); } catch (e) { S.results = []; toast({ kind: 'bad', title: 'Search failed', text: e.message }); }
  S.searching = false;
  if (S.view === 'apps' && !S.browser) renderAppsBody();
}
async function aboutApp(pkg, name) {
  const s = document.createElement('div'); s.className = 'scrim';
  s.innerHTML = `<div class="panel" style="width:min(760px,92vw);max-height:84vh;display:flex;flex-direction:column;margin:0;box-shadow:var(--shadow-lg)"><div class="row"><h3 class="grow" style="font-size:17px">${esc(name)}</h3><button class="icon-btn" data-x>${icon('close', 16)}</button></div><div class="pkg muted small" style="margin-bottom:10px">${esc(pkg)}</div><div id="aboutBody" style="overflow:auto"><div class="row muted"><span class="spin"></span>Loading…</div></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-open>${icon('external', 14)}F-Droid page</button><button class="btn primary" data-inst ${targetId() ? '' : 'disabled'}>${icon('download', 14)}Install${targetDev() ? ` on ${esc(targetDev().name)}` : ''}</button></div></div>`;
  document.body.appendChild(s);
  s.addEventListener('click', async (e) => {
    if (e.target === s || e.target.closest('[data-x]')) return s.remove();
    if (e.target.closest('[data-open]')) return call('shell:open', `https://f-droid.org/en/packages/${pkg}/`);
    const ib = e.target.closest('[data-inst]');
    if (ib) { ib.disabled = true; ib.innerHTML = '<span class="spin"></span>Installing'; try { await call('apps:fdroid', pkg, targetId()); s.remove(); } catch (err) { ib.disabled = false; ib.textContent = 'Retry'; toast({ kind: 'bad', title: 'Install failed', text: err.message }); } }
  });
  const a = await call('apps:about', pkg).catch(() => ({ text: '', shots: [] }));
  const body = $('#aboutBody', s); if (!body) return;
  body.innerHTML = `${a.shots.length ? `<div class="row" style="gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:10px">${a.shots.map((u) => `<img src="${esc(u)}" style="height:240px;border-radius:10px;flex:none">`).join('')}</div>` : ''}<div style="white-space:pre-wrap;color:var(--fg-2);font-size:13px">${esc(a.text || 'No description.')}</div>`;
}

function renderBrowser() {
  const v = $('#view'); v.classList.add('flush');
  const t = targetDev();
  v.innerHTML = `<div class="browser">
    <div class="browser-bar">
      <button class="icon-btn sm" data-b="close" title="Back to Get apps">${icon('close', 16)}</button>
      <button class="icon-btn sm" data-b="back" title="Back">${icon('chevL', 16)}</button>
      <button class="icon-btn sm" data-b="fwd" title="Forward">${icon('chevR', 16)}</button>
      <button class="icon-btn sm" data-b="reload" title="Reload">${icon('refresh', 15)}</button>
      <input class="input" id="bUrl" value="${esc(S.browser.url)}">
      ${S.init.sites.map((s) => `<button class="btn xs" data-b="site" data-url="${esc(s.url)}">${esc(s.name)}</button>`).join('')}
    </div>
    <webview id="web" src="${esc(S.browser.url)}" partition="persist:droid-web" allowpopups></webview>
    <div class="browser-foot"><span id="browserFoot" class="grow row">${icon('info', 14)} Download any APK, APKM or XAPK and it ${S.init.settings.autoInstall && t ? `installs on <b style="margin:0 3px">${esc(t.name)}</b> automatically` : 'lands in your App library'}.</span>
      <span class="row small">Auto-install <button class="switch ${S.init.settings.autoInstall ? 'on' : ''}" data-b="auto"></button></span></div>
  </div>`;
  const w = $('#web');
  w.addEventListener('did-navigate', (e) => { $('#bUrl').value = e.url; S.browser.url = e.url; });
  w.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { $('#bUrl').value = e.url; S.browser.url = e.url; } });
  w.addEventListener('new-window', (e) => { if (/^https?:/.test(e.url)) w.loadURL(e.url); });
  $('#bUrl').onkeydown = (e) => { if (e.key === 'Enter') { let u = e.target.value.trim(); if (!/^https?:\/\//.test(u)) u = /\.[a-z]{2,}/.test(u) && !/\s/.test(u) ? `https://${u}` : `https://www.google.com/search?q=${encodeURIComponent(u + ' apk')}`; w.loadURL(u); } };
  v.onclick = (e) => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    const a = b.dataset.b;
    if (a === 'close') { S.browser = null; v.classList.remove('flush'); return renderApps(); }
    if (a === 'back' && w.canGoBack()) w.goBack();
    if (a === 'fwd' && w.canGoForward()) w.goForward();
    if (a === 'reload') w.reload();
    if (a === 'site') w.loadURL(b.dataset.url);
    if (a === 'auto') { const on = !S.init.settings.autoInstall; S.init.settings.autoInstall = on; call('settings:set', { autoInstall: on, installTarget: targetId() }); b.classList.toggle('on', on); }
  };
  call('settings:set', { installTarget: targetId() }).catch(() => {});
}

// ───────────────────────── App library
function dropZone(el, onPaths) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('over');
    const paths = [...e.dataTransfer.files].map((f) => window.droid.pathFor(f)).filter(Boolean);
    if (paths.length) onPaths(paths).catch((err) => toast({ kind: 'bad', title: 'Could not add', text: err.message }));
  });
}
function renderLibrary() {
  head('App library', S.library.length ? `${S.library.length} file${S.library.length === 1 ? '' : 's'}` : '', `${targetSelect()}<button class="btn" data-l="add">${icon('plus', 15)}Add files…</button>`);
  bindTarget();
  $('#headRight').onclick = (e) => { if (e.target.closest('[data-l="add"]')) call('library:add'); };
  const v = $('#view');
  v.innerHTML = `<div class="drop-zone" id="libDrop">${icon('upload', 18)}<div style="margin-top:4px">Drop APK, APKM, XAPK or APKS files to keep them here. Everything you download in Get apps lands here too.</div></div>
    ${S.library.length ? `<div class="list">${S.library.map((f) => `<div class="li">${tile(f.label || f.package || f.name, 38)}
      <div class="meta"><b>${esc(f.label || f.package || f.name)}</b><span>${[f.version && `v${esc(f.version)}`, f.kind === 'bundle' ? `Bundle · ${f.splits} parts` : 'APK', fmtBytes(f.size), ago(f.added), f.package && f.label ? esc(f.package) : f.package ? esc(f.name) : ''].filter(Boolean).join(' · ')}${f.encrypted ? ' · <span style="color:var(--warn)">protected</span>' : ''}${f.broken ? ' · <span style="color:var(--bad)">damaged</span>' : ''}</span></div>
      <button class="btn sm primary" data-l="install" data-file="${esc(f.file)}" ${S.devices.length ? '' : 'disabled'}>${icon('download', 14)}Install</button>
      <button class="icon-btn sm" data-l="more" data-file="${esc(f.file)}" title="More">${icon('more', 15)}</button></div>`).join('')}</div>`
      : `<div class="empty">${icon('box', 30)}<div>No app files yet.</div><button class="btn sm" data-l="go">Find apps</button></div>`}`;
  hydrateIcons(v);
  dropZone($('#libDrop'), (paths) => call('library:addPaths', paths));
  v.onclick = async (e) => {
    const b = e.target.closest('[data-l]'); if (!b) return;
    const f = b.dataset.file;
    if (b.dataset.l === 'go') return go('apps');
    if (b.dataset.l === 'install') { const t = targetId(); if (!t) return; b.disabled = true; b.innerHTML = '<span class="spin"></span>Installing'; try { await call('library:install', f, t); b.innerHTML = `${icon('check', 14)}Installed`; } catch (err) { b.disabled = false; b.innerHTML = `${icon('download', 14)}Install`; } setTimeout(() => { b.disabled = false; b.innerHTML = `${icon('download', 14)}Install`; }, 4000); return; }
    if (b.dataset.l === 'more') {
      menu(b, [
        { heading: 'Install on' },
        ...S.devices.map((d) => ({ icon: S.init.catalog.styles[d.style].tablet ? 'tablet' : 'phone', label: d.name, hint: S.states[d.id] === 'running' ? 'running' : '', run: () => call('library:install', f, d.id) })),
        '-',
        { icon: 'reveal', label: 'Show in folder', run: () => call('library:reveal', f) },
        { icon: 'trash', label: 'Remove from library', danger: true, run: () => call('library:remove', f) },
      ]);
    }
  };
}

// ───────────────────────── Android versions & storage
async function renderSystem() {
  head('Android versions', 'and storage', `<button class="btn" data-s="refresh">${icon('refresh', 15)}Refresh</button>`);
  const v = $('#view');
  v.innerHTML = `<div class="row muted"><span class="spin"></span>Measuring…</div>`;
  const [st, usage] = await Promise.all([call('sdk:status'), call('sdk:usage').catch(() => null)]);
  if (S.view !== 'system') return;
  S.sysUsage = usage;
  const devBytes = usage ? usage.devices.reduce((a, d) => a + d.bytes, 0) : 0;
  const imgBytes = usage ? usage.images.reduce((a, i) => a + i.bytes, 0) : 0;
  v.innerHTML = `
    <div class="stat-row">
      <div class="stat"><b>${fmtBytes(devBytes)}</b><span>${S.devices.length} device${S.devices.length === 1 ? '' : 's'}</span></div>
      <div class="stat"><b>${fmtBytes(imgBytes)}</b><span>${usage ? usage.images.length : 0} Android version${usage?.images.length === 1 ? '' : 's'}</span></div>
      <div class="stat"><b>${fmtBytes((usage?.emulator || 0) + (usage?.platformTools || 0))}</b><span>Emulator and tools</span></div>
      <div class="stat"><b>${fmtBytes(usage?.apks || 0)}</b><span>App library</span></div>
    </div>
    <div id="sysProgress"></div>
    <div class="panel"><h3>Downloaded Android versions</h3><p>Shared by every device that uses them. Remove ones no device needs to free space.</p>
      ${usage && usage.images.length ? `<div class="list">${usage.images.map((i) => `<div class="li">${tile('Android ' + i.api, 34)}<div class="meta"><b>${esc(apiName(i.api))} · ${esc(tagName(i.tag))}</b><span>${esc(i.path)} · ${fmtBytes(i.bytes)}${i.users.length ? ` · used by ${esc(i.users.join(', '))}` : ' · not used'}</span></div><button class="btn sm danger" data-s="rmimg" data-path="${esc(i.path)}" ${i.users.length ? 'disabled title="Delete the devices that use it first"' : ''}>${icon('trash', 14)}Remove</button></div>`).join('')}</div>`
        : `<div class="hint">None yet. They download the first time a device needs them.</div>`}
    </div>
    <div class="panel"><h3>Emulator</h3><p>Google's Android Emulator runs each device. Droid installs and updates it for you.</p>
      <div class="set-row"><div class="meta"><b>Android Emulator</b><span>${st.emulator ? `Version ${esc(st.emulator)}` : 'Not installed yet'}</span></div>${st.emulator ? '<span class="pill ok">Installed</span>' : `<button class="btn sm" data-s="install" data-kind="emulator">Install</button>`}</div>
      <div class="set-row"><div class="meta"><b>Platform tools (adb)</b><span>${st.platformTools ? `Version ${esc(st.platformTools)}` : 'Not installed yet'}</span></div>${st.platformTools ? '<span class="pill ok">Installed</span>' : `<button class="btn sm" data-s="install" data-kind="platform-tools">Install</button>`}</div>
      <div class="set-row"><div class="meta"><b>Hardware acceleration</b><span id="accelText">${S.accel ? esc(S.accel.text) : 'Lets devices run at full speed.'}</span></div>${S.accel ? `<span class="pill ${S.accel.ok ? 'ok' : S.accel.ok === false ? 'bad' : ''}">${S.accel.ok ? 'Ready' : S.accel.ok === false ? 'Not available' : 'Unknown'}</span>` : ''}<button class="btn sm" data-s="accel">Check</button></div>
      <div class="set-row"><div class="meta"><b>Updates</b><span>Get the newest emulator from Google (devices must be off).</span></div><button class="btn sm" data-s="update" ${running().length ? 'disabled' : ''}>Check for update</button></div>
    </div>
    <div class="panel"><h3>Where Droid keeps things</h3>
      <div class="set-row"><div class="meta"><b>Data folder</b><span class="path">${esc(S.init.dataDir)}</span></div><button class="btn sm" data-s="reveal" data-p="${esc(S.init.dataDir)}">Show</button><button class="btn sm" data-s="move">Change…</button></div>
      <div class="set-row"><div class="meta"><b>Android SDK</b><span class="path">${esc(st.root)}</span></div>${S.init.settings.sdkRoot ? `<button class="btn sm" data-s="ownSdk">Use Droid's own</button>` : ''}</div>
      ${S.init.existingSdks.map((p) => `<div class="set-row"><div class="meta"><b>Android Studio SDK found</b><span class="path">${esc(p)}</span><span>Share its emulator and Android versions to save disk space.</span></div><button class="btn sm" data-s="useSdk" data-p="${esc(p)}">Use this</button></div>`).join('')}
      <div class="set-row"><div class="meta"><b>Download cache</b><span>${fmtBytes(usage?.downloads || 0)} of unfinished or leftover downloads</span></div><button class="btn sm" data-s="clear" ${usage?.downloads ? '' : 'disabled'}>Clear</button></div>
    </div>`;
  hydrateIcons(v);
  renderSysProgress();
  const hr = $('#headRight'); hr.onclick = (e) => { if (e.target.closest('[data-s="refresh"]')) renderSystem(); };
  v.onclick = async (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const a = b.dataset.s;
    try {
      if (a === 'rmimg') { if (await confirmBox({ title: 'Remove this Android version?', text: `${b.dataset.path} will be deleted. It downloads again if a device needs it.`, ok: 'Remove', danger: true })) { await call('sdk:removeImage', b.dataset.path); renderSystem(); } }
      if (a === 'install') { b.disabled = true; b.innerHTML = '<span class="spin"></span>Installing'; const cat = await call('catalog:images'); const item = a === 'install' && b.dataset.kind === 'emulator' ? { kind: 'emulator', ...cat.emulator, label: 'Android Emulator' } : { kind: 'platform-tools', ...cat.platformTools, label: 'Platform tools (adb)' }; await call('sdk:install', item); renderSystem(); }
      if (a === 'update') { b.disabled = true; b.innerHTML = '<span class="spin"></span>Checking'; const cat = await call('catalog:images', true); const cur = (await call('sdk:status')).emulator; if (cat.emulator && cur && cat.emulator.version !== cur && confirmVersionNewer(cat.emulator.version, cur)) { if (await confirmBox({ title: `Update the emulator to ${cat.emulator.version}?`, text: `You have ${cur}. The download is about ${fmtBytes(cat.emulator.size)}.`, ok: 'Update' })) { await call('sdk:install', { kind: 'emulator', ...cat.emulator, label: 'Android Emulator' }); toast({ kind: 'ok', title: 'Emulator updated', text: cat.emulator.version }); } } else toast({ kind: 'ok', title: 'You have the newest emulator', text: cur || '' }); renderSystem(); }
      if (a === 'accel') { b.disabled = true; b.innerHTML = '<span class="spin"></span>Checking'; S.accel = await call('host:accel'); renderSystem(); }
      if (a === 'reveal') call('shell:reveal', b.dataset.p);
      if (a === 'move') { const r = await call('dialog:dataFolder'); if (r?.restart && await confirmBox({ title: 'Restart Droid now?', text: `Droid will use ${r.dir} after a restart. Existing devices stay in the old folder; move its contents there first if you want to keep them.`, ok: 'Restart' })) call('app:relaunch'); }
      if (a === 'useSdk' || a === 'ownSdk') { await call('sdk:useExisting', a === 'useSdk' ? b.dataset.p : null); S.init = await call('app:init'); S.images = null; renderSystem(); }
      if (a === 'clear') { await call('sdk:clearDownloads'); renderSystem(); }
    } catch (err) { toast({ kind: 'bad', title: 'Something went wrong', text: err.message }); renderSystem(); }
  };
}
function confirmVersionNewer(a, b) { const p = (s) => String(s).split('.').map(Number); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
function renderSysProgress() {
  const box = $('#sysProgress'); if (!box) return;
  const items = Object.values(S.downloads).filter((d) => d.phase && d.phase !== 'done');
  box.innerHTML = items.map((d) => `<div class="panel"><div class="row"><b class="grow">${esc(d.label || d.key)}</b><span class="tnum small muted">${d.total ? `${fmtBytes(d.got)} of ${fmtBytes(d.total)}` : d.phase}</span></div><div class="bar ${d.phase !== 'download' ? 'indet' : ''}" style="margin-top:8px"><i style="width:${d.total ? Math.round((d.got / d.total) * 100) : 0}%"></i></div></div>`).join('');
}
function apiName(api) { const n = { 24: '7', 25: '7.1', 26: '8', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16', 37: '17' }[parseInt(api, 10)]; return n ? `Android ${n}${String(api).includes('.') && !String(api).endsWith('.0') ? ` (${api})` : ''}` : `API ${api}`; }
function tagName(t) { return { google_apis_playstore: 'Google Play', google_apis: 'Google APIs', default: 'Pure Android' }[t] || t; }

// ───────────────────────── Settings
function renderSettings() {
  head('Settings');
  const st = S.init.settings;
  const v = $('#view');
  v.innerHTML = `
    <div class="panel"><h3>Appearance</h3>
      <div class="set-row"><div class="meta"><b>Theme</b><span>Follow your system, or pick one.</span></div><div class="seg" id="setTheme">${[['system', 'System', 'auto'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([k, l, i]) => `<button data-v="${k}" class="${st.theme === k ? 'on' : ''}">${icon(i, 14)}${l}</button>`).join('')}</div></div>
    </div>
    <div class="panel"><h3>Phone windows</h3>
      <div class="set-row"><div class="meta"><b>How the emulator runs</b><span>Droid shows each device in its own window. The emulator works in the background.</span></div>
        <select class="select" id="setWin"><option value="hidden" ${st.emulatorWindow === 'hidden' ? 'selected' : ''}>In the background (recommended)</option><option value="none" ${st.emulatorWindow === 'none' ? 'selected' : ''}>Headless (lightest, no GPU window)</option><option value="visible" ${st.emulatorWindow === 'visible' ? 'selected' : ''}>Also show Google's emulator window</option></select></div>
      <div class="set-row"><div class="meta"><b>Screenshots and recordings</b><span class="path">Pictures/Droid</span></div><button class="btn sm" data-x="shots">Open folder</button></div>
    </div>
    <div class="panel"><h3>Installing apps</h3>
      <div class="set-row"><div class="meta"><b>Install downloads automatically</b><span>Apps you download in Get apps install on the chosen device right away.</span></div><button class="switch ${st.autoInstall ? 'on' : ''}" id="setAuto"></button></div>
      <div class="set-row"><div class="meta"><b>Default device</b><span>Where downloads and drops from the library go.</span></div>${targetSelect('setTarget')}</div>
    </div>
    <div class="panel"><h3>Keyboard and mouse in a phone window</h3>
      <div class="set-row"><div class="meta"><b>Typing</b><span>Type straight into the device. Esc is Back. ${window.droid.platform === 'darwin' ? '⌘' : 'Ctrl'}+V pastes your computer's clipboard.</span></div></div>
      <div class="set-row"><div class="meta"><b>Pinch and zoom</b><span>Hold ${window.droid.platform === 'darwin' ? 'Option' : 'Alt'} while dragging for a two-finger pinch. Scroll with the wheel or trackpad. Right-click is Back.</span></div></div>
      <div class="set-row"><div class="meta"><b>Shortcuts</b><span>${window.droid.platform === 'darwin' ? '⌘' : 'Ctrl'}+S screenshot · ${window.droid.platform === 'darwin' ? '⌘' : 'Ctrl'}+← / → rotate · ${window.droid.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+H home · ${window.droid.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+R recent apps</span></div></div>
    </div>
    <div class="panel"><h3>About</h3>
      <div class="set-row"><div class="meta"><b>Droid ${esc(S.init.version)}</b><span>Part of the Utility Suite. Runs Google's Android Emulator; Android versions download from Google, free apps from F-Droid.</span></div>${S.init.demo ? '<span class="pill warn">Demo mode</span>' : ''}</div>
    </div>`;
  hydrateIcons(v);
  bindTarget();
  $('#setTarget').onchange = (e) => { S.init.settings.installTarget = e.target.value; call('settings:set', { installTarget: e.target.value }); };
  $('#setTheme').onclick = async (e) => { const b = e.target.closest('[data-v]'); if (!b) return; S.init.settings = await call('settings:set', { theme: b.dataset.v }); applyTheme(); renderSettings(); };
  $('#setWin').onchange = (e) => call('settings:set', { emulatorWindow: e.target.value }).then((s) => (S.init.settings = s));
  $('#setAuto').onclick = async (e) => { const on = !S.init.settings.autoInstall; S.init.settings = await call('settings:set', { autoInstall: on }); e.target.classList.toggle('on', on); };
  v.onclick = (e) => { if (e.target.closest('[data-x="shots"]')) call('shell:captures').catch(() => {}); };
}

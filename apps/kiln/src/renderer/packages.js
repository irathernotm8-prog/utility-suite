/* Kiln — Packages: install, launch, update and configure Stable Diffusion apps. */
(() => {
  const { $, $$, esc } = K;
  let el = null;
  const st = { id: null, tab: 'overview', catalog: null, ext: null, extIndex: null, extQ: '', follow: true };

  function mount(e) {
    el = e;
    el.innerHTML = `<div class="pkg-layout"><div class="pkg-list"><div style="padding:14px 14px 4px"><button class="btn primary block" id="pkAdd">${ic('plus', 15)} Add a package</button></div><div class="scroll" id="pkList"></div>
</div>
      <div class="pkg-main" id="pkMain"></div></div>`;
    $('#pkAdd', el).onclick = () => { st.id = null; render(); };
    K.bus.on('pkg:status', (s) => { if (K.state.page !== 'packages') return; renderList(); if (s.id === st.id && st.tab !== 'console') renderMain(); else if (s.id === st.id) renderHead(); });
    K.bus.on('pkg:list', () => { if (K.state.page === 'packages') render(); });
    K.bus.on('pkg:log', (d) => { if (d.id === st.id && st.tab === 'console' && K.state.page === 'packages') appendLog(d.lines); });
  }
  const cur = () => K.state.packages.find(p => p.id === st.id);
  const initials = (n) => esc(String(n || '?').replace(/^Stable Diffusion /, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());

  function stateLabel(p) {
    const s = p.status?.state;
    if (s === 'working') return p.status.job?.step || 'Working…';
    if (p.status?.job?.state === 'failed' && s !== 'running') return 'Last task failed';
    if (!p.exists) return 'Folder missing';
    if (!p.hasVenv && s !== 'working') return 'Needs setup';
    return window.Home.stateText(s);
  }
  function renderList() {
    const l = $('#pkList', el);
    const list = K.state.packages;
    l.innerHTML = list.length ? list.map(p => `<button class="pkg-row ${p.id === st.id ? 'on' : ''}" data-id="${p.id}"><span class="pkg-ic">${initials(p.name)}</span><div class="t"><b>${esc(p.name)}</b><small><span class="state-dot ${p.status?.state}"></span>${esc(stateLabel(p))}${p.updateAvailable ? ' · <span style="color:var(--amber)">update</span>' : ''}</small></div>${p.id === K.state.settings.defaultPackageId ? `<span title="Default">${ic('star', 13)}</span>` : ''}</button>`).join('')
      : `<p class="muted small" style="padding:8px 12px">No packages yet. Add one to start generating.</p>`;
    $$('[data-id]', l).forEach(b => b.onclick = () => { st.id = b.dataset.id; st.ext = null; st.extIndex = null; if (st.tab === 'catalog') st.tab = 'overview'; render(); });
  }
  function render() { renderList(); renderMain(); }

  /* ---------- catalog ---------- */
  async function renderCatalog(m) {
    st.catalog = st.catalog || await kiln.pkg.catalog();
    const gpu = await kiln.app.gpu().catch(() => null);
    const isMac = K.state.app?.platform === 'darwin';
    m.innerHTML = `<div class="scroll"><div class="page-wrap"><div class="ph"><div class="grow"><h1>Add a package</h1><p>Kiln downloads it, sets up its own Python, installs PyTorch for your graphics card, and connects it to ${esc(K.state.profile.name)}’s models.</p></div></div>
      ${gpu?.best ? `<div class="callout" style="margin-bottom:18px">${ic('cpu', 17)}<div><b>${esc(gpu.best.name)}</b>${gpu.best.memoryMB ? ` · ${Math.round(gpu.best.memoryMB / 1024)} GB` : ''}. Kiln will install the ${gpu.torch === 'cuda' ? 'NVIDIA CUDA' : gpu.torch === 'mps' ? 'Apple Metal' : gpu.torch === 'rocm' ? 'AMD ROCm' : 'CPU'} build of PyTorch.${gpu.best.memoryMB && gpu.best.memoryMB < 10000 && gpu.best.vendor === 'nvidia' ? ' With 8 GB, SDXL runs well; Flux runs best as a GGUF model.' : ''}</div></div>` : ''}
      <div class="catalog">${(isMac ? [...st.catalog].sort((x, y) => ({ good: 0, ok: 1, limited: 2 }[x.mac] - { good: 0, ok: 1, limited: 2 }[y.mac])) : st.catalog).map(c => {
        const have = K.state.packages.filter(p => p.catalogId === c.id).length;
        return `<div class="cat-card"><div class="head"><span class="pkg-ic">${initials(c.name)}</span><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><small>by ${esc(c.author)}</small></div>${have ? `<span class="badge ok">Installed</span>` : ''}</div>
          <p>${esc(c.blurb)}</p><div class="chips">${isMac ? (c.mac === 'good' ? '<span class="badge ok">Works well on Mac</span>' : c.mac === 'limited' ? '<span class="badge warn">Built for NVIDIA; may not run on Mac</span>' : '<span class="badge">Runs on Mac (slower)</span>') : ''}${(c.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}${c.backend ? '<span class="chip">Works with Generate</span>' : ''}</div>
          <div class="row"><button class="btn sm ${have ? '' : 'primary'}" data-c="${c.id}">${ic('download', 13)} ${have ? 'Install another copy' : 'Install'}</button><button class="btn sm ghost" data-repo="${esc(c.repo)}">${ic('external', 13)} Project page</button></div></div>`;
      }).join('')}</div></div></div>`;
    $$('[data-c]', m).forEach(b => b.onclick = () => installDialog(st.catalog.find(c => c.id === b.dataset.c)));
    $$('[data-repo]', m).forEach(b => b.onclick = () => window.Browser.openUrl(b.dataset.repo));
  }
  function installDialog(c) {
    K.modal({
      title: `Install ${c.name}`, subtitle: 'Usually takes 5–20 minutes, mostly downloading PyTorch. You can keep using Kiln.',
      body: `<label class="field"><span>Name</span><input class="input" id="inN" value="${esc(c.name)}"></label>
        <details style="margin-bottom:8px"><summary class="muted" style="cursor:pointer;margin-bottom:10px">Advanced</summary>
          <div class="fields-2"><label class="field"><span>Branch</span><input class="input" id="inB" value="${esc(c.branch)}"></label><label class="field"><span>Python</span><input class="input" id="inPy" value="${esc(c.python)}"></label></div>
          <label class="field"><span>PyTorch build</span><select class="input" id="inT"><option value="">Match my graphics card</option><option value="cuda">NVIDIA (CUDA 12.8)</option><option value="rocm">AMD (ROCm, Linux)</option><option value="cpu">CPU only</option><option value="mps">Apple Silicon</option></select><small>Only used by packages that don’t install PyTorch themselves.</small></label>
        </details>`,
      actions: [{ label: 'Cancel' }, { label: 'Install', kind: 'primary', onClick: async (m) => {
        const p = await kiln.pkg.install({ catalogId: c.id, name: $('#inN', m).value.trim() || c.name, branch: $('#inB', m).value.trim() || c.branch, python: $('#inPy', m).value.trim() || c.python, torch: $('#inT', m).value || null });
        K.state.packages = await kiln.pkg.list();
        if (!K.state.settings.defaultPackageId) await K.saveSettings({ defaultPackageId: p.id });
        st.id = p.id; st.tab = 'console'; render();
        K.toast(`Installing ${c.name}`, 'ok');
      } }]
    });
  }
  /* ---------- a package ---------- */
  function renderMain() {
    const m = $('#pkMain', el);
    const p = cur();
    if (!p) return renderCatalog(m);
    m.innerHTML = `<div class="pkg-head" id="pkHead"></div>
      <div class="tabs" style="padding:0 20px">${[['overview', 'Overview', 'info'], ['options', 'Launch options', 'sliders'], ['console', 'Console', 'terminal'], ...(p.catalog?.extensions ? [['extensions', 'Extensions', 'puzzle']] : [])].map(([id, l, icn]) => `<button data-tab="${id}" class="${st.tab === id ? 'on' : ''}">${ic(icn, 15)} ${l}</button>`).join('')}</div>
      <div class="pkg-body ${st.tab === 'console' ? 'console-mode' : ''}" id="pkBody"></div>`;
    $$('[data-tab]', m).forEach(b => b.onclick = () => { st.tab = b.dataset.tab; renderMain(); });
    renderHead();
    const body = $('#pkBody', m);
    if (st.tab === 'overview') overview(body, p);
    if (st.tab === 'options') options(body, p);
    if (st.tab === 'console') consoleView(body, p);
    if (st.tab === 'extensions') extensions(body, p);
  }
  function renderHead() {
    const h = $('#pkHead', el); const p = cur();
    if (!h || !p) return;
    const s = p.status?.state || 'stopped';
    const busy = s === 'working' || s === 'starting' || s === 'stopping';
    h.innerHTML = `<span class="pkg-ic">${initials(p.name)}</span><div class="t"><h1>${esc(p.name)}</h1><small class="row"><span class="state-dot ${s}"></span>${esc(stateLabel(p))}${p.status?.url ? ` · <a href="#" id="pkUrl">${esc(p.status.url)}</a>` : ''}</small></div>
      ${s === 'running' ? `<button class="btn" id="pkOpen">${ic('globe', 15)} Open web UI</button>${p.catalog?.backend ? `<button class="btn" id="pkGen">${ic('wand', 15)} Generate</button>` : ''}<button class="btn danger" id="pkStop">${ic('stop', 14)} Stop</button>`
        : s === 'starting' || s === 'stopping' ? `<button class="btn danger" id="pkStop">${ic('stop', 14)} Stop</button>`
        : s === 'working' ? `<span class="spinner"></span>`
        : !p.hasVenv && p.exists ? `<button class="btn primary" id="pkRepair">${ic('refresh', 15)} Finish setup</button>`
        : `<button class="btn primary" id="pkLaunch" ${p.exists ? '' : 'disabled'}>${ic('play', 14)} Launch</button>`}
      ${p.updateAvailable && !busy && s !== 'running' ? `<button class="btn" id="pkUpd">${ic('arrowUp', 15)} Update</button>` : ''}
      <button class="icon-btn" id="pkMore">${ic('dots', 18)}</button>`;
    $('#pkUrl', h)?.addEventListener('click', (e) => { e.preventDefault(); window.Browser.openUrl(p.status.url, { title: p.name }); });
    $('#pkOpen', h)?.addEventListener('click', () => window.Browser.openUrl(p.status.url, { title: p.name }));
    $('#pkGen', h)?.addEventListener('click', () => K.go('generate', { pkgId: p.id }));
    $('#pkStop', h)?.addEventListener('click', () => kiln.pkg.stop(p.id));
    $('#pkLaunch', h)?.addEventListener('click', async () => { try { st.tab = 'console'; renderMain(); await kiln.pkg.launch(p.id); } catch (e) { K.fail(e); } });
    $('#pkRepair', h)?.addEventListener('click', () => { st.tab = 'console'; renderMain(); kiln.pkg.repair(p.id).catch(K.fail); });
    $('#pkUpd', h)?.addEventListener('click', () => { st.tab = 'console'; renderMain(); kiln.pkg.update(p.id).catch(K.fail); });
    $('#pkMore', h).onclick = (e) => K.menuAt(e.currentTarget, [
      { label: 'Check for updates', icon: 'refresh', disabled: busy, onClick: async () => { const r = await kiln.pkg.checkUpdate(p.id); K.toast(r.error || (r.updateAvailable ? `${r.updateAvailable} new change${r.updateAvailable > 1 ? 's' : ''} available` : 'Up to date'), r.error ? 'error' : 'ok'); K.state.packages = await kiln.pkg.list(); render(); } },
      { label: 'Use for Generate by default', icon: 'star', checked: K.state.settings.defaultPackageId === p.id, onClick: async () => { await K.saveSettings({ defaultPackageId: p.id }); renderList(); } },
      { label: 'Rename', icon: 'edit', onClick: async () => { const n = await K.ask('Rename package', { value: p.name }); if (n?.trim()) { await kiln.pkg.save(p.id, { name: n.trim() }); K.state.packages = await kiln.pkg.list(); render(); } } },
      { label: 'Repair (reinstall its Python environment)', icon: 'refresh', disabled: busy || s === 'running', onClick: () => { st.tab = 'console'; renderMain(); kiln.pkg.repair(p.id).catch(K.fail); } },
      { label: 'Open folder', icon: 'folder', onClick: () => kiln.pkg.openFolder(p.id) }, '-',
      { label: 'Remove…', icon: 'trash', danger: true, onClick: () => removeDialog(p) }
    ], 'right');
  }
  function removeDialog(p) {
    K.modal({
      title: `Remove ${p.name}?`,
      body: `<button class="choice on" data-del="0"><span class="radio"></span><div><b>Remove from Kiln only</b><small>The folder stays on disk. You can bring it back later.</small></div></button>
        <button class="choice" data-del="1"><span class="radio"></span><div><b>Remove and move its folder to the trash</b><small>${esc(p.path)}. Your models aren’t touched: they live in your library.</small></div></button>`,
      actions: [{ label: 'Cancel' }, { label: 'Remove', kind: 'danger', onClick: async (m) => { const del = $('.choice.on', m).dataset.del === '1'; K.state.packages = await kiln.pkg.uninstall(p.id, del); st.id = null; render(); K.toast('Removed'); } }],
      onMount: (m) => $$('[data-del]', m).forEach(b => b.onclick = () => $$('[data-del]', m).forEach(x => x.classList.toggle('on', x === b)))
    });
  }

  function overview(body, p) {
    const runningFor = p.status?.profileId && p.status.profileId !== K.state.profile.id && p.status.state === 'running';
    const job = p.status?.job;
    body.innerHTML = `
      ${runningFor ? `<div class="callout warn" style="margin-bottom:16px">${ic('alert', 17)}<div>It’s running with another profile’s models. <b>Restart it</b> to use ${esc(K.state.profile.name)}’s.</div></div>` : ''}
      ${job?.state === 'failed' ? `<div class="callout warn" style="margin-bottom:16px">${ic('alert', 17)}<div><b>The last ${esc(job.kind)} didn’t finish.</b> ${esc(job.error || '')} <a href="#" id="ovCon">See the console</a></div></div>` : ''}
      <div class="panel panel-pad" style="margin-bottom:16px"><h2 style="margin-bottom:12px">Connected to ${esc(K.state.profile.name)}</h2>
        <dl class="kv"><dt>Models</dt><dd>${esc(K.state.profile.libraryName)} · <span class="mono">${esc(K.state.profile.libraryPath)}</span></dd><dt>Images save to</dt><dd class="mono">${esc(K.state.profile.outputsDir)}</dd></dl>
        <p class="muted small" style="margin:10px 0 0">Each launch links the package to the profile you’re in, so every profile keeps its own models and images.</p></div>
      <div class="panel panel-pad"><h2 style="margin-bottom:12px">Details</h2>
        <dl class="kv"><dt>Package</dt><dd>${esc(p.catalog?.name || p.catalogId)}</dd><dt>Folder</dt><dd class="mono">${esc(p.path)}</dd><dt>Branch</dt><dd>${esc(p.branch || '')}</dd><dt>Version</dt><dd class="mono">${esc((p.commit || '').slice(0, 10) || 'unknown')}${p.updateAvailable ? ` · <span style="color:var(--amber)">update available</span>` : ''}</dd><dt>Python</dt><dd>${esc(p.python || '')}${p.hasVenv ? '' : ' · <span style="color:var(--amber)">not set up</span>'}</dd>${p.catalog?.repo ? `<dt>Project</dt><dd><a href="#" id="ovRepo">${esc(p.catalog.repo.replace('https://', ''))}</a></dd>` : ''}</dl></div>`;
    $('#ovCon', body)?.addEventListener('click', (e) => { e.preventDefault(); st.tab = 'console'; renderMain(); });
    $('#ovRepo', body)?.addEventListener('click', (e) => { e.preventDefault(); window.Browser.openUrl(p.catalog.repo); });
  }

  async function options(body, p) {
    const opts = p.catalog?.options || [];
    const vals = { ...(p.options || {}) };
    const preview = async () => { $('#opPrev', body).textContent = `python ${p.catalog?.id === 'comfyui' ? 'main.py' : p.catalog?.id === 'fooocus' ? 'entry_with_update.py' : 'launch.py'} ${await kiln.pkg.argsPreview(p.id)}`; };
    const saveOpt = K.debounce(async (patch) => { const r = await kiln.pkg.save(p.id, patch); Object.assign(p, r); preview(); }, 300);
    body.innerHTML = `<div style="max-width:760px">
      <div class="panel panel-pad" style="margin-bottom:16px">${opts.map(o => `<div class="opt"><div class="t"><b>${esc(o.label)}</b>${o.help ? `<small>${esc(o.help)}</small><br>` : ''}<code>${esc(o.flag)}</code></div>
        ${o.type === 'bool' ? `<span class="switch"><input type="checkbox" data-o="${esc(o.flag)}" ${(vals[o.flag] ?? o.default) ? 'checked' : ''}><i></i></span>`
          : o.type === 'choice' ? `<select class="input" style="width:150px" data-o="${esc(o.flag)}">${o.choices.map(c => `<option value="${esc(c)}" ${(vals[o.flag] ?? o.default) === c ? 'selected' : ''}>${esc(c || 'Default')}</option>`).join('')}</select>`
          : `<input class="input" style="width:150px" data-o="${esc(o.flag)}" value="${esc(vals[o.flag] ?? o.default ?? '')}" placeholder="${esc(o.placeholder || '')}">`}</div>`).join('')}</div>
      <div class="panel panel-pad" style="margin-bottom:16px">
        <label class="field"><span>Extra arguments</span><input class="input mono" id="opExtra" value="${esc(p.extraArgs || '')}" placeholder="--some-flag value"><small>Added after the options above.</small></label>
        <div class="opt"><div class="t"><b>Open its web UI in Kiln when it’s ready</b></div><span class="switch"><input type="checkbox" id="opAuto" ${p.autoOpen !== false ? 'checked' : ''}><i></i></span></div>
        ${p.catalog?.backend === 'a1111' ? `<div class="opt"><div class="t"><b>Save its images to the profile’s gallery</b><small>Links its output folders to ${esc(K.state.profile.name)}’s outputs.</small></div><span class="switch"><input type="checkbox" id="opOut" ${p.shareOutputs !== false ? 'checked' : ''}><i></i></span></div>` : ''}
      </div>
      <div class="field"><span>Command</span><pre class="console" style="border-radius:10px;max-height:none;flex:none" id="opPrev"></pre></div>
      <p class="muted small">Changes apply the next time it launches.</p></div>`;
    $$('[data-o]', body).forEach(i => i.onchange = () => { vals[i.dataset.o] = i.type === 'checkbox' ? i.checked : i.value; saveOpt({ options: { ...vals } }); });
    $('#opExtra', body).oninput = () => saveOpt({ extraArgs: $('#opExtra', body).value });
    $('#opAuto', body).onchange = (e) => saveOpt({ autoOpen: e.target.checked });
    $('#opOut', body)?.addEventListener('change', (e) => saveOpt({ shareOutputs: e.target.checked }));
    preview();
  }

  /* ---------- console ---------- */
  function lineClass(l) { return /^▸/.test(l) ? 'step' : /^✓|Running on local URL|To see the GUI|App started/i.test(l) ? 'ok' : /error|traceback|exception|✕|failed/i.test(l) ? 'err' : ''; }
  function lineHtml(l) { const c = lineClass(l); return c ? `<span class="${c}">${esc(l)}</span>\n` : esc(l) + '\n'; }
  async function consoleView(body, p) {
    body.innerHTML = `<pre class="console" id="pkCon"></pre><div class="console-bar"><input class="input mono" id="pkIn" placeholder="Type a response for the console and press Enter (only needed if it asks)"><button class="btn sm" id="pkCopy">${ic('copy', 13)} Copy</button><button class="btn sm" id="pkClr">Clear</button></div>`;
    const con = $('#pkCon', body);
    const lines = await kiln.pkg.log(p.id);
    con.innerHTML = lines.length ? lines.slice(-3000).map(lineHtml).join('') : `<span style="opacity:.6">Nothing yet. Output from installing and running ${esc(p.name)} shows here.</span>\n`;
    con.scrollTop = con.scrollHeight;
    con.onscroll = () => { st.follow = con.scrollTop + con.clientHeight >= con.scrollHeight - 30; };
    $('#pkIn', body).onkeydown = async (e) => { if (e.key === 'Enter') { const ok = await kiln.pkg.sendInput(p.id, e.target.value); if (!ok) K.toast('It isn’t running', 'error'); e.target.value = ''; } };
    $('#pkCopy', body).onclick = async () => { navigator.clipboard.writeText((await kiln.pkg.log(p.id)).join('\n')); K.toast('Console copied', 'ok'); };
    $('#pkClr', body).onclick = async () => { await kiln.pkg.clearLog(p.id); con.innerHTML = ''; };
  }
  function appendLog(lines) {
    const con = $('#pkCon', el);
    if (!con) return;
    if (con.firstChild?.nodeType === 1 && con.firstChild.style?.opacity) con.innerHTML = '';
    con.insertAdjacentHTML('beforeend', lines.map(lineHtml).join(''));
    while (con.childNodes.length > 9000) con.removeChild(con.firstChild);
    if (st.follow) con.scrollTop = con.scrollHeight;
  }

  /* ---------- extensions ---------- */
  async function extensions(body, p) {
    body.innerHTML = '<span class="spinner"></span>';
    try { st.ext = await kiln.ext.list(p.id); } catch (e) { st.ext = []; }
    const kind = p.catalog?.id === 'comfyui' ? 'custom nodes' : 'extensions';
    body.innerHTML = `<div style="max-width:860px">
      <form class="row" id="exForm" style="margin-bottom:18px"><input class="input" id="exUrl" placeholder="Install from a Git link — https://github.com/…"><button class="btn primary">${ic('download', 14)} Install</button></form>
      <div class="section-h"><h2>Installed ${kind}</h2><span class="muted small">${st.ext.length}</span></div>
      <div class="panel" style="padding:4px 16px;margin-bottom:24px">${st.ext.length ? st.ext.map(x => `<div class="ext-row" data-f="${esc(x.folder)}"><div class="t"><b>${esc(x.name)}</b><small>${esc(x.url || 'Local folder')}</small></div>
        <span class="switch" title="${x.enabled ? 'On' : 'Off'}"><input type="checkbox" data-tog ${x.enabled ? 'checked' : ''}><i></i></span>
        ${x.url ? `<button class="icon-btn sm" data-upd title="Update">${ic('refresh', 14)}</button>` : ''}<button class="icon-btn sm" data-rm title="Remove">${ic('trash', 14)}</button></div>`).join('') : `<p class="muted" style="padding:10px 0">None installed.</p>`}</div>
      <div class="section-h"><h2>Browse</h2><div class="search" style="width:280px">${ic('search', 15)}<input class="input" id="exQ" placeholder="Search ${kind}" value="${esc(st.extQ)}"></div></div>
      <div id="exIdx"><span class="spinner"></span></div>
      <p class="muted small">Restart ${esc(p.name)} after installing, updating or turning ${kind} on or off.</p></div>`;
    $('#exForm', body).onsubmit = async (e) => { e.preventDefault(); const u = $('#exUrl', body).value.trim(); if (!u) return; installExt(p, u); };
    $$('.ext-row', body).forEach(r => {
      const f = r.dataset.f;
      $('[data-tog]', r).onchange = async (e) => { try { st.ext = await kiln.ext.toggle(p.id, f, e.target.checked); } catch (er) { K.fail(er); } };
      $('[data-upd]', r)?.addEventListener('click', async () => { K.toast(`Updating ${f}…`); try { await kiln.ext.update(p.id, f); K.toast('Updated', 'ok'); } catch (er) { K.fail(er); } });
      $('[data-rm]', r).onclick = async () => { if (await K.confirm(`Remove ${f}?`, 'Its folder goes to the trash.', { ok: 'Remove', danger: true })) { await kiln.ext.remove(p.id, f); extensions(body, p); } };
    });
    $('#exQ', body).oninput = K.debounce((e) => { st.extQ = e.target.value; drawIndex(body, p); }, 200);
    try { st.extIndex = st.extIndex || await kiln.ext.index(p.id); } catch (e) { $('#exIdx', body).innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    drawIndex(body, p);
  }
  function drawIndex(body, p) {
    const box = $('#exIdx', body); if (!box || !st.extIndex) return;
    const q = st.extQ.toLowerCase();
    const have = new Set((st.ext || []).map(x => (x.url || '').replace(/\.git$/, '').toLowerCase()));
    const list = st.extIndex.filter(x => !q || (x.name + ' ' + x.description + ' ' + x.author).toLowerCase().includes(q)).slice(0, 80);
    box.innerHTML = `<div class="panel" style="padding:4px 16px;margin-bottom:12px">${list.map((x, i) => `<div class="ext-row"><div class="t"><b>${esc(x.name)}</b><small>${esc(x.description || x.url)}</small></div>${have.has((x.url || '').replace(/\.git$/, '').toLowerCase()) ? '<span class="badge ok">Installed</span>' : `<button class="btn sm" data-i="${i}">${ic('download', 13)} Install</button>`}</div>`).join('') || '<p class="muted" style="padding:10px 0">Nothing matches.</p>'}</div>`;
    $$('[data-i]', box).forEach(b => b.onclick = () => installExt(p, list[Number(b.dataset.i)].url));
  }
  async function installExt(p, url) {
    st.tab = 'console'; renderMain();
    try { await kiln.ext.install(p.id, url); K.toast('Installed. Restart to load it.', 'ok'); } catch (e) { K.fail(e); }
  }

  function show(prm = {}) {
    if (prm.id) st.id = prm.id;
    if (prm.tab) st.tab = prm.tab;
    if (st.id && !cur()) st.id = null;
    if (!st.id && !prm.add && K.state.packages.length) st.id = K.state.packages[0].id;
    kiln.pkg.list().then(l => { K.state.packages = l; render(); });
  }
  K.register('packages', { title: 'Packages', mount, show, reset: () => { st.id = null; st.tab = 'overview'; } });
})();

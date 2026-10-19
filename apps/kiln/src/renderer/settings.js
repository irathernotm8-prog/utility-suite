/* Kiln — Settings: per-profile preferences, accounts, and app-wide setup. */
(() => {
  const { $, $$, esc } = K;
  let el = null;
  let tab = 'profile';
  const TABS = [['profile', 'Profile', 'user'], ['look', 'Look & content', 'eye'], ['accounts', 'Accounts', 'lock'], ['generate', 'Generate', 'wand'], ['browser', 'Browser', 'globe'], ['system', 'Storage & system', 'cpu']];

  function mount(e) { el = e; el.innerHTML = `<div class="settings"><nav class="subnav" id="setNav"></nav><div class="body"><div id="setBody"></div></div></div>`; }
  function nav() {
    $('#setNav', el).innerHTML = `<h4 style="margin-top:4px">${esc(K.state.profile.name)}</h4>` + TABS.slice(0, 5).map(([id, l, i]) => `<button data-t="${id}" class="${tab === id ? 'on' : ''}">${ic(i, 15)}<span>${l}</span></button>`).join('') + `<h4>Kiln</h4>` + TABS.slice(5).map(([id, l, i]) => `<button data-t="${id}" class="${tab === id ? 'on' : ''}">${ic(i, 15)}<span>${l}</span></button>`).join('');
    $$('[data-t]', el).forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
  }
  const sw = (id, on) => `<span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></span>`;

  async function render() {
    nav();
    const s = K.state.settings, p = K.state.profile;
    const b = $('#setBody', el);
    const app = K.state.app = await kiln.app.state();
    if (tab === 'profile') {
      b.innerHTML = `<div class="ph"><div class="grow"><h1>Profile</h1><p>Everything here applies to ${esc(p.name)} only.</p></div></div>
        <div class="set-group panel panel-pad"><div class="row" style="gap:16px">${K.avatar(p, 'xl')}<div style="flex:1"><h2>${esc(p.name)}</h2><p class="muted" style="margin:4px 0 12px">${p.hasPin ? 'Locked with a PIN' : 'No PIN'}</p><button class="btn" id="spEdit">${ic('edit', 14)} Edit name, color and PIN</button></div></div></div>
        <div class="set-group"><h2>Model library</h2><p>The folder this profile’s packages load models from and downloads go into. Profiles can share a library to save disk space.</p>
          ${app.libraries.map(l => `<button class="choice ${l.id === p.libraryId ? 'on' : ''}" data-lib="${l.id}"><span class="radio"></span><div style="min-width:0"><b>${esc(l.name)}</b><small class="mono" style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(l.path)}</small><small>${l.profiles.length ? 'Used by ' + esc(l.profiles.join(', ')) : 'Not used by any profile'}</small></div></button>`).join('')}
          <div class="row"><button class="btn sm" id="spNewLib">${ic('plus', 13)} New empty library</button><button class="btn sm" id="spAddLib">${ic('folder', 13)} Use an existing models folder</button></div></div>
        <div class="set-group"><h2>Images</h2><p>Where this profile’s generated images are saved. Packages are linked here when they launch.</p>
          <div class="row"><input class="input mono" readonly value="${esc(p.outputsDir)}"><button class="btn" id="spOut">${ic('folder', 14)} Change</button></div></div>
        <div class="set-group"><h2>Other profiles</h2>
          <div class="opt"><div class="t"><b>Ask which profile to use when Kiln opens</b></div>${sw('spAsk', app.askOnLaunch)}</div>
          <div class="row" style="margin-top:10px"><button class="btn sm" id="spAll">${ic('users', 13)} All profiles</button>${app.profiles.length > 1 ? `<button class="btn sm danger" id="spDel">${ic('trash', 13)} Delete this profile</button>` : ''}</div></div>`;
      $('#spEdit', b).onclick = () => window.Profiles.createDialog({ edit: p, onCreated: () => render() });
      $$('[data-lib]', b).forEach(x => x.onclick = () => setLibrary(x.dataset.lib));
      $('#spNewLib', b).onclick = async () => { const n = await K.ask('New library', { label: 'Name', value: `${p.name}’s models` }); if (n) { const l = await kiln.libraries.create({ name: n }); setLibrary(l.id); } };
      $('#spAddLib', b).onclick = async () => { const l = await kiln.libraries.addExisting(); if (l) setLibrary(l.id); };
      $('#spOut', b).onclick = async () => { const d = await kiln.app.chooseFolder({ title: 'Where should this profile’s images go?', defaultPath: p.outputsDir }); if (d) { K.state.app = await kiln.profiles.update(p.id, { outputsDir: d }); K.state.profile = K.state.app.profiles.find(x => x.id === p.id); K.toast('Images folder changed', 'ok'); render(); } };
      $('#spAsk', b).onchange = (e) => kiln.app.set({ askOnLaunch: e.target.checked });
      $('#spAll', b).onclick = () => window.Profiles.picker();
      $('#spDel', b)?.addEventListener('click', async () => {
        if (!await K.confirm(`Delete ${p.name}?`, 'Its saved prompts, history, settings and browser sign-ins go to the trash. Its model library and images folder stay on disk.', { ok: 'Delete profile', danger: true })) return;
        await kiln.profiles.remove(p.id, true); window.Profiles.picker();
      });
    }
    if (tab === 'look') {
      b.innerHTML = `<div class="ph"><div class="grow"><h1>Look & content</h1></div></div>
        <div class="set-group"><h2>Theme</h2><div class="seg" id="slTheme">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']].map(([v, l]) => `<button data-v="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="set-group"><h2>Mature content</h2><p>How images marked as mature appear in Find models and your library.</p>
          ${[['blur', 'Blur until I hover', 'Shown in results, blurred.'], ['show', 'Show', 'No blur.'], ['hide', 'Hide', 'Left out of CivitAI results entirely.']].map(([v, l, d]) => `<button class="choice ${s.nsfw === v ? 'on' : ''}" data-n="${v}"><span class="radio"></span><div><b>${l}</b><small>${d}</small></div></button>`).join('')}</div>`;
      $$('#slTheme [data-v]', b).forEach(x => x.onclick = async () => { await K.saveSettings({ theme: x.dataset.v }); document.documentElement.dataset.theme = x.dataset.v === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : x.dataset.v; render(); });
      $$('[data-n]', b).forEach(x => x.onclick = async () => { await K.saveSettings({ nsfw: x.dataset.n }); window.Discover && K.pages.discover?.reset?.(); render(); });
    }
    if (tab === 'accounts') {
      b.innerHTML = `<div class="ph"><div class="grow"><h1>Accounts</h1><p>Keys are stored encrypted on this computer, for ${esc(p.name)} only.</p></div></div>
        <div class="set-group panel panel-pad"><h2 style="margin-bottom:6px">CivitAI API key</h2><p class="muted" style="margin:0 0 12px">Needed for some downloads (models that require sign-in) and for early access models you’ve unlocked. Create one at civitai.com → Account settings → API keys.</p>
          <div class="row"><input class="input mono" id="saCiv" type="password" placeholder="${s.hasCivitaiKey ? 'Saved. Paste a new key to replace it' : 'Paste your API key'}"><button class="btn primary" id="saCivS">Save</button>${s.hasCivitaiKey ? `<button class="btn ghost" id="saCivX">Remove</button>` : ''}</div>
          <button class="btn ghost sm" id="saCivOpen" style="margin-top:8px">${ic('globe', 13)} Open CivitAI account settings</button></div>
        <div class="set-group panel panel-pad"><h2 style="margin-bottom:6px">Hugging Face token</h2><p class="muted" style="margin:0 0 12px">Needed for gated models like Flux dev. Create a read token at huggingface.co → Settings → Access tokens, and accept the model’s terms on its page.</p>
          <div class="row"><input class="input mono" id="saHf" type="password" placeholder="${s.hasHfToken ? 'Saved. Paste a new token to replace it' : 'hf_…'}"><button class="btn primary" id="saHfS">Save</button>${s.hasHfToken ? `<button class="btn ghost" id="saHfX">Remove</button>` : ''}</div>
          <button class="btn ghost sm" id="saHfOpen" style="margin-top:8px">${ic('globe', 13)} Open Hugging Face tokens</button></div>`;
      const saveKey = async (k, v) => { await K.saveSettings({ [k]: v }); K.toast(v ? 'Saved' : 'Removed', 'ok'); render(); };
      $('#saCivS', b).onclick = () => { const v = $('#saCiv', b).value.trim(); if (v) saveKey('civitaiKey', v); };
      $('#saHfS', b).onclick = () => { const v = $('#saHf', b).value.trim(); if (v) saveKey('hfToken', v); };
      $('#saCivX', b)?.addEventListener('click', () => saveKey('civitaiKey', null));
      $('#saHfX', b)?.addEventListener('click', () => saveKey('hfToken', null));
      $('#saCivOpen', b).onclick = () => window.Browser.openUrl('https://civitai.com/user/account');
      $('#saHfOpen', b).onclick = () => window.Browser.openUrl('https://huggingface.co/settings/tokens');
    }
    if (tab === 'generate') {
      const tags = await kiln.tags.status();
      const pk = K.state.packages.filter(x => x.catalog?.backend);
      b.innerHTML = `<div class="ph"><div class="grow"><h1>Generate</h1></div></div>
        <div class="set-group"><h2>Default engine</h2><p>The package Generate uses first.</p><select class="input" id="sgDef" style="max-width:360px"><option value="">First one running</option>${pk.map(x => `<option value="${x.id}" ${x.id === s.defaultPackageId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="set-group"><h2>Size presets</h2><p>One per line, like 1216 x 832.</p><textarea class="input mono" id="sgSizes" rows="8" style="max-width:360px">${esc((s.sizes || []).join('\n'))}</textarea><div><button class="btn sm" id="sgSizesS" style="margin-top:8px">Save presets</button></div></div>
        <div class="set-group"><h2>Default “leave out” text</h2><textarea class="input" id="sgNeg" rows="3" placeholder="Used when you start a new prompt">${esc(s.gen?.negative || '')}</textarea></div>
        <div class="set-group"><h2>Tag suggestions</h2><p>${tags.available ? `${K.fmtNum(tags.count)} Danbooru and e621 tags loaded.` : 'No tag list yet. Download one to get suggestions while you type prompts.'}</p>${tags.available ? `<small class="muted mono">${esc(tags.file || '')}</small>` : `<button class="btn" id="sgTags">${ic('download', 14)} Download tag list (about 2 MB)</button>`}</div>`;
      $('#sgDef', b).onchange = (e) => K.saveSettings({ defaultPackageId: e.target.value || null });
      $('#sgSizesS', b).onclick = async () => { const sizes = $('#sgSizes', b).value.split('\n').map(x => x.trim()).filter(x => /^\d+\s*x\s*\d+$/i.test(x)); await K.saveSettings({ sizes }); K.toast('Presets saved', 'ok'); };
      $('#sgNeg', b).onchange = (e) => K.saveSettings({ gen: { negative: e.target.value } });
      $('#sgTags', b)?.addEventListener('click', async (e) => { e.target.disabled = true; try { await kiln.tags.download(); K.toast('Tag list ready', 'ok'); render(); } catch (er) { K.fail(er); e.target.disabled = false; } });
    }
    if (tab === 'browser') {
      b.innerHTML = `<div class="ph"><div class="grow"><h1>Browser</h1><p>${esc(p.name)} has its own sign-ins and bookmarks.</p></div></div>
        <div class="set-group"><h2>Search with</h2><div class="seg" id="sbEng">${[['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['bing', 'Bing']].map(([v, l]) => `<button data-v="${v}" class="${s.searchEngine === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="set-group"><div class="opt"><div class="t"><b>Block ads and trackers</b><small>Uses the same filter lists as uBlock Origin.</small></div>${sw('sbAd', s.adblock !== false)}</div></div>
        <div class="set-group"><h2>Browsing data</h2><p>Sign out of every site in this profile’s browser.</p><button class="btn danger" id="sbClr">${ic('trash', 14)} Clear browsing data</button></div>`;
      $$('#sbEng [data-v]', b).forEach(x => x.onclick = async () => { await K.saveSettings({ searchEngine: x.dataset.v }); render(); });
      $('#sbAd', b).onchange = (e) => K.saveSettings({ adblock: e.target.checked });
      $('#sbClr', b).onclick = async () => { if (await K.confirm('Clear browsing data?', 'Signs this profile out of sites in Kiln’s browser.', { ok: 'Clear', danger: true })) { await kiln.browser.clearData(); K.toast('Cleared', 'ok'); } };
    }
    if (tab === 'system') {
      b.innerHTML = `<div class="ph"><div class="grow"><h1>Storage & system</h1><p>These apply to every profile.</p></div></div><div id="sysBody"><span class="spinner"></span></div>`;
      const [gpu, tools] = await Promise.all([kiln.app.gpu().catch(() => null), kiln.app.tools().catch(() => ({}))]);
      $('#sysBody', b).innerHTML = `
        <div class="set-group"><h2>Kiln folder</h2><p>New packages, profiles and libraries are created here.</p><div class="row"><input class="input mono" readonly value="${esc(app.dataRoot)}"><button class="btn" id="ssRoot">${ic('folder', 14)} Change</button></div><small class="muted">Changing it doesn’t move anything already there.</small></div>
        <div class="set-group panel panel-pad"><h2 style="margin-bottom:10px">This computer</h2><dl class="kv">
          ${(gpu?.gpus || []).map(g => `<dt>Graphics</dt><dd>${esc(g.name)}${g.memoryMB ? ` · ${(g.memoryMB / 1024).toFixed(0)} GB` : ''}${g.driver ? ` · driver ${esc(g.driver)}` : ''}</dd>`).join('') || '<dt>Graphics</dt><dd>Not detected</dd>'}
          <dt>PyTorch build</dt><dd>${esc((gpu?.torch || 'cpu').toUpperCase())}</dd>
          <dt>Git</dt><dd class="mono">${esc(tools.git || 'Downloaded when first needed')}</dd>
          <dt>uv (Python)</dt><dd class="mono">${esc(tools.uv || 'Downloaded when first needed')}</dd>
          <dt>Python installs</dt><dd class="mono">${esc(tools.pythonDir || '')}</dd></dl></div>
        <div class="set-group"><h2>About</h2><p>Kiln ${esc(app.version)} · part of the Utility Package.</p></div>`;
      $('#ssRoot', b).onclick = async () => { const d = await kiln.app.chooseFolder({ title: 'Choose the Kiln folder', defaultPath: app.dataRoot }); if (d) { await kiln.app.set({ dataRoot: d }); render(); } };
    }
  }
  async function setLibrary(id) {
    const p = K.state.profile;
    if (id === p.libraryId) return;
    K.state.app = await kiln.profiles.update(p.id, { libraryId: id });
    K.state.profile = K.state.app.profiles.find(x => x.id === p.id);
    K.toast(`${p.name} now uses ${K.state.profile.libraryName}`, 'ok');
    if (K.state.running.length) K.toast('Restart running packages to load the new library');
    render();
  }

  K.register('settings', { title: 'Settings', mount, show: (prm = {}) => { if (prm.tab) tab = prm.tab; render(); } });
})();

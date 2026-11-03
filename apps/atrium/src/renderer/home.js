// Atrium — All sites (the gallery) and Settings (AI providers and keys, the Claude/Codex plugin, publishing,
// appearance, where sites live).
'use strict';
async function renderHome() {
  const host = $('#home'); const list = await call('sites:list');
  host.innerHTML = `<div class="home-head"><div class="grow"><h1>Your sites</h1><p>${plural(list.length, 'site')} in <code>${esc(tildify(S.info.sitesRoot))}</code></p></div><button class="btn" data-import>${icon('download', 15)} Import a website</button><button class="btn primary" data-new>${icon('plus', 15)} New site</button></div>
  <div class="site-grid">${list.map((s) => `<div class="site-card ${S.site && s.id === S.site.id ? 'cur' : ''}" data-dir="${esc(s.dir)}"><div class="sc-thumb" data-thumb="${esc(s.dir)}"><div class="sc-swatch" style="background:linear-gradient(135deg, ${s.colors.bg}, ${s.colors.surface})"><span style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg, ${s.colors.primary}, ${s.colors.accent})"></span></div></div><div class="sc-meta"><div class="grow"><b>${esc(s.name)}</b><span>${plural(s.pages.length, 'page')}${s.posts ? ' · ' + plural(s.posts, 'post') : ''} · ${ago(s.updatedAt)}</span></div></div><button class="icon-btn sm sc-more" data-more>${icon('more', 16)}</button></div>`).join('')}
  <button class="site-card new-card" data-new2><div class="plus">${icon('plus', 22)}</div><b>New site</b><span class="small muted">From a template, blank, or described to the AI</span></button></div>`;
  hydrateIcons(host);
  $('[data-new]', host).onclick = () => newSiteSheet(); $('[data-new2]', host).onclick = () => newSiteSheet(); $('[data-import]', host).onclick = () => importSheet();
  $$('[data-dir]', host).forEach((c) => c.onclick = (e) => { if (e.target.closest('[data-more]')) return; openSite(c.dataset.dir); });
  $$('[data-more]', host).forEach((b) => b.onclick = (e) => { e.stopPropagation(); const dir = b.closest('[data-dir]').dataset.dir; menu(b, [
    { text: 'Open', icon: 'edit', run: () => openSite(dir) }, { text: 'Duplicate', icon: 'dup', run: () => attempt(async () => { await call('sites:duplicate', dir); renderHome(); }) }, { text: 'Show in Finder', icon: 'folder', run: () => call('sites:reveal', dir) },
    '-', { text: 'Move to trash', icon: 'trash', danger: true, run: async () => { if (await confirmSheet('Move this site to the trash?', 'It goes to the .trash folder inside your sites folder, so it can be recovered.', 'Move to trash', true)) attempt(async () => { await call('sites:trash', dir); await loadSite(); renderHome(); }); } },
  ], { right: true }); });
  for (const el of $$('[data-thumb]', host)) call('sites:thumb', el.dataset.thumb).then((u) => { if (u) { el.style.backgroundImage = `url(${u})`; const sw = $('.sc-swatch', el); if (sw) sw.remove(); } });
}

async function renderPrefs() {
  const host = $('#prefs'); S.settings = await call('settings:get'); const st = await call('connectors:status').catch(() => null); const ai = await call('ai:status').catch(() => ({}));
  const P = S.lib.providers; const cur = S.settings.aiProvider; const hasKey = S.settings.hasKey || {};
  const prov = (id, name, ready, note) => `<div class="prov ${cur === id ? 'on' : ''}" data-prov="${id}"><span data-icon="${/claude|anthropic/.test(id) ? 'sparkle' : /ollama|lmstudio/.test(id) ? 'cpu' : 'api'}" data-size="15"></span><b>${esc(name)}</b>${ready ? '<span class="pill ok">ready</span>' : `<span class="pill">${esc(note)}</span>`}</div>`;
  host.innerHTML = `<div class="prefs-wrap"><div class="home-head"><div class="grow"><h1>Settings</h1></div><button class="btn" data-back>${icon('x', 14)} Close</button></div>
  <div class="card"><h3>${icon('sparkle', 16)} The AI that builds with you</h3><p class="sub">Pick which AI the in-app assistant uses. Every option gets the same full control of the site.</p>
    <div class="prov-list">${prov('claude-code', 'Claude Code (your subscription)', !!ai.claude, 'not installed')}${prov('codex', 'Codex (your ChatGPT plan)', !!ai.codex, 'not installed')}${P.map((p) => prov(p.id, p.name, !p.noKey && hasKey[p.id], p.noKey ? 'no key needed' : 'needs a key')).join('')}</div>
    <div id="provDetail"></div></div>
  <div class="card"><h3>${icon('plug', 16)} Use Atrium from Claude and Codex</h3><p class="sub">Adds Atrium’s tools to the Claude desktop app, Claude Code and Codex, so you can build from there. Atrium starts in the background when they need it.</p>
    ${st ? [['desktop', 'Claude desktop app', st.desktop.installed ? (st.desktop.added ? 'Added' : 'Not added yet') : 'Claude desktop isn’t installed', st.desktop.added && st.desktop.current], ['code', 'Claude Code', st.code.installed ? `Found ${esc(st.code.version || '')}` : 'Not found — it will be written to ~/.claude.json', st.code.added && st.code.current], ['codex', 'Codex (CLI, IDE and app)', st.codex.installed ? 'Found' : 'Not found — it will be written to ~/.codex/config.toml', st.codex.added && st.codex.current]].map(([k, n, sub, ok]) => `<div class="conn-row"><div class="grow"><b>${n}</b><span>${sub}</span></div>${ok ? '<span class="pill ok">Connected</span>' : ''}<button class="btn sm ${ok ? '' : 'primary'}" data-conn="${k}">${ok ? 'Re-add' : 'Add'}</button></div>`).join('') : ''}
    <span class="hint">${st && st.bridge && st.bridge.connected ? `${esc(st.bridge.client || 'An AI')} is connected right now.` : 'After adding, restart the Claude app (or start a new Claude Code / Codex session).'}</span></div>
  <div class="card"><h3>${icon('publish', 16)} Publishing</h3><div class="kv"><label>Netlify token</label><div class="row"><input class="input sm grow" type="password" data-net placeholder="${S.settings.hasNetlify ? '•••••••• saved' : 'Personal access token'}"><button class="btn sm" data-net-save>Save</button></div></div><span class="hint">GitHub Pages uses the GitHub CLI’s sign-in (gh auth login). Tokens and keys are encrypted with your system keychain and never leave this computer except to the service they’re for.</span></div>
  <div class="card"><h3>${icon('gear', 16)} App</h3>
    <div class="kv"><label>Appearance</label><div class="seg">${['system', 'dark', 'light'].map((x) => `<button data-theme="${x}" class="${S.settings.theme === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>
    <div class="kv"><label>Sites folder</label><div class="row"><code class="grow ellip">${esc(tildify(S.info.sitesRoot))}</code><button class="btn sm" data-dir>Change…</button></div></div>
    <div class="kv"><label>Version</label><span class="small">Atrium ${esc(S.info.version)}</span></div></div></div>`;
  hydrateIcons(host);
  $('[data-back]', host).onclick = () => showView('builder');
  $$('[data-prov]', host).forEach((b) => b.onclick = async () => { S.settings = await call('settings:set', { aiProvider: b.dataset.prov }); renderPrefs(); });
  $$('[data-conn]', host).forEach((b) => b.onclick = () => attempt(async () => { await call('connectors:' + b.dataset.conn); renderPrefs(); }, 'Added — restart that app to see Atrium'));
  $('[data-net-save]', host).onclick = () => attempt(async () => { await call('settings:netlify', $('[data-net]', host).value); S.settings = await call('settings:get'); renderPrefs(); }, 'Token saved');
  $$('[data-theme]', host).forEach((b) => b.onclick = async () => { S.settings = await call('settings:set', { theme: b.dataset.theme }); applyAppTheme(); renderPrefs(); });
  $('[data-dir]', host).onclick = async () => { const d = await call('dialog:folder'); if (d) { S.settings = await call('settings:set', { sitesDir: d }); S.info = await call('app:info'); await loadSite(); renderPrefs(); } };
  // provider detail
  const det = $('#provDetail', host); const p = P.find((x) => x.id === cur);
  if (cur === 'claude-code' || cur === 'codex') { const c = cur === 'codex' ? ai.codex : ai.claude; det.innerHTML = `<div class="hint">${c ? `Using ${esc(c.path)} (${esc(c.version || '')}). It runs with your own sign-in and only Atrium’s tools.` : `Install ${cur === 'codex' ? 'Codex (npm i -g @openai/codex)' : 'Claude Code (claude.ai/code)'} and sign in, or pick a provider with an API key.`}</div>`; return; }
  if (!p) return;
  det.innerHTML = `<div class="col" style="gap:10px;margin-top:4px">${p.noKey ? '' : `<div class="kv"><label>API key</label><div class="row"><input class="input sm grow" type="password" data-key placeholder="${hasKey[p.id] ? '•••••••• saved' : 'Paste your key'}"><button class="btn sm" data-key-save>Save</button>${p.keyUrl ? `<button class="link-btn" data-keyurl>Get a key</button>` : ''}</div></div>`}
    <div class="kv"><label>Model</label><div class="row"><input class="input sm grow" data-model value="${esc(S.settings.models[p.id] || p.model)}" list="modelList"><datalist id="modelList"></datalist><button class="btn sm" data-models>Load models</button></div></div>
    <div class="kv"><label>Address</label><input class="input sm" data-base value="${esc(S.settings.bases[p.id] || p.base)}"></div>
    <span class="hint">${p.vision ? 'This model can see the screenshots it takes.' : 'This model may not see images; it gets text results instead of screenshots.'}</span></div>`;
  if ($('[data-key-save]', det)) $('[data-key-save]', det).onclick = () => attempt(async () => { await call('settings:key', p.id, $('[data-key]', det).value); renderPrefs(); }, 'Key saved');
  if ($('[data-keyurl]', det)) $('[data-keyurl]', det).onclick = () => call('shell:open', p.keyUrl);
  $('[data-model]', det).onchange = async (e) => { S.settings = await call('settings:set', { models: { ...S.settings.models, [p.id]: e.target.value.trim() } }); };
  $('[data-base]', det).onchange = async (e) => { S.settings = await call('settings:set', { bases: { ...S.settings.bases, [p.id]: e.target.value.trim() } }); };
  $('[data-models]', det).onclick = async () => { const list = await attempt(() => call('ai:models', p.id)); if (list) { $('#modelList').innerHTML = list.map((m) => `<option value="${esc(m)}">`).join(''); toast(`${list.length} models`, 'Pick one in the Model box'); } };
}

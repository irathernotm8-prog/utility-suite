// Atrium — main process: the window, settings, sites, the live preview server, the AI's hidden browser, the
// Claude/Codex plugin bridge, the in-app assistant (API keys or Claude Code/Codex), exports and publishing.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.env.ATRIUM_USER_DATA) app.setPath('userData', process.env.ATRIUM_USER_DATA);
app.setName('Atrium');
if (process.platform === 'win32') app.setAppUserModelId('com.bilal.atrium');
const IS_MAC = process.platform === 'darwin';
let startHidden = process.argv.includes('--hidden');
if (!process.env.ATRIUM_E2E && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const { Library, readJSON, writeJSON } = require('./core/site');
const R = require('./core/render');
const EX = require('./core/exporters');
const TH = require('./core/theme');
const { Preview } = require('./preview');
const capture = require('./capture');
const connectors = require('./connectors');
const ai = require('./ai');
const llm = require('./llm');
const publish = require('./publish');
const assets = require('./assets');
const { makeImporter } = require('./importer');
const { makeHandlers } = require('./mcp-handlers');
const { guideText } = require('../mcp/guide');

// ───────── settings (keys are encrypted with the system keychain and never sent to the window)
const USER = app.getPath('userData');
const SETTINGS = path.join(USER, 'settings.json');
const DEFAULTS = { theme: 'system', sitesDir: '', activeSite: null, device: 'desktop', aiProvider: 'claude-code', models: {}, bases: {}, keys: {}, netlify: '', onboarded: false, editorPanel: 'layers', recent: [] };
let settings = { ...DEFAULTS, ...readJSON(SETTINGS, {}) };
const saveSettings = () => writeJSON(SETTINGS, settings);
const enc = (v) => (!v ? '' : safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString('base64') : 'p:' + Buffer.from(v).toString('base64'));
const dec = (v) => { if (!v) return ''; try { return v.startsWith('p:') ? Buffer.from(v.slice(2), 'base64').toString() : safeStorage.decryptString(Buffer.from(v, 'base64')); } catch { return ''; } };
const publicSettings = () => { const { keys, netlify, ...rest } = settings; return { ...rest, hasKey: Object.fromEntries(Object.entries(keys || {}).map(([k, v]) => [k, !!v])), hasNetlify: !!netlify }; };

const sitesRoot = () => settings.sitesDir || process.env.ATRIUM_SITES || path.join(app.getPath('documents'), 'Atrium');
const lib = new Library(sitesRoot());
let win = null; let selection = null;
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };

// ───────── the open site
let current = null; let unsub = null;
function active() {
  if (current) return current;
  if (settings.activeSite && fs.existsSync(path.join(settings.activeSite, 'atrium.json'))) { try { return attach(lib.open(settings.activeSite)); } catch {} }
  const list = lib.list(); if (list.length) return attach(lib.open(list[0].dir));
  return attach(lib.create({ name: 'My first site', template: firstTemplate() }));
}
function firstTemplate() { try { const T = require('./core/templates').TEMPLATES; return (T.find((t) => /saas|product/.test(t.id)) || T[0] || {}).id; } catch { return undefined; } }
function attach(site) {
  if (unsub) unsub(); current = site; settings.activeSite = site.dir; settings.recent = [site.dir, ...(settings.recent || []).filter((d) => d !== site.dir)].slice(0, 8); saveSettings();
  unsub = site.onChange((e) => onSiteChange(site, e));
  return site;
}
function setActive(dir) { const s = lib.open(dir); attach(s); preview && preview.broadcast({ type: 'reload' }); send('site:switched', s.summary()); return s; }
let thumbTimer = null;
function onSiteChange(site, e) {
  if (site !== current) return;
  if (e.theme) preview.broadcast({ type: 'css' });
  else if (e.hot && e.section && !e.full) preview.broadcast({ type: 'section', id: e.section, nonce: e.nonce || null });
  else if (!e.assets) preview.broadcast({ type: 'reload' });
  send('site:changed', { ...e, at: Date.now() });
  clearTimeout(thumbTimer); thumbTimer = setTimeout(() => makeThumb(site), 4000);
}
async function makeThumb(site) { try { const b = await capture.thumb(preview.pageUrl(site, 'index')); if (b) { fs.mkdirSync(site.p('.atrium'), { recursive: true }); fs.writeFileSync(site.p('.atrium', 'thumb.jpg'), b); send('thumbs:changed', site.id); } } catch {} }

// ───────── preview, AI plumbing
const preview = new Preview({ getSite: () => current, overlayDir: path.join(__dirname, 'renderer'), onVisit: (v) => send('lan:visit', v) });
const activity = (msg, ref) => send('ai:activity', { msg, ref: ref || null, at: Date.now() });
const importer = makeImporter({ lib, capture });
const handle = makeHandlers({ lib, active, setActive, capture, preview, selection: () => selection, activity, publish, assets, importer, settings: () => ({ netlifyToken: () => dec(settings.netlify) }) });

// ───────── window
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 700, show: false, title: 'Atrium',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b10' : '#f6f5f2',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ecebf2' : '#1b1a22', height: 46 },
    trafficLightPosition: { x: 16, y: 17 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  nativeTheme.on('updated', () => { if (!IS_MAC && win && !win.isDestroyed()) try { win.setTitleBarOverlay({ symbolColor: nativeTheme.shouldUseDarkColors ? '#ecebf2' : '#1b1a22' }); } catch {} });
}
function showWindow() { if (IS_MAC && app.dock) app.dock.show(); startHidden = false; if (!win || win.isDestroyed()) { createWindow(); return; } win.show(); win.focus(); }
function applyTheme() { nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system'; }
function appMenu() {
  const go = (v) => () => { showWindow(); send('nav', v); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(IS_MAC ? [{ role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [{ label: 'New site…', accelerator: 'CmdOrCtrl+N', click: go('new-site') }, { label: 'New page…', accelerator: 'CmdOrCtrl+Shift+N', click: go('new-page') }, { label: 'All sites', accelerator: 'CmdOrCtrl+Shift+H', click: go('home') }, { type: 'separator' }, { label: 'Import a website…', click: go('import') }, { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: go('export') }, { label: 'Publish…', accelerator: 'CmdOrCtrl+Shift+P', click: go('publish') }, { type: 'separator' }, IS_MAC ? { role: 'close' } : { role: 'quit' }] },
    { label: 'Edit', submenu: [{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('nav', 'undo') }, { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('nav', 'redo') }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ label: 'Desktop', accelerator: 'CmdOrCtrl+1', click: go('device:desktop') }, { label: 'Tablet', accelerator: 'CmdOrCtrl+2', click: go('device:tablet') }, { label: 'Phone', accelerator: 'CmdOrCtrl+3', click: go('device:phone') }, { type: 'separator' }, { label: 'Edit / Preview mode', accelerator: 'CmdOrCtrl+P', click: go('toggle-mode') }, { label: 'Ask AI', accelerator: 'CmdOrCtrl+K', click: go('ai') }, { label: 'Check quality', accelerator: 'CmdOrCtrl+Shift+A', click: go('audit') }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

// ───────── IPC
function h(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } }); }
const S = () => active();
async function viaTool(name, args) { const r = await handle(name, args, 'you'); if (r.isError) throw new Error(r.content[0].text.replace(/^Error: /, '')); const t = r.content.find((x) => x.type === 'text'); try { return JSON.parse(t.text); } catch { return t ? t.text : null; } }

h('app:info', () => ({ version: app.getVersion(), platform: process.platform, home: os.homedir(), userData: USER, sitesRoot: sitesRoot(), previewPort: preview.port }));
h('settings:get', () => publicSettings());
h('settings:set', (patch) => { delete patch.keys; delete patch.netlify; settings = { ...settings, ...patch }; saveSettings(); if ('theme' in patch) applyTheme(); if ('sitesDir' in patch) { lib.setRoot(sitesRoot()); current = null; send('site:switched', active().summary()); } return publicSettings(); });
h('settings:key', (provider, key) => { settings.keys = { ...(settings.keys || {}), [provider]: enc(String(key || '').trim()) }; saveSettings(); return publicSettings(); });
h('settings:netlify', (t) => { settings.netlify = enc(String(t || '').trim()); saveSettings(); return publicSettings(); });

// library
h('library:all', () => { const { SECTIONS, CATEGORIES } = require('./core/sections'); const { TEMPLATES } = require('./core/templates'); const { PRESETS, FONTS, FONT_PAIRS } = require('./core/presets'); const { ICONS } = require('./core/site-icons'); return { sections: SECTIONS, categories: CATEGORIES, templates: TEMPLATES.map(({ pages, posts, ...t }) => ({ ...t, pages: pages.map((p) => ({ slug: p.slug, title: p.title, sections: p.sections.length })), posts: (posts || []).length })), presets: PRESETS, fonts: FONTS, pairs: FONT_PAIRS, icons: Object.keys(ICONS), formats: EX.FORMATS, providers: llm.PROVIDERS }; });
h('library:previewUrl', (type, preset) => preview.url(`__atrium/lib/${encodeURIComponent(type)}${preset ? '?preset=' + encodeURIComponent(preset) : ''}`));

// sites
h('sites:list', () => lib.list());
h('sites:create', (o) => { const s = lib.create(o || {}); setActive(s.dir); return s.summary(); });
h('sites:open', (dir) => setActive(dir).summary());
h('sites:duplicate', (dir) => lib.duplicate(dir).summary());
h('sites:trash', (dir) => { const was = current && current.dir === dir; lib.trash(dir); if (was) { current = null; send('site:switched', active().summary()); } return true; });
h('sites:rename', (name) => { S().setSettings({ name }, 'you'); return S().summary(); });
h('sites:reveal', (dir) => { shell.openPath(dir || S().dir); return true; });
h('sites:thumb', (dir) => { const f = path.join(dir, '.atrium', 'thumb.jpg'); return fs.existsSync(f) ? 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64') : null; });
h('site:get', () => ({ ...S().data, dir: S().dir }));
h('site:undo', () => S().undo());
h('site:redo', () => S().redo());
h('site:versions', () => S().versions());
h('site:restore', (id) => { S().restore(id); return true; });
h('site:checks', () => TH.themeChecks(S().data.theme));

// pages / sections (the window uses the same code paths as the AI)
h('pages:add', (o) => S().addPage(o || {}, 'you'));
h('pages:update', (id, patch) => S().updatePage(id, patch, 'you'));
h('pages:remove', (id) => S().removePage(id, 'you'));
h('pages:move', (id, to) => S().movePage(id, to, 'you'));
h('pages:duplicate', (id) => { const p = S().page(id); return S().addPage({ title: p.title + ' copy', nav: false, template: p.id, seo: { ...p.seo } }, 'you'); });
h('sections:add', (pageRef, spec, pos) => S().addSection(pageRef, spec, pos, 'you'));
h('sections:update', (id, patch, nonce) => { const s = S(); const f = s.find(id); const sec = f.section; s.mutate(patch._label || `Edit ${sec.name}`, 'you', () => { for (const k of ['html', 'css', 'js', 'name']) if (patch[k] != null) sec[k] = String(patch[k]); }, { section: sec.id, page: f.page && f.page.id, hot: !('js' in patch), nonce }); return sec; });
h('sections:remove', (id) => S().removeSection(id, 'you'));
h('sections:move', (id, to) => S().moveSection(id, to, 'you'));
h('sections:duplicate', (id) => S().duplicateSection(id, 'you'));
h('sections:check', (spec) => require('./mcp-handlers').checkSection(spec));
h('sections:render', (id, pageRef) => { const s = S(); const f = s.find(id); return R.renderSection(s, f.section, f.page || s.page(pageRef || 'index'), R.withDefaults({ mode: 'preview' })); });
h('theme:set', (patch) => S().setTheme(patch, 'you'));
h('theme:palette', (hex, mode) => TH.paletteFrom(hex, mode));
h('settings:site', (patch) => S().setSettings(patch, 'you'));
h('posts:save', (o) => S().upsertPost(o, 'you'));
h('posts:remove', (id) => S().removePost(id, 'you'));

// assets
h('assets:list', () => S().listAssets().map((a) => ({ ...a, used: S().assetUses(a.path) })));
h('assets:add', async (files) => { const out = []; for (const f of files) out.push(await assets.fromFile(S(), f)); return out; });
h('assets:url', async (url) => assets.fromUrl(S(), url));
h('assets:remove', (rel) => S().removeAsset(rel));
h('assets:favicon', (rel) => { const f = assets.favicon(S(), rel); S().setSettings({ favicon: f }, 'you'); return f; });
h('photos:search', async (q, orientation) => (await viaTool('search_photos', { query: q, count: 20, orientation })).results);

// preview
h('preview:url', (pageRef, edit) => preview.pageUrl(S(), pageRef, edit));
h('preview:post', (slug) => preview.url(`blog/${slug}.html`));
h('preview:lan', (on) => preview.setLan(!!on));
h('preview:open', (pageRef) => shell.openExternal(preview.pageUrl(S(), pageRef || 'index')));
h('selection:set', (sel) => { selection = sel; return true; });

// quality, export, publish
h('audit:run', (page) => viaTool('audit', { page: page || 'all' }));
h('export:formats', () => EX.FORMATS);
h('export:run', async (format, opts = {}) => { if (opts.ask) { const r = await dialog.showOpenDialog(win, { title: 'Export to…', properties: ['openDirectory', 'createDirectory'] }); if (r.canceled) return null; opts.dest = r.filePaths[0]; } return EX.exportSite(S(), format, opts); });
h('publish:netlify', () => publish.netlify(S(), dec(settings.netlify), (m) => send('publish:step', m)));
h('publish:github', (repo) => publish.github(S(), { repo }, (m) => send('publish:step', m)));
h('publish:status', () => ({ gh: !!ai.cli('gh'), git: !!ai.which('git'), netlify: !!settings.netlify, published: S().data.settings.publish || {} }));
h('import:run', async (p, name) => { const s = await importer(p, name); setActive(s.dir); return s.summary(); });
h('fetch:url', (url) => viaTool('fetch_url', { url, look: false }));

// AI: plugin + chat
h('connectors:status', () => connectors.connectorStatus());
h('connectors:desktop', () => connectors.connectDesktop());
h('connectors:code', () => connectors.connectCode());
h('connectors:codex', () => connectors.connectCodex());
h('ai:status', () => ({ claude: ai.cli('claude'), codex: ai.cli('codex'), bridge: connectors.status() }));
h('ai:models', async (provider) => { const p = llm.PROVIDERS.find((x) => x.id === provider); if (!p) throw new Error('Unknown provider'); return llm.listModels({ ...p, base: settings.bases[provider] || p.base }, dec(settings.keys[provider])); });
h('tool', (name, args) => viaTool(name, args));

const chats = new Map(); let chatCtl = null;
const chatFile = (site) => site.p('.atrium', 'chat.json');
function chatOf(site) { if (!chats.has(site.id)) chats.set(site.id, readJSON(chatFile(site), { history: [], log: [], sessions: {} })); return chats.get(site.id); }
function saveChat(site) { const c = chatOf(site); const lean = JSON.parse(JSON.stringify(c, (k, v) => (k === 'data' && typeof v === 'string' && v.length > 2000 ? undefined : v))); lean.history = lean.history.slice(-80); lean.log = lean.log.slice(-200); writeJSON(chatFile(site), lean); }
h('chat:get', () => chatOf(S()).log);
h('chat:clear', () => { const s = S(); chats.set(s.id, { history: [], log: [], sessions: {} }); saveChat(s); return true; });
h('chat:stop', () => { if (chatCtl) chatCtl.abort(); chatCtl = null; return true; });
h('chat:send', async (prompt, opts = {}) => {
  if (chatCtl) throw new Error('The AI is still working. Stop it first, or wait.');
  const site = S(); const c = chatOf(site); const provider = opts.provider || settings.aiProvider; const ctl = new AbortController(); chatCtl = ctl;
  const ev = (e) => { send('chat:event', e); if (e.kind === 'text' || e.kind === 'tool' || e.kind === 'tool-error') c.log.push({ ...e, at: Date.now() }); };
  c.log.push({ kind: 'user', text: prompt, at: Date.now() });
  let sel = '';
  if (selection && selection.section) { try { const f = site.find(selection.section); sel = `\nThe user has selected the section "${f.section.name}" (id ${f.section.id}) on ${f.page ? 'page ' + f.page.slug : 'the ' + f.where}${selection.element ? `, element: ${selection.element}` : ''}. "This section" means it.`; } catch {} }
  else if (selection && selection.page) sel = `\nThe user is looking at page "${selection.page}".`;
  try {
    let r;
    if (provider === 'claude-code' || provider === 'codex') {
      connectors.installScript(); const entry = connectors.connectorStatus().entry;
      const full = `${prompt}\n\n(You're inside the Atrium app, working on the open site "${site.name}". The user watches the live preview update as you work.${sel} Keep your final message short.)`;
      r = await ai.askAgent({ prompt: full, entry, cwd: path.join(USER, 'ask', site.id), signal: ctl.signal, provider: provider === 'codex' ? 'codex' : 'claude', resume: provider === 'claude-code' ? c.sessions.claude : null, onEvent: ev });
      if (r.session) c.sessions.claude = r.session;
    } else {
      const p = llm.PROVIDERS.find((x) => x.id === provider); if (!p) throw new Error('Choose an AI in Settings › AI');
      const system = `${guideText(libInfo())}\n\n## Right now\nOpen site: "${site.name}" (${site.data.pages.length} pages: ${site.data.pages.map((x) => x.slug).join(', ')}).${sel}\nToday is ${new Date().toDateString()}.`;
      r = await llm.runTurn({ provider: { ...p, base: settings.bases[provider] || p.base }, key: dec(settings.keys[provider]), model: settings.models[provider] || p.model, system, history: c.history, prompt, handle: (n, a, by) => handle(n, a, by), onEvent: ev, signal: ctl.signal });
    }
    c.log.push({ kind: 'done', text: r.text, at: Date.now() }); send('chat:event', { kind: 'done', text: r.text });
    return r;
  } catch (e) { const msg = /abort/i.test(e.name || '') || /Stopped/.test(e.message) ? 'Stopped' : e.message; c.log.push({ kind: 'error', text: msg, at: Date.now() }); send('chat:event', { kind: 'error', text: msg }); throw new Error(msg); }
  finally { chatCtl = null; saveChat(site); }
});
function libInfo() { const { SECTIONS } = require('./core/sections'); const { PRESETS } = require('./core/presets'); const { ICONS } = require('./core/site-icons'); return { sections: SECTIONS, presets: PRESETS, icons: Object.keys(ICONS) }; }

// files & shell
h('dialog:files', async (opts = {}) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(opts.multi ? ['multiSelections'] : []), ...(opts.folders ? ['openDirectory'] : [])], filters: opts.filters }); return r.canceled ? null : r.filePaths; });
h('dialog:folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
h('shell:open', async (p) => { if (/^https?:/.test(p)) return shell.openExternal(p); const e = await shell.openPath(p); if (e) throw new Error(e); return true; });
h('shell:reveal', (p) => { shell.showItemInFolder(p); return true; });
h('clipboard:write', (t) => { clipboard.writeText(String(t)); return true; });

// ───────── lifecycle
app.on('second-instance', (e, argv) => { if (!argv.includes('--hidden')) showWindow(); });
app.on('activate', () => showWindow());
app.on('will-quit', () => { connectors.stopBridge(); preview.stop(); });
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });

app.whenReady().then(async () => {
  try { if (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden) startHidden = true; } catch {}
  applyTheme(); appMenu();
  await preview.start();
  active();
  connectors.startBridge(handle, (st) => send('bridge:status', st));
  connectors.refreshInstalled();
  createWindow();
  if (startHidden && IS_MAC && app.dock) app.dock.hide();
});

// Dither — main process: the window, settings, projects, the effect sandbox, the local image engine, the
// Claude/Codex plugin bridge, and everything the window asks for.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, nativeImage, clipboard } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const png = require('./core/png');
const FX = require('./core/fxruntime');
const SP = require('./core/sprite');
const EX = require('./core/exporters');
const sheets = require('./core/sheets');
const snap = require('./core/pixelsnap');
const { LIB } = require('./core/fxlib');
const { Library, readJSON, writeJSON } = require('./core/project');
const fxhost = require('./fxhost');
const engine = require('./engine');
const connectors = require('./connectors');
const ai = require('./ai');
const { makeHandlers } = require('./mcp-handlers');

const IS_MAC = process.platform === 'darwin';
if (process.env.DITHER_USER_DATA) app.setPath('userData', process.env.DITHER_USER_DATA);
app.setName('Dither');
if (process.platform === 'win32') app.setAppUserModelId('com.bilal.dither');
let startHidden = process.argv.includes('--hidden');
if (!process.env.DITHER_E2E && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ───────────────────────── settings
const USER = app.getPath('userData');
const SETTINGS = path.join(USER, 'settings.json');
const DEFAULTS = { theme: 'system', projectsDir: '', activeProject: null, previewBg: 'checker', previewScale: 0, onionSkin: true, engineUrl: '', askProvider: 'auto', onboarded: false };
let settings = { ...DEFAULTS, ...readJSON(SETTINGS, {}) };
const saveSettings = () => writeJSON(SETTINGS, settings);
const projectsRoot = () => settings.projectsDir || process.env.DITHER_PROJECTS || path.join(app.getPath('documents'), 'Dither');
const lib = new Library(projectsRoot());
engine.setCustom(settings.engineUrl);

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
function active() {
  if (settings.activeProject) { try { return lib.get(settings.activeProject); } catch {} }
  const list = lib.list(); if (list.length) { settings.activeProject = list[0].id; saveSettings(); return lib.get(list[0].id); }
  const p = lib.create('My first project'); settings.activeProject = p.id; saveSettings(); return p;
}
function setActive(id) { settings.activeProject = lib.get(id).id; saveSettings(); send('project:switched', settings.activeProject); }

// pictures on disk → RGBA (PNG/JPG/WebP/BMP via the system; GIFs take their first frame)
function decodeImage(file) {
  if (/\.png$/i.test(file)) { try { return png.decode(fs.readFileSync(file)); } catch {} }
  const im = nativeImage.createFromPath(file); if (im.isEmpty()) throw new Error('Couldn’t read that picture: ' + path.basename(file));
  const { width: w, height: h } = im.getSize(); const bgra = im.toBitmap(); const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = bgra[i + 2]; d[i + 1] = bgra[i + 1]; d[i + 2] = bgra[i]; d[i + 3] = bgra[i + 3]; }
  return { w, h, data: d };
}
const render = (code, opts) => fxhost.render(code, opts);

// ───────────────────────── the plugin bridge
const changed = (kind, id) => send('changed', { kind, id, at: Date.now() });
const activity = (msg, ref) => send('ai:activity', { msg, ref: ref || null, at: Date.now() });
const handle = makeHandlers({ lib, active, setActive, render, webm: fxhost.webm, engine, decodeImage, changed, activity });

// ───────────────────────── window
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1080, minHeight: 680, show: false, title: 'Dither',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0b10' : '#f5f4f8',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ecebf2' : '#1b1a22', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
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
function showWindow() { if (IS_MAC && app.dock) app.dock.show(); startHidden = false; if (!win || win.isDestroyed()) { createWindow(); return; } if (!win.webContents.isLoading()) { win.show(); win.focus(); } else win.once('ready-to-show', () => win.show()); }
function applyTheme() { nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system'; }
function appMenu() {
  const go = (v) => () => { showWindow(); send('nav', v); };
  const t = [
    ...(IS_MAC ? [{ role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [{ label: 'New sprite…', accelerator: 'CmdOrCtrl+N', click: go('new-sprite') }, { label: 'New effect', accelerator: 'CmdOrCtrl+Shift+N', click: go('new-effect') }, { label: 'New project…', click: go('new-project') }, { type: 'separator' }, { label: 'Pixelize a picture…', click: go('pixelize') }, { type: 'separator' }, IS_MAC ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ label: 'Drafts', accelerator: 'CmdOrCtrl+1', click: go('drafts') }, { label: 'Effects', accelerator: 'CmdOrCtrl+2', click: go('effects') }, { label: 'Sprites', accelerator: 'CmdOrCtrl+3', click: go('sprites') }, { label: 'References', accelerator: 'CmdOrCtrl+4', click: go('refs') }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

// ───────────────────────── IPC
function h(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message || String(err), line: err.line }; } }); }
const P = () => active();

h('app:info', () => ({ version: app.getVersion(), platform: process.platform, home: os.homedir(), userData: USER, projectsRoot: projectsRoot(), palettes: FX.PALETTES, ramps: FX.RAMPS, ops: SP.OPS }));
h('settings:get', () => settings);
h('settings:set', (patch) => { settings = { ...settings, ...patch }; saveSettings(); if ('theme' in patch) applyTheme(); if ('projectsDir' in patch) { lib.setRoot(projectsRoot()); settings.activeProject = null; send('project:switched', active().id); } if ('engineUrl' in patch) engine.setCustom(settings.engineUrl); return settings; });

// projects
h('projects:list', () => ({ list: lib.list(), active: P().id }));
h('projects:create', (name) => { const p = lib.create(name || 'Untitled'); setActive(p.id); return p.summary(); });
h('projects:open', (id) => { setActive(id); return P().summary(); });
h('projects:rename', (id, name) => lib.rename(id, name).summary());
h('projects:reveal', (id) => { shell.openPath(lib.get(id || P().id).dir); return true; });
h('project:summary', () => ({ ...P().summary(), boards: P().meta.boards, refs: P().meta.refs }));

// effects
const effectOut = (m) => ({ ...m });
h('effects:list', () => P().listEffects());
h('effects:get', (id, v) => P().getEffect(id, v));
h('effects:create', ({ name, code, boardId, from }) => { const m = P().createEffect({ name, code, by: 'you', boardId, from }); changed('effect', m.id); return effectOut(m); });
h('effects:update', (id, { code, note, name }) => { const m = P().updateEffect(id, { code, note, name, by: 'you' }); changed('effect', m.id); return m; });
h('effects:patch', (id, patch) => { const m = P().patchEffect(id, patch); return m; });
h('effects:feedback', (id, patch) => { const m = P().feedback(id, patch); changed('feedback', m.id); return m; });
h('effects:remove', (id) => { P().removeEffect(id); changed('effect', id); return true; });
h('effects:duplicate', (id) => { const e = P().getEffect(id); const m = P().createEffect({ name: `${e.name} copy`, code: e.code, from: e.id }); changed('effect', m.id); return m; });
h('effects:keep', (id, kept = true) => { const m = P().patchEffect(id, { kept }); changed('effect', id); return m; });
h('fx:render', async (code, opts = {}) => { const r = await render(code, opts); return { meta: r.meta, frames: r.frames }; });
h('fx:renderEffect', async (id, opts = {}) => { const e = P().getEffect(id, opts.version); const r = await render(e.code, { params: { ...(e.params || {}), ...(opts.params || {}) }, seed: opts.seed }); return { meta: r.meta, frames: r.frames, version: e.version }; });
h('library:list', () => LIB);
h('library:add', (lid) => { const l = LIB.find((x) => x.id === lid); const m = P().createEffect({ name: l.name, code: l.code, from: 'library:' + l.id }); changed('effect', m.id); return m; });

// boards
h('boards:list', () => P().meta.boards);
h('boards:create', ({ idea, brief }) => { const b = P().createBoard({ idea, brief, by: 'you' }); changed('board', b.id); return b; });
h('boards:patch', (id, patch) => { const b = P().patchBoard(id, patch); changed('board', id); return b; });
h('boards:remove', (id) => { P().removeBoard(id); changed('board', id); return true; });

// sprites
h('sprites:list', () => P().listSprites());
h('sprites:get', (id) => P().getSprite(id));
h('sprites:frames', (id) => { const s = P().getSprite(id); return { meta: { w: s.w, h: s.h, n: s.frames.length, durations: s.frames.map((f) => f.duration), loop: true }, frames: SP.composeAll(s) }; });
h('sprites:create', (opts) => { const s = SP.create(opts); P().saveSprite(s); changed('sprite', s.id); return s; });
h('sprites:save', (s) => { P().saveSprite(SP.hydrate(s)); return { id: s.id, updatedAt: Date.now() }; });
h('sprites:remove', (id) => { P().removeSprite(id); changed('sprite', id); return true; });
h('sprites:duplicate', (id) => { const s = P().getSprite(id); s.id = SP.uid('s'); s.name = s.name + ' copy'; P().saveSprite(s); changed('sprite', s.id); return s.id; });
h('sprites:bake', async (effectId) => { const r = await handle('bake_effect', { effect: effectId }, 'you'); const j = JSON.parse(r.content[0].text); if (r.isError) throw new Error(r.content[0].text); return j.sprite; });
h('sprites:import', async (file, opts = {}) => {
  const img = decodeImage(file); let res = img, pal = null;
  if (opts.snap) { const r = snap.snap(img, opts); res = r.img; pal = r.palette; }
  if (res.w > 512 || res.h > 512) throw new Error(`That picture is ${res.w}×${res.h}. Pixelize it (or pick a target width) to bring it under 512×512.`);
  const s = SP.create({ name: opts.name || path.basename(file).replace(/\.[^.]+$/, ''), w: res.w, h: res.h, palette: pal && pal.length ? pal.slice(0, 64) : (sheets.colorsUsed([res.data]).length <= 64 ? sheets.colorsUsed([res.data]).map((c) => c.color) : 'pico8') });
  SP.setCel(s, s.layers[0].id, s.frames[0].id, res.data); P().saveSprite(s); changed('sprite', s.id); return s.id;
});
h('pixelize:preview', (file, opts = {}) => { const img = decodeImage(file); const r = snap.snap(img, opts); return { w: r.img.w, h: r.img.h, data: r.img.data, grid: r.grid, palette: r.palette, source: { w: img.w, h: img.h } }; });

// references
h('refs:add', (files) => { const out = []; for (const f of files) out.push(P().addRef(f)); changed('refs'); return out; });
h('refs:patch', (id, patch) => { const r = P().patchRef(id, patch); changed('refs'); return r; });
h('refs:remove', (id) => { P().removeRef(id); changed('refs'); return true; });
h('refs:path', (id) => { const r = P().meta.refs.find((x) => x.id === id); return r ? P().p('refs', r.file) : null; });

// record / export (shared with the plugin so both behave the same)
async function viaTool(name, args) { const r = await handle(name, args, 'you'); if (r.isError) throw new Error(r.content[0].text); return JSON.parse(r.content[0].text); }
h('record', (args) => viaTool('record', args));
h('export', async (args) => { if (args.ask) { const r = await dialog.showOpenDialog(win, { title: 'Export to…', properties: ['openDirectory', 'createDirectory'] }); if (r.canceled) return null; args.dest = r.filePaths[0]; } return viaTool('export', args); });
h('save:webm', async (frames, meta, name) => { const buf = await fxhost.webm(frames, meta, { scale: Math.max(2, Math.min(10, Math.floor(360 / Math.max(meta.w, meta.h)))) }); const f = P().uniqueFile(P().outDir('records'), EX.fileBase(name), '.webm'); fs.writeFileSync(f, buf); return f; });

// local model
h('engine:status', () => engine.status());
h('engine:installLora', async (dirs) => engine.installLora(dirs, (p) => send('engine:progress', p)));
h('engine:generate', async (o) => {
  const g = await engine.generate(o, (p) => send('engine:progress', p));
  const img = png.decode(g.png); const r = snap.snap(img, { width: o.size || undefined, colors: o.colors || undefined, palette: o.palette || undefined });
  const raw = P().uniqueFile(P().outDir('records'), `generated ${g.seed}`, '.png'); fs.writeFileSync(raw, g.png);
  return { raw, seed: g.seed, checkpoint: g.checkpoint, lora: g.lora, engine: g.engine, w: r.img.w, h: r.img.h, data: r.img.data, palette: r.palette, grid: r.grid };
});
h('engine:keep', ({ w, h: hh, data, palette, name, prompt, seed }) => { const s = SP.create({ name: name || 'Generated', w, h: hh, palette: palette && palette.length ? palette : 'pico8' }); SP.setCel(s, s.layers[0].id, s.frames[0].id, new Uint8ClampedArray(data)); s.from = { generated: { prompt, seed } }; P().saveSprite(s); changed('sprite', s.id); return s.id; });

// plugin & Ask
h('connectors:status', () => connectors.connectorStatus());
h('connectors:desktop', () => connectors.connectDesktop());
h('connectors:code', () => connectors.connectCode());
h('connectors:codex', () => connectors.connectCodex());
h('ai:status', () => ({ claude: ai.cli('claude'), codex: ai.cli('codex') }));
let asking = null;
h('ask:start', async (prompt) => {
  if (asking) throw new Error('Claude is already working on something. Stop it first.');
  connectors.installScript(); const entry = connectors.connectorStatus().entry; const ctl = new AbortController(); asking = ctl;
  const pr = P(); const full = `${prompt}\n\n(You're inside the Dither app. Work in the active project "${pr.name}". The user is watching the board/effects update live. Keep your final message short.)`;
  try { const r = await ai.askAgent({ prompt: full, entry, cwd: path.join(USER, 'ask'), signal: ctl.signal, provider: settings.askProvider, onEvent: (ev) => send('ask:event', ev) }); return r; }
  finally { asking = null; }
});
h('ask:stop', () => { if (asking) asking.abort(); asking = null; return true; });

// files
h('dialog:files', async (opts = {}) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])], filters: opts.filters }); return r.canceled ? null : r.filePaths; });
h('dialog:folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
h('shell:open', async (p) => { if (/^https?:/.test(p)) return shell.openExternal(p); const e = await shell.openPath(p); if (e) throw new Error(e); return true; });
h('shell:reveal', (p) => { shell.showItemInFolder(p); return true; });
h('clipboard:write', (t) => { clipboard.writeText(String(t)); return true; });
h('clipboard:image', (data, w, hh, scale = 1) => { const img = scale > 1 ? sheets.scaleImage({ w, h: hh, data: new Uint8ClampedArray(data) }, scale) : { w, h: hh, data: new Uint8ClampedArray(data) }; clipboard.writeImage(nativeImage.createFromBuffer(png.encode(img))); return true; });
h('image:dataUrl', (file) => { const ext = path.extname(file).slice(1).toLowerCase(); return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(file).toString('base64')}`; });

// ───────────────────────── lifecycle
app.on('second-instance', (e, argv) => { if (!argv.includes('--hidden')) showWindow(); });
app.on('activate', () => showWindow());
app.on('will-quit', () => { connectors.stopBridge(); fxhost.stop(); });
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });

app.whenReady().then(() => {
  try { if (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden) startHidden = true; } catch {}
  applyTheme(); appMenu(); active();
  connectors.startBridge(handle, (st) => send('bridge:status', st));
  connectors.refreshInstalled();
  fxhost.start();
  createWindow();
  if (startHidden && IS_MAC && app.dock) app.dock.hide();
});

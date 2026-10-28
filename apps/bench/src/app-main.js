// Bench — main process: the window, settings, desks and runs, the Claude bridge, the live view and everything the
// window asks for.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, nativeTheme, clipboard, Tray, Menu, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const host = require('./core/host');
const appsCore = require('./core/apps');
const { readJson, writeJson } = require('./core/store');
const { DeskManager, KINDS } = require('./core/desks');
const { Runs } = require('./core/runs');
const { Findings } = require('./core/findings');
const { TartEngine, IMAGES } = require('./core/tart');
const { WinSandboxEngine } = require('./core/winsandbox');
const { CommandSession } = require('./core/proc');
const { ElectronApp } = require('./core/electron-app');
const { cdpKeyEvents, keysymFor, MOD_KEYSYM } = require('./core/keys');
const connectors = require('./connectors');
const { makeHandlers } = require('./mcp-handlers');

const DEMO = process.env.BENCH_DEMO === '1';
if (process.env.BENCH_USER_DATA) app.setPath('userData', process.env.BENCH_USER_DATA);
app.setName('Bench');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const START_HIDDEN = process.argv.includes('--hidden');

if (!process.env.BENCH_USER_DATA && !app.requestSingleInstanceLock()) { app.quit(); }
else app.on('second-instance', () => showMain());

// ───────────────────────── paths and settings
const USER = app.getPath('userData');
const P = {
  settings: path.join(USER, 'settings.json'),
  engines: path.join(USER, 'engines'),
  tart: path.join(USER, 'vms'),
  captures: () => path.join(app.getPath('pictures'), 'Bench'),
  agent: () => { const p = path.join(__dirname, 'assets', 'bench-agent.ps1'); const u = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep); return fs.existsSync(u) ? u : p; },
};
const DEFAULTS = { theme: 'system', packageDir: null, defaultDesk: null, allowCommands: true, parallelApps: null, parallelTests: null, background: true, liveFps: 8, onboarded: false };
let settings = { ...DEFAULTS, ...readJson(P.settings, {}) };
const saveSettings = () => writeJson(P.settings, settings);
fs.mkdirSync(P.engines, { recursive: true });
if (!IS_WIN) { try { process.env.PATH = host.loginPath(); } catch {} }

// ───────────────────────── services
const pkgDir = () => appsCore.packageDir(settings.packageDir);
const limits = () => { const l = host.suggested(); return { apps: settings.parallelApps || l.apps, tests: settings.parallelTests || l.tests }; };
const shellCmd = () => ({ exec: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
function installDeps(dir, onLine = () => {}) {
  const s = new CommandSession({ id: 'npm', command: 'npm install --no-audit --no-fund', cwd: dir });
  s.on('log', (e) => onLine(e.text)); s.start();
  return s.wait(20 * 60000).then((r) => { if (r.code !== 0) throw new Error(`npm install failed in ${dir}:\n${r.output.slice(-1500)}`); return r; });
}
const tart = new TartEngine({ engineDir: P.engines, home: P.tart });
const winsb = new WinSandboxEngine();
const ctx = { pkgDir, shell: shellCmd, installDeps, agentSource: P.agent(), defaultDesk: () => settings.defaultDesk, limits };
const desks = new DeskManager({ dataDir: USER, ctx, tart, winsb });
const runs = new Runs({ dataDir: USER, ctx });
const findings = new Findings(USER);
const encode = (buffer, mime) => {
  if (mime === 'image/png' && buffer.length > 900 * 1024) { const img = nativeImage.createFromBuffer(buffer); if (!img.isEmpty()) return { data: img.toJPEG(82).toString('base64'), mime: 'image/jpeg' }; }
  return { data: buffer.toString('base64'), mime };
};
const handle = makeHandlers({ desks, runs, findings, tart, winsb, host: () => host.info(), pkgDir, settings: () => settings, encode });

// ───────────────────────── windows
let mainWin = null; let tray = null; let quitting = false;
function broadcast(ch, data) { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, data); }
function createMain(show = true) {
  mainWin = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 640, show: false,
    title: 'Bench', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0b10' : '#f6f5f8',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e9e6ef' : '#1d1a24', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => { if (show) mainWin.show(); });
  mainWin.on('close', (e) => { if (!quitting && settings.background && tray) { e.preventDefault(); mainWin.hide(); if (IS_MAC && app.dock) app.dock.hide(); } });
  mainWin.on('closed', () => { mainWin = null; stopAllLive(); });
  mainWin.on('hide', () => stopAllLive());
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}
function showMain() {
  if (IS_MAC && app.dock) app.dock.show();
  if (!mainWin) createMain(true); else { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
}
function trayIcon() {
  const f = IS_MAC ? 'trayTemplate.png' : 'tray.png';
  const p = path.join(__dirname, '..', 'build', f);
  const img = fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 18, height: 18 });
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}
function buildTray() {
  if (tray) return;
  try { tray = new Tray(trayIcon()); } catch { tray = null; return; }
  tray.setToolTip('Bench');
  tray.on('click', () => { if (!IS_MAC) showMain(); });
  updateTray();
}
function updateTray() {
  if (!tray) return;
  const st = connectors.status(); const running = desks.list().reduce((n, d) => n + d.sessions.filter((s) => s.state !== 'exited').length, 0);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Bench', click: showMain },
    { type: 'separator' },
    { label: st.connected ? `${st.client || 'Claude'} is connected` : 'Claude isn’t connected right now', enabled: false },
    { label: running ? `${running} running on desks` : 'Nothing running', enabled: false },
    { label: 'Close everything on desks', enabled: running > 0, click: () => desks.stopAll() },
    { type: 'separator' },
    { label: 'Quit Bench', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ───────────────────────── events → window
desks.on('changed', () => { broadcast('desks:changed'); updateTray(); });
desks.on('sessions', ({ id }) => { broadcast('desk:sessions', { id }); updateTray(); });
desks.on('desk-state', (s) => broadcast('desk:state', s));
desks.on('activity', (e) => broadcast('desk:activity', e));
desks.on('log', (e) => broadcast('desk:log', { desk: e.desk, session: e.session, entry: e.entry }));
desks.on('dialog', (e) => broadcast('desk:dialog', e));
runs.on('changed', (e) => broadcast('runs:changed', { id: e.id }));
findings.on('changed', (e) => broadcast('findings:changed', e));

// ───────────────────────── live view: frames of what's on a desk, and your mouse and keys back to it
const live = new Map(); // webContents id → { desk, session, win, timer, busy, seq }
function stopLive(wcId) { const l = live.get(wcId); if (l) { clearTimeout(l.timer); live.delete(wcId); } }
function stopAllLive() { for (const k of [...live.keys()]) stopLive(k); }
async function liveTick(wc, l) {
  if (!live.has(wc.id) || wc.isDestroyed()) return;
  const interval = Math.round(1000 / Math.max(1, Math.min(20, settings.liveFps || 8)));
  try {
    const d = desks.rt(l.desk);
    if (d.rec.kind === 'sandbox') {
      let a = null; try { a = d.app(l.session || undefined); } catch {}
      if (a && a.running && a.controlled) {
        const ws = await a.windows();
        const win = (l.win && ws.find((w) => w.id === l.win)) || ws.find((w) => w.visible && w.focused) || ws.filter((w) => w.visible).sort((x, y) => y.id - x.id)[0];
        if (win) {
          const s = await a.screenshot(win.id, { maxWidth: Math.min(2400, Math.round(win.width * (l.dpr || 1))), jpeg: true, quality: 74, native: (l.dpr || 1) > 1 });
          a.lastShot.delete(win.id); // the live view mustn't change the scale Claude's coordinates use
          wc.send('live:frame', { desk: l.desk, session: a.id, win: win.id, title: win.title, windows: ws, url: `data:image/jpeg;base64,${s.buffer.toString('base64')}`, width: s.width, height: s.height, winWidth: win.width, winHeight: win.height });
        } else wc.send('live:frame', { desk: l.desk, session: a.id, windows: ws, empty: 'No window open' });
      } else wc.send('live:frame', { desk: l.desk, empty: a ? (a.controlled ? `${a.name} has quit` : `${a.name} runs without a view`) : 'Nothing running' });
    } else if (d.state === 'running') {
      if (d.frameRgba) {
        const f = d.frameRgba();
        if (f && f.seq !== l.seq) {
          l.seq = f.seq;
          const bgra = Buffer.allocUnsafe(f.data.length);
          for (let i = 0; i < f.data.length; i += 4) { bgra[i] = f.data[i + 2]; bgra[i + 1] = f.data[i + 1]; bgra[i + 2] = f.data[i]; bgra[i + 3] = 255; }
          let img = nativeImage.createFromBitmap(bgra, { width: f.width, height: f.height });
          if (f.width > 1600) img = img.resize({ width: 1600 });
          const sz = img.getSize();
          wc.send('live:frame', { desk: l.desk, url: `data:image/jpeg;base64,${img.toJPEG(74).toString('base64')}`, width: sz.width, height: sz.height, screenWidth: f.width, screenHeight: f.height });
        }
      } else {
        const s = await d.screenshot({ maxSide: 1600, jpeg: true });
        wc.send('live:frame', { desk: l.desk, url: `data:image/jpeg;base64,${s.buffer.toString('base64')}`, width: s.width, height: s.height, screenWidth: (d.size || {}).width, screenHeight: (d.size || {}).height });
        l.slow = true;
      }
    } else wc.send('live:frame', { desk: l.desk, empty: d.state === 'starting' ? (d.detail || 'Starting…') : 'Stopped' });
  } catch (e) { if (!wc.isDestroyed()) wc.send('live:frame', { desk: l.desk, empty: e.message, error: true }); }
  if (live.has(wc.id)) l.timer = setTimeout(() => liveTick(wc, l), l.slow ? Math.max(interval, 700) : interval);
}
ipcMain.on('live:watch', (e, o) => { stopLive(e.sender.id); const l = { desk: o.desk, session: o.session || null, win: o.win || null, seq: -1, dpr: Math.min(2, o.dpr || 1) }; live.set(e.sender.id, l); liveTick(e.sender, l); });
ipcMain.on('live:unwatch', (e) => stopLive(e.sender.id));
let lastUserClick = 0;
ipcMain.on('live:input', async (e, ev) => {
  try {
    const d = desks.rt(ev.desk);
    if (d.rec.kind === 'sandbox') {
      const a = d.app(ev.session || undefined); const win = ev.win;
      if (ev.type === 'mouse') {
        const btn = ev.button === 2 ? 'right' : ev.button === 1 ? 'middle' : 'left';
        const t = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved' }[ev.action];
        await a.call('input', win, [{ method: 'Input.dispatchMouseEvent', params: { type: t, x: Math.round(ev.x), y: Math.round(ev.y), button: ev.action === 'move' && !ev.buttons ? 'none' : btn, buttons: ev.buttons || 0, clickCount: ev.clicks || 1, modifiers: ev.mods || 0 } }]);
        if (ev.action === 'down' && Date.now() - lastUserClick > 1200) { lastUserClick = Date.now(); desks.record(d.rec.id, { who: 'You', action: 'click', text: `Clicked in ${a.name}`, x: Math.round(ev.x), y: Math.round(ev.y), win, session: a.id, quiet: true }); }
      } else if (ev.type === 'wheel') {
        await a.call('input', win, [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: Math.round(ev.x), y: Math.round(ev.y), deltaX: ev.dx, deltaY: ev.dy } }]);
      } else if (ev.type === 'key') {
        const mods = (ev.alt ? 1 : 0) | (ev.ctrl ? 2 : 0) | (ev.meta ? 4 : 0) | (ev.shift ? 8 : 0);
        if (ev.action === 'down' && (ev.meta || ev.ctrl) && ev.key.length === 1) { await a.press(win, `${ev.meta ? 'cmd+' : ''}${ev.ctrl ? 'ctrl+' : ''}${ev.alt ? 'alt+' : ''}${ev.shift ? 'shift+' : ''}${ev.key.toLowerCase()}`); return; }
        if (ev.action === 'up' && (ev.meta || ev.ctrl) && ev.key.length === 1) return;
        const named = { Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' }[ev.key];
        let commands; if (named && IS_MAC) { try { commands = cdpKeyEvents(`${ev.shift ? 'shift+' : ''}${ev.alt ? 'alt+' : ''}${ev.meta ? 'cmd+' : ''}${named}`, { mac: true }).down.commands; } catch {} }
        const text = ev.action === 'down' && ev.key.length === 1 && !ev.ctrl && !ev.meta ? ev.key : ev.key === 'Enter' && ev.action === 'down' ? '\r' : undefined;
        await a.call('input', win, [{ method: 'Input.dispatchKeyEvent', params: { type: ev.action === 'up' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown', key: ev.key, code: ev.code, windowsVirtualKeyCode: ev.keyCode, nativeVirtualKeyCode: ev.keyCode, modifiers: mods, ...(text ? { text, unmodifiedText: text } : {}), ...(commands ? { commands } : {}) } }]);
      }
    } else if (d.state === 'running') {
      if (d.rfb) {
        if (ev.type === 'mouse') d.rfb.pointer(ev.x, ev.y, ev.buttonsMask || 0);
        else if (ev.type === 'wheel') await d.rfb.scroll(ev.x, ev.y, ev.dx, ev.dy);
        else if (ev.type === 'key') {
          const named = { Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ' ': 'Space' }[ev.key];
          const mod = { Shift: 'shift', Control: 'control', Alt: 'alt', Meta: 'meta' }[ev.key];
          const ks = mod ? MOD_KEYSYM[mod] : named ? keysymFor(named) : /^F\d+$/.test(ev.key) ? keysymFor(ev.key) : ev.key.length === 1 ? keysymFor(ev.key) : null;
          if (ks) d.rfb.keyEvent(ks, ev.action === 'down');
        }
      } else if (d.rec.kind === 'windows-sandbox') {
        if (ev.type === 'mouse' && (ev.action === 'down' || ev.action === 'up')) await d.button({ x: ev.x, y: ev.y, button: ev.button === 2 ? 'right' : 'left', down: ev.action === 'down' });
        else if (ev.type === 'wheel') await d.scroll({ x: ev.x / d.shotScale, y: ev.y / d.shotScale, dx: ev.dx, dy: ev.dy });
        else if (ev.type === 'key' && ev.action === 'down') { const k = ev.key === ' ' ? 'Space' : ev.key.replace(/^Arrow/, ''); if (!['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) await d.press({ keys: `${ev.ctrl ? 'ctrl+' : ''}${ev.alt ? 'alt+' : ''}${ev.meta ? 'win+' : ''}${ev.shift && k.length > 1 ? 'shift+' : ''}${k}` }); }
      }
    }
  } catch (err) { if (!e.sender.isDestroyed()) e.sender.send('toast', { kind: 'bad', title: 'That didn’t reach the desk', text: err.message }); }
});

// ───────────────────────── desk thumbnails (what each card shows)
const thumbs = new Map();
async function refreshThumbs() {
  if (!mainWin || !mainWin.isVisible()) return;
  for (const r of desks.list()) {
    try {
      const d = desks.liveIf(r.id); if (!d) continue;
      let url = null;
      if (r.kind === 'sandbox') { let a = null; try { a = d.app(); } catch {} if (a && a.running && a.controlled) { const ws = await a.windows(); const w = ws.find((x) => x.visible); if (w) { const s = await a.screenshot(w.id, { maxWidth: 560, jpeg: true, quality: 70 }); a.lastShot.delete(w.id); url = `data:image/jpeg;base64,${s.buffer.toString('base64')}`; } } }
      else if (d.state === 'running' && d.frameRgba) { const f = d.frameRgba(); if (f) { const bgra = Buffer.allocUnsafe(f.data.length); for (let i = 0; i < f.data.length; i += 4) { bgra[i] = f.data[i + 2]; bgra[i + 1] = f.data[i + 1]; bgra[i + 2] = f.data[i]; bgra[i + 3] = 255; } url = 'data:image/jpeg;base64,' + nativeImage.createFromBitmap(bgra, { width: f.width, height: f.height }).resize({ width: 560 }).toJPEG(70).toString('base64'); } }
      if (url !== (thumbs.get(r.id) || null)) { if (url) thumbs.set(r.id, url); else thumbs.delete(r.id); broadcast('desk:thumb', { id: r.id, url }); }
    } catch {}
  }
}

// ───────────────────────── IPC
function on(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } }); }
const deskView = (r) => ({ ...r, remote: r.remote ? { ...r.remote, vncPassword: r.remote.vncPassword ? '••••' : '', sshPassword: r.remote.sshPassword ? '••••' : '' } : undefined });
async function enginesStatus() {
  const t = await tart.status(); const w = winsb.status();
  let images = IMAGES.map((i) => ({ ...i, pulled: false }));
  if (t.installed) { try { images = await tart.images(); } catch {} }
  return { tart: t, winsb: w, images, kinds: KINDS };
}
on('app:init', async () => ({
  settings, platform: process.platform, arch: process.arch, version: app.getVersion(), demo: DEMO, host: host.info(), desks: desks.list().map(deskView), kinds: KINDS,
  claude: connectors.connectorStatus(), pkgDir: pkgDir(), home: os.homedir(), thumbs: Object.fromEntries(thumbs),
}));
on('settings:set', (patch) => {
  settings = { ...settings, ...patch }; saveSettings();
  if (patch.theme && mainWin) { nativeTheme.themeSource = patch.theme; }
  broadcast('settings:changed', settings); return settings;
});
on('host:info', () => ({ ...host.info(), limits: { ...host.suggested(), ...limits() } }));
on('desks:list', () => desks.list().map(deskView));
on('desks:create', (o) => deskView(desks.create(o)));
on('desks:update', (id, patch) => deskView(desks.update(id, patch)));
on('desks:remove', (id) => desks.remove(id));
on('desks:start', (id) => desks.start(id));
on('desks:stop', (id) => desks.stop(id));
on('desks:reset', (id) => desks.reset(id));
on('desks:saveClean', (id) => desks.saveClean(id));
on('desks:prepare', (id) => desks.prepare(id));
on('desks:activity', (id) => desks.activity(id));
on('desk:sessions', async (id) => {
  const d = desks.rt(id); if (d.rec.kind !== 'sandbox') return [];
  const list = d.sessions();
  for (const s of list) if (s.kind === 'electron' && s.state !== 'exited' && s.controlled) { try { s.windows = await d.app(s.id).windows(); s.dialogs = d.app(s.id).pendingDialogs(); } catch {} }
  return list;
});
on('desk:launch', async (id, spec) => {
  const d = await desks.ready(id);
  desks.record(d.rec.id, { who: 'You', action: 'launch', text: `Opening ${spec.app || spec.project || spec.path || spec.url || spec.file || spec.command}` });
  if (d.rec.kind === 'sandbox') { const r = await d.launch(spec, { onProgress: (p) => desks.record(d.rec.id, { who: 'Bench', action: 'progress', text: p.label }) }); desks.record(d.rec.id, { who: 'Bench', action: 'launched', text: `${r.session.name} is running`, session: r.session.id }); return r; }
  return d.launch(spec);
});
on('desk:quit', async (id, sid) => { const d = desks.rt(id); const s = await d.quit(sid); desks.record(d.rec.id, { who: 'You', action: 'stop', text: `Stopped ${s.name}`, session: sid }); return s; });
on('desk:forget', (id, sid) => desks.rt(id).forget(sid));
on('desk:logs', (id, sid, since = 0) => { const d = desks.rt(id); let buf = d.logs; if (sid && d.sessionsMap && d.sessionsMap.get(sid)) buf = d.sessionsMap.get(sid).logs; return { items: buf.query({ since, limit: 600 }), seq: buf.seq }; });
on('desk:answer', async (id, sid, ans) => { const a = desks.rt(id).app(sid); const r = await a.answerDialog(ans); desks.record(id, { who: 'You', action: 'dialog', text: `Answered a ${ans.kind} dialog`, session: sid }); return r; });
on('desk:visible', async (id, sid, visible) => { const a = desks.rt(id).app(sid); await a.setHidden(!visible); return true; });
on('desk:shot', async (id, sid, win) => {
  const d = desks.rt(id); const s = await d.screenshot({ session: sid || undefined, win: win || undefined, maxSide: 4000 });
  const dir = P.captures(); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${d.rec.name} ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.${s.mime === 'image/jpeg' ? 'jpg' : 'png'}`);
  fs.writeFileSync(f, s.buffer); shell.showItemInFolder(f); return f;
});
on('desk:folder', (id) => { const d = desks.rt(id); const p = d.paths ? d.paths.home : desks.dirOf(id); fs.mkdirSync(p, { recursive: true }); shell.openPath(p); return p; });
on('desk:run', async (id, command, cwd) => { const d = desks.rt(id); desks.record(d.rec.id, { who: 'You', action: 'command', text: `$ ${command}` }); const r = await d.run(command, { cwd, timeout: 15 * 60000 }); desks.record(d.rec.id, { who: 'Bench', action: 'command-done', text: `Exit code ${r.code}`, ok: r.code === 0 }); return r; });
on('desk:menu', async (id, sid) => desks.rt(id).app(sid).menu());
on('desk:menuClick', async (id, sid, p) => desks.rt(id).app(sid).menuClick(p));
on('catalog:apps', () => { const p = pkgDir(); return { pkgDir: p, installed: appsCore.installedSuite(p), projects: appsCore.projects(p) }; });
on('engines:status', enginesStatus);
on('engines:installTart', async () => { await tart.install((p) => broadcast('engines:progress', { key: 'tart', ...p })); broadcast('engines:progress', { key: 'tart', done: true }); return enginesStatus(); });
on('engines:pull', async (imageId) => { const im = IMAGES.find((i) => i.id === imageId); if (!im) throw new Error('Unknown system'); if (!tart.bin()) await tart.install((p) => broadcast('engines:progress', { key: imageId, ...p })); await tart.pull(im.ref, (p) => broadcast('engines:progress', { key: imageId, ...p })); broadcast('engines:progress', { key: imageId, done: true }); return enginesStatus(); });
on('engines:removeImage', async (imageId) => { await tart.removeImage(imageId); return enginesStatus(); });
on('engines:enableWinSandbox', () => winsb.enable());
on('runs:list', () => runs.list());
on('runs:get', (id) => runs.get(id));
on('runs:smoke', async (o) => { const r = await runs.smoke({ ...o, who: 'You' }); return { id: r.id }; });
on('runs:tests', async (o) => { const r = await runs.tests({ ...o, who: 'You' }); return { id: r.id }; });
on('runs:cancel', (id) => runs.cancel(id));
on('runs:remove', (id) => runs.remove(id));
on('file:dataUrl', (f) => { if (!f.startsWith(USER)) throw new Error('Not one of Bench’s files'); const b = fs.readFileSync(f); return `data:image/${/\.jpe?g$/i.test(f) ? 'jpeg' : 'png'};base64,${b.toString('base64')}`; });
on('findings:list', () => findings.list({}));
on('findings:update', (id, patch) => findings.update(id, patch));
on('findings:remove', (id) => findings.remove(id));
on('findings:copy', (id) => { const md = findings.markdown(id); clipboard.writeText(md); return md; });
on('findings:add', (o) => findings.add({ ...o, who: 'You' }));
on('claude:status', () => connectors.connectorStatus());
on('claude:connect', async (which) => { const r = which === 'desktop' ? connectors.connectDesktop() : which === 'code' ? await connectors.connectCode() : connectors.connectCodex(); return r; });
on('claude:disconnect', (which) => connectors.disconnect(which));
on('clipboard:write', (t) => { clipboard.writeText(String(t)); return true; });
on('shell:open', (p) => shell.openPath(p));
on('shell:reveal', (p) => { shell.showItemInFolder(p); return true; });
on('shell:url', (u) => { if (/^https?:/.test(u)) shell.openExternal(u); return true; });
on('dialog:save', async () => { const r = await dialog.showSaveDialog(mainWin, {}); return r.canceled ? null : r.filePath; });
on('dialog:pick', async (kind) => {
  const props = kind === 'folder' ? ['openDirectory'] : kind === 'app' ? (IS_MAC ? ['openFile', 'treatPackageAsDirectory'] : ['openFile']) : ['openFile'];
  const r = await dialog.showOpenDialog(mainWin, { properties: props.filter((x) => x !== 'treatPackageAsDirectory'), filters: kind === 'app' ? [{ name: 'Apps', extensions: IS_MAC ? ['app'] : ['exe'] }] : undefined });
  return r.canceled ? null : r.filePaths[0];
});

// ───────────────────────── start
async function demoSetup() {
  const { createFakeScreen } = require('./demo/fake-vnc');
  const screen1 = createFakeScreen({ password: 'bench', name: 'Demo desktop' }); const port = await screen1.listen(0);
  let vnc = desks.recs.all().find((r) => r.kind === 'vnc' && /demo/i.test(r.name));
  if (!vnc) vnc = desks.create({ name: 'Demo desktop', kind: 'vnc', host: '127.0.0.1', vncPort: port, vncPassword: 'bench', color: 'sky', notes: 'A pretend VNC screen for trying Bench' });
  else desks.update(vnc.id, { remote: { vncPort: port } });
  const sample = path.join(__dirname, '..', 'test', 'fixtures', 'sample-app');
  if (!findings.list({}).length && fs.existsSync(sample)) {
    findings.add({ title: 'Throw button raises “undefinedFunction is not defined”', severity: 'high', app: 'Sample', version: '1.2.3', deskName: 'Sandbox', steps: ['Open Sample', 'Click Throw'], expected: 'Nothing breaks', actual: 'The console shows Uncaught ReferenceError: undefinedFunction is not defined', who: 'Claude', logs: '[error] window w1: Uncaught ReferenceError: undefinedFunction is not defined' });
    findings.add({ title: 'Status line overlaps the list on small windows', severity: 'low', app: 'Sample', version: '1.2.3', deskName: 'Sandbox', steps: ['Resize the window to 600×400'], actual: 'The status text runs into the last to-do', who: 'Claude' });
  }
}
app.whenReady().then(async () => {
  nativeTheme.themeSource = settings.theme || 'system';
  desks.ensureDefault();
  if (DEMO) await demoSetup().catch((e) => console.error('demo', e));
  connectors.startBridge(handle, (st) => { broadcast('claude:status', { ...connectors.connectorStatus(), bridge: st }); updateTray(); });
  connectors.refreshInstalled();
  if (IS_MAC && process.arch === 'arm64') tart.stopStrays().catch(() => {});
  buildTray();
  createMain(!START_HIDDEN);
  if (START_HIDDEN && IS_MAC && app.dock) app.dock.hide();
  setInterval(refreshThumbs, 6000);
  setInterval(() => broadcast('host:tick', host.info()), 4000);
});
app.on('activate', () => showMain());
app.on('window-all-closed', () => { if (!settings.background || !tray) { quitting = true; app.quit(); } });
let cleaned = false;
app.on('before-quit', async (e) => {
  quitting = true;
  if (cleaned) return;
  e.preventDefault(); cleaned = true;
  connectors.stopBridge();
  await Promise.race([desks.stopAll(), new Promise((r) => setTimeout(r, 8000))]);
  app.quit();
});
module.exports = { ElectronApp };

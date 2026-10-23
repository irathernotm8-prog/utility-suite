// Touchline — main process
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu, clipboard } = require('electron');

const IS_MAC = process.platform === 'darwin';
app.setName('Touchline');
if (process.env.TOUCHLINE_USER_DATA) app.setPath('userData', process.env.TOUCHLINE_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const images = require('./data/images');
images.registerScheme();
const data = require('./data');
const store = require('./store');
const alerts = require('./alerts');

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
let win = null;
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };

function chrome(dark) {
  return { color: '#00000000', symbolColor: dark ? '#e6efe9' : '#14231b', height: 52 };
}

function createWindow() {
  const w = store.get().window || {};
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: w.width || 1380, height: w.height || 880, x: w.x, y: w.y, minWidth: 1040, minHeight: 660,
    title: 'Touchline', show: false, backgroundColor: dark ? '#0b120e' : '#f4f7f4',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : { titleBarStyle: 'hidden', titleBarOverlay: chrome(dark) }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  if (w.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (!win || win.isDestroyed()) return; store.get().window = { ...win.getNormalBounds(), maximized: win.isMaximized() }; store.save(); };
  win.on('resize', remember); win.on('move', remember);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

function applyTheme(theme) {
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
  if (win && !IS_MAC) try { win.setTitleBarOverlay(chrome(nativeTheme.shouldUseDarkColors)); } catch {}
}

/* ---------- IPC ---------- */
const wrap = (fn) => async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (err) { return { ok: false, error: err.message || String(err), status: err.status || 0 }; }
};

function register() {
  ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), tz: data.TZ, today: data.todayStr(), dark: nativeTheme.shouldUseDarkColors }));
  ipcMain.handle('app:open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:copy', (_e, text) => clipboard.writeText(String(text || '')));

  ipcMain.handle('store:get', () => store.publicState());
  ipcMain.handle('store:set', (_e, patch) => { const s = store.set(patch); if (patch && 'theme' in patch) applyTheme(patch.theme); if (patch && 'alerts' in patch) alerts.start(openMatch); return s; });
  ipcMain.handle('store:follow', (_e, kind, item) => { const s = store.toggleFollow(kind, item); if (kind === 'teams') alerts.start(openMatch); return s; });
  ipcMain.handle('store:reorder', (_e, kind, ids) => store.reorderFollow(kind, ids));

  ipcMain.handle('data:day', wrap((date, opts = {}) => data.matchDay(date, { ...opts, leagueIds: store.get().following.leagues.map((l) => l.id) })));
  ipcMain.handle('data:match', wrap((id, opts) => data.match(id, opts)));
  ipcMain.handle('data:catalog', wrap((opts) => data.catalog(opts)));
  ipcMain.handle('data:league', wrap((id, season, opts) => data.league(id, season, opts)));
  ipcMain.handle('data:leaders', wrap((url, opts) => data.leaders(url, opts)));
  ipcMain.handle('data:team', wrap((id, opts) => data.team(id, opts)));
  ipcMain.handle('data:player', wrap((id, opts) => data.player(id, opts)));
  ipcMain.handle('data:player-season', wrap((id, entry, opts) => data.playerSeason(id, entry, opts)));
  ipcMain.handle('data:search', wrap((term) => data.search(term)));
  ipcMain.handle('data:history', wrap((name, birthYear, opts) => data.history(name, birthYear, opts)));
  ipcMain.handle('data:legends', wrap(() => data.legends()));
  ipcMain.handle('data:status', () => ({ ...data.status }));
  ipcMain.handle('data:cache-info', () => { const a = data.cacheInfo(), b = images.size(); return { bytes: a.bytes + b.bytes, files: a.files + b.files, data: a, images: b }; });
  ipcMain.handle('data:cache-clear', () => { data.clearCache(); images.clear(); return true; });
}

function openMatch(id) {
  if (!win) createWindow();
  win.show(); win.focus();
  send('nav', { route: 'match', id });
}

function buildMenu() {
  const go = (route) => () => send('nav', { route });
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Search…', accelerator: 'CmdOrCtrl+K', click: () => send('menu', 'search') }, { type: 'separator' }, IS_MAC ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Matchday', accelerator: 'CmdOrCtrl+1', click: go('today') },
      { label: 'Competitions', accelerator: 'CmdOrCtrl+2', click: go('leagues') },
      { label: 'Following', accelerator: 'CmdOrCtrl+3', click: go('following') },
      { label: 'Legends', accelerator: 'CmdOrCtrl+4', click: go('legends') },
      { label: 'XI Builder', accelerator: 'CmdOrCtrl+5', click: go('builder') },
      { type: 'separator' },
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => send('menu', 'back') },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => send('menu', 'forward') },
      { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => send('menu', 'refresh') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  const ud = app.getPath('userData');
  store.load(ud);
  data.init(ud);
  images.handle(ud);
  applyTheme(store.get().theme);
  nativeTheme.on('updated', () => { if (win && !IS_MAC) try { win.setTitleBarOverlay(chrome(nativeTheme.shouldUseDarkColors)); } catch {} send('theme', nativeTheme.shouldUseDarkColors); });
  register();
  buildMenu();
  createWindow();
  alerts.start(openMatch);
  if (process.env.TOUCHLINE_E2E) { try { require('../test/e2e/drive')(win, process.env.TOUCHLINE_E2E); } catch (err) { console.error(err); } }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { store.flush(); if (!IS_MAC) app.quit(); });
app.on('before-quit', () => store.flush());

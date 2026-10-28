// Bench Browser — a plain window that shows one web page (or a local file / dev server) on a desk. Bench starts it
// like any other app and drives it the same way: screenshots, clicks, typing, console errors.
'use strict';
const { app, BrowserWindow, Menu, shell } = require('electron');

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
let url = arg('bench-url') || 'about:blank';
if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) url = 'https://' + url;
if (/^(\/|[A-Za-z]:\\)/.test(url)) url = 'file://' + url;
const [w, h] = (arg('bench-size') || '1280x800').split('x').map(Number);
app.setName('Bench Browser');

function open(u, opts = {}) {
  const win = new BrowserWindow({ width: w || 1280, height: h || 800, title: 'Bench Browser', backgroundColor: '#ffffff', show: false, ...opts, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(({ url: next }) => { if (/^https?:|^file:/.test(next)) { open(next, { width: 1100, height: 760 }); } else shell.openExternal(next); return { action: 'deny' }; });
  win.once('ready-to-show', () => win.show());
  win.loadURL(u).catch((e) => console.error(`Couldn’t open ${u}: ${e.message}`));
  return win;
}
app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ role: 'close' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Go', submenu: [{ label: 'Back', accelerator: 'CmdOrCtrl+[', click: (i, win) => win && win.webContents.navigationHistory.goBack() }, { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: (i, win) => win && win.webContents.navigationHistory.goForward() }] },
  ]));
  open(url);
});
app.on('window-all-closed', () => app.quit());

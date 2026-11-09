// Mixer — runs the hidden engine window (src/engine) and hands it jobs: render, analyze, draw, export. Restarts it if
// it ever goes away. Large results (audio files) come back as bytes and are written by the caller.
'use strict';
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

let win = null, ready = null, seq = 0; const waiting = new Map(); let onProgress = () => {};
function start() {
  if (win && !win.isDestroyed()) return ready;
  win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: path.join(__dirname, 'engine', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, offscreen: false } });
  ready = new Promise((res) => win.webContents.once('did-finish-load', res));
  win.loadFile(path.join(__dirname, 'engine', 'engine.html'));
  win.webContents.on('render-process-gone', () => { for (const [, w] of waiting) w.reject(new Error('The audio engine stopped. Try again.')); waiting.clear(); win = null; });
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 || process.env.MIXER_DEBUG) console.log('[engine]', msg); });
  win.on('closed', () => { win = null; });
  return ready;
}
ipcMain.on('job:done', (e, { id, ok, data }) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); clearTimeout(w.timer); ok ? w.resolve(data) : w.reject(new Error(data)); });
ipcMain.on('job:progress', (e, { id, msg }) => onProgress({ id, msg }));
async function job(kind, args, { timeout = 600 } = {}) {
  await start(); const id = ++seq;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`The audio engine took longer than ${timeout} s.`)); }, timeout * 1000); waiting.set(id, { resolve, reject, timer }); win.webContents.send('job', { id, kind, args }); });
}
const forget = (file) => { if (win && !win.isDestroyed()) win.webContents.send('audio:forget', file); };
function stop() { try { if (win && !win.isDestroyed()) win.destroy(); } catch {} win = null; }
module.exports = { start, job, stop, forget, setProgress: (f) => { onProgress = f; } };

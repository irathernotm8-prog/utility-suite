// Dither — runs effect code in a hidden, sandboxed window (Chromium's sandbox, no Node, no network, a worker with a
// time limit). Every render — from the window, from Claude's plugin, for exports — goes through here.
'use strict';
const path = require('path');
const { BrowserWindow, ipcMain, session } = require('electron');

let win = null, ready = null, seq = 0; const waits = new Map();
function start() {
  if (win && !win.isDestroyed()) return ready;
  const ses = session.fromPartition('dither-sandbox');
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|devtools|blob|data):/.test(d.url) }));   // no network at all
  win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: path.join(__dirname, 'sandbox', 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, session: ses, backgroundThrottling: false, offscreen: false } });
  ready = new Promise((res) => ipcMain.once('fx:ready', () => res()));
  win.loadFile(path.join(__dirname, 'sandbox', 'fx.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', () => { for (const [, w] of waits) w({ ok: false, error: 'The sandbox stopped. Try again.' }); waits.clear(); win = null; });
  return ready;
}
ipcMain.on('fx:result', (e, id, result) => { if (!win || e.sender !== win.webContents) return; const w = waits.get(id); if (w) { waits.delete(id); w(result); } });
async function job(kind, payload, timeoutMs = 15000) {
  await start(); const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { waits.delete(id); rej(new Error('The sandbox didn’t answer')); try { win.destroy(); } catch {} win = null; }, timeoutMs + 5000);
    waits.set(id, (r) => { clearTimeout(t); r && r.ok ? res(r) : rej(Object.assign(new Error((r && r.error) || 'Render failed'), { line: r && r.line })); });
    win.webContents.send('fx:job', { id, kind, ...payload, timeoutMs });
  });
}
async function render(code, opts = {}) { const r = await job('render', { code, opts }, opts.timeoutMs || 10000); return { meta: r.meta, frames: r.frames.map((b) => new Uint8ClampedArray(b)) }; }
async function webm(frames, meta, { scale = 6, bg = '#16141e', loops = 3 } = {}) { const r = await job('webm', { frames: frames.map((f) => f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength)), w: meta.w, h: meta.h, durations: meta.durations, scale, bg, loops }, 60000); return Buffer.from(r.data); }
function stop() { try { win && win.destroy(); } catch {} win = null; }
module.exports = { start, render, webm, stop };

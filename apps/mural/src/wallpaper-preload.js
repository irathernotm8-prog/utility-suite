// Mural — preload for wallpaper windows: a narrow bridge, the page can only receive its wallpaper and input and report
// its frame stats or an error.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const arg = process.argv.find((a) => a.startsWith('--mural-display='));
const display = arg ? arg.slice('--mural-display='.length) : '';
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); };
contextBridge.exposeInMainWorld('muralHost', {
  display,
  onLoad: on('wp:load'), onPointer: on('wp:pointer'), onClick: on('wp:click'), onPause: on('wp:pause'), onResume: on('wp:resume'), onQuality: on('wp:quality'), onSettings: on('wp:settings'),
  stats: (s) => ipcRenderer.send('wp:stats', display, s),
  error: (m) => ipcRenderer.send('wp:error', display, String(m))
});

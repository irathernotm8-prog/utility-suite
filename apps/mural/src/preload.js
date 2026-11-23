// Mural — preload for the app window. Everything goes through call(name, ...args) to the API table in main.js.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('mural', {
  call: (name, ...args) => ipcRenderer.invoke('mural:call', name, ...args),
  on: (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('mural:' + ch, h); return () => ipcRenderer.removeListener('mural:' + ch, h); },
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return null; } },
  platform: process.platform
});

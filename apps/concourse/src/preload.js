'use strict';
// Concourse — the bridge. The window never touches Node: it calls the api table in main.js and listens for pushes.
const { contextBridge, ipcRenderer } = require('electron');
const model = require('./core/model');

contextBridge.exposeInMainWorld('concourse', {
  call: (name, arg) => ipcRenderer.invoke('call', name, arg),
  on: (ch, fn) => {
    if (!['state', 'messages', 'messages-error', 'go', 'cmd', 'toast'].includes(ch)) return () => {};
    const h = (_e, ...a) => fn(...a); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h);
  },
  model,
  platform: process.platform,
});

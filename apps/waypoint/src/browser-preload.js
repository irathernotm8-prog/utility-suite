// Waypoint — bridge for the booking browser's toolbar.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wpb', {
  cmd: (c, a) => ipcRenderer.invoke('browser', c, a),
  on: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
});

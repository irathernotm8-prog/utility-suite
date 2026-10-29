// Dither — the sandbox window's only link to the app: receive jobs, send results. No Node, no files.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sandbox', {
  onJob: (fn) => ipcRenderer.on('fx:job', (e, job) => fn(job)),
  reply: (id, result) => ipcRenderer.send('fx:result', id, result),
  ready: () => ipcRenderer.send('fx:ready'),
});

// Mixer — the hidden engine window's bridge: jobs in, results out, audio bytes on request.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mixerEngine', {
  onJob: (fn) => ipcRenderer.on('job', (e, j) => fn(j)),
  done: (id, ok, data) => ipcRenderer.send('job:done', { id, ok, data }),
  progress: (id, msg) => ipcRenderer.send('job:progress', { id, msg }),
  readAudio: async (file) => { const r = await ipcRenderer.invoke('audio:read', file); if (!r || !r.ok) throw new Error(r ? r.error : 'No answer'); return r.data; },
  forget: (fn) => ipcRenderer.on('audio:forget', (e, f) => fn(f)),
});

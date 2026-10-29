// The windows' only door to the system: a small, named API.
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke('helm:' + ch, ...a).then((r) => { if (r && r.ok === false) throw new Error(r.error); return r ? r.data : undefined; });
const on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('helm:' + ch, h); return () => ipcRenderer.removeListener('helm:' + ch, h); };
contextBridge.exposeInMainWorld('helm', { call, on });

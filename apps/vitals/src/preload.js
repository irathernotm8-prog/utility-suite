// The window's only door to the system: a small, named API.
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke('vitals:' + ch, ...a).then((r) => { if (r && r.ok === false) throw new Error(r.error); return r ? r.data : undefined; });
const on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('vitals:' + ch, h); return () => ipcRenderer.removeListener('vitals:' + ch, h); };
contextBridge.exposeInMainWorld('vitals', { call, on });

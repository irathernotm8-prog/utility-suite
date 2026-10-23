// The windows' only door to the system: a small, named API.
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke('scene:' + ch, ...a).then((r) => { if (r && r.ok === false) throw new Error(r.error); return r ? r.data : undefined; });
const on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('scene:' + ch, h); return () => ipcRenderer.removeListener('scene:' + ch, h); };
contextBridge.exposeInMainWorld('scene', { call, on });

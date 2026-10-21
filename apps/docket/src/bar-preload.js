const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bar', {
  onState: (fn) => ipcRenderer.on('bar:state', (_e, s) => fn(s)),
  cmd: (c) => ipcRenderer.send('bar:cmd', c)
});

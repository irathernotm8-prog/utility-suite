const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bar', {
  state: () => ipcRenderer.invoke('bar:state'),
  onState: (fn) => ipcRenderer.on('bar:state', (_e, s) => fn(s)),
  setTarget: (id) => ipcRenderer.send('bar:target', id),
  capture: (mode) => ipcRenderer.send('bar:capture', mode),
  openApp: () => ipcRenderer.send('bar:open-app'),
  close: () => ipcRenderer.send('bar:close')
});

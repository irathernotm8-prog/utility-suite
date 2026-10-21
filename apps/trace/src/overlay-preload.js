const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  init: () => ipcRenderer.invoke('overlay:init'),
  done: (rect) => ipcRenderer.send('overlay:done', rect)
});

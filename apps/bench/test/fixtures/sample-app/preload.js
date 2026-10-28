const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', { open: () => ipcRenderer.invoke('open'), ask: () => ipcRenderer.invoke('ask'), boom: () => ipcRenderer.invoke('boom'), on: (c, f) => ipcRenderer.on(c, (e, d) => f(d)) });

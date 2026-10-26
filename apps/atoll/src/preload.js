// Atoll — the windows' bridge to the main process. Pages never touch the disk or network themselves.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('atoll', {
  call: (name, ...args) => ipcRenderer.invoke('atoll', name, args),
  on: (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('atoll:' + ch, h); return () => ipcRenderer.removeListener('atoll:' + ch, h); },
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  drag: (id) => ipcRenderer.send('atoll:drag', id)
});

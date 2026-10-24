// Waypoint — bridge between the window and the main process. The window never touches Node directly.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (method, ...a) => {
  const r = await ipcRenderer.invoke('call', method, ...a);
  if (!r || !r.ok) throw new Error(r ? r.error : 'No answer');
  return r.data;
};

contextBridge.exposeInMainWorld('waypoint', {
  call,
  on: (ch, fn) => { const l = (e, d) => fn(d); ipcRenderer.on(ch, l); return () => ipcRenderer.removeListener(ch, l); },
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return file && file.path; } },
  pending: () => ipcRenderer.sendSync('pending'),
  platform: process.platform,
});

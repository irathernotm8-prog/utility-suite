// Bridge between Bench's window and the main process. The window never touches Node directly.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = async (ch, ...a) => {
  const r = await ipcRenderer.invoke(ch, ...a);
  if (!r || !r.ok) throw new Error(r ? r.error : 'No answer');
  return r.data;
};

contextBridge.exposeInMainWorld('bench', {
  call: invoke,
  send: (ch, ...a) => ipcRenderer.send(ch, ...a),
  on: (ch, fn) => { const l = (e, d) => fn(d); ipcRenderer.on(ch, l); return () => ipcRenderer.removeListener(ch, l); },
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return file && file.path; } },
  platform: process.platform,
});

// Crate — the window's bridge to the main process
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r || !r.ok) { const e = new Error((r && r.error) || 'Something went wrong'); e.code = r && r.code; throw e; }
  return r.value;
};
const on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('crate', {
  call,
  on,
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  platform: process.platform
});

// Glean — the window's only door to the main process.
const { contextBridge, ipcRenderer } = require('electron');

const call = async (name, ...args) => {
  const r = await ipcRenderer.invoke('glean:' + name, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong');
  return r.data;
};
const EVENTS = ['collection', 'state', 'download', 'library', 'notice', 'scroll:done', 'batch:done', 'batch:add', 'sync'];

contextBridge.exposeInMainWorld('glean', {
  call,
  on(event, fn) {
    if (!EVENTS.includes(event)) throw new Error('Unknown event ' + event);
    const h = (_e, data) => fn(data);
    ipcRenderer.on('glean:' + event, h);
    return () => ipcRenderer.removeListener('glean:' + event, h);
  }
});

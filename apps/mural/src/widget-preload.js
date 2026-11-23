// Mural — preload for the widgets layer windows. The page can only lay widgets out, relay their calls, and report moves.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const arg = process.argv.find((a) => a.startsWith('--mural-display='));
const display = arg ? arg.slice('--mural-display='.length) : '';
const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, d) => fn(d));
contextBridge.exposeInMainWorld('muralLayer', {
  display,
  onLayout: on('wl:layout'), onPause: on('wl:pause'), onResume: on('wl:resume'),
  call: (id, name, args) => ipcRenderer.invoke('wl:call', display, id, name, args),
  move: (id, rect) => ipcRenderer.invoke('wl:move', display, id, rect),
  remove: (id) => ipcRenderer.invoke('wl:remove', display, id),
  settings: (id) => ipcRenderer.invoke('wl:settings', display, id),
  done: () => ipcRenderer.invoke('wl:done', display),
  front: (id) => ipcRenderer.invoke('wl:front', display, id)
});

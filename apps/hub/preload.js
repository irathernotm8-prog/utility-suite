'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('hub', {
  state: () => call('state'),
  install: (id) => call('install', id),
  installMany: (ids) => call('install-many', ids),
  uninstall: (id) => call('uninstall', id),
  open: (id) => call('open', id),
  reveal: (id) => call('reveal', id),
  refresh: () => call('refresh'),
  importPath: (p) => call('import', p),
  pickPackages: (kind) => call('pick-packages', kind),
  dismissSource: (stamp) => call('dismiss-source', stamp),
  installHub: (ids) => call('install-hub', ids),
  updateHub: () => call('update-hub'),
  removeHub: (removeApps) => call('remove-hub', removeApps),
  setSettings: (patch) => call('settings', patch),
  addWatchFolder: () => call('add-watch-folder'),
  removeWatchFolder: (p) => call('remove-watch-folder', p),
  removePackage: (id) => call('remove-package', id),
  showLibrary: () => call('show-library'),
  findOldCopies: () => call('find-old-copies'),
  removeOldCopies: (items) => call('remove-old-copies', items),
  pathForFile: (file) => webUtils.getPathForFile(file),
  on: (channel, cb) => {
    const ok = ['changed', 'progress', 'toast', 'menu'];
    if (!ok.includes(channel)) return () => {};
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});

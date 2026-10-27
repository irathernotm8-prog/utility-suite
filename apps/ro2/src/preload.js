// The only bridge between the page and the computer. Everything is a named call into main.js.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('ro2', {
  info: call('app:info'),
  setTheme: call('app:theme'),
  pendingOpen: call('app:pending-open'),
  readyToClose: () => ipcRenderer.send('app:ready-to-close'),
  onBeforeClose: on('app:before-close'),
  onOpenFiles: on('app:open-files'),
  onMenu: on('menu'),
  log: call('log'),
  settings: { get: call('settings:get'), set: call('settings:set') },
  shell: { open: call('shell:open'), reveal: call('shell:reveal') },
  designs: {
    list: call('designs:list'), load: call('designs:load'), save: call('designs:save'), rename: call('designs:rename'),
    duplicate: call('designs:duplicate'), remove: call('designs:delete'), chooseFolder: call('designs:choose-folder'), openDialog: call('designs:open-dialog'),
  },
  files: {
    openImages: call('files:open-images'), readImage: call('files:read-image'), convertImage: call('files:convert-image'),
    pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  },
  exporter: { choose: call('export:choose'), write: call('export:write'), writeIn: call('export:write-in'), pdf: call('export:pdf'), copyPng: call('export:copy-png') },
  clipboard: { readImage: call('clipboard:read-image') },
  brand: {
    get: call('brand:get'), setActive: call('brand:active'), create: call('brand:create'), update: call('brand:update'), remove: call('brand:remove'),
    addLogo: call('brand:add-logo'), removeLogo: call('brand:remove-logo'), logo: call('brand:logo'), pickLogos: call('brand:pick-logos'),
  },
  library: { search: call('library:search'), fetch: call('library:fetch') },
  models: { list: call('models:list'), download: call('models:download'), cancel: call('models:cancel'), remove: call('models:delete'), onProgress: on('models:progress') },
});

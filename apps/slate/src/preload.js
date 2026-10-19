// Slate — the bridge between the window and the main process
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

contextBridge.exposeInMainWorld('slate', {
  platform: process.platform,
  load: () => inv('store:get'),
  save: (partial) => inv('store:save', partial),
  paths: () => inv('app:paths'),
  catalog: () => inv('cards:catalog'),
  cardImage: { set: (cardId, filePath) => inv('cards:set-image', { cardId, filePath }), fromUrl: (cardId, url) => inv('cards:image-from-url', { cardId, url }), reset: (id) => inv('cards:reset-image', id), resetAll: () => inv('cards:reset-all-images'), overrides: () => inv('cards:image-overrides') },
  statements: {
    list: () => inv('statements:list'), folder: () => inv('statements:folder'), openFolder: () => inv('statements:open-folder'),
    open: (id) => inv('statements:open', id), show: (id) => inv('statements:show', id), update: (id, patch) => inv('statements:update', { id, patch }),
    reparse: (id) => inv('statements:reparse', id), file: (id, opts) => inv('statements:file', { id, ...opts }), unfile: (id) => inv('statements:unfile', id),
    trash: (id) => inv('statements:trash', id), importPaths: (paths) => inv('statements:import-paths', paths), pick: () => inv('statements:pick'),
    chooseFolder: () => inv('statements:choose-folder'), watchDownloads: (on) => inv('statements:watch-downloads', on)
  },
  browser: { prepare: () => inv('browser:prepare'), clear: () => inv('browser:clear'), savePdf: (wcId) => inv('browser:save-pdf', wcId) },
  reportPdf: (month) => inv('report:pdf', month),
  simplefin: { state: () => inv('simplefin:state'), connect: (token) => inv('simplefin:connect', token), sync: () => inv('simplefin:sync'), disconnect: () => inv('simplefin:disconnect'), openBridge: (where) => inv('simplefin:open-bridge', where) },
  creditReport: { pick: () => inv('report:pick'), fromFile: (f) => inv('report:from-file', f), fromText: (t) => inv('report:from-text', t) },
  exportData: () => inv('data:export'),
  importData: () => inv('data:import'),
  openExternal: (url) => inv('shell:open-external', url),
  openPath: (p) => inv('shell:open-path', p),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  on: {
    toast: on('toast'), nav: on('nav'), statements: on('statements:update'), downloading: on('statements:downloading'),
    accounts: on('store:accounts'), wallet: on('store:wallet'), openTab: on('browser:open-tab'), cardCandidate: on('card-image:candidate'), simplefin: on('simplefin:state')
  }
});

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('native', {
  platform: process.platform,
  recent: () => invoke('app:recent'),
  recoveryRead: () => invoke('app:recovery-read'),
  recoveryWrite: (json) => invoke('app:recovery-write', json),
  reveal: (p) => invoke('app:reveal', p),
  closeConfirmed: () => invoke('app:close-confirmed'),
  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', fn),
  openFiles: () => invoke('dialog:open-files'),
  openFolder: () => invoke('dialog:open-folder'),
  pickSaveParent: (name) => invoke('dialog:pick-save-parent', name),
  saveFileDialog: (defaultName, ext) => invoke('dialog:save-file', { defaultName, ext }),
  pickImage: () => invoke('dialog:pick-image'),
  importFile: (p) => invoke('file:import', p),
  openDataFiles: (mode) => invoke('dialog:open-data', mode),
  scanDataset: (opts) => invoke('dataset:scan', opts),
  saveProject: (payload) => invoke('project:save', payload),
  openProjectFolder: (dir) => invoke('project:open-folder', dir),
  exportPdf: (html, filePath) => invoke('export:pdf', { html, filePath }),
  exportSheet: (payload) => invoke('export:sheet', payload),
  renderPng: (html, w, h) => invoke('render:png', { html, w, h }),
  pathForFile: (file) => webUtils.getPathForFile(file)
});

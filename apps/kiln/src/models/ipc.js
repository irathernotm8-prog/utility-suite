// Kiln — Find models: IPC for CivitAI, Hugging Face and pasted links.
const { ipcMain } = require('electron');
const sources = require('./sources');
const library = require('./library');

function installedIndex() {
  const items = library.scan(library.activeRoot());
  const versions = {}, models = {}, files = {};
  for (const m of items) {
    if (m.info?.versionId) versions[m.info.versionId] = m.path;
    if (m.info?.modelId) models[m.info.modelId] = (models[m.info.modelId] || 0) + 1;
    files[m.file.toLowerCase()] = m.path;
  }
  return { versions, models, files };
}

function register() {
  ipcMain.handle('civ:search', (_e, q) => sources.civSearch(q || {}));
  ipcMain.handle('civ:model', (_e, id) => sources.civModel(id));
  ipcMain.handle('hf:search', (_e, q) => sources.hfSearch(q || {}));
  ipcMain.handle('hf:files', (_e, repo) => sources.hfFiles(repo));
  ipcMain.handle('hf:model', (_e, repo) => sources.hfModel(repo));
  ipcMain.handle('hf:essentials', () => sources.ESSENTIALS);
  ipcMain.handle('link:resolve', (_e, url) => sources.resolveLink(url));
  ipcMain.handle('lib:installed', () => installedIndex());
}

module.exports = { register };

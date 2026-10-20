const {contextBridge, ipcRenderer, webUtils} = require('electron');
const invoke = names => Object.fromEntries(names.map(n => [n, (...a) => ipcRenderer.invoke(n, ...a)]));
contextBridge.exposeInMainWorld('desk', {
  ...invoke(['init', 'places', 'list', 'info', 'readText', 'diskSpace', 'savePrefs', 'launchers', 'folderSize', 'search',
    'newFolder', 'newFile', 'rename', 'transfer', 'duplicate', 'trash', 'undo', 'history', 'open', 'reveal', 'terminal', 'editor',
    'openWith', 'editCmd', 'copyText', 'compress', 'extract', 'chooseFolder', 'confirm', 'thumb', 'icon', 'watch', 'menu',
    'tidyScan', 'tidyApply', 'tidyTrash', 'profiles', 'saveProfiles', 'revise', 'assistStatus', 'aiPreview', 'aiRun', 'acceptAI']),
  cancel: id => ipcRenderer.send('cancel', id),
  cancelScan: () => ipcRenderer.send('cancel-scan'),
  startDrag: paths => ipcRenderer.send('startDrag', paths),
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  on: (channel, fn) => {
    if (!['search-batch', 'scan-progress', 'dir-changed', 'command', 'theme', 'open-path'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, ...a) => fn(...a));
  },
});

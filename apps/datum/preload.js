const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('native', {
  platform: process.platform,
  recent: () => invoke('app:recent'),
  recentRemove: (dir) => invoke('app:recent-remove', dir),
  recentClearMissing: () => invoke('app:recent-clear-missing'),
  describeProject: (dir) => invoke('project:describe', dir),
  deleteProject: (dir) => invoke('project:delete', dir),
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
  pathForFile: (file) => webUtils.getPathForFile(file),
  // AI: tool calls from Claude / Codex / the in-app assistant, and their settings
  agent: {
    ready: () => ipcRenderer.send('agent:ready'),
    onCall: (fn) => ipcRenderer.on('agent:call', (_e, msg) => fn(msg)),
    result: (id, result) => ipcRenderer.send('agent:result', { id, result }),
    onBridge: (fn) => ipcRenderer.on('agent:bridge', (_e, st) => fn(st)),
    settings: () => invoke('agent:settings'),
    setSettings: (patch) => invoke('agent:settings-set', patch),
    models: (id) => invoke('agent:models', id),
    status: () => invoke('agent:status'),
    connect: (which) => invoke('agent:connect', which),
    openUrl: (u) => invoke('agent:open-url', u),
    chatSend: (o) => invoke('agent:chat-send', o),
    chatStop: () => invoke('agent:chat-stop'),
    chatClear: (key) => invoke('agent:chat-clear', key),
    onChatEvent: (fn) => ipcRenderer.on('agent:chat-event', (_e, ev) => fn(ev))
  }
});

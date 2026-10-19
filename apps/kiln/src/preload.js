// Kiln — the window's bridge to the main process. Everything the UI can do goes through here.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('kiln', {
  app: {
    state: call('app:state'), set: call('app:set'), completeSetup: call('setup:complete'),
    chooseFolder: call('app:choose-folder'), chooseFiles: call('app:choose-files'),
    openExternal: call('app:open-external'), openPath: call('app:open-path'),
    gpu: call('app:gpu'), tools: call('app:tools'), onMenu: on('menu'),
    pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } }
  },
  profiles: {
    create: call('profile:create'), update: (id, patch) => ipcRenderer.invoke('profile:update', { id, patch }),
    remove: (id, deleteFiles) => ipcRenderer.invoke('profile:remove', { id, deleteFiles }),
    open: (id, pin) => ipcRenderer.invoke('profile:open', { id, pin }), lock: call('profile:lock'), state: call('profile:state'),
    onChanged: on('profile:changed')
  },
  libraries: { create: call('libraries:create'), addExisting: call('libraries:add-existing'), rename: (id, name) => ipcRenderer.invoke('libraries:rename', { id, name }) },
  settings: { save: call('settings:save') },
  prompts: { list: call('prompts:list'), save: call('prompts:save'), remove: call('prompts:remove'), used: call('prompts:used'), exportAll: call('prompts:export'), importFile: call('prompts:import') },
  pkg: {
    catalog: call('pkg:catalog'), list: call('pkg:list'), install: call('pkg:install'), repair: call('pkg:repair'),
    checkUpdate: call('pkg:check-update'), update: call('pkg:update'), uninstall: (id, deleteFiles) => ipcRenderer.invoke('pkg:uninstall', { id, deleteFiles }),
    launch: call('pkg:launch'), stop: call('pkg:stop'), running: call('pkg:running'), log: call('pkg:log'), clearLog: call('pkg:clear-log'),
    save: (id, patch) => ipcRenderer.invoke('pkg:save', { id, patch }), argsPreview: call('pkg:args-preview'), openFolder: call('pkg:open-folder'),
    sendInput: (id, text) => ipcRenderer.invoke('pkg:send-input', { id, text }),
    onLog: on('pkg:log'), onStatus: on('pkg:status'), onReady: on('pkg:ready'), onList: on('pkg:list')
  },
  ext: {
    list: call('ext:list'), index: call('ext:index'), install: (id, url) => ipcRenderer.invoke('ext:install', { id, url }),
    update: (id, folder) => ipcRenderer.invoke('ext:update', { id, folder }), remove: (id, folder) => ipcRenderer.invoke('ext:remove', { id, folder }),
    toggle: (id, folder, enabled) => ipcRenderer.invoke('ext:toggle', { id, folder, enabled })
  },
  lib: {
    list: call('lib:list'), types: call('lib:types'), remove: call('lib:remove'), move: (p, type, sub) => ipcRenderer.invoke('lib:move', { path: p, type, sub }),
    setTitle: (p, title) => ipcRenderer.invoke('lib:set-title', { path: p, title }), lookup: call('lib:lookup'), lookupAll: call('lib:lookup-all'),
    openFolder: call('lib:open-folder'), show: call('lib:show'), importFiles: (files, type) => ipcRenderer.invoke('lib:import-files', { files, type }),
    installed: call('lib:installed'),
    onChanged: on('lib:changed'), onHashProgress: on('lib:hash-progress'), onScanProgress: on('lib:scan-progress')
  },
  civ: { search: call('civ:search'), model: call('civ:model') },
  hf: { search: call('hf:search'), files: call('hf:files'), model: call('hf:model'), essentials: call('hf:essentials') },
  link: { resolve: call('link:resolve') },
  dl: {
    start: call('dl:start'), list: call('dl:list'), control: (id, action) => ipcRenderer.invoke('dl:control', { id, action }),
    setType: (id, type) => ipcRenderer.invoke('dl:set-type', { id, type }), retry: call('dl:retry'), remove: call('dl:remove'), clear: call('dl:clear'), show: call('dl:open'),
    onUpdate: on('dl:update'), onDone: on('dl:done')
  },
  gen: {
    options: call('gen:options'), refresh: call('gen:refresh'), run: call('gen:run'), interrupt: call('gen:interrupt'), upscale: call('gen:upscale'),
    history: call('gen:history'), removeHistory: call('gen:history-remove'), pickImage: call('gen:pick-image'), imageFromUrl: call('gen:image-from-url'),
    onProgress: on('gen:progress'), onStarted: on('gen:started')
  },
  gal: {
    list: call('gal:list'), details: call('gal:details'), favorite: (p, on) => ipcRenderer.invoke('gal:favorite', { path: p, on }),
    remove: call('gal:delete'), show: call('gal:show'), openFolder: call('gal:open-folder'), copy: call('gal:copy'), dataUrl: call('gal:read-data-url'),
    startDrag: (p) => ipcRenderer.send('gal:drag', p)
  },
  tags: { search: call('tags:search'), status: call('tags:status'), download: call('tags:download') },
  browser: {
    prepare: call('browser:prepare'), partition: call('browser:partition'), save: call('browser:save'),
    clearIncognito: call('browser:clear-incognito'), clearData: call('browser:clear-data'), blockedCount: call('adblock:count'),
    onOpen: on('browser:open'), onDownloadModel: on('browser:download-model'), onUseImage: on('browser:use-image'), onUsePrompt: on('browser:use-prompt')
  },
  file: (p, thumb = 0) => thumb ? `kiln://thumb/?w=${thumb}&p=${encodeURIComponent(p)}` : `kiln://file/?p=${encodeURIComponent(p)}`
});

// Vantage — the bridge between the browser UI and the main process.
// `vantage` is the UI's API; `relay` is the same surface under the name the Library, Player, Reader
// and Vault screens (moved over from Relay) already use.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { const f = (_e, ...a) => cb(...a); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

const media = {
  pick: inv('media:pick'), stat: inv('media:stat'), airplay: inv('media:airplay'), soundOutput: inv('media:sound-output'),
  found: inv('media:found'), prepare: inv('media:prepare'),
  castDiscover: inv('cast:discover'), castPlay: (o) => ipcRenderer.invoke('cast:play', o), castControl: (action, value) => ipcRenderer.invoke('cast:control', { action, value }),
  onCastStatus: on('cast:status'), onOpenUrl: on('media:open-url'),
  saveProgress: inv('media:progress'), getProgress: inv('media:get-progress')
};
const library = {
  root: inv('library:root'), scan: inv('library:scan'),
  meta: (kind, key, patch) => ipcRenderer.invoke('library:meta', { kind, key, patch }),
  opened: (kind, key) => ipcRenderer.invoke('library:opened', { kind, key }),
  pickCover: (kind, key) => ipcRenderer.invoke('library:pick-cover', { kind, key }),
  setCover: (kind, key, from) => ipcRenderer.invoke('library:set-cover', { kind, key, from }),
  resetCover: (kind, key) => ipcRenderer.invoke('library:reset-cover', { kind, key }),
  saveThumb: inv('library:save-thumb'), fileBytes: inv('library:file-bytes'), zipFirst: inv('library:zip-first'),
  openFolder: inv('library:open-folder'), show: inv('library:show'), openExternal: inv('library:open-external'),
  trash: inv('library:trash'), add: inv('library:add'),
  importFiles: (kind, paths, move) => ipcRenderer.invoke('library:import', { kind, paths, move }),
  kindFor: inv('library:kind-for'), chooseRoot: inv('library:choose-root'), onChanged: on('library:changed')
};
const reader = {
  open: inv('reader:open'), page: (id, index) => ipcRenderer.invoke('reader:page', { id, index }),
  pdfBytes: inv('reader:pdf-bytes'), fetchUrl: (url, partition) => ipcRenderer.invoke('reader:fetch', { url, partition }),
  close: inv('reader:close'), progress: inv('reader:progress'), onOpenUrl: on('reader:open-url')
};
const vault = {
  status: inv('vault:status'), create: inv('vault:create'), unlock: inv('vault:unlock'), unlockTouchID: inv('vault:unlock-touchid'),
  setTouchID: inv('vault:touchid'), changePassword: inv('vault:change-password'), lock: inv('vault:lock'), list: inv('vault:list'),
  reveal: inv('vault:reveal'), copy: (id, field) => ipcRenderer.invoke('vault:copy', { id, field }), save: inv('vault:save'),
  remove: inv('vault:delete'), importCSV: inv('vault:import'), trashImport: inv('vault:trash-import'), exportCSV: inv('vault:export'),
  matches: inv('vault:matches'), fill: (id, wcId) => ipcRenderer.invoke('vault:fill', { id, wcId }),
  totp: inv('vault:totp'), totpSecret: inv('vault:get-totp-secret'),
  importRelay: inv('vault:import-relay'), relayExists: inv('vault:relay-exists'),
  saveCaptured: (token, never) => ipcRenderer.invoke('vault:save-captured', { token, never }),
  onLocked: on('vault:locked'), onFillRequest: on('vault:fill-request'), onSaveRequest: on('vault:save-request'),
  onOfferSave: on('vault:offer-save'), onUnlockRequest: on('vault:unlock-request')
};
const downloads = {
  list: inv('downloads:list'), folder: inv('downloads:folder'), chooseFolder: inv('downloads:choose-folder'), openFolder: inv('downloads:open-folder'),
  open: inv('downloads:open'), show: inv('downloads:show'), remove: inv('downloads:remove'), del: inv('downloads:delete'), clear: inv('downloads:clear'),
  control: (id, action) => ipcRenderer.invoke('downloads:control', { id, action }),
  start: (url, partition) => ipcRenderer.invoke('downloads:start', { url, partition }),
  onUpdate: on('downloads:update'), onRemoved: on('downloads:removed'), onStarted: on('download:started'), onDone: on('download:done')
};
const common = {
  prepareSession: (partition) => ipcRenderer.invoke('session:prepare', { partition }),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  openExternal: inv('shell:open-external'),
  startDrag: inv('file:drag'),
  media, library, reader, vault, downloads
};

contextBridge.exposeInMainWorld('relay', common);
contextBridge.exposeInMainWorld('vantage', {
  ...common,
  init: inv('win:init'), saveState: (s) => ipcRenderer.send('win:state', s),
  newWindow: inv('win:new'), fullscreen: inv('win:fullscreen'), closeWindow: inv('win:close'), titleDblClick: inv('win:dblclick'),
  settings: { get: inv('settings:get'), set: inv('settings:set'), onChanged: on('settings:changed') },
  history: {
    visit: (v) => ipcRenderer.send('history:visit', v), title: (v) => ipcRenderer.send('history:title', v),
    search: inv('history:search'), frecent: inv('history:frecent'), top: inv('history:top'), del: inv('history:delete')
  },
  bookmarks: { list: inv('bookmarks:list'), save: inv('bookmarks:save'), del: inv('bookmarks:delete'), reorder: inv('bookmarks:reorder'),
    importSources: inv('bookmarks:import-sources'), import: inv('bookmarks:import'), onChanged: on('bookmarks:changed') },
  suggest: inv('suggest'),
  page: { reader: inv('page:reader'), screenshot: inv('page:screenshot'), save: inv('page:save'), adblockCount: inv('page:adblock-count'), devtools: inv('page:devtools'), print: inv('page:print') },
  site: { get: inv('site:get'), set: (host, patch) => ipcRenderer.invoke('site:set', { host, patch }), allowHttp: inv('site:allow-http'),
    clearData: inv('site:clear-data'), forgetPermission: inv('site:forget-permission') },
  perm: { answer: inv('perm:answer'), onAsk: on('perm:ask') },
  adblock: { status: inv('adblock:status'), site: (host, allow) => ipcRenderer.invoke('adblock:site', { host, allow }), reload: inv('adblock:reload'), onCount: on('adblock:count') },
  vpn: { state: inv('vpn:state'), connect: inv('vpn:connect'), disconnect: inv('vpn:disconnect'), check: inv('vpn:check'), resetWarp: inv('vpn:reset-warp'),
    importFile: inv('vpn:import'), importText: inv('vpn:import-text'), proxy: inv('vpn:proxy'), onState: on('vpn:state') },
  data: { clear: inv('data:clear') },
  defaultBrowser: { status: inv('default:status'), set: inv('default:set') },
  info: inv('app:info'), notify: inv('notify'),
  onCmd: on('cmd'), onOpenTab: on('tab:open'), onFullscreen: on('win:fullscreen')
});

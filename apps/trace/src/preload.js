const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (name) => (...a) => ipcRenderer.invoke('trace:' + name, ...a).then((r) => { if (!r.ok) throw new Error(r.error); return r.data; });
const on = (ch) => (fn) => ipcRenderer.on('trace:' + ch, (_e, d) => fn(d));
contextBridge.exposeInMainWorld('api', {
  bootstrap: call('bootstrap'), setSettings: call('settings:set'),
  projects: call('projects'), createProject: call('project:create'), loadProject: call('project:load'), saveProject: call('project:save'),
  deleteProject: call('project:delete'), setActiveProject: call('project:active'),
  listMedia: call('media:list'), updateMedia: call('media:update'), deleteMedia: call('media:delete'), importMedia: call('media:import'),
  mediaFromBuffer: call('media:fromBuffer'), mediaFromPaths: call('media:fromPaths'), mediaDataUrl: call('media:dataUrl'), revealMedia: call('media:reveal'), seedMedia: call('media:seed'),
  saveFile: call('file:save'), copyImage: call('clipboard:image'), exportPdf: call('export:pdf'),
  pickFolder: call('folder:pick'), scanFolder: call('folder:scan'),
  capture: call('capture'), captureBar: call('capture:bar'), capturePermission: call('capture:permission'), openCaptureSettings: call('capture:openSettings'),
  fullscreen: call('window:fullscreen'), windowChrome: call('window:chrome'),
  open: call('open'), reveal: call('reveal'), openPath: call('openPath'), openLibrary: call('library:open'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (_) { return ''; } },
  onMediaAdded: on('media-added'), onMenu: on('menu'), onFullscreen: on('fullscreen'), onBar: on('bar'), onError: on('error'),
  onFlush: (fn) => ipcRenderer.on('trace:flush', async () => { try { await fn(); } finally { ipcRenderer.send('trace:flushed'); } })
});

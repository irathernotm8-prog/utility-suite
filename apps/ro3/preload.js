// The only bridge between the UI and the system. Everything returns plain data.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) {
    const e = new Error(r.error);
    e.cancelled = r.cancelled;
    throw e;
  }
  return r.value;
}

const progressListeners = new Map();
ipcRenderer.on('job:progress', (_e, { jobId, progress }) => {
  const fn = progressListeners.get(jobId);
  if (fn) fn(progress);
});

let jobCounter = 0;
function job(channel, args, onProgress) {
  const jobId = `job-${Date.now()}-${jobCounter++}`;
  if (onProgress) progressListeners.set(jobId, onProgress);
  const promise = call(channel, jobId, ...args).finally(() => progressListeners.delete(jobId));
  return { jobId, promise, cancel: () => call('job:cancel', jobId) };
}

contextBridge.exposeInMainWorld('ro3', {
  platform: process.platform,
  formats: () => call('app:formats'),
  info: () => call('app:info'),
  fileUrl: (p) => pathToFileURL(p).href,
  pathOf: (file) => webUtils.getPathForFile(file),
  openDialog: (opts) => call('dialog:open', opts),
  saveDialog: (opts) => call('dialog:save', opts),
  folderDialog: () => call('dialog:folder'),
  stat: (p) => call('fs:stat', p),
  readText: (p) => call('fs:readText', p),
  readBytes: (p) => call('fs:readBytes', p),
  writeBytes: (p, b) => call('fs:writeBytes', p, b),
  addRecent: (p) => call('recent:add', p).catch(() => {}),
  autosaveWrite: (name, text) => call('autosave:write', name, text),
  autosaveRead: (name) => call('autosave:read', name),
  autosaveClear: (name) => call('autosave:clear', name),
  pendingOpen: () => call('app:pendingOpen'),
  commands: () => call('app:commands'),
  oraRead: (p) => call('ora:read', p),
  oraWrite: (p, doc) => call('ora:write', p, doc),
  writeText: (p, t) => call('fs:writeText', p, t),
  uniquePath: (p) => call('fs:unique', p),
  showInFolder: (p) => call('shell:show', p),
  openPath: (p) => call('shell:open', p),
  probe: (p) => call('media:probe', p),
  thumb: (p) => call('media:thumb', p),
  filmstrip: (p, d, n) => call('media:filmstrip', p, d, n),
  waveform: (p) => call('media:waveform', p),
  frame: (p, t) => call('media:frame', p, t),
  still: (p, t) => call('media:still', p, t),
  interchange: (project, fmt, out) => call('video:interchange', project, fmt, out),
  transitions: () => call('video:transitions'),
  decodeImage: (p) => call('image:decode', p),
  imageInfo: (p) => call('image:info', p),
  exportImage: (bytes, job) => call('image:exportBuffer', bytes, job),
  convert: (jobSpec, onProgress) => job('convert:file', [jobSpec], onProgress),
  proxy: (p, onProgress) => job('media:proxy', [p], onProgress),
  render: (project, out, onProgress) => job('video:render', [project, out], onProgress),
  previewPath: () => call('video:previewPath'),
  writeTemp: (bytes, name) => call('video:writeTemp', bytes, name),
  clipboardWriteImage: (bytes) => call('clipboard:writeImage', bytes),
  clipboardReadImage: () => call('clipboard:readImage'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, cmd) => fn(cmd)),
});

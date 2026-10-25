// Facet — the window's narrow bridge to the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r?.ok) throw new Error(r?.error || 'Something went wrong');
  return r.data;
};
const on = (ch) => (fn) => {
  const h = (_e, d) => fn(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('facet', {
  info: () => call('app:info'),
  settings: (p) => call('settings:patch', p),
  openExternal: (u) => call('app:openExternal', u),
  reveal: (p) => call('app:reveal', p),
  openPath: (p) => call('app:openPath', p),
  chooseFolder: (t, d) => call('app:chooseFolder', t, d),
  chooseImages: (multi) => call('app:chooseImages', multi),
  chooseModelFile: () => call('app:chooseModelFile'),
  saveTemp: (name, bytes) => call('app:saveTemp', name, bytes),
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  hw: () => call('hw:detect'),
  engine: {
    status: () => call('engine:status'), install: (o) => call('engine:install', o), cancel: () => call('engine:cancel'),
    hello: () => call('engine:hello'), restart: () => call('engine:restart'), log: () => call('engine:log'), size: () => call('engine:size')
  },
  models: { list: () => call('models:list'), download: (id) => call('models:download', id), cancel: (id) => call('models:cancel', id), remove: (id) => call('models:remove', id) },
  create: { imagine: (a) => call('create:imagine', a), make: (a) => call('create:make', a), cancel: (id) => call('create:cancel', id), jobs: () => call('create:jobs') },
  library: {
    list: () => call('library:list'), get: (id) => call('library:get', id), update: (id, p) => call('library:update', id, p), trash: (id) => call('library:trash', id),
    thumb: (id, url) => call('library:thumb', id, url), export: (id, f, o) => call('library:export', id, f, o), import: (files) => call('library:import', files)
  },
  on: { engine: on('engine'), models: on('models'), job: on('job'), library: on('library'), worker: on('worker') }
});

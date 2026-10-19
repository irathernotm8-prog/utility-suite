const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); };
const call = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('onward', {
  ready: () => ipcRenderer.send('renderer:ready'),
  getState: () => ipcRenderer.invoke('state:get'),
  saveUi: call('ui:save'),
  saveSettings: call('settings:save'),
  saveProfile: call('profile:save'),
  importResume: call('resume:import'),
  addCredentials: (paths, type) => ipcRenderer.invoke('credential:add', { paths, type }),
  updateCredential: (id, patch) => ipcRenderer.invoke('credential:update', { id, patch }),
  removeCredential: call('credential:remove'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },

  saveJob: call('job:save'),
  setStatus: (id, status) => ipcRenderer.invoke('job:status', { id, status }),
  addNote: (id, text) => ipcRenderer.invoke('job:note', { id, text }),
  removeJob: call('job:remove'),
  markApplied: call('job:applied'),
  markAppliedWith: (id, answers, portal) => ipcRenderer.invoke('job:applied-with', { id, answers, portal }),
  fillDetails: call('job:fill-details'),

  saveContact: (jobId, contact) => ipcRenderer.invoke('contact:save', { jobId, contact }),
  removeContact: (jobId, contactId) => ipcRenderer.invoke('contact:remove', { jobId, contactId }),
  saveMessage: (jobId, contactId, message) => ipcRenderer.invoke('message:save', { jobId, contactId, message }),
  removeMessage: (jobId, contactId, messageId) => ipcRenderer.invoke('message:remove', { jobId, contactId, messageId }),

  discover: {
    search: call('discover:search'),
    detail: call('discover:detail'),
    save: call('discover:save')
  },

  ai: {
    build: (kind, args) => ipcRenderer.invoke('ai:build', { kind, args }),
    api: (prompt) => ipcRenderer.invoke('ai:api', { prompt }),
    finish: (kind, args, reply) => ipcRenderer.invoke('ai:finish', { kind, args, reply }),
    setKey: (provider, key) => ipcRenderer.invoke('ai:key', { provider, key }),
    session: () => ipcRenderer.invoke('ai:session'),
    signIn: (site) => ipcRenderer.invoke('ai:signin', { site }),
    onSignedIn: on('ai:signed-in')
  },

  guide: {
    scan: call('guide:scan'),
    fill: (fields) => ipcRenderer.invoke('guide:fill', { fields }),
    upload: (o) => ipcRenderer.invoke('guide:upload', o),
    focus: (ref) => ipcRenderer.invoke('guide:focus', { ref }),
    markSubmit: (ref) => ipcRenderer.invoke('guide:mark-submit', { ref }),
    autofill: (jobId) => ipcRenderer.invoke('guide:autofill', { jobId })
  },

  // Main process asks the window to do something only it can (e.g. Indeed in a hidden tab)
  onRpc: (handler) => ipcRenderer.on('rpc', async (_e, { id, method, args }) => {
    try { ipcRenderer.invoke('rpc:reply', { id, result: await handler(method, args) }); }
    catch (err) { ipcRenderer.invoke('rpc:reply', { id, error: String(err && err.message || err) }); }
  }),

  openFile: call('file:open'),
  showFile: call('file:show'),
  openFolder: call('folder:open'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openExternal: call('external:open'),

  browser: {
    prepare: () => ipcRenderer.invoke('session:prepare'),
    register: call('browser:register'),
    active: call('browser:active'),
    closed: call('browser:closed'),
    save: call('browser:save'),
    linkJob: call('browser:link-job'),
    linkTab: (tabId, jobId) => ipcRenderer.invoke('browser:link-tab', { tabId, jobId }),
    clearData: () => ipcRenderer.invoke('browser:clear-data'),
    onNewTab: on('browser:new-tab'),
    onSaveJob: on('browser:save-job'),
    onLinked: on('browser:linked'),
    onReadyToSubmit: on('browser:ready-to-submit'),
    onSubmitted: on('browser:submitted'),
    onSubmittedUnknown: on('browser:submitted-unknown')
  },

  claude: {
    status: () => ipcRenderer.invoke('claude:status'),
    connect: () => ipcRenderer.invoke('claude:connect'),
    connectCodex: () => ipcRenderer.invoke('codex:connect'),
    copy: call('claude:copy'),
    onStatus: on('claude:status'),
    onActivity: on('claude:activity'),
    onJob: on('claude:job'),
    onMessage: on('claude:message'),
    onDiscover: on('claude:discover')
  },

  onView: on('ui:view'),
  onChanged: on('state:changed'),
  onToast: on('toast')
});

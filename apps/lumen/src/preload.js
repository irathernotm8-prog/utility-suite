const { contextBridge, ipcRenderer } = require('electron');
const call = (name) => (...a) => ipcRenderer.invoke('lumen:' + name, ...a).then((r) => { if (!r.ok) throw new Error(r.error); return r.data; });
contextBridge.exposeInMainWorld('lumen', {
  bootstrap: call('bootstrap'), setActive: call('setActive'), summary: call('summary'),
  addWorkspace: call('workspace:add'), renameWorkspace: call('workspace:rename'), removeWorkspace: call('workspace:remove'),
  connections: call('connections'), addConnection: call('connection:add'), updateConnection: call('connection:update'),
  removeConnection: call('connection:remove'), testConnection: call('connection:test'), syncConnection: call('connection:sync'),
  setTheme: call('settings:theme'), setModel: call('settings:model'), setKey: call('settings:key'),
  setProvider: call('settings:provider'), setCliModel: call('settings:cliModel'), detectAi: call('ai:detect'), testAi: call('ai:test'),
  setGoogleClient: call('google:setClient'), googleSignIn: call('google:signIn'), googleSignOut: call('google:signOut'),
  analytics: call('analytics'),
  posts: call('posts'), savePost: call('post:save'), schedulePost: call('post:schedule'), publishPostNow: call('post:publishNow'), unschedulePost: call('post:unschedule'), deletePost: call('post:delete'),
  adsTree: call('ads:tree'), adsChange: call('ads:change'), adsCopy: call('ads:copy'), adsCreative: call('ads:creative'), adsPreview: call('ads:preview'), adsEditCreative: call('ads:editCreative'), adsCreate: call('ads:create'), adsGeo: call('ads:geo'), adsAudit: call('ads:audit'), adsRevert: call('ads:revert'), adsDefaults: call('ads:defaults'), adsAiDraft: call('ads:aiDraft'), setBudgetCap: call('settings:budgetCap'),
  pickMedia: call('media:pick'), mediaThumb: call('media:thumb'), draftCaptions: call('ai:draft'),
  onPostsChanged: (fn) => ipcRenderer.on('lumen:posts-changed', () => fn()),
  ask: call('ask'), open: call('open')
});

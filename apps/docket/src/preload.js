const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (name) => (...a) => ipcRenderer.invoke('docket:' + name, ...a).then((r) => { if (!r.ok) throw new Error(r.error); return r.data; });
const on = (ch) => (fn) => ipcRenderer.on('docket:' + ch, (_e, d) => fn(d));
contextBridge.exposeInMainWorld('api', {
  bootstrap: call('bootstrap'), setSettings: call('settings:set'),
  meetings: call('meetings'), createMeeting: call('meeting:create'), loadMeeting: call('meeting:load'), saveMeeting: call('meeting:save'),
  deleteMeeting: call('meeting:delete'), searchMeetings: call('meeting:search'), revealMeeting: call('meeting:reveal'),
  exportMeeting: call('meeting:export'), copyMeeting: call('meeting:copy'),
  appendAudio: call('audio:append'), finishAudio: call('audio:finish'), removeAudio: call('audio:remove'),
  pickImport: call('import:pick'), readImport: call('import:read'), checkPath: call('import:path'),
  todos: call('todos'), addTodos: call('todos:add'), updateTodo: call('todos:update'), deleteTodos: call('todos:delete'),
  summarize: call('ai:summarize'), ask: call('ai:ask'), detectAi: call('ai:detect'),
  askMic: call('perm:mic'), permStatus: call('perm:status'), openPerm: call('perm:open'), requestScreen: call('perm:requestScreen'),
  windowChrome: call('window:chrome'), open: call('open'), openHome: call('home:open'), notify: call('notify'), restartWatch: call('watch:restart'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (_) { return ''; } },
  recState: (s) => ipcRenderer.send('docket:rec', s),
  stopped: () => ipcRenderer.send('docket:stopped'),
  onDetected: on('detected'),
  onFlush: (fn) => ipcRenderer.on('docket:flush', async () => { try { await fn(); } finally { ipcRenderer.send('docket:flushed'); } })
});

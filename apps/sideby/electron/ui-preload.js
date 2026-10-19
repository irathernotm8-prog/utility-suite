const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);
const listen = (channel, fn) => {
  const handler = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const STAGE_EVENTS = ['video', 'nav', 'popup', 'load-error', 'fullscreen', 'crashed', 'escape'];

contextBridge.exposeInMainWorld('sideby', {
  settings: {
    get: () => invoke('settings:get'),
    set: patch => invoke('settings:set', patch)
  },
  app: {
    info: () => invoke('app:info'),
    takeDeepLink: () => invoke('app:take-deeplink'),
    clipboardInvite: () => invoke('app:clipboard-invite'),
    copy: text => invoke('app:copy', text),
    openExternal: url => invoke('app:open-external', url),
    fullscreen: on => invoke('app:fullscreen', on),
    on: (event, fn) => ['deeplink', 'fullscreen', 'focus', 'menu'].includes(event) ? listen(`app:${event}`, fn) : () => {}
  },
  stage: {
    load: url => invoke('stage:load', url),
    bounds: rect => send('stage:bounds', rect),
    visible: on => send('stage:visible', on),
    nav: action => send('stage:nav', action),
    blank: () => send('stage:blank'),
    apply: cmd => send('stage:apply', cmd),
    react: payload => send('stage:react', payload),
    mute: muted => send('stage:mute', muted),
    snapshot: () => invoke('stage:snapshot'),
    navState: () => invoke('stage:nav-state'),
    playerUrl: (src, opts) => invoke('stage:player-url', src, opts),
    openFile: () => invoke('stage:open-file'),
    devtools: () => send('stage:devtools'),
    on: (event, fn) => STAGE_EVENTS.includes(event) ? listen(`stage:${event}`, fn) : () => {}
  },
  capture: {
    sources: () => invoke('capture:sources'),
    prepare: choice => invoke('capture:prepare', choice),
    openSettings: () => invoke('capture:open-settings')
  }
});

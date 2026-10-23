// Touchline — the window's bridge to the main process. The window never touches
// the network or disk itself; everything goes through these calls.
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('tl', {
  app: { info: call('app:info'), openExternal: call('app:open-external'), copy: call('app:copy'), onNav: on('nav'), onMenu: on('menu'), onTheme: on('theme') },
  store: { get: call('store:get'), set: call('store:set'), follow: call('store:follow'), reorder: call('store:reorder') },
  data: {
    day: call('data:day'), match: call('data:match'), catalog: call('data:catalog'), league: call('data:league'), leaders: call('data:leaders'),
    team: call('data:team'), player: call('data:player'), playerSeason: call('data:player-season'), search: call('data:search'),
    history: call('data:history'), legends: call('data:legends'), status: call('data:status'), cacheInfo: call('data:cache-info'), cacheClear: call('data:cache-clear')
  }
});

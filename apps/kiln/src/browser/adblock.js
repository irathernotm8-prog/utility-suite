// Kiln — ad & tracker blocking (ported from Relay) (Ghostery's open-source engine, uBlock Origin / EasyList compatible)
// We wire the engine into our own per-session webRequest handlers so it can be switched
// on and off per account, and so it can share sessions with Relay's sign-in header rewriting.
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

let ElectronBlocker = null, PRELOAD_PATH = null;
try {
  ({ ElectronBlocker } = require('@ghostery/adblocker-electron'));
  PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload');
} catch (e) { console.error('Ad blocker unavailable:', e.message); }

let blocker = null;
let loading = null;
const counts = new Map();          // webContentsId -> blocked count on the current page
const sessions = new Map();        // session -> () => boolean (is blocking enabled?)
const preloadIds = new Map();      // session -> registered preload id

const cachePath = () => path.join(app.getPath('userData'), 'adblock-engine.bin');

async function init() {
  if (!ElectronBlocker || loading) return loading;
  loading = (async () => {
    try {
      // Refresh the filter lists every few days
      try { const st = fs.statSync(cachePath()); if (Date.now() - st.mtimeMs > 3 * 86400000) fs.unlinkSync(cachePath()); } catch {}
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cachePath(),
        read: fs.promises.readFile,
        write: fs.promises.writeFile
      });
      for (const ses of sessions.keys()) registerPreload(ses);
    } catch (e) {
      console.error('Ad blocker failed to load lists:', e.message);
      // fall back to an older cached engine if one exists
      try { blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(cachePath()))); } catch {}
    }
    return blocker;
  })();
  return loading;
}

// For tests / offline use
function useFilters(text) {
  if (!ElectronBlocker) return;
  blocker = ElectronBlocker.parse(text, { loadCosmeticFilters: true, loadNetworkFilters: true });
  for (const ses of sessions.keys()) registerPreload(ses);
}

function registerPreload(ses) {
  if (!blocker || !PRELOAD_PATH || preloadIds.has(ses)) return;
  try { preloadIds.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH })); }
  catch (e) { console.error('adblock preload', e.message); }
}

function attach(ses, isEnabled) {
  sessions.set(ses, isEnabled);
  registerPreload(ses);
}

function enabledFor(ses) {
  const fn = sessions.get(ses);
  return !!(blocker && fn && fn());
}

// Called from the session's webRequest.onBeforeRequest
function onBeforeRequest(ses, details, callback) {
  if (details.resourceType === 'mainFrame' && details.webContentsId != null) counts.set(details.webContentsId, 0);
  if (!enabledFor(ses)) return callback({});
  blocker.onBeforeRequest(details, (res) => {
    if (process.env.KILN_DEBUG) console.log('[ab]', details.webContentsId, details.resourceType, details.url, JSON.stringify(res));
    if (res && (res.cancel || res.redirectURL) && details.webContentsId != null) {
      counts.set(details.webContentsId, (counts.get(details.webContentsId) || 0) + 1);
    }
    callback(res || {});
  });
}
function onHeadersReceived(ses, details, callback) {
  if (!enabledFor(ses)) return callback({});
  blocker.onHeadersReceived(details, callback);
}

// Cosmetic filtering (hiding ad boxes) — requested by the engine's preload script in each page
ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
  if (process.env.KILN_DEBUG) console.log('[ab cosmetic]', url, enabledFor(event.sender.session), JSON.stringify(msg || {}).slice(0, 200));
  if (!enabledFor(event.sender.session)) return undefined;
  return blocker.onInjectCosmeticFilters(event, url, msg);
});
ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
  if (!enabledFor(event.sender.session)) return false;
  return blocker.onIsMutationObserverEnabled(event);
});

ipcMain.handle('adblock:count', (_e, wcId) => counts.get(wcId) || 0);
ipcMain.handle('adblock:status', () => ({ available: !!ElectronBlocker, ready: !!blocker }));

module.exports = { init, attach, onBeforeRequest, onHeadersReceived, useFilters, isReady: () => !!blocker };

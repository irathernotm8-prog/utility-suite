// Vantage — ad, tracker and annoyance blocking.
// Ghostery's open-source engine (uBlock Origin / EasyList compatible). "Strict" uses the full prebuilt set:
// ads, trackers, cookie banners and other annoyances, with the scriptlets that handle YouTube.
// Per-site exceptions, your own filters, and a running count of what was blocked.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, webContents } = require('electron');

let ElectronBlocker = null, PRELOAD_PATH = null;
try {
  ({ ElectronBlocker } = require('@ghostery/adblocker-electron'));
  PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload');
} catch (e) { console.error('Ad blocker unavailable:', e.message); }

let blocker = null, loading = null, store = null, onCount = () => {};
let customApplied = '';
const counts = new Map();        // webContentsId -> blocked on the current page
const sessions = new Set();
const preloadIds = new Map();

const cachePath = () => path.join(app.getPath('userData'), store.settings().adblock.strict === false ? 'adblock-standard.bin' : 'adblock-full.bin');
const settings = () => store.settings().adblock;

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function pageHost(wcId) {
  if (wcId == null) return '';
  try { const wc = webContents.fromId(wcId); return wc ? hostOf(wc.getURL()) : ''; } catch { return ''; }
}
function allowed(host) {
  if (!host) return false;
  const list = settings().allow || [];
  return list.some(h => host === h || host.endsWith('.' + h));
}
function enabledFor(details) {
  if (!blocker || settings().enabled === false) return false;
  const host = details.resourceType === 'mainFrame' ? hostOf(details.url) : pageHost(details.webContentsId);
  return !allowed(host);
}

async function init(s, countCb) {
  store = s; onCount = countCb || onCount;
  return reload();
}
function reload(force = false) {
  if (!ElectronBlocker) return Promise.resolve(null);
  loading = (async () => {
    try {
      try { const st = fs.statSync(cachePath()); if (force || Date.now() - st.mtimeMs > 3 * 86400000) fs.unlinkSync(cachePath()); } catch {}
      const io = { path: cachePath(), read: fs.promises.readFile, write: fs.promises.writeFile };
      blocker = settings().strict === false
        ? await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, io)
        : await ElectronBlocker.fromPrebuiltFull(fetch, io);
    } catch (e) {
      console.error('Ad blocker failed to load lists:', e.message);
      try { blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(cachePath()))); } catch {}
    }
    customApplied = '';
    applyCustom();
    for (const ses of sessions) registerPreload(ses);
    return blocker;
  })();
  return loading;
}
// Your own filter lines (uBlock syntax), applied on top of the lists
function applyCustom() {
  if (!blocker) return;
  const text = settings().custom || '';
  if (text === customApplied) return;
  const lines = (t) => t.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!'));
  try { blocker.updateFromDiff({ added: lines(text), removed: lines(customApplied) }); customApplied = text; }
  catch (e) { console.error('custom filters', e.message); }
}

function registerPreload(ses) {
  if (!blocker || !PRELOAD_PATH || preloadIds.has(ses)) return;
  try { preloadIds.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH })); }
  catch (e) { console.error('adblock preload', e.message); }
}
function attach(ses) { sessions.add(ses); registerPreload(ses); }

function onBeforeRequest(details, callback) {
  if (details.resourceType === 'mainFrame' && details.webContentsId != null) counts.set(details.webContentsId, 0);
  if (!enabledFor(details)) return callback({});
  blocker.onBeforeRequest(details, (res) => {
    if (res && (res.cancel || res.redirectURL) && details.webContentsId != null) {
      counts.set(details.webContentsId, (counts.get(details.webContentsId) || 0) + 1);
      onCount(details.webContentsId, counts.get(details.webContentsId));
    }
    callback(res || {});
  });
}
function onHeadersReceived(details, callback) {
  if (!enabledFor(details)) return callback({});
  blocker.onHeadersReceived(details, callback);
}

ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
  if (!blocker || settings().enabled === false || allowed(hostOf(event.sender.getURL()))) return undefined;
  return blocker.onInjectCosmeticFilters(event, url, msg);
});
ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
  if (!blocker || settings().enabled === false || allowed(hostOf(event.sender.getURL()))) return false;
  return blocker.onIsMutationObserverEnabled(event);
});

function setAllowed(host, allow) {
  const a = settings();
  host = String(host || '').replace(/^www\./, '');
  a.allow = (a.allow || []).filter(h => h !== host);
  if (allow) a.allow.push(host);
  store.save();
}

module.exports = {
  init, reload, attach, onBeforeRequest, onHeadersReceived, applyCustom, setAllowed, allowed,
  count: (wcId) => counts.get(wcId) || 0,
  status: () => ({ available: !!ElectronBlocker, ready: !!blocker, loading: !blocker && !!loading })
};

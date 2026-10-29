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
// Sign-in pages are never filtered: Google's check for "is this a real browser" breaks when any of its
// scripts are blocked, and it then refuses the sign-in ("This browser or app may not be secure").
const AUTH_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'gds.google.com', 'myaccount.google.com', 'login.live.com', 'login.microsoftonline.com',
  'login.microsoft.com', 'account.live.com', 'signup.live.com', 'account.microsoft.com', 'appleid.apple.com', 'idmsa.apple.com', 'login.yahoo.com',
  'api.login.yahoo.com', 'account.proton.me', 'accounts.zoho.com', 'challenges.cloudflare.com', 'www.recaptcha.net', 'hcaptcha.com'];
const isAuthHost = (h) => !!h && AUTH_HOSTS.some(a => h === a || h.endsWith('.' + a));
// Sites where the lists' injected scripts (scriptlets) do more harm than good. Their ads are still blocked at
// the network level; only the scripts are skipped. YouTube's player won't start after in-page navigation with them.
const NO_SCRIPTLETS = ['youtube.com', 'youtube-nocookie.com', 'google.com'];
const skipScriptlets = (h) => NO_SCRIPTLETS.some(a => h === a || h.endsWith('.' + a));
let tldts = null;
try { tldts = require('tldts-experimental'); } catch {}   // comes with the Ghostery engine
function parseUrl(url) {
  if (tldts) return tldts.parse(url);
  const hostname = rawHost(url);
  return { hostname, domain: hostname.split('.').slice(-2).join('.') };
}
function rawHost(u) { try { return new URL(u).hostname; } catch { return ''; } }

function pageRawHost(wcId) {
  if (wcId == null) return '';
  try { const wc = webContents.fromId(wcId); return wc ? rawHost(wc.getURL()) : ''; } catch { return ''; }
}
function allowed(host) {
  if (!host) return false;
  const list = settings().allow || [];
  return list.some(h => host === h || host.endsWith('.' + h));
}
function enabledFor(details) {
  if (!blocker || settings().enabled === false) return false;
  const host = details.resourceType === 'mainFrame' ? hostOf(details.url) : pageHost(details.webContentsId);
  if (isAuthHost(rawHost(details.url)) || isAuthHost(host) || isAuthHost('www.' + host) || isAuthHost(pageRawHost(details.webContentsId))) return false;
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

// Cosmetic filtering: hide ad boxes and run the lists' scriptlets. The engine's own handler injects into the
// top page no matter which frame asked, and runs scriptlets again on every update; this one targets the
// frame that asked and runs scriptlets once per frame.
const cosmeticOff = (url) => !blocker || settings().enabled === false || allowed(hostOf(url)) || isAuthHost(rawHost(url));
ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, msg) => {
  try {
    const top = event.sender.getURL();
    if (cosmeticOff(top) || cosmeticOff(url)) return undefined;
    const parsed = parseUrl(url);
    const hostname = parsed.hostname || '';
    const first = msg === undefined;
    const { active, styles, scripts } = blocker.getCosmeticsFilters({
      domain: parsed.domain || '', hostname, url,
      classes: msg?.classes, hrefs: msg?.hrefs, ids: msg?.ids,
      getBaseRules: first, getInjectionRules: first, getExtendedRules: false, getRulesFromHostname: first, getRulesFromDOM: !first,
      callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: msg?.lifecycle }
    });
    if (active === false) return undefined;
    const frame = event.senderFrame;
    if (!frame) return undefined;
    if (styles && styles.length) {
      if (frame === event.sender.mainFrame) event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {});
      else frame.executeJavaScript(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(styles)}; (document.head || document.documentElement).appendChild(s); })()`).catch(() => {});
    }
    if (first && scripts && scripts.length && !skipScriptlets(hostname) && !skipScriptlets(rawHost(top))) {
      for (const script of scripts) frame.executeJavaScript(script, true).catch(() => {});
    }
  } catch (e) { if (process.env.VANTAGE_DEBUG) console.error('cosmetics', e.message); }
  return undefined;
});
ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
  if (cosmeticOff(event.sender.getURL())) return false;
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
  init, reload, attach, isAuthHost, onBeforeRequest, onHeadersReceived, applyCustom, setAllowed, allowed,
  count: (wcId) => counts.get(wcId) || 0,
  status: () => ({ available: !!ElectronBlocker, ready: !!blocker, loading: !blocker && !!loading })
};

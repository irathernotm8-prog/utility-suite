// Relay — main process
const { app, BrowserWindow, ipcMain, shell, session, nativeTheme, safeStorage, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { IDENTITIES, identityFor, rewriteHeaders, navigatorPatch } = require('./identity');
const vault = require('./vault');
const adblock = require('./adblock');
const downloads = require('./downloads');
const library = require('./library');
const plugins = require('./plugins');
const media = require('./media');
const tracking = require('./tracking');
const Carriers = require('./shared/carriers');

// A plain Chrome user agent. Google/Microsoft refuse sign-in from UAs that mention Electron.
const CHROME_UA = IDENTITIES.chrome.ua;
const IS_MAC = process.platform === 'darwin';
app.userAgentFallback = CHROME_UA;
const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js');
const partitionModes = new Map(); // partition -> sign-in mode ('auto' | 'firefox' | ...)
const partitionAdblock = new Map(); // partition -> false when the user turned ads blocking off for that account
const BROWSER_PARTITION = 'persist:relay-browser';
const INCOGNITO_PARTITION = 'relay-incognito'; // no "persist:" → lives in memory only
const isBrowserPartition = (p) => p === BROWSER_PARTITION || p === INCOGNITO_PARTITION;

// Hosts allowed to open as popups inside Relay (sign-in flows). Everything else opens in the default browser.
const AUTH_HOSTS = [
  'accounts.google.com', 'login.live.com', 'login.microsoftonline.com', 'account.live.com',
  'login.yahoo.com', 'api.login.yahoo.com', 'appleid.apple.com', 'idmsa.apple.com',
  'account.proton.me', 'accounts.zoho.com', 'myaccount.google.com', 'accounts.youtube.com',
  'signup.live.com', 'account.microsoft.com', 'login.microsoft.com', 'gds.google.com'
];

// ---------- persistent store ----------
const storePath = () => path.join(app.getPath('userData'), 'relay-data.json');
const DEFAULT_STORE = {
  accounts: [],
  events: [],
  tasks: [],
  briefing: null,
  storage: [],
  downloads: [],
  packages: [],
  readerProgress: {},
  browser: {
    tabs: [],
    bookmarks: [
      { id: 'b1', title: 'Google', url: 'https://www.google.com' },
      { id: 'b2', title: 'YouTube', url: 'https://www.youtube.com' },
      { id: 'b3', title: 'LinkedIn', url: 'https://www.linkedin.com' },
      { id: 'b4', title: 'ESPN FC', url: 'https://www.espn.com/soccer/' }
    ]
  },
  settings: {
    adblockMail: true,
    adblockBrowser: true,
    openLinksIn: 'relay',
    searchEngine: 'google',
    theme: 'dark',
    look: 'relay',
    accent: '#7c5cff',
    inboxStyle: 'match',
    aiMode: 'web',
    aiWeb: 'claude',
    aiProvider: 'claude',
    claudeModel: 'claude-sonnet-4-5',
    openaiModel: 'gpt-5',
    claudeKey: '',
    openaiKey: '',
    calendarView: 'month',
    weekStartsMonday: false
  },
  ui: { platform: 'home', selected: {}, homeView: 'overview' }
};
let store = null;

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    store = { ...DEFAULT_STORE, ...raw, settings: { ...DEFAULT_STORE.settings, ...(raw.settings || {}) }, ui: { ...DEFAULT_STORE.ui, ...(raw.ui || {}) } };
  } catch {
    store = JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
  migrate();
}
// One-time updates for existing installs
function migrate() {
  const s = store.settings;
  if (!s.v2) {
    s.v2 = true;
    if (!s.theme || s.theme === 'system') s.theme = 'dark';          // Relay 2 is dark + purple by default
    // Yahoo's sign-in breaks with ad blocking on, so it starts off for Yahoo accounts
    for (const a of store.accounts) if (a.platform === 'yahoo' && a.adblock === undefined) a.adblock = false;
    // People with API keys keep using them; everyone else gets the free sign-in panel
    s.aiMode = (s.claudeKey || s.openaiKey) ? 'api' : 'web';
    saveStore();
  }
}
let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(storePath(), JSON.stringify(store, null, 2)); } catch (e) { console.error('save failed', e); }
  }, 150);
}

// API keys are encrypted with the macOS keychain via safeStorage.
function encryptKey(plain) {
  if (!plain) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  return 'raw:' + Buffer.from(plain).toString('base64');
}
function decryptKey(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString();
  } catch { /* fallthrough */ }
  return '';
}
function publicState() {
  const s = { ...store.settings };
  s.hasClaudeKey = !!s.claudeKey; s.hasOpenaiKey = !!s.openaiKey;
  s.hasTrackKey = !!s.track17Key;
  delete s.claudeKey; delete s.openaiKey; delete s.track17Key;
  return { accounts: store.accounts, events: store.events, tasks: store.tasks || [], briefing: store.briefing || null, storage: store.storage || [], browser: store.browser || DEFAULT_STORE.browser, settings: s, ui: store.ui };
}

// ---------- window ----------
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    title: 'Relay',
    ...(IS_MAC ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    } : {
      // Windows/Linux: draw our own title bar, keep the native minimize/maximize/close buttons
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#f2f0fa' : '#17151f', height: 56 },
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0d13' : '#f4f3f9',
      icon: process.platform === 'win32' ? path.join(__dirname, '..', 'build', 'icon.ico') : APP_ICON
    }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

function isAuthUrl(url) {
  try { const h = new URL(url).hostname; return AUTH_HOSTS.some(a => h === a || h.endsWith('.' + a)); } catch { return false; }
}

app.on('web-contents-created', (_e, contents) => {
  const type = contents.getType();
  // Popup windows opened by account pages (sign-in flows) belong to an account partition
  if (type === 'window' && contents.session !== session.defaultSession) applyIdentityTracking(contents);
  if (type === 'webview') {
    applyIdentityTracking(contents);
    contents.setWindowOpenHandler(({ url }) => {
      if (isAuthUrl(url) || url === 'about:blank') {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: win, webPreferences: { partition: partitionOf(contents), preload: WEBVIEW_PRELOAD, sandbox: true } } };
      }
      openLink(url, partitionOf(contents) === INCOGNITO_PARTITION, isBrowserPartition(partitionOf(contents)));
      return { action: 'deny' };
    });
    // Right-click menu with the basics inside mail pages
    contents.on('context-menu', (_ev, p) => {
      const items = [];
      if (p.linkURL && /^https?:/.test(p.linkURL)) items.push(
        { label: 'Open Link in New Relay Tab', click: () => sendBrowserTab(p.linkURL, partitionOf(contents) === INCOGNITO_PARTITION) },
        { label: 'Open Link in Incognito Tab', click: () => sendBrowserTab(p.linkURL, true) },
        { label: 'Open Link in Default Browser', click: () => shell.openExternal(p.linkURL) },
        { label: 'Copy Link', click: () => require('electron').clipboard.writeText(p.linkURL) }, { type: 'separator' });
      else if (p.linkURL) items.push({ label: 'Copy Link', click: () => require('electron').clipboard.writeText(p.linkURL) }, { type: 'separator' });
      const part = partitionOf(contents);
      if (p.mediaType === 'image' && p.srcURL) items.push(
        { label: 'View in Relay Reader', click: () => win.webContents.send('reader:open-url', { url: p.srcURL, title: contents.getTitle(), partition: part }) },
        { label: 'Save Image', click: () => contents.downloadURL(p.srcURL) }, { type: 'separator' });
      const pageUrl = contents.getURL();
      if ((p.mediaType === 'video' || p.mediaType === 'audio') && /^https?:/.test(p.srcURL || '')) items.push(
        { label: `Play in Relay Player`, click: () => win.webContents.send('media:open-url', { url: p.srcURL, title: contents.getTitle(), partition: part, referer: pageUrl }) },
        { label: `Download ${p.mediaType}`, click: () => contents.downloadURL(p.srcURL) }, { type: 'separator' });
      else if (p.mediaType === 'video') items.push(
        // streamed video (blob:) can't leave the page — but it can float above everything
        { label: 'Pop Out Video (Picture in Picture)', click: () => contents.executeJavaScript(POP_OUT_JS, true).catch(() => {}) }, { type: 'separator' });
      if (YT_WATCH.test(pageUrl) || (p.linkURL && YT_WATCH.test(p.linkURL))) items.push(
        { label: 'Watch in Relay Player', click: () => win.webContents.send('media:open-url', { url: YT_WATCH.test(p.linkURL || '') ? p.linkURL : pageUrl, title: contents.getTitle(), web: true }) }, { type: 'separator' });
      if (p.linkURL && /\.(mp4|m4v|mov|webm|mp3|m4a|wav|flac|ogg|m3u8)(\?|$)/i.test(p.linkURL)) items.push(
        { label: 'Play Link in Relay Player', click: () => win.webContents.send('media:open-url', { url: p.linkURL, title: p.linkText || '', partition: part, referer: pageUrl }) }, { type: 'separator' });
      // Package tracking: selected tracking numbers or links to a carrier's tracking page
      const found = Carriers.findInText(p.selectionText || '', p.linkURL ? [p.linkURL] : []);
      if (found.length) items.push(...found.slice(0, 3).map(f => ({
        label: `Track ${Carriers.info(f.carrier).name} package ${f.number.length > 14 ? f.number.slice(0, 6) + '…' + f.number.slice(-4) : f.number}`,
        click: () => win.webContents.send('track:add-request', { ...f, pageUrl: contents.getURL(), pageTitle: contents.getTitle(), partition: part })
      })), { type: 'separator' });
      // Passwords: fill from (or save to) the Relay vault from any page you're signed into
      if (part !== INCOGNITO_PARTITION && (p.isEditable || p.formControlType === 'input-password')) items.push(
        { label: 'Fill Password from Vault…', click: () => win && win.webContents.send('vault:fill-request', { wcId: contents.id, x: p.x, y: p.y }) },
        { label: 'Save Password to Vault…', click: () => win && win.webContents.send('vault:save-request', { wcId: contents.id }) }, { type: 'separator' });
      if (p.misspelledWord) {
        p.dictionarySuggestions.slice(0, 4).forEach(s => items.push({ label: s, click: () => contents.replaceMisspelling(s) }));
        if (p.dictionarySuggestions.length) items.push({ type: 'separator' });
      }
      if (p.selectionText) items.push({ label: 'Ask AI about selection', click: () => win && win.webContents.send('ai:ask-selection', p.selectionText) },
        ...(store.settings.assistEnabled !== false ? [{ label: 'Draft a Reply with Assist', click: () => win && win.webContents.send('assist:draft-selection', p.selectionText) }] : []), { type: 'separator' });
      items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: 'Back', enabled: canGoBack(contents), click: () => (contents.navigationHistory ? contents.navigationHistory.goBack() : contents.goBack()) }, { label: 'Reload', click: () => contents.reload() });
      Menu.buildFromTemplate(items).popup();
    });
  }
});

const YT_WATCH = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i;
const POP_OUT_JS = `(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v) return false; if (document.pictureInPictureElement) { document.exitPictureInPicture(); return true; } v.requestPictureInPicture(); return true; })()`;

/* ---------- media found on web pages (for "Play in Relay Player") ---------- */
const mediaSeen = new Map(); // webContentsId -> Map(url -> info)
const MEDIA_EXT = /\.(m3u8|mp4|m4v|webm|mov|mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i;
function sniffMedia(details, partition) {
  const id = details.webContentsId;
  if (id == null) return;
  if (details.resourceType === 'mainFrame') { mediaSeen.delete(id); return; }
  const u = details.url;
  if (!/^https?:/.test(u)) return;
  const pathOnly = u.split(/[?#]/)[0];
  // skip adaptive-stream fragments (YouTube & friends use these — they can't be played on their own)
  if (/googlevideo\.com|\/videoplayback|\.(ts|m4s|aac\d)$|\/(seg|segment|chunk|frag)[-_]?\d/i.test(pathOnly)) return;
  if (!(details.resourceType === 'media' || MEDIA_EXT.test(pathOnly))) return;
  let m = mediaSeen.get(id);
  if (!m) mediaSeen.set(id, m = new Map());
  if (m.has(u) || m.size > 40) return;
  const kind = /\.m3u8$/i.test(pathOnly) ? 'hls' : /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i.test(pathOnly) ? 'audio' : 'video';
  m.set(u, { url: u, kind, referer: details.referrer || '', partition, at: Date.now() });
}
ipcMain.handle('media:found', (_e, wcId) => [...(mediaSeen.get(wcId)?.values() || [])]);

// When the player streams something found on a page, send that site's cookies & referrer along
// (and relax CORS for the player only), so the stream plays the same as it did on the page.
let mediaCtx = null; // { partition, referer }
ipcMain.handle('media:prepare', async (_e, ctx) => {
  if (ctx && ctx.web) {
    // YouTube's "theater" layout gives the cleanest full-window video
    try { await session.fromPartition(BROWSER_PARTITION).cookies.set({ url: 'https://www.youtube.com', name: 'wide', value: '1', domain: '.youtube.com', path: '/', expirationDate: Date.now() / 1000 + 31536000 }); } catch {}
    return true;
  }
  mediaCtx = ctx && (ctx.partition || ctx.referer) ? ctx : null;
  return true;
});
function setupPlayerSession() {
  const ses = session.defaultSession;
  const forPlayer = (d) => mediaCtx && win && d.webContentsId === win.webContents.id && /^https?:/.test(d.url) && ['media', 'xhr', 'other'].includes(d.resourceType);
  ses.webRequest.onBeforeSendHeaders(async (d, cb) => {
    if (!forPlayer(d)) return cb({});
    const h = { ...d.requestHeaders, 'User-Agent': CHROME_UA };
    if (mediaCtx.referer) h.Referer = mediaCtx.referer;
    if (mediaCtx.partition) {
      try {
        const cookies = await session.fromPartition(mediaCtx.partition).cookies.get({ url: d.url });
        if (cookies.length) h.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      } catch {}
    }
    cb({ requestHeaders: h });
  });
  ses.webRequest.onHeadersReceived((d, cb) => {
    if (!forPlayer(d)) return cb({});
    const rh = {};
    for (const [k, v] of Object.entries(d.responseHeaders || {})) if (!/^access-control-allow-(origin|credentials)$/i.test(k)) rh[k] = v;
    rh['Access-Control-Allow-Origin'] = ['*'];
    cb({ responseHeaders: rh });
  });
}

function canGoBack(c) { try { return c.navigationHistory ? c.navigationHistory.canGoBack() : c.canGoBack(); } catch { return false; } }
function sendBrowserTab(url, incognito) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('browser:open-tab', { url, incognito: !!incognito });
  win.focus();
}
// Links clicked in mail open in Relay's browser tab (or the default browser, if the user prefers)
function openLink(url, incognito, fromBrowser) {
  if (/^mailto:/.test(url)) return shell.openExternal(url);
  if (!/^https?:/.test(url)) return;
  if (fromBrowser || store.settings.openLinksIn !== 'external') sendBrowserTab(url, incognito);
  else shell.openExternal(url);
}

function partitionOf(contents) {
  for (const p of partitionModes.keys()) if (session.fromPartition(p) === contents.session) return p;
  return undefined;
}
function modeOf(contents) {
  const p = partitionOf(contents);
  return (p && partitionModes.get(p)) || 'auto';
}
// Keep the page's browser identity (user agent) in step with the site it is on.
function applyIdentityTracking(contents) {
  const setFor = (url) => {
    const id = identityFor(url, modeOf(contents));
    if (contents.getUserAgent() !== id.ua) contents.setUserAgent(id.ua);
  };
  contents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    const u = e.url || url;
    const main = e.isMainFrame ?? isMainFrame;
    const same = e.isSameDocument ?? isInPlace;
    if (main && !same && u) setFor(u);
  });
  contents.on('will-redirect', (e, url, isInPlace, isMainFrame) => {
    const u = e.url || url;
    if ((e.isMainFrame ?? isMainFrame) && u) setFor(u);
  });
}

ipcMain.on('relay:navigator-patch', (event, url) => {
  try { event.returnValue = navigatorPatch(identityFor(url, modeOf(event.sender))); }
  catch { event.returnValue = null; }
});

function configureSession(partition, mode, adblockOn) {
  if (adblockOn === false) partitionAdblock.set(partition, false); else if (adblockOn === true) partitionAdblock.delete(partition);
  if (mode) partitionModes.set(partition, mode);
  else if (!partitionModes.has(partition)) partitionModes.set(partition, 'auto');
  const ses = session.fromPartition(partition);
  if (ses.__relayConfigured) return;
  ses.__relayConfigured = true;
  ses.setUserAgent(CHROME_UA);
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    let pageUrl = details.url;
    if (details.resourceType !== 'mainFrame') {
      try { pageUrl = details.frame?.top?.url || details.webContents?.getURL() || details.referrer || details.url; } catch { pageUrl = details.referrer || details.url; }
    }
    const id = identityFor(pageUrl, partitionModes.get(partition) || 'auto');
    cb({ requestHeaders: rewriteHeaders(details.requestHeaders, id) });
  });
  // Ad & tracker blocking
  const blockingOn = () => isBrowserPartition(partition)
    ? store.settings.adblockBrowser !== false
    : store.settings.adblockMail !== false && partitionAdblock.get(partition) !== false;
  adblock.attach(ses, blockingOn);
  ses.webRequest.onBeforeRequest((details, cb) => { sniffMedia(details, partition); adblock.onBeforeRequest(ses, details, cb); });
  ses.webRequest.onHeadersReceived((details, cb) => adblock.onHeadersReceived(ses, details, cb));
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['notifications', 'clipboard-sanitized-write', 'clipboard-read', 'media', 'fullscreen'].includes(permission));
  });
  // Every download goes to Relay's downloads folder and into the Downloads tab
  downloads.attach(ses, partition);
}

// Friendly "from" label for the Downloads tab
function describeSource(partition) {
  if (partition === BROWSER_PARTITION) return { sourceLabel: 'Browser', sourceKind: 'browser' };
  if (partition === INCOGNITO_PARTITION) return { sourceLabel: 'Incognito', sourceKind: 'incognito' };
  const id = String(partition || '').replace(/^persist:relay-/, '');
  const acc = store.accounts.find(a => a.id === id);
  if (acc) return { sourceLabel: acc.name || acc.email, sourceKind: 'account', sourceId: acc.id, sourceColor: acc.color };
  const st = (store.storage || []).find(x => x.id === id);
  if (st) return { sourceLabel: st.name, sourceKind: 'storage', sourceId: st.id, sourceColor: st.color };
  return { sourceLabel: 'Relay', sourceKind: 'relay' };
}

// ---------- IPC: state ----------
ipcMain.handle('state:get', () => publicState());

ipcMain.handle('accounts:save', (_e, account) => {
  const i = store.accounts.findIndex(a => a.id === account.id);
  if (i >= 0) store.accounts[i] = { ...store.accounts[i], ...account };
  else store.accounts.push(account);
  saveStore();
  return store.accounts;
});
ipcMain.handle('accounts:remove', async (_e, id) => {
  store.accounts = store.accounts.filter(a => a.id !== id);
  store.events = store.events.filter(ev => ev.accountId !== id);
  (store.tasks || []).forEach(t => { if (t.accountId === id) t.accountId = null; });
  store.storage = (store.storage || []).filter(x => x.linkedAccountId !== id);
  saveStore();
  try { await session.fromPartition('persist:relay-' + id).clearStorageData(); } catch {}
  return store.accounts;
});
ipcMain.handle('accounts:reorder', (_e, ids) => {
  store.accounts.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  saveStore();
  return store.accounts;
});
ipcMain.handle('accounts:signout', async (_e, id) => {
  await session.fromPartition('persist:relay-' + id).clearStorageData();
  return true;
});
ipcMain.handle('session:prepare', (_e, { partition, mode, adblock: ab }) => { configureSession(partition, mode || 'auto', ab); return { preload: 'file://' + WEBVIEW_PRELOAD }; });

// ---------- storage & browser ----------
ipcMain.handle('storage:save', (_e, item) => {
  store.storage = store.storage || [];
  const i = store.storage.findIndex(x => x.id === item.id);
  if (i >= 0) store.storage[i] = { ...store.storage[i], ...item }; else store.storage.push(item);
  saveStore();
  return store.storage;
});
ipcMain.handle('storage:reorder', (_e, ids) => {
  store.storage.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  saveStore();
  return store.storage;
});
ipcMain.handle('storage:remove', async (_e, id) => {
  const item = (store.storage || []).find(x => x.id === id);
  store.storage = (store.storage || []).filter(x => x.id !== id);
  saveStore();
  // Only clear the session if it isn't shared with a mail account
  if (item && !item.linkedAccountId) { try { await session.fromPartition('persist:relay-' + id).clearStorageData(); } catch {} }
  return store.storage;
});
ipcMain.handle('browser:save', (_e, patch) => { store.browser = { ...(store.browser || {}), ...patch }; saveStore(); return true; });
ipcMain.handle('browser:clear-incognito', async () => { try { await session.fromPartition(INCOGNITO_PARTITION).clearStorageData(); await session.fromPartition(INCOGNITO_PARTITION).clearCache(); } catch {} return true; });
ipcMain.handle('browser:clear-data', async () => { await session.fromPartition(BROWSER_PARTITION).clearStorageData(); await session.fromPartition(BROWSER_PARTITION).clearCache(); return true; });
// Drag a file out of Relay (Downloads, Library) into a web page — e.g. upload to Dropbox in split view
ipcMain.on('drag-out', (e, p) => {
  try {
    if (!p || !fs.existsSync(p)) return;
    const { nativeImage } = require('electron');
    e.sender.startDrag({ file: p, icon: nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 32, height: 32 }) });
  } catch {}
});
ipcMain.handle('show-in-folder', (_e, p) => { if (p && (p.startsWith(app.getPath('downloads')) || (store.downloads || []).some(d => d.path === p))) shell.showItemInFolder(p); });
ipcMain.handle('window:close', () => win && win.close());

// ---------- tasks & briefing ----------
ipcMain.handle('tasks:save', (_e, t) => {
  store.tasks = store.tasks || [];
  const i = store.tasks.findIndex(x => x.id === t.id);
  if (i >= 0) store.tasks[i] = { ...store.tasks[i], ...t, updatedAt: Date.now() };
  else store.tasks.unshift({ createdAt: Date.now(), ...t, updatedAt: Date.now() });
  saveStore();
  return store.tasks;
});
ipcMain.handle('tasks:remove', (_e, id) => { store.tasks = (store.tasks || []).filter(t => t.id !== id); saveStore(); return store.tasks; });
ipcMain.handle('tasks:reorder', (_e, ids) => { store.tasks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); saveStore(); return store.tasks; });
ipcMain.handle('briefing:save', (_e, b) => { store.briefing = b; saveStore(); return true; });

ipcMain.handle('events:save', (_e, ev) => {
  const i = store.events.findIndex(x => x.id === ev.id);
  if (i >= 0) store.events[i] = ev; else store.events.push(ev);
  saveStore();
  return store.events;
});
ipcMain.handle('events:remove', (_e, id) => {
  store.events = store.events.filter(x => x.id !== id);
  saveStore();
  return store.events;
});

ipcMain.handle('ui:save', (_e, ui) => { store.ui = { ...store.ui, ...ui }; saveStore(); return true; });

ipcMain.handle('settings:save', (_e, patch) => {
  const p = { ...patch };
  if ('claudeKey' in p) p.claudeKey = encryptKey(p.claudeKey);
  if ('openaiKey' in p) p.openaiKey = encryptKey(p.openaiKey);
  store.settings = { ...store.settings, ...p };
  if (p.theme) { nativeTheme.themeSource = p.theme; syncTitleBar(); }
  saveStore();
  return publicState().settings;
});

ipcMain.handle('gravatar', (_e, email) => {
  const hash = crypto.createHash('md5').update(String(email || '').trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=160&d=404`;
});

ipcMain.handle('dock:badge', (_e, n) => {
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(n > 0 ? String(n > 999 ? '999+' : n) : '');
});

ipcMain.handle('open:external', (_e, url) => shell.openExternal(url));

ipcMain.handle('pick:image', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const buf = fs.readFileSync(r.filePaths[0]);
  const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${buf.toString('base64')}`;
});

// ---------- IPC: calendar feeds (ICS) ----------
ipcMain.handle('calendar:find-link', (_e, { accountId, platform, outlookType }) => {
  const url = platform === 'gmail' ? 'https://calendar.google.com/calendar/u/0/r/settings'
    : platform === 'outlook' ? (outlookType === 'work' ? 'https://outlook.office.com/calendar/options/calendar/SharedCalendars' : 'https://outlook.live.com/calendar/0/options/calendar/SharedCalendars')
    : platform === 'yahoo' ? 'https://calendar.yahoo.com/' : null;
  if (!url) return false;
  const part = store.accounts.find(a => a.id === accountId)?.partition || 'persist:relay-' + accountId;
  configureSession(part);
  const w = new BrowserWindow({ width: 1100, height: 780, parent: win, title: 'Find your calendar link', webPreferences: { partition: part, preload: WEBVIEW_PRELOAD, sandbox: true } });
  applyIdentityTracking(w.webContents);
  w.loadURL(url);
  return true;
});
// People paste all kinds of calendar links. Fix the common ones and explain the rest in plain words.
function normalizeIcsUrl(raw) {
  let u = String(raw || '').trim().replace(/^<|>$/g, '');
  if (!u) throw new Error('Paste the calendar’s .ics link');
  u = u.replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  // Outlook "Publish a calendar" gives an HTML link and an ICS link — they differ only at the end
  u = u.replace(/(outlook\.(live|office|office365)\.com\/owa\/calendar\/[^?#]+)\/calendar\.html(\?.*)?$/i, '$1/calendar.ics');
  if (/calendar\.google\.com\/calendar\/(u\/\d+\/)?(r|embed)\b/i.test(u) && !/\/ical\//i.test(u)) {
    throw new Error('That’s a link to the Google Calendar page, not the calendar file. In Google Calendar → Settings → your calendar → “Integrate calendar”, copy the “Secret address in iCal format”.');
  }
  return u;
}
async function fetchIcsText(url, accountId) {
  const part = accountId ? (store.accounts.find(a => a.id === accountId)?.partition || 'persist:relay-' + accountId) : null;
  const ses = part ? session.fromPartition(part) : session.defaultSession;
  let res;
  try { res = await ses.fetch(url, { headers: { accept: 'text/calendar, text/plain, */*' }, redirect: 'follow' }); }
  catch (e) { throw new Error('Couldn’t reach that calendar — check your internet connection and the link.'); }
  const text = await res.text();
  if (res.status === 404) throw new Error(/google\.com/.test(url) ? 'Google says this calendar doesn’t exist. Use the “Secret address in iCal format” (not the public address unless the calendar is public).' : 'That calendar link no longer exists (404). Copy a fresh link from your calendar’s settings.');
  if (res.status === 401 || res.status === 403) throw new Error('This calendar link is private and needs a secret/published link. Use the “secret address” (Google) or “Publish a calendar → ICS” (Outlook).');
  if (!res.ok) throw new Error(`The calendar server answered with an error (${res.status}). Try again later or copy a fresh link.`);
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) {
    if (/<html|<!doctype/i.test(text.slice(0, 500))) throw new Error('That link opens a web page, not a calendar file. Look for a link ending in .ics (Google: “Secret address in iCal format”; Outlook: the ICS link under “Publish a calendar”).');
    throw new Error('That link didn’t return a calendar file (.ics).');
  }
  return text;
}
ipcMain.handle('calendar:test', async (_e, { url, accountId }) => {
  const fixed = normalizeIcsUrl(url);
  const text = await fetchIcsText(fixed, accountId);
  const ical = require('node-ical');
  const data = ical.sync.parseICS(text);
  const events = Object.values(data).filter(v => v && v.type === 'VEVENT').length;
  const name = (text.match(/^X-WR-CALNAME:(.*)$/m) || [])[1]?.trim() || '';
  return { url: fixed, events, name };
});
ipcMain.handle('calendar:fetch', async (_e, { url, start, end, accountId }) => {
  const ical = require('node-ical');
  const fixed = normalizeIcsUrl(url);
  const data = ical.sync.parseICS(await fetchIcsText(fixed, accountId));
  const rangeStart = new Date(start), rangeEnd = new Date(end);
  const out = [];
  const push = (ev, s, e) => {
    const allDay = ev.datetype === 'date' || (ev.start && ev.start.dateOnly);
    out.push({
      uid: ev.uid + '@' + s.toISOString(),
      title: typeof ev.summary === 'object' ? ev.summary.val : (ev.summary || '(No title)'),
      location: typeof ev.location === 'object' ? ev.location?.val : (ev.location || ''),
      description: typeof ev.description === 'object' ? ev.description?.val : (ev.description || ''),
      start: s.toISOString(),
      end: (e || s).toISOString(),
      allDay: !!allDay
    });
  };
  for (const k in data) {
    const ev = data[k];
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    const dur = (ev.end ? new Date(ev.end) - new Date(ev.start) : 0);
    if (ev.rrule) {
      const fix = recurrenceFixer(ev);
      const dates = ev.rrule.between(new Date(rangeStart.getTime() - dur - 2 * 86400000), new Date(rangeEnd.getTime() + 2 * 86400000), true).map(fix)
        .filter(d => d <= rangeEnd && d.getTime() + dur >= rangeStart.getTime());
      for (const d of dates) {
        const key = d.toISOString().slice(0, 10);
        if (ev.exdate && Object.keys(ev.exdate).some(x => String(x).slice(0, 10) === key)) continue;
        let inst = ev;
        if (ev.recurrences) {
          const r = Object.entries(ev.recurrences).find(([rk]) => String(rk).slice(0, 10) === key);
          if (r) inst = r[1];
        }
        const s = inst === ev ? new Date(d) : new Date(inst.start);
        const e = inst === ev ? new Date(s.getTime() + dur) : new Date(inst.end || inst.start);
        push(inst, s, e);
      }
    } else {
      const s = new Date(ev.start), e = new Date(ev.end || ev.start);
      if (e >= rangeStart && s <= rangeEnd) push(ev, s, e);
    }
  }
  return out;
});

// rrule returns occurrences whose UTC fields hold the wall-clock time of the event's zone.
// Work out which interpretation matches the event's real start and convert every occurrence the same way.
function tzOffsetMs(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
function wallToAbs(d, tz) {
  const guess = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  const off = tzOffsetMs(guess, tz);
  let r = guess - off;
  const off2 = tzOffsetMs(r, tz);
  if (off2 !== off) r = guess - off2;
  return new Date(r);
}
function recurrenceFixer(ev) {
  const start = new Date(ev.start);
  const allDay = ev.datetype === 'date' || ev.start.dateOnly;
  if (allDay) return (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const first = ev.rrule.options?.dtstart ? new Date(ev.rrule.options.dtstart) : null;
  if (!first || +first === +start) return (d) => new Date(d);
  const tz = ev.start.tz && !/^Etc\/UTC$|^UTC$|^Z$/.test(ev.start.tz) ? ev.start.tz : null;
  if (tz) {
    try { if (+wallToAbs(first, tz) === +start) return (d) => wallToAbs(d, tz); } catch { /* unknown zone name */ }
  }
  const local = new Date(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate(), first.getUTCHours(), first.getUTCMinutes(), first.getUTCSeconds());
  if (+local === +start) return (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  const delta = start - first;
  return (d) => new Date(d.getTime() + delta);
}

// ---------- IPC: AI (streaming) ----------
const aiControllers = new Map();

ipcMain.handle('ai:cancel', (_e, reqId) => { aiControllers.get(reqId)?.abort(); aiControllers.delete(reqId); });

async function callAI({ provider, system, messages, signal, onDelta, maxTokens = 4096 }) {
  const stream = !!onDelta;
  let text = '';
  if (provider === 'assist') return plugins.complete({ system, messages, maxTokens, signal, onDelta });
  if (provider === 'claude') {
    const key = decryptKey(store.settings.claudeKey);
    if (!key) throw new Error('Add your Anthropic API key in Settings to use Claude.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: store.settings.claudeModel, max_tokens: maxTokens, system, messages, stream })
    });
    if (!res.ok) throw new Error(await apiError(res));
    if (!stream) { const j = await res.json(); return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); }
    await readSSE(res, (evt) => {
      if (evt.type === 'content_block_delta' && evt.delta?.text) { text += evt.delta.text; onDelta(evt.delta.text); }
      if (evt.type === 'error') throw new Error(evt.error?.message || 'Claude error');
    });
  } else {
    const key = decryptKey(store.settings.openaiKey);
    if (!key) throw new Error('Add your OpenAI API key in Settings to use ChatGPT.');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: store.settings.openaiModel, stream, messages: [{ role: 'system', content: system }, ...messages] })
    });
    if (!res.ok) throw new Error(await apiError(res));
    if (!stream) { const j = await res.json(); return j.choices?.[0]?.message?.content || ''; }
    await readSSE(res, (evt) => {
      const t = evt.choices?.[0]?.delta?.content;
      if (t) { text += t; onDelta(t); }
    });
  }
  return text;
}

ipcMain.handle('ai:chat', async (event, { reqId, provider, messages, system }) => {
  const send = (type, data) => !event.sender.isDestroyed() && event.sender.send('ai:stream', { reqId, type, data });
  const controller = new AbortController();
  aiControllers.set(reqId, controller);
  try {
    await callAI({ provider, system, messages, signal: controller.signal, onDelta: (t) => send('delta', t) });
    send('done');
  } catch (err) {
    if (err.name === 'AbortError') send('done');
    else send('error', err.message || String(err));
  } finally {
    aiControllers.delete(reqId);
  }
});

// One-shot completion (used by the inbox briefing)
ipcMain.handle('ai:complete', async (_e, { provider, system, prompt, maxTokens }) => {
  return callAI({ provider: provider || store.settings.aiProvider || 'claude', system, messages: [{ role: 'user', content: prompt }], maxTokens: maxTokens || 2000 });
});

async function apiError(res) {
  let body = '';
  try { const j = await res.json(); body = j.error?.message || JSON.stringify(j); } catch { body = res.statusText; }
  return `${res.status}: ${body}`;
}

async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { onEvent(JSON.parse(payload)); } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
    }
  }
}

function syncTitleBar() {
  if (IS_MAC || !win || win.isDestroyed()) return;
  try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#f2f0fa' : '#17151f', height: 56 }); } catch {}
}

// ---------- app menu ----------
function buildMenu() {
  const send = (ch, arg) => () => win && win.webContents.send(ch, arg);
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('menu', 'settings') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ] }] : []),
    { label: 'File', submenu: [
      ...(IS_MAC ? [] : [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('menu', 'settings') }, { type: 'separator' }]),
      { label: 'Add Account…', accelerator: 'CmdOrCtrl+N', click: send('menu', 'add-account') },
      { label: 'New Event…', accelerator: 'CmdOrCtrl+Shift+E', click: send('menu', 'new-event') },
      { label: 'New Task / New Tab', accelerator: 'CmdOrCtrl+T', click: send('menu', 'cmd-t') },
      { label: 'New Incognito Tab', accelerator: 'CmdOrCtrl+Shift+N', click: send('menu', 'incognito') },
      { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: send('menu', 'open-location') },
      { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: send('menu', 'find') },
      { type: 'separator' },
      { label: 'Open in Relay Player…', accelerator: 'CmdOrCtrl+Alt+P', click: send('menu', 'open-player') },
      { label: 'Open in Relay Reader…', accelerator: 'CmdOrCtrl+Alt+R', click: send('menu', 'open-reader') },
      { label: 'Track a Package…', accelerator: 'CmdOrCtrl+Shift+P', click: send('menu', 'track-package') },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('menu', 'close-tab') },
      { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => win && win.close() },
      ...(IS_MAC ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Exit Relay' }])
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Home', accelerator: 'CmdOrCtrl+1', click: send('menu', 'tab:home') },
      { label: 'Gmail', accelerator: 'CmdOrCtrl+2', click: send('menu', 'tab:gmail') },
      { label: 'Outlook', accelerator: 'CmdOrCtrl+3', click: send('menu', 'tab:outlook') },
      { label: 'Yahoo', accelerator: 'CmdOrCtrl+4', click: send('menu', 'tab:yahoo') },
      { label: 'Other', accelerator: 'CmdOrCtrl+5', click: send('menu', 'tab:other') },
      { label: 'Calendar', accelerator: 'CmdOrCtrl+6', click: send('menu', 'tab:calendar') },
      { label: 'Storage', accelerator: 'CmdOrCtrl+7', click: send('menu', 'tab:storage') },
      { label: 'Browser', accelerator: 'CmdOrCtrl+8', click: send('menu', 'tab:browser') },
      { label: 'Vault', accelerator: 'CmdOrCtrl+9', click: send('menu', 'tab:vault') },
      { label: 'Library', accelerator: 'CmdOrCtrl+Shift+L', click: send('menu', 'tab:library') },
      { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: send('menu', 'tab:downloads') },
      { label: 'Tracking', accelerator: 'CmdOrCtrl+Shift+K', click: send('menu', 'tab:tracking') },
      { type: 'separator' },
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: send('menu', 'back') },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: send('menu', 'forward') },
      { type: 'separator' },
      { label: 'Inbox Briefing', accelerator: 'CmdOrCtrl+B', click: send('menu', 'briefing') },
      { label: 'Toggle AI Panel', accelerator: 'CmdOrCtrl+J', click: send('menu', 'toggle-ai') },
      { label: 'Toggle Sidebar Size', accelerator: 'CmdOrCtrl+\\', click: send('menu', 'toggle-sidebar') },
      { label: 'Split View', accelerator: 'CmdOrCtrl+Shift+S', click: send('menu', 'split') },
      { label: 'Quick Switcher…', accelerator: 'CmdOrCtrl+K', click: send('menu', 'palette') },
      { label: 'Reload Account', accelerator: 'CmdOrCtrl+R', click: send('menu', 'reload') },
      { type: 'separator' },
      { role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const APP_ICON = path.join(__dirname, '..', 'build', 'icon.png');
app.whenReady().then(() => {
  // same icon everywhere: Dock while running from source, About window, notifications
  if (IS_MAC && !app.isPackaged) try { app.dock.setIcon(APP_ICON); } catch {}
  app.setAboutPanelOptions({ applicationName: 'Relay', applicationVersion: app.getVersion(), iconPath: APP_ICON, copyright: '© 2026 Bilal' });
  loadStore();
  nativeTheme.themeSource = store.settings.theme || 'system';
  buildMenu();
  createWindow();
  vault.register(ipcMain, () => win);
  const ctx = { getStore: () => store, saveStore, getWin: () => win, encryptKey, decryptKey, describeSource };
  library.register(ctx);
  plugins.register(ctx);
  downloads.register({ ...ctx, filesRoot: () => library.root() });
  media.register({ ...ctx, downloadsDir: () => downloads.dir() });
  tracking.register(ctx);
  setupPlayerSession();
  nativeTheme.on('updated', syncTitleBar);
  adblock.init();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { media.stopCast(); clearTimeout(saveTimer); try { fs.writeFileSync(storePath(), JSON.stringify(store, null, 2)); } catch {} });

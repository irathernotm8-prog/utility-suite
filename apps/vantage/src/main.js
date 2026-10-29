// Vantage — main process: windows, browsing sessions, privacy, and the services behind the browser UI.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  app, BrowserWindow, session, ipcMain, Menu, shell, nativeTheme, dialog, webContents, clipboard,
  nativeImage, systemPreferences, Notification
} = require('electron');

const store = require('./core/store');
const adblock = require('./core/adblock');
const vpn = require('./core/vpn');
const downloads = require('./core/downloads');
const vault = require('./core/vault');
const library = require('./core/library');
const media = require('./core/media');
const suitelink = require('./suitelink');
const { IDENTITIES, identityFor, rewriteHeaders, navigatorPatch } = require('./core/identity');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const APP_ICON = path.join(__dirname, '..', 'build', 'icon.png');
const PAGE_PRELOAD = path.join(__dirname, 'page-preload.js');
const NORMAL = 'persist:vantage';
const PRIVATE = 'vantage-private';
const CONTAINER = (id) => `persist:vantage-c-${String(id).replace(/[^a-z0-9-]/gi, '')}`;
const CHROME_UA = IDENTITIES.chrome.ua;
// pages and requests that don't go through a session's own user agent still look like plain Chrome
app.userAgentFallback = CHROME_UA;
const DOH = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  nextdns: 'https://dns.nextdns.io'
};

if (process.env.VANTAGE_USER_DATA) app.setPath('userData', process.env.VANTAGE_USER_DATA);
app.setName('Vantage');
app.setAppUserModelId('com.bilal.vantage');
// Chromium's own multi-part downloading for the downloads Vantage can't split itself
app.commandLine.appendSwitch('enable-features', 'ParallelDownloading');

const pendingUrls = [];
const urlsFromArgv = (argv) => argv.slice(1).filter(a => /^(https?|file):/i.test(a) || (/\.(html?|xhtml|pdf)$/i.test(a) && fs.existsSync(a)))
  .map(a => (/^[a-z]+:/i.test(a) ? a : 'file://' + path.resolve(a)));
if (!process.env.VANTAGE_MULTI && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', (_e, argv) => {
  const urls = urlsFromArgv(argv);
  const w = focusedWin();
  if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); urls.forEach(u => send(w, 'tab:open', { url: u })); if (!urls.length) send(w, 'cmd', 'new-tab'); }
  else createWindow({ urls });
});
app.on('open-url', (e, url) => { e.preventDefault(); openUrls([url]); });
app.on('open-file', (e, file) => { e.preventDefault(); openUrls(['file://' + file]); });
pendingUrls.push(...urlsFromArgv(process.argv));
function openUrls(urls) {
  if (!app.isReady()) return pendingUrls.push(...urls);
  const w = focusedWin(true);
  if (w) { urls.forEach(u => send(w, 'tab:open', { url: u })); w.show(); w.focus(); }
  else createWindow({ urls });
}

/* ---------------- windows ---------------- */
const wins = new Map();      // BrowserWindow.id -> { win, private, key }
let quitting = false;
let lastFocused = null;
function send(w, ch, ...args) { if (w && !w.isDestroyed()) w.webContents.send(ch, ...args); }
function broadcast(ch, ...args) { for (const { win } of wins.values()) send(win, ch, ...args); }
function focusedWin(normalOnly = false) {
  const list = [...wins.values()].filter(x => !normalOnly || !x.private);
  const f = BrowserWindow.getFocusedWindow();
  const hit = list.find(x => x.win === f) || list.find(x => x.win === lastFocused) || list[0];
  return hit ? hit.win : null;
}
function ownerOf(wc) {
  try { const host = wc.hostWebContents || wc; return BrowserWindow.fromWebContents(host) || focusedWin(); } catch { return focusedWin(); }
}
const settings = () => store.settings();
const dark = () => nativeTheme.shouldUseDarkColors;

function createWindow({ isPrivate = false, saved = null, urls = [] } = {}) {
  const b = saved?.bounds;
  const win = new BrowserWindow({
    width: b?.width || 1380, height: b?.height || 880, x: b?.x, y: b?.y, minWidth: 640, minHeight: 420,
    title: 'Vantage',
    backgroundColor: dark() ? '#0b0e13' : '#f3f5f8',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: dark() ? '#e8edf3' : '#1a2030', height: 40 },
    icon: IS_MAC ? undefined : APP_ICON,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, spellcheck: false }
  });
  if (saved?.maximized) win.maximize();
  const key = saved?.key || Math.random().toString(36).slice(2);
  wins.set(win.id, { win, private: isPrivate, key, init: { saved: saved?.state || null, urls, isPrivate } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => { lastFocused = win; });
  win.on('enter-full-screen', () => send(win, 'win:fullscreen', true));
  win.on('leave-full-screen', () => send(win, 'win:fullscreen', false));
  win.webContents.on('will-attach-webview', (_e, wp, params) => {
    // pages never get Node, and only Vantage's own sessions can be used
    delete wp.preload; wp.nodeIntegration = false; wp.contextIsolation = true; wp.sandbox = true; wp.webSecurity = true;
    const p = params.partition || '';
    if (!(p === NORMAL || p === PRIVATE || /^persist:vantage-c-[a-z0-9-]+$/i.test(p))) params.partition = isPrivate ? PRIVATE : NORMAL;
    if (isPrivate) params.partition = PRIVATE;
    prepareSession(params.partition);
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) send(win, 'tab:open', { url }); return { action: 'deny' }; });
  win.on('close', () => {
    if (quitting || isPrivate) return;
    if ([...wins.values()].filter(x => !x.private).length > 1) {
      const s = store.get().session;
      s.windows = (s.windows || []).filter(w => w.key !== key);
      store.save();
    }
  });
  win.on('closed', () => {
    wins.delete(win.id);
    if (isPrivate && ![...wins.values()].some(x => x.private)) clearPrivate();
  });
  return win;
}
async function clearPrivate() {
  try { const s = session.fromPartition(PRIVATE); await s.clearStorageData(); await s.clearCache(); await s.clearAuthCache(); } catch {}
}

/* ---------------- browsing sessions ---------------- */
const prepared = new Set();
const httpOk = new Set();   // hosts where you chose to continue without https
const isLocalHost = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|.*\.local|.*\.localhost|.*\.test|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(h);
// the browser UI's own session is included, so favicons and suggestions follow the VPN too
function allSessions() { return [...[...prepared].map(p => session.fromPartition(p)), session.defaultSession]; }

function prepareSession(partition) {
  if (prepared.has(partition)) return session.fromPartition(partition);
  prepared.add(partition);
  const ses = session.fromPartition(partition);
  const isPrivate = partition === PRIVATE;
  ses.setUserAgent(CHROME_UA);
  ses.registerPreloadScript({ type: 'frame', filePath: PAGE_PRELOAD });
  adblock.attach(ses);
  downloads.attach(ses, partition, { isPrivate });
  ses.webRequest.onBeforeRequest((d, cb) => {
    sniffMedia(d, partition);
    if (d.resourceType === 'mainFrame' && settings().httpsUpgrade !== false && /^http:\/\//i.test(d.url)) {
      let host = ''; try { host = new URL(d.url).hostname; } catch {}
      if (host && !isLocalHost(host) && !httpOk.has(host)) return cb({ redirectURL: 'https://' + d.url.slice(7) });
    }
    adblock.onBeforeRequest(d, cb);
  });
  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    let pageUrl = d.url;
    if (d.resourceType !== 'mainFrame') { try { pageUrl = d.frame?.top?.url || d.webContents?.getURL() || d.referrer || d.url; } catch { pageUrl = d.referrer || d.url; } }
    const h = rewriteHeaders(d.requestHeaders, identityFor(pageUrl, signinMode()));
    if (settings().gpc !== false) { h['Sec-GPC'] = '1'; h.DNT = '1'; }
    cb({ requestHeaders: h });
  });
  ses.webRequest.onHeadersReceived((d, cb) => adblock.onHeadersReceived(d, cb));
  ses.setPermissionRequestHandler((wc, permission, cb, details) => askPermission(wc, permission, cb, details, isPrivate));
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (['fullscreen', 'clipboard-sanitized-write', 'background-sync', 'accessibility-events'].includes(permission)) return true;
    const host = hostOf(origin || wc?.getURL());
    return siteOf(host).perms?.[permission] === 'allow';
  });
  try { ses.setSpellCheckerEnabled(true); } catch {}
  ses.on('select-hid-device', (e, details, cb) => { e.preventDefault(); cb(details.deviceList[0]?.deviceId); });
  // VPN applies to every browsing session, including ones made after it connected
  vpn.applyTo(ses);
  return ses;
}
ipcMain.handle('session:prepare', (_e, { partition }) => { prepareSession(partition || NORMAL); return { preload: null }; });

/* ---------------- sites: zoom, dark pages, permissions ---------------- */
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function siteOf(host) { return settings().sites[host] || {}; }
function setSite(host, patch) {
  if (!host) return {};
  const s = settings().sites;
  s[host] = { ...(s[host] || {}), ...patch };
  for (const [k, v] of Object.entries(s[host])) if (v === null || v === undefined) delete s[host][k];
  if (!Object.keys(s[host]).length) delete s[host];
  store.save();
  return s[host] || {};
}
const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-placement', 'speaker-selection']);
const permAsks = new Map();
let permSeq = 0;
function askPermission(wc, permission, cb, details, isPrivate) {
  if (AUTO_ALLOW.has(permission)) return cb(true);
  if (permission === 'openExternal') {
    const url = details?.externalURL || '';
    return cb(/^(mailto|tel|sms|zoommtg|msteams|slack|spotify|itms-apps|facetime|webex):/i.test(url));
  }
  const host = hostOf(details?.requestingUrl || wc.getURL());
  const stored = siteOf(host).perms?.[permission];
  if (stored) return grant(stored === 'allow');
  const win = ownerOf(wc);
  if (!win) return cb(false);
  const id = ++permSeq;
  const timer = setTimeout(() => { if (permAsks.has(id)) { permAsks.delete(id); cb(false); } }, 120000);
  permAsks.set(id, { grant, host, permission, isPrivate, timer });
  send(win, 'perm:ask', { id, wcId: wc.id, host, permission, mediaTypes: details?.mediaTypes || [] });
  async function grant(allow) {
    if (allow && IS_MAC && permission === 'media') {
      const types = details?.mediaTypes || ['video', 'audio'];
      try {
        if (types.includes('video')) allow = await systemPreferences.askForMediaAccess('camera') && allow;
        if (types.includes('audio')) allow = await systemPreferences.askForMediaAccess('microphone') && allow;
      } catch {}
    }
    cb(!!allow);
  }
}
ipcMain.handle('perm:answer', (_e, { id, allow, remember }) => {
  const a = permAsks.get(id);
  if (!a) return false;
  permAsks.delete(id); clearTimeout(a.timer);
  if (remember && !a.isPrivate) {
    const perms = { ...(siteOf(a.host).perms || {}), [a.permission]: allow ? 'allow' : 'block' };
    setSite(a.host, { perms });
  }
  a.grant(!!allow);
  return true;
});
ipcMain.handle('site:get', (_e, host) => ({ ...siteOf(host), adblockAllowed: adblock.allowed(host), httpOk: httpOk.has(host) }));
ipcMain.handle('site:set', (_e, { host, patch }) => setSite(host, patch));
ipcMain.handle('site:allow-http', (_e, host) => { httpOk.add(host); return true; });
ipcMain.handle('site:clear-data', async (_e, { origin, partition }) => {
  const ses = session.fromPartition(partition || NORMAL);
  await ses.clearStorageData({ origin });
  return true;
});
ipcMain.handle('site:forget-permission', (_e, { host, permission }) => {
  const perms = { ...(siteOf(host).perms || {}) }; delete perms[permission];
  return setSite(host, { perms: Object.keys(perms).length ? perms : null });
});

/* ---------------- web page contents ---------------- */
const YT_WATCH = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i;
const POP_OUT_JS = `(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v) return false; if (document.pictureInPictureElement) { document.exitPictureInPicture(); return true; } v.requestPictureInPicture(); return true; })()`;

const signinMode = () => settings().signinMode || 'auto';
function applyIdentityTracking(contents) {
  const setFor = (url) => { const id = identityFor(url, signinMode()); if (contents.getUserAgent() !== id.ua) contents.setUserAgent(id.ua); };
  contents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument && e.url) setFor(e.url); });
  contents.on('will-redirect', (e) => { if (e.isMainFrame && e.url) setFor(e.url); });
}
ipcMain.on('vantage:navigator-patch', (event, url) => {
  try { event.returnValue = navigatorPatch(identityFor(url, signinMode())); } catch { event.returnValue = null; }
});

/* ---------------- sign-in help (from Relay) ----------------
   Google shows "This browser or app may not be secure" when it rejects a sign-in. Vantage then steps through
   other browser identities for the sign-in page by itself, and the Sign-in settings let you pick one or start over. */
const SIGNIN_NEXT = { auto: 'safari', firefox: 'safari', safari: 'edge', edge: 'chrome', chrome: null };
async function restartSignin(wc) {
  const ses = wc.session;
  try { await ses.clearStorageData({ origin: 'https://accounts.google.com' }); } catch {}
  // go back to the last sign-in step that wasn't the rejection, so "continue to" survives
  let target = 'https://accounts.google.com/';
  try {
    const entries = wc.navigationHistory.getAllEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const u = entries[i].url || '';
      if (/^https:\/\/accounts\.google\.com\//.test(u) && !/rejected|disallowed|deniedsignin|unsupportedbrowser/i.test(u)) {
        try { const x = new URL(u); const cont = x.searchParams.get('continue'); target = cont ? `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(cont)}` : u; } catch { target = u; }
        break;
      }
    }
  } catch {}
  wc.loadURL(target).catch(() => {});
}
ipcMain.handle('signin:blocked', async (_e, wcId) => {
  const wc = webContents.fromId(wcId);
  const cur = signinMode();
  const next = SIGNIN_NEXT[cur];
  if (!wc || !next) return { mode: cur, next: null };
  settings().signinMode = next; store.save(); broadcast('settings:changed', settings());
  await restartSignin(wc);
  return { mode: cur, next };
});
ipcMain.handle('signin:set', async (_e, { mode, wcId, restart }) => {
  if (mode) { settings().signinMode = mode; store.save(); broadcast('settings:changed', settings()); }
  const wc = wcId != null && webContents.fromId(wcId);
  if (wc && restart) await restartSignin(wc);
  return settings().signinMode;
});
ipcMain.handle('signin:reset', async () => {
  for (const ses of allSessions()) { try { await ses.clearStorageData({ origin: 'https://accounts.google.com' }); } catch {} }
  settings().signinMode = 'auto'; store.save(); broadcast('settings:changed', settings());
  return true;
});

function searchUrl(q) {
  const E = { google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=', bing: 'https://www.bing.com/search?q=', brave: 'https://search.brave.com/search?q=', startpage: 'https://www.startpage.com/do/search?q=' };
  return (E[settings().searchEngine] || E.google) + encodeURIComponent(q);
}

app.on('web-contents-created', (_e, contents) => {
  const type = contents.getType();
  if (type !== 'webview' && !(type === 'window' && contents.session !== session.defaultSession)) return;
  applyIdentityTracking(contents);
  vpn.applyWebRTC(contents);
  contents.setWindowOpenHandler(({ url, disposition, features }) => {
    const win = ownerOf(contents);
    const popup = disposition === 'new-window' && (/(width|height|popup)/i.test(features || '') || url === 'about:blank' || !url);
    if (popup) {
      const w = Number((/width=(\d+)/i.exec(features || '') || [])[1]) || 520;
      const h = Number((/height=(\d+)/i.exec(features || '') || [])[1]) || 720;
      return { action: 'allow', overrideBrowserWindowOptions: { width: Math.max(320, w), height: Math.max(300, h), parent: win || undefined, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { session: contents.session, sandbox: true, contextIsolation: true } } };
    }
    if (/^https?:|^file:|^about:/i.test(url)) send(win, 'tab:open', { url, background: disposition === 'background-tab', fromWcId: contents.id });
    else if (/^(mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('context-menu', (_ev, p) => pageMenu(contents, p));
});

function pageMenu(contents, p) {
  const win = ownerOf(contents);
  const tell = (cmd, arg) => send(win, 'cmd', cmd, { ...arg, wcId: contents.id });
  const items = [];
  const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
  const pageUrl = contents.getURL();
  if (p.linkURL && /^(https?|file):/.test(p.linkURL)) {
    items.push(
      { label: 'Open Link in New Tab', click: () => send(win, 'tab:open', { url: p.linkURL, background: true, fromWcId: contents.id }) },
      { label: 'Open Link in Split View', click: () => tell('open-in-split', { url: p.linkURL }) },
      { label: 'Open Link in New Window', click: () => createWindow({ urls: [p.linkURL] }) },
      { label: 'Open Link in Private Window', click: () => createWindow({ isPrivate: true, urls: [p.linkURL] }) },
      { label: 'Open Link in Container', submenu: settings().containers.map(c => ({ label: c.name, click: () => send(win, 'tab:open', { url: p.linkURL, container: c.id }) })) },
      { type: 'separator' },
      { label: 'Save Link As…', click: () => contents.downloadURL(p.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) });
    if (/\.(mp4|m4v|mov|webm|mp3|m4a|wav|flac|ogg|m3u8)(\?|$)/i.test(p.linkURL)) items.push({ label: 'Play Link in Vantage Player', click: () => send(win, 'media:open-url', { url: p.linkURL, title: p.linkText || '', partition: partitionOf(contents), referer: pageUrl }) });
    if (YT_WATCH.test(p.linkURL)) items.push({ label: 'Watch in Vantage Player', click: () => send(win, 'media:open-url', { url: p.linkURL, title: p.linkText || '', web: true }) });
    sep();
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      { label: 'Open Image in New Tab', click: () => send(win, 'tab:open', { url: p.srcURL, background: true }) },
      { label: 'Save Image As…', click: () => contents.downloadURL(p.srcURL) },
      { label: 'Copy Image', click: () => contents.copyImageAt(p.x, p.y) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) },
      { label: 'View in Vantage Reader', click: () => send(win, 'reader:open-url', { url: p.srcURL, title: contents.getTitle(), partition: partitionOf(contents) }) });
    sep();
  }
  if ((p.mediaType === 'video' || p.mediaType === 'audio') && /^https?:/.test(p.srcURL || '')) {
    items.push({ label: 'Play in Vantage Player', click: () => send(win, 'media:open-url', { url: p.srcURL, title: contents.getTitle(), partition: partitionOf(contents), referer: pageUrl }) },
      { label: `Save ${p.mediaType === 'video' ? 'Video' : 'Audio'} As…`, click: () => contents.downloadURL(p.srcURL) });
  }
  if (p.mediaType === 'video') items.push({ label: 'Open in Mini Player', click: () => tell('mini-player') }, { label: 'Picture in Picture', click: () => contents.executeJavaScript(POP_OUT_JS, true).catch(() => {}) });
  sep();
  if (YT_WATCH.test(pageUrl) && !p.linkURL) { items.push({ label: 'Watch in Vantage Player (cinema view)', click: () => send(win, 'media:open-url', { url: pageUrl, title: contents.getTitle(), web: true }) }); sep(); }
  if (p.misspelledWord) {
    p.dictionarySuggestions.slice(0, 5).forEach(s => items.push({ label: s, click: () => contents.replaceMisspelling(s) }));
    items.push({ label: 'Add to Dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    sep();
  }
  const sel = (p.selectionText || '').trim();
  if (sel) {
    const short = sel.length > 32 ? sel.slice(0, 30) + '…' : sel;
    items.push({ label: `Search for “${short}”`, click: () => send(win, 'tab:open', { url: searchUrl(sel), fromWcId: contents.id }) });
    if (/^(https?:\/\/)?[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(sel)) items.push({ label: 'Open as Link', click: () => send(win, 'tab:open', { url: /^https?:/.test(sel) ? sel : 'https://' + sel }) });
    if (IS_MAC) items.push({ label: `Look Up “${short}”`, click: () => contents.showDefinitionForSelection() });
    sep();
  }
  if (p.isEditable) {
    items.push({ role: 'undo', enabled: p.editFlags.canUndo }, { role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' },
      { role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste },
      { role: 'pasteAndMatchStyle', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
    if (partitionOf(contents) !== PRIVATE) items.push({ type: 'separator' }, { label: 'Fill from Vantage Vault…', click: () => send(win, 'vault:fill-request', { wcId: contents.id }) });
    sep();
  } else if (sel) { items.push({ role: 'copy' }); sep(); }
  if (!p.linkURL && !p.isEditable && !sel && p.mediaType === 'none') {
    const nav = contents.navigationHistory;
    items.push(
      { label: 'Back', enabled: nav.canGoBack(), click: () => nav.goBack() },
      { label: 'Forward', enabled: nav.canGoForward(), click: () => nav.goForward() },
      { label: 'Reload', click: () => contents.reload() },
      { type: 'separator' },
      { label: 'Reader View', click: () => tell('reader-view') },
      { label: 'Save to Read Later', click: () => tell('read-later') },
      { label: 'Save Page As…', click: () => tell('save-page') },
      { label: 'Print…', click: () => contents.print() },
      { label: 'Take Screenshot', click: () => tell('screenshot') },
      { label: 'Translate Page', click: () => send(win, 'tab:open', { url: 'https://translate.google.com/translate?sl=auto&tl=en&u=' + encodeURIComponent(pageUrl) }) },
      { type: 'separator' },
      { label: 'View Page Source', click: () => send(win, 'tab:open', { url: 'view-source:' + pageUrl }) });
  }
  sep();
  items.push({ label: 'Inspect Element', click: () => { contents.inspectElement(p.x, p.y); if (contents.isDevToolsOpened()) contents.devToolsWebContents?.focus(); } });
  Menu.buildFromTemplate(items).popup({ window: win || undefined });
}
function partitionOf(contents) {
  for (const p of prepared) if (session.fromPartition(p) === contents.session) return p;
  return NORMAL;
}

/* ---------------- media found on pages (for the Player) ---------------- */
const mediaSeen = new Map();
const MEDIA_EXT = /\.(m3u8|mp4|m4v|webm|mov|mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i;
function sniffMedia(d, partition) {
  const id = d.webContentsId;
  if (id == null) return;
  if (d.resourceType === 'mainFrame') { mediaSeen.delete(id); return; }
  const u = d.url;
  if (!/^https?:/.test(u)) return;
  const pathOnly = u.split(/[?#]/)[0];
  if (/googlevideo\.com|\/videoplayback|\.(ts|m4s|aac\d)$|\/(seg|segment|chunk|frag)[-_]?\d/i.test(pathOnly)) return;
  if (!(d.resourceType === 'media' || MEDIA_EXT.test(pathOnly))) return;
  let m = mediaSeen.get(id);
  if (!m) mediaSeen.set(id, m = new Map());
  if (m.has(u) || m.size > 40) return;
  const kind = /\.m3u8$/i.test(pathOnly) ? 'hls' : /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i.test(pathOnly) ? 'audio' : 'video';
  m.set(u, { url: u, kind, referer: d.referrer || '', partition, at: Date.now() });
}
ipcMain.handle('media:found', (_e, wcId) => [...(mediaSeen.get(wcId)?.values() || [])]);
let mediaCtx = null;
ipcMain.handle('media:prepare', async (_e, ctx) => {
  if (ctx && ctx.web) {
    try { await session.fromPartition(NORMAL).cookies.set({ url: 'https://www.youtube.com', name: 'wide', value: '1', domain: '.youtube.com', path: '/', expirationDate: Date.now() / 1000 + 31536000 }); } catch {}
    return true;
  }
  mediaCtx = ctx && (ctx.partition || ctx.referer) ? ctx : null;
  return true;
});
function setupPlayerSession() {
  const ses = session.defaultSession;
  const chromeIds = () => new Set([...wins.values()].map(x => x.win.webContents.id));
  const forPlayer = (d) => mediaCtx && chromeIds().has(d.webContentsId) && /^https?:/.test(d.url) && ['media', 'xhr', 'other'].includes(d.resourceType);
  ses.webRequest.onBeforeSendHeaders(async (d, cb) => {
    if (!forPlayer(d)) return cb({});
    const h = { ...d.requestHeaders, 'User-Agent': CHROME_UA };
    if (mediaCtx.referer) h.Referer = mediaCtx.referer;
    if (mediaCtx.partition) {
      try { const cookies = await session.fromPartition(mediaCtx.partition).cookies.get({ url: d.url }); if (cookies.length) h.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; '); } catch {}
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

/* ---------------- settings ---------------- */
function applyTheme() {
  nativeTheme.themeSource = settings().theme || 'system';
  for (const { win } of wins.values()) {
    if (!IS_MAC) try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark() ? '#e8edf3' : '#1a2030', height: 40 }); } catch {}
  }
}
function applyDns() {
  const mode = settings().secureDns || 'automatic';
  try {
    app.configureHostResolver({ secureDnsMode: mode === 'secure' ? 'secure' : mode === 'off' ? 'off' : 'automatic', secureDnsServers: mode === 'off' ? [] : [DOH[settings().dnsProvider] || DOH.cloudflare] });
  } catch (e) { console.error('dns', e.message); }
}
ipcMain.handle('settings:get', () => settings());
ipcMain.handle('settings:set', async (_e, patch) => {
  const s = store.get();
  const before = JSON.stringify(s.settings.adblock);
  s.settings = store.merge(s.settings, patch);
  if (patch.containers) s.settings.containers = patch.containers;
  if (patch.adblock?.allow) s.settings.adblock.allow = patch.adblock.allow;
  if (patch.vault?.never) s.settings.vault.never = patch.vault.never;
  store.save();
  if ('theme' in patch) applyTheme();
  if ('secureDns' in patch || 'dnsProvider' in patch) applyDns();
  if (patch.adblock && JSON.stringify(s.settings.adblock) !== before) {
    if ('strict' in patch.adblock) adblock.reload(true); else adblock.applyCustom();
  }
  if (patch.vpn && ('webrtc' in patch.vpn)) vpn.applyWebRTC();
  broadcast('settings:changed', s.settings);
  return s.settings;
});

/* ---------------- history & bookmarks ---------------- */
ipcMain.on('history:visit', (e, v) => { if (!wins.get(BrowserWindow.fromWebContents(e.sender)?.id)?.private) store.addVisit(v); });
ipcMain.on('history:title', (e, { url, title }) => { if (!wins.get(BrowserWindow.fromWebContents(e.sender)?.id)?.private) store.setTitle(url, title); });
ipcMain.handle('history:search', (_e, { q, limit, before }) => store.searchHistory(q, limit, before));
ipcMain.handle('history:frecent', (_e, { q, limit }) => store.frecent(q, limit));
ipcMain.handle('history:top', (_e, limit) => store.topSites(limit));
ipcMain.handle('history:delete', (_e, opts) => { store.deleteHistory(opts); return true; });

const bm = () => store.get().bookmarks;
ipcMain.handle('bookmarks:list', () => bm());
ipcMain.handle('bookmarks:save', (_e, b) => {
  const list = bm();
  const i = list.findIndex(x => x.id === b.id);
  if (i >= 0) list[i] = { ...list[i], ...b };
  else list.push({ id: Math.random().toString(36).slice(2, 10), folder: 'Bar', at: Date.now(), ...b });
  store.save(); broadcast('bookmarks:changed', list);
  return list;
});
ipcMain.handle('bookmarks:delete', (_e, id) => { store.get().bookmarks = bm().filter(x => x.id !== id); store.save(); broadcast('bookmarks:changed', bm()); return bm(); });
ipcMain.handle('bookmarks:reorder', (_e, ids) => {
  const map = new Map(bm().map(b => [b.id, b]));
  const rest = bm().filter(b => !ids.includes(b.id));
  store.get().bookmarks = [...ids.map(id => map.get(id)).filter(Boolean), ...rest];
  store.save(); broadcast('bookmarks:changed', bm()); return bm();
});
function chromeBookmarkFiles() {
  const home = app.getPath('home');
  const base = IS_MAC ? path.join(home, 'Library', 'Application Support') : process.env.LOCALAPPDATA || '';
  const browsers = IS_MAC
    ? [['Chrome', 'Google/Chrome'], ['Brave', 'BraveSoftware/Brave-Browser'], ['Edge', 'Microsoft Edge'], ['Arc', 'Arc/User Data'], ['Chromium', 'Chromium']]
    : [['Chrome', 'Google/Chrome/User Data'], ['Brave', 'BraveSoftware/Brave-Browser/User Data'], ['Edge', 'Microsoft/Edge/User Data']];
  return browsers.map(([name, rel]) => ({ name, file: path.join(base, rel, 'Default', 'Bookmarks') })).filter(b => fs.existsSync(b.file));
}
ipcMain.handle('bookmarks:import-sources', () => chromeBookmarkFiles().map(b => b.name));
ipcMain.handle('bookmarks:import', (_e, name) => {
  const src = chromeBookmarkFiles().find(b => b.name === name);
  if (!src) throw new Error(`No ${name} bookmarks found`);
  const j = JSON.parse(fs.readFileSync(src.file, 'utf8'));
  const have = new Set(bm().map(b => b.url));
  let added = 0;
  const walk = (node, folder) => {
    if (node.type === 'url') { if (!have.has(node.url) && /^https?:/.test(node.url)) { bm().push({ id: Math.random().toString(36).slice(2, 10), title: node.name, url: node.url, folder, at: Date.now() }); have.add(node.url); added++; } return; }
    for (const c of node.children || []) walk(c, c.type === 'folder' ? `${folder}/${c.name}` : folder);
  };
  if (j.roots?.bookmark_bar) walk(j.roots.bookmark_bar, 'Bar');
  if (j.roots?.other) walk(j.roots.other, 'Other');
  if (j.roots?.synced) walk(j.roots.synced, 'Mobile');
  store.save(); broadcast('bookmarks:changed', bm());
  return { added };
});

/* ---------------- search suggestions ---------------- */
ipcMain.handle('suggest', async (_e, q) => {
  if (!q || settings().suggestions === false || settings().engineSuggestions === false) return [];
  const engine = settings().searchEngine;
  const url = engine === 'duckduckgo' ? `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`
    : engine === 'bing' ? `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`
    : engine === 'brave' ? `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}`
    : `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`;
  try {
    const r = await prepareSession(NORMAL).fetch(url, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    return (Array.isArray(j) ? j[1] : []).slice(0, 6).map(String);
  } catch { return []; }
});

/* ---------------- pages: reader view, screenshots, save ---------------- */
let readabilitySrc = null;
ipcMain.handle('page:reader', async (_e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc) return null;
  if (!readabilitySrc) readabilitySrc = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
  const js = `(() => { ${readabilitySrc}\n; try { const a = new Readability(document.cloneNode(true)).parse(); return a ? { title: a.title, byline: a.byline, siteName: a.siteName, content: a.content, length: a.length } : null; } catch (e) { return null; } })()`;
  return wc.executeJavaScript(js, true).catch(() => null);
});
ipcMain.handle('page:screenshot', async (_e, { wcId, copy }) => {
  const wc = webContents.fromId(wcId);
  if (!wc) return null;
  const img = await wc.capturePage();
  if (copy) { clipboard.writeImage(img); return { copied: true }; }
  const name = `${(wc.getTitle() || 'Screenshot').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)} ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
  const p = path.join(downloads.dir(), name);
  fs.writeFileSync(p, img.toPNG());
  return { path: p };
});
ipcMain.handle('page:save', async (e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc) return false;
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: path.join(downloads.dir(), (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]/g, '_') + '.html') });
  if (r.canceled || !r.filePath) return false;
  await wc.savePage(r.filePath, 'HTMLComplete');
  return true;
});
ipcMain.handle('page:adblock-count', (_e, wcId) => adblock.count(wcId));
ipcMain.handle('page:devtools', (_e, wcId) => { const wc = webContents.fromId(wcId); if (wc) wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'right' }); });
ipcMain.handle('page:print', (_e, wcId) => { webContents.fromId(wcId)?.print(); });

/* ---------------- site icons ----------------
   The best icon a site offers (apple-touch-icon or a large <link rel=icon>, else /favicon.ico), fetched through
   the browsing session (so it follows the VPN) and kept as a small data URL for bookmarks and New Tab tiles. */
const iconJobs = new Map();
async function fetchIcon(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  const ses = prepareSession(NORMAL);
  const get = async (u, ms = 7000) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { return await ses.fetch(u, { signal: ctl.signal, headers: { 'User-Agent': CHROME_UA } }); } finally { clearTimeout(t); }
  };
  const cands = [];
  try {
    const r = await get(origin + '/');
    if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
      const html = (await r.text()).slice(0, 300000);
      const base = r.url || origin + '/';
      for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = m[0];
        const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
        if (!/icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
        const href = (/\bhref\s*=\s*["']?([^"' >]+)/i.exec(tag) || [])[1];
        if (!href) continue;
        const sizes = (/\bsizes\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
        const px = /any/i.test(sizes) ? 256 : Math.max(0, ...sizes.split(/\s+/).map(x => parseInt(x, 10) || 0));
        let score = /apple-touch/i.test(rel) ? 180 : px || (/\.svg(\?|$)/i.test(href) ? 200 : 32);
        if (score > 400) score = 400 - score / 100;   // huge images are slow and look the same
        try { cands.push({ url: new URL(href, base).href, score }); } catch {}
      }
    }
  } catch {}
  cands.sort((a, b) => b.score - a.score);
  cands.push({ url: origin + '/favicon.ico', score: 1 });
  for (const c of cands.slice(0, 5)) {
    try {
      if (/^data:image\//.test(c.url)) return c.url.length < 300000 ? c.url : null;
      const r = await get(c.url);
      if (!r.ok) continue;
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 60 || buf.length > 400000) continue;
      const mime = /^image\//.test(type) ? type : /\.svg(\?|$)/i.test(c.url) ? 'image/svg+xml' : /\.png(\?|$)/i.test(c.url) ? 'image/png' : 'image/x-icon';
      if (mime === 'image/svg+xml' || mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') return `data:${mime};base64,${buf.toString('base64')}`;
      // shrink big bitmaps so the data stays small
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) continue;
      const { width } = img.getSize();
      return (width > 128 ? img.resize({ width: 128, quality: 'best' }) : img).toDataURL();
    } catch {}
  }
  return null;
}
ipcMain.handle('favicon:get', async (_e, { url, refresh }) => {
  let host; try { host = new URL(url).hostname; } catch { return null; }
  const cache = store.get().favicons;
  const hit = cache[host];
  if (hit && !refresh && (hit.data || Date.now() - hit.t < 86400000)) return hit.data || null;
  if (!iconJobs.has(host)) iconJobs.set(host, fetchIcon(url).then((data) => {
    cache[host] = { data: data || '', t: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > 600) for (const k of keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, 100)) delete cache[k];
    store.save(); return data;
  }).finally(() => iconJobs.delete(host)));
  return iconJobs.get(host);
});

/* ---------------- page thumbnails (New Tab's "Jump back in") ---------------- */
const thumbsFile = () => path.join(app.getPath('userData'), 'thumbs.json');
let thumbs = null;
const loadThumbs = () => { if (!thumbs) { try { thumbs = JSON.parse(fs.readFileSync(thumbsFile(), 'utf8')); } catch { thumbs = {}; } } return thumbs; };
let thumbsT = null;
const saveThumbs = () => { clearTimeout(thumbsT); thumbsT = setTimeout(() => { try { fs.writeFileSync(thumbsFile(), JSON.stringify(thumbs)); } catch {} }, 1500); };
const thumbKey = (u) => String(u || '').replace(/#.*$/, '');
ipcMain.handle('thumb:capture', async (e, { wcId, url }) => {
  if (wins.get(BrowserWindow.fromWebContents(e.sender)?.id)?.private) return false;
  const wc = webContents.fromId(wcId);
  if (!wc || !/^https?:/.test(url || '')) return false;
  try {
    const img = await wc.capturePage();
    if (img.isEmpty()) return false;
    const small = img.resize({ width: 480, quality: 'good' });
    const t = loadThumbs();
    t[thumbKey(url)] = { d: 'data:image/jpeg;base64,' + small.toJPEG(68).toString('base64'), t: Date.now() };
    const keys = Object.keys(t);
    if (keys.length > 60) for (const k of keys.sort((a, b) => t[a].t - t[b].t).slice(0, keys.length - 60)) delete t[k];
    saveThumbs();
    return true;
  } catch { return false; }
});
ipcMain.handle('thumb:get', (_e, urls) => { const t = loadThumbs(); const out = {}; for (const u of urls || []) { const x = t[thumbKey(u)]; if (x) out[u] = x.d; } return out; });

/* ---------------- New Tab: background picture of the day, your own picture ---------------- */
ipcMain.handle('newtab:daily', async () => {
  const dir = path.join(app.getPath('userData'), 'wallpapers');
  const today = new Date().toISOString().slice(0, 10);
  const metaFile = path.join(dir, 'daily.json');
  try { const m = JSON.parse(fs.readFileSync(metaFile, 'utf8')); if (m.day === today && fs.existsSync(m.file)) return { url: require('url').pathToFileURL(m.file).href, credit: m.credit, link: m.link }; } catch {}
  try {
    const ses = prepareSession(NORMAL);
    const j = await (await ses.fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US')).json();
    const im = j.images?.[0];
    if (!im?.url) throw new Error('no image');
    const r = await ses.fetch('https://www.bing.com' + im.url.replace(/_\d+x\d+\.jpg/, '_UHD.jpg'));
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^daily-/.test(f)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
    const file = path.join(dir, `daily-${today}.jpg`);
    fs.writeFileSync(file, buf);
    const meta = { day: today, file, credit: im.copyright || '', link: im.copyrightlink || '' };
    fs.writeFileSync(metaFile, JSON.stringify(meta));
    return { url: require('url').pathToFileURL(file).href, credit: meta.credit, link: meta.link };
  } catch { return null; }
});
ipcMain.handle('newtab:pick-image', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Choose a background picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.join(app.getPath('userData'), 'wallpapers');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^mine-/.test(f)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
  const file = path.join(dir, `mine-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase() || '.jpg'}`);
  fs.copyFileSync(r.filePaths[0], file);
  const url = require('url').pathToFileURL(file).href;
  settings().newtab.image = url; settings().newtab.bg = 'image'; store.save(); broadcast('settings:changed', settings());
  return url;
});

/* ---------------- read later & notes ---------------- */
ipcMain.handle('readlater:list', () => store.get().readLater);
ipcMain.handle('readlater:add', (_e, { url, title }) => {
  const list = store.get().readLater;
  if (!/^https?:/.test(url || '')) return list;
  const i = list.findIndex(x => x.url === url);
  if (i >= 0) list.splice(i, 1);
  list.unshift({ url, title: title || url, at: Date.now() });
  if (list.length > 200) list.length = 200;
  store.save(); broadcast('readlater:changed', list); return list;
});
ipcMain.handle('readlater:remove', (_e, url) => {
  store.get().readLater = store.get().readLater.filter(x => x.url !== url);
  store.save(); broadcast('readlater:changed', store.get().readLater); return store.get().readLater;
});
ipcMain.handle('notes:get', () => store.get().notes || '');
ipcMain.handle('notes:set', (e, text) => { store.get().notes = String(text || '').slice(0, 20000); store.save(); for (const { win } of wins.values()) if (win.webContents !== e.sender) send(win, 'notes:changed', store.get().notes); return true; });

/* ---------------- privacy ---------------- */
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
ipcMain.handle('adblock:status', () => {
  const st = store.get().stats;
  const week = [];
  for (let i = 6; i >= 0; i--) { const k = dayKey(Date.now() - i * 86400000); week.push({ day: k, n: st.daily?.[k] || 0 }); }
  return { ...adblock.status(), total: st.blocked, since: st.since, week };
});
ipcMain.handle('adblock:site', (_e, { host, allow }) => { adblock.setAllowed(host, allow); broadcast('settings:changed', settings()); return true; });
ipcMain.handle('adblock:reload', () => adblock.reload(true).then(() => true));
ipcMain.handle('data:clear', async (_e, { since = 0, history = true, cookies = false, cache = true, downloadsList = false }) => {
  if (history) store.deleteHistory(since ? { since } : { all: true });
  for (const ses of allSessions()) {
    if (cache) await ses.clearCache();
    if (cookies) await ses.clearStorageData();
  }
  if (downloadsList) { store.get().downloads = store.get().downloads.filter(d => ['progressing', 'paused'].includes(d.state)); store.save(); }
  return true;
});

/* ---------------- VPN ---------------- */
ipcMain.handle('vpn:state', () => vpn.state());
ipcMain.handle('vpn:connect', (_e, mode) => vpn.connect(mode));
ipcMain.handle('vpn:disconnect', () => vpn.disconnect());
ipcMain.handle('vpn:check', () => vpn.check().then(() => vpn.state()));
ipcMain.handle('vpn:reset-warp', () => { vpn.resetWarp(); return vpn.state(); });
ipcMain.handle('vpn:import', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Choose a WireGuard config', properties: ['openFile'], filters: [{ name: 'WireGuard config', extensions: ['conf'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  await vpn.importWireGuard(fs.readFileSync(r.filePaths[0], 'utf8'), path.basename(r.filePaths[0], '.conf'));
  return vpn.state();
});
ipcMain.handle('vpn:import-text', async (_e, { text, name }) => { await vpn.importWireGuard(text, name); return vpn.state(); });
ipcMain.handle('vpn:proxy', (_e, { type, host, port, user, pass }) => {
  settings().vpn.proxy = { type: type || 'socks5', host: String(host || '').trim(), port: Number(port) || 1080, user: user || '' };
  if (pass !== undefined) vpn.setProxyPassword(pass);
  store.save();
  return true;
});
app.on('login', (event, _wc, details, authInfo, cb) => {
  if (!authInfo.isProxy) return;
  const a = vpn.proxyAuth();
  if (a) { event.preventDefault(); cb(a.user, a.pass); }
});

/* ---------------- default browser ---------------- */
function isDefault() { try { return app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http'); } catch { return false; } }
ipcMain.handle('default:status', () => isDefault());
ipcMain.handle('default:set', async () => {
  if (IS_MAC) { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); return isDefault(); }
  if (IS_WIN) {
    const exe = process.execPath;
    const base = 'HKCU\\Software\\Clients\\StartMenuInternet\\Vantage';
    const cmd = `"${exe}" "%1"`;
    const regs = [
      [base, '', 'Vantage'],
      [base + '\\Capabilities', 'ApplicationName', 'Vantage'],
      [base + '\\Capabilities', 'ApplicationDescription', 'A fast, private browser'],
      [base + '\\Capabilities\\URLAssociations', 'http', 'VantageURL'],
      [base + '\\Capabilities\\URLAssociations', 'https', 'VantageURL'],
      [base + '\\Capabilities\\FileAssociations', '.html', 'VantageHTML'],
      [base + '\\Capabilities\\FileAssociations', '.htm', 'VantageHTML'],
      [base + '\\Capabilities\\FileAssociations', '.pdf', 'VantageHTML'],
      [base + '\\DefaultIcon', '', `${exe},0`],
      [base + '\\shell\\open\\command', '', `"${exe}"`],
      ['HKCU\\Software\\RegisteredApplications', 'Vantage', 'Software\\Clients\\StartMenuInternet\\Vantage\\Capabilities'],
      ['HKCU\\Software\\Classes\\VantageURL', '', 'Vantage URL'],
      ['HKCU\\Software\\Classes\\VantageURL', 'URL Protocol', ''],
      ['HKCU\\Software\\Classes\\VantageURL\\shell\\open\\command', '', cmd],
      ['HKCU\\Software\\Classes\\VantageHTML', '', 'Vantage HTML Document'],
      ['HKCU\\Software\\Classes\\VantageHTML\\shell\\open\\command', '', cmd]
    ];
    for (const [k, v, d] of regs) {
      await new Promise((res) => execFile('reg', ['add', k, ...(v ? ['/v', v] : ['/ve']), '/d', d, '/f'], () => res()));
    }
    await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Vantage');
    return false;
  }
  return false;
});

/* ---------------- window state & misc ---------------- */
ipcMain.handle('win:init', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const rec = wins.get(w?.id);
  const init = rec?.init || {};
  return {
    isPrivate: !!init.isPrivate, saved: init.saved || null, urls: init.urls || [], platform: process.platform,
    settings: settings(), bookmarks: bm(), fullscreen: !!w?.isFullScreen(), version: app.getVersion(),
    partitions: { normal: NORMAL, private: PRIVATE, container: CONTAINER('ID') }, preloadNull: true
  };
});
ipcMain.on('win:state', (e, state) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const rec = wins.get(w?.id);
  if (!rec) return;
  rec.init = { ...rec.init, saved: state, urls: [] };   // a reload of the window comes back to where it was
  if (rec.private) return;
  const s = store.get().session;
  s.windows = s.windows || [];
  const entry = { key: rec.key, bounds: w.getNormalBounds(), maximized: w.isMaximized(), state };
  const i = s.windows.findIndex(x => x.key === rec.key);
  if (i >= 0) s.windows[i] = entry; else s.windows.push(entry);
  store.save();
});
ipcMain.handle('win:new', (_e, { isPrivate, urls } = {}) => { createWindow({ isPrivate: !!isPrivate, urls: urls || [] }); return true; });
ipcMain.handle('win:fullscreen', (e, on) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setFullScreen(on === undefined ? !w.isFullScreen() : !!on); return w?.isFullScreen(); });
ipcMain.handle('win:close', (e) => { BrowserWindow.fromWebContents(e.sender)?.close(); });
ipcMain.handle('win:dblclick', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  const action = IS_MAC ? systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string') : 'Maximize';
  if (action === 'Minimize') w.minimize(); else if (w.isMaximized()) w.unmaximize(); else w.maximize();
});
ipcMain.handle('shell:open-external', (_e, url) => { if (/^(https?|mailto|ms-settings|x-apple\.systempreferences):/i.test(url)) shell.openExternal(url); });
ipcMain.handle('file:drag', (e, file) => { try { e.sender.startDrag({ file, icon: nativeImage.createFromPath(APP_ICON).resize({ width: 32 }) }); } catch {} });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, userData: app.getPath('userData') }));
ipcMain.handle('notify', (e, { title, body }) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w?.isFocused() || !Notification.isSupported()) return false;
  const n = new Notification({ title, body, silent: true });
  n.on('click', () => { w?.show(); w?.focus(); });
  n.show();
  return true;
});

/* ---------------- menu ---------------- */
function buildMenu() {
  const cmd = (name, arg) => () => { const w = focusedWin(); if (w) send(w, 'cmd', name, arg); else if (name === 'new-tab') createWindow(); };
  const template = [
    ...(IS_MAC ? [{ label: 'Vantage', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'Cmd+,', click: cmd('open-internal', 'settings') },
      { label: 'Make Vantage the Default Browser', click: () => { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); } },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ] }] : []),
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: cmd('new-tab') },
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
      { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow({ isPrivate: true }) },
      { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: cmd('reopen-tab') },
      { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: cmd('focus-omnibox') },
      { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: async () => {
          const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Web pages & PDFs', extensions: ['html', 'htm', 'pdf', 'svg', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
          if (!r.canceled && r.filePaths[0]) openUrls(['file://' + r.filePaths[0]]);
        } },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: cmd('close-tab') },
      { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => focusedWin()?.close() },
      { type: 'separator' },
      { label: 'Save Page As…', accelerator: 'CmdOrCtrl+S', click: cmd('save-page') },
      { label: 'Take Screenshot', accelerator: 'CmdOrCtrl+Shift+2', click: cmd('screenshot') },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: cmd('print') },
      ...(IS_MAC ? [] : [{ type: 'separator' }, { label: 'Settings', accelerator: 'Ctrl+,', click: cmd('open-internal', 'settings') }, { role: 'quit' }])
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: cmd('find') },
      { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: cmd('find-next') },
      { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: cmd('find-prev') },
      { type: 'separator' },
      { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', click: cmd('palette') },
      ...(IS_MAC ? [{ type: 'separator' }, { role: 'startSpeaking' }, { role: 'stopSpeaking' }] : [])
    ] },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: cmd('reload') },
      { label: 'Reload Ignoring Cache', accelerator: 'CmdOrCtrl+Shift+R', click: cmd('hard-reload') },
      { label: 'Stop', accelerator: 'Esc', registerAccelerator: false, click: cmd('stop') },
      { type: 'separator' },
      { label: 'Split View', submenu: [
        { label: 'One Page', accelerator: 'CmdOrCtrl+Alt+1', click: cmd('layout', 'one') },
        { label: 'Two Side by Side', accelerator: 'CmdOrCtrl+Alt+2', click: cmd('layout', 'cols2') },
        { label: 'Two Stacked', accelerator: 'CmdOrCtrl+Alt+3', click: cmd('layout', 'rows2') },
        { label: 'One Big and Two', accelerator: 'CmdOrCtrl+Alt+4', click: cmd('layout', 'main3') },
        { label: 'Three Columns', accelerator: 'CmdOrCtrl+Alt+5', click: cmd('layout', 'cols3') },
        { label: 'Grid of Four', accelerator: 'CmdOrCtrl+Alt+6', click: cmd('layout', 'grid4') },
        { type: 'separator' },
        { label: 'Next Pane', accelerator: 'CmdOrCtrl+Alt+]', click: cmd('pane', 1) },
        { label: 'Previous Pane', accelerator: 'CmdOrCtrl+Alt+[', click: cmd('pane', -1) },
        { label: 'Swap Panes', click: cmd('swap-panes') },
        { label: 'Even Out Sizes', click: cmd('even-panes') }
      ] },
      { label: 'Focus Mode', accelerator: 'CmdOrCtrl+Shift+F', click: cmd('focus-mode') },
      { label: 'Reader View', accelerator: 'CmdOrCtrl+Alt+R', click: cmd('reader-view') },
      { label: 'Dark Pages on This Site', click: cmd('toggle-dark') },
      { label: 'Show Bookmarks Bar', accelerator: 'CmdOrCtrl+Shift+B', click: cmd('toggle-bookmarks-bar') },
      { label: 'Tabs on the Side', click: cmd('toggle-side-tabs') },
      { label: 'Customize New Tab…', click: cmd('customize-newtab') },
      { type: 'separator' },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: cmd('zoom', 0) },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: cmd('zoom', 1) },
      { label: 'Zoom In ', accelerator: 'CmdOrCtrl+Plus', visible: false, click: cmd('zoom', 1) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: cmd('zoom', -1) },
      { type: 'separator' },
      { label: 'Developer Tools', accelerator: IS_MAC ? 'Cmd+Alt+I' : 'Ctrl+Shift+I', click: cmd('devtools') },
      { label: 'View Source', accelerator: 'CmdOrCtrl+Alt+U', click: cmd('view-source') },
      { label: 'Vantage’s Own Tools', click: () => focusedWin()?.webContents.openDevTools({ mode: 'detach' }) },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ] },
    { label: 'History', submenu: [
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: cmd('back') },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: cmd('forward') },
      { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: cmd('home') },
      { type: 'separator' },
      { label: 'Show All History', accelerator: 'CmdOrCtrl+Y', click: cmd('open-internal', 'history') },
      { label: 'Clear Browsing Data…', accelerator: 'CmdOrCtrl+Shift+Backspace', click: cmd('clear-data') }
    ] },
    { label: 'Bookmarks', submenu: [
      { label: 'Bookmark This Page…', accelerator: 'CmdOrCtrl+D', click: cmd('bookmark') },
      { label: 'Show All Bookmarks', accelerator: 'CmdOrCtrl+Alt+B', click: cmd('open-internal', 'bookmarks') },
      { type: 'separator' },
      { label: 'Save to Read Later', accelerator: 'CmdOrCtrl+Shift+D', click: cmd('read-later') }
    ] },
    { label: 'Tools', submenu: [
      { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: cmd('open-internal', 'downloads') },
      { label: 'Library', accelerator: 'CmdOrCtrl+Shift+L', click: cmd('open-internal', 'library') },
      { label: 'Password Vault', accelerator: 'CmdOrCtrl+Alt+K', click: cmd('open-internal', 'vault') },
      { label: 'Open in Vantage Player…', accelerator: 'CmdOrCtrl+Alt+P', click: cmd('open-player') },
      { label: 'Open in Vantage Reader…', accelerator: 'CmdOrCtrl+Alt+O', click: cmd('open-reader') },
      { type: 'separator' },
      { label: 'Turn VPN On or Off', accelerator: 'CmdOrCtrl+Shift+U', click: cmd('toggle-vpn') },
      { label: 'Pause Ad Blocking on This Site', click: cmd('toggle-adblock-site') },
      { label: 'Mute Tab', accelerator: 'CmdOrCtrl+Shift+M', click: cmd('mute') },
      { label: 'Mini Player', accelerator: 'CmdOrCtrl+Alt+M', click: cmd('mini-player') },
      { label: 'Picture in Picture', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('pip') }
    ] },
    { label: 'Tab', submenu: [
      { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: cmd('tab-step', 1) },
      { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: cmd('tab-step', -1) },
      { label: 'Next Tab ', accelerator: IS_MAC ? 'Cmd+Alt+Right' : 'Ctrl+PageDown', click: cmd('tab-step', 1) },
      { label: 'Previous Tab ', accelerator: IS_MAC ? 'Cmd+Alt+Left' : 'Ctrl+PageUp', click: cmd('tab-step', -1) },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: cmd('tab-index', n - 1), visible: false })),
      { label: 'Last Tab', accelerator: 'CmdOrCtrl+9', click: cmd('tab-index', -1) },
      { type: 'separator' },
      { label: 'Duplicate Tab', click: cmd('duplicate-tab') },
      { label: 'Pin Tab', click: cmd('pin-tab') },
      { label: 'Search Tabs…', accelerator: 'CmdOrCtrl+Shift+A', click: cmd('palette', 'tabs') }
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'About Vantage', click: cmd('open-internal', 'settings:about') }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- moving in from Relay ---------------- */
// The Library, its covers and resume points, and the browser bookmarks came from Relay. Bring them over once.
function migrateFromRelay() {
  const s = store.get();
  if (s.migrated.relay) return;
  s.migrated.relay = Date.now();
  try {
    const r = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'Relay', 'relay-data.json'), 'utf8'));
    if (r.library && !Object.keys(s.library.meta || {}).length) s.library = r.library;
    s.readerProgress = { ...(r.readerProgress || {}), ...s.readerProgress };
    s.mediaProgress = { ...(r.mediaProgress || {}), ...s.mediaProgress };
    if (r.settings?.filesRoot && !s.settings.filesRoot) s.settings.filesRoot = r.settings.filesRoot;
    const have = new Set(s.bookmarks.map(b => b.url));
    for (const b of r.browser?.bookmarks || []) if (b.url && !have.has(b.url)) s.bookmarks.push({ id: Math.random().toString(36).slice(2, 10), title: b.title || b.url, url: b.url, folder: 'Bar', at: Date.now() });
  } catch {}
  store.save();
}

/* ---------------- Utility Suite link ---------------- */
let link = null;
function startLink() {
  try {
    link = suitelink.serve('vantage', { version: app.getVersion(), calls: {
      open: (url) => { if (url && /^https?:/i.test(url)) openUrls([url]); else { const w = focusedWin(); if (w) { w.show(); w.focus(); } else createWindow(); } return true; },
      vpn: () => vpn.state(),
      downloads: () => store.get().downloads.slice(0, 10).map(d => ({ name: d.name, state: d.state, received: d.received, total: d.total }))
    } });
  } catch { link = null; }
}

/* ---------------- start ---------------- */
app.whenReady().then(async () => {
  store.load();
  migrateFromRelay();
  if (IS_MAC && !app.isPackaged) try { app.dock.setIcon(APP_ICON); } catch {}
  app.setAboutPanelOptions({ applicationName: 'Vantage', applicationVersion: app.getVersion(), iconPath: APP_ICON, copyright: '© 2026 Bilal' });
  applyTheme();
  applyDns();
  buildMenu();
  const ctx = { getStore: store.get, saveStore: store.save, getWin: () => focusedWin() };
  vault.register(ipcMain, () => focusedWin(), broadcast);
  vault.registerAutofill(ipcMain, {
    getSettings: () => settings().vault,
    saveSettings: () => store.save(),
    offerSave: (wc, info) => send(ownerOf(wc), 'vault:offer-save', { ...info, wcId: wc.id }),
    askUnlock: (wc) => { const w = ownerOf(wc); if (w) { w.focus(); send(w, 'vault:unlock-request', { wcId: wc.id }); } }
  });
  library.register(ctx);
  media.register({ ...ctx, downloadsDir: () => downloads.dir() });
  downloads.register({ store, getWin: () => focusedWin(), notifyAll: broadcast });
  await adblock.init(store, (wcId, n) => {
    const st = store.get().stats;
    st.blocked++;
    st.daily = st.daily || {};
    const k = dayKey();
    st.daily[k] = (st.daily[k] || 0) + 1;
    if (Object.keys(st.daily).length > 40) for (const d of Object.keys(st.daily).sort().slice(0, -35)) delete st.daily[d];
    store.save();
    const wc = webContents.fromId(wcId);
    const owner = wc && ownerOf(wc);
    if (owner) send(owner, 'adblock:count', { wcId, n });
  }).catch(() => {});
  prepareSession(NORMAL);
  vpn.init(store, { onState: (st) => broadcast('vpn:state', { ...vpn.state(), ...st }), getSessions: allSessions });
  setupPlayerSession();
  startLink();
  nativeTheme.on('updated', applyTheme);

  const saved = settings().startup === 'newtab' ? [] : (store.get().session.windows || []);
  if (saved.length) saved.forEach((w, i) => createWindow({ saved: w, urls: i === 0 ? pendingUrls.splice(0) : [] }));
  else createWindow({ urls: pendingUrls.splice(0) });
  app.on('activate', () => { if (!wins.size) createWindow(); });
});

app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
app.on('before-quit', () => { quitting = true; downloads.pauseAll(); media.stopCast(); vpn.stop(); store.flush(); });
app.on('will-quit', () => { try { link?.close(); } catch {} store.flush(); });

// Kiln — the built-in browser's main-process side (ported from Relay): one signed-in session per
// profile, ad blocking, sign-in friendly browser identity, popups as tabs, and model downloads.
const path = require('path');
const { ipcMain, session, shell, Menu, clipboard } = require('electron');
const core = require('../core');
const adblock = require('./adblock');
const downloads = require('../models/downloads');
const { identityFor, rewriteHeaders, navigatorPatch } = require('./identity');
const { MODEL_EXT } = require('../shared/types');

const PRELOAD = path.join(__dirname, 'webview-preload.js');
const INCOGNITO = 'kiln-incognito';
const AUTH_HOSTS = ['accounts.google.com', 'github.com', 'discord.com', 'login.live.com', 'login.microsoftonline.com', 'appleid.apple.com', 'huggingface.co', 'civitai.com', 'accounts.youtube.com', 'gds.google.com'];
const configured = new Set();
let getWin = () => null;
let send = () => {};

const isAuthUrl = (url) => { try { const h = new URL(url).hostname; return /\/(login|signin|oauth|authorize|auth)\b/i.test(new URL(url).pathname) && AUTH_HOSTS.some(a => h === a || h.endsWith('.' + a)); } catch { return false; } };
const adblockOn = () => core.active()?.data.settings.adblock !== false;

function configure(partition) {
  const ses = session.fromPartition(partition);
  if (configured.has(partition)) return ses;
  configured.add(partition);
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    let pageUrl = details.url;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(pageUrl)) return cb({ requestHeaders: details.requestHeaders });
    if (details.resourceType !== 'mainFrame') {
      try { pageUrl = details.frame?.top?.url || details.webContents?.getURL() || details.referrer || details.url; } catch { pageUrl = details.referrer || details.url; }
    }
    cb({ requestHeaders: rewriteHeaders(details.requestHeaders, identityFor(pageUrl, 'auto')) });
  });
  adblock.attach(ses, () => adblockOn());
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(details.url)) return cb({});
    adblock.onBeforeRequest(ses, details, cb);
  });
  ses.webRequest.onHeadersReceived((details, cb) => adblock.onHeadersReceived(ses, details, cb));
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications'].includes(permission)));
  const m = /^persist:kiln-(.+)$/.exec(partition);
  downloads.attach(ses, m ? m[1] : null);
  return ses;
}

function trackIdentity(contents) {
  const setFor = (url) => { if (!url || /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return; const id = identityFor(url, 'auto'); if (contents.getUserAgent() !== id.ua) contents.setUserAgent(id.ua); };
  contents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) setFor(e.url); });
  contents.on('will-redirect', (e) => { if (e.isMainFrame) setFor(e.url); });
}

function isIncognito(contents) { return contents.session === session.fromPartition(INCOGNITO); }

function onWebContents(contents) {
  const type = contents.getType();
  if (type === 'window' && contents.session !== session.defaultSession) trackIdentity(contents);
  if (type !== 'webview') return;
  trackIdentity(contents);
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (isAuthUrl(url) || url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: getWin(), autoHideMenuBar: true, webPreferences: { session: contents.session, preload: PRELOAD, sandbox: true } } };
    }
    if (/^https?:/.test(url)) send('browser:open', { url, incognito: isIncognito(contents), background: disposition === 'background-tab' });
    else shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('context-menu', (_ev, p) => {
    const items = [];
    const inc = isIncognito(contents);
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      const modelish = MODEL_EXT.test(p.linkURL.split('?')[0]) || /civitai\.com\/api\/download\/models\/\d+/.test(p.linkURL) || /huggingface\.co\/.+\/(resolve|blob)\/.+\.(safetensors|ckpt|gguf|pth?|bin)/i.test(p.linkURL);
      if (modelish) items.push({ label: 'Download to my models', click: () => send('browser:download-model', { url: p.linkURL, name: p.linkText }) }, { type: 'separator' });
      items.push(
        { label: 'Open link in new tab', click: () => send('browser:open', { url: p.linkURL, incognito: inc }) },
        ...(!inc ? [{ label: 'Open link in incognito tab', click: () => send('browser:open', { url: p.linkURL, incognito: true }) }] : []),
        { label: 'Open link in default browser', click: () => shell.openExternal(p.linkURL) },
        { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) items.push(
      { label: 'Use image in Generate', click: () => send('browser:use-image', { url: p.srcURL }) },
      { label: 'Save image', click: () => contents.downloadURL(p.srcURL) },
      { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
    if (p.selectionText) items.push({ label: 'Use as prompt in Generate', click: () => send('browser:use-prompt', { text: p.selectionText }) }, { type: 'separator' });
    if (p.misspelledWord) {
      p.dictionarySuggestions.slice(0, 4).forEach(s => items.push({ label: s, click: () => contents.replaceMisspelling(s) }));
      if (p.dictionarySuggestions.length) items.push({ type: 'separator' });
    }
    const nav = contents.navigationHistory;
    items.push(
      { role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' },
      { label: 'Back', enabled: nav ? nav.canGoBack() : false, click: () => nav?.goBack() },
      { label: 'Reload', click: () => contents.reload() },
      { label: 'Inspect', click: () => contents.inspectElement(p.x, p.y) }
    );
    Menu.buildFromTemplate(items).popup();
  });
}

function register(ctx) {
  getWin = ctx.getWin; send = ctx.send;
  adblock.init().catch(() => {});
  ipcMain.on('kiln:navigator-patch', (event, url) => {
    try { event.returnValue = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url) ? null : navigatorPatch(identityFor(url, 'auto')); }
    catch { event.returnValue = null; }
  });
  ipcMain.handle('browser:prepare', (_e, partition) => { configure(partition); return { preload: require('url').pathToFileURL(PRELOAD).href }; });
  ipcMain.handle('browser:partition', (_e, incognito) => incognito ? INCOGNITO : downloads.partitionFor(core.active()?.profile.id || 'none'));
  ipcMain.handle('browser:save', (_e, patch) => {
    const a = core.active(); if (!a) return false;
    a.data.browser = { ...a.data.browser, ...patch };
    a.store.save();
    return true;
  });
  ipcMain.handle('browser:clear-incognito', async () => { const s = session.fromPartition(INCOGNITO); await s.clearStorageData(); await s.clearCache(); return true; });
  ipcMain.handle('browser:clear-data', async () => {
    const a = core.active(); if (!a) return false;
    const s = session.fromPartition(downloads.partitionFor(a.profile.id));
    await s.clearStorageData(); await s.clearCache();
    return true;
  });}

module.exports = { register, onWebContents, configure, INCOGNITO };

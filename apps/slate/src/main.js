// Slate — main process
const { app, BrowserWindow, ipcMain, shell, session, nativeTheme, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { IDENTITIES, identityFor, rewriteHeaders, navigatorPatch } = require('./identity');
const statements = require('./statements');
const P = require('./parse');
const simplefin = require('./simplefin');

// A plain Chrome user agent: some banks and sign-in pages refuse anything that mentions Electron.
const CHROME_UA = IDENTITIES.chrome.ua;
const IS_MAC = process.platform === 'darwin';
app.userAgentFallback = CHROME_UA;
const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js');
const BROWSER_PARTITION = 'persist:slate-browser';
// Test hooks: a separate data folder, and automatic screenshots of every screen
if (process.env.SLATE_USER_DATA) app.setPath('userData', process.env.SLATE_USER_DATA);
const SHOTS = process.env.SLATE_SHOTS || '';

/* ---------- persistent store ---------- */
const storePath = () => path.join(app.getPath('userData'), 'slate-data.json');
const DEFAULT_BOOKMARKS = [
  ['Chase', 'https://www.chase.com'], ['American Express', 'https://www.americanexpress.com'],
  ['Capital One', 'https://www.capitalone.com'], ['Citi', 'https://www.citi.com'],
  ['Bank of America', 'https://www.bankofamerica.com'], ['Discover', 'https://www.discover.com'],
  ['Wells Fargo', 'https://www.wellsfargo.com'], ['Fidelity', 'https://www.fidelity.com'],
  ['Vanguard', 'https://investor.vanguard.com'], ['Schwab', 'https://www.schwab.com'],
  ['Empower', 'https://www.empower.com']
].map(([title, url], i) => ({ id: 'bk' + i, title, url }));

const DEFAULT_STORE = {
  accounts: [],        // { id, name, institution, type, last4, color, loginUrl, inPlanner, balances: [{date, amount, source}] }
  wallet: [],          // { id, cardId, accountId, opened: 'YYYY-MM-DD', feeMonth, nickname, usage: [{creditId, period, amount, date}] }
  customCards: [],     // catalog entries added by the user
  cardEdits: {},       // cardId -> fields the user corrected
  plans: {},           // 'YYYY-MM' -> { accountId: { planned, actual } }
  scores: [],          // { id, date, bureau, score, model, source }
  events: [],          // { id, title, date, repeat: 'none'|'monthly'|'yearly', amount, accountId }
  notes: {},           // report notes per month
  statements: [],
  browser: { tabs: [], bookmarks: DEFAULT_BOOKMARKS },
  settings: { name: '', theme: 'dark', statementsDir: '', watchDownloads: false, monthlyGoal: 0, renewalLeadDays: 45 },
  ui: { view: 'overview' }
};
let store = null;
function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    store = { ...structuredClone(DEFAULT_STORE), ...raw, settings: { ...DEFAULT_STORE.settings, ...(raw.settings || {}) }, ui: { ...DEFAULT_STORE.ui, ...(raw.ui || {}) }, browser: { ...DEFAULT_STORE.browser, ...(raw.browser || {}) } };
    // 1.1: Plaid was replaced by SimpleFIN. Drop its keys and links; balances already recorded stay.
    if (store.plaid) { delete store.plaid; for (const a of store.accounts || []) delete a.plaid; saveStore(true); }
  } catch { store = structuredClone(DEFAULT_STORE); }
}
let saveTimer = null;
function saveStore(now) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      const tmp = storePath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
      fs.renameSync(tmp, storePath());
    } catch (e) { console.error('save failed', e); }
  };
  if (now) write(); else saveTimer = setTimeout(write, 200);
}

/* ---------- window ---------- */
let win;
const toast = (msg, kind) => { if (win && !win.isDestroyed()) win.webContents.send('toast', { msg, kind }); };
function createWindow() {
  const dark = store.settings.theme === 'dark' || (store.settings.theme === 'system' && nativeTheme.shouldUseDarkColors);
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1040, minHeight: 660, title: 'Slate',
    backgroundColor: dark ? '#1a1f25' : '#eceff1',
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#ece8df' : '#1a1f25', height: 48 }, icon: path.join(__dirname, '..', 'build', 'icon.png') }),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, spellcheck: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (SHOTS) win.webContents.once('did-finish-load', () => runShots().catch(e => { console.error(e); app.exit(1); }));
  // Files dropped on the window go to the statement inbox (handled in the renderer); never navigate away
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

/* ---------- the built-in browser (from Relay) ---------- */
function applyIdentityTracking(contents) {
  const setFor = (url) => { const id = identityFor(url, 'auto'); if (contents.getUserAgent() !== id.ua) contents.setUserAgent(id.ua); };
  contents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    const u = e.url || url;
    if ((e.isMainFrame ?? isMainFrame) && !(e.isSameDocument ?? isInPlace) && u) setFor(u);
  });
  contents.on('will-redirect', (e, url, _p, isMainFrame) => { const u = e.url || url; if ((e.isMainFrame ?? isMainFrame) && u) setFor(u); });
}
ipcMain.on('slate:navigator-patch', (event, url) => {
  try { event.returnValue = navigatorPatch(identityFor(url, 'auto')); } catch { event.returnValue = null; }
});

function configureSession(partition) {
  const ses = session.fromPartition(partition);
  if (ses.__slate) return ses;
  ses.__slate = true;
  ses.setUserAgent(CHROME_UA);
  ses.setSpellCheckerEnabled(false); // no dictionary downloads
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    let pageUrl = details.url;
    if (details.resourceType !== 'mainFrame') { try { pageUrl = details.frame?.top?.url || details.webContents?.getURL() || details.referrer || details.url; } catch { pageUrl = details.referrer || details.url; } }
    cb({ requestHeaders: rewriteHeaders(details.requestHeaders, identityFor(pageUrl, 'auto')) });
  });
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'].includes(permission)));
  statements.attach(ses);   // every download → statement inbox
  return ses;
}

const sendTab = (url) => { if (win && !win.isDestroyed()) { win.webContents.send('browser:open-tab', { url }); win.focus(); } };
app.on('web-contents-created', (_e, contents) => {
  const type = contents.getType();
  if (type === 'window' && contents.session !== session.defaultSession) applyIdentityTracking(contents);
  if (type !== 'webview') return;
  applyIdentityTracking(contents);
  contents.setWindowOpenHandler(({ url, disposition }) => {
    // sign-in popups (about:blank, oauth windows) need a real window that shares the session
    if (url === 'about:blank' || disposition === 'new-window') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 560, height: 760, parent: win, webPreferences: { partition: BROWSER_PARTITION, preload: WEBVIEW_PRELOAD, sandbox: true, plugins: true } } };
    }
    if (/^https?:|^blob:/.test(url)) sendTab(url);
    return { action: 'deny' };
  });
  contents.on('context-menu', (_ev, p) => {
    const items = [];
    if (p.linkURL && /^https?:/.test(p.linkURL)) items.push(
      { label: 'Open Link in New Tab', click: () => sendTab(p.linkURL) },
      { label: 'Save Linked File to Statement Inbox', click: () => contents.downloadURL(p.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    if (p.mediaType === 'image' && /^https?:|^data:/.test(p.srcURL || '')) items.push(
      { label: 'Use Image as Card Art…', click: () => win?.webContents.send('card-image:candidate', { url: p.srcURL, page: contents.getURL() }) }, { type: 'separator' });
    items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' },
      { label: 'Back', enabled: contents.navigationHistory?.canGoBack?.() ?? false, click: () => contents.navigationHistory.goBack() },
      { label: 'Reload', click: () => contents.reload() });
    Menu.buildFromTemplate(items).popup();
  });
});

ipcMain.handle('browser:prepare', () => { configureSession(BROWSER_PARTITION); return { partition: BROWSER_PARTITION, preload: WEBVIEW_PRELOAD }; });
ipcMain.handle('browser:clear', async () => { const ses = session.fromPartition(BROWSER_PARTITION); await ses.clearStorageData(); await ses.clearCache(); return true; });
// Save the page you're looking at as a PDF straight into the inbox (for banks that show statements as web pages)
ipcMain.handle('browser:save-pdf', async (_e, wcId) => {
  const { webContents } = require('electron');
  const wc = webContents.fromId(wcId);
  if (!wc) return null;
  const title = (wc.getTitle() || 'Page').replace(/[/\\:*?"<>|]/g, '-').slice(0, 80);
  const data = await wc.printToPDF({ printBackground: true, pageSize: 'Letter' });
  const dir = path.join(statements.root(), 'Inbox');
  let target = path.join(dir, `${title}.pdf`), n = 2;
  while (fs.existsSync(target)) target = path.join(dir, `${title} (${n++}).pdf`);
  fs.writeFileSync(target, data);
  let host = ''; try { host = new URL(wc.getURL()).hostname; } catch {}
  const rec = statements.add(target, { kind: 'browser', host, title: wc.getTitle() });
  return rec.name;
});

/* ---------- store ---------- */
ipcMain.handle('store:get', () => { const { simplefin: _s, ...rest } = store; return rest; }); // the SimpleFIN Access URL never goes to the window
ipcMain.handle('store:save', (_e, partial) => {
  for (const [k, v] of Object.entries(partial || {})) {
    if (k === 'statements' || k === 'simplefin') continue; // owned by their modules
    if (k === 'settings' || k === 'ui' || k === 'browser') store[k] = { ...store[k], ...v };
    else store[k] = v;
  }
  if (partial?.settings?.theme) applyTheme();
  saveStore();
  return true;
});
function applyTheme() { nativeTheme.themeSource = store.settings.theme === 'system' ? 'system' : store.settings.theme; }

/* ---------- card images the user replaced ---------- */
const cardImgDir = () => { const d = path.join(app.getPath('userData'), 'card-images'); fs.mkdirSync(d, { recursive: true }); return d; };
ipcMain.handle('app:paths', () => ({ cardImages: cardImgDir(), statements: statements.root(), cards: path.join(__dirname, 'data', 'cards') }));
ipcMain.handle('cards:catalog', () => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cards.json'), 'utf8')));
ipcMain.handle('cards:set-image', async (_e, { cardId, filePath }) => {
  if (!filePath) {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a card image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    filePath = r.filePaths[0];
  }
  for (const f of fs.readdirSync(cardImgDir())) if (f.startsWith(cardId + '.')) fs.unlinkSync(path.join(cardImgDir(), f));
  const target = path.join(cardImgDir(), `${cardId}${path.extname(filePath).toLowerCase()}`);
  fs.copyFileSync(filePath, target);
  return `${target}?v=${Date.now()}`;
});
// Card art picked from a web page (right-click → Use Image as Card Art…)
ipcMain.handle('cards:image-from-url', async (_e, { cardId, url }) => {
  let buf, ext = '.png';
  if (/^data:/.test(url)) { const m = url.match(/^data:image\/(\w+);base64,(.*)$/); if (!m) throw new Error('Unsupported image'); ext = '.' + m[1].replace('jpeg', 'jpg'); buf = Buffer.from(m[2], 'base64'); }
  else {
    const res = await session.fromPartition(BROWSER_PARTITION).fetch(url);
    if (!res.ok) throw new Error(`Couldn’t download the image (${res.status})`);
    const type = res.headers.get('content-type') || '';
    ext = /webp/.test(type) ? '.webp' : /jpe?g/.test(type) ? '.jpg' : /avif/.test(type) ? '.avif' : /gif/.test(type) ? '.gif' : '.png';
    buf = Buffer.from(await res.arrayBuffer());
  }
  for (const f of fs.readdirSync(cardImgDir())) if (f.startsWith(cardId + '.')) fs.unlinkSync(path.join(cardImgDir(), f));
  const target = path.join(cardImgDir(), cardId + ext);
  fs.writeFileSync(target, buf);
  return `${target}?v=${Date.now()}`;
});
ipcMain.handle('cards:reset-image', (_e, cardId) => { for (const f of fs.readdirSync(cardImgDir())) if (f.startsWith(cardId + '.')) fs.unlinkSync(path.join(cardImgDir(), f)); return true; });
ipcMain.handle('cards:reset-all-images', () => { let n = 0; for (const f of fs.readdirSync(cardImgDir())) { fs.unlinkSync(path.join(cardImgDir(), f)); n++; } return n; });
ipcMain.handle('cards:image-overrides', () => Object.fromEntries(fs.readdirSync(cardImgDir()).map(f => [path.basename(f, path.extname(f)), path.join(cardImgDir(), f)])));

/* ---------- credit reports: open dates, limits, every card and loan ---------- */
ipcMain.handle('report:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a credit report', properties: ['openFile'], filters: [{ name: 'Credit report', extensions: ['pdf', 'txt', 'html', 'htm'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return P.parseReport(r.filePaths[0]);
});
ipcMain.handle('report:from-file', (_e, file) => P.parseReport(file));
ipcMain.handle('report:from-text', (_e, text) => P.parseReport(String(text || ''), true));

/* ---------- monthly report → PDF ---------- */
ipcMain.handle('report:pdf', async (_e, month) => {
  const dir = path.join(path.dirname(statements.root()), 'Reports');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `Slate report ${month}.pdf`);
  const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
  fs.writeFileSync(target, data);
  shell.openPath(target);
  return target;
});

/* ---------- backup ---------- */
ipcMain.handle('data:export', async () => {
  const r = await dialog.showSaveDialog(win, { title: 'Back up Slate data', defaultPath: path.join(app.getPath('documents'), `Slate backup ${new Date().toISOString().slice(0, 10)}.json`) });
  if (r.canceled || !r.filePath) return null;
  const { simplefin: _s, ...rest } = store; // the bank connection stays on this computer, never in a backup file
  fs.writeFileSync(r.filePath, JSON.stringify(rest, null, 1));
  return r.filePath;
});
ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Restore a Slate backup', properties: ['openFile'], filters: [{ name: 'Slate backup', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return false;
  const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  if (!raw || !Array.isArray(raw.accounts)) throw new Error('That file isn’t a Slate backup');
  try { fs.copyFileSync(storePath(), storePath() + '.before-restore'); } catch {}
  store = { ...structuredClone(DEFAULT_STORE), ...raw, settings: { ...DEFAULT_STORE.settings, ...(raw.settings || {}) }, simplefin: store.simplefin };
  saveStore(true);
  win.reload();
  return true;
});
ipcMain.handle('shell:open-external', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
ipcMain.handle('shell:open-path', (_e, p) => shell.openPath(p));

let flushNet = () => {};
// Test mode: record every request that would leave this computer (SLATE_NET_LOG=path)
function netAudit() {
  const seen = [];
  const local = /^(file|data|blob|devtools|chrome|chrome-extension|about):|^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i;
  const watch = (ses, name) => ses.webRequest.onBeforeRequest((d, cb) => { if (!local.test(d.url)) seen.push({ session: name, url: d.url, type: d.resourceType }); cb({}); });
  watch(session.defaultSession, 'default');
  watch(session.fromPartition(BROWSER_PARTITION), 'browser');
  const nodeFetch = globalThis.fetch; // main-process requests (SimpleFIN) don't pass through webRequest
  globalThis.fetch = (u, o) => { const url = String(u?.url || u); if (!local.test(url)) seen.push({ session: 'main', url: url.replace(/\/\/[^/@]*@/, '//***@'), type: 'fetch' }); return nodeFetch(u, o); };
  flushNet = () => { try { fs.writeFileSync(process.env.SLATE_NET_LOG, JSON.stringify(seen, null, 1)); } catch {} };
  app.on('before-quit', flushNet);
}

async function runShots() {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (e) => { const lvl = e.level ?? e; if (lvl === 'error' || lvl === 3) errors.push(e.message); });
  await wait(1500);
  if (process.env.SLATE_SCRIPT) {
    // [{ js, wait, shot }] — scripted test runs
    for (const st of JSON.parse(fs.readFileSync(process.env.SLATE_SCRIPT, 'utf8'))) {
      if (st.js) { try { const r = await win.webContents.executeJavaScript(`(async () => { ${st.js} })()`); if (st.log) console.log('LOG', st.log, JSON.stringify(r)); } catch (e) { errors.push('step: ' + e.message); } }
      if (st.main === 'store') fs.writeFileSync(path.join(SHOTS, st.file || 'store.json'), JSON.stringify(store, null, 1));
      await wait(st.wait ?? 700);
      if (st.shot) fs.writeFileSync(path.join(SHOTS, st.shot + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(SHOTS, 'errors.txt'), errors.join('\n'));
    flushNet(); return app.exit(0);
  }
  const steps =(process.env.SLATE_STEPS || 'overview,accounts,cards,cards:catalog,calendar,planner,credit,statements,report,browser').split(',');
  for (const step of steps) {
    const [view, extra] = step.split(':');
    if (view === 'e2e') {
      // serve a statement as a download, fetch it through Slate's browser, then file it
      const http = require('http');
      const pdf = fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'Statement_Sep2026.pdf'));
      const srv = http.createServer((req, res) => {
        if (req.url.startsWith('/statement')) { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="20260914-statements-4321-.pdf"' }); res.end(pdf); }
        else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Test bank</h1><a id="dl" href="/statement">Download statement</a>'); }
      }).listen(0);
      const port = srv.address().port;
      await win.webContents.executeJavaScript(`Slate.go('browser');Slate.views.browser.openTab('http://127.0.0.1:${port}/');0`);
      await wait(2500);
      fs.writeFileSync(path.join(SHOTS, 'e2e-1-bank.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.querySelector('webview.on').executeJavaScript("document.getElementById('dl').click()");0`);
      await wait(3000);
      await win.webContents.executeJavaScript(`Slate.go('statements');0`);
      await wait(800);
      fs.writeFileSync(path.join(SHOTS, 'e2e-2-inbox.png'), (await win.webContents.capturePage()).toPNG());
      const before = store.statements.length;
      const rec = store.statements.find(s => s.name.startsWith('20260914'));
      await win.webContents.executeJavaScript(`document.querySelector('.inbox-item[data-s="${rec?.id}"] :is([data-file],[data-file-multi])').click();0`);
      await wait(1200);
      fs.writeFileSync(path.join(SHOTS, 'e2e-3-filed.png'), (await win.webContents.capturePage()).toPNG());
      const r2 = store.statements.find(s => s.id === rec?.id);
      const acc = store.accounts.find(a => a.id === r2?.accountId);
      fs.writeFileSync(path.join(SHOTS, 'e2e.json'), JSON.stringify({ downloaded: !!rec, statements: before, status: r2?.status, path: r2?.path, exists: r2 && fs.existsSync(r2.path), account: acc?.name, recorded: r2?.recorded, lastBalance: acc?.balances?.slice(-1)[0] }, null, 1));
      srv.close();
      continue;
    }
    const js = extra === 'catalog' ? `Slate.views.cards.open('catalog');Slate.go('cards')`
      : extra === 'detail' ? `Slate.views.cards.detail(Slate.card('amex-gold'))`
      : extra === 'light' ? `document.documentElement.dataset.theme='light';Slate.go('${view}')`
      : view === 'cards' ? `Slate.views.cards.open('wallet');Slate.go('cards')` : `Slate.go('${view}')`;
    await win.webContents.executeJavaScript(js + ';0');
    await wait(view === 'browser' ? 2500 : 700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, `${step.replace(':', '-')}.png`), img.toPNG());
    if (extra === 'light') await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';0`);
    await win.webContents.executeJavaScript(`document.getElementById('modalRoot').classList.remove('on');0`);
  }
  fs.writeFileSync(path.join(SHOTS, 'errors.txt'), errors.join('\n'));
  flushNet(); app.exit(0);
}

/* ---------- menu ---------- */
function buildMenu() {
  const go = (view) => () => win?.webContents.send('nav', view);
  const views = [['Overview', 'overview', '1'], ['Accounts', 'accounts', '2'], ['Cards', 'cards', '3'], ['Calendar', 'calendar', '4'], ['Planner', 'planner', '5'], ['Credit score', 'credit', '6'], ['Statements', 'statements', '7'], ['Browser', 'browser', '8'], ['Monthly report', 'report', '9']];
  const template = [
    ...(IS_MAC ? [{ label: 'Slate', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'Add statements…', accelerator: 'CmdOrCtrl+O', click: go('add-statements') },
      { label: 'New browser tab', accelerator: 'CmdOrCtrl+T', click: go('new-tab') },
      { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => win?.webContents.send('nav', 'close-tab') },
      { type: 'separator' }, { label: 'Back up data…', click: () => win?.webContents.send('nav', 'export') },
      ...(IS_MAC ? [] : [{ type: 'separator' }, { label: 'Settings', accelerator: 'Ctrl+,', click: go('settings') }, { role: 'quit' }])] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [...views.map(([label, v, k]) => ({ label, accelerator: `CmdOrCtrl+${k}`, click: go(v) })), { type: 'separator' },
      { label: 'Reload page', accelerator: 'CmdOrCtrl+R', click: go('reload') }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  loadStore();
  session.defaultSession.setSpellCheckerEnabled(false); // spellcheck dictionaries would be downloaded from Google on Windows/Linux
  if (process.env.SLATE_NET_LOG) netAudit();
  applyTheme();
  statements.register({ getStore: () => store, saveStore, getWin: () => win, toast });
  simplefin.register({ getStore: () => store, saveStore, getWin: () => win, toast });
  if (IS_MAC && app.dock && fs.existsSync(path.join(__dirname, '..', 'build', 'icon.png'))) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => saveStore(true));
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });

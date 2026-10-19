// Onward — main process
const { app, BrowserWindow, ipcMain, shell, session, dialog, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { IDENTITIES, identityFor, rewriteHeaders, navigatorPatch } = require('./identity');
const D = require('./data');
const Docs = require('./documents');
const bridge = require('./bridge');
const B = require('./browserctl');
const Tools = require('./claude-tools');
const Disc = require('./discover');
const AI = require('./ai');
const AF = require('./autofill');

app.setName('Onward');
app.setPath('userData', path.join(app.getPath('appData'), 'Onward'));
app.userAgentFallback = IDENTITIES.chrome.ua;

const IS_MAC = process.platform === 'darwin';
const BROWSER_PARTITION = 'persist:onward-browser';
const AI_PARTITION = 'persist:onward-ai';
const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js');
const AUTH_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'login.live.com', 'login.microsoftonline.com', 'account.live.com',
  'appleid.apple.com', 'idmsa.apple.com', 'login.microsoft.com', 'signup.live.com', 'gds.google.com', 'auth.openai.com', 'auth0.openai.com'];
let win = null;

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

// ---------- browser sessions ----------
function configureSession(partition) {
  const ses = session.fromPartition(partition);
  if (ses.__onward) return ses;
  ses.__onward = true;
  ses.setUserAgent(IDENTITIES.chrome.ua);
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    let pageUrl = details.url;
    if (details.resourceType !== 'mainFrame') {
      try { pageUrl = details.frame?.top?.url || details.webContents?.getURL() || details.referrer || details.url; } catch { pageUrl = details.referrer || details.url; }
    }
    cb({ requestHeaders: rewriteHeaders(details.requestHeaders, identityFor(pageUrl, 'auto')) });
  });
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications'].includes(permission)));
  ses.on('will-download', (_e, item) => {
    const dir = path.join(D.filesRoot(), 'Downloads');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    item.setSavePath(D.uniquePath(dir, path.basename(item.getFilename(), path.extname(item.getFilename())), path.extname(item.getFilename())));
    item.once('done', (_ev, state) => { if (state === 'completed') send('toast', { text: 'Downloaded ' + path.basename(item.getSavePath()), path: item.getSavePath() }); });
  });
  return ses;
}

ipcMain.on('onward:navigator-patch', (event, url) => {
  try { event.returnValue = navigatorPatch(identityFor(url, 'auto')); } catch { event.returnValue = null; }
});

const isAuthUrl = (url) => { try { const h = new URL(url).hostname; return AUTH_HOSTS.some(a => h === a || h.endsWith('.' + a)); } catch { return false; } };

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  const isAi = () => contents.session === session.fromPartition(AI_PARTITION);
  contents.setWindowOpenHandler(({ url }) => {
    if (isAuthUrl(url) || url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: win, webPreferences: { partition: isAi() ? AI_PARTITION : BROWSER_PARTITION, preload: WEBVIEW_PRELOAD, sandbox: true } } };
    }
    if (/^mailto:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    // Everything else stays in Onward — a new tab that remembers which job it came from
    if (/^https?:/.test(url)) send('browser:new-tab', { url, openerWcId: isAi() ? null : contents.id });
    return { action: 'deny' };
  });
  contents.on('will-navigate', (ev, url) => { if (/^mailto:/i.test(url)) { ev.preventDefault(); shell.openExternal(url); } });
  contents.on('context-menu', (_ev, p) => {
    const items = [];
    if (p.linkURL && /^https?:/.test(p.linkURL)) items.push(
      { label: 'Open Link in New Tab', click: () => send('browser:new-tab', { url: p.linkURL, openerWcId: contents.id }) },
      { label: 'Open Link in Default Browser', click: () => shell.openExternal(p.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
    else if (p.selectionText) items.push({ role: 'copy' }, { type: 'separator' });
    if (!isAi()) items.push({ label: 'Save This Job to Onward', click: () => send('browser:save-job', {}) });
    items.push({ type: 'separator' }, { label: 'Back', enabled: contents.navigationHistory?.canGoBack?.() ?? contents.canGoBack(), click: () => contents.navigationHistory ? contents.navigationHistory.goBack() : contents.goBack() }, { label: 'Reload', click: () => contents.reload() });
    if (!app.isPackaged) items.push({ label: 'Inspect Element', click: () => contents.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup();
  });
});

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1100, minHeight: 660, title: 'Onward', show: false,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 }, backgroundColor: '#0d0e10' }
      : { autoHideMenuBar: true, backgroundColor: '#0d0e10' }),  // Windows/Linux: normal title bar (panels have buttons in their top-right corners)
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, spellcheck: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}
async function ensureWindow() {
  if (win && !win.isDestroyed()) return;
  createWindow();
  await new Promise(r => { ipcMain.once('renderer:ready', r); setTimeout(r, 8000); });
}

// ---------- AI connectors (MCP): Claude desktop, Claude Code, Codex / ChatGPT ----------
const mcpDir = () => path.join(app.getPath('userData'), 'mcp');
function installMcpScript() {
  fs.mkdirSync(mcpDir(), { recursive: true });
  for (const f of ['onward-mcp.js', 'tools.js']) {
    const src = path.join(__dirname, '..', 'mcp', f).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    const from = fs.existsSync(src) ? src : path.join(__dirname, '..', 'mcp', f);
    fs.copyFileSync(from, path.join(mcpDir(), f));
  }
}
function mcpServerEntry() {
  const launch = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
  return {
    command: process.execPath,
    args: [path.join(mcpDir(), 'onward-mcp.js')],
    env: { ELECTRON_RUN_AS_NODE: '1', ONWARD_BRIDGE: bridge.bridgeFile(), ONWARD_LAUNCH: JSON.stringify(launch) }
  };
}
const claudeConfigPath = () => IS_MAC
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
const codexConfigPath = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');

function connectorStatus() {
  const entry = mcpServerEntry();
  let configured = false, current = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(claudeConfigPath(), 'utf8'));
    const e = cfg.mcpServers?.onward;
    configured = !!e;
    current = !!e && e.command === process.execPath && e.args?.[0] === entry.args[0];
  } catch {}
  let codexConfigured = false, codexCurrent = false;
  try {
    const t = fs.readFileSync(codexConfigPath(), 'utf8');
    codexConfigured = /^\s*\[mcp_servers\.("onward"|onward)\]/m.test(t);
    codexCurrent = codexConfigured && t.includes(JSON.stringify(entry.args[0]));
  } catch {}
  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  const codeCmd = `claude mcp add onward --scope user ${Object.entries(entry.env).map(([k, v]) => `-e ${k}=${q(v)}`).join(' ')} -- ${q(entry.command)} ${q(entry.args[0])}`;
  const codexCmd = `codex mcp add onward ${Object.entries(entry.env).map(([k, v]) => `--env ${k}=${q(v)}`).join(' ')} -- ${q(entry.command)} ${q(entry.args[0])}`;
  return {
    ...bridge.status(), configured, current, claudeInstalled: fs.existsSync(path.dirname(claudeConfigPath())), configPath: claudeConfigPath(), codeCmd,
    codexConfigured, codexCurrent, codexInstalled: fs.existsSync(path.dirname(codexConfigPath())), codexPath: codexConfigPath(), codexCmd, entry
  };
}

function connectClaudeDesktop() {
  const p = claudeConfigPath();
  let cfg = {};
  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, 'utf8');
    try { cfg = raw.trim() ? JSON.parse(raw) : {}; }
    catch { throw new Error('Claude\'s settings file has a formatting problem, so Onward didn\'t touch it: ' + p); }
    fs.writeFileSync(p + '.onward-backup', raw);
  } else fs.mkdirSync(path.dirname(p), { recursive: true });
  cfg.mcpServers = { ...(cfg.mcpServers || {}), onward: mcpServerEntry() };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return connectorStatus();
}

// Codex (in the ChatGPT desktop app, the Codex app, CLI and IDE extension) reads ~/.codex/config.toml
function connectCodex() {
  const p = codexConfigPath();
  let raw = '';
  if (fs.existsSync(p)) { raw = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p + '.onward-backup', raw); }
  else fs.mkdirSync(path.dirname(p), { recursive: true });
  // drop any previous [mcp_servers.onward] / [mcp_servers.onward.env] tables
  const out = [];
  let skipping = false;
  for (const line of raw.split(/\r?\n/)) {
    const h = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (h) skipping = /^mcp_servers\.("onward"|onward)(\.|$)/.test(h[1].replace(/\s+/g, ''));
    if (!skipping) out.push(line);
  }
  const e = mcpServerEntry();
  const s = (v) => JSON.stringify(v); // a JSON string is a valid TOML basic string
  const block = [
    '', '# Onward — job search app (added by Onward)',
    '[mcp_servers.onward]',
    `command = ${s(e.command)}`,
    `args = [${e.args.map(s).join(', ')}]`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 180',
    '', '[mcp_servers.onward.env]',
    ...Object.entries(e.env).map(([k, v]) => `${k} = ${s(v)}`), ''
  ];
  fs.writeFileSync(p, out.join('\n').replace(/\n{3,}$/, '\n').trimEnd() + '\n' + block.join('\n'));
  return connectorStatus();
}

// ---------- state for the renderer ----------
function publicState() {
  const s = D.store;
  return {
    profile: s.profile,
    baseResume: s.baseResume && { ...s.baseResume, text: undefined, chars: (s.baseResume.text || '').length, preview: (s.baseResume.text || '').slice(0, 1600) },
    credentials: s.credentials.map(c => ({ ...c, text: undefined, chars: (c.text || '').length })),
    jobs: s.jobs, settings: { ...s.settings, ai: AI.publicSettings() }, browser: s.browser, ui: s.ui, discover: s.discover,
    filesRoot: D.filesRoot(), statuses: D.STATUSES, claude: connectorStatus(), platform: process.platform
  };
}

// ---------- IPC ----------
ipcMain.handle('state:get', () => publicState());
ipcMain.handle('ui:save', (_e, patch) => { D.store.ui = { ...D.store.ui, ...patch }; D.save('ui'); return true; });
ipcMain.handle('settings:save', (_e, patch) => {
  const { ai, ...rest } = patch || {};
  D.store.settings = { ...D.store.settings, ...rest };
  if (ai) { const { openaiKey, anthropicKey, hasOpenaiKey, hasAnthropicKey, ...a } = ai; D.store.settings.ai = { ...D.store.settings.ai, ...a }; }
  D.ensureFolders(); D.save('settings');
  return publicState().settings;
});
ipcMain.handle('profile:save', (_e, patch) => D.updateProfile(patch));

async function pickFiles(title, filters) {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openFile', 'multiSelections'], filters });
  return r.canceled ? [] : r.filePaths;
}
const DOC_FILTERS = [{ name: 'Documents & images', extensions: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'] }];

ipcMain.handle('resume:import', async (_e, given) => {
  const files = given?.length ? given : await pickFiles('Choose your base resume', [{ name: 'Resume', extensions: ['pdf', 'docx', 'txt', 'md'] }]);
  if (!files.length) return null;
  const src = files[0];
  const ext = path.extname(src);
  const dest = D.uniquePath(D.profileDir(), 'Base Resume - ' + D.safeName(path.basename(src, ext), 50), ext);
  fs.copyFileSync(src, dest);
  const old = D.store.baseResume?.file;
  const text = await Docs.extractText(dest);
  D.store.baseResume = { file: dest, name: path.basename(src), text, updatedAt: D.now() };
  D.save('profile');
  if (old && old !== dest && fs.existsSync(old)) { try { await shell.trashItem(old); } catch {} }
  return publicState();
});

ipcMain.handle('credential:add', async (_e, { paths: given, type } = {}) => {
  const files = given?.length ? given : await pickFiles('Add certificates, degrees, licenses…', DOC_FILTERS);
  for (const src of files) {
    const ext = path.extname(src);
    const dest = D.uniquePath(D.credentialsDir(), D.safeName(path.basename(src, ext), 70), ext);
    fs.copyFileSync(src, dest);
    const text = await Docs.extractText(dest);
    const title = path.basename(src, ext).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    D.store.credentials.push({ id: D.uid('cred_'), type: type || guessType(title + ' ' + text.slice(0, 400)), title, issuer: '', date: '', file: dest, name: path.basename(src), text, addedAt: D.now() });
  }
  D.save('profile');
  return publicState();
});
function guessType(s) {
  s = s.toLowerCase();
  if (/bachelor|master|degree|diploma|b\.?s\.?\b|b\.?a\.?\b|mba|ph\.?d|transcript|university|college/.test(s)) return 'Degree';
  if (/licen[cs]e/.test(s)) return 'License';
  if (/certif|credential|badge|course|completion/.test(s)) return 'Certificate';
  if (/reference|recommendation/.test(s)) return 'Reference';
  if (/portfolio|case study|sample/.test(s)) return 'Portfolio';
  return 'Other';
}
ipcMain.handle('credential:update', (_e, { id, patch }) => {
  const c = D.store.credentials.find(x => x.id === id);
  if (c) for (const k of ['type', 'title', 'issuer', 'date']) if (patch[k] !== undefined) c[k] = patch[k];
  D.save('profile');
  return publicState();
});
ipcMain.handle('credential:remove', async (_e, id) => {
  const c = D.store.credentials.find(x => x.id === id);
  D.store.credentials = D.store.credentials.filter(x => x.id !== id);
  D.save('profile');
  if (c?.file && fs.existsSync(c.file)) { try { await shell.trashItem(c.file); } catch {} }
  return publicState();
});

ipcMain.handle('job:save', (_e, job) => { const r = D.saveJob(job); return r.job; });
ipcMain.handle('job:status', (_e, { id, status }) => D.setStatus(id, status));
ipcMain.handle('job:note', (_e, { id, text }) => D.addNote(id, text));
ipcMain.handle('job:remove', (_e, id) => { D.removeJob(id); return true; });
ipcMain.handle('job:applied', (_e, id) => D.recordSubmission(id, { submitted: true }));
ipcMain.handle('job:fill-details', async (_e, id) => {
  // Fetch the full posting for a job that came in without one (LinkedIn only)
  const j = D.findJob(id);
  if (!j) throw new Error('Job not found');
  const n = j.listingId || (D.normUrl(j.url || '').startsWith('linkedin:') ? D.normUrl(j.url).slice(9) : null);
  if (!n) return j;
  const d = await Disc.detail('li:' + n);
  D.saveJob({ id: j.id, listingId: n, description: d.description, applyType: d.applyType, logo: d.logo, seniority: d.seniority, employmentType: d.employmentType, industry: d.industry, experience: j.experience || d.experience, contacts: d.contacts });
  return D.findJob(id);
});

ipcMain.handle('contact:save', (_e, { jobId, contact }) => D.addContact(jobId, contact).contact);
ipcMain.handle('contact:remove', (_e, { jobId, contactId }) => { D.removeContact(jobId, contactId); return true; });
ipcMain.handle('message:save', (_e, { jobId, contactId, message }) => D.saveMessage(jobId, contactId, message).message);
ipcMain.handle('message:remove', (_e, { jobId, contactId, messageId }) => { D.removeMessage(jobId, contactId, messageId); return true; });

ipcMain.handle('discover:search', (_e, q) => Disc.search(q));
ipcMain.handle('discover:detail', (_e, id) => Disc.detail(id));
ipcMain.handle('discover:save', async (_e, id) => { const r = await Disc.save(id); return r.job; });

ipcMain.handle('ai:build', (_e, { kind, args }) => AI.build(kind, args));
ipcMain.handle('ai:api', (_e, { prompt }) => AI.callApi(prompt));
ipcMain.handle('ai:finish', (_e, { kind, args, reply }) => AI.finish(kind, args, reply));
ipcMain.handle('ai:key', (_e, { provider, key }) => { AI.setKey(provider, key); return AI.publicSettings(); });
ipcMain.handle('ai:session', () => { configureSession(AI_PARTITION); return { partition: AI_PARTITION, preload: 'file://' + WEBVIEW_PRELOAD }; });
// Sign in to ChatGPT / Claude / Gemini in a real window that shares the AI panel's cookies
const AI_LOGIN = { chatgpt: 'https://chatgpt.com/auth/login', claude: 'https://claude.ai/login', gemini: 'https://gemini.google.com/app' };
let signinWin = null;
ipcMain.handle('ai:signin', (_e, { site }) => {
  if (signinWin && !signinWin.isDestroyed()) { signinWin.focus(); return true; }
  configureSession(AI_PARTITION);
  signinWin = new BrowserWindow({
    width: 560, height: 760, parent: win, title: 'Sign in', backgroundColor: '#ffffff',
    webPreferences: { partition: AI_PARTITION, preload: WEBVIEW_PRELOAD, sandbox: true, contextIsolation: true }
  });
  signinWin.webContents.setWindowOpenHandler(({ url }) => ({ action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: signinWin, webPreferences: { partition: AI_PARTITION, preload: WEBVIEW_PRELOAD, sandbox: true } } }));
  signinWin.loadURL(AI_LOGIN[site] || AI_LOGIN.chatgpt);
  // Close automatically once the chat itself loads (i.e. you're signed in)
  const done = (url) => {
    try {
      const u = new URL(url);
      const home = { chatgpt: /^chatgpt\.com$/, claude: /^claude\.ai$/, gemini: /^gemini\.google\.com$/ }[site];
      if (home && home.test(u.hostname) && !/login|auth|signin|onboarding/i.test(u.pathname)) setTimeout(() => { if (signinWin && !signinWin.isDestroyed()) signinWin.close(); }, 1500);
    } catch {}
  };
  signinWin.webContents.on('did-navigate', (_e, url) => done(url));
  signinWin.webContents.on('did-navigate-in-page', (_e, url) => done(url));
  signinWin.on('closed', () => { signinWin = null; send('ai:signed-in', { site }); });
  return true;
});

// Apply Guide
ipcMain.handle('guide:scan', async (_e, { tabId } = {}) => {
  const scan = await B.scan({ tabId });
  if (!scan) return null;
  const job = scan.jobId ? D.findJob(scan.jobId) : null;
  const vals = AF.profileValues(D.store.profile, { source: job?.source });
  const portal = AF.portalFor(scan.url);
  return {
    ...scan, portal: { id: portal.id, name: portal.name, tips: portal.tips },
    fields: AF.plan(scan.fields, vals),
    job: job ? { id: job.id, title: job.title, company: job.company, status: job.status, hasResume: !!job.submitted?.resume, hasCover: !!job.submitted?.coverLetter, appliedAt: job.submitted?.appliedAt, attachments: job.submitted?.attachments || [] } : null,
    finalButton: scan.buttons.find(b => /\b(submit|send)\b.*\b(application|app)\b|^\s*(submit|send|finish|complete( application)?|submit now)\s*$|submit your application|finish applying/i.test(b.label || '')) || null
  };
});
ipcMain.handle('guide:fill', (_e, { fields }) => B.fill(fields));
ipcMain.handle('guide:upload', (_e, { ref, file, jobId, format }) => Tools.uploadFile(ref, file, jobId, format));
ipcMain.handle('guide:focus', (_e, { ref }) => B.scroll({ ref }).catch(() => null));
ipcMain.handle('guide:mark-submit', async (_e, { ref }) => B.click(ref, { allowSubmit: false }));
ipcMain.handle('guide:autofill', async (_e, { jobId }) => { const r = await Tools.autofill(jobId); return { filled: r.filled.length, failed: r.failed.length }; });

ipcMain.handle('file:open', (_e, p) => { if (p && D.insideFiles(p)) return shell.openPath(p); });
ipcMain.handle('file:show', (_e, p) => { if (p && (D.insideFiles(p) || p === D.filesRoot())) shell.showItemInFolder(p); });
ipcMain.handle('folder:open', (_e, which) => {
  const dirs = { root: D.filesRoot(), profile: D.profileDir(), applications: D.applicationsDir() };
  return shell.openPath(dirs[which] || D.filesRoot());
});
ipcMain.handle('folder:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Where should Onward keep its files?', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  D.store.settings.filesRoot = path.join(r.filePaths[0], 'Onward Files');
  D.ensureFolders(); D.save('settings');
  return publicState();
});
ipcMain.handle('external:open', (_e, url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); });

ipcMain.handle('session:prepare', () => { configureSession(BROWSER_PARTITION); return { partition: BROWSER_PARTITION, preload: 'file://' + WEBVIEW_PRELOAD }; });
ipcMain.handle('browser:register', (_e, o) => { B.register(o); return true; });
ipcMain.handle('browser:active', (_e, tabId) => { B.setActive(tabId); return true; });
ipcMain.handle('browser:closed', (_e, tabId) => { B.closed(tabId); return true; });
ipcMain.handle('browser:save', (_e, patch) => { D.store.browser = { ...D.store.browser, ...patch }; D.save('browser'); return true; });
ipcMain.handle('browser:link-job', (_e, jobId) => { B.linkJob(jobId, true); return true; });
ipcMain.handle('browser:link-tab', (_e, { tabId, jobId }) => { B.linkTab(tabId, jobId); return true; });
ipcMain.handle('browser:clear-data', async () => { const ses = session.fromPartition(BROWSER_PARTITION); await ses.clearStorageData(); await ses.clearCache(); return true; });

ipcMain.handle('claude:status', () => connectorStatus());
ipcMain.handle('claude:connect', () => connectClaudeDesktop());
ipcMain.handle('codex:connect', () => connectCodex());
ipcMain.handle('claude:copy', (_e, t) => { clipboard.writeText(String(t || '')); return true; });

// ---------- start ----------
app.whenReady().then(() => {
  D.load();
  D.onChange = (kind) => send('state:changed', kind);
  configureSession(BROWSER_PARTITION);
  configureSession(AI_PARTITION);
  try { installMcpScript(); } catch (e) { console.error('MCP install failed', e); }
  Tools.setNotify((kind, payload) => send('claude:' + kind, payload));
  Disc.init({ send, ensureWindow });
  B.init({
    sendToRenderer: send,
    ensureWindow,
    submitted: (jobId, url, payload = {}) => {
      let portal = '';
      try { portal = require('./autofill').portalFor(url).name; } catch {}
      const job = jobId && D.findJob(jobId);
      const answers = (payload.answers || []).filter(a => a.question && a.answer);
      if (job) {
        D.recordSubmission(jobId, { submitted: true, portal: job.submitted?.portal ? undefined : portal, answers });
        send('claude:job', { id: jobId }); send('toast', { text: 'Marked as applied 🎉' });
        send('browser:submitted', { jobId });
      } else send('browser:submitted-unknown', { url, answers, portal });
    }
  });
  bridge.start({ handle: Tools.handle, status: (s) => send('claude:status', { ...connectorStatus(), ...s }) });
  // Keep connector entries pointing at this copy of Onward (e.g. after installing to /Applications)
  try { const st = connectorStatus(); if (st.configured && !st.current) connectClaudeDesktop(); if (st.codexConfigured && !st.codexCurrent) connectCodex(); } catch {}
  if (IS_MAC) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ]));
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); else win.show(); });
});

ipcMain.handle('job:applied-with', (_e, { id, answers, portal }) => D.recordSubmission(id, { submitted: true, answers, portal }));

app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
app.on('before-quit', () => { D.flush(); bridge.stop(); });

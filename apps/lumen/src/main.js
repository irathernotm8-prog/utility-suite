// Lumen — main process. Owns the database, secrets and network calls; the window only sees what preload exposes.
const { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, shell } = require('electron');
const path = require('path');
const { open, store, iso, addDays } = require('./db');
const connectors = require('./connectors');
const ai = require('./ai');

if (process.env.LUMEN_USER_DATA) app.setPath('userData', process.env.LUMEN_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win, S;
const isMac = process.platform === 'darwin';

// ---- secrets: encrypted with the OS keychain via safeStorage; the renderer only ever learns "set / not set" ----
const seal = (v) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : 'raw:' + Buffer.from(v).toString('base64'));
const unseal = (v) => {
  if (!v) return '';
  if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
  return Buffer.from(v.slice(4), 'base64').toString();
};
const secretKeys = (kind) => ((connectors.get(kind) || {}).fields || []).filter((f) => f.secret).map((f) => f.key);

function publicConn(c) {
  const secrets = secretKeys(c.kind), cfg = { ...c.config };
  const has = {};
  for (const k of secrets) { has[k] = !!cfg[k]; delete cfg[k]; }
  return { ...c, config: cfg, hasSecret: has };
}
function plainConfig(c) {
  const cfg = { ...c.config };
  for (const k of secretKeys(c.kind)) if (cfg[k]) cfg[k] = unseal(cfg[k]);
  return cfg;
}
const getKey = (name) => unseal(S.getSetting('secret.' + name, ''));

// ---- sync ----
async function syncConnection(id, days = 90) {
  const c = S.connection(id);
  if (!c) throw new Error('Connection not found.');
  const impl = connectors.get(c.kind);
  const until = iso(new Date()), since = addDays(until, -(days - 1));
  try {
    let rows;
    if (c.kind === 'demo') rows = impl.generate({ days, end: until });
    else rows = await impl.sync(plainConfig(c), { since, until });
    S.upsertFacts(c.workspace_id, c.kind, c.id, rows);
    S.updateConnection(id, { status: 'ok', last_sync: new Date().toISOString(), last_error: null });
    return { rows: rows.length };
  } catch (e) {
    S.updateConnection(id, { status: 'error', last_error: String(e.message || e) });
    throw e;
  }
}

function seedDemo() {
  if (S.workspaces().length) return;
  const ws = S.addWorkspace('Demo workspace', 1);
  const cn = S.addConnection(ws, 'demo', 'Demo data', {});
  S.setSetting('activeWorkspace', ws);
  syncConnection(cn).catch(() => {});
}

// ---- IPC ----
const h = (name, fn) => ipcMain.handle('lumen:' + name, async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

function registerIpc() {
  h('bootstrap', () => {
    const workspaces = S.workspaces();
    let active = S.getSetting('activeWorkspace');
    if (!workspaces.find((w) => w.id === active)) active = workspaces[0] && workspaces[0].id;
    return {
      workspaces, active, theme: S.getSetting('theme', 'system'), model: S.getSetting('model', ai.DEFAULT_MODEL),
      keys: { anthropic: !!getKey('anthropic'), openai: !!getKey('openai') },
      platform: process.platform,
      connectors: {
        ready: Object.values(connectors.ready).filter((c) => c.kind !== 'demo').map((c) => ({ kind: c.kind, name: c.name, fields: c.fields })),
        planned: connectors.planned
      },
      today: iso(new Date())
    };
  });
  h('setActive', (id) => S.setSetting('activeWorkspace', id));
  h('summary', (ws, from, to) => S.summary(ws, from, to));
  h('workspace:add', (name) => { const id = S.addWorkspace(String(name || 'Untitled').trim() || 'Untitled'); S.setSetting('activeWorkspace', id); return id; });
  h('workspace:rename', (id, name) => S.renameWorkspace(id, String(name).trim()));
  h('workspace:remove', (id) => { S.removeWorkspace(id); });

  h('connections', (ws) => S.connections(ws).map(publicConn));
  h('connection:add', (ws, kind, label, cfg) => {
    const impl = connectors.get(kind);
    if (!impl || kind === 'demo') throw new Error('Unknown connector.');
    const clean = { ...cfg };
    for (const k of secretKeys(kind)) if (clean[k]) clean[k] = seal(String(clean[k]).trim());
    return S.addConnection(ws, kind, label || impl.name, clean);
  });
  h('connection:update', (id, label, cfg) => {
    const c = S.connection(id); if (!c) throw new Error('Connection not found.');
    const merged = { ...c.config };
    for (const [k, v] of Object.entries(cfg || {})) {
      if (secretKeys(c.kind).includes(k)) { if (v) merged[k] = seal(String(v).trim()); } else merged[k] = v;
    }
    S.updateConnection(id, { label: label || c.label, config: merged, status: 'new' });
  });
  h('connection:remove', (id) => S.removeConnection(id));
  h('connection:test', async (id) => { const c = S.connection(id); return connectors.get(c.kind).test(plainConfig(c)); });
  h('connection:sync', (id, days) => syncConnection(id, days || 90));

  h('settings:theme', (t) => { S.setSetting('theme', t); applyTheme(t); });
  h('settings:model', (m) => S.setSetting('model', String(m || '').trim() || ai.DEFAULT_MODEL));
  h('settings:key', (name, value) => {
    if (!['anthropic', 'openai'].includes(name)) throw new Error('Unknown key.');
    S.setSetting('secret.' + name, value ? seal(String(value).trim()) : '');
    return !!value;
  });

  h('ask', (payload) => ai.ask({
    key: getKey('anthropic'), model: S.getSetting('model', ai.DEFAULT_MODEL),
    question: String(payload.question || ''), history: payload.history || [],
    summary: S.summary(payload.ws, payload.from, payload.to),
    workspace: (S.workspaces().find((w) => w.id === payload.ws) || {}).name || 'Workspace'
  }));
  h('open', (url) => { if (/^https:\/\//.test(url)) return shell.openExternal(url); });
}

function applyTheme(t) { nativeTheme.themeSource = ['light', 'dark'].includes(t) ? t : 'system'; }

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0f14' : '#f6f7fb',
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0d0f14', symbolColor: '#aab0c0', height: 48 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  S = store(open(path.join(app.getPath('userData'), 'lumen.db')));
  applyTheme(S.getSetting('theme', 'system'));
  seedDemo();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (!isMac) app.quit(); });

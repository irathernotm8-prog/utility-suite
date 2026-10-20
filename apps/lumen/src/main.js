// Lumen — main process. Owns the database, secrets and network calls; the window only sees what preload exposes.
const { app, BrowserWindow, ipcMain, nativeTheme, nativeImage, dialog, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { open, store, iso, localToday, addDays } = require('./db');
const connectors = require('./connectors');
const ai = require('./ai');
const gauth = require('./google-auth');
const publisher = require('./publisher');
const { makePosts } = require('./posts');
const adsApi = require('./ads');
const { makeAds } = require('./adsmgr');

if (process.env.LUMEN_USER_DATA) app.setPath('userData', process.env.LUMEN_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win, S, P, A, ticking = false;
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
// Google connectors share one sign-in; hand them a fresh access token.
const googleCreds = () => ({ clientId: S.getSetting('google.clientId', ''), clientSecret: getKey('google.clientSecret'), refreshToken: getKey('google.refresh') });
async function resolveConfig(c) {
  const cfg = plainConfig(c);
  if ((connectors.get(c.kind) || {}).google) cfg.accessToken = await gauth.accessToken(googleCreds());
  return cfg;
}
const getKey = (name) => unseal(S.getSetting('secret.' + name, ''));

// ---- posting: media lives in the app's own folder; Facebook/Instagram calls happen here, never in the window ----
const mediaDir = () => path.join(app.getPath('userData'), 'media');
function safeMedia(p) {
  const full = path.resolve(String(p || ''));
  if (!full.startsWith(mediaDir() + path.sep)) throw new Error('That file is not in Lumen’s media folder.');
  return full;
}
const readMedia = async (p) => { const full = safeMedia(p); return { data: fs.readFileSync(full), type: 'image/jpeg', name: path.basename(full) }; };
function cfgFor(ws) {
  const c = S.connections(ws).find((x) => x.kind === 'meta-pages');
  if (!c) throw new Error('Connect “Facebook & Instagram posting” in Sources first.');
  return plainConfig(c);
}
const pub = {
  canNativeSchedule: publisher.canNativeSchedule,
  scheduleFacebook: (p, c) => publisher.scheduleFacebook(p, c, fetch, { readMedia }),
  cancelFacebook: (id, c) => publisher.cancelFacebook(id, c, fetch),
  checkFacebook: (id, c) => publisher.checkFacebook(id, c, fetch),
  publishNow: (p, c, pl) => publisher.publishNow(p, c, pl, fetch, { readMedia })
};
function adsCfgFor(ws) {
  const c = S.connections(ws).find((x) => x.kind === 'meta');
  if (!c) throw new Error('Connect Meta Ads in Sources first.');
  return plainConfig(c);
}
const adsBound = {
  fetchTree: (c, r) => adsApi.fetchTree(c, r, fetch),
  update: (c, id, k, p, cur) => adsApi.update(c, id, k, p, cur, fetch),
  copyCampaign: (c, id) => adsApi.copyCampaign(c, id, fetch),
  geoSearch: (c, q) => adsApi.geoSearch(c, q, fetch),
  createCampaign: (c, spec, cur, rm) => adsApi.createCampaign(c, spec, cur, fetch, rm)
};
async function runTick() {
  if (ticking || !P) return; ticking = true;
  try { const changed = await P.tick(); if (changed.length && win && !win.isDestroyed()) win.webContents.send('lumen:posts-changed'); }
  catch (e) { console.error('scheduler:', e.message); } finally { ticking = false; }
}

// ---- sync ----
async function syncConnection(id, days = 90) {
  const c = S.connection(id);
  if (!c) throw new Error('Connection not found.');
  const impl = connectors.get(c.kind);
  const until = localToday(), since = addDays(until, -(days - 1));
  try {
    let res;
    if (c.kind === 'demo') res = impl.generate({ days, end: until });
    else res = await impl.sync(await resolveConfig(c), { since, until });
    const out = Array.isArray(res) ? { facts: res } : res || {};
    let n = 0;
    if (out.facts) n += S.upsertFacts(c.workspace_id, c.kind, c.id, out.facts);
    if (out.series) n += S.upsertSeries(c.workspace_id, c.kind, c.id, out.series);
    for (const sn of out.snapshots || []) { S.upsertSnapshot(c.workspace_id, c.id, sn.key, c.kind, sn.name, sn.payload); n++; }
    S.updateConnection(id, { status: 'ok', last_sync: new Date().toISOString(), last_error: out.warning || null });
    return { rows: n, warning: out.warning };
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

// A small slice of the analytics sources so questions like "does GA4 agree with Meta?" are answerable.
function analyticsForAi(ws, from, to) {
  const out = {}, top = (a, n) => (a || []).slice(0, n).map((x) => ({ name: x.dim, value: Math.round(x.total * 100) / 100 }));
  const g = S.seriesSummary(ws, 'ga4', from, to);
  if (Object.keys(g.metrics).length) {
    out.ga4 = { totals: Object.fromEntries(['sessions', 'engaged_sessions', 'key_events', 'revenue'].filter((m) => g.metrics[m]).map((m) => [m, { now: Math.round(g.metrics[m].total), previous: Math.round(g.metrics[m].previous) }])),
      sessions_by_channel: top(g.dims.sessions, 8), key_events_by_campaign: top(g.dims.campaign_key_events, 15), sessions_by_campaign: top(g.dims.campaign_sessions, 15) };
  }
  const y = S.seriesSummary(ws, 'youtube', from, to);
  if (Object.keys(y.metrics).length) out.youtube = Object.fromEntries(Object.entries(y.metrics).map(([m, v]) => [m, { now: Math.round(v.total), previous: Math.round(v.previous) }]));
  return Object.keys(out).length ? out : undefined;
}

function registerIpc() {
  h('bootstrap', () => {
    const workspaces = S.workspaces();
    let active = S.getSetting('activeWorkspace');
    if (!workspaces.find((w) => w.id === active)) active = workspaces[0] && workspaces[0].id;
    return {
      workspaces, active, theme: S.getSetting('theme', 'system'), model: S.getSetting('model', ai.DEFAULT_MODEL),
      keys: { anthropic: !!getKey('anthropic'), openai: !!getKey('openai') },
      ai: { provider: S.getSetting('aiProvider', 'anthropic'), cliModel: S.getSetting('cliModel', ''), providers: Object.entries(ai.PROVIDERS).map(([id, p]) => ({ id, label: p.label })) },
      google: { hasClient: !!(S.getSetting('google.clientId', '') && getKey('google.clientSecret')), signedIn: !!getKey('google.refresh') },
      platform: process.platform,
      connectors: {
        ready: Object.values(connectors.ready).filter((c) => c.kind !== 'demo').map((c) => ({ kind: c.kind, name: c.name, fields: c.fields, category: c.category || 'ads', google: !!c.google })),
        planned: connectors.planned
      },
      today: localToday(), budgetCap: S.getSetting('budgetCap', 500)
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
  h('connection:test', async (id) => { const c = S.connection(id); return connectors.get(c.kind).test(await resolveConfig(c)); });
  h('connection:sync', (id, days) => syncConnection(id, days || 90));

  h('settings:theme', (t) => { S.setSetting('theme', t); applyTheme(t); });
  h('settings:model', (m) => S.setSetting('model', String(m || '').trim() || ai.DEFAULT_MODEL));
  h('settings:key', (name, value) => {
    if (!['anthropic', 'openai'].includes(name)) throw new Error('Unknown key.');
    S.setSetting('secret.' + name, value ? seal(String(value).trim()) : '');
    return !!value;
  });

  h('settings:provider', (p) => { if (!ai.PROVIDERS[p]) throw new Error('Unknown AI provider.'); S.setSetting('aiProvider', p); });
  h('settings:cliModel', (m) => S.setSetting('cliModel', String(m || '').trim()));
  h('ai:detect', (p) => ai.detect(p));
  h('ai:test', async () => {
    const text = await ai.ask({ provider: S.getSetting('aiProvider', 'anthropic'), key: getKey('anthropic'), model: S.getSetting('model', ai.DEFAULT_MODEL), cliModel: S.getSetting('cliModel', ''),
      question: 'Reply with the single word OK.', summary: { from: '', to: '', span: 0, current: {}, previous: {}, campaigns: [], series: [] }, workspace: 'test' });
    return text.slice(0, 80);
  });

  // Google: one sign-in shared by Analytics, Ads and YouTube.
  h('google:setClient', (id, secret) => { S.setSetting('google.clientId', String(id || '').trim()); if (secret) S.setSetting('secret.google.clientSecret', seal(String(secret).trim())); });
  h('google:signIn', async () => {
    const { refreshToken } = await gauth.signIn({ ...googleCreds(), openExternal: (u) => shell.openExternal(u) });
    S.setSetting('secret.google.refresh', seal(refreshToken));
    if (win) { win.show(); win.focus(); }
  });
  h('google:signOut', () => { S.setSetting('secret.google.refresh', ''); });

  // Ads manager: every change goes through adsmgr.js (confirmations, budget ceiling, audit log)
  h('ads:tree', async (ws, from, to, force) => ({ ...(await A.tree(ws, { since: from, until: to }, force)), cap: A.cap(), options: { objectives: Object.entries(adsApi.OBJECTIVES).map(([id, o]) => ({ id, label: o.label, needsPixel: !!o.needsPixel })), ctas: adsApi.CTAS, special: adsApi.SPECIAL } }));
  h('ads:change', (ws, id, patch, opts) => A.change(ws, id, patch, { confirmedActivate: !!(opts && opts.confirmedActivate) }));
  h('ads:copy', (ws, id) => A.copy(ws, id));
  h('ads:create', (ws, spec) => A.create(ws, spec));
  h('ads:geo', (ws, q) => A.geo(ws, String(q || '').trim()));
  h('ads:audit', (ws) => A.audit(ws));
  h('ads:revert', (ws, id, opts) => A.revert(ws, id, { confirmedActivate: !!(opts && opts.confirmedActivate) }));
  h('ads:defaults', async (ws) => {
    const c = S.connections(ws).find((x) => x.kind === 'meta-pages'); if (!c) return {};
    const out = { pageId: c.config.pageId };
    try { const ctx = await publisher.pageContext(plainConfig(c), fetch); out.instagramUserId = ctx.igId; out.pageName = ctx.name; } catch (_) {}
    return out;
  });
  h('ads:aiDraft', (ws, brief) => ai.campaignDraft({
    provider: S.getSetting('aiProvider', 'anthropic'), key: getKey('anthropic'), model: S.getSetting('model', ai.DEFAULT_MODEL), cliModel: S.getSetting('cliModel', ''),
    brief, cap: A.cap(), ctas: adsApi.CTAS, workspace: (S.workspaces().find((w) => w.id === ws) || {}).name
  }));
  h('settings:budgetCap', (v) => { const n = +v; if (!(n > 0 && n <= 100000)) throw new Error('Enter a daily limit above zero.'); S.setSetting('budgetCap', n); });

  // Posts + calendar
  h('posts', (ws) => S.posts(ws));
  h('post:save', (ws, d) => P.save(ws, d));
  h('post:schedule', (id) => P.schedule(id));
  h('post:publishNow', (id) => P.publishNow(id));
  h('post:unschedule', (id) => P.unschedule(id));
  h('post:delete', (id) => P.remove(id));
  h('media:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0], ext = path.extname(src).toLowerCase();
    fs.mkdirSync(mediaDir(), { recursive: true });
    const out = path.join(mediaDir(), Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.jpg');
    if (ext === '.jpg' || ext === '.jpeg') fs.copyFileSync(src, out);
    else { const img = nativeImage.createFromPath(src); if (img.isEmpty()) throw new Error('Could not read that image.'); fs.writeFileSync(out, img.toJPEG(92)); }
    return { path: out, name: path.basename(src) };
  });
  h('media:thumb', (p) => { const img = nativeImage.createFromPath(safeMedia(p)); return img.isEmpty() ? '' : img.resize({ width: 360 }).toDataURL(); });
  h('ai:draft', (d) => ai.draft({
    provider: S.getSetting('aiProvider', 'anthropic'), key: getKey('anthropic'), model: S.getSetting('model', ai.DEFAULT_MODEL), cliModel: S.getSetting('cliModel', ''),
    brief: d.brief, platforms: d.platforms, tone: d.tone, workspace: (S.workspaces().find((w) => w.id === d.ws) || {}).name
  }));

  h('analytics', (ws, from, to) => ({
    ga4: S.seriesSummary(ws, 'ga4', from, to), youtube: S.seriesSummary(ws, 'youtube', from, to),
    snapshots: S.snapshots(ws).map((x) => ({ source: x.source, key: x.key, name: x.name, fetched_at: x.fetched_at, ...x.payload }))
  }));

  h('ask', (payload) => {
    const summary = S.summary(payload.ws, payload.from, payload.to);
    summary.analytics = analyticsForAi(payload.ws, payload.from, payload.to);
    return ai.ask({
      provider: S.getSetting('aiProvider', 'anthropic'), key: getKey('anthropic'), model: S.getSetting('model', ai.DEFAULT_MODEL), cliModel: S.getSetting('cliModel', ''),
      question: String(payload.question || ''), history: payload.history || [], summary,
      workspace: (S.workspaces().find((w) => w.id === payload.ws) || {}).name || 'Workspace'
    });
  });
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
  P = makePosts({ S, cfgFor, pub });
  A = makeAds({ S, cfgFor: adsCfgFor, api: adsBound, readMedia, getCap: () => S.getSetting('budgetCap', 500) });
  registerIpc();
  createWindow();
  setTimeout(runTick, 4000); setInterval(runTick, 60 * 1000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (!isMac) app.quit(); });

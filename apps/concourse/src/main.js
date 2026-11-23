'use strict';
// Concourse — main process: the window, the menu bar / tray countdown, Microsoft accounts, the live sync, meeting
// reminders, joining, local tasks, the Utility Suite link and the bridge (window.concourse.call → api table below).
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification, safeStorage, session, desktopCapturer, powerMonitor, globalShortcut, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const M = require('./core/model');
const auth = require('./core/auth');
const { Graph } = require('./core/graph');
const { AccountSync } = require('./sync');
const suitelink = require('./suitelink');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const DEMO = process.env.CONCOURSE_DEMO === '1' || process.argv.includes('--demo');
if (process.env.CONCOURSE_USER_DATA) app.setPath('userData', process.env.CONCOURSE_USER_DATA);
const USER = app.getPath('userData');
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

if (!DEMO && !process.env.CONCOURSE_MULTI && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.bilal.concourse');

let win = null, tray = null, quitting = false;
const startHidden = process.argv.includes('--hidden') || (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden);

// ───────────────────────────────────────────── files
const F = {
  settings: path.join(USER, 'settings.json'),
  accounts: path.join(USER, 'accounts.bin'),
  tasks: path.join(USER, 'tasks.json'),
  cache: path.join(USER, 'cache.json'),
  photos: path.join(USER, 'photos'),
};
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }

// ───────────────────────────────────────────── settings
function defaults() {
  return {
    clientId: '', tenant: 'organizations',
    lamp: 'amber',                 // board colour: amber · cyan · green · white
    flaps: true,                   // split-flap animation
    boardMin: 10,                  // "NOW BOARDING" this many minutes before a meeting
    remind: [5, 1],                // meeting reminders (minutes before)
    joinMode: 'browser',           // browser · app · window · vantage
    recordWithDocket: false,       // ask Docket to start recording when you join
    notify: { messages: true, mentionsOnly: false, meetings: true, sound: true },
    quiet: { on: false, from: '18:00', to: '08:00' },
    taskTarget: 'local',           // where new tasks go: local · todo:<accountId>:<listId>
    showTodo: true,                // show Microsoft To Do tasks beside local ones
    workHours: [8, 18], weekDays: 5,
    menubar: true,                 // countdown to the next meeting in the menu bar (Mac)
    closeToTray: true, launchAtLogin: false,
    shortcut: 'CommandOrControl+Shift+J', // join the next meeting from anywhere
    pinned: [], muted: [],         // chat ids
  };
}
let settings = Object.assign(defaults(), readJson(F.settings, {}));
settings.notify = Object.assign(defaults().notify, settings.notify);
settings.quiet = Object.assign(defaults().quiet, settings.quiet);
const saveSettings = () => writeJson(F.settings, settings);
// A client ID baked into src/config.json (Bilal's own app registration) is used when Settings has none.
const CONFIG = readJson(path.join(__dirname, 'config.json'), {});
const clientId = () => settings.clientId || process.env.CONCOURSE_CLIENT_ID || CONFIG.clientId || '';

// ───────────────────────────────────────────── accounts (refresh tokens encrypted with the system keychain)
let accounts = [];
const COLORS = ['#ffb547', '#5ee0ff', '#7dff9b', '#ff7ab6', '#b69cff'];
function loadAccounts() {
  if (DEMO) { accounts = [{ id: 'demo', name: 'Bilal Ahmad', username: 'bilal@northwind.example', tenantId: 'demo', color: COLORS[0], demo: true }]; return; }
  try {
    const buf = fs.readFileSync(F.accounts);
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    accounts = JSON.parse(txt);
  } catch (_) { accounts = []; }
}
function saveAccounts() {
  if (DEMO) return;
  const txt = JSON.stringify(accounts.map(a => ({ ...a, accessToken: undefined, expiresAt: undefined })));
  fs.mkdirSync(USER, { recursive: true });
  fs.writeFileSync(F.accounts, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt));
}
const tokens = new Map(); // accountId → { accessToken, expiresAt }
async function tokenFor(acc) {
  const t = tokens.get(acc.id);
  if (t && t.expiresAt > Date.now()) return t.accessToken;
  if (!acc.refreshToken) { const e = new Error('Sign in again in Settings › Accounts.'); e.code = 'needsSignIn'; e.status = 401; throw e; }
  try {
    const r = await auth.refresh({ clientId: acc.clientId, tenant: acc.tenantId || 'organizations', refreshToken: acc.refreshToken, scopes: acc.scopes });
    tokens.set(acc.id, { accessToken: r.accessToken, expiresAt: r.expiresAt });
    if (r.refreshToken && r.refreshToken !== acc.refreshToken) { acc.refreshToken = r.refreshToken; saveAccounts(); }
    if (acc.needsSignIn) { acc.needsSignIn = false; push('accounts'); }
    return r.accessToken;
  } catch (e) {
    if (/invalid_grant|expired|AADSTS(700082|50173|70008)/i.test(e.code + ' ' + e.detail)) { acc.needsSignIn = true; push('accounts'); }
    e.status = e.status || 401; throw e;
  }
}

// ───────────────────────────────────────────── syncs
const syncs = new Map(); // accountId → AccountSync
function graphFor(acc) {
  if (acc.demo) { const { DemoGraph } = require('./demo'); return (graphFor.demo = graphFor.demo || new DemoGraph()); }
  return new Graph({ getToken: () => tokenFor(acc) });
}
function startSync(acc) {
  stopSync(acc.id);
  const s = new AccountSync({ account: acc, graph: graphFor(acc), focused: () => !!(win && win.isFocused()), calendarRange: calRange });
  s.on('change', (part) => { push(part); if (part === 'calendar') { scheduleReminders(); updateTray(); } if (part === 'chats') { updateBadge(); linkEmit('unread', unreadCount()); } });
  s.on('new-messages', (rows) => notifyMessages(acc, rows));
  s.on('error', (key, e) => { if (process.env.CONCOURSE_DEBUG) console.error('[sync]', acc.id, key, e && e.message); });
  syncs.set(acc.id, s); s.start();
}
function stopSync(id) { const s = syncs.get(id); if (s) { s.stop(); syncs.delete(id); } }
let calFrom = M.addDays(M.startOfDay(Date.now()), -7), calTo = M.addDays(M.startOfDay(Date.now()), 28);
function calRange() { return [Math.min(calFrom, M.addDays(M.startOfDay(Date.now()), -7)), Math.max(calTo, M.addDays(M.startOfDay(Date.now()), 28))]; }

// ───────────────────────────────────────────── the snapshot the window draws from
function snapshot() {
  const out = { demo: DEMO, now: Date.now(), settings: publicSettings(), accounts: accounts.map(publicAccount), me: {}, chats: [], events: [], teams: {}, todo: [], todoLists: {}, people: {}, errors: {}, loaded: {}, tasks: localTasks };
  for (const a of accounts) {
    const s = syncs.get(a.id); if (!s) continue;
    out.me[a.id] = s.s.me ? { ...s.s.me, presence: s.s.presence } : null;
    out.chats.push(...s.s.chats);
    out.events.push(...s.s.events);
    if (s.s.teams) out.teams[a.id] = s.s.teams;
    out.todo.push(...s.s.todo);
    out.todoLists[a.id] = s.s.todoLists;
    Object.assign(out.people, s.s.people);
    if (Object.keys(s.s.errors).length) out.errors[a.id] = s.s.errors;
    out.loaded[a.id] = s.s.loaded;
  }
  return out;
}
const publicAccount = (a) => ({ id: a.id, name: a.name, username: a.username, tenantId: a.tenantId, color: a.color, demo: !!a.demo, needsSignIn: !!a.needsSignIn, channels: !!(a.scopes || []).some(s => /ChannelMessage\.Read/i.test(s)) || !!a.demo });
const publicSettings = () => ({ ...settings, clientId: clientId(), clientIdFromConfig: !settings.clientId && !!(process.env.CONCOURSE_CLIENT_ID || CONFIG.clientId), platform: process.platform });

let pushTimer = null; const pushParts = new Set();
function push(part) {
  pushParts.add(part || 'all');
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null; const parts = [...pushParts]; pushParts.clear();
    send('state', snapshot(), parts);
    saveCacheSoon();
  }, 120);
}
function send(ch, ...a) { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); }

// Offline start: the last snapshot is shown until the first sync lands.
let cacheTimer = null;
function saveCacheSoon() {
  if (DEMO || cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    const s = snapshot();
    writeJson(F.cache, { at: Date.now(), me: s.me, chats: s.chats, events: s.events, todo: s.todo, todoLists: s.todoLists, teams: s.teams });
  }, 4000);
}

// ───────────────────────────────────────────── local tasks (self-assigned, on this computer)
let localTasks = DEMO ? [] : readJson(F.tasks, []);
const saveTasks = () => { if (!DEMO) writeJson(F.tasks, localTasks); push('tasks'); };

// ───────────────────────────────────────────── helpers used by the API
const accById = (id) => { const a = accounts.find(x => x.id === id) || accounts[0]; if (!a) throw new Error('Sign in to Microsoft first (Settings › Accounts).'); return a; };
const gFor = (id) => graphFor(accById(id));
const syncFor = (id) => syncs.get(accById(id).id);
const meFor = (id) => { const s = syncFor(id); return s && s.s.me; };
function allEvents() { const o = []; for (const s of syncs.values()) o.push(...s.s.events); return o; }
function allChats() { const o = []; for (const s of syncs.values()) o.push(...s.s.chats.map(c => ({ c, me: s.s.me }))); return o; }
function unreadCount() { return allChats().filter(({ c, me }) => me && M.chatUnread(c, me.id) && !settings.muted.includes(c.id)).length; }
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// chat being watched (open in the window): polled every few seconds
let watching = null, watchTimer = null, watchSig = '';
async function pollWatched() {
  clearTimeout(watchTimer);
  if (!watching) return;
  const w = watching;
  try {
    const msgs = await gFor(w.accountId).messages(w.chatId);
    if (watching !== w) return;
    const sig = JSON.stringify(msgs.map(m => [m.id, m.lastModifiedDateTime, m.deletedDateTime, (m.reactions || []).length]));
    if (sig !== watchSig) { watchSig = sig; send('messages', { chatId: w.chatId, accountId: w.accountId, messages: msgs }); if (win && win.isFocused()) markReadQuiet(w); }
  } catch (e) { send('messages-error', { chatId: w.chatId, error: e.message }); }
  if (watching === w) watchTimer = setTimeout(pollWatched, win && win.isFocused() ? 4000 : 12000);
}
async function markReadQuiet(w) {
  try {
    const acc = accById(w.accountId); const me = meFor(acc.id); if (!me) return;
    const s = syncFor(acc.id); const c = s && s.s.chats.find(x => x.id === w.chatId);
    if (c && M.chatUnread(c, me.id)) {
      await graphFor(acc).markRead(w.chatId, me.id, acc.tenantId);
      if (c.viewpoint) c.viewpoint.lastMessageReadDateTime = new Date().toISOString(); else c.viewpoint = { lastMessageReadDateTime: new Date().toISOString() };
      push('chats'); updateBadge();
    }
  } catch (_) { /* marking read is best effort */ }
}

// photos: disk cache per account, misses remembered for a day
const photoMiss = new Map();
async function photo(accountId, userId) {
  if (!userId) return null;
  const acc = accById(accountId);
  const file = path.join(F.photos, acc.id.replace(/[^a-z0-9-]/gi, ''), userId.replace(/[^a-z0-9-]/gi, '') + '.jpg');
  try { const st = fs.statSync(file); if (Date.now() - st.mtimeMs < 7 * 864e5) return 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64'); } catch (_) {}
  const k = acc.id + userId; if (photoMiss.get(k) > Date.now()) return null;
  try {
    const buf = await graphFor(acc).photo(userId);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf);
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch (_) { photoMiss.set(k, Date.now() + 864e5); return null; }
}

// ───────────────────────────────────────────── joining meetings
let meetingWin = null;
async function join({ url, title, eventId, accountId, mode }) {
  if (!url && eventId) {
    const ev = allEvents().find(e => e.id === eventId);
    const j = ev && M.joinLink(ev); url = j && j.url; title = title || (ev && ev.subject);
  }
  if (!url) throw new Error('This meeting has no join link.');
  mode = mode || settings.joinMode;
  if (DEMO) return { mode, demo: true, url };
  const targets = M.joinTargets(url);
  if (settings.recordWithDocket) docketRecord(title).catch(() => {});
  if (mode === 'app' && targets.app) { await shell.openExternal(targets.app); return { mode }; }
  if (mode === 'vantage') {
    try { const c = link.vantage || (link.vantage = suitelink.connect('vantage')); await withTimeout(c.call('open', url), 2500); return { mode }; }
    catch (_) { await shell.openExternal(url); return { mode: 'browser', note: 'Vantage wasn’t running, so the meeting opened in your browser.' }; }
  }
  if (mode === 'window') { openMeetingWindow(url, title); return { mode }; }
  await shell.openExternal(url); return { mode: 'browser' };
}
function openMeetingWindow(url, title) {
  if (meetingWin && !meetingWin.isDestroyed()) { meetingWin.loadURL(url); meetingWin.focus(); return; }
  const ses = session.fromPartition('persist:meetings');
  ses.setUserAgent(IS_WIN ? WIN_UA : CHROME_UA);
  const allowed = /(^|\.)(microsoft\.com|live\.com|office\.com|skype\.com|teams\.cdn\.office\.net|microsoftonline\.com|zoom\.us|google\.com|webex\.com)$/i;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    let host = ''; try { host = new URL(details.requestingUrl || wc.getURL()).hostname; } catch (_) {}
    cb(allowed.test(host) && ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture', 'speaker-selection'].includes(perm));
  });
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(src => cb({ video: src[0], audio: IS_WIN ? 'loopback' : undefined })).catch(() => cb({}));
  }, { useSystemPicker: true });
  const b = screen.getPrimaryDisplay().workArea;
  meetingWin = new BrowserWindow({ width: Math.min(1280, b.width - 80), height: Math.min(820, b.height - 80), title: title || 'Meeting', backgroundColor: '#07080b', icon: ICON, webPreferences: { partition: 'persist:meetings', contextIsolation: true, sandbox: true } });
  meetingWin.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https:\/\/([a-z0-9-]+\.)*(microsoft|live|office|microsoftonline)\.com\//i.test(u)) return { action: 'allow' }; shell.openExternal(u); return { action: 'deny' }; });
  meetingWin.on('closed', () => { meetingWin = null; });
  meetingWin.loadURL(url);
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

// ───────────────────────────────────────────── Utility Suite link
const link = { server: null, docket: null, vantage: null };
function startLink() {
  try {
    link.server = suitelink.serve('concourse', { version: app.getVersion(), calls: {
      status: () => ({ accounts: accounts.length, unread: unreadCount(), next: nextForLink() }),
      next: () => nextForLink(),
      today: () => M.departuresFor(allEvents(), Date.now(), Date.now(), { boardMin: settings.boardMin }).map(slim),
      unread: () => unreadCount(),
      join: (id) => { const n = id ? allEvents().find(e => e.id === id) : null; const target = n ? { eventId: n.id } : nextForLink(); if (!target) throw new Error('Nothing to join'); return join({ eventId: target.eventId || target.id }); },
      open: (view) => { showWindow(); if (view) send('go', view); return true; },
    } });
  } catch (_) { link.server = null; }
}
const slim = (r) => ({ id: r.id, title: r.title, start: r.start, end: r.end, status: r.status.label, join: r.join && r.join.url, gate: r.gate });
function nextForLink() { const n = M.nextDeparture(allEvents(), Date.now(), { boardMin: settings.boardMin }); return n ? slim(n) : null; }
function linkEmit(ev, data) { try { if (link.server && link.server.clients() > 0) link.server.emit(ev, data); } catch (_) {} }
async function docketRecord(title) {
  const c = link.docket || (link.docket = suitelink.connect('docket'));
  await withTimeout(c.call('start', { title: title || 'Meeting' }), 3000);
}

// ───────────────────────────────────────────── notifications and reminders
const inQuiet = () => {
  if (!settings.quiet.on) return false;
  const d = new Date(); const n = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = settings.quiet.from.split(':').map(Number), [th, tm] = settings.quiet.to.split(':').map(Number);
  const f = fh * 60 + fm, t = th * 60 + tm;
  return f <= t ? (n >= f && n < t) : (n >= f || n < t);
};
const dnd = () => { for (const s of syncs.values()) { const p = s.s.presence; if (p && /DoNotDisturb|Presenting|Focusing/i.test(p.availability + ' ' + p.activity)) return true; } return false; };

function notifyMessages(acc, rows) {
  if (!settings.notify.messages || !Notification.isSupported() || inQuiet()) return;
  const meId = meFor(acc.id) && meFor(acc.id).id;
  for (const r of rows.slice(0, 4)) {
    if (settings.muted.includes(r.id)) continue;
    if (win && win.isFocused() && watching && watching.chatId === r.id) continue;
    const s = syncFor(acc.id); const chat = s && s.s.chats.find(c => c.id === r.id);
    const urgent = chat && chat.lastMessagePreview && chat.lastMessagePreview.importance === 'urgent';
    if (settings.notify.mentionsOnly && r.chatType !== 'oneOnOne' && !urgent && !(r.text || '').includes(meFor(acc.id).displayName.split(' ')[0])) continue;
    if (dnd() && !urgent) continue;
    const n = new Notification({ title: r.chatType === 'oneOnOne' ? r.from : `${r.from} · ${r.title}`, body: r.text.slice(0, 240), silent: !settings.notify.sound, icon: IS_WIN ? ICON : undefined });
    n.on('click', () => { showWindow(); send('go', { view: 'chats', chatId: r.id, accountId: acc.id }); });
    n.show();
  }
  void meId;
}

const reminded = new Set(); let reminderTimer = null;
function scheduleReminders() { clearTimeout(reminderTimer); reminderTimer = setTimeout(checkReminders, 1000); }
function checkReminders() {
  clearTimeout(reminderTimer);
  const now = Date.now();
  if (settings.notify.meetings && !inQuiet()) {
    for (const ev of allEvents()) {
      const r = M.departure(ev, now, { boardMin: settings.boardMin });
      if (r.allDay || r.cancelled || r.response === 'declined' || r.start < now - 60000) continue;
      for (const m of settings.remind) {
        const key = `${r.id}:${r.start}:${m}`;
        const due = r.start - m * 60000;
        if (now >= due && now < due + 90000 && !reminded.has(key)) { reminded.add(key); remind(r, m); }
      }
    }
  }
  updateTray();
  reminderTimer = setTimeout(checkReminders, 15000);
}
function remind(r, mins) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: `${mins <= 1 ? 'Boarding now' : `Boarding in ${mins} min`} · ${r.title}`,
    body: `${fmtTime(r.start)} – ${fmtTime(r.end)}${r.organizer ? ' · ' + r.organizer : ''}${r.online ? '' : r.location ? ' · ' + r.location : ''}`,
    actions: r.online && IS_MAC ? [{ type: 'button', text: 'Join' }] : [], silent: !settings.notify.sound, icon: IS_WIN ? ICON : undefined,
  });
  n.on('action', () => join({ eventId: r.id }).catch(() => {}));
  n.on('click', () => { if (r.online && mins <= 1) join({ eventId: r.id }).catch(() => {}); else { showWindow(); send('go', { view: 'home' }); } });
  n.show();
  linkEmit('boarding', slim(r));
}
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function updateBadge() {
  const n = unreadCount();
  try { if (IS_MAC && app.dock) app.dock.setBadge(n ? String(n) : ''); else app.setBadgeCount(n); } catch (_) {}
}

// ───────────────────────────────────────────── tray / menu bar
function trayImage() {
  if (IS_MAC) { const i = nativeImage.createFromPath(path.join(ROOT, 'build', 'trayTemplate.png')); i.setTemplateImage(true); return i; }
  return nativeImage.createFromPath(path.join(ROOT, 'build', 'tray.png'));
}
function createTray() {
  try { tray = new Tray(trayImage()); } catch (_) { tray = null; return; }
  tray.setToolTip('Concourse');
  tray.on('click', () => { if (!IS_MAC) showWindow(); });
  updateTray();
}
function updateTray() {
  if (!tray) return;
  const now = Date.now();
  const next = M.nextDeparture(allEvents(), now, { boardMin: settings.boardMin });
  if (IS_MAC) {
    let title = '';
    if (settings.menubar && next) {
      const mins = Math.ceil((next.start - now) / 60000);
      if (next.start <= now) title = ` ● ${trim(next.title, 18)}`;
      else if (mins <= 90) title = ` ${mins}m ${trim(next.title, 18)}`;
    }
    tray.setTitle(title, { fontType: 'monospacedDigit' });
  }
  const today = M.departuresFor(allEvents(), now, now, { boardMin: settings.boardMin }).filter(r => !r.allDay && r.end > now && !r.cancelled).slice(0, 6);
  const items = [];
  if (next) {
    items.push({ label: `${next.start <= now ? 'In progress' : 'Next'}: ${trim(next.title, 34)} · ${next.start <= now ? 'now' : M.countdown(next.start, now)}`, enabled: false });
    if (next.online) items.push({ label: 'Join now', accelerator: settings.shortcut || undefined, click: () => join({ eventId: next.id }).catch(e => showError(e)) });
    items.push({ type: 'separator' });
  }
  if (today.length) {
    items.push({ label: 'Today’s departures', enabled: false });
    for (const r of today) items.push({ label: `${fmtTime(r.start)}  ${trim(r.title, 34)}`, click: () => r.online ? join({ eventId: r.id }).catch(e => showError(e)) : (showWindow(), send('go', { view: 'calendar', eventId: r.id })) });
    items.push({ type: 'separator' });
  }
  const unread = unreadCount();
  items.push({ label: unread ? `${unread} unread chat${unread === 1 ? '' : 's'}` : 'No unread chats', click: () => { showWindow(); send('go', { view: 'chats' }); } });
  items.push({ type: 'separator' }, { label: 'Open Concourse', click: showWindow }, { label: 'Quit', click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function showError(e) { showWindow(); send('toast', { tone: 'red', text: e.message }); }

// ───────────────────────────────────────────── window
function createWindow() {
  const b = readJson(path.join(USER, 'window.json'), null);
  win = new BrowserWindow({
    width: (b && b.width) || 1360, height: (b && b.height) || 860, x: b && b.x, y: b && b.y, minWidth: 980, minHeight: 640,
    show: false, backgroundColor: '#050608', title: 'Concourse', icon: ICON,
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden', trafficLightPosition: { x: 16, y: 18 },
    titleBarOverlay: IS_MAC ? undefined : { color: '#050608', symbolColor: '#c9b48a', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, spellcheck: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.on('focus', () => { if (watching) pollWatched(); for (const s of syncs.values()) s.refresh('chats'); });
  const saveBounds = () => { if (!win.isMinimized() && !win.isFullScreen()) writeJson(path.join(USER, 'window.json'), win.getBounds()); };
  win.on('resize', debounce(saveBounds, 500)); win.on('move', debounce(saveBounds, 500));
  win.on('close', (e) => { if (!quitting && settings.closeToTray && tray) { e.preventDefault(); win.hide(); if (IS_MAC && app.dock) app.dock.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:|^msteams:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}
function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (IS_MAC && app.dock) app.dock.show();
  win.show(); win.focus();
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function buildMenu() {
  const go = (v) => () => { showWindow(); send('go', { view: v }); };
  const tpl = [
    ...(IS_MAC ? [{ label: 'Concourse', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { label: 'Quit Concourse', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }] }] : []),
    { label: 'File', submenu: [{ label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => send('cmd', 'new-chat') }, { label: 'New Meeting', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('cmd', 'new-meeting') }, { label: 'New Task', accelerator: 'CmdOrCtrl+T', click: () => send('cmd', 'new-task') }, { type: 'separator' }, { label: 'Join Next Meeting', accelerator: 'CmdOrCtrl+J', click: () => send('cmd', 'join-next') }, ...(IS_MAC ? [] : [{ type: 'separator' }, { label: 'Settings', accelerator: 'Ctrl+,', click: go('settings') }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }])] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Board', accelerator: 'CmdOrCtrl+1', click: go('home') }, { label: 'Chats', accelerator: 'CmdOrCtrl+2', click: go('chats') }, { label: 'Teams', accelerator: 'CmdOrCtrl+3', click: go('teams') },
      { label: 'Timetable', accelerator: 'CmdOrCtrl+4', click: go('calendar') }, { label: 'Manifest', accelerator: 'CmdOrCtrl+5', click: go('tasks') },
      { type: 'separator' }, { label: 'Search…', accelerator: 'CmdOrCtrl+K', click: () => send('cmd', 'palette') }, { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => { for (const s of syncs.values()) s.refresh(); } },
      { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      ...(process.env.CONCOURSE_DEBUG || !app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function registerShortcut() {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  if (!settings.shortcut) return;
  try { globalShortcut.register(settings.shortcut, () => { const n = M.nextDeparture(allEvents(), Date.now(), { boardMin: settings.boardMin }); if (n && n.online) join({ eventId: n.id }).catch(e => showError(e)); else { showWindow(); send('toast', { text: 'No meeting to join right now.' }); } }); } catch (_) {}
}

// ───────────────────────────────────────────── the API the window calls
const api = {
  state: () => snapshot(),
  cached: () => (DEMO ? null : readJson(F.cache, null)),

  // accounts
  async signIn({ loginHint } = {}) {
    const cid = clientId();
    if (!cid) throw new Error('Add your Application (client) ID first.');
    const tok = await auth.signIn({ clientId: cid, tenant: settings.tenant || 'organizations', openUrl: (u) => shell.openExternal(u), loginHint });
    const c = tok.idClaims || {};
    const id = (c.oid || crypto.randomUUID()) + '.' + (c.tid || 'org');
    let acc = accounts.find(a => a.id === id);
    if (!acc) { acc = { id, color: COLORS[accounts.length % COLORS.length] }; accounts.push(acc); }
    Object.assign(acc, { clientId: cid, tenantId: c.tid || 'organizations', oid: c.oid, name: c.name || c.preferred_username || 'Microsoft account', username: c.preferred_username || c.email || '', refreshToken: tok.refreshToken, scopes: auth.BASE_SCOPES.concat((acc.scopes || []).filter(s => auth.CHANNEL_SCOPES.includes(s))), needsSignIn: false });
    tokens.set(acc.id, { accessToken: tok.accessToken, expiresAt: tok.expiresAt });
    saveAccounts(); startSync(acc); push('accounts'); showWindow();
    return publicAccount(acc);
  },
  async enableChannels({ accountId }) {
    const acc = accById(accountId);
    const scopes = auth.BASE_SCOPES.concat(auth.CHANNEL_SCOPES);
    const tok = await auth.signIn({ clientId: acc.clientId, tenant: acc.tenantId, scopes, openUrl: (u) => shell.openExternal(u), loginHint: acc.username, prompt: 'consent' });
    acc.refreshToken = tok.refreshToken; acc.scopes = scopes; tokens.set(acc.id, { accessToken: tok.accessToken, expiresAt: tok.expiresAt });
    saveAccounts(); push('accounts'); showWindow(); return true;
  },
  signOut({ accountId }) {
    stopSync(accountId); tokens.delete(accountId);
    accounts = accounts.filter(a => a.id !== accountId); saveAccounts();
    if (watching && watching.accountId === accountId) watching = null;
    push('all'); updateBadge(); updateTray(); return true;
  },
  setClientId({ clientId: cid, tenant }) {
    settings.clientId = String(cid || '').trim();
    if (tenant !== undefined) settings.tenant = String(tenant || 'organizations').trim() || 'organizations';
    saveSettings(); push('settings'); return publicSettings();
  },
  adminConsentUrl({ accountId } = {}) { const a = accounts.find(x => x.id === accountId); return auth.adminConsentUrl(clientId(), (a && a.tenantId) || 'organizations'); },
  copy({ text }) { clipboard.writeText(String(text || '')); return true; },

  settings: () => publicSettings(),
  setSettings(patch) {
    const before = { ...settings };
    for (const [k, v] of Object.entries(patch || {})) if (k in defaults()) settings[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...settings[k], ...v } : v;
    saveSettings();
    if (before.shortcut !== settings.shortcut) registerShortcut();
    if (before.launchAtLogin !== settings.launchAtLogin) { try { app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, openAsHidden: true, args: ['--hidden'] }); } catch (_) {} }
    push('settings'); updateTray(); scheduleReminders();
    return publicSettings();
  },
  refresh({ part } = {}) { return Promise.all([...syncs.values()].map(s => s.refresh(part))).then(() => true); },

  // chats
  async openChat({ accountId, chatId }) {
    watching = { accountId: accById(accountId).id, chatId }; watchSig = '';
    const msgs = await gFor(accountId).messages(chatId);
    watchSig = JSON.stringify(msgs.map(m => [m.id, m.lastModifiedDateTime, m.deletedDateTime, (m.reactions || []).length]));
    markReadQuiet(watching);
    clearTimeout(watchTimer); watchTimer = setTimeout(pollWatched, 4000);
    return msgs;
  },
  closeChat() { watching = null; clearTimeout(watchTimer); return true; },
  async send({ accountId, chatId, html, importance, mentions }) {
    const extra = {}; if (importance && importance !== 'normal') extra.importance = importance; if (mentions && mentions.length) extra.mentions = mentions;
    const m = await gFor(accountId).sendMessage(chatId, html, extra);
    const s = syncFor(accountId); if (s) s.refresh('chats');
    setTimeout(pollWatched, 300);
    return m;
  },
  async editMessage({ accountId, chatId, messageId, html }) { await gFor(accountId).editMessage(chatId, messageId, html); setTimeout(pollWatched, 300); return true; },
  async deleteMessage({ accountId, chatId, messageId }) { const me = meFor(accountId); await gFor(accountId).deleteMessage(me.id, chatId, messageId); setTimeout(pollWatched, 300); return true; },
  async react({ accountId, chatId, messageId, reaction, on }) { await gFor(accountId).react(chatId, messageId, reaction, on !== false); setTimeout(pollWatched, 300); return true; },
  async markUnread({ accountId, chatId }) {
    const acc = accById(accountId); const me = meFor(acc.id); const s = syncFor(acc.id); const c = s.s.chats.find(x => x.id === chatId);
    if (!c || !c.lastMessagePreview) return false;
    const before = new Date(Date.parse(c.lastMessagePreview.createdDateTime) - 1000).toISOString();
    await graphFor(acc).markUnread(chatId, me.id, acc.tenantId, before);
    c.viewpoint = { ...(c.viewpoint || {}), lastMessageReadDateTime: before }; if (watching && watching.chatId === chatId) watching = null;
    push('chats'); updateBadge(); return true;
  },
  async markRead({ accountId, chatId }) { await markReadQuiet({ accountId: accById(accountId).id, chatId }); return true; },
  async newChat({ accountId, emails, topic, message }) {
    const acc = accById(accountId); const me = meFor(acc.id);
    const c = await graphFor(acc).createChat(me.id, emails, topic);
    if (message) await graphFor(acc).sendMessage(c.id, `<p>${escapeHtml(message)}</p>`);
    await syncFor(acc.id).refresh('chats');
    return { chatId: c.id, accountId: acc.id };
  },
  people({ accountId, q }) { return gFor(accountId).people(q); },
  photo({ accountId, userId }) { return photo(accountId, userId); },
  async hosted({ accountId, url }) { const buf = await gFor(accountId).hostedContent(url); return 'data:image/png;base64,' + buf.toString('base64'); },
  pin({ chatId, on }) { settings.pinned = settings.pinned.filter(x => x !== chatId); if (on) settings.pinned.unshift(chatId); saveSettings(); push('settings'); return true; },
  mute({ chatId, on }) { settings.muted = settings.muted.filter(x => x !== chatId); if (on) settings.muted.push(chatId); saveSettings(); push('settings'); updateBadge(); return true; },

  // teams and channels
  async teams({ accountId, force } = {}) { const s = syncFor(accountId); if (!s.s.teams || force) await s.run('teams', () => s.loadTeams()); if (s.s.errors.teams && !s.s.teams) throw new Error(s.s.errors.teams); return s.s.teams || []; },
  channelMessages({ accountId, teamId, channelId }) { return gFor(accountId).channelMessages(teamId, channelId); },
  postChannel({ accountId, teamId, channelId, html, subject }) { return gFor(accountId).postChannel(teamId, channelId, html, subject); },
  replyChannel({ accountId, teamId, channelId, messageId, html }) { return gFor(accountId).replyChannel(teamId, channelId, messageId, html); },

  // calendar
  async range({ from, to }) {
    let grew = false;
    if (from < calFrom) { calFrom = from; grew = true; }
    if (to > calTo) { calTo = to; grew = true; }
    if (grew) await Promise.all([...syncs.values()].map(s => s.refresh('calendar')));
    return true;
  },
  async rsvp({ accountId, eventId, how, comment }) { await gFor(accountId).rsvp(eventId, how, comment); await syncFor(accountId).refresh('calendar'); return true; },
  async createEvent({ accountId, ...o }) { const e = await gFor(accountId).createEvent(o); await syncFor(accountId).refresh('calendar'); return e; },
  async cancelEvent({ accountId, eventId, comment }) { await gFor(accountId).cancelEvent(eventId, comment); await syncFor(accountId).refresh('calendar'); return true; },
  async deleteEvent({ accountId, eventId }) { await gFor(accountId).deleteEvent(eventId); await syncFor(accountId).refresh('calendar'); return true; },
  join: (o) => join(o || {}),
  openExternal({ url }) { if (/^(https?|mailto|msteams):/i.test(url)) shell.openExternal(url); return true; },

  // tasks: local ones here, Microsoft To Do through Graph
  async addTask(t) {
    const target = t.target || settings.taskTarget;
    if (target && target.startsWith('todo:')) {
      const [, accountId, listId] = target.split(':');
      const r = await gFor(accountId).createTodo(listId, M.toTodo({ ...t, done: false }));
      await syncFor(accountId).refresh('todo'); return { id: 'todo:' + r.id };
    }
    const task = { id: 'local:' + crypto.randomUUID(), source: 'local', title: String(t.title || '').trim(), notes: t.notes || '', due: t.due || null, important: !!t.important, myDay: t.myDay !== false && !t.due, done: false, createdAt: Date.now(), link: t.link || null };
    if (!task.title) throw new Error('A task needs a title.');
    localTasks.unshift(task); saveTasks(); return task;
  },
  async updateTask({ id, patch }) {
    if (id.startsWith('local:')) {
      const t = localTasks.find(x => x.id === id); if (!t) return false;
      Object.assign(t, patch); if ('done' in patch) t.doneAt = patch.done ? Date.now() : null;
      if (patch.due) t.myDay = false;
      saveTasks(); return true;
    }
    const cur = allTodo().find(x => x.id === id); if (!cur) return false;
    const next = { ...cur, ...patch };
    const body = {};
    if ('title' in patch) body.title = next.title;
    if ('notes' in patch) body.body = { content: next.notes || '', contentType: 'text' };
    if ('important' in patch) body.importance = next.important ? 'high' : 'normal';
    if ('done' in patch) body.status = next.done ? 'completed' : 'notStarted';
    if ('due' in patch) body.dueDateTime = M.toTodo(next).dueDateTime;
    await gFor(cur.accountId).updateTodo(cur.listId, cur.remoteId, body);
    // show it straight away, then confirm from Microsoft
    const s = syncFor(cur.accountId); const t = s.s.todo.find(x => x.id === id); if (t) { Object.assign(t, patch); if ('done' in patch) t.doneAt = patch.done ? Date.now() : null; }
    push('todo'); s.refresh('todo'); return true;
  },
  async deleteTask({ id }) {
    if (id.startsWith('local:')) { localTasks = localTasks.filter(x => x.id !== id); saveTasks(); return true; }
    const cur = allTodo().find(x => x.id === id); if (!cur) return false;
    await gFor(cur.accountId).deleteTodo(cur.listId, cur.remoteId);
    const s = syncFor(cur.accountId); s.s.todo = s.s.todo.filter(x => x.id !== id); push('todo'); return true;
  },

  // presence
  async setPresence({ accountId, availability, minutes }) {
    const acc = accById(accountId); const me = meFor(acc.id);
    await graphFor(acc).setPreferredPresence(me.id, availability, null, minutes ? `PT${Math.round(minutes / 60)}H${minutes % 60}M` : undefined);
    await syncFor(acc.id).refresh('me'); return true;
  },
  async setStatusMessage({ accountId, text, until }) { const acc = accById(accountId); const me = meFor(acc.id); await graphFor(acc).setStatusMessage(me.id, text, until); await syncFor(acc.id).refresh('me'); return true; },
  docketAvailable: async () => { try { const c = link.docket || (link.docket = suitelink.connect('docket')); await withTimeout(c.call('status'), 1200); return true; } catch (_) { return false; } },
  version: () => app.getVersion(),
  demo({ on }) { const args = process.argv.slice(1).filter(a => a !== '--demo' && a !== '--hidden'); if (on) args.push('--demo'); app.relaunch({ args }); quitting = true; app.exit(0); return true; },
  async meetNow({ accountId, chatId, title }) {
    const acc = accById(accountId); const start = Date.now(); const s = syncFor(acc.id); const c = s.s.chats.find(x => x.id === chatId);
    const me = meFor(acc.id);
    const attendees = c ? (c.members || []).filter(m => m.userId !== me.id && m.email).map(m => ({ email: m.email, name: m.displayName })) : [];
    const ev = await graphFor(acc).createEvent({ title: title || (c && M.chatTitle(c, me.id)) || 'Meet now', start, end: start + 30 * 60000, attendees, teams: true });
    const url = (ev.onlineMeeting && ev.onlineMeeting.joinUrl) || '';
    if (chatId && url) await graphFor(acc).sendMessage(chatId, `<p>📞 I started a meeting: <a href="${escapeHtml(url)}">Join now</a></p>`);
    s.refresh('calendar');
    if (url) await join({ url, title: ev.subject });
    return { url };
  },
};
function allTodo() { const o = []; for (const s of syncs.values()) o.push(...s.s.todo); return o; }

ipcMain.handle('call', async (_e, name, arg) => {
  const fn = api[name];
  if (!fn) throw new Error('Unknown call ' + name);
  try { return await fn(arg); }
  catch (e) { throw new Error(e && e.message ? e.message : String(e)); }
});

// ───────────────────────────────────────────── start
app.on('second-instance', () => showWindow());
app.on('activate', () => showWindow());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (_) {} try { link.server && link.server.close(); } catch (_) {} });
app.on('window-all-closed', () => { if (!tray || !settings.closeToTray) app.quit(); });

app.whenReady().then(() => {
  loadAccounts();
  buildMenu(); createWindow(); createTray(); registerShortcut();
  for (const a of accounts) startSync(a);
  if (!DEMO) startLink();
  checkReminders();
  powerMonitor.on('resume', () => { for (const s of syncs.values()) s.refresh(); });
  if (process.env.CONCOURSE_SCREENSHOT) require('../test/e2e/shoot')(win, send, api).catch(e => { console.error(e); app.exit(1); });
});

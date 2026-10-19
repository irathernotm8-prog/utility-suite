// Slate — optional bank connections through SimpleFIN Bridge (https://bridge.simplefin.org).
// Nothing here runs unless you paste a Setup Token. Then:
// • The token is claimed once for an Access URL. That URL is the only secret; it's encrypted with the
//   system keychain (safeStorage) and never shown to the window, put in backups, or sent anywhere but its own host.
// • Balances come from GET /accounts?balances-only=1 — no transactions are downloaded.
// • SimpleFIN allows about 24 requests a day per connection, so Slate refreshes at most every few hours on its own
//   and caps manual refreshes well under that.
const { ipcMain, safeStorage, shell } = require('electron');
const crypto = require('crypto');
const { typeFromName } = require('./extract');

let ctx = null; // { getStore, saveStore, getWin, toast }
const BRIDGE = 'https://bridge.simplefin.org';
const AUTO_EVERY = 6 * 3600e3;       // refresh on launch when the last one is older than this
const MANUAL_GAP = 10 * 60e3;        // and not more often than this when you press Update now
const DAILY_CAP = 16;                // stay well below SimpleFIN's ~24/day limit
const allowHttp = () => process.env.SLATE_SIMPLEFIN_ALLOW_HTTP === '1'; // tests only (local mock server)

/* ---------- secrets ---------- */
const enc = (plain) => (plain ? (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(plain).toString('base64') : 'raw:' + Buffer.from(plain).toString('base64')) : '');
const dec = (v) => {
  if (!v) return '';
  try { if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString(); } catch {}
  return '';
};
const cfg = () => ctx.getStore().simplefin || null;
const connected = () => !!(cfg() && dec(cfg().access));
const send = (ch, d) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); };
const recent = () => (cfg()?.requests || []).filter(t => Date.now() - t < 24 * 3600e3);

// What the window may see: never the Access URL
function publicState() {
  const c = cfg();
  if (!c) return { connected: false, accounts: [] };
  return {
    connected: connected(), host: c.host || '', addedAt: c.addedAt || null, lastSync: c.lastSync || null,
    accounts: c.accounts || [], errors: c.errors || [], warnings: c.warnings || [], needsReconnect: !!c.needsReconnect,
    requestsToday: recent().length, dailyCap: DAILY_CAP
  };
}

/* ---------- protocol ---------- */
const okScheme = (u) => u.protocol === 'https:' || (allowHttp() && u.protocol === 'http:');
function decodeToken(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, '');
  if (!t) throw new Error('Paste the Setup Token from SimpleFIN Bridge');
  // Someone may paste an Access URL directly (https://user:pass@host/simplefin)
  if (/^https?:\/\//i.test(t)) return { access: t };
  let s = t.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const claim = Buffer.from(s, 'base64').toString('utf8').trim();
  if (!/^https?:\/\//i.test(claim)) throw new Error('That doesn’t look like a SimpleFIN Setup Token. Copy the whole token from Bridge and try again.');
  return { claim };
}
function parseAccess(accessUrl) {
  const u = new URL(accessUrl);
  if (!okScheme(u)) throw new Error('SimpleFIN connections must use https');
  if (!u.username) throw new Error('That Access URL is missing its credentials');
  const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
  u.username = ''; u.password = '';
  return { base: u.toString().replace(/\/+$/, ''), host: u.host, auth };
}
async function claimToken(claimUrl) {
  const u = new URL(claimUrl);
  if (!okScheme(u)) throw new Error('SimpleFIN tokens must use https');
  const res = await fetch(u, { method: 'POST', headers: { 'Content-Length': '0' }, signal: AbortSignal.timeout(30000) });
  if (res.status === 403) throw new Error('That Setup Token was already used or has expired. Make a new one in Bridge (My Account → Apps → New connection) and paste it here.');
  if (!res.ok) throw new Error(`SimpleFIN didn’t accept the token (${res.status})`);
  const access = (await res.text()).trim();
  if (!/^https?:\/\//i.test(access)) throw new Error('SimpleFIN returned something unexpected. Try a new Setup Token.');
  return access;
}
async function fetchAccounts() {
  const { base, auth } = parseAccess(dec(cfg().access));
  const c = cfg();
  c.requests = recent().concat(Date.now());
  const res = await fetch(`${base}/accounts?balances-only=1`, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
  if (res.status === 403 || res.status === 401) { c.needsReconnect = true; throw new Error('SimpleFIN says this connection was turned off. Make a new Setup Token in Bridge and connect again.'); }
  if (res.status === 402) throw new Error('Your SimpleFIN Bridge subscription needs attention (payment required).');
  if (!res.ok) throw new Error(`SimpleFIN error ${res.status}`);
  return res.json();
}

/* ---------- mapping SimpleFIN accounts onto Slate accounts ---------- */
const LAST4 = /(?:\(\s*(?:\.{2,3}|…|x+|\*+)\s*(\d{4})\s*\)|(?:\.{3}|…|\bx{2,}|\*{2,}|ending in\s*|#)\s*(\d{4})\b)/i;
const last4Of = (n = '') => { const m = String(n).match(LAST4); return m ? (m[1] || m[2]) : ''; };
function cleanName(n = '') {
  let s = String(n).replace(LAST4, '').replace(/[®™℠]/g, '').replace(/\s*[-–·]\s*$/, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) s = s.replace(/\s*(visa signature|visa infinite|world elite mastercard|world mastercard|mastercard|visa|signature|credit card account)\s*$/i, '').trim();
  return s.replace(/\b([A-Z])([A-Z]{3,})\b/g, (m, a, b) => a + b.toLowerCase()) || String(n).trim() || 'Account';
}
const isDebt = (t) => ['credit', 'loan', 'mortgage', 'student-loan', 'auto-loan'].includes(t);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const firstWord = (s = '') => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').find(Boolean) || '';
const sameBank = (a = '', b = '') => !a || !b || a.toLowerCase().includes(firstWord(b)) || b.toLowerCase().includes(firstWord(a));

function institutionOf(sa, data) {
  if (sa.org?.name) return sa.org.name;
  const conn = (data.connections || []).find(c => c.conn_id === sa.conn_id);
  return conn?.name || conn?.org_name || sa.org?.domain || '';
}

function apply(data) {
  const store = ctx.getStore();
  const report = { balances: 0, created: [], linked: [] };
  const seen = [];
  for (const sa of data.accounts || []) {
    if (!sa || !sa.id) continue;
    const institution = institutionOf(sa, data);
    const last4 = last4Of(sa.name);
    const bal = num(sa.balance);
    let type = typeFromName(sa.name || '');
    // a name with no clue defaults to checking; a negative balance there means money owed (usually a card)
    if (bal != null && bal < 0 && type === 'checking' && !/checking/i.test(sa.name || '')) type = 'credit';
    let acc = store.accounts.find(a => a.simplefin?.id === sa.id);
    if (!acc) {
      // same bank + same last 4 → an account you already track
      acc = last4 && store.accounts.find(a => !a.simplefin && a.last4 === last4 && sameBank(a.institution, institution));
      if (acc) report.linked.push(acc.name);
      else {
        acc = { id: crypto.randomUUID(), name: cleanName(sa.name), institution, type: type || 'other', last4, balances: [], inPlanner: !isDebt(type) && type !== 'checking' };
        store.accounts.push(acc);
        report.created.push(acc);
      }
    }
    acc.simplefin = { id: sa.id, name: sa.name || '', currency: sa.currency || 'USD' };
    if (!acc.last4 && last4) acc.last4 = last4;
    if (!acc.institution && institution) acc.institution = institution;
    if (bal != null) {
      const when = sa['balance-date'] ? new Date(Number(sa['balance-date']) * 1000) : new Date();
      const date = ymd(isNaN(when) || when > new Date() ? new Date() : when);
      const amount = Math.round((isDebt(acc.type) ? Math.abs(bal) : bal) * 100) / 100;
      acc.balances = (acc.balances || []).filter(x => !(x.source === 'simplefin' && x.date === date));
      acc.balances.push({ date, amount, source: 'simplefin' });
      acc.balances.sort((a, b) => (a.date < b.date ? -1 : 1));
      report.balances++;
    }
    seen.push({ id: sa.id, slateId: acc.id, name: acc.name, institution: acc.institution, last4: acc.last4 || '', type: acc.type });
  }
  cfg().accounts = seen;
  return report;
}

async function sync({ manual = false, force = false } = {}) {
  if (!connected()) return { skipped: true, reason: 'not-connected' };
  const c = cfg();
  if (!force && manual && c.lastSync && Date.now() - c.lastSync < MANUAL_GAP) return { skipped: true, reason: 'too-soon', next: c.lastSync + MANUAL_GAP };
  if (!force && recent().length >= DAILY_CAP) return { skipped: true, reason: 'daily-cap' };
  let report;
  try {
    const data = await fetchAccounts();
    c.errors = Array.isArray(data.errlist) ? data.errlist.map(e => (typeof e === 'string' ? e : e.msg || e.message || JSON.stringify(e))) : [];
    c.warnings = Array.isArray(data.errors) ? data.errors.map(String) : [];
    report = apply(data);
    c.lastSync = Date.now();
    c.needsReconnect = false;
  } catch (e) {
    ctx.saveStore(true);
    send('simplefin:state', publicState());
    throw e;
  }
  ctx.saveStore(true);
  send('store:accounts', ctx.getStore().accounts);
  send('simplefin:state', publicState());
  return { balances: report.balances, linked: report.linked, errors: c.errors, warnings: c.warnings,
    created: report.created.map(a => ({ id: a.id, name: a.name, type: a.type, last4: a.last4, institution: a.institution })) };
}

async function connect(token) {
  const t = decodeToken(token);
  const access = t.access || await claimToken(t.claim);
  const { host } = parseAccess(access); // validates
  const store = ctx.getStore();
  const prev = store.simplefin;
  store.simplefin = { access: enc(access), host, addedAt: Date.now(), lastSync: null, requests: prev?.requests || [], accounts: [], errors: [], warnings: [] };
  ctx.saveStore(true);
  try { return { ok: true, ...(await sync({ force: true })) }; }
  catch (e) { return { ok: true, syncError: e.message }; }
}

function disconnect() {
  const store = ctx.getStore();
  delete store.simplefin;
  // keep the accounts and their history; they just stop updating
  for (const a of store.accounts) delete a.simplefin;
  ctx.saveStore(true);
  send('store:accounts', store.accounts);
  return publicState();
}

function register(c) {
  ctx = c;
  ipcMain.handle('simplefin:state', () => publicState());
  ipcMain.handle('simplefin:connect', (_e, token) => connect(token));
  ipcMain.handle('simplefin:sync', (_e, o) => sync({ manual: true, ...(o || {}), force: false }));
  ipcMain.handle('simplefin:disconnect', () => disconnect());
  ipcMain.handle('simplefin:open-bridge', (_e, where) => shell.openExternal(BRIDGE + (where === 'apps' ? '/my-account' : '')));
  // the only thing Slate does on its own over the network, and only after you've connected
  setTimeout(() => { if (connected() && !cfg().needsReconnect && Date.now() - (cfg().lastSync || 0) > AUTO_EVERY) sync().catch(() => {}); }, 4000);
}

module.exports = { register, sync, publicState, last4Of, cleanName, decodeToken, parseAccess };

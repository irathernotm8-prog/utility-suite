// Vantage — password vault (from Relay; main process only, plaintext never touches disk).
// Adds autofill for web pages, save/update prompts, 2FA codes and importing Relay's vault.
// Encryption: AES-256-GCM with a key derived from the master password via scrypt.
// Touch ID: the derived key is additionally wrapped with the macOS keychain (safeStorage)
// and only released after a successful Touch ID prompt.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage, systemPreferences, clipboard, dialog, shell, powerMonitor } = require('electron');

const KDF = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const AUTO_LOCK_MS = 10 * 60 * 1000;

let key = null;          // Buffer while unlocked
let entries = [];        // decrypted entries while unlocked
let lockTimer = null;
let lastImportPath = null;
let notify = () => {};

const file = () => path.join(app.getPath('userData'), 'vantage-vault.json');
function readFile() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; } }
function writeFile(obj) { fs.writeFileSync(file(), JSON.stringify(obj), { mode: 0o600 }); }

function derive(password, salt) {
  return new Promise((res, rej) => crypto.scrypt(password.normalize('NFKC'), salt, 32, KDF, (e, k) => e ? rej(e) : res(k)));
}
function seal(k, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function open(k, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
}

function persist() {
  const f = readFile();
  f.data = seal(key, entries);
  f.count = entries.length;
  f.updatedAt = Date.now();
  writeFile(f);
}
function touch() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => lock('timeout'), AUTO_LOCK_MS);
}
function lock(reason = 'manual') {
  if (key) key.fill(0);
  key = null; entries = [];
  clearTimeout(lockTimer);
  notify('vault:locked', reason);
  return status();
}
function requireUnlocked() {
  if (!key) throw new Error('Vault is locked');
  touch();
}

function touchIdAvailable() {
  try { return process.platform === 'darwin' && systemPreferences.canPromptTouchID() && safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function status() {
  const f = readFile();
  return {
    exists: !!f,
    unlocked: !!key,
    touchIdAvailable: touchIdAvailable(),
    touchIdEnabled: !!(f && f.touchKey),
    count: key ? entries.length : (f?.count ?? null)
  };
}

/* ---------- strength & hygiene ---------- */
const COMMON = /^(password|passw0rd|123456|12345678|qwerty|letmein|welcome|iloveyou|admin|abc123|monkey|dragon|football|baseball|111111|000000)/i;
function strength(pw = '') {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
  let bits = pw.length * Math.log2(Math.max(pool, 2));
  if (COMMON.test(pw)) bits = Math.min(bits, 20);
  if (/(.)\1{2,}/.test(pw)) bits -= 10;
  return bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4; // 1 weak … 4 excellent
}
function hostOf(url) {
  try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function baseDomain(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const sld = parts[parts.length - 2];
  if (/^(co|com|org|net|ac|gov|edu)$/.test(sld) && parts[parts.length - 1].length === 2) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
// Google/Microsoft sign-in hosts map to the services people save passwords under
const DOMAIN_ALIASES = { 'live.com': ['outlook.com', 'hotmail.com', 'microsoft.com', 'live.com', 'microsoftonline.com'], 'microsoftonline.com': ['microsoft.com', 'office.com', 'microsoftonline.com', 'live.com'], 'google.com': ['google.com', 'gmail.com', 'youtube.com'], 'yahoo.com': ['yahoo.com'] };

function publicList() {
  const counts = {};
  entries.forEach(e => { if (e.password) counts[e.password] = (counts[e.password] || 0) + 1; });
  return entries.map(e => ({
    id: e.id, name: e.name, url: e.url, host: hostOf(e.url), username: e.username, notes: e.notes || '',
    favorite: !!e.favorite, createdAt: e.createdAt, updatedAt: e.updatedAt,
    hasPassword: !!e.password, hasTotp: !!e.totp, strength: strength(e.password), reused: !!(e.password && counts[e.password] > 1)
  }));
}

/* ---------- CSV import (Google Password Manager, Chrome, 1Password, Bitwarden, LastPass…) ---------- */
function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
function mapRows(rows) {
  const header = rows[0].map(h => h.trim().toLowerCase());
  const find = (...names) => header.findIndex(h => names.includes(h));
  const iName = find('name', 'title', 'account', 'site');
  const iUrl = find('url', 'login_uri', 'website', 'web site', 'login url', 'origin_url');
  const iUser = find('username', 'login_username', 'login', 'user', 'email', 'username_value');
  const iPass = find('password', 'login_password', 'password_value');
  const iNote = find('note', 'notes', 'extra', 'comments');
  if (iPass < 0) throw new Error('This file doesn’t look like a password export (no “password” column).');
  return rows.slice(1).map(r => ({
    name: (iName >= 0 ? r[iName] : '') || hostOf(iUrl >= 0 ? r[iUrl] : '') || 'Untitled',
    url: iUrl >= 0 ? (r[iUrl] || '').trim() : '',
    username: iUser >= 0 ? (r[iUser] || '').trim() : '',
    password: r[iPass] || '',
    notes: iNote >= 0 ? (r[iNote] || '') : ''
  })).filter(e => e.password || e.username);
}

function register(ipcMain, getWin, broadcast) {
  notify = broadcast || ((ch, data) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); });
  powerMonitor.on('lock-screen', () => key && lock('screen'));
  powerMonitor.on('suspend', () => key && lock('sleep'));

  ipcMain.handle('vault:status', () => status());

  ipcMain.handle('vault:create', async (_e, password) => {
    if (readFile()) throw new Error('A vault already exists');
    if (!password || password.length < 8) throw new Error('Use at least 8 characters for your master password');
    const salt = crypto.randomBytes(16);
    key = await derive(password, salt);
    entries = [];
    writeFile({ v: 1, kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64') }, data: seal(key, entries), createdAt: Date.now() });
    touch();
    return status();
  });

  ipcMain.handle('vault:unlock', async (_e, password) => {
    const f = readFile();
    if (!f) throw new Error('No vault yet');
    const k = await derive(password || '', Buffer.from(f.kdf.salt, 'base64'));
    try { entries = open(k, f.data); } catch { throw new Error('That master password isn’t right'); }
    key = k; touch();
    return status();
  });

  ipcMain.handle('vault:unlock-touchid', async () => {
    const f = readFile();
    if (!f?.touchKey) throw new Error('Touch ID isn’t set up for this vault');
    await systemPreferences.promptTouchID('unlock your Vantage password vault');
    const k = Buffer.from(safeStorage.decryptString(Buffer.from(f.touchKey, 'base64')), 'base64');
    try { entries = open(k, f.data); } catch { throw new Error('Touch ID key is out of date — unlock with your master password'); }
    key = k; touch();
    return status();
  });

  ipcMain.handle('vault:touchid', async (_e, enable) => {
    requireUnlocked();
    const f = readFile();
    if (enable) {
      if (!touchIdAvailable()) throw new Error('Touch ID isn’t available on this Mac');
      await systemPreferences.promptTouchID('turn on Touch ID for your Vantage vault');
      f.touchKey = safeStorage.encryptString(key.toString('base64')).toString('base64');
    } else delete f.touchKey;
    writeFile(f);
    return status();
  });

  ipcMain.handle('vault:change-password', async (_e, { current, next }) => {
    requireUnlocked();
    const f = readFile();
    const k = await derive(current || '', Buffer.from(f.kdf.salt, 'base64'));
    if (!crypto.timingSafeEqual(k, key)) throw new Error('Current master password isn’t right');
    if (!next || next.length < 8) throw new Error('Use at least 8 characters');
    const salt = crypto.randomBytes(16);
    key = await derive(next, salt);
    f.kdf.salt = salt.toString('base64');
    f.data = seal(key, entries);
    if (f.touchKey) f.touchKey = safeStorage.encryptString(key.toString('base64')).toString('base64');
    writeFile(f);
    return status();
  });

  ipcMain.handle('vault:lock', () => lock('manual'));
  ipcMain.handle('vault:list', () => { requireUnlocked(); return publicList(); });

  ipcMain.handle('vault:reveal', (_e, id) => { requireUnlocked(); return entries.find(e => e.id === id)?.password || ''; });

  ipcMain.handle('vault:copy', (_e, { id, field }) => {
    requireUnlocked();
    const e = entries.find(x => x.id === id);
    if (!e) return false;
    const value = field === 'password' ? e.password : e.username;
    clipboard.writeText(value || '');
    if (field === 'password') setTimeout(() => { if (clipboard.readText() === value) clipboard.clear(); }, 30000);
    return true;
  });

  ipcMain.handle('vault:save', (_e, entry) => {
    requireUnlocked();
    const now = Date.now();
    const i = entries.findIndex(x => x.id === entry.id);
    if (i >= 0) {
      const prev = entries[i];
      entries[i] = { ...prev, ...entry, password: entry.password === undefined ? prev.password : entry.password, updatedAt: now };
    } else {
      entries.push({ id: crypto.randomUUID(), name: '', url: '', username: '', password: '', notes: '', ...entry, createdAt: now, updatedAt: now });
    }
    persist();
    return publicList();
  });

  ipcMain.handle('vault:delete', (_e, id) => {
    requireUnlocked();
    entries = entries.filter(e => e.id !== id);
    persist();
    return publicList();
  });

  ipcMain.handle('vault:import', async () => {
    requireUnlocked();
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose your password export (.csv)', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const rows = parseCSV(fs.readFileSync(p, 'utf8'));
    if (rows.length < 2) throw new Error('That file is empty');
    const incoming = mapRows(rows);
    const seen = new Set(entries.map(e => `${hostOf(e.url)}|${e.username}|${e.password}`));
    let added = 0, skipped = 0;
    const now = Date.now();
    for (const e of incoming) {
      const sig = `${hostOf(e.url)}|${e.username}|${e.password}`;
      if (seen.has(sig)) { skipped++; continue; }
      seen.add(sig);
      entries.push({ id: crypto.randomUUID(), ...e, createdAt: now, updatedAt: now, source: 'import' });
      added++;
    }
    persist();
    lastImportPath = p;
    return { added, skipped, file: path.basename(p), list: publicList() };
  });

  ipcMain.handle('vault:trash-import', async () => {
    if (!lastImportPath) return false;
    await shell.trashItem(lastImportPath);
    lastImportPath = null;
    return true;
  });

  ipcMain.handle('vault:export', async () => {
    requireUnlocked();
    const r = await dialog.showSaveDialog(getWin(), { title: 'Export passwords (unencrypted CSV)', defaultPath: 'Vantage Passwords.csv' });
    if (r.canceled || !r.filePath) return false;
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = ['name,url,username,password,note', ...entries.map(e => [e.name, e.url, e.username, e.password, e.notes].map(q).join(','))].join('\n');
    fs.writeFileSync(r.filePath, csv, { mode: 0o600 });
    return true;
  });

  // Credentials that match the site an account page is on (for "Fill from Vault")
  ipcMain.handle('vault:matches', (_e, url) => {
    requireUnlocked();
    const host = hostOf(url);
    const base = baseDomain(host);
    const wanted = new Set([base, ...(DOMAIN_ALIASES[base] || [])]);
    return publicList().filter(e => e.host && (wanted.has(baseDomain(e.host)) || e.host === host));
  });
  // Types the saved username/password straight into the sign-in page (password never goes through the UI)
  ipcMain.handle('vault:fill', async (_e, { id, wcId }) => {
    requireUnlocked();
    const e = entries.find(x => x.id === id);
    const wc = require('electron').webContents.fromId(wcId);
    if (!e || !wc) return { ok: false };
    const js = `(() => {
      const vis = (el) => el && el.offsetParent !== null && !el.disabled && el.type !== 'hidden';
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const pw = [...document.querySelectorAll('input[type=password]')].find(vis);
      const user = [...document.querySelectorAll('input[type=email], input[autocomplete=username], input[name=identifier], input[name=loginfmt], input[name=username], input[name=login], input[id*=user i], input[name*=email i], input[type=text][name*=login i]')].find(vis);
      let filled = [];
      if (user && ${JSON.stringify(!!e.username)}) { set(user, ${JSON.stringify(e.username || '')}); filled.push('username'); }
      if (pw) { set(pw, ${JSON.stringify(e.password || '')}); filled.push('password'); pw.focus(); }
      else if (user) user.focus();
      return filled;
    })()`;
    const filled = await wc.executeJavaScript(js).catch(() => []);
    return { ok: filled.length > 0, filled };
  });
}


/* ---------- 2FA codes (TOTP, RFC 6238) ---------- */
function base32(str) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = '', out = [];
  for (const c of clean) { const v = A.indexOf(c); if (v < 0) throw new Error('That 2FA key isn’t valid'); bits += v.toString(2).padStart(5, '0'); }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function parseTotp(v) {
  v = String(v || '').trim();
  if (/^otpauth:/i.test(v)) {
    const u = new URL(v);
    return { secret: u.searchParams.get('secret') || '', digits: +(u.searchParams.get('digits') || 6), period: +(u.searchParams.get('period') || 30), algo: (u.searchParams.get('algorithm') || 'SHA1').toLowerCase() };
  }
  return { secret: v, digits: 6, period: 30, algo: 'sha1' };
}
function totp(v, now = Date.now()) {
  const t = parseTotp(v);
  const counter = Math.floor(now / 1000 / t.period);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(t.algo === 'sha256' ? 'sha256' : t.algo === 'sha512' ? 'sha512' : 'sha1', base32(t.secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 10 ** t.digits;
  return { code: String(n).padStart(t.digits, '0'), left: t.period - Math.floor(now / 1000) % t.period, period: t.period };
}

/* ---------- autofill for web pages ---------- */
// Pages only ever see names and usernames until you pick an entry; the password is handed to that page
// only if the entry belongs to the site the page is on.
function matchesFor(url) {
  const host = hostOf(url);
  if (!host) return [];
  const base = baseDomain(host);
  const wanted = new Set([base, ...(DOMAIN_ALIASES[base] || [])]);
  return entries.filter(e => { const h = hostOf(e.url); return h && (h === host || wanted.has(baseDomain(h))); });
}
const pendingSaves = new Map();   // token -> { url, host, username, password, id? }
const recentUsernames = new Map(); // host -> { username, at } (for sign-ins split over two pages)
let settingsRef = () => ({ offerToSave: true, autofill: true, never: [] });
let settingsSave = () => {};

function registerAutofill(ipcMain, { getSettings, saveSettings, offerSave, askUnlock }) {
  settingsRef = getSettings; settingsSave = saveSettings || settingsSave;
  ipcMain.handle('af:query', (event, { kind }) => {
    const s = settingsRef();
    if (s.autofill === false) return { state: 'off' };
    const url = event.senderFrame?.url || event.sender.getURL();
    const f = readFile();
    if (!f) return { state: 'none' };
    if (!key) return { state: 'locked', count: f.count || 0 };
    touch();
    const list = matchesFor(url).map(e => ({ id: e.id, name: e.name || hostOf(e.url), username: e.username, hasTotp: !!e.totp }));
    return { state: 'ok', list, host: hostOf(url), kind };
  });
  ipcMain.handle('af:fill', (event, { id }) => {
    if (!key) return null;
    const url = event.senderFrame?.url || event.sender.getURL();
    const e = matchesFor(url).find(x => x.id === id);
    if (!e) return null;
    touch();
    return { username: e.username || '', password: e.password || '' };
  });
  ipcMain.handle('af:totp', (event, { id }) => {
    if (!key) return null;
    const url = event.senderFrame?.url || event.sender.getURL();
    const e = matchesFor(url).find(x => x.id === id && x.totp);
    if (!e) return null;
    try { return totp(e.totp); } catch { return null; }
  });
  ipcMain.handle('af:unlock', (event) => { askUnlock(event.sender); return true; });
  ipcMain.on('af:username', (event, username) => {
    const host = hostOf(event.senderFrame?.url || event.sender.getURL());
    if (host && username) recentUsernames.set(host, { username: String(username).slice(0, 200), at: Date.now() });
  });
  ipcMain.on('af:captured', (event, { username, password }) => {
    const s = settingsRef();
    if (s.offerToSave === false || !password || typeof password !== 'string' || password.length > 500) return;
    const url = event.senderFrame?.url || event.sender.getURL();
    const host = hostOf(url);
    if (!host || (s.never || []).includes(host)) return;
    if (!username) { const r = recentUsernames.get(host); if (r && Date.now() - r.at < 10 * 60000) username = r.username; }
    let existing = null;
    if (key) {
      const same = matchesFor(url).filter(e => (e.username || '') === (username || ''));
      if (same.some(e => e.password === password)) return;
      existing = same[0] || null;
    }
    const token = crypto.randomUUID();
    pendingSaves.set(token, { url, host, username: username || '', password, id: existing?.id || null });
    setTimeout(() => pendingSaves.delete(token), 10 * 60000);
    offerSave(event.sender, { token, host, username: username || '', update: !!existing, locked: !key });
  });
  ipcMain.handle('vault:save-captured', (_e, { token, never }) => {
    const p = pendingSaves.get(token);
    if (!p) return { ok: false };
    pendingSaves.delete(token);
    if (never) { const s = settingsRef(); s.never = [...new Set([...(s.never || []), p.host])]; settingsSave(); return { ok: true, never: true }; }
    requireUnlocked();
    const now = Date.now();
    // re-check now that the vault is open: an entry for this username may exist
    const existing = p.id ? entries.find(e => e.id === p.id) : matchesFor(p.url).find(e => (e.username || '') === p.username);
    if (existing) { existing.password = p.password; existing.updatedAt = now; }
    else entries.push({ id: crypto.randomUUID(), name: p.host, url: new URL(p.url).origin, username: p.username, password: p.password, notes: '', createdAt: now, updatedAt: now, source: 'saved' });
    persist();
    return { ok: true, updated: !!existing };
  });
  ipcMain.handle('vault:totp', (_e, id) => { requireUnlocked(); const e = entries.find(x => x.id === id); if (!e?.totp) return null; try { return totp(e.totp); } catch (err) { return { error: err.message }; } });
  ipcMain.handle('vault:get-totp-secret', (_e, id) => { requireUnlocked(); return entries.find(x => x.id === id)?.totp || ''; });
  ipcMain.handle('vault:status-detail', () => status());

  // Bring over Relay's vault: unlocks it with Relay's master password and merges the entries.
  ipcMain.handle('vault:import-relay', async (_e, password) => {
    requireUnlocked();
    const p = path.join(app.getPath('appData'), 'Relay', 'relay-vault.json');
    let f;
    try { f = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new Error('No Relay vault was found on this computer'); }
    const salt = Buffer.from(f.kdf.salt, 'base64');
    const k = await new Promise((res, rej) => crypto.scrypt(String(password || '').normalize('NFKC'), salt, 32, { N: f.kdf.N, r: f.kdf.r, p: f.kdf.p, maxmem: 256 * 1024 * 1024 }, (e, kk) => e ? rej(e) : res(kk)));
    let incoming;
    try { incoming = open(k, f.data); } catch { throw new Error('That isn’t Relay’s master password'); }
    const seen = new Set(entries.map(e => `${hostOf(e.url)}|${e.username}|${e.password}`));
    let added = 0, skipped = 0;
    for (const e of incoming) {
      const sig = `${hostOf(e.url)}|${e.username}|${e.password}`;
      if (seen.has(sig)) { skipped++; continue; }
      seen.add(sig); entries.push({ ...e, id: crypto.randomUUID(), source: 'relay' }); added++;
    }
    persist();
    return { added, skipped, list: publicList() };
  });
  ipcMain.handle('vault:relay-exists', () => fs.existsSync(path.join(app.getPath('appData'), 'Relay', 'relay-vault.json')));
}

module.exports = { register, registerAutofill, lock, isUnlocked: () => !!key, totp, _test: { totp, base32, parseCSV, mapRows, strength } };

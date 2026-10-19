// Relay — password vault (main process only; plaintext never touches disk)
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

const file = () => path.join(app.getPath('userData'), 'relay-vault.json');
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
    hasPassword: !!e.password, strength: strength(e.password), reused: !!(e.password && counts[e.password] > 1)
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

function register(ipcMain, getWin) {
  notify = (ch, data) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
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
    await systemPreferences.promptTouchID('unlock your Relay password vault');
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
      await systemPreferences.promptTouchID('turn on Touch ID for your Relay vault');
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
    const r = await dialog.showSaveDialog(getWin(), { title: 'Export passwords (unencrypted CSV)', defaultPath: 'Relay Passwords.csv' });
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

module.exports = { register, lock };

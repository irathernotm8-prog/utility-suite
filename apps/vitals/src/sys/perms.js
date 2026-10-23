// Privacy permissions: which apps can use the camera, microphone, screen, files, contacts…
// Mac reads the TCC databases (needs Full Disk Access for Vitals). Windows reads the ConsentStore in the registry.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, out, runAdmin, isMac, isWin } = require('./run');
const P = require('./parse');

const USER_DB = path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db');
const SYS_DB = '/Library/Application Support/com.apple.TCC/TCC.db';

async function readTcc(db, source) {
  const q1 = "SELECT service, client, client_type, auth_value, last_modified, indirect_object_identifier FROM access;";
  let r = await run('sqlite3', ['-readonly', '-separator', '|', db, q1], { timeout: 8000 });
  if (!r.ok && /no such column/i.test(r.stderr)) r = await run('sqlite3', ['-readonly', '-separator', '|', db, "SELECT service, client, client_type, allowed*2, last_modified, '' FROM access;"], { timeout: 8000 });
  if (!r.ok) return { ok: false, error: r.stderr || r.error };
  return { ok: true, rows: P.parseTccRows(r.stdout, source) };
}

async function macList() {
  const u = await readTcc(USER_DB, 'user');
  if (!u.ok) return { needsAccess: true, rows: [], error: /authorization denied|unable to open/i.test(u.error || '') ? 'full-disk-access' : u.error };
  const s = await readTcc(SYS_DB, 'system');
  return { needsAccess: false, rows: [...u.rows, ...(s.ok ? s.rows : [])], partial: !s.ok };
}

async function macRevoke(row) {
  const svc = P.TCC[row.service] && P.TCC[row.service].reset; if (!svc) throw new Error('Unknown permission');
  if (!/^[\w.-]+$/.test(row.client)) throw new Error('macOS can only reset this for apps with a bundle ID. Use System Settings for this one.');
  let r = await run('tccutil', ['reset', svc, row.client], { timeout: 10000 });
  if (!r.ok && row.source === 'system') r = await runAdmin(`tccutil reset ${svc} ${row.client}`, { prompt: `Vitals wants to remove ${row.label} access for ${row.client}.` });
  if (!r.ok) throw new Error((r.stderr || 'macOS refused').trim());
  return { ok: true };
}

const CONSENT = 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';
async function winList() {
  const [cu, lm] = await Promise.all([out('reg', ['query', 'HKCU\\' + CONSENT, '/s'], { timeout: 20000 }), out('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore', '/s'], { timeout: 20000 })]);
  const user = P.parseConsentStore(P.parseRegQuery(cu), 'HKCU');
  const machine = P.parseConsentStore(P.parseRegQuery(lm), 'HKLM').filter((r) => r.global);
  return { needsAccess: false, rows: [...user, ...machine.map((m) => ({ ...m, machine: true }))] };
}
async function winSet(row, allow) {
  const key = row.key.replace(/^HKEY_CURRENT_USER/, 'HKCU').replace(/^HKEY_LOCAL_MACHINE/, 'HKLM');
  const args = ['add', key, '/v', 'Value', '/t', 'REG_SZ', '/d', allow ? 'Allow' : 'Deny', '/f'];
  if (key.startsWith('HKLM')) { const r = await runAdmin(['reg', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ')); if (!r.ok) throw new Error('Windows didn’t allow the change.'); return { ok: true }; }
  const r = await run('reg', args); if (!r.ok) throw new Error((r.stderr || 'Could not change it').trim());
  return { ok: true };
}

async function list() { if (isMac) return macList(); if (isWin) return winList(); return { unsupported: true, rows: [] }; }
async function revoke(row) { if (isMac) return macRevoke(row); if (isWin) return winSet(row, false); throw new Error('Not supported here'); }
async function allow(row) { if (isWin) return winSet(row, true); throw new Error('macOS only lets you grant permissions in System Settings.'); }
function settingsUrl(row) {
  if (isMac) { const pane = (P.TCC[row.service] || {}).pane || 'Privacy'; return `x-apple.systempreferences:com.apple.preference.security?${pane}`; }
  if (isWin) return (P.WIN_CAPS[row.cap] || {}).settings || 'ms-settings:privacy';
  return null;
}
module.exports = { list, revoke, allow, settingsUrl };

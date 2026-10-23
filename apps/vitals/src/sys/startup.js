// Things that start by themselves: login items, launch agents/daemons (Mac), Run keys and Startup folders (Windows).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, out, runAdmin, pool, ps, isMac, isWin } = require('./run');
const P = require('./parse');
const HOME = os.homedir();

// ------------------------------------------------------------------ macOS
const LOGIN_SCRIPT = `tell application "System Events"
  set out to ""
  repeat with li in (every login item)
    set p to ""
    try
      set p to (path of li) as text
    end try
    set out to out & (name of li) & tab & p & linefeed
  end repeat
  return out
end tell`;

async function plistJson(file) {
  const r = await run('plutil', ['-convert', 'json', '-o', '-', file], { timeout: 5000 });
  if (!r.ok) return null; try { return JSON.parse(r.stdout); } catch { return null; }
}
function programOf(pl) {
  if (!pl) return '';
  if (pl.Program) return pl.Program;
  if (Array.isArray(pl.ProgramArguments) && pl.ProgramArguments.length) return pl.ProgramArguments[0];
  if (pl.BundleProgram) return pl.BundleProgram;
  return '';
}
function vendorOf(label) {
  const parts = String(label || '').split('.');
  return parts.length >= 2 ? parts[1].replace(/^\w/, (c) => c.toUpperCase()) : '';
}

async function macItems({ loginItems = true } = {}) {
  const uid = process.getuid ? process.getuid() : 501;
  const dirs = [
    { dir: path.join(HOME, 'Library', 'LaunchAgents'), type: 'agent', scope: 'user', domain: `gui/${uid}`, admin: false },
    { dir: '/Library/LaunchAgents', type: 'agent', scope: 'all users', domain: `gui/${uid}`, admin: false },
    { dir: '/Library/LaunchDaemons', type: 'daemon', scope: 'system', domain: 'system', admin: true }
  ];
  const [listT, disU, disS] = await Promise.all([out('launchctl', ['list']), out('launchctl', ['print-disabled', `gui/${uid}`]), out('launchctl', ['print-disabled', 'system'])]);
  const loaded = P.parseLaunchctlList(listT); const disUser = P.parsePrintDisabled(disU); const disSys = P.parsePrintDisabled(disS);
  const files = [];
  for (const d of dirs) { let fl = []; try { fl = fs.readdirSync(d.dir).filter((f) => f.endsWith('.plist')); } catch (_) {} for (const f of fl) files.push({ ...d, file: path.join(d.dir, f) }); }
  const items = (await pool(files, 8, async (f) => {
    const pl = await plistJson(f.file) || {};
    const label = pl.Label || path.basename(f.file, '.plist');
    const prog = programOf(pl);
    const dis = f.domain === 'system' ? disSys.get(label) : disUser.get(label);
    const disabled = dis === true || (dis === undefined && pl.Disabled === true);
    const l = loaded.get(label);
    const bundle = P.macBundleOf(prog);
    return {
      id: 'launchd:' + f.file, kind: f.type === 'daemon' ? 'Background service' : 'Launch agent', type: f.type, scope: f.scope, label, file: f.file, program: prog,
      name: bundle ? path.basename(bundle, '.app') : (vendorOf(label) ? `${vendorOf(label)} — ${label.split('.').slice(2).join('.') || label}` : label),
      app: bundle || '', vendor: vendorOf(label), enabled: !disabled, running: !!(l && l.pid), pid: l ? l.pid : null, lastExit: l ? l.status : null,
      runAtLoad: !!pl.RunAtLoad, keepAlive: !!pl.KeepAlive, interval: pl.StartInterval || null, needsAdmin: f.admin, domain: f.domain,
      missing: prog && prog.startsWith('/') ? !fs.existsSync(prog) : false, apple: /^com\.apple\./.test(label)
    };
  })).filter(Boolean);
  let logins = [], loginError = null;
  if (loginItems) {
    const r = await run('osascript', LOGIN_SCRIPT.split('\n').flatMap((l) => ['-e', l]), { timeout: 20000 });
    if (r.ok) logins = P.parseLoginItems(r.stdout).map((li) => ({ id: 'login:' + li.name, kind: 'Login item', type: 'login', scope: 'user', name: li.name, program: li.path || '', app: li.path && li.path.endsWith('.app') ? li.path : '', enabled: true, running: null, needsAdmin: false }));
    else loginError = /-1743|not allowed|Not authorized/i.test(r.stderr) ? 'automation-denied' : (r.stderr || '').trim();
  }
  return { items: [...logins, ...items], loginError };
}

async function macToggle(item, enable, store) {
  if (item.type === 'login') {
    if (enable) {
      const saved = store.get('login:' + item.name) || item;
      const esc = String(saved.program).replace(/"/g, '\\"');
      const r = await run('osascript', ['-e', `tell application "System Events" to make login item at end with properties {path:"${esc}", hidden:false}`], { timeout: 20000 });
      if (!r.ok) throw new Error((r.stderr || 'Could not add the login item').trim());
      store.delete('login:' + item.name);
    } else {
      store.set('login:' + item.name, item);
      const esc = String(item.name).replace(/"/g, '\\"');
      const r = await run('osascript', ['-e', `tell application "System Events" to delete login item "${esc}"`], { timeout: 20000 });
      if (!r.ok) throw new Error((r.stderr || 'Could not remove the login item').trim());
    }
    return { ok: true };
  }
  const target = `${item.domain}/${item.label}`;
  const cmds = enable
    ? [['launchctl', ['enable', target]], ['launchctl', ['bootstrap', item.domain, item.file]]]
    : [['launchctl', ['disable', target]], ['launchctl', ['bootout', target]]];
  if (item.needsAdmin) {
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const line = cmds.map(([c, a]) => [c, ...a].map(q).join(' ')).join('; ') + '; true';
    const r = await runAdmin(line, { prompt: `Vitals wants to ${enable ? 'turn on' : 'turn off'} ${item.name}.` });
    if (!r.ok) throw new Error(/User canceled|-128/.test(r.stderr) ? 'Cancelled' : (r.stderr || 'Could not change it').trim());
    return { ok: true };
  }
  const r1 = await run(cmds[0][0], cmds[0][1]);
  if (!r1.ok) throw new Error((r1.stderr || r1.error || 'launchctl refused').trim());
  await run(cmds[1][0], cmds[1][1]); // bootstrap/bootout may "fail" when it was already in that state
  return { ok: true };
}

// ------------------------------------------------------------------ Windows
const RUN = [
  { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', scope: 'user', admin: false },
  { key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', scope: 'all users', admin: true },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32', scope: 'all users', admin: true }
];
function regValues(text) { const k = P.parseRegQuery(text)[0]; return k ? k.values : {}; }

async function winItems() {
  const items = [];
  for (const r of RUN) {
    const [vals, appr] = await Promise.all([out('reg', ['query', r.key]).then(regValues), out('reg', ['query', r.approved]).then(regValues)]);
    for (const [name, v] of Object.entries(vals)) {
      if (name === '(Default)' || !v.data) continue;
      const exe = P.exeOfCommand(String(v.data).replace(/%([^%]+)%/g, (_, e) => process.env[e] || `%${e}%`));
      items.push({ id: `run:${r.key}:${name}`, kind: 'Run at sign-in', type: 'run', scope: r.scope, name, program: exe, command: v.data, enabled: P.approvedEnabled(appr[name] && appr[name].data),
        needsAdmin: r.admin, regKey: r.key, approvedKey: r.approved, missing: exe && /^[a-z]:\\/i.test(exe) ? !fs.existsSync(exe) : false });
    }
  }
  const folders = [
    { dir: path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'), approved: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder', scope: 'user', admin: false },
    { dir: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs\\StartUp'), approved: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder', scope: 'all users', admin: true }
  ];
  for (const f of folders) {
    let fl = []; try { fl = fs.readdirSync(f.dir).filter((x) => !/^desktop\.ini$/i.test(x)); } catch (_) {}
    if (!fl.length) continue;
    const appr = regValues(await out('reg', ['query', f.approved]));
    for (const file of fl) items.push({ id: `folder:${f.dir}:${file}`, kind: 'Startup folder', type: 'folder', scope: f.scope, name: file.replace(/\.(lnk|url|bat|cmd|exe)$/i, ''), program: path.join(f.dir, file), file: path.join(f.dir, file), valueName: file,
      enabled: P.approvedEnabled(appr[file] && appr[file].data), needsAdmin: f.admin, approvedKey: f.approved });
  }
  // scheduled tasks that run at log on
  const t = await ps(`Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' -and ($_.Triggers | Where-Object { $_.CimClass.CimClassName -in 'MSFT_TaskLogonTrigger','MSFT_TaskBootTrigger' }) } | ForEach-Object { "$($_.TaskPath)\`t$($_.TaskName)\`t$($_.State)\`t$(($_.Actions | Select-Object -First 1).Execute)" }`, { shell: 'slow', timeout: 30000 });
  for (const l of (t.stdout || '').split('\n')) {
    const f = l.split('\t'); if (f.length < 4) continue;
    items.push({ id: `task:${f[0]}${f[1]}`, kind: 'Scheduled at sign-in', type: 'task', scope: 'all users', name: f[1], taskPath: f[0], program: f[3].replace(/^"|"$/g, ''), enabled: !/Disabled/i.test(f[2]), running: /Running/i.test(f[2]), needsAdmin: true });
  }
  return { items };
}
async function winToggle(item, enable) {
  if (item.type === 'task') {
    const line = `schtasks /Change /TN "${item.taskPath}${item.name}" ${enable ? '/ENABLE' : '/DISABLE'}`;
    const r = await runAdmin(line); if (!r.ok) throw new Error('Windows didn’t allow the change (it needs administrator approval).'); return { ok: true };
  }
  const name = item.type === 'folder' ? item.valueName : item.name;
  // the 12-byte value Task Manager writes: 02 = enabled, 03 = disabled (+ a FILETIME when disabled)
  let data = '020000000000000000000000';
  if (!enable) { const ft = BigInt(Date.now() + 11644473600000) * 10000n; const b = Buffer.alloc(8); b.writeBigUInt64LE(ft); data = '03000000' + b.toString('hex'); }
  const args = ['add', item.approvedKey, '/v', name, '/t', 'REG_BINARY', '/d', data, '/f'];
  if (item.needsAdmin) {
    const r = await runAdmin(['reg', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' '));
    if (!r.ok) throw new Error('Windows didn’t allow the change (it needs administrator approval).');
    return { ok: true };
  }
  const r = await run('reg', args); if (!r.ok) throw new Error((r.stderr || 'Could not change it').trim());
  return { ok: true };
}

// ------------------------------------------------------------------ Linux (development)
function linuxItems() {
  const dir = path.join(HOME, '.config', 'autostart'); const items = [];
  let fl = []; try { fl = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop')); } catch (_) {}
  for (const f of fl) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8'); const g = (k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '';
    items.push({ id: 'xdg:' + f, kind: 'Autostart', type: 'xdg', scope: 'user', name: g('Name') || f, program: g('Exec'), file: path.join(dir, f), enabled: g('Hidden') !== 'true' && g('X-GNOME-Autostart-enabled') !== 'false', needsAdmin: false });
  }
  return { items };
}
async function linuxToggle(item, enable) {
  let t = fs.readFileSync(item.file, 'utf8');
  t = /^Hidden=/m.test(t) ? t.replace(/^Hidden=.*$/m, 'Hidden=' + (!enable)) : t.replace(/\[Desktop Entry\]\n?/, `[Desktop Entry]\nHidden=${!enable}\n`);
  fs.writeFileSync(item.file, t); return { ok: true };
}

async function list(opts) { if (isMac) return macItems(opts); if (isWin) return winItems(); return linuxItems(); }
async function toggle(item, enable, store) { if (isMac) return macToggle(item, enable, store); if (isWin) return winToggle(item, enable); return linuxToggle(item, enable); }

module.exports = { list, toggle };

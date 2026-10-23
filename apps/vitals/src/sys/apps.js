// Installed apps: listing, sizes, last used, and uninstalling (with leftover files on a Mac).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, out, runAdmin, pool, ps, psJson, isMac, isWin } = require('./run');
const P = require('./parse');

const HOME = os.homedir();

// ------------------------------------------------------------------ macOS
function findBundles(dir, depth = 2) {
  const res = [];
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return res; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.name.endsWith('.app')) res.push(p);
    else if ((e.isDirectory() || e.isSymbolicLink()) && depth > 1) res.push(...findBundles(p, depth - 1));
  }
  return res;
}
async function plistJson(file) {
  const r = await run('plutil', ['-convert', 'json', '-o', '-', file], { timeout: 5000 });
  if (!r.ok) return null; try { return JSON.parse(r.stdout); } catch { return null; }
}
async function macApps() {
  const roots = [
    { dir: '/Applications', system: false }, { dir: path.join(HOME, 'Applications'), system: false },
    { dir: '/System/Applications', system: true }, { dir: '/System/Applications/Utilities', system: true, depth: 1 }
  ];
  const seen = new Set(); const bundles = [];
  for (const r of roots) for (const b of findBundles(r.dir, r.depth || 2)) { if (seen.has(b)) continue; seen.add(b); bundles.push({ path: b, system: r.system }); }
  const infos = await pool(bundles, 8, async (b) => {
    const info = (await plistJson(path.join(b.path, 'Contents', 'Info.plist'))) || {};
    let st = null; try { st = fs.statSync(b.path); } catch (_) {}
    const name = info.CFBundleDisplayName || info.CFBundleName || path.basename(b.path, '.app');
    return {
      id: b.path, path: b.path, name: path.basename(b.path, '.app') || name, bundleId: info.CFBundleIdentifier || '',
      version: info.CFBundleShortVersionString || info.CFBundleVersion || '', publisher: (info.NSHumanReadableCopyright || '').replace(/^(Copyright\s*)?(©|\(c\))?\s*[\d\-–, ]*/i, '').replace(/\.?\s*All rights reserved\.?/i, '').trim().slice(0, 60),
      installed: st ? st.birthtimeMs || st.mtimeMs : null, modified: st ? st.mtimeMs : null,
      system: b.system || (st ? false : false), protected: b.system || b.path.startsWith('/System/'),
      appStore: fs.existsSync(path.join(b.path, 'Contents', '_MASReceipt')),
      arch: null, source: b.system ? 'system' : 'app', size: null, lastUsed: null,
      category: (info.LSApplicationCategoryType || '').replace('public.app-category.', ''),
      background: !!(info.LSUIElement || info.LSBackgroundOnly)
    };
  });
  const list = infos.filter(Boolean);
  // last opened + size from Spotlight in one call (in chunks)
  const names = ['kMDItemLastUsedDate', 'kMDItemUseCount', 'kMDItemPhysicalSize', 'kMDItemLogicalSize'];
  for (let i = 0; i < list.length; i += 120) {
    const chunk = list.slice(i, i + 120);
    const args = []; names.forEach((n) => args.push('-name', n)); args.push('-raw', ...chunk.map((a) => a.path));
    const t = await out('mdls', args, { timeout: 15000 });
    const md = P.parseMdlsRaw(t, chunk.map((a) => a.path), names);
    for (const a of chunk) {
      const m = md[a.path] || {};
      a.lastUsed = P.mdDate(m.kMDItemLastUsedDate); a.useCount = m.kMDItemUseCount ? +m.kMDItemUseCount : null;
      const sz = +(m.kMDItemPhysicalSize || m.kMDItemLogicalSize || 0); if (sz > 0) a.size = sz;
    }
  }
  return list;
}
/** du -sk for apps missing a size (slow; run in background). */
async function sizeOf(p) {
  if (isWin) return null;
  const r = await run('du', ['-sk', p], { timeout: 60000 });
  const k = parseInt(r.stdout, 10); return isNaN(k) ? null : k * 1024;
}

/** Where an app keeps its files on a Mac. Only paths that exist are returned. */
function macLeftovers(app) {
  const L = path.join(HOME, 'Library');
  const ids = [app.bundleId].filter(Boolean);
  const names = [...new Set([app.name, app.name.replace(/\s+/g, ''), app.name.replace(/\s+/g, '-')])].filter((n) => n && n.length > 2);
  const cand = [];
  for (const id of ids) {
    cand.push(
      [path.join(L, 'Application Support', id), 'App data'], [path.join(L, 'Caches', id), 'Cache'], [path.join(L, 'Preferences', id + '.plist'), 'Preferences'],
      [path.join(L, 'Saved Application State', id + '.savedState'), 'Window state'], [path.join(L, 'Containers', id), 'Sandbox container'],
      [path.join(L, 'HTTPStorages', id), 'Web storage'], [path.join(L, 'HTTPStorages', id + '.binarycookies'), 'Cookies'], [path.join(L, 'WebKit', id), 'Web data'],
      [path.join(L, 'Cookies', id + '.binarycookies'), 'Cookies'], [path.join(L, 'Application Scripts', id), 'Scripts'], [path.join(L, 'Logs', id), 'Logs'],
      [path.join(L, 'Caches', 'com.crashlytics.data', id), 'Crash reports']
    );
    for (const dir of [path.join(L, 'LaunchAgents')]) {
      try { for (const f of fs.readdirSync(dir)) if (f.toLowerCase().includes(id.toLowerCase())) cand.push([path.join(dir, f), 'Startup item']); } catch (_) {}
    }
    try { for (const f of fs.readdirSync(path.join(L, 'Preferences', 'ByHost'))) if (f.startsWith(id + '.')) cand.push([path.join(L, 'Preferences', 'ByHost', f), 'Preferences']); } catch (_) {}
    try { for (const f of fs.readdirSync(path.join(L, 'Group Containers'))) if (f.toLowerCase().endsWith('.' + id.toLowerCase()) || f.toLowerCase() === id.toLowerCase()) cand.push([path.join(L, 'Group Containers', f), 'Shared container']); } catch (_) {}
  }
  for (const n of names) {
    cand.push([path.join(L, 'Application Support', n), 'App data'], [path.join(L, 'Caches', n), 'Cache'], [path.join(L, 'Logs', n), 'Logs']);
  }
  const seen = new Set(); const res = [];
  for (const [p, kind] of cand) {
    if (seen.has(p)) continue; seen.add(p);
    try { const st = fs.lstatSync(p); res.push({ path: p, kind, dir: st.isDirectory(), size: st.isDirectory() ? null : st.size }); } catch (_) {}
  }
  return res;
}

// ------------------------------------------------------------------ Windows
const UNINSTALL_KEYS = [
  ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'machine'],
  ['HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'machine'],
  ['HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'user']
];
async function winApps() {
  const lists = await Promise.all(UNINSTALL_KEYS.map(async ([k, scope]) => P.winUninstallEntries(P.parseRegQuery(await out('reg', ['query', k, '/s'], { timeout: 20000 })), scope)));
  const desktop = P.dedupeApps(lists.flat());
  const store = await psJson(`Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable -and $_.SignatureKind -ne 'System' } | Select-Object Name, PackageFullName, PackageFamilyName, Version, Publisher, InstallLocation, @{n='Installed';e={ try { (Get-Item $_.InstallLocation -ErrorAction Stop).CreationTime.ToString('o') } catch { $null } }}`, { shell: 'slow', timeout: 30000 });
  const storeApps = store.filter((s) => s && s.Name).map((s) => ({
    id: 'appx:' + s.PackageFullName, name: P.prettyPackage(s.Name), version: s.Version || '', publisher: String(s.Publisher || '').replace(/^CN=([^,]+).*$/, '$1'),
    installed: s.Installed ? Date.parse(s.Installed) : null, size: null, location: s.InstallLocation || '', icon: '', packageFullName: s.PackageFullName, family: s.PackageFamilyName,
    source: 'store', scope: 'user', protected: /^Microsoft\.(Windows|Xbox|Edge|Store|Desktop|VCLibs|NET|UI\.|Services|Advertising|SecHealth)/i.test(s.Name)
  }));
  return [...desktop.map((a) => ({ ...a, path: a.location || a.icon || '' })), ...storeApps];
}

// ------------------------------------------------------------------ Linux (development)
function linuxApps() {
  const dirs = ['/usr/share/applications', path.join(HOME, '.local/share/applications')];
  const res = [];
  for (const d of dirs) {
    let fl = []; try { fl = fs.readdirSync(d).filter((f) => f.endsWith('.desktop')); } catch (_) {}
    for (const f of fl) {
      let t = ''; try { t = fs.readFileSync(path.join(d, f), 'utf8'); } catch (_) { continue; }
      if (/^NoDisplay=true/m.test(t)) continue;
      const g = (k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '';
      res.push({ id: path.join(d, f), path: path.join(d, f), name: g('Name') || f, version: '', publisher: '', source: 'app', exec: g('Exec'), protected: d.startsWith('/usr'), installed: null, lastUsed: null, size: null });
    }
  }
  return res;
}

async function list() {
  if (isMac) return macApps();
  if (isWin) return winApps();
  return linuxApps();
}

/** Uninstall. Mac: move the app (and the chosen leftovers) to the Trash. Windows: start the app's own uninstaller. */
async function uninstall(app, { leftovers = [], trashItem } = {}) {
  if (isMac) {
    if (app.protected) throw new Error('This app is part of macOS and can’t be removed.');
    const moved = [], failed = [];
    for (const p of [app.path, ...leftovers]) {
      try { await trashItem(p); moved.push(p); }
      catch (e) {
        if (p === app.path) {
          // apps installed by an admin can need a password; Finder handles that and still uses the Trash
          const esc = p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const r = await run('osascript', ['-e', `tell application "Finder" to delete (POSIX file "${esc}" as alias)`], { timeout: 120000 });
          if (r.ok) moved.push(p); else failed.push({ path: p, error: (r.stderr || e.message || '').trim() });
        } else failed.push({ path: p, error: String(e.message || e) });
      }
    }
    if (failed.some((f) => f.path === app.path)) throw new Error('macOS wouldn’t move ' + app.name + ' to the Trash. ' + (failed[0].error || ''));
    return { ok: true, moved, failed, done: true };
  }
  if (isWin) {
    if (app.source === 'store') {
      const r = await ps(`Remove-AppxPackage -Package '${String(app.packageFullName).replace(/'/g, "''")}'`, { shell: 'slow', timeout: 120000 });
      if (!r.ok) throw new Error('Windows couldn’t remove it: ' + (r.stdout || r.error || '').trim().slice(0, 300));
      return { ok: true, done: true };
    }
    const cmd = P.winUninstallCommand(app);
    if (!cmd) throw new Error('This app doesn’t have an uninstaller registered.');
    // Hand off to the app's own uninstaller; it shows its own windows and UAC prompt.
    const { spawn } = require('child_process');
    const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return { ok: true, done: false, started: true };
  }
  throw new Error('Uninstalling isn’t supported on this system yet.');
}

/** Is an app still installed? (to notice when an uninstaller finishes) */
async function stillInstalled(app) {
  if (isMac) return fs.existsSync(app.path);
  if (isWin) {
    if (app.source === 'store') { const r = await ps(`[bool](Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.PackageFullName -eq '${String(app.packageFullName).replace(/'/g, "''")}' })`, { timeout: 15000 }); return /True/.test(r.stdout); }
    const k = app.id.replace(/^HKEY_LOCAL_MACHINE/, 'HKLM').replace(/^HKEY_CURRENT_USER/, 'HKCU');
    const r = await run('reg', ['query', k], { timeout: 8000 }); return r.ok;
  }
  return true;
}

module.exports = { list, sizeOf, macLeftovers, uninstall, stillInstalled };

// Bench — finding what can be tested: Utility Suite apps installed on this computer, each app's source folder in
// the Utility Package, and any other app picked by path. Turns a request like {app: "Lumen"} or
// {project: "lumen"} into the command that starts it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson } = require('./store');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const FALLBACK_SUITE = ['Assist', 'Atoll', 'Beam', 'Bench', 'Cadence', 'Crate', 'Datum', 'Decomp', 'Docket', 'Droid', 'Facet', 'Fresh Desk', 'Glean', 'Kiln', 'Lumen', 'Onward', 'RO2', 'RO3', 'Relay', 'Scene', 'Sideby', 'Slate', 'Touchline', 'Trace', 'Utility Hub', 'Vitals', 'Waypoint'];

/** The Utility Package folder: the setting, else ~/Downloads/Utility Package if it's there. */
function packageDir(setting) {
  const cands = [setting, path.join(os.homedir(), 'Downloads', 'Utility Package')].filter(Boolean).map((p) => p.replace(/^~(?=$|[\\/])/, os.homedir()));
  return cands.find((p) => fs.existsSync(path.join(p, 'suite.json')) && fs.existsSync(path.join(p, 'apps'))) || null;
}
function suiteList(pkgDir) {
  const m = pkgDir ? readJson(path.join(pkgDir, 'suite.json'), null) : null;
  if (m && Array.isArray(m.apps)) return m.apps.map((a) => ({ id: a.id, name: a.name, description: a.description || '', hub: a.role === 'hub' }));
  return FALLBACK_SUITE.map((n) => ({ id: n.toLowerCase().replace(/\s+/g, '-'), name: n, description: '' }));
}

function macBundle(appPath) {
  const contents = path.join(appPath, 'Contents');
  let exe = path.basename(appPath, '.app'); let version = ''; let id = '';
  try {
    const pl = fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8');
    const get = (k) => (new RegExp(`<key>${k}</key>\\s*<string>([^<]+)</string>`).exec(pl) || [])[1];
    exe = get('CFBundleExecutable') || exe; version = get('CFBundleShortVersionString') || ''; id = get('CFBundleIdentifier') || '';
  } catch {}
  const electron = fs.existsSync(path.join(contents, 'Frameworks', 'Electron Framework.framework'));
  return { exec: path.join(contents, 'MacOS', exe), version, bundleId: id, electron };
}
function winExe(exe) {
  const dir = path.dirname(exe);
  const electron = fs.existsSync(path.join(dir, 'resources', 'app.asar')) || fs.existsSync(path.join(dir, 'resources', 'app'));
  let version = '';
  try { const pkg = readJson(path.join(dir, 'resources', 'app', 'package.json'), null); if (pkg) version = pkg.version; } catch {}
  return { exec: exe, version, electron };
}

/** Utility Suite apps installed on this computer. */
function installedSuite(pkgDir) {
  const out = [];
  for (const a of suiteList(pkgDir)) {
    if (IS_MAC) {
      for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
        const p = path.join(dir, `${a.name}.app`);
        if (fs.existsSync(p)) { const b = macBundle(p); out.push({ id: a.id, name: a.name, path: p, ...b, source: 'installed' }); break; }
      }
    } else if (IS_WIN) {
      const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Utility Suite', a.name);
      const exe = path.join(root, `${a.name}.exe`);
      if (fs.existsSync(exe)) out.push({ id: a.id, name: a.name, path: exe, ...winExe(exe), source: 'installed' });
    }
  }
  return out;
}

/** The Electron binary a source folder would run with (from its own node_modules), or null. */
function projectElectron(dir) {
  const e = path.join(dir, 'node_modules', 'electron');
  try {
    const rel = fs.readFileSync(path.join(e, 'path.txt'), 'utf8').trim();
    const bin = path.join(e, 'dist', rel);
    if (fs.existsSync(bin)) return { bin, version: readJson(path.join(e, 'package.json'), {}).version || '' };
  } catch {}
  return null;
}
/** Each app's source in the Utility Package (apps/<id>). */
function projects(pkgDir) {
  if (!pkgDir) return [];
  const names = new Map(suiteList(pkgDir).map((a) => [a.id, a]));
  let dirs = []; try { dirs = fs.readdirSync(path.join(pkgDir, 'apps')); } catch {}
  return dirs.map((id) => {
    const dir = path.join(pkgDir, 'apps', id); const pkg = readJson(path.join(dir, 'package.json'), null);
    if (!pkg) return null;
    const e = projectElectron(dir);
    return { id, name: pkg.productName || (names.get(id) || {}).name || pkg.name || id, version: pkg.version || '', dir, description: (names.get(id) || {}).description || pkg.description || '', hasDeps: fs.existsSync(path.join(dir, 'node_modules')), electron: e ? e.version : null, scripts: Object.keys(pkg.scripts || {}), hub: (names.get(id) || {}).hub || false, source: 'project' };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Works out how to start something.
 * spec: { app: "Lumen" } (installed suite app), { project: "lumen" | "/path/to/source" }, { path: "/Applications/X.app" | "C:\\…\\x.exe" | "/path/to/source" }
 * Returns { name, version, exec, args, cwd, kind: 'electron'|'native', needsInstall?: dir }.
 */
function resolveLaunch(spec, { pkgDir, extraArgs = [] } = {}) {
  const expand = (p) => String(p).replace(/^~(?=$|[\\/])/, os.homedir());
  if (spec.project) {
    let dir = expand(spec.project);
    if (!path.isAbsolute(dir) || !fs.existsSync(dir)) {
      const p = projects(pkgDir).find((x) => x.id === String(spec.project).toLowerCase() || x.name.toLowerCase() === String(spec.project).toLowerCase());
      if (!p) throw new Error(`No app source “${spec.project}” in ${pkgDir ? path.join(pkgDir, 'apps') : 'the Utility Package (set its folder in Bench › Settings)'}`);
      dir = p.dir;
    }
    return fromSource(dir, extraArgs);
  }
  if (spec.app) {
    const want = String(spec.app).toLowerCase();
    const hit = installedSuite(pkgDir).find((a) => a.name.toLowerCase() === want || a.id === want);
    if (hit) return { name: hit.name, version: hit.version, exec: hit.exec, args: extraArgs, cwd: path.dirname(hit.exec), kind: hit.electron ? 'electron' : 'native', source: 'installed' };
    // not installed: fall back to its source in the Utility Package
    const p = projects(pkgDir).find((x) => x.id === want || x.name.toLowerCase() === want);
    if (p) return { ...fromSource(p.dir, extraArgs), note: `${p.name} isn’t installed on this computer, so Bench runs it from its source in apps/${p.id}` };
    const other = findAnyApp(spec.app);
    if (other) return resolveLaunch({ path: other }, { pkgDir, extraArgs });
    throw new Error(`Couldn’t find “${spec.app}”. Installed Utility Suite apps: ${installedSuite(pkgDir).map((a) => a.name).join(', ') || 'none'}`);
  }
  if (spec.path) {
    const p = expand(spec.path);
    if (!fs.existsSync(p)) throw new Error(`Nothing at ${p}`);
    if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'package.json'))) return fromSource(p, extraArgs);
    if (IS_MAC && p.endsWith('.app')) { const b = macBundle(p); return { name: path.basename(p, '.app'), version: b.version, exec: b.exec, args: extraArgs, cwd: path.dirname(b.exec), kind: b.electron ? 'electron' : 'native', source: 'path' }; }
    if (IS_WIN && /\.exe$/i.test(p)) { const w = winExe(p); return { name: path.basename(p, '.exe'), version: w.version, exec: p, args: extraArgs, cwd: path.dirname(p), kind: w.electron ? 'electron' : 'native', source: 'path' }; }
    return { name: path.basename(p), version: '', exec: p, args: extraArgs, cwd: path.dirname(p), kind: /electron/i.test(path.basename(p)) ? 'electron' : 'native', source: 'path' };
  }
  throw new Error('Say what to open: an app name, a project (app source folder), a path, a web address or a command');
}
function fromSource(dir, extraArgs) {
  const pkg = readJson(path.join(dir, 'package.json'), null);
  if (!pkg) throw new Error(`${dir} has no package.json`);
  const name = pkg.productName || pkg.name || path.basename(dir);
  const e = projectElectron(dir);
  if (!e) return { name, version: pkg.version || '', needsInstall: dir, exec: null, args: [dir, ...extraArgs], cwd: dir, kind: 'electron', source: 'project' };
  return { name, version: pkg.version || '', exec: e.bin, args: [dir, ...extraArgs], cwd: dir, kind: 'electron', source: 'project', electronVersion: e.version };
}
function findAnyApp(name) {
  if (IS_MAC) for (const dir of ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications']) { const p = path.join(dir, `${name}.app`); if (fs.existsSync(p)) return p; }
  if (IS_WIN) {
    const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    for (const root of [path.join(la, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) { const exe = path.join(root, name, `${name}.exe`); if (fs.existsSync(exe)) return exe; }
  }
  return null;
}

module.exports = { packageDir, suiteList, installedSuite, projects, resolveLaunch, projectElectron, macBundle };

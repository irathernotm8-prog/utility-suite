'use strict';
// A "Packages" folder holds catalog.json plus one zip per app. The Utility Package's
// `./utility suite` writes it; the hub reads it.
//
// catalog.json
// { format: 1, suiteName, suiteVersion, platform: "mac"|"win", builtAt, publisher,
//   hub:  { version, path: "../Utility Hub.app" | "../Utility Hub", exe? },
//   apps: [{ id, name, version, arch, description, appId, file, sha256, size, icon,
//            bundle: "RO3.app" (mac) | folder: "RO3", exe: "RO3.exe" (win), notes: [] }] }
const path = require('path');
const fs = require('./fsx');
const { readJSON, compareVersions } = require('./sys');

const FORMAT = 1;
const platformKey = (p = process.platform) => (p === 'darwin' ? 'mac' : p === 'win32' ? 'win' : 'linux');

function findCatalog(root) {
  const candidates = [path.join(root, 'catalog.json'), path.join(root, 'Packages', 'catalog.json')];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function readCatalog(root) {
  const file = findCatalog(root);
  if (!file) throw new Error(`No Utility Suite packages found in ${root}`);
  const cat = readJSON(file, null);
  if (!cat || !Array.isArray(cat.apps)) throw new Error(`${file} isn't a valid package catalog`);
  if (cat.format > FORMAT) throw new Error('These packages were made by a newer Utility Package. Update Utility Hub first.');
  return { catalog: cat, dir: path.dirname(file), file };
}

// Can this computer run a package built for `arch`?
function archCompatible(pkgArch, hostArch = process.arch, platform = process.platform) {
  if (!pkgArch || pkgArch === 'universal' || pkgArch === hostArch) return true;
  if (platform === 'win32' && hostArch === 'arm64' && pkgArch === 'x64') return true; // Windows on ARM emulates x64
  return false;
}

function compatibility(cat, entry, host = {}) {
  const platform = host.platform || process.platform;
  if (cat.platform !== platformKey(platform)) return { ok: false, reason: `Built for ${cat.platform === 'mac' ? 'Mac' : cat.platform === 'win' ? 'Windows' : cat.platform}` };
  if (!archCompatible(entry.arch, host.arch || process.arch, platform)) {
    const mac = platform === 'darwin';
    const need = entry.arch === 'arm64' ? (mac ? 'an Apple Silicon Mac' : 'an ARM (arm64) PC') : entry.arch === 'x64' ? (mac ? 'an Intel Mac' : 'a standard (x64) PC') : `a ${entry.arch} computer`;
    return { ok: false, reason: `Needs ${need}` };
  }
  return { ok: true };
}

const hubPath = (dir, cat) => (cat.hub?.path ? path.resolve(dir, cat.hub.path) : null);

module.exports = { FORMAT, platformKey, findCatalog, readCatalog, archCompatible, compatibility, hubPath, compareVersions };

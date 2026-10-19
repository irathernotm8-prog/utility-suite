#!/usr/bin/env node
// Utility Package — central home for all of Bilal's desktop apps.
//
//   status                 what's changed in each project since it was last ported
//   port <app|all>         copy a project's latest source into apps/<id>
//   build <app|all>        build that app's own installers (dmg / exe) into releases/apps
//   suite                  build every app and bundle them into one Mac DMG and/or one Windows zip
//   add <project path>     register a new app project
//   doctor                 check this computer has what builds need
//   menu                   interactive menu (what "Utility Package.command" opens)
//
// No dependencies beyond Node 20+. Run via ./utility (Mac) or utility.cmd (Windows).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  manifest: path.join(ROOT, 'suite.json'),
  ports: path.join(ROOT, 'ports.json'),
  changelog: path.join(ROOT, 'CHANGELOG.md'),
  apps: path.join(ROOT, 'apps'),
  build: path.join(ROOT, '.build'),
  releases: path.join(ROOT, 'releases'),
  installer: path.join(ROOT, 'installer'),
};
const HOST = process.platform; // darwin | win32 | linux
const IS_WIN = HOST === 'win32';
const TARGETS = {
  mac: { platform: 'darwin', flag: '--mac', label: 'macOS' },
  win: { platform: 'win32', flag: '--win', label: 'Windows' },
  linux: { platform: 'linux', flag: '--linux', label: 'Linux' }, // used for testing the pipeline
};

// ───────────────────────── output helpers ─────────────────────────
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c(1), dim = c(2), red = c(31), green = c(32), yellow = c(33), cyan = c(36);
const log = (...a) => console.log(...a);
const step = (s) => log(`\n${cyan('▸')} ${bold(s)}`);
const ok = (s) => log(`  ${green('✓')} ${s}`);
const warn = (s) => log(`  ${yellow('!')} ${s}`);
class UserError extends Error {}
const fail = (s) => { throw new UserError(s); };

// ───────────────────────── manifest & state ─────────────────────────
const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const manifest = () => {
  const m = readJSON(P.manifest, null);
  if (!m) fail(`Can't read ${P.manifest}`);
  return m;
};
const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(ROOT, p));
const pkgOf = (dir) => readJSON(path.join(dir, 'package.json'), null);
const productName = (pkg) => pkg?.build?.productName || pkg?.productName || pkg?.name;

function pickApps(which) {
  const m = manifest();
  if (!which || which === 'all') return m.apps;
  const wanted = which.split(',').map((s) => s.trim().toLowerCase());
  const found = m.apps.filter((a) => wanted.includes(a.id) || wanted.includes(a.name.toLowerCase()));
  if (found.length !== wanted.length) {
    fail(`Unknown app "${which}". Known apps: ${m.apps.map((a) => a.id).join(', ')}`);
  }
  return found;
}
const excludesFor = (app) => [...(manifest().defaultExcludes || []), ...(app.exclude || [])];

// ───────────────────────── file tree diff / mirror ─────────────────────────
function isExcluded(rel, patterns) {
  const segs = rel.split('/');
  const base = segs[segs.length - 1];
  return patterns.some((p) => {
    if (p.includes('/')) return rel === p || rel.startsWith(p + '/');
    if (p.startsWith('*.')) return base.endsWith(p.slice(1));
    return segs.includes(p);
  });
}

function walk(root, patterns) {
  const out = new Map();
  if (!fs.existsSync(root)) return out;
  const visit = (dir, relDir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (isExcluded(rel, patterns)) continue;
      const abs = path.join(dir, ent.name);
      let st;
      try { st = fs.statSync(abs); } catch { continue; } // broken symlink
      if (st.isDirectory()) visit(abs, rel);
      else if (st.isFile()) out.set(rel, { abs, size: st.size });
    }
  };
  visit(root, '');
  return out;
}

const hashFile = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

function diffTrees(src, dst, patterns) {
  const a = walk(src, patterns), b = walk(dst, patterns);
  const added = [], changed = [], removed = [];
  for (const [rel, fa] of a) {
    const fb = b.get(rel);
    if (!fb) added.push(rel);
    else if (fa.size !== fb.size || hashFile(fa.abs) !== hashFile(fb.abs)) changed.push(rel);
  }
  for (const rel of b.keys()) if (!a.has(rel)) removed.push(rel);
  return { added, changed, removed, total: added.length + changed.length + removed.length };
}

function applyDiff(src, dst, d) {
  for (const rel of [...d.added, ...d.changed]) {
    const to = path.join(dst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(src, rel), to);
    try { fs.chmodSync(to, fs.statSync(path.join(src, rel)).mode); } catch {}
  }
  for (const rel of d.removed) {
    fs.rmSync(path.join(dst, rel), { force: true });
    let dir = path.dirname(path.join(dst, rel));
    while (dir.startsWith(dst) && dir !== dst) {
      try { if (fs.readdirSync(dir).length) break; fs.rmdirSync(dir); } catch { break; }
      dir = path.dirname(dir);
    }
  }
}

function mirror(src, dst, patterns) {
  fs.mkdirSync(dst, { recursive: true });
  const d = diffTrees(src, dst, patterns);
  applyDiff(src, dst, d);
  return d;
}

// ───────────────────────── process helpers ─────────────────────────
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.quiet ? 'pipe' : 'inherit', shell: IS_WIN, encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    fail(`Command failed (${r.status}): ${cmd} ${args.join(' ')}${opts.quiet && r.stderr ? '\n' + r.stderr.trim() : ''}`);
  }
  return r;
}
const has = (cmd) => {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { stdio: 'pipe' });
  return r.status === 0;
};
const q = (s) => (IS_WIN && /\s/.test(s) ? `"${s}"` : s); // quote for shell:true on Windows

function copyTree(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (HOST === 'darwin') run('ditto', [src, dst]); // keeps symlinks, signatures, xattrs
  else fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
}

function extractZip(zip, into) {
  fs.mkdirSync(into, { recursive: true });
  if (has('unzip')) run('unzip', ['-q', '-o', zip, '-d', into], { quiet: true });
  else run('tar', ['-xf', q(zip), '-C', q(into)], { quiet: true }); // bsdtar on Mac/Windows reads zip
}

function makeZip(folder, outZip) {
  fs.rmSync(outZip, { force: true });
  if (HOST === 'darwin') run('ditto', ['-c', '-k', '--keepParent', folder, outZip]);
  else if (IS_WIN) run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${folder}' -DestinationPath '${outZip}'`]);
  else run('zip', ['-qry', outZip, path.basename(folder)], { cwd: path.dirname(folder) });
}

// ───────────────────────── sources ─────────────────────────
// A source is a project folder, or a .zip of one (Assist is handed over as a zip).
function openSource(app) {
  const src = expandHome(app.source);
  if (!fs.existsSync(src)) return { missing: true, path: src };
  if (src.toLowerCase().endsWith('.zip')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `utility-${app.id}-`));
    extractZip(src, tmp);
    let dir = tmp;
    if (!fs.existsSync(path.join(dir, 'package.json'))) {
      const kids = fs.readdirSync(dir).filter((n) => !n.startsWith('.') && n !== '__MACOSX');
      if (kids.length === 1 && fs.existsSync(path.join(dir, kids[0], 'package.json'))) dir = path.join(dir, kids[0]);
    }
    return { dir, path: src, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  }
  return { dir: src, path: src, cleanup: () => {} };
}

// ───────────────────────── status ─────────────────────────
// Apps normally live right here in apps/<id> (no "source" in suite.json). An app with a "source"
// is still developed somewhere else and copied in with `port` until it's adopted.
const inPlace = (app) => !app.source;
const appDir = (app) => path.join(P.apps, app.id);

// versions in the newest suite build, by app id
function lastSuite() {
  const latest = readJSON(path.join(P.releases, 'suite', 'latest.json'), null);
  if (!latest) return { version: null, apps: {} };
  const dir = path.join(P.releases, 'suite', latest.version);
  const apps = {};
  for (const os_ of ['mac', 'win', 'linux']) {
    const cat = readJSON(path.join(dir, os_, 'catalog.json'), null);
    for (const a of cat?.apps || []) apps[a.id] = a.version;
    if (cat?.hub) apps.__hub = cat.hub.version;
  }
  return { version: latest.version, apps };
}

function gitChanges() {
  if (!fs.existsSync(path.join(ROOT, '.git')) || !has('git')) return null;
  const r = run('git', ['status', '--porcelain', '--', 'apps'], { cwd: ROOT, quiet: true, allowFail: true });
  const by = {};
  for (const line of (r.stdout || '').split('\n').filter(Boolean)) {
    const id = line.slice(3).replace(/^"|"$/g, '').split('/')[1];
    if (id) by[id] = (by[id] || 0) + 1;
  }
  return by;
}

function cmdStatus() {
  const ship = lastSuite();
  const git = gitChanges();
  const rows = [['App', 'Version', `In last suite${ship.version ? ` (${ship.version})` : ''}`, 'Ready to ship', ...(git ? ['Uncommitted'] : []), 'Lives in']];
  for (const app of manifest().apps) {
    const v = pkgOf(appDir(app))?.version || '—';
    const shipped = isHub(app) ? ship.apps.__hub : ship.apps[app.id];
    const ready = !shipped ? yellow('not in a suite yet') : compareVersions(v, shipped) > 0 ? green(`yes, ${shipped} → ${v}`) : dim('no (bump version to ship)');
    let where = `apps/${app.id}`;
    if (!inPlace(app)) {
      const src = openSource(app);
      if (src.missing) where = red(`elsewhere, not found: ${app.source}`);
      else {
        try {
          const d = diffTrees(src.dir, appDir(app), excludesFor(app));
          where = `${app.source}${d.total ? yellow(` (${d.total} unported)`) : ''}`;
        } finally { src.cleanup(); }
      }
    }
    rows.push([app.name, v, shipped || '—', ready, ...(git ? [git[app.id] ? yellow(String(git[app.id])) : dim('0')] : []), where]);
  }
  printTable(rows);
  log(dim('\n  Ship an app: bump "version" in apps/<id>/package.json, ./utility note <id> "what changed", then ./utility suite --all'));
}

function compareVersions(a, b) {
  const p = (v) => String(v || '0').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const A = p(a), B = p(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

function printTable(rows) {
  const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => strip(r[i]).length)));
  rows.forEach((r, ri) => {
    const line = r.map((cell, i) => String(cell) + ' '.repeat(w[i] - strip(cell).length)).join('   ');
    log('  ' + (ri === 0 ? bold(line) : line));
  });
}

// ───────────────────────── port ─────────────────────────
function cmdPort(which, opts) {
  if (!which) fail('Which app? e.g. ./utility port ro3   (or: ./utility port all)');
  const ports = readJSON(P.ports, {});
  const done = [];
  for (const app of pickApps(which)) {
    step(`Port ${app.name}`);
    if (inPlace(app) && !opts['from-old']) { ok(`Lives in apps/${app.id}; edit it there. Nothing to port.`); continue; }
    if (inPlace(app) && !app.movedFrom) { warn(`${app.name} has no old folder on record.`); continue; }
    // --from-old: catch up on edits made in the app's old folder after it moved in
    const src = openSource(inPlace(app) ? { ...app, source: app.movedFrom } : app);
    if (src.missing) { warn(`Source not found: ${src.path} — update "source" for ${app.id} in suite.json`); continue; }
    try {
      const pkg = pkgOf(src.dir);
      if (!pkg) { warn(`No package.json in ${src.path} — that doesn't look like the ${app.name} project. Skipped.`); continue; }
      const dst = path.join(P.apps, app.id);
      const d = diffTrees(src.dir, dst, excludesFor(app));
      if (d.total === 0) { ok(`Already up to date (v${pkg.version})`); continue; }
      const show = (label, list, color) => {
        if (!list.length) return;
        log(`  ${color(label)} ${list.length}`);
        list.slice(0, 12).forEach((f) => log(dim(`      ${f}`)));
        if (list.length > 12) log(dim(`      …and ${list.length - 12} more`));
      };
      show('changed', d.changed, yellow); show('new    ', d.added, green); show('removed', d.removed, red);
      const prev = ports[app.id];
      if (prev?.version && prev.version === pkg.version) {
        warn(`Version is still ${pkg.version}. Bump "version" in the project's package.json so installed copies show it's newer.`);
      }
      if (opts['dry-run']) { log(dim('  (dry run — nothing copied)')); continue; }
      fs.mkdirSync(dst, { recursive: true });
      applyDiff(src.dir, dst, d);
      ports[app.id] = { version: pkg.version, portedAt: new Date().toISOString(), from: app.source, changed: d.changed.length, added: d.added.length, removed: d.removed.length, ...(opts.note ? { note: opts.note } : {}) };
      writeJSON(P.ports, ports);
      appendChangelog(app, pkg.version, d, opts.note);
      ok(`Ported ${app.name} v${pkg.version}`);
      done.push(`${app.name} ${pkg.version}`);
    } finally { src.cleanup(); }
  }
  if (done.length) gitCommit(`Port: ${done.join(', ')}${opts.note ? ` — ${opts.note}` : ''}`);
  return done;
}

function appendChangelog(app, version, d, note) {
  const header = '# Changelog\n\nWhat changed in each app, newest first. Lines with a note after the dash show up as "What\'s new" in Utility Hub.\n\n';
  let body = fs.existsSync(P.changelog) ? fs.readFileSync(P.changelog, 'utf8') : header;
  if (body.startsWith('# Port log')) body = header + body.slice(body.indexOf('\n- ') + 1);
  else if (!body.startsWith('# Changelog')) body = header + body;
  const n = new Date(), pad = (x) => String(x).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`;
  const counts = [d.changed.length && `${d.changed.length} changed`, d.added.length && `${d.added.length} new`, d.removed.length && `${d.removed.length} removed`].filter(Boolean).join(', ');
  const line = `- ${stamp} — **${app.name} ${version}**${counts ? ` (${counts})` : ''}${note ? ` — ${note}` : ''}\n`;
  const idx = body.indexOf('\n- ');
  body = idx === -1 ? body.trimEnd() + '\n\n' + line : body.slice(0, idx + 1) + line + body.slice(idx + 1);
  fs.writeFileSync(P.changelog, body);
}

function gitCommit(msg) {
  if (!fs.existsSync(path.join(ROOT, '.git')) || !has('git')) return;
  run('git', ['add', '-A'], { cwd: ROOT, quiet: true, allowFail: true });
  const r = run('git', ['commit', '-q', '-m', IS_WIN ? `"${msg}"` : msg], { cwd: ROOT, quiet: true, allowFail: true });
  if (r.status === 0) ok(dim('Saved to history (git)'));
}

// ───────────────────────── staging & building ─────────────────────────
const hostArch = () => (process.arch === 'arm64' ? 'arm64' : 'x64');

function stageApp(app, tKey, arch) {
  const t = TARGETS[tKey];
  const srcDir = path.join(P.apps, app.id);
  if (!fs.existsSync(path.join(srcDir, 'package.json'))) fail(`apps/${app.id} has no package.json. Add the app with: ./utility add <project folder>`);
  const stage = path.join(P.build, `${tKey}-${arch}`, app.id);
  mirror(srcDir, stage, [...excludesFor(app), '.deps-stamp']);

  const pkg = pkgOf(stage);
  const lock = path.join(stage, 'package-lock.json');
  const cross = t.platform !== HOST || (arch !== 'universal' && arch !== hostArch());
  const stamp = crypto.createHash('sha1')
    .update(JSON.stringify([pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies]))
    .update(fs.existsSync(lock) ? fs.readFileSync(lock) : '')
    .update(`${t.platform}|${arch}|${process.versions.node.split('.')[0]}`).digest('hex');
  const stampFile = path.join(stage, '.deps-stamp');
  const nm = path.join(stage, 'node_modules');
  if (!fs.existsSync(nm) || readFileSafe(stampFile) !== stamp) {
    log(dim(`  installing dependencies for ${t.label} ${arch}${cross ? ' (cross-platform)' : ''}…`));
    fs.rmSync(nm, { recursive: true, force: true });
    const args = [fs.existsSync(lock) ? 'ci' : 'install', '--no-audit', '--no-fund'];
    const env = { ...process.env };
    if (cross) {
      const cpu = arch === 'universal' ? hostArch() : arch;
      args.push(`--os=${t.platform}`, `--cpu=${cpu}`);
      env.npm_config_platform = t.platform; // ffmpeg-static & friends read these at install
      env.npm_config_arch = cpu;
    }
    run('npm', args, { cwd: stage, env });
    if (cross) checkNativeDeps(stage, t.platform, arch === 'universal' ? hostArch() : arch, app);
    fs.writeFileSync(stampFile, stamp);
  }
  if (tKey === 'mac' && arch === 'universal' && fs.existsSync(path.join(nm, 'sharp'))) {
    warn(`${app.name} uses sharp; a universal Mac build only carries this Mac's sharp binary. Set "macArch": "arm64" for it in suite.json.`);
  }
  return { stage, pkg, cross };
}

const readFileSafe = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

function checkNativeDeps(stage, platform, arch, app) {
  const nm = path.join(stage, 'node_modules');
  const problems = [];
  if (fs.existsSync(path.join(nm, 'sharp')) && !fs.existsSync(path.join(nm, '@img', `sharp-${platform}-${arch}`))) {
    problems.push(`sharp has no ${platform}-${arch} binary`);
  }
  const ff = path.join(nm, 'ffmpeg-static');
  if (fs.existsSync(ff) && !fs.existsSync(path.join(ff, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))) {
    problems.push('ffmpeg-static did not download the right FFmpeg');
  }
  if (problems.length) {
    fail(`${app.name}: ${problems.join('; ')}.\n  Cross-building isn't possible for it on this computer — build it on a ${platform === 'win32' ? 'Windows PC' : 'Mac'} or with the GitHub workflow.`);
  }
  ok(`${app.name}: ${platform}-${arch} native binaries in place`);
}

function electronBuilder(stage, args) {
  const bin = path.join(stage, 'node_modules', '.bin', IS_WIN ? 'electron-builder.cmd' : 'electron-builder');
  if (!fs.existsSync(bin)) fail(`electron-builder isn't in ${path.basename(stage)}'s devDependencies. Add it to the project: npm i -D electron-builder`);
  fs.rmSync(path.join(stage, 'dist'), { recursive: true, force: true });
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  run(q(bin), args, { cwd: stage, env });
}

function archFlag(arch) { return `--${arch}`; }

function parseTargets(opts) {
  const list = [];
  if (opts.mac || opts.all) list.push('mac');
  if (opts.win || opts.all) list.push('win');
  if (opts.linux) list.push('linux');
  if (!list.length) list.push(HOST === 'win32' ? 'win' : HOST === 'linux' ? 'linux' : 'mac');
  for (const t of list) {
    if (t === 'mac' && HOST !== 'darwin') fail('Mac apps can only be built on a Mac (or with the GitHub workflow).');
  }
  return list;
}
const archFor = (app, tKey, opts) => opts.arch || (tKey === 'mac' ? app.macArch || hostArch() : tKey === 'win' ? app.winArch || 'x64' : hostArch());

// build: each app's own installers (whatever its package.json "build" config makes)
function cmdBuild(which, opts) {
  if (!which) fail('Which app? e.g. ./utility build ro3 --win   (or: ./utility build all --all)');
  const results = [];
  for (const tKey of parseTargets(opts)) {
    for (const app of pickApps(which)) {
      const arch = archFor(app, tKey, opts);
      step(`Build ${app.name} for ${TARGETS[tKey].label} (${arch})`);
      const { stage, pkg, cross } = stageApp(app, tKey, arch);
      const args = [TARGETS[tKey].flag, archFlag(arch), '--publish', 'never'];
      if (cross) args.push('-c.npmRebuild=false');
      electronBuilder(stage, args);
      const out = path.join(P.releases, 'apps', app.id, pkg.version, tKey);
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      const dist = path.join(stage, 'dist');
      const files = fs.readdirSync(dist).filter((f) => /\.(dmg|zip|exe|msi|pkg|AppImage|deb)$/i.test(f));
      for (const f of files) fs.copyFileSync(path.join(dist, f), path.join(out, f));
      if (!files.length) {
        // app only produces an unpacked app (e.g. Relay on Mac) — ship that, zipped
        const unpacked = findUnpacked(dist, tKey);
        if (unpacked) { const z = path.join(out, `${productName(pkg)}-${pkg.version}-${tKey}-${arch}.zip`); makeZip(unpacked.item, z); files.push(path.basename(z)); }
      }
      files.forEach((f) => ok(path.relative(ROOT, path.join(out, f))));
      results.push(...files.map((f) => path.join(out, f)));
    }
  }
  return results;
}

// find the unpacked app electron-builder made with the "dir" target
function findUnpacked(dist, tKey) {
  if (!fs.existsSync(dist)) return null;
  for (const d of fs.readdirSync(dist)) {
    const full = path.join(dist, d);
    if (!fs.statSync(full).isDirectory()) continue;
    if (tKey === 'mac' && d.startsWith('mac')) {
      const app = fs.readdirSync(full).find((n) => n.endsWith('.app'));
      if (app) return { item: path.join(full, app), name: app };
    }
    if ((tKey === 'win' || tKey === 'linux') && d.endsWith('unpacked')) return { item: full, name: d };
  }
  return null;
}

// ───────────────────────── suite ─────────────────────────
function suiteVersion() {
  const d = new Date();
  const base = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  let v = base, n = 2;
  while (fs.existsSync(path.join(P.releases, 'suite', v))) v = `${base}-${n++}`;
  return v;
}

const isHub = (a) => a.role === 'hub';

function cmdSuite(opts) {
  if (!opts.classic) return cmdHubSuite(opts);
  const m = manifest();
  const targets = parseTargets(opts);
  const apps = pickApps(opts.apps || 'all').filter((a) => !isHub(a));
  const version = opts.version || suiteVersion();
  const relDir = path.join(P.releases, 'suite', version);
  const outputs = [];
  log(bold(`\n${m.suiteName} ${version}`) + dim(`  —  ${apps.map((a) => a.name).join(', ')}`));

  for (const tKey of targets) {
    const built = [];
    for (const app of apps) {
      const arch = archFor(app, tKey, opts);
      step(`${app.name} → ${TARGETS[tKey].label} (${arch})`);
      const { stage, pkg, cross } = stageApp(app, tKey, arch);
      const args = [TARGETS[tKey].flag, 'dir', archFlag(arch), '--publish', 'never'];
      if (tKey === 'mac') args.push('-c.mac.identity=null');
      if (cross) args.push('-c.npmRebuild=false');
      electronBuilder(stage, args);
      const u = findUnpacked(path.join(stage, 'dist'), tKey);
      if (!u) fail(`Couldn't find the built ${app.name} in ${path.join(stage, 'dist')}`);
      const exe = tKey === 'win' ? fs.readdirSync(u.item).find((f) => f.toLowerCase() === `${productName(pkg).toLowerCase()}.exe`) || fs.readdirSync(u.item).find((f) => f.endsWith('.exe') && !/^(Uninstall|elevate)/i.test(f)) : null;
      built.push({ app, pkg, arch, ...u, exe });
      ok(`${productName(pkg)} ${pkg.version}`);
    }

    step(`Packaging ${m.suiteName} for ${TARGETS[tKey].label}`);
    const info = {
      suiteName: m.suiteName, version, platform: tKey, builtAt: new Date().toISOString(), publisher: m.publisher,
      apps: built.map((b) => ({ id: b.app.id, name: productName(b.pkg), version: b.pkg.version, arch: b.arch, description: b.app.description || b.pkg.description || '', ...(b.exe ? { folder: productName(b.pkg), exe: b.exe } : { bundle: b.name }) })),
    };
    const platDir = path.join(relDir, tKey);
    fs.mkdirSync(platDir, { recursive: true });
    writeJSON(path.join(platDir, 'suite-info.json'), info);

    if (tKey === 'mac') outputs.push(assembleMac(m, version, built, platDir, info));
    else if (tKey === 'win') outputs.push(assembleWin(m, version, built, platDir, info));
    else outputs.push(assembleGenericZip(m, version, built, platDir, info, tKey));
  }

  writeReleaseNotes(relDir, version, m, apps);
  writeJSON(path.join(P.releases, 'suite', 'latest.json'), { version, outputs: outputs.map((o) => path.relative(P.releases, o)) });
  log('');
  outputs.forEach((o) => log(`  ${green('✓')} ${bold(path.relative(ROOT, o))}  ${dim(fmtSize(fs.statSync(o).size))}`));
  log(dim(`\n  Copy that file to the new computer and follow "READ ME FIRST.txt" inside it.`));
  return outputs;
}

// ───────────────────────── hub bundle (default) ─────────────────────────
// One download per OS:
//   Utility Hub(.app)        the app manager: installs itself, then lets you pick apps
//   Packages/catalog.json    what's inside (versions, checksums, notes)
//   Packages/<id>-<ver>-<os>-<arch>.zip, Packages/icons/<id>.png
//   READ ME FIRST.txt  (+ Install.cmd on Windows, Applications shortcut on Mac)
function buildDir(app, tKey, opts) {
  const arch = archFor(app, tKey, opts);
  step(`${app.name} → ${TARGETS[tKey].label} (${arch})`);
  const { stage, pkg, cross } = stageApp(app, tKey, arch);
  const args = [TARGETS[tKey].flag, 'dir', archFlag(arch), '--publish', 'never'];
  if (tKey === 'mac') args.push('-c.mac.identity=null');
  if (cross) args.push('-c.npmRebuild=false');
  electronBuilder(stage, args);
  const u = findUnpacked(path.join(stage, 'dist'), tKey);
  if (!u) fail(`Couldn't find the built ${app.name} in ${path.join(stage, 'dist')}`);
  const name = productName(pkg);
  const exe = tKey === 'mac' ? null : fs.readdirSync(u.item).find((f) => f.toLowerCase() === `${name.toLowerCase()}${tKey === 'win' ? '.exe' : ''}`)
    || fs.readdirSync(u.item).find((f) => f.endsWith('.exe') && !/^(Uninstall|elevate)/i.test(f));
  ok(`${name} ${pkg.version}`);
  return { app, pkg, arch, stage, name, exe, item: u.item, bundle: tKey === 'mac' ? u.name : null };
}

// zip one item (an .app or a folder) so the zip's top entry is that item
function zipItem(item, outZip, { forWindows = false } = {}) {
  fs.rmSync(outZip, { force: true });
  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  if (HOST === 'darwin') run('ditto', ['-c', '-k', ...(forWindows ? ['--norsrc', '--noextattr', '--noacl'] : []), '--keepParent', item, outZip]);
  else if (IS_WIN) run('tar', ['-a', '-c', '-f', q(outZip), '-C', q(path.dirname(item)), q(path.basename(item))]);
  else run('zip', ['-qry', outZip, path.basename(item)], { cwd: path.dirname(item) });
}

const sha256 = (f) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex'))); });

function notesFor(app, version) {
  const text = fs.existsSync(P.changelog) ? fs.readFileSync(P.changelog, 'utf8') : '';
  const out = [];
  for (const line of text.split('\n')) {
    const mm = line.match(/^- .*?\*\*(.+?) ([^*\s]+)\*\*(?: \([^)]*\))?(?: — (.+))?$/);
    if (mm && mm[1] === app.name && mm[2] === version && mm[3]) out.push(mm[3].trim());
  }
  return [...new Set(out)];
}

// Zip one built app (an .app on Mac, a folder on Windows) into outDir and describe it for a catalog.
async function packageEntry(b, tKey, outDir, scratch, { iconPrefix = 'icons/' } = {}) {
  const fileName = `${b.app.id}-${b.pkg.version}-${tKey}-${b.arch}.zip`;
  fs.mkdirSync(scratch, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const item = path.join(scratch, tKey === 'mac' ? b.bundle : b.name); // e.g. "RO3.app" or folder "RO3"
  copyTree(b.item, item);
  if (tKey === 'mac') run('codesign', ['--force', '--deep', '--sign', '-', item], { quiet: true }); // ad-hoc sign so Apple Silicon will launch it
  const zipPath = path.join(outDir, fileName);
  zipItem(item, zipPath, { forWindows: tKey === 'win' });
  fs.rmSync(item, { recursive: true, force: true });
  const iconSrc = path.join(b.stage, 'build', 'icon.png');
  let icon = null;
  if (fs.existsSync(iconSrc)) {
    icon = `${iconPrefix}${b.app.id}.png`;
    fs.mkdirSync(path.dirname(path.join(outDir, icon)), { recursive: true });
    fs.copyFileSync(iconSrc, path.join(outDir, icon));
  }
  return {
    id: b.app.id, name: b.name, version: b.pkg.version, arch: b.arch,
    description: b.app.description || b.pkg.description || '', appId: b.pkg.build?.appId || null,
    file: fileName, sha256: await sha256(zipPath), size: fs.statSync(zipPath).size, icon,
    ...(tKey === 'mac' ? { bundle: b.bundle } : { folder: b.name, exe: b.exe }),
    notes: notesFor(b.app, b.pkg.version),
  };
}

async function cmdHubSuite(opts) {
  const m = manifest();
  const targets = parseTargets(opts);
  const hubApp = m.apps.find(isHub);
  if (!hubApp) fail('Utility Hub isn\'t registered in suite.json (an app with "role": "hub").');
  if (!fs.existsSync(path.join(P.apps, hubApp.id, 'package.json'))) fail(`apps/${hubApp.id} (Utility Hub) is missing.`);
  const apps = pickApps(opts.apps || 'all').filter((a) => !isHub(a));
  const version = opts.version || suiteVersion();
  const relDir = path.join(P.releases, 'suite', version);
  const outputs = [];
  log(bold(`\n${m.suiteName} ${version}`) + dim(`  —  Utility Hub + ${apps.map((a) => a.name).join(', ')}`));

  for (const tKey of targets) {
    const built = apps.map((a) => buildDir(a, tKey, opts));
    const hub = buildDir(hubApp, tKey, opts);

    step(`Packaging ${m.suiteName} for ${TARGETS[tKey].label}`);
    const platDir = path.join(relDir, tKey);
    const label = { mac: 'mac', win: 'windows-x64', linux: 'linux' }[tKey];
    const bundleName = `${m.suiteName.replace(/\s+/g, '-')}-${version}-${label}`;
    const root = path.join(platDir, tKey === 'mac' ? m.suiteName : bundleName);
    const pk = path.join(root, 'Packages');
    const scratch = path.join(P.build, 'bundle-scratch', tKey);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(path.join(pk, 'icons'), { recursive: true });

    // the hub itself sits at the top of the bundle
    const hubDest = path.join(root, tKey === 'mac' ? hub.bundle : hub.name);
    copyTree(hub.item, hubDest);
    if (tKey === 'mac') run('codesign', ['--force', '--deep', '--sign', '-', hubDest], { quiet: true });

    const entries = [];
    for (const b of built) {
      const e = await packageEntry(b, tKey, pk, scratch, { iconPrefix: 'icons/' });
      entries.push(e);
      ok(`${b.name} ${b.pkg.version} packaged ${dim(fmtSize(e.size))}`);
    }
    const catalog = {
      format: 1, suiteName: m.suiteName, suiteVersion: version, platform: tKey, builtAt: new Date().toISOString(), publisher: m.publisher,
      hub: { version: hub.pkg.version, path: `../${path.basename(hubDest)}`, ...(hub.exe ? { exe: hub.exe } : {}) },
      apps: entries,
    };
    writeJSON(path.join(pk, 'catalog.json'), catalog);
    writeJSON(path.join(platDir, 'catalog.json'), catalog);

    const tplDir = path.join(P.installer, 'hub');
    const readme = fill(fs.readFileSync(path.join(tplDir, tKey === 'win' ? 'windows.txt' : 'mac.txt'), 'utf8'), {
      suite: m.suiteName, version, apps: entries.map((e) => `  • ${e.name} ${e.version} — ${e.description}`).join('\n'),
    });
    if (tKey === 'win') {
      fs.writeFileSync(path.join(root, 'READ ME FIRST.txt'), readme.replace(/\r?\n/g, '\r\n'));
      fs.writeFileSync(path.join(root, 'Install.cmd'), `@echo off\r\nrem Opens Utility Hub, which installs itself and the apps you pick.\r\nstart "" "%~dp0${path.basename(hubDest)}\\${hub.exe}"\r\n`);
    } else fs.writeFileSync(path.join(root, 'READ ME FIRST.txt'), readme);

    let out;
    if (tKey === 'mac') {
      fs.symlinkSync('/Applications', path.join(root, 'Applications'));
      out = path.join(platDir, `${bundleName}.dmg`);
      fs.rmSync(out, { force: true });
      run('hdiutil', ['create', '-volname', `${m.suiteName} ${version}`, '-srcfolder', root, '-ov', '-format', 'UDZO', '-quiet', out]);
    } else {
      out = path.join(platDir, `${bundleName}.zip`);
      zipItem(root, out, { forWindows: tKey === 'win' });
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    outputs.push(out);
  }

  writeReleaseNotes(relDir, version, m, apps);
  writeJSON(path.join(P.releases, 'suite', 'latest.json'), { version, outputs: outputs.map((o) => path.relative(P.releases, o)) });
  log('');
  outputs.forEach((o) => log(`  ${green('✓')} ${bold(path.relative(ROOT, o))}  ${dim(fmtSize(fs.statSync(o).size))}`));
  log(dim('\n  Copy it to the other computer and open Utility Hub inside it. On a computer that already has the hub,\n  just put it in Downloads (or a watched folder) and the hub offers the updates.'));
  return outputs;
}

// ───────────────────────── GitHub: setup and publish ─────────────────────────
// Source lives in a GitHub repo. Built apps live as assets on one rolling release (tag "packages"):
//   catalog-mac.json, catalog-win.json             what's current, per OS (Utility Hub reads these)
//   <id>-<version>-<os>-<arch>.zip, <id>.png        one package per app per OS, plus its icon
//   Utility-Hub-Setup-mac.zip / -windows.zip        stable links for installing the hub on a new computer
// `publish` builds only apps whose version is newer than what's published.
const RELEASE_TAG = 'packages';
const OS_LABEL = { mac: 'Mac', win: 'Windows', linux: 'Linux' };

// the GitHub CLI: a private copy in tools/bin (set up by "Set Up GitHub.command"), or one installed on the system
const GH = fs.existsSync(path.join(ROOT, 'tools', 'bin', IS_WIN ? 'gh.exe' : 'gh')) ? path.join(ROOT, 'tools', 'bin', IS_WIN ? 'gh.exe' : 'gh') : 'gh';
const hasGh = () => GH !== 'gh' || has('gh');
function gh(args, opts = {}) { return run(q(GH), args, { quiet: true, ...opts }); }
function needGh() {
  if (!hasGh()) fail('The GitHub CLI isn\'t set up yet. Double-click "Set Up GitHub.command" in the Utility Package folder.');
  if (gh(['auth', 'status'], { allowFail: true }).status !== 0) fail('You\'re not signed in to GitHub yet. Double-click "Set Up GitHub.command" in the Utility Package folder.');
}
function feedConfig() {
  const u = manifest().updates;
  return u?.repo ? { repo: u.repo, release: u.release || RELEASE_TAG, base: `https://github.com/${u.repo}/releases/download/${u.release || RELEASE_TAG}` } : null;
}

async function cmdGithub(name, opts) {
  if (!has('git')) fail('git isn\'t installed. On a Mac run: xcode-select --install');
  needGh();
  const m = manifest();
  if (!fs.existsSync(path.join(ROOT, '.git'))) { run('git', ['init', '-b', 'main'], { cwd: ROOT, quiet: true }); ok('Started a git repo in this folder'); }
  if (!run('git', ['config', 'user.name'], { cwd: ROOT, quiet: true, allowFail: true }).stdout?.trim()) {
    const login = gh(['api', 'user', '-q', '.login'], { allowFail: true }).stdout?.trim() || 'utility';
    run('git', ['config', 'user.name', m.publisher || login], { cwd: ROOT, quiet: true });
    run('git', ['config', 'user.email', `${login}@users.noreply.github.com`], { cwd: ROOT, quiet: true });
  }
  const hasOrigin = run('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, quiet: true, allowFail: true }).status === 0;
  if (!hasOrigin) {
    if (!name) fail('Give the new repo a name, e.g.: ./utility github utility-package');
    step(`Creating ${opts.private ? 'private' : 'public'} GitHub repo "${name}"`);
    gh(['repo', 'create', name, opts.private ? '--private' : '--public', '--source', ROOT, '--remote', 'origin',
      '--description', `${m.suiteName}: ${m.apps.map((a) => a.name).join(', ')}`], { cwd: ROOT });
  }
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: ROOT }).stdout.trim();
  m.updates = { repo, release: RELEASE_TAG };
  writeJSON(P.manifest, m);
  const hub = m.apps.find(isHub);
  if (hub) writeJSON(path.join(appDir(hub), 'feed.json'), { repo, release: RELEASE_TAG });
  ok(`Connected to github.com/${repo}`);

  step('Pushing the source');
  run('git', ['add', '-A'], { cwd: ROOT, quiet: true });
  run('git', ['commit', '-q', '-m', 'Utility Package'], { cwd: ROOT, quiet: true, allowFail: true });
  run('git', ['push', '-u', 'origin', 'main'], { cwd: ROOT });
  if (gh(['release', 'view', RELEASE_TAG, '--repo', repo], { allowFail: true }).status !== 0) {
    gh(['release', 'create', RELEASE_TAG, '--repo', repo, '--title', m.suiteName, '--notes', 'Built apps for Utility Hub. Nothing published yet.', '--latest']);
  }
  ok(`Source is at https://github.com/${repo}`);
  log(dim('\n  Next: ./utility publish   (builds every app the first time, then only what changed)'));
}

async function loadPublishedCatalog(tKey, cfg, local) {
  if (local) return readJSON(path.join(local, `catalog-${tKey}.json`), null);
  const url = `${cfg.base}/catalog-${tKey}.json?t=${Date.now()}`;
  let res;
  try { res = await fetch(url, { cache: 'no-store' }); } catch (e) { fail(`Couldn't reach GitHub to read the current ${OS_LABEL[tKey]} catalog (${e.message}). Check your connection and try again.`); }
  if (res.status === 404) return null;
  if (!res.ok) fail(`GitHub answered ${res.status} for ${url}. Try again in a minute.`);
  return res.json();
}

async function cmdPublish(opts) {
  const m = manifest();
  const local = opts.local ? path.resolve(String(opts.local).replace(/^~/, os.homedir())) : null; // publish into a folder instead (testing, or a shared drive)
  const cfg = feedConfig();
  if (!local && !cfg) fail('Not connected to GitHub yet. Run: ./utility github <repo-name>');
  if (!local) needGh();
  const targets = opts.mac || opts.win || opts.linux || opts.all ? parseTargets(opts) : HOST === 'darwin' ? ['mac', 'win'] : parseTargets({});
  const pick = opts.apps ? pickApps(opts.apps) : m.apps;
  const out = path.join(P.build, 'publish');
  const scratch = path.join(P.build, 'publish-scratch');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const files = [], catalogs = [], shipped = [], failed = [], keep = new Set();
  for (const tKey of targets) {
    const current = await loadPublishedCatalog(tKey, cfg, local);
    const cat = current && current.apps ? current : { format: 1, apps: [] };
    const published = (app) => (isHub(app) ? cat.hub?.version : cat.apps.find((a) => a.id === app.id)?.version);
    const todo = pick.filter((app) => {
      const v = pkgOf(appDir(app))?.version;
      if (!v) { warn(`${app.name}: apps/${app.id} has no package.json; skipped`); return false; }
      return opts.force || !published(app) || compareVersions(v, published(app)) > 0;
    });
    log(bold(`\n${OS_LABEL[tKey]}`) + dim(todo.length ? `  —  publishing ${todo.map((a) => `${a.name} ${pkgOf(appDir(a)).version}`).join(', ')}` : '  —  everything is already published'));
    if (!todo.length) { for (const a of cat.apps) keep.add(a.file); if (cat.hub?.file) keep.add(cat.hub.file); continue; }
    if (opts['dry-run']) continue;

    for (const app of todo) {
      let b, e;
      try {
        b = buildDir(app, tKey, opts);
        e = await packageEntry(b, tKey, out, scratch, { iconPrefix: '' });
      } catch (err) {
        failed.push(`${app.name} (${OS_LABEL[tKey]}): ${String(err.message || err).split('\n')[0]}`);
        warn(`${app.name} didn't build for ${OS_LABEL[tKey]}; skipping it this time.`);
        continue;
      }
      files.push(path.join(out, e.file));
      if (e.icon) files.push(path.join(out, e.icon));
      if (isHub(app)) {
        cat.hub = { version: e.version, file: e.file, sha256: e.sha256, size: e.size, ...(e.bundle ? { bundle: e.bundle } : { folder: e.folder, exe: e.exe }) };
        files.push(makeHubSetup(b, tKey, out, scratch, e));
      } else {
        cat.apps = [...cat.apps.filter((a) => a.id !== e.id), e].sort((x, y) => x.name.localeCompare(y.name));
      }
      shipped.push(`${e.name} ${e.version} (${OS_LABEL[tKey]})`);
      ok(`${e.name} ${e.version} ready ${dim(fmtSize(e.size))}`);
    }
    Object.assign(cat, { format: 1, feed: true, suiteName: m.suiteName, publisher: m.publisher, platform: tKey, updatedAt: new Date().toISOString() });
    const catFile = path.join(out, `catalog-${tKey}.json`);
    writeJSON(catFile, cat);
    catalogs.push(catFile);
    for (const a of cat.apps) keep.add(a.file);
    if (cat.hub?.file) keep.add(cat.hub.file);
  }
  if (opts['dry-run'] || !catalogs.length) { log(dim(opts['dry-run'] ? '\n  (dry run: nothing built or uploaded)' : '')); return; }
  // never prune packages that belong to an OS this run didn't touch
  for (const other of ['mac', 'win'].filter((t) => !targets.includes(t))) {
    const c = await loadPublishedCatalog(other, cfg, local);
    for (const a of c?.apps || []) keep.add(a.file);
    if (c?.hub?.file) keep.add(c.hub.file);
  }

  step(local ? `Copying into ${local}` : `Uploading to github.com/${cfg.repo}`);
  if (local) {
    fs.mkdirSync(local, { recursive: true });
    for (const f of [...files, ...catalogs]) fs.copyFileSync(f, path.join(local, path.basename(f))); // catalogs last
    for (const f of fs.readdirSync(local)) if (/^[a-z0-9-]+-\d[^/]*\.zip$/.test(f) && !keep.has(f)) fs.rmSync(path.join(local, f));
  } else {
    if (gh(['release', 'view', RELEASE_TAG, '--repo', cfg.repo], { allowFail: true }).status !== 0) {
      gh(['release', 'create', RELEASE_TAG, '--repo', cfg.repo, '--title', m.suiteName, '--notes', ' ', '--latest']);
    }
    // packages first, catalogs last, so a hub never sees a catalog pointing at a file that isn't there yet
    run(q(GH), ['release', 'upload', RELEASE_TAG, ...files, '--clobber', '--repo', cfg.repo]);
    run(q(GH), ['release', 'upload', RELEASE_TAG, ...catalogs, '--clobber', '--repo', cfg.repo]);
    const assets = gh(['release', 'view', RELEASE_TAG, '--repo', cfg.repo, '--json', 'assets', '-q', '.assets[].name']).stdout.split('\n').filter(Boolean);
    for (const a of assets) {
      if (/^[a-z0-9-]+-\d[^/]*\.zip$/.test(a) && !keep.has(a)) { gh(['release', 'delete-asset', RELEASE_TAG, a, '--repo', cfg.repo, '-y'], { allowFail: true }); log(dim(`  removed old ${a}`)); }
    }
    const notes = path.join(out, 'release-notes.md');
    fs.writeFileSync(notes, releaseNotes(m, cfg, catalogs.map((c) => readJSON(c, {}))));
    gh(['release', 'edit', RELEASE_TAG, '--repo', cfg.repo, '--notes-file', notes, '--title', m.suiteName]);
  }
  shipped.forEach((x) => ok(x));
  if (failed.length) { log(red('\n  Not published (fix and run publish again):')); failed.forEach((f) => log(red(`    ${f}`))); }

  if (!local && fs.existsSync(path.join(ROOT, '.git'))) {
    step('Pushing the source');
    run('git', ['add', '-A'], { cwd: ROOT, quiet: true });
    run('git', ['commit', '-q', '-m', `Publish: ${[...new Set(shipped.map((x) => x.replace(/ \(.*\)$/, '')))].join(', ')}`], { cwd: ROOT, quiet: true, allowFail: true });
    run('git', ['push'], { cwd: ROOT, allowFail: true });
  }
  log(dim(`\n  Every Utility Hub that checks for updates now sees ${shipped.length === 1 ? 'it' : 'these'}.`));
}

// The download a new computer starts from: just Utility Hub, which then installs apps online.
function makeHubSetup(b, tKey, out, scratch, entry) {
  if (tKey !== 'win') {
    const dst = path.join(out, `Utility-Hub-Setup-${tKey}.zip`);
    fs.copyFileSync(path.join(out, entry.file), dst); // the signed Utility Hub.app, zipped
    return dst;
  }
  const root = path.join(scratch, 'Utility Hub Setup');
  fs.rmSync(root, { recursive: true, force: true });
  copyTree(b.item, path.join(root, b.name));
  fs.writeFileSync(path.join(root, 'Install.cmd'), `@echo off\r\nrem Opens Utility Hub, which installs itself and the apps you pick.\r\nstart "" "%~dp0${b.name}\\${b.exe}"\r\n`);
  fs.writeFileSync(path.join(root, 'READ ME FIRST.txt'), [
    'Utility Hub for Windows', '', '1. Right-click this zip, Extract All (do not run it from inside the zip).',
    '2. Double-click Install.cmd. If Windows shows "Windows protected your PC", click More info, then Run anyway.',
    '3. Utility Hub sets itself up. Tick the apps you want and click Install. It downloads them for you,',
    '   and from then on it updates them whenever a new version is published.', '',
  ].join('\r\n'));
  const dst = path.join(out, 'Utility-Hub-Setup-windows.zip');
  zipItem(root, dst, { forWindows: true });
  fs.rmSync(root, { recursive: true, force: true });
  return dst;
}

function releaseNotes(m, cfg, cats) {
  const url = (f) => `${cfg.base}/${f}`;
  const rows = {};
  for (const c of cats) for (const a of c.apps || []) rows[a.id] = { ...(rows[a.id] || {}), name: a.name, desc: a.description, [c.platform]: a.version };
  return [
    `## ${m.suiteName}`, '',
    'Install **Utility Hub** once. It installs the apps you pick and keeps them up to date.', '',
    `- **Mac:** [Utility-Hub-Setup-mac.zip](${url('Utility-Hub-Setup-mac.zip')}). Open the zip, then right-click **Utility Hub** and choose Open. If macOS refuses, go to System Settings, then Privacy & Security, then Open Anyway.`,
    `- **Windows:** [Utility-Hub-Setup-windows.zip](${url('Utility-Hub-Setup-windows.zip')}). Extract it and run **Install.cmd**. If SmartScreen appears, click More info, then Run anyway.`,
    '', 'The apps aren\'t code-signed, so that first-launch warning is expected.', '',
    '| App | What it does | Mac | Windows |', '|---|---|---|---|',
    ...Object.values(rows).sort((a, b) => a.name.localeCompare(b.name)).map((r) => `| ${r.name} | ${r.desc || ''} | ${r.mac || '—'} | ${r.win || '—'} |`),
    '', `_Updated ${new Date().toISOString().slice(0, 10)}. Files below are what Utility Hub downloads; you don't need them directly._`,
  ].join('\n');
}

function fill(template, vars) { return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''); }
function appList(info) { return info.apps.map((a) => `  • ${a.name} ${a.version} — ${a.description}`).join('\n'); }

function assembleMac(m, version, built, platDir, info) {
  const folder = path.join(platDir, m.suiteName);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  for (const b of built) {
    const dest = path.join(folder, b.name);
    copyTree(b.item, dest);
    run('codesign', ['--force', '--deep', '--sign', '-', dest], { quiet: true }); // ad-hoc sign so Apple Silicon will launch it
  }
  const tpl = path.join(P.installer, 'mac');
  const inst = path.join(folder, 'Install All.command');
  fs.copyFileSync(path.join(tpl, 'Install All.command'), inst);
  fs.chmodSync(inst, 0o755);
  fs.writeFileSync(path.join(folder, 'READ ME FIRST.txt'), fill(fs.readFileSync(path.join(tpl, 'READ ME FIRST.txt'), 'utf8'), { suite: m.suiteName, version, apps: appList(info) }));
  fs.symlinkSync('/Applications', path.join(folder, 'Applications'));
  const dmg = path.join(platDir, `${m.suiteName.replace(/\s+/g, '-')}-${version}-mac.dmg`);
  fs.rmSync(dmg, { force: true });
  run('hdiutil', ['create', '-volname', `${m.suiteName} ${version}`, '-srcfolder', folder, '-ov', '-format', 'UDZO', '-quiet', dmg]);
  fs.rmSync(folder, { recursive: true, force: true });
  return dmg;
}

function assembleWin(m, version, built, platDir, info) {
  const name = `${m.suiteName.replace(/\s+/g, '-')}-${version}-windows-x64`;
  const folder = path.join(platDir, name);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(path.join(folder, 'apps'), { recursive: true });
  for (const b of built) copyTree(b.item, path.join(folder, 'apps', productName(b.pkg)));
  const tpl = path.join(P.installer, 'windows');
  for (const f of ['Install.cmd', 'install.ps1', 'uninstall.ps1']) fs.copyFileSync(path.join(tpl, f), path.join(folder, f));
  writeJSON(path.join(folder, 'suite-info.json'), info);
  const readme = fill(fs.readFileSync(path.join(tpl, 'READ ME FIRST.txt'), 'utf8'), { suite: m.suiteName, version, apps: appList(info) });
  fs.writeFileSync(path.join(folder, 'READ ME FIRST.txt'), readme.replace(/\r?\n/g, '\r\n'));
  const zip = path.join(platDir, `${name}.zip`);
  makeZip(folder, zip);
  fs.rmSync(folder, { recursive: true, force: true });
  return zip;
}

function assembleGenericZip(m, version, built, platDir, info, tKey) {
  const name = `${m.suiteName.replace(/\s+/g, '-')}-${version}-${tKey}`;
  const folder = path.join(platDir, name);
  fs.rmSync(folder, { recursive: true, force: true });
  for (const b of built) copyTree(b.item, path.join(folder, 'apps', productName(b.pkg)));
  writeJSON(path.join(folder, 'suite-info.json'), info);
  const zip = path.join(platDir, `${name}.zip`);
  makeZip(folder, zip);
  fs.rmSync(folder, { recursive: true, force: true });
  return zip;
}

function writeReleaseNotes(relDir, version, m, apps) {
  const ports = readJSON(P.ports, {});
  const lines = [`# ${m.suiteName} ${version}`, '', `Built ${new Date().toLocaleString()}`, '', '| App | Version | Last ported |', '|---|---|---|'];
  for (const a of apps) {
    const v = pkgOf(path.join(P.apps, a.id))?.version || '?';
    lines.push(`| ${a.name} | ${v} | ${ports[a.id]?.portedAt ? ports[a.id].portedAt.slice(0, 10) : '—'} |`);
  }
  fs.mkdirSync(relDir, { recursive: true });
  fs.writeFileSync(path.join(relDir, 'RELEASE-NOTES.md'), lines.join('\n') + '\n');
}

const fmtSize = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(0)} MB`);

// ───────────────────────── add / adopt / note ─────────────────────────
// add: copy a project (folder or source .zip) into apps/<id>; from then on it's developed there.
function cmdAdd(projectPath, opts) {
  if (!projectPath) fail('Usage: ./utility add <project folder or source .zip> [--id myapp] [--exclude "Big Data,dist-win"]');
  const abs = path.resolve(projectPath.replace(/^~/, os.homedir()));
  const extra = String(opts.exclude || '').split(',').map((x) => x.trim()).filter(Boolean);
  const probe = { id: 'probe', source: abs, exclude: extra };
  const src = openSource(probe);
  if (src.missing) fail(`Not found: ${abs}`);
  const m = manifest();
  let app;
  try {
    const pkg = pkgOf(src.dir);
    if (!pkg) fail('No package.json there — point at the project folder (the one with package.json).');
    const id = (opts.id || pkg.name || productName(pkg)).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (m.apps.some((a) => a.id === id)) fail(`An app with id "${id}" is already registered.`);
    if (fs.existsSync(path.join(P.apps, id))) fail(`apps/${id} already exists.`);
    app = { id, name: productName(pkg), description: pkg.description || '', macArch: 'arm64', winArch: 'x64', exclude: extra, movedFrom: abs.startsWith(os.homedir()) ? '~' + abs.slice(os.homedir().length) : abs };
    if (!pkg.devDependencies?.['electron-builder']) warn('This project has no electron-builder devDependency — builds will need it (npm i -D electron-builder).');
    step(`Add ${app.name}`);
    const d = mirror(src.dir, path.join(P.apps, id), excludesFor(app));
    ok(`Copied ${d.added.length} files into apps/${id} (skipped node_modules, dist, .git, .env${extra.length ? ', ' + extra.join(', ') : ''})`);
    appendChangelog(app, pkg.version, d, opts.note || 'Added to the Utility Package');
  } finally { src.cleanup(); }
  m.apps.push(app);
  writeJSON(P.manifest, m);
  ok(`${app.name} now lives in apps/${app.id}`);
  log(dim(`  Develop it there (cd apps/${app.id} && npm install && npm start). The old folder is no longer used.`));
  gitCommit(`Add ${app.name}`);
}

// adopt: an app still developed elsewhere gets a final port, then apps/<id> becomes its home.
function cmdAdopt(which, opts) {
  if (!which) fail('Which app? e.g. ./utility adopt fresh-desk   (or: ./utility adopt all)');
  const m = manifest();
  for (const app of pickApps(which)) {
    if (inPlace(app)) { ok(`${app.name} already lives in apps/${app.id}`); continue; }
    const src = expandHome(app.source);
    if (!fs.existsSync(src) && !opts.force) { warn(`${app.name}: ${app.source} not found. Use --force to adopt the copy already in apps/${app.id}.`); continue; }
    if (fs.existsSync(src)) cmdPort(app.id, { note: opts.note });
    const entry = m.apps.find((a) => a.id === app.id);
    entry.movedFrom = entry.source;
    delete entry.source;
    writeJSON(P.manifest, m);
    ok(`${app.name} now lives in apps/${app.id}. ${app.source} is no longer used.`);
  }
  gitCommit(`Adopt ${which}`);
}

// note: record what changed in an app's current version (shown as "What's new" in Utility Hub)
function cmdNote(which, text) {
  if (!which || !text) fail('Usage: ./utility note <app> "what changed"');
  const [app] = pickApps(which);
  const v = pkgOf(appDir(app))?.version;
  if (!v) fail(`apps/${app.id} has no package.json`);
  appendChangelog(app, v, { changed: [], added: [], removed: [] }, text);
  ok(`Noted for ${app.name} ${v}: ${text}`);
}

// ───────────────────────── doctor ─────────────────────────
function cmdDoctor() {
  step('Checking this computer');
  const nodeMajor = +process.versions.node.split('.')[0];
  (nodeMajor >= 20 ? ok : warn)(`Node ${process.versions.node}${nodeMajor < 20 ? ' — please install Node 20 or newer from nodejs.org' : ''}`);
  const npmV = run('npm', ['-v'], { quiet: true, allowFail: true }).stdout?.trim();
  const [maj, min] = (npmV || '0.0').split('.').map(Number);
  (maj > 10 || (maj === 10 && min >= 4) ? ok : warn)(`npm ${npmV || 'missing'}${maj < 10 || (maj === 10 && min < 4) ? ' — update for cross-building Windows apps: npm i -g npm' : ''}`);
  if (HOST === 'darwin') {
    (has('hdiutil') ? ok : warn)('hdiutil (makes the Mac DMG)');
    (has('codesign') ? ok : warn)('codesign (ad-hoc signing so apps open on Apple Silicon)');
  }
  (has('git') ? ok : warn)(has('git') ? 'git' : 'git not found — needed to push to GitHub (xcode-select --install)');
  (hasGh() ? ok : warn)(hasGh() ? `GitHub CLI${feedConfig() ? ` (publishing to github.com/${feedConfig().repo})` : ' (not connected yet: ./utility github <repo-name>)'}` : 'GitHub CLI not found — needed to publish (https://cli.github.com, then gh auth login)');
  step('Checking apps');
  for (const app of manifest().apps) {
    if (inPlace(app)) { const okp = fs.existsSync(path.join(appDir(app), 'package.json')); (okp ? ok : warn)(`${app.name}: apps/${app.id}${okp ? '' : '  ← package.json missing'}`); continue; }
    const src = expandHome(app.source);
    (fs.existsSync(src) ? ok : warn)(`${app.name}: still developed in ${app.source}${fs.existsSync(src) ? ' (run ./utility adopt ' + app.id + ' to move it in)' : '  ← not found'}`);
  }
  try {
    const free = fs.statfsSync(ROOT);
    const gb = (free.bavail * free.bsize) / 1e9;
    (gb > 10 ? ok : warn)(`${gb.toFixed(0)} GB free${gb <= 10 ? ' — builds need roughly 5–10 GB of working space' : ''}`);
  } catch {}
}

// ───────────────────────── interactive menu ─────────────────────────
async function cmdMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (s) => new Promise((r) => rl.question(s, r));
  const m = manifest();
  const choices = [
    ['See each app\'s version and what\'s ready to ship', () => cmdStatus()],
    ['Write a "What\'s new" note for an app', async () => { const a = await pickOne(ask, m); if (a) { const t = (await ask(`  What changed in ${a.name}? `)).trim(); if (t) cmdNote(a.id, t); } }],
    ['Build the Mac suite (Utility Hub + every app, one DMG)', () => cmdSuite({ mac: true })],
    ['Build the Windows suite (Utility Hub + every app, one zip)', () => cmdSuite({ win: true })],
    ['Build both Mac and Windows suites', () => cmdSuite({ all: true })],
    ['Build one app\'s own installers', async () => { const a = await pickOne(ask, m); if (a) { const p = (await ask('  [m]ac, [w]indows or [b]oth? ')).trim().toLowerCase(); cmdBuild(a.id, { mac: p !== 'w', win: p !== 'm' }); } }],
    ['Check this computer is ready (doctor)', () => cmdDoctor()],
    ['Open the releases folder', () => openPath(P.releases)],
  ];
  for (;;) {
    log(`\n${bold(m.suiteName + ' — Utility Package')}`);
    choices.forEach(([label], i) => log(`  ${cyan(i + 1)}  ${label}`));
    log(`  ${cyan('q')}  Quit`);
    const a = (await ask('\nChoose: ')).trim().toLowerCase();
    if (a === 'q' || a === '') break;
    const ch = choices[+a - 1];
    if (!ch) continue;
    try { await ch[1](); } catch (e) { log(red(`\n  ${e instanceof UserError ? e.message : e.stack}`)); }
  }
  rl.close();
}
async function pickOne(ask, m) {
  m.apps.forEach((a, i) => log(`    ${i + 1}  ${a.name}`));
  return m.apps[+(await ask('  Which app? ')) - 1];
}
function openPath(p) {
  fs.mkdirSync(p, { recursive: true });
  spawnSync(HOST === 'darwin' ? 'open' : IS_WIN ? 'explorer' : 'xdg-open', [p], { stdio: 'ignore' });
}

// ───────────────────────── main ─────────────────────────
function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) opts[k] = v;
      else if (['note', 'arch', 'id', 'apps', 'version', 'exclude', 'text', 'local'].includes(k)) opts[k] = argv[++i];
      else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

const HELP = `
${bold('Utility Package')} — one home for every app project

  ${cyan('./utility status')}                   each app's version vs the last suite, and what's ready to ship
  ${cyan('./utility note <app> "…"')}           record what changed in the app's current version ("What's new" in the hub)
  ${cyan('./utility publish')}                  build every app whose version went up (Mac + Windows) and post it to GitHub;
                                     every Utility Hub sees the update
        --apps ro3,datum  --dry-run  --force   --local <folder> (post to a folder instead)
  ${cyan('./utility github <repo-name>')}       one-time: create the GitHub repo (public; --private) and push the source
  ${cyan('./utility suite')}                    build Utility Hub + every app into ONE download per OS (offline / USB)
        --mac  --win  --all          choose platforms (Windows can be built from a Mac)
        --apps ro3,datum             only some apps (an update bundle; the hub is always included)
        --classic                    the older Install All / Install.cmd bundle, without the hub
  ${cyan('./utility build <app|all>')}          build an app's own installers (its .dmg / Setup .exe)
        --mac  --win  --all  --arch arm64|x64|universal
  ${cyan('./utility add <project folder>')}     copy a new app into apps/<id> (it's developed there from then on)
        --exclude "Data Folder"      leave personal data folders behind
  ${cyan('./utility adopt <app>')}              move an app still developed elsewhere into apps/<id>
  ${cyan('./utility port <app>')}               (apps developed elsewhere only) copy in their latest source
        --from-old                   one-off: pull late edits from an app's old folder after it moved in
  ${cyan('./utility doctor')}                   check this computer has what builds need
  ${cyan('./utility menu')}                     interactive menu

  Apps: ${(() => { try { return manifest().apps.map((a) => a.id).join(', '); } catch { return '?'; } })()}
`;

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = pos;
  switch (cmd) {
    case 'status': return cmdStatus();
    case 'port': return cmdPort(arg, opts);
    case 'build': return cmdBuild(arg, opts);
    case 'suite': return cmdSuite(opts);
    case 'add': return cmdAdd(arg, opts);
    case 'adopt': return cmdAdopt(arg, opts);
    case 'note': return cmdNote(arg, pos.slice(2).join(' ') || opts.text);
    case 'github': return cmdGithub(arg, opts);
    case 'publish': return cmdPublish(opts);
    case 'doctor': return cmdDoctor();
    case 'menu': return cmdMenu();
    case undefined: case 'help': case '--help': case '-h': return log(HELP);
    default: fail(`Unknown command "${cmd}". Run ./utility help`);
  }
}

main().catch((e) => {
  console.error(red(`\n✗ ${e instanceof UserError ? e.message : e.stack}`));
  process.exit(1);
});

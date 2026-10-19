// Kiln — installing, updating, launching and stopping packages, plus their extensions.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ipcMain, shell, net, app } = require('electron');
const core = require('../core');
const tools = require('../tools');
const links = require('./links');
const { CATALOG, byId } = require('./catalog');

let send = () => {};
const runtime = new Map();   // pkgId -> { proc, state, url, profileId, startedAt }
const logs = new Map();      // pkgId -> string[] (console, last N lines)
const jobs = new Map();      // pkgId -> { kind, state, step, error }
const pending = new Map();   // pkgId -> queued lines for the window
const MAX_LINES = 5000;

const pkgs = () => core.g().packages;
const getPkg = (id) => pkgs().find(p => p.id === id);
const catOf = (p) => byId[p?.catalogId] || null;

/* ---------- console ---------- */
function log(id, line) {
  if (line == null) return;
  const arr = logs.get(id) || [];
  for (const l of String(line).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/)) {
    arr.push(l);
    const q = pending.get(id) || [];
    q.push(l); pending.set(id, q);
  }
  if (arr.length > MAX_LINES) arr.splice(0, arr.length - MAX_LINES);
  logs.set(id, arr);
}
setInterval(() => {
  for (const [id, q] of pending) { if (q.length) send('pkg:log', { id, lines: q.splice(0) }); }
}, 120);

function status(id) {
  const r = runtime.get(id), j = jobs.get(id);
  return { id, state: j && j.state === 'working' ? 'working' : r?.state || 'stopped', url: r?.url || null, profileId: r?.profileId || null, job: j || null, startedAt: r?.startedAt || null };
}
function emit(id) { send('pkg:status', status(id)); }

/* ---------- paths ---------- */
function constraintsFile() {
  // pip and uv split these environment variables on spaces, so the file must live at a path without any
  // ("Kiln Files" has one). The temp folder has none on macOS and normally none on Windows.
  const f = path.join(require('os').tmpdir(), 'kiln-pip-constraints.txt');
  const want = 'setuptools<81\n';
  try { if (fs.readFileSync(f, 'utf8') === want) return f; } catch {}
  fs.writeFileSync(f, want);
  return f;
}
// Environment for pip/uv inside a package: keep build tools old enough for packages that still use pkg_resources
function pipEnv() {
  const f = constraintsFile();
  if (/\s/.test(f)) return {};
  return { PIP_CONSTRAINT: f, PIP_BUILD_CONSTRAINT: f, UV_BUILD_CONSTRAINT: f };
}
function venvDir(p) {
  for (const v of [p.venv, 'venv', '.venv'].filter(Boolean)) if (fs.existsSync(path.join(p.path, v))) return path.join(p.path, v);
  return path.join(p.path, p.venv || 'venv');
}
function venvPython(p) { return path.join(venvDir(p), tools.IS_WIN ? 'Scripts' : 'bin', tools.IS_WIN ? 'python.exe' : 'python'); }
function uniqueDir(base) {
  let d = base, n = 2;
  while (fs.existsSync(d)) d = `${base}-${n++}`;
  return d;
}

/* ---------- jobs (install, update, repair) ---------- */
async function job(id, kind, fn) {
  if (jobs.get(id)?.state === 'working') throw new Error('Already working on this package');
  const j = { kind, state: 'working', step: '', error: null, startedAt: Date.now() };
  jobs.set(id, j); emit(id);
  const step = (s) => { j.step = s; log(id, `\n▸ ${s}`); emit(id); };
  try {
    await fn(step);
    j.state = 'done'; j.step = '';
    log(id, `✓ ${kind === 'install' ? 'Installed' : kind === 'update' ? 'Updated' : 'Done'}`);
  } catch (e) {
    j.state = 'failed'; j.error = e.message;
    log(id, `✕ ${e.message}`);
  }
  emit(id);
  core.saveGlobal();
  return j;
}
async function must(id, cmd, args, opts = {}) {
  log(id, `$ ${path.basename(cmd)} ${args.join(' ')}`);
  const code = await tools.run(cmd, args, { ...opts, onLine: (l) => log(id, l) });
  if (code !== 0) throw new Error(`${path.basename(cmd)} ${args[0]} failed (exit code ${code}). The console above has the details.`);
}

async function prepareEnv(p, step) {
  const c = catOf(p);
  const id = p.id;
  const uv = await tools.ensureUv((s) => log(id, s));
  const env = { ...tools.uvEnv(), ...pipEnv() };
  const ver = p.python || c?.python || '3.11';
  if (!fs.existsSync(venvPython(p))) {
    step(`Setting up Python ${ver}`);
    await must(id, uv, ['python', 'install', ver], { env });
    await must(id, uv, ['venv', path.join(p.path, p.venv || 'venv'), '--python', ver, '--seed'], { env, cwd: p.path });
  }
  const py = venvPython(p);
  if (c?.torch === 'kiln') {
    const gpu = await tools.detectGpu();
    const idx = tools.TORCH_INDEX[p.torch || gpu.torch];
    step(`Installing PyTorch (${(p.torch || gpu.torch).toUpperCase()})`);
    await must(id, uv, ['pip', 'install', '--python', py, 'torch', 'torchvision', 'torchaudio', ...(idx ? ['--index-url', idx] : [])], { env, cwd: p.path });
  }
  if (c?.requirements && fs.existsSync(path.join(p.path, c.requirements))) {
    step('Installing requirements');
    const gpu = await tools.detectGpu();
    const idx = c?.torch === 'kiln' ? tools.TORCH_INDEX[p.torch || gpu.torch] : null;
    await must(id, uv, ['pip', 'install', '--python', py, '-r', c.requirements, ...(idx ? ['--extra-index-url', idx, '--index-strategy', 'unsafe-best-match'] : [])], { env, cwd: p.path });
  }
}

async function gitHead(p) {
  const git = await tools.findGit();
  if (!git || !fs.existsSync(path.join(p.path, '.git'))) return null;
  const r = await tools.capture(git, ['-C', p.path, 'rev-parse', 'HEAD']);
  return r.ok ? r.out.trim() : null;
}

function uniqueName(n) { let out = n, i = 2; while (pkgs().some(p => p.name === out)) out = `${n} ${i++}`; return out; }
async function install({ catalogId, name, branch, folder, python, torch }) {
  const c = byId[catalogId];
  if (!c) throw new Error('Unknown package');
  const dir = uniqueDir(path.join(core.packagesDir(), folder || c.id));
  const p = {
    id: core.uid(), catalogId, name: uniqueName(name || c.name), path: dir, branch: branch || c.branch, python: python || c.python, torch: torch || null,
    venv: 'venv', options: defaultOptions(c), extraArgs: '', autoOpen: true, installedAt: null, commit: null, updateAvailable: 0, lastCheck: null, imported: null
  };
  pkgs().push(p); core.saveGlobal();
  send('pkg:list', list());
  job(p.id, 'install', async (step) => {
    const git = await tools.ensureGit((s) => log(p.id, s));
    step(`Downloading ${c.name}`);
    await must(p.id, git, ['clone', '--branch', p.branch, c.repo, dir]);
    await prepareEnv(p, step);
    if (c.fooocus) { step('Pointing Fooocus at your library'); }
    p.commit = await gitHead(p);
    p.installedAt = Date.now();
    log(p.id, `\n${c.name} is ready. Press Launch to start it.`);
  }).then(() => send('pkg:list', list()));
  return p;
}
async function repair(id) {
  const p = getPkg(id);
  if (!p) throw new Error('Package not found');
  return job(id, 'repair', async (step) => {
    if (!fs.existsSync(path.join(p.path, '.git')) && catOf(p)) {
      const git = await tools.ensureGit((s) => log(id, s));
      step('Downloading files again');
      fs.mkdirSync(p.path, { recursive: true });
      await must(id, git, ['clone', '--branch', p.branch, catOf(p).repo, p.path]);
    }
    await prepareEnv(p, step);
    p.installedAt = p.installedAt || Date.now();
    p.commit = await gitHead(p);
  });
}

async function checkUpdate(id) {
  const p = getPkg(id);
  const git = await tools.findGit();
  if (!p || !git || !fs.existsSync(path.join(p.path, '.git'))) return { updateAvailable: 0 };
  const br = p.branch || (await tools.capture(git, ['-C', p.path, 'rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
  const f = await tools.capture(git, ['-C', p.path, 'fetch', 'origin', br], { timeout: 60000 });
  if (!f.ok) return { updateAvailable: p.updateAvailable || 0, error: 'Couldn’t reach GitHub' };
  const r = await tools.capture(git, ['-C', p.path, 'rev-list', '--count', `HEAD..origin/${br}`]);
  p.updateAvailable = r.ok ? Number(r.out.trim()) || 0 : 0;
  p.lastCheck = Date.now();
  core.saveGlobal();
  send('pkg:list', list());
  return { updateAvailable: p.updateAvailable };
}
async function update(id) {
  const p = getPkg(id);
  if (!p) throw new Error('Package not found');
  if (runtime.get(id)?.state === 'running' || runtime.get(id)?.state === 'starting') throw new Error('Stop the package before updating it');
  return job(id, 'update', async (step) => {
    const git = await tools.ensureGit((s) => log(id, s));
    const br = p.branch || 'HEAD';
    step('Getting the latest version');
    await must(id, git, ['-C', p.path, 'fetch', 'origin', br]);
    const code = await tools.run(git, ['-C', p.path, 'merge', '--ff-only', `origin/${br}`], { onLine: (l) => log(id, l) });
    if (code !== 0) {
      log(id, 'Local changes block a clean update. Saving them with git stash and trying again…');
      await must(id, git, ['-C', p.path, 'stash', '--include-untracked']);
      await must(id, git, ['-C', p.path, 'merge', '--ff-only', `origin/${br}`]);
    }
    const c = catOf(p);
    if (c?.requirements) await prepareEnv(p, step);
    p.commit = await gitHead(p);
    p.updateAvailable = 0;
  }).then((j) => { send('pkg:list', list()); return j; });
}

async function uninstall(id, { deleteFiles }) {
  const p = getPkg(id);
  if (!p) return list();
  await stop(id);
  if (deleteFiles && fs.existsSync(p.path)) {
    links.removeAllLinks(p.path);   // never send library models to the trash with it
    try { await shell.trashItem(p.path); }
    catch { await fs.promises.rm(p.path, { recursive: true, force: true }); }
  }
  core.g().packages = pkgs().filter(x => x.id !== id);
  logs.delete(id); jobs.delete(id);
  core.saveGlobal();
  return list();
}

/* ---------- launching ---------- */
function defaultOptions(c) { return Object.fromEntries((c.options || []).map(o => [o.flag, o.default])); }
function splitArgs(s) {
  const out = []; let cur = '', q = null;
  for (const ch of String(s || '')) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function buildArgs(p) {
  const c = catOf(p);
  const args = [];
  for (const o of c?.options || []) {
    const v = p.options?.[o.flag] ?? o.default;
    if (o.type === 'bool') { if (v) args.push(o.flag); }
    else if (v !== '' && v != null) args.push(o.flag, String(v));
  }
  return [...args, ...splitArgs(p.extraArgs)];
}

function connectToProfile(p, a) {
  const c = catOf(p);
  const libRoot = a.library?.path;
  if (!libRoot) { log(p.id, 'This profile has no model library yet.'); return; }
  core.ensureLibraryFolders(libRoot);
  const out = a.outputsDir;
  const l = (s) => log(p.id, s);
  log(p.id, `Using ${a.profile.name}’s models (${libRoot})`);
  if (c?.comfy) {
    links.writeComfyPaths(p.path, libRoot);
  } else if (c?.fooocus) {
    links.writeFooocusPaths(p.path, libRoot, out);
  } else {
    links.applyLinks(p.path, c?.models, (f) => path.join(libRoot, f), l);
    if (p.shareOutputs !== false) links.applyLinks(p.path, c?.outputs, (f) => path.join(out, f), l);
  }
}

async function launch(id) {
  const p = getPkg(id);
  if (!p) throw new Error('Package not found');
  const cur = runtime.get(id);
  if (cur && (cur.state === 'running' || cur.state === 'starting')) return status(id);
  if (jobs.get(id)?.state === 'working') throw new Error('Wait for the current install or update to finish');
  const a = core.active();
  if (!a) throw new Error('Pick a profile first');
  const c = catOf(p);
  const py = venvPython(p);
  if (!fs.existsSync(py)) throw new Error('Its Python environment is missing. Use Repair to set it up again.');
  try { connectToProfile(p, a); } catch (e) { log(id, 'Linking models failed: ' + e.message); }

  const args = [c?.launch || 'launch.py', ...buildArgs(p)];
  // Apple Silicon: A1111-style UIs assume CUDA. These are the flags their own webui-macos-env.sh uses.
  if (process.platform === 'darwin' && c?.backend === 'a1111' && c.id !== 'sdnext') {
    for (const f of ['--skip-torch-cuda-test', '--upcast-sampling', '--no-half-vae']) if (!args.includes(f)) args.push(f);
    if (!args.includes('--use-cpu')) args.push('--use-cpu', 'interrogate');
  }
  if (c?.comfy) {
    args.push('--extra-model-paths-config', path.join(p.path, 'extra_model_paths.yaml'));
    args.push('--output-directory', core.ensureDir(path.join(a.outputsDir, 'ComfyUI')));
    if (!args.includes('--disable-auto-launch')) args.push('--disable-auto-launch');
  }
  const git = await tools.findGit();
  const uv = await tools.findUv();
  const bin = path.dirname(py);
  const sep = tools.IS_WIN ? ';' : ':';
  const PATH = [bin, ...tools.gitPathDirs(git), uv ? path.dirname(uv) : null, process.env.PATH || process.env.Path].filter(Boolean).join(sep);
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/^path$/i.test(k)) delete base[k];
  const env = {
    ...base, ...tools.uvEnv(), ...pipEnv(), ...(p.env || {}),
    PATH, VIRTUAL_ENV: venvDir(p), PYTHONUNBUFFERED: '1',
    ...(process.platform === 'darwin' ? { PYTORCH_ENABLE_MPS_FALLBACK: '1', ...(c?.backend === 'a1111' && c.id !== 'sdnext' ? { TORCH_COMMAND: 'pip install torch torchvision', TORCH_INDEX_URL: 'https://pypi.org/simple' } : {}) } : {}), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
    ...(git ? { GIT: git } : {})
  };
  delete env.PYTHONHOME; delete env.ELECTRON_RUN_AS_NODE;
  log(id, `\n▸ Starting ${p.name}\n$ python ${args.join(' ')}`);
  const proc = spawn(py, args, { cwd: p.path, env, windowsHide: true, detached: !tools.IS_WIN });
  const r = { proc, state: 'starting', url: null, profileId: a.profile.id, profileName: a.profile.name, outputsDir: a.outputsDir, startedAt: Date.now() };
  runtime.set(id, r); emit(id);
  const URL_RE = /(https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::\]):\d+)/i;
  const onLine = (l) => {
    log(id, l);
    if (!r.url) {
      const m = l.match(URL_RE);
      if (m && !/download|fetch|pip|huggingface/i.test(l)) { r.url = m[1].replace('0.0.0.0', '127.0.0.1').replace('[::]', '127.0.0.1'); waitReady(id, r); }
    }
  };
  const split = (buf) => (d) => { buf.s += d.toString(); const parts = buf.s.split(/\r?\n|\r(?!\n)/); buf.s = parts.pop(); parts.forEach(onLine); };
  proc.stdout.on('data', split({ s: '' }));
  proc.stderr.on('data', split({ s: '' }));
  proc.on('error', (e) => { log(id, '✕ ' + e.message); r.state = 'error'; emit(id); });
  proc.on('close', (code) => {
    log(id, `\n■ ${p.name} stopped${code ? ` (exit code ${code})` : ''}`);
    r.state = code && r.state !== 'stopping' ? 'error' : 'stopped';
    r.url = null; r.proc = null; emit(id);
  });
  return status(id);
}
async function waitReady(id, r) {
  for (let i = 0; i < 240 && runtime.get(id) === r && r.state === 'starting'; i++) {
    try { const res = await net.fetch(r.url, { method: 'GET' }); if (res.status < 500) { r.state = 'running'; break; } } catch {}
    await new Promise(s => setTimeout(s, 500));
  }
  if (r.state === 'starting' && r.proc) r.state = 'running';
  emit(id);
  if (r.state === 'running') send('pkg:ready', { id, url: r.url, autoOpen: getPkg(id)?.autoOpen !== false });
}
async function stop(id) {
  const r = runtime.get(id);
  if (!r?.proc) return status(id);
  r.state = 'stopping'; emit(id);
  tools.killTree(r.proc.pid);
  await new Promise((res) => { const t = setTimeout(res, 6000); r.proc?.once('close', () => { clearTimeout(t); res(); }); });
  return status(id);
}
function stopAll() { for (const [, r] of runtime) if (r.proc) { try { tools.killTree(r.proc.pid); } catch {} } }
function running() { return [...runtime.entries()].filter(([, r]) => r.state === 'running' || r.state === 'starting').map(([id, r]) => ({ id, url: r.url, state: r.state, name: getPkg(id)?.name, backend: catOf(getPkg(id))?.backend || null, profileId: r.profileId, profileName: r.profileName, outputsDir: r.outputsDir })); }

/* ---------- extensions ---------- */
function extDir(p) { const c = catOf(p); return c?.extensions ? path.join(p.path, c.extensions.dir) : null; }
function gitRemote(dir) {
  try {
    const cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
    const m = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
function a1111Disabled(p) {
  try { return JSON.parse(fs.readFileSync(path.join(p.path, 'config.json'), 'utf8')).disabled_extensions || []; } catch { return []; }
}
function listExtensions(id) {
  const p = getPkg(id);
  const d = p && extDir(p);
  if (!d || !fs.existsSync(d)) return [];
  const disabledA = catOf(p)?.comfy ? [] : a1111Disabled(p);
  return fs.readdirSync(d, { withFileTypes: true })
    .filter(e => e.isDirectory() && !/^(__pycache__|\.)/.test(e.name))
    .map(e => {
      const name = e.name.replace(/\.disabled$/, '');
      return { name, folder: e.name, url: gitRemote(path.join(d, e.name)), enabled: !e.name.endsWith('.disabled') && !disabledA.includes(name) };
    }).sort((a, b) => a.name.localeCompare(b.name));
}
async function installExtension(id, url) {
  const p = getPkg(id);
  const d = p && extDir(p);
  if (!d) throw new Error('This package doesn’t support extensions');
  if (!/^https?:\/\/\S+$/.test(url)) throw new Error('Paste a Git repository link (https://github.com/…)');
  fs.mkdirSync(d, { recursive: true });
  const name = url.replace(/\.git$/, '').split('/').filter(Boolean).pop();
  const target = path.join(d, name);
  if (fs.existsSync(target)) throw new Error(`${name} is already installed`);
  return job(id, 'extension', async (step) => {
    const git = await tools.ensureGit((s) => log(id, s));
    step(`Installing ${name}`);
    await must(id, git, ['clone', '--depth', '1', url, target]);
    if (catOf(p)?.extensions?.requirements && fs.existsSync(path.join(target, 'requirements.txt'))) {
      const uv = await tools.ensureUv();
      step(`Installing ${name}’s requirements`);
      await must(id, uv, ['pip', 'install', '--python', venvPython(p), '-r', path.join(target, 'requirements.txt')], { env: tools.uvEnv() });
    }
    log(id, `${name} installed. Restart ${p.name} to load it.`);
  });
}
async function updateExtension(id, folder) {
  const p = getPkg(id);
  const t = path.join(extDir(p), folder);
  return job(id, 'extension', async (step) => {
    const git = await tools.ensureGit();
    step(`Updating ${folder}`);
    await must(id, git, ['-C', t, 'pull', '--ff-only']);
  });
}
async function removeExtension(id, folder) {
  const p = getPkg(id);
  const t = path.join(extDir(p), folder);
  if (fs.existsSync(t)) await shell.trashItem(t).catch(() => fs.promises.rm(t, { recursive: true, force: true }));
  return listExtensions(id);
}
function toggleExtension(id, folder, enabled) {
  const p = getPkg(id);
  const d = extDir(p);
  if (catOf(p)?.comfy) {
    const base = folder.replace(/\.disabled$/, '');
    fs.renameSync(path.join(d, folder), path.join(d, enabled ? base : base + '.disabled'));
  } else {
    const file = path.join(p.path, 'config.json');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const set = new Set(cfg.disabled_extensions || []);
    if (enabled) set.delete(folder); else set.add(folder);
    cfg.disabled_extensions = [...set];
    fs.writeFileSync(file, JSON.stringify(cfg, null, 4));
  }
  return listExtensions(id);
}
const INDEX_URLS = {
  a1111: 'https://raw.githubusercontent.com/AUTOMATIC1111/stable-diffusion-webui-extensions/master/index.json',
  comfy: 'https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json'
};
const indexCache = {};
async function extensionIndex(id) {
  const p = getPkg(id);
  const kind = catOf(p)?.extensions?.index;
  if (!kind) return [];
  if (indexCache[kind] && Date.now() - indexCache[kind].at < 6 * 3600e3) return indexCache[kind].items;
  const file = path.join(app.getPath('userData'), `ext-index-${kind}.json`);
  let raw = null;
  try { raw = await (await net.fetch(INDEX_URLS[kind])).json(); fs.writeFileSync(file, JSON.stringify(raw)); }
  catch { try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = null; } }
  if (!raw) throw new Error('Couldn’t load the extension list. Check your connection.');
  let items = [];
  if (kind === 'a1111') items = (raw.extensions || []).map(e => ({ name: e.name, url: e.url, description: e.description || '', tags: e.tags || [], author: (e.url || '').split('/')[3] || '' }));
  else items = (raw.custom_nodes || []).filter(e => e.install_type === 'git-clone' && (e.reference || e.files?.[0])).map(e => ({ name: e.title, url: e.files?.[0] || e.reference, description: e.description || '', tags: [], author: e.author || '' }));
  indexCache[kind] = { at: Date.now(), items };
  return items;
}

/* ---------- public ---------- */
function publicPkg(p) {
  const c = catOf(p);
  return {
    ...p, catalog: c ? { id: c.id, name: c.name, backend: c.backend, options: c.options, extensions: !!c.extensions, blurb: c.blurb, repo: c.repo } : null,
    exists: fs.existsSync(p.path), hasVenv: fs.existsSync(venvPython(p)), status: status(p.id)
  };
}
function list() { return pkgs().map(publicPkg); }

function register(ctx) {
  send = ctx.send;
  ipcMain.handle('pkg:catalog', () => CATALOG.map(c => ({ id: c.id, mac: c.mac, name: c.name, author: c.author, blurb: c.blurb, tags: c.tags, repo: c.repo, branch: c.branch, python: c.python, backend: c.backend })));
  ipcMain.handle('pkg:list', () => list());
  ipcMain.handle('pkg:install', (_e, opts) => install(opts).then(publicPkg));
  ipcMain.handle('pkg:repair', (_e, id) => repair(id));
  ipcMain.handle('pkg:check-update', (_e, id) => checkUpdate(id));
  ipcMain.handle('pkg:update', (_e, id) => update(id));
  ipcMain.handle('pkg:uninstall', (_e, { id, deleteFiles }) => uninstall(id, { deleteFiles }));
  ipcMain.handle('pkg:launch', (_e, id) => launch(id));
  ipcMain.handle('pkg:stop', (_e, id) => stop(id));
  ipcMain.handle('pkg:running', () => running());
  ipcMain.handle('pkg:log', (_e, id) => logs.get(id) || []);
  ipcMain.handle('pkg:clear-log', (_e, id) => { logs.set(id, []); return true; });
  ipcMain.handle('pkg:save', (_e, { id, patch }) => {
    const p = getPkg(id);
    if (!p) return null;
    for (const k of ['name', 'options', 'extraArgs', 'autoOpen', 'env', 'branch', 'shareOutputs', 'torch']) if (k in patch) p[k] = patch[k];
    core.saveGlobal();
    return publicPkg(p);
  });
  ipcMain.handle('pkg:args-preview', (_e, id) => { const p = getPkg(id); return p ? buildArgs(p).join(' ') : ''; });
  ipcMain.handle('pkg:open-folder', (_e, id) => { const p = getPkg(id); if (p) shell.openPath(p.path); });
  ipcMain.handle('pkg:send-input', (_e, { id, text }) => { const r = runtime.get(id); if (r?.proc?.stdin?.writable) { r.proc.stdin.write(text + '\n'); log(id, '> ' + text); return true; } return false; });
  ipcMain.handle('ext:list', (_e, id) => listExtensions(id));
  ipcMain.handle('ext:index', (_e, id) => extensionIndex(id));
  ipcMain.handle('ext:install', (_e, { id, url }) => installExtension(id, url).then(() => listExtensions(id)));
  ipcMain.handle('ext:update', (_e, { id, folder }) => updateExtension(id, folder).then(() => listExtensions(id)));
  ipcMain.handle('ext:remove', (_e, { id, folder }) => removeExtension(id, folder));
  ipcMain.handle('ext:toggle', (_e, { id, folder, enabled }) => toggleExtension(id, folder, enabled));
}

module.exports = { register, list, getPkg, launch, stop, stopAll, running, status, venvPython, publicPkg, log };

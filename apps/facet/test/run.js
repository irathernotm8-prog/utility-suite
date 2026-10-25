// Facet — quick checks that need no GPU, no Electron and no downloads. Run: npm test
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

console.log('catalog');
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/catalog.json'), 'utf8'));
t('every model has the fields the app reads', () => {
  for (const m of cat.models) {
    for (const k of ['id', 'kind', 'name', 'short', 'label', 'tagline', 'blurb', 'sizeMB', 'license', 'licenseUrl', 'needs']) assert(m[k] != null, `${m.id} is missing ${k}`);
    assert(m.url ? m.dest : (m.repo && m.allow?.length), `${m.id} needs repo+allow or url+dest`);
  }
});
t('ids are unique', () => assert.strictEqual(new Set(cat.models.map(m => m.id)).size, cat.models.length));
t('shape engines have detail levels', () => { for (const m of cat.models.filter(m => m.kind === 'shape')) assert(m.detail?.length === 3, m.id); });
t('every shape engine is known to the Python worker', () => {
  const py = fs.readFileSync(path.join(ROOT, 'engine/facet_worker.py'), 'utf8');
  for (const m of cat.models.filter(m => m.kind === 'shape' && m.id !== 'triposr')) assert(py.includes(`"${m.id}"`), m.id);
  for (const m of cat.models.filter(m => m.kind === 'image')) assert(py.includes(`"${m.id}"`), m.id);
});
t('a background remover is required', () => assert(cat.models.some(m => m.kind === 'helper' && m.required)));

console.log('engine files');
t('requirements pin the libraries the worker imports', () => {
  const req = fs.readFileSync(path.join(ROOT, 'engine/requirements.txt'), 'utf8');
  for (const p of ['diffusers', 'transformers', 'trimesh', 'rembg', 'scikit-image', 'scipy', 'fast-simplification', 'omegaconf', 'einops', 'onnxruntime']) assert(new RegExp('^' + p + '\\b', 'm').test(req), p);
});
t('TripoSR is bundled with its licence and without torchmcubes', () => {
  assert(fs.existsSync(path.join(ROOT, 'engine/tsr/LICENSE')));
  assert(!fs.readFileSync(path.join(ROOT, 'engine/tsr/models/isosurface.py'), 'utf8').includes('from torchmcubes'));
});
t('the worker compiles', () => {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  try { execFileSync(py, ['-m', 'py_compile', path.join(ROOT, 'engine/facet_worker.py')], { stdio: 'pipe' }); }
  catch (e) { if (e.code === 'ENOENT') return; throw new Error(String(e.stderr || e.message)); }
});

t('texturing and rigging self-test (uses the engine Python when it is set up)', () => {
  const os = require('os');
  const base = process.env.FACET_PY || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Facet/Engine/python-env/bin/python')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Facet/Engine/python-env/Scripts/python.exe') : path.join(os.homedir(), '.config/Facet/Engine/python-env/bin/python'));
  if (!fs.existsSync(base)) { console.log('    (skipped: engine not set up on this computer)'); return; }
  try { execFileSync(base, [path.join(ROOT, 'engine/selftest.py')], { stdio: 'pipe', timeout: 300000 }); }
  catch (e) { if (e.status === 3) { console.log('    (skipped: engine needs an update)'); return; } throw new Error(String(e.stderr || e.stdout || e.message).slice(-800)); }
});

console.log('renderer');
t('every script the window imports exists', () => {
  const dir = path.join(ROOT, 'src/renderer');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/from '(\.\/[^']+)'/g)) assert(fs.existsSync(path.join(dir, m[1])), `${f} imports ${m[1]}`);
  }
  for (const f of fs.readdirSync(path.join(dir, 'vendor')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, 'vendor', f), 'utf8');
    assert(!/from 'three'/.test(src), `${f} still imports bare 'three'`);
  }
});
t('the icon is in place', () => assert(fs.statSync(path.join(ROOT, 'build/icon.png')).size > 50000));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

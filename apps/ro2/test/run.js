// RO2 quick checks (no window): every icon name exists, the model catalog is sound, shapes parse, the vendor files are there.
'use strict';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const R = path.join(__dirname, '..', 'src', 'renderer');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' · ' + e.message); } };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const src = walk(R).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(f, 'utf8')]);

t('vendor files present', () => {
  for (const f of ['vendor/fabric/fabric.min.mjs', 'vendor/ort/ort.webgpu.bundle.min.mjs', 'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm', 'vendor/lucide/icons.json', 'vendor/fonts/fonts.json']) assert(fs.existsSync(path.join(R, f)), f);
});
const icons = JSON.parse(fs.readFileSync(path.join(R, 'vendor/lucide/icons.json'), 'utf8'));
t('every icon name used in the UI exists', () => {
  const names = new Set();
  for (const [, s] of src) {
    for (const m of s.matchAll(/(?:ico|svgIcon)\('([a-z0-9-]+)'\)/g)) names.add(m[1]);
    for (const m of s.matchAll(/\bicon: '([a-z0-9-]+)'/g)) names.add(m[1]);
    for (const m of s.matchAll(/name: '([a-z0-9-]+)', color/g)) names.add(m[1]);
  }
  const el = src.find(([f]) => f.endsWith('elements.js'))[1];
  for (const m of el.match(/POPULAR_ICONS = \[([\s\S]*?)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)) names.add(m[1]);
  const ctx = src.find(([f]) => f.endsWith('ctxbar.js'))[1];
  for (const m of ctx.match(/aIcon = \{([^}]*)\}/)[1].matchAll(/'([a-z0-9-]+)'/g)) names.add(m[1]);
  const lay = src.find(([f]) => f.endsWith('layers.js'))[1];
  for (const m of lay.match(/KIND_ICON = \{([^}]*)\}/)[1].matchAll(/'([a-z0-9-]+)'/g)) names.add(m[1]);
  const missing = [...names].filter((n) => !icons[n]);
  assert(!missing.length, 'missing: ' + missing.join(', '));
  console.log(`    (${names.size} icons checked)`);
});
t('fonts: every family has files', () => {
  const f = JSON.parse(fs.readFileSync(path.join(R, 'vendor/fonts/fonts.json'), 'utf8'));
  assert(f.length >= 30); for (const x of f) { assert(Object.keys(x.files).length, x.family); for (const file of Object.values(x.files)) assert(fs.existsSync(path.join(R, 'vendor/fonts', file)), file); }
});
t('fonts used by templates and pairings are bundled', () => {
  const fams = new Set(JSON.parse(fs.readFileSync(path.join(R, 'vendor/fonts/fonts.json'), 'utf8')).map((x) => x.family));
  for (const [f, s] of src) for (const m of s.matchAll(/(?:font|fontFamily): '([A-Z][^'",]+)'/g)) assert(fams.has(m[1]), `${m[1]} in ${path.basename(f)}`);
});
t('model catalog: unique ids, sizes, files', () => {
  const Module = require('module'); const orig = Module._load;
  Module._load = function (req, ...a) { if (req === 'electron') return { net: {} }; return orig.call(this, req, ...a); };
  const { CATALOG } = require('../src/models.js'); Module._load = orig;
  const ids = new Set(); for (const m of CATALOG) { assert(!ids.has(m.id)); ids.add(m.id); assert(m.files.length && m.files.every((f) => f.size > 1e6 && /^https:/.test(f.url))); }
  for (const id of ['ormbg', 'lama', 'slimsam', 'ocr']) assert(ids.has(id), id);
  const worker = fs.readFileSync(path.join(R, 'js/ai/ai.worker.js'), 'utf8') + fs.readFileSync(path.join(R, 'js/ai/layerize.js'), 'utf8');
  for (const m of CATALOG) for (const f of m.files) assert(worker.includes(`'${f.name}'`) || worker.includes(`"${f.name}"`), `worker uses ${m.id}/${f.name}`);
});
t('brand kits: create, colours, logos, remove', () => {
  const os = require('os'); const { Brand } = require('../src/brand.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro2b-')); const b = new Brand(dir);
  const id = b.create('Acme').active; assert(id && b.get().kits.length >= 1);
  b.update(id, { colors: [{ hex: '#ff0066', name: 'Pink' }] }); assert.equal(b.kit(id).colors[0].hex, '#ff0066');
  b.addLogo(id, { name: 'Mark', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), ext: 'svg' });
  const l = b.kit(id).logos[0]; assert(l && b.logoData(id, l.id).svg.includes('<svg'));
  assert.throws(() => b.addLogo(id, { bytes: Buffer.from('x'), ext: 'exe' }));
  assert.equal(new Brand(dir).kit(id).colors.length, 1, 'reloads from disk');
  b.removeLogo(id, l.id); assert(!b.kit(id).logos.length);
  if (b.get().kits.length > 1) { b.remove(id); assert(!b.get().kits.some((x) => x.id === id)); }
});
t('shape paths are well formed', () => {
  const s = src.find(([f]) => f.endsWith('shapes.js'))[1];
  for (const m of s.matchAll(/\bd: '([^']+)'/g)) assert(/^M[\d .A-Z-]+$/i.test(m[1]), m[1].slice(0, 30));
});
t('every module imports resolve', () => {
  for (const [f, s] of src) for (const m of s.matchAll(/(?:import [^'"]*from |import\()\s*'(\.[^']+)'/g)) { const p = path.resolve(path.dirname(f), m[1]); assert(fs.existsSync(p), `${path.basename(f)} → ${m[1]}`); }
});
t('designs store: save, list, rename, duplicate', () => {
  const os = require('os'); const { Designs } = require('../src/designs.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro2t-')); const d = new Designs(path.join(dir, 'index.json'), () => path.join(dir, 'designs'));
  const data = JSON.stringify({ name: 'Test: one/two', width: 100, height: 50, pages: [{ objects: [] }], updated: 1 });
  const f = d.save({ name: 'Test: one/two', data }); assert(fs.existsSync(f) && !/[:/]two/.test(path.basename(f)));
  const f2 = d.save({ name: 'Test: one/two', data }); assert(f2 !== f, 'unique names');
  assert.equal(d.list().length, 2);
  const r = d.rename(f, 'Renamed'); assert(path.basename(r) === 'Renamed.ro2');
  const c = d.duplicate(r); assert(JSON.parse(fs.readFileSync(c, 'utf8')).name === 'Renamed copy');
  assert.equal(d.list().length, 3);
});
t('build config keeps the icon and the renderer', () => {
  const p = require('../package.json'); assert(p.build.files.includes('src/**/*') && p.build.files.includes('build/icon.png')); assert(fs.existsSync(path.join(__dirname, '..', 'build/icon.png')));
  assert(!p.dependencies || !Object.keys(p.dependencies).length, 'no runtime npm dependencies');
});
console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);

// Trace — quick Node checks for the parts that don't need a window: storage, folder scanning, layout, routing and file rules.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Store, imageSize } = require('../src/store');
const folders = require('../src/folders');
const L = require('../src/renderer/layout');
const R = require('../src/renderer/rules');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n    ')); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-test-'));

// a real 3×2 PNG
function png(w, h) {
  const crc = (buf) => { let c, crcs = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcs[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = crcs[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function noOverlap(nodes, pos) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = { ...pos.get(nodes[i].id), w: nodes[i].w, h: nodes[i].h }, b = { ...pos.get(nodes[j].id), w: nodes[j].w, h: nodes[j].h };
    if (overlaps(a, b)) throw new Error(`${nodes[i].id} overlaps ${nodes[j].id}`);
  }
}

console.log('storage');
const store = new Store(path.join(tmp, 'Library'));
let p;
t('create, list, load', () => {
  p = store.create({ name: 'Test', items: [{ id: 'a', type: 'note', title: 'N', html: '' }] });
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(store.list()[0].counts.note, 1);
  const { project, media } = store.load(p.id);
  assert.strictEqual(project.name, 'Test'); assert.deepStrictEqual(media, []);
});
t('save is atomic and updates time', () => {
  const { project } = store.load(p.id);
  project.items.push({ id: 'b', type: 'chart', title: 'C', nodes: [], edges: [] });
  const before = project.updated;
  store.save(project);
  const again = store.load(p.id).project;
  assert.strictEqual(again.items.length, 2);
  assert.ok(again.updated >= before);
  assert.ok(!fs.readdirSync(store.projectDir(p.id)).some((f) => f.endsWith('.tmp')));
});
t('rejects bad ids (no path tricks)', () => {
  assert.throws(() => store.load('../etc'));
  assert.throws(() => store.mediaFile(p.id, '../../project.json'));
  assert.throws(() => store.save({ id: '../x' }));
});
let m;
t('adds a PNG with its size and a sidecar', () => {
  m = store.addMedia(p.id, png(3, 2), { source: 'capture', name: 'Shot' });
  assert.strictEqual(m.w, 3); assert.strictEqual(m.h, 2); assert.ok(m.file.endsWith('.png'));
  assert.ok(fs.existsSync(store.mediaFile(p.id, m.file)));
  assert.strictEqual(store.listMedia(p.id).length, 1);
});
t('reads JPEG and GIF sizes', () => {
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0001108002a003c03012200021101031101', 'hex');
  assert.deepStrictEqual(imageSize(jpeg), { w: 60, h: 42, ext: 'jpg' });
  const gif = Buffer.from('474946383961' + '0a00' + '0500', 'hex');
  assert.deepStrictEqual(imageSize(Buffer.concat([gif, Buffer.alloc(8)])), { w: 10, h: 5, ext: 'gif' });
  assert.throws(() => store.addMedia(p.id, Buffer.from('not an image')));
});
t('updates annotations, crop and name only', () => {
  const u = store.updateMedia(p.id, m.id, { annotations: [{ id: 'x', t: 'box', x1: 0, y1: 0, x2: 1, y2: 1 }], crop: { x: 0, y: 0, w: 2, h: 2 }, name: 'Renamed', file: 'evil.png' });
  assert.strictEqual(u.annotations.length, 1); assert.strictEqual(u.crop.w, 2); assert.strictEqual(u.name, 'Renamed'); assert.strictEqual(u.file, m.file);
  assert.strictEqual(store.updateMedia(p.id, m.id, { crop: null }).crop, null);
  assert.strictEqual(store.mediaFiles(p.id, m.id).length, 2);
});

console.log('folders');
t('scans folders, counts file types, skips hidden and node_modules', () => {
  const root = path.join(tmp, 'Home');
  for (const d of ['Docs/Finance', 'Docs/Work', 'Design/Source', '.hidden', 'node_modules/x', 'Big.app/Contents']) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of ['Docs/a.pdf', 'Docs/b.pdf', 'Docs/c.txt', 'Docs/Finance/invoice.pdf', 'Design/Source/x.psd', 'readme']) fs.writeFileSync(path.join(root, f), 'x');
  const tree = folders.scan(root, { depth: 3 });
  assert.deepStrictEqual(tree.children.map((c) => c.name), ['Design', 'Docs']);
  const docs = tree.children[1];
  assert.deepStrictEqual(docs.counts, { '.pdf': 2, '.txt': 1 });
  assert.deepStrictEqual(docs.children.map((c) => c.name), ['Finance', 'Work']);
  assert.strictEqual(tree.counts['.app'], 1);
  assert.strictEqual(tree.counts['(none)'], 1);
  assert.deepStrictEqual(folders.topTypes(docs.counts, 1), [['.pdf', 2]]);
  const shallow = folders.scan(root, { depth: 1 });
  assert.strictEqual(shallow.children.length, 0); assert.strictEqual(shallow.more, 2);
});

console.log('layout');
const N = (id, w = 160, h = 56) => ({ id, w, h });
const E = (from, to) => ({ from, to });
t('vertical tree: children below, centred parent, no overlaps', () => {
  const nodes = [N('a'), N('b'), N('c'), N('d'), N('e', 220, 80)];
  const edges = [E('a', 'b'), E('a', 'c'), E('b', 'd'), E('b', 'e')];
  const r = L.layout(nodes, edges, { orientation: 'vertical' });
  noOverlap(nodes, r.pos);
  assert.ok(r.pos.get('b').y > r.pos.get('a').y + 56);
  assert.ok(r.pos.get('d').y > r.pos.get('b').y);
  assert.ok(r.pos.get('b').x < r.pos.get('c').x, 'children keep edge order');
});
t('horizontal: ranks go left to right', () => {
  const nodes = [N('a'), N('b'), N('c')];
  const r = L.layout(nodes, [E('a', 'b'), E('b', 'c')], { orientation: 'horizontal' });
  assert.ok(r.pos.get('b').x > r.pos.get('a').x + 160);
  assert.ok(r.pos.get('c').x > r.pos.get('b').x + 160);
  assert.strictEqual(r.pos.get('a').y, r.pos.get('c').y);
});
t('a step reached from two branches sits below both', () => {
  const nodes = [N('s'), N('l'), N('r'), N('r2'), N('end')];
  const r = L.layout(nodes, [E('s', 'l'), E('s', 'r'), E('r', 'r2'), E('l', 'end'), E('r2', 'end')]);
  assert.strictEqual(r.rank.get('end'), 3);
  noOverlap(nodes, r.pos);
});
t('loops back don’t break the layout', () => {
  const nodes = [N('a'), N('b'), N('c')];
  const r = L.layout(nodes, [E('a', 'b'), E('b', 'c'), E('c', 'a')]);
  assert.strictEqual(r.back.size, 1);
  assert.ok(r.rank.get('c') === 2);
  noOverlap(nodes, r.pos);
});
t('org chart: 4+ leaf reports stack in a column under their manager', () => {
  const nodes = [N('boss', 210, 60), N('m1', 210, 60), N('m2', 210, 60), ...['a', 'b', 'c', 'd'].map((x) => N(x, 210, 60)), N('z', 210, 60)];
  const edges = [E('boss', 'm1'), E('boss', 'm2'), ...['a', 'b', 'c', 'd'].map((x) => E('m1', x)), E('m2', 'z')];
  const r = L.layout(nodes, edges, { orientation: 'vertical' });
  assert.ok(r.stacked.has('m1'));
  assert.strictEqual(r.pos.get('a').x, r.pos.get('b').x);
  assert.ok(r.pos.get('b').y > r.pos.get('a').y);
  noOverlap(nodes, r.pos);
});
t('several separate charts side by side, no overlaps (random graphs)', () => {
  for (let seed = 1; seed < 40; seed++) {
    let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const n = 4 + Math.floor(rnd() * 30);
    const nodes = Array.from({ length: n }, (_, i) => N('n' + i, 100 + Math.floor(rnd() * 140), 40 + Math.floor(rnd() * 60)));
    const edges = [];
    for (let i = 1; i < n; i++) { if (rnd() < 0.85) edges.push(E('n' + Math.floor(rnd() * i), 'n' + i)); if (rnd() < 0.15) edges.push(E('n' + i, 'n' + Math.floor(rnd() * n))); }
    for (const o of ['vertical', 'horizontal']) noOverlap(nodes, L.layout(nodes, edges, { orientation: o }).pos);
  }
});
t('routes: forward elbow, curve and loop-back', () => {
  const a = { x: 0, y: 0, w: 100, h: 40 }, b = { x: 200, y: 120, w: 100, h: 40 };
  const r1 = L.route(a, b, { orientation: 'vertical', style: 'elbow', rankGap: 80 });
  assert.ok(r1.d.startsWith('M50,40')); assert.ok(r1.d.endsWith('L250,120')); assert.strictEqual(r1.lx, 250);
  const r2 = L.route(a, b, { orientation: 'horizontal', style: 'curve' });
  assert.ok(/^M100,20 C/.test(r2.d));
  const r3 = L.route(b, a, { orientation: 'vertical', style: 'elbow' });
  assert.ok(r3.back);
});
t('pathTo finds the way from the top', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const edges = [E('a', 'b'), E('b', 'c'), E('a', 'd'), E('d', 'c')];
  const p2 = L.pathTo(nodes, edges, 'c');
  assert.strictEqual(p2[0], 'a'); assert.strictEqual(p2[p2.length - 1], 'c'); assert.strictEqual(p2.length, 3);
  assert.deepStrictEqual(L.pathTo(nodes, edges, 'a'), ['a']);
  assert.strictEqual(L.pathTo(nodes, edges, 'zz'), null);
});
t('smooth zoom starts and ends where asked', () => {
  const i = L.interpolateZoom([0, 0, 1000], [500, 300, 400]);
  const s = i(0), e = i(1);
  assert.ok(Math.abs(s[0]) < 1e-6 && Math.abs(s[2] - 1000) < 1e-6);
  assert.ok(Math.abs(e[0] - 500) < 1e-6 && Math.abs(e[1] - 300) < 1e-6 && Math.abs(e[2] - 400) < 1e-6);
  assert.ok(i.duration > 0);
});

console.log('file rules');
const plan = [
  { id: 'docs', rules: ['.pdf', '.docx'] }, { id: 'fin', rules: ['invoice*', 'receipt'] }, { id: 'design', rules: ['.psd', '*.ai'] },
  { id: 'photos', rules: ['jpg', 'img_*'] }, { id: 'archive', rules: ['.zip'] }
];
t('extension, glob and keyword rules', () => {
  assert.strictEqual(R.match('notes.pdf', plan)[0].id, 'docs');
  assert.strictEqual(R.match('invoice-march.pdf', plan)[0].id, 'fin', 'specific name beats extension');
  assert.strictEqual(R.match('Store receipt 2026.png', plan)[0].id, 'fin');
  assert.strictEqual(R.match('logo.ai', plan)[0].id, 'design');
  assert.strictEqual(R.match('IMG_2041.HEIC', plan)[0].id, 'photos');
  assert.strictEqual(R.match('beach.jpg', plan)[0].id, 'photos');
  assert.strictEqual(R.match('psd', plan)[0].id, 'design', 'a bare extension works as a query');
  assert.strictEqual(R.match('.zip', plan)[0].id, 'archive');
  assert.strictEqual(R.match('mystery.xyz', plan).length, 0);
  assert.strictEqual(R.match('invoice.pdf', plan).length, 2);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

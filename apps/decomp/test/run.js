// Node checks for Decomp's core (no Electron, no downloads). Run: npm test
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const FX = require('./fixtures');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decomp-test-'));
const write = (name, buf) => { const p = path.join(tmp, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; };
const ISO = path.join(__dirname, 'fixtures', 'sample.iso');
const tests = []; const test = (name, fn) => tests.push([name, fn]);

const detect = require('../src/core/detect');
const util = require('../src/core/util');

// ───────── safety
test('archive paths never escape the output folder', () => {
  const root = path.join(tmp, 'safe');
  assert.strictEqual(util.safeJoin(root, '../../etc/passwd'), path.join(root, 'etc', 'passwd'));
  assert.strictEqual(util.safeJoin(root, 'a/./b\\c'), path.join(root, 'a', 'b', 'c'));
  assert.ok(util.safeJoin(root, 'con.txt').endsWith('_con.txt'));
  assert.ok(util.safeJoin(root, 'bad:name?.txt').endsWith('bad_name_.txt'));
});

// ───────── discs
test('ISO 9660 with Joliet names, folders and file sizes', () => {
  const c = require('../src/core/formats/iso9660').open(ISO);
  try {
    assert.strictEqual(c.info.names, 'Joliet'); assert.strictEqual(c.info.volumeId, 'DECOMP_TEST');
    const names = c.entries.map((e) => e.path);
    assert.ok(names.includes('docs/A guide with a long name.txt'));
    assert.strictEqual(c.entries.find((e) => e.path === 'app/tool.dll').size, 20480);
    const out = path.join(tmp, 'iso-one.txt'); c.extract(c.entries.find((e) => e.path === 'README.txt'), out);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'Decomp test disc\n');
  } finally { c.close(); }
});
test('raw 2352-byte disc images read the same as plain ISOs', () => {
  const iso = fs.readFileSync(ISO); const raw = [];
  for (let i = 0; i < iso.length; i += 2048) raw.push(Buffer.from('00ffffffffffffffffffff0000020001', 'hex'), iso.subarray(i, i + 2048), Buffer.alloc(288));
  const p = write('raw.bin', Buffer.concat(raw));
  assert.strictEqual(detect.quick(p).kind, 'iso');
  const c = require('../src/core/formats/iso9660').open(p);
  try { assert.strictEqual(c.info.layout, 'Raw Mode 1 (2352)'); const o = path.join(tmp, 'raw-guide.txt'); c.extract(c.entries.find((e) => e.path.startsWith('docs/A guide')), o); assert.strictEqual(fs.statSync(o).size, 1900); } finally { c.close(); }
});
test('CSO decompresses in slices back to the exact ISO', () => {
  const iso = fs.readFileSync(ISO); const p = write('game.cso', FX.cso(iso));
  assert.strictEqual(detect.quick(p).kind, 'cso');
  const cso = require('../src/core/formats/cso'); const out = path.join(tmp, 'game.iso'); const info = cso.prepare(p, out);
  const half = Math.ceil(info.blocks / 2); cso.decompressRange(p, out, half, info.blocks); cso.decompressRange(p, out, 0, half);
  assert.ok(fs.readFileSync(out).equals(iso));
});
test('LZ4 blocks (ZSO) decode', () => {
  const { lz4Block } = require('../src/core/formats/cso');
  // literal-only block: token 0x50 = 5 literals
  assert.strictEqual(lz4Block(Buffer.from([0x50, 104, 101, 108, 108, 111]), 5).toString(), 'hello');
  // "abcabcabc": 3 literals, then match offset 3 length 6
  assert.strictEqual(lz4Block(Buffer.from([0x32, 97, 98, 99, 3, 0]), 9).toString(), 'abcabcabc');
});
test('Xbox XDVDFS discs list folders and files', () => {
  const p = write('game.xiso', FX.xiso());
  assert.strictEqual(detect.quick(p).kind, 'xiso');
  const c = require('../src/core/formats/xiso').open(p);
  try {
    assert.deepStrictEqual(c.entries.map((e) => e.path).sort(), ['default.xbe', 'media', 'media/note.txt']);
    const o = path.join(tmp, 'note.txt'); c.extract(c.entries.find((e) => e.path === 'media/note.txt'), o);
    assert.strictEqual(fs.readFileSync(o, 'utf8'), 'hello from a subfolder');
  } finally { c.close(); }
});
test('GameCube discs: system files and the file table', () => {
  const p = write('game.gcm', FX.gcm());
  assert.strictEqual(detect.quick(p).kind, 'gcm');
  const c = require('../src/core/formats/gcm').open(p);
  try {
    assert.strictEqual(c.info.title, 'Decomp Test Game'); assert.strictEqual(c.info.gameId, 'GDCE01');
    assert.ok(c.entries.some((e) => e.path === 'files/data/a.txt'));
    assert.strictEqual(c.entries.find((e) => e.path === 'sys/main.dol').size, 0x140);
    const o = path.join(tmp, 'a.txt'); c.extract(c.entries.find((e) => e.path === 'files/data/a.txt'), o); assert.strictEqual(fs.readFileSync(o, 'utf8'), 'hello');
  } finally { c.close(); }
});

// ───────── apps and games
test('Electron asar archives', () => {
  const p = write('app.asar', FX.asar({ 'package.json': '{"name":"x"}', 'src/main.js': 'function a(){return 1}' }));
  assert.strictEqual(detect.quick(p).kind, 'asar');
  const a = require('../src/core/formats/asar').open(p);
  try { assert.strictEqual(a.read('src/main.js').toString(), 'function a(){return 1}'); assert.strictEqual(a.info.files, 2); } finally { a.close(); }
});
test('Godot packs', () => {
  const p = write('game.pck', FX.pck({ 'scenes/main.tscn': '[gd_scene]', 'player.gd': 'extends Node' }));
  assert.strictEqual(detect.quick(p).kind, 'godot');
  const g = require('../src/core/formats/godot').open(p);
  try { assert.strictEqual(g.info.engine, 'Godot 3.5.0'); const e = g.entries.find((x) => x.path === 'player.gd'); const o = path.join(tmp, 'player.gd'); g.extract(e, o); assert.strictEqual(fs.readFileSync(o, 'utf8'), 'extends Node'); } finally { g.close(); }
});
test('RPG Maker archives decrypt (v1 and v3)', () => {
  const { openRgss } = require('../src/core/formats/misc');
  for (const v of [1, 3]) {
    const p = write(`Game${v}.rgssad`, FX.rgss({ 'Data/Scripts.rvdata2': 'script data here', 'Graphics/Title.png': 'PNGDATA-123' }, v));
    assert.strictEqual(detect.quick(p).kind, 'rgss');
    const a = openRgss(p);
    try {
      assert.deepStrictEqual(a.entries.map((e) => e.path), ['Data/Scripts.rvdata2', 'Graphics/Title.png']);
      const o = path.join(tmp, `t${v}.png`); a.extract(a.entries[1], o); assert.strictEqual(fs.readFileSync(o, 'utf8'), 'PNGDATA-123');
    } finally { a.close(); }
  }
});
test('PyInstaller archives: scripts and PYZ modules come out as loadable .pyc', () => {
  const p = write('pyapp', FX.pyinstaller());
  const py = require('../src/core/formats/python');
  const out = path.join(tmp, 'pyout'); const r = py.extractPyInstaller(p, out);
  assert.strictEqual(r.version, '3.12'); assert.strictEqual(r.modules, 1);
  const main = fs.readFileSync(path.join(out, 'main.pyc'));
  assert.strictEqual(main.readUInt16LE(0), 3531); assert.strictEqual(main.length, 16 + 'main code'.length);
  assert.ok(fs.existsSync(path.join(out, 'PYZ (modules)', 'mypkg', 'tool.pyc')));
});
test('marshal reader handles refs and nested tuples', () => {
  const { unmarshal } = require('../src/core/formats/python');
  const b = Buffer.concat([Buffer.from([0x5b, 2, 0, 0, 0]), Buffer.from([0xfa, 1]), Buffer.from('a'), Buffer.from([0x72, 0, 0, 0, 0])]);
  assert.deepStrictEqual(unmarshal(b), ['a', 'a']);
});
test('.NET single-file bundles', () => {
  const p = write('MyApp.exe', FX.dotnetBundle());
  const b = require('../src/core/formats/dotnetbundle').open(p);
  try { assert.strictEqual(b.info.version, '6.0'); assert.deepStrictEqual(b.entries.map((e) => [e.path, e.kind]), [['MyApp.dll', 'Assembly'], ['MyApp.runtimeconfig.json', 'RuntimeConfigJson']]); const o = path.join(tmp, 'MyApp.dll'); b.extract(b.entries[0], o); assert.strictEqual(fs.readFileSync(o, 'utf8'), 'MZ fake assembly'); } finally { b.close(); }
});
test('.NET assemblies are told apart from native programs', () => {
  const dll = path.join(tmp, 'tool.dll');
  const c = require('../src/core/formats/iso9660').open(ISO); try { c.extract(c.entries.find((e) => e.path === 'app/tool.dll'), dll); } finally { c.close(); }
  const id = detect.full(dll);
  assert.strictEqual(id.kind, 'dotnet'); assert.strictEqual(id.details.pe.machine, 'x86'); assert.ok(id.details.dotnet.runtime.startsWith('v4'));
  assert.strictEqual(id.details.version.FileDescription, 'McMaster.Extensions.Hosting.CommandLine');
});
test('Java class and JAR details', () => {
  const jar = path.join(tmp, 'hello.jar');
  const c = require('../src/core/formats/iso9660').open(ISO); try { c.extract(c.entries.find((e) => e.path === 'app/hello.jar'), jar); } finally { c.close(); }
  const id = detect.full(jar);
  assert.strictEqual(id.kind, 'jar'); assert.strictEqual(id.details.java.mainClass, 'com.demo.Hello'); assert.strictEqual(id.details.java.classes, 1);
  const z = require('../src/core/formats/zip').open(jar); const cls = require('../src/core/formats/javaish').classInfo(z.read('com/demo/Hello.class')); z.close();
  assert.strictEqual(cls.name, 'com.demo.Hello'); assert.strictEqual(cls.java, 8);
});
test('WebAssembly summary', () => {
  const p = write('add.wasm', FX.wasm()); const id = detect.full(p);
  assert.strictEqual(id.kind, 'wasm'); assert.strictEqual(id.details.wasm.functions, 1); assert.strictEqual(id.details.wasm.exports, 1);
});
test('tar and gzip', async () => {
  const p = write('a.tar.gz', zlib.gzipSync(FX.tar({ 'dir/one.txt': 'one', 'two.txt': 'two!' })));
  assert.strictEqual(detect.quick(p).kind, 'tar');
  const out = path.join(tmp, 'tarout'); const e = await require('../src/core/formats/tar').walk(p, { outDir: out });
  assert.deepStrictEqual(e.map((x) => x.path), ['dir/one.txt', 'two.txt']); assert.strictEqual(fs.readFileSync(path.join(out, 'two.txt'), 'utf8'), 'two!');
});
test('plists (XML and binary)', () => {
  const pl = require('../src/core/formats/plist');
  assert.deepStrictEqual(pl.parse(Buffer.from('<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Demo &amp; Co</string><key>N</key><integer>3</integer><key>A</key><array><true/><false/></array></dict></plist>')), { CFBundleName: 'Demo & Co', N: 3, A: [true, false] });
  // bplist: { "k": "v" }
  const b = Buffer.concat([Buffer.from('bplist00'), Buffer.from([0xd1, 0x01, 0x02, 0x51, 0x6b, 0x51, 0x76]), Buffer.from([8, 11, 13]), Buffer.alloc(6), Buffer.from([1, 1]), Buffer.from([0, 0, 0, 0, 0, 0, 0, 3]), Buffer.alloc(8), Buffer.from([0, 0, 0, 0, 0, 0, 0, 15])]);
  assert.deepStrictEqual(pl.parse(b), { k: 'v' });
});

// ───────── analysis
test('signature scan finds embedded files at the right offsets', () => {
  const fw = FX.firmware(); const p = write('router.bin', fw.buf);
  assert.strictEqual(detect.quick(p).kind, 'firmware');
  const a = require('../src/core/analysis');
  const hits = a.slices(fw.buf.length, 3, 1024).flatMap(([s, e]) => a.scanRange(p, s, e));
  assert.ok(hits.some((h) => h.type === 'gzip' && h.offset === fw.gzAt)); assert.ok(hits.some((h) => h.type === 'zip' && h.offset === fw.zipAt));
});
test('strings and entropy', () => {
  const a = require('../src/core/analysis');
  const p = write('s.bin', Buffer.concat([Buffer.alloc(100), Buffer.from('https://example.com/api\0'), Buffer.from('w\0i\0d\0e\0s\0t\0r\0\0\0')]));
  const s = a.stringsRange(p, 0, fs.statSync(p).size);
  assert.ok(s.some((x) => x.s === 'https://example.com/api')); assert.ok(s.some((x) => x.s.endsWith('widestr') && x.w));
  const e = a.entropyRange(p, 0, 100, 100); assert.strictEqual(e[0], 0);
  const { interesting } = require('../src/core/pipeline'); assert.deepStrictEqual(interesting(s).urls, ['https://example.com/api']);
});

// ───────── power and scheduling
test('power modes split the machine sensibly', () => {
  const power = require('../src/core/power');
  const max = power.budget('max'), quiet = power.budget('quiet');
  assert.strictEqual(max.threads, power.cpuCount()); assert.ok(quiet.threads <= max.threads); assert.ok(quiet.priority > 0); assert.ok(max.heapMB >= 1024);
});
test('the scheduler shares threads between engines and never exceeds the budget', async () => {
  const { Scheduler } = require('../src/core/scheduler');
  const b = { threads: 12, engines: 3, heapMB: 12000, priority: 0 };
  const s = new Scheduler(() => b); const seen = []; let live = 0, peak = 0;
  await Promise.all([1, 2, 3, 4, 5].map((i) => s.engine('e' + i, async ({ threads }) => { live += threads; peak = Math.max(peak, live); seen.push(threads); await new Promise((r) => setTimeout(r, 20)); live -= threads; })));
  assert.ok(peak <= 12, 'peak ' + peak); assert.ok(seen.every((t) => t >= 1)); assert.strictEqual(seen[0], 4);
  const solo = await s.engine('solo', async ({ threads }) => threads); assert.strictEqual(solo, 12);
});

// ───────── whole jobs (built-in engines only)
async function runJob(input, options = {}) {
  const { createContext } = require('../src/core/context'); const { Job } = require('../src/core/pipeline');
  const ctx = createContext({ enginesDir: path.join(tmp, 'engines'), useSystem: false });
  try { const job = new Job({ input, outRoot: path.join(tmp, 'jobs'), options, ctx }); return { snap: await job.run(), job }; } finally { ctx.close(); }
}
test('job: disc image → files unpacked on the pool, nested zip opened, engines flagged', async () => {
  const { snap } = await runJob(ISO);
  assert.strictEqual(snap.status, 'done');
  const out = snap.outDir;
  assert.strictEqual(fs.readFileSync(path.join(out, 'Unpacked', 'README.txt'), 'utf8'), 'Decomp test disc\n');
  assert.ok(fs.existsSync(path.join(out, 'Unpacked', 'app', 'data.zip (unpacked)', 'inside', 'inner.txt')));
  assert.ok(snap.needs.includes('vineflower') && snap.needs.includes('ilspy'), 'needs ' + snap.needs);
  assert.ok(fs.existsSync(path.join(out, 'Overview.md')) && fs.existsSync(path.join(out, 'report.json')));
});
test('job: Electron archive → unpacked and beautified', async () => {
  const p = write('job/app.asar', FX.asar({ 'package.json': '{"main":"main.js"}', 'main.js': 'function f(a,b){if(a){return b}else{return a+b}}'.repeat(60), 'node_modules/x/index.js': 'module.exports=1' }));
  const { snap } = await runJob(p);
  assert.strictEqual(snap.status, 'done');
  const pretty = fs.readFileSync(path.join(snap.outDir, 'Source', 'main.js'), 'utf8');
  assert.ok(pretty.includes('function f(a, b) {\n'), pretty.slice(0, 80));
  assert.ok(!fs.existsSync(path.join(snap.outDir, 'Source', 'node_modules')));
});
test('job: CSO → ISO → files (three layers deep)', async () => {
  const p = write('job/game.cso', FX.cso(fs.readFileSync(ISO)));
  const { snap } = await runJob(p);
  assert.strictEqual(snap.status, 'done');
  assert.ok(fs.existsSync(path.join(snap.outDir, 'Unpacked', 'game.iso (unpacked)', 'docs', 'A guide with a long name.txt')));
});
test('job: firmware → embedded gzip carved out and opened', async () => {
  const fw = FX.firmware(); const p = write('job/fw.bin', fw.buf);
  const { snap } = await runJob(p);
  assert.ok(snap.steps.some((s) => /^Carve/.test(s.title) && s.state === 'done'), JSON.stringify(snap.steps.map((s) => s.title)));
  assert.ok(fs.existsSync(path.join(snap.outDir, 'Unpacked', 'carved', fw.gzAt.toString(16).padStart(8, '0') + '.gz')));
});
test('job: WebAssembly → text', async () => {
  const p = write('job/add.wasm', FX.wasm());
  const { snap } = await runJob(p);
  const wat = fs.readFileSync(path.join(snap.outDir, 'Source', 'add.wat'), 'utf8');
  assert.ok(/i32\.add/.test(wat) && /export "add"/.test(wat), wat);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${tests.length - failed} of ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();

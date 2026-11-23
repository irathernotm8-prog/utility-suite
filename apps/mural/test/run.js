// Mural — unit checks (plain Node, no Electron): time of day, the wallpaper format, pause rules and the budget,
// the .mural package format, the library (import/save/export), and the plugin's tool list.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const tests = []; const test = (name, fn) => tests.push({ name, fn });
const RT = (f) => pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'runtime', f)).href;

test('sun: Houston noon is day, midnight is night, 6:45 am in November is dawn', async () => {
  const { skyAt, sunPosition } = await import(RT('sun.js'));
  const loc = { lat: 29.76, lon: -95.37 };
  const at = (iso) => new Date(iso);
  const noon = sunPosition(at('2026-11-23T18:00:00Z'), loc.lat, loc.lon); // 12:00 CST
  assert(noon.altitude > 35 && noon.altitude < 42, 'noon altitude ' + noon.altitude);
  assert(Math.abs(noon.azimuth - 180) < 8, 'noon azimuth ~south ' + noon.azimuth);
  assert(skyAt(at('2026-11-23T18:00:00Z'), loc).phases.day > 0.99);
  assert(skyAt(at('2026-11-24T06:00:00Z'), loc).phases.night > 0.99);
  const dawn = skyAt(at('2026-11-23T12:45:00Z'), loc).phases; // 6:45 CST, sunrise ≈ 6:55
  assert(dawn.dawn > 0.3 && dawn.dusk === 0, JSON.stringify(dawn));
  const dusk = skyAt(at('2026-11-23T23:35:00Z'), loc).phases; // 17:35 CST, sunset ≈ 17:24
  assert(dusk.dusk > 0.3 && dusk.dawn === 0, JSON.stringify(dusk));
  for (const p of [dawn, dusk]) assert(Math.abs(p.night + p.dawn + p.day + p.dusk - 1) < 1e-9);
});
test('sun: "when" weights blend, missing keys mean always', async () => {
  const { whenWeight } = await import(RT('sun.js'));
  assert.strictEqual(whenWeight(null, { night: 1, dawn: 0, day: 0, dusk: 0 }), 1);
  assert.strictEqual(whenWeight({ night: 1, day: 0 }, { night: 0.5, dawn: 0, day: 0.5, dusk: 0 }), 0.5);
  assert.strictEqual(whenWeight({ day: 0 }, { night: 0, dawn: 0.4, day: 0.6, dusk: 0 }), 0.4);
});
test('format: defaults fill in, unknown kinds drop, traits are right', async () => {
  const S = await import(RT('schema.js'));
  const m = S.normalizeManifest({ name: 'x', type: 'scene', scene: { layers: [{ kind: 'particles', preset: 'rain' }, { kind: 'nope' }, { kind: 'sky' }, { kind: 'hills', depth: 0.4 }] } });
  assert.strictEqual(m.scene.layers.length, 3);
  assert.strictEqual(m.scene.layers[0].count, 220); assert.strictEqual(m.scene.layers[0].cursor, 'repel');
  const t = S.traits(m); assert(t.animated && t.cursor && t.click && t.timeOfDay);
  const still = S.traits(S.normalizeManifest({ type: 'scene', scene: { layers: [{ kind: 'gradient' }, { kind: 'text', text: '{time}' }], effects: { click: 'none' } } }));
  assert(!still.animated && !still.cursor && !still.click, JSON.stringify(still));
  const sh = S.traits({ type: 'shader', code: 'uniform... iTime iPointer' }); assert(sh.cursor && !sh.click);
  assert.throws(() => S.makeLayer('nope'));
});
test('policy: pause reasons in order, battery eco, governor steps down and back', () => {
  const { pauseReason, quality, Governor } = require('../src/core/policy');
  assert.strictEqual(pauseReason({ settings: {}, covered: true }), 'covered');
  assert.strictEqual(pauseReason({ settings: { pauseCovered: false }, covered: true }), null);
  assert.strictEqual(pauseReason({ settings: { battery: 'pause' }, onBattery: true }), 'battery');
  assert.strictEqual(pauseReason({ settings: {}, userPaused: true, covered: true }), 'paused');
  assert.strictEqual(pauseReason({ settings: {}, thermal: 'critical' }), 'hot');
  assert.deepStrictEqual(quality({ settings: { fps: 30, scale: 1 } }), { fps: 30, scale: 1 });
  assert.deepStrictEqual(quality({ settings: { fps: 60, scale: 1, battery: 'eco' }, onBattery: true }), { fps: 15, scale: 0.75 });
  assert.strictEqual(quality({ settings: { fps: 60 }, hint: { fps: 24 } }).fps, 24);
  assert.strictEqual(quality({ settings: { fps: 30 }, level: 2 }).fps, 20);
  assert(quality({ settings: { fps: 30 }, level: 6 }).scale < 1);
  const g = new Governor('balanced'); let t = 0;
  g.sample(20, t += 4000); assert.strictEqual(g.level, 0); g.sample(20, t += 4000); assert.strictEqual(g.level, 1);
  for (let i = 0; i < 6; i++) g.sample(1, t += 4000); assert.strictEqual(g.level, 1, 'waits 30 s before stepping up');
  for (let i = 0; i < 10; i++) g.sample(1, t += 4000); assert.strictEqual(g.level, 0);
  const u = new Governor('unlimited'); u.sample(500, 1); u.sample(500, 2); assert.strictEqual(u.level, 0);
});
test('policy: which display a point is on', () => {
  const { displayFor, covers } = require('../src/core/policy');
  const ds = [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }, { bounds: { x: 1440, y: -200, width: 2560, height: 1440 } }];
  assert.strictEqual(displayFor({ x: 2000, y: 100 }, ds), ds[1]); assert.strictEqual(displayFor({ x: -50, y: 10 }, ds), ds[0]);
  assert(covers({ x: 0, y: 0, width: 1440, height: 900 }, ds[0].bounds)); assert(!covers({ x: 0, y: 25, width: 1440, height: 600 }, ds[0].bounds));
});
test('zip: round trip, refuses unsafe paths', () => {
  const { writeZip, readZip } = require('../src/core/zip');
  const big = Buffer.alloc(200000, 7);
  const z = writeZip([{ name: 'mural.json', data: Buffer.from('{"a":1}') }, { name: 'sub/big.bin', data: big }]);
  const back = readZip(z); assert.strictEqual(back.length, 2); assert(back[1].data.equals(big));
  const evil = writeZip([{ name: '../evil.txt', data: Buffer.from('x') }]);
  assert.throws(() => readZip(evil), /Unsafe/);
});
test('library: built-ins load, import video/shader/html/.mural, save a built-in makes a copy, export', async () => {
  const schema = await import(RT('schema.js'));
  const { Library } = require('../src/core/library');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mural-')); const user = path.join(tmp, 'lib'), thumbs = path.join(tmp, 'thumbs');
  const lib = new Library({ builtinDir: path.join(__dirname, '..', 'src', 'builtin'), userDir: user, thumbDir: thumbs, schema });
  const all = lib.list();
  assert(all.length >= 20, 'built-ins: ' + all.length);
  for (const w of all) { const r = lib.read(w.id); assert(r && r.manifest.name, w.id); if (r.manifest.type === 'shader') assert(fs.existsSync(lib.fileOf(w.id, r.manifest.shader)), w.id + ' shader file'); }
  assert(all.find((w) => w.id === 'builtin/aurora').traits.cursor, 'aurora reacts to the cursor (read from its shader)');
  assert.strictEqual(lib.fileOf('builtin/aurora', '../../main.js'), null, 'no escaping a wallpaper folder');
  const src = path.join(tmp, 'src'); fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'beach_waves.mp4'), Buffer.alloc(100)); fs.writeFileSync(path.join(src, 'swirl.frag'), 'void mainImage(out vec4 o, in vec2 p){o=vec4(1.0);}'); fs.writeFileSync(path.join(src, 'page.html'), '<p>hi</p>');
  fs.mkdirSync(path.join(src, 'we')); fs.writeFileSync(path.join(src, 'we', 'project.json'), JSON.stringify({ title: 'WE Clip', type: 'Video', file: 'clip.mp4' })); fs.writeFileSync(path.join(src, 'we', 'clip.mp4'), Buffer.alloc(10));
  const r = lib.importPaths(['beach_waves.mp4', 'swirl.frag', 'page.html', 'we', 'nothing.xyz'].map((f) => path.join(src, f)));
  assert.strictEqual(r.imported.length, 4, JSON.stringify(r)); assert.strictEqual(r.skipped.length, 1);
  const vid = lib.read(r.imported[0]); assert.strictEqual(vid.manifest.type, 'video'); assert.strictEqual(vid.manifest.name, 'beach waves');
  assert.strictEqual(lib.read(r.imported[3]).manifest.src, 'clip.mp4');
  const copy = lib.save('builtin/snowfall', { ...lib.read('builtin/snowfall').manifest, name: 'My snow' });
  assert(copy.startsWith('user/')); assert.strictEqual(lib.read(copy).manifest.name, 'My snow'); assert.strictEqual(lib.read('builtin/snowfall').manifest.name, 'Snowfall');
  const pkg = path.join(tmp, 'snow.mural'); lib.exportTo(copy, pkg);
  const again = lib.importPaths([pkg]).imported[0]; assert.strictEqual(lib.read(again).manifest.name, 'My snow'); assert.notStrictEqual(again, copy);
  assert.throws(() => lib.remove('builtin/aurora'));
});
test('store: defaults, partial updates, per-display choice', () => {
  const { Store } = require('../src/core/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mural-st-'));
  const s = new Store(dir); assert.strictEqual(s.get().fps, 30); s.set({ fps: 24, bogus: 1, rotate: { on: true } });
  const t = new Store(dir); assert.strictEqual(t.get().fps, 24); assert.strictEqual(t.get().bogus, undefined); assert.strictEqual(t.get().rotate.minutes, 60);
  t.set({ sameOnAll: false, perDisplay: { 7: 'builtin/nebula' } }); assert.strictEqual(t.wallpaperFor('7'), 'builtin/nebula'); assert.strictEqual(t.wallpaperFor('8'), t.get().wallpaper);
});
test('plugin: tool list is well formed and the MCP server answers initialize and tools/list', async () => {
  const { TOOLS } = require('../mcp/tools');
  const names = TOOLS.map((t) => t.name); assert.strictEqual(new Set(names).size, names.length);
  for (const t of TOOLS) { assert(t.description.length > 20); assert.strictEqual(t.inputSchema.type, 'object'); }
  const { spawn } = require('child_process');
  const c = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'mural-mcp.js')], { env: { ...process.env, MURAL_BRIDGE: path.join(os.tmpdir(), 'none.json') } });
  const out = await new Promise((res) => { let s = ''; c.stdout.on('data', (d) => { s += d; if (s.split('\n').filter(Boolean).length >= 2) res(s); }); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 't' } } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n'); setTimeout(() => res(s), 4000); });
  c.kill();
  const lines = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.strictEqual(lines[0].result.serverInfo.name, 'mural'); assert.strictEqual(lines[1].result.tools.length, TOOLS.length);
});
test('helpers: the Mac script parses, the Windows helper keeps to C# 5', () => {
  const { JXA } = require('../src/platform/mac'); new Function('ObjC', '$', 'delay', JXA);
  const { CS } = require('../src/platform/win');
  assert(!/\$"/.test(CS), 'no interpolated strings'); assert(!/\?\./.test(CS), 'no ?.'); assert(!/out var /.test(CS), 'no out var'); assert(!/=>\s*[^"]/.test(CS.replace(/"[^"]*"/g, '')), 'no lambdas/expression bodies');
  assert.strictEqual((CS.match(/{/g) || []).length, (CS.match(/}/g) || []).length);
});
test('shaders: every built-in has mainImage and only uses uniforms Mural provides', () => {
  const dir = path.join(__dirname, '..', 'src', 'builtin');
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'main.frag'); if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8'); assert(/void\s+mainImage\s*\(/.test(src), d);
    assert(!/texture2D|iChannel/.test(src), d + ' uses textures');
  }
});

test('widgets: built-ins are valid, placing finds free spots, clamp, storage, import/export, permissions', () => {
  const { Widgets, normalizeWidget, permissionText } = require('../src/core/widgets');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mural-w-'));
  const W = new Widgets({ builtinDir: path.join(__dirname, '..', 'src', 'widgets'), userDir: path.join(tmp, 'Widgets'), dataDir: tmp });
  const types = W.types(); assert(types.length >= 10, 'built-in widgets: ' + types.length);
  for (const t of types) { const r = W.read(t.type); assert(fs.existsSync(W.fileOf(t.type, r.manifest.page)), t.type); const html = fs.readFileSync(W.fileOf(t.type, r.manifest.page), 'utf8'); assert(/widget-sdk\.js/.test(html), t.type + ' uses the SDK'); if (/setInterval|setTimeout\((tick|load|loop)/.test(html)) assert(/on\('pause'|mural\.paused/.test(html), t.type + ' stops its timers on pause'); }
  assert.strictEqual(W.fileOf('builtin/clock', '../../main.js'), null);
  const b = { width: 1440, height: 900 };
  const a1 = W.add('builtin/clock', '1', b), a2 = W.add('builtin/notes', '1', b), a3 = W.add('builtin/todo', '1', b);
  const overlap = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  assert(!overlap(a1, a2) && !overlap(a2, a3) && !overlap(a1, a3), 'free spots don’t overlap');
  assert.strictEqual(a1.settings.style, 'digital'); assert.deepStrictEqual(W.instances('1').length, 3);
  W.update(a1.id, { x: 5000, y: -40, settings: { h24: true } }); const c = W.clamp(W.instance(a1.id), b);
  assert(c.x + c.w <= 1440 && c.y >= 0); assert.strictEqual(W.instance(a1.id).settings.h24, true); assert.strictEqual(W.instance(a1.id).settings.style, 'digital');
  W.setData(a2.id, 'text', 'hello'); assert.strictEqual(new Widgets({ builtinDir: W.builtinDir, userDir: W.userDir, dataDir: tmp }).getData(a2.id).text, 'hello', 'data survives a restart');
  const t = W.temp('builtin/notes'); W.setData(t.id, 'text', 'x'); assert.strictEqual(W.getData(t.id).text, 'x'); assert(!fs.existsSync(W.dataFile(t.id)), 'previews never write to disk');
  const mine = W.saveType(null, { name: 'Stock ticker', permissions: ['network', 'evil', 'suite:scene'], settings: [{ key: 'sym', type: 'text' }, { key: 'bad', type: 'nope' }] }, { 'index.html': '<p>hi</p>' });
  assert.strictEqual(mine, 'user/stock-ticker'); const mm = W.read(mine).manifest; assert.deepStrictEqual(mm.permissions, ['network', 'suite:scene']); assert.strictEqual(mm.settings.length, 1);
  const copy = W.saveType('builtin/clock', W.read('builtin/clock').manifest, {}); assert(copy.startsWith('user/') && fs.existsSync(W.fileOf(copy, 'index.html')), 'editing a built-in copies it');
  const pkg = path.join(tmp, 'x.muralwidget'); W.exportType(mine, pkg); const back = W.importPath(pkg); assert.notStrictEqual(back, mine); assert.strictEqual(W.read(back).manifest.name, 'Stock ticker');
  W.remove(a2.id); assert(!fs.existsSync(W.dataFile(a2.id))); assert.throws(() => W.removeType('builtin/clock'));
  assert.strictEqual(normalizeWidget({ size: { w: 99999 } }).size.w, 3000); assert(/Scene/.test(permissionText('suite:scene')));
});

(async () => {
  let failed = 0;
  for (const t of tests) { try { await t.fn(); console.log('ok   ' + t.name); } catch (e) { failed++; console.log('FAIL ' + t.name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); } }
  console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();

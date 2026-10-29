// Dither — Node checks (no Electron, no network): node test/run.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const png = require('../src/core/png');
const gif = require('../src/core/gif');
const FX = require('../src/core/fxruntime');
const SP = require('../src/core/sprite');
const sheets = require('../src/core/sheets');
const snap = require('../src/core/pixelsnap');
const EX = require('../src/core/exporters');
const { LIB } = require('../src/core/fxlib');
const { Library } = require('../src/core/project');
const { makeHandlers } = require('../src/mcp-handlers');
const { TOOLS } = require('../mcp/tools');

const tests = []; const test = (name, fn) => tests.push([name, fn]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dither-test-'));

// a tiny GIF decoder, to prove the encoder's LZW round-trips
function decodeGifFrames(buf) {
  let o = 6; const W = buf.readUInt16LE(o), H = buf.readUInt16LE(o + 2), flags = buf[o + 4]; o += 7;
  if (flags & 0x80) o += 3 * (1 << ((flags & 7) + 1));
  const frames = [];
  while (o < buf.length) {
    const b = buf[o++];
    if (b === 0x3b) break;
    if (b === 0x21) { o++; while (buf[o]) o += buf[o] + 1; o++; continue; }
    if (b === 0x2c) {
      const w = buf.readUInt16LE(o + 4), h = buf.readUInt16LE(o + 6), f = buf[o + 8]; o += 9; if (f & 0x80) o += 3 * (1 << ((f & 7) + 1));
      const min = buf[o++]; const data = []; while (buf[o]) { const n = buf[o++]; for (let i = 0; i < n; i++) data.push(buf[o++]); } o++;
      const clear = 1 << min, eoi = clear + 1; let size = min + 1, dict = [], prev = null, bit = 0; const out = [];
      const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = null; size = min + 1; prev = null; };
      reset();
      for (;;) {
        let code = 0; for (let i = 0; i < size; i++) { if ((data[(bit >> 3)] >> (bit & 7)) & 1) code |= 1 << i; bit++; }
        if (code === clear) { reset(); continue; } if (code === eoi || bit > data.length * 8) break;
        let entry = dict[code]; if (!entry) entry = prev.concat([prev[0]]);
        out.push(...entry);
        if (prev) { dict.push(prev.concat([entry[0]])); if (dict.length === (1 << size) && size < 12) size++; }
        prev = entry;
      }
      frames.push({ w, h, idx: out });
      continue;
    }
    break;
  }
  return { W, H, frames };
}

test('PNG encodes and decodes losslessly', () => {
  const img = { w: 7, h: 5, data: new Uint8ClampedArray(7 * 5 * 4).map((_, i) => (i * 37) % 256) };
  const back = png.decode(png.encode(img, { text: { Software: 'Dither' } }));
  assert.equal(back.w, 7); assert.equal(back.h, 5); assert.deepEqual([...back.data], [...img.data]); assert.equal(back.text.Software, 'Dither');
});

test('GIF frames round-trip through LZW (incl. >4096 codes and scaling)', () => {
  const w = 96, h = 80; const frames = [0, 1].map((k) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const c = (i * 7 + k * 13 + ((i / w) | 0) * 3) % 40; d[i * 4] = c * 6; d[i * 4 + 1] = 255 - c * 5; d[i * 4 + 2] = (c * 31) % 256; d[i * 4 + 3] = c === 0 ? 0 : 255; } return { data: d, delay: 100 }; });
  const buf = gif.encode(frames, w, h, { scale: 2 });
  assert.equal(buf.toString('ascii', 0, 6), 'GIF89a'); assert.equal(buf[buf.length - 1], 0x3b);
  const g = decodeGifFrames(buf); assert.equal(g.frames.length, 2); assert.equal(g.W, w * 2);
  assert.equal(g.frames[0].idx.length, w * 2 * h * 2);
  // transparent pixels map to index 0, opaque ones never do
  const d = frames[0].data; for (let y = 0; y < h; y += 7) for (let x = 0; x < w; x += 5) { const a = d[(y * w + x) * 4 + 3]; const k = g.frames[0].idx[(y * 2) * w * 2 + x * 2]; assert.equal(a === 0, k === 0, `pixel ${x},${y}`); }
});

test('Drawing kit: lines, circles, dithering, flood, outline, text, symmetry', () => {
  const g = new FX.Canvas(16, 16, 'pico8');
  g.line(0, 0, 15, 15, 7); for (let i = 0; i < 16; i++) assert.equal(g.get(i, i), '#fff1e8');
  g.clear().fillCircle(8, 8, 4, 8); assert.ok(g.filled(8, 8) && g.filled(8, 4) && !g.filled(8, 2));
  g.clear().dither(0, 0, 4, 4, 7, 0.5); let n = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) n += g.filled(x, y); assert.equal(n, 8);
  g.clear().rect(2, 2, 6, 6, 1).flood(4, 4, 12); assert.equal(g.idx(4, 4), 12); assert.equal(g.idx(0, 0), -1);
  g.clear().px(5, 5, 7).outline(0); assert.equal(g.idx(5, 4), 0); assert.equal(g.idx(4, 4), -1);
  g.clear().text('A1', 0, 0, 7); assert.ok(g.filled(1, 0) && g.filled(5, 0) && !g.filled(4, 0));
  g.clear().symmetry(true, false).px(1, 3, 9); assert.ok(g.filled(14, 3));
});

test('Every starter effect renders, deterministically, with frames that are not empty', () => {
  for (const e of LIB) {
    const a = FX.render(e.code), b = FX.render(e.code);
    assert.equal(a.frames.length, a.meta.n, e.id);
    assert.ok(a.frames.some((f) => f.some((v, i) => i % 4 === 3 && v)), e.id + ' draws something');
    assert.deepEqual(Buffer.from(a.frames[3].buffer), Buffer.from(b.frames[3].buffer), e.id + ' is repeatable');
    assert.ok(sheets.colorsUsed(a.frames).length <= a.meta.palette.length, e.id + ' stays in its palette');
  }
});

test('Effect errors are clear', () => {
  assert.throws(() => FX.render('const x = 1;'), /never called effect/);
  assert.throws(() => FX.render("effect({ size: [8,8], draw(g) { g.px(0,0,'nope') } })"), /./);
  assert.throws(() => FX.render("effect({ size:[8,8], frames: 3, draw(g){ const t=Date.now(); while(Date.now()-t<40){} } })", { budgetMs: 50 }), /longer than/);
  const r = FX.render("effect({ size:[8,8], frames:4, fps:10, holds:[1,3,1,1], params:{ n:{ value:2, min:1, max:5 } }, draw(g,{params}){ g.px(params.n,0,7) } })", { params: { n: 4 } });
  assert.deepEqual(r.meta.durations, [100, 300, 100, 100]); assert.equal(r.meta.params.n, 4);
});

test('Pixel snap recovers the grid of a soft, upscaled sprite', () => {
  const src = new FX.Canvas(16, 16, 'sweetie16'); src.clear(12).fillCircle(8, 8, 5, 2).fillRect(5, 6, 3, 2, 4).outline(0);
  const S = 7.3, W = Math.round(16 * S), H = W; const big = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(15, Math.floor(x / S)), sy = Math.min(15, Math.floor(y / S)); const i = (sy * 16 + sx) * 4, o = (y * W + x) * 4; for (let k = 0; k < 3; k++) big.data[o + k] = Math.max(0, Math.min(255, src.data[i + k] + (rnd() - 0.5) * 14)); big.data[o + 3] = 255; }
  const r = snap.snap(big, { colors: 5 });
  assert.equal(r.img.w, 16, `width ${r.img.w} (cell ${r.grid.cell})`); assert.equal(r.img.h, 16);
  // background (slot 12) cleared, the body kept
  assert.equal(r.img.data[3], 0); assert.ok(r.img.data[(8 * 16 + 8) * 4 + 3] > 0);
  let same = 0; for (let i = 0; i < 256; i++) { const a = src.data.slice(i * 4, i * 4 + 3), b = r.img.data.slice(i * 4, i * 4 + 3); if (!r.img.data[i * 4 + 3] || Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 40) same++; }
  assert.ok(same >= 240, `${same}/256 cells match`);
  const fixed = snap.snap(big, { width: 16, palette: 'sweetie16', background: false });
  assert.equal(fixed.img.w, 16); assert.ok(fixed.palette.every((c) => FX.PALETTES.sweetie16.includes(c)));
});

test('Sprites: pixel rows, ops on frames and layers, compose, save/load', () => {
  const s = SP.create({ name: 'Slime', w: 8, h: 8, palette: 'pico8', frames: 2 });
  SP.apply(s, [{ op: 'pixels', x: 1, y: 2, rows: ['.bb.', 'b77b', 'bbbb'] }, { op: 'outline', color: 0 }, { op: 'rect', x: 0, y: 0, w: 8, h: 8, color: 8, frame: 1 }]);
  const f0 = SP.compose(s, 0); assert.equal(f0[((3 * 8) + 2) * 4], 255); // '7' is #fff1e8 → r 255
  assert.ok(SP.compose(s, 1)[3] > 0);
  const top = SP.addLayer(s, { name: 'Eyes' }); SP.apply(s, [{ op: 'px', x: 2, y: 3, color: 0 }], { layer: 'Eyes' });
  assert.equal(SP.compose(s, 0)[((3 * 8) + 2) * 4], 0);
  top.visible = false; assert.equal(SP.compose(s, 0)[((3 * 8) + 2) * 4], 255);
  SP.addFrame(s, { at: 1, copyFrom: 0 }); assert.equal(s.frames.length, 3); assert.deepEqual([...SP.compose(s, 1)], [...SP.compose(s, 0)]);
  const back = SP.hydrate(JSON.parse(JSON.stringify(SP.serialize(s)))); assert.deepEqual([...SP.compose(back, 2)], [...SP.compose(s, 2)]);
  assert.throws(() => SP.apply(s, [{ op: 'pixels', x: 0, y: 0, rows: ['z'] }]), /palette slot 35/);
  SP.resize(s, 12, 10); assert.equal(SP.compose(s, 0).length, 12 * 10 * 4);
});

test('Sheets: contact sheet, board and sprite sheet JSON', () => {
  const r = FX.render(LIB[0].code);
  const c = sheets.contactSheet(r.frames, r.meta.w, r.meta.h, { title: 'X', durations: r.meta.durations }); assert.ok(c.w > r.meta.w * 4 && c.w <= 1500);
  const b = sheets.boardSheet([{ label: 'a', frames: r.frames, w: r.meta.w, h: r.meta.h }, { label: 'b', frames: r.frames.slice(0, 3), w: r.meta.w, h: r.meta.h }]); assert.ok(b.h > r.meta.h * 2);
  const { img, json } = sheets.spriteSheet(r.frames, r.meta.w, r.meta.h, { cols: 4, durations: r.meta.durations, name: 'pickup' });
  assert.equal(img.w, 4 * r.meta.w); assert.equal(json.frames.length, r.frames.length); assert.equal(json.frames[1].duration, r.meta.durations[1]); assert.equal(json.frames[5].frame.x, r.meta.w);
});

test('Exported JS module works on its own', async () => {
  const l = LIB.find((x) => x.id === 'fire-loop'); const r = FX.render(l.code);
  const f = path.join(tmp, 'fire.mjs'); fs.writeFileSync(f, EX.effectModule(l.code, r.meta));
  global.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  global.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { const self = this; return { putImageData(img) { self.img = img; }, drawImage() { self.drawn = (self.drawn || 0) + 1; }, set imageSmoothingEnabled(v) {} }; } };
  const mod = await import('file://' + f);
  const fx = mod.createEffect(); assert.equal(fx.length, r.meta.n); assert.equal(fx.w, 24);
  assert.deepEqual([...fx.pixels[5]], [...r.frames[5]]);
  const calls = []; const ctx = { drawImage: (...a) => calls.push(a), set imageSmoothingEnabled(v) {} };
  assert.equal(fx.drawAt(ctx, 10, 20, 9999999, 2), true); assert.equal(calls[0][3], 48);
  assert.equal(fx.frameAt(0), 0); assert.equal(fx.frameAt(r.meta.durations[0] + 1), 1);
});

test('Projects: effects keep every version, feedback, boards, references', () => {
  const lib = new Library(path.join(tmp, 'projects'));
  const p = lib.create('Destroy Any Website'); assert.equal(lib.list().length, 1);
  const b = p.createBoard({ idea: 'MIRV split' });
  const e = p.createEffect({ name: 'Split A', code: LIB[0].code, boardId: b.id, by: 'Claude' });
  assert.deepEqual(p.getBoard('latest').items, [e.id]);
  p.updateEffect(e.id, { code: LIB[1].code, note: 'more smoke', by: 'Claude' }); assert.equal(p.getEffect(e.id).version, 2); assert.equal(p.getEffect(e.id, 1).code, LIB[0].code);
  p.feedback(e.id, { verdict: 'pick', stars: 3, note: 'hold the split frame longer', frame: 4 });
  const m = p.resolveEffect('split a'); assert.equal(m.feedback.verdict, 'pick'); assert.equal(m.feedback.notes[0].frame, 4); assert.equal(m.kept, true);
  const img = path.join(tmp, 'ref.png'); fs.writeFileSync(img, png.encode({ w: 2, h: 2, data: new Uint8ClampedArray(16).fill(200) }));
  const r = p.addRef(img, 'PoE2 lightning'); assert.ok(fs.existsSync(p.p('refs', r.file)));
  const s = SP.create({ name: 'Hero', w: 16, h: 16 }); p.saveSprite(s); assert.equal(p.getSprite('hero').id, s.id);
  p.removeEffect(e.id); assert.equal(p.listEffects().length, 0); assert.ok(fs.readdirSync(p.p('.trash')).length >= 1);
});

test('Plugin handlers: drafts → feedback → update → bake → record → export', async () => {
  const lib = new Library(path.join(tmp, 'handlers')); let active = null; const changes = [];
  const handle = makeHandlers({ lib, active: () => (active ? lib.get(active) : (() => { throw new Error('Open a project first'); })()), setActive: (id) => (active = id), render: async (code, o) => FX.render(code, o), webm: null, engine: { status: async () => ({ engine: null }) }, decodeImage: (f) => png.decode(fs.readFileSync(f)), changed: (k, id) => changes.push(k), activity: () => {} });
  const call = async (n, a) => { const r = await handle(n, a, 'Claude Code'); if (r.isError) throw new Error(n + ': ' + r.content[0].text); return r; };
  const json = (r) => JSON.parse(r.content.find((c) => c.type === 'text').text);
  assert.ok((await call('dither_guide')).content[0].text.includes('effect({'));
  await call('create_project', { name: 'Arcade' });
  const ctx = json(await call('dither_context')); assert.equal(ctx.active_project.name, 'Arcade');
  const d = await call('create_drafts', { idea: 'coin pop', drafts: [{ name: 'Sparkle', code: LIB[0].code }, { name: 'Impact', code: LIB[8].code }, { name: 'Broken', code: 'effect({ draw(g){ nope() } })' }] });
  const dj = json(d); assert.equal(dj.drafts.length, 3); assert.equal(dj.drafts[2].ok, false); assert.ok(d.content.some((c) => c.type === 'image'));
  const proj = lib.get(active); proj.feedback(dj.drafts[0].id, { verdict: 'pick', note: 'fewer sparks' });
  const fb = json(await call('get_feedback', {})); assert.deepEqual(fb.picks, [dj.drafts[0].id]); assert.equal(fb.drafts[0].open_notes[0].note, 'fewer sparks');
  const up = json(await call('update_effect', { effect: dj.drafts[0].id, code: LIB[0].code.replace('value: 8', 'value: 5'), note: 'fewer sparks', resolves: [0] })); assert.equal(up.version, 2);
  assert.equal(json(await call('get_feedback', { effect: dj.drafts[0].id })).open_notes.length, 0);
  const v = await call('view', { kind: 'effect', id: dj.drafts[0].id, frame: 3 }); assert.ok(v.content[1].data.length > 100);
  const baked = json(await call('bake_effect', { effect: dj.drafts[0].id })); assert.ok(baked.sprite);
  const rec = json(await call('record', { id: dj.drafts[0].id })); assert.equal(rec.files.length, 2); rec.files.forEach((f) => assert.ok(fs.existsSync(f)));
  const ex = json(await call('export', { id: dj.drafts[0].id, format: 'module' })); assert.ok(ex.files[0].endsWith('.js'));
  const sh = json(await call('export', { kind: 'sprite', id: baked.sprite, format: 'sheet', cols: 5 })); assert.ok(sh.files[1].endsWith('.json'));
  const sp = json(await call('create_sprite', { name: 'Coin', w: 8, h: 8, palette: 'pico8', frames: 2 }));
  const dr = await call('draw_sprite', { sprite: sp.id, ops: [{ op: 'circle', x: 3.5, y: 3.5, r: 3, color: 10, fill: true }, { op: 'outline', color: 9, frame: 0 }, { op: 'px', x: 3, y: 3, color: 7, frame: 1 }] });
  assert.deepEqual(json(dr).changed_frames, [1, 2]);
  const rows = json(await call('get_sprite', { sprite: sp.id, frame: 0 })).rows; assert.equal(rows.length, 8); assert.ok(rows[3].includes('a'));
  json(await call('edit_sprite', { sprite: sp.id, action: 'duplicate_frame', index: 1 }));
  const big = path.join(tmp, 'soft.png'); const c = new FX.Canvas(10, 10, 'pico8'); c.clear(1).fillCircle(5, 5, 3, 8); fs.writeFileSync(big, png.encode(sheets.scaleImage(c.toImage(), 6)));
  const px = json(await call('pixelize_image', { path: big })); assert.equal(px.size, '10×10');
  const err = await handle('generate_image', { prompt: 'x' }, 'Claude'); assert.ok(err.isError);
  for (const t of TOOLS) assert.ok(typeof t.inputSchema === 'object' && t.description.length > 20, t.name);
  assert.ok(changes.includes('board') && changes.includes('sprite'));
});

test('MCP server speaks JSON-RPC over stdio and forwards calls to the app bridge', async () => {
  const token = 't0k3n'; const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { assert.equal(req.headers.authorization, 'Bearer ' + token); const m = JSON.parse(b); seen.push(m); res.end(JSON.stringify(req.url === '/hello' ? { ok: true } : { content: [{ type: 'text', text: 'pong:' + m.name }] })); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const bridge = path.join(tmp, 'bridge.json'); fs.writeFileSync(bridge, JSON.stringify({ port: srv.address().port, token, pid: process.pid }));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'dither-mcp.js')], { env: { ...process.env, DITHER_BRIDGE: bridge }, stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = []; let buf = ''; child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dither_context', arguments: {} } });
  for (let i = 0; i < 50 && replies.length < 3; i++) await new Promise((r) => setTimeout(r, 100));
  child.kill(); srv.close();
  const by = Object.fromEntries(replies.map((r) => [r.id, r.result]));
  assert.equal(by[1].serverInfo.name, 'dither'); assert.ok(by[1].instructions.includes('drafts'));
  assert.equal(by[2].tools.length, TOOLS.length);
  assert.equal(by[3].content[0].text, 'pong:dither_context'); assert.equal(seen.find((s) => s.name).client, 'claude-code');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) { const t = Date.now(); try { await fn(); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); } }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nAll ${tests.length} passed`); process.exit(failed ? 1 : 0);
})();

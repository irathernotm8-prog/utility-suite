'use strict';
// Node checks for Beam's core (no Electron). Two engines talk over localhost.
//   node test/run.js            all checks
//   BEAM_BIG_MB=2000 node test/run.js   bigger speed test
const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { PassThrough, pipeline } = require('stream');
const { promisify } = require('util');
const pipe = promisify(pipeline);

const C = require('../src/core/crypto');
const F = require('../src/core/files');
const { Engine } = require('../src/core/engine');
const { Discovery } = require('../src/core/discovery');
const { loadIdentity } = require('../src/core/identity');
const { deviceFromUA } = require('../src/core/phone');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-test-'));
const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name]); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push([false, name]); console.log(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); }
}
const until = async (fn, ms = 20000, what = 'condition') => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('timed out waiting for ' + what);
};
const sha = async (p) => { const h = crypto.createHash('sha256'); for await (const c of fs.createReadStream(p)) h.update(c); return h.digest('hex'); };

async function makeEngine(name, extra = {}) {
  const dir = path.join(ROOT, name);
  const settings = { name, receiveDir: path.join(dir, 'Received'), receive: 'everyone', autoAcceptTrusted: true, trusted: [], saved: [], streams: 0, phone: { enabled: true }, ...extra };
  const e = new Engine({ dataDir: path.join(dir, 'data'), identity: loadIdentity(path.join(dir, 'data')), settings: () => settings, port: 0, discovery: false, retry: [20, 20], phoneHtml: () => '<!doctype html><title>__NAME__</title>' });
  e.s = settings;
  await e.start();
  return e;
}
const final = (e, tid) => until(() => { const h = e.history.find(x => x.tid === tid); return h && h; }, 120000, 'transfer end');

(async () => {
  console.log('Beam checks\n');

  await check('encrypted frames round-trip in odd-sized pieces', async () => {
    const key = crypto.randomBytes(32), base = crypto.randomBytes(8);
    const data = crypto.randomBytes(3 * C.FRAME + 12345);
    const enc = new C.Encrypt(key, base), dec = new C.Decrypt(key, base);
    const src = new PassThrough();
    const out = [];
    dec.on('data', c => out.push(c));
    const done = pipe(src, enc, dec);
    for (let o = 0; o < data.length;) { const n = Math.min(data.length - o, 1 + Math.floor(Math.random() * 200000)); src.write(data.subarray(o, o + n)); o += n; }
    src.end(); await done;
    assert.ok(Buffer.concat(out).equals(data));
  });

  await check('a changed byte, a cut-short stream and the wrong key are all caught', async () => {
    const key = crypto.randomBytes(32), base = crypto.randomBytes(8);
    const data = crypto.randomBytes(C.FRAME + 500);
    const sealed = [];
    const enc = new C.Encrypt(key, base); enc.on('data', c => sealed.push(c));
    await new Promise(r => { enc.on('end', r); enc.end(data); });
    const all = Buffer.concat(sealed);
    const run = async (buf, k = key) => { const d = new C.Decrypt(k, base); d.resume(); const s = new PassThrough(); const p = pipe(s, d); s.end(buf); return p; };
    await run(all);
    const bad = Buffer.from(all); bad[100] ^= 1;
    await assert.rejects(run(bad), /integrity/);
    await assert.rejects(run(all.subarray(0, all.length - 30)), /cut short/);
    await assert.rejects(run(all.subarray(0, 4 + C.FRAME + 16)), /cut short/);
    await assert.rejects(run(all, crypto.randomBytes(32)), /integrity/);
    const k1 = C.newKeys(), k2 = C.newKeys();
    assert.ok(C.sharedKey(k1.priv, 'a', k2.pub, 'b').equals(C.sharedKey(k2.priv, 'b', k1.pub, 'a')));
    assert.strictEqual(C.safetyCode(k1.pub, k2.pub), C.safetyCode(k2.pub, k1.pub));
    const msg = C.seal(C.sharedKey(k1.priv, 'a', k2.pub, 'b'), { hi: 1 });
    assert.deepStrictEqual(C.open(C.sharedKey(k2.priv, 'b', k1.pub, 'a'), msg), { hi: 1 });
  });

  await check('the plan cuts big files, packs small ones, and is the same on both sides', async () => {
    const items = [{ s: 100 << 20 }, { s: 10 }, { s: 0 }, { s: 2 << 20 }, ...Array.from({ length: 2500 }, () => ({ s: 4000 }))];
    const p = F.plan(items);
    const segs = p.filter(x => x.f === 0);
    assert.strictEqual(segs.length, 4);
    assert.strictEqual(segs.reduce((a, x) => a + x.l, 0), 100 << 20);
    const batches = p.filter(x => x.files);
    assert.ok(batches.length >= 3 && batches.every(b => b.files.length <= 1000));
    const covered = new Set(batches.flatMap(b => b.files));
    assert.ok(covered.has(1) && !covered.has(2) && covered.size === 2501);
    assert.deepStrictEqual(F.plan(items), p);
    p.forEach((x, i) => assert.strictEqual(x.k, i));
  });

  await check('names from other devices can’t escape the receive folder and work on Windows', async () => {
    assert.deepStrictEqual(F.safeRel('../../etc/passwd'), ['etc', 'passwd']);
    assert.deepStrictEqual(F.safeRel('a/b:c?.txt'), ['a', 'b_c_.txt']);
    assert.deepStrictEqual(F.safeRel('CON/aux.txt'), ['_CON', '_aux.txt']);
    assert.deepStrictEqual(F.safeRel('dots.../x '), ['dots', 'x']);
    assert.throws(() => F.safeRel('../..'));
    const d = path.join(ROOT, 'uniq'); await fsp.mkdir(d, { recursive: true });
    await fsp.writeFile(path.join(d, 'a.txt'), ''); await fsp.writeFile(path.join(d, 'a 2.txt'), '');
    assert.strictEqual(path.basename(await F.uniquePath(d, 'a.txt')), 'a 3.txt');
    assert.strictEqual(deviceFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)').name, 'iPhone');
  });

  // ── two devices
  const A = await makeEngine('Mac');
  const B = await makeEngine('PC');
  const asks = [];
  B.on('incoming', (t) => asks.push(t));
  await check('a device can be added by its address', async () => {
    const r = await A.addAddress(`127.0.0.1:${B.port}`);
    assert.strictEqual(r.name, 'PC');
    await B.addAddress(`127.0.0.1:${A.port}`);
    assert.ok(A.peerList().some(p => p.id === B.identity.id && !p.trusted));
    assert.deepStrictEqual(A.s.saved, [`127.0.0.1:${B.port}`]);
    await assert.rejects(A.addAddress('127.0.0.1:1'), /Couldn’t reach/);
  });

  // a folder with a big file, lots of small ones, an empty file and an empty folder
  const src = path.join(ROOT, 'src', 'Holiday');
  const BIG = (Number(process.env.BEAM_BIG_MB) || 300) << 20;
  await fsp.mkdir(path.join(src, 'small', 'deeper'), { recursive: true });
  await fsp.mkdir(path.join(src, 'empty'), { recursive: true });
  {
    const fh = await fsp.open(path.join(src, 'video.mov'), 'w');
    const block = crypto.randomBytes(4 << 20);
    for (let o = 0; o < BIG; o += block.length) await fh.write(block, 0, Math.min(block.length, BIG - o));
    await fh.close();
    for (let i = 0; i < 400; i++) await fsp.writeFile(path.join(src, 'small', i % 3 ? 'deeper' : '', `photo ${i}.jpg`), crypto.randomBytes(1000 + (i * 7919) % 300000));
    await fsp.writeFile(path.join(src, 'blank.txt'), '');
    await fsp.writeFile(path.join(src, 'small', '.DS_Store'), 'skip me');
    const old = new Date('2021-06-01T12:00:00Z');
    await fsp.utimes(path.join(src, 'blank.txt'), old, old);
    await fsp.utimes(path.join(src, 'small', 'photo 3.jpg'), old, old);
  }
  const single = path.join(ROOT, 'src', 'notes.txt');
  await fsp.writeFile(single, 'hello from the Mac');

  let firstTid;
  await check('a folder goes across intact, after the receiver says yes', async () => {
    const tid = await A.send(B.identity.id, [src, single]);
    firstTid = tid;
    const ask = await until(() => asks.find(x => x.tid === tid), 10000, 'the question');
    assert.strictEqual(ask.peer.name, 'Mac');
    assert.strictEqual(ask.count, 403);
    assert.deepStrictEqual(ask.names, ['Holiday', 'notes.txt']);
    const t0 = Date.now();
    B.respond(tid, true, { trust: true });
    const h = await final(A, tid);
    const secs = (Date.now() - t0) / 1000;
    assert.strictEqual(h.status, 'done', h.error);
    console.log(`    ${F.human(h.total)} in ${secs.toFixed(2)} s → ${F.human(h.total / secs)}/s over localhost`);
    const hb = await final(B, tid);
    assert.strictEqual(hb.status, 'done');
    const dst = path.join(B.s.receiveDir, 'Holiday');
    assert.strictEqual(await sha(path.join(dst, 'video.mov')), await sha(path.join(src, 'video.mov')));
    for (let i = 0; i < 400; i += 37) {
      const rel = path.join('small', i % 3 ? 'deeper' : '', `photo ${i}.jpg`);
      assert.ok((await fsp.readFile(path.join(dst, rel))).equals(await fsp.readFile(path.join(src, rel))), rel);
    }
    assert.strictEqual((await fsp.stat(path.join(dst, 'blank.txt'))).size, 0);
    assert.ok((await fsp.stat(path.join(dst, 'empty'))).isDirectory());
    assert.ok(!fs.existsSync(path.join(dst, 'small', '.DS_Store')));
    assert.strictEqual((await fsp.stat(path.join(dst, 'small', 'photo 3.jpg'))).mtime.toISOString(), '2021-06-01T12:00:00.000Z');
    assert.strictEqual(await fsp.readFile(path.join(B.s.receiveDir, 'notes.txt'), 'utf8'), 'hello from the Mac');
    assert.ok(!fs.existsSync(path.join(B.s.receiveDir, '.beam-incoming', tid)));
    assert.ok(B.s.trusted.some(x => x.id === A.identity.id), 'Mac is now trusted');
  });

  await check('a trusted device sends straight in; the same names don’t overwrite', async () => {
    const n = asks.length;
    const tid = await A.send(B.identity.id, [single]);
    const h = await final(A, tid);
    assert.strictEqual(h.status, 'done', h.error);
    assert.strictEqual(asks.length, n, 'no question asked');
    assert.strictEqual(await fsp.readFile(path.join(B.s.receiveDir, 'notes 2.txt'), 'utf8'), 'hello from the Mac');
  });

  await check('saying no stops it on both sides', async () => {
    const tid = await B.send(A.identity.id, [single]);
    const asksA = [];
    A.once('incoming', t => asksA.push(t));
    await until(() => asksA.length, 5000, 'question');
    A.respond(tid, false);
    assert.strictEqual((await final(B, tid)).status, 'declined');
    assert.strictEqual((await final(A, tid)).status, 'declined');
  });

  await check('text arrives and is handed over', async () => {
    const got = [];
    B.once('text', x => got.push(x));
    const tid = await A.sendText(B.identity.id, 'https://example.com/a?b=1');
    assert.strictEqual((await final(A, tid)).status, 'done');
    await until(() => got.length);
    assert.strictEqual(got[0].text, 'https://example.com/a?b=1');
  });

  await check('after a failure, Retry sends only what’s missing', async () => {
    const tid0 = Date.now();
    let block = true, puts = 0;
    B.testFail = (k) => { puts++; return block && k === 0; };
    const tid = await A.send(B.identity.id, [src]);
    const h = await final(A, tid);
    assert.strictEqual(h.status, 'failed');
    const partial = B.transfers.get(tid);
    assert.ok(partial && partial.done.size > 0, 'receiver kept what arrived');
    const doneBefore = partial.done.size;
    A.history = A.history.filter(x => x.tid !== tid);
    block = false; puts = 0;
    A.retry(tid);
    const h2 = await final(A, tid);
    assert.strictEqual(h2.status, 'done', h2.error);
    assert.ok(puts <= partial.tasks.length - doneBefore + 1, `resent ${puts} jobs`);
    assert.strictEqual(await sha(path.join(B.s.receiveDir, 'Holiday 2', 'video.mov')), await sha(path.join(src, 'video.mov')));
    B.testFail = null;
  });

  await check('the receiver can cancel part-way and the sender stops', async () => {
    const t0 = await A.send(B.identity.id, [path.join(src, 'video.mov')]);
    await until(() => { const t = B.transfers.get(t0); return t && t.status === 'active' && t.bytes > 0; }, 10000, 'start');
    B.cancel(t0);
    const h = await final(A, t0);
    assert.ok(['cancelled', 'failed'].includes(h.status), h.status);
    assert.ok(!fs.existsSync(path.join(B.s.receiveDir, '.beam-incoming', t0)) || await until(() => !fs.existsSync(path.join(B.s.receiveDir, '.beam-incoming', t0)), 3000));
  });

  await check('a device that isn’t trusted can’t send when “trusted only” is on', async () => {
    A.s.receive = 'trusted';
    const tid = await B.send(A.identity.id, [single]);
    const h = await final(B, tid);
    assert.strictEqual(h.status, 'declined');
    assert.match(h.error, /only accepts/);
    A.s.receive = 'everyone';
  });

  await check('a device using someone else’s id with a different key isn’t trusted', async () => {
    const fake = await makeEngine('Fake');
    fake.identity = { ...fake.identity, id: A.identity.id };
    await fake.addAddress(`127.0.0.1:${B.port}`);
    const seen = [];
    B.once('incoming', (t, meta) => seen.push(meta));
    const tid = await fake.send(B.identity.id, [single]);
    await until(() => seen.length, 5000, 'question');
    assert.strictEqual(seen[0].keyChanged, true);
    B.respond(tid, false);
    await final(fake, tid);
    await fake.stop();
  });

  await check('phones: the page, uploads, text and downloads', async () => {
    const info = B.phone.info();
    const tok = B.s.phone.token;
    const get = (p, opts = {}) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: B.port, path: p, headers: opts.headers }, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c), headers: r.headers })); }).on('error', rej));
    const send = (method, p, body, headers = {}) => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port: B.port, path: p, method, headers }, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c) })); }); q.on('error', rej); q.end(body); });
    assert.strictEqual((await get(`/m/${tok}/`)).body.toString(), '<!doctype html><title>PC</title>');
    assert.strictEqual((await get(`/m/wrongtoken12/`)).status, 404);
    assert.ok(info.qr && info.qr.rows.length === info.qr.n);
    const ua = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' };
    const a = crypto.randomBytes(300000), b = crypto.randomBytes(1234);
    const r1 = await send('PUT', `/m/${tok}/api/up?name=IMG_0001.HEIC&size=${a.length}&total=${a.length + b.length}&count=2&batch=b1`, a, ua);
    assert.strictEqual(r1.status, 200, r1.body.toString());
    await send('PUT', `/m/${tok}/api/up?name=../evil.txt&size=${b.length}&total=${a.length + b.length}&count=2&batch=b1`, b, ua);
    const h = await final(B, 'pb1');
    assert.strictEqual(h.status, 'done'); assert.strictEqual(h.peer.name, 'iPhone'); assert.strictEqual(h.count, 2);
    assert.ok((await fsp.readFile(path.join(B.s.receiveDir, 'IMG_0001.HEIC'))).equals(a));
    assert.ok(fs.existsSync(path.join(B.s.receiveDir, 'evil.txt')));
    const short = await send('PUT', `/m/${tok}/api/up?name=x.bin&size=999&count=1&batch=b2`, Buffer.alloc(10), ua);
    assert.strictEqual(short.status, 400);
    const got = []; B.once('text', x => got.push(x));
    assert.strictEqual((await send('POST', `/m/${tok}/api/text`, 'hi from phone', ua)).status, 200);
    assert.strictEqual(got[0].text, 'hi from phone');
    await B.phone.share([single]);
    const list = JSON.parse((await get(`/m/${tok}/api/info`)).body);
    assert.strictEqual(list.shared[0].name, 'notes.txt');
    const dl = await get(`/m/${tok}/api/dl/${list.shared[0].id}`);
    assert.strictEqual(dl.body.toString(), 'hello from the Mac');
    const part = await get(`/m/${tok}/api/dl/${list.shared[0].id}`, { headers: { range: 'bytes=6-9' } });
    assert.strictEqual(part.status, 206); assert.strictEqual(part.body.toString(), 'from');
    B.phone.newLink();
    assert.strictEqual((await get(`/m/${tok}/api/info`)).status, 404, 'old link stops working');
  });

  await check('history is kept between launches', async () => {
    await B.saveHistory();
    const j = JSON.parse(await fsp.readFile(path.join(ROOT, 'PC', 'data', 'history.json'), 'utf8'));
    assert.ok(j.find(x => x.tid === firstTid && x.status === 'done'));
  });

  await A.stop(); await B.stop();

  await check('discovery: two devices find each other (loopback multicast)', async () => {
    const mk = (id, port) => new Discovery({ me: () => ({ id, name: id, os: 'mac', dev: 'laptop', port, pub: C.newKeys().pub, visible: true }), udpPort: 47999, every: 300, gone: 1500 });
    const d1 = mk('one', 1), d2 = mk('two', 2);
    await d1.start(); await d2.start();
    try {
      await until(() => d1.get('two') && d2.get('one'), 4000, 'peers');
      assert.strictEqual(d1.get('two').port, 2);
      d2.stop();
      await until(() => !d1.get('two'), 3000, 'goodbye');
    } finally { d1.stop(); d2.stop(); }
  });

  await check('discovery asks every address on its own networks directly (Wi-Fi ↔ Ethernet)', async () => {
    const real = os.networkInterfaces;
    os.networkInterfaces = () => ({
      en0: [{ family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }],
      en7: [{ family: 'IPv4', address: '10.0.4.9', netmask: '255.255.252.0', internal: false }],
      vEthernet: [{ family: 'IPv4', address: '172.20.0.1', netmask: '255.255.255.0', internal: false }],
      corp: [{ family: 'IPv4', address: '10.200.0.5', netmask: '255.255.0.0', internal: false }],
    });
    try {
      const sent = [];
      const d = new Discovery({ me: () => ({ id: 'me', name: 'me', port: 1, pub: C.newKeys().pub, visible: true }) });
      d.sock = { send: (b, port, addr) => sent.push(addr) };
      d.sweep();
      const lan = sent.filter(a => a.startsWith('192.168.1.'));
      assert.strictEqual(lan.length, 253);
      assert.ok(!lan.includes('192.168.1.20') && !lan.includes('192.168.1.0') && !lan.includes('192.168.1.255'));
      assert.strictEqual(sent.filter(a => a.startsWith('10.0.')).length, 1021, 'a /22 is swept');
      assert.ok(!sent.some(a => a.startsWith('172.20.') || a.startsWith('10.200.')), 'virtual adapters and huge networks are skipped');
      // known devices are also greeted directly on every round
      d.peers.set('p', { id: 'p', addrs: new Map([['192.168.1.77', Date.now()]]) });
      sent.length = 0; d.send('hi');
      assert.ok(sent.includes('192.168.1.77'));
    } finally { os.networkInterfaces = real; }
  });

  await fsp.rm(ROOT, { recursive: true, force: true }).catch(() => {});
  const bad = results.filter(r => !r[0]);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();

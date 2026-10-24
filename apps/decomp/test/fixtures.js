// Builds small sample files for the tests, so nothing big lives in the repo.
'use strict';
const zlib = require('zlib');
const crypto = require('crypto');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

function cso(iso, block = 2048) {
  const n = Math.ceil(iso.length / block); const blocks = []; const idx = Buffer.alloc((n + 1) * 4);
  let pos = 24 + idx.length;
  for (let i = 0; i < n; i++) {
    const raw = iso.subarray(i * block, (i + 1) * block); const c = zlib.deflateRawSync(raw);
    const plain = c.length >= raw.length; const data = plain ? raw : c;
    idx.writeUInt32LE((pos | (plain ? 0x80000000 : 0)) >>> 0, i * 4); blocks.push(data); pos += data.length;
  }
  idx.writeUInt32LE(pos, n * 4);
  const h = Buffer.alloc(24); h.write('CISO'); h.writeUInt32LE(24, 4); h.writeBigUInt64LE(BigInt(iso.length), 8); h.writeUInt32LE(block, 16); h[20] = 1; h[21] = 0;
  return Buffer.concat([h, idx, ...blocks]);
}

function asar(files) {
  const root = { files: {} }; let off = 0; const datas = [];
  for (const [p, content] of Object.entries(files)) {
    const parts = p.split('/'); let node = root;
    for (const d of parts.slice(0, -1)) node = node.files[d] = node.files[d] || { files: {} };
    const b = Buffer.from(content); node.files[parts.at(-1)] = { size: b.length, offset: String(off) }; off += b.length; datas.push(b);
  }
  const json = Buffer.from(JSON.stringify(root)); const payload = pad4(Buffer.concat([u32(json.length), json]));
  const headerPickle = Buffer.concat([u32(payload.length), payload]);
  return Buffer.concat([u32(4), u32(headerPickle.length), headerPickle, ...datas]);
}

function pck(files) {
  const entries = Object.entries(files).map(([p, c]) => [Buffer.from('res://' + p), Buffer.from(c)]);
  let headerLen = 4 + 4 + 12 + 64 + 4; for (const [n] of entries) headerLen += 4 + pad4(n).length + 8 + 8 + 16;
  const parts = [Buffer.from('GDPC'), u32(1), u32(3), u32(5), u32(0), Buffer.alloc(64), u32(entries.length)];
  let off = headerLen;
  for (const [n, c] of entries) { const pn = pad4(n); parts.push(u32(pn.length), pn, u64(off), u64(c.length), crypto.createHash('md5').update(c).digest()); off += c.length; }
  return Buffer.concat([...parts, ...entries.map(([, c]) => c)]);
}

const step = (k) => (Math.imul(k, 7) + 3) >>> 0;
const xorData = (buf, key) => { const out = Buffer.from(buf); let k = key >>> 0; for (let i = 0; i < out.length; i += 4) { for (let j = 0; j < 4 && i + j < out.length; j++) out[i + j] ^= (k >>> (8 * j)) & 0xff; k = step(k); } return out; };
function rgss(files, version = 1) {
  const out = [Buffer.from('RGSSAD\0'), Buffer.from([version])];
  const list = Object.entries(files).map(([p, c]) => [Buffer.from(p.replace(/\//g, '\\')), Buffer.from(c)]);
  if (version === 3) {
    const seed = 0x1234; const key = (Math.imul(seed, 9) + 3) >>> 0; out.push(u32(seed));
    let hdr = 12 + list.reduce((a, [n]) => a + 16 + n.length, 0) + 16; const table = [], datas = [];
    for (const [n, c] of list) {
      const fkey = 0xabc000 + n.length; const nb = Buffer.from(n); for (let i = 0; i < nb.length; i++) nb[i] ^= (key >>> (8 * (i % 4))) & 0xff;
      table.push(u32(hdr ^ key), u32(c.length ^ key), u32(fkey ^ key), u32(n.length ^ key), nb); datas.push(xorData(c, fkey)); hdr += c.length;
    }
    table.push(u32(0 ^ key), Buffer.alloc(12));
    return Buffer.concat([...out, ...table, ...datas]);
  }
  let key = 0xdeadcafe;
  for (const [n, c] of list) {
    out.push(u32(n.length ^ key)); key = step(key);
    const nb = Buffer.from(n); for (let i = 0; i < nb.length; i++) { nb[i] ^= key & 0xff; key = step(key); } out.push(nb);
    out.push(u32(c.length ^ key)); key = step(key);
    out.push(xorData(c, key));
  }
  return Buffer.concat(out);
}

// Xbox XDVDFS: volume descriptor at 0x10000, one root table with a file and a folder holding one file.
function xiso() {
  const S = 2048; const img = Buffer.alloc(S * 40);
  const vd = 0x10000; img.write('MICROSOFT*XBOX*MEDIA', vd, 'latin1'); img.write('MICROSOFT*XBOX*MEDIA', vd + 0x7ec, 'latin1');
  const entry = (left, right, sector, size, attr, name) => { const b = Buffer.alloc(14 + name.length); b.writeUInt16LE(left, 0); b.writeUInt16LE(right, 2); b.writeUInt32LE(sector, 4); b.writeUInt32LE(size, 8); b[12] = attr; b[13] = name.length; b.write(name, 14, 'latin1'); return pad4(b); };
  const xbe = Buffer.from('XBEH' + 'fake executable'), txt = Buffer.from('hello from a subfolder');
  // root table at sector 33: "default.xbe" (right → "media")
  const e2 = entry(0, 0, 34, S, 0x10, 'media'); const e1 = entry(0, 0, 0, 0, 0, 'default.xbe');
  const e1real = entry(0, e1.length / 4, 35, xbe.length, 0x20, 'default.xbe');
  const root = Buffer.concat([e1real, e2]); void e1;
  img.writeUInt32LE(33, vd + 20); img.writeUInt32LE(root.length, vd + 24);
  root.copy(img, 33 * S);
  const sub = entry(0, 0, 36, txt.length, 0x20, 'note.txt'); sub.copy(img, 34 * S); img.writeUInt32LE(sub.length, 33 * S + e1real.length + 8);
  xbe.copy(img, 35 * S); txt.copy(img, 36 * S);
  return img;
}

function gcm() {
  const img = Buffer.alloc(0x20000);
  img.write('GDCE01', 0, 'latin1'); img.writeUInt32BE(0xc2339f3d, 0x1c); img.write('Decomp Test Game', 0x20, 'latin1');
  const dol = 0x8000, fst = 0x9000;
  img.writeUInt32BE(dol, 0x420); img.writeUInt32BE(fst, 0x424);
  img.writeUInt32BE(0x20, 0x2440 + 0x14); // apploader size
  img.writeUInt32BE(0x100, dol); img.writeUInt32BE(0x40, dol + 0x90); // one text section: offset 0x100 size 0x40
  // FST: root(3 entries) / dir "data" (ends at 3) / file "data/a.txt"
  const names = Buffer.from('data\0a.txt\0'); const t = Buffer.alloc(36);
  t[0] = 1; t.writeUInt32BE(3, 8);
  t[12] = 1; t.writeUIntBE(0, 13, 3); t.writeUInt32BE(0, 16); t.writeUInt32BE(3, 20);
  t[24] = 0; t.writeUIntBE(5, 25, 3); t.writeUInt32BE(0xa000, 28); t.writeUInt32BE(5, 32);
  const fstBuf = Buffer.concat([t, names]); fstBuf.copy(img, fst); img.writeUInt32BE(fstBuf.length, 0x428);
  img.write('hello', 0xa000, 'latin1');
  return img;
}

// marshal helpers (subset) for a fake PYZ table
const mstr = (s) => Buffer.concat([Buffer.from([0x7a, s.length]), Buffer.from(s, 'latin1')]);
const mint = (n) => Buffer.concat([Buffer.from([0x69]), u32(n)]);
function pyinstaller() {
  const magic = Buffer.from([0xcb, 0x0d, 0x0d, 0x0a]); // 3.12
  const mod = zlib.deflateSync(Buffer.from('fake code object'));
  const pyzHead = Buffer.concat([Buffer.from('PYZ\0'), magic, Buffer.alloc(4)]);
  const modPos = pyzHead.length;
  const toc = Buffer.concat([Buffer.from([0x5b]), u32(1), Buffer.from([0x29, 2]), mstr('mypkg.tool'), Buffer.from([0x29, 3]), mint(0), mint(modPos), mint(mod.length)]);
  const pyz = Buffer.concat([pyzHead, mod, toc]); pyz.writeUInt32BE(modPos + mod.length, 8);
  const script = zlib.deflateSync(Buffer.from('main code'));
  const entries = [['s', 'main', script, 9], ['z', 'PYZ.pyz', pyz, pyz.length]];
  const pkg = []; let pos = 0; const tocParts = [];
  for (const [type, name, data, usize] of entries) {
    const es = Math.ceil((18 + name.length + 1) / 16) * 16; const nm = Buffer.alloc(es - 18); nm.write(name); const e = Buffer.alloc(18);
    e.writeUInt32BE(es, 0); e.writeUInt32BE(pos, 4); e.writeUInt32BE(data.length, 8); e.writeUInt32BE(usize, 12); e[16] = type === 's' ? 1 : 0; e[17] = type.charCodeAt(0);
    tocParts.push(e, nm); pkg.push(type === 's' ? data : data); pos += data.length;
  }
  const tocBuf = Buffer.concat(tocParts); const body = Buffer.concat([...pkg, tocBuf]);
  const cookie = Buffer.alloc(88); Buffer.from('MEI\x0c\x0b\x0a\x0b\x0e', 'latin1').copy(cookie, 0);
  cookie.writeUInt32BE(body.length + 88, 8); cookie.writeUInt32BE(pos, 12); cookie.writeUInt32BE(tocBuf.length, 16); cookie.writeUInt32BE(312, 20); cookie.write('libpython3.12.so.1.0', 24);
  return Buffer.concat([Buffer.from('\x7fELF fake host program padding'.padEnd(256, '.')), body, cookie]);
}

function dotnetBundle() {
  const SIG = Buffer.from('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae', 'hex');
  const dll = Buffer.from('MZ fake assembly'), cfg = Buffer.from('{"runtimeOptions":{}}');
  const host = Buffer.concat([Buffer.from('MZ host'.padEnd(64, '\0')), Buffer.alloc(8), SIG, Buffer.alloc(32)]);
  const dllOff = host.length, cfgOff = dllOff + dll.length, man = cfgOff + cfg.length;
  const str = (s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)]);
  const entry = (off, size, type, name) => Buffer.concat([u64(off), u64(size), u64(0), Buffer.from([type]), str(name)]);
  const manifest = Buffer.concat([u32(6), u32(0), u32(2), str('bundle-id'), Buffer.alloc(40), entry(dllOff, dll.length, 1, 'MyApp.dll'), entry(cfgOff, cfg.length, 4, 'MyApp.runtimeconfig.json')]);
  const out = Buffer.concat([host, dll, cfg, manifest]);
  out.writeBigInt64LE(BigInt(man), 64);
  return out;
}

function wasm() {
  // (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
  return Buffer.from('0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b', 'hex');
}

function firmware() {
  const rnd = (n) => crypto.randomBytes(n);
  const gz = zlib.gzipSync(Buffer.from('config=1\n'.repeat(200)));
  const zipFile = Buffer.concat([Buffer.from('504b0304', 'hex'), rnd(60)]);
  return { buf: Buffer.concat([rnd(5000), gz, rnd(3000), zipFile, rnd(1000)]), gzAt: 5000, zipAt: 5000 + gz.length + 3000 };
}

function tar(files) {
  const parts = [];
  for (const [p, c] of Object.entries(files)) {
    const b = Buffer.from(c); const h = Buffer.alloc(512);
    h.write(p, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(b.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h.write('0', 156); h.write('ustar\0' + '00', 257);
    let sum = 0; for (const x of h) sum += x; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(h, b, Buffer.alloc((512 - (b.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

module.exports = { cso, asar, pck, rgss, xiso, gcm, pyinstaller, dotnetBundle, wasm, firmware, tar };

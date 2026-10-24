'use strict';
// End-to-end encryption between two Beam devices.
// Every device has a long-lived X25519 key. Two devices derive one shared AES-256 key from
// their keys (ECDH + HKDF), so nothing on the wire is readable without one of the two private keys,
// and a device can't pretend to be another one it doesn't hold the key for.
// Bodies are cut into frames of up to 1 MiB, each sealed with AES-256-GCM. The frame header (length +
// "last frame" bit) is authenticated too, so a reordered, altered or cut-short stream is detected.
const crypto = require('crypto');
const { Transform } = require('stream');

const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const FRAME = 1 << 20;
const LAST = 0x80000000;

function newKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
  };
}

function validPub(pub) {
  try { return typeof pub === 'string' && Buffer.from(pub, 'base64').length === 32; } catch { return false; }
}

const privCache = new Map();
const keyCache = new Map();
function sharedKey(myPriv, myId, theirPub, theirId) {
  const ck = myPriv.slice(-24) + '|' + myId + '|' + theirId + '|' + theirPub;
  let k = keyCache.get(ck);
  if (k) return k;
  if (!validPub(theirPub)) throw new Error('bad key');
  let pk = privCache.get(myPriv);
  if (!pk) { pk = crypto.createPrivateKey({ key: Buffer.from(myPriv, 'base64'), format: 'der', type: 'pkcs8' }); privCache.set(myPriv, pk); }
  const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(theirPub, 'base64')]), format: 'der', type: 'spki' });
  const secret = crypto.diffieHellman({ privateKey: pk, publicKey: pub });
  const salt = [myId, theirId].sort().join('|');
  k = Buffer.from(crypto.hkdfSync('sha256', secret, salt, 'beam v1', 32));
  if (keyCache.size > 200) keyCache.clear();
  keyCache.set(ck, k);
  return k;
}

// A short code both screens can show to compare (like Bluetooth pairing): the same on both ends only
// when each side really has the other's key.
function safetyCode(pubA, pubB) {
  const h = crypto.createHash('sha256').update([pubA, pubB].sort().join('|')).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2');
}

function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj))), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}
function open(key, buf) {
  if (!buf || buf.length < 28) throw new Error('bad message');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  const pt = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
  return JSON.parse(pt.toString());
}

function nonce(base, n) {
  const iv = Buffer.alloc(12); base.copy(iv, 0, 0, 8); iv.writeUInt32BE(n, 8); return iv;
}

class Encrypt extends Transform {
  constructor(key, base) {
    super({ highWaterMark: 2 * FRAME });
    this.key = key; this.base = base; this.n = 0; this.buf = []; this.len = 0;
  }
  frame(pt, last) {
    const hdr = Buffer.alloc(4); hdr.writeUInt32BE((pt.length | (last ? LAST : 0)) >>> 0);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, nonce(this.base, this.n++));
    c.setAAD(hdr);
    const ct = c.update(pt); c.final();
    this.push(Buffer.concat([hdr, ct, c.getAuthTag()]));
  }
  _transform(chunk, _e, cb) {
    this.buf.push(chunk); this.len += chunk.length;
    if (this.len >= FRAME) {
      let all = Buffer.concat(this.buf, this.len);
      while (all.length >= FRAME) { this.frame(all.subarray(0, FRAME), false); all = all.subarray(FRAME); }
      this.buf = all.length ? [all] : []; this.len = all.length;
    }
    cb();
  }
  _flush(cb) {
    this.frame(Buffer.concat(this.buf, this.len), true);
    this.buf = []; this.len = 0; cb();
  }
}

class Decrypt extends Transform {
  constructor(key, base) {
    super({ readableHighWaterMark: 2 * FRAME });
    this.key = key; this.base = base; this.n = 0; this.buf = []; this.len = 0; this.done = false;
  }
  take(n) {
    const all = this.buf.length === 1 ? this.buf[0] : Buffer.concat(this.buf, this.len);
    const out = all.subarray(0, n), rest = all.subarray(n);
    this.buf = rest.length ? [rest] : []; this.len = rest.length;
    return out;
  }
  peek4() {
    if (this.buf[0].length >= 4) return this.buf[0].readUInt32BE(0);
    const all = Buffer.concat(this.buf, this.len); this.buf = [all]; return all.readUInt32BE(0);
  }
  _transform(chunk, _e, cb) {
    if (this.done) return cb(new Error('data after the last frame'));
    this.buf.push(chunk); this.len += chunk.length;
    try {
      while (this.len >= 4) {
        const h = this.peek4();
        const n = (h & ~LAST) >>> 0, last = (h & LAST) !== 0;
        if (n > FRAME) throw new Error('frame too large');
        if (this.len < 4 + n + 16) break;
        const f = this.take(4 + n + 16);
        const d = crypto.createDecipheriv('aes-256-gcm', this.key, nonce(this.base, this.n++));
        d.setAAD(f.subarray(0, 4)); d.setAuthTag(f.subarray(4 + n));
        const pt = d.update(f.subarray(4, 4 + n)); d.final();
        if (pt.length) this.push(pt);
        if (last) { this.done = true; if (this.len) throw new Error('data after the last frame'); break; }
      }
      cb();
    } catch (e) { cb(e.message && /unable to authenticate|Unsupported state/i.test(e.message) ? new Error('integrity check failed') : e); }
  }
  _flush(cb) { cb(this.done ? null : new Error('the stream was cut short')); }
}

module.exports = { newKeys, validPub, sharedKey, safetyCode, seal, open, Encrypt, Decrypt, FRAME };

// Property lists: binary (bplist00) and XML, returned as plain JS values.
'use strict';

function parseBinary(b) {
  const t = b.subarray(b.length - 32);
  const offSize = t[6], refSize = t[7];
  const num = Number(t.readBigUInt64BE(8)), top = Number(t.readBigUInt64BE(16)), tableOff = Number(t.readBigUInt64BE(24));
  const uint = (o, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i]; return v; };
  const offsets = []; for (let i = 0; i < num; i++) offsets.push(uint(tableOff + i * offSize, offSize));
  const seen = new Set();
  const obj = (i, depth = 0) => {
    if (depth > 64 || seen.has(i)) return null;
    const o = offsets[i]; const m = b[o], hi = m >> 4, lo = m & 15;
    const len = () => { if (lo !== 15) return [lo, o + 1]; const im = b[o + 1]; const n = 1 << (im & 15); return [uint(o + 2, n), o + 2 + n]; };
    switch (hi) {
      case 0: return lo === 8 ? false : lo === 9 ? true : null;
      case 1: { const n = 1 << lo; return n === 8 ? Number(b.readBigInt64BE(o + 1)) : uint(o + 1, n); }
      case 2: return lo === 2 ? b.readFloatBE(o + 1) : b.readDoubleBE(o + 1);
      case 3: return new Date((978307200 + b.readDoubleBE(o + 1)) * 1000).toISOString();
      case 4: { const [n, s] = len(); return `<${n} bytes>`; void s; }
      case 5: { const [n, s] = len(); return b.toString('latin1', s, s + n); }
      case 6: { const [n, s] = len(); const c = Buffer.from(b.subarray(s, s + n * 2)); c.swap16(); return c.toString('utf16le'); }
      case 8: return { UID: uint(o + 1, lo + 1) };
      case 10: { const [n, s] = len(); seen.add(i); const a = []; for (let k = 0; k < n; k++) a.push(obj(uint(s + k * refSize, refSize), depth + 1)); seen.delete(i); return a; }
      case 13: { const [n, s] = len(); seen.add(i); const d = {}; for (let k = 0; k < n; k++) d[obj(uint(s + k * refSize, refSize), depth + 1)] = obj(uint(s + (n + k) * refSize, refSize), depth + 1); seen.delete(i); return d; }
      default: return null;
    }
  };
  return obj(top);
}

function parseXml(s) {
  let i = s.indexOf('<plist'); if (i < 0) throw new Error('not a plist'); i = s.indexOf('>', i) + 1;
  const ws = () => { while (i < s.length) { if (/\s/.test(s[i])) i++; else if (s.startsWith('<!--', i)) i = s.indexOf('-->', i) + 3; else break; } };
  const unesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  const val = () => {
    ws();
    const m = s.slice(i).match(/^<(\w+)\s*(\/?)>/); if (!m) return undefined;
    const tag = m[1]; i += m[0].length;
    if (m[2]) return tag === 'true' ? true : tag === 'false' ? false : tag === 'dict' ? {} : tag === 'array' ? [] : '';
    if (tag === 'dict') { const d = {}; for (;;) { ws(); if (s.startsWith('</dict>', i)) { i += 7; return d; } const k = s.indexOf('</key>', i); const key = unesc(s.slice(s.indexOf('>', i) + 1, k)); i = k + 6; d[key] = val(); } }
    if (tag === 'array') { const a = []; for (;;) { ws(); if (s.startsWith('</array>', i)) { i += 8; return a; } a.push(val()); } }
    const end = s.indexOf(`</${tag}>`, i); const t = s.slice(i, end); i = end + tag.length + 3;
    if (tag === 'integer') return parseInt(t, 10); if (tag === 'real') return parseFloat(t); if (tag === 'data') return `<${Math.floor(t.replace(/\s/g, '').length * 0.75)} bytes>`;
    return unesc(t);
  };
  return val();
}

function parse(buf) {
  if (buf.toString('latin1', 0, 8) === 'bplist00') return parseBinary(buf);
  return parseXml(buf.toString('utf8'));
}
module.exports = { parse };

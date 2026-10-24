// Android binary XML (AndroidManifest.xml and compiled res/*.xml) back to readable XML.
'use strict';

const DIM = ['px', 'dp', 'sp', 'pt', 'in', 'mm'];
function value(dtype, data, strings) {
  switch (dtype) {
    case 0x01: return `@0x${(data >>> 0).toString(16).padStart(8, '0')}`;
    case 0x02: return `?0x${(data >>> 0).toString(16).padStart(8, '0')}`;
    case 0x03: return strings[data] ?? '';
    case 0x04: { const b = Buffer.alloc(4); b.writeUInt32LE(data >>> 0); return String(+b.readFloatLE(0).toFixed(6)); }
    case 0x05: return `${((data >> 8) * [1 / 256, 1 / 32768, 1 / 8388608, 1 / 2147483648][(data >> 4) & 3]).toFixed(2).replace(/\.?0+$/, '')}${DIM[data & 15] || ''}`;
    case 0x06: return `${((data >> 8) * [1 / 256, 1 / 32768, 1 / 8388608, 1 / 2147483648][(data >> 4) & 3] * 100).toFixed(2)}%`;
    case 0x10: return String(data | 0);
    case 0x11: return '0x' + (data >>> 0).toString(16);
    case 0x12: return data !== 0 ? 'true' : 'false';
    case 0x1c: case 0x1d: case 0x1e: case 0x1f: return '#' + (data >>> 0).toString(16).padStart(8, '0');
    default: return `0x${(data >>> 0).toString(16)}`;
  }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// Common android: attribute ids for obfuscated manifests whose names were stripped.
const ATTR = { 0x01010003: 'name', 0x01010001: 'label', 0x01010002: 'icon', 0x0101021b: 'versionCode', 0x0101021c: 'versionName', 0x0101020c: 'minSdkVersion', 0x01010270: 'targetSdkVersion', 0x01010010: 'exported', 0x0101000f: 'enabled', 0x01010006: 'permission' };

function toXml(buf) {
  if (buf.readUInt16LE(0) !== 0x0003) throw new Error('Not Android binary XML');
  const u16 = (o) => buf.readUInt16LE(o), u32 = (o) => buf.readUInt32LE(o);
  let strings = [], resIds = [], out = '<?xml version="1.0" encoding="utf-8"?>\n', depth = 0;
  const ns = new Map(); let pendingNs = [];
  let p = u16(2);
  while (p + 8 <= buf.length) {
    const type = u16(p), hsz = u16(p + 2), csz = u32(p + 4);
    if (csz < 8) break;
    if (type === 0x0001) {
      const n = u32(p + 8), flags = u32(p + 16), sStart = u32(p + 20), utf8 = !!(flags & 0x100);
      strings = new Array(n);
      for (let i = 0; i < n; i++) {
        let o = p + sStart + u32(p + hsz + i * 4);
        if (utf8) { let l = buf[o++]; if (l & 0x80) o++; let bl = buf[o++]; if (bl & 0x80) bl = ((bl & 0x7f) << 8) | buf[o++]; strings[i] = buf.toString('utf8', o, o + bl); }
        else { let l = u16(o); o += 2; if (l & 0x8000) { l = ((l & 0x7fff) << 16) | u16(o); o += 2; } strings[i] = buf.toString('utf16le', o, o + l * 2); }
      }
    } else if (type === 0x0180) { resIds = []; for (let o = p + 8; o < p + csz; o += 4) resIds.push(u32(o)); }
    else if (type === 0x0100) { const prefix = strings[u32(p + 16)], uri = strings[u32(p + 20)]; ns.set(uri, prefix); pendingNs.push([prefix, uri]); }
    else if (type === 0x0102) {
      const tag = strings[u32(p + 20)];
      const attrStart = u16(p + 24), attrSize = u16(p + 26), attrCount = u16(p + 28);
      let s = '  '.repeat(depth) + '<' + tag;
      for (const [prefix, uri] of pendingNs) s += ` xmlns:${prefix}="${esc(uri)}"`;
      pendingNs = [];
      for (let i = 0; i < attrCount; i++) {
        const a = p + 16 + attrStart + i * attrSize;
        const nsi = u32(a), ni = u32(a + 4), raw = u32(a + 8), dtype = buf[a + 15], data = u32(a + 16);
        let name = strings[ni]; if (!name) name = ATTR[resIds[ni]] || `attr_0x${(resIds[ni] || ni).toString(16)}`;
        const pre = nsi !== 0xffffffff ? ns.get(strings[nsi]) : null;
        const v = raw !== 0xffffffff ? strings[raw] : value(dtype, data, strings);
        s += `${attrCount > 2 ? '\n' + '  '.repeat(depth + 1) : ' '}${pre ? pre + ':' : ''}${name}="${esc(v)}"`;
      }
      out += s + '>\n'; depth++;
    } else if (type === 0x0103) { depth = Math.max(0, depth - 1); out += '  '.repeat(depth) + `</${strings[u32(p + 20)]}>\n`; }
    else if (type === 0x0104) { const t = strings[u32(p + 16)]; if (t && t.trim()) out += '  '.repeat(depth) + esc(t.trim()) + '\n'; }
    p += csz;
  }
  return out;
}

// The handful of fields the overview shows.
function summary(buf) {
  const xml = toXml(buf);
  const get = (re) => (xml.match(re) || [])[1] || null;
  return {
    package: get(/\spackage="([^"]+)"/), versionName: get(/versionName="([^"]+)"/), versionCode: get(/versionCode="([^"]+)"/),
    minSdk: get(/minSdkVersion="([^"]+)"/), targetSdk: get(/targetSdkVersion="([^"]+)"/),
    permissions: [...xml.matchAll(/<uses-permission[^>]*?name="([^"]+)"/g)].map((m) => m[1]),
    activities: [...xml.matchAll(/<activity[^>]*?name="([^"]+)"/g)].map((m) => m[1]).slice(0, 200),
    xml,
  };
}
module.exports = { toXml, summary };

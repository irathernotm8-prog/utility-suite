// Java class files and Android DEX headers.
'use strict';

function classInfo(b) {
  if (b.readUInt32BE(0) !== 0xcafebabe) return null;
  const minor = b.readUInt16BE(4), major = b.readUInt16BE(6);
  if (major < 45 || major > 80) return null;
  const n = b.readUInt16BE(8); const cp = new Array(n); let p = 10;
  for (let i = 1; i < n; i++) {
    const tag = b[p];
    if (tag === 1) { const l = b.readUInt16BE(p + 1); cp[i] = { t: 1, s: b.toString('utf8', p + 3, p + 3 + l) }; p += 3 + l; }
    else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) { cp[i] = { t: tag, i: b.readUInt16BE(p + 1) }; p += 3; }
    else if (tag === 15) p += 4;
    else if (tag === 3 || tag === 4 || tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) p += 5;
    else if (tag === 5 || tag === 6) { p += 9; i++; }
    else return { major, minor, java: major - 44 };
  }
  const utf = (i) => (cp[i] && cp[i].t === 1 ? cp[i].s : '');
  const cls = (i) => (cp[i] && cp[i].t === 7 ? utf(cp[i].i) : '');
  const access = b.readUInt16BE(p), thisC = cls(b.readUInt16BE(p + 2)), superC = cls(b.readUInt16BE(p + 4));
  return { major, minor, java: major >= 49 ? major - 44 : `1.${major - 44}`, name: thisC.replace(/\//g, '.'), super: superC.replace(/\//g, '.'), interface: !!(access & 0x200), abstract: !!(access & 0x400) };
}

function dexInfo(b) {
  if (b.toString('latin1', 0, 4) !== 'dex\n') return null;
  const v = b.toString('latin1', 4, 7);
  return { version: v, strings: b.readUInt32LE(0x38), types: b.readUInt32LE(0x40), methods: b.readUInt32LE(0x58), fields: b.readUInt32LE(0x50), classes: b.readUInt32LE(0x60), size: b.readUInt32LE(0x20), android: { '035': '≤ 7', '037': '7.0+', '038': '8.0+', '039': '9.0+', '040': '15+', '041': '15+' }[v] || '?' };
}
module.exports = { classInfo, dexInfo };

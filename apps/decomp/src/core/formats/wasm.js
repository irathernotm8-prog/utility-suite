// WebAssembly module summary (sections, imports, exports, function count, names).
'use strict';
function info(b) {
  if (b.length < 8 || b.readUInt32LE(0) !== 0x6d736100) return null;
  let p = 8; const sections = []; let imports = [], exports = [], funcs = 0, customs = [];
  const leb = () => { let v = 0, s = 0, c; do { c = b[p++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return v; };
  const name = () => { const n = leb(); const s = b.toString('utf8', p, p + n); p += n; return s; };
  const KINDS = ['func', 'table', 'memory', 'global', 'tag'];
  while (p < b.length) {
    const id = b[p++]; const size = leb(); const end = p + size;
    sections.push({ id, size });
    try {
      if (id === 0) customs.push(name());
      else if (id === 2) { const n = leb(); for (let i = 0; i < n && i < 5000; i++) { const mod = name(), fld = name(); const k = b[p++]; imports.push(`${mod}.${fld} (${KINDS[k]})`); if (k === 0) leb(); else if (k === 1) { p++; const f = b[p++]; leb(); if (f & 1) leb(); } else if (k === 2) { const f = b[p++]; leb(); if (f & 1) leb(); } else if (k === 3) p += 2; else leb(); } }
      else if (id === 3) funcs = leb();
      else if (id === 7) { const n = leb(); for (let i = 0; i < n && i < 5000; i++) { const nm = name(); const k = b[p++]; leb(); exports.push(`${nm} (${KINDS[k]})`); } }
    } catch {}
    p = end;
  }
  return { version: b.readUInt32LE(4), functions: funcs, imports, exports, customSections: customs, hasNames: customs.includes('name'), sections: sections.length };
}
module.exports = { info };

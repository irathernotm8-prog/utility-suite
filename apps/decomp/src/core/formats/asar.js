// Electron app archives (app.asar): JSON header + concatenated files; unpacked members live beside it
// in app.asar.unpacked.
'use strict';
const fs = require('fs');
const path = require('path');
const { FileReader } = require('../util');

function open(file) {
  const r = new FileReader(file);
  try {
    const h = r.read(0, 16);
    const headerSize = h.readUInt32LE(4), jsonLen = h.readUInt32LE(12);
    const json = JSON.parse(r.read(16, jsonLen).toString('utf8'));
    const base = 8 + headerSize;
    const entries = [];
    const visit = (node, prefix) => {
      for (const [name, v] of Object.entries(node.files || {})) {
        const full = prefix ? prefix + '/' + name : name;
        if (v.files) { entries.push({ path: full, dir: true, size: 0 }); visit(v, full); }
        else if (v.link) entries.push({ path: full, size: 0, link: v.link });
        else entries.push({ path: full, size: v.size || 0, offset: v.unpacked ? null : base + Number(v.offset), unpacked: !!v.unpacked, exec: !!v.executable, integrity: v.integrity ? v.integrity.algorithm : undefined });
      }
    };
    visit(json, '');
    const unpackedDir = file + '.unpacked';
    return {
      format: 'asar', entries,
      info: { files: entries.filter((e) => !e.dir).length, unpacked: entries.filter((e) => e.unpacked).length, integrity: entries.some((e) => e.integrity) },
      read(e) { if (typeof e === 'string') e = entries.find((x) => x.path === e); if (!e) return null; return e.unpacked ? fs.readFileSync(path.join(unpackedDir, e.path)) : r.read(e.offset, e.size); },
      extract(e, dest) {
        if (e.dir) { fs.mkdirSync(dest, { recursive: true }); return; }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (e.link) { fs.writeFileSync(dest + '.link.txt', 'link → ' + e.link); return; }
        if (e.unpacked) { const s = path.join(unpackedDir, e.path); if (fs.existsSync(s)) fs.copyFileSync(s, dest); return; }
        const out = fs.openSync(dest, 'w');
        try { let d = 0; while (d < e.size) { const n = Math.min(8 << 20, e.size - d); fs.writeSync(out, r.read(e.offset + d, n)); d += n; } } finally { fs.closeSync(out); }
      },
      close() { r.close(); },
    };
  } catch (e) { r.close(); throw new Error('Not a readable asar archive: ' + e.message); }
}
const probe = (r) => { const h = r.read(0, 16); return h.length === 16 && h.readUInt32LE(0) === 4 && h.readUInt32LE(12) > 0 && h.readUInt32LE(12) < h.readUInt32LE(4) && r.read(16, 1).toString() === '{'; };
module.exports = { open, probe };

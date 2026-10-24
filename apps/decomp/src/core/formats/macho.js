// Mac and iOS binaries (Mach-O, thin or universal): architectures, linked libraries, platform, code
// signature and App Store encryption (encrypted iOS binaries can't be decompiled until decrypted).
'use strict';
const { FileReader, cstr } = require('../util');

const CPU = { 7: 'x86', 0x01000007: 'x86_64', 12: 'ARM', 0x0100000c: 'ARM64', 0x0200000c: 'ARM64_32', 18: 'PowerPC', 0x01000012: 'PowerPC64' };
const FT = { 1: 'Object', 2: 'Executable', 6: 'Dynamic library', 7: 'Dynamic linker', 8: 'Bundle', 10: 'Debug symbols (dSYM)', 11: 'Kext bundle' };
const PLAT = { 1: 'macOS', 2: 'iOS', 3: 'tvOS', 4: 'watchOS', 6: 'Mac Catalyst', 7: 'iOS Simulator', 11: 'visionOS' };

function fat(r) {
  const h = r.read(0, 8);
  if (h.length < 8) return null;
  const m = h.readUInt32BE(0);
  if (m !== 0xcafebabe && m !== 0xcafebabf) return null;
  const n = h.readUInt32BE(4);
  if (n === 0 || n > 30) return null;                     // Java class files share this magic
  const w = m === 0xcafebabf ? 32 : 20, t = r.read(8, n * w), out = [];
  for (let i = 0; i < n; i++) { const o = i * w; out.push({ cpu: CPU[t.readUInt32BE(o)] || t.readUInt32BE(o), offset: w === 32 ? Number(t.readBigUInt64BE(o + 8)) : t.readUInt32BE(o + 8), size: w === 32 ? Number(t.readBigUInt64BE(o + 16)) : t.readUInt32BE(o + 12) }); }
  return out;
}

function thin(r, base) {
  const h = r.read(base, 32);
  const m = h.readUInt32LE(0);
  const is64 = m === 0xfeedfacf, le = m === 0xfeedface || m === 0xfeedfacf;
  if (!le) return null;
  const cpu = h.readUInt32LE(4), ft = h.readUInt32LE(12), ncmds = h.readUInt32LE(16), sz = h.readUInt32LE(20), flags = h.readUInt32LE(24);
  const lc = r.read(base + (is64 ? 32 : 28), Math.min(sz, 4 << 20));
  const out = { cpu: CPU[cpu] || cpu, type: FT[ft] || ft, pie: !!(flags & 0x200000), libs: [], segments: [], signed: false, encrypted: false, platform: null, minOS: null, uuid: null, objc: false, swift: false, id: null, entry: null };
  let p = 0;
  for (let i = 0; i < ncmds && p + 8 <= lc.length; i++) {
    const cmd = lc.readUInt32LE(p), cs = lc.readUInt32LE(p + 4);
    if (cs < 8) break;
    const c = lc.subarray(p, p + cs);
    if (cmd === 0x19 || cmd === 0x1) {
      const segname = cstr(c, 8, 24), nsects = c.readUInt32LE(cmd === 0x19 ? 64 : 48);
      const sects = [];
      for (let s = 0; s < nsects; s++) { const so = (cmd === 0x19 ? 72 : 56) + s * (cmd === 0x19 ? 80 : 68); if (so + 32 > c.length) break; const sn = cstr(c, so, so + 16); sects.push(sn); if (/__objc_classlist|__objc_imageinfo/.test(sn)) out.objc = true; if (/__swift5_/.test(sn)) out.swift = true; }
      out.segments.push({ name: segname, sections: sects });
    } else if (cmd === 0xc || cmd === 0x80000018 || cmd === 0x8000001f || cmd === 0x23) out.libs.push(cstr(c, c.readUInt32LE(8)));
    else if (cmd === 0xd) out.id = cstr(c, c.readUInt32LE(8));
    else if (cmd === 0x1d) out.signed = true;
    else if (cmd === 0x21 || cmd === 0x2c) out.encrypted = out.encrypted || c.readUInt32LE(16) !== 0;
    else if (cmd === 0x32) { out.platform = PLAT[c.readUInt32LE(8)] || c.readUInt32LE(8); const v = c.readUInt32LE(12); out.minOS = `${v >> 16}.${(v >> 8) & 0xff}`; }
    else if (cmd === 0x24 || cmd === 0x25 || cmd === 0x2f || cmd === 0x30) { out.platform = out.platform || { 0x24: 'macOS', 0x25: 'iOS', 0x2f: 'tvOS', 0x30: 'watchOS' }[cmd]; const v = c.readUInt32LE(8); out.minOS = out.minOS || `${v >> 16}.${(v >> 8) & 0xff}`; }
    else if (cmd === 0x1b) out.uuid = c.subarray(8, 24).toString('hex').toUpperCase().replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
    else if (cmd === 0x80000028) out.entry = '0x' + Number(c.readBigUInt64LE(8)).toString(16);
    p += cs;
  }
  return out;
}

function parse(file, { r: given } = {}) {
  const r = given || new FileReader(file);
  try {
    const arches = fat(r);
    if (arches) return { format: 'Mach-O universal', arches: arches.map((a) => ({ ...a, ...(thin(r, a.offset) || {}) })) };
    const t = thin(r, 0);
    return t ? { format: 'Mach-O', arches: [{ offset: 0, size: r.size, ...t }] } : null;
  } finally { if (!given) r.close(); }
}
module.exports = { parse, fat };

// Windows executables and DLLs (PE32/PE32+): headers, sections, imports, exports, version info,
// signature, overlay, and the .NET CLR header (managed code → ILSpy).
'use strict';
const { FileReader, cstr } = require('../util');

const MACHINES = { 0x14c: 'x86', 0x8664: 'x64', 0xaa64: 'ARM64', 0x1c0: 'ARM', 0x1c4: 'ARMv7 (Thumb-2)', 0x200: 'Itanium', 0xebc: 'EFI bytecode', 0x5064: 'RISC-V 64' };
const SUBSYS = { 1: 'Native', 2: 'Windows GUI', 3: 'Console', 7: 'POSIX', 9: 'Windows CE', 10: 'EFI application', 11: 'EFI boot driver', 12: 'EFI runtime driver', 14: 'Xbox', 16: 'Boot application' };

function parse(file, { r: given } = {}) {
  const r = given || new FileReader(file);
  try {
    const dos = r.read(0, 64);
    if (dos.length < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return null;
    const peOff = dos.readUInt32LE(0x3c);
    const nt = r.read(peOff, 24 + 240);
    if (nt.length < 24 || nt.toString('latin1', 0, 4) !== 'PE\0\0') return { dosOnly: true };
    const machine = nt.readUInt16LE(4), nsec = nt.readUInt16LE(6), ts = nt.readUInt32LE(8), optSize = nt.readUInt16LE(20), chars = nt.readUInt16LE(22);
    const o = 24, magic = nt.readUInt16LE(o), pe64 = magic === 0x20b;
    const entry = nt.readUInt32LE(o + 16);
    const imageBase = pe64 ? Number(nt.readBigUInt64LE(o + 24)) : nt.readUInt32LE(o + 28);
    const subsystem = nt.readUInt16LE(o + 68);
    const ddOff = o + (pe64 ? 112 : 96), ndd = Math.min(16, nt.readUInt32LE(ddOff - 4));
    const dirs = []; for (let i = 0; i < ndd; i++) dirs.push({ rva: nt.readUInt32LE(ddOff + i * 8), size: nt.readUInt32LE(ddOff + i * 8 + 4) });
    const secTab = r.read(peOff + 24 + optSize, nsec * 40);
    const sections = [];
    for (let i = 0; i < nsec; i++) {
      const s = secTab.subarray(i * 40, i * 40 + 40); if (s.length < 40) break;
      sections.push({ name: cstr(s, 0, 8), vaddr: s.readUInt32LE(12), vsize: s.readUInt32LE(8), raw: s.readUInt32LE(20), rawSize: s.readUInt32LE(16), flags: s.readUInt32LE(36) });
    }
    const rva2off = (rva) => { for (const s of sections) if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawSize)) return rva - s.vaddr + s.raw; return rva < 0x1000 ? rva : -1; };
    const readRva = (rva, len) => { const off = rva2off(rva); return off < 0 ? Buffer.alloc(0) : r.read(off, len); };
    const strAt = (rva) => cstr(readRva(rva, 256));

    // imports
    const imports = [];
    if (dirs[1] && dirs[1].rva) {
      for (let i = 0; i < 512; i++) {
        const d = readRva(dirs[1].rva + i * 20, 20); if (d.length < 20) break;
        const oft = d.readUInt32LE(0), nameRva = d.readUInt32LE(12), ft = d.readUInt32LE(16);
        if (!nameRva) break;
        const dll = strAt(nameRva); const fns = [];
        const thunk = oft || ft; const w = pe64 ? 8 : 4;
        for (let j = 0; j < 2000 && thunk; j++) {
          const t = readRva(thunk + j * w, w); if (t.length < w) break;
          const v = pe64 ? t.readBigUInt64LE(0) : BigInt(t.readUInt32LE(0));
          if (v === 0n) break;
          const ord = pe64 ? (v >> 63n) & 1n : (v >> 31n) & 1n;
          if (ord) fns.push('#' + Number(v & 0xffffn)); else fns.push(strAt(Number(v & 0x7fffffffn) + 2));
        }
        imports.push({ dll, functions: fns });
      }
    }
    // exports
    let exports = [], exportName = null;
    if (dirs[0] && dirs[0].rva) {
      const e = readRva(dirs[0].rva, 40);
      if (e.length === 40) {
        exportName = strAt(e.readUInt32LE(12));
        const n = Math.min(e.readUInt32LE(24), 20000), names = e.readUInt32LE(32);
        const tbl = readRva(names, n * 4);
        for (let i = 0; i < n && i * 4 + 4 <= tbl.length; i++) exports.push(strAt(tbl.readUInt32LE(i * 4)));
      }
    }
    // .NET
    let dotnet = null;
    if (dirs[14] && dirs[14].rva) {
      const c = readRva(dirs[14].rva, 72);
      if (c.length >= 72) {
        const mdRva = c.readUInt32LE(8), flags = c.readUInt32LE(16);
        const md = readRva(mdRva, 256);
        let runtime = null;
        if (md.toString('latin1', 0, 4) === 'BSJB') { const len = md.readUInt32LE(12); runtime = cstr(md, 16, 16 + len); }
        dotnet = { runtime, ilOnly: !!(flags & 1), requires32: !!(flags & 2), strongName: !!(flags & 8), readyToRun: !!c.readUInt32LE(64) };
      }
    }
    // version info (RT_VERSION) via the resource tree
    const version = dirs[2] && dirs[2].rva ? readVersion(readRva, dirs[2].rva) : null;
    const end = sections.reduce((m, s) => Math.max(m, s.raw + s.rawSize), 0);
    const cert = dirs[4] && dirs[4].rva ? { offset: dirs[4].rva, size: dirs[4].size } : null; // file offset, not RVA
    let overlay = r.size - end;
    if (cert && cert.offset >= end) overlay = cert.offset - end;
    return {
      format: pe64 ? 'PE32+' : 'PE32', machine: MACHINES[machine] || '0x' + machine.toString(16), dll: !!(chars & 0x2000),
      subsystem: SUBSYS[subsystem] || subsystem, entry: '0x' + (imageBase + entry).toString(16), imageBase: '0x' + imageBase.toString(16),
      timestamp: ts > 0x2a000000 && ts < 0x80000000 ? new Date(ts * 1000).toISOString().slice(0, 10) : null,
      sections, imports, exports: exports.slice(0, 5000), exportName, dotnet, version, signed: !!cert,
      overlay: overlay > 0 ? { offset: end, size: overlay } : null, dirs, peOff,
    };
  } finally { if (!given) r.close(); }
}

function readVersion(readRva, rsrc) {
  try {
    const dirAt = (rva) => { const d = readRva(rva, 16); const n = d.readUInt16LE(12) + d.readUInt16LE(14); const out = []; const e = readRva(rva + 16, n * 8); for (let i = 0; i < n; i++) out.push({ id: e.readUInt32LE(i * 8), off: e.readUInt32LE(i * 8 + 4) }); return out; };
    const t = dirAt(rsrc).find((x) => x.id === 16); if (!t || !(t.off & 0x80000000)) return null;
    const l2 = dirAt(rsrc + (t.off & 0x7fffffff))[0]; if (!l2) return null;
    const l3 = dirAt(rsrc + (l2.off & 0x7fffffff))[0]; if (!l3) return null;
    const de = readRva(rsrc + (l3.off & 0x7fffffff), 16);
    const data = readRva(de.readUInt32LE(0), Math.min(de.readUInt32LE(4), 65536));
    // Pull "Key\0\0Value" UTF-16 pairs out of the StringFileInfo block.
    const s = data.toString('utf16le');
    const out = {};
    for (const k of ['CompanyName', 'FileDescription', 'FileVersion', 'InternalName', 'LegalCopyright', 'OriginalFilename', 'ProductName', 'ProductVersion', 'Comments']) {
      const i = s.indexOf(k + '\0'); if (i < 0) continue;
      let j = i + k.length; while (s[j] === '\0') j++;
      const v = s.slice(j, s.indexOf('\0', j)); if (v) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

module.exports = { parse, MACHINES };

// Linux/Android/console ELF binaries: header, sections, needed libraries, interpreter, symbols count.
'use strict';
const { FileReader, cstr } = require('../util');

const MACH = { 3: 'x86', 62: 'x86-64', 40: 'ARM', 183: 'ARM64', 8: 'MIPS', 20: 'PowerPC', 21: 'PowerPC64', 243: 'RISC-V', 2: 'SPARC', 43: 'SPARC V9', 22: 'S390', 247: 'eBPF', 0xf3: 'RISC-V', 258: 'LoongArch' };
const TYPES = { 1: 'Relocatable object', 2: 'Executable', 3: 'Shared object / PIE', 4: 'Core dump' };
const OSABI = { 0: 'System V', 3: 'Linux', 6: 'Solaris', 9: 'FreeBSD', 12: 'OpenBSD', 97: 'ARM', 255: 'Standalone' };

function parse(file, { r: given } = {}) {
  const r = given || new FileReader(file);
  try {
    const h = r.read(0, 64);
    if (h.length < 52 || h.readUInt32BE(0) !== 0x7f454c46) return null;
    const b64 = h[4] === 2, le = h[5] === 1;
    const u16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    const uN = (b, o) => (b64 ? Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o)) : u32(b, o));
    const type = u16(h, 16), machine = u16(h, 18), entry = uN(h, 24);
    const phoff = uN(h, b64 ? 32 : 28), shoff = uN(h, b64 ? 40 : 32);
    const phentsize = u16(h, b64 ? 54 : 42), phnum = u16(h, b64 ? 56 : 44), shentsize = u16(h, b64 ? 58 : 46), shnum = u16(h, b64 ? 60 : 48), shstrndx = u16(h, b64 ? 62 : 50);
    const sections = [];
    if (shoff && shnum && shnum < 4096) {
      const tab = r.read(shoff, shnum * shentsize);
      const raw = [];
      for (let i = 0; i < shnum; i++) { const s = tab.subarray(i * shentsize); if (s.length < (b64 ? 64 : 40)) break; raw.push({ nameOff: u32(s, 0), type: u32(s, 4), addr: uN(s, b64 ? 16 : 12), offset: uN(s, b64 ? 24 : 16), size: uN(s, b64 ? 32 : 20), link: u32(s, b64 ? 40 : 24) }); }
      const strs = raw[shstrndx] ? r.read(raw[shstrndx].offset, Math.min(raw[shstrndx].size, 1 << 20)) : Buffer.alloc(0);
      for (const s of raw) sections.push({ ...s, name: cstr(strs, s.nameOff) });
    }
    let interp = null; const needed = []; let soname = null;
    for (let i = 0; i < Math.min(phnum, 256); i++) {
      const p = r.read(phoff + i * phentsize, phentsize);
      if (p.length < phentsize) break;
      const pt = u32(p, 0);
      if (pt === 3) { const off = uN(p, b64 ? 8 : 4), sz = uN(p, b64 ? 32 : 16); interp = cstr(r.read(off, Math.min(sz, 512))); }
    }
    const dyn = sections.find((s) => s.type === 6);
    if (dyn) {
      const dstr = sections[dyn.link];
      const strtab = dstr ? r.read(dstr.offset, Math.min(dstr.size, 4 << 20)) : Buffer.alloc(0);
      const d = r.read(dyn.offset, Math.min(dyn.size, 1 << 20)); const es = b64 ? 16 : 8;
      for (let o = 0; o + es <= d.length; o += es) {
        const tag = b64 ? Number(le ? d.readBigInt64LE(o) : d.readBigInt64BE(o)) : u32(d, o); if (tag === 0) break;
        const val = uN(d, o + (b64 ? 8 : 4));
        if (tag === 1) needed.push(cstr(strtab, val)); if (tag === 14) soname = cstr(strtab, val);
      }
    }
    const sym = sections.find((s) => s.type === 2), dsym = sections.find((s) => s.type === 11);
    const endOfElf = Math.max(shoff + shnum * shentsize, ...sections.filter((s) => s.type !== 8).map((s) => s.offset + s.size), 0);
    return {
      format: b64 ? 'ELF64' : 'ELF32', endian: le ? 'little' : 'big', machine: MACH[machine] || machine, type: TYPES[type] || type, osabi: OSABI[h[7]] || h[7],
      entry: '0x' + entry.toString(16), interp, needed, soname, stripped: !sym, symbols: sym ? Math.round(sym.size / (b64 ? 24 : 16)) : 0, dynamicSymbols: dsym ? Math.round(dsym.size / (b64 ? 24 : 16)) : 0,
      sections: sections.filter((s) => s.name).map((s) => ({ name: s.name, addr: '0x' + s.addr.toString(16), offset: s.offset, size: s.size })),
      appImage: h.toString('latin1', 8, 11) === 'AI\x02' || h.toString('latin1', 8, 11) === 'AI\x01', endOfElf,
    };
  } finally { if (!given) r.close(); }
}
module.exports = { parse };

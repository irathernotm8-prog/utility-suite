// ISO 9660 disc images: plain .iso, raw 2352-byte .bin/.img/.mdf tracks, Joliet (long Windows names),
// Rock Ridge (Unix names), files over 4 GB split across extents, and the El Torito boot image.
// UDF-only discs (most Windows install ISOs) report udfOnly so the pipeline hands them to 7-Zip.
'use strict';
const fs = require('fs');
const path = require('path');
const { FileReader, safeJoin } = require('../util');

const LAYOUTS = [
  { sector: 2048, data: 0, name: 'ISO (2048)' },
  { sector: 2352, data: 16, name: 'Raw Mode 1 (2352)' },
  { sector: 2352, data: 24, name: 'Raw Mode 2 (2352)' },
  { sector: 2336, data: 8, name: 'Mode 2 (2336)' },
];

function findLayout(r) {
  for (const L of LAYOUTS) {
    for (const base of [0, 150 * L.sector]) {      // some images keep the 2-second pregap
      const p = base + 16 * L.sector + L.data;
      const b = r.read(p, 8);
      if (b.length >= 6 && b.toString('latin1', 1, 6) === 'CD001') return { ...L, base };
    }
  }
  return null;
}
function hasUdf(r, L) {
  for (let s = 16; s < 32; s++) {
    const b = r.read((L ? L.base : 0) + s * (L ? L.sector : 2048) + (L ? L.data : 0), 8);
    const id = b.toString('latin1', 1, 6);
    if (id === 'NSR02' || id === 'NSR03') return true;
    if (id === 'TEA01') break;
  }
  return false;
}

const isoDate = (b, o) => {
  const y = b[o]; if (!y) return null;
  const tz = (b[o + 6] << 24 >> 24) * 15;
  return new Date(Date.UTC(1900 + y, b[o + 1] - 1, b[o + 2], b[o + 3], b[o + 4] - tz, b[o + 5])).toISOString();
};
const pvdText = (b, o, n) => b.toString('latin1', o, o + n).replace(/\0/g, '').trim();

function open(file) {
  const r = new FileReader(file);
  const L = findLayout(r);
  if (!L) {
    const udf = hasUdf(r, { base: 0, sector: 2048, data: 0 });
    r.close();
    const e = new Error(udf ? 'This disc uses UDF only' : 'No ISO 9660 volume found');
    e.udfOnly = udf; throw e;
  }
  const readSector = (lba) => r.read(L.base + lba * L.sector + L.data, 2048);
  // Reads `len` bytes starting at a logical block, skipping sector headers on raw images.
  const readExtent = (lba, len) => {
    if (L.sector === 2048) return r.read(L.base + lba * 2048, len);
    const out = Buffer.alloc(len); let got = 0, s = lba;
    while (got < len) { const c = readSector(s++); const n = Math.min(2048, len - got); c.copy(out, got, 0, n); got += n; }
    return out;
  };

  let pvd = null, joliet = null, boot = null;
  for (let s = 16; s < 64; s++) {
    const d = readSector(s);
    if (d.toString('latin1', 1, 6) !== 'CD001') break;
    const type = d[0];
    if (type === 255) break;
    if (type === 1 && !pvd) pvd = d;
    if (type === 2) { const esc = d.toString('latin1', 88, 91); if (/^%\/[@CE]/.test(esc)) joliet = d; }
    if (type === 0 && d.toString('latin1', 7, 30).startsWith('EL TORITO')) boot = d.readUInt32LE(71);
  }
  if (!pvd) { r.close(); throw new Error('No primary volume descriptor'); }
  const info = {
    layout: L.name, udf: hasUdf(r, L),
    volumeId: pvdText(pvd, 40, 32), systemId: pvdText(pvd, 8, 32), publisher: pvdText(pvd, 318, 128),
    preparer: pvdText(pvd, 446, 128), application: pvdText(pvd, 574, 128),
    created: (() => { const t = pvd.toString('latin1', 813, 827); return /^\d{14}$/.test(t) && t !== '00000000000000' ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null; })(),
    blocks: pvd.readUInt32LE(80), names: joliet ? 'Joliet' : 'ISO 9660', rockRidge: false, bootable: boot != null,
  };
  if (joliet) { const v = Buffer.from(joliet.subarray(40, 72)); v.swap16(); info.volumeId = v.toString('utf16le').replace(/\0/g, '').trim() || info.volumeId; }

  const entries = [];
  const useJ = !!joliet;
  const rootRec = (useJ ? joliet : pvd).subarray(156, 190);
  const seen = new Set();
  const swap16 = (b) => { const c = Buffer.from(b); for (let i = 0; i + 1 < c.length; i += 2) { const t = c[i]; c[i] = c[i + 1]; c[i + 1] = t; } return c; };

  function walkDir(lba, size, prefix, depth) {
    if (depth > 64 || seen.has(lba)) return;
    seen.add(lba);
    const data = readExtent(lba, size);
    let p = 0; const pending = new Map();
    while (p < data.length) {
      const len = data[p];
      if (len === 0) { p = (Math.floor(p / 2048) + 1) * 2048; continue; }
      if (p + len > data.length || len < 34) break;
      const rec = data.subarray(p, p + len);
      const ext = rec.readUInt32LE(2), dlen = rec.readUInt32LE(10), flags = rec[25], nl = rec[32];
      const raw = rec.subarray(33, 33 + nl);
      p += len;
      if (nl === 1 && (raw[0] === 0 || raw[0] === 1)) continue;   // . and ..
      let name = useJ ? swap16(raw).toString('utf16le') : raw.toString('latin1');
      // Rock Ridge alternate name
      if (!useJ) {
        let su = 33 + nl + (nl % 2 === 0 ? 1 : 0), rr = '';
        while (su + 4 <= rec.length) {
          const sig = rec.toString('latin1', su, su + 2), sl = rec[su + 2];
          if (sl < 4) break;
          if (sig === 'NM') { rr += rec.toString('utf8', su + 5, su + sl); info.rockRidge = true; }
          su += sl;
        }
        if (rr) name = rr;
      }
      name = name.replace(/;\d+$/, '').replace(/\.$/, '');
      const full = prefix ? prefix + '/' + name : name;
      const dir = !!(flags & 2);
      if (dir) { entries.push({ path: full, dir: true, size: 0 }); walkDir(ext, dlen, full, depth + 1); continue; }
      // multi-extent files: each part has flag 0x80 except the last
      const prev = pending.get(full);
      if (prev) { prev.extents.push([ext, dlen]); prev.size += dlen; }
      else { const e = { path: full, size: dlen, extents: [[ext, dlen]], date: isoDate(rec, 18) }; entries.push(e); if (flags & 0x80) pending.set(full, e); }
      if (!(flags & 0x80)) pending.delete(full);
    }
  }
  walkDir(rootRec.readUInt32LE(2), rootRec.readUInt32LE(10), '', 0);

  // El Torito: add the default boot image as [BOOT]/boot.img
  if (boot != null) {
    try {
      const cat = readSector(boot);
      if (cat[0] === 1 && cat[0x1e] === 0x55 && cat[0x1f] === 0xaa) {
        const e = cat.subarray(32, 64);
        const media = e[1] & 0x0f, count = e.readUInt16LE(6), rba = e.readUInt32LE(8);
        const sizes = { 1: 1228800, 2: 1474560, 3: 2949120 };
        const bytes = sizes[media] || Math.max(count, 4) * 512;
        info.boot = { platform: ['x86', 'PowerPC', 'Mac'][cat[1]] || 'EFI/other', emulation: ['none', '1.2M floppy', '1.44M floppy', '2.88M floppy', 'hard disk'][media] || 'other', sector: rba };
        entries.push({ path: '[BOOT]/boot.img', size: bytes, extents: [[rba, bytes]] });
      }
    } catch {}
  }

  return {
    format: 'iso9660', info, entries,
    // Streams one entry to dest (raw images are de-framed sector by sector).
    extract(entry, dest) {
      if (entry.dir) { fs.mkdirSync(dest, { recursive: true }); return; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.openSync(dest, 'w');
      try {
        const CH = 512; // sectors per chunk = 1 MB
        for (const [lba, len] of entry.extents) {
          let done = 0, s = lba;
          while (done < len) {
            const n = Math.min(CH * 2048, len - done);
            const b = readExtent(s, n);
            fs.writeSync(out, b);
            done += n; s += Math.ceil(n / 2048);
          }
        }
      } finally { fs.closeSync(out); }
    },
    close() { r.close(); },
  };
}

function extractAll(file, outDir, { onProgress, only } = {}) {
  const iso = open(file);
  try {
    const list = only ? iso.entries.filter((e, i) => only.includes(i)) : iso.entries;
    let bytes = 0;
    for (const e of list) { iso.extract(e, safeJoin(outDir, e.path)); bytes += e.size || 0; onProgress && onProgress(bytes); }
    return { files: list.filter((e) => !e.dir).length };
  } finally { iso.close(); }
}

const probe = (r) => !!findLayout(r);
module.exports = { open, extractAll, probe, findLayout, hasUdf };

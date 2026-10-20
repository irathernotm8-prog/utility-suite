// OpenRaster (.ora) read/write with a minimal ZIP container (STORED + DEFLATE) built on zlib.
//
// doc = { width, height,
//         layers: [{ name, png: Buffer, x, y, opacity, visible, blend }],   // bottom → top; blend = canvas composite op
//         merged: Buffer /* png */, thumbnail?: Buffer /* png */ }
//
// stack.xml layout and composite-op mapping ported from PhotoCraft's io crate (ora.rs), MIT/Apache-2.0.
const fs = require('fs');
const zlib = require('zlib');

// ---------- composite ops ----------

/** ORA composite-op ↔ canvas globalCompositeOperation. */
const OPS = [
  ['svg:src-over', 'source-over'], ['svg:multiply', 'multiply'], ['svg:screen', 'screen'], ['svg:overlay', 'overlay'],
  ['svg:darken', 'darken'], ['svg:lighten', 'lighten'], ['svg:color-dodge', 'color-dodge'], ['svg:color-burn', 'color-burn'],
  ['svg:hard-light', 'hard-light'], ['svg:soft-light', 'soft-light'], ['svg:difference', 'difference'],
  ['svg:exclusion', 'exclusion'], ['svg:plus', 'lighter'], ['svg:hue', 'hue'], ['svg:saturation', 'saturation'],
  ['svg:color', 'color'], ['svg:luminosity', 'luminosity'],
];
const TO_SVG = new Map(OPS.map(([s, c]) => [c, s]));
const FROM_SVG = new Map(OPS);
const svgOp = blend => TO_SVG.get(blend) || 'svg:src-over';
const canvasOp = op => FROM_SVG.get(String(op || '').trim()) || 'source-over';

// ---------- CRC32 ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- ZIP ----------

/** MS-DOS time/date for the local + central headers. */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Builds a ZIP from [{ name, data: Buffer, store?: bool }] in order. No extra fields, no ZIP64. */
function zip(entries) {
  const { time, date } = dosDateTime();
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const body = e.store ? data : zlib.deflateRawSync(data, { level: 9 });
    const method = e.store ? 0 : 8;
    const crc = crc32(data);
    const flags = /[^\x20-\x7e]/.test(e.name) ? 0x0800 : 0;   // UTF-8 names
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    // extra len, comment len, disk no., internal attrs, external attrs = 0
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Reads a ZIP via its central directory → Map(name → Buffer). STORED and DEFLATE only. */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`Corrupt ZIP local header for ${name}`);
    // The local header's own name/extra lengths can differ from the central copy.
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (name.endsWith('/')) continue;
    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) }));
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
  }
  return files;
}

// ---------- tiny XML ----------

const xmlEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function xmlUnesc(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(cp) ? String.fromCodePoint(cp) : m; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

/** Tag events from an XML string: { close, name, attrs, selfClose }. Comments / PIs / CDATA / DOCTYPE skipped. */
function* tags(xml) {
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (!m[2]) continue;
    const attrs = {};
    const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ar.exec(m[3] || ''))) attrs[a[1]] = xmlUnesc(a[2] ?? a[3] ?? a[4] ?? '');
    yield { close: m[1] === '/', name: m[2].replace(/^.*:/, ''), attrs, selfClose: m[4] === '/' };
  }
}

const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const clamp01 = n => Math.min(1, Math.max(0, n));

// ---------- ORA ----------

/** Encodes `doc` into an .ora Buffer. */
function buildORA(doc) {
  const layers = doc.layers || [];
  const entries = [{ name: 'mimetype', data: Buffer.from('image/openraster', 'ascii'), store: true }];
  // stack.xml lists layers top → bottom; doc.layers is bottom → top.
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.3" w="${Math.round(doc.width)}" h="${Math.round(doc.height)}">\n<stack>\n`;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const src = `data/layer${i}.png`;
    const op = svgOp(l.blend);
    xml += `<layer name="${xmlEsc(l.name || `Layer ${i + 1}`)}" src="${src}" x="${Math.round(l.x || 0)}" y="${Math.round(l.y || 0)}" ` +
      `opacity="${+clamp01(num(l.opacity, 1)).toFixed(4)}" visibility="${l.visible === false ? 'hidden' : 'visible'}"` +
      `${op !== 'svg:src-over' ? ` composite-op="${op}"` : ''}/>\n`;
  }
  xml += '</stack>\n</image>\n';
  entries.push({ name: 'stack.xml', data: Buffer.from(xml, 'utf8') });
  layers.forEach((l, i) => {
    if (!Buffer.isBuffer(l.png)) throw new Error(`Layer ${i} ("${l.name}") has no PNG data`);
    entries.push({ name: `data/layer${i}.png`, data: l.png });
  });
  const merged = doc.merged || doc.thumbnail;
  if (merged) entries.push({ name: 'mergedimage.png', data: merged });
  const thumb = doc.thumbnail || doc.merged;
  if (thumb) entries.push({ name: 'Thumbnails/thumbnail.png', data: thumb });
  return zip(entries);
}

/** Writes `doc` to `file` as OpenRaster. Returns the bytes. */
function writeORA(file, doc) {
  const buf = buildORA(doc);
  if (file) fs.writeFileSync(file, buf);
  return buf;
}

/** Decodes an .ora Buffer. Nested stacks are flattened (offsets add, opacities multiply, hidden propagates). */
function parseORA(buf) {
  const files = unzip(buf);
  const mime = files.get('mimetype');
  if (mime && mime.toString('ascii').trim() !== 'image/openraster') throw new Error(`Not an OpenRaster file (mimetype "${mime.toString('ascii').trim()}")`);
  const stackXml = files.get('stack.xml');
  if (!stackXml) throw new Error('OpenRaster file has no stack.xml');
  const doc = { width: 0, height: 0, layers: [], merged: files.get('mergedimage.png') || null, thumbnail: files.get('Thumbnails/thumbnail.png') || null };
  const top = [];   // collected top → bottom
  const ctx = [{ x: 0, y: 0, opacity: 1, visible: true }];
  for (const t of tags(stackXml.toString('utf8'))) {
    if (t.name === 'image' && !t.close) {
      doc.width = Math.round(num(t.attrs.w, 0));
      doc.height = Math.round(num(t.attrs.h, 0));
    } else if (t.name === 'stack') {
      if (t.close) { if (ctx.length > 1) ctx.pop(); continue; }
      const p = ctx[ctx.length - 1];
      const s = {
        x: p.x + num(t.attrs.x, 0), y: p.y + num(t.attrs.y, 0),
        opacity: p.opacity * clamp01(num(t.attrs.opacity, 1)),
        visible: p.visible && t.attrs.visibility !== 'hidden',
      };
      if (!t.selfClose) ctx.push(s);
    } else if (t.name === 'layer' && !t.close) {
      const p = ctx[ctx.length - 1];
      const png = files.get(String(t.attrs.src || '').replace(/^\.?\//, ''));
      if (!png) continue;   // missing pixel data: skip the layer rather than fail the whole file
      top.push({
        name: t.attrs.name ?? '',
        png,
        x: Math.round(p.x + num(t.attrs.x, 0)),
        y: Math.round(p.y + num(t.attrs.y, 0)),
        opacity: p.opacity * clamp01(num(t.attrs.opacity, 1)),
        visible: p.visible && t.attrs.visibility !== 'hidden',
        blend: canvasOp(t.attrs['composite-op']),
      });
    }
  }
  doc.layers = top.reverse();
  return doc;
}

/** Reads an .ora file (path or Buffer). */
function readORA(file) {
  return parseORA(Buffer.isBuffer(file) ? file : fs.readFileSync(file));
}

module.exports = { writeORA, readORA, buildORA, parseORA, zip, unzip, crc32, svgOp, canvasOp };

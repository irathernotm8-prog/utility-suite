// Image conversion: sharp for the heavy lifting, small hand-written encoders
// for the formats libvips can't write (BMP, ICO, PDF), and a worker for SVG tracing.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Worker } = require('worker_threads');
const { ffmpegToBuffer } = require('./ffmpeg');
const { extOf } = require('./formats');

sharp.cache(false);

const SHARP_UNREADABLE = ['bmp', 'ico', 'cur'];

let agPsd = null;
function psdLib() {
  if (agPsd) return agPsd;
  agPsd = require('ag-psd');
  // Main process has no <canvas>; RO3 only needs raw pixel buffers here.
  agPsd.initializeCanvas(() => { throw new Error('canvas unavailable'); }, (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
  return agPsd;
}

/** Flattened image of a PSD (needs the composite Photoshop stores when "Maximize compatibility" is on). */
async function decodePsd(file) {
  const buf = await fs.promises.readFile(file);
  const psd = psdLib().readPsd(buf, { skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true, useImageData: true });
  if (!psd.imageData) throw new Error(`${path.basename(file)} has no flattened preview. Open it in RO3's Photo tab (which reads the layers) or re-save it from Photoshop with "Maximize compatibility" on.`);
  const { width, height, data } = psd.imageData;
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Single-layer PSD from a sharp pipeline. */
async function encodePsd(s) {
  const { data, info } = await s.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
  const out = psdLib().writePsd({ width: info.width, height: info.height, imageData, children: [{ name: 'Background', left: 0, top: 0, imageData }] }, { noBackground: true });
  return Buffer.from(out);
}

/** Load any supported image into a sharp pipeline. */
async function load(input, { animated = false } = {}) {
  const isBuf = Buffer.isBuffer(input);
  const ext = isBuf ? '' : extOf(input);
  const opts = { failOn: 'none', limitInputPixels: false };
  if (ext === 'svg') opts.density = 300;
  if (animated && (ext === 'gif' || ext === 'webp')) opts.animated = true;
  if (!isBuf && ext === 'psd') return sharp(await decodePsd(input), opts);
  if (!isBuf && SHARP_UNREADABLE.includes(ext)) {
    return sharp(await decodeWithFfmpeg(input), opts);
  }
  try {
    const s = sharp(input, opts);
    await s.metadata();
    return s;
  } catch (e) {
    if (isBuf) throw e;
    // Fall back to FFmpeg's decoders (covers BMP variants, odd TIFFs, etc.)
    return sharp(await decodeWithFfmpeg(input), opts);
  }
}

async function decodeWithFfmpeg(file) {
  try {
    return await ffmpegToBuffer(['-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
  } catch (e) {
    throw new Error(`Can't read ${path.basename(file)} — the format or file looks unsupported or damaged.`);
  }
}

/** Decode an image to PNG bytes for the photo editor. */
async function toPngBuffer(input) {
  const s = await load(input);
  const buf = await s.rotate().png().toBuffer({ resolveWithObject: true });
  return { data: buf.data, width: buf.info.width, height: buf.info.height };
}

function applyResize(s, resize) {
  if (!resize) return s;
  const { width, height, fit } = resize;
  if (!width && !height) return s;
  return s.resize({ width: width || null, height: height || null, fit: fit || 'inside', withoutEnlargement: fit !== 'fill' && !resize.enlarge });
}

async function rawOf(s, maxSide) {
  let p = s.clone().ensureAlpha();
  if (maxSide) p = p.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await p.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// ---------- hand-written encoders ----------

function encodeBmp(raw) {
  const { data, width, height } = raw; // RGBA, flattened onto white beforehand
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(width, 18); b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(rowSize * height, 34);
  b.writeInt32LE(2835, 38); b.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      b[dst++] = data[i + 2]; b[dst++] = data[i + 1]; b[dst++] = data[i];
    }
  }
  return b;
}

async function encodeIco(s) {
  const meta = await s.metadata();
  const maxSide = Math.max(meta.width || 256, meta.height || 256);
  const sizes = [16, 24, 32, 48, 64, 128, 256].filter(n => n <= Math.max(16, maxSide));
  const pngs = [];
  for (const n of sizes) {
    pngs.push(await s.clone().resize(n, n, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  }
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const n = sizes[i];
    const e = 6 + i * 16;
    header[e] = n >= 256 ? 0 : n; header[e + 1] = n >= 256 ? 0 : n;
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

async function encodePdf(s, quality) {
  const { data: jpg, info } = await s.clone().flatten({ background: '#ffffff' }).jpeg({ quality: Math.max(quality, 85) }).toBuffer({ resolveWithObject: true });
  const w = info.width * 0.75, h = info.height * 0.75; // px → pt at 96dpi
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q`;
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [];
  let pos = parts[0].length;
  const push = buf => { parts.push(buf); pos += buf.length; };
  objs.forEach((o, i) => { offsets.push(pos); push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'binary')); });
  offsets.push(pos);
  push(Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, 'binary'));
  push(jpg); push(Buffer.from('\nendstream\nendobj\n', 'binary'));
  offsets.push(pos);
  push(Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`, 'binary'));
  const xref = pos;
  let x = `xref\n0 6\n0000000000 65535 f \n`;
  offsets.forEach(o => { x += String(o).padStart(10, '0') + ' 00000 n \n'; });
  x += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(Buffer.from(x, 'binary'));
  return Buffer.concat(parts);
}

/**
 * Trace a sharp image to SVG.
 * trace = { mode: 'color'|'bw'|'posterize', preset: 'logo'|'balanced'|'detailed', colors, threshold, fill, maxSide }
 */
async function traceSvg(s, trace = {}) {
  const meta = await s.metadata();
  const outW = meta.width, outH = meta.height;
  const mode = trace.mode || 'color';
  const maxSide = trace.maxSide || (trace.preset === 'detailed' ? 1600 : 1000);
  let workerData;
  if (mode === 'color') {
    const raw = await rawOf(s, maxSide);
    workerData = { mode, preset: trace.preset, colors: trace.colors, raw: raw.data, width: raw.width, height: raw.height, outW, outH };
  } else {
    const { data, info } = await s.clone().flatten({ background: '#ffffff' })
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .png().toBuffer({ resolveWithObject: true });
    workerData = { mode, preset: trace.preset, colors: trace.colors, threshold: trace.threshold, fill: trace.fill, png: data, width: info.width, height: info.height, outW, outH };
  }
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'traceWorker.js'), { workerData });
    w.once('message', m => { m.ok ? resolve(m.svg) : reject(new Error('Tracing failed: ' + m.error)); w.terminate(); });
    w.once('error', reject);
  });
}

/**
 * Convert an image.
 * job = { input (path) | buffer, output, format?, quality?, resize?, background?, trace? }
 */
async function convertImage(job) {
  const format = (job.format || extOf(job.output)).toLowerCase();
  const quality = Math.round(job.quality || 90);
  const keepAnimation = ['gif', 'webp'].includes(format);
  let s = await load(job.buffer || job.input, { animated: keepAnimation });
  if (!keepAnimation) s = s.rotate(); // honour EXIF orientation
  s = applyResize(s, job.resize);
  const bg = job.background || '#ffffff';
  let out;
  switch (format) {
    case 'png': out = await s.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(); break;
    case 'jpg': case 'jpeg': out = await s.flatten({ background: bg }).jpeg({ quality, mozjpeg: true }).toBuffer(); break;
    case 'webp': out = await s.webp({ quality, effort: 5 }).toBuffer(); break;
    case 'avif': out = await s.avif({ quality: Math.max(30, quality - 25), effort: 4 }).toBuffer(); break;
    case 'tif': case 'tiff': out = await s.tiff({ compression: 'lzw' }).toBuffer(); break;
    case 'gif': out = await s.gif({ effort: 8 }).toBuffer(); break;
    case 'bmp': out = encodeBmp(await rawOf(s.flatten({ background: bg }))); break;
    case 'ico': out = await encodeIco(s); break;
    case 'pdf': out = await encodePdf(s, quality); break;
    case 'psd': out = await encodePsd(s); break;
    case 'svg': out = Buffer.from(await traceSvg(s, job.trace || {}), 'utf8'); break;
    default: throw new Error(`RO3 can't write .${format} images.`);
  }
  if (job.output) {
    await fs.promises.writeFile(job.output, out);
    return { output: job.output, bytes: out.length };
  }
  return { data: out, bytes: out.length };
}

async function imageInfo(input) {
  const s = await load(input);
  const m = await s.metadata();
  return { width: m.width, height: m.height, format: m.format, hasAlpha: !!m.hasAlpha, pages: m.pages || 1 };
}

async function thumbnail(input, size = 160) {
  const s = await load(input);
  const buf = await s.rotate().resize(size, size, { fit: 'inside' }).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

module.exports = { convertImage, toPngBuffer, imageInfo, thumbnail, traceSvg, load };

// Dither — animated GIF encoder (no dependencies). Pixel art rarely passes 255 colours, so one global palette with a
// transparent slot is exact; anything bigger is reduced with median cut first.
'use strict';

function lzw(indices, minCode) {
  const out = []; let cur = 0, bits = 0;
  const emit = (code, size) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1; let dict = new Map();
  emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]; const key = prefix * 4096 + k;
    const got = dict.get(key);
    if (got !== undefined) { prefix = got; continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix, size); emit(eoi, size);
  if (bits > 0) out.push(cur & 255);
  return out;
}

function medianCut(colors, max) { // colors: array of [r,g,b,count]
  let boxes = [colors];
  while (boxes.length < max) {
    let bi = -1, best = -1, axis = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; for (let a = 0; a < 3; a++) { let lo = 255, hi = 0; for (const c of b) { if (c[a] < lo) lo = c[a]; if (c[a] > hi) hi = c[a]; } if (hi - lo > best) { best = hi - lo; bi = i; axis = a; } } });
    if (bi < 0) break;
    const b = boxes[bi].sort((x, y) => x[axis] - y[axis]); const total = b.reduce((s, c) => s + c[3], 0); let acc = 0, cut = 1;
    for (let i = 0; i < b.length; i++) { acc += b[i][3]; if (acc >= total / 2) { cut = Math.max(1, Math.min(b.length - 1, i + 1)); break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map((b) => { let r = 0, g = 0, bl = 0, n = 0; for (const c of b) { r += c[0] * c[3]; g += c[1] * c[3]; bl += c[2] * c[3]; n += c[3]; } return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)]; });
}

// frames: [{ data: RGBA, delay: ms }], w, h. opts: { loop: true, scale: 1, background: [r,g,b] | null }
function encode(frames, w, h, opts = {}) {
  const scale = Math.max(1, Math.round(opts.scale || 1));
  const W = w * scale, H = h * scale;
  const bg = opts.background || null;
  const px = (d, i) => { let a = d[i + 3]; if (bg && a < 255) { const t = a / 255; return [Math.round(d[i] * t + bg[0] * (1 - t)), Math.round(d[i + 1] * t + bg[1] * (1 - t)), Math.round(d[i + 2] * t + bg[2] * (1 - t)), 255]; } return [d[i], d[i + 1], d[i + 2], a < 128 ? 0 : 255]; };
  const counts = new Map();
  for (const f of frames) for (let i = 0; i < f.data.length; i += 4) { const [r, g, b, a] = px(f.data, i); if (!a) continue; const k = (r << 16) | (g << 8) | b; counts.set(k, (counts.get(k) || 0) + 1); }
  let palette = [...counts.keys()].map((k) => [k >> 16, (k >> 8) & 255, k & 255]);
  let mapColor;
  if (palette.length > 255) {
    palette = medianCut([...counts.entries()].map(([k, n]) => [k >> 16, (k >> 8) & 255, k & 255, n]), 255);
    const memo = new Map();
    mapColor = (k) => { let v = memo.get(k); if (v !== undefined) return v; const r = k >> 16, g = (k >> 8) & 255, b = k & 255; let bi = 0, bd = Infinity; palette.forEach((p, i) => { const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; bi = i; } }); memo.set(k, bi + 1); return bi + 1; };
  } else { const idx = new Map(palette.map((p, i) => [(p[0] << 16) | (p[1] << 8) | p[2], i + 1])); mapColor = (k) => idx.get(k); }
  const ncol = palette.length + 1; let bitsz = 1; while ((1 << bitsz) < ncol) bitsz++;
  const tableSize = 1 << bitsz;
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  bytes.push(...Buffer.from('GIF89a'));
  u16(W); u16(H); bytes.push(0x80 | 0x70 | (bitsz - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) { const c = i === 0 ? [0, 0, 0] : palette[i - 1] || [0, 0, 0]; bytes.push(c[0], c[1], c[2]); }
  if (opts.loop !== false && frames.length > 1) bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  const minCode = Math.max(2, bitsz);
  for (const f of frames) {
    const delay = Math.max(2, Math.round((f.delay || 100) / 10));
    bytes.push(0x21, 0xf9, 4, (2 << 2) | 1); u16(delay); bytes.push(0, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(W); u16(H); bytes.push(0);
    const ind = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (((y / scale) | 0) * w + ((x / scale) | 0)) * 4; const [r, g, b, a] = px(f.data, i); ind[y * W + x] = a ? mapColor((r << 16) | (g << 8) | b) : 0; }
    bytes.push(minCode);
    const data = lzw(ind, minCode);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); bytes.push(n); for (let j = 0; j < n; j++) bytes.push(data[i + j]); }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

module.exports = { encode, medianCut };

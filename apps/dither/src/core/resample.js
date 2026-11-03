// Dither — scaling pixel art. `shrink` is plain nearest-neighbour (thumbnails). `downscale` makes a smaller version
// the way a pixel artist would redraw it: each new pixel takes the colour that matters most in its box, not the
// average, so eyes, outlines and highlights survive while flat areas stay flat. `overview` makes a picture of a big
// image with a labelled tile grid (A1, B3 …) so Claude can ask for close-ups by name.
'use strict';

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function shrink(img, max) {
  const k = Math.max(1, Math.max(img.w, img.h) / max); if (k <= 1) return img;
  const w = Math.max(1, Math.round(img.w / k)), h = Math.max(1, Math.round(img.h / k)), d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const si = (Math.min(img.h - 1, Math.floor((y + 0.5) * img.h / h)) * img.w + Math.min(img.w - 1, Math.floor((x + 0.5) * img.w / w))) * 4; d[(y * w + x) * 4] = img.data[si]; d[(y * w + x) * 4 + 1] = img.data[si + 1]; d[(y * w + x) * 4 + 2] = img.data[si + 2]; d[(y * w + x) * 4 + 3] = img.data[si + 3]; }
  return { w, h, data: d };
}

// downscale(img, w, h, { mode: 'detail' | 'majority' | 'nearest', keep: 0..1 (how hard detail fights the majority) })
function downscale(img, W, H, o = {}) {
  W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H)); const mode = o.mode || 'detail';
  if (mode === 'nearest') { const r = shrink(img, Math.max(W, H)); return r.w === W && r.h === H ? r : nearestTo(img, W, H); }
  const sx = img.w / W, sy = img.h / H, out = new Uint8ClampedArray(W * H * 4), keep = o.keep ?? 0.9, d = img.data;
  // the local surroundings of each cell (3×3 cells) — detail is what stands out from it
  const meanL = new Float32Array(W * H), cover = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0, a = 0, t = 0; const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const k = (j * img.w + i) * 4; t++; if (d[k + 3] > 127) { a++; s += luma(d[k], d[k + 1], d[k + 2]); n++; } }
    meanL[y * W + x] = n ? s / n : -1; cover[y * W + x] = t ? a / t : 0;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    const counts = new Map(); let total = 0;
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const k = (j * img.w + i) * 4; total++; if (d[k + 3] <= 127) continue; const key = (d[k] << 16) | (d[k + 1] << 8) | d[k + 2]; counts.set(key, (counts.get(key) || 0) + 1); }
    const o4 = (y * W + x) * 4; const opaque = [...counts.values()].reduce((a, b) => a + b, 0);
    // keep thin silhouettes: a cell is solid if enough of it is, or if it sits on the edge of something solid
    let neigh = 0, nc = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; nc++; neigh += cover[Y * W + X]; }
    const solid = mode === 'majority' ? opaque / total >= 0.5 : opaque / total >= 0.5 || (opaque / total >= 0.25 && neigh / Math.max(1, nc) > 0.35);
    if (!solid || !opaque) continue;
    let ctx = 0, cn = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const m = meanL[Y * W + X]; if (m >= 0) { ctx += m; cn++; } }
    ctx = cn ? ctx / cn : 128; const edge = neigh / Math.max(1, nc) < 0.85;          // next to transparency: outlines matter more
    let best = null, bs = -1;
    for (const [key, n] of counts) {
      const r = key >> 16, g = (key >> 8) & 255, b = key & 255, share = n / opaque;
      let score = share;
      if (mode === 'detail') { const con = Math.abs(luma(r, g, b) - ctx) / 255; score += keep * con * Math.sqrt(share) * (edge ? 1.4 : 1) * (share < 0.08 ? 0.3 : 1); }
      if (score > bs) { bs = score; best = [r, g, b]; }
    }
    out[o4] = best[0]; out[o4 + 1] = best[1]; out[o4 + 2] = best[2]; out[o4 + 3] = 255;
  }
  return { w: W, h: H, data: out };
}
function nearestTo(img, W, H) { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const si = (Math.min(img.h - 1, Math.floor((y + 0.5) * img.h / H)) * img.w + Math.min(img.w - 1, Math.floor((x + 0.5) * img.w / W))) * 4; d.set(img.data.subarray(si, si + 4), (y * W + x) * 4); } return { w: W, h: H, data: d }; }

// ───────── tiles for big images: A1 is the top-left tile; letters go across, numbers go down
function tileSize(w, h) { const m = Math.max(w, h); return m <= 128 ? 0 : m <= 256 ? 64 : m <= 768 ? 128 : 256; }
const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
function tiles(w, h, size) { size = size || tileSize(w, h) || Math.max(w, h); const out = []; for (let y = 0, r = 1; y < h; y += size, r++) for (let x = 0, c = 0; x < w; x += size, c++) out.push({ name: colName(c) + r, x, y, w: Math.min(size, w - x), h: Math.min(size, h - y) }); return out; }
// region: {x,y,w,h} | 'B3' | 'B3:C4' (a block of tiles)
function parseRegion(region, w, h, size) {
  if (!region) return null; if (typeof region === 'object') return { x: Math.max(0, region.x | 0), y: Math.max(0, region.y | 0), w: Math.min(w - Math.max(0, region.x | 0), region.w | 0 || w), h: Math.min(h - Math.max(0, region.y | 0), region.h | 0 || h) };
  const list = tiles(w, h, size); const get = (n) => { const t = list.find((x) => x.name === String(n).trim().toUpperCase()); if (!t) throw new Error(`No tile “${n}”. Tiles are ${list[0].name}…${list[list.length - 1].name} (${size || tileSize(w, h)}px)`); return t; };
  const [a, b] = String(region).split(':'); const A = get(a), B = b ? get(b) : A; const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y); return { x, y, w: Math.max(A.x + A.w, B.x + B.w) - x, h: Math.max(A.y + A.h, B.y + B.h) - y, name: String(region).toUpperCase() };
}
// a picture of a big image, at most `max` px, with the tile grid and names drawn on (3×5 font, outlined)
function overview(img, { max = 768, size } = {}) {
  const FX = require('./fxruntime'); size = size || tileSize(img.w, img.h);
  const k = Math.max(img.w, img.h) > max ? max / Math.max(img.w, img.h) : 1; const sm = k < 1 ? downscale(img, img.w * k, img.h * k, { mode: 'majority' }) : img;
  const g = new FX.Canvas(sm.w, sm.h, ['#000']); const bg = [22, 20, 30], ck = [32, 30, 42];
  for (let y = 0; y < sm.h; y++) for (let x = 0; x < sm.w; x++) { const i = (y * sm.w + x) * 4, a = sm.data[i + 3]; const b = ((x >> 3) + (y >> 3)) & 1 ? ck : bg; g.data[i] = a ? sm.data[i] : b[0]; g.data[i + 1] = a ? sm.data[i + 1] : b[1]; g.data[i + 2] = a ? sm.data[i + 2] : b[2]; g.data[i + 3] = 255; }
  if (size) for (const t of tiles(img.w, img.h, size)) {
    const X = Math.round(t.x * k), Y = Math.round(t.y * k), Wd = Math.round(t.w * k), Hd = Math.round(t.h * k);
    for (let i = 0; i < Wd; i += 2) { g.px(X + i, Y, '#ff6f7d'); } for (let j = 0; j < Hd; j += 2) g.px(X, Y + j, '#ff6f7d');
    const s = sm.w >= 512 ? 2 : 1; g.fillRect(X + 1, Y + 1, g.textWidth(t.name, s) + 3, 5 * s + 3, '#16141e'); g.text(t.name, X + 3, Y + 3, '#ffffff', s);
  }
  return { w: g.w, h: g.h, data: g.data, scale: k, tile: size };
}

module.exports = { shrink, downscale, tiles, tileSize, parseRegion, overview, luma };

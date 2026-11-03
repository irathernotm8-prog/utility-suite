// Dither — tiles and scenes. Autotile tilesets (the 47-tile "blob" set and the 16-tile sides set) built from five
// hand-drawn pieces, a seamless-tile check and fixer, terrain grids that pick the right tile for every cell, parallax
// scenes, and exports for Tiled (.tsx/.tmj with a Wang set) and Godot 4 (.tres TileSet with terrain peering bits).
'use strict';
const FX = require('./fxruntime');

// neighbour bits, clockwise from the top
const B = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 };
const DIRS = [['N', 0, -1], ['NE', 1, -1], ['E', 1, 0], ['SE', 1, 1], ['S', 0, 1], ['SW', -1, 1], ['W', -1, 0], ['NW', -1, -1]];
// a corner only counts when both sides next to it are filled
function canon(m) { if (!(m & B.N && m & B.E)) m &= ~B.NE; if (!(m & B.S && m & B.E)) m &= ~B.SE; if (!(m & B.S && m & B.W)) m &= ~B.SW; if (!(m & B.N && m & B.W)) m &= ~B.NW; return m; }
const BLOB = [...new Set(Array.from({ length: 256 }, (_, m) => canon(m)))].sort((a, b) => a - b);     // the 47
const SIDES = Array.from({ length: 16 }, (_, i) => (i & 1 ? B.N : 0) | (i & 2 ? B.E : 0) | (i & 4 ? B.S : 0) | (i & 8 ? B.W : 0));

const blank = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
function flip(img, fx, fy) { const o = blank(img.w, img.h); for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const s = ((fy ? img.h - 1 - y : y) * img.w + (fx ? img.w - 1 - x : x)) * 4; o.data.set(img.data.subarray(s, s + 4), (y * img.w + x) * 4); } return o; }
function blit(dst, src, sx, sy, w, h, dx, dy) { for (let j = 0; j < h; j++) { const a = ((sy + j) * src.w + sx) * 4; dst.data.set(src.data.subarray(a, a + w * 4), ((dy + j) * dst.w + dx) * 4); } }

// one tile for a neighbour mask, from pieces { fill, top, left, outer, inner, bottom?, right? } (each T×T, drawn for the
// top-left: "top" has the edge along its top, "outer" is the top-left outside corner, "inner" the top-left inside corner)
function buildTile(P, m, T) {
  const out = blank(T, T), h0 = Math.floor(T / 2);
  const quads = [[0, 0, 'N', 'W', 'NW', false, false], [1, 0, 'N', 'E', 'NE', true, false], [0, 1, 'S', 'W', 'SW', false, true], [1, 1, 'S', 'E', 'SE', true, true]];
  for (const [qx, qy, v, hz, dg, fx, fy] of quads) {
    const V = m & B[v], Hh = m & B[hz], D = m & B[dg];
    let piece, fX = fx, fY = fy;
    if (V && Hh) piece = D ? P.fill : P.inner;
    else if (V && !Hh) { piece = fx && P.right ? P.right : P.left; if (fx && P.right) fX = false; }
    else if (!V && Hh) { piece = fy && P.bottom ? P.bottom : P.top; if (fy && P.bottom) fY = false; }
    else piece = P.outer;
    if (piece === P.fill) { fX = false; fY = false; }
    const src = fX || fY ? flip(piece, fX, fY) : piece;
    const x = qx ? h0 : 0, y = qy ? h0 : 0, w = qx ? T - h0 : h0, h = qy ? T - h0 : h0;
    blit(out, src, x, y, w, h, x, y);
  }
  return out;
}
// autotile(pieces, { kind: 'blob47' | 'sides16', cols, name }) → { sheet {w,h,data}, tile, kind, masks: [mask per index], index: {mask → index}, cols }
function autotile(P, o = {}) {
  for (const k of ['fill', 'top', 'left', 'outer', 'inner']) if (!P[k]) throw new Error(`Missing the “${k}” piece. Draw five tiles: fill, top edge, left edge, outer corner (top-left), inner corner (top-left).`);
  const T = P.fill.w; for (const [k, v] of Object.entries(P)) if (v && (v.w !== T || v.h !== T)) throw new Error(`Piece “${k}” is ${v.w}×${v.h}; every piece must be ${T}×${T}`);
  const kind = o.kind === 'sides16' ? 'sides16' : 'blob47'; const masks = kind === 'blob47' ? BLOB : SIDES.map((m) => canon(m | B.NE | B.SE | B.SW | B.NW));
  const cols = o.cols || (kind === 'blob47' ? 8 : 4), rows = Math.ceil(masks.length / cols), sheet = blank(cols * T, rows * T);
  masks.forEach((m, i) => blit(sheet, buildTile(P, m, T), 0, 0, T, T, (i % cols) * T, Math.floor(i / cols) * T));
  const index = {}; masks.forEach((m, i) => (index[m] = i));
  return { sheet, tile: T, kind, masks, index, cols, rows, count: masks.length };
}
// which tile goes in each cell of a terrain grid (rows of '#'/'.' or booleans)
function maskAt(grid, x, y, wrap) { const H = grid.length, W = grid[0].length; const on = (X, Y) => { if (wrap) { X = (X + W) % W; Y = (Y + H) % H; } else if (X < 0 || Y < 0 || X >= W || Y >= H) return true; return grid[Y][X]; }; let m = 0; for (const [n, dx, dy] of DIRS) if (on(x + dx, y + dy)) m |= B[n]; return m; }
function parseGrid(rows) { const g = (Array.isArray(rows) ? rows : String(rows).split('\n')).map((r) => (Array.isArray(r) ? r.map(Boolean) : [...String(r)].map((c) => c !== '.' && c !== ' ' && c !== '0'))); const W = Math.max(...g.map((r) => r.length)); return g.map((r) => { while (r.length < W) r.push(false); return r; }); }
function tileFor(ts, m) { if (ts.kind === 'sides16') { const s = m & (B.N | B.E | B.S | B.W); return ts.index[canon(s | B.NE | B.SE | B.SW | B.NW)]; } return ts.index[canon(m)]; }
function mapIndices(ts, rows, { wrap = false, edges = 'filled' } = {}) { const g = parseGrid(rows); const out = g.map((r, y) => r.map((on, x) => (on ? tileFor(ts, edges === 'filled' ? maskAt(g, x, y, wrap) : maskAtOpen(g, x, y)) : -1))); return { grid: g, cells: out }; }
function maskAtOpen(grid, x, y) { const H = grid.length, W = grid[0].length; let m = 0; for (const [n, dx, dy] of DIRS) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && grid[Y][X]) m |= B[n]; } return m; }
function renderMap(ts, rows, o = {}) {
  const { cells } = mapIndices(ts, rows, o); const T = ts.tile, H = cells.length, W = cells[0].length, img = blank(W * T, H * T);
  cells.forEach((r, y) => r.forEach((i, x) => { if (i < 0 || i === undefined) return; blit(img, ts.sheet, (i % ts.cols) * T, Math.floor(i / ts.cols) * T, T, T, x * T, y * T); }));
  return { img, cells };
}
// a test map that uses every tile (islands, lakes, thin bits), for previews
const DEMO = ['................', '..#####....###..', '.#######..#####.', '.##...##..##.##.', '.##...########..', '.#######...#....', '..#####..#.#.##.', '.........#...##.', '..##.###.#####..', '..##.#.#........', '.....###..####..', '..........#..#..', '..#..####.####..', '.###.#..#.......', '..#..####.......', '................'];

// ───────── seamless tiles
function seamCheck(img) {
  const { w, h, data: d } = img; const L = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const diff = (a, b) => { if (!!d[a + 3] !== !!d[b + 3]) return 1; if (!d[a + 3]) return 0; return Math.min(1, (Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2])) / 180 + Math.abs(L(a) - L(b)) / 255); };
  // compare the jump across the seam with the typical jump between neighbouring columns/rows inside the tile
  let sx = 0, ix = 0, sy = 0, iy = 0; const badX = [], badY = [];
  for (let y = 0; y < h; y++) { const v = diff((y * w + w - 1) * 4, (y * w) * 4); sx += v; if (v > 0.5) badX.push(y); for (let x = 0; x < w - 1; x++) ix += diff((y * w + x) * 4, (y * w + x + 1) * 4); }
  for (let x = 0; x < w; x++) { const v = diff(((h - 1) * w + x) * 4, x * 4); sy += v; if (v > 0.5) badY.push(x); for (let y = 0; y < h - 1; y++) iy += diff((y * w + x) * 4, ((y + 1) * w + x) * 4); }
  const seamX = sx / h, seamY = sy / w, inX = ix / (h * (w - 1)), inY = iy / (w * (h - 1));
  const ratioX = seamX / Math.max(0.02, inX), ratioY = seamY / Math.max(0.02, inY); const okX = ratioX < 1.6, okY = ratioY < 1.6;
  return { seamless: okX && okY, left_right: { ok: okX, seam: +seamX.toFixed(3), inside: +inX.toFixed(3), rows: badX.slice(0, 40) }, top_bottom: { ok: okY, seam: +seamY.toFixed(3), inside: +inY.toFixed(3), cols: badY.slice(0, 40) } };
}
function repeat(img, nx = 3, ny = 3) { const o = blank(img.w * nx, img.h * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) blit(o, img, 0, 0, img.w, img.h, i * img.w, j * img.h); return o; }
// makeSeamless(img, { mode: 'offset' (wrap by half, so the seams sit in the middle for you to paint over) | 'blend' (dithered cross-fade near the edges) })
function makeSeamless(img, o = {}) {
  const { w, h } = img;
  if (o.mode === 'offset') { const g = new FX.Canvas(w, h, ['#000']); g.data.set(img.data); g.shift(Math.floor(w / 2), Math.floor(h / 2), true); return { w, h, data: g.data }; }
  const out = new Uint8ClampedArray(img.data), band = Math.max(2, Math.round((o.band || 0.25) * Math.min(w, h)));
  const src = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.min(x, w - 1 - x), dy = Math.min(y, h - 1 - y); let take = null;
    if (dx < band) { const t = 0.5 - (dx + 0.5) / band * 0.5; if (FX.bayer(x, y) < t) take = (y * w + (w - 1 - x)) * 4; }
    if (dy < band && take === null) { const t = 0.5 - (dy + 0.5) / band * 0.5; if (FX.bayer(x + 2, y + 1) < t) take = ((h - 1 - y) * w + x) * 4; }
    if (take !== null) out.set(src.subarray(take, take + 4), (y * w + x) * 4);
  }
  return { w, h, data: out };
}

// ───────── scenes: parallax layers (sprites, repeated or not) and terrain-grid tile layers, rendered for a camera
// layer: { kind: 'sprite', image {w,h,data}, x, y, depth (0 = fixed sky … 1 = moves with the camera; >1 = foreground), repeat: 'x'|'y'|'both'|null }
//        { kind: 'tiles', image (the rendered map), x, y, depth }
function renderScene(scene, layers, camX = 0, camY = 0) {
  const W = scene.w, H = scene.h, out = blank(W, H);
  if (scene.background) { const c = FX.hex(scene.background); for (let i = 0; i < out.data.length; i += 4) { out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = 255; } }
  for (const l of layers) {
    if (!l.image || l.visible === false) continue; const im = l.image, d = l.depth ?? 1;
    const ox = Math.round((l.x || 0) - camX * d), oy = Math.round((l.y || 0) - camY * d);
    const rx = l.repeat === 'x' || l.repeat === 'both', ry = l.repeat === 'y' || l.repeat === 'both';
    const x0 = rx ? ((ox % im.w) + im.w) % im.w - im.w : ox, y0 = ry ? ((oy % im.h) + im.h) % im.h - im.h : oy;
    for (let ty = y0; ty < (ry ? H : y0 + 1); ty += im.h) for (let tx = x0; tx < (rx ? W : x0 + 1); tx += im.w) {
      for (let y = Math.max(0, -ty); y < im.h && ty + y < H; y++) for (let x = Math.max(0, -tx); x < im.w && tx + x < W; x++) { const s = (y * im.w + x) * 4; if (im.data[s + 3] < 128) continue; const t = ((ty + y) * W + tx + x) * 4; out.data[t] = im.data[s]; out.data[t + 1] = im.data[s + 1]; out.data[t + 2] = im.data[s + 2]; out.data[t + 3] = 255; }
      if (!rx && !ry) break;
    }
  }
  return out;
}

// ───────── exports
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Tiled: wangid order is top, top-right, right, bottom-right, bottom, bottom-left, left, top-left
function tiledTsx(ts, { name, image, terrain = 'Terrain', color = '#ff6f7d' }) {
  const wang = ts.masks.map((m, i) => { const ids = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((n, k) => (ts.kind === 'sides16' && k % 2 ? 0 : m & B[n] ? 1 : 0)); return `   <wangtile tileid="${i}" wangid="${ids.join(',')}"/>`; }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.0" name="${esc(name)}" tilewidth="${ts.tile}" tileheight="${ts.tile}" tilecount="${ts.count}" columns="${ts.cols}">
 <image source="${esc(image)}" width="${ts.sheet.w}" height="${ts.sheet.h}"/>
 <wangsets>
  <wangset name="${esc(terrain)}" type="${ts.kind === 'sides16' ? 'edge' : 'mixed'}" tile="-1">
   <wangcolor name="${esc(terrain)}" color="${color}" tile="-1" probability="1"/>
${wang}
  </wangset>
 </wangsets>
</tileset>
`;
}
function tiledTmj(ts, cells, { tsx, name }) {
  const H = cells.length, W = cells[0].length; const data = []; cells.forEach((r) => r.forEach((i) => data.push(i < 0 || i === undefined ? 0 : i + 1)));
  return JSON.stringify({ type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down', width: W, height: H, tilewidth: ts.tile, tileheight: ts.tile, infinite: false, nextlayerid: 2, nextobjectid: 1,
    layers: [{ id: 1, name: name || 'Terrain', type: 'tilelayer', width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data }], tilesets: [{ firstgid: 1, source: tsx }] }, null, 1);
}
// Godot 4: terrain_set mode 0 = match corners and sides (blob 47), 2 = match sides (16)
function godotTres(ts, { image, terrain = 'Terrain', color = [1, 0.43, 0.49] }) {
  const bits = { N: 'top_side', NE: 'top_right_corner', E: 'right_side', SE: 'bottom_right_corner', S: 'bottom_side', SW: 'bottom_left_corner', W: 'left_side', NW: 'top_left_corner' };
  const lines = [];
  ts.masks.forEach((m, i) => { const at = `${i % ts.cols}:${Math.floor(i / ts.cols)}/0`; lines.push(`${at} = 0`, `${at}/terrain_set = 0`, `${at}/terrain = 0`); for (const [n, prop] of Object.entries(bits)) { if (ts.kind === 'sides16' && n.length === 2) continue; if (m & B[n]) lines.push(`${at}/terrains_peering_bit/${prop} = 0`); } });
  return `[gd_resource type="TileSet" load_steps=3 format=3]

[ext_resource type="Texture2D" path="res://${image}" id="1_tex"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]
texture = ExtResource("1_tex")
texture_region_size = Vector2i(${ts.tile}, ${ts.tile})
${lines.join('\n')}

[resource]
tile_size = Vector2i(${ts.tile}, ${ts.tile})
terrain_set_0/mode = ${ts.kind === 'sides16' ? 2 : 0}
terrain_set_0/terrain_0/name = "${terrain}"
terrain_set_0/terrain_0/color = Color(${color.join(', ')}, 1)
sources/0 = SubResource("TileSetAtlasSource_1")
`;
}

module.exports = { B, BLOB, SIDES, canon, autotile, buildTile, mapIndices, renderMap, parseGrid, DEMO, seamCheck, makeSeamless, repeat, renderScene, tiledTsx, tiledTmj, godotTres, flip };

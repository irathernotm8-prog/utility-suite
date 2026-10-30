// Dither — vector → pixel. Claude is far better at writing clean SVG shapes than at placing thousands of pixels, so
// this rasterizes a practical SVG subset the way a pixel artist would: fills sampled at pixel centres (no
// anti-aliasing), thin strokes as pixel-perfect lines (no L-shaped doubles), gradients and opacity as ordered
// dithering, colours snapped to the palette, and data-material / data-form tags kept for the shading pass.
'use strict';
const FX = require('./fxruntime');

// ───────── tiny XML reader (enough for SVG written by people and AIs)
function parseXML(src) {
  src = String(src).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const root = { tag: '#root', attrs: {}, children: [] }; const stack = [root];
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g; let m;
  while ((m = re.exec(src))) {
    const [, close, tag, attrSrc, self] = m;
    if (close) { while (stack.length > 1 && stack.pop().tag !== tag); continue; }
    const attrs = {}; attrSrc.replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, a, b) => { attrs[k] = a !== undefined ? a : b; });
    if (attrs.style) for (const part of attrs.style.split(';')) { const i = part.indexOf(':'); if (i > 0) attrs[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
    const node = { tag: tag.replace(/^svg:/, ''), attrs, children: [] }; stack[stack.length - 1].children.push(node);
    if (!self) stack.push(node);
  }
  return root;
}

// ───────── colours
const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', magenta: '#ff00ff', fuchsia: '#ff00ff', cyan: '#00ffff', aqua: '#00ffff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', navy: '#000080', teal: '#008080', olive: '#808000', brown: '#a52a2a', pink: '#ffc0cb', gold: '#ffd700', currentcolor: '#000000' };
function color(v) {
  if (v == null) return undefined; v = String(v).trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  if (NAMED[v]) v = NAMED[v];
  if (/^#[0-9a-f]{3,8}$/.test(v)) { try { return FX.hex(v); } catch { return undefined; } }
  const m = /^rgba?\(([^)]+)\)/.exec(v); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x, i) => (x.endsWith('%') ? (i < 3 ? 2.55 : 0.01) * parseFloat(x) * (i < 3 ? 1 : 100) : parseFloat(x))); return [p[0] | 0, p[1] | 0, p[2] | 0, p[3] === undefined ? 255 : Math.round((p[3] <= 1 ? p[3] * 255 : p[3]))]; }
  if (/^url\(/.test(v)) return { ref: /url\(\s*#([^)\s]+)\s*\)/.exec(v)?.[1] };
  return undefined;
}

// ───────── 2×3 matrices
const I = [1, 0, 0, 1, 0, 0];
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function transform(s) {
  let m = I; if (!s) return m; const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let t;
  while ((t = re.exec(s))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number); let n;
    if (t[1] === 'matrix') n = a.slice(0, 6);
    else if (t[1] === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (t[1] === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (t[1] === 'rotate') { const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), si = Math.sin(r); n = [c, si, -si, c, 0, 0]; if (a.length > 2) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]); }
    else if (t[1] === 'skewX') n = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
    else n = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

// ───────── geometry → flattened subpaths (arrays of [x,y] in user space)
function num(v, d = 0) { const n = parseFloat(v); return isFinite(n) ? n : d; }
function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2, seg) {
  rx = Math.abs(rx); ry = Math.abs(ry); if (!rx || !ry) return [[x2, y2]];
  const c = Math.cos(phi), s = Math.sin(phi); const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = c * dx + s * dy, y1p = -s * dx + c * dy; let l = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
  const sign = fa === fs ? -1 : 1; const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p; const co = sign * Math.sqrt(Math.max(0, num2 / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx; const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI * 2) * seg)); const out = [];
  for (let i = 1; i <= n; i++) { const t = t1 + dt * i / n; out.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]); }
  return out;
}
function pathData(d, seg) {
  const toks = String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []; let i = 0, cmd = '';
  const subs = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
  const n = () => parseFloat(toks[i++]); const isNum = () => i < toks.length && !/[a-z]/i.test(toks[i]);
  const cubic = (x0, y0, x1, y1, x2, y2, x3, y3) => { const k = Math.max(4, Math.ceil(seg / 4)); for (let j = 1; j <= k; j++) { const t = j / k, u = 1 - t; cur.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]); } };
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++]; else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(); const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; } cur = null; lc = lq = null; continue; }
    if (!isNum()) { continue; }
    if (C === 'M') { x = ox + n(); y = oy + n(); sx = x; sy = y; cur = [[x, y]]; subs.push(cur); cmd = rel ? 'l' : 'L'; lc = lq = null; continue; }
    if (!cur) { cur = [[x, y]]; subs.push(cur); }
    if (C === 'L') { x = ox + n(); y = oy + n(); cur.push([x, y]); lc = lq = null; }
    else if (C === 'H') { x = ox + n(); cur.push([x, y]); lc = lq = null; }
    else if (C === 'V') { y = (rel ? y : 0) + n(); cur.push([x, y]); lc = lq = null; }
    else if (C === 'C') { const x1 = ox + n(), y1 = oy + n(), x2 = ox + n(), y2 = oy + n(), x3 = ox + n(), y3 = oy + n(); cubic(x, y, x1, y1, x2, y2, x3, y3); lc = [x2, y2]; lq = null; x = x3; y = y3; }
    else if (C === 'S') { const x1 = lc ? 2 * x - lc[0] : x, y1 = lc ? 2 * y - lc[1] : y; const x2 = ox + n(), y2 = oy + n(), x3 = ox + n(), y3 = oy + n(); cubic(x, y, x1, y1, x2, y2, x3, y3); lc = [x2, y2]; lq = null; x = x3; y = y3; }
    else if (C === 'Q' || C === 'T') { let qx, qy; if (C === 'Q') { qx = ox + n(); qy = oy + n(); } else { qx = lq ? 2 * x - lq[0] : x; qy = lq ? 2 * y - lq[1] : y; } const x3 = ox + n(), y3 = oy + n(); cubic(x, y, x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x3 + 2 / 3 * (qx - x3), y3 + 2 / 3 * (qy - y3), x3, y3); lq = [qx, qy]; lc = null; x = x3; y = y3; }
    else if (C === 'A') { const rx = n(), ry = n(), ph = n() * Math.PI / 180, fa = n(), fs = n(); const x2 = ox + n(), y2 = oy + n(); cur.push(...arcPoints(x, y, rx, ry, ph, fa ? 1 : 0, fs ? 1 : 0, x2, y2, seg)); x = x2; y = y2; lc = lq = null; }
    else i++;
  }
  return subs.filter((s) => s.length > 1 || s.closed);
}
function ellipsePts(cx, cy, rx, ry, seg) { const n = Math.max(12, seg); const p = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; p.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } p.closed = true; return p; }
function shapeSubpaths(node, seg) {
  const a = node.attrs; const t = node.tag;
  if (t === 'rect') {
    const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height); if (w <= 0 || h <= 0) return [];
    let rx = a.rx != null ? num(a.rx) : a.ry != null ? num(a.ry) : 0, ry = a.ry != null ? num(a.ry) : rx; rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (!rx || !ry) { const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; p.closed = true; return [p]; }
    return pathData(`M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`, seg);
  }
  if (t === 'circle') return [ellipsePts(num(a.cx), num(a.cy), num(a.r), num(a.r), seg)];
  if (t === 'ellipse') return [ellipsePts(num(a.cx), num(a.cy), num(a.rx), num(a.ry), seg)];
  if (t === 'line') return [[[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]]];
  if (t === 'polyline' || t === 'polygon') { const v = String(a.points || '').split(/[\s,]+/).filter(Boolean).map(Number); const p = []; for (let i = 0; i + 1 < v.length; i += 2) p.push([v[i], v[i + 1]]); if (t === 'polygon') p.closed = true; return p.length > 1 ? [p] : []; }
  if (t === 'path') return pathData(a.d, seg);
  return [];
}

// ───────── rasterizing
function fillPolys(polys, w, h, rule, plot) {
  const edges = []; for (const p of polys) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]); }
  if (!edges.length) return; let y0 = Infinity, y1 = -Infinity; for (const e of edges) { y0 = Math.min(y0, e[1]); y1 = Math.max(y1, e[3]); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++) {
    const yy = y + 0.5; const xs = [];
    for (const e of edges) if (yy >= e[1] && yy < e[3]) xs.push([e[0] + (yy - e[1]) / (e[3] - e[1]) * (e[2] - e[0]), e[4]]);
    xs.sort((p, q) => p[0] - q[0]); let wind = 0;
    for (let k = 0; k + 1 < xs.length + 1 && k < xs.length; k++) {
      wind += rule === 'evenodd' ? 1 : xs[k][1]; const inside = rule === 'evenodd' ? wind % 2 === 1 : wind !== 0;
      if (inside && k + 1 < xs.length) for (let x = Math.max(0, Math.ceil(xs[k][0] - 0.5)); x <= Math.min(w - 1, Math.ceil(xs[k + 1][0] - 0.5) - 1); x++) plot(x, y);
    }
  }
}
// thin strokes: Bresenham through the vertices, then drop the redundant corner pixel of every L (pixel-perfect lines)
function thinStroke(pts, closed, plot) {
  const raw = []; const P = pts.map(([x, y]) => [Math.floor(x), Math.floor(y)]); if (closed) P.push(P[0]);
  for (let i = 0; i + 1 < P.length; i++) { let [x0, y0] = P[i]; const [x1, y1] = P[i + 1]; const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1; let err = dx + dy; for (;;) { const l = raw[raw.length - 1]; if (!l || l[0] !== x0 || l[1] !== y0) raw.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } } }
  if (P.length === 1) raw.push(P[0]);
  const out = []; for (let i = 0; i < raw.length; i++) { const a = out[out.length - 1], b = raw[i], c = raw[i + 1]; if (a && c && (a[0] === b[0] || a[1] === b[1]) && (c[0] === b[0] || c[1] === b[1]) && a[0] !== c[0] && a[1] !== c[1]) continue; out.push(b); }
  for (const [x, y] of out) plot(x, y);
}
function thickStroke(pts, closed, width, w, h, plot) {
  const r = width / 2; const P = closed ? [...pts, pts[0]] : pts; const polys = [];
  for (let i = 0; i + 1 < P.length; i++) { const [x0, y0] = P[i], [x1, y1] = P[i + 1]; const L = Math.hypot(x1 - x0, y1 - y0) || 1; const nx = -(y1 - y0) / L * r, ny = (x1 - x0) / L * r; polys.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]); }
  for (const p of polys) fillPolys([p], w, h, 'nonzero', plot);
  for (const [x, y] of P) fillPolys([ellipsePts(x, y, r, r, 16)], w, h, 'nonzero', plot);
}

// render(svg, w, h, { palette, snap, background }) → { data, materials: { '#hex': { material, form } }, colors, warnings }
function render(svg, w, h, opts = {}) {
  const root = parseXML(svg); const svgEl = (function find(n) { if (n.tag === 'svg') return n; for (const c of n.children) { const f = find(c); if (f) return f; } return null; })(root) || { tag: 'svg', attrs: {}, children: root.children };
  const vb = String(svgEl.attrs.viewBox || svgEl.attrs.viewbox || `0 0 ${num(svgEl.attrs.width, w)} ${num(svgEl.attrs.height, h)}`).split(/[\s,]+/).map(Number);
  const sx = w / (vb[2] || w), sy = h / (vb[3] || h); const s = Math.min(sx, sy); const base = mul([1, 0, 0, 1, (w - vb[2] * s) / 2, (h - vb[3] * s) / 2], [s, 0, 0, s, -vb[0] * s, -vb[1] * s]);
  const out = new Uint8ClampedArray(w * h * 4); const materials = {}; const warnings = []; const used = new Set(); const defs = {};
  const pal = opts.palette ? FX.resolvePalette(opts.palette).map(FX.hex) : null;
  const near = (c) => { if (!pal || !opts.snap) return c; let bi = 0, bd = Infinity; for (let i = 0; i < pal.length; i++) { const p = pal[i]; const r = (p[0] + c[0]) / 2, d = (2 + r / 256) * (p[0] - c[0]) ** 2 + 4 * (p[1] - c[1]) ** 2 + (2 + (255 - r) / 256) * (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } } return [...pal[bi].slice(0, 3), c[3]]; };
  (function collect(n) { if (/Gradient$/.test(n.tag) && n.attrs.id) defs[n.attrs.id] = n; for (const c of n.children) collect(c); })(root);
  const gradStops = (g) => { let n = g; let guard = 0; while (n && !n.children.some((c) => c.tag === 'stop') && n.attrs['xlink:href'] && guard++ < 5) n = defs[n.attrs['xlink:href'].slice(1)]; return (n ? n.children : []).filter((c) => c.tag === 'stop').map((st) => { const o = String(st.attrs.offset || 0); return { t: o.endsWith('%') ? parseFloat(o) / 100 : num(o), c: color(st.attrs['stop-color'] || '#000') || [0, 0, 0, 255], a: num(st.attrs['stop-opacity'], 1) }; }).sort((a, b) => a.t - b.t); };
  const put = (x, y, c, level = 1) => { if (x < 0 || y < 0 || x >= w || y >= h || !c) return; if (level < 1 && FX.bayer(x, y) >= level) return; const k = (y * w + x) * 4; const cc = near(c); out[k] = cc[0]; out[k + 1] = cc[1]; out[k + 2] = cc[2]; out[k + 3] = 255; used.add(FX.toHex(cc)); };
  const seg = Math.max(16, Math.round(Math.max(w, h) / 2));
  function painter(paint, m, bbox, alpha) {
    if (paint && paint.ref) {
      const g = defs[paint.ref]; if (!g) { warnings.push(`No gradient #${paint.ref}`); return null; }
      const stops = gradStops(g); if (!stops.length) return null; const userSpace = g.attrs.gradientUnits === 'userSpaceOnUse'; const gm = transform(g.attrs.gradientTransform);
      const inv = (() => { const M = mul(m, gm); const det = M[0] * M[3] - M[1] * M[2] || 1; return [M[3] / det, -M[1] / det, -M[2] / det, M[0] / det, (M[2] * M[5] - M[3] * M[4]) / det, (M[1] * M[4] - M[0] * M[5]) / det]; })();
      const pct = (v, d, size, off) => { if (v == null) return d; const s2 = String(v); const f = s2.endsWith('%') ? parseFloat(s2) / 100 : parseFloat(s2); return userSpace ? (s2.endsWith('%') ? f * size : f) : off + f * size; };
      const lin = g.tag === 'linearGradient';
      const bands = Math.max(2, Math.min(16, num(g.attrs['data-steps'], Math.min(8, stops.length * 2 + 1)))), dith = Math.max(0, Math.min(1, num(g.attrs['data-dither'], 0.6)));
      const at = (t) => { let k = 0; while (k + 1 < stops.length && stops[k + 1].t <= t) k++; const a = stops[k], b = stops[Math.min(stops.length - 1, k + 1)]; const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0; return [0, 1, 2].map((i) => Math.round(a.c[i] + (b.c[i] - a.c[i]) * f)).concat([Math.round(255 * (a.a + (b.a - a.a) * f))]); };
      const [bx, by, bw, bh] = userSpace ? [0, 0, vb[2], vb[3]] : bbox;
      const x1 = pct(g.attrs.x1, bx, bw, bx), y1 = pct(g.attrs.y1, by, bh, by), x2 = pct(g.attrs.x2, bx + bw, bw, bx), y2 = pct(g.attrs.y2, by, bh, by);
      const cx = pct(g.attrs.cx, bx + bw / 2, bw, bx), cy = pct(g.attrs.cy, by + bh / 2, bh, by); const r = userSpace ? num(String(g.attrs.r || '50%').endsWith('%') ? parseFloat(g.attrs.r || 50) / 100 * Math.hypot(vb[2], vb[3]) / Math.SQRT2 : g.attrs.r) : (String(g.attrs.r || '50%').endsWith('%') ? parseFloat(g.attrs.r || 50) / 100 : num(g.attrs.r, 0.5)) * Math.max(bw, bh);
      return (x, y) => {
        const [ux, uy] = apply(inv, x + 0.5, y + 0.5); let t;
        if (lin) { const dx = x2 - x1, dy = y2 - y1; t = ((ux - x1) * dx + (uy - y1) * dy) / (dx * dx + dy * dy || 1); } else t = Math.hypot(ux - cx, uy - cy) / (r || 1);
        t = Math.max(0, Math.min(1, t));
        // pixel-art gradients: a few flat bands with a narrow dithered seam between them, not noise end to end
        const v = t * (bands - 1), k = Math.floor(v), f = v - k; const up = f > 0.5 + (FX.bayer(x, y) - 0.5) * dith;
        const c = at(Math.min(bands - 1, k + (up ? 1 : 0)) / (bands - 1));
        return [c, c[3] / 255 * alpha];
      };
    }
    return paint ? () => [paint, alpha * (paint[3] / 255)] : null;
  }
  function walk(n, ctx) {
    const a = n.attrs; if (n.tag === 'defs' || /Gradient$/.test(n.tag) || n.tag === 'clipPath' || n.tag === 'mask' || n.tag === 'title' || n.tag === 'desc' || n.tag === 'style' || a.display === 'none' || a.visibility === 'hidden') return;
    const st = { ...ctx, m: mul(ctx.m, transform(a.transform)) };
    for (const k of ['fill', 'stroke', 'stroke-width', 'fill-rule', 'data-material', 'data-form', 'data-ramp']) if (a[k] !== undefined) st[k] = a[k];
    st.opacity = ctx.opacity * num(a.opacity, 1); if (a['fill-opacity'] !== undefined) st.fo = num(a['fill-opacity'], 1); if (a['stroke-opacity'] !== undefined) st.so = num(a['stroke-opacity'], 1);
    const subs = shapeSubpaths(n, seg);
    if (subs.length) {
      let bx = Infinity, by = Infinity, bx2 = -Infinity, by2 = -Infinity; for (const p of subs) for (const [x, y] of p) { bx = Math.min(bx, x); by = Math.min(by, y); bx2 = Math.max(bx2, x); by2 = Math.max(by2, y); }
      const px = subs.map((p) => { const q = p.map(([x, y]) => apply(st.m, x, y)); q.closed = p.closed || n.tag === 'rect' || n.tag === 'circle' || n.tag === 'ellipse' || n.tag === 'polygon'; return q; });
      const fill = n.tag === 'line' || n.tag === 'polyline' && st.fill === undefined ? null : color(st.fill === undefined ? '#000' : st.fill);
      const fp = painter(fill, st.m, [bx, by, bx2 - bx, by2 - by], st.opacity * (st.fo ?? 1));
      if (fp) { fillPolys(px, w, h, st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero', (x, y) => { const [c, al] = fp(x, y); put(x, y, c, al); }); if (st['data-material'] && fill && !fill.ref) materials[FX.toHex(near(fill))] = { material: st['data-material'], form: st['data-form'] || undefined, ramp: st['data-ramp'] || undefined }; }
      const stroke = color(st.stroke);
      if (stroke) {
        const sp = painter(stroke, st.m, [bx, by, bx2 - bx, by2 - by], st.opacity * (st.so ?? 1)); const sw = num(st['stroke-width'], 1) * Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
        const plot = (x, y) => { const [c, al] = sp(x, y); put(x, y, c, al); };
        for (const p of px) (sw <= 1.6 ? thinStroke(p, p.closed, plot) : thickStroke(p, p.closed, sw, w, h, plot));
      }
    }
    for (const c of n.children) walk(c, st);
  }
  walk(svgEl, { m: base, opacity: 1 });
  if (!used.size) warnings.push('Nothing was drawn. Check the viewBox matches your coordinates and shapes have a fill or stroke.');
  return { data: out, materials, colors: [...used], warnings };
}

module.exports = { render, parseXML, pathData, color };

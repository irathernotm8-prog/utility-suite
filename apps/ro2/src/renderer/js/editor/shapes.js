// The shape library. Every shape is a path in a box (w × h, usually 100 × 100), or a native rect / circle
// so corners stay round when resized. These same shapes are used as photo frames (masks).
const f = (n) => Math.round(n * 100) / 100;
function poly(pts) { return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L') + ' Z'; }
function ngon(n, rot = -90, r = 50, cx = 50, cy = 50) {
  const pts = []; for (let i = 0; i < n; i++) { const a = ((rot + (360 / n) * i) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
function fitPts(pts) { // stretch a point list to fill 0..100 in both directions
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return pts.map(([x, y]) => [((x - x0) / (x1 - x0)) * 100, ((y - y0) / (y1 - y0)) * 100]);
}
function star(n, inner, rot = -90) {
  const pts = []; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? 50 * inner : 50; const a = ((rot + (180 / n) * i) * Math.PI) / 180; pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]); }
  return pts;
}
// smooth closed curve through points (Catmull-Rom → cubic Bézier)
function smooth(pts, t = 1) {
  const n = pts.length; let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * t, p1[1] + ((p2[1] - p0[1]) / 6) * t], c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * t, p2[1] - ((p3[1] - p1[1]) / 6) * t];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + ' Z';
}
function blob(radii, rot = 0) { return smooth(radii.map((r, i) => { const a = ((rot + (360 / radii.length) * i) * Math.PI) / 180; return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; })); }
function scallop(n, depth) {
  let d = ''; const R = 50 - depth;
  for (let i = 0; i < n; i++) {
    const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n, am = (a0 + a1) / 2;
    const p0 = [50 + R * Math.cos(a0), 50 + R * Math.sin(a0)], p1 = [50 + R * Math.cos(a1), 50 + R * Math.sin(a1)], c = [50 + (R + depth * 2) * Math.cos(am), 50 + (R + depth * 2) * Math.sin(am)];
    d += (i === 0 ? `M${f(p0[0])} ${f(p0[1])}` : '') + ` Q${f(c[0])} ${f(c[1])} ${f(p1[0])} ${f(p1[1])}`;
  }
  return d + ' Z';
}

export const SHAPES = [
  // basic
  { id: 'square', name: 'Square', cat: 'basic', kind: 'rect', rx: 0 },
  { id: 'rounded', name: 'Rounded square', cat: 'basic', kind: 'rect', rx: 18 },
  { id: 'circle', name: 'Circle', cat: 'basic', kind: 'circle' },
  { id: 'pill', name: 'Pill', cat: 'basic', kind: 'rect', rx: 999, w: 160, h: 70 },
  { id: 'triangle', name: 'Triangle', cat: 'basic', d: poly([[50, 0], [100, 100], [0, 100]]) },
  { id: 'right-triangle', name: 'Right triangle', cat: 'basic', d: poly([[0, 0], [100, 100], [0, 100]]) },
  { id: 'diamond', name: 'Diamond', cat: 'basic', d: poly([[50, 0], [100, 50], [50, 100], [0, 50]]) },
  { id: 'pentagon', name: 'Pentagon', cat: 'basic', d: poly(fitPts(ngon(5))) },
  { id: 'hexagon', name: 'Hexagon', cat: 'basic', d: poly(fitPts(ngon(6, 0))) },
  { id: 'octagon', name: 'Octagon', cat: 'basic', d: poly(fitPts(ngon(8, 22.5))) },
  { id: 'parallelogram', name: 'Parallelogram', cat: 'basic', d: poly([[25, 0], [100, 0], [75, 100], [0, 100]]), w: 140, h: 90 },
  { id: 'trapezoid', name: 'Trapezoid', cat: 'basic', d: poly([[22, 0], [78, 0], [100, 100], [0, 100]]), w: 130, h: 90 },
  { id: 'half-circle', name: 'Half circle', cat: 'basic', d: 'M0 100 A50 50 0 0 1 100 100 Z', w: 100, h: 50, box: [0, 50, 100, 50] },
  { id: 'quarter', name: 'Quarter circle', cat: 'basic', d: 'M0 0 A100 100 0 0 1 100 100 L0 100 Z' },
  { id: 'ring', name: 'Ring', cat: 'basic', d: 'M50 0 A50 50 0 1 1 49.99 0 Z M50 22 A28 28 0 1 0 50.01 22 Z', evenodd: true },
  { id: 'cross', name: 'Plus', cat: 'basic', d: poly([[34, 0], [66, 0], [66, 34], [100, 34], [100, 66], [66, 66], [66, 100], [34, 100], [34, 66], [0, 66], [0, 34], [34, 34]]) },
  { id: 'squircle', name: 'Squircle', cat: 'basic', d: 'M50 0 C90 0 100 10 100 50 C100 90 90 100 50 100 C10 100 0 90 0 50 C0 10 10 0 50 0 Z' },
  { id: 'arch', name: 'Arch', cat: 'basic', d: 'M0 100 L0 45 A45 45 0 0 1 45 0 L55 0 A45 45 0 0 1 100 45 L100 100 Z', w: 90, h: 120 },
  // stars & badges
  { id: 'star', name: 'Star', cat: 'stars', d: poly(star(5, 0.42)) },
  { id: 'star6', name: '6-point star', cat: 'stars', d: poly(star(6, 0.55)) },
  { id: 'star4', name: 'Sparkle', cat: 'stars', d: 'M50 0 C54 34 66 46 100 50 C66 54 54 66 50 100 C46 66 34 54 0 50 C34 46 46 34 50 0 Z' },
  { id: 'burst', name: 'Burst', cat: 'stars', d: poly(star(12, 0.72)) },
  { id: 'burst24', name: 'Seal', cat: 'stars', d: poly(star(24, 0.86)) },
  { id: 'scallop', name: 'Badge', cat: 'stars', d: scallop(14, 4) },
  { id: 'flower', name: 'Flower', cat: 'stars', d: scallop(6, 14) },
  { id: 'shield', name: 'Shield', cat: 'stars', d: 'M50 0 L100 14 L100 46 C100 76 78 92 50 100 C22 92 0 76 0 46 L0 14 Z', w: 90, h: 105 },
  { id: 'ribbon', name: 'Ribbon', cat: 'stars', d: poly([[0, 0], [100, 0], [88, 50], [100, 100], [0, 100], [12, 50]]), w: 180, h: 60 },
  { id: 'tag', name: 'Tag', cat: 'stars', d: 'M0 10 Q0 0 10 0 L70 0 L100 50 L70 100 L10 100 Q0 100 0 90 Z', w: 150, h: 80 },
  // arrows
  { id: 'arrow-right', name: 'Arrow', cat: 'arrows', d: poly([[0, 30], [60, 30], [60, 0], [100, 50], [60, 100], [60, 70], [0, 70]]), w: 150, h: 90 },
  { id: 'arrow-double', name: 'Double arrow', cat: 'arrows', d: poly([[0, 50], [28, 0], [28, 30], [72, 30], [72, 0], [100, 50], [72, 100], [72, 70], [28, 70], [28, 100]]), w: 170, h: 80 },
  { id: 'chevron', name: 'Chevron', cat: 'arrows', d: poly([[0, 0], [70, 0], [100, 50], [70, 100], [0, 100], [30, 50]]), w: 130, h: 90 },
  { id: 'arrow-up', name: 'Arrow up', cat: 'arrows', d: poly([[50, 0], [100, 45], [70, 45], [70, 100], [30, 100], [30, 45], [0, 45]]), w: 80, h: 110 },
  { id: 'arrow-curve', name: 'Curved arrow', cat: 'arrows', d: 'M10 95 C10 45 35 25 70 25 L70 5 L100 38 L70 71 L70 51 C48 51 32 62 32 95 Z', w: 120, h: 100 },
  { id: 'pointer', name: 'Pointer', cat: 'arrows', d: poly([[0, 0], [80, 0], [100, 50], [80, 100], [0, 100]]), w: 150, h: 70 },
  // speech & callouts
  { id: 'bubble', name: 'Speech bubble', cat: 'callouts', d: 'M50 4 C78 4 100 21 100 42 C100 63 78 80 50 80 C44 80 39 79 34 78 L14 96 L20 72 C8 65 0 54 0 42 C0 21 22 4 50 4 Z', w: 130, h: 115 },
  { id: 'bubble-rect', name: 'Message', cat: 'callouts', d: 'M8 0 L92 0 Q100 0 100 8 L100 66 Q100 74 92 74 L34 74 L16 94 L18 74 L8 74 Q0 74 0 66 L0 8 Q0 0 8 0 Z', w: 140, h: 110 },
  { id: 'thought', name: 'Thought', cat: 'callouts', d: blob([44, 40, 45, 41, 46, 40, 44, 42], 10) + ' M18 86 A7 7 0 1 1 18.01 86 Z M8 97 A3.5 3.5 0 1 1 8.01 97 Z', w: 130, h: 115 },
  { id: 'cloud', name: 'Cloud', cat: 'callouts', d: 'M25 85 C10 85 0 75 0 62 C0 50 9 41 21 40 C22 23 35 12 51 12 C64 12 75 20 79 32 C91 33 100 43 100 56 C100 72 89 85 74 85 Z', w: 150, h: 95 },
  { id: 'banner', name: 'Banner', cat: 'callouts', d: 'M0 8 Q0 0 8 0 L92 0 Q100 0 100 8 L100 70 Q100 78 92 78 L8 78 Q0 78 0 70 Z', w: 200, h: 70 },
  // organic
  { id: 'blob1', name: 'Blob', cat: 'organic', d: blob([46, 38, 48, 36, 44, 40], 12) },
  { id: 'blob2', name: 'Pebble', cat: 'organic', d: blob([48, 42, 34, 44, 47, 38, 40], 30) },
  { id: 'blob3', name: 'Splash', cat: 'organic', d: blob([48, 30, 46, 28, 47, 31, 45, 29, 48, 32], 0) },
  { id: 'heart', name: 'Heart', cat: 'organic', d: 'M50 92 C22 72 0 56 0 30 C0 13 13 0 28 0 C38 0 46 6 50 14 C54 6 62 0 72 0 C87 0 100 13 100 30 C100 56 78 72 50 92 Z', w: 100, h: 92 },
  { id: 'drop', name: 'Drop', cat: 'organic', d: 'M50 0 C50 0 90 46 90 68 C90 90 72 104 50 104 C28 104 10 90 10 68 C10 46 50 0 50 0 Z', w: 80, h: 104 },
  { id: 'leaf', name: 'Leaf', cat: 'organic', d: 'M0 100 C0 40 40 0 100 0 C100 60 60 100 0 100 Z' },
  { id: 'moon', name: 'Moon', cat: 'organic', d: 'M62 0 C35 6 15 30 15 58 C15 82 31 100 55 100 C75 100 92 89 100 72 C92 76 83 78 74 78 C47 78 28 57 28 32 C28 18 34 7 44 1 C50 0 56 0 62 0 Z', w: 90, h: 100 },
  { id: 'bolt', name: 'Lightning', cat: 'organic', d: poly([[58, 0], [8, 58], [44, 58], [34, 100], [92, 38], [55, 38], [70, 0]]), w: 80, h: 110 },
  { id: 'wave', name: 'Wave', cat: 'organic', d: 'M0 30 C17 10 33 10 50 30 C67 50 83 50 100 30 L100 100 L0 100 Z', w: 200, h: 80 },
];
export const SHAPE_CATS = [['basic', 'Basic'], ['stars', 'Stars & badges'], ['arrows', 'Arrows'], ['callouts', 'Callouts'], ['organic', 'Organic']];
export const byId = (id) => SHAPES.find((s) => s.id === id);
// An SVG for previews (tiles, frame menu)
export function shapeSvg(s, fill = 'currentColor') {
  if (s.kind === 'rect') {
    const w = s.w || 100, h = s.h || 100, rx = Math.min(s.rx, Math.min(w, h) / 2);
    return `<svg class="shape" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${rx}" fill="${fill}"/></svg>`;
  }
  if (s.kind === 'circle') return `<svg class="shape" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${fill}"/></svg>`;
  const vb = s.box ? s.box.join(' ') : '0 0 100 100';
  return `<svg class="shape" viewBox="${vb}" preserveAspectRatio="none" style="aspect-ratio:${(s.w || 100) / (s.h || 100)}"><path d="${s.d}" fill="${fill}" ${s.evenodd ? 'fill-rule="evenodd"' : ''}/></svg>`;
}
export const LINES = [
  { id: 'line', name: 'Line', dash: 'solid', start: 'none', end: 'none' },
  { id: 'dashed', name: 'Dashed', dash: 'dashed', start: 'none', end: 'none' },
  { id: 'dotted', name: 'Dotted', dash: 'dotted', start: 'none', end: 'none' },
  { id: 'arrow', name: 'Arrow', dash: 'solid', start: 'none', end: 'arrow' },
  { id: 'arrow2', name: 'Two-way arrow', dash: 'solid', start: 'arrow', end: 'arrow' },
  { id: 'tri', name: 'Pointer', dash: 'solid', start: 'none', end: 'triangle' },
  { id: 'dot-line', name: 'Connector', dash: 'solid', start: 'circle', end: 'circle' },
  { id: 'dash-arrow', name: 'Dashed arrow', dash: 'dashed', start: 'none', end: 'arrow' },
];
export function lineSvg(l) {
  const dash = l.dash === 'dashed' ? 'stroke-dasharray="9 6"' : l.dash === 'dotted' ? 'stroke-dasharray="0.1 7"' : '';
  const cap = (x, dir, t) => t === 'arrow' ? `<path d="M${x - dir * 12} 38 L${x} 50 L${x - dir * 12} 62" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    : t === 'triangle' ? `<path d="M${x - dir * 14} 39 L${x} 50 L${x - dir * 14} 61 Z" fill="currentColor"/>`
      : t === 'circle' ? `<circle cx="${x}" cy="50" r="6" fill="currentColor"/>` : '';
  return `<svg class="shape" viewBox="0 0 100 100"><line x1="12" y1="50" x2="88" y2="50" stroke="currentColor" stroke-width="5" stroke-linecap="round" ${dash}/>${cap(12, -1, l.start)}${cap(88, 1, l.end)}</svg>`;
}

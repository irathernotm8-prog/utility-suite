// Dither — 2D character rigs. A picture of a character becomes parts (head, torso, upper/lower arms, hands, thighs,
// shins, feet) hung on a bone skeleton, posed by rotating bones. Pixel art stays crisp when rotated: parts are blown
// up 8× with Scale2x (RotSprite), rotated there, and brought back down by majority vote onto the character's palette.
//
// Coordinates are image pixels (y down). Rotations are degrees, clockwise-positive on screen (same as Godot 2D).
// A pose is { root: { x, y, rot }, bones: { name: { r, x, y, sl, sw } } } — r rotates a bone relative to its
// parent, x/y nudge it, sl/sw stretch its part along/across the bone. Offsets are in figure heights (H) so the same
// motion fits any size of character.
'use strict';

const JOINTS = ['head_top', 'neck', 'pelvis', 'shoulder_f', 'elbow_f', 'wrist_f', 'hand_f', 'shoulder_b', 'elbow_b', 'wrist_b', 'hand_b', 'hip_f', 'knee_f', 'ankle_f', 'toe_f', 'hip_b', 'knee_b', 'ankle_b', 'toe_b'];
// [bone, parent, start joint, end joint, radius (fraction of H) used to cut parts]
const BONES = [
  ['root', null, null, null, 0], ['hips', 'root', 'pelvis', 'neck', 0],
  ['torso', 'hips', 'pelvis', 'neck', 0.13], ['head', 'torso', 'neck', 'head_top', 0],
  ['upper_arm_b', 'torso', 'shoulder_b', 'elbow_b', 0.05], ['lower_arm_b', 'upper_arm_b', 'elbow_b', 'wrist_b', 0.045], ['hand_b', 'lower_arm_b', 'wrist_b', 'hand_b', 0.045],
  ['thigh_b', 'hips', 'hip_b', 'knee_b', 0.065], ['shin_b', 'thigh_b', 'knee_b', 'ankle_b', 0.055], ['foot_b', 'shin_b', 'ankle_b', 'toe_b', 0.045],
  ['upper_arm_f', 'torso', 'shoulder_f', 'elbow_f', 0.05], ['lower_arm_f', 'upper_arm_f', 'elbow_f', 'wrist_f', 0.045], ['hand_f', 'lower_arm_f', 'wrist_f', 'hand_f', 0.045],
  ['thigh_f', 'hips', 'hip_f', 'knee_f', 0.065], ['shin_f', 'thigh_f', 'knee_f', 'ankle_f', 0.055], ['foot_f', 'shin_f', 'ankle_f', 'toe_f', 0.045],
];
const PART_BONES = BONES.filter((b) => b[4] > 0 || b[0] === 'head').map((b) => b[0]);
const LIMBS = { arm_f: ['upper_arm_f', 'lower_arm_f', 'hand_f'], arm_b: ['upper_arm_b', 'lower_arm_b', 'hand_b'], leg_f: ['thigh_f', 'shin_f', 'foot_f'], leg_b: ['thigh_b', 'shin_b', 'foot_b'] };
// draw order, back to front, per kind of view
const ORDER = {
  side: ['hand_b', 'lower_arm_b', 'upper_arm_b', 'foot_b', 'shin_b', 'thigh_b', 'torso', 'thigh_f', 'shin_f', 'foot_f', 'head', 'upper_arm_f', 'lower_arm_f', 'hand_f'],
  front: ['thigh_b', 'shin_b', 'foot_b', 'thigh_f', 'shin_f', 'foot_f', 'torso', 'upper_arm_b', 'lower_arm_b', 'hand_b', 'upper_arm_f', 'lower_arm_f', 'hand_f', 'head'],
  back: ['upper_arm_b', 'lower_arm_b', 'hand_b', 'upper_arm_f', 'lower_arm_f', 'hand_f', 'thigh_b', 'shin_b', 'foot_b', 'thigh_f', 'shin_f', 'foot_f', 'torso', 'head'],
};
ORDER.front34 = ORDER.side; ORDER.back34 = ['upper_arm_f', 'lower_arm_f', 'hand_f', 'thigh_f', 'shin_f', 'foot_f', 'hand_b', 'lower_arm_b', 'upper_arm_b', 'foot_b', 'shin_b', 'thigh_b', 'torso', 'head'];
const viewKind = (v) => (v === 'front' || v === 'back' ? v : v === 'back34' ? 'back34' : 'side');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ───────── finding joints
function bbox(img) { let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1; for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }
function runs(img, y) { const r = []; let s = -1; for (let x = 0; x <= img.w; x++) { const on = x < img.w && img.data[(y * img.w + x) * 4 + 3] > 127; if (on && s < 0) s = x; if (!on && s >= 0) { r.push([s, x - 1]); s = -1; } } return r; }
// joints from the silhouette alone: works for a character standing upright, arms down or out (then you or Claude adjust)
function guessJoints(img, view = 'side') {
  const b = bbox(img); if (!b) throw new Error('The picture is empty (no opaque pixels). Remove the background first.');
  const H = b.h, Y = (f) => Math.round(b.y0 + f * (H - 1)); const kind = viewKind(view);
  const width = []; for (let y = b.y0; y <= b.y1; y++) { const r = runs(img, y); width.push(r.length ? r[r.length - 1][1] - r[0][0] + 1 : 0); }
  const centre = (y) => { const r = runs(img, y); if (!r.length) return (b.x0 + b.x1) / 2; let s = 0, n = 0; for (const [a, c] of r) { s += (a + c) / 2 * (c - a + 1); n += c - a + 1; } return s / n; };
  // the neck: the narrowest row between 12% and 45% of the height (big heads → chibi proportions)
  let neckF = 0.2, best = Infinity; for (let f = 0.12; f <= 0.45; f += 0.01) { const w = width[Math.round(f * (H - 1))]; if (w > 0 && w < best * 0.97) { best = w; neckF = f; } }
  const headW = Math.max(...width.slice(0, Math.round(neckF * H) + 1)); if (best > headW * 0.85) neckF = headW > b.w * 0.5 ? 0.33 : 0.2;   // no clear neck: guess from how wide the head is
  // the crotch: the highest row in the lower 60% where the legs are two separate runs
  let crotchF = null; for (let f = 0.95; f >= 0.45; f -= 0.01) { const r = runs(img, Y(f)).filter(([a, c]) => c - a >= 1); if (r.length >= 2) crotchF = f; else if (crotchF !== null) break; }
  const legs = crotchF !== null; const pelvisF = legs ? Math.max(neckF + 0.15, crotchF - 0.04) : neckF + (1 - neckF) * 0.48;
  const cx = centre(Y((neckF + pelvisF) / 2)), neck = [centre(Y(neckF)), Y(neckF)], top = [centre(b.y0), b.y0], pelvis = [cx, Y(pelvisF)];
  const torsoLen = pelvis[1] - neck[1]; const shoulderY = neck[1] + torsoLen * 0.15;
  // arms out (T-pose) if the shoulder band is much wider than the torso just above the hips
  const bandW = Math.max(...width.slice(Math.round((shoulderY - b.y0)), Math.round(shoulderY - b.y0 + torsoLen * 0.25) + 1)), waistW = width[Math.round((pelvis[1] - b.y0) - torsoLen * 0.2)] || bandW;
  const J = { head_top: top, neck, pelvis };
  const legRuns = legs ? runs(img, Y(Math.min(0.99, crotchF + 0.06))).filter(([a, c]) => c - a >= 1) : null;
  const legX = legRuns && legRuns.length >= 2 ? [(legRuns[0][0] + legRuns[0][1]) / 2, (legRuns[legRuns.length - 1][0] + legRuns[legRuns.length - 1][1]) / 2] : [cx - b.w * 0.12, cx + b.w * 0.12];
  const bottom = runs(img, b.y1);
  if (kind === 'side' || kind === 'back34') {
    const sh = [cx + (kind === 'side' ? b.w * 0.02 : 0), shoulderY]; const armOut = bandW > waistW * 1.8;
    const elbow = armOut ? [sh[0] + torsoLen * 0.55, sh[1] + torsoLen * 0.05] : [sh[0] + torsoLen * 0.03, sh[1] + torsoLen * 0.45], wrist = armOut ? [sh[0] + torsoLen * 1.05, sh[1] + torsoLen * 0.1] : [sh[0] + torsoLen * 0.08, sh[1] + torsoLen * 0.85];
    const hand = [wrist[0] + (wrist[0] - elbow[0]) * 0.35, wrist[1] + (wrist[1] - elbow[1]) * 0.35];
    const hipF = [legs ? legX[1] : cx + b.w * 0.05, pelvis[1] + torsoLen * 0.08], hipB = [legs ? legX[0] : cx - b.w * 0.05, pelvis[1] + torsoLen * 0.08];
    const footRight = bottom.length ? bottom[bottom.length - 1][1] : b.x1, footLeftEnd = bottom.length ? bottom[0][1] : b.x1;
    const ankF = [hipF[0], b.y1 - H * 0.04], ankB = [hipB[0], b.y1 - H * 0.04];
    Object.assign(J, { shoulder_f: sh, elbow_f: elbow, wrist_f: wrist, hand_f: hand, shoulder_b: [...sh], elbow_b: [...elbow], wrist_b: [...wrist], hand_b: [...hand],
      hip_f: hipF, knee_f: lerp(hipF, ankF, 0.5), ankle_f: ankF, toe_f: [Math.max(ankF[0] + H * 0.05, footRight), b.y1], hip_b: hipB, knee_b: lerp(hipB, ankB, 0.5), ankle_b: ankB, toe_b: [Math.max(ankB[0] + H * 0.05, legs ? footLeftEnd : footRight), b.y1] });
    if (!legs) { const hip = [cx, pelvis[1] + torsoLen * 0.08], ank = [cx, b.y1 - H * 0.04]; for (const s of ['f', 'b']) Object.assign(J, { ['hip_' + s]: hip, ['knee_' + s]: lerp(hip, ank, 0.5), ['ankle_' + s]: ank, ['toe_' + s]: [Math.max(cx + H * 0.06, bottom.length ? bottom[bottom.length - 1][1] : b.x1), b.y1] }); }
  } else {
    const sw = Math.max(4, Math.min(bandW, waistW * 1.25)) / 2; const armOut = bandW > waistW * 1.8; const aw = Math.max(1, H * 0.045);
    const edge = (y, dir) => { const r = runs(img, Math.round(Math.min(b.y1, Math.max(b.y0, y)))); if (!r.length) return cx + dir * sw; return dir < 0 ? r[0][0] + aw : r[r.length - 1][1] + 1 - aw; };
    for (const [s, dir] of [['f', -1], ['b', 1]]) {      // f = the character's right = left on screen
      const sh = armOut ? [cx + dir * sw * 0.8, shoulderY] : [edge(shoulderY + torsoLen * 0.12, dir), shoulderY];
      const elbow = armOut ? [cx + dir * (sw + torsoLen * 0.5), shoulderY + torsoLen * 0.05] : [edge(sh[1] + torsoLen * 0.45, dir), sh[1] + torsoLen * 0.45];
      const wrist = armOut ? [cx + dir * (sw + torsoLen * 1.0), shoulderY + torsoLen * 0.08] : [edge(sh[1] + torsoLen * 0.82, dir), sh[1] + torsoLen * 0.82];
      const hx = legs ? legX[dir < 0 ? 0 : 1] : cx + dir * b.w * 0.12, hip = [hx, pelvis[1] + torsoLen * 0.06], ank = [hx, b.y1 - H * 0.04];
      Object.assign(J, { ['shoulder_' + s]: sh, ['elbow_' + s]: elbow, ['wrist_' + s]: wrist, ['hand_' + s]: [wrist[0] + (wrist[0] - elbow[0]) * 0.35, wrist[1] + (wrist[1] - elbow[1]) * 0.35], ['hip_' + s]: hip, ['knee_' + s]: lerp(hip, ank, 0.5), ['ankle_' + s]: ank, ['toe_' + s]: [hx, b.y1] });
    }
  }
  for (const k of JOINTS) J[k] = [Math.round(J[k][0] * 10) / 10, Math.round(J[k][1] * 10) / 10];
  return { joints: J, source: 'silhouette', notes: [legs ? 'legs found' : 'no gap between the legs (robe/dress?): legs guessed', `head ${Math.round(neckF * 100)}% of the height`] };
}
// joints from MediaPipe pose landmarks (33 points in pixels: [x, y, z, visibility])
function jointsFromLandmarks(L, view = 'side', img = null) {
  if (!L) return null; const P = (i) => [L[i][0], L[i][1]], mid = (a, b) => lerp(a, b, 0.5), vis = (i) => L[i][3] ?? 1;
  const kind = viewKind(view); let fSide = 'r';                                     // MediaPipe: odd = left, even = right
  if (kind === 'side' || kind === 'back34') { const zl = (L[11][2] + L[13][2] + L[23][2] + L[25][2]) / 4, zr = (L[12][2] + L[14][2] + L[24][2] + L[26][2]) / 4; fSide = zl < zr ? 'l' : 'r'; }
  const I = { l: { sh: 11, el: 13, wr: 15, ix: 19, hip: 23, kn: 25, an: 27, toe: 31 }, r: { sh: 12, el: 14, wr: 16, ix: 20, hip: 24, kn: 26, an: 28, toe: 32 } };
  const f = I[fSide], b = I[fSide === 'l' ? 'r' : 'l'];
  const shoulders = mid(P(11), P(12)), hips = mid(P(23), P(24)), neck = lerp(shoulders, P(0), 0.25);
  const ears = mid(P(7), P(8)), up = [ears[0] - neck[0], ears[1] - neck[1]], top = [ears[0] + up[0] * 0.9, ears[1] + up[1] * 0.9];
  let topY = top[1]; if (img) { const bb = bbox(img); if (bb) topY = Math.min(top[1], bb.y0 + 1); }
  const J = { head_top: [top[0], topY], neck, pelvis: hips };
  for (const [s, k] of [['f', f], ['b', b]]) Object.assign(J, { ['shoulder_' + s]: P(k.sh), ['elbow_' + s]: P(k.el), ['wrist_' + s]: P(k.wr), ['hand_' + s]: P(k.ix), ['hip_' + s]: P(k.hip), ['knee_' + s]: P(k.kn), ['ankle_' + s]: P(k.an), ['toe_' + s]: P(k.toe) });
  const conf = [11, 12, 13, 14, 23, 24, 25, 26].reduce((a, i) => a + vis(i), 0) / 8;
  for (const k of JOINTS) J[k] = [Math.round(J[k][0] * 10) / 10, Math.round(J[k][1] * 10) / 10];
  return { joints: J, source: 'pose-model', confidence: Math.round(conf * 100) / 100 };
}

// ───────── the skeleton
function figureHeight(J) { const feet = Math.max(J.ankle_f[1], J.ankle_b[1], J.toe_f[1], J.toe_b[1]); return Math.max(4, feet - J.head_top[1]); }
function skeleton(J, view = 'side') {
  const H = figureHeight(J); const ground = Math.max(J.toe_f[1], J.toe_b[1], J.ankle_f[1], J.ankle_b[1]);
  const bones = BONES.map(([name, parent, a, e, r]) => {
    let S, E; if (name === 'root') { S = [J.pelvis[0], ground]; E = [J.pelvis[0], ground - 1]; }
    else if (name === 'hips') { S = [...J.pelvis]; E = [J.pelvis[0], J.pelvis[1] - 1]; }
    else { S = [...J[a]]; E = [...J[e]]; if (dist(S, E) < 0.5) E = [S[0], S[1] + 1]; }
    const rad = name === 'head' ? Math.max(1.5, dist(S, E) * 0.62) : name === 'torso' ? Math.max(1.5, dist(J.shoulder_f, J.shoulder_b) > H * 0.1 ? dist(J.shoulder_f, J.shoulder_b) * 0.5 : r * H) : Math.max(1, r * H);
    return { name, parent, start: S, end: E, length: dist(S, E), angle: Math.atan2(E[1] - S[1], E[0] - S[0]) * 180 / Math.PI, radius: rad };
  });
  return { bones, H, ground, view, order: ORDER[viewKind(view)] || ORDER.side };
}

// ───────── cutting the picture into parts
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
// cut(img, skel, { backLimbs: 'auto' | 'copy' | 'own', fill: true }) → { parts: { bone: {w,h,data} (full-size layers) }, notes }
function cut(img, sk, o = {}) {
  const { w, h, data } = img; const B = sk.bones.filter((b) => PART_BONES.includes(b.name)); const kind = viewKind(sk.view);
  const J = jointsOf(sk);
  // in a side view the far limbs usually hide behind the near ones: copy the near limb (one shade darker) when they coincide
  const same = (s) => ['shoulder', 'elbow', 'wrist'].every((k) => dist(J[k + '_f'], J[k + '_b']) < sk.H * 0.03) ? 'arm' : null;
  const sameLeg = ['hip', 'knee', 'ankle'].every((k) => dist(J[k + '_f'], J[k + '_b']) < sk.H * 0.03);
  const copyArm = o.backLimbs === 'copy' || (o.backLimbs !== 'own' && kind !== 'front' && kind !== 'back' && same()), copyLeg = o.backLimbs === 'copy' || (o.backLimbs !== 'own' && kind !== 'front' && kind !== 'back' && sameLeg);
  const skip = new Set([...(copyArm ? LIMBS.arm_b : []), ...(copyLeg ? LIMBS.leg_b : [])]);
  const cand = B.filter((b) => !skip.has(b.name));
  const owner = new Int16Array(w * h).fill(-1); const score = new Float32Array(w * h);
  // the head wins anywhere above the neck, the torso nowhere outside the torso band; everything else by nearest bone/radius
  const neckY = J.neck[1];
  // each limb's own colours: what lies right on its bone line (so a limb over the torso doesn't steal the torso's belt)
  const key = (i) => (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
  const own = cand.map((bn) => { const set = new Set(); const n = Math.max(2, Math.ceil(bn.length)); for (let k = 0; k <= n; k++) { const q = lerp(bn.start, bn.end, k / n); for (const [dx, dy] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) { const x = Math.floor(q[0] + dx), y = Math.floor(q[1] + dy); if (x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 127) set.add(key(y * w + x)); } } return set; });
  const torsoB = cand.find((b) => b.name === 'torso');
  // limbs win inside their own capsule (an arm lying over the torso belongs to the arm; the torso is filled in behind it);
  // elsewhere the head owns what's above the neck and the torso the rest, unless a limb is clearly nearer
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (data[i * 4 + 3] <= 127) continue; const pt = [x + 0.5, y + 0.5]; let bi = -1, bs = Infinity, li = -1, ls = Infinity;
    for (let k = 0; k < cand.length; k++) { const bn = cand[k]; const s = segDist(pt, bn.start, bn.end) / Math.max(0.8, bn.radius); if (bn.name === 'head' || bn.name === 'torso') continue; if (s < ls) { ls = s; li = k; } }
    if (ls <= 1 && !(torsoB && !own[li].has(key(i)) && segDist(pt, torsoB.start, torsoB.end) / torsoB.radius < 1 && ls > 0.2)) { owner[i] = li; score[i] = ls; continue; }
    const hk = cand.findIndex((b) => b.name === 'head'), tk = cand.findIndex((b) => b.name === 'torso');
    const above = pt[1] < neckY + (kind === 'side' ? 0 : 0.5); bi = above ? hk : tk; bs = 1;
    if (!above && ls < 1.8 && pt[1] > J.pelvis[1]) { bi = li; bs = ls; }                  // below the hips: the nearest leg
    if (above && ls < 1.4) { bi = li; bs = ls; }                                            // a raised hand next to the head
    owner[i] = bi; score[i] = bs;
  }
  const parts = {}; const make = () => new Uint8ClampedArray(w * h * 4);
  cand.forEach((bn, k) => { const p = make(); for (let i = 0; i < w * h; i++) if (owner[i] === k) p.set(data.subarray(i * 4, i * 4 + 4), i * 4); parts[bn.name] = p; });
  const notes = [];
  // fill what the front parts covered, so turning a limb never shows a hole (nearest colour of the part's own pixels)
  if (o.fill !== false) for (const bn of cand) {
    if (!['torso', 'head', 'thigh_b', 'thigh_f', 'upper_arm_b'].includes(bn.name)) continue; const p = parts[bn.name]; const want = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (data[i * 4 + 3] <= 127 || p[i * 4 + 3]) continue; const d = segDist([x + 0.5, y + 0.5], bn.start, bn.end) / Math.max(0.8, bn.radius); if (d < (bn.name === 'torso' ? 0.95 : 0.8) && (bn.name !== 'torso' || (y >= J.neck[1] && y <= J.pelvis[1] + sk.H * 0.04)) && (bn.name !== 'head' || y < J.neck[1])) want.push(i); }
    if (want.length) { bfsFill(p, w, h, new Set(want)); notes.push(`${bn.name}: filled ${want.length} hidden px`); }
  }
  // joint caps: each limb part also carries its parent's pixels in a small disc round the joint, so bends don't open gaps
  for (const bn of cand) { if (!bn.parent || bn.parent === 'hips' || bn.parent === 'torso') continue; const par = parts[bn.parent]; if (!par) continue; const p = parts[bn.name]; const r = Math.max(1, bn.radius * 0.9);
    for (let y = Math.floor(bn.start[1] - r); y <= Math.ceil(bn.start[1] + r); y++) for (let x = Math.floor(bn.start[0] - r); x <= Math.ceil(bn.start[0] + r); x++) { if (x < 0 || y < 0 || x >= w || y >= h) continue; const i = (y * w + x) * 4; if (p[i + 3] || !par[i + 3] || Math.hypot(x + 0.5 - bn.start[0], y + 0.5 - bn.start[1]) > r) continue; p.set(par.subarray(i, i + 4), i); } }
  // far limbs copied from the near ones, a shade darker, nudged backwards
  const shade = (p) => { const q = new Uint8ClampedArray(p); for (let i = 0; i < q.length; i += 4) if (q[i + 3]) { q[i] = q[i] * 0.72; q[i + 1] = q[i + 1] * 0.7; q[i + 2] = Math.min(255, q[i + 2] * 0.78 + 10); } return q; };
  const shift = (p, dx) => { const q = new Uint8ClampedArray(p.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const X = x + dx; if (X < 0 || X >= w) continue; q.set(p.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + X) * 4); } return q; };
  const back = o.backShift ?? 0;                                   // 0: the far limb sits exactly behind the near one at rest
  if (copyArm) { for (const n of LIMBS.arm_f) parts[n.replace('_f', '_b')] = shade(shift(parts[n], back)); notes.push('far arm copied from the near arm'); }
  if (copyLeg) { for (const n of LIMBS.leg_f) parts[n.replace("_f", "_b")] = shade(shift(parts[n], back)); notes.push('far leg copied from the near leg'); }
  for (const n of PART_BONES) if (!parts[n]) parts[n] = make();
  return { parts, notes, copied: { arm: copyArm, leg: copyLeg }, backShift: back };
}
function bfsFill(p, w, h, want) {
  const q = []; const col = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) if (p[i * 4 + 3]) { col[i] = i; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) { const i = q[qi], x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (col[j] >= 0 || !want.has(j)) continue; col[j] = col[i]; q.push(j); } }
  for (const j of want) if (col[j] >= 0) p.set(p.subarray(col[j] * 4, col[j] * 4 + 4), j * 4);
}
function jointsOf(sk) { const J = {}; for (const b of sk.bones) { const [, , a, e] = BONES.find((x) => x[0] === b.name); if (a) J[a] = b.start; if (e && !J[e]) J[e] = b.end; } return J; }

// ───────── posing (forward kinematics as affine maps from the rest picture to the posed picture)
const I2 = () => [1, 0, 0, 1, 0, 0];
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const T = (x, y) => [1, 0, 0, 1, x, y], R = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; }, Sc = (x, y) => [x, 0, 0, y, 0, 0];
const ap = (M, p) => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]];
function inv(M) { const d = M[0] * M[3] - M[1] * M[2] || 1e-9; return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d, (M[2] * M[5] - M[3] * M[4]) / d, (M[1] * M[4] - M[0] * M[5]) / d]; }
// pose → { name: { M (rest → posed), angle (world, degrees), start (posed) } }
function solve(sk, pose = {}) {
  const P = pose.bones || {}, root = pose.root || {}, H = sk.H, out = {};
  for (const b of sk.bones) {
    const p = P[b.name] || {};
    if (!b.parent) { const piv = b.start; const M = mul(T((root.x || 0) * H + piv[0], (root.y || 0) * H + piv[1]), mul(R(root.rot || 0), T(-piv[0], -piv[1]))); out[b.name] = { M, angle: root.rot || 0, start: ap(M, b.start), Mpart: M }; continue; }
    const par = out[b.parent]; const st = ap(par.M, b.start); const st2 = [st[0] + (p.x || 0) * H, st[1] + (p.y || 0) * H]; const ang = par.angle + (p.r || 0);
    const M = mul(T(st2[0], st2[1]), mul(R(ang), T(-b.start[0], -b.start[1])));
    // the part itself may stretch along/across the bone; children follow the stretched bone
    const sl = p.sl ?? 1, sw = p.sw ?? 1; const Ms = sl === 1 && sw === 1 ? M : mul(M, mul(T(b.start[0], b.start[1]), mul(R(b.angle), mul(Sc(sl, sw), mul(R(-b.angle), T(-b.start[0], -b.start[1]))))));
    out[b.name] = { M: Ms, angle: ang, start: st2, Mpart: Ms };
  }
  return out;
}
// where named points end up (hands, head, feet) — for attach points in exports
function points(sk, pose) { const S = solve(sk, pose); const g = (n, end) => { const b = sk.bones.find((x) => x.name === n); return ap(S[n].M, end ? b.end : b.start); }; return { hand_f: g('hand_f', true), hand_b: g('hand_b', true), head: g('head', true), neck: g('head'), pelvis: g('torso'), foot_f: g('foot_f', true), foot_b: g('foot_b', true), root: ap(S.root.M, sk.bones[0].start) }; }

// ───────── rendering: Scale2x ×3 (RotSprite), transform at 8×, majority back down, snap to the palette
function scale2x(img) {
  const { w, h, data: d } = img, W = w * 2, o = new Uint8ClampedArray(W * h * 2 * 4), u = new Uint32Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)), O = new Uint32Array(o.buffer);
  const at = (x, y) => u[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
    O[(2 * y) * W + 2 * x] = C === A && C !== D && A !== B ? A : P; O[(2 * y) * W + 2 * x + 1] = A === B && A !== C && B !== D ? B : P; O[(2 * y + 1) * W + 2 * x] = D === C && D !== B && C !== A ? C : P; O[(2 * y + 1) * W + 2 * x + 1] = B === D && B !== A && D !== C ? D : P; }
  return { w: W, h: h * 2, data: o };
}
function partBox(p, w, h) { let x0 = w, y0 = h, x1 = -1, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (p[(y * w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1 }; }
// layers: [{ bone, data (w×h RGBA, rest position), z? }] in draw order; extra: attachments already turned into layers
function prepare(layers, w, h, pixel) {
  return layers.map((l) => { const bx = partBox(l.data, w, h); if (!bx) return null; const cw = bx.x1 - bx.x0 + 1, ch = bx.y1 - bx.y0 + 1; const crop = new Uint8ClampedArray(cw * ch * 4); for (let y = 0; y < ch; y++) crop.set(l.data.subarray(((bx.y0 + y) * w + bx.x0) * 4, ((bx.y0 + y) * w + bx.x1 + 1) * 4), y * cw * 4);
    let big = { w: cw, h: ch, data: crop }; if (pixel) big = scale2x(scale2x(scale2x(big))); return { ...l, box: bx, cw, ch, big }; }).filter(Boolean);
}
// render(sk, prepared, pose, { frame: {x, y, w, h} (in picture px), pixel, palette }) → {w,h,data}
function render(sk, prep, pose, o = {}) {
  const F = o.frame, K = o.pixel === false ? 1 : 8, W = F.w * K, Hh = F.h * K, big = new Uint8ClampedArray(W * Hh * 4); const S = solve(sk, pose);
  for (const p of prep) {
    const st = S[p.bone]; if (!st) continue; const M = p.extra ? mul(st.M, p.extra) : st.Mpart; const Mi = inv(M);
    // the part's posed bounding box in the frame
    const cs = [[p.box.x0, p.box.y0], [p.box.x1 + 1, p.box.y0], [p.box.x0, p.box.y1 + 1], [p.box.x1 + 1, p.box.y1 + 1]].map((c) => ap(M, c));
    const X0 = Math.max(0, Math.floor((Math.min(...cs.map((c) => c[0])) - F.x) * K) - 1), X1 = Math.min(W - 1, Math.ceil((Math.max(...cs.map((c) => c[0])) - F.x) * K) + 1), Y0 = Math.max(0, Math.floor((Math.min(...cs.map((c) => c[1])) - F.y) * K) - 1), Y1 = Math.min(Hh - 1, Math.ceil((Math.max(...cs.map((c) => c[1])) - F.y) * K) + 1);
    const bw = p.big.w, bh = p.big.h, bd = p.big.data, kx = bw / p.cw, ky = bh / p.ch;
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const src = ap(Mi, [F.x + (x + 0.5) / K, F.y + (y + 0.5) / K]); const sx = Math.floor((src[0] - p.box.x0) * kx), sy = Math.floor((src[1] - p.box.y0) * ky);
      if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) continue; const si = (sy * bw + sx) * 4; if (bd[si + 3] < 128) continue; const di = (y * W + x) * 4;
      big[di] = bd[si]; big[di + 1] = bd[si + 1]; big[di + 2] = bd[si + 2]; big[di + 3] = 255;
    }
  }
  if (K === 1) return { w: F.w, h: F.h, data: big };
  // back down: per 8×8 block, the commonest colour if at least half of it is filled
  const out = new Uint8ClampedArray(F.w * F.h * 4); const pal = o.palette && o.palette.length ? o.palette.map((c) => (Array.isArray(c) ? c : hexRgb(c))) : null; const cache = new Map();
  for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
    const cnt = new Map(); let n = 0;
    for (let j = 0; j < K; j++) { const row = ((y * K + j) * W + x * K) * 4; for (let i = 0; i < K; i++) { const di = row + i * 4; if (!big[di + 3]) continue; n++; const k = (big[di] << 16) | (big[di + 1] << 8) | big[di + 2]; cnt.set(k, (cnt.get(k) || 0) + 1); } }
    if (n < (K * K) / 2) continue; let bk = 0, bn = -1; for (const [k, c] of cnt) if (c > bn) { bn = c; bk = k; }
    let c = [bk >> 16, (bk >> 8) & 255, bk & 255]; if (pal) { if (!cache.has(bk)) { let best = pal[0], bd = Infinity; for (const q of pal) { const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (d < bd) { bd = d; best = q; } } cache.set(bk, best); } c = cache.get(bk); }
    const oi = (y * F.w + x) * 4; out[oi] = c[0]; out[oi + 1] = c[1]; out[oi + 2] = c[2]; out[oi + 3] = 255;
  }
  return { w: F.w, h: F.h, data: out };
}
function hexRgb(h) { const s = String(h).replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; }
// the area a set of poses covers (union of every part's posed box), padded — gives every frame of a view one size
function bounds(sk, prep, poses, pad = 2) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pose of poses) { const S = solve(sk, pose); for (const p of prep) { const st = S[p.bone]; if (!st) continue; const M = p.extra ? mul(st.M, p.extra) : st.Mpart; for (const c of [[p.box.x0, p.box.y0], [p.box.x1 + 1, p.box.y0], [p.box.x0, p.box.y1 + 1], [p.box.x1 + 1, p.box.y1 + 1]]) { const q = ap(M, c); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } } }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.floor(x0) - pad, y = Math.floor(y0) - pad; return { x, y, w: Math.ceil(x1) + pad - x, h: Math.ceil(y1) + pad - y };
}
function flipJointsX(J, w) { const o = {}; for (const k of Object.keys(J)) o[k] = [w - J[k][0], J[k][1]]; return o; }

module.exports = { JOINTS, BONES, PART_BONES, LIMBS, ORDER, viewKind, bbox, guessJoints, jointsFromLandmarks, skeleton, cut, solve, points, scale2x, prepare, render, bounds, figureHeight, flipJointsX, mul, T, R, Sc, ap, inv };

// Dither — characters: a rig per view (side, front, back, three-quarters), a library of motions that fit any rig,
// keyed animations from the pose editor or from video, skins and attachments, and rendering for any game direction.
// A character's parts live in an ordinary sprite (one layer per bone, frame 0 = default skin, more frames = skins),
// so they can be drawn on, shaded and textured like anything else.
'use strict';
const RG = require('./rig');
const SP = require('./sprite');

const VIEWS = ['side', 'front', 'back', 'front34', 'back34'];
// game directions → which view draws them and whether it's mirrored
const DIRS = {
  1: [['right', 'side', false], ['left', 'side', true]],
  4: [['down', 'front', false], ['up', 'back', false], ['right', 'side', false], ['left', 'side', true]],
  8: [['down', 'front', false], ['down_right', 'front34', false], ['right', 'side', false], ['up_right', 'back34', false], ['up', 'back', false], ['up_left', 'back34', true], ['left', 'side', true], ['down_left', 'front34', true]],
};
const FALLBACK = { front34: ['side', 'front'], back34: ['side', 'back'], back: ['front', 'side'], front: ['side'], side: ['front'] };
function directions(ch) { return (DIRS[ch.directions] || DIRS[1]).map(([dir, view, mirror]) => { const have = ch.views[view] ? view : (FALLBACK[view] || []).find((v) => ch.views[v]) || Object.keys(ch.views)[0]; return { dir, view: have, wanted: view, mirror, fallback: have !== view }; }); }

// ───────── the motion library. Angles in degrees, clockwise on screen; side views face right.
// Offsets are in figure heights. Every motion is a function of t (0..1) for a kind of view.
const sin = (t) => Math.sin(2 * Math.PI * t), cos = (t) => Math.cos(2 * Math.PI * t), pos = (v) => Math.max(0, v);
const smooth = (u) => u * u * (3 - 2 * u);
// keyframe helper: kf(t, [[t0, v0], [t1, v1], …]) eases between keys
function kf(t, keys) { if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * smooth((t - a) / Math.max(1e-6, b - a)); } return keys[keys.length - 1][1]; }
const MOTIONS = {
  idle: { label: 'Idle', loop: true, frames: 6, fps: 6, side(t) { const s = sin(t); return { root: { y: 0.008 * (1 - cos(t)) / 2 }, bones: { torso: { r: 1.2 * s }, head: { r: -1.2 * s }, upper_arm_f: { r: -2 * s }, upper_arm_b: { r: -2 * s }, lower_arm_f: { r: -3 }, lower_arm_b: { r: -3 } } }; },
    front(t) { const s = sin(t); return { root: { y: 0.008 * (1 - cos(t)) / 2 }, bones: { torso: { sw: 1 + 0.02 * s }, head: { y: 0.004 * s }, upper_arm_f: { r: 2 * s }, upper_arm_b: { r: -2 * s } } }; } },
  walk: { label: 'Walk', loop: true, frames: 8, fps: 10, side(t) { const s = sin(t), c = cos(t); return { root: { y: -0.018 * (1 - s * s) }, bones: {
      torso: { r: 3 }, head: { r: -2 }, thigh_f: { r: -24 * s }, thigh_b: { r: 24 * s }, shin_f: { r: 34 * pos(c) }, shin_b: { r: 34 * pos(-c) }, foot_f: { r: 24 * s * 0.6 - 34 * pos(c) * 0.6 }, foot_b: { r: -24 * s * 0.6 - 34 * pos(-c) * 0.6 },
      upper_arm_f: { r: 22 * s }, upper_arm_b: { r: -22 * s }, lower_arm_f: { r: -12 - 10 * pos(-s) }, lower_arm_b: { r: -12 - 10 * pos(s) } } }; },
    front(t) { const s = sin(t); return { root: { y: 0.014 * s * s - 0.01 }, bones: { torso: { r: 2 * s }, head: { r: -2 * s }, thigh_f: { sl: 1 - 0.16 * pos(s), y: -0.025 * pos(s) }, shin_f: { sl: 1 - 0.1 * pos(s) }, foot_f: { y: -0.01 * pos(s) }, thigh_b: { sl: 1 - 0.16 * pos(-s), y: -0.025 * pos(-s) }, shin_b: { sl: 1 - 0.1 * pos(-s) }, foot_b: { y: -0.01 * pos(-s) }, upper_arm_f: { r: 5 * s, sl: 1 - 0.08 * pos(-s) }, upper_arm_b: { r: 5 * s, sl: 1 - 0.08 * pos(s) } } }; } },
  run: { label: 'Run', loop: true, frames: 8, fps: 14, side(t) { const s = sin(t), c = cos(t); return { root: { y: -0.045 * (1 - Math.abs(s)) + 0.01 }, bones: {
      torso: { r: 11 }, head: { r: -7 }, thigh_f: { r: -42 * s }, thigh_b: { r: 42 * s }, shin_f: { r: 80 * pos(c) + 12 }, shin_b: { r: 80 * pos(-c) + 12 }, foot_f: { r: -30 * pos(c) }, foot_b: { r: -30 * pos(-c) },
      upper_arm_f: { r: 48 * s }, upper_arm_b: { r: -48 * s }, lower_arm_f: { r: -80 }, lower_arm_b: { r: -80 } } }; },
    front(t) { const s = sin(t); return { root: { y: 0.03 * s * s - 0.03 }, bones: { torso: { r: 3 * s }, thigh_f: { sl: 1 - 0.3 * pos(s), y: -0.05 * pos(s) }, shin_f: { sl: 1 - 0.2 * pos(s) }, thigh_b: { sl: 1 - 0.3 * pos(-s), y: -0.05 * pos(-s) }, shin_b: { sl: 1 - 0.2 * pos(-s) }, upper_arm_f: { r: 12 * s, sl: 1 - 0.2 * pos(-s) }, upper_arm_b: { r: 12 * s, sl: 1 - 0.2 * pos(s) }, lower_arm_f: { r: 20 }, lower_arm_b: { r: -20 } } }; } },
  jump: { label: 'Jump', loop: false, frames: 10, fps: 12, side(t) { const air = t > 0.3 && t < 0.82 ? Math.sin(Math.PI * (t - 0.3) / 0.52) : 0, crouch = kf(t, [[0, 0], [0.18, 1], [0.3, 0], [0.82, 0], [0.9, 0.8], [1, 0]]);
      return { root: { y: 0.07 * crouch - 0.38 * air }, bones: { torso: { r: 14 * crouch + 4 }, head: { r: -8 * crouch }, thigh_f: { r: -38 * crouch - 35 * air }, thigh_b: { r: -30 * crouch - 10 * air }, shin_f: { r: 60 * crouch + 55 * air }, shin_b: { r: 50 * crouch + 25 * air }, foot_f: { r: -20 * crouch }, foot_b: { r: -20 * crouch },
        upper_arm_f: { r: kf(t, [[0, 0], [0.18, 35], [0.32, -150], [0.6, -120], [0.85, 20], [1, 0]]) }, upper_arm_b: { r: kf(t, [[0, 0], [0.18, 30], [0.32, -140], [0.6, -110], [0.85, 15], [1, 0]]) }, lower_arm_f: { r: -20 }, lower_arm_b: { r: -20 } } }; },
    front(t) { const air = t > 0.3 && t < 0.82 ? Math.sin(Math.PI * (t - 0.3) / 0.52) : 0, crouch = kf(t, [[0, 0], [0.18, 1], [0.3, 0], [0.82, 0], [0.9, 0.8], [1, 0]]);
      return { root: { y: 0.07 * crouch - 0.38 * air }, bones: { thigh_f: { sl: 1 - 0.25 * crouch - 0.2 * air, r: 10 * air }, thigh_b: { sl: 1 - 0.25 * crouch - 0.2 * air, r: -10 * air }, shin_f: { sl: 1 - 0.2 * crouch }, shin_b: { sl: 1 - 0.2 * crouch }, upper_arm_f: { r: kf(t, [[0, 0], [0.18, -15], [0.35, 150], [0.7, 130], [0.9, 10], [1, 0]]) }, upper_arm_b: { r: -kf(t, [[0, 0], [0.18, -15], [0.35, 150], [0.7, 130], [0.9, 10], [1, 0]]) } } }; } },
  attack: { label: 'Attack', loop: false, frames: 8, fps: 14, events: [{ t: 0.45, name: 'hit' }], side(t) { const arm = kf(t, [[0, 0], [0.3, 150], [0.48, -100], [0.68, -45], [1, 0]]);
      return { root: { x: kf(t, [[0, 0], [0.3, -0.02], [0.5, 0.05], [1, 0]]) }, bones: { torso: { r: kf(t, [[0, 0], [0.3, -9], [0.5, 15], [1, 0]]) }, head: { r: kf(t, [[0, 0], [0.5, -6], [1, 0]]) }, upper_arm_f: { r: arm }, lower_arm_f: { r: kf(t, [[0, -10], [0.3, -40], [0.5, -5], [1, -10]]) }, upper_arm_b: { r: kf(t, [[0, 0], [0.3, -30], [0.5, 40], [1, 0]]) },
        thigh_f: { r: kf(t, [[0, 0], [0.5, -28], [1, 0]]) }, shin_f: { r: kf(t, [[0, 0], [0.5, 18], [1, 0]]) }, thigh_b: { r: kf(t, [[0, 0], [0.5, 18], [1, 0]]) } } }; },
    front(t) { const arm = kf(t, [[0, 0], [0.3, -150], [0.48, 20], [0.7, 0], [1, 0]]); return { root: { y: kf(t, [[0, 0], [0.48, 0.02], [1, 0]]) }, bones: { torso: { r: kf(t, [[0, 0], [0.3, 4], [0.5, -6], [1, 0]]) }, upper_arm_b: { r: arm, sl: kf(t, [[0, 1], [0.48, 0.7], [0.8, 1]]) }, lower_arm_b: { r: kf(t, [[0, 0], [0.3, -30], [0.5, 0]]) } } }; } },
  cast: { label: 'Cast', loop: false, frames: 10, fps: 12, events: [{ t: 0.55, name: 'cast' }], side(t) { const up = kf(t, [[0, 0], [0.35, 1], [0.7, 1], [1, 0]]), push = kf(t, [[0, 0], [0.45, 0], [0.6, 1], [0.8, 0.6], [1, 0]]);
      return { root: { y: -0.01 * up }, bones: { torso: { r: -6 * up + 8 * push }, head: { r: -6 * up }, upper_arm_f: { r: -100 * up - 10 * push }, upper_arm_b: { r: -85 * up }, lower_arm_f: { r: -40 * up + 35 * push }, lower_arm_b: { r: -50 * up + 30 * push } } }; },
    front(t) { const up = kf(t, [[0, 0], [0.35, 1], [0.7, 1], [1, 0]]); return { root: { y: -0.01 * up }, bones: { upper_arm_f: { r: 110 * up }, upper_arm_b: { r: -110 * up }, lower_arm_f: { r: 30 * up }, lower_arm_b: { r: -30 * up }, head: { y: -0.005 * up } } }; } },
  hurt: { label: 'Hurt', loop: false, frames: 5, fps: 12, side(t) { const k = kf(t, [[0, 0], [0.25, 1], [1, 0]]); return { root: { x: -0.05 * k }, bones: { torso: { r: -15 * k }, head: { r: -14 * k }, upper_arm_f: { r: 45 * k }, upper_arm_b: { r: 35 * k }, lower_arm_f: { r: -30 * k }, thigh_f: { r: -14 * k }, shin_f: { r: 10 * k } } }; },
    front(t) { const k = kf(t, [[0, 0], [0.25, 1], [1, 0]]); return { root: { y: 0.02 * k }, bones: { torso: { r: -5 * k }, head: { r: 9 * k }, upper_arm_f: { r: 30 * k }, upper_arm_b: { r: -30 * k } } }; } },
  death: { label: 'Death', loop: false, frames: 12, fps: 10, side(t) { const fall = kf(t, [[0, 0], [0.25, 0.08], [0.75, 1], [1, 1]]), buckle = kf(t, [[0, 0], [0.3, 1], [0.7, 0.4], [1, 0.2]]);
      return { root: { rot: -84 * fall, x: -0.03 * fall, y: 0.02 * buckle }, bones: { torso: { r: -8 * buckle }, head: { r: kf(t, [[0, 0], [0.4, -20], [0.8, 15], [1, 10]]) }, upper_arm_f: { r: kf(t, [[0, 0], [0.4, 70], [1, 35]]) }, upper_arm_b: { r: kf(t, [[0, 0], [0.4, 60], [1, 30]]) }, thigh_f: { r: -25 * buckle }, shin_f: { r: 40 * buckle }, thigh_b: { r: -15 * buckle }, shin_b: { r: 30 * buckle } } }; },
    front(t) { const fall = kf(t, [[0, 0], [0.3, 0.05], [0.8, 1], [1, 1]]), buckle = kf(t, [[0, 0], [0.35, 1], [1, 0.6]]); return { root: { rot: 84 * fall, y: 0.03 * buckle }, bones: { thigh_f: { sl: 1 - 0.3 * buckle }, thigh_b: { sl: 1 - 0.3 * buckle }, head: { r: 12 * fall }, upper_arm_f: { r: 40 * fall }, upper_arm_b: { r: -20 * fall } } }; } },
  climb: { label: 'Climb', loop: true, frames: 8, fps: 8, side(t) { const s = sin(t); return { root: { y: -0.02 * s }, bones: { torso: { r: -4 }, upper_arm_f: { r: -150 + 25 * s }, upper_arm_b: { r: -150 - 25 * s }, lower_arm_f: { r: -30 - 20 * pos(s) }, lower_arm_b: { r: -30 - 20 * pos(-s) }, thigh_f: { r: -45 * pos(-s) }, shin_f: { r: 70 * pos(-s) }, thigh_b: { r: -45 * pos(s) }, shin_b: { r: 70 * pos(s) } } }; },
    front(t) { const s = sin(t); return { root: { y: -0.02 * s }, bones: { upper_arm_f: { r: 160 - 15 * s, sl: 1 - 0.1 * pos(s) }, upper_arm_b: { r: -160 - 15 * s, sl: 1 - 0.1 * pos(-s) }, lower_arm_f: { r: 20 }, lower_arm_b: { r: -20 }, thigh_f: { sl: 1 - 0.3 * pos(-s), y: -0.04 * pos(-s) }, thigh_b: { sl: 1 - 0.3 * pos(s), y: -0.04 * pos(s) } } }; } },
};
function motionPose(id, t, view, amp = 1) {
  const m = MOTIONS[id]; if (!m) throw new Error(`No motion “${id}”. Motions: ${Object.keys(MOTIONS).join(', ')}`);
  const kind = RG.viewKind(view); let p = kind === 'front' || kind === 'back' ? m.front(t) : m.side(t);
  if (view === 'front34' || view === 'back34') p = scalePose(p, 0.8);
  return amp === 1 ? p : scalePose(p, amp);
}
function scalePose(p, k) { const o = { root: {}, bones: {} }; for (const [a, v] of Object.entries(p.root || {})) o.root[a] = v * k; for (const [b, v] of Object.entries(p.bones || {})) { o.bones[b] = {}; for (const [a, x] of Object.entries(v)) o.bones[b][a] = a === 'sl' || a === 'sw' ? 1 + (x - 1) * k : x * k; } return o; }
function lerpPose(A, B, u) {
  const o = { root: {}, bones: {} }; const ks = new Set([...Object.keys(A.root || {}), ...Object.keys(B.root || {})]); for (const k of ks) o.root[k] = (A.root?.[k] || 0) + ((B.root?.[k] || 0) - (A.root?.[k] || 0)) * u;
  const bs = new Set([...Object.keys(A.bones || {}), ...Object.keys(B.bones || {})]); for (const b of bs) { const a = A.bones?.[b] || {}, c = B.bones?.[b] || {}; o.bones[b] = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(c)])) { const d = k === 'sl' || k === 'sw' ? 1 : 0; o.bones[b][k] = (a[k] ?? d) + ((c[k] ?? d) - (a[k] ?? d)) * u; } }
  return o;
}
function addPose(A, B) { const o = lerpPose(A, { root: {}, bones: {} }, 0); for (const [k, v] of Object.entries(B.root || {})) o.root[k] = (o.root[k] || 0) + v; for (const [b, v] of Object.entries(B.bones || {})) { o.bones[b] ||= {}; for (const [k, x] of Object.entries(v)) o.bones[b][k] = k === 'sl' || k === 'sw' ? (o.bones[b][k] ?? 1) * x : (o.bones[b][k] || 0) + x; } return o; }
// the pose of an animation at frame f: keyed frames (from the pose editor or video) or the library motion; keys add on top of a motion
// vo = the character's view ({ robe }): under a robe or dress the legs barely swing
function poseAt(anim, f, view, vo) { let p = poseAt0(anim, f, view); if (!vo || !vo.robe) return p; p = JSON.parse(JSON.stringify(p)); for (const b of ['thigh_f', 'thigh_b', 'shin_f', 'shin_b', 'foot_f', 'foot_b']) { const q = p.bones && p.bones[b]; if (!q) continue; if (q.r) q.r *= 0.3; if (q.sl !== undefined) q.sl = 1 + (q.sl - 1) * 0.3; if (q.y) q.y *= 0.3; } return p; }
function poseAt0(anim, f, view) {
  const n = Math.max(1, anim.frames || 1), t = anim.loop ? f / n : n > 1 ? f / (n - 1) : 0;
  let base = anim.motion ? motionPose(anim.motion, t, view, anim.amp ?? 1) : { root: {}, bones: {} };
  const keys = (anim.keys && (anim.keys[view] || anim.keys.all)) || null;
  if (keys && keys.length) {
    const ks = [...keys].sort((a, b) => a.f - b.f); let k;
    if (f <= ks[0].f && !anim.loop) k = ks[0].pose; else if (f >= ks[ks.length - 1].f && !anim.loop) k = ks[ks.length - 1].pose;
    else { let a = ks[ks.length - 1], b = ks[0]; for (let i = 0; i < ks.length; i++) { if (ks[i].f <= f) a = ks[i]; if (ks[i].f > f) { b = ks[i]; break; } if (i === ks.length - 1) b = ks[0]; } const span = ((b.f - a.f) + n) % n || n; const u = a === b ? 0 : (((f - a.f) + n) % n) / span; k = lerpPose(a.pose, b.pose, u); }
    base = anim.motion && anim.add !== false ? addPose(base, k) : k;
  }
  return base;
}

// ───────── a character's views → rigs ready to render
function viewParts(s, skinFrame = 0) {
  // layers bottom → top are the draw order; a skin frame's empty cel falls back to the default skin (frame 0)
  return s.layers.filter((l) => l.visible !== false).map((l) => { const c = SP.getCel(s, l.id, s.frames[Math.min(skinFrame, s.frames.length - 1)].id) || SP.getCel(s, l.id, s.frames[0].id); return { bone: l.name, data: c || new Uint8ClampedArray(s.w * s.h * 4), layer: l.id }; });
}
function skinFrame(ch, s) { const sk = (ch.skins || []).find((k) => k.name === ch.skin); return sk ? Math.min(sk.frame, s.frames.length - 1) : 0; }
function recolorParts(parts, map) { if (!map || !Object.keys(map).length) return parts; const m = new Map(Object.entries(map).map(([a, b]) => [hexKey(a), hexRgb(b)])); return parts.map((p) => { const d = new Uint8ClampedArray(p.data); for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { const r = m.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); if (r) { d[i] = r[0]; d[i + 1] = r[1]; d[i + 2] = r[2]; } } return { ...p, data: d }; }); }
const hexRgb = (h) => { const s = String(h).replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const hexKey = (h) => { const c = hexRgb(h); return (c[0] << 16) | (c[1] << 8) | c[2]; };
// attachments become extra layers on a bone: { bone, sprite, frame, x, y (offset from the bone's start, rest pose), rot, z: 'front'|'back' }
function attachmentLayers(getSprite, ch, viewName, sk, s) {
  const out = { front: [], back: [] };
  for (const a of ch.attachments || []) {
    if (a.skin && a.skin !== ch.skin) continue; if (a.views && !a.views.includes(viewName)) continue; const bone = sk.bones.find((b) => b.name === a.bone); if (!bone) continue;
    let as; try { as = getSprite(a.sprite); } catch { continue; } const img = SP.compose(as, a.frame || 0);
    // place it on the parts canvas at rest: its pivot (a.px, a.py in the attachment's own pixels, default centre) at bone start + offset
    const d = new Uint8ClampedArray(s.w * s.h * 4); const px = a.px ?? as.w / 2, py = a.py ?? as.h / 2; const ox = bone.start[0] + (a.x || 0) - px, oy = bone.start[1] + (a.y || 0) - py; const r = (a.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const dx = x + 0.5 - (ox + px), dy = y + 0.5 - (oy + py); const u = Math.floor(c * dx + sn * dy + px), v = Math.floor(-sn * dx + c * dy + py); if (u < 0 || v < 0 || u >= as.w || v >= as.h) continue; const si = (v * as.w + u) * 4; if (img[si + 3] < 128) continue; d.set(img.subarray(si, si + 4), (y * s.w + x) * 4); }
    out[a.z === 'back' ? 'back' : 'front'].push({ bone: a.bone, data: d, attachment: a.id });
  }
  return out;
}
// everything needed to render one view: { sk, prep, palette, w, h, mirror }
function viewRig(getSprite, ch, viewName, { pixel } = {}) {
  const v = ch.views[viewName]; if (!v) throw new Error(`This character has no ${viewName} view yet`); const s = getSprite(v.sprite);
  const sk = RG.skeleton(v.joints, viewName); let parts = viewParts(s, skinFrame(ch, s)); const sk2 = (ch.skins || []).find((k) => k.name === ch.skin); if (sk2 && sk2.recolor) parts = recolorParts(parts, sk2.recolor);
  const att = attachmentLayers(getSprite, ch, viewName, sk, s); const order = [...att.back, ...parts, ...att.front];
  const px = pixel ?? ch.pixel !== false; const prep = RG.prepare(order, s.w, s.h, px);
  const pal = new Set(); for (const l of order) for (let i = 0; i < l.data.length; i += 4) if (l.data[i + 3] > 127) pal.add((l.data[i] << 16) | (l.data[i + 1] << 8) | l.data[i + 2]);
  return { sk, prep, palette: [...pal].map((k) => [k >> 16, (k >> 8) & 255, k & 255]), w: s.w, h: s.h, pixel: px, sprite: s };
}
// render frames of an animation for one view; frame box shared by all frames (or given)
function renderAnim(getSprite, ch, anim, viewName, { mirror = false, frame, rig, pixel } = {}) {
  const R0 = rig || viewRig(getSprite, ch, viewName, { pixel }); const n = Math.max(1, anim.frames || 1); const poses = Array.from({ length: n }, (_, f) => poseAt(anim, f, viewName, ch.views[viewName]));
  const F = frame || RG.bounds(R0.sk, R0.prep, poses, 2);
  const frames = poses.map((p) => { const r = RG.render(R0.sk, R0.prep, p, { frame: F, pixel: R0.pixel, palette: R0.palette }); return mirror ? flipX(r) : r; });
  return { frames: frames.map((f) => f.data), w: F.w, h: F.h, box: F, poses, fps: anim.fps || 10, rig: R0 };
}
function flipX(img) { const o = new Uint8ClampedArray(img.data.length); for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) o.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (y * img.w + img.w - 1 - x) * 4); return { w: img.w, h: img.h, data: o }; }

// ───────── making a character
// prepPicture: key out a flat background, crop, and (for pixel style) bring a big picture down to `height` px
function prepPicture(img, { pixel = true, height } = {}) {
  const C2S = require('./clip2sprite'); let transparent = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) transparent++;
  let im = img; if (transparent < img.data.length / 4 / 50) im = C2S.key(img);
  const st = C2S.stats(im); if (!st) throw new Error('Nothing left after removing the background');
  const long = Math.max(st.x1 - st.x0 + 1, st.y1 - st.y0 + 1); const target = pixel ? (height || (long > 128 ? 64 : 0)) : 0;
  if (target && st.y1 - st.y0 + 1 > target) { const ds = C2S.downsample([im], { height: target, pad: 1 }); const { frames, palette } = C2S.sharedPalette(ds.frames, ds.w, ds.h, { colors: 24 }); return { w: ds.w, h: ds.h, data: frames[0], palette }; }
  // just crop with a margin
  const pad = Math.max(2, Math.round(long * 0.04)), w = st.x1 - st.x0 + 1 + pad * 2, h = st.y1 - st.y0 + 1 + pad * 2, d = new Uint8ClampedArray(w * h * 4);
  for (let y = st.y0; y <= st.y1; y++) d.set(im.data.subarray((y * im.w + st.x0) * 4, (y * im.w + st.x1 + 1) * 4), ((y - st.y0 + pad) * w + pad) * 4);
  return { w, h, data: d };
}
// a parts sprite for a view, from a picture and joints
function buildView({ name, img, joints, view, backLimbs, skins }) {
  const sk = RG.skeleton(joints, view); const c = RG.cut(img, sk, { backLimbs });
  const s = SP.create({ name, w: img.w, h: img.h, palette: [], frames: 1 });
  s.layers = sk.order.map((n) => ({ id: SP.uid('ly'), name: n, visible: true, opacity: 1 })); s.cels = {};
  for (const l of s.layers) SP.setCel(s, l.id, s.frames[0].id, c.parts[l.name]);
  const used = new Set(); for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 127) used.add('#' + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('')); s.palette = [...used].slice(0, 256);
  s.partsOf = true; s.tags = [{ name: 'Default skin', from: 0, to: 0, direction: 'forward' }]; void skins;
  return { sprite: s, notes: c.notes, copied: c.copied };
}
function blankCharacter({ name = 'Character', pixel = true, directions: dirs = 1 } = {}) {
  return { name, pixel, directions: dirs, views: {}, animations: Object.keys(MOTIONS).filter((k) => ['idle', 'walk', 'run', 'jump', 'attack', 'hurt', 'death'].includes(k)).map((k) => ({ id: k, name: k, motion: k, frames: MOTIONS[k].frames, fps: MOTIONS[k].fps, loop: MOTIONS[k].loop, events: MOTIONS[k].events || [] })), skins: [{ name: 'Default', frame: 0 }], skin: 'Default', attachments: [] };
}

// ───────── motion from video: MediaPipe landmarks per frame → bone rotations for this character's view
const LM = { nose: 0, l_ear: 7, r_ear: 8, l_sh: 11, r_sh: 12, l_el: 13, r_el: 14, l_wr: 15, r_wr: 16, l_ix: 19, r_ix: 20, l_hip: 23, r_hip: 24, l_kn: 25, r_kn: 26, l_an: 27, r_an: 28, l_toe: 31, r_toe: 32 };
const wrap = (a) => ((a + 540) % 360) - 180;
function retarget(seq, sk, { view = 'side', frames, start = 0, end, inPlace = true, loop = false } = {}) {
  const kind = RG.viewKind(view); let list = seq.slice(start, end ?? seq.length);
  // fill gaps by holding the last good frame
  let last = null; list = list.map((l) => (l ? (last = l) : last)); const firstGood = list.find(Boolean); if (!firstGood) throw new Error('No person was found in that video. Pose detection needs a clear full body.'); list = list.map((l) => l || firstGood);
  const P = (L, i) => [L[i][0], L[i][1]], mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // facing: side views face right; mirror a video that faces left. Near side = lower average z.
  const L0 = list[0]; const ears = mid(P(L0, LM.l_ear), P(L0, LM.r_ear)); const facingLeft = kind !== 'front' && kind !== 'back' && P(L0, LM.nose)[0] < ears[0];
  const zl = list.reduce((a, L) => a + L[LM.l_sh][2] + L[LM.l_hip][2], 0), zr = list.reduce((a, L) => a + L[LM.r_sh][2] + L[LM.r_hip][2], 0);
  const near = kind === 'front' || kind === 'back' ? 'r' : zl < zr ? 'l' : 'r', far = near === 'l' ? 'r' : 'l';
  const map = { f: near, b: far };
  const seg = { upper_arm: ['sh', 'el'], lower_arm: ['el', 'wr'], hand: ['wr', 'ix'], thigh: ['hip', 'kn'], shin: ['kn', 'an'], foot: ['an', 'toe'] };
  const angle = (a, b) => Math.atan2(b[1] - a[1], (b[0] - a[0]) * (facingLeft ? -1 : 1)) * 180 / Math.PI;
  const rest = Object.fromEntries(sk.bones.map((b) => [b.name, b.angle]));
  const heightOf = (L) => Math.max(1, Math.max(L[LM.l_an][1], L[LM.r_an][1]) - P(L, LM.nose)[1]) * 1.12;
  const hip0 = mid(P(L0, LM.l_hip), P(L0, LM.r_hip)), H0 = heightOf(L0);
  const raw = list.map((L) => {
    const w = {}; const sh = mid(P(L, LM.l_sh), P(L, LM.r_sh)), hp = mid(P(L, LM.l_hip), P(L, LM.r_hip)), ea = mid(P(L, LM.l_ear), P(L, LM.r_ear));
    w.torso = angle(hp, sh); w.head = angle(sh, [ea[0] + (ea[0] - sh[0]) * 0.2, ea[1] + (ea[1] - sh[1]) * 0.2]);
    for (const [s, side] of Object.entries(map)) for (const [b, [a, c]] of Object.entries(seg)) w[`${b}_${s}`] = angle(P(L, LM[`${side}_${a}`]), P(L, LM[`${side}_${c}`]));
    const d = {}; for (const b of Object.keys(w)) d[b] = wrap(w[b] - rest[b]);
    const bones = {}; for (const b of sk.bones) { if (!(b.name in d)) continue; const par = b.parent && b.parent !== 'hips' && b.parent !== 'root' ? d[b.parent] ?? 0 : 0; bones[b.name] = { r: Math.round(wrap(d[b.name] - par) * 10) / 10 }; }
    const root = { y: (hp[1] - hip0[1]) / H0 }; if (!inPlace) root.x = ((hp[0] - hip0[0]) * (facingLeft ? -1 : 1)) / H0;
    return { root, bones };
  });
  // smooth (1-2-1) and resample to the frame count
  const sm = raw.map((p, i) => lerpPose(lerpPose(raw[Math.max(0, i - 1)], raw[Math.min(raw.length - 1, i + 1)], 0.5), p, 0.5));
  const n = frames || Math.min(24, sm.length); const keys = [];
  for (let f = 0; f < n; f++) { const x = loop ? (f / n) * sm.length : n > 1 ? (f / (n - 1)) * (sm.length - 1) : 0; const i = Math.floor(x), u = x - i; keys.push({ f, pose: lerpPose(sm[Math.min(sm.length - 1, i)], sm[Math.min(sm.length - 1, i + 1)], u) }); }
  return { keys, facingLeft, near, source_frames: list.length };
}

module.exports = { VIEWS, DIRS, directions, MOTIONS, motionPose, poseAt, lerpPose, addPose, scalePose, viewParts, viewRig, renderAnim, flipX, prepPicture, buildView, blankCharacter, retarget, kf };

// Dither — the character service shared by the window (IPC) and Claude (plugin tools): make a character from a
// picture, find joints (pose model, then the silhouette), cut parts, add views/directions, animate (library motions,
// keyed poses, motion from video), skins and attachments, previews and exports.
'use strict';
const fs = require('fs');
const path = require('path');
const SP = require('./core/sprite');
const RG = require('./core/rig');
const CH = require('./core/character');
const CX = require('./core/charexport');
const C2S = require('./core/clip2sprite');

function makeCharacters(ctx) {
  // ctx: { active(), decodeImage(file), poses(frames, opts), frames(bytes, mime, opts), animate, changed(kind, id) }
  const P = () => ctx.active(); const get = (id) => P().getSprite(id);
  const save = (c) => { const r = P().saveCharacter(c); ctx.changed('character', r.id); return r; };

  function imageFrom(src = {}) {
    if (src.sprite) { const s = get(src.sprite); return { w: s.w, h: s.h, data: SP.compose(s, src.frame || 0) }; }
    if (src.file) return ctx.decodeImage(src.file);
    if (src.image) return src.image;
    if (src.clip) { const frames = P().clipFrames(src.clip); const f = frames[Math.max(0, Math.min(frames.length - 1, src.frame || 0))]; return C2S.key(f); }
    throw new Error('Give the picture: a sprite, a file or a clip frame');
  }
  // joints: try the pose model on a blown-up copy over white, keep it if it's confident and lands on the figure
  async function findJoints(img, view, { model = true } = {}) {
    const sil = RG.guessJoints(img, view); if (!model || !ctx.poses) return sil;
    try {
      const k = Math.max(1, Math.floor(512 / Math.max(img.w, img.h))), W = img.w * k, H = img.h * k, pad = Math.round(Math.max(W, H) * 0.15), BW = W + pad * 2, BH = H + pad * 2, d = new Uint8ClampedArray(BW * BH * 4).fill(255);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const si = (Math.floor(y / k) * img.w + Math.floor(x / k)) * 4, a = img.data[si + 3] / 255, di = ((y + pad) * BW + x + pad) * 4; d[di] = img.data[si] * a + 255 * (1 - a); d[di + 1] = img.data[si + 1] * a + 255 * (1 - a); d[di + 2] = img.data[si + 2] * a + 255 * (1 - a); }
      const [L] = await ctx.poses([{ w: BW, h: BH, data: d }]); if (!L) return { ...sil, notes: [...sil.notes, 'the pose model found no person; joints from the silhouette'] };
      const back = L.map((p) => [(p[0] - pad) / k, (p[1] - pad) / k, p[2], p[3]]); const m = RG.jointsFromLandmarks(back, view, img);
      const bb = RG.bbox(img); const inside = Object.values(m.joints).filter(([x, y]) => x >= bb.x0 - 2 && x <= bb.x1 + 2 && y >= bb.y0 - 2 && y <= bb.y1 + 2).length / RG.JOINTS.length;
      if (m.confidence >= 0.55 && inside > 0.85) return { ...m, notes: [`joints from the pose model (confidence ${m.confidence})`] };
      return { ...sil, notes: [...sil.notes, `the pose model wasn’t sure (confidence ${m.confidence}); joints from the silhouette`] };
    } catch (e) { return { ...sil, notes: [...sil.notes, `pose model unavailable (${e.message}); joints from the silhouette`] }; }
  }
  async function makeView(c, view, img, { joints, backLimbs, model, robe: o2robe } = {}) {
    let J = joints, notes = [];
    let robe = o2robe; if (!J) { const r = await findJoints(img, view, { model }); J = r.joints; notes = r.notes; if (robe === undefined) robe = !!r.robe; }
    const old = c.views[view]; const b = CH.buildView({ name: `${c.name} · ${view}`, img, joints: J, view, backLimbs });
    if (old) { try { const prev = get(old.sprite); b.sprite.id = prev.id; b.sprite.name = prev.name; for (const f of prev.frames.slice(1)) b.sprite.frames.push(f); for (const l of b.sprite.layers) { const pl = prev.layers.find((x) => x.name === l.name); if (!pl) continue; for (const f of prev.frames.slice(1)) { const cel = SP.getCel(prev, pl.id, f.id); if (cel) SP.setCel(b.sprite, l.id, f.id, cel); } } b.sprite.tags = prev.tags; } catch {} }
    P().saveSprite(b.sprite); ctx.changed('sprite', b.sprite.id);
    c.views[view] = { sprite: b.sprite.id, joints: J, backLimbs: backLimbs || 'auto', robe: robe ?? (old && old.robe) ?? false, source: img.w + '×' + img.h };
    fs.mkdirSync(P().p('characters', 'sources'), { recursive: true }); fs.writeFileSync(P().p('characters', 'sources', `${b.sprite.id}.png`), require('./core/png').encode(img));
    return { notes: [...notes, ...b.notes], copied: b.copied };
  }
  // a photo or busy picture (no transparency): cut the person out with the pose model's mask; flat backgrounds are keyed instead
  async function cutOut(raw) {
    let transparent = 0; for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] < 128) transparent++; if (transparent > raw.data.length / 4 / 50 || !ctx.poses) return raw;
    const C2S2 = require('./core/clip2sprite'); const kc = C2S2.keyColor(raw); let flat = 0, n = 0; for (let y = 0; y < raw.h; y += 4) for (const x of [0, raw.w - 1]) { const i = (y * raw.w + x) * 4; n++; if (Math.abs(raw.data[i] - kc[0]) + Math.abs(raw.data[i + 1] - kc[1]) + Math.abs(raw.data[i + 2] - kc[2]) < 40) flat++; } if (flat / n > 0.85) return raw;   // a plain backdrop: the keyer does it better
    try { const r = await ctx.poses([raw], { mask: true }); const m = r.masks && r.masks[0]; if (!m || !r.poses[0]) return raw; const o = new Uint8ClampedArray(raw.data); for (let y = 0; y < raw.h; y++) for (let x = 0; x < raw.w; x++) { const v = m.data[Math.min(m.h - 1, Math.floor(y * m.h / raw.h)) * m.w + Math.min(m.w - 1, Math.floor(x * m.w / raw.w))]; o[(y * raw.w + x) * 4 + 3] = v > 127 ? 255 : 0; } return { w: raw.w, h: raw.h, data: o, cutout: true }; } catch { return raw; }
  }
  async function create({ name, source, view = 'side', pixel = true, height, directions = 1, model = true, by = 'you' } = {}) {
    const img = CH.prepPicture(await cutOut(imageFrom(source)), { pixel, height });
    const c = CH.blankCharacter({ name: name || 'Character', pixel, directions }); c.by = by;
    const r = await makeView(c, view, img, { model }); const saved = save(c);
    return { character: saved, notes: r.notes };
  }
  function sourceOf(c, view) { const v = c.views[view]; const f = P().p('characters', 'sources', `${v.sprite}.png`); if (fs.existsSync(f)) { const png = require('./core/png'); return png.decode(fs.readFileSync(f)); } const s = get(v.sprite); return { w: s.w, h: s.h, data: SP.compose(s, 0) }; }
  async function setJoints(id, view, joints, { recut = true, backLimbs, robe } = {}) {
    const c = P().getCharacter(id); const v = c.views[view]; if (!v) throw new Error(`No ${view} view`);
    const J = { ...v.joints }; for (const [k, p] of Object.entries(joints || {})) { if (!RG.JOINTS.includes(k)) throw new Error(`Unknown joint “${k}”. Joints: ${RG.JOINTS.join(', ')}`); J[k] = [+p[0], +p[1]]; }
    let notes = []; if (recut) { const r = await makeView(c, view, sourceOf(c, view), { joints: J, backLimbs: backLimbs || v.backLimbs, robe: robe ?? v.robe }); notes = r.notes; } else { v.joints = J; if (robe !== undefined) v.robe = robe; }
    save(c); return { character: c, notes };
  }
  async function addView(id, view, src = {}, o = {}) {
    if (!CH.VIEWS.includes(view)) throw new Error(`view: ${CH.VIEWS.join(', ')}`); const c = P().getCharacter(id);
    let img;
    if (src.mirrorOf) { const s = sourceOf(c, src.mirrorOf); img = CH.flipX(s); }
    else { const raw = await cutOut(imageFrom(src)); const ref = Object.values(c.views)[0]; const refH = ref ? RG.figureHeight(ref.joints) : 0; img = CH.prepPicture(raw, { pixel: c.pixel !== false, height: o.height || (refH ? Math.round(refH + 2) : undefined) }); }
    const r = await makeView(c, view, img, { model: o.model, backLimbs: o.backLimbs });
    if (o.directions) c.directions = o.directions; else if ((view === 'front' || view === 'back') && c.directions < 4) c.directions = 4; else if ((view === 'front34' || view === 'back34') && c.directions < 8) c.directions = 8;
    save(c); return { character: c, notes: r.notes };
  }
  // a turnaround clip from the character's picture (Animate), then views picked from its frames
  async function turnaround(id, { engine } = {}) { const c = P().getCharacter(id); const view = c.views.side ? 'side' : Object.keys(c.views)[0]; const s = get(c.views[view].sprite); return ctx.animate.generate({ source: { sprite: s.id }, preset: 'turnaround', engine, name: `${c.name} turnaround`, by: 'Dither' }); }
  // which frame of a turnaround shows which view: body angle from the pose model's shoulders (x spread + depth),
  // facing from the nose; without the model, silhouette widths and the order of the turn
  async function autoPick(clip) {
    const frames = P().clipFrames(clip); if (!frames || !frames.length) throw new Error('That clip has no frames');
    const imgs = frames.map((f) => C2S.key(f)), n = imgs.length, notes = [];
    const TARGET = { front: 0, front34: 45, side: 90, back34: 135, back: 180 };
    let est = null;
    if (ctx.poses) {
      try {
        const Ls = await ctx.poses(imgs.map((im) => { const d = new Uint8ClampedArray(im.w * im.h * 4); for (let i = 0; i < d.length; i += 4) { const a = im.data[i + 3] / 255; d[i] = im.data[i] * a + 255 * (1 - a); d[i + 1] = im.data[i + 1] * a + 255 * (1 - a); d[i + 2] = im.data[i + 2] * a + 255 * (1 - a); d[i + 3] = 255; } return { w: im.w, h: im.h, data: d }; }));
        est = Ls.map((L) => {
          if (!L) return null; const sh = [(L[11][0] + L[12][0]) / 2, (L[11][1] + L[12][1]) / 2], hp = [(L[23][0] + L[24][0]) / 2, (L[23][1] + L[24][1]) / 2], torso = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]) || 1;
          const dx = ((L[11][0] - L[12][0]) + (L[23][0] - L[24][0]) * 0.6) / torso;   // the person's left is screen-right when they face us
          const nose = L[0], face = nose[0] > sh[0] ? 1 : -1, ok = Math.min(L[11][3] ?? 1, L[12][3] ?? 1);
          const faceVis = [0, 1, 2, 3, 4, 5, 6, 9, 10].reduce((a, i) => a + (L[i][3] ?? 1), 0) / 9; return { dx, face, ok, faceVis };
        });
        // the shoulder/hip spread shrinks with cos(angle): the widest frame of the turn is straight on (the model's depth is too noisy to use)
        const top = Math.max(...est.filter(Boolean).map((e) => Math.abs(e.dx))) || 1;
        est.forEach((e) => { if (!e) return; const a = Math.acos(Math.min(1, Math.abs(e.dx) / top)) * 180 / Math.PI; e.ang = e.dx >= 0 ? a : 180 - a; });
        if (est.filter(Boolean).length < Math.max(3, n * 0.4)) { est = null; notes.push('the pose model lost the figure in most frames; picked by silhouette width'); }
      } catch (e) { est = null; notes.push(`pose model unavailable (${e.message}); picked by silhouette width`); }
    }
    const picks = {};
    if (est) {
      for (const [v, t] of Object.entries(TARGET)) {
        let best = -1, bs = Infinity;
        est.forEach((e, i) => { if (!e) return; let s = Math.abs(e.ang - t) + (1 - e.ok) * 20; if (v !== 'front' && v !== 'back' && e.face < 0) s += 35; if (s < bs) { bs = s; best = i; } });
        if (best >= 0 && bs < 40) picks[v] = best;
      }
      // the model often reads a back as a mirrored front: if the two widest frames half a turn apart read the same way,
      // the one with the clearer face is the front, the other the back, and the back three-quarter sits between side and back
      const idx = est.map((e, i) => (e ? i : -1)).filter((i) => i >= 0), circ = (a, b) => Math.min(Math.abs(a - b), n - Math.abs(a - b));
      const A = idx.reduce((m, i) => (Math.abs(est[i].dx) > Math.abs(est[m].dx) ? i : m), idx[0]);
      const far = idx.filter((i) => circ(i, A) >= n / 4), B = far.length ? far.reduce((m, i) => (Math.abs(est[i].dx) > Math.abs(est[m].dx) ? i : m), far[0]) : -1;
      if (B >= 0 && Math.abs(est[B].dx) > 0.6 * Math.abs(est[A].dx) && Math.sign(est[A].dx) === Math.sign(est[B].dx) && idx.some((i) => Math.abs(est[i].dx) < 0.45 * Math.abs(est[A].dx))) {
        const faceScore = (i) => est[i].faceVis; const [F, Bk] = faceScore(A) >= faceScore(B) ? [A, B] : [B, A];
        picks.front = F; picks.back = Bk;
        notes.push('front and back looked alike to the pose model; the clearer face was taken as the front');
      }
      // three-quarter views sit on the turn between front/back and the side: keep them on that stretch of the clip
      const arc = (a, b) => { const f = (b - a + n) % n, r = (a - b + n) % n, out = []; if (f <= r) for (let k = 1; k < f; k++) out.push((a + k) % n); else for (let k = 1; k < r; k++) out.push((a - k + n) % n); return out; };
      for (const [v, end, t] of [['front34', 'front', 45], ['back34', 'back', 135]]) {
        if (picks.side === undefined || picks[end] === undefined) { delete picks[v]; continue; } const on = arc(picks[end], picks.side); if (!on.length) { delete picks[v]; continue; }
        const scored = on.filter((i) => est[i]); picks[v] = scored.length && !notes.length ? scored.reduce((m, i) => (Math.abs(est[i].ang - t) < Math.abs(est[m].ang - t) ? i : m), scored[0]) : on[Math.floor(on.length / 2)];
      }
      notes.push('picked from the body angle the pose model sees — check them before making the views');
    } else {
      const wid = imgs.map((im) => { const b = RG.bbox(im); return b ? b.x1 - b.x0 : 0; });
      const order = wid.map((w, i) => i).sort((a, b) => wid[b] - wid[a]);
      const f1 = order[0], f2 = order.find((i) => Math.min(Math.abs(i - f1), n - Math.abs(i - f1)) >= n / 4);
      const [a, b] = [f1, f2 ?? (f1 + Math.floor(n / 2)) % n].sort((x, y) => x - y);
      picks.front = a; picks.back = b; picks.side = a > 0 ? wid.slice(0, a).indexOf(Math.min(...wid.slice(0, a))) : 0;
      if (a - picks.side > 1) picks.front34 = Math.round((a + picks.side) / 2);
      if (b - a > 1) picks.back34 = Math.round((a + b) / 2);
      notes.push('picked by silhouette width and the order of the turn (front and back can be swapped) — check them');
    }
    return { clip, frames: n, picks, notes };
  }
  async function viewsFromClip(id, clip, picks) { const out = []; for (const [view, frame] of Object.entries(picks || {})) { if (frame === null || frame === undefined) continue; const r = await addView(id, view, { clip, frame }); out.push(...r.notes.map((n) => `${view}: ${n}`)); } return { character: P().getCharacter(id), notes: out }; }

  // animations
  function animation(id, op = {}) {
    const c = P().getCharacter(id); c.animations ||= []; const find = (n) => c.animations.find((a) => a.id === n || a.name === n);
    const { action = 'add' } = op;
    if (action === 'add') { const m = op.motion ? CH.MOTIONS[op.motion] : null; if (op.motion && !m) throw new Error(`Motions: ${Object.keys(CH.MOTIONS).join(', ')}`); const name = op.name || op.motion || 'custom'; if (find(name)) throw new Error(`There’s already an animation called “${name}”`); c.animations.push({ id: SP.uid('an'), name, motion: op.motion || null, amp: op.amp ?? 1, frames: op.frames || (m ? m.frames : 8), fps: op.fps || (m ? m.fps : 10), loop: op.loop ?? (m ? m.loop : true), events: op.events || (m && m.events) || [], keys: {} }); }
    else {
      const a = find(op.anim || op.name); if (!a) throw new Error(`No animation “${op.anim || op.name}”. It has: ${c.animations.map((x) => x.name).join(', ')}`);
      if (action === 'update') { for (const k of ['name', 'motion', 'amp', 'frames', 'fps', 'loop', 'events', 'add']) if (op[k] !== undefined) a[k] = op[k]; }
      else if (action === 'remove') c.animations = c.animations.filter((x) => x !== a);
      else if (action === 'pose') { // key one frame: merge bone rotations into that frame's key for a view
        const view = op.view || Object.keys(c.views)[0]; a.keys ||= {}; const ks = (a.keys[view] ||= []); let k = ks.find((x) => x.f === op.frame); if (!k) { k = { f: op.frame || 0, pose: { root: {}, bones: {} } }; ks.push(k); }
        for (const [b, v] of Object.entries(op.pose?.bones || {})) k.pose.bones[b] = { ...(k.pose.bones[b] || {}), ...v }; Object.assign(k.pose.root, op.pose?.root || {});
      }
      else if (action === 'clear_keys') { if (op.view) delete a.keys?.[op.view]; else a.keys = {}; }
      else if (action === 'bake') { const view = op.view || Object.keys(c.views)[0]; a.keys ||= {}; a.keys[view] = Array.from({ length: a.frames }, (_, f) => ({ f, pose: CH.poseAt(a, f, view, c.views[view]) })); a.motion = null; }
      else throw new Error('action: add, update, remove, pose, clear_keys, bake');
    }
    save(c); return c;
  }
  async function fromVideo(id, { clip, file, name, view, frames, loop = true, start, end, inPlace = true } = {}) {
    const c = P().getCharacter(id); view = view || (c.views.side ? 'side' : Object.keys(c.views)[0]);
    let raw, fps = 24; if (clip) { raw = P().clipFrames(clip); fps = P().getClip(clip).fps; } else if (file) { const ext = path.extname(file).toLowerCase(); const ex = await ctx.frames(fs.readFileSync(file), { '.gif': 'image/gif', '.webm': 'video/webm' }[ext] || 'video/mp4', { fps: 24, maxFrames: 144, maxSize: 512 }); raw = ex.frames; fps = ex.fps; } else throw new Error('Give a clip (from Animate) or a video file');
    // on green screen clips the person is keyed out; the pose model wants a normal picture, so keep the original frames
    const L = await ctx.poses(raw, { video: true, fps }); const found = L.filter(Boolean).length; if (!found) throw new Error('No person was found in that video. Pose detection needs a clear, full-body person (real footage works best).');
    const sk = RG.skeleton(c.views[view].joints, view); const r = CH.retarget(L, sk, { view, frames, loop, start, end, inPlace });
    const nm = name || `${clip ? P().getClip(clip).name : path.basename(file || 'video', path.extname(file || ''))}`;
    let a = c.animations.find((x) => x.name === nm); if (!a) { a = { id: SP.uid('an'), name: nm, motion: null, frames: r.keys.length, fps: Math.max(6, Math.min(24, Math.round((r.keys.length / Math.max(1, r.source_frames)) * fps))), loop, events: [], keys: {} }; c.animations.push(a); }
    a.keys ||= {}; a.keys[view] = r.keys; a.frames = r.keys.length; a.from = { clip, file: file && path.basename(file), detected: `${found}/${L.length} frames` };
    save(c); return { character: c, anim: a, detected: found, of: L.length, facingLeft: r.facingLeft };
  }
  // skins (frames of every view's parts sprite) and attachments
  function skin(id, op = {}) {
    const c = P().getCharacter(id); c.skins ||= [{ name: 'Default', frame: 0 }]; c.attachments ||= [];
    const { action } = op;
    if (action === 'add') { if (c.skins.some((k) => k.name === op.name)) throw new Error('A skin with that name exists'); let frame = 0; for (const v of Object.values(c.views)) { const s = get(v.sprite); SP.addFrame(s); frame = s.frames.length - 1; s.tags = [...(s.tags || []), { name: op.name, from: frame, to: frame, direction: 'forward' }]; P().saveSprite(s); ctx.changed('sprite', s.id); } c.skins.push({ name: op.name, frame, recolor: op.recolor || null }); if (op.use !== false) c.skin = op.name; }
    else if (action === 'use') { if (!c.skins.some((k) => k.name === op.name)) throw new Error(`Skins: ${c.skins.map((k) => k.name).join(', ')}`); c.skin = op.name; }
    else if (action === 'recolor') { const k = c.skins.find((x) => x.name === (op.name || c.skin)); if (!k) throw new Error('No such skin'); k.recolor = { ...(k.recolor || {}), ...(op.recolor || {}) }; }
    else if (action === 'remove') { c.skins = c.skins.filter((k) => k.name !== op.name || k.frame === 0); if (c.skin === op.name) c.skin = 'Default'; }
    else if (action === 'attach') { if (!op.sprite || !op.bone) throw new Error('attach needs sprite and bone (e.g. hand_f)'); c.attachments.push({ id: SP.uid('at'), name: op.label || get(op.sprite).name, bone: op.bone, sprite: op.sprite, frame: op.frame || 0, x: op.x || 0, y: op.y || 0, rot: op.rot || 0, px: op.px, py: op.py, z: op.z || 'front', skin: op.skin || null, views: op.views || null }); }
    else if (action === 'update_attachment') { const a = c.attachments.find((x) => x.id === op.id || x.name === op.label); if (!a) throw new Error('No such attachment'); for (const k of ['bone', 'x', 'y', 'rot', 'px', 'py', 'z', 'skin', 'views', 'frame']) if (op[k] !== undefined) a[k] = op[k]; }
    else if (action === 'detach') c.attachments = c.attachments.filter((x) => x.id !== op.id && x.name !== op.label);
    else throw new Error('action: add, use, recolor, remove, attach, update_attachment, detach');
    save(c); return c;
  }
  // previews
  function preview(id, { anim, dir, view, frames } = {}) {
    const c = P().getCharacter(id); const ds = CH.directions(c); const d = dir ? ds.find((x) => x.dir === dir) : view ? { dir: view, view, mirror: false } : ds.find((x) => x.dir === 'right') || ds[0]; if (!d) throw new Error(`Directions: ${ds.map((x) => x.dir).join(', ')}`);
    const a = anim ? c.animations.find((x) => x.id === anim || x.name === anim) : null; const A = a || { name: 'rest', frames: 1, fps: 1, loop: false };
    const r = CH.renderAnim(get, c, frames ? { ...A, frames } : A, d.view, { mirror: d.mirror }); return { ...r, dir: d.dir, view: d.view, fallback: d.fallback, anim: A.name, rig: undefined };
  }
  // the picture with its joints and bones drawn on (for checking the rig)
  function rigPicture(id, view, scale = 6) {
    const c = P().getCharacter(id); view = view || Object.keys(c.views)[0]; const v = c.views[view]; const s = get(v.sprite); const img = { w: s.w, h: s.h, data: SP.compose(s, 0) }; const sk = RG.skeleton(v.joints, view);
    const W = s.w * scale, H = s.h * scale, d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const si = (Math.floor(y / scale) * s.w + Math.floor(x / scale)) * 4, di = (y * W + x) * 4; const a = img.data[si + 3]; const ck = ((x >> 3) + (y >> 3)) & 1 ? 38 : 30; d[di] = a ? img.data[si] * 0.55 + 20 : ck; d[di + 1] = a ? img.data[si + 1] * 0.55 + 20 : ck; d[di + 2] = a ? img.data[si + 2] * 0.55 + 30 : ck + 8; d[di + 3] = 255; }
    const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; d.set(c, (y * W + x) * 4); };
    const line = (a, b, c) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; put(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, c); put(a[0] + (b[0] - a[0]) * t + 1, a[1] + (b[1] - a[1]) * t, c); } };
    for (const b of sk.bones) { if (!b.parent || b.name === 'hips') continue; const col = /_f$/.test(b.name) ? [255, 111, 125, 255] : /_b$/.test(b.name) ? [93, 189, 255, 255] : [255, 205, 117, 255]; line([b.start[0] * scale, b.start[1] * scale], [b.end[0] * scale, b.end[1] * scale], col); }
    const FX = require('./core/fxruntime'); const g = new FX.Canvas(W, H, ['#000']); g.data.set(d);
    for (const [k, p] of Object.entries(v.joints)) { const x = p[0] * scale, y = p[1] * scale; g.fillCircle(x, y, 3, k.endsWith('_b') ? '#5dbdff' : k.endsWith('_f') ? '#ff6f7d' : '#ffcd75').ring(x, y, 3, 1, '#16141e'); }
    return { w: W, h: H, data: g.data, joints: v.joints };
  }
  function exportTo(id, dir, format = 'all', o = {}) {
    const c = P().getCharacter(id); fs.mkdirSync(dir, { recursive: true }); const files = [];
    if (format === 'sheets' || format === 'all') files.push(...CX.writeBaked(dir, get, c, o).files);
    if (format === 'spine' || format === 'all') files.push(...CX.writeRig(dir, get, c, 'spine'));
    if (format === 'godot' || format === 'all') files.push(...CX.writeRig(dir, get, c, 'godot'));
    return files;
  }
  return { create, findJoints, setJoints, addView, turnaround, autoPick, viewsFromClip, animation, fromVideo, skin, preview, rigPicture, exportTo, list: () => P().listCharacters(), get: (id) => P().getCharacter(id), save, remove: (id) => { P().removeCharacter(id); ctx.changed('character', id); return true; } };
}

module.exports = { makeCharacters };

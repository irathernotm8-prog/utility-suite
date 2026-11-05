// Dither — character exports. Baked sprite sheets (one per direction, one row per animation, every frame the same
// size with the feet at the same pivot) with hitboxes and attach points, a Godot 4 SpriteFrames resource, a Spine 4.1
// skeleton per view (bones, slots, region attachments, rotate/translate timelines, a packed atlas), and a Godot 4
// scene per view (Node2D bones with Sprite2D parts and an AnimationPlayer).
'use strict';
const fs = require('fs');
const path = require('path');
const png = require('./png');
const RG = require('./rig');
const CH = require('./character');
const EX = require('./exporters');

const base = (s) => String(s || 'character').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'character';
const snake = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'anim';
const r3 = (v) => Math.round(v * 1000) / 1000;

// ───────── baked sheets
function bake(getSprite, ch, { anims, dirs } = {}) {
  const list = (ch.animations || []).filter((a) => !anims || anims.includes(a.id) || anims.includes(a.name));
  const out = [];
  for (const d of CH.directions(ch).filter((x) => !dirs || dirs.includes(x.dir))) {
    const rig = CH.viewRig(getSprite, ch, d.view);
    const allPoses = list.flatMap((a) => Array.from({ length: a.frames }, (_, f) => CH.poseAt(a, f, d.view)));
    const box = RG.bounds(rig.sk, rig.prep, allPoses.length ? allPoses : [{}], 2);
    const rows = list.map((a) => {
      const r = CH.renderAnim(getSprite, ch, a, d.view, { mirror: d.mirror, frame: box, rig });
      const meta = r.frames.map((fr, i) => {
        let x0 = box.w, y0 = box.h, x1 = -1, y1 = -1; for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) if (fr[(y * box.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const pts = RG.points(rig.sk, r.poses[i]); const P = {}; for (const [k, v] of Object.entries(pts)) { const x = v[0] - box.x, y = v[1] - box.y; P[k] = [Math.round(d.mirror ? box.w - x : x), Math.round(y)]; }
        return { hitbox: x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1], points: P };
      });
      return { anim: a, frames: r.frames, meta };
    });
    const ground = rig.sk.ground, pivot = [Math.round((d.mirror ? box.x + box.w - rig.sk.bones[0].start[0] : rig.sk.bones[0].start[0] - box.x)), Math.round(ground - box.y)];
    out.push({ dir: d.dir, view: d.view, mirror: d.mirror, fallback: d.fallback, w: box.w, h: box.h, pivot, rows });
  }
  return out;
}
function sheetOf(b) {
  const cols = Math.max(1, ...b.rows.map((r) => r.frames.length)), W = cols * b.w, H = b.rows.length * b.h, data = new Uint8ClampedArray(W * H * 4);
  b.rows.forEach((r, ri) => r.frames.forEach((f, fi) => { for (let y = 0; y < b.h; y++) data.set(f.subarray(y * b.w * 4, (y + 1) * b.w * 4), ((ri * b.h + y) * W + fi * b.w) * 4); }));
  return { w: W, h: H, data, cols };
}
function writeBaked(dir, getSprite, ch, opts = {}) {
  const baked = bake(getSprite, ch, opts); const name = base(ch.name); const files = []; const meta = { character: ch.name, frame_pivot: 'feet (root) position inside each frame', directions: {} };
  const godot = []; let sub = 0; const subs = [];
  for (const b of baked) {
    const sh = sheetOf(b); const file = `${name} ${b.dir}.png`; fs.writeFileSync(path.join(dir, file), png.encode(sh)); files.push(path.join(dir, file));
    meta.directions[b.dir] = { image: file, frame: [b.w, b.h], pivot: b.pivot, view: b.view, mirrored: b.mirror, stand_in_view: b.fallback || undefined, animations: Object.fromEntries(b.rows.map((r, ri) => [r.anim.name, { row: ri, frames: r.frames.length, fps: r.anim.fps, loop: !!r.anim.loop, events: (r.anim.events || []).map((e) => ({ name: e.name, frame: Math.round(e.t * (r.frames.length - (r.anim.loop ? 0 : 1))) })), hitboxes: r.meta.map((m) => m.hitbox), points: r.meta.map((m) => m.points) }])) };
    const tex = `${godot.length + 1}_tex`; godot.push(`[ext_resource type="Texture2D" path="res://${opts.godotDir || `characters/${name}`}/${file}" id="${tex}"]`);
    b.rows.forEach((r, ri) => { const ids = r.frames.map((_, fi) => { const id = `AtlasTexture_${++sub}`; subs.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("${tex}")\nregion = Rect2(${fi * b.w}, ${ri * b.h}, ${b.w}, ${b.h})\n`); return id; }); godot.anims = godot.anims || []; godot.anims.push(`{\n"frames": [${ids.map((id) => `{\n"duration": 1.0,\n"texture": SubResource("${id}")\n}`).join(', ')}],\n"loop": ${r.anim.loop ? 'true' : 'false'},\n"name": &"${snake(r.anim.name)}_${b.dir}",\n"speed": ${r.anim.fps || 10}.0\n}`); });
  }
  const j = path.join(dir, `${name}.json`); fs.writeFileSync(j, JSON.stringify(meta, null, 1)); files.push(j);
  const tres = path.join(dir, `${name} frames.tres`);
  fs.writeFileSync(tres, `[gd_resource type="SpriteFrames" load_steps=${godot.length + subs.length + 1} format=3]\n\n${godot.filter((x) => typeof x === 'string').join('\n')}\n\n${subs.join('\n')}\n[resource]\nanimations = [${(godot.anims || []).join(', ')}]\n`); files.push(tres);
  if (opts.gifs !== false) for (const b of baked) for (const r of b.rows) { const g = path.join(dir, 'previews', `${name} ${r.anim.name} ${b.dir}.gif`); fs.mkdirSync(path.dirname(g), { recursive: true }); EX.writeGif(g, r.frames, b.w, b.h, { durations: r.frames.map(() => Math.round(1000 / (r.anim.fps || 10))), scale: 4, loop: true }); files.push(g); }
  return { files, baked };
}

// ───────── shared by Spine and Godot: each part cropped to its own picture, positioned relative to its bone
function partPieces(getSprite, ch, view) {
  const rig = CH.viewRig(getSprite, ch, view, { pixel: false }); const { w, h } = rig;
  return { rig, pieces: rig.prep.map((p, i) => ({ name: p.attachment ? `att_${p.attachment}` : p.bone + (rig.prep.findIndex((q) => q.bone === p.bone && !q.attachment) === i || p.attachment ? '' : `_${i}`), bone: p.bone, box: p.box, img: { w: p.cw, h: p.ch, data: p.big.data }, z: i })), w, h };
}
// a simple shelf packer
function pack(pieces, pad = 2) { const sorted = [...pieces].sort((a, b) => b.img.h - a.img.h); const W = Math.max(64, Math.min(2048, 2 ** Math.ceil(Math.log2(Math.sqrt(pieces.reduce((s, p) => s + (p.img.w + pad) * (p.img.h + pad), 0)) * 1.3)))); let x = pad, y = pad, row = 0; for (const p of sorted) { if (x + p.img.w + pad > W) { x = pad; y += row + pad; row = 0; } p.at = [x, y]; x += p.img.w + pad; row = Math.max(row, p.img.h); } const H = 2 ** Math.ceil(Math.log2(y + row + pad)); const data = new Uint8ClampedArray(W * H * 4); for (const p of pieces) for (let j = 0; j < p.img.h; j++) data.set(p.img.data.subarray(j * p.img.w * 4, (j + 1) * p.img.w * 4), ((p.at[1] + j) * W + p.at[0]) * 4); return { w: W, h: H, data }; }

// Spine 4.1 JSON. Spine is y-up and counter-clockwise; Dither is y-down and clockwise, so y and angles flip.
function spine(getSprite, ch, view, { atlasName } = {}) {
  const { rig, pieces } = partPieces(getSprite, ch, view); const sk = rig.sk; const root = sk.bones[0].start;
  const Y = (p) => [p[0] - root[0], -(p[1] - root[1])];
  const world = {}; for (const b of sk.bones) world[b.name] = { pos: Y(b.start), ang: b.name === 'root' || b.name === 'hips' ? 0 : -b.angle };
  const bones = sk.bones.map((b) => { const wb = world[b.name]; if (!b.parent) return { name: 'root' }; const pw = world[b.parent]; const dx = wb.pos[0] - pw.pos[0], dy = wb.pos[1] - pw.pos[1], a = -pw.ang * Math.PI / 180; return { name: b.name, parent: b.parent, length: r3(b.length), x: r3(dx * Math.cos(a) - dy * Math.sin(a)), y: r3(dx * Math.sin(a) + dy * Math.cos(a)), rotation: r3(wb.ang - pw.ang) }; });
  const slots = pieces.map((p) => ({ name: p.name, bone: p.bone, attachment: p.name }));
  const skin = { name: 'default', attachments: {} };
  for (const p of pieces) { const wb = world[p.bone]; const c = Y([(p.box.x0 + p.box.x1 + 1) / 2, (p.box.y0 + p.box.y1 + 1) / 2]); const dx = c[0] - wb.pos[0], dy = c[1] - wb.pos[1], a = -wb.ang * Math.PI / 180; skin.attachments[p.name] = { [p.name]: { x: r3(dx * Math.cos(a) - dy * Math.sin(a)), y: r3(dx * Math.sin(a) + dy * Math.cos(a)), rotation: r3(-wb.ang), width: p.img.w, height: p.img.h } }; }
  const H = sk.H; const animations = {};
  for (const a of ch.animations || []) {
    const n = Math.max(1, a.frames), dt = 1 / (a.fps || 10); const tl = {};
    for (let f = 0; f <= (a.loop ? n : n - 1); f++) {
      const pose = CH.poseAt(a, a.loop ? f % n : f, view), time = r3(f * dt);
      for (const b of sk.bones) { const p = b.name === 'root' ? pose.root || {} : (pose.bones || {})[b.name] || {}; const t = (tl[b.name] ||= { rotate: [], translate: [], scale: [] }); t.rotate.push({ time, value: r3(-(b.name === 'root' ? p.rot || 0 : p.r || 0)) }); t.translate.push({ time, x: r3((p.x || 0) * H), y: r3(-(p.y || 0) * H) }); if (b.name !== 'root') t.scale.push({ time, x: r3(p.sl ?? 1), y: r3(p.sw ?? 1) }); }
    }
    for (const [k, t] of Object.entries(tl)) { if (t.rotate.every((x) => !x.value)) delete t.rotate; if (t.translate.every((x) => !x.x && !x.y)) delete t.translate; if (!t.scale.length || t.scale.every((x) => x.x === 1 && x.y === 1)) delete t.scale; if (!Object.keys(t).length) delete tl[k]; }
    animations[a.name] = { bones: tl }; if (a.events && a.events.length) animations[a.name].events = a.events.map((e) => ({ time: r3(e.t * (n - (a.loop ? 0 : 1)) * dt), name: e.name }));
  }
  const events = {}; for (const a of ch.animations || []) for (const e of a.events || []) events[e.name] = {};
  const img = pack(pieces);
  const atlas = `${atlasName}.png\nsize:${img.w},${img.h}\nfilter:Nearest,Nearest\n${pieces.map((p) => `${p.name}\nbounds:${p.at[0]},${p.at[1]},${p.img.w},${p.img.h}`).join('\n')}\n`;
  return { json: { skeleton: { spine: '4.1.00', images: './', width: rig.w, height: rig.h }, bones, slots, skins: [skin], events, animations }, atlas, atlasImg: img };
}

// Godot 4 scene: Node2D per bone (no rest rotation: positions are rest offsets from the parent, so our local
// rotations map 1:1 onto Node2D.rotation), Sprite2D per part, AnimationPlayer with every animation.
function godotScene(getSprite, ch, view, { dir }) {
  const { rig, pieces } = partPieces(getSprite, ch, view); const sk = rig.sk; const name = base(ch.name);
  const ext = pieces.map((p, i) => `[ext_resource type="Texture2D" path="res://${dir}/parts ${view}/${p.name}.png" id="${i + 1}_p"]`);
  const pathOf = {}; const nodes = []; const by = Object.fromEntries(sk.bones.map((b) => [b.name, b]));
  for (const b of sk.bones) {
    const parentPath = b.parent ? pathOf[b.parent] : null; pathOf[b.name] = parentPath ? `${parentPath}/${b.name}` : b.name;
    const off = b.parent ? [b.start[0] - by[b.parent].start[0], b.start[1] - by[b.parent].start[1]] : [0, 0];
    nodes.push(`[node name="${b.name}" type="Node2D" parent="${parentPath ? parentPath : '.'}"]\nposition = Vector2(${r3(off[0])}, ${r3(off[1])})\n`);
  }
  pieces.forEach((p, i) => { nodes.push(`[node name="${p.name}" type="Sprite2D" parent="${pathOf[p.bone]}"]\nz_index = ${p.z}\ntexture = ExtResource("${i + 1}_p")\ncentered = false\noffset = Vector2(${r3(p.box.x0 - by[p.bone].start[0])}, ${r3(p.box.y0 - by[p.bone].start[1])})\n`); });
  const H = sk.H; const anims = [];
  (ch.animations || []).forEach((a, ai) => {
    const n = Math.max(1, a.frames), dt = 1 / (a.fps || 10), count = a.loop ? n + 1 : n; const times = Array.from({ length: count }, (_, f) => r3(f * dt)); const tracks = [];
    const poses = times.map((_, f) => CH.poseAt(a, a.loop ? f % n : f, view));
    for (const b of sk.bones) {
      const rot = poses.map((p) => (b.name === 'root' ? p.root?.rot || 0 : p.bones?.[b.name]?.r || 0) * Math.PI / 180);
      const off = b.parent ? [b.start[0] - by[b.parent].start[0], b.start[1] - by[b.parent].start[1]] : [0, 0];
      const posv = poses.map((p) => { const q = b.name === 'root' ? p.root || {} : p.bones?.[b.name] || {}; return [off[0] + (q.x || 0) * H, off[1] + (q.y || 0) * H]; });
      if (rot.some((v) => v)) tracks.push({ path: `${pathOf[b.name]}:rotation`, values: rot.map((v) => r3(v)) });
      if (posv.some((v, i) => v[0] !== off[0] || v[1] !== off[1])) tracks.push({ path: `${pathOf[b.name]}:position`, values: posv.map((v) => `Vector2(${r3(v[0])}, ${r3(v[1])})`) });
    }
    const id = `Animation_${ai + 1}`;
    anims.push({ id, name: snake(a.name), text: `[sub_resource type="Animation" id="${id}"]\nresource_name = "${snake(a.name)}"\nlength = ${r3((count - (a.loop ? 1 : 0)) * dt) || dt}\n${a.loop ? 'loop_mode = 1\n' : ''}step = ${r3(dt)}\n${tracks.map((t, k) => `tracks/${k}/type = "value"\ntracks/${k}/imported = false\ntracks/${k}/enabled = true\ntracks/${k}/path = NodePath("${t.path}")\ntracks/${k}/interp = 1\ntracks/${k}/loop_wrap = true\ntracks/${k}/keys = {\n"times": PackedFloat32Array(${times.join(', ')}),\n"transitions": PackedFloat32Array(${times.map(() => 1).join(', ')}),\n"update": 0,\n"values": [${t.values.join(', ')}]\n}`).join('\n')}\n` });
  });
  const lib = `[sub_resource type="AnimationLibrary" id="AnimationLibrary_1"]\n_data = {\n${anims.map((a) => `&"${a.name}": SubResource("${a.id}")`).join(',\n')}\n}\n`;
  const rootNode = `[node name="${name.replace(/[^A-Za-z0-9_ ]/g, '')}" type="Node2D"]\ntexture_filter = ${ch.pixel !== false ? 1 : 0}\n`;
  const ap = `[node name="AnimationPlayer" type="AnimationPlayer" parent="."]\nlibraries = {\n&"": SubResource("AnimationLibrary_1")\n}\n`;
  const scene = `[gd_scene load_steps=${ext.length + anims.length + 2} format=3]\n\n${ext.join('\n')}\n\n${anims.map((a) => a.text).join('\n')}\n${lib}\n${rootNode}\n${nodes.map((x) => x.replace(/parent="(?!\.)/, 'parent="')).join('\n')}\n${ap}`;
  return { scene, pieces };
}

function writeRig(dir, getSprite, ch, format) {
  const name = base(ch.name); const files = []; const views = Object.keys(ch.views);
  for (const v of views) {
    if (format === 'spine') { const an = `${name} ${v}`; const r = spine(getSprite, ch, v, { atlasName: an }); const j = path.join(dir, `${an}.json`); fs.writeFileSync(j, JSON.stringify(r.json, null, 1)); fs.writeFileSync(path.join(dir, `${an}.atlas`), r.atlas); fs.writeFileSync(path.join(dir, `${an}.png`), png.encode(r.atlasImg)); files.push(j, path.join(dir, `${an}.atlas`), path.join(dir, `${an}.png`)); }
    else { const gdir = `characters/${name}`; const r = godotScene(getSprite, ch, v, { dir: gdir }); const pd = path.join(dir, `parts ${v}`); fs.mkdirSync(pd, { recursive: true }); for (const p of r.pieces) { const f = path.join(pd, `${p.name}.png`); fs.writeFileSync(f, png.encode(p.img)); } const f = path.join(dir, `${name} ${v}.tscn`); fs.writeFileSync(f, r.scene); files.push(f, pd); }
  }
  return files;
}

module.exports = { bake, sheetOf, writeBaked, spine, godotScene, writeRig, pack };

import * as spine from '@esotericsoftware/spine-core';
import fs from 'fs'; import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const D = new URL('../../', import.meta.url).pathname; const RG = require(D + 'src/core/rig'); const CH = require(D + 'src/core/character');
const { Library } = require(D + 'src/core/project');
const lib = new Library(new URL('./lib', import.meta.url).pathname); const p = lib.get(lib.list()[0].id); const ch = p.listCharacters()[0]; const c = p.getCharacter(ch.id);
for (const view of ['side', 'front']) {
  const atlas = new spine.TextureAtlas(fs.readFileSync(`out/Knight ${view}.atlas`, 'utf8'));
  for (const page of atlas.pages) page.setTexture({ setFilters() {}, setWraps() {}, getImage() { return { width: 1, height: 1 }; }, dispose() {} });
  const json = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)); const data = json.readSkeletonData(JSON.parse(fs.readFileSync(`out/Knight ${view}.json`, 'utf8')));
  const sk = new spine.Skeleton(data); sk.setToSetupPose(); sk.updateWorldTransform(spine.Physics ? spine.Physics.update : undefined);
  const v = c.views[view]; const rig = RG.skeleton(v.joints, view); const root = rig.bones[0].start;
  let worst = 0, worstAt = '';
  const check = (pose, label) => { const S = RG.solve(rig, pose); for (const b of rig.bones) { const sb = sk.findBone(b.name); const want = RG.ap(S[b.name].M, b.start); const got = [sb.worldX + root[0], -sb.worldY + root[1]]; const d = Math.hypot(want[0] - got[0], want[1] - got[1]); if (d > worst) { worst = d; worstAt = `${label} ${b.name} want ${want.map((x) => x.toFixed(1))} got ${got.map((x) => x.toFixed(1))}`; } } };
  check({}, 'setup');
  for (const a of c.animations) { const anim = data.findAnimation(a.name); if (!anim) { console.log('MISSING anim', a.name); continue; }
    for (const f of [0, 2, Math.floor(a.frames / 2)]) { sk.setToSetupPose(); anim.apply(sk, 0, f / a.fps, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn); sk.updateWorldTransform(spine.Physics ? spine.Physics.update : undefined); check(CH.poseAt(a, f, view), `${a.name}@${f}`); } }
  console.log(view, 'bones', data.bones.length, 'slots', data.slots.length, 'anims', data.animations.length, 'worst bone error px', worst.toFixed(2), worstAt);
  // attachments resolve
  const miss = data.slots.filter((s) => !sk.getAttachmentByName(s.name, s.attachmentName)); console.log(view, 'attachments missing:', miss.length);
}

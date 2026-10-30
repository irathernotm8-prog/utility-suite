// Dither — what Claude and Codex read: the short instructions sent when the plugin connects, and the full guide
// (dither_guide) with the effect contract, the drawing kit, sprite ops and the way of working.
'use strict';
const FX = require('./fxruntime');
const { OPS } = require('./sprite');

const { INSTRUCTIONS } = require('../../mcp/guide-instructions');

function guideText() {
  const pals = Object.entries(FX.PALETTES).map(([k, v]) => `${k} (${v.length}): ${v.join(' ')}`).join('\n');
  const ramps = Object.entries(FX.RAMPS).map(([k, v]) => `${k}: ${v.join(' ')}`).join('\n');
  return `# Dither guide

## Pixel-art rules Dither expects
- Work at the real resolution (e.g. 16–64 px for effects and characters). Never draw big and scale down.
- Limited palette: pick a built-in palette or pass your own 4–32 hex colours. Shade with palette steps, not blends.
- No anti-aliasing and no blur. Fake transparency and glow with ordered dithering (ditherPx, dither, glow, ditherCircle).
- Clean lines: avoid jaggies and doubles on curves; single-pixel orphans read as noise unless they're sparks.
- Readable silhouette at 1×. Strong value contrast between the core and the edge of an effect.
- Motion: anticipation → impact (hold the impact frame with "holds") → follow-through and dissipation. Ease out of explosions, ease in to collapses. Smear frames for fast motion. Loops must meet seamlessly (use t, which runs 0…1 and wraps, with sin/cos(t*TAU)).
- Fade by stepping colours down the ramp, shrinking and dithering out — not by alpha.

## Effects: the contract
An effect is JavaScript that calls effect({...}) exactly once. It runs in a sandbox with no network, files or DOM; Math is available.

effect({
  name: 'Ember burst',
  size: [48, 48],            // canvas in pixels (max 512×512)
  frames: 16,                // 1–240
  fps: 12,                   // base timing
  holds: [1, 2, 1, ...],     // optional: per-frame multiples of 1/fps (hold an impact frame); or durations: [ms, ...]
  palette: 'ember',          // a built-in name or an array of hex strings; colour numbers in draw calls are palette slots
  loop: true,                // loops: t wraps (frame n meets frame 0); one-shots: t reaches 1 on the last frame
  seed: 7,                   // randomness is seeded, so renders are repeatable
  persist: false,            // true = the canvas is NOT cleared between frames (trails, accumulation)
  background: '#0b1626',     // optional preview backdrop (not baked into exports)
  params: { count: { value: 12, min: 4, max: 30, step: 1 }, speed: 1.5 },   // sliders in the app; read params.count
  setup(ctx) { return { /* state built once, e.g. particles */ }; },        // optional
  draw(g, ctx) { /* draw one frame onto g */ },
})

ctx (in setup and draw): f (frame index), t (0…1), n (frame count), w, h, cx, cy (centre), time (seconds), state, params,
rand() (seeded 0…1), rnd(a,b), irnd(a,b) (integer, inclusive), pick(arr), chance(p), noise(x,y,z) (smooth value noise 0…1),
ease.{linear,inQuad,outQuad,inOutQuad,inCubic,outCubic,inOutCubic,outQuart,inExpo,outExpo,inBack,outBack,outElastic,outBounce},
lerp(a,b,t), clamp(v,a,b), smooth(a,b,v), range(t,a,b) (0…1 progress of t through [a,b]), pingpong(t), TAU, PI, bayer(x,y), palette, ramps.

## The drawing kit (g)
Colours: a palette slot number, '#rrggbb', null (= erase). Coordinates are rounded to whole pixels.
g.clear(c?) · g.px(x,y,c) · g.get(x,y) → '#hex'|null · g.idx(x,y) → palette slot|-1 · g.filled(x,y)
g.line(x0,y0,x1,y1,c) · g.polyline(points,c,closed?) · g.rect(x,y,w,h,c) · g.fillRect(x,y,w,h,c)
g.circle(cx,cy,r,c) · g.fillCircle(cx,cy,r,c) · g.ring(cx,cy,r,thickness,c) · g.ellipse(cx,cy,rx,ry,c) · g.fillEllipse(cx,cy,rx,ry,c)
g.poly(points,c) (filled) · g.flood(x,y,c)
Dithering (0 = none … 1 = solid, 4×4 Bayer): g.ditherPx(x,y,c,level) · g.dither(x,y,w,h,c,level) · g.ditherCircle(cx,cy,r,c,level)
g.glow(cx,cy,r,[bright,…,dim],strength) — a dithered radial glow
g.text(str,x,y,c,scale) — 3×5 pixel font (A–Z 0–9 + - ! ? . , : % / x * = # ( )); g.textWidth(str,scale)
Post: g.outline(c,{corners}) · g.replace(from,to) · g.shift(dx,dy,wrap) · g.flip(horizontal,vertical)
g.symmetry(mirrorX, mirrorY) — mirror every following draw call · g.clip = [x,y,w,h] | null
g.blit(img,x,y,{flipX,flipY,scale,tint}) — draw another {w,h,data} (e.g. g.copy()) · g.ramp(nameOrArray, t) → colour

Built-in palettes:
${pals}

Ramps (bright → dark), for g.ramp(name, t):
${ramps}

Performance: every frame has a budget (the whole render must finish in a few seconds). Per-pixel loops over 64×64 × 24 frames are fine; nested particle × pixel loops over large canvases are not.

## Starter library
Call list_library / get_library_effect for working examples (explosion, slash, lightning, fire loop, heal, black hole, rain, pickup sparkle, hit impact). Start from one when it fits, then make it the user's own.

## Sprites
create_sprite makes a document (w×h, palette, frames). draw_sprite applies ops to a frame/layer and returns the result.
Ops (JSON objects with "op"): ${OPS.join(', ')}.
- pixels: { op:'pixels', x, y, rows:['..11..', '.1221.', ...], key?:{ '1':'#fff', 'k': 3 } } — each character is a palette slot in base 36 (0–9, a–z), '.' or ' ' skips, '_' erases. The most precise way to draw characters and icons.
- line {x1,y1,x2,y2,color} · rect {x,y,w,h,color,fill} · circle {x,y,r,color,fill,thickness} · ellipse {x,y,rx,ry,color,fill} · poly {points:[[x,y],…],color,fill}
- flood {x,y,color} · dither {x,y,w,h,color,level} · outline {color,corners} · replace {from,to} · shift {dx,dy,wrap} · flip {axis:'x'|'y'} · clear {x?,y?,w?,h?} · text {text,x,y,color,scale}
- Any op can carry "frame" (index from 0) and "layer" (id or name) to target another cel, and "mirror": 'x'|'y'|'both'.
edit_sprite handles frames (add, duplicate, delete, move, durations), layers, tags, palette and resize.
## Detailed sprites: work in passes
Placing thousands of pixels one by one gives flat, noisy art. Build detailed sprites the way pixel artists do, and look after every pass (each tool returns a picture):
1. Silhouette + flats — draw_svg. Write an SVG whose viewBox is the sprite's pixel size (viewBox="0 0 48 48" for a 48×48 sprite), one flat colour per material. Big shapes first, then features.
   Supported: rect (rx), circle, ellipse, line, polyline, polygon, path (M L H V C S Q T A Z, relative too), g with transform (translate, scale, rotate, matrix, skew), fill, stroke, stroke-width, opacity/fill-opacity (rendered as dithering), fill-rule, linearGradient/radialGradient (rendered as a few flat bands with dithered seams; data-steps on the gradient sets the band count, data-dither 0–1 the seam width).
   Pixel rules it follows: fills are sampled at pixel centres (no anti-aliasing), strokes of width ≤1.5 become pixel-perfect 1px lines (no doubled L corners), thicker strokes become solid shapes. Keep coordinates on whole or half pixels for crisp edges; a shape thinner than a pixel can vanish.
   Tag each shape: data-material="skin|cloth|leather|metal|gold|wood|stone|foliage|hair|gel|plastic|crystal|fur|flat" and data-form="soft|sphere|cylinder|cylinder-h|bevel|facet|flat|flat-up|flat-left|…". Details you want left alone (eyes, a visor slit, a logo) get no material.
2. Shading — shade_sprite. One light for the whole sprite (default top-left). Each material gets a hue-shifted ramp (shadows cool, highlights warm), form shadows from its shape, highlights on shiny materials, rim light, contact shadows where one shape sits over another, and a selective outline (darker where the form turns away, lighter on the lit side). Override per colour with { material, form, base, ramp: [dark…light], steps, hueShift }; set dither 0–1 for softer transitions (stone, fur, clouds).
   make_ramp gives you the same ramps for hand work or effects.
3. Critique — critique. Fix every major issue (jaggies, pillow shading, flat values) and most minor ones (stray pixels, doubled corners). Numbers match boxes on the picture.
4. Detail and cleanup — draw_sprite with pixels rows and px for eyes, highlights, texture clusters, buckles; get_sprite with as:'rows' reads exact pixels; view with region zooms into an area with a pixel grid.
5. Animate — duplicate the frame (edit_sprite) and move parts with shift/svg per frame, or draw key poses as SVG and shade_sprite with frames:'all' so lighting stays consistent.

## Animating characters with a video model (Animate)
For natural motion (walks, runs, attacks, idles with breathing), let a video model move the character, then bring it back to pixel art:
1. animate_status — which engine is ready (local Wan 2.2 in the user's ComfyUI, or cloud via their fal.ai key).
2. animate_character with a sprite (or a picture) and a preset (idle, walk, run, attack, cast, jump, hurt, death) or one short motion prompt. Keep it to ONE action, side view, in place. Dither places the character on a green screen and adds the guard: camera doesn't move, background stays, no new shadows, seamless loop for cycles.
   It takes minutes; if it returns "running", check list_clips later.
3. view kind:'clip' to look at the frames, then clip_to_sprite with keep:false to preview: height (sprite size), count (frames: 4–8 for walks, 2–4 for idles, 6–10 for attacks), colors, palette, align ('feet' for anything in place, 'x' for jumps).
4. Keep it (clip_to_sprite keep:true), then critique and fix with draw_sprite; shade_sprite can re-light it to match other sprites.
import_clip brings in any video or GIF the user has (3D renders, footage on green) the same way.
Sources that work best: a clear full-body character on a flat background, readable at the source size; video models smooth pixel art, so a bigger, cleaner source (or a generated illustration) animates better and Dither re-pixelizes the result.

Good sprite practice: block in the silhouette in one dark colour, then flats, then 2–3 shade steps per material with a consistent light direction (top-left by default), then a selective outline. Animate with key poses first, then in-betweens; keep volumes consistent between frames.

## Seeing your work
Every render returns a contact sheet (all frames, numbered, with held frames marked in ms). view lets you look again at any effect, sprite or reference, larger or at a single frame. The user sees the same thing animating in Dither.

## Feedback loop
get_feedback returns, per draft/effect: verdict (pick / maybe / no), stars (0–3), and notes (optionally tied to a frame). Open notes are the to-do list for your next update. After you address a note, mention it in update_effect's note so the user can see what changed.

## Output
record → GIF (scaled up), WebM video, contact sheet PNG in the project's records/ folder (for review and sharing).
export → sprite sheet PNG + Aseprite-style JSON (Phaser, Godot, Unity importers, PixiJS), single PNG frames, GIF, or a standalone JS module ("module") that pre-renders the effect at runtime and draws it to any canvas: import { createEffect } from './ember-burst.js'; const fx = createEffect(); fx.draw(ctx, x, y, frameIndex, scale).
bake_effect turns an effect's frames into an editable sprite for hand polish.
`;
}

module.exports = { INSTRUCTIONS, guideText };

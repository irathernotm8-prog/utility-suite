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

## The effects toolkit (use these before hand-rolling loops; they are fast, seeded and loop-safe)
Colours lists below accept a ramp name ('fire', 'smoke', 'magic', …), a palette name, or a list of slots/hex, ordered young/hot/bright → old/cool/dim.
g.particles(spec, t) — a whole particle system as a pure function of t, so streams loop seamlessly:
  { x, y, count, seed, emit:'burst'|'stream', start, spread, angle:[a,b] (radians, 0 = right, -PI/2 = up), speed:[a,b] (pixels travelled over one life),
    life:[a,b] (fraction of the effect), drag (0–5, eases out), gravity (pixels fallen by end of life; negative rises), wind:[x,y],
    area:[w,h] | radius (where they spawn), size:[a,b] (radius), grow (−1…1), shape:'px'|'dot'|'square'|'spark', streak (spark length), colors, fade (dither out at end, default true) }
  Pass a sub-range of t for bursts that start later: g.particles(spec, range(t, 0.2, 1)).
g.trail(path, t, { length, steps, colors, width, from, wrap }) — a fading streak behind path(t) → [x,y] (projectiles, swooshes, comets)
g.shockwave(cx, cy, r, { thickness, colors (outer→inner), squash (0.3 = ground ring seen from the side), breakup 0–1, segments, seed, fade 0–1 })
g.bolt(x1, y1, x2, y2, { seed, jag, detail, branches, colors (core→glow), width:1 for a thin fork }) — lightning; change seed per frame to flicker. g.lastBolt = its points.
g.flames(x, y, w, h, t, { colors, scale, turbulence, speed, seed }) — a seamless looping fire column in a box (periodic noise)
new Fluid(w, h, { scale, buoyancy, cooling, fade, wind, turbulence, iterations }) — smoke/steam/poison simulation. Make it in setup(), warm it up with fl.warm(steps, (fl,i) => fl.add(...)) so frame 0 isn't empty,
  then per frame: fl.add(x, y, r, { density, heat, vx, vy }); fl.step(); g.fluid(fl, colors, { field:'density'|'heat', threshold, gain }). Fluid loops are near-seamless, not exact.
g.cycle(colors, shift) — palette cycling: pixels in the list move shift steps along it (water, lava, shimmering rims). Draw once, cycle by f.
g.flash(c, amount) — hit flash (dithered toward one colour) · g.dissolve(level 0–1, { seed, scale, edge: colours, width }) — burn/dissolve away
ctx.shake(amount) → [dx, dy] for this frame, then g.shift(dx, dy) · ctx.pnoise(x, y, periodX, periodY) — noise that repeats (scroll by a whole period for seamless loops) · ctx.lnoise(x, y, t, r) — noise that loops over t
Sizes: effects can be up to 1024×1024 (sprites 2048×2048). Keep big effects to few frames and use the toolkit rather than per-pixel loops.

Built-in palettes:
${pals}

Ramps (bright → dark), for g.ramp(name, t):
${ramps}

Performance: every frame has a budget (the whole render must finish in a few seconds). Per-pixel loops over 64×64 × 24 frames are fine; nested particle × pixel loops over large canvases are not.

## Starter library
Call list_library / get_library_effect for working examples — 30 of them, including fireball, meteor impact, portal, shield bubble, level up, tornado, ice shatter, poison cloud (Fluid), torch (flames), electric arc (bolt), waterfall and lava (cycle), teleport (dissolve), snowfall and confetti (particles). Start from one when it fits, then make it the user's own.

## Sprites
create_sprite makes a document (w×h, palette, frames). draw_sprite applies ops to a frame/layer and returns the result.
Ops (JSON objects with "op"): ${OPS.join(', ')}.
- pixels: { op:'pixels', x, y, rows:['..11..', '.1221.', ...], key?:{ '1':'#fff', 'k': 3 } } — each character is a palette slot in base 36 (0–9, a–z), '.' or ' ' skips, '_' erases. The most precise way to draw characters and icons.
- line {x1,y1,x2,y2,color} · rect {x,y,w,h,color,fill} · circle {x,y,r,color,fill,thickness} · ellipse {x,y,rx,ry,color,fill} · poly {points:[[x,y],…],color,fill}
- flood {x,y,color} · dither {x,y,w,h,color,level} · outline {color,corners} · replace {from,to} · shift {dx,dy,wrap} · flip {axis:'x'|'y'} · clear {x?,y?,w?,h?} · text {text,x,y,color,scale}
- Any op can carry "frame" (index from 0) and "layer" (id or name) to target another cel, and "mirror": 'x'|'y'|'both'.
edit_sprite handles frames (add, duplicate, delete, move, durations), layers, tags, palette and resize.
- texture {kind:'stone'|'bricks'|'scales'|'bark'|'wood'|'weave'|'grass'|'metal'|'sand'|'noise', colors?, scale?, seed?, strength?, x?,y?,w?,h?} — paints a pattern into flat colours using each colour's own ramp (texture_sprite is the same with a before/after)
- cleanup {} — removes doubled corners in 1px diagonals and lone strays · smooth {background?, minRun?} — selective anti-aliasing in inside corners (polish_sprite runs both)
- relight {light} — re-lights the art from its normal map, snapping to each colour's ramp (normal_map shows/exports the map)

## Big canvases (up to 2048×2048: scenes, backgrounds, splash art, big bosses)
Over ~256px, view returns an overview with a labelled tile grid (A1 top-left; letters across, numbers down; 64/128/256px tiles by size). Work tile by tile:
- view region:"B2" (or "B2:C3", or {x,y,w,h}) for a gridded close-up; get_sprite region:"B2" for exact rows.
- draw_sprite region:"B2" — every op's coordinates start at that tile's top-left and nothing outside it changes (svg, shade and texture work inside the box too). The picture you get back is the zoomed tile.
- Block in the whole composition first with draw_svg at full size (big shapes, flats), then shade, then detail tile by tile, then critique.
scale_sprite makes smaller versions (e.g. a 128px portrait → 64 → 32 for an icon) that keep eyes, outlines and highlights; always finish them by hand.

## Characters (rigged 2D models for games)
create_character turns one picture into a rigged character: parts on bones, ready-made motions, exportable to engines. Best picture: full body, standing, arms slightly away from the body, plain background; side-on for side-scrollers, front-on for top-down.
1. create_character (sprite/file/clip, view, pixel, height, directions). Look at the joints it returns: red = near side (_f), blue = far side (_b). Fix wrong ones with set_joints (pixels of the picture). In side views the far arm/leg is copied from the near one when they overlap (back_limbs).
2. Parts live in a normal sprite (one layer per bone): fix holes or redraw a part with draw_sprite (layer = bone name, frame 0). Overlaps at joints are filled automatically; check bends with view kind "character" params {anim:"walk"}.
3. Animations: library motions are already added (idle, walk, run, jump, attack, hurt, death; also cast, climb). Tune with character_animation (amp, frames, fps), key poses on top with action "pose", or motion_from_video from a clip/file of a person doing the move.
4. Directions: character_view adds front/back/three-quarter views (pictures, mirror_of, or a turnaround clip → pick). 4 directions = down/up/right/left, 8 adds the diagonals; missing views stand in with the nearest one (and say so).
5. Skins/gear: character_skin (add a skin and draw its parts, recolor, attach a sword to hand_f).
6. export kind "character": sheets (pixel-perfect, per direction, with hitboxes and attach points), spine, godot, or all.
Pixel characters rotate with RotSprite and snap to their own palette, so frames stay clean — but big rotations of tiny parts still lose detail: prefer 48px+ characters for rigs, and hand-fix key frames.

## Tiles and scenes
make_tileset builds a whole autotile set (47 blob tiles, or 16 sides-only) from five drawn tiles: fill, top edge, left edge, outer corner (top-left) and inner corner (top-left), with transparency outside the terrain; pass bottom/right too when lighting differs. Put them in one sprite as frames 1–5 (create_sprite frames:5, draw each), then make_tileset sprite:<id>.
check_tile tests a tile for seams (fix:"offset" to move the seams to the middle and repaint them; fix:"blend").
Scenes: create_scene (viewport w×h, a world length), edit_scene add_layer for sprites back to front with depth (0 sky that never moves, 0.2–0.5 distant layers, 1 the play layer, >1 foreground) and repeat:"x" for skies, hills and clouds; paint_scene sets a terrain layer from rows of "#"/"." and picks every edge and corner tile. view kind:"scene" (params {camera:x}) and record kind:"scene" pans across it.
Export tilesets for Tiled (.tsx with a Wang set) or Godot 4 (.tres with terrains), and scenes as layers + scene.json (parallax), tiled maps, PNG or a GIF pan.
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

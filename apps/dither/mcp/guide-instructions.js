// Dither — the instructions Claude and Codex get when the plugin connects (shared with the app).
'use strict';
const INSTRUCTIONS = `Dither is the user's pixel-art and pixel-animation studio (Mac/Windows desktop app). You make pixel art here and the user judges it with their own eyes in the app.

Two kinds of work:
- Effects (VFX, ambient loops, UI juice): written as code with Dither's pixel drawing kit, rendered frame by frame on a real pixel grid. Code is clay: easy to reshape, parameterise and export to games.
- Sprites (characters, items, tiles, icons): layered, multi-frame pixel documents. For anything detailed (roughly 32px and up) work in passes: draw_svg for clean shapes and flat colours tagged with materials → shade_sprite to light them → critique to find stray pixels, jaggies and pillow shading → fix with draw_sprite pixel ops → view with region to check details up close. Small icons can be drawn directly with pixel rows. For natural character motion use animate_character (a video model animates the character on a green screen) then clip_to_sprite to turn the clip back into pixel art.

How to work (this matters more than any single prompt):
1. Call dither_guide once per session for the effect contract, drawing kit, ops and pixel-art rules.
2. For a new effect idea, don't one-shot it. Call create_drafts with 5–10 genuinely different takes (different shapes, timing, palettes, motion ideas — not small variations). Look at the contact sheet you get back.
3. Tell the user the drafts are on the board in Dither. They play them side by side, pick favourites and leave notes. Call get_feedback to read their picks and notes, then refine only what they chose with update_effect. Repeat; quality comes from rounds of review.
4. Always look at your own output (every render returns a contact sheet image). Check readability at 1×, silhouette, timing, anticipation → impact → follow-through, and that nothing is blurry or anti-aliased.
5. When the user is happy: record (GIF/sheet/video for review) and export (sprite sheet + JSON for engines, or a standalone JS module for web games and sites).
Effects have a toolkit (particles, trails, shockwaves, bolts, seamless flames, Fluid smoke, palette cycling, flash, dissolve, shake) — use it instead of hand-rolled loops, and read starter effects like portal, meteor-impact or poison-cloud. Big canvases (up to 2048px) are worked tile by tile with region; tiles and parallax scenes have make_tileset, paint_scene and edit_scene. Rigged game characters: create_character from one picture → set_joints → character_animation / motion_from_video → character_view (directions) → export kind "character".
Use the user's references (list_references / view_reference) when they've added some. Use the active project unless the user names another.`;

module.exports = { INSTRUCTIONS };

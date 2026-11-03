// RO2 — the guide every AI reads before designing (ro2_guide), and the short instructions sent when it connects.
'use strict';

const INSTRUCTIONS = `RO2 is the user's design and photo editor (posts, stories, thumbnails, flyers, ads, slides, short videos). You can build and change their designs and export them. Read ro2_guide once per session. The best way to make a design is one full-page HTML layer (add_html) written at the design's exact size; then look at it with screenshot and fix what you see. Moving HTML becomes MP4/WebM/GIF. Check get_state first: the user may already have a design open.`;

function guideText(info = {}) {
  const fonts = (info.fonts || []).join(', ');
  const shapes = (info.shapes || []).join(', ');
  const brand = info.brand ? `\nThe active brand kit is "${info.brand.name}": colours ${info.brand.colors.join(', ') || '(none)'}; fonts ${['heading', 'subheading', 'body'].map((k) => info.brand.fonts[k] ? `${k} ${info.brand.fonts[k].family} ${info.brand.fonts[k].weight}` : null).filter(Boolean).join(', ') || '(none)'}; ${info.brand.logos.length} logo(s). Use them unless the user asks otherwise.` : '';
  return `# RO2 guide

## What RO2 is
A Canva-style editor. A **design** has one size (e.g. 1080×1350 Instagram portrait) and one or more **pages**. Each page is a stack of **layers** (bottom → top): HTML layers, text, shapes, pictures, icons, QR codes, video clips. The user can edit everything you make by hand afterwards.

Coordinates are design pixels from the top-left of the page; x/y are a layer's top-left corner, width/height its size, angle in degrees.

## The best way to design: one HTML layer per page
You are better at HTML/CSS than at placing boxes one by one, so build each page as **one HTML layer covering the whole page** (add_html with no x/y/width/height):
- Lay it out at exactly the design size: \`html, body\` are already width×height CSS px with no margin and overflow hidden. Use absolute positioning, flex or grid inside a full-size container. Never rely on scrolling.
- Put \`<style>\` (and optional \`<script>\`) in the code. Inline SVG is welcome. Images: https URLs or data: URIs. Google Fonts and other CDN CSS/JS load fine over https (keep it light).
- RO2's bundled fonts are always available by name: ${fonts || 'Inter, Poppins, Montserrat…'}.${brand}
- Design quality bar: a clear hierarchy (one dominant headline), generous margins (≈6–8% of the short side), a tight palette (2–3 colours + neutrals), real contrast (4.5:1 for body text), sizes readable on a phone (body ≥ 28px on a 1080-wide post), aligned edges, and nothing touching the page edge unless it bleeds on purpose. Write real, specific copy, never lorem ipsum.
- After every add_html / update_html you get a screenshot: look at it, then fix spacing, overflow, clipped text and contrast before moving on.

## Moving designs (video / GIF)
HTML layers can animate. RO2 records them frame by frame on its own clock, so the result is smooth and exact:
- CSS animations / transitions, the Web Animations API, requestAnimationFrame, setTimeout/setInterval, performance.now()/Date and <video> all follow RO2's clock. GSAP, anime.js, Lottie, canvas and WebGL animations work too.
- Make the timing explicit: say how long it runs with \`<html data-duration="6">\` (seconds) or add_html {duration}. Prefer finite animations that end on a clean final frame (\`animation-fill-mode: both\`). Loops are fine for GIFs: make the last frame meet the first.
- Stagger entrances (headline, then supporting text, then call to action), ease in and out, keep it 4–10 s for social video. Don't use real-world time, random numbers that change per frame, or audio inside the HTML (add music with set_timeline).
- Use preview_animation to check motion and the ending, and screenshot {t} for a single moment.

## Pages as a timeline
Each page is a scene. set_timeline sets each page's duration, the transition into it (fade, fadeblack, dissolve, slideleft, slideright, slideup, slidedown, wipeleft, wiperight, circleopen, circleclose, zoomin, radial, smoothleft…) and a music track. export {format: mp4 | webm | gif} plays the pages in order. Pages with only still layers become still scenes. Video clips (add_video) play on their page.

## Other layers
add_text, add_shape (${shapes || 'rect, circle, star…'}), add_image (web address, file, or free-photo search), add_icon (Lucide names), add_video. Change anything with update_layer; list_layers shows ids. html_to_layers turns an HTML layer into separate editable RO2 layers, for when the user wants to tweak by hand.

## Brand, colour, sizes, exports
- brand_kit gives the user's colours, fonts and logos (logo URLs work in HTML layers: <img src="ro2://brand/…">).
- color_grade changes a photo's look, or the whole page's colours.
- resize_design adapts a design to another size; list_sizes has the presets.
- export: png / jpg / webp / svg / pdf for stills, mp4 / webm / gif for video. Files go to Downloads unless you give a path.

## Workflow
1. get_state (and brand_kit). If nothing suitable is open, new_design at the right size.
2. add_html for each page; look; fix; repeat until it's genuinely good.
3. If it moves: set durations and transitions with set_timeline, check with preview_animation.
4. Export only when the user asked for a file. Tell them what you made and where it is.
`;
}

module.exports = { INSTRUCTIONS, guideText };

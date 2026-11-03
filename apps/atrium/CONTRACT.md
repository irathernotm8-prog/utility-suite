# Atrium content contract (sections, themes, templates, icons)

Atrium sites are built from **sections**. A section is `{ id, type, name, html, css, js }`.

## How a section is rendered
- `html` is the section's full markup with ONE root element (usually `<section>`, `<header>` or `<footer>`). At render time Atrium adds `data-s="<id>"` to that root.
- `css` is scoped by Atrium: every selector is prefixed with `[data-s="<id>"]`. Use `&` to mean the root itself:
  `& { padding: var(--at-pad) 0; }   & .grid { display:grid; }   &.is-dark {…}`
  A selector without `&` gets the root prefix plus a space (`.card {}` → `[data-s="x"] .card {}`).
  `@media`, `@container`, `@supports` blocks are fine (their inner rules get scoped). `@keyframes` names should be unique-ish (prefix with the section type, e.g. `@keyframes heroglow-float`).
- `js` (optional) runs once as `(function(root){ … })(theSectionRootElement)`. Keep it tiny, no libraries, no globals. Most sections need none.

## Theme tokens (CSS custom properties on :root; ALWAYS use these, never hard-code brand colours)
| var | meaning |
|---|---|
| `--at-bg` | page background |
| `--at-surface` | cards, panels |
| `--at-surface-2` | subtle alt background (alternating sections, inputs) |
| `--at-text` | main text |
| `--at-muted` | secondary text |
| `--at-primary` | brand colour (buttons, links, highlights) |
| `--at-primary-text` | text on top of primary |
| `--at-accent` | second brand colour |
| `--at-border` | hairlines |
| `--at-grad` | gradient primary → accent (a full `linear-gradient(...)` value) |
| `--at-radius` | card radius (e.g. 16px) |
| `--at-radius-sm` | small radius (inputs, chips) |
| `--at-btn-radius` | button radius (pill/rounded/square from theme) |
| `--at-font-h` / `--at-font-b` | heading / body font-family stacks |
| `--at-h-weight` | heading weight |
| `--at-h-track` | heading letter-spacing |
| `--at-max` | container max width (e.g. 1200px) |
| `--at-pad` | vertical section padding (a clamp()) |
| `--at-gap` | standard grid gap |
| `--at-shadow` | card shadow |
| `--at-shadow-lg` | big floating shadow |
Colour mixing is encouraged: `color-mix(in srgb, var(--at-primary) 14%, transparent)`.
Light AND dark themes must both look right, so derive tints from tokens rather than assuming dark or light.

## Base classes (provided by `src/core/base-css.js`, available in every section)
`.at-container` (centred, max `--at-max`, side padding), `.at-container.narrow` (760px), `.at-eyebrow` (small caps label), `.at-h1`, `.at-h2`, `.at-h3`, `.at-lead` (large muted paragraph), `.at-muted`, `.at-btn` + `.at-btn-primary` / `.at-btn-ghost` / `.at-btn-outline` / `.at-btn-lg` / `.at-btn-sm`, `.at-card`, `.at-badge`, `.at-grid` with `.cols-2 .cols-3 .cols-4` (collapse responsively), `.at-stack` (vertical flow gap), `.at-row` (flex wrap gap), `.at-center`, `.at-gradient-text`, `.at-divider`, `.at-ic` (icon box, 1em, currentColor), `.at-input` (inputs/textarea/select), `.at-field` (label + input), `.at-check-list` (ul with check icons via CSS), `.at-media` (rounded img/figure, cover), `.at-glow` (soft primary glow behind), `.at-glass` (frosted panel), `.at-marquee` (+ `.at-marquee-track`, infinite horizontal scroll, pure CSS), `.at-sr` (screen-reader only).
Reveal animations: put `data-reveal` (optionally `="up"|"fade"|"zoom"|"left"|"right"` and `data-delay="100"` ms) on any element; the runtime adds `.at-in` when it scrolls into view. Respect `prefers-reduced-motion` (base CSS handles it).

## Dynamic placeholders (filled at render; keep them, don't hard-code their content)
- `<nav data-at-nav></nav>` → links to every page with `nav:true` (`<a href="about.html">About</a>`, active one gets `aria-current="page"`). Style `& [data-at-nav] a {…}` and `& [data-at-nav] a[aria-current]`.
- `<span data-at-sitename></span>` → site name. `<span data-at-tagline></span>` → tagline.
- `<span data-at-year></span>` → current year.
- `<button data-at-menu-toggle aria-label="Menu">…</button>` → runtime toggles class `at-open` on the closest `[data-s]` root (mobile menu). Style `&.at-open …`.
- `<div data-at-posts data-limit="3"></div>` → blog post cards (`<article class="at-post-card"><a href…><img class="at-media"…><div class="at-post-meta">date</div><h3>title</h3><p>excerpt</p></a></article>`); style `.at-post-card` in the section CSS.
- `<form data-at-form name="contact">` → action/method set from the site's form settings. Use normal `<input name=…>` fields and a submit button.
- `[data-count="1200"]` (optional `data-suffix="+"`) → number counts up when visible.
- `<img data-at-logo>` or `<span data-at-logo>` → the site's logo image if one is set, else the site name text.

## Icons
`<i data-icon="NAME"></i>` → inline SVG (24×24 stroke icons, currentColor, size 1em; set font-size to size them). Names come from `src/core/site-icons.js` (`ICONS` keys).

## Images / placeholders
Use placeholder art at `assets/ph/<W>x<H>-<N>.svg` (e.g. `assets/ph/1200x800-3.svg`, N = 1..12 picks a different tasteful abstract gradient). Atrium generates these on demand; the user replaces them with their own. Always include meaningful `alt`.

## Links between pages
Plain relative files: `index.html`, `about.html`, `contact.html`, `blog/index.html`… (`#anchors` fine). Exporters rewrite for WordPress etc.

## Section library entry (src/core/sections.js)
`{ type: 'hero-split', name: 'Split hero', category: 'Hero', description: 'one line', tags: ['saas','product'], html, css, js? }`
Categories: Header, Hero, Logos, Features, Content, Stats, Social proof, Pricing, CTA, FAQ, Gallery, Team, Blog, Contact, Footer.

## Theme preset (src/core/presets.js)
```js
{ id: 'midnight', name: 'Midnight', description: '…',
  mode: 'dark',
  colors: { bg, surface, surface2, text, muted, primary, primaryText, accent, border },   // hex
  fonts: { heading: 'Inter', body: 'Inter', headingWeight: 700 },                          // names from FONTS
  radius: 16, buttonShape: 'pill'|'rounded'|'square', density: 'compact'|'comfortable'|'airy',
  maxWidth: 1200, shadow: 'none'|'soft'|'deep', headingTracking: -0.02 }
```
`FONTS`: `[{ name: 'Inter', category: 'sans'|'serif'|'display'|'mono', google: true, weights: [400,500,600,700,800], fallback: 'system-ui, sans-serif' }]` (system fonts allowed with google:false).
`FONT_PAIRS`: `[{ heading, body, label }]`.

## Template (src/core/templates.js)
```js
{ id, name, description, category, theme: 'presetId',
  settings: { name, tagline },
  header: { type, replace: {} }, footer: { type, replace: {} },
  pages: [{ slug: 'index', title: 'Home', nav: true, seo: { description }, sections: [{ type, replace: { 'Exact text in section html': 'New text' } }] }],
  posts: [{ slug, title, date: 'YYYY-MM-DD', excerpt, cover: 'assets/ph/1200x800-4.svg', tags: [], body: 'markdown' }] }
```
`replace` keys must appear verbatim in that section type's html (Atrium does plain string replaceAll, first key first).

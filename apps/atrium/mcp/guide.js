// Atrium — the guide every AI reads: how a site is put together, the design bar, and how to work.
'use strict';

const INSTRUCTIONS = `Atrium is the user's website builder. You have full control of their sites through these tools: pages, sections (HTML + scoped CSS + JS), the theme, settings, blog posts, assets, screenshots, audits, exports and publishing. The user watches the live preview update as you work.
Start with site_context, and read atrium_guide once before building. Work in passes: build → screenshot (desktop and phone) → fix → audit. Never claim something looks right without a screenshot.`;

function guideText(info = {}) {
  const secs = (info.sections || []).reduce((m, s) => { (m[s.category] = m[s.category] || []).push(`${s.type} (${s.name})`); return m; }, {});
  return `# Atrium guide

${INSTRUCTIONS}

## How a site is built
- A **site** has pages, a shared **header** and **footer**, a **theme**, settings and blog **posts**.
- A **page** is a list of **sections**. A section is \`{ html, css, js }\`:
  - **html** — the section's full markup with ONE root element (\`<section>\`, \`<header>\`, \`<footer>\`, \`<div>\`). Atrium adds \`data-s="<id>"\` to the root.
  - **css** — scoped automatically to that section. \`&\` means the root: \`& { padding: var(--at-pad) 0 }\`, \`& .grid { … }\`, \`&.at-open nav { … }\`. Selectors without \`&\` are inside the root. @media / @container / @supports work. Name @keyframes uniquely. Modern CSS (grid, clamp(), color-mix(), container queries, :has()) is welcome.
  - **js** — optional, runs as \`(function(root){ … })(sectionRoot)\`. No libraries, no globals; keep it small. Most sections need none.
- Global, unscoped CSS/JS go in update_settings {customCss, customJs} — use sparingly.

## Theme tokens — always use them (the user can re-theme the whole site in one click)
Colours: --at-bg, --at-surface, --at-surface-2, --at-text, --at-muted, --at-primary, --at-primary-text, --at-accent, --at-border, --at-grad (primary→accent gradient).
Shape & type: --at-radius, --at-radius-sm, --at-btn-radius, --at-font-h, --at-font-b, --at-h-weight, --at-h-track.
Layout: --at-max (container), --at-pad (section vertical padding), --at-gap, --at-shadow, --at-shadow-lg.
Tints: \`color-mix(in srgb, var(--at-primary) 14%, transparent)\`. Never hard-code brand colours; the site must work in its light or dark theme.

## Base classes (available everywhere)
.at-container (.narrow), .at-eyebrow, .at-h1 .at-h2 .at-h3, .at-lead, .at-muted, .at-btn + .at-btn-primary / .at-btn-ghost / .at-btn-outline / .at-btn-lg / .at-btn-sm, .at-card, .at-badge, .at-grid.cols-2/3/4 (responsive), .at-stack, .at-row, .at-center, .at-gradient-text, .at-divider, .at-ic, .at-input, .at-field, .at-check-list, .at-media, .at-glow, .at-glass, .at-marquee + .at-marquee-track, .at-sr.
Scroll reveal: add data-reveal ("up" | "fade" | "zoom" | "left" | "right") and data-delay="120" to elements.

## Placeholders Atrium fills (leave their contents empty)
- <nav data-at-nav></nav> → links to every page in the menu (active one has aria-current="page").
- <span data-at-logo></span> → the logo image, or the site name. <span data-at-sitename></span>, <span data-at-tagline></span>, <span data-at-year></span>.
- <button data-at-menu-toggle aria-label="Menu">…</button> → toggles .at-open on the section root (mobile menus).
- <div data-at-posts data-limit="3"></div> → blog post cards (.at-post-card). data-tag="news" filters.
- <form data-at-form name="contact"> → wired to the site's form service on export (Formspree, Netlify Forms, email, or WordPress's own mail on the WordPress export). Give every input a name and a <label>.
- data-count="1200" (data-suffix="+", data-prefix="$") → counts up when seen.
- <i data-icon="NAME"></i> → an inline SVG icon (size with font-size). Icons: ${(info.icons || []).join(', ')}.
- Images: real ones live in assets/ (add_asset, search_photos). Placeholder art: assets/ph/<W>x<H>-<1..12>.svg (generated in the site's colours). Always write meaningful alt text.
- Links between pages: about.html, contact.html, index.html, blog/<slug>.html. Atrium rewrites them for each export.

## Section library
${Object.entries(secs).map(([c, l]) => `- **${c}**: ${l.join(', ')}`).join('\n') || '(call list_sections)'}
Start from these: add_section {type, replace} gives a polished, tested section; then make it yours with edit_text or update_section. get_section_template shows the code to learn the conventions.

## Themes
Presets: ${(info.presets || []).map((p) => `${p.id} (${p.mode})`).join(', ')}.
set_theme {preset} for a starting point, {from_color:'#hex', mode} for a palette from a brand colour, then fine-tune colours/fonts. Check the contrast results it returns.

## The quality bar — premium, not template-y
- **One idea per section**, clear hierarchy: eyebrow → headline (short, specific, benefit-led) → one supporting line → action.
- **Typography does the heavy lifting**: big confident headlines (clamp(2.6rem, 6vw, 5rem) for heroes), tight tracking on display sizes, 60–75 character body lines, generous line-height.
- **Whitespace and rhythm**: use --at-pad between sections; align to the container; consistent gaps. Vary section backgrounds (bg / surface-2 / a gradient band) to create rhythm.
- **Real content**: write specific, believable copy for the user's actual business — never lorem ipsum, never "Feature 1". Ask the user for facts you can't infer (prices, address, hours) or mark them clearly.
- **Depth and polish**: subtle borders, soft shadows, a glow or gradient used once or twice per page, hover states on everything clickable, focus-visible styles, smooth transitions (150–250ms).
- **Responsive by design**: check at 390px. Stack columns, scale type with clamp(), keep tap targets ≥ 44px, no horizontal scroll.
- **Accessible**: semantic landmarks (header/nav/main/footer, one h1 per page, headings in order), alt text, labels on inputs, 4.5:1 text contrast.
- **Fast**: compress big images (add_asset does), lazy-load below the fold (loading="lazy"), no heavy scripts.

## Workflow
1. site_context. If the user is starting fresh, create_site (a template close to their need, or blank) and set_theme to fit their brand.
2. Plan pages and sections before writing; tell the user the plan in a sentence or two.
3. Build page by page: add_section (library + replace for copy) or write your own. Look at each section's screenshot as you go.
4. screenshot device:"all" for each finished page; fix what looks off (spacing, alignment, overflow, contrast, awkward line breaks).
5. Fill SEO: update_page seo for each page, update_settings {description, url, ogImage, schema}.
6. audit, fix the issues, screenshot again.
7. Export or publish only when the user asks. Mention the folder/URL you get back.
- The user may have something selected in the editor (site_context.selection); "this section" means that.
- Every AI change is saved as a version, so be bold — but don't delete pages, posts or sections the user didn't ask you to remove.
`;
}

module.exports = { INSTRUCTIONS, guideText };

// Atrium sections — headers (site navigation). Every header has a logo, <nav data-at-nav> and a working mobile menu.
'use strict';

const NAV_MOBILE = `
@media (max-width: 880px) {
  & [data-at-nav] { display: none; position: absolute; top: calc(100% + 8px); left: 12px; right: 12px; flex-direction: column; align-items: stretch; gap: 2px; padding: 10px; border-radius: var(--at-radius); background: var(--at-surface); border: 1px solid var(--at-border); box-shadow: var(--at-shadow-lg); z-index: 60; }
  & [data-at-nav] a { padding: 12px 14px; font-size: 1rem; }
  &.at-open [data-at-nav] { display: flex; animation: hdr-drop .22s cubic-bezier(.2,.8,.2,1); }
  & .toggle { display: inline-grid; }
  & .hide-sm { display: none; }
}
@keyframes hdr-drop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }`;

const TOGGLE_CSS = `
& .toggle { display: none; place-items: center; width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--at-border); background: transparent; color: var(--at-text); font-size: 20px; }
& .toggle .i-close { display: none; }
&.at-open .toggle .i-open { display: none; }
&.at-open .toggle .i-close { display: inline-block; }
& .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--at-text); text-decoration: none; font-family: var(--at-font-h); font-weight: 700; font-size: 1.15rem; letter-spacing: -0.02em; }
& .brand img { height: 30px; width: auto; }`;

const TOGGLE = `<button class="toggle" data-at-menu-toggle aria-label="Menu" aria-expanded="false"><i data-icon="menu" class="i-open"></i><i data-icon="x" class="i-close"></i></button>`;

module.exports = [
  {
    type: 'header-classic', name: 'Classic bar', category: 'Header', tags: ['saas', 'business', 'sticky'],
    description: 'Sticky frosted bar: logo, centred links, sign-in and a primary button.',
    html: `<header class="hd">
  <div class="at-container bar">
    <a href="index.html" class="brand" aria-label="Home"><span data-at-logo></span></a>
    <nav data-at-nav aria-label="Main"></nav>
    <div class="actions">
      <a href="contact.html" class="at-btn at-btn-ghost at-btn-sm hide-sm">Sign in</a>
      <a href="contact.html" class="at-btn at-btn-primary at-btn-sm">Get started</a>
      ${TOGGLE}
    </div>
  </div>
</header>`,
    css: `& { position: sticky; top: 0; z-index: 50; background: color-mix(in srgb, var(--at-bg) 78%, transparent); -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5); border-bottom: 1px solid color-mix(in srgb, var(--at-border) 70%, transparent); }
& .bar { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 68px; }
& [data-at-nav] { display: flex; align-items: center; gap: 2px; }
& [data-at-nav] a { padding: 8px 14px; border-radius: 999px; color: var(--at-muted); text-decoration: none; font-size: .93rem; font-weight: 500; transition: color .2s, background .2s; }
& [data-at-nav] a:hover { color: var(--at-text); background: color-mix(in srgb, var(--at-text) 6%, transparent); opacity: 1; }
& [data-at-nav] a[aria-current] { color: var(--at-text); background: color-mix(in srgb, var(--at-text) 7%, transparent); }
& .actions { display: flex; align-items: center; gap: 8px; }
${TOGGLE_CSS}
${NAV_MOBILE}`,
  },
  {
    type: 'header-centered', name: 'Centred logo', category: 'Header', tags: ['editorial', 'restaurant', 'fashion'],
    description: 'Logo in the middle with links on the left and a call to action on the right — editorial and boutique.',
    html: `<header class="hd">
  <div class="at-container bar">
    <nav data-at-nav aria-label="Main"></nav>
    <a href="index.html" class="brand" aria-label="Home"><span data-at-logo></span></a>
    <div class="actions">
      <a href="contact.html" class="at-btn at-btn-outline at-btn-sm">Book a table</a>
      ${TOGGLE}
    </div>
  </div>
</header>`,
    css: `& { position: relative; z-index: 50; border-bottom: 1px solid var(--at-border); background: var(--at-bg); }
& .bar { position: relative; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px; min-height: 84px; }
& .brand { justify-self: center; font-size: 1.45rem; letter-spacing: -0.01em; }
& [data-at-nav] { display: flex; gap: 22px; }
& [data-at-nav] a { color: var(--at-muted); text-decoration: none; font-size: .9rem; font-weight: 500; letter-spacing: .02em; position: relative; padding: 6px 0; }
& [data-at-nav] a::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: currentColor; transform: scaleX(0); transform-origin: left; transition: transform .3s; }
& [data-at-nav] a:hover, & [data-at-nav] a[aria-current] { color: var(--at-text); opacity: 1; }
& [data-at-nav] a:hover::after, & [data-at-nav] a[aria-current]::after { transform: scaleX(1); }
& .actions { justify-self: end; display: flex; gap: 8px; align-items: center; }
${TOGGLE_CSS}
@media (max-width: 880px) {
  & .bar { grid-template-columns: auto 1fr auto; min-height: 68px; }
  & .brand { grid-column: 1; grid-row: 1; justify-self: start; }
  & .actions { grid-column: 3; grid-row: 1; }
  & [data-at-nav] a::after { display: none; }
}
${NAV_MOBILE}`,
  },
  {
    type: 'header-floating', name: 'Floating pill', category: 'Header', tags: ['startup', 'modern', 'glass'],
    description: 'A rounded glass pill that floats above the page — modern startup feel.',
    html: `<header class="hd">
  <div class="at-container">
    <div class="pill at-glass">
      <a href="index.html" class="brand" aria-label="Home"><span data-at-logo></span></a>
      <nav data-at-nav aria-label="Main"></nav>
      <div class="actions">
        <a href="contact.html" class="at-btn at-btn-primary at-btn-sm">Start free <i data-icon="arrow-right"></i></a>
        ${TOGGLE}
      </div>
    </div>
  </div>
</header>`,
    css: `& { position: sticky; top: 0; z-index: 50; padding-top: 14px; pointer-events: none; }
& .pill { pointer-events: auto; position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; max-width: 980px; margin: 0 auto; padding: 8px 8px 8px 20px; border-radius: 999px; box-shadow: var(--at-shadow-lg); }
& [data-at-nav] { display: flex; gap: 2px; }
& [data-at-nav] a { padding: 8px 14px; border-radius: 999px; color: var(--at-muted); text-decoration: none; font-size: .9rem; font-weight: 500; transition: color .2s, background .2s; }
& [data-at-nav] a:hover, & [data-at-nav] a[aria-current] { color: var(--at-text); background: color-mix(in srgb, var(--at-text) 7%, transparent); opacity: 1; }
& .actions { display: flex; gap: 6px; align-items: center; }
& .toggle { border-radius: 999px; }
${TOGGLE_CSS}
${NAV_MOBILE}`,
  },
  {
    type: 'header-announce', name: 'Minimal with announcement', category: 'Header', tags: ['launch', 'shop', 'news'],
    description: 'A slim announcement bar on top of a minimal header — great for launches and promos.',
    html: `<header class="hd">
  <a class="announce" href="blog/index.html"><span class="dot"></span><span>Northwind 3.0 is here — faster, smarter, beautifully simple.</span><span class="more">Read the story <i data-icon="arrow-right"></i></span></a>
  <div class="at-container bar">
    <a href="index.html" class="brand" aria-label="Home"><span data-at-logo></span></a>
    <div class="right">
      <nav data-at-nav aria-label="Main"></nav>
      <a href="contact.html" class="at-btn at-btn-primary at-btn-sm">Contact</a>
      ${TOGGLE}
    </div>
  </div>
</header>`,
    css: `& { position: relative; z-index: 50; background: var(--at-bg); border-bottom: 1px solid var(--at-border); }
& .announce { display: flex; justify-content: center; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 16px; background: var(--at-grad); color: var(--at-primary-text); font-size: .85rem; font-weight: 500; text-decoration: none; text-align: center; }
& .announce:hover { opacity: 1; }
& .announce .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 25%, transparent); }
& .announce .more { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; }
& .announce:hover .more .at-ic { transform: translateX(2px); }
& .announce .at-ic { transition: transform .2s; }
& .bar { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 66px; }
& .right { display: flex; align-items: center; gap: 18px; }
& [data-at-nav] { display: flex; gap: 22px; }
& [data-at-nav] a { color: var(--at-muted); text-decoration: none; font-size: .92rem; font-weight: 500; }
& [data-at-nav] a:hover, & [data-at-nav] a[aria-current] { color: var(--at-text); opacity: 1; }
${TOGGLE_CSS}
@media (max-width: 880px) { & .right { gap: 8px; } }
${NAV_MOBILE}`,
  },
];

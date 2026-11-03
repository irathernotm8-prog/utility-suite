// Atrium sections — footers.
'use strict';

const SOCIAL = `<div class="soc"><a href="#" aria-label="Instagram"><i data-icon="instagram"></i></a><a href="#" aria-label="X"><i data-icon="x-twitter"></i></a><a href="#" aria-label="LinkedIn"><i data-icon="linkedin"></i></a><a href="#" aria-label="YouTube"><i data-icon="youtube"></i></a></div>`;
const SOCIAL_CSS = `& .soc { display: flex; gap: 8px; }
& .soc a { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--at-border); color: var(--at-muted); font-size: 16px; transition: color .2s, border-color .2s, background .2s; }
& .soc a:hover { color: var(--at-text); border-color: color-mix(in srgb, var(--at-text) 35%, transparent); opacity: 1; }
& .brand { display: inline-flex; align-items: center; color: var(--at-text); text-decoration: none; font-family: var(--at-font-h); font-weight: 700; font-size: 1.2rem; letter-spacing: -0.02em; }
& .brand img { height: 30px; width: auto; }`;

module.exports = [
  {
    type: 'footer-columns', name: 'Multi-column footer', category: 'Footer', tags: ['saas', 'business', 'sitemap'],
    description: 'Brand blurb and social icons plus three link columns, with a bottom bar for copyright and legal links.',
    html: `<footer class="ft">
  <div class="at-container">
    <div class="top">
      <div class="at-stack about">
        <a href="index.html" class="brand" aria-label="Home"><span data-at-logo></span></a>
        <p class="at-muted"><span data-at-tagline></span></p>
        ${SOCIAL}
      </div>
      <nav class="col" aria-label="Product"><h4>Product</h4><a href="index.html#features">Features</a><a href="pricing.html">Pricing</a><a href="blog/index.html">Changelog</a><a href="contact.html">Book a demo</a></nav>
      <nav class="col" aria-label="Company"><h4>Company</h4><a href="about.html">About</a><a href="blog/index.html">Blog</a><a href="contact.html">Careers</a><a href="contact.html">Contact</a></nav>
      <nav class="col" aria-label="Resources"><h4>Resources</h4><a href="contact.html">Help centre</a><a href="contact.html">Community</a><a href="contact.html">Status</a><a href="contact.html">Partners</a></nav>
    </div>
    <div class="bottom">
      <p>© <span data-at-year></span> <span data-at-sitename></span>. All rights reserved.</p>
      <div class="legal"><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="privacy.html#cookies">Cookies</a></div>
    </div>
  </div>
</footer>`,
    css: `& { padding: clamp(56px, 8vw, 96px) 0 28px; border-top: 1px solid var(--at-border); background: color-mix(in srgb, var(--at-surface-2) 55%, var(--at-bg)); }
& .top { display: grid; gap: 40px; grid-template-columns: repeat(2, 1fr); }
& .about { grid-column: 1 / -1; gap: 16px; max-width: 340px; }
@media (min-width: 900px) { & .top { grid-template-columns: 2fr 1fr 1fr 1fr; } & .about { grid-column: auto; } }
& .about p { font-size: .95rem; }
& .col { display: flex; flex-direction: column; gap: 11px; }
& .col h4 { font-family: var(--at-font-b); font-size: .8rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--at-text); margin-bottom: 4px; }
& .col a, & .legal a { color: var(--at-muted); text-decoration: none; font-size: .94rem; }
& .col a:hover, & .legal a:hover { color: var(--at-text); opacity: 1; }
& .bottom { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: clamp(40px, 6vw, 72px); padding-top: 24px; border-top: 1px solid var(--at-border); font-size: .86rem; color: var(--at-muted); }
& .legal { display: flex; gap: 20px; }
${SOCIAL_CSS}`,
  },
  {
    type: 'footer-simple', name: 'Simple centred footer', category: 'Footer', tags: ['minimal', 'portfolio', 'landing'],
    description: 'Logo, the main page links, social icons and copyright, all centred.',
    html: `<footer class="ft">
  <div class="at-container at-center inner">
    <a href="index.html" class="brand" aria-label="Home"><span data-at-logo></span></a>
    <nav data-at-nav aria-label="Footer"></nav>
    ${SOCIAL}
    <p class="copy">© <span data-at-year></span> <span data-at-sitename></span> · Made with care</p>
  </div>
</footer>`,
    css: `& { padding: clamp(48px, 7vw, 80px) 0 36px; border-top: 1px solid var(--at-border); }
& .inner { display: flex; flex-direction: column; align-items: center; gap: 22px; }
& [data-at-nav] { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 24px; }
& [data-at-nav] a { color: var(--at-muted); text-decoration: none; font-size: .94rem; }
& [data-at-nav] a:hover, & [data-at-nav] a[aria-current] { color: var(--at-text); opacity: 1; }
& .copy { color: var(--at-muted); font-size: .85rem; }
${SOCIAL_CSS}`,
  },
  {
    type: 'footer-cta', name: 'Footer with big CTA', category: 'Footer', tags: ['agency', 'personal', 'bold'],
    description: 'A huge closing headline with an email link, then a slim bar with links, social and copyright.',
    html: `<footer class="ft">
  <div class="at-container">
    <div class="cta">
      <span class="at-eyebrow" data-reveal>Have a project in mind?</span>
      <a href="mailto:hello@northwind.co" class="big" data-reveal data-delay="60">Let’s make something great <i data-icon="arrow-up-right"></i></a>
    </div>
    <div class="bar">
      <a href="index.html" class="brand" aria-label="Home"><span data-at-logo></span></a>
      <nav data-at-nav aria-label="Footer"></nav>
      ${SOCIAL}
    </div>
    <p class="copy">© <span data-at-year></span> <span data-at-sitename></span>. All rights reserved.</p>
  </div>
</footer>`,
    css: `& { padding: clamp(64px, 10vw, 140px) 0 28px; border-top: 1px solid var(--at-border); overflow: hidden; }
& .cta { display: flex; flex-direction: column; gap: 18px; margin-bottom: clamp(48px, 8vw, 110px); }
& .big { display: inline-flex; align-items: center; gap: .25em; flex-wrap: wrap; color: var(--at-text); text-decoration: none; font-family: var(--at-font-h); font-weight: var(--at-h-weight); font-size: clamp(2.4rem, 1.2rem + 5.6vw, 6.4rem); line-height: 1; letter-spacing: calc(var(--at-h-track) - .01em); transition: color .3s; }
& .big .at-ic { color: var(--at-primary); transition: transform .3s; }
& .big:hover { opacity: 1; color: var(--at-primary); }
& .big:hover .at-ic { transform: translate(6px, -6px); }
& .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; padding: 24px 0; border-top: 1px solid var(--at-border); border-bottom: 1px solid var(--at-border); }
& [data-at-nav] { display: flex; flex-wrap: wrap; gap: 8px 24px; }
& [data-at-nav] a { color: var(--at-muted); text-decoration: none; font-size: .94rem; }
& [data-at-nav] a:hover, & [data-at-nav] a[aria-current] { color: var(--at-text); opacity: 1; }
& .copy { margin-top: 22px; color: var(--at-muted); font-size: .85rem; }
${SOCIAL_CSS}`,
  },
];

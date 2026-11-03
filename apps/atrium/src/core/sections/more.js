// Atrium sections — pricing, calls to action, FAQ, gallery, team, blog, contact and newsletter.
'use strict';

const HEAD = (eyebrow, title, lead) => `<div class="head at-center at-stack">
      <span class="at-eyebrow" data-reveal>${eyebrow}</span>
      <h2 class="at-h2" data-reveal data-delay="60">${title}</h2>
      ${lead ? `<p class="at-lead" data-reveal data-delay="120">${lead}</p>` : ''}
    </div>`;
const HEAD_CSS = `& .head { align-items: center; margin-bottom: clamp(36px, 5vw, 60px); }
& .head h2 { max-width: 20ch; }`;

module.exports = [
  {
    type: 'pricing-tiers', name: 'Pricing tiers', category: 'Pricing', tags: ['saas', 'plans', 'interactive'],
    description: 'Three plans with a highlighted favourite and a monthly / yearly switch (tiny script).',
    html: `<section class="pricing">
  <div class="at-container">
    ${HEAD('Pricing', 'Simple pricing that grows with you', 'Start free, upgrade when you’re ready. Every plan includes unlimited projects.')}
    <div class="switch" role="group" aria-label="Billing period" data-reveal>
      <button type="button" data-billing="monthly" aria-pressed="true">Monthly</button>
      <button type="button" data-billing="yearly" aria-pressed="false">Yearly <span class="save">Save 20%</span></button>
    </div>
    <div class="plans">
      <article class="plan" data-reveal>
        <h3>Starter</h3><p class="at-muted desc">For individuals and side projects.</p>
        <div class="price"><span class="m">$0</span><span class="y">$0</span><span class="per">/ month</span></div>
        <a href="contact.html" class="at-btn at-btn-outline">Start for free</a>
        <ul class="at-check-list"><li>Up to 3 members</li><li>Unlimited projects</li><li>Basic automations</li><li>Community support</li></ul>
      </article>
      <article class="plan pop" data-reveal data-delay="80">
        <span class="tag">Most popular</span>
        <h3>Team</h3><p class="desc">For growing teams that ship together.</p>
        <div class="price"><span class="m">$12</span><span class="y">$10</span><span class="per">/ user / month</span></div>
        <a href="contact.html" class="at-btn at-btn-primary">Start 14-day trial</a>
        <ul class="at-check-list"><li>Unlimited members</li><li>AI assistant included</li><li>Advanced automations</li><li>Priority support</li></ul>
      </article>
      <article class="plan" data-reveal data-delay="160">
        <h3>Business</h3><p class="at-muted desc">For organisations that need control.</p>
        <div class="price"><span class="m">$24</span><span class="y">$19</span><span class="per">/ user / month</span></div>
        <a href="contact.html" class="at-btn at-btn-outline">Talk to sales</a>
        <ul class="at-check-list"><li>SSO &amp; SCIM</li><li>Audit logs</li><li>Custom roles</li><li>Dedicated success manager</li></ul>
      </article>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .switch { display: flex; gap: 4px; width: fit-content; margin: 0 auto 36px; padding: 5px; border-radius: 999px; background: var(--at-surface-2); border: 1px solid var(--at-border); }
& .switch button { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 999px; border: 0; background: transparent; color: var(--at-muted); font-weight: 600; font-size: .9rem; transition: background .2s, color .2s; }
& .switch button[aria-pressed=true] { background: var(--at-surface); color: var(--at-text); box-shadow: var(--at-shadow); }
& .save { padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--at-primary) 16%, transparent); color: var(--at-primary); font-size: .74rem; }
& .plans { display: grid; gap: 18px; align-items: stretch; }
@media (min-width: 960px) { & .plans { grid-template-columns: repeat(3, 1fr); } }
& .plan { position: relative; display: flex; flex-direction: column; gap: 14px; padding: clamp(26px, 3vw, 36px); border-radius: calc(var(--at-radius) + 4px); background: var(--at-surface); border: 1px solid var(--at-border); }
& .plan h3 { font-size: 1.25rem; }
& .desc { font-size: .93rem; margin-top: -6px; }
& .price { display: flex; align-items: baseline; gap: 8px; margin: 8px 0; }
& .price .m, & .price .y { font-family: var(--at-font-h); font-weight: var(--at-h-weight); font-size: clamp(2.6rem, 2.2rem + 1.4vw, 3.4rem); letter-spacing: -0.045em; line-height: 1; }
& .price .y { display: none; }
&.is-yearly .price .m { display: none; }
&.is-yearly .price .y { display: inline; }
& .per { color: var(--at-muted); font-size: .9rem; }
& .plan .at-btn { width: 100%; margin-bottom: 8px; }
& .pop { background: var(--at-text); color: var(--at-bg); border-color: transparent; box-shadow: var(--at-shadow-lg); }
& .pop h3 { color: var(--at-bg); }
& .pop .desc, & .pop .per { color: color-mix(in srgb, var(--at-bg) 70%, transparent); }
& .pop .at-check-list li::before { background: color-mix(in srgb, var(--at-primary) 30%, transparent); }
@media (min-width: 960px) { & .pop { transform: scale(1.035); } }
& .tag { position: absolute; top: 18px; right: 18px; padding: 5px 12px; border-radius: 999px; background: var(--at-grad); color: var(--at-primary-text); font-size: .75rem; font-weight: 700; }`,
    js: `var btns = root.querySelectorAll('[data-billing]');
btns.forEach(function (b) {
  b.addEventListener('click', function () {
    root.classList.toggle('is-yearly', b.getAttribute('data-billing') === 'yearly');
    btns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
  });
});`,
  },
  {
    type: 'pricing-simple', name: 'Two plans', category: 'Pricing', tags: ['service', 'simple', 'membership'],
    description: 'Two side-by-side plans with feature lists — good for services, memberships or internet plans.',
    html: `<section class="pricing">
  <div class="at-container">
    ${HEAD('Plans', 'Pick the plan that fits', 'No contracts, no hidden fees. Change or cancel any time.')}
    <div class="plans">
      <article class="plan" data-reveal>
        <div class="top"><div><h3>Essential</h3><p class="at-muted">Everything you need to get going.</p></div><div class="price"><span class="amt">$49</span><span class="per">/mo</span></div></div>
        <ul class="at-check-list"><li>All core features</li><li>Email support</li><li>Monthly reporting</li></ul>
        <a href="contact.html" class="at-btn at-btn-outline">Choose Essential</a>
      </article>
      <article class="plan best" data-reveal data-delay="100">
        <div class="top"><div><h3>Premium <span class="at-badge">Best value</span></h3><p class="at-muted">For people who want the very best.</p></div><div class="price"><span class="amt">$89</span><span class="per">/mo</span></div></div>
        <ul class="at-check-list"><li>Everything in Essential</li><li>24/7 priority support</li><li>Weekly reporting</li><li>Dedicated specialist</li></ul>
        <a href="contact.html" class="at-btn at-btn-primary">Choose Premium</a>
      </article>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .plans { display: grid; gap: 18px; max-width: 980px; margin: 0 auto; }
@media (min-width: 820px) { & .plans { grid-template-columns: 1fr 1fr; } }
& .plan { display: flex; flex-direction: column; gap: 22px; padding: clamp(26px, 3.4vw, 40px); border-radius: calc(var(--at-radius) + 4px); background: var(--at-surface); border: 1px solid var(--at-border); }
& .best { border-color: color-mix(in srgb, var(--at-primary) 55%, var(--at-border)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--at-primary) 12%, transparent), var(--at-shadow-lg); }
& .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding-bottom: 22px; border-bottom: 1px solid var(--at-border); }
& .top h3 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
& .top p { font-size: .93rem; }
& .price { text-align: right; white-space: nowrap; }
& .amt { font-family: var(--at-font-h); font-weight: var(--at-h-weight); font-size: clamp(2.2rem, 1.9rem + 1.2vw, 3rem); letter-spacing: -0.04em; line-height: 1; }
& .per { color: var(--at-muted); }
& .plan .at-btn { margin-top: auto; }`,
  },
  {
    type: 'cta-gradient', name: 'Gradient CTA banner', category: 'CTA', tags: ['conversion', 'bold'],
    description: 'A big rounded gradient banner with a headline, line of copy and two buttons.',
    html: `<section class="cta">
  <div class="at-container">
    <div class="box" data-reveal="zoom">
      <div class="glow" aria-hidden="true"></div>
      <h2 class="at-h2">Ready to give your team its time back?</h2>
      <p>Join 12,000 teams already working calmer with Northwind. Free for 14 days.</p>
      <div class="at-row btns">
        <a href="contact.html" class="at-btn at-btn-lg light">Start free trial <i data-icon="arrow-right"></i></a>
        <a href="contact.html" class="at-btn at-btn-lg line">Book a demo</a>
      </div>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .box { position: relative; overflow: hidden; isolation: isolate; padding: clamp(40px, 7vw, 96px) clamp(24px, 5vw, 64px); border-radius: calc(var(--at-radius) + 12px); background: var(--at-grad); color: var(--at-primary-text); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 18px; }
& .glow { position: absolute; inset: -40% -10% auto; height: 120%; z-index: -1; background: radial-gradient(closest-side, rgba(255,255,255,.28), transparent 70%); }
& .box::after { content: ""; position: absolute; inset: 0; z-index: -1; background-image: radial-gradient(rgba(255,255,255,.18) 1px, transparent 1px); background-size: 22px 22px; -webkit-mask-image: linear-gradient(180deg, transparent, #000); mask-image: linear-gradient(180deg, transparent, #000); }
& h2 { color: inherit; max-width: 18ch; }
& p { font-size: clamp(1.02rem, .98rem + .3vw, 1.2rem); opacity: .9; max-width: 50ch; }
& .btns { justify-content: center; margin-top: 10px; }
& .light { background: var(--at-primary-text); color: var(--at-primary); }
& .light:hover { color: var(--at-primary); box-shadow: 0 14px 30px -12px rgba(0,0,0,.4); }
& .line { background: transparent; color: var(--at-primary-text); border-color: color-mix(in srgb, var(--at-primary-text) 45%, transparent); }
& .line:hover { color: var(--at-primary-text); background: color-mix(in srgb, var(--at-primary-text) 12%, transparent); }`,
  },
  {
    type: 'cta-split', name: 'Split CTA with form', category: 'CTA', tags: ['lead', 'demo', 'conversion'],
    description: 'Heading and benefits on one side, a short lead form in a card on the other.',
    html: `<section class="cta">
  <div class="at-container grid">
    <div class="at-stack copy">
      <span class="at-eyebrow" data-reveal>Book a demo</span>
      <h2 class="at-h2" data-reveal data-delay="60">See Northwind with your own workflow</h2>
      <p class="at-lead" data-reveal data-delay="120">A 20-minute call with a product specialist — tailored to your team, no pressure.</p>
      <ul class="at-check-list" data-reveal data-delay="180"><li>Personal walkthrough</li><li>Migration plan for your tools</li><li>Custom pricing for 50+ seats</li></ul>
    </div>
    <form data-at-form name="demo" class="at-card form" data-reveal="zoom">
      <div class="two"><label class="at-field">First name<input class="at-input" name="first_name" required autocomplete="given-name"></label><label class="at-field">Last name<input class="at-input" name="last_name" autocomplete="family-name"></label></div>
      <label class="at-field">Work email<input class="at-input" type="email" name="email" required autocomplete="email" placeholder="you@company.com"></label>
      <label class="at-field">Team size<select class="at-input" name="team_size"><option>1–10</option><option>11–50</option><option>51–200</option><option>200+</option></select></label>
      <button type="submit" class="at-btn at-btn-primary at-btn-lg">Request my demo</button>
      <p class="fine at-muted">We’ll reply within one business day.</p>
    </form>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .grid { display: grid; gap: clamp(32px, 5vw, 72px); align-items: center; }
@media (min-width: 920px) { & .grid { grid-template-columns: 1fr 1fr; } }
& .copy { gap: 20px; }
& .form { display: flex; flex-direction: column; gap: 16px; box-shadow: var(--at-shadow-lg); }
& .two { display: grid; gap: 16px; }
@media (min-width: 520px) { & .two { grid-template-columns: 1fr 1fr; } }
& .fine { font-size: .84rem; text-align: center; }`,
  },
  {
    type: 'faq-accordion', name: 'FAQ accordion', category: 'FAQ', tags: ['support', 'questions'],
    description: 'Heading and contact prompt on the left, smooth <details> accordions on the right.',
    html: `<section class="faq">
  <div class="at-container grid">
    <div class="at-stack side">
      <span class="at-eyebrow" data-reveal>FAQ</span>
      <h2 class="at-h2" data-reveal data-delay="60">Questions, answered</h2>
      <p class="at-muted" data-reveal data-delay="120">Can’t find what you’re looking for? <a href="contact.html">Talk to our team</a> — we usually reply within the hour.</p>
    </div>
    <div class="list">
      <details data-reveal open><summary>How does the free trial work?<i data-icon="plus"></i></summary><div class="a"><p>You get every feature for 14 days, no credit card needed. At the end, pick a plan or drop to the free Starter plan — your data stays put.</p></div></details>
      <details data-reveal><summary>Can I import from other tools?<i data-icon="plus"></i></summary><div class="a"><p>Yes. One-click importers bring over projects, tasks and files from Trello, Asana, Jira, Notion and spreadsheets.</p></div></details>
      <details data-reveal><summary>Is my data secure?<i data-icon="plus"></i></summary><div class="a"><p>Data is encrypted in transit and at rest, backed up hourly and hosted in SOC 2 Type II certified data centres.</p></div></details>
      <details data-reveal><summary>Do you offer discounts for nonprofits?<i data-icon="plus"></i></summary><div class="a"><p>We do — registered nonprofits and schools get 50% off any paid plan. Just get in touch.</p></div></details>
      <details data-reveal><summary>Can I cancel any time?<i data-icon="plus"></i></summary><div class="a"><p>Of course. Cancel in two clicks from settings and you won’t be charged again. You can export everything first.</p></div></details>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .grid { display: grid; gap: 36px; }
@media (min-width: 920px) { & .grid { grid-template-columns: 1fr 1.5fr; gap: 80px; } & .side { position: sticky; top: 110px; align-self: start; } }
& .list { display: flex; flex-direction: column; gap: 12px; }
& details { border-radius: var(--at-radius); background: var(--at-surface); border: 1px solid var(--at-border); transition: border-color .25s, background .25s; }
& details[open] { border-color: color-mix(in srgb, var(--at-primary) 40%, var(--at-border)); }
& summary { list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 22px; font-weight: 600; font-size: 1.02rem; }
& summary::-webkit-details-marker { display: none; }
& summary .at-ic { font-size: 18px; color: var(--at-muted); transition: transform .3s, color .3s; }
& details[open] summary .at-ic { transform: rotate(45deg); color: var(--at-primary); }
& .a { padding: 0 22px 20px; color: var(--at-muted); animation: faq-open .35s ease; }
@keyframes faq-open { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }`,
  },
  {
    type: 'gallery-grid', name: 'Gallery grid', category: 'Gallery', tags: ['portfolio', 'photos', 'work'],
    description: 'A heading with a filter-less grid of project tiles that lift and reveal captions on hover.',
    html: `<section class="gallery">
  <div class="at-container">
    <div class="head">
      <div class="at-stack"><span class="at-eyebrow" data-reveal>Selected work</span><h2 class="at-h2" data-reveal data-delay="60">Recent projects</h2></div>
      <a href="work.html" class="at-btn at-btn-outline" data-reveal>View all work <i data-icon="arrow-right"></i></a>
    </div>
    <div class="grid">
      <a href="#" class="item" data-reveal><img class="at-media" src="assets/ph/1000x750-1.svg" alt="Lumen brand identity"><div class="cap"><strong>Lumen</strong><span>Brand identity</span></div></a>
      <a href="#" class="item" data-reveal data-delay="80"><img class="at-media" src="assets/ph/1000x750-4.svg" alt="Orbitly website"><div class="cap"><strong>Orbitly</strong><span>Website &amp; product</span></div></a>
      <a href="#" class="item" data-reveal><img class="at-media" src="assets/ph/1000x750-7.svg" alt="Greenhouse packaging"><div class="cap"><strong>Greenhouse</strong><span>Packaging</span></div></a>
      <a href="#" class="item" data-reveal data-delay="80"><img class="at-media" src="assets/ph/1000x750-10.svg" alt="Nimbus campaign"><div class="cap"><strong>Nimbus</strong><span>Campaign</span></div></a>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; margin-bottom: clamp(28px, 4vw, 48px); }
& .grid { display: grid; gap: 20px; }
@media (min-width: 760px) { & .grid { grid-template-columns: 1fr 1fr; } }
& .item { display: block; color: inherit; text-decoration: none; }
& .item:hover { opacity: 1; }
& .item img { aspect-ratio: 4 / 3; transition: transform .6s cubic-bezier(.2,.8,.2,1), filter .4s; }
& .item:hover img { transform: scale(1.015); filter: brightness(1.05); }
& .cap { display: flex; justify-content: space-between; gap: 12px; padding: 14px 4px 0; }
& .cap strong { font-family: var(--at-font-h); font-size: 1.15rem; letter-spacing: -0.02em; }
& .cap span { color: var(--at-muted); font-size: .92rem; }`,
  },
  {
    type: 'gallery-masonry', name: 'Masonry gallery', category: 'Gallery', tags: ['photography', 'restaurant', 'event'],
    description: 'A photo wall in natural proportions (pure CSS columns) with a centred heading.',
    html: `<section class="masonry">
  <div class="at-container">
    <div class="head at-center at-stack">
      <span class="at-eyebrow" data-reveal>Gallery</span>
      <h2 class="at-h2" data-reveal data-delay="60">Moments worth keeping</h2>
    </div>
    <div class="cols" data-reveal="fade">
      <img class="at-media" src="assets/ph/800x1100-1.svg" alt="Gallery photo 1">
      <img class="at-media" src="assets/ph/800x600-2.svg" alt="Gallery photo 2">
      <img class="at-media" src="assets/ph/800x900-3.svg" alt="Gallery photo 3">
      <img class="at-media" src="assets/ph/800x600-4.svg" alt="Gallery photo 4">
      <img class="at-media" src="assets/ph/800x1000-5.svg" alt="Gallery photo 5">
      <img class="at-media" src="assets/ph/800x700-6.svg" alt="Gallery photo 6">
      <img class="at-media" src="assets/ph/800x1100-7.svg" alt="Gallery photo 7">
      <img class="at-media" src="assets/ph/800x600-8.svg" alt="Gallery photo 8">
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .head { align-items: center; margin-bottom: clamp(32px, 5vw, 56px); }
& .cols { columns: 2; column-gap: 14px; }
@media (min-width: 900px) { & .cols { columns: 3; column-gap: 18px; } }
& .cols img { margin-bottom: 14px; break-inside: avoid; transition: transform .5s cubic-bezier(.2,.8,.2,1); }
@media (min-width: 900px) { & .cols img { margin-bottom: 18px; } }
& .cols img:hover { transform: scale(1.015); }`,
  },
  {
    type: 'team-grid', name: 'Team grid', category: 'Team', tags: ['about', 'people'],
    description: 'Portrait cards with name, role and social links in a responsive grid.',
    html: `<section class="team">
  <div class="at-container">
    ${HEAD('Our team', 'The people behind the work', 'A small, senior team that cares deeply about every detail.')}
    <div class="at-grid cols-4">
      <article class="m" data-reveal><img class="at-media" src="assets/ph/600x720-1.svg" alt="Portrait of Ava Lindqvist"><h3>Ava Lindqvist</h3><p class="at-muted">Founder &amp; CEO</p><div class="soc"><a href="#" aria-label="LinkedIn"><i data-icon="linkedin"></i></a><a href="#" aria-label="X"><i data-icon="x-twitter"></i></a></div></article>
      <article class="m" data-reveal data-delay="80"><img class="at-media" src="assets/ph/600x720-2.svg" alt="Portrait of Jonah Reyes"><h3>Jonah Reyes</h3><p class="at-muted">Head of Design</p><div class="soc"><a href="#" aria-label="LinkedIn"><i data-icon="linkedin"></i></a><a href="#" aria-label="Dribbble"><i data-icon="dribbble"></i></a></div></article>
      <article class="m" data-reveal data-delay="160"><img class="at-media" src="assets/ph/600x720-3.svg" alt="Portrait of Noor Haddad"><h3>Noor Haddad</h3><p class="at-muted">Lead Engineer</p><div class="soc"><a href="#" aria-label="LinkedIn"><i data-icon="linkedin"></i></a><a href="#" aria-label="GitHub"><i data-icon="github"></i></a></div></article>
      <article class="m" data-reveal data-delay="240"><img class="at-media" src="assets/ph/600x720-4.svg" alt="Portrait of Leo Martin"><h3>Leo Martin</h3><p class="at-muted">Client Partner</p><div class="soc"><a href="#" aria-label="LinkedIn"><i data-icon="linkedin"></i></a><a href="#" aria-label="Instagram"><i data-icon="instagram"></i></a></div></article>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .m { display: flex; flex-direction: column; gap: 4px; }
& .m img { aspect-ratio: 5 / 6; margin-bottom: 14px; transition: transform .5s cubic-bezier(.2,.8,.2,1); }
& .m:hover img { transform: translateY(-4px); }
& .m h3 { font-size: 1.1rem; }
& .m p { font-size: .92rem; }
& .soc { display: flex; gap: 6px; margin-top: 8px; }
& .soc a { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--at-border); color: var(--at-muted); font-size: 15px; }
& .soc a:hover { color: var(--at-primary); border-color: var(--at-primary); opacity: 1; }`,
  },
  {
    type: 'blog-list', name: 'Latest posts', category: 'Blog', tags: ['blog', 'news', 'journal'],
    description: 'The latest blog posts as cards (filled automatically from the site’s posts), with a link to all posts.',
    html: `<section class="blog">
  <div class="at-container">
    <div class="head">
      <div class="at-stack"><span class="at-eyebrow" data-reveal>Journal</span><h2 class="at-h2" data-reveal data-delay="60">Latest from the blog</h2></div>
      <a href="blog/index.html" class="at-btn at-btn-outline" data-reveal>All posts <i data-icon="arrow-right"></i></a>
    </div>
    <div class="posts" data-at-posts data-limit="3" data-reveal="fade"></div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; margin-bottom: clamp(28px, 4vw, 48px); }
& .posts { display: grid; gap: clamp(20px, 2.4vw, 32px); }
@media (min-width: 700px) { & .posts { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1000px) { & .posts { grid-template-columns: repeat(3, 1fr); } }
& .at-post-card h3 { transition: color .2s; }
& .at-post-card a:hover h3 { color: var(--at-primary); }`,
  },
  {
    type: 'contact-split', name: 'Contact form + details', category: 'Contact', tags: ['contact', 'lead', 'local'],
    description: 'Contact details with icons and a map picture on one side, a full message form on the other.',
    html: `<section class="contact">
  <div class="at-container grid">
    <div class="at-stack info">
      <span class="at-eyebrow" data-reveal>Contact</span>
      <h2 class="at-h2" data-reveal data-delay="60">Let’s talk</h2>
      <p class="at-lead" data-reveal data-delay="120">Questions, ideas or a project in mind? Send a note and a real person will get back to you within one business day.</p>
      <ul class="details" data-reveal data-delay="180">
        <li><span class="ic"><i data-icon="mail"></i></span><div><strong>Email</strong><a href="mailto:hello@northwind.co">hello@northwind.co</a></div></li>
        <li><span class="ic"><i data-icon="phone"></i></span><div><strong>Phone</strong><a href="tel:+15550134000">+1 (555) 013-4000</a></div></li>
        <li><span class="ic"><i data-icon="map-pin"></i></span><div><strong>Studio</strong><span class="at-muted">120 Market Street, Portland, OR</span></div></li>
      </ul>
      <img class="at-media map" src="assets/ph/900x420-11.svg" alt="Map showing our location" data-reveal>
    </div>
    <form data-at-form name="contact" class="at-card form" data-reveal="zoom">
      <div class="two"><label class="at-field">Name<input class="at-input" name="name" required autocomplete="name"></label><label class="at-field">Email<input class="at-input" type="email" name="email" required autocomplete="email"></label></div>
      <label class="at-field">Subject<select class="at-input" name="subject"><option>General question</option><option>New project</option><option>Support</option><option>Press</option></select></label>
      <label class="at-field">Message<textarea class="at-input" name="message" rows="6" required placeholder="Tell us a little about what you need…"></textarea></label>
      <button type="submit" class="at-btn at-btn-primary at-btn-lg">Send message <i data-icon="send"></i></button>
    </form>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .grid { display: grid; gap: clamp(36px, 5vw, 72px); }
@media (min-width: 960px) { & .grid { grid-template-columns: 1fr 1.1fr; align-items: start; } }
& .info { gap: 20px; }
& .details { list-style: none; display: flex; flex-direction: column; gap: 16px; margin-top: 8px; }
& .details li { display: flex; gap: 14px; align-items: center; }
& .details strong { display: block; font-size: .82rem; color: var(--at-muted); font-weight: 500; }
& .details a { color: var(--at-text); text-decoration: none; font-weight: 600; }
& .details a:hover { color: var(--at-primary); }
& .ic { display: grid; place-items: center; width: 44px; height: 44px; flex: none; border-radius: 12px; background: color-mix(in srgb, var(--at-primary) 12%, transparent); color: var(--at-primary); font-size: 19px; }
& .map { aspect-ratio: 15 / 7; margin-top: 8px; border: 1px solid var(--at-border); }
& .form { display: flex; flex-direction: column; gap: 16px; box-shadow: var(--at-shadow-lg); }
& .two { display: grid; gap: 16px; }
@media (min-width: 520px) { & .two { grid-template-columns: 1fr 1fr; } }`,
  },
  {
    type: 'newsletter', name: 'Newsletter', category: 'Contact', tags: ['email', 'subscribe', 'blog'],
    description: 'A compact newsletter card: heading, line of copy and an inline email field.',
    html: `<section class="news">
  <div class="at-container">
    <div class="box" data-reveal="zoom">
      <div class="at-stack copy"><span class="ic"><i data-icon="mail"></i></span><h2 class="title">Get the good stuff, monthly</h2><p class="at-muted">One thoughtful email a month with product news, guides and stories. Unsubscribe any time.</p></div>
      <form data-at-form name="newsletter" class="f">
        <label class="at-sr" for="nl-email">Email address</label>
        <input id="nl-email" class="at-input" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
        <button type="submit" class="at-btn at-btn-primary">Subscribe</button>
      </form>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .box { display: grid; gap: 28px; align-items: center; padding: clamp(28px, 4vw, 56px); border-radius: calc(var(--at-radius) + 6px); background: var(--at-surface); border: 1px solid var(--at-border); position: relative; overflow: hidden; }
& .box::before { content: ""; position: absolute; right: -120px; top: -120px; width: 320px; height: 320px; border-radius: 50%; background: var(--at-grad); filter: blur(90px); opacity: .25; }
@media (min-width: 900px) { & .box { grid-template-columns: 1.2fr 1fr; gap: 56px; } }
& .copy { gap: 12px; position: relative; }
& .ic { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; background: var(--at-grad); color: var(--at-primary-text); font-size: 21px; }
& .title { font-size: clamp(1.5rem, 1.3rem + 1vw, 2.2rem); }
& .f { display: flex; gap: 10px; position: relative; }
& .f .at-input { flex: 1; min-width: 0; }
@media (max-width: 480px) { & .f { flex-direction: column; } }`,
  },
  {
    type: 'coming-soon', name: 'Coming soon', category: 'CTA', tags: ['launch', 'waitlist', 'placeholder'],
    description: 'A full-height teaser page section with a countdown-style date, short pitch and signup.',
    html: `<section class="soon">
  <div class="at-container narrow at-center inner">
    <span class="at-badge" data-reveal><i data-icon="clock"></i> Launching spring 2027</span>
    <h1 class="at-h1" data-reveal data-delay="80">Something new is <span class="at-gradient-text">on the way</span></h1>
    <p class="at-lead" data-reveal data-delay="160">We’re putting the finishing touches on Northwind. Leave your email and you’ll be the first to know.</p>
    <form data-at-form name="launch" class="f" data-reveal data-delay="240"><label class="at-sr" for="cs-email">Email address</label><input id="cs-email" class="at-input" type="email" name="email" required placeholder="you@example.com"><button type="submit" class="at-btn at-btn-primary">Notify me</button></form>
    <div class="soc" data-reveal data-delay="300"><a href="#" aria-label="Instagram"><i data-icon="instagram"></i></a><a href="#" aria-label="X"><i data-icon="x-twitter"></i></a><a href="#" aria-label="LinkedIn"><i data-icon="linkedin"></i></a></div>
  </div>
</section>`,
    css: `& { min-height: 86vh; display: flex; align-items: center; padding: var(--at-pad) 0; position: relative; overflow: hidden; isolation: isolate; }
&::before { content: ""; position: absolute; inset: auto -20% -50% -20%; height: 90%; z-index: -1; background: var(--at-grad); filter: blur(140px); opacity: .28; border-radius: 50%; }
& .inner { display: flex; flex-direction: column; align-items: center; gap: 22px; }
& .f { display: flex; gap: 10px; width: 100%; max-width: 480px; }
& .f .at-input { flex: 1; min-width: 0; }
@media (max-width: 480px) { & .f { flex-direction: column; } }
& .soc { display: flex; gap: 8px; margin-top: 10px; }
& .soc a { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--at-border); color: var(--at-muted); font-size: 17px; }
& .soc a:hover { color: var(--at-text); border-color: var(--at-text); opacity: 1; }`,
  },
];

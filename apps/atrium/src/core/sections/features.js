// Atrium sections — logos and features.
'use strict';

const HEAD = (eyebrow, title, lead) => `<div class="head at-center at-stack">
      <span class="at-eyebrow" data-reveal>${eyebrow}</span>
      <h2 class="at-h2" data-reveal data-delay="60">${title}</h2>
      <p class="at-lead" data-reveal data-delay="120">${lead}</p>
    </div>`;
const HEAD_CSS = `& .head { align-items: center; margin-bottom: clamp(36px, 5vw, 64px); }
& .head h2 { max-width: 20ch; }`;

const LOGOS = [['zap', 'Voltage'], ['globe', 'Orbitly'], ['layers', 'Stacked'], ['leaf', 'Greenhouse'], ['compass', 'Northstar'], ['cloud', 'Nimbus'], ['target', 'Bullseye'], ['sparkles', 'Lumina']];
const logoItems = LOGOS.map(([i, n]) => `<span class="logo"><i data-icon="${i}"></i>${n}</span>`).join('');

module.exports = [
  {
    type: 'logos-marquee', name: 'Logo marquee', category: 'Logos', tags: ['trust', 'saas'],
    description: 'An endless, gently scrolling strip of customer logos with a fade at the edges.',
    html: `<section class="logos">
  <div class="at-container">
    <p class="label" data-reveal>Trusted by fast-moving teams at</p>
  </div>
  <div class="at-marquee" data-reveal="fade">
    <div class="at-marquee-track">${logoItems}${logoItems.replace(/<span class="logo">/g, '<span class="logo" aria-hidden="true">')}</div>
  </div>
</section>`,
    css: `& { padding: clamp(40px, 6vw, 72px) 0; }
& .label { text-align: center; font-size: .85rem; color: var(--at-muted); margin-bottom: 26px; letter-spacing: .02em; }
& .logo { display: inline-flex; align-items: center; gap: 10px; font-family: var(--at-font-h); font-size: 1.45rem; font-weight: 700; letter-spacing: -0.03em; color: var(--at-muted); opacity: .8; white-space: nowrap; transition: opacity .2s, color .2s; }
& .logo:hover { opacity: 1; color: var(--at-text); }
& .logo .at-ic { font-size: 1.1em; }`,
  },
  {
    type: 'logos-grid', name: 'Logo grid', category: 'Logos', tags: ['trust', 'clients', 'agency'],
    description: 'A tidy bordered grid of client logos with a short heading.',
    html: `<section class="logos">
  <div class="at-container">
    <div class="wrap">
      <h2 class="title" data-reveal>Partners who build with us</h2>
      <div class="grid">${LOGOS.map(([i, n], k) => `<div class="cell" data-reveal="fade" data-delay="${k * 50}"><span class="logo"><i data-icon="${i}"></i>${n}</span></div>`).join('')}</div>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .wrap { display: grid; gap: 32px; align-items: center; }
@media (min-width: 960px) { & .wrap { grid-template-columns: 1fr 2.6fr; gap: 56px; } }
& .title { font-size: clamp(1.4rem, 1.2rem + .8vw, 1.9rem); max-width: 14ch; }
& .grid { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid var(--at-border); border-left: 1px solid var(--at-border); }
@media (min-width: 700px) { & .grid { grid-template-columns: repeat(4, 1fr); } }
& .cell { display: grid; place-items: center; min-height: 104px; border-right: 1px solid var(--at-border); border-bottom: 1px solid var(--at-border); }
& .logo { display: inline-flex; align-items: center; gap: 8px; font-family: var(--at-font-h); font-weight: 700; font-size: 1.15rem; letter-spacing: -0.02em; color: var(--at-muted); transition: color .2s; }
& .cell:hover .logo { color: var(--at-text); }`,
  },
  {
    type: 'features-cards', name: 'Feature cards', category: 'Features', tags: ['saas', 'service', 'benefits'],
    description: 'Six icon cards in a responsive grid with a centred heading — the classic benefits section.',
    html: `<section class="features" id="features">
  <div class="at-container">
    ${HEAD('Features', 'Everything you need. Nothing you don’t.', 'Thoughtful tools that work together, so your team can focus on the work that actually matters.')}
    <div class="at-grid cols-3">
      <article class="at-card card" data-reveal><span class="ic"><i data-icon="zap"></i></span><h3>Instant everything</h3><p class="at-muted">Pages load in milliseconds and sync in real time across every device your team uses.</p></article>
      <article class="at-card card" data-reveal data-delay="80"><span class="ic"><i data-icon="shield-check"></i></span><h3>Secure by default</h3><p class="at-muted">SSO, audit logs and encryption at rest. Enterprise-grade security without the paperwork.</p></article>
      <article class="at-card card" data-reveal data-delay="160"><span class="ic"><i data-icon="sparkles"></i></span><h3>AI that helps</h3><p class="at-muted">Summaries, drafts and smart suggestions that save hours — never in your way.</p></article>
      <article class="at-card card" data-reveal><span class="ic"><i data-icon="layers"></i></span><h3>Works with your stack</h3><p class="at-muted">Connect 120+ tools in a click, from Slack and Google to Salesforce and GitHub.</p></article>
      <article class="at-card card" data-reveal data-delay="80"><span class="ic"><i data-icon="chart"></i></span><h3>Insight at a glance</h3><p class="at-muted">Beautiful dashboards show progress, bottlenecks and wins without a single spreadsheet.</p></article>
      <article class="at-card card" data-reveal data-delay="160"><span class="ic"><i data-icon="headset"></i></span><h3>Humans on support</h3><p class="at-muted">Real people answer in minutes, 24/7. No bots, no ticket queues, no runaround.</p></article>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .card { display: flex; flex-direction: column; gap: 12px; }
& .card:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--at-primary) 40%, var(--at-border)); box-shadow: var(--at-shadow-lg); }
& .ic { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; font-size: 22px; color: var(--at-primary); background: color-mix(in srgb, var(--at-primary) 13%, transparent); border: 1px solid color-mix(in srgb, var(--at-primary) 22%, transparent); margin-bottom: 6px; }
& h3 { font-size: 1.15rem; }
& p { font-size: .97rem; }`,
  },
  {
    type: 'features-bento', name: 'Bento features', category: 'Features', tags: ['saas', 'product', 'modern'],
    description: 'An asymmetric bento grid: a large picture tile, a stat tile, a checklist tile and accent tiles.',
    html: `<section class="features" id="features">
  <div class="at-container">
    ${HEAD('Why Northwind', 'Built for the way modern teams work', 'One home for plans, docs and decisions — designed to stay fast and simple as you grow.')}
    <div class="bento">
      <article class="tile t1" data-reveal><div class="txt"><h3>A home for every project</h3><p class="at-muted">Boards, timelines and docs in one place, linked automatically.</p></div><img class="at-media" src="assets/ph/1200x700-2.svg" alt="Project board"></article>
      <article class="tile t2" data-reveal data-delay="80"><span class="big"><span data-count="99.99" data-suffix="%">99.99%</span></span><h3>Uptime, guaranteed</h3><p class="at-muted">Redundant infrastructure across three regions.</p></article>
      <article class="tile t3" data-reveal data-delay="120"><h3>Automations</h3><ul class="at-check-list"><li>Assign work on arrival</li><li>Nudge owners before deadlines</li><li>Post weekly digests to Slack</li></ul></article>
      <article class="tile t4 grad" data-reveal data-delay="160"><i data-icon="sparkles"></i><h3>AI copilot</h3><p>Ask anything about your projects and get answers with sources.</p></article>
      <article class="tile t5" data-reveal data-delay="200"><i data-icon="globe" class="soft"></i><h3>Global by design</h3><p class="at-muted">30 languages, every time zone, any currency.</p></article>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .bento { display: grid; gap: 16px; grid-template-columns: 1fr; }
& .tile { position: relative; display: flex; flex-direction: column; gap: 10px; padding: clamp(22px, 2.6vw, 32px); border-radius: var(--at-radius); background: var(--at-surface); border: 1px solid var(--at-border); overflow: hidden; transition: transform .3s, border-color .3s; }
& .tile:hover { border-color: color-mix(in srgb, var(--at-primary) 35%, var(--at-border)); }
& .tile h3 { font-size: 1.2rem; }
& .t1 img { margin-top: 14px; aspect-ratio: 16 / 9; border: 1px solid var(--at-border); }
& .t2 .big { font-family: var(--at-font-h); font-size: clamp(2.8rem, 2rem + 2.4vw, 4rem); font-weight: var(--at-h-weight); letter-spacing: -0.045em; line-height: 1; margin-bottom: auto; padding-bottom: 18px; }
& .grad { background: var(--at-grad); color: var(--at-primary-text); border: 0; }
& .grad h3 { color: inherit; }
& .grad p { opacity: .88; }
& .tile > .at-ic { font-size: 30px; margin-bottom: auto; padding-bottom: 18px; }
& .soft { color: var(--at-primary); }
@media (min-width: 760px) { & .bento { grid-template-columns: repeat(2, 1fr); } & .t1 { grid-column: 1 / -1; } }
@media (min-width: 1040px) {
  & .bento { grid-template-columns: repeat(3, 1fr); }
  & .t1 { grid-column: 1 / 3; grid-row: 1 / 3; }
  & .t1 img { margin-top: auto; }
}`,
  },
  {
    type: 'features-alternating', name: 'Alternating rows', category: 'Features', tags: ['product', 'service', 'story'],
    description: 'Three picture-and-text rows that alternate sides, each with an eyebrow, heading, copy and checklist.',
    html: `<section class="features">
  <div class="at-container rows">
    <div class="row" data-reveal>
      <img class="at-media" src="assets/ph/1100x800-6.svg" alt="Planning view">
      <div class="at-stack copy"><span class="at-eyebrow">Plan</span><h2 class="at-h2">See the whole picture before you start.</h2><p class="at-lead">Map goals to projects and projects to people. Everyone knows what matters this week — and why.</p><ul class="at-check-list"><li>Roadmaps that update themselves</li><li>Priorities everyone can see</li></ul></div>
    </div>
    <div class="row flip" data-reveal>
      <img class="at-media" src="assets/ph/1100x800-7.svg" alt="Collaboration view">
      <div class="at-stack copy"><span class="at-eyebrow">Collaborate</span><h2 class="at-h2">Work together without the meetings.</h2><p class="at-lead">Comments, approvals and handoffs live right next to the work, so decisions never get lost in chat.</p><ul class="at-check-list"><li>Threaded feedback on anything</li><li>One-click approvals</li></ul></div>
    </div>
    <div class="row" data-reveal>
      <img class="at-media" src="assets/ph/1100x800-8.svg" alt="Reporting view">
      <div class="at-stack copy"><span class="at-eyebrow">Measure</span><h2 class="at-h2">Know what’s working, instantly.</h2><p class="at-lead">Live reports show progress and impact the moment work moves — share them with a link.</p><ul class="at-check-list"><li>Dashboards in seconds</li><li>Weekly reports to your inbox</li></ul></div>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .rows { display: flex; flex-direction: column; gap: clamp(56px, 8vw, 120px); }
& .row { display: grid; gap: clamp(28px, 5vw, 72px); align-items: center; }
& .row img { aspect-ratio: 11 / 8; border: 1px solid var(--at-border); box-shadow: var(--at-shadow); }
& .copy { gap: 18px; }
@media (min-width: 900px) {
  & .row { grid-template-columns: 1.1fr 1fr; }
  & .row.flip img { order: 2; }
}`,
  },
  {
    type: 'features-tabs', name: 'Feature tabs', category: 'Features', tags: ['product', 'saas', 'interactive'],
    description: 'Tabbed showcase: pick a tab to swap the picture and description (tiny script, keyboard friendly).',
    html: `<section class="features">
  <div class="at-container">
    ${HEAD('Tour', 'One workspace, every workflow', 'Switch between views to see how Northwind adapts to the way each team works.')}
    <div class="tabs" role="tablist" aria-label="Product views" data-reveal>
      <button role="tab" aria-selected="true" id="ft-t1" aria-controls="ft-p1"><i data-icon="layout"></i> Boards</button>
      <button role="tab" aria-selected="false" id="ft-t2" aria-controls="ft-p2"><i data-icon="calendar"></i> Timeline</button>
      <button role="tab" aria-selected="false" id="ft-t3" aria-controls="ft-p3"><i data-icon="file"></i> Docs</button>
      <button role="tab" aria-selected="false" id="ft-t4" aria-controls="ft-p4"><i data-icon="bar-chart"></i> Reports</button>
    </div>
    <div class="panels" data-reveal="zoom">
      <div role="tabpanel" id="ft-p1" aria-labelledby="ft-t1" class="panel"><div class="at-stack"><h3>Boards that stay tidy</h3><p class="at-muted">Drag cards between stages, group by owner or priority, and let automations handle the busywork.</p></div><img class="at-media" src="assets/ph/1200x750-1.svg" alt="Boards view"></div>
      <div role="tabpanel" id="ft-p2" aria-labelledby="ft-t2" class="panel" hidden><div class="at-stack"><h3>Timelines that adjust</h3><p class="at-muted">Move one date and every dependency follows. See conflicts before they become problems.</p></div><img class="at-media" src="assets/ph/1200x750-2.svg" alt="Timeline view"></div>
      <div role="tabpanel" id="ft-p3" aria-labelledby="ft-t3" class="panel" hidden><div class="at-stack"><h3>Docs that do things</h3><p class="at-muted">Embed live tasks, tables and charts right inside your writing. Specs and work stay in sync.</p></div><img class="at-media" src="assets/ph/1200x750-3.svg" alt="Docs view"></div>
      <div role="tabpanel" id="ft-p4" aria-labelledby="ft-t4" class="panel" hidden><div class="at-stack"><h3>Reports that write themselves</h3><p class="at-muted">Weekly summaries land in your inbox with the numbers and the story behind them.</p></div><img class="at-media" src="assets/ph/1200x750-4.svg" alt="Reports view"></div>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .tabs { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; width: fit-content; max-width: 100%; margin: 0 auto 28px; padding: 6px; border-radius: 999px; background: var(--at-surface-2); border: 1px solid var(--at-border); }
& [role=tab] { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; border: 0; background: transparent; color: var(--at-muted); font-weight: 600; font-size: .92rem; transition: background .2s, color .2s, box-shadow .2s; }
& [role=tab]:hover { color: var(--at-text); }
& [role=tab][aria-selected=true] { background: var(--at-surface); color: var(--at-text); box-shadow: var(--at-shadow); }
& .panel { display: grid; gap: 28px; align-items: center; padding: clamp(20px, 3vw, 40px); border-radius: calc(var(--at-radius) + 6px); background: var(--at-surface); border: 1px solid var(--at-border); animation: ftabs-in .4s cubic-bezier(.2,.8,.2,1); }
& .panel[hidden] { display: none; }
& .panel img { aspect-ratio: 16 / 10; border: 1px solid var(--at-border); }
& .panel h3 { font-size: clamp(1.4rem, 1.2rem + .8vw, 1.9rem); }
@media (min-width: 900px) { & .panel { grid-template-columns: 1fr 1.6fr; gap: 48px; } }
@keyframes ftabs-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`,
    js: `var tabs = root.querySelectorAll('[role=tab]'), panels = root.querySelectorAll('[role=tabpanel]');
function pick(i) { tabs.forEach(function (t, j) { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; if (panels[j]) panels[j].hidden = i !== j; }); }
tabs.forEach(function (t, i) {
  t.addEventListener('click', function () { pick(i); });
  t.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; pick(n); tabs[n].focus(); } });
});`,
  },
  {
    type: 'features-steps', name: 'Steps / how it works', category: 'Features', tags: ['process', 'service', 'onboarding'],
    description: 'Four numbered steps joined by a line — how it works, onboarding or a process.',
    html: `<section class="steps">
  <div class="at-container">
    ${HEAD('How it works', 'From sign-up to shipped in four steps', 'No consultants, no migration headaches. Most teams are up and running the same afternoon.')}
    <ol class="list">
      <li data-reveal><span class="n">01</span><h3>Create your space</h3><p class="at-muted">Sign up with Google or email and invite your team in seconds.</p></li>
      <li data-reveal data-delay="90"><span class="n">02</span><h3>Bring your work</h3><p class="at-muted">Import from Trello, Asana or a spreadsheet with one click.</p></li>
      <li data-reveal data-delay="180"><span class="n">03</span><h3>Automate the busywork</h3><p class="at-muted">Pick from 60 ready-made automations or describe your own.</p></li>
      <li data-reveal data-delay="270"><span class="n">04</span><h3>Ship with confidence</h3><p class="at-muted">Track progress live and celebrate every launch together.</p></li>
    </ol>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .list { list-style: none; display: grid; gap: 28px; counter-reset: s; position: relative; }
@media (min-width: 900px) {
  & .list { grid-template-columns: repeat(4, 1fr); gap: 24px; }
  & .list::before { content: ""; position: absolute; top: 27px; left: 28px; right: 12%; height: 1px; background: linear-gradient(90deg, var(--at-primary), color-mix(in srgb, var(--at-accent) 40%, transparent)); }
}
& li { position: relative; display: flex; flex-direction: column; gap: 10px; }
& .n { position: relative; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--at-surface); border: 1px solid color-mix(in srgb, var(--at-primary) 45%, var(--at-border)); color: var(--at-primary); font-family: var(--at-font-h); font-weight: 700; font-size: 1.05rem; margin-bottom: 8px; box-shadow: 0 0 0 6px var(--at-bg); }
& h3 { font-size: 1.15rem; }`,
  },
  {
    type: 'features-comparison', name: 'Comparison table', category: 'Features', tags: ['saas', 'pricing', 'versus'],
    description: 'Us-versus-them table with check and cross marks and a highlighted column.',
    html: `<section class="compare">
  <div class="at-container narrow">
    ${HEAD('Compare', 'Why teams switch to Northwind', 'Same price as the usual stack of five tools — with far less to manage.')}
    <div class="table-wrap" data-reveal>
      <table>
        <thead><tr><th scope="col">Feature</th><th scope="col" class="us">Northwind</th><th scope="col">Others</th></tr></thead>
        <tbody>
          <tr><th scope="row">Projects, docs &amp; chat in one place</th><td class="us"><i data-icon="check" aria-label="Yes"></i></td><td><i data-icon="x" aria-label="No"></i></td></tr>
          <tr><th scope="row">Built-in AI assistant</th><td class="us"><i data-icon="check" aria-label="Yes"></i></td><td>Paid add-on</td></tr>
          <tr><th scope="row">Unlimited guests</th><td class="us"><i data-icon="check" aria-label="Yes"></i></td><td><i data-icon="x" aria-label="No"></i></td></tr>
          <tr><th scope="row">Real-time sync</th><td class="us"><i data-icon="check" aria-label="Yes"></i></td><td><i data-icon="check" aria-label="Yes"></i></td></tr>
          <tr><th scope="row">24/7 human support</th><td class="us"><i data-icon="check" aria-label="Yes"></i></td><td>Business hours</td></tr>
          <tr><th scope="row">Setup time</th><td class="us"><strong>Minutes</strong></td><td>Weeks</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
${HEAD_CSS}
& .table-wrap { overflow-x: auto; border-radius: var(--at-radius); border: 1px solid var(--at-border); background: var(--at-surface); }
& table { min-width: 520px; font-size: .96rem; }
& th, & td { padding: 16px 20px; text-align: left; border-bottom: 1px solid var(--at-border); }
& tbody tr:last-child th, & tbody tr:last-child td { border-bottom: 0; }
& thead th { font-size: .8rem; text-transform: uppercase; letter-spacing: .1em; color: var(--at-muted); font-weight: 600; }
& tbody th { font-weight: 500; }
& td { color: var(--at-muted); text-align: center; width: 24%; }
& thead th:not(:first-child) { text-align: center; }
& .us { background: color-mix(in srgb, var(--at-primary) 8%, transparent); color: var(--at-text); }
& thead .us { color: var(--at-primary); }
& td .at-ic { font-size: 20px; margin: 0 auto; }
& td.us .at-ic { color: var(--at-primary); }`,
  },
  {
    type: 'features-sticky', name: 'Sticky heading list', category: 'Features', tags: ['service', 'agency', 'capabilities'],
    description: 'A sticky heading on the left while a list of capabilities with icons scrolls past on the right.',
    html: `<section class="sticky">
  <div class="at-container grid">
    <div class="side">
      <div class="at-stack">
        <span class="at-eyebrow" data-reveal>Capabilities</span>
        <h2 class="at-h2" data-reveal data-delay="60">What we do best</h2>
        <p class="at-lead" data-reveal data-delay="120">A senior team across strategy, design and engineering — working as one, from first sketch to launch day.</p>
        <a href="contact.html" class="at-btn at-btn-primary" data-reveal data-delay="180">Tell us about your project</a>
      </div>
    </div>
    <div class="items">
      <div class="item" data-reveal><i data-icon="compass"></i><div><h3>Brand strategy</h3><p class="at-muted">Positioning, naming and messaging that makes you the obvious choice.</p></div></div>
      <div class="item" data-reveal><i data-icon="palette"></i><div><h3>Visual identity</h3><p class="at-muted">Logos, type systems and guidelines built to scale across every touchpoint.</p></div></div>
      <div class="item" data-reveal><i data-icon="layout"></i><div><h3>Websites &amp; products</h3><p class="at-muted">Fast, accessible sites and apps designed to convert and built to last.</p></div></div>
      <div class="item" data-reveal><i data-icon="video"></i><div><h3>Motion &amp; film</h3><p class="at-muted">Launch films, product animations and social content with real craft.</p></div></div>
      <div class="item" data-reveal><i data-icon="trending-up"></i><div><h3>Growth</h3><p class="at-muted">Experiments, analytics and content that compound month after month.</p></div></div>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .grid { display: grid; gap: 40px; }
@media (min-width: 960px) { & .grid { grid-template-columns: 1fr 1.25fr; gap: 80px; } & .side > div { position: sticky; top: 110px; } }
& .items { display: flex; flex-direction: column; }
& .item { display: flex; gap: 20px; padding: 28px 0; border-top: 1px solid var(--at-border); }
& .item:last-child { border-bottom: 1px solid var(--at-border); }
& .item > .at-ic { font-size: 26px; color: var(--at-primary); margin-top: 3px; }
& .item h3 { margin-bottom: 6px; }`,
  },
];

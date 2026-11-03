// Atrium sections — heroes.
'use strict';

module.exports = [
  {
    type: 'hero-split', name: 'Split hero', category: 'Hero', tags: ['saas', 'product', 'service'],
    description: 'Headline, lead and buttons on the left; a product picture with a glow and a floating stat card on the right.',
    html: `<section class="hero">
  <div class="at-container grid">
    <div class="copy at-stack">
      <span class="at-badge" data-reveal><i data-icon="sparkles"></i> New: automations that write themselves</span>
      <h1 class="at-h1" data-reveal data-delay="80">Run your whole business from one calm place.</h1>
      <p class="at-lead" data-reveal data-delay="160">Northwind brings projects, clients and payments together, so your team spends less time switching tabs and more time doing great work.</p>
      <div class="at-row" data-reveal data-delay="240">
        <a href="contact.html" class="at-btn at-btn-primary at-btn-lg">Start free trial <i data-icon="arrow-right"></i></a>
        <a href="#features" class="at-btn at-btn-outline at-btn-lg"><i data-icon="play-circle"></i> Watch the tour</a>
      </div>
      <div class="trust" data-reveal data-delay="320">
        <div class="avatars"><img src="assets/ph/96x96-2.svg" alt=""><img src="assets/ph/96x96-5.svg" alt=""><img src="assets/ph/96x96-8.svg" alt=""><img src="assets/ph/96x96-11.svg" alt=""></div>
        <div><div class="stars" aria-label="Rated 4.9 out of 5"><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i></div><span class="at-muted">Loved by 12,000+ teams</span></div>
      </div>
    </div>
    <div class="visual at-glow" data-reveal="zoom" data-delay="150">
      <img class="at-media shot" src="assets/ph/1200x900-1.svg" alt="The Northwind dashboard">
      <div class="float at-glass"><span class="ic"><i data-icon="trending-up"></i></span><div><strong>+38%</strong><span class="at-muted">faster delivery</span></div></div>
    </div>
  </div>
</section>`,
    css: `& { padding: calc(var(--at-pad) * 1.1) 0 var(--at-pad); overflow: hidden; }
& .grid { display: grid; gap: clamp(40px, 6vw, 80px); align-items: center; }
@media (min-width: 960px) { & .grid { grid-template-columns: 1.05fr 1fr; } }
& .copy { gap: 22px; }
& .trust { display: flex; align-items: center; gap: 14px; font-size: .9rem; margin-top: 6px; }
& .avatars { display: flex; }
& .avatars img { width: 38px; height: 38px; border-radius: 50%; border: 2px solid var(--at-bg); margin-left: -10px; object-fit: cover; }
& .avatars img:first-child { margin-left: 0; }
& .stars { display: flex; gap: 2px; color: #f5b83d; font-size: 14px; }
& .stars svg { fill: currentColor; }
& .visual { position: relative; }
& .shot { aspect-ratio: 4 / 3; border: 1px solid var(--at-border); box-shadow: var(--at-shadow-lg); }
& .float { position: absolute; left: -18px; bottom: 28px; display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: var(--at-radius); box-shadow: var(--at-shadow-lg); animation: herosplit-bob 6s ease-in-out infinite; }
& .float strong { display: block; font-size: 1.25rem; font-family: var(--at-font-h); letter-spacing: -0.02em; }
& .float span { font-size: .82rem; }
& .float .ic { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--at-primary); color: var(--at-primary-text); font-size: 20px; }
@media (max-width: 600px) { & .float { left: 10px; bottom: 10px; } }
@keyframes herosplit-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }`,
  },
  {
    type: 'hero-centered', name: 'Centred gradient hero', category: 'Hero', tags: ['saas', 'launch', 'startup'],
    description: 'Big centred headline with gradient words, a badge, two buttons and a glowing product shot on a fine grid.',
    html: `<section class="hero">
  <div class="bg" aria-hidden="true"></div>
  <div class="at-container at-center inner">
    <a href="blog/index.html" class="at-badge pill" data-reveal><span class="new">New</span> Northwind 3.0 is live <i data-icon="arrow-right"></i></a>
    <h1 class="at-h1 title" data-reveal data-delay="80">The workspace that <span class="at-gradient-text">thinks ahead</span></h1>
    <p class="at-lead" data-reveal data-delay="160">Plan, build and ship with a workspace that understands your team. Northwind turns scattered work into one clear, beautiful flow.</p>
    <div class="at-row" data-reveal data-delay="240">
      <a href="contact.html" class="at-btn at-btn-primary at-btn-lg">Get started — it’s free</a>
      <a href="pricing.html" class="at-btn at-btn-ghost at-btn-lg">See pricing <i data-icon="arrow-right"></i></a>
    </div>
    <p class="note at-muted" data-reveal data-delay="300">No credit card required · Set up in 2 minutes</p>
    <div class="shot-wrap at-glow" data-reveal="zoom" data-delay="200">
      <img class="at-media shot" src="assets/ph/1600x1000-3.svg" alt="Northwind product screenshot">
    </div>
  </div>
</section>`,
    css: `& { position: relative; padding: calc(var(--at-pad) * 1.25) 0 var(--at-pad); overflow: hidden; isolation: isolate; }
& .bg { position: absolute; inset: 0; z-index: -1; background-image: linear-gradient(color-mix(in srgb, var(--at-text) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--at-text) 6%, transparent) 1px, transparent 1px); background-size: 56px 56px; -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 0%, #000 30%, transparent 75%); mask-image: radial-gradient(ellipse 70% 60% at 50% 0%, #000 30%, transparent 75%); }
& .bg::after { content: ""; position: absolute; left: 50%; top: -20%; width: 70%; height: 60%; transform: translateX(-50%); background: var(--at-grad); filter: blur(120px); opacity: .25; }
& .inner { display: flex; flex-direction: column; align-items: center; gap: 24px; }
& .title { max-width: 14ch; }
& .pill { text-decoration: none; padding: 5px 14px 5px 5px; }
& .pill .new { padding: 3px 10px; border-radius: 999px; background: var(--at-primary); color: var(--at-primary-text); font-size: .74rem; font-weight: 700; }
& .note { font-size: .85rem; }
& .shot-wrap { width: 100%; max-width: 1080px; margin-top: clamp(24px, 4vw, 48px); padding: 10px; border-radius: calc(var(--at-radius) + 10px); background: color-mix(in srgb, var(--at-surface) 70%, transparent); border: 1px solid var(--at-border); }
& .shot { aspect-ratio: 16 / 10; }`,
  },
  {
    type: 'hero-media', name: 'Full-bleed media hero', category: 'Hero', tags: ['restaurant', 'travel', 'photography', 'event', 'video'],
    description: 'Edge-to-edge picture (or swap in a <video>) with a soft dark overlay and the headline anchored bottom-left.',
    html: `<section class="hero">
  <img class="bg-media" src="assets/ph/1920x1080-5.svg" alt="">
  <div class="shade" aria-hidden="true"></div>
  <div class="at-container content">
    <span class="at-eyebrow kicker" data-reveal>Since 2014 · Portland</span>
    <h1 class="at-h1" data-reveal data-delay="80">Made slowly. Shared generously.</h1>
    <p class="lead" data-reveal data-delay="160">Seasonal plates, natural wine and a long table waiting for you. Northwind Kitchen is where the neighbourhood gathers.</p>
    <div class="at-row" data-reveal data-delay="240">
      <a href="contact.html" class="at-btn at-btn-primary at-btn-lg">Reserve a table</a>
      <a href="menu.html" class="at-btn at-btn-lg glassbtn">View the menu</a>
    </div>
  </div>
  <a href="#next" class="scroll" aria-label="Scroll down"><i data-icon="arrow-down"></i></a>
</section>`,
    css: `& { position: relative; min-height: min(92vh, 900px); display: flex; align-items: flex-end; color: #fff; overflow: hidden; isolation: isolate; }
& .bg-media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; transform: scale(1.04); animation: heromedia-zoom 18s ease-out forwards; }
& .shade { position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.25) 40%, rgba(0,0,0,.78) 100%); }
& .content { display: flex; flex-direction: column; gap: 22px; padding-bottom: clamp(56px, 9vw, 110px); padding-top: 140px; }
& h1 { color: #fff; max-width: 13ch; }
& .kicker { color: rgba(255,255,255,.85); }
& .lead { font-size: clamp(1.05rem, 1rem + .4vw, 1.3rem); max-width: 52ch; color: rgba(255,255,255,.82); line-height: 1.55; }
& .glassbtn { background: rgba(255,255,255,.12); color: #fff; border-color: rgba(255,255,255,.3); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
& .glassbtn:hover { background: rgba(255,255,255,.2); color: #fff; }
& .scroll { position: absolute; right: clamp(20px, 4vw, 48px); bottom: clamp(56px, 9vw, 110px); display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); color: #fff; font-size: 20px; animation: heromedia-bob 2.4s ease-in-out infinite; }
@media (max-width: 700px) { & .scroll { display: none; } }
@keyframes heromedia-zoom { to { transform: scale(1); } }
@keyframes heromedia-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(6px); } }`,
  },
  {
    type: 'hero-bento', name: 'Bento hero', category: 'Hero', tags: ['agency', 'product', 'portfolio'],
    description: 'Headline beside a bento grid of tiles: a big picture, a live stat, a quote and a small feature tile.',
    html: `<section class="hero">
  <div class="at-container">
    <div class="top">
      <div class="at-stack">
        <span class="at-eyebrow" data-reveal>Design &amp; engineering studio</span>
        <h1 class="at-h1" data-reveal data-delay="80">We build brands people can’t stop talking about.</h1>
      </div>
      <div class="side at-stack" data-reveal data-delay="160">
        <p class="at-lead">Strategy, identity and digital products for ambitious teams. Small studio, big outcomes.</p>
        <div class="at-row"><a href="contact.html" class="at-btn at-btn-primary">Start a project <i data-icon="arrow-up-right"></i></a><a href="work.html" class="at-btn at-btn-ghost">Our work</a></div>
      </div>
    </div>
    <div class="bento">
      <figure class="tile big" data-reveal="zoom"><img class="at-media" src="assets/ph/1200x800-4.svg" alt="Featured project"><figcaption class="at-glass">Featured · Lumen rebrand</figcaption></figure>
      <div class="tile stat" data-reveal data-delay="100"><span class="num"><span data-count="140" data-suffix="+">140+</span></span><span>launches since 2016</span></div>
      <div class="tile quote" data-reveal data-delay="180"><i data-icon="quote"></i><p>“They understood our business faster than our own board did.”</p><span class="at-muted">— Maya Chen, Lumen</span></div>
      <div class="tile accent" data-reveal data-delay="260"><i data-icon="award"></i><strong>Awwwards</strong><span>Site of the Day ×6</span></div>
    </div>
  </div>
</section>`,
    css: `& { padding: calc(var(--at-pad) * 1.05) 0 var(--at-pad); }
& .top { display: grid; gap: 28px; align-items: end; margin-bottom: clamp(32px, 5vw, 56px); }
@media (min-width: 960px) { & .top { grid-template-columns: 1.5fr 1fr; gap: 64px; } }
& h1 { max-width: 15ch; }
& .bento { display: grid; gap: 14px; grid-template-columns: repeat(2, 1fr); }
& .tile { position: relative; border-radius: var(--at-radius); background: var(--at-surface); border: 1px solid var(--at-border); padding: 22px; min-height: 180px; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; overflow: hidden; }
& .big { grid-column: 1 / -1; padding: 0; min-height: 300px; }
& .big img { position: absolute; inset: 0; height: 100%; border-radius: 0; }
& .big figcaption { position: absolute; left: 16px; bottom: 16px; padding: 8px 14px; border-radius: 999px; font-size: .85rem; font-weight: 600; }
& .stat .num { font-family: var(--at-font-h); font-size: clamp(2.6rem, 2rem + 2vw, 3.6rem); font-weight: var(--at-h-weight); letter-spacing: -0.04em; line-height: 1; }
& .stat > span:last-child { color: var(--at-muted); font-size: .9rem; }
& .quote { justify-content: space-between; }
& .quote .at-ic { font-size: 26px; color: var(--at-primary); }
& .quote p { font-family: var(--at-font-h); font-size: 1.08rem; line-height: 1.4; }
& .quote span { font-size: .85rem; }
& .accent { background: var(--at-grad); color: var(--at-primary-text); border: 0; }
& .accent .at-ic { font-size: 28px; margin-bottom: auto; }
& .accent strong { font-size: 1.3rem; font-family: var(--at-font-h); }
& .accent span { opacity: .85; font-size: .9rem; }
@media (min-width: 900px) {
  & .bento { grid-template-columns: 2fr 1fr 1fr; grid-template-rows: 220px 220px; }
  & .big { grid-column: 1; grid-row: 1 / 3; min-height: 0; }
  & .quote { grid-column: 2 / 4; }
}`,
  },
  {
    type: 'hero-editorial', name: 'Editorial serif hero', category: 'Hero', tags: ['editorial', 'personal', 'magazine', 'portfolio'],
    description: 'Magazine-style: a meta line, an oversized serif headline, a wide picture and a two-column intro.',
    html: `<section class="hero">
  <div class="at-container">
    <div class="meta" data-reveal><span>Issue 07</span><span>Essays on craft &amp; work</span><span>Autumn edition</span></div>
    <h1 class="title" data-reveal data-delay="80">Good work is <em>quiet</em>, patient and made with care.</h1>
    <figure class="pic" data-reveal="zoom" data-delay="160"><img class="at-media" src="assets/ph/1800x900-9.svg" alt="A studio desk in morning light"><figcaption class="at-muted">The studio, early morning.</figcaption></figure>
    <div class="cols">
      <p class="intro" data-reveal>Northwind is a journal and studio exploring how thoughtful people build things that last — from furniture to software.</p>
      <div class="at-stack" data-reveal data-delay="100"><p class="at-muted">Each season we publish long-form essays, interviews and field notes from makers around the world. No noise, no hot takes — just ideas worth your time.</p><a href="blog/index.html" class="at-btn at-btn-outline">Read the latest issue <i data-icon="arrow-right"></i></a></div>
    </div>
  </div>
</section>`,
    css: `& { padding: calc(var(--at-pad) * 1.05) 0 var(--at-pad); }
& .meta { display: flex; flex-wrap: wrap; gap: 8px 28px; padding-bottom: 18px; border-bottom: 1px solid var(--at-border); font-size: .8rem; letter-spacing: .12em; text-transform: uppercase; color: var(--at-muted); }
& .title { margin: clamp(28px, 4vw, 52px) 0; font-size: clamp(2.8rem, 1.6rem + 5.6vw, 7rem); line-height: .96; letter-spacing: calc(var(--at-h-track) - .01em); max-width: 16ch; }
& .title em { font-style: italic; color: var(--at-primary); }
& .pic img { aspect-ratio: 2 / 1; }
& .pic figcaption { font-size: .82rem; margin-top: 10px; }
& .cols { display: grid; gap: 28px; margin-top: clamp(32px, 5vw, 56px); }
@media (min-width: 860px) { & .cols { grid-template-columns: 1.3fr 1fr; gap: 72px; } }
& .intro { font-family: var(--at-font-h); font-size: clamp(1.4rem, 1.15rem + 1vw, 2rem); line-height: 1.3; letter-spacing: -0.01em; }`,
  },
  {
    type: 'hero-signup', name: 'Signup hero', category: 'Hero', tags: ['waitlist', 'newsletter', 'launch', 'service'],
    description: 'Centred headline with an inline email signup form (wired to the site’s form settings) and social proof.',
    html: `<section class="hero">
  <div class="orb a" aria-hidden="true"></div><div class="orb b" aria-hidden="true"></div>
  <div class="at-container narrow at-center inner">
    <span class="at-badge" data-reveal><i data-icon="zap"></i> Early access opens soon</span>
    <h1 class="at-h1" data-reveal data-delay="80">Be first in line for something <span class="at-gradient-text">remarkable</span>.</h1>
    <p class="at-lead" data-reveal data-delay="160">Join the waitlist and get early access, founder pricing and a front-row seat as we build Northwind.</p>
    <form data-at-form name="signup" class="signup at-glass" data-reveal data-delay="240">
      <label class="at-sr" for="hs-email">Email address</label>
      <i data-icon="mail" class="lead-ic"></i>
      <input id="hs-email" type="email" name="email" required placeholder="you@company.com" autocomplete="email">
      <button type="submit" class="at-btn at-btn-primary">Join the waitlist</button>
    </form>
    <p class="small at-muted" data-reveal data-delay="300"><i data-icon="check-circle"></i> 4,200 people already joined · No spam, ever</p>
  </div>
</section>`,
    css: `& { position: relative; padding: calc(var(--at-pad) * 1.3) 0; overflow: hidden; isolation: isolate; }
& .orb { position: absolute; z-index: -1; width: 520px; height: 520px; border-radius: 50%; filter: blur(110px); opacity: .32; }
& .orb.a { background: var(--at-primary); top: -200px; left: -120px; }
& .orb.b { background: var(--at-accent); bottom: -260px; right: -140px; }
& .inner { display: flex; flex-direction: column; align-items: center; gap: 22px; }
& .signup { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 520px; padding: 7px 7px 7px 18px; border-radius: 999px; box-shadow: var(--at-shadow-lg); }
& .signup .lead-ic { color: var(--at-muted); font-size: 18px; }
& .signup input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 1rem; padding: 10px 4px; color: var(--at-text); }
& .signup input::placeholder { color: var(--at-muted); }
& .signup:focus-within { box-shadow: 0 0 0 4px color-mix(in srgb, var(--at-primary) 22%, transparent), var(--at-shadow-lg); }
& .small { font-size: .88rem; display: inline-flex; align-items: center; gap: 6px; }
& .small .at-ic { color: var(--at-primary); }
@media (max-width: 520px) {
  & .signup { flex-direction: column; align-items: stretch; border-radius: var(--at-radius); padding: 10px; }
  & .signup .lead-ic { display: none; }
  & .signup input { padding: 12px; }
}`,
  },
];

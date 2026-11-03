// Atrium sections — content, stats and social proof.
'use strict';

module.exports = [
  {
    type: 'content-prose', name: 'Article / rich text', category: 'Content', tags: ['about', 'story', 'legal', 'blog'],
    description: 'A readable long-form text column with headings, lists and a pull quote — about pages, policies, stories.',
    html: `<section class="prose-sec">
  <div class="at-container narrow">
    <header class="at-stack top" data-reveal>
      <span class="at-eyebrow">Our story</span>
      <h2 class="at-h2">Built by a small team that cares about the details</h2>
    </header>
    <div class="prose" data-reveal data-delay="80">
      <p>Northwind started in 2019 at a kitchen table, with a simple frustration: the tools we used every day made work feel harder than it needed to be. So we set out to build something calmer.</p>
      <h3>What we believe</h3>
      <p>Software should get out of the way. Every feature we ship has to earn its place by saving people time or helping them think more clearly.</p>
      <ul><li>Fewer, better features</li><li>Speed is a feature</li><li>Privacy is not optional</li></ul>
      <blockquote>“The best tools disappear. You only notice the work you got done.”</blockquote>
      <p>Today we are a remote team of 40 across nine countries, and we still answer support ourselves. If you have an idea or a question, we would love to hear it.</p>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .top { margin-bottom: 36px; }`,
  },
  {
    type: 'content-mission', name: 'Mission statement', category: 'Content', tags: ['about', 'brand', 'quote'],
    description: 'One big, bold statement with a highlighted phrase — for mission, manifesto or a key message.',
    html: `<section class="mission">
  <div class="at-container">
    <span class="at-eyebrow" data-reveal>Our mission</span>
    <p class="statement" data-reveal data-delay="80">We believe great work happens when people have <span class="at-gradient-text">room to think</span>. Northwind exists to give every team that room — and to make the busywork disappear.</p>
    <div class="sig" data-reveal data-delay="160"><img src="assets/ph/96x96-4.svg" alt="Portrait of Ava Lindqvist"><div><strong>Ava Lindqvist</strong><span class="at-muted">Founder &amp; CEO</span></div></div>
  </div>
</section>`,
    css: `& { padding: calc(var(--at-pad) * 1.1) 0; }
& .statement { margin: 22px 0 36px; font-family: var(--at-font-h); font-weight: var(--at-h-weight); font-size: clamp(1.8rem, 1.2rem + 2.8vw, 3.6rem); line-height: 1.12; letter-spacing: var(--at-h-track); max-width: 24ch; }
& .sig { display: flex; align-items: center; gap: 14px; }
& .sig img { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; }
& .sig strong { display: block; }
& .sig span { font-size: .9rem; }`,
  },
  {
    type: 'content-image-text', name: 'Image + text', category: 'Content', tags: ['about', 'service', 'story'],
    description: 'A tall picture beside a heading, paragraph, checklist and button, with a small overlapping stat.',
    html: `<section class="imgtext">
  <div class="at-container grid">
    <div class="media" data-reveal="zoom">
      <img class="at-media main" src="assets/ph/900x1100-10.svg" alt="Our team at work">
      <div class="chip at-glass"><strong><span data-count="12" data-suffix=" yrs">12 yrs</span></strong><span>of craft</span></div>
    </div>
    <div class="at-stack copy">
      <span class="at-eyebrow" data-reveal>About us</span>
      <h2 class="at-h2" data-reveal data-delay="60">A partner who treats your business like their own</h2>
      <p class="at-lead" data-reveal data-delay="120">We are a close-knit team of specialists who obsess over quality. You get senior people on every project, clear communication and work you will be proud to show off.</p>
      <ul class="at-check-list" data-reveal data-delay="180"><li>Senior team on every project</li><li>Transparent, fixed pricing</li><li>Support long after launch</li></ul>
      <div data-reveal data-delay="240"><a href="about.html" class="at-btn at-btn-primary">More about us <i data-icon="arrow-right"></i></a></div>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .grid { display: grid; gap: clamp(36px, 6vw, 88px); align-items: center; }
@media (min-width: 900px) { & .grid { grid-template-columns: 1fr 1.1fr; } }
& .media { position: relative; }
& .main { aspect-ratio: 9 / 11; box-shadow: var(--at-shadow-lg); }
& .chip { position: absolute; right: -14px; bottom: 32px; padding: 16px 20px; border-radius: var(--at-radius); display: flex; flex-direction: column; box-shadow: var(--at-shadow-lg); }
& .chip strong { font-family: var(--at-font-h); font-size: 1.8rem; letter-spacing: -0.03em; line-height: 1; }
& .chip > span:last-child { color: var(--at-muted); font-size: .85rem; }
@media (max-width: 600px) { & .chip { right: 10px; } }
& .copy { gap: 20px; }`,
  },
  {
    type: 'content-video', name: 'Video feature', category: 'Content', tags: ['product', 'story', 'video'],
    description: 'A heading over a large 16:9 video poster with a play button — swap in a YouTube/Vimeo embed or <video>.',
    html: `<section class="video">
  <div class="at-container">
    <div class="at-center at-stack head">
      <span class="at-eyebrow" data-reveal>See it in action</span>
      <h2 class="at-h2" data-reveal data-delay="60">Two minutes that change how you work</h2>
    </div>
    <a class="frame at-glow" href="#" aria-label="Play video" data-reveal="zoom">
      <img class="at-media" src="assets/ph/1600x900-12.svg" alt="Video preview">
      <span class="play"><i data-icon="play"></i></span>
      <span class="len at-glass">2:14</span>
    </a>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .head { align-items: center; margin-bottom: 40px; }
& .frame { position: relative; display: block; max-width: 1080px; margin: 0 auto; border-radius: calc(var(--at-radius) + 6px); }
& .frame img { aspect-ratio: 16 / 9; border-radius: calc(var(--at-radius) + 6px); border: 1px solid var(--at-border); }
& .play { position: absolute; left: 50%; top: 50%; display: grid; place-items: center; width: 88px; height: 88px; border-radius: 50%; transform: translate(-50%, -50%); background: var(--at-primary); color: var(--at-primary-text); font-size: 30px; box-shadow: 0 0 0 12px color-mix(in srgb, var(--at-primary) 25%, transparent), var(--at-shadow-lg); transition: transform .3s; }
& .play svg { fill: currentColor; margin-left: 4px; }
& .frame:hover { opacity: 1; }
& .frame:hover .play { transform: translate(-50%, -50%) scale(1.08); }
& .len { position: absolute; right: 16px; bottom: 16px; padding: 5px 12px; border-radius: 999px; font-size: .82rem; font-weight: 600; color: var(--at-text); }`,
  },
  {
    type: 'stats-row', name: 'Stats row', category: 'Stats', tags: ['numbers', 'trust', 'about'],
    description: 'Four big numbers that count up when they scroll into view, separated by hairlines.',
    html: `<section class="stats">
  <div class="at-container">
    <div class="row">
      <div class="stat" data-reveal><span class="num"><span data-count="12000" data-suffix="+">12,000+</span></span><span class="lbl">teams on Northwind</span></div>
      <div class="stat" data-reveal data-delay="80"><span class="num"><span data-count="98" data-suffix="%">98%</span></span><span class="lbl">customer satisfaction</span></div>
      <div class="stat" data-reveal data-delay="160"><span class="num"><span data-count="4" data-suffix="h">4h</span></span><span class="lbl">saved per person, weekly</span></div>
      <div class="stat" data-reveal data-delay="240"><span class="num"><span data-count="30" data-suffix="+">30+</span></span><span class="lbl">countries served</span></div>
    </div>
  </div>
</section>`,
    css: `& { padding: clamp(48px, 7vw, 88px) 0; }
& .row { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid var(--at-border); border-bottom: 1px solid var(--at-border); }
@media (min-width: 900px) { & .row { grid-template-columns: repeat(4, 1fr); } }
& .stat { display: flex; flex-direction: column; gap: 6px; padding: clamp(24px, 3vw, 40px) clamp(14px, 2vw, 28px); }
& .stat + .stat { border-left: 1px solid var(--at-border); }
@media (max-width: 899px) { & .stat:nth-child(3) { border-left: 0; } & .stat:nth-child(n+3) { border-top: 1px solid var(--at-border); } }
& .num { font-family: var(--at-font-h); font-weight: var(--at-h-weight); font-size: clamp(2.2rem, 1.6rem + 2.4vw, 3.6rem); letter-spacing: -0.045em; line-height: 1; }
& .lbl { color: var(--at-muted); font-size: .93rem; }`,
  },
  {
    type: 'stats-band', name: 'Stats band', category: 'Stats', tags: ['numbers', 'impact', 'bold'],
    description: 'A bold gradient band with a heading and three large figures — impact or results.',
    html: `<section class="band">
  <div class="at-container">
    <div class="box" data-reveal="zoom">
      <h2 class="at-h2 title">Results our customers see in the first 90 days</h2>
      <div class="nums">
        <div><span class="n"><span data-count="3" data-suffix="×">3×</span></span><span>faster project delivery</span></div>
        <div><span class="n"><span data-count="47" data-suffix="%">47%</span></span><span>fewer status meetings</span></div>
        <div><span class="n">$<span data-count="18" data-suffix="k">18k</span></span><span>saved on tools per year</span></div>
      </div>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .box { position: relative; overflow: hidden; padding: clamp(32px, 5vw, 72px); border-radius: calc(var(--at-radius) + 8px); background: var(--at-grad); color: var(--at-primary-text); }
& .box::after { content: ""; position: absolute; right: -10%; top: -40%; width: 60%; height: 140%; background: radial-gradient(closest-side, rgba(255,255,255,.22), transparent); pointer-events: none; }
& .title { color: inherit; max-width: 20ch; margin-bottom: clamp(28px, 4vw, 48px); }
& .nums { display: grid; gap: 28px; }
@media (min-width: 760px) { & .nums { grid-template-columns: repeat(3, 1fr); } }
& .nums > div { display: flex; flex-direction: column; gap: 6px; padding-top: 18px; border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
& .n { font-family: var(--at-font-h); font-weight: var(--at-h-weight); font-size: clamp(2.6rem, 2rem + 2.6vw, 4.4rem); letter-spacing: -0.045em; line-height: 1; }
& .nums > div > span:last-child { opacity: .85; }`,
  },
  {
    type: 'testimonials-grid', name: 'Testimonial cards', category: 'Social proof', tags: ['reviews', 'trust'],
    description: 'Three testimonial cards with star ratings, quotes and avatars.',
    html: `<section class="testi">
  <div class="at-container">
    <div class="head at-center at-stack">
      <span class="at-eyebrow" data-reveal>Testimonials</span>
      <h2 class="at-h2" data-reveal data-delay="60">Teams love working this way</h2>
    </div>
    <div class="at-grid cols-3">
      <figure class="at-card card" data-reveal><div class="stars" aria-label="5 stars"><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i></div><blockquote>“We replaced four tools with Northwind and our Monday stand-up went from an hour to ten minutes.”</blockquote><figcaption><img src="assets/ph/96x96-1.svg" alt="Priya Raman"><div><strong>Priya Raman</strong><span>COO, Fieldnote</span></div></figcaption></figure>
      <figure class="at-card card" data-reveal data-delay="80"><div class="stars" aria-label="5 stars"><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i></div><blockquote>“The first tool our designers and engineers actually agree on. It just feels right.”</blockquote><figcaption><img src="assets/ph/96x96-3.svg" alt="Marcus Hale"><div><strong>Marcus Hale</strong><span>Head of Product, Orbitly</span></div></figcaption></figure>
      <figure class="at-card card" data-reveal data-delay="160"><div class="stars" aria-label="5 stars"><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i><i data-icon="star"></i></div><blockquote>“Support answered in four minutes on a Sunday. That told me everything about this company.”</blockquote><figcaption><img src="assets/ph/96x96-6.svg" alt="Sofia Alvarez"><div><strong>Sofia Alvarez</strong><span>Founder, Greenhouse</span></div></figcaption></figure>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .head { align-items: center; margin-bottom: clamp(36px, 5vw, 56px); }
& .card { display: flex; flex-direction: column; gap: 18px; margin: 0; }
& .stars { display: flex; gap: 3px; color: #f5b83d; font-size: 15px; }
& .stars svg { fill: currentColor; }
& blockquote { font-size: 1.05rem; line-height: 1.55; flex: 1; }
& figcaption { display: flex; align-items: center; gap: 12px; padding-top: 16px; border-top: 1px solid var(--at-border); }
& figcaption img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
& figcaption strong { display: block; font-size: .95rem; }
& figcaption span { color: var(--at-muted); font-size: .85rem; }`,
  },
  {
    type: 'testimonial-large', name: 'Big testimonial', category: 'Social proof', tags: ['review', 'case study', 'quote'],
    description: 'One large centred quote with a portrait, name and company — maximum impact.',
    html: `<section class="big">
  <div class="at-container narrow at-center">
    <i data-icon="quote" class="q" data-reveal></i>
    <blockquote class="quote" data-reveal data-delay="60">“Northwind didn’t just speed us up — it changed how we think about work. It’s the calmest our company has ever felt, and we’re shipping twice as much.”</blockquote>
    <div class="who" data-reveal data-delay="140"><img src="assets/ph/160x160-2.svg" alt="Daniel Okafor"><div><strong>Daniel Okafor</strong><span class="at-muted">VP Engineering, Stacked</span></div></div>
  </div>
</section>`,
    css: `& { padding: calc(var(--at-pad) * 1.1) 0; }
& .q { font-size: 44px; color: var(--at-primary); margin: 0 auto 24px; }
& .quote { font-family: var(--at-font-h); font-weight: var(--at-h-weight); font-size: clamp(1.5rem, 1.1rem + 1.8vw, 2.5rem); line-height: 1.25; letter-spacing: var(--at-h-track); }
& .who { display: inline-flex; align-items: center; gap: 14px; margin-top: 36px; text-align: left; }
& .who img { width: 60px; height: 60px; border-radius: 50%; object-fit: cover; border: 2px solid var(--at-primary); }
& .who strong { display: block; }
& .who span { font-size: .9rem; }`,
  },
  {
    type: 'testimonials-wall', name: 'Testimonial wall', category: 'Social proof', tags: ['reviews', 'community', 'masonry'],
    description: 'A masonry wall of short reviews in varied lengths, fading out at the bottom.',
    html: `<section class="wall">
  <div class="at-container">
    <div class="head at-center at-stack">
      <span class="at-eyebrow" data-reveal>Wall of love</span>
      <h2 class="at-h2" data-reveal data-delay="60">Don’t take our word for it</h2>
      <p class="at-lead" data-reveal data-delay="120">Thousands of reviews from people who made the switch.</p>
    </div>
    <div class="cols" data-reveal="fade">
      <figure class="t"><blockquote>Honestly the nicest software I use all day.</blockquote><figcaption><img src="assets/ph/96x96-1.svg" alt=""><span><strong>Lena K.</strong> Designer</span></figcaption></figure>
      <figure class="t"><blockquote>We onboarded 60 people in a single afternoon. Nobody needed training — it’s that intuitive.</blockquote><figcaption><img src="assets/ph/96x96-2.svg" alt=""><span><strong>Tom B.</strong> Ops lead</span></figcaption></figure>
      <figure class="t"><blockquote>The automations alone pay for it. Our weekly report now writes itself.</blockquote><figcaption><img src="assets/ph/96x96-3.svg" alt=""><span><strong>Aisha N.</strong> Agency owner</span></figcaption></figure>
      <figure class="t"><blockquote>Fast. Like, really fast.</blockquote><figcaption><img src="assets/ph/96x96-4.svg" alt=""><span><strong>Chris P.</strong> Engineer</span></figcaption></figure>
      <figure class="t"><blockquote>I was skeptical about another tool, but this one replaced three. Our team is calmer and our clients notice.</blockquote><figcaption><img src="assets/ph/96x96-5.svg" alt=""><span><strong>Hannah W.</strong> Producer</span></figcaption></figure>
      <figure class="t"><blockquote>Support is unreal. Real humans, real answers, in minutes.</blockquote><figcaption><img src="assets/ph/96x96-6.svg" alt=""><span><strong>Diego R.</strong> Founder</span></figcaption></figure>
      <figure class="t"><blockquote>Finally, one place for everything. I don’t miss the tab chaos at all.</blockquote><figcaption><img src="assets/ph/96x96-7.svg" alt=""><span><strong>Mei L.</strong> PM</span></figcaption></figure>
      <figure class="t"><blockquote>The AI summaries save me an hour every morning.</blockquote><figcaption><img src="assets/ph/96x96-8.svg" alt=""><span><strong>Omar S.</strong> Director</span></figcaption></figure>
      <figure class="t"><blockquote>Beautiful, thoughtful and reliable. A rare combination in work software.</blockquote><figcaption><img src="assets/ph/96x96-9.svg" alt=""><span><strong>Julia F.</strong> Writer</span></figcaption></figure>
    </div>
  </div>
</section>`,
    css: `& { padding: var(--at-pad) 0; }
& .head { align-items: center; margin-bottom: clamp(36px, 5vw, 56px); }
& .cols { columns: 1; column-gap: 16px; max-height: 760px; overflow: hidden; -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent); mask-image: linear-gradient(180deg, #000 70%, transparent); }
@media (min-width: 680px) { & .cols { columns: 2; } }
@media (min-width: 1040px) { & .cols { columns: 3; } }
& .t { break-inside: avoid; margin: 0 0 16px; padding: 22px; border-radius: var(--at-radius); background: var(--at-surface); border: 1px solid var(--at-border); }
& blockquote { font-size: 1rem; line-height: 1.55; margin-bottom: 16px; }
& figcaption { display: flex; align-items: center; gap: 10px; font-size: .86rem; color: var(--at-muted); }
& figcaption strong { color: var(--at-text); margin-right: 4px; }
& figcaption img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }`,
  },
];

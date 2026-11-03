// Atrium — base CSS shared by every site: reset, type, and the .at-* utility classes sections build on.
// Uses only the theme tokens (--at-*) so it works for light and dark themes alike.
'use strict';

function baseCss() {
  return `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--at-bg);color:var(--at-text);font-family:var(--at-font-b);font-size:clamp(15px,.95rem + .1vw,17px);line-height:1.6;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;overflow-x:hidden}
img,picture,video,canvas,svg{display:block;max-width:100%}
img{height:auto}
input,button,textarea,select{font:inherit;color:inherit}
button{cursor:pointer}
p,h1,h2,h3,h4,h5,h6{overflow-wrap:break-word;margin:0}
h1,h2,h3,h4,h5,h6{font-family:var(--at-font-h);font-weight:var(--at-h-weight);letter-spacing:var(--at-h-track);line-height:1.1;color:var(--at-text)}
h1{font-size:clamp(2.4rem,1.6rem + 3.6vw,4.6rem);line-height:1.02}
h2{font-size:clamp(1.9rem,1.4rem + 2.2vw,3.2rem);line-height:1.06}
h3{font-size:clamp(1.15rem,1.05rem + .45vw,1.4rem);line-height:1.25}
h4{font-size:1.05rem;line-height:1.3}
ul,ol{margin:0;padding:0}
a{color:var(--at-primary);text-decoration-thickness:1px;text-underline-offset:.18em;transition:color .2s,opacity .2s}
a:hover{opacity:.85}
hr{border:0;border-top:1px solid var(--at-border);margin:0}
::selection{background:color-mix(in srgb,var(--at-primary) 30%,transparent)}
:focus-visible{outline:2px solid var(--at-primary);outline-offset:3px;border-radius:4px}
section,header,footer{position:relative}
table{border-collapse:collapse;width:100%}
blockquote{margin:0}
figure{margin:0}
details summary{cursor:pointer}

.at-container{width:100%;max-width:calc(var(--at-max) + 48px);margin-inline:auto;padding-inline:24px}
.at-container.narrow{max-width:808px}
.at-container.wide{max-width:calc(var(--at-max) + 240px)}
@media (min-width:900px){.at-container{padding-inline:32px}.at-container.narrow{max-width:824px}}
.at-eyebrow{display:inline-flex;align-items:center;gap:.5em;font-family:var(--at-font-b);font-size:.78rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--at-primary)}
.at-h1{font-size:clamp(2.6rem,1.6rem + 4.4vw,5.4rem);line-height:.98;letter-spacing:calc(var(--at-h-track) - .01em)}
.at-h2{font-size:clamp(2rem,1.4rem + 2.4vw,3.4rem);line-height:1.04}
.at-h3{font-size:clamp(1.2rem,1.05rem + .5vw,1.5rem);line-height:1.22}
.at-lead{font-size:clamp(1.05rem,.98rem + .4vw,1.3rem);line-height:1.55;color:var(--at-muted);max-width:62ch}
.at-muted{color:var(--at-muted)}
.at-center{text-align:center}
.at-center .at-lead{margin-inline:auto}
.at-gradient-text{background:var(--at-grad);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.at-divider{height:1px;background:var(--at-border);border:0;width:100%}
.at-stack{display:flex;flex-direction:column;gap:clamp(14px,1.6vw,22px)}
.at-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.at-center .at-row{justify-content:center}
.at-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

.at-btn{--b:var(--at-surface-2);display:inline-flex;align-items:center;justify-content:center;gap:.55em;min-height:46px;padding:0 22px;border-radius:var(--at-btn-radius);border:1px solid transparent;background:var(--b);color:var(--at-text);font-family:var(--at-font-b);font-size:.95rem;font-weight:600;letter-spacing:-.005em;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .25s,background .2s,border-color .2s,color .2s,opacity .2s}
.at-btn:hover{opacity:1;transform:translateY(-1px)}
.at-btn:active{transform:translateY(0)}
.at-btn .at-ic{font-size:1.05em;transition:transform .2s}
.at-btn:hover .at-ic:last-child{transform:translateX(2px)}
.at-btn-primary{background:var(--at-primary);color:var(--at-primary-text);box-shadow:0 1px 0 rgba(255,255,255,.18) inset,0 10px 28px -10px color-mix(in srgb,var(--at-primary) 70%,transparent)}
.at-btn-primary:hover{box-shadow:0 1px 0 rgba(255,255,255,.2) inset,0 16px 36px -12px color-mix(in srgb,var(--at-primary) 80%,transparent);color:var(--at-primary-text)}
.at-btn-ghost{background:transparent;color:var(--at-text)}
.at-btn-ghost:hover{background:color-mix(in srgb,var(--at-text) 7%,transparent);color:var(--at-text)}
.at-btn-outline{background:transparent;color:var(--at-text);border-color:color-mix(in srgb,var(--at-text) 18%,transparent)}
.at-btn-outline:hover{border-color:color-mix(in srgb,var(--at-text) 40%,transparent);color:var(--at-text)}
.at-btn-lg{min-height:54px;padding:0 28px;font-size:1.02rem}
.at-btn-sm{min-height:36px;padding:0 15px;font-size:.86rem}

.at-card{background:var(--at-surface);border:1px solid var(--at-border);border-radius:var(--at-radius);padding:clamp(20px,2.4vw,32px);box-shadow:var(--at-shadow);transition:transform .3s cubic-bezier(.2,.8,.2,1),border-color .3s,box-shadow .3s}
.at-badge{display:inline-flex;align-items:center;gap:.45em;padding:6px 12px;border-radius:999px;font-size:.8rem;font-weight:600;line-height:1.2;color:var(--at-text);background:color-mix(in srgb,var(--at-primary) 12%,var(--at-surface));border:1px solid color-mix(in srgb,var(--at-primary) 28%,var(--at-border))}
.at-badge .at-ic{color:var(--at-primary)}

.at-grid{display:grid;gap:var(--at-gap);grid-template-columns:1fr}
@media (min-width:700px){.at-grid.cols-2,.at-grid.cols-3,.at-grid.cols-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1000px){.at-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.at-grid.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}}

.at-ic{display:inline-block;width:1em;height:1em;flex:none;vertical-align:-.125em;line-height:1;color:currentColor}
.at-ic svg{width:100%;height:100%;display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}

.at-input{width:100%;min-height:48px;padding:12px 16px;border-radius:var(--at-radius-sm);border:1px solid var(--at-border);background:var(--at-surface-2);color:var(--at-text);font-size:.97rem;line-height:1.4;transition:border-color .2s,box-shadow .2s,background .2s;appearance:none;-webkit-appearance:none}
textarea.at-input{min-height:130px;resize:vertical}
select.at-input{background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 20px) 52%,calc(100% - 15px) 52%;background-size:5px 5px;background-repeat:no-repeat;padding-right:40px}
.at-input::placeholder{color:var(--at-muted);opacity:.8}
.at-input:focus{outline:none;border-color:var(--at-primary);box-shadow:0 0 0 4px color-mix(in srgb,var(--at-primary) 18%,transparent);background:var(--at-surface)}
.at-field{display:flex;flex-direction:column;gap:7px;font-size:.88rem;font-weight:600;color:var(--at-text)}

.at-check-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:11px}
.at-check-list li{position:relative;padding-left:30px;line-height:1.5}
.at-check-list li::before{content:"";position:absolute;left:0;top:.18em;width:19px;height:19px;border-radius:50%;background:color-mix(in srgb,var(--at-primary) 16%,transparent)}
.at-check-list li::after{content:"";position:absolute;left:6.5px;top:calc(.18em + 5px);width:6px;height:9px;border:solid var(--at-primary);border-width:0 2px 2px 0;transform:rotate(45deg)}

.at-media{display:block;width:100%;border-radius:var(--at-radius);object-fit:cover;overflow:hidden;background:var(--at-surface-2)}
figure.at-media img{width:100%;height:100%;object-fit:cover}
.at-glow{position:relative;isolation:isolate}
.at-glow::before{content:"";position:absolute;inset:8% 6%;z-index:-1;background:var(--at-grad);filter:blur(60px);opacity:.4;border-radius:50%}
.at-glass{background:color-mix(in srgb,var(--at-surface) 62%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);border:1px solid color-mix(in srgb,var(--at-text) 10%,transparent)}

.at-marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}
.at-marquee-track{display:flex;width:max-content;gap:clamp(40px,6vw,80px);align-items:center;animation:at-marquee 38s linear infinite}
.at-marquee:hover .at-marquee-track{animation-play-state:paused}
@keyframes at-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}

.at-post-card{display:block}
.at-post-card a{display:flex;flex-direction:column;gap:12px;height:100%;color:inherit;text-decoration:none}
.at-post-card a:hover{opacity:1}
.at-post-card .at-media{aspect-ratio:16/10;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.at-post-card a:hover .at-media{transform:scale(1.02)}
.at-post-card .at-post-meta{font-size:.82rem;color:var(--at-muted);font-weight:500}
.at-post-card h3{font-size:1.2rem}
.at-post-card p{color:var(--at-muted);font-size:.96rem}

.prose{font-size:1.06rem;line-height:1.75;color:var(--at-text)}
.prose>*+*{margin-top:1.1em}
.prose h2{font-size:clamp(1.5rem,1.3rem + 1vw,2rem);margin-top:1.8em}
.prose h3{margin-top:1.5em}
.prose p,.prose li{color:color-mix(in srgb,var(--at-text) 86%,var(--at-muted))}
.prose ul,.prose ol{padding-left:1.3em}
.prose li+li{margin-top:.4em}
.prose blockquote{border-left:3px solid var(--at-primary);padding:.2em 0 .2em 1.1em;font-size:1.15em;color:var(--at-text)}
.prose img{border-radius:var(--at-radius)}
.prose code{font-size:.9em;padding:.15em .4em;border-radius:6px;background:var(--at-surface-2)}
.prose pre{padding:18px;border-radius:var(--at-radius-sm);background:var(--at-surface-2);overflow:auto}
.prose pre code{padding:0;background:none}

[data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1);will-change:opacity,transform}
[data-reveal="fade"]{transform:none}
[data-reveal="zoom"]{transform:scale(.96)}
[data-reveal="left"]{transform:translateX(-28px)}
[data-reveal="right"]{transform:translateX(28px)}
[data-reveal].at-in{opacity:1;transform:none}
html.at-no-reveal [data-reveal]{opacity:1!important;transform:none!important;transition:none!important}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  [data-reveal]{opacity:1!important;transform:none!important;transition:none!important}
  .at-marquee-track{animation:none}
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
`;
}

module.exports = { baseCss };

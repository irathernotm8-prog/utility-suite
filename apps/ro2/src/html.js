// RO2 — HTML layers. An AI (or you) writes a page of HTML/CSS/JS at the design's exact size; RO2 shows it on the
// canvas as a picture, plays it live in previews, and turns it into frames for video/GIF.
//
// Every HTML layer is served from ro2://html/<key>.html in its own session ("ro2-html"): no Node, no app bridge,
// sandboxed, GET-only network (fonts and images from the web still work). Two modes:
//   live   plays in real time (the editor's preview and the HTML editor)
//   frame  the page's clock is RO2's: performance.now, Date, rAF, setTimeout/setInterval, CSS / Web Animations and
//          <video> are all driven by __ro2.seek(ms), so every frame is exact and identical on every computer.
'use strict';
const { BrowserWindow, session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const docs = new Map(); // key → { html, w, h }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
let fontCss = '';

function register({ html, w, h }) {
  const key = crypto.createHash('sha1').update(`${w}x${h}\n${html}`).digest('hex').slice(0, 20);
  docs.set(key, { html: String(html || ''), w: Math.max(16, Math.round(w)), h: Math.max(16, Math.round(h)) });
  if (docs.size > 400) docs.delete(docs.keys().next().value);
  return key;
}

// The clock shim. Runs before any of the page's own scripts.
const SHIM = `(()=>{const R=window;const realRaf=R.requestAnimationFrame.bind(R);const realST=R.setTimeout.bind(R);const realNow=performance.now.bind(performance);
let now=0;const base=Date.UTC(2026,0,1,12,0,0);let seq=1;const timers=new Map();let rafs=new Map();let rafUsed=false,timerUsed=false;
const RD=Date;function D(...a){return a.length?new RD(...a):new RD(base+now)}D.prototype=RD.prototype;D.now=()=>base+Math.floor(now);D.parse=RD.parse;D.UTC=RD.UTC;R.Date=D;
performance.now=()=>now;
R.requestAnimationFrame=(cb)=>{rafUsed=true;const id=seq++;rafs.set(id,cb);return id};R.cancelAnimationFrame=(id)=>rafs.delete(id);
R.setTimeout=(cb,ms,...a)=>{const id=seq++;if(typeof cb!=='function')return id;if(ms>0)timerUsed=true;timers.set(id,{at:now+Math.max(0,+ms||0),cb,a});return id};
R.setInterval=(cb,ms,...a)=>{const id=seq++;timerUsed=true;const every=Math.max(4,+ms||0);timers.set(id,{at:now+every,cb,a,every});return id};
R.clearTimeout=R.clearInterval=(id)=>timers.delete(id);
const firstSeen=new WeakMap();
function anims(){let a=[];try{a=document.getAnimations()}catch(e){}return a}
function runTimers(upTo){for(let guard=0;guard<10000;guard++){let next=null;for(const [id,t] of timers)if(t.at<=upTo&&(!next||t.at<next[1].at))next=[id,t];if(!next)return;const [id,t]=next;const keep=now;now=Math.max(now,t.at);if(t.every)t.at+=t.every;else timers.delete(id);try{t.cb(...t.a)}catch(e){console.error(e)}now=Math.max(keep,now)}}
function frame(){const list=rafs;rafs=new Map();for(const cb of list.values()){try{cb(now)}catch(e){console.error(e)}}}
function catchAnims(){for(const a of anims())if(!firstSeen.has(a)){firstSeen.set(a,now);try{a.pause()}catch(e){}}}
function syncAnims(){for(const a of anims()){if(!firstSeen.has(a))firstSeen.set(a,now);try{a.pause();a.currentTime=Math.max(0,now-firstSeen.get(a))}catch(e){}}
 for(const v of document.querySelectorAll('video,audio')){try{v.muted=true;v.pause();if(v.duration){const t=now/1000;v.currentTime=v.loop?t%v.duration:Math.min(t,v.duration)}}catch(e){}}}
async function settle(){try{await Promise.race([document.fonts.ready,new Promise(r=>realST(r,3000))])}catch(e){}
 const imgs=[...document.images].filter(i=>!i.complete);if(imgs.length)await Promise.race([Promise.all(imgs.map(i=>new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>realST(r,6000))]);
 const vids=[...document.querySelectorAll('video')].filter(v=>v.seeking||v.readyState<2);if(vids.length)await Promise.race([Promise.all(vids.map(v=>new Promise(r=>{const d=()=>r();v.addEventListener('seeked',d,{once:true});v.addEventListener('loadeddata',d,{once:true});v.addEventListener('error',d,{once:true})}))),new Promise(r=>realST(r,4000))]);
 await new Promise(r=>realRaf(()=>realRaf(r)))}
document.addEventListener('DOMContentLoaded',()=>{if(now===0)catchAnims()});R.addEventListener('load',()=>{if(now===0)catchAnims()});
R.__ro2={get now(){return now},
 async seek(ms){ms=Math.max(0,+ms||0);if(ms<now){/* going back: CSS animations rewind exactly; scripted ones replay from 0 */}
  const step=1000/60;let guard=0;
  while(now<ms-1e-6&&guard++<36000){const nx=Math.min(ms,now+step);runTimers(nx);catchAnims();now=nx;frame()}
  if(ms<now)now=ms;runTimers(now);if(!guard)frame();syncAnims();await settle();syncAnims();return now},
 meta(){let end=0,infinite=false;for(const a of anims()){try{const t=a.effect.getComputedTiming();if(t.endTime===Infinity||t.iterations===Infinity)infinite=true;else end=Math.max(end,(firstSeen.get(a)||0)+t.endTime)}catch(e){}}
  const vids=[...document.querySelectorAll('video')];for(const v of vids){if(v.duration&&isFinite(v.duration))end=Math.max(end,v.duration*1000);if(v.loop)infinite=true}
  const declared=+(document.documentElement.getAttribute('data-duration')||(document.querySelector('meta[name=ro2-duration]')||{}).content||0);
  return {cssAnimations:anims().length,endMs:Math.round(end),infinite,raf:rafUsed,timers:timerUsed,videos:vids.length,declaredMs:declared>0?(declared<300?declared*1000:declared):0,
   animated:anims().length>0||rafUsed||timerUsed||vids.length>0}}};
})();`;

// Fonts RO2 bundles, so the page can use the same families as the rest of the design
function setFonts(rendererDir) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(rendererDir, 'vendor/fonts/fonts.json'), 'utf8'));
    fontCss = list.map((f) => Object.entries(f.files).map(([w, file]) => `@font-face{font-family:"${f.family}";font-weight:${w};font-style:normal;font-display:block;src:url("ro2://app/vendor/fonts/${file}") format("woff2")}`).join('')).join('');
  } catch { fontCss = ''; }
}

// A complete document: the page at exactly w×h, RO2's fonts, the clock shim in frame mode
function wrap(doc, mode) {
  const base = `<meta charset="utf-8"><meta name="viewport" content="width=${doc.w}"><style>${fontCss}html,body{margin:0;padding:0}html{width:${doc.w}px;height:${doc.h}px;overflow:hidden}body{width:${doc.w}px;min-height:${doc.h}px;overflow:hidden;-webkit-font-smoothing:antialiased}</style>`;
  const head = base + (mode === 'frame' ? `<script>${SHIM}</script>` : '');
  let html = doc.html.trim();
  if (!/<html[\s>]/i.test(html)) html = /<body[\s>]/i.test(html) ? `<!doctype html><html>${html}</html>` : `<!doctype html><html><head></head><body>${html}</body></html>`;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + head);
  else html = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  if (!/^<!doctype/i.test(html)) html = '<!doctype html>' + html;
  return html;
}

function serve(u) {
  const key = u.pathname.replace(/^\/+|\.html$/g, '');
  const doc = docs.get(key);
  if (!doc) return new Response('This HTML layer has expired; reopen the design.', { status: 404 });
  return new Response(wrap(doc, u.searchParams.get('mode') === 'frame' ? 'frame' : 'live'), { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cross-Origin-Embedder-Policy': 'credentialless', 'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors ro2:", 'X-Content-Type-Options': 'nosniff' } });
}

// The session HTML layers run in: our protocol, GET-only network, no permissions, no downloads
let ses = null;
function htmlSession(protocolHandler) {
  if (ses) return ses;
  ses = session.fromPartition('ro2-html');
  ses.protocol.handle('ro2', protocolHandler);
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(/^(ro2|data|blob|about|devtools):/.test(d.url) || (/^https?:/.test(d.url) && ['GET', 'HEAD', 'OPTIONS'].includes(d.method))) }));
  ses.on('will-download', (e) => e.preventDefault());
  return ses;
}

function makeWin(w, h) {
  const bw = new BrowserWindow({
    show: false, width: w, height: h, useContentSize: true, frame: false, paintWhenInitiallyHidden: true, enableLargerThanScreen: true, transparent: true, backgroundColor: '#00000000',
    // offscreen: a page can be bigger than the screen (a 1080×1920 story at 2× is 3840 px tall), and paints at 1× on Retina too
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, javascript: true, offscreen: true, spellcheck: false },
  });
  bw.setContentSize(w, h); // windows are clamped to the screen when created; offscreen ones can be resized past it
  bw.webContents.setFrameRate(60);
  bw.webContents.setAudioMuted(true);
  bw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  bw.webContents.on('will-navigate', (e) => e.preventDefault());
  return bw;
}

// A page loaded in frame mode at `scale` (CSS size stays w×h; pixels are w·scale × h·scale)
async function openFrame(spec, scale = 1) {
  const key = spec.key || register(spec); const doc = docs.get(key);
  const W = Math.round(doc.w * scale), H = Math.round(doc.h * scale);
  const bw = makeWin(W, H); const logs = [];
  bw.webContents.on('console-message', (e) => { const level = e.level ?? e.params?.level; const msg = e.message ?? e.params?.message; if (level === 'error' || level === 3) logs.push(String(msg).slice(0, 300)); });
  await Promise.race([bw.loadURL(`ro2://html/${key}.html?mode=frame`).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), sleep(30000).then(() => { throw new Error('The HTML took too long to load.'); })]);
  if (scale !== 1) { bw.webContents.setZoomFactor(scale); await sleep(60); }
  const ok = await bw.webContents.executeJavaScript('!!window.__ro2').catch(() => false);
  if (!ok) throw new Error('The HTML could not be prepared for capture.');
  return { bw, W, H, doc, logs, key };
}
// the next painted frame (offscreen windows paint on their own schedule; capture after a fresh one)
function painted(bw, ms = 700) { return new Promise((ok) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); bw.webContents.off('paint', done); ok(); } bw.webContents.on('paint', done); bw.webContents.invalidate(); }); }
async function shot(f) {
  await painted(f.bw);
  let img = await f.bw.webContents.capturePage({ x: 0, y: 0, width: f.W, height: f.H });
  const s = img.getSize(); if (s.width !== f.W || s.height !== f.H) img = img.resize({ width: f.W, height: f.H, quality: 'best' }); // Retina screens capture at 2×
  return img;
}

// One picture of the page at time t (ms). → { png: Buffer, meta, logs }
function render(spec, { scale = 1, t = 0 } = {}) {
  return serial(async () => {
    const f = await openFrame(spec, scale);
    try {
      await f.bw.webContents.executeJavaScript(`window.__ro2.seek(${+t || 0})`);
      const meta = await f.bw.webContents.executeJavaScript('window.__ro2.meta()');
      const img = await shot(f);
      return { png: img.toPNG(), w: f.W, h: f.H, meta, logs: f.logs.slice(0, 8), key: f.key };
    } finally { try { f.bw.destroy(); } catch {} }
  });
}
// How the page moves: { animated, durationMs (a sensible length), meta }
function inspect(spec) {
  return serial(async () => {
    const key = spec.key || register(spec); const f = await openFrame({ key }, Math.min(1, 480 / Math.max(docs.get(key).w, 1)));
    try {
      await f.bw.webContents.executeJavaScript('window.__ro2.seek(0)');
      await f.bw.webContents.executeJavaScript('window.__ro2.seek(400)'); // let scripted animations start
      const meta = await f.bw.webContents.executeJavaScript('window.__ro2.meta()');
      const dur = meta.declaredMs || (meta.endMs && !meta.infinite ? Math.min(60000, meta.endMs) : meta.animated ? 5000 : 0);
      return { animated: !!meta.animated, durationMs: dur, meta, logs: f.logs.slice(0, 8) };
    } finally { try { f.bw.destroy(); } catch {} }
  });
}
// Every frame: onFrame(pngBuffer, index) is awaited, so the caller can stream into FFmpeg
function frames(spec, { scale = 1, fps = 30, durationMs = 5000, startMs = 0, onFrame, onProgress, signal } = {}) {
  return serial(async () => {
    const f = await openFrame(spec, scale);
    try {
      const n = Math.max(1, Math.round((durationMs / 1000) * fps));
      for (let i = 0; i < n; i++) {
        if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
        await f.bw.webContents.executeJavaScript(`window.__ro2.seek(${startMs + (i * 1000) / fps})`);
        const img = await shot(f);
        await onFrame(img.toPNG(), i);
        if (onProgress) onProgress((i + 1) / n);
      }
      return { frames: n, w: f.W, h: f.H, logs: f.logs.slice(0, 8) };
    } finally { try { f.bw.destroy(); } catch {} }
  });
}

// ── HTML → editable RO2 layers: read the laid-out page (text boxes, solid boxes, images, inline SVG) and capture
// everything else (gradients, shadows, canvas, effects) as one background picture.
const EXTRACT_JS = `(async()=>{const W=innerWidth,H=innerHeight;const out={texts:[],boxes:[],images:[],svgs:[]};
const vis=e=>{const cs=getComputedStyle(e);return cs.display!=='none'&&cs.visibility!=='hidden'&&+cs.opacity>0.02};
const op=e=>{let o=1;for(let n=e;n&&n.nodeType===1;n=n.parentElement)o*=+getComputedStyle(n).opacity;return o};
const rot=e=>{const t=getComputedStyle(e).transform;if(!t||t==='none')return 0;const m=t.match(/matrix\\(([^)]+)\\)/);if(!m)return 0;const [a,b]=m[1].split(',').map(Number);return Math.round(Math.atan2(b,a)*1800/Math.PI)/10};
const rect=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}};
const onPage=r=>r.w>0.5&&r.h>0.5&&r.x<W&&r.y<H&&r.x+r.w>0&&r.y+r.h>0;
const all=[...document.body.querySelectorAll('*')];let z=0;
for(const e of all){if(!vis(e))continue;const tag=e.tagName;if(e.closest('svg')&&tag!=='svg')continue;
 const cs=getComputedStyle(e);const r=rect(e);if(!onPage(r))continue;const angle=rot(e);
 if(tag==='IMG'&&e.currentSrc){out.images.push({src:e.currentSrc,...r,fit:cs.objectFit,radius:parseFloat(cs.borderTopLeftRadius)||0,opacity:op(e),angle,z:z++,el:all.indexOf(e)});continue}
 if(tag==='svg'){const c=e.cloneNode(true);const src=[e,...e.querySelectorAll('*')],dst=[c,...c.querySelectorAll('*')];src.forEach((s,i)=>{const k=getComputedStyle(s);for(const p of ['fill','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','stroke-linecap','stroke-linejoin'])dst[i].setAttribute(p,k.getPropertyValue(p))});c.setAttribute('width',r.w);c.setAttribute('height',r.h);if(!c.getAttribute('xmlns'))c.setAttribute('xmlns','http://www.w3.org/2000/svg');out.svgs.push({svg:c.outerHTML,...r,opacity:op(e),angle,z:z++,el:all.indexOf(e)});continue}
 if(/^(CANVAS|VIDEO|IFRAME|SCRIPT|STYLE|BR)$/.test(tag))continue;
 const bg=cs.backgroundColor;const hasImg=cs.backgroundImage&&cs.backgroundImage!=='none';const solid=bg&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg);
 const bw=parseFloat(cs.borderTopWidth)||0;const sameBorder=['Right','Bottom','Left'].every(s=>cs['border'+s+'Width']===cs.borderTopWidth&&cs['border'+s+'Color']===cs.borderTopColor)&&cs.borderTopStyle==='solid';
 const shadow=cs.boxShadow&&cs.boxShadow!=='none';const simple=!hasImg&&!shadow&&(!bw||sameBorder)&&cs.backdropFilter==='none'&&cs.filter==='none';
 if((solid||(bw&&sameBorder))&&simple&&!(e===document.body)){out.boxes.push({...r,fill:solid?bg:'transparent',radius:parseFloat(cs.borderTopLeftRadius)||0,stroke:bw?cs.borderTopColor:null,strokeWidth:bw,opacity:op(e),angle,z:z++,el:all.indexOf(e)})}
 // text: elements with their own text
 const own=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());
 if(own.length&&!e.closest('button svg')){const kids=[...e.children].filter(c=>!/^(BR|SPAN|B|STRONG|I|EM|A|SMALL|SUP|SUB|MARK|U|S)$/.test(c.tagName));if(kids.length)continue;
  const range=document.createRange();range.selectNodeContents(e);const rr=range.getBoundingClientRect();const lines=[...range.getClientRects()].reduce((a,c)=>{if(!a.length||Math.abs(a[a.length-1]-c.top)>2)a.push(c.top);return a},[]).length;
  let txt=e.innerText.replace(/\\u00a0/g,' ');if(cs.textTransform==='uppercase')txt=txt.toUpperCase();else if(cs.textTransform==='lowercase')txt=txt.toLowerCase();
  const ls=cs.letterSpacing==='normal'?0:parseFloat(cs.letterSpacing)||0;const fs=parseFloat(cs.fontSize);const lh=cs.lineHeight==='normal'?1.2:parseFloat(cs.lineHeight)/fs;
  const grad=(cs.webkitBackgroundClip==='text'||cs.backgroundClip==='text')&&hasImg;
  out.texts.push({text:txt,x:rr.left,y:rr.top,w:rr.width,h:rr.height,lines,family:cs.fontFamily.split(',')[0].replace(/["']/g,'').trim(),weight:+cs.fontWeight||400,italic:cs.fontStyle==='italic',size:fs,color:grad?null:cs.color,align:cs.textAlign==='start'?'left':cs.textAlign==='end'?'right':cs.textAlign,spacing:ls,lineHeight:lh,shadow:cs.textShadow!=='none'?cs.textShadow:null,opacity:op(e),angle,z:z++,el:all.indexOf(e),decoration:cs.textDecorationLine,stroke:cs.webkitTextStrokeWidth&&parseFloat(cs.webkitTextStrokeWidth)>0?{w:parseFloat(cs.webkitTextStrokeWidth),c:cs.webkitTextStrokeColor}:null,grad})}}
return out})()`;
// hide what became layers, then capture the rest as the background
const HIDE_JS = (ids) => `(()=>{const all=[...document.body.querySelectorAll('*')];const s=document.createElement('style');s.textContent='.__ro2t,.__ro2t *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important;text-decoration-color:transparent!important}.__ro2h{visibility:hidden!important}.__ro2b{background-color:transparent!important;border-color:transparent!important}';document.head.appendChild(s);
const I=${JSON.stringify(ids)};I.t.forEach(i=>all[i]&&all[i].classList.add('__ro2t'));I.h.forEach(i=>all[i]&&all[i].classList.add('__ro2h'));I.b.forEach(i=>all[i]&&all[i].classList.add('__ro2b'));return true})()`;
function toLayers(spec, { t = 0, scale = 1 } = {}) {
  return serial(async () => {
    const f = await openFrame(spec, scale);
    try {
      await f.bw.webContents.executeJavaScript(`window.__ro2.seek(${+t || 0})`);
      const ex = await f.bw.webContents.executeJavaScript(EXTRACT_JS);
      const full = (await shot(f)).toPNG();
      await f.bw.webContents.executeJavaScript(HIDE_JS({ t: ex.texts.filter((x) => x.color).map((x) => x.el), h: [...ex.images, ...ex.svgs].map((x) => x.el), b: ex.boxes.map((x) => x.el) }));
      await sleep(80); // (page timers are on RO2's frozen clock here, so wait from outside)
      await f.bw.webContents.executeJavaScript(`window.__ro2.seek(${+t || 0})`);
      const bg = (await shot(f)).toPNG();
      // images from the web come in as data so the design keeps them
      for (const im of ex.images) {
        try {
          if (/^data:/.test(im.src)) { im.dataUrl = im.src; continue; }
          const r = await ses.fetch(im.src); if (!r.ok) continue; const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 30e6) continue;
          im.dataUrl = `data:${(r.headers.get('content-type') || 'image/png').split(';')[0]};base64,${buf.toString('base64')}`;
        } catch {}
      }
      return { ...ex, background: bg.toString('base64'), full: full.toString('base64'), w: f.doc.w, h: f.doc.h, scale };
    } finally { try { f.bw.destroy(); } catch {} }
  });
}

module.exports = { register, serve, htmlSession, setFonts, render, inspect, frames, toLayers, wrap, docs };

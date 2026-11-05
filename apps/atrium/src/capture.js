// Atrium — a hidden browser for the AI's eyes: screenshots of the preview (desktop/tablet/phone, full page in
// slices, or one section), in-page audits (contrast, overflow, tap targets…), reading other websites, and
// parsing HTML for imports. Runs in its own session; remote pages get no Node and no access to the app.
'use strict';
const { BrowserWindow, session, nativeImage } = require('electron');

const DEVICES = { desktop: 1440, laptop: 1280, tablet: 834, phone: 390 };
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeWin(width, height, remote) {
  const w = new BrowserWindow({
    show: false, width, height, useContentSize: true, frame: false, paintWhenInitiallyHidden: true, enableLargerThanScreen: true,
    webPreferences: { offscreen: false, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, javascript: true, partition: remote ? 'atrium-remote' : 'atrium-capture', images: true },
  });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}
async function load(w, url, timeout = 25000) {
  await Promise.race([w.loadURL(url).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), sleep(timeout).then(() => { throw new Error('The page took too long to load'); })]);
  await w.webContents.insertCSS('html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}html{scrollbar-width:none!important}').catch(() => {});
  await w.webContents.executeJavaScript(`(async()=>{document.documentElement.classList.add('at-no-reveal');document.querySelectorAll('[data-reveal]').forEach(e=>e.classList.add('at-in'));try{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,2500))])}catch(e){}
    document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager');
    await Promise.race([Promise.all([...document.images].filter(i=>!i.complete).map(i=>new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>setTimeout(r,4000))]);return true})()`).catch(() => {});
  await sleep(350);
}

// Capture [y0, y1) of the page (CSS px) without ever making the window taller than a real screen: scroll through
// it in screen-height bands and stitch the bitmaps together on the CPU. (Growing a hidden window to the page height
// breaks on Macs, where Retina doubles it past the GPU's texture limit, and stretches 100vh sections.) Fixed and
// sticky elements are hidden after the first screen so a sticky header isn't repeated down the page.
async function captureRange(w, width, vh, y0, y1) {
  const parts = []; let hidden = false;
  for (let y = y0; y < y1; y += vh) {
    const h = Math.min(vh, y1 - y);
    if (y > 0 && !hidden) { hidden = true; await w.webContents.executeJavaScript(`document.querySelectorAll('body *').forEach(e=>{const p=getComputedStyle(e).position;if(p==='fixed'||p==='sticky')e.style.setProperty('visibility','hidden','important')})`); }
    const sy = await w.webContents.executeJavaScript(`new Promise(r=>{document.documentElement.style.setProperty('scroll-behavior','auto','important');window.scrollTo({top:${Math.round(y)},left:0,behavior:'instant'});requestAnimationFrame(()=>requestAnimationFrame(()=>r(window.scrollY)))})`);
    await sleep(60);
    const top = Math.max(0, Math.round(y - sy)); const hh = Math.max(1, Math.min(Math.round(h), vh - top));
    const img = await w.webContents.capturePage({ x: 0, y: top, width, height: hh });
    if (img.getSize().width) parts.push(img);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const pw = parts[0].getSize().width; const bufs = []; let ph = 0;
  for (const im of parts) { const sz = im.getSize(); const b = sz.width === pw ? im.toBitmap() : im.resize({ width: pw }).toBitmap(); bufs.push(b); ph += b.length / (pw * 4); }
  return nativeImage.createFromBitmap(Buffer.concat(bufs), { width: pw, height: Math.round(ph) });
}
const pageHeight = (w) => w.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)');
const viewportFor = (width) => (width <= 500 ? 844 : width <= 900 ? 1112 : 900);

// → [{ data: base64 jpeg, w, h, note }]
function shoot(url, { width = 1440, fullPage = true, selector = null, outWidth, maxSlices = 4, sliceHeight, remote = false, quality = 78 } = {}) {
  return serial(async () => {
    const vh = viewportFor(width);
    const w = makeWin(width, vh, remote);
    try {
      await load(w, url);
      let rect = null;
      if (selector) {
        rect = await w.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {y:Math.round(r.top+scrollY),h:Math.max(1,Math.round(r.height))}})()`);
        if (!rect) throw new Error('That section isn’t on the page');
      }
      const total = await pageHeight(w);
      const ow = outWidth || (width >= 1200 ? 1100 : width >= 700 ? 834 : 390);
      const scale = ow / width;
      const sh = sliceHeight || (width <= 500 ? 1500 : 1300) / scale;
      const y0 = rect ? rect.y : 0; const y1 = rect ? Math.min(total, rect.y + rect.h) : fullPage ? total : Math.min(total, vh);
      const out = [];
      for (let y = y0; y < y1 && out.length < maxSlices; y += sh) {
        const h = Math.min(sh, y1 - y); if (h < 2) break;
        const img = await captureRange(w, width, vh, y, y + h); if (!img) continue;
        const r = img.resize({ width: Math.round(ow), quality: 'good' });
        out.push({ data: r.toJPEG(quality).toString('base64'), w: r.getSize().width, h: r.getSize().height, y: Math.round(y) });
      }
      const more = y1 - y0 > sh * maxSlices;
      if (out.length) out[out.length - 1].note = more ? `Showing the top ${Math.round(sh * maxSlices)}px of ${Math.round(y1 - y0)}px. Ask for a section to see the rest.` : '';
      return { slices: out, height: Math.round(total), width };
    } finally { try { w.destroy(); } catch {} }
  });
}

// full-resolution capture for the PDF export: the whole page in 2000px bands (CSS-pixel positions), plus where each
// section sits so the PDF can label it
function captureForPdf(url, { width = 1440, quality = 86 } = {}) {
  return serial(async () => {
    const vh = viewportFor(width);
    const w = makeWin(width, vh, false);
    try {
      await load(w, url);
      const total = Math.min(30000, await pageHeight(w));
      const sections = await w.webContents.executeJavaScript(`[...document.querySelectorAll('[data-s]')].filter(e=>!e.parentElement.closest('[data-s]')).map(e=>{const r=e.getBoundingClientRect();return {id:e.getAttribute('data-s'),top:Math.round(r.top+scrollY),height:Math.round(r.height)}})`);
      const out = []; const band = 2000;
      for (let y = 0; y < total; y += band) {
        const h = Math.min(band, total - y);
        const img = await captureRange(w, width, vh, y, y + h); if (!img) continue;
        out.push({ jpeg: img.toJPEG(quality), y, h });
      }
      return { slices: out, height: total, width, sections };
    } finally { try { w.destroy(); } catch {} }
  });
}

// thumbnail for the site gallery
async function thumb(url) { const r = await shoot(url, { width: 1440, fullPage: false, outWidth: 560, maxSlices: 1, quality: 72 }); return r.slices[0] ? Buffer.from(r.slices[0].data, 'base64') : null; }

// ── in-page audit: measures the rendered page, so contrast and overflow are real, not guessed
const AUDIT_JS = `(()=>{const out=[];const sec=e=>{const s=e.closest('[data-s]');return s?s.getAttribute('data-s'):null};const short=e=>(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).slice(0,2).join('.'):'')).slice(0,60);
const add=(level,kind,msg,e,fix)=>out.push({level,kind,msg,section:e?sec(e):null,el:e?short(e):null,fix:fix||''});
const rgb=c=>{const m=/rgba?\\(([^)]+)\\)/.exec(c);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1]};
const lum=c=>{const a=c.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
const bgOf=e=>{let n=e;while(n&&n.nodeType===1){const cs=getComputedStyle(n);if(cs.backgroundImage&&cs.backgroundImage!=='none')return 'image';const c=rgb(cs.backgroundColor);if(c&&c[3]>.6)return c;n=n.parentElement}const b=rgb(getComputedStyle(document.body).backgroundColor);return b&&b[3]>.5?b:[255,255,255,1]};
const W=innerWidth;
document.querySelectorAll('img').forEach(i=>{if(!i.hasAttribute('alt'))add('error','a11y','Image without alt text',i,'Add alt="…" describing it (alt="" if purely decorative).');else if(/^(image|img|photo|picture|placeholder)$/i.test(i.alt.trim()))add('warn','a11y','Alt text says nothing ("'+i.alt+'")',i,'Describe what the image shows.');if(i.naturalWidth>2*i.clientWidth*devicePixelRatio&&i.naturalWidth>1600)add('warn','perf','Image is much bigger than shown ('+i.naturalWidth+'px wide, shown at '+i.clientWidth+'px)',i,'Resize it (add_asset resizes big photos).')});
const hs=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h=>h.offsetParent!==null);const h1=hs.filter(h=>h.tagName==='H1');if(!h1.length)add('error','seo','No h1 on the page',null,'Make the main headline an h1.');if(h1.length>1)add('warn','seo',h1.length+' h1 headings',h1[1],'Use one h1; make the others h2.');
let last=0;hs.forEach(h=>{const l=+h.tagName[1];if(last&&l>last+1)add('warn','a11y','Heading jumps from h'+last+' to h'+l,h,'Keep heading levels in order.');last=l});
document.querySelectorAll('a').forEach(a=>{const t=(a.textContent+(a.getAttribute('aria-label')||'')+[...a.querySelectorAll('img')].map(i=>i.alt).join('')).trim();if(!t)add('error','a11y','Link with no text',a,'Add text or aria-label.');if(a.getAttribute('href')==='#'||a.getAttribute('href')==='')add('warn','links','Link goes nowhere (href="#")',a,'Point it at a page or section.')});
document.querySelectorAll('button').forEach(b=>{if(!(b.textContent.trim()||b.getAttribute('aria-label')||b.title))add('error','a11y','Button with no label',b,'Add text or aria-label.')});
document.querySelectorAll('input:not([type=hidden]):not([type=submit]),textarea,select').forEach(i=>{const ok=(i.id&&document.querySelector('label[for="'+i.id+'"]'))||i.closest('label')||i.getAttribute('aria-label')||i.getAttribute('aria-labelledby');if(!ok)add('warn','a11y','Form field without a label',i,'Wrap it in a <label> or add aria-label.')});
const seen=new Set();const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n,checked=0;while((n=walk.nextNode())&&checked<1500){const t=n.textContent.trim();if(t.length<2)continue;const e=n.parentElement;if(!e||seen.has(e))continue;seen.add(e);const cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<.2||e.closest('[aria-hidden=true]'))continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;checked++;
 if(cs.webkitBackgroundClip==='text'||cs.backgroundClip==='text')continue;const fg=rgb(cs.color);const bg=bgOf(e);if(!fg||bg==='image')continue;const a=fg[3];const mix=[0,1,2].map(k=>fg[k]*a+bg[k]*(1-a));const L1=lum(mix),L2=lum(bg);const ratio=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);const size=parseFloat(cs.fontSize),bold=+cs.fontWeight>=600;const need=(size>=24||(size>=18.6&&bold))?3:4.5;if(ratio<need)add(ratio<need*.75?'error':'warn','contrast','Low contrast '+ratio.toFixed(2)+':1 (needs '+need+') on "'+t.slice(0,40)+'"',e,'Use --at-text or --at-muted on this background, or darken/lighten the colour.')}
const over=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.right>W+2&&getComputedStyle(e).position!=='fixed'){let p=e.parentElement,clipped=false;while(p&&p!==document.body){const o=getComputedStyle(p).overflowX;if(o==='hidden'||o==='clip'||o==='auto'||o==='scroll'){clipped=true;break}p=p.parentElement}if(!clipped)over.push(e)}});
const top=over.filter(e=>!over.includes(e.parentElement)).slice(0,6);if(document.documentElement.scrollWidth>W+2)top.forEach(e=>add('error','layout','Sticks out '+Math.round(e.getBoundingClientRect().right-W)+'px past the screen at '+W+'px wide',e,'Let it wrap/shrink (max-width:100%, flex-wrap, smaller min widths, grid that stacks).'));
if(W<=500){document.querySelectorAll('a,button,input,select,textarea,[role=button]').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.height&&(r.width<32||r.height<32)&&e.offsetParent!==null&&!e.closest('p,li,td'))add('warn','mobile','Small tap target ('+Math.round(r.width)+'×'+Math.round(r.height)+'px)',e,'Make it at least 44×44px (padding).')})}
const desc=document.querySelector('meta[name=description]');const title=document.title||'';
const meta={title,titleLength:title.length,description:desc?desc.content:'',lang:document.documentElement.lang,ogImage:!!document.querySelector('meta[property="og:image"]'),links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>h&&!/^(https?:|mailto:|tel:|#|javascript:)/.test(h)),words:document.body.innerText.split(/\\s+/).length,scrollWidth:document.documentElement.scrollWidth};
return {issues:out,meta}})()`;

function auditPage(url, width = 1280) {
  return serial(async () => {
    const w = makeWin(width, 900, false);
    try { await load(w, url); return await w.webContents.executeJavaScript(AUDIT_JS); }
    finally { try { w.destroy(); } catch {} }
  });
}

// ── read another website
const READ_JS = `(()=>{const t=e=>e?e.textContent.replace(/\\s+/g,' ').trim():'';const cnt={};const add=(c,w)=>{if(!c||/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return;cnt[c]=(cnt[c]||0)+w};
document.querySelectorAll('body, header, section, footer, a, button, h1, h2, .btn, [class*=button]').forEach((e,i)=>{if(i>400)return;const cs=getComputedStyle(e);add(cs.backgroundColor,e.tagName==='BODY'?50:e.matches('a,button,[class*=button],.btn')?6:3);add(cs.color,e.matches('h1,h2')?5:2)});
const hex=c=>{const m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c);return m?'#'+[m[1],m[2],m[3]].map(v=>(+v).toString(16).padStart(2,'0')).join(''):c};
const colors=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([c])=>hex(c));
const font=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g,'').trim():null};
const heads=[...document.querySelectorAll('h1,h2,h3')].slice(0,60).map(h=>h.tagName.toLowerCase()+': '+t(h)).filter(x=>x.length>4);
const nav=[...document.querySelectorAll('header a, nav a')].slice(0,30).map(a=>({text:t(a),href:a.href})).filter(x=>x.text);
const imgs=[...document.images].filter(i=>i.naturalWidth>200).slice(0,16).map(i=>({src:i.currentSrc||i.src,alt:i.alt,w:i.naturalWidth,h:i.naturalHeight}));
const md=document.querySelector('meta[name=description]');
return {url:location.href,title:document.title,description:md?md.content:'',lang:document.documentElement.lang,fonts:{heading:font('h1')||font('h2'),body:font('p')||font('body')},colors,headings:heads,nav,images:imgs,text:document.body.innerText.replace(/\\n{3,}/g,'\\n\\n').slice(0,9000)}})()`;

function readUrl(url, { look = true, width = 1440 } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Give a full https:// address');
  return serial(async () => {
    const w = makeWin(width, 900, true);
    try {
      await load(w, url, 30000);
      const info = await w.webContents.executeJavaScript(READ_JS);
      let slices = [];
      if (look) {
        const total = Math.min(5200, await w.webContents.executeJavaScript('document.documentElement.scrollHeight'));
        w.setContentSize(width, Math.max(900, total)); await sleep(500);
        const sh = 1300 / (1100 / width);
        for (let y = 0; y < total && slices.length < 3; y += sh) { const img = await w.webContents.capturePage({ x: 0, y: Math.round(y), width, height: Math.round(Math.min(sh, total - y)) }); const r = img.resize({ width: Math.round(img.getSize().width * 1100 / width) }); slices.push({ data: r.toJPEG(74).toString('base64'), w: r.getSize().width, h: r.getSize().height }); }
      }
      return { ...info, slices };
    } finally { try { w.destroy(); } catch {} }
  });
}

// ── parse HTML (for imports) in a blank page with DOMParser
function parseHtml(html) {
  return serial(async () => {
    const w = makeWin(800, 600, true);
    try {
      await w.loadURL('about:blank');
      return await w.webContents.executeJavaScript(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(String(html))},'text/html');
        let root=d.body;const els=()=>[...root.children].filter(e=>!/^(SCRIPT|NOSCRIPT|STYLE|LINK|TEMPLATE)$/.test(e.tagName));
        while(els().length===1&&/^(DIV|MAIN|ARTICLE)$/.test(els()[0].tagName)&&els()[0].children.length>1&&!els()[0].querySelector(':scope > header')&&!els()[0].className.includes('section'))root=els()[0];
        const parts=[];for(const e of els()){if(e.tagName==='MAIN'&&e.children.length>1){for(const c of e.children)parts.push({tag:c.tagName.toLowerCase(),html:c.outerHTML});continue}parts.push({tag:e.tagName.toLowerCase(),html:e.outerHTML})}
        const styles=[...d.querySelectorAll('style')].map(s=>s.textContent).join('\\n');const links=[...d.querySelectorAll('link[rel=stylesheet]')].map(l=>l.getAttribute('href'));
        const scripts=[...d.querySelectorAll('script')].filter(s=>!s.src).map(s=>s.textContent).join('\\n;\\n');const scriptSrc=[...d.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'));
        const md=d.querySelector('meta[name=description]');
        return {title:d.title,description:md?md.content:'',lang:d.documentElement.lang,parts,styles,links,scripts,scriptSrc,fontLinks:[...d.querySelectorAll('link[href*="fonts.googleapis"]')].map(l=>l.href)}})()`);
    } finally { try { w.destroy(); } catch {} }
  });
}

function clearRemote() { try { session.fromPartition('atrium-remote').clearStorageData(); } catch {} }

module.exports = { captureForPdf, shoot, thumb, auditPage, readUrl, parseHtml, clearRemote, DEVICES };

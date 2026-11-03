// Atrium — the live preview server. Serves the open site exactly as it will be exported, on 127.0.0.1 (and on the
// Wi-Fi for phone preview, read-only, when turned on). Changes stream to open pages over Server-Sent Events:
// a changed section is swapped in place, theme changes refresh the stylesheet, anything else reloads and keeps
// the scroll position. In the editor the page also gets the click-to-edit overlay.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./core/render');
const EX = require('./core/exporters');

const LIVE = `<script>(function(){if(window.__atLive)return;window.__atLive=1;var es;function css(){var l=document.querySelector('link[href*="assets/site.css"]');if(!l)return;var n=l.cloneNode();n.href=l.href.replace(/([?&])v=[^&]*/,'$1v='+Date.now());n.onload=function(){l.remove()};l.after(n)}
function connect(){es=new EventSource('/__atrium/events');es.onmessage=function(m){var e;try{e=JSON.parse(m.data)}catch(x){return}if(window.__atOverlay&&window.__atOverlay.event(e)===false)return;
if(e.type==='reload'){try{sessionStorage.setItem('at-scroll',String(scrollY))}catch(x){}location.reload()}
else if(e.type==='css'){css()}
else if(e.type==='section'){fetch('/__atrium/section/'+e.id+'?page='+encodeURIComponent(document.body.getAttribute('data-page')||'')).then(function(r){return r.json()}).then(function(d){var el=document.querySelector('[data-s="'+e.id+'"]');if(!el||!d.html){location.reload();return}var t=document.createElement('template');t.innerHTML=d.html.trim();var n=t.content.firstElementChild;el.replaceWith(n);css();if(window.Atrium)Atrium.refresh(n);n.querySelectorAll('[data-reveal]').forEach(function(x){x.classList.add('at-in')});if(window.__atOverlay)window.__atOverlay.swapped(n)})}};es.onerror=function(){es.close();setTimeout(connect,1500)}}
connect();try{var y=sessionStorage.getItem('at-scroll');if(y!=null){sessionStorage.removeItem('at-scroll');var go=function(){scrollTo(0,+y)};if(document.readyState==='complete')go();else addEventListener('load',go)}}catch(x){}})();</script>`;

function lanAddresses() {
  const out = []; for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !/^169\.254/.test(a.address)) out.push({ name, address: a.address });
  return out.sort((a, b) => (/^(en|wl|Wi-Fi|Ethernet)/i.test(b.name) ? 1 : 0) - (/^(en|wl|Wi-Fi|Ethernet)/i.test(a.name) ? 1 : 0));
}
function qrRows(text) { const qrcode = require('qrcode-generator'); const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(); const rows = []; for (let r = 0; r < n; r++) { let s = ''; for (let c = 0; c < n; c++) s += q.isDark(r, c) ? '1' : '0'; rows.push(s); } return rows; }

// a library section (or a whole template's home page) rendered in the open site's theme or a preset, for the
// library cards and the template picker
function libraryPreview(site, type, preset, tpl) {
  const TH = require('./core/theme'); const { baseCss } = require('./core/base-css'); const { makeSection } = require('./core/site');
  let theme = preset ? TH.presetTheme(preset) : site.data.theme;
  let secs, pages = site.data.pages, name = site.data.settings.name || site.data.name, logo = site.data.settings.logo;
  if (tpl) {
    const t = require('./core/templates').TEMPLATES.find((x) => x.id === type); if (!t) return 'No template';
    theme = TH.presetTheme(preset || t.theme); preset = preset || t.theme;
    secs = [t.header, ...t.pages[0].sections, t.footer].filter(Boolean).map((x) => makeSection(x));
    pages = t.pages.map((p, i) => ({ id: 'tp' + i, slug: p.slug, title: p.title, nav: p.nav !== false })); name = (t.settings && t.settings.name) || t.name; logo = '';
  } else { const t = require('./core/sections').SECTIONS.find((x) => x.type === type); if (!t) return 'No section'; secs = [{ id: 'preview', type: t.type, name: t.name, html: t.html, css: t.css, js: t.js || '' }]; }
  const fake = { data: { ...site.data, theme, pages, settings: { ...site.data.settings, name, logo } }, allSections: () => secs.map((s) => ({ section: s })) };
  const ctx = R.withDefaults({ mode: 'preview', asset: (x) => '/' + x });
  const phFix = (h) => h.replace(/\/assets\/ph\//g, `/__atrium/ph/${preset || ''}/`);
  const fonts = TH.googleFontsHref(theme);
  return `<!doctype html><html data-theme="${theme.mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts ? `<link rel="stylesheet" href="${fonts}">` : ''}<style>${TH.themeVars(theme)}${baseCss()}${secs.map((s) => phFix(R.sectionCss(s, ctx))).join('\n')}[data-reveal]{opacity:1!important;transform:none!important}body{margin:0}${tpl ? '' : 'body{pointer-events:none}'}</style></head><body>${secs.map((s) => phFix(R.renderSection(fake, s, pages[0], ctx))).join('\n')}<script>${R.RUNTIME}</script></body></html>`;
}

class Preview {
  constructor({ getSite, overlayDir, onVisit }) { this.getSite = getSite; this.overlayDir = overlayDir; this.clients = new Set(); this.server = null; this.lan = null; this.port = 0; this.lanPort = 0; this.onVisit = onVisit || (() => {}); }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((q, s) => this.handle(q, s, false));
      this.server.listen(+process.env.ATRIUM_PREVIEW_PORT || 0, '127.0.0.1', () => { this.port = this.server.address().port; resolve(this.port); });
    });
  }
  stop() { try { this.server && this.server.close(); } catch {} try { this.lan && this.lan.close(); } catch {} for (const c of this.clients) { try { c.end(); } catch {} } }
  url(p = '') { return `http://127.0.0.1:${this.port}/${String(p).replace(/^\//, '')}`; }
  pageUrl(site, pageRef, edit) { let slug = 'index'; try { slug = site.page(pageRef).slug; } catch {} return this.url(`${slug === 'index' ? '' : slug + '.html'}${edit ? '?edit=1' : ''}`); }
  broadcast(e) { const msg = `data: ${JSON.stringify(e)}\n\n`; for (const c of this.clients) { try { c.write(msg); } catch {} } }
  async setLan(on) {
    if (!on) { if (this.lan) { try { this.lan.close(); } catch {} } this.lan = null; this.lanPort = 0; return this.lanInfo(); }
    if (!this.lan) await new Promise((resolve, reject) => { this.lan = http.createServer((q, s) => this.handle(q, s, true)); this.lan.on('error', reject); this.lan.listen(0, '0.0.0.0', () => { this.lanPort = this.lan.address().port; resolve(); }); });
    return this.lanInfo();
  }
  lanInfo() { if (!this.lan) return { on: false }; const a = lanAddresses()[0]; if (!a) return { on: true, url: null, note: 'This computer isn’t on a network.' }; const url = `http://${a.address}:${this.lanPort}/`; return { on: true, url, address: a.address, qr: qrRows(url) }; }

  handle(req, res, lan) {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); let m0;
    const site = this.getSite();
    const send = (code, type, body, headers = {}) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers }); res.end(body); };
    try {
      if (p === '/__atrium/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write(': hi\n\n');
        this.clients.add(res); const ka = setInterval(() => { try { res.write(': k\n\n'); } catch {} }, 20000);
        req.on('close', () => { clearInterval(ka); this.clients.delete(res); }); return;
      }
      if (!lan && /^\/__atrium\/overlay\.(js|css)$/.test(p)) { const f = path.join(this.overlayDir, 'overlay.' + p.split('.').pop()); return send(200, p.endsWith('.js') ? 'text/javascript' : 'text/css', fs.readFileSync(f)); }
      if (!site) return send(200, 'text/html; charset=utf-8', '<!doctype html><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#888">No site open</body>');
      if (!lan && p.startsWith('/__atrium/lib/')) return send(200, 'text/html; charset=utf-8', libraryPreview(site, decodeURIComponent(p.split('/').pop()), u.searchParams.get('preset'), u.searchParams.get('tpl')));
      if (p.startsWith('/__atrium/section/')) {
        const id = p.split('/').pop(); const f = site.find(id); let page = f.page; if (!page) { try { page = site.page(u.searchParams.get('page') || 'index'); } catch { page = null; } }
        return send(200, 'application/json', JSON.stringify({ html: R.renderSection(site, f.section, page, this.ctx(site, false, 0)) }));
      }
      if ((m0 = /^\/__atrium\/ph\/([\w-]*)\/(\d+)x(\d+)-(\d+)\.svg$/.exec(p))) { const TH = require('./core/theme'); return send(200, 'image/svg+xml', R.phSvg(m0[2], m0[3], m0[4], m0[1] ? TH.presetTheme(m0[1]) : site.data.theme)); }
      if (p === '/assets/site.css') return send(200, 'text/css; charset=utf-8', R.siteCss(site, { asset: (x) => '/' + x }));
      if (p === '/assets/site.js') return send(200, 'text/javascript; charset=utf-8', R.siteJs(site));
      if (p.startsWith('/assets/')) {
        const rel = p.slice(1); const buf = EX.assetBuffer(site, rel);
        if (!buf) return send(404, 'text/plain', 'Not found');
        return send(200, EX.mime(rel), buf, { 'Cache-Control': rel.startsWith('assets/ph/') ? 'no-store' : 'max-age=5' });
      }
      const edit = !lan && (u.searchParams.has('edit') || /(^|;\s*)atrium_edit=1/.test(req.headers.cookie || ''));
      const cookie = !lan && u.searchParams.has('edit') ? { 'Set-Cookie': 'atrium_edit=1; Path=/; SameSite=Lax' } : !lan && u.searchParams.has('view') ? { 'Set-Cookie': 'atrium_edit=; Path=/; Max-Age=0' } : {};
      let m; let html = null;
      if (p === '/' || p === '/index.html') html = R.renderPage(site, site.page('index'), this.ctx(site, edit, 0));
      else if ((m = /^\/blog\/?(index\.html)?$/.exec(p))) html = site.data.pages.some((x) => x.slug === 'blog') ? R.renderPage(site, site.page('blog'), this.ctx(site, edit, 0)) : R.renderBlogIndex(site, this.ctx(site, edit, 1));
      else if ((m = /^\/blog\/([a-z0-9-]+)\.html$/.exec(p))) { const post = site.data.posts.find((x) => x.slug === m[1]); if (post) html = R.renderPost(site, post, this.ctx(site, edit, 1)); }
      else if ((m = /^\/([a-z0-9-]+)(\.html|\/)?$/.exec(p))) { const pg = site.data.pages.find((x) => x.slug === m[1]); if (pg) html = R.renderPage(site, pg, this.ctx(site, edit, 0)); }
      if (html == null) return send(404, 'text/html; charset=utf-8', `<!doctype html><body style="font:15px system-ui;padding:40px;color:#888">No page at ${p.replace(/[<>&]/g, '')}</body>`);
      if (lan) this.onVisit({ ua: req.headers['user-agent'] || '', at: Date.now(), path: p });
      return send(200, 'text/html; charset=utf-8', html, cookie);
    } catch (e) { return send(500, 'text/plain; charset=utf-8', 'Preview error: ' + (e.message || e)); }
  }
  ctx(site, edit, depth) {
    const v = site.data.updatedAt || Date.now();
    return R.withDefaults({ mode: 'preview', depth, cssHref: `assets/site.css?v=${v}`, jsHref: `assets/site.js?v=${v}`,
      extraHead: edit ? '<link rel="stylesheet" href="/__atrium/overlay.css">' : '',
      extraBody: LIVE + (edit ? '<script src="/__atrium/overlay.js"></script>' : '') });
  }
}

module.exports = { Preview, lanAddresses, qrRows };

// Atrium — renders a site into real web pages. The same code feeds the live preview, the AI's screenshots and
// every exporter, so what you see is what ships. Sections get their root tagged (data-s), their CSS scoped, and
// placeholders filled (navigation, site name, logo, year, blog cards, forms, icons).
'use strict';
const { scopeCss } = require('./scope');
const { themeVars, googleFontsHref, normalizeTheme, hexToRgb } = require('./theme');
const { markdown, esc, plain } = require('./markdown');
const { ICONS } = require('./site-icons');
const { baseCss } = require('./base-css');

const attrEsc = (s) => esc(String(s ?? ''));
const ROOT_RE = /^(\s*(?:<!--[\s\S]*?-->\s*)*)<([a-zA-Z][\w-]*)/;

// ───────── one section
function tagRoot(html, id) {
  html = String(html || '').trim();
  if (!ROOT_RE.test(html)) html = `<section>${html}</section>`;
  return html.replace(ROOT_RE, (m, pre, tag) => `${pre}<${tag} data-s="${id}"`).replace(new RegExp(`(<[a-zA-Z][\\w-]* data-s="${id}")([^>]*?)\\sdata-s="[^"]*"`), '$1$2');
}
function iconSvg(name) {
  const body = ICONS[name] || ICONS['sparkles'] || '';
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
function expandIcons(html) {
  return html.replace(/<i\b([^>]*\bdata-icon="([\w-]+)"[^>]*)>[\s\S]*?<\/i>/g, (m, attrs, name) => {
    let a = attrs.replace(/\saria-hidden="[^"]*"/, '');
    a = /\bclass="/.test(a) ? (/\bat-ic\b/.test(a) ? a : a.replace(/\bclass="/, 'class="at-ic ')) : a + ' class="at-ic"';
    return `<i${a} aria-hidden="true">${iconSvg(name)}</i>`;
  });
}
function navLinks(site, page, ctx) {
  return site.data.pages.filter((p) => p.nav).map((p) => {
    const cur = page && page.id === p.id ? ' aria-current="page"' : '';
    return `<a href="${ctx.link(p.slug)}"${cur}>${esc(p.title)}</a>`;
  }).join('');
}
function postCard(site, p, ctx) {
  const date = p.date ? new Date(p.date + 'T12:00:00').toLocaleDateString(site.data.settings.lang || 'en', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  return `<article class="at-post-card"><a href="${ctx.postLink(p.slug)}">${p.cover ? `<img class="at-media" src="${ctx.asset(p.cover)}" alt="${attrEsc(p.title)}" loading="lazy">` : ''}<div class="at-post-meta">${esc(date)}${p.tags && p.tags.length ? ` · ${esc(p.tags[0])}` : ''}</div><h3>${esc(p.title)}</h3><p>${esc(p.excerpt || plain(p.body).slice(0, 160))}</p></a></article>`;
}
function fill(html, site, page, ctx) {
  const st = site.data.settings; const name = st.name || site.data.name;
  const logo = st.logo ? `<img src="${ctx.asset(st.logo)}" alt="${attrEsc(name)}" class="at-logo-img">` : esc(name);
  html = html.replace(/<nav\b([^>]*\bdata-at-nav\b[^>]*)>[\s\S]*?<\/nav>/g, (m, a) => `<nav${a}>${navLinks(site, page, ctx)}</nav>`);
  html = html.replace(/<(\w+)\b([^>]*\bdata-at-sitename\b[^>]*)>[\s\S]*?<\/\1>/g, (m, t, a) => `<${t}${a}>${esc(name)}</${t}>`);
  html = html.replace(/<(\w+)\b([^>]*\bdata-at-tagline\b[^>]*)>[\s\S]*?<\/\1>/g, (m, t, a) => `<${t}${a}>${esc(st.tagline || '')}</${t}>`);
  html = html.replace(/<(\w+)\b([^>]*\bdata-at-year\b[^>]*)>[\s\S]*?<\/\1>/g, (m, t, a) => `<${t}${a}>${new Date().getFullYear()}</${t}>`);
  html = html.replace(/<img\b([^>]*\bdata-at-logo\b[^>]*?)\/?>/g, (m, a) => st.logo ? `<img${a.replace(/\s(src|alt)="[^"]*"/g, '')} src="${ctx.asset(st.logo)}" alt="${attrEsc(name)}">` : `<span${a.replace(/\s(src|alt|width|height)="[^"]*"/g, '')}>${esc(name)}</span>`);
  html = html.replace(/<(span|div|strong|b)\b([^>]*\bdata-at-logo\b[^>]*)>[\s\S]*?<\/\1>/g, (m, t, a) => `<${t}${a}>${logo}</${t}>`);
  html = html.replace(/<(\w+)\b([^>]*\bdata-at-posts\b[^>]*)>[\s\S]*?<\/\1>/g, (m, t, a) => {
    const lim = +((/data-limit="(\d+)"/.exec(a) || [])[1] || 0); const tag = (/data-tag="([^"]+)"/.exec(a) || [])[1];
    if (ctx.target === 'wordpress') return `<${t}${a}>{{atrium:posts:${lim || 0}:${tag || ''}}}</${t}>`;
    let posts = site.data.posts.filter((p) => !p.draft && (!tag || (p.tags || []).includes(tag)));
    if (lim) posts = posts.slice(0, lim);
    return `<${t}${a}>${posts.length ? posts.map((p) => postCard(site, p, ctx)).join('') : '<p class="at-muted">No posts yet.</p>'}</${t}>`;
  });
  html = html.replace(/<form\b([^>]*\bdata-at-form\b[^>]*)>/g, (m, a) => {
    a = a.replace(/\s(action|method|enctype|data-netlify|netlify)="[^"]*"/g, ''); const f = st.forms || {}; const fname = (/\bname="([^"]+)"/.exec(a) || [])[1] || 'contact';
    if (ctx.mode === 'preview') return `<form${a} data-at-preview-form>`;
    if (ctx.target === 'wordpress' && (f.provider === 'wordpress' || f.provider === 'netlify' || !(f.endpoint || (f.provider === 'mailto' && f.email)))) return `<form${a} method="post" action="{{atrium:form}}"><input type="hidden" name="action" value="atrium_form"><input type="hidden" name="atrium_form" value="${attrEsc(fname)}">`;
    if (f.provider === 'netlify') return `<form${a} method="POST" data-netlify="true"><input type="hidden" name="form-name" value="${attrEsc(fname)}">`;
    if (f.provider === 'mailto' && f.email) return `<form${a} action="mailto:${attrEsc(f.email)}" method="post" enctype="text/plain">`;
    if (f.endpoint) return `<form${a} action="${attrEsc(f.endpoint)}" method="POST">`;
    return `<form${a}>`;
  });
  return expandIcons(html);
}
// rewrite asset and page links for the destination (export targets)
function relink(html, ctx) {
  html = html.replace(/(\s(?:src|href|poster|data-src)=")(\.\.\/)?(assets\/[^"]+)"/g, (m, a, up, p) => `${a}${ctx.asset(p)}"`);
  html = html.replace(/(\ssrcset=")([^"]+)"/g, (m, a, v) => a + v.split(',').map((x) => { const [u, ...r] = x.trim().split(/\s+/); return [/^(\.\.\/)?assets\//.test(u) ? ctx.asset(u.replace(/^\.\.\//, '')) : u, ...r].join(' '); }).join(', ') + '"');
  html = html.replace(/url\((['"]?)(\.\.\/)?(assets\/[^'")]+)\1\)/g, (m, q, up, p) => `url(${q}${ctx.asset(p)}${q})`);
  html = html.replace(/(\shref=")(\.\.\/)?(blog\/)([a-z0-9-]+)\.html(#[^"]*)?"/g, (m, a, up, b, slug, hash) => `${a}${slug === 'index' ? ctx.blogLink() : ctx.postLink(slug)}${hash || ''}"`);
  html = html.replace(/(\shref=")(\.\.\/)?([a-z0-9-]+)\.html(#[^"]*)?"/g, (m, a, up, slug, hash) => `${a}${ctx.link(slug)}${hash || ''}"`);
  return html;
}
function renderSection(site, sec, page, ctx) { return relink(fill(tagRoot(sec.html, sec.id), site, page, ctx), ctx); }
function sectionCss(sec, ctx) { let css = scopeCss(sec.css || '', `[data-s="${sec.id}"]`); if (ctx) css = css.replace(/url\((['"]?)(\.\.\/)?(assets\/[^'")]+)\1\)/g, (m, q, up, p) => `url(${q}${ctx.asset(p)}${q})`); return css; }

// ───────── site-wide CSS and JS
const POST_CSS = `.at-article{padding:clamp(48px,8vw,110px) 0}.at-article header{margin-bottom:36px}.at-article .at-post-meta{color:var(--at-muted);font-size:.92rem;margin-bottom:14px}.at-article h1{font-size:clamp(2.1rem,4.6vw,3.4rem);margin:0 0 18px}.at-article .at-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--at-radius);margin:10px 0 40px;border:1px solid var(--at-border)}
.at-prose{font-size:1.09rem;line-height:1.75}.at-prose>*+*{margin-top:1.1em}.at-prose h2{font-size:1.7rem;margin-top:1.8em}.at-prose h3{font-size:1.3rem;margin-top:1.5em}.at-prose a{color:var(--at-primary);text-underline-offset:3px}.at-prose img{max-width:100%;border-radius:var(--at-radius-sm)}.at-prose blockquote{margin:1.5em 0;padding:4px 0 4px 20px;border-left:3px solid var(--at-primary);color:var(--at-muted);font-size:1.15rem}.at-prose pre{background:var(--at-surface-2);border:1px solid var(--at-border);padding:16px 18px;border-radius:var(--at-radius-sm);overflow:auto;font-size:.92rem}.at-prose code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}.at-prose :not(pre)>code{background:var(--at-surface-2);padding:.12em .4em;border-radius:6px}.at-prose table{width:100%;border-collapse:collapse}.at-prose th,.at-prose td{border-bottom:1px solid var(--at-border);padding:10px;text-align:left}.at-prose ul,.at-prose ol{padding-left:1.3em}.at-prose li+li{margin-top:.4em}
.at-post-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--at-gap);margin-top:40px}.at-back{display:inline-flex;gap:6px;align-items:center;color:var(--at-muted);text-decoration:none;font-size:.95rem;margin-bottom:24px}.at-back:hover{color:var(--at-text)}
.at-form-note{margin-top:12px;padding:10px 14px;border-radius:var(--at-radius-sm);background:color-mix(in srgb,var(--at-primary) 12%,transparent);color:var(--at-text);font-size:.92rem}`;

function siteCss(site, ctx) {
  const d = site.data; const out = [themeVars(d.theme), baseCss(), POST_CSS];
  if (d.settings.reveal === false) out.push('[data-reveal]{opacity:1!important;transform:none!important}');
  const secs = site.allSections().map((x) => x.section);
  for (const s of secs) if (s.css && s.css.trim()) out.push(`/* ${s.name.replace(/\*\//g, '')} */\n${sectionCss(s, ctx)}`);
  if (d.customCss) out.push('/* custom */\n' + d.customCss);
  return out.join('\n');
}
const RUNTIME = `(function(){var d=document,R=d.documentElement;R.classList.add('at-js');
var io='IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var t=e.target,dl=+t.getAttribute('data-delay')||0;setTimeout(function(){t.classList.add('at-in')},dl);io.unobserve(t)}})},{rootMargin:'0px 0px -8% 0px',threshold:.08}):null;
function reveal(root){(root||d).querySelectorAll('[data-reveal]:not(.at-in)').forEach(function(el){io?io.observe(el):el.classList.add('at-in')})}
function count(root){(root||d).querySelectorAll('[data-count]').forEach(function(el){if(el.__c)return;el.__c=1;var to=parseFloat(el.getAttribute('data-count'))||0,suf=el.getAttribute('data-suffix')||'',pre=el.getAttribute('data-prefix')||'',dec=(String(to).split('.')[1]||'').length;var run=function(){var t0=performance.now(),D=1400;(function f(n){var k=Math.min(1,(n-t0)/D),v=to*(1-Math.pow(1-k,3));el.textContent=pre+v.toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec})+suf;if(k<1)requestAnimationFrame(f)})(t0)};if(!io){el.textContent=pre+to.toLocaleString()+suf;return}var o=new IntersectionObserver(function(es){if(es[0].isIntersecting){o.disconnect();run()}});o.observe(el)})}
d.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-at-menu-toggle]');if(t){var r=t.closest('[data-s]')||d.body;var on=!r.classList.contains('at-open');r.classList.toggle('at-open',on);t.setAttribute('aria-expanded',on);return}var a=e.target.closest&&e.target.closest('a[href^="#"]');if(a&&a.getAttribute('href').length>1){var x=d.querySelector(a.getAttribute('href'));if(x){e.preventDefault();x.scrollIntoView({behavior:'smooth',block:'start'});history.replaceState(null,'',a.getAttribute('href'))}}var n=e.target.closest&&e.target.closest('[data-at-nav] a');if(n){var o=n.closest('.at-open');if(o)o.classList.remove('at-open')}});
d.addEventListener('submit',function(e){var f=e.target;if(!f.matches('[data-at-preview-form],form[data-at-form]:not([action]):not([data-netlify])'))return;e.preventDefault();var m=f.querySelector('.at-form-note')||d.createElement('div');m.className='at-form-note';m.setAttribute('role','status');m.textContent=f.hasAttribute('data-at-preview-form')?'Preview: this form will send once forms are set up (Site settings → Forms).':'Thanks! (This form isn’t connected yet.)';f.appendChild(m)});
var hdr=function(){d.querySelectorAll('header[data-s]').forEach(function(h){h.classList.toggle('at-scrolled',scrollY>8)})};addEventListener('scroll',hdr,{passive:true});
window.Atrium={refresh:function(r){reveal(r);count(r);hdr()}};
if(d.readyState!=='loading')Atrium.refresh();else d.addEventListener('DOMContentLoaded',function(){Atrium.refresh()});})();`;

function sectionJs(secs) {
  return secs.filter((s) => s.js && s.js.trim()).map((s) => `;(function(root){if(!root)return;try{\n${s.js}\n}catch(e){console.error('Section ${s.name.replace(/'/g, '')}:',e)}})(document.querySelector('[data-s="${s.id}"]'));`).join('\n');
}
function siteJs(site) { return RUNTIME + '\n' + sectionJs(site.allSections().map((x) => x.section)) + (site.data.customJs ? '\n;(function(){' + site.data.customJs + '\n})();' : ''); }

// ───────── head: SEO, social, fonts, analytics
function analytics(st, where) {
  const a = st.analytics || {}; const out = [];
  if (where === 'head') {
    if (a.gtm) out.push(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${attrEsc(a.gtm)}');</script>`);
    if (a.ga4) out.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${attrEsc(a.ga4)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${attrEsc(a.ga4)}');</script>`);
    if (a.metaPixel) out.push(`<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${attrEsc(a.metaPixel)}');fbq('track','PageView');</script>`);
    if (a.plausible) out.push(`<script defer data-domain="${attrEsc(a.plausible)}" src="https://plausible.io/js/script.js"></script>`);
  } else if (a.gtm) out.push(`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${attrEsc(a.gtm)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`);
  return out.join('\n');
}
function pageMeta(site, page, post) {
  const st = site.data.settings; const name = st.name || site.data.name;
  let title, desc, og;
  if (post) { title = `${post.title} — ${name}`; desc = post.excerpt || plain(post.body).slice(0, 155); og = post.cover; }
  else { title = page.seo.title || (page.slug === 'index' ? (st.tagline ? `${name} — ${st.tagline}` : name) : `${page.title} — ${name}`); desc = page.seo.description || st.description || st.tagline || ''; og = page.seo.ogImage || st.ogImage; }
  return { title, desc, og };
}
function schema(site) {
  const st = site.data.settings; const name = st.name || site.data.name; if (!st.schema || st.schema === 'none') return '';
  const o = { '@context': 'https://schema.org', '@type': st.schema || 'Organization', name };
  if (st.url) o.url = st.url; if (st.logo && st.url) o.logo = st.url.replace(/\/$/, '') + '/' + st.logo; if (st.description) o.description = st.description;
  const same = Object.values(st.social || {}).filter((x) => /^https?:/.test(x)); if (same.length) o.sameAs = same;
  if (st.phone) o.telephone = st.phone; if (st.email) o.email = st.email; if (st.address) o.address = st.address;
  return `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
}
function head(site, page, post, ctx, extraHead = '') {
  const st = site.data.settings; const d = site.data; const m = pageMeta(site, page, post);
  const abs = (p) => (st.url && p ? st.url.replace(/\/$/, '') + '/' + p.replace(/^\//, '') : ctx.asset(p));
  const canon = st.url ? st.url.replace(/\/$/, '') + '/' + (post ? `blog/${post.slug}.html` : page.slug === 'index' ? '' : page.slug + '.html') : '';
  const fonts = googleFontsHref(d.theme);
  const tc = normalizeTheme(d.theme).colors.bg;
  return [
    '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(m.title)}</title>`, m.desc ? `<meta name="description" content="${attrEsc(m.desc)}">` : '',
    canon ? `<link rel="canonical" href="${attrEsc(canon)}">` : '',
    page && page.seo && page.seo.noindex ? '<meta name="robots" content="noindex">' : '',
    `<meta property="og:type" content="${post ? 'article' : 'website'}">`, `<meta property="og:title" content="${attrEsc(m.title)}">`, m.desc ? `<meta property="og:description" content="${attrEsc(m.desc)}">` : '',
    m.og ? `<meta property="og:image" content="${attrEsc(abs(m.og))}">` : '', canon ? `<meta property="og:url" content="${attrEsc(canon)}">` : '', `<meta property="og:site_name" content="${attrEsc(st.name || d.name)}">`,
    `<meta name="twitter:card" content="${m.og ? 'summary_large_image' : 'summary'}">`,
    `<meta name="theme-color" content="${attrEsc(tc)}">`,
    st.favicon ? `<link rel="icon" href="${ctx.asset(st.favicon)}">` : '',
    fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${fonts}">` : '',
    ctx.inline ? `<style>${ctx.css}</style>` : `<link rel="stylesheet" href="${ctx.cssHref}">`,
    schema(site),
    ctx.mode === 'export' ? analytics(st, 'head') : '',
    st.headCode || '',
    extraHead,
  ].filter(Boolean).join('\n');
}

function shell(site, page, post, mainHtml, ctx) {
  const d = site.data; const g = d.globals;
  const hdr = g.header ? renderSection(site, g.header, page, ctx) : '';
  const ftr = g.footer ? renderSection(site, g.footer, page, ctx) : '';
  const base = ctx.depth ? '<base href="../">' : '';
  const js = ctx.inline ? `<script>${ctx.js}</script>` : `<script src="${ctx.jsHref}" defer></script>`;
  return `<!doctype html>
<html lang="${attrEsc(d.settings.lang || 'en')}" data-theme="${d.theme.mode}">
<head>
${base}${head(site, page, post, ctx, ctx.extraHead || '')}
</head>
<body${page ? ` data-page="${attrEsc(page.slug)}"` : ' data-page="post"'}>
${ctx.mode === 'export' ? analytics(d.settings, 'body') : ''}
${hdr}
<main id="main">
${mainHtml}
</main>
${ftr}
${js}
${ctx.mode === 'export' ? d.settings.bodyCode || '' : ''}${ctx.extraBody || ''}
</body>
</html>`;
}

function renderPage(site, page, ctx) {
  ctx = withDefaults(ctx);
  const main = page.sections.map((s) => renderSection(site, s, page, ctx)).join('\n');
  return shell(site, page, null, main || (ctx.mode === 'preview' ? '<section data-at-empty style="padding:120px 20px;text-align:center;color:var(--at-muted)"><p>This page is empty. Add a section from the library, or ask the AI to build it.</p></section>' : ''), ctx);
}
function renderPost(site, post, ctx) {
  ctx = withDefaults({ ...ctx });
  const blogPage = site.data.pages.find((p) => p.slug === 'blog');
  const date = post.date ? new Date(post.date + 'T12:00:00').toLocaleDateString(site.data.settings.lang || 'en', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const main = `<article class="at-article"><div class="at-container narrow"><a class="at-back" href="${blogPage ? ctx.link('blog') : ctx.blogLink()}">${iconSvg('arrow-left')} All posts</a><header><div class="at-post-meta">${esc(date)}${post.author ? ' · ' + esc(post.author) : ''}${(post.tags || []).length ? ' · ' + post.tags.map(esc).join(', ') : ''}</div><h1>${esc(post.title)}</h1>${post.excerpt ? `<p class="at-lead">${esc(post.excerpt)}</p>` : ''}</header>${post.cover ? `<img class="at-cover" src="${ctx.asset(post.cover)}" alt="${attrEsc(post.title)}">` : ''}<div class="at-prose">${relink(markdown(post.body), ctx)}</div></div></article>`;
  return shell(site, null, post, main, ctx);
}
function renderBlogIndex(site, ctx) {
  ctx = withDefaults({ ...ctx });
  const posts = site.data.posts.filter((p) => !p.draft);
  const main = `<section class="at-article"><div class="at-container"><p class="at-eyebrow">Blog</p><h1 class="at-h1">Latest posts</h1><div class="at-post-list">${posts.map((p) => postCard(site, p, ctx)).join('')}</div></div></section>`;
  return shell(site, { id: '_blog', slug: 'blog', title: 'Blog', seo: { title: '', description: '' } }, null, main, ctx);
}
function withDefaults(ctx = {}) {
  return {
    mode: 'export', target: 'static', depth: 0,
    link: (slug) => (slug === 'index' ? 'index.html' : `${slug}.html`),
    postLink: (slug) => `blog/${slug}.html`, blogLink: () => 'blog/index.html',
    asset: (p) => p, cssHref: 'assets/site.css', jsHref: 'assets/site.js', ...ctx,
  };
}

// ───────── placeholder art: tasteful gradients in the site's own colours
function phSvg(w, h, n, theme) {
  const t = normalizeTheme(theme); const c = t.colors; w = Math.max(8, Math.min(4000, +w || 1200)); h = Math.max(8, Math.min(4000, +h || 800)); n = ((+n || 1) - 1) % 12;
  const cols = [c.primary, c.accent, c.surface, c.bg, c.surface2];
  const pick = (i) => cols[(i + n) % cols.length];
  const rnd = (k) => { const x = Math.sin((n + 1) * 9301 + k * 49297) * 233280; return x - Math.floor(x); };
  const blobs = [0, 1, 2, 3].map((i) => `<circle cx="${(rnd(i) * w).toFixed(0)}" cy="${(rnd(i + 7) * h).toFixed(0)}" r="${((0.25 + rnd(i + 3) * 0.35) * Math.max(w, h)).toFixed(0)}" fill="${i % 2 ? c.accent : c.primary}" opacity="${(0.35 + rnd(i + 11) * 0.4).toFixed(2)}"/>`).join('');
  const [r, g, b] = hexToRgb(c.text); const line = `rgba(${r},${g},${b},.07)`;
  const deco = n % 3 === 0 ? `<g stroke="${line}" stroke-width="1">${Array.from({ length: Math.ceil(w / 48) }, (_, i) => `<path d="M${i * 48} 0V${h}"/>`).join('')}${Array.from({ length: Math.ceil(h / 48) }, (_, i) => `<path d="M0 ${i * 48}H${w}"/>`).join('')}</g>`
    : n % 3 === 1 ? `<g fill="none" stroke="${line}" stroke-width="1.5">${[0.18, 0.3, 0.42, 0.54].map((k) => `<circle cx="${w * 0.72}" cy="${h * 0.38}" r="${Math.max(w, h) * k}"/>`).join('')}</g>`
      : `<g fill="${line}">${Array.from({ length: 80 }, (_, i) => `<circle cx="${(rnd(i + 20) * w).toFixed(0)}" cy="${(rnd(i + 120) * h).toFixed(0)}" r="${(1 + rnd(i + 220) * 2).toFixed(1)}"/>`).join('')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pick(3)}"/><stop offset="1" stop-color="${pick(2)}"/></linearGradient><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(Math.max(w, h) / 9).toFixed(0)}"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/><g filter="url(#b)">${blobs}</g>${deco}</svg>`;
}
const PH_RE = /assets\/ph\/(\d+)x(\d+)-(\d+)\.svg/g;
function placeholdersUsed(site) {
  const set = new Set(); const scan = (s) => { for (const m of String(s || '').matchAll(PH_RE)) set.add(m[0]); };
  for (const x of site.allSections()) { scan(x.section.html); scan(x.section.css); }
  for (const p of site.data.posts) { scan(p.cover); scan(p.body); }
  const st = site.data.settings; scan(st.ogImage); scan(st.logo); site.data.pages.forEach((p) => scan(p.seo.ogImage)); scan(site.data.customCss);
  return [...set];
}

module.exports = { analytics, renderPage, renderPost, renderBlogIndex, renderSection, sectionCss, siteCss, siteJs, tagRoot, fill, relink, expandIcons, iconSvg, phSvg, placeholdersUsed, withDefaults, pageMeta, RUNTIME, PH_RE };

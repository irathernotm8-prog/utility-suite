// Atrium — exports. Every format comes from the same renderer as the preview:
//   static     — a complete static site (any host: Netlify, GitHub Pages, cPanel, S3…), with sitemap and robots
//   single     — each page as one self-contained .html file (CSS, JS and images inside)
//   wordpress  — a block theme that sets itself up on activation (pages, posts, front page, menu-aware links,
//                live post cards, a working contact form) + a WXR file for Tools › Import
//   embed      — for site builders (Weebly, Wix, Squarespace, Webflow, Shopify, Google Sites, Carrd…): head code,
//                whole-page snippets, per-section snippets and iframe-ready pages, with instructions per platform
//   weebly     — Weebly theme files (header template with {menu}/{content}/{footer}, main.css, assets)
//   backup     — a .atrium file (the site + assets) to move or share a site; imports back into Atrium
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./render');
const { scopeCss } = require('./scope');
const { themeVars, googleFontsHref } = require('./theme');
const { baseCss } = require('./base-css');
const { markdown, esc } = require('./markdown');
const { makeZip } = require('./zip');
const { slugify } = require('./site');

const FORMATS = [
  { id: 'static', name: 'Static website', blurb: 'HTML, CSS and JS for any host — Netlify, GitHub Pages, Vercel, cPanel, S3. Includes sitemap.xml and robots.txt.' },
  { id: 'wordpress', name: 'WordPress theme', blurb: 'A block theme. Upload it, activate it, and it creates your pages and posts, sets the front page and wires up the contact form. Also a WXR file for Tools › Import.' },
  { id: 'embed', name: 'Site builders (Weebly, Wix, Squarespace…)', blurb: 'Head code plus page and section snippets for Embed / Custom HTML / Code blocks, with steps for each platform.' },
  { id: 'weebly', name: 'Weebly theme files', blurb: 'For Theme › Edit HTML/CSS: a header template using Weebly’s {menu}, {content} and {footer} tags, the stylesheet and assets.' },
  { id: 'single', name: 'Single-file pages', blurb: 'Each page as one .html file with everything inside — for email, sharing or iframes.' },
  { id: 'backup', name: 'Atrium backup (.atrium)', blurb: 'The whole site and its assets, to move to another computer or share. Opens in Atrium.' },
];

const mime = (f) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.xml': 'application/xml', '.txt': 'text/plain', '.pdf': 'application/pdf' }[path.extname(f).toLowerCase()] || 'application/octet-stream');

// every asset the site has (copied as-is) plus the placeholder art it uses (generated)
function assetFiles(site) {
  const out = [];
  for (const a of site.listAssets()) out.push({ name: a.path, data: fs.readFileSync(site.p(a.path)) });
  for (const ph of R.placeholdersUsed(site)) { const m = /(\d+)x(\d+)-(\d+)/.exec(ph); out.push({ name: ph, data: Buffer.from(R.phSvg(m[1], m[2], m[3], site.data.theme)) }); }
  return out;
}
function assetBuffer(site, rel) {
  rel = rel.replace(/^\.\.\//, '').split('#')[0].split('?')[0];
  const m = /^assets\/ph\/(\d+)x(\d+)-(\d+)\.svg$/.exec(rel); if (m) return Buffer.from(R.phSvg(m[1], m[2], m[3], site.data.theme));
  const p = site.p(rel); if (!p.startsWith(site.dir) || !fs.existsSync(p)) return null; return fs.readFileSync(p);
}
const dataUrl = (site, rel) => { const b = assetBuffer(site, rel); return b ? `data:${mime(rel)};base64,${b.toString('base64')}` : rel; };

function sitemap(site) {
  const base = (site.data.settings.url || '').replace(/\/$/, ''); if (!base) return null; const today = new Date().toISOString().slice(0, 10);
  const urls = site.data.pages.filter((p) => !p.seo.noindex).map((p) => `${base}/${p.slug === 'index' ? '' : p.slug + '.html'}`).concat(site.data.posts.filter((p) => !p.draft).map((p) => `${base}/blog/${p.slug}.html`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}
const robots = (site) => `User-agent: *\nAllow: /\n${site.data.settings.url ? `Sitemap: ${site.data.settings.url.replace(/\/$/, '')}/sitemap.xml\n` : ''}`;
const hasBlogPage = (site) => site.data.pages.some((p) => p.slug === 'blog');

// ───────── static
function staticFiles(site, opts = {}) {
  const ctx = R.withDefaults({ mode: 'export', target: 'static' });
  const files = [];
  for (const p of site.data.pages) files.push({ name: `${p.slug}.html`, data: R.renderPage(site, p, ctx) });
  for (const p of site.data.posts.filter((x) => !x.draft)) files.push({ name: `blog/${p.slug}.html`, data: R.renderPost(site, p, { ...ctx, depth: 1 }) });
  if (site.data.posts.length) files.push({ name: 'blog/index.html', data: hasBlogPage(site) ? R.renderPage(site, site.page('blog'), { ...ctx, depth: 1 }) : R.renderBlogIndex(site, { ...ctx, depth: 1 }) });
  if (!site.data.pages.some((p) => p.slug === '404')) files.push({ name: '404.html', data: R.renderPage(site, { id: '_404', slug: '404', title: 'Not found', seo: { title: '', description: '', noindex: true }, sections: [{ id: 'e404', name: '404', html: '<section style="padding:140px 0;text-align:center"><div class="at-container narrow at-stack"><p class="at-eyebrow">404</p><h1 class="at-h1">This page wandered off</h1><p class="at-lead">The link may be old, or the page moved.</p><p><a class="at-btn at-btn-primary" href="index.html">Back home</a></p></div></section>', css: '', js: '' }] }, ctx) });
  files.push({ name: 'assets/site.css', data: R.siteCss(site, { asset: (p) => p.replace(/^assets\//, '') }) });
  files.push({ name: 'assets/site.js', data: R.siteJs(site) });
  files.push(...assetFiles(site));
  const sm = sitemap(site); if (sm) files.push({ name: 'sitemap.xml', data: sm });
  files.push({ name: 'robots.txt', data: robots(site) });
  if (opts.readme !== false) files.push({ name: 'README.txt', data: `${site.data.name} — exported from Atrium on ${new Date().toLocaleString()}\n\nUpload everything in this folder to your host's web root (public_html, www, or the publish folder).\nOpen index.html to view it locally.\n\nNetlify: drag this folder onto app.netlify.com/drop\nGitHub Pages: push these files to a repo and turn on Pages (Settings › Pages › Deploy from branch).\nVercel: vercel deploy in this folder.\n${site.data.settings.url ? '' : '\nTip: set the site address in Atrium (Site settings) so sitemap.xml and social previews use full links.\n'}` });
  return files;
}

// ───────── single-file pages
function singleFiles(site) {
  const css = R.siteCss(site, { asset: (p) => dataUrl(site, p) }); const js = R.siteJs(site);
  const inline = (html) => html.replace(/(\s(?:src|poster)=")((?:\.\.\/)?assets\/[^"]+)"/g, (m, a, p) => `${a}${dataUrl(site, p)}"`).replace(/url\((['"]?)((?:\.\.\/)?assets\/[^'")]+)\1\)/g, (m, q, p) => `url(${q}${dataUrl(site, p)}${q})`);
  const ctx = R.withDefaults({ mode: 'export', target: 'single', inline: true, css, js, postLink: (s) => `post-${s}.html`, blogLink: () => 'blog.html' });
  const files = site.data.pages.map((p) => ({ name: `${p.slug}.html`, data: inline(R.renderPage(site, p, ctx)) }));
  for (const p of site.data.posts.filter((x) => !x.draft)) files.push({ name: `post-${p.slug}.html`, data: inline(R.renderPost(site, p, ctx)) });
  if (site.data.posts.length && !hasBlogPage(site)) files.push({ name: 'blog.html', data: inline(R.renderBlogIndex(site, ctx)) });
  return files;
}

// ───────── WordPress block theme (+ WXR)
const T = (s) => `{{atrium:${s}}}`;
function wpCtx() {
  return R.withDefaults({ mode: 'export', target: 'wordpress', link: (slug) => (slug === 'index' ? T('home') : T('page:' + slug)), postLink: (s) => T('post:' + s), blogLink: () => T('blog'), asset: (p) => T('asset:' + p.replace(/^\.\.\//, '')) });
}
const block = (html) => `<!-- wp:html -->\n${html}\n<!-- /wp:html -->`;
const phpStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
function wordpressFiles(site) {
  const d = site.data; const st = d.settings; const ctx = wpCtx(); const slug = slugify(d.name) || 'site'; const dir = `atrium-${slug}`; const theme = d.theme;
  const files = []; const F = (n, data) => files.push({ name: `${dir}/${n}`, data });
  const version = `1.0.${Math.floor(Date.now() / 1000)}`;
  const wpFix = `
/* WordPress resets for Atrium sections */
.wp-site-blocks{padding:0!important}.wp-site-blocks>*,.wp-block-post-content>*,.entry-content>*{margin-block-start:0;margin-block-end:0}
.wp-block-post-content,.entry-content{max-width:none}.wp-block-template-part{margin:0}
.at-wp-query{padding:clamp(48px,8vw,110px) 0}.at-wp-query .wp-block-post-template{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--at-gap);list-style:none;padding:0;margin:32px 0 0}
.at-wp-query .wp-block-post{background:var(--at-surface);border:1px solid var(--at-border);border-radius:var(--at-radius);padding:18px;overflow:hidden}.at-wp-query .wp-block-post-featured-image img{border-radius:calc(var(--at-radius) - 6px);aspect-ratio:16/10;object-fit:cover}
.at-wp-query .wp-block-post-title a{color:var(--at-text);text-decoration:none}.at-wp-query .wp-block-post-date{color:var(--at-muted);font-size:.9rem}
.at-wp-sent{margin:0;padding:14px 20px;text-align:center;background:color-mix(in srgb,var(--at-primary) 16%,transparent);color:var(--at-text)}`;
  F('style.css', `/*
Theme Name: ${d.name.replace(/\*\//g, '')} (Atrium)
Theme URI: ${st.url || ''}
Author: Atrium
Description: ${String(st.tagline || 'Built with Atrium').replace(/\*\//g, '')}. Activating this theme creates the site's pages and posts (only the ones that don't exist yet) and sets the front page.
Version: ${version}
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 7.4
License: All rights reserved
Text Domain: ${dir}
*/
${R.siteCss(site, { asset: (p) => p })}
${wpFix}
`);
  const c = theme.colors;
  F('theme.json', JSON.stringify({
    $schema: 'https://schemas.wp.org/trunk/theme.json', version: 3,
    settings: { appearanceTools: true, useRootPaddingAwareAlignments: false,
      layout: { contentSize: '760px', wideSize: (theme.maxWidth || 1200) + 'px' },
      color: { defaultPalette: false, palette: [['bg', 'Background', c.bg], ['surface', 'Surface', c.surface], ['text', 'Text', c.text], ['muted', 'Muted', c.muted], ['primary', 'Primary', c.primary], ['accent', 'Accent', c.accent], ['border', 'Border', c.border]].map(([s, n, col]) => ({ slug: s, name: n, color: col })) },
      typography: { fontFamilies: [{ slug: 'heading', name: theme.fonts.heading, fontFamily: 'var(--at-font-h)' }, { slug: 'body', name: theme.fonts.body, fontFamily: 'var(--at-font-b)' }] },
      spacing: { blockGap: '0px' } },
    styles: { color: { background: c.bg, text: c.text }, typography: { fontFamily: 'var(--at-font-b)' }, spacing: { blockGap: '0px', padding: { top: '0', bottom: '0', left: '0', right: '0' } }, elements: { link: { color: { text: c.primary } } } },
    templateParts: [{ name: 'header', title: 'Header', area: 'header' }, { name: 'footer', title: 'Footer', area: 'footer' }],
  }, null, 2));
  const H = '<!-- wp:template-part {"slug":"header","tagName":"div"} /-->';
  const Fo = '<!-- wp:template-part {"slug":"footer","tagName":"div"} /-->';
  const content = '<!-- wp:post-content {"layout":{"type":"default"}} /-->';
  F('templates/page.html', `${H}\n${content}\n${Fo}\n`);
  F('templates/front-page.html', `${H}\n${content}\n${Fo}\n`);
  const query = `<!-- wp:group {"className":"at-wp-query"} -->
<div class="wp-block-group at-wp-query"><!-- wp:group {"className":"at-container"} -->
<div class="wp-block-group at-container"><!-- wp:query-title {"type":"archive","showPrefix":false,"className":"at-h1"} /-->
<!-- wp:query {"queryId":1,"query":{"perPage":12,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","inherit":true}} -->
<div class="wp-block-query"><!-- wp:post-template -->
<!-- wp:post-featured-image {"isLink":true} /-->
<!-- wp:post-date /-->
<!-- wp:post-title {"isLink":true,"level":3} /-->
<!-- wp:post-excerpt /-->
<!-- /wp:post-template -->
<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->
<!-- wp:query-pagination-numbers /-->
<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination --></div>
<!-- /wp:query --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->`;
  F('templates/index.html', `${H}\n${query}\n${Fo}\n`);
  F('templates/home.html', `${H}\n${query}\n${Fo}\n`);
  F('templates/archive.html', `${H}\n${query}\n${Fo}\n`);
  F('templates/single.html', `${H}
<!-- wp:group {"tagName":"article","className":"at-article"} -->
<article class="wp-block-group at-article"><!-- wp:group {"className":"at-container narrow"} -->
<div class="wp-block-group at-container narrow"><!-- wp:post-date {"className":"at-post-meta"} /-->
<!-- wp:post-title {"level":1} /-->
<!-- wp:post-featured-image {"className":"at-cover"} /-->
<!-- wp:post-content {"className":"at-prose","layout":{"type":"default"}} /--></div>
<!-- /wp:group --></article>
<!-- /wp:group -->
${Fo}\n`);
  F('templates/404.html', `${H}\n${block('<section style="padding:140px 0;text-align:center"><div class="at-container narrow at-stack"><p class="at-eyebrow">404</p><h1 class="at-h1">This page wandered off</h1><p><a class="at-btn at-btn-primary" href="{{atrium:home}}">Back home</a></p></div></section>')}\n${Fo}\n`);
  F('parts/header.html', d.globals.header ? block(R.renderSection(site, d.globals.header, null, ctx)) + '\n' : '');
  F('parts/footer.html', d.globals.footer ? block(R.renderSection(site, d.globals.footer, null, ctx)) + '\n' : '');
  F('assets/site.js', R.siteJs(site));
  for (const a of assetFiles(site)) F(a.name, a.data);
  // content the theme creates on activation
  const pages = d.pages.map((p) => ({ slug: p.slug === 'index' ? 'home' : p.slug, atrium: p.slug, title: p.title, front: p.slug === 'index', nav: p.nav, description: p.seo.description || '', file: `content/page-${p.slug}.html` }));
  for (const p of d.pages) F(`content/page-${p.slug}.html`, p.sections.map((s) => block(R.renderSection(site, s, p, ctx))).join('\n\n'));
  const posts = d.posts.filter((p) => !p.draft).map((p) => ({ slug: p.slug, title: p.title, date: p.date, excerpt: p.excerpt || '', tags: p.tags || [], cover: p.cover || '', file: `content/post-${p.slug}.html` }));
  for (const p of d.posts.filter((x) => !x.draft)) F(`content/post-${p.slug}.html`, R.relink(markdown(p.body), ctx));
  F('content/site.json', JSON.stringify({ pages, posts, blogPage: hasBlogPage(site) ? 'blog' : '' }, null, 2));
  const fonts = googleFontsHref(theme);
  const headExtra = st.headCode || '';
  const analyticsHead = analyticsBlock(st);
  F('functions.php', `<?php
/**
 * ${d.name.replace(/\*\//g, '')} — WordPress theme exported from Atrium.
 * Links written as {{atrium:…}} are resolved here, so menus, posts and assets always point at the right place.
 */
if (!defined('ABSPATH')) exit;

add_action('after_setup_theme', function () {
  add_theme_support('post-thumbnails');
  add_theme_support('title-tag');
  add_theme_support('responsive-embeds');
  add_theme_support('html5', ['search-form', 'gallery', 'caption', 'style', 'script']);
});

add_action('wp_enqueue_scripts', function () {
  $v = wp_get_theme()->get('Version');
  ${fonts ? `wp_enqueue_style('atrium-fonts', ${phpStr(fonts)}, [], null);` : ''}
  wp_enqueue_style('atrium-site', get_stylesheet_uri(), [], $v);
  wp_enqueue_script('atrium-site', get_theme_file_uri('assets/site.js'), [], $v, true);
});

add_action('wp_head', function () {
  echo ${phpStr(analyticsHead + headExtra)};
}, 20);
${st.bodyCode ? `add_action('wp_footer', function () { echo ${phpStr(st.bodyCode)}; }, 20);\n` : ''}
function atrium_page_url($slug) {
  if ($slug === 'index' || $slug === '') return home_url('/');
  $p = get_page_by_path($slug);
  return $p ? get_permalink($p) : home_url('/' . $slug . '/');
}
function atrium_post_url($slug) {
  $q = get_posts(['name' => $slug, 'post_type' => 'post', 'post_status' => 'publish', 'numberposts' => 1]);
  return $q ? get_permalink($q[0]) : home_url('/' . $slug . '/');
}
function atrium_blog_url() {
  $id = (int) get_option('page_for_posts');
  if ($id) return get_permalink($id);
  $b = get_page_by_path('blog');
  return $b ? get_permalink($b) : home_url('/?post_type=post');
}
function atrium_post_cards($limit, $tag) {
  $args = ['post_type' => 'post', 'post_status' => 'publish', 'numberposts' => $limit > 0 ? $limit : 12];
  if ($tag !== '') $args['tag'] = sanitize_title($tag);
  $out = '';
  foreach (get_posts($args) as $p) {
    $img = get_the_post_thumbnail_url($p, 'large');
    $out .= '<article class="at-post-card"><a href="' . esc_url(get_permalink($p)) . '">'
      . ($img ? '<img class="at-media" src="' . esc_url($img) . '" alt="' . esc_attr(get_the_title($p)) . '" loading="lazy">' : '')
      . '<div class="at-post-meta">' . esc_html(get_the_date('', $p)) . '</div>'
      . '<h3>' . esc_html(get_the_title($p)) . '</h3>'
      . '<p>' . esc_html(wp_trim_words(get_the_excerpt($p), 26)) . '</p></a></article>';
  }
  return $out !== '' ? $out : '<p class="at-muted">No posts yet.</p>';
}
function atrium_resolve($html) {
  if (strpos($html, '{{atrium:') === false) return $html;
  return preg_replace_callback('/\\{\\{atrium:([a-z]+)(?::([^}]*))?\\}\\}/', function ($m) {
    $arg = isset($m[2]) ? $m[2] : '';
    switch ($m[1]) {
      case 'home': return esc_url(home_url('/'));
      case 'page': return esc_url(atrium_page_url($arg));
      case 'post': return esc_url(atrium_post_url($arg));
      case 'blog': return esc_url(atrium_blog_url());
      case 'asset': return esc_url(get_theme_file_uri($arg));
      case 'form': return esc_url(admin_url('admin-post.php'));
      case 'posts': $a = explode(':', $arg . ':'); return atrium_post_cards((int) $a[0], $a[1]);
    }
    return '';
  }, $html);
}
add_filter('render_block', function ($content) { return atrium_resolve($content); }, 20);
add_filter('the_content', 'atrium_resolve', 20);

// Contact forms: emailed to the site admin, then back to the page with a thank-you note.
function atrium_form_submit() {
  $skip = ['action', 'atrium_form', '_wp_http_referer'];
  $lines = [];
  foreach ($_POST as $k => $v) {
    if (in_array($k, $skip, true)) continue;
    $lines[] = sanitize_text_field($k) . ': ' . sanitize_textarea_field(is_array($v) ? implode(', ', $v) : wp_unslash($v));
  }
  if (!empty($_POST['website_url'])) { wp_safe_redirect(home_url('/')); exit; } // honeypot
  $name = isset($_POST['atrium_form']) ? sanitize_text_field(wp_unslash($_POST['atrium_form'])) : 'contact';
  wp_mail(get_option('admin_email'), '[' . get_bloginfo('name') . '] New ' . $name . ' form message', implode("\\n", $lines));
  $back = wp_get_referer() ? wp_get_referer() : home_url('/');
  wp_safe_redirect(add_query_arg('sent', '1', $back));
  exit;
}
add_action('admin_post_nopriv_atrium_form', 'atrium_form_submit');
add_action('admin_post_atrium_form', 'atrium_form_submit');
add_action('wp_body_open', function () { if (isset($_GET['sent'])) echo '<p class="at-wp-sent" role="status">Thanks — your message was sent.</p>'; });

// One-time setup when the theme is activated: create what's missing, never overwrite.
add_action('after_switch_theme', 'atrium_setup');
function atrium_setup() {
  $file = get_theme_file_path('content/site.json');
  if (!file_exists($file)) return;
  $site = json_decode(file_get_contents($file), true);
  if (!is_array($site)) return;
  $front = 0;
  foreach ($site['pages'] as $p) {
    $existing = get_page_by_path($p['slug']);
    if ($existing) { $id = $existing->ID; }
    else {
      $body = file_get_contents(get_theme_file_path($p['file']));
      $id = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => $p['title'], 'post_name' => $p['slug'], 'post_content' => wp_slash($body), 'post_excerpt' => $p['description']]);
    }
    if (!empty($p['front']) && $id && !is_wp_error($id)) $front = $id;
  }
  if ($front) { update_option('show_on_front', 'page'); update_option('page_on_front', $front); }
  foreach ($site['posts'] as $p) {
    if (get_posts(['name' => $p['slug'], 'post_type' => 'post', 'post_status' => 'any', 'numberposts' => 1])) continue;
    $body = file_get_contents(get_theme_file_path($p['file']));
    $id = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => $p['title'], 'post_name' => $p['slug'], 'post_content' => wp_slash($body), 'post_excerpt' => $p['excerpt'], 'post_date' => $p['date'] . ' 09:00:00', 'tags_input' => $p['tags']]);
    if ($id && !is_wp_error($id) && !empty($p['cover'])) atrium_attach_cover($id, $p['cover']);
  }
  if (!get_option('permalink_structure')) { update_option('permalink_structure', '/%postname%/'); flush_rewrite_rules(); }
}
function atrium_attach_cover($post_id, $rel) {
  $src = get_theme_file_path($rel);
  if (!file_exists($src)) return;
  require_once ABSPATH . 'wp-admin/includes/file.php';
  require_once ABSPATH . 'wp-admin/includes/media.php';
  require_once ABSPATH . 'wp-admin/includes/image.php';
  $tmp = wp_tempnam(basename($src));
  if (!$tmp || !copy($src, $tmp)) return;
  $att = media_handle_sideload(['name' => basename($src), 'tmp_name' => $tmp], $post_id);
  if (is_wp_error($att)) { @unlink($tmp); return; }
  set_post_thumbnail($post_id, $att);
}
`);
  F('readme.txt', `=== ${d.name} (Atrium) ===\n\nInstall: WordPress admin › Appearance › Themes › Add New › Upload Theme › choose ${dir}.zip › Activate.\nOn activation the theme creates your pages${posts.length ? ' and posts' : ''} (any that don't exist yet), sets the home page and switches links to "Post name" if they were plain.\nEach section is a Custom HTML block you can move or edit in the page editor. Header and footer: Appearance › Editor › Patterns › Header/Footer.\nContact forms email the site admin address (Settings › General).\n`);
  return { files, dir, pages, posts };
}
// analytics in WordPress go through wp_head (same snippets as the static site)
const analyticsBlock = (st) => R.analytics(st, 'head');
function wxr(site, wp) {
  const d = site.data; const ctx = wpCtx(); const now = new Date().toUTCString(); let id = 1000;
  const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  const item = (type, o) => `  <item>\n    <title>${cdata(o.title)}</title>\n    <dc:creator>${cdata('admin')}</dc:creator>\n    <content:encoded>${cdata(o.body)}</content:encoded>\n    <excerpt:encoded>${cdata(o.excerpt || '')}</excerpt:encoded>\n    <wp:post_id>${++id}</wp:post_id>\n    <wp:post_date>${cdata(o.date)}</wp:post_date>\n    <wp:post_name>${cdata(o.slug)}</wp:post_name>\n    <wp:status>${cdata('publish')}</wp:status>\n    <wp:post_type>${cdata(type)}</wp:post_type>\n${(o.tags || []).map((t) => `    <category domain="post_tag" nicename="${esc(slugify(t))}">${cdata(t)}</category>`).join('\n')}\n  </item>`;
  const items = [];
  for (const p of d.pages) items.push(item('page', { title: p.title, slug: p.slug === 'index' ? 'home' : p.slug, date: new Date().toISOString().slice(0, 19).replace('T', ' '), body: p.sections.map((s) => block(R.renderSection(site, s, p, ctx))).join('\n\n'), excerpt: p.seo.description }));
  for (const p of d.posts.filter((x) => !x.draft)) items.push(item('post', { title: p.title, slug: p.slug, date: `${p.date} 09:00:00`, body: R.relink(markdown(p.body), ctx), excerpt: p.excerpt, tags: p.tags }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">\n<channel>\n  <title>${cdata(d.name)}</title>\n  <link>${esc(d.settings.url || 'https://example.com')}</link>\n  <description>${cdata(d.settings.tagline || '')}</description>\n  <pubDate>${now}</pubDate>\n  <language>${esc(d.settings.lang || 'en')}</language>\n  <wp:wxr_version>1.2</wp:wxr_version>\n  <generator>Atrium</generator>\n${items.join('\n')}\n</channel>\n</rss>\n`;
}

// ───────── site builders (embed pack)
function embedFiles(site, opts = {}) {
  const d = site.data; const W = '.atrium-embed';
  const base = (opts.assetBase || '').replace(/\/$/, '');
  const asset = (p) => (base ? `${base}/${p.replace(/^\.\.\//, '')}` : dataUrl(site, p));
  const absLink = (slug) => (d.settings.url ? `${d.settings.url.replace(/\/$/, '')}/${slug === 'index' ? '' : slug}` : (slug === 'index' ? '/' : '/' + slug));
  const ctx = R.withDefaults({ mode: 'export', target: 'embed', asset, link: absLink, postLink: (s) => absLink('blog/' + s), blogLink: () => absLink('blog') });
  const fonts = googleFontsHref(d.theme);
  const vars = themeVars(d.theme).replace(':root', W);
  const shared = `${vars}\n${scopeCss(baseCss(), W, true)}\n${W}{background:var(--at-bg);color:var(--at-text);font-family:var(--at-font-b)}\n${W} *,${W} *::before,${W} *::after{box-sizing:border-box}\n${d.customCss ? scopeCss(d.customCss, W, true) : ''}`;
  const rt = R.RUNTIME;
  const secCss = (s) => R.sectionCss(s, ctx);
  const secJs = (s) => (s.js && s.js.trim() ? `<script>(function(root){if(!root)return;${s.js}\n})(document.querySelector('[data-s="${s.id}"]'));</script>` : '');
  const headCode = `<!-- Atrium: paste once into your site's header code (site-wide) -->\n${fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${fonts}">\n` : ''}<style>\n${shared}\n</style>\n<script>${rt}</script>\n`;
  const files = [{ name: 'head-code.html', data: headCode }];
  const all = [d.globals.header, ...d.pages.flatMap((p) => p.sections), d.globals.footer].filter(Boolean);
  for (const p of d.pages) {
    const secs = [d.globals.header, ...p.sections, d.globals.footer].filter(Boolean);
    const body = secs.map((s) => R.renderSection(site, s, p, ctx)).join('\n');
    files.push({ name: `pages/${p.slug}.html`, data: `<!-- Atrium · ${esc(p.title)} — one block with everything (styles included). Paste into an Embed / Custom HTML / Code block. -->\n${fonts ? `<link rel="stylesheet" href="${fonts}">\n` : ''}<style>\n${shared}\n${secs.map(secCss).join('\n')}\n</style>\n<div class="atrium-embed">\n${body}\n</div>\n<script>${rt}</script>\n${secs.map(secJs).join('\n')}\n` });
    p.sections.forEach((s, i) => files.push({ name: `sections/${p.slug}/${String(i + 1).padStart(2, '0')}-${slugify(s.name)}.html`, data: `<!-- Atrium · ${esc(p.title)} › ${esc(s.name)}. Needs head-code.html once on the site. -->\n<style>\n${secCss(s)}\n</style>\n<div class="atrium-embed">\n${R.renderSection(site, s, p, ctx)}\n</div>\n${secJs(s)}\n` }));
  }
  for (const g of ['header', 'footer']) if (d.globals[g]) files.push({ name: `sections/_${g}.html`, data: `<style>\n${secCss(d.globals[g])}\n</style>\n<div class="atrium-embed">\n${R.renderSection(site, d.globals[g], null, ctx)}\n</div>\n${secJs(d.globals[g])}\n` });
  for (const f of singleFiles(site)) files.push({ name: 'iframe/' + f.name, data: f.data });
  if (base) files.push(...assetFiles(site));
  files.push({ name: 'README.md', data: embedReadme(site, !!base) });
  void all;
  return files;
}
function embedReadme(site, hosted) {
  return `# ${site.data.name} — for site builders

Exported from Atrium on ${new Date().toLocaleString()}.

What's here
- **head-code.html** — fonts, theme and base styles, and the small script for animations and menus. Paste it once into the site-wide header code.
- **pages/<page>.html** — a whole page in one snippet (styles included). Easiest: one Embed block per page.
- **sections/<page>/NN-name.html** — each section on its own, for building the page block by block (needs head-code.html).
- **iframe/** — complete pages for builders that put embeds in an iframe (Wix, Google Sites). Host them, or paste the whole file.
${hosted ? '- **assets/** — upload this folder to the address you gave Atrium; the snippets link to it.' : '- Images are built into the snippets, so there is nothing else to upload. (For big sites, export again with an asset address to keep snippets small.)'}

Everything sits inside \`<div class="atrium-embed">\`, so it doesn't restyle the rest of your site.

## Weebly
1. Settings › SEO › Header Code: paste **head-code.html**.
2. On a page, drag in **Embed Code**, click it › Edit Custom HTML, paste a file from **pages/** (or one section at a time from **sections/**).
3. For a full-width look, pick a theme layout with no header (Pages › page › Header type: No Header).

## Squarespace
1. Settings › Developer tools › Code Injection › Header: paste **head-code.html** (needs a plan with code injection).
2. Edit a page › Add Block › Code › paste a **sections/** file (one block per section) or a **pages/** file. Turn off "Display source".

## Wix
Wix runs custom code in an iframe: Add › Embed Code › Embed HTML › Code, paste a file from **iframe/** and stretch it to full width. (Or host the static export and use "Website address".)

## Webflow
1. Site settings › Custom code › Head code: paste **head-code.html**.
2. Add an **Embed** element (Code Embed) and paste a **sections/** or **pages/** file. Webflow limits an embed to 50,000 characters — use sections for long pages.

## Shopify
1. Online Store › Themes › Edit code › layout/theme.liquid: paste **head-code.html** before \`</head>\`.
2. Customize › Add section › **Custom Liquid**, paste a **sections/** file.

## Google Sites
Insert › Embed › Embed code: paste a file from **iframe/**.

## Carrd, Framer, Ghost, Hostinger, GoDaddy, Jimdo, Strikingly…
Use the header/code injection setting for **head-code.html** and an Embed/HTML block for the snippets. If a builder iframes its embeds, use **iframe/**.
`;
}

// ───────── Weebly theme files
function weeblyFiles(site) {
  const d = site.data; const ctx = R.withDefaults({ mode: 'export', target: 'weebly', asset: (p) => p.replace(/^assets\//, '/files/theme/') });
  const hdr = d.globals.header ? R.renderSection(site, d.globals.header, null, ctx).replace(/<nav\b([^>]*\bdata-at-nav\b[^>]*)>[\s\S]*?<\/nav>/, '<nav$1>{menu}</nav>').replace(/<(span|div)\b([^>]*\bdata-at-logo\b[^>]*)>[\s\S]*?<\/\1>/, '<$1$2>{logo}</$1>') : '<header>{logo}<nav>{menu}</nav></header>';
  const ftr = d.globals.footer ? R.renderSection(site, d.globals.footer, null, ctx) : '';
  const fonts = googleFontsHref(d.theme);
  const tpl = (body) => `<!DOCTYPE html>\n<html>\n<head>\n  <title>{title}</title>\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  ${fonts ? `<link rel="stylesheet" href="${fonts}">` : ''}\n</head>\n<body class="atrium-weebly">\n${hdr}\n<main id="main">${body}</main>\n${ftr}\n<script src="/files/theme/site.js"></script>\n</body>\n</html>\n`;
  const css = R.siteCss(site, { asset: (p) => p.replace(/^assets\//, '') }) + `\n/* Weebly content area */\n#main .wsite-elements,#main>div{max-width:none}\n.atrium-weebly .wsite-menu-default{display:contents}\n`;
  const files = [
    { name: 'templates/header.html', data: tpl('{content}') },
    { name: 'templates/no-header.html', data: tpl('{content}') },
    { name: 'styles/main.css', data: css },
    { name: 'assets/site.js', data: R.siteJs(site) },
    ...assetFiles(site).map((a) => ({ name: a.name, data: a.data })),
  ];
  for (const p of d.pages) files.push({ name: `page-content/${p.slug}.html`, data: `<!-- Paste into an Embed Code element on the "${esc(p.title)}" page -->\n<div class="atrium-embed">\n${p.sections.map((s) => R.renderSection(site, s, p, ctx)).join('\n')}\n</div>\n` });
  files.push({ name: 'README.md', data: `# ${d.name} — Weebly theme files\n\nFor Weebly's Theme › Edit HTML / CSS (classic Weebly editor). Check the first import: Weebly's theme format can change.\n\n1. Theme › Edit HTML / CSS. Back up your current theme first (Export theme).\n2. Replace **header.html** (and **no-header.html**) with the files in **templates/**. They keep Weebly's {title}, {logo}, {menu} and {content} tags, so the menu and page content still come from Weebly.\n3. Replace **main.css** (or add a new stylesheet and link it) with **styles/main.css**.\n4. Upload **assets/site.js** and every file in **assets/** with "Add file" (Weebly serves them from /files/theme/).\n5. For each page, add an Embed Code element and paste the matching file from **page-content/**.\n\nSimpler route: the "Site builders" export (head code + embed snippets) needs no theme editing.\n` });
  return files;
}

// ───────── backup
function backupFile(site) {
  const files = [{ name: 'atrium.json', data: JSON.stringify(site.data, null, 2) }];
  for (const a of site.listAssets()) files.push({ name: a.path, data: fs.readFileSync(site.p(a.path)) });
  return makeZip(files);
}

// ───────── write
function writeFiles(dir, files) { for (const f of files) { const p = path.join(dir, f.name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); } }
function stamp() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; }

// format → { path, files, notes } ; dest defaults to <site>/exports/<format> <date>
function exportSite(site, format, opts = {}) {
  const name = slugify(site.data.name) || 'site';
  const outRoot = opts.dest || site.p('exports');
  const folder = path.join(outRoot, `${name} ${format} ${stamp()}`);
  let files, notes = [], result = {};
  switch (format) {
    case 'static': files = staticFiles(site); break;
    case 'single': files = singleFiles(site); break;
    case 'embed': files = embedFiles(site, opts); if (!opts.assetBase) notes.push('Images are built into the snippets. Give an asset address to keep them small.'); break;
    case 'weebly': files = weeblyFiles(site); break;
    case 'wordpress': {
      const wp = wordpressFiles(site);
      const themeZip = makeZip(wp.files.map((f) => ({ name: f.name, data: f.data })));
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `${wp.dir}.zip`), themeZip);
      fs.writeFileSync(path.join(folder, `${name}-content.xml`), wxr(site, wp));
      fs.writeFileSync(path.join(folder, 'HOW TO INSTALL.txt'), `1. In WordPress: Appearance › Themes › Add New › Upload Theme › ${wp.dir}.zip › Install › Activate.\n   Activating creates your ${wp.pages.length} pages${wp.posts.length ? ` and ${wp.posts.length} posts` : ''}, sets the home page and uses "Post name" links.\n\n2. (Optional, instead of step 1's automatic setup) Tools › Import › WordPress › ${name}-content.xml imports the same pages and posts.\n   Keep the Atrium theme active: it holds the styles, images and the links between pages.\n\nForms email the admin address in Settings › General. Analytics and header code from Atrium are included.\n`);
      if (opts.unzipped) writeFiles(path.join(folder, wp.dir), wp.files.map((f) => ({ name: f.name.slice(wp.dir.length + 1), data: f.data })));
      result = { theme: path.join(folder, `${wp.dir}.zip`), wxr: path.join(folder, `${name}-content.xml`) };
      return { path: folder, format, count: wp.files.length, notes, ...result };
    }
    case 'backup': {
      fs.mkdirSync(outRoot, { recursive: true }); const f = path.join(outRoot, `${name} ${stamp()}.atrium`); fs.writeFileSync(f, backupFile(site));
      return { path: f, format, count: 1, notes };
    }
    default: throw new Error(`Unknown format "${format}". Formats: ${FORMATS.map((x) => x.id).join(', ')}`);
  }
  if (opts.zip) { fs.mkdirSync(outRoot, { recursive: true }); const z = folder + '.zip'; fs.writeFileSync(z, makeZip(files)); return { path: z, format, count: files.length, notes }; }
  writeFiles(folder, files);
  return { path: folder, format, count: files.length, notes, index: format === 'static' || format === 'single' ? path.join(folder, 'index.html') : null };
}

module.exports = { FORMATS, exportSite, staticFiles, singleFiles, wordpressFiles, wxr, embedFiles, weeblyFiles, backupFile, assetBuffer, assetFiles, mime, writeFiles };

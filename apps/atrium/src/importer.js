// Atrium — importing an existing static site (a folder of .html files, one .html file, or an .atrium backup).
// Each page's top-level blocks become sections; the first page's <header>/<footer> become the shared ones; local
// files are copied into assets/imported/ with links rewritten; the original CSS goes into the site's custom CSS.
'use strict';
const fs = require('fs');
const path = require('path');
const { readZip } = require('./core/zip');
const { slugify, uid } = require('./core/site');

function walk(dir, out = [], root = dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out, root); else out.push(path.relative(root, p).split(path.sep).join('/')); } return out; }

function makeImporter({ lib, capture }) {
  return async function importSite(src, name) {
    if (!fs.existsSync(src)) throw new Error('Nothing at ' + src);
    if (/\.atrium$/i.test(src) || /\.zip$/i.test(src)) {
      const files = readZip(fs.readFileSync(src)); const j = files.find((f) => f.name === 'atrium.json');
      if (!j) throw new Error('That zip isn’t an Atrium backup (no atrium.json). Unzip a static site and import the folder.');
      const data = JSON.parse(j.data.toString('utf8')); if (name) data.name = name;
      return lib.importData(data, files.filter((f) => f.name.startsWith('assets/')));
    }
    const isDir = fs.statSync(src).isDirectory(); const root = isDir ? src : path.dirname(src);
    const all = isDir ? walk(root) : [path.basename(src), ...walk(root).filter((f) => !/\.html?$/i.test(f)).slice(0, 400)];
    const htmls = all.filter((f) => /\.html?$/i.test(f) && (isDir || f === path.basename(src))).slice(0, 60);
    if (!htmls.length) throw new Error('No .html files there');
    const site = lib.create({ name: name || path.basename(isDir ? src : path.dirname(src)) || 'Imported site', template: 'blank' });
    const d = site.data; d.pages = []; d.globals = { header: null, footer: null };
    // copy local files
    const copied = new Map();
    for (const f of all.filter((x) => !/\.(html?|md|DS_Store)$/i.test(x))) { const to = 'assets/imported/' + f; const dest = site.p(to); fs.mkdirSync(path.dirname(dest), { recursive: true }); try { fs.copyFileSync(path.join(root, f), dest); copied.set(f, to); } catch {} }
    const fixUrls = (html, fromFile) => html.replace(/(\s(?:src|href|poster)=")([^"#?]+)([^"]*)"/g, (m, a, u, rest) => {
      if (/^(https?:|mailto:|tel:|data:|\/\/|#)/i.test(u)) return m;
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), u)).replace(/^\.\//, '').replace(/^\//, '');
      if (/\.html?$/i.test(rel) && htmls.includes(rel)) return `${a}${slugOf(rel)}.html${rest}"`;
      return copied.has(rel) ? `${a}${copied.get(rel)}${rest}"` : m;
    }).replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => { if (/^(https?:|data:|\/\/|#)/.test(u)) return m; const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), u)).replace(/^\//, ''); return copied.has(rel) ? `url(${q}${copied.get(rel)}${q})` : m; });
    const slugs = new Map(); const slugOf = (f) => { if (slugs.has(f)) return slugs.get(f); let s = /^index\.html?$/i.test(f) ? 'index' : slugify(f.replace(/\.html?$/i, '').replace(/\/index$/i, '').replace(/\//g, '-')); while ([...slugs.values()].includes(s)) s += '-2'; slugs.set(f, s); return s; };
    htmls.sort((a, b) => (/^index\.html?$/i.test(a) ? -1 : /^index\.html?$/i.test(b) ? 1 : a.localeCompare(b))).forEach(slugOf);
    let css = []; const extJs = []; const fontLinks = new Set();
    for (const f of htmls) {
      const parsed = await capture.parseHtml(fs.readFileSync(path.join(root, f), 'utf8'));
      if (parsed.styles) css.push(`/* ${f} */\n` + fixUrls(parsed.styles, f));
      for (const l of parsed.links || []) { if (/^https?:/.test(l)) { fontLinks.add(l); continue; } const rel = path.posix.normalize(path.posix.join(path.posix.dirname(f), l)).replace(/^\//, ''); if (copied.has(rel) && !css.some((c) => c.startsWith(`/* ${rel} */`))) { try { css.push(`/* ${rel} */\n` + fixUrls(fs.readFileSync(path.join(root, rel), 'utf8'), rel)); } catch {} } }
      for (const fl of parsed.fontLinks || []) fontLinks.add(fl);
      if (parsed.scripts && parsed.scripts.trim()) extJs.push(parsed.scripts);
      const page = { id: uid('p'), slug: slugOf(f), title: parsed.title || slugOf(f), nav: true, seo: { title: parsed.title || '', description: parsed.description || '', ogImage: '', noindex: false }, sections: [] };
      for (const part of parsed.parts) {
        const html = fixUrls(part.html, f);
        if (part.tag === 'header' && !d.globals.header) { d.globals.header = { id: uid('s'), type: 'custom', name: 'Header (imported)', html, css: '', js: '' }; continue; }
        if (part.tag === 'header' && d.globals.header) continue;
        if (part.tag === 'footer' && !d.globals.footer) { d.globals.footer = { id: uid('s'), type: 'custom', name: 'Footer (imported)', html, css: '', js: '' }; continue; }
        if (part.tag === 'footer' && d.globals.footer) continue;
        if (part.tag === 'nav' && !d.globals.header) { d.globals.header = { id: uid('s'), type: 'custom', name: 'Navigation (imported)', html: `<header>${html}</header>`, css: '', js: '' }; continue; }
        const label = (/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html) || [])[1];
        page.sections.push({ id: uid('s'), type: 'custom', name: label ? label.replace(/<[^>]+>/g, '').trim().slice(0, 40) || 'Section' : `${part.tag} block`, html: /^<(section|div|article|aside|main|figure|form|ul|header|footer|nav)\b/i.test(html.trim()) ? html : `<section>${html}</section>`, css: '', js: '' });
      }
      d.pages.push(page);
    }
    if (!d.pages.some((p) => p.slug === 'index')) d.pages[0].slug = 'index';
    d.customCss = css.join('\n\n');
    d.settings.headCode = [...fontLinks].map((l) => `<link rel="stylesheet" href="${l.replace(/"/g, '&quot;')}">`).join('\n');
    d.customJs = extJs.join('\n;\n');
    d.settings.reveal = false; d.settings.importedFrom = src;
    d.theme.preset = 'custom';
    site.save(); site.snapshot('Imported', 'you');
    return site;
  };
}

module.exports = { makeImporter };

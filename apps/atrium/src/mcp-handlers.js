// Atrium — every AI tool, implemented once. Used by the MCP bridge (Claude Desktop / Claude Code / Codex) and by
// the in-app assistant (API keys). Results are MCP content: JSON text plus pictures where the AI needs eyes.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { guideText } = require('../mcp/guide');
const { checkCss } = require('./core/scope');
const { themeChecks, paletteFrom } = require('./core/theme');
const EX = require('./core/exporters');
const R = require('./core/render');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function rootCount(html) {
  const s = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '<x/>');
  let depth = 0, roots = 0, text = false; const re = /<\/?([a-zA-Z][\w-]*)[^>]*?(\/?)>|([^<]+)/g; let m;
  while ((m = re.exec(s))) {
    if (m[3]) { if (depth === 0 && m[3].trim()) text = true; continue; }
    const tag = m[1].toLowerCase(); const closing = m[0][1] === '/'; const selfc = m[2] === '/' || VOID.has(tag);
    if (closing) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) roots++;
    if (!selfc) depth++;
  }
  return { roots, text, unclosed: depth };
}
function checkSection({ html, css }) {
  const warn = [];
  if (html != null) { const r = rootCount(html); if (r.roots !== 1) warn.push(`The html has ${r.roots} top-level elements; a section needs exactly one root (wrap it in <section>).`); if (r.text) warn.push('There is text outside the root element.'); if (r.unclosed > 0) warn.push(`${r.unclosed} element(s) look unclosed.`); }
  if (css != null) { const e = checkCss(css); if (e) warn.push('CSS: ' + e); }
  return warn;
}

function makeHandlers(deps) {
  const { pdf, lib, active, setActive, capture, preview, selection, activity = () => {}, publish, assets, importer, settings } = deps;
  const ok = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
  const withImages = (o, slices = [], label) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }, ...slices.flatMap((s, i) => [...(label && slices.length > 1 ? [{ type: 'text', text: `${label} ${i + 1}/${slices.length}${s.note ? ' — ' + s.note : ''}` }] : s.note ? [{ type: 'text', text: s.note }] : []), { type: 'image', data: s.data, mimeType: 'image/jpeg' }])] });
  const siteOf = (a) => (a && a.site ? lib.get(a.site) : active());
  const sum = (s) => s.summary();
  const outline = (s) => ({ header: s.data.globals.header ? { id: s.data.globals.header.id, name: s.data.globals.header.name } : null, footer: s.data.globals.footer ? { id: s.data.globals.footer.id, name: s.data.globals.footer.name } : null, pages: s.data.pages.map((p) => ({ slug: p.slug, title: p.title, nav: p.nav, sections: p.sections.map((x) => `${x.id} · ${x.type} · ${x.name}`) })) });
  const libInfo = () => { const { SECTIONS } = require('./core/sections'); const { PRESETS } = require('./core/presets'); const { ICONS } = require('./core/site-icons'); return { sections: SECTIONS, presets: PRESETS, icons: Object.keys(ICONS) }; };

  async function look(site, { page, post, section, width = 1440, fullPage = true, maxSlices = 4 } = {}) {
    let url;
    if (post) { const p = site.post(post); url = preview.url(`blog/${p.slug}.html`); }
    else if (section) { const f = site.find(section); url = preview.pageUrl(site, f.page ? f.page.id : (page || 'index')); }
    else url = preview.pageUrl(site, page || 'index');
    const sel = section ? `[data-s="${site.find(section).section.id}"]` : null;
    return capture.shoot(url, { width, fullPage, selector: sel, maxSlices });
  }

  const H = {
    async atrium_guide() { return ok(guideText(libInfo())); },
    async site_context() {
      const s = active(); const st = s.data.settings;
      return ok({ sites: lib.list().map((x) => ({ id: x.id, name: x.name, pages: x.pages.length, updated: new Date(x.updatedAt).toISOString() })), open: { ...sum(s), outline: outline(s), theme: s.data.theme, settings: { name: st.name, tagline: st.tagline, url: st.url, description: st.description, logo: st.logo, forms: st.forms, analytics: st.analytics, schema: st.schema }, posts: s.data.posts.map((p) => ({ slug: p.slug, title: p.title, date: p.date, draft: p.draft })) }, selection: selection ? selection() : null, preview: preview.url(), exportFormats: EX.FORMATS.map((f) => f.id) });
    },
    async create_site(a) { const s = lib.create({ name: a.name, template: a.template, preset: a.preset, tagline: a.tagline }); setActive(s.dir); activity(`Created ${s.name}`); return ok({ created: sum(s), outline: outline(s), next: 'Read atrium_guide if you haven’t; set_theme to fit the brand; then build pages and look at them.' }); },
    async open_site(a) { const s = lib.get(a.site); setActive(s.dir); return ok({ open: sum(s), outline: outline(s) }); },
    async list_templates() { const { TEMPLATES } = require('./core/templates'); return ok(TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, theme: t.theme, pages: t.pages.map((p) => p.title) }))); },
    async list_sections(a) { const { SECTIONS, CATEGORIES } = require('./core/sections'); const l = SECTIONS.filter((x) => !a.category || x.category.toLowerCase() === String(a.category).toLowerCase()); return ok({ categories: CATEGORIES, sections: l.map((x) => ({ type: x.type, name: x.name, category: x.category, description: x.description, tags: x.tags })) }); },
    async get_section_template(a) { const { SECTIONS } = require('./core/sections'); const t = SECTIONS.find((x) => x.type === a.type); if (!t) throw new Error(`No section type "${a.type}"`); return ok(t); },
    async get_page(a) {
      const s = siteOf(a); const code = a.code !== false; const sec = (x) => (code ? { id: x.id, type: x.type, name: x.name, html: x.html, css: x.css, js: x.js } : { id: x.id, type: x.type, name: x.name });
      if (a.page === 'header' || a.page === 'footer') { const g = s.data.globals[a.page]; return ok(g ? { [a.page]: sec(g) } : { [a.page]: null, note: `No ${a.page} yet — add_section page:"${a.page}" sets one.` }); }
      const p = s.page(a.page); return ok({ id: p.id, slug: p.slug, title: p.title, nav: p.nav, seo: p.seo, file: p.slug + '.html', sections: p.sections.map(sec), header: s.data.globals.header ? s.data.globals.header.id : null, footer: s.data.globals.footer ? s.data.globals.footer.id : null });
    },
    async add_page(a, by) {
      const s = siteOf(a); for (const sp of a.sections || []) { const w = sp.html ? checkSection(sp) : []; if (w.length) throw new Error(`Section "${sp.name || sp.type}": ${w.join(' ')}`); }
      const p = s.addPage({ title: a.title, slug: a.slug, nav: a.nav !== false, seo: a.seo || {}, sections: a.sections || [], template: a.copy_from, position: a.position }, by);
      activity(`Added page ${p.title}`, { page: p.id });
      return ok({ page: { id: p.id, slug: p.slug, title: p.title, sections: p.sections.map((x) => ({ id: x.id, type: x.type, name: x.name })) }, url: preview.pageUrl(s, p.id), next: 'screenshot it (device "all") when the sections are in.' });
    },
    async update_page(a, by) { const s = siteOf(a); const p = s.updatePage(a.page, a, by); return ok({ id: p.id, slug: p.slug, title: p.title, nav: p.nav, seo: p.seo }); },
    async delete_page(a, by) { const s = siteOf(a); s.removePage(a.page, by); return ok({ deleted: a.page, pages: s.data.pages.map((p) => p.slug) }); },
    async move_page(a, by) { const s = siteOf(a); s.movePage(a.page, +a.to, by); return ok({ pages: s.data.pages.map((p) => p.slug) }); },
    async add_section(a, by) {
      const s = siteOf(a); const spec = { type: a.type, replace: a.replace, name: a.name, html: a.html, css: a.css, js: a.js };
      if (!a.type && !a.html) throw new Error('Give a library type, or your own html (and css).');
      const w = a.html ? checkSection(a) : []; if (w.length) throw new Error(w.join(' '));
      if (a.type && a.replace) { const { SECTIONS } = require('./core/sections'); const t = SECTIONS.find((x) => x.type === a.type); const miss = t ? Object.keys(a.replace).filter((k) => !t.html.includes(k)) : []; if (miss.length) spec._miss = miss; }
      const sec = s.addSection(a.page, spec, a.position, by);
      activity(`Added ${sec.name}`, { section: sec.id });
      const res = { section: { id: sec.id, type: sec.type, name: sec.name }, page: a.page, ...(spec._miss ? { warning: `These replace keys weren’t found in the library html, so they were skipped: ${spec._miss.map((x) => JSON.stringify(x.slice(0, 50))).join(', ')}. Use edit_text on the new section.` } : {}) };
      if (a.look === false) return ok(res);
      try { const shot = await look(s, { section: sec.id, maxSlices: 2 }); return withImages(res, shot.slices); } catch (e) { return ok({ ...res, screenshot: 'unavailable: ' + e.message }); }
    },
    async update_section(a, by) {
      const s = siteOf(a); const w = checkSection(a); if (w.length) throw new Error(w.join(' ') + ' Nothing was saved.');
      const sec = s.updateSection(a.section, { html: a.html, css: a.css, js: a.js, name: a.name }, by);
      activity(`Updated ${sec.name}`, { section: sec.id });
      const res = { section: { id: sec.id, name: sec.name }, saved: true };
      if (a.look === false) return ok(res);
      try { const shot = await look(s, { section: sec.id, width: a.width || 1440, maxSlices: 2 }); return withImages(res, shot.slices); } catch (e) { return ok({ ...res, screenshot: 'unavailable: ' + e.message }); }
    },
    async edit_text(a, by) { const s = siteOf(a); const n = s.replaceInSection(a.section, a.find, a.replace ?? '', a.all !== false, by); activity('Edited text', { section: a.section }); return ok({ replaced: n }); },
    async move_section(a, by) { const s = siteOf(a); s.moveSection(a.section, a.to, by); const f = s.find(a.section); return ok({ moved: true, page: f.page && f.page.slug, order: f.page ? f.page.sections.map((x) => `${x.id} · ${x.name}`) : null }); },
    async duplicate_section(a, by) { const s = siteOf(a); const c = s.duplicateSection(a.section, by); return ok({ section: { id: c.id, name: c.name } }); },
    async delete_section(a, by) { const s = siteOf(a); s.removeSection(a.section, by); return ok({ deleted: a.section }); },
    async list_presets() { const { PRESETS, FONTS, FONT_PAIRS } = require('./core/presets'); return ok({ presets: PRESETS.map((p) => ({ id: p.id, name: p.name, mode: p.mode, description: p.description, primary: p.colors.primary, fonts: p.fonts })), fonts: FONTS.map((f) => `${f.name} (${f.category})`), pairs: FONT_PAIRS }); },
    async set_theme(a, by) {
      const s = siteOf(a); const patch = {};
      for (const k of ['preset', 'mode', 'colors', 'fonts', 'radius', 'buttonShape', 'density', 'maxWidth', 'shadow', 'headingTracking']) if (a[k] != null) patch[k] = a[k];
      if (a.from_color) patch.colors = { ...paletteFrom(a.from_color, a.mode || s.data.theme.mode), ...(a.colors || {}) };
      const t = s.setTheme(patch, by); activity('Changed the theme');
      const res = { theme: t, contrast: themeChecks(t) };
      if (a.look === false) return ok(res);
      try { const shot = await look(s, { page: 'index', fullPage: false, maxSlices: 1 }); return withImages(res, shot.slices); } catch { return ok(res); }
    },
    async update_settings(a, by) { const s = siteOf(a); const st = s.setSettings(a.settings || {}, by); activity('Updated site settings'); return ok({ settings: st, customCss: s.data.customCss.length + ' chars' }); },
    async list_posts(a) { const s = siteOf(a); return ok(s.data.posts.map((p) => ({ id: p.id, slug: p.slug, title: p.title, date: p.date, tags: p.tags, draft: p.draft, excerpt: p.excerpt, cover: p.cover }))); },
    async write_post(a, by) { const s = siteOf(a); const p = s.upsertPost({ ...a, id: a.post }, by); activity(`Saved post ${p.title}`); return ok({ post: { id: p.id, slug: p.slug, title: p.title, url: `blog/${p.slug}.html` } }); },
    async delete_post(a, by) { const s = siteOf(a); s.removePost(a.post, by); return ok({ deleted: a.post }); },
    async list_assets(a) { const s = siteOf(a); return ok(s.listAssets().map((x) => ({ ...x, mtime: undefined, used: s.assetUses(x.path) }))); },
    async add_asset(a) {
      const s = siteOf(a); let rel;
      if (a.url) rel = await assets.fromUrl(s, a.url, a.name);
      else if (a.path) rel = await assets.fromFile(s, a.path.replace(/^~/, os.homedir()), a.name);
      else throw new Error('Give path or url');
      activity(`Added ${rel}`); return ok({ asset: rel, use: `<img src="${rel}" alt="…">` });
    },
    async search_photos(a) {
      const count = Math.max(1, Math.min(20, +a.count || 12));
      const q = new URLSearchParams({ q: a.query, page_size: String(count), license_type: 'commercial,modification', mature: 'false' });
      if (a.orientation) q.set('aspect_ratio', { landscape: 'wide', portrait: 'tall', square: 'square' }[a.orientation] || a.orientation);
      const r = await fetch('https://api.openverse.org/v1/images/?' + q, { headers: { 'User-Agent': 'Atrium website builder (desktop app)' } });
      if (!r.ok) throw new Error(`Photo search failed (${r.status}). Try again in a moment.`);
      const j = await r.json(); const list = (j.results || []).map((x, i) => ({ n: i + 1, url: x.url, thumb: x.thumbnail, width: x.width, height: x.height, title: x.title, creator: x.creator, license: `${String(x.license || '').toUpperCase()} ${x.license_version || ''}`.trim(), source: x.foreign_landing_url, credit: x.attribution }));
      if (!list.length) return ok({ results: [], note: 'Nothing found. Try simpler words.' });
      try {
        const html = `<!doctype html><body style="margin:0;background:#111;font:600 15px system-ui;color:#fff"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px">${list.map((x) => `<div style="position:relative;aspect-ratio:4/3;background:#222"><img src="${x.thumb}" style="width:100%;height:100%;object-fit:cover"><b style="position:absolute;left:6px;top:6px;background:#000c;padding:2px 7px;border-radius:6px">${x.n}</b></div>`).join('')}</div></body>`;
        const shot = await capture.shoot('data:text/html;base64,' + Buffer.from(html).toString('base64'), { width: 1100, fullPage: true, maxSlices: 1, remote: true, outWidth: 1000 });
        return withImages({ results: list, next: 'add_asset {url} for the ones you pick; credit creators where the licence asks (CC BY…).' }, shot.slices);
      } catch { return ok({ results: list }); }
    },
    async screenshot(a) {
      const s = siteOf(a);
      const widths = a.width ? [['custom', +a.width]] : a.device === 'all' ? [['desktop', 1440], ['tablet', 834], ['phone', 390]] : [[a.device || 'desktop', capture.DEVICES[a.device] || 1440]];
      const content = []; const full = a.full_page !== false;
      for (const [name, w] of widths) {
        const shot = await look(s, { page: a.page, post: a.post, section: a.section, width: w, fullPage: full, maxSlices: widths.length > 1 ? (w < 500 ? 3 : 2) : 4 });
        content.push({ type: 'text', text: `${name} · ${w}px wide · page height ${shot.height}px${shot.slices.length > 1 ? ` · ${shot.slices.length} slices top to bottom` : ''}` });
        shot.slices.forEach((x) => { content.push({ type: 'image', data: x.data, mimeType: 'image/jpeg' }); if (x.note) content.push({ type: 'text', text: x.note }); });
      }
      return { content };
    },
    async audit(a) {
      const s = siteOf(a); const pages = !a.page || a.page === 'all' ? s.data.pages : [s.page(a.page)];
      const known = new Set([...s.data.pages.map((p) => p.slug + '.html'), 'index.html', '', ...s.data.posts.map((p) => `blog/${p.slug}.html`), 'blog/index.html', 'blog/']);
      const assetsOk = (h) => !!EX.assetBuffer(s, h.replace(/^\.\.\//, '').replace(/^\//, ''));
      const out = []; const st = s.data.settings;
      if (!st.url) out.push({ level: 'warn', kind: 'seo', msg: 'No site address set', fix: 'update_settings {url:"https://…"} so the sitemap, canonical links and social previews use full links.' });
      if (!st.description) out.push({ level: 'warn', kind: 'seo', msg: 'No site description', fix: 'update_settings {description} (used when a page has none).' });
      if (!st.favicon) out.push({ level: 'info', kind: 'brand', msg: 'No favicon', fix: 'Add an icon image and update_settings {favicon:"assets/…"}' });
      if (!st.ogImage && !s.data.pages.some((p) => p.seo.ogImage)) out.push({ level: 'warn', kind: 'seo', msg: 'No social share image', fix: 'update_settings {ogImage:"assets/…"} (1200×630).' });
      for (const t of themeChecks(s.data.theme).filter((x) => !x.ok)) out.push({ level: 'warn', kind: 'contrast', msg: `Theme: ${t.pair} is ${t.ratio}:1 (needs ${t.min})`, fix: 'Adjust the theme colours.' });
      for (const x of s.listAssets()) if (x.kind === 'image' && x.size > 600 * 1024) out.push({ level: 'warn', kind: 'perf', msg: `${x.path} is ${(x.size / 1048576).toFixed(1)} MB`, fix: 'Use a smaller/compressed version (re-add it with add_asset to resize).' });
      const per = [];
      for (const p of pages) {
        const url = preview.pageUrl(s, p.id);
        const [desk, phone] = [await capture.auditPage(url, 1280), await capture.auditPage(url, 390)];
        const seen = new Set(); const issues = [];
        for (const i of [...desk.issues, ...phone.issues.filter((x) => ['layout', 'mobile'].includes(x.kind))]) { const k = i.msg + i.el + i.section; if (seen.has(k)) continue; seen.add(k); issues.push(i); }
        const m = desk.meta;
        if (!p.seo.description && !st.description) issues.push({ level: 'error', kind: 'seo', msg: 'No meta description', fix: `update_page {page:"${p.slug}", seo:{description:"…"}} (120–160 characters).` });
        else if (m.description && (m.description.length < 50 || m.description.length > 170)) issues.push({ level: 'warn', kind: 'seo', msg: `Description is ${m.description.length} characters`, fix: 'Aim for 120–160.' });
        if (m.titleLength > 65) issues.push({ level: 'warn', kind: 'seo', msg: `Title is ${m.titleLength} characters (Google shows ~60)`, fix: 'Shorten seo.title.' });
        for (const h of [...new Set(m.links)]) { const clean = h.split('#')[0].split('?')[0].replace(/^\.\.\//, '').replace(/^\//, ''); if (clean.startsWith('assets/')) { if (!assetsOk(clean)) issues.push({ level: 'error', kind: 'links', msg: `Missing file ${clean}`, fix: 'Add the file or fix the path.' }); } else if (!known.has(clean)) issues.push({ level: 'error', kind: 'links', msg: `Broken link to ${h}`, fix: 'Point it at an existing page (see get_page / site_context).' }); }
        if (m.words < 80) issues.push({ level: 'info', kind: 'content', msg: `Only ~${m.words} words on the page`, fix: 'Thin pages rank poorly; add real content.' });
        const sc = { error: 0, warn: 0, info: 0 }; issues.forEach((i) => { sc[i.level] = (sc[i.level] || 0) + 1; });
        per.push({ page: p.slug, score: Math.max(0, 100 - sc.error * 8 - sc.warn * 3 - sc.info), counts: sc, issues: issues.slice(0, 60) });
      }
      const nameOf = (id) => { try { return s.find(id).section.name; } catch { return null; } };
      for (const pp of per) for (const i of pp.issues) if (i.section) i.sectionName = nameOf(i.section);
      return ok({ site: out, pages: per, score: Math.round(per.reduce((t, x) => t + x.score, 0) / Math.max(1, per.length)) });
    },
    async fetch_url(a) { const r = await capture.readUrl(a.url, { look: a.look !== false, width: a.width || 1440 }); const { slices, ...info } = r; return withImages(info, slices, 'Screenshot'); },
    async import_html(a) { const s = await importer(a.path.replace(/^~/, os.homedir()), a.name); setActive(s.dir); return ok({ imported: sum(s), outline: outline(s), next: 'screenshot the pages; imported sections keep their original CSS in customCss — consider rebuilding key sections with the theme tokens.' }); },
    async export(a) { const s = siteOf(a);
      if (a.format === 'pdf') { const r = await pdf.exportPdf({ site: s, preview, capture, opts: { device: a.device, pages: a.pages, posts: a.posts, labels: a.labels, notes: a.notes, dest: a.dest && a.dest.replace(/^~/, os.homedir()) }, onStep: (m) => activity(m) }); activity('Exported a PDF', { path: r.path }); return ok(r); }
      const r = EX.exportSite(s, a.format, { zip: a.zip, assetBase: a.asset_base, dest: a.dest && a.dest.replace(/^~/, os.homedir()) }); activity(`Exported ${a.format}`, { path: r.path }); return ok(r); },
    async publish(a) { const s = siteOf(a); const r = a.target === 'github' ? await publish.github(s, { repo: a.repo }, (m) => activity(m)) : await publish.netlify(s, settings().netlifyToken(), (m) => activity(m)); activity(`Published to ${r.url}`); return ok(r); },
    async history(a) { const s = siteOf(a); return ok(s.versions().slice(0, 60).map((v) => ({ id: v.id, at: new Date(v.at).toLocaleString(), label: v.label, by: v.by }))); },
    async restore_version(a) { const s = siteOf(a); s.restore(a.id); return ok({ restored: a.id, outline: outline(s) }); },
    async preview_url() { return ok({ local: preview.url(), phone: preview.lanInfo().url || null }); },
  };

  return async function handle(name, args = {}, by = 'Claude') {
    const fn = H[name]; if (!fn) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
    try { return await fn(args || {}, by || 'Claude'); }
    catch (e) { return { content: [{ type: 'text', text: 'Error: ' + (e.message || String(e)) }], isError: true }; }
  };
}

module.exports = { makeHandlers, rootCount, checkSection };

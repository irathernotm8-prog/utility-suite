// Atrium — sites on disk. Each site is a folder (default ~/Documents/Atrium/<Name>) holding atrium.json (pages,
// sections, theme, settings, posts), assets/, exports/ and .atrium/ (versions, thumbnail). Every change is saved
// at once; versions are snapshots you can go back to; undo/redo is kept in memory for the session.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeTheme, presetTheme } = require('./theme');

const uid = (p = '') => p + crypto.randomBytes(5).toString('hex').slice(0, 8);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
const clone = (o) => JSON.parse(JSON.stringify(o));
function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function writeJSON(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify(o, null, 2)); fs.renameSync(tmp, f); }
const safeName = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

function libSections() { try { return require('./sections').SECTIONS; } catch { return []; } }
function libTemplates() { try { return require('./templates').TEMPLATES; } catch { return []; } }

// a section from the library (optionally with text replaced), or a custom one
function makeSection(spec = {}) {
  if (spec.type && spec.type !== 'custom' && !spec.html) {
    const t = libSections().find((x) => x.type === spec.type);
    if (!t) throw new Error(`No section type "${spec.type}". list_sections shows the library.`);
    let html = t.html, css = t.css || '', js = t.js || '';
    for (const [a, b] of Object.entries(spec.replace || {})) { html = html.split(a).join(b); }
    return { id: uid('s'), type: t.type, name: spec.name || t.name, html, css, js };
  }
  return { id: uid('s'), type: spec.type || 'custom', name: spec.name || 'Custom section', html: String(spec.html || '<section><div class="at-container"><p>New section</p></div></section>'), css: String(spec.css || ''), js: String(spec.js || '') };
}

function blankData(name) {
  return {
    format: 1, id: uid('site_'), name, createdAt: Date.now(), updatedAt: Date.now(),
    settings: { name, tagline: '', lang: 'en', url: '', logo: '', favicon: '', description: '', ogImage: '',
      analytics: { ga4: '', gtm: '', metaPixel: '', plausible: '' }, forms: { provider: 'formspree', endpoint: '', email: '' },
      social: {}, headCode: '', bodyCode: '', schema: 'Organization', reveal: true, smoothScroll: true },
    theme: presetTheme('midnight'), globals: { header: null, footer: null },
    pages: [{ id: uid('p'), slug: 'index', title: 'Home', nav: true, seo: { title: '', description: '', ogImage: '', noindex: false }, sections: [] }],
    posts: [], customCss: '', customJs: '',
  };
}

class Site {
  constructor(dir) {
    this.dir = dir; this.file = path.join(dir, 'atrium.json');
    this.data = readJSON(this.file, null); if (!this.data) throw new Error('Not an Atrium site: ' + dir);
    this.migrate(); this.undoStack = []; this.redoStack = []; this.lastSnap = 0; this.listeners = new Set();
  }
  migrate() {
    const d = this.data; const b = blankData(d.name || path.basename(this.dir));
    d.settings = { ...b.settings, ...(d.settings || {}), analytics: { ...b.settings.analytics, ...((d.settings || {}).analytics || {}) }, forms: { ...b.settings.forms, ...((d.settings || {}).forms || {}) } };
    d.theme = normalizeTheme(d.theme); d.globals = d.globals || { header: null, footer: null }; d.pages = d.pages || b.pages; d.posts = d.posts || []; d.customCss = d.customCss || ''; d.customJs = d.customJs || '';
    for (const p of d.pages) { p.seo = { title: '', description: '', ogImage: '', noindex: false, ...(p.seo || {}) }; p.sections = p.sections || []; if (p.nav === undefined) p.nav = true; }
  }
  get id() { return this.data.id; } get name() { return this.data.name; }
  p(...a) { return path.join(this.dir, ...a); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // every mutation goes through here: undo point, save, optional version snapshot, change event
  mutate(label, by, fn, detail = {}) {
    const before = JSON.stringify(this.data);
    const r = fn(this.data);
    this.data.updatedAt = Date.now();
    this.undoStack.push({ json: before, label }); if (this.undoStack.length > 150) this.undoStack.shift(); this.redoStack = [];
    this.save();
    if (by && by !== 'you') this.snapshot(label, by); else if (Date.now() - this.lastSnap > 5 * 60e3) this.snapshot(label, by || 'you');
    this.emit({ label, by: by || 'you', ...detail });
    return r;
  }
  emit(e) { for (const fn of this.listeners) { try { fn(e); } catch {} } }
  save() { writeJSON(this.file, this.data); }
  undo() { const u = this.undoStack.pop(); if (!u) return null; this.redoStack.push({ json: JSON.stringify(this.data), label: u.label }); this.data = JSON.parse(u.json); this.save(); this.emit({ label: 'Undo ' + u.label, by: 'you', full: true }); return u.label; }
  redo() { const r = this.redoStack.pop(); if (!r) return null; this.undoStack.push({ json: JSON.stringify(this.data), label: r.label }); this.data = JSON.parse(r.json); this.save(); this.emit({ label: 'Redo ' + r.label, by: 'you', full: true }); return r.label; }

  // versions
  vdir() { return this.p('.atrium', 'versions'); }
  snapshot(label = 'Saved', by = 'you') {
    fs.mkdirSync(this.vdir(), { recursive: true }); const at = Date.now(); this.lastSnap = at;
    writeJSON(path.join(this.vdir(), `${at}.json`), { at, label, by, data: this.data });
    const all = fs.readdirSync(this.vdir()).filter((f) => f.endsWith('.json')).sort(); for (const f of all.slice(0, Math.max(0, all.length - 300))) { try { fs.unlinkSync(path.join(this.vdir(), f)); } catch {} }
    return at;
  }
  versions() { try { return fs.readdirSync(this.vdir()).filter((f) => /^\d+\.json$/.test(f)).sort().reverse().map((f) => { const v = readJSON(path.join(this.vdir(), f), {}); return { id: f.replace('.json', ''), at: v.at, label: v.label, by: v.by, pages: (v.data && v.data.pages || []).length }; }); } catch { return []; } }
  restore(id) { const v = readJSON(path.join(this.vdir(), `${id}.json`), null); if (!v) throw new Error('No such version'); this.snapshot('Before restoring a version', 'you'); return this.mutate(`Restore version from ${new Date(v.at).toLocaleString()}`, 'you', (d) => { Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, clone(v.data)); }, { full: true }); }

  summary() {
    const d = this.data;
    return { id: d.id, name: d.name, dir: this.dir, updatedAt: d.updatedAt, createdAt: d.createdAt, tagline: d.settings.tagline, preset: d.theme.preset, mode: d.theme.mode,
      colors: d.theme.colors, pages: d.pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, nav: p.nav, sections: p.sections.length })), posts: d.posts.length };
  }

  // ── pages
  page(ref) {
    if (ref == null || ref === '') return this.data.pages[0];
    const r = String(ref).toLowerCase().replace(/\.html$/, '').replace(/^\//, '') || 'index';
    const p = this.data.pages.find((x) => x.id === ref || x.slug === r || x.title.toLowerCase() === r || (r === 'home' && x.slug === 'index'));
    if (!p) throw new Error(`No page "${ref}". Pages: ${this.data.pages.map((x) => x.slug).join(', ')}`); return p;
  }
  uniqueSlug(s, except) { let base = slugify(s), slug = base, n = 2; const taken = (x) => this.data.pages.some((p) => p.slug === x && p.id !== except) || x === 'blog' && this.data.posts.length && !this.data.pages.some((p) => p.slug === 'blog' && p.id !== except && false); while (this.data.pages.some((p) => p.slug === slug && p.id !== except)) slug = `${base}-${n++}`; return slug; }
  addPage({ title = 'New page', slug, nav = true, seo = {}, sections = [], position, template } = {}, by) {
    const pg = { id: uid('p'), slug: '', title, nav, seo: { title: '', description: '', ogImage: '', noindex: false, ...seo }, sections: [] };
    pg.slug = this.uniqueSlug(slug || (this.data.pages.length ? title : 'index'));
    if (template) { const src = this.page(template); pg.sections = src.sections.map((s) => ({ ...clone(s), id: uid('s') })); }
    for (const s of sections) pg.sections.push(makeSection(s));
    this.mutate(`Add page ${title}`, by, (d) => { if (position == null || position >= d.pages.length) d.pages.push(pg); else d.pages.splice(Math.max(0, position), 0, pg); }, { page: pg.id, full: true });
    return pg;
  }
  updatePage(ref, patch, by) {
    const p = this.page(ref); const old = p.slug;
    this.mutate(`Edit page ${p.title}`, by, () => {
      if (patch.title != null) p.title = String(patch.title);
      if (patch.nav != null) p.nav = !!patch.nav;
      if (patch.slug != null && p.slug !== 'index') p.slug = this.uniqueSlug(patch.slug, p.id);
      if (patch.seo) p.seo = { ...p.seo, ...patch.seo };
    }, { page: p.id, full: true });
    if (old !== p.slug) this.relink(old, p.slug);
    return p;
  }
  // when a slug changes, fix links in every section
  relink(from, to) {
    const re = new RegExp(`href="(\\.\\./)?${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.html`, 'g');
    for (const s of this.allSections()) s.section.html = s.section.html.replace(re, (m, up) => `href="${up || ''}${to}.html`);
    this.save();
  }
  removePage(ref, by) { const p = this.page(ref); if (p.slug === 'index') throw new Error('The home page can’t be removed (rename it or replace its sections instead).'); this.mutate(`Delete page ${p.title}`, by, (d) => { d.pages = d.pages.filter((x) => x.id !== p.id); }, { full: true }); return true; }
  movePage(ref, to, by) { const p = this.page(ref); this.mutate(`Move page ${p.title}`, by, (d) => { const i = d.pages.indexOf(p); d.pages.splice(i, 1); d.pages.splice(Math.max(0, Math.min(d.pages.length, to)), 0, p); }, { full: true }); return true; }

  // ── sections
  allSections() {
    const out = []; const g = this.data.globals;
    if (g.header) out.push({ section: g.header, where: 'header', page: null });
    for (const p of this.data.pages) p.sections.forEach((s, i) => out.push({ section: s, where: 'page', page: p, index: i }));
    if (g.footer) out.push({ section: g.footer, where: 'footer', page: null });
    return out;
  }
  find(id) { const f = this.allSections().find((x) => x.section.id === id || (x.where !== 'page' && x.where === id)); if (!f) throw new Error(`No section "${id}" (use get_page to see section ids)`); return f; }
  addSection(pageRef, spec = {}, position, by) {
    const s = makeSection(spec);
    if (pageRef === 'header' || pageRef === 'footer') { this.mutate(`Set ${pageRef}`, by, (d) => { d.globals[pageRef] = s; }, { section: s.id, full: true }); return s; }
    const p = this.page(pageRef);
    this.mutate(`Add ${s.name}`, by, () => { p.sections.splice(this.resolvePos(p, position), 0, s); }, { page: p.id, section: s.id, full: true });
    return s;
  }
  resolvePos(p, position) {
    const n = p.sections.length; if (position == null || position === 'end') return n; if (position === 'start') return 0;
    if (typeof position === 'number') return Math.max(0, Math.min(n, position));
    if (typeof position === 'string' && /^\d+$/.test(position)) return Math.min(n, +position);
    if (position.after) { const i = p.sections.findIndex((s) => s.id === position.after); return i < 0 ? n : i + 1; }
    if (position.before) { const i = p.sections.findIndex((s) => s.id === position.before); return i < 0 ? n : i; }
    return n;
  }
  updateSection(id, patch, by, label) {
    const f = this.find(id); const s = f.section;
    this.mutate(label || `Edit ${s.name}`, by, () => { for (const k of ['html', 'css', 'js', 'name']) if (patch[k] != null) s[k] = String(patch[k]); if (patch.type) s.type = patch.type; }, { section: s.id, page: f.page && f.page.id, where: f.where, hot: !('js' in patch) });
    return s;
  }
  replaceInSection(id, find, replace, all = true, by) {
    const f = this.find(id); const s = f.section; let n = 0;
    const doIt = (str) => { if (!find) return str; if (all) { n += str.split(find).length - 1; return str.split(find).join(replace); } const i = str.indexOf(find); if (i < 0) return str; n = 1; return str.slice(0, i) + replace + str.slice(i + find.length); };
    const html = doIt(s.html); const css = n ? s.css : doIt(s.css);
    if (!n) throw new Error('That text wasn’t found in the section (it must match exactly, including tags and spacing). get_page shows the current html.');
    this.updateSection(id, { html, css }, by, `Edit ${s.name}`); return n;
  }
  removeSection(id, by) { const f = this.find(id); this.mutate(`Delete ${f.section.name}`, by, (d) => { if (f.where === 'page') f.page.sections = f.page.sections.filter((s) => s.id !== f.section.id); else d.globals[f.where] = null; }, { full: true }); return true; }
  moveSection(id, to, by) {
    const f = this.find(id); if (f.where !== 'page') throw new Error('The header and footer stay where they are');
    const toPage = to && typeof to === 'object' && to.page ? this.page(to.page) : f.page;
    this.mutate(`Move ${f.section.name}`, by, () => {
      f.page.sections.splice(f.page.sections.indexOf(f.section), 1);
      let i; if (typeof to === 'number') i = to; else if (to === 'up') i = Math.max(0, f.index - 1); else if (to === 'down') i = Math.min(toPage.sections.length, f.index + 1); else i = this.resolvePos(toPage, to && to.position != null ? to.position : to);
      toPage.sections.splice(Math.max(0, Math.min(toPage.sections.length, i)), 0, f.section);
    }, { full: true });
    return true;
  }
  duplicateSection(id, by) { const f = this.find(id); if (f.where !== 'page') throw new Error('Only page sections can be duplicated'); const c = { ...clone(f.section), id: uid('s'), name: f.section.name + ' copy' }; this.mutate(`Duplicate ${f.section.name}`, by, () => { f.page.sections.splice(f.index + 1, 0, c); }, { full: true }); return c; }

  // ── theme & settings
  setTheme(patch = {}, by) {
    this.mutate('Change theme', by, (d) => {
      let t = patch.preset && patch.preset !== d.theme.preset ? presetTheme(patch.preset) : d.theme;
      const { preset, colors, fonts, ...rest } = patch;
      t = normalizeTheme({ ...t, ...rest, colors: { ...t.colors, ...(colors || {}) }, fonts: { ...t.fonts, ...(fonts || {}) } });
      if (patch.preset) t.preset = patch.preset; else if (colors || fonts || Object.keys(rest).length) t.preset = t.preset || 'custom';
      d.theme = t;
    }, { theme: true, hot: true });
    return this.data.theme;
  }
  setSettings(patch = {}, by) {
    this.mutate('Site settings', by, (d) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && d.settings[k] && typeof d.settings[k] === 'object') d.settings[k] = { ...d.settings[k], ...v };
        else if (k === 'customCss' || k === 'customJs') d[k] = String(v || '');
        else d.settings[k] = v;
      }
      if (patch.name) d.name = String(patch.name);
    }, { full: true });
    return this.data.settings;
  }

  // ── posts
  post(ref) { const p = this.data.posts.find((x) => x.id === ref || x.slug === ref || x.title === ref); if (!p) throw new Error(`No post "${ref}"`); return p; }
  upsertPost(o = {}, by) {
    let p = o.id || o.post ? this.data.posts.find((x) => x.id === (o.id || o.post) || x.slug === (o.id || o.post)) : null;
    const fields = ['title', 'date', 'excerpt', 'cover', 'body', 'tags', 'draft', 'author'];
    this.mutate(p ? `Edit post ${p.title}` : `New post ${o.title || ''}`, by, (d) => {
      if (!p) { p = { id: uid('po'), slug: '', title: o.title || 'Untitled post', date: new Date().toISOString().slice(0, 10), excerpt: '', cover: '', body: '', tags: [], draft: false, author: '' }; d.posts.unshift(p); }
      for (const k of fields) if (o[k] != null) p[k] = o[k];
      const want = slugify(o.slug || p.slug || p.title); let s = want, n = 2; while (d.posts.some((x) => x.slug === s && x.id !== p.id)) s = `${want}-${n++}`; p.slug = s;
      d.posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }, { full: true });
    return p;
  }
  removePost(ref, by) { const p = this.post(ref); this.mutate(`Delete post ${p.title}`, by, (d) => { d.posts = d.posts.filter((x) => x.id !== p.id); }, { full: true }); return true; }

  // ── assets
  assetsDir() { return this.p('assets'); }
  listAssets() {
    const out = []; const walk = (dir, rel) => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { if (e.name.startsWith('.') || (rel === '' && e.name === 'ph')) continue; const p = path.join(dir, e.name); const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else { const st = fs.statSync(p); out.push({ path: 'assets/' + r, name: e.name, size: st.size, mtime: st.mtimeMs, kind: /\.(png|jpe?g|webp|gif|svg|avif|ico)$/i.test(e.name) ? 'image' : /\.(mp4|webm|mov)$/i.test(e.name) ? 'video' : /\.(woff2?|ttf|otf)$/i.test(e.name) ? 'font' : 'file' }); } } };
    walk(this.assetsDir(), ''); return out.sort((a, b) => b.mtime - a.mtime);
  }
  uniqueAsset(name) { const ext = path.extname(name).toLowerCase(); const base = slugify(path.basename(name, path.extname(name))).slice(0, 50) || 'file'; let f = base + ext, n = 2; while (fs.existsSync(path.join(this.assetsDir(), f))) f = `${base}-${n++}${ext}`; return f; }
  addAssetBuffer(name, buf) { fs.mkdirSync(this.assetsDir(), { recursive: true }); const f = this.uniqueAsset(name); fs.writeFileSync(path.join(this.assetsDir(), f), buf); this.emit({ label: 'Add asset', by: 'you', assets: true }); return 'assets/' + f; }
  removeAsset(rel) { const p = this.p(rel); if (!p.startsWith(this.assetsDir())) throw new Error('Not an asset'); fs.rmSync(p, { force: true }); this.emit({ label: 'Remove asset', by: 'you', assets: true }); return true; }
  assetUses(rel) { const n = []; for (const s of this.allSections()) if (s.section.html.includes(rel) || s.section.css.includes(rel)) n.push(s.section.name); return n; }
}

class Library {
  constructor(root) { this.root = root; this.cache = new Map(); }
  setRoot(r) { this.root = r; this.cache.clear(); }
  ensure() { fs.mkdirSync(this.root, { recursive: true }); }
  list() {
    this.ensure(); const out = [];
    for (const e of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue; const f = path.join(this.root, e.name, 'atrium.json'); if (!fs.existsSync(f)) continue;
      try { const s = this.open(path.join(this.root, e.name)); out.push({ ...s.summary(), thumb: fs.existsSync(s.p('.atrium', 'thumb.jpg')) ? s.p('.atrium', 'thumb.jpg') : null }); } catch {}
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  open(dir) { if (this.cache.has(dir)) return this.cache.get(dir); const s = new Site(dir); this.cache.set(dir, s); return s; }
  get(ref) {
    if (!ref) throw new Error('Which site?');
    for (const s of this.list()) if (s.id === ref || s.name.toLowerCase() === String(ref).toLowerCase() || s.dir === ref) return this.open(s.dir);
    throw new Error(`No site "${ref}"`);
  }
  folderFor(name) { this.ensure(); let base = safeName(name), f = base, n = 2; while (fs.existsSync(path.join(this.root, f))) f = `${base} ${n++}`; return path.join(this.root, f); }
  create({ name = 'Untitled site', template, preset, tagline } = {}) {
    const dir = this.folderFor(name); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    const d = blankData(name);
    if (template && template !== 'blank') {
      const t = libTemplates().find((x) => x.id === template); if (!t) throw new Error(`No template "${template}"`);
      d.theme = presetTheme(t.theme || 'midnight');
      d.settings.tagline = (t.settings && t.settings.tagline) || '';
      if (t.header) d.globals.header = makeSection(t.header);
      if (t.footer) d.globals.footer = makeSection(t.footer);
      d.pages = t.pages.map((p) => ({ id: uid('p'), slug: p.slug, title: p.title, nav: p.nav !== false, seo: { title: '', description: '', ogImage: '', noindex: false, ...(p.seo || {}) }, sections: p.sections.map(makeSection) }));
      d.posts = (t.posts || []).map((p) => ({ id: uid('po'), slug: p.slug || slugify(p.title), title: p.title, date: p.date || new Date().toISOString().slice(0, 10), excerpt: p.excerpt || '', cover: p.cover || '', body: p.body || '', tags: p.tags || [], draft: false, author: p.author || '' }));
      d.settings.templateFrom = t.id;
    } else {
      // blank: a header, a simple hero and a footer, so there's something to look at
      const has = (type) => libSections().some((x) => x.type === type);
      const pick = (cat) => (libSections().find((x) => x.category === cat) || {}).type;
      const h = pick('Header'), f = pick('Footer'), hero = pick('Hero');
      if (h && has(h)) d.globals.header = makeSection({ type: h });
      if (f && has(f)) d.globals.footer = makeSection({ type: f });
      if (hero) d.pages[0].sections.push(makeSection({ type: hero }));
    }
    if (preset) d.theme = presetTheme(preset);
    if (tagline) d.settings.tagline = tagline;
    writeJSON(path.join(dir, 'atrium.json'), d);
    const s = this.open(dir); s.snapshot('Created', 'you'); return s;
  }
  duplicate(ref, name) {
    const src = this.get(ref); const dir = this.folderFor(name || src.name + ' copy');
    fs.cpSync(src.dir, dir, { recursive: true, filter: (p) => !p.includes(path.sep + '.atrium' + path.sep + 'versions') && !p.includes(path.sep + 'exports') });
    const d = readJSON(path.join(dir, 'atrium.json')); d.id = uid('site_'); d.name = name || src.name + ' copy'; d.createdAt = d.updatedAt = Date.now(); writeJSON(path.join(dir, 'atrium.json'), d);
    return this.open(dir);
  }
  // sites go to a .trash folder in the library (never deleted outright)
  trash(ref) { const s = this.get(ref); const t = path.join(this.root, '.trash'); fs.mkdirSync(t, { recursive: true }); fs.renameSync(s.dir, path.join(t, path.basename(s.dir) + ' ' + Date.now())); this.cache.delete(s.dir); return true; }
  importData(data, assets = []) {
    const dir = this.folderFor(data.name || 'Imported site'); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    data.id = uid('site_'); data.updatedAt = Date.now(); writeJSON(path.join(dir, 'atrium.json'), data);
    for (const a of assets) { const p = path.join(dir, a.name); if (!p.startsWith(dir)) continue; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, a.data); }
    return this.open(dir);
  }
}

module.exports = { Library, Site, makeSection, blankData, uid, slugify, readJSON, writeJSON, clone };

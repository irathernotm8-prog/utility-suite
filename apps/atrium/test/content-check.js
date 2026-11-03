// Checks Atrium's content library: sections, icons, presets and templates. Run: node test/content-check.js
'use strict';
const path = require('path');
const core = (m) => require(path.join(__dirname, '..', 'src', 'core', m));
const { SECTIONS, CATEGORIES } = core('sections');
const { ICONS } = core('site-icons');
const { PRESETS, FONTS, FONT_PAIRS } = core('presets');
const { TEMPLATES } = core('templates');
const { baseCss } = core('base-css');

const errors = [];
const err = (m) => errors.push(m);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// counts top-level elements and checks tags are balanced
function htmlCheck(html, where) {
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  const stack = []; let roots = 0, m;
  while ((m = re.exec(html))) {
    if (!m[1]) continue;
    const tag = m[1].toLowerCase(); const closing = m[0][1] === '/';
    if (closing) { const top = stack.pop(); if (top !== tag) { err(`${where}: </${tag}> closes <${top}>`); return; } continue; }
    if (stack.length === 0) roots++;
    if (VOID.has(tag) || m[2] === '/') continue;
    if (tag === 'svg' || tag === 'path') continue;
    stack.push(tag);
  }
  if (stack.length) err(`${where}: unclosed ${stack.join(', ')}`);
  const text = html.replace(re, '').trim();
  if (roots !== 1) err(`${where}: ${roots} root elements (need exactly 1)`);
  return text;
}
function braces(css, where) { let d = 0; for (const c of css.replace(/"[^"]*"/g, '')) { if (c === '{') d++; else if (c === '}') d--; if (d < 0) { err(`${where}: css closes too early`); return; } } if (d) err(`${where}: css braces unbalanced (${d})`); }

const types = new Set();
for (const s of SECTIONS) {
  const w = `section ${s.type}`;
  if (!s.type || !s.name || !s.description) err(`${w}: missing type/name/description`);
  if (types.has(s.type)) err(`${w}: duplicate type`); types.add(s.type);
  if (!CATEGORIES.includes(s.category)) err(`${w}: bad category ${s.category}`);
  htmlCheck(s.html, w);
  braces(s.css, w);
  if (/#[0-9a-f]{3,6}\b/i.test(s.css.replace(/#f5b83d/gi, '').replace(/#000\b/g, '').replace(/#fff\b/g, ''))) err(`${w}: hard-coded colour in css`);
  for (const m of s.html.matchAll(/data-icon="([^"]+)"/g)) if (!ICONS[m[1]]) err(`${w}: unknown icon ${m[1]}`);
  for (const m of s.html.matchAll(/assets\/ph\/([^"]+)/g)) if (!/^\d+x\d+-(\d|1[0-2])\.svg$/.test(m[1])) err(`${w}: bad placeholder ${m[1]}`);
  for (const m of s.html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) err(`${w}: img without alt`);
  if (s.category === 'Header') {
    if (!s.html.includes('data-at-nav')) err(`${w}: header without data-at-nav`);
    if (!s.html.includes('data-at-menu-toggle')) err(`${w}: header without menu toggle`);
    if (!s.html.includes('data-at-logo')) err(`${w}: header without logo`);
    if (!s.css.includes('&.at-open')) err(`${w}: header css never opens the menu`);
  }
  if (s.js && /`/.test(s.js)) err(`${w}: backticks in js`);
  if (s.js) { try { new Function('root', s.js); } catch (e) { err(`${w}: js syntax: ${e.message}`); } }
}
const required = ['header', 'hero', 'footer'];
for (const c of ['Header', 'Hero', 'Footer']) if (!SECTIONS.some((s) => s.category === c)) err('no ' + c);

for (const k of Object.keys(ICONS)) if (!/^<(path|circle|rect|ellipse|line|polyline|polygon)\b/.test(ICONS[k])) err(`icon ${k}: odd markup`);

const fontNames = new Set(FONTS.map((f) => f.name));
for (const f of FONTS) if (!f.weights || !f.weights.length || !f.fallback || !['sans', 'serif', 'display', 'mono'].includes(f.category)) err(`font ${f.name}: incomplete`);
for (const p of FONT_PAIRS) if (!fontNames.has(p.heading) || !fontNames.has(p.body)) err(`pair ${p.label}: unknown font`);
const presetIds = new Set();
for (const p of PRESETS) {
  if (presetIds.has(p.id)) err(`preset ${p.id}: duplicate`); presetIds.add(p.id);
  for (const k of ['bg', 'surface', 'surface2', 'text', 'muted', 'primary', 'primaryText', 'accent', 'border']) if (!/^#[0-9a-f]{6}$/i.test(p.colors[k] || '')) err(`preset ${p.id}: colour ${k}`);
  if (!fontNames.has(p.fonts.heading) || !fontNames.has(p.fonts.body)) err(`preset ${p.id}: unknown font`);
  if (!['pill', 'rounded', 'square'].includes(p.buttonShape) || !['compact', 'comfortable', 'airy'].includes(p.density) || !['none', 'soft', 'deep'].includes(p.shadow) || !['dark', 'light'].includes(p.mode)) err(`preset ${p.id}: bad enum`);
  if (!(p.fonts.headingWeight > 0) || typeof p.radius !== 'number' || typeof p.maxWidth !== 'number' || typeof p.headingTracking !== 'number') err(`preset ${p.id}: bad number`);
  const fw = FONTS.find((f) => f.name === p.fonts.heading); if (fw && !fw.weights.includes(p.fonts.headingWeight)) err(`preset ${p.id}: heading weight ${p.fonts.headingWeight} not in ${fw.name}`);
}

const byType = Object.fromEntries(SECTIONS.map((s) => [s.type, s]));
const tplIds = new Set();
let linkOk = () => true;
function useCheck(u, where) {
  const s = byType[u.type]; if (!s) { err(`${where}: unknown section ${u.type}`); return; }
  let html = s.html;
  for (const [k, v] of Object.entries(u.replace || {})) { if (!html.includes(k)) err(`${where} ${u.type}: replace key not found: ${JSON.stringify(k.slice(0, 70))}`); html = html.split(k).join(v); }
  for (const m of html.matchAll(/data-icon="([^"]+)"/g)) if (!ICONS[m[1]]) err(`${where}: unknown icon after replace ${m[1]}`);
  for (const m of html.matchAll(/href="([^"#:]+\.html)(#[^"]*)?"/g)) if (!linkOk(m[1])) err(`${where} ${u.type}: link to missing page ${m[1]}`);
  htmlCheck(html, `${where} ${u.type} (after replace)`);
}
for (const t of TEMPLATES) {
  const w = `template ${t.id}`;
  const pageSet = new Set(t.pages.map((p) => p.slug + '.html'));
  const postSet = new Set((t.posts || []).map((p) => 'blog/' + p.slug + '.html'));
  linkOk = (h) => pageSet.has(h) || postSet.has(h) || (h === 'blog/index.html' && postSet.size > 0);
  if (tplIds.has(t.id)) err(`${w}: duplicate`); tplIds.add(t.id);
  if (!presetIds.has(t.theme)) err(`${w}: unknown theme ${t.theme}`);
  if (!t.settings || !t.settings.name) err(`${w}: no settings.name`);
  if (t.header) { useCheck(t.header, w + ' header'); if (byType[t.header.type] && byType[t.header.type].category !== 'Header') err(`${w}: header is not a Header`); }
  if (t.footer) { useCheck(t.footer, w + ' footer'); if (byType[t.footer.type] && byType[t.footer.type].category !== 'Footer') err(`${w}: footer is not a Footer`); }
  const slugs = new Set();
  if (!t.pages.some((p) => p.slug === 'index')) err(`${w}: no index page`);
  for (const p of t.pages) {
    if (slugs.has(p.slug)) err(`${w}: duplicate slug ${p.slug}`); slugs.add(p.slug);
    if (!p.seo || !p.seo.description) err(`${w} ${p.slug}: no seo.description`);
    for (const u of p.sections) { useCheck(u, `${w} ${p.slug}`); if (byType[u.type] && ['Header', 'Footer'].includes(byType[u.type].category)) err(`${w} ${p.slug}: header/footer inside a page`); }
  }
  for (const po of t.posts || []) { if (!po.slug || !po.title || !/^\d{4}-\d{2}-\d{2}$/.test(po.date) || !po.body) err(`${w} post ${po.slug}: incomplete`); }
}
braces(baseCss(), 'base css');

console.log(`${SECTIONS.length} sections in ${new Set(SECTIONS.map((s) => s.category)).size} categories, ${Object.keys(ICONS).length} icons, ${PRESETS.length} presets, ${FONTS.length} fonts, ${FONT_PAIRS.length} pairs, ${TEMPLATES.length} templates (${TEMPLATES.reduce((n, t) => n + t.pages.length, 0)} pages, ${TEMPLATES.reduce((n, t) => n + (t.posts || []).length, 0)} posts)`);
if (errors.length) { console.log(errors.length + ' problem(s):\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('content OK');

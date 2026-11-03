// Atrium — the section library. Each entry: { type, name, category, description, tags, html, css, js? }.
// See CONTRACT.md for the tokens, base classes and placeholders sections may use. Sections live in ./sections/*.js.
'use strict';

const CATEGORIES = ['Header', 'Hero', 'Logos', 'Features', 'Content', 'Stats', 'Social proof', 'Pricing', 'CTA', 'FAQ', 'Gallery', 'Team', 'Blog', 'Contact', 'Footer'];

const SECTIONS = [
  ...require('./sections/headers'),
  ...require('./sections/heroes'),
  ...require('./sections/features'),
  ...require('./sections/content'),
  ...require('./sections/more'),
  ...require('./sections/footers'),
].map((s) => ({ js: '', tags: [], ...s, html: s.html.trim(), css: s.css.trim(), js: (s.js || '').trim() }))
  .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));

module.exports = { SECTIONS, CATEGORIES };

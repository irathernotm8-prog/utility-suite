// Glean — where files go and what they're called. Pure functions (tested in test/run.js).
const { siteName, extFor, keyOf } = require('../collect/extract');

const LAYOUTS = {
  account: { root: ['{site}', '{account}'], sub: null, label: 'A folder per account' },
  post: { root: ['{site}', '{account}'], sub: '{date} {post}', label: 'A folder per post, inside the account' },
  flat: { root: ['{account}'], sub: null, label: 'Just the account name' }
};
const FILE_NAMES = {
  'date-post-n': '{date} {post} {n}',
  'account-date-n': '{account} {date} {n}',
  'post-n': '{post} {n}',
  original: '{name}'
};

function clean(s, max = 80) {
  return String(s == null ? '' : s).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function ymd(ms) { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function originalName(m) {
  if (m.name) return m.name.replace(/\.\w{2,5}$/, '');
  try { const b = decodeURIComponent(new URL(m.url).pathname.split('/').pop() || ''); return b.replace(/\.\w{2,5}$/, ''); } catch { return ''; }
}

function accountLabel(m, ctx = {}) {
  return clean(m.account || m.accountName || ctx.account || ctx.pageTitle || ctx.pageHost || 'Unsorted', 60) || 'Unsorted';
}

function tokens(m, ctx = {}) {
  const key = m.key || keyOf(m.url);
  return {
    site: clean(siteName(m.site || 'web'), 40) || 'Web',
    account: accountLabel(m, ctx),
    post: clean(m.postId || '', 40),
    date: ymd(m.date),
    n: m.postId ? pad(m.postIndex || 1) : '',
    caption: clean((m.caption || '').split('\n')[0], 50),
    name: clean(originalName(m), 80),
    id: clean(key.slice(-10), 12),
    kind: m.kind === 'video' ? 'video' : 'photo'
  };
}
function render(tpl, t) {
  return clean(tpl.replace(/\{(\w+)\}/g, (_, k) => (t[k] != null ? t[k] : '')).replace(/\s+/g, ' ').replace(/^[\s_-]+|[\s_-]+$/g, ''), 120);
}

// Returns { root: [segments], sub: string|null, base: string, ext } for one media item.
function placeFor(m, opts = {}, ctx = {}) {
  const layout = LAYOUTS[opts.layout] || LAYOUTS.account;
  const t = tokens(m, ctx);
  const root = layout.root.map(s => render(s, t) || 'Unsorted');
  const sub = layout.sub ? (render(layout.sub, t) || null) : null;
  let base = render(FILE_NAMES[opts.fileNames] || opts.fileTemplate || FILE_NAMES['date-post-n'], t);
  if (!base || base === t.n) base = render('{name}', t) || t.id;
  if (!m.postId && opts.fileNames !== 'original') base = render('{date} {name}', t) || t.id;
  return { root, sub, base, ext: extFor(m.url, m.kind, m.mime) };
}

// Picks a name not yet used in `taken` (a Set of lowercase file names).
function uniqueName(base, ext, taken) {
  let name = `${base}.${ext}`; let i = 2;
  while (taken.has(name.toLowerCase())) name = `${base} (${i++}).${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function captionsCsv(items) {
  const rows = [['file', 'post', 'post_url', 'date', 'number', 'type', 'width', 'height', 'caption', 'source_url']];
  const sorted = [...items].sort((a, b) => (b.date || 0) - (a.date || 0) || String(a.postId).localeCompare(String(b.postId)) || (a.postIndex || 0) - (b.postIndex || 0));
  for (const i of sorted) rows.push([i.file, i.postId || '', i.postUrl || '', i.date ? new Date(i.date).toISOString() : '', i.postIndex || '', i.kind, i.width || '', i.height || '', i.caption || '', i.url]);
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { LAYOUTS, FILE_NAMES, clean, ymd, tokens, render, placeFor, uniqueName, captionsCsv, accountLabel };

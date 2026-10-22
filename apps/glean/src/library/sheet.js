// Glean — contact sheets: a PDF of a haul's posts (pictures, dates, captions, links) to send a client for review.
const { pathToFileURL } = require('url');
const { ymd } = require('./naming');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function groupPosts(items) {
  const posts = new Map();
  for (const i of items) {
    const k = i.postId || 'loose:' + i.key;
    if (!posts.has(k)) posts.set(k, { postId: i.postId, postUrl: i.postUrl, date: i.date, caption: i.caption, items: [] });
    const p = posts.get(k); p.items.push(i); if (!p.caption && i.caption) p.caption = i.caption; if (!p.date && i.date) p.date = i.date;
  }
  for (const p of posts.values()) p.items.sort((a, b) => (a.postIndex || 0) - (b.postIndex || 0));
  return [...posts.values()].sort((a, b) => (b.date || 0) - (a.date || 0));
}

function sheetHtml(haul, items, opts = {}) {
  const posts = groupPosts(items.filter(i => i.exists !== false));
  const dates = items.map(i => i.date).filter(Boolean).sort();
  const range = dates.length ? (ymd(dates[0]) === ymd(dates[dates.length - 1]) ? ymd(dates[0]) : `${ymd(dates[0])} – ${ymd(dates[dates.length - 1])}`) : '';
  const photos = items.filter(i => i.kind !== 'video').length, videos = items.length - photos;
  const tile = (i, n, total) => {
    const label = total > 1 ? `<span class="n">${n}/${total}</span>` : '';
    if (i.kind === 'video' && i.posterPath) return `<figure><img src="${pathToFileURL(i.posterPath).href}"><span class="play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>${label}</figure>`;
    if (i.kind === 'video') return `<figure class="v"><div class="ph"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><small>${esc(i.file.split('/').pop())}</small></div>${label}</figure>`;
    return `<figure><img src="${pathToFileURL(i.path).href}">${label}</figure>`;
  };
  const block = (p) => `
    <section class="post">
      <div class="grid ${p.items.length > 1 ? 'multi' : ''}">${p.items.slice(0, 4).map((i, n) => tile(i, n + 1, p.items.length)).join('')}</div>
      ${p.items.length > 4 ? `<div class="more">+${p.items.length - 4} more</div>` : ''}
      <header><b>${esc(p.date ? new Date(p.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Undated')}</b>
        ${p.postUrl ? `<a href="${esc(p.postUrl)}">${esc(p.postUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}</header>
      ${p.caption && opts.captions !== false ? `<p class="cap">${esc(p.caption)}</p>` : ''}
    </section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10px/1.4 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1c1a24; }
  .top { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #1c1a24; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -.3px; } .sub { color: #6a6578; margin-top: 2px; font-size: 11px; }
  .brand { font-weight: 700; color: #6d5dfc; font-size: 11px; letter-spacing: .4px; text-transform: uppercase; }
  .posts { display: grid; grid-template-columns: repeat(${opts.columns || 4}, 1fr); gap: 16px 12px; }
  .post { break-inside: avoid; min-width: 0; }
  header { display: flex; flex-direction: column; margin-top: 5px; line-height: 1.3; } header b { font-size: 10px; } header a { color: #6d5dfc; text-decoration: none; font-size: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 3px; } .grid.multi { grid-template-columns: 1fr 1fr; }
  .grid.multi figure { aspect-ratio: 4 / 5; } .more { font-size: 8px; color: #6a6578; margin-top: 2px; }
  figure { margin: 0; position: relative; aspect-ratio: 4 / 5; background: #f1eff6; border-radius: 4px; overflow: hidden; }
  figure img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .n { position: absolute; left: 4px; top: 4px; background: rgba(20,18,30,.72); color: #fff; font-size: 8px; padding: 1px 5px; border-radius: 6px; }
  .ph { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #6a6578; } .ph svg { width: 22px; fill: #6d5dfc; } .ph small { font-size: 7.5px; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .play { position: absolute; inset: 0; display: grid; place-items: center; } .play svg { width: 26px; fill: #fff; filter: drop-shadow(0 1px 4px rgba(0,0,0,.5)); }
  .cap { margin: 3px 0 0; white-space: pre-wrap; color: #3b3747; font-size: 8.5px; max-height: 5.6em; overflow: hidden; }
  </style></head><body>
  <div class="top"><div><h1>${esc(haul.accountName || haul.title || haul.account)}</h1>
    <div class="sub">${esc([haul.siteName, haul.account && haul.account !== haul.accountName ? '@' + haul.account : '', range, `${posts.length} posts · ${photos} photos${videos ? ` · ${videos} videos` : ''}`].filter(Boolean).join('  ·  '))}</div></div>
    <div class="brand">Glean</div></div>
  <div class="posts">${posts.map(block).join('')}</div>
  </body></html>`;
}

module.exports = { sheetHtml, groupPosts };

// Atrium — a small, safe Markdown → HTML converter for blog posts (headings, paragraphs, emphasis, code, links,
// images, lists, blockquotes, fenced code, rules, tables). Raw HTML lines are passed through (it's the user's own site).
'use strict';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, src, t) => `<img src="${src}" alt="${alt}"${t ? ` title="${t}"` : ''} loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, href) => `<a href="${href}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
}

function markdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n'); const out = []; let i = 0;
  const isBlockStart = (l) => /^(#{1,6}\s|>|```|\s*([-*+]|\d+[.)])\s|\s*(---|\*\*\*|___)\s*$|<\w)/.test(l) || /^\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^```\s*(\w+)?/.exec(l))) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code${m[1] ? ` class="language-${m[1]}"` : ''}>${esc(buf.join('\n'))}</code></pre>`); continue; }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { const n = m[1].length; const id = m[2].toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); out.push(`<h${n} id="${id}">${inline(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^>/.test(l)) { const buf = []; while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${markdown(buf.join('\n'))}</blockquote>`); continue; }
    if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2; const body = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+/.exec(l))) {
      const ordered = /\d/.test(m[2]); const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { let t = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''); while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) t += ' ' + lines[i++].trim(); items.push(t); }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => { const cb = /^\[( |x)\]\s+/i.exec(t); return cb ? `<li class="task"><input type="checkbox" disabled${cb[1] !== ' ' ? ' checked' : ''}> ${inline(t.slice(cb[0].length))}</li>` : `<li>${inline(t)}</li>`; }).join('')}</${tag}>`); continue;
    }
    if (/^<\w/.test(l)) { const buf = []; while (i < lines.length && lines[i].trim()) buf.push(lines[i++]); out.push(buf.join('\n')); continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines[i]))) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' ').trim()).replace(/ {2,}$/, '')}</p>`);
  }
  return out.join('\n');
}

const plain = (md) => String(md || '').replace(/```[\s\S]*?```/g, '').replace(/[#>*_`~|-]+/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
module.exports = { markdown, inline, plain, esc };

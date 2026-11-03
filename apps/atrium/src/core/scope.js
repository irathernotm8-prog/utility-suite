// Atrium — scopes a section's CSS to its root element ([data-s="id"]). `&` means the root; selectors without `&`
// get the root as an ancestor. @media/@supports/@container/@layer blocks are scoped inside; @keyframes,
// @font-face and @property pass through. html/body/:root selectors are left global on purpose (an escape hatch).
'use strict';

function stripComments(css) { return String(css || '').replace(/\/\*[\s\S]*?\*\//g, ''); }

// split at top-level commas (not inside () or [] or strings)
function splitSelectors(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function scopeSelector(sel, root, strict) {
  if (strict) { const m = /^((?:html|:root)(?:\s+body)?|body)\b(.*)$/.exec(sel); if (m) return root + m[2]; }
  else if (/^(html|body|:root)\b/.test(sel)) return sel;
  if (sel.includes('&')) return sel.replace(/&/g, root);
  return root + ' ' + sel;
}

// walk blocks: returns [{prelude, body}|{text}] at one level
function blocks(css) {
  const out = []; let i = 0, n = css.length, start = 0;
  while (i < n) {
    const ch = css[i];
    if (ch === '"' || ch === "'") { const q = ch; i++; while (i < n && css[i] !== q) { if (css[i] === '\\') i++; i++; } i++; continue; }
    if (ch === ';') { const t = css.slice(start, i + 1).trim(); if (t) out.push({ text: t }); start = i + 1; i++; continue; }
    if (ch === '{') {
      const prelude = css.slice(start, i).trim(); let depth = 1, j = i + 1;
      while (j < n && depth) { const c = css[j]; if (c === '"' || c === "'") { const q = c; j++; while (j < n && css[j] !== q) { if (css[j] === '\\') j++; j++; } } else if (c === '{') depth++; else if (c === '}') depth--; j++; }
      out.push({ prelude, body: css.slice(i + 1, j - 1) }); i = j; start = j; continue;
    }
    if (ch === '}') { start = i + 1; } // stray brace: drop
    i++;
  }
  const rest = css.slice(start).trim(); if (rest) out.push({ text: rest });
  return out;
}

// strict: html/body/:root become the root too (for CSS pasted into someone else's page)
function scopeCss(css, root, strict = false) {
  const parts = [];
  for (const b of blocks(stripComments(css))) {
    if (b.text) { parts.push(b.text); continue; }
    const p = b.prelude;
    if (/^@(media|supports|container|layer|document)\b/i.test(p)) parts.push(`${p}{${scopeCss(b.body, root, strict)}}`);
    else if (/^@/.test(p)) parts.push(`${p}{${b.body}}`);
    else parts.push(`${splitSelectors(p).map((s) => scopeSelector(s, root, strict)).join(',')}{${b.body.trim()}}`);
  }
  return parts.join('\n');
}

// quick structural check used by the AI tools: unbalanced braces are the most common mistake
function checkCss(css) {
  const s = stripComments(css).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""'); let d = 0;
  for (const ch of s) { if (ch === '{') d++; if (ch === '}') { d--; if (d < 0) return 'There’s a } without a matching {'; } }
  return d ? `${d} unclosed {` : null;
}

module.exports = { scopeCss, checkCss, splitSelectors };

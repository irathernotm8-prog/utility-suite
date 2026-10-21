// Trace — "where does this file go?" rules for folder-plan charts. Pure; shared with Node tests.
// A folder node's rules are short tokens:  .pdf   pdf   *.psd   invoice*   receipt   (comma or space separated)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.T = root.T || {}).rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const parse = (text) => String(text || '').split(/[,\n]+|\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
  const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

  // Score how well one rule matches a file name (0 = no match). Longer, more specific rules win.
  function score(rule, name) {
    const r = String(rule).trim().toLowerCase();
    let n = String(name).trim().toLowerCase();
    if (!r || !n) return 0;
    const dot = n.lastIndexOf('.');
    // a bare query like "psd" or ".psd" is treated as an extension
    let ext = dot > 0 ? n.slice(dot) : '';
    if (!ext && /^\.?[a-z0-9]{1,8}$/.test(n)) { ext = n.startsWith('.') ? n : '.' + n; n = 'file' + ext; }
    const base = dot > 0 ? n.slice(0, n.lastIndexOf('.')) : n;
    if (r.includes('*') || r.includes('?')) {
      if (!globRe(r).test(n)) return 0;
      return 2 + r.replace(/[*?]/g, '').length / 4;
    }
    if (r.startsWith('.')) return ext === r ? 2 : 0;
    if (/^[a-z0-9]{1,6}$/.test(r) && ext === '.' + r) return 2;
    if (r.length >= 3 && base.includes(r)) return 3 + r.length / 10;
    return 0;
  }

  // nodes: [{id, title, rules: []}] → best matches first: [{id, score, rule}]
  function match(name, nodes) {
    const out = [];
    for (const n of nodes) {
      let best = 0, which = '';
      for (const r of n.rules || []) { const s = score(r, name); if (s > best) { best = s; which = r; } }
      if (best > 0) out.push({ id: n.id, score: best, rule: which });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  return { parse, score, match };
});

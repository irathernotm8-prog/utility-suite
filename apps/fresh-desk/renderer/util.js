'use strict';
// Small helpers shared by the explorer and Tidy. Exposed as globals (no bundler).
(function (g) {
  const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
  function bytes(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n < 1000) return `${n} byte${n === 1 ? '' : 's'}`;
    const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let i = -1;
    do { n /= 1000; i++; } while (n >= 1000 && i < u.length - 1);
    return `${n >= 100 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')} ${u[i]}`;
  }
  const dayMs = 86400000;
  function when(ms) {
    if (!ms) return '—';
    const d = new Date(ms), now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const time = d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
    if (ms >= startToday) return `Today, ${time}`;
    if (ms >= startToday - dayMs) return `Yesterday, ${time}`;
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) + `, ${time}`;
    return d.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
  }
  function longDate(ms) { return ms ? new Date(ms).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '—'; }
  function compareEntries(sort, foldersFirst) {
    const {key = 'name', dir = 1} = sort || {};
    return (a, b) => {
      if (foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let r = 0;
      if (key === 'size') r = (a.size ?? -1) - (b.size ?? -1);
      else if (key === 'mtime') r = a.mtime - b.mtime;
      else if (key === 'kind') r = collator.compare(a.kind, b.kind);
      if (!r) r = collator.compare(a.name, b.name);
      return r * dir;
    };
  }
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v; // only for our own SVG strings
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function basename(p, sep) { const parts = p.split(/[\\/]/).filter(Boolean); return parts.length ? parts[parts.length - 1] : p; }
  function dirname(p, sep) {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (i <= 0) return sep === '\\' ? p.slice(0, 3) : '/';
    const d = p.slice(0, i);
    return /^[A-Za-z]:$/.test(d) ? d + '\\' : d;
  }
  function join(dir, name, sep) { return dir.endsWith(sep) ? dir + name : dir + sep + name; }
  function fileUrl(p) { return 'fdfile://f/' + encodeURIComponent(p.replace(/^\/+/, '')); }
  // Simple subsequence fuzzy score for the command palette.
  function fuzzy(query, text) {
    const q = query.toLowerCase(), t = text.toLowerCase();
    if (!q) return 1;
    const idx = t.indexOf(q);
    if (idx >= 0) return 1000 - idx - t.length * 0.1 + (idx === 0 || /[\s/\\_-]/.test(t[idx - 1]) ? 200 : 0);
    let ti = 0, score = 0, streak = 0;
    for (const c of q) { const f = t.indexOf(c, ti); if (f < 0) return 0; streak = f === ti ? streak + 1 : 0; score += 1 + streak * 2; ti = f + 1; }
    return score;
  }
  g.U = {bytes, when, longDate, compareEntries, el, debounce, basename, dirname, join, fileUrl, fuzzy, collator};
})(globalThis);

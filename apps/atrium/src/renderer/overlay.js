// Atrium — the editing layer inside the preview (loaded only in the app's Edit mode). Hover shows sections, click
// selects a section and the element under the pointer, double-click edits text in place, images can be swapped,
// and every change is written back to the section's html (cleaned of everything Atrium adds at render time).
(function () {
  'use strict';
  if (window.__atOverlay) return;
  const P = window.parent; const post = (m) => P.postMessage({ src: 'atrium-overlay', ...m }, '*');
  let editing = true, selId = null, selEl = null, hoverId = null, textEl = null, textBefore = '', lastNonce = null;
  const doc = document;
  const box = (cls) => { const d = doc.createElement('div'); d.className = 'at-ov ' + cls; d.setAttribute('data-at-ov', ''); doc.documentElement.appendChild(d); return d; };
  const hov = box('at-ov-hover'), sel = box('at-ov-sel'), elb = box('at-ov-el');
  const bar = box('at-ov-bar'); bar.innerHTML = '<b></b><button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button><button data-a="dup" title="Duplicate">⧉</button><button data-a="code" title="Edit code">&lt;/&gt;</button><button data-a="ai" title="Ask AI about this section">✦ AI</button><button data-a="delete" title="Delete">✕</button>';
  const addBtn = box('at-ov-add'); addBtn.innerHTML = '<button title="Add a section here">+ Add section</button>';
  const tag = box('at-ov-tag');
  const root = (n) => (n && n.closest ? n.closest('[data-s]') : null);
  const sid = (r) => (r ? r.getAttribute('data-s') : null);
  const isGlobal = (r) => r && /^(HEADER|FOOTER)$/.test(r.tagName) && r.parentElement === doc.body;
  const place = (el, r, pad = 0) => { if (!r) { el.style.display = 'none'; return; } const b = r.getBoundingClientRect(); el.style.display = 'block'; el.style.left = (b.left + scrollX - pad) + 'px'; el.style.top = (b.top + scrollY - pad) + 'px'; el.style.width = (b.width + pad * 2) + 'px'; el.style.height = (b.height + pad * 2) + 'px'; };
  const TEXT = /^(H[1-6]|P|A|SPAN|LI|BUTTON|BLOCKQUOTE|FIGCAPTION|SMALL|STRONG|EM|B|I|LABEL|TD|TH|DT|DD|CITE|Q|SUMMARY|LEGEND|DIV)$/;
  const textish = (e) => e && TEXT.test(e.tagName) && !e.hasAttribute('data-icon') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !e.closest('[data-at-nav],[data-at-posts],[data-at-sitename],[data-at-year],[data-at-logo],[data-at-tagline]');

  function path(el, r) { const p = []; while (el && el !== r) { const par = el.parentElement; p.unshift([...par.children].filter((c) => !c.hasAttribute('data-at-ov')).indexOf(el)); el = par; } return p; }
  function byPath(r, p) { let el = r; for (const i of p || []) { el = [...el.children].filter((c) => !c.hasAttribute('data-at-ov'))[i]; if (!el) return null; } return el; }
  function describe(el) {
    const cs = getComputedStyle(el); const r = root(el);
    const crumbs = []; let n = el; while (n && n !== r.parentElement) { crumbs.unshift({ tag: n.tagName.toLowerCase(), cls: (n.getAttribute('class') || '').split(/\s+/).filter((c) => c && !/^at-(in|open|scrolled)$/.test(c)).slice(0, 2).join('.'), path: path(n, r) }); n = n.parentElement; }
    return { tag: el.tagName.toLowerCase(), text: el.tagName === 'IMG' ? '' : (el.textContent || '').trim().slice(0, 80), src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '', href: el.getAttribute('href') || '', target: el.getAttribute('target') || '', inline: el.getAttribute('style') || '', cls: el.getAttribute('class') || '', crumbs, textish: textish(el), editable: textish(el) || el.tagName === 'IMG',
      computed: { color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, textAlign: cs.textAlign, padding: cs.padding, margin: cs.margin, borderRadius: cs.borderRadius, maxWidth: cs.maxWidth, display: cs.display, gap: cs.gap, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing } };
  }
  // the html Atrium stores: no render-time additions
  function clean(r) {
    const c = r.cloneNode(true); c.removeAttribute('data-s');
    c.querySelectorAll('[data-at-ov]').forEach((x) => x.remove());
    const all = [c, ...c.querySelectorAll('*')];
    for (const e of all) {
      e.removeAttribute('contenteditable'); e.removeAttribute('spellcheck'); e.removeAttribute('data-at-editing');
      if (e.classList && e.classList.length) { e.classList.remove('at-in', 'at-open', 'at-scrolled'); if (!e.classList.length) e.removeAttribute('class'); }
      if (e.hasAttribute('data-at-preview-form')) e.removeAttribute('data-at-preview-form');
    }
    c.querySelectorAll('i[data-icon]').forEach((e) => { e.innerHTML = ''; e.removeAttribute('aria-hidden'); if (e.getAttribute('class') === 'at-ic') e.removeAttribute('class'); });
    c.querySelectorAll('[data-at-nav],[data-at-sitename],[data-at-tagline],[data-at-year],[data-at-posts],span[data-at-logo],div[data-at-logo]').forEach((e) => { e.innerHTML = ''; });
    c.querySelectorAll('.at-form-note').forEach((e) => e.remove());
    c.querySelectorAll('form[data-at-form] input[type=hidden][name="form-name"]').forEach((e) => e.remove());
    c.querySelectorAll('[data-count]').forEach((e) => { const v = parseFloat(e.getAttribute('data-count')); if (!isNaN(v) && !e.children.length) e.textContent = (e.getAttribute('data-prefix') || '') + v.toLocaleString() + (e.getAttribute('data-suffix') || ''); });
    return c.outerHTML;
  }
  function commit(r, label) { lastNonce = 'n' + Date.now() + Math.random().toString(36).slice(2, 6); post({ type: 'commit', id: sid(r), html: clean(r), nonce: lastNonce, label }); }

  function select(r, el, quiet) {
    selId = sid(r); selEl = el || null;
    place(sel, r); place(elb, el && el !== r ? el : null, 1);
    const b = r ? r.getBoundingClientRect() : null;
    if (r) { bar.style.display = 'flex'; bar.querySelector('b').textContent = r.__atName || r.tagName.toLowerCase(); bar.style.left = (b.left + scrollX + 8) + 'px'; bar.style.top = Math.max(scrollY + 4, b.top + scrollY + 8) + 'px'; bar.querySelector('[data-a=up]').style.display = bar.querySelector('[data-a=down]').style.display = bar.querySelector('[data-a=dup]').style.display = isGlobal(r) ? 'none' : ''; }
    else bar.style.display = 'none';
    if (r && !isGlobal(r)) { addBtn.style.display = 'block'; addBtn.style.left = (b.left + scrollX + b.width / 2 - 64) + 'px'; addBtn.style.top = (b.bottom + scrollY - 15) + 'px'; } else addBtn.style.display = 'none';
    if (!quiet) post({ type: 'select', id: selId, path: el && r ? path(el, r) : [], info: el ? describe(el) : r ? describe(r) : null });
  }
  function reposition() { const r = selId && doc.querySelector(`[data-s="${selId}"]`); if (r) { if (selEl && !r.contains(selEl)) selEl = null; select(r, selEl, true); } else select(null, null, true); if (hoverId) place(hov, doc.querySelector(`[data-s="${hoverId}"]`)); }

  doc.addEventListener('mousemove', (e) => {
    if (!editing || textEl) return;
    const r = root(e.target); const id = sid(r);
    if (id !== hoverId) { hoverId = id; place(hov, r); }
    const t = e.target; if (r && t && t !== r && !t.hasAttribute('data-at-ov')) { const b = t.getBoundingClientRect(); tag.style.display = 'block'; tag.textContent = t.tagName.toLowerCase() + (textish(t) ? ' · double-click to edit' : t.tagName === 'IMG' ? ' · double-click to replace' : ''); tag.style.left = (b.left + scrollX) + 'px'; tag.style.top = (b.top + scrollY - 20) + 'px'; } else tag.style.display = 'none';
  }, true);
  doc.addEventListener('mouseleave', () => { hoverId = null; place(hov, null); tag.style.display = 'none'; });
  doc.addEventListener('click', (e) => {
    if (!editing) return;
    if (e.target.closest('[data-at-ov]')) return;
    if (textEl && textEl.contains(e.target)) return;
    if (textEl) finishText(true);
    const a = e.target.closest('a'); if (a) { e.preventDefault(); if (e.metaKey || e.ctrlKey) { post({ type: 'navigate', href: a.getAttribute('href') }); return; } }
    if (e.target.closest('button[type=submit],input[type=submit]')) e.preventDefault();
    const r = root(e.target); if (!r) { select(null); return; }
    select(r, e.target === r ? null : e.target);
  }, true);
  doc.addEventListener('submit', (e) => { if (editing) e.preventDefault(); }, true);
  doc.addEventListener('dblclick', (e) => {
    if (!editing) return; const t = e.target; const r = root(t); if (!r) return;
    if (t.tagName === 'IMG') { e.preventDefault(); select(r, t); post({ type: 'image', id: sid(r), path: path(t, r), src: t.getAttribute('src') }); return; }
    const el = textish(t) ? t : t.closest && [...(function* () { let n = t; while (n && n !== r) { yield n; n = n.parentElement; } })()].find(textish);
    if (el) { e.preventDefault(); startText(el); }
  }, true);

  function startText(el) {
    const r = root(el); select(r, el); textEl = el; textBefore = el.innerHTML;
    el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true'); el.setAttribute('data-at-editing', ''); el.focus();
    const range = doc.createRange(); range.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    el.addEventListener('blur', onBlur); el.addEventListener('keydown', onKey); post({ type: 'editing', on: true });
  }
  function onBlur() { finishText(true); }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); finishText(false); }
    else if (e.key === 'Enter' && !e.shiftKey && !/^(P|LI|BLOCKQUOTE|DD|TD)$/.test(textEl.tagName)) { e.preventDefault(); finishText(true); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finishText(true); }
    else if ((e.metaKey || e.ctrlKey) && /^[bi]$/i.test(e.key)) { e.preventDefault(); doc.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic'); }
  }
  function finishText(save) {
    const el = textEl; if (!el) return; textEl = null;
    el.removeEventListener('blur', onBlur); el.removeEventListener('keydown', onKey);
    el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); el.removeAttribute('data-at-editing');
    post({ type: 'editing', on: false });
    if (!save) { el.innerHTML = textBefore; return; }
    el.innerHTML = el.innerHTML.replace(/&nbsp;/g, ' ').replace(/<br>$/, '');
    if (el.innerHTML !== textBefore) commit(root(el), 'Edit text');
  }
  // paste as plain text while editing
  doc.addEventListener('paste', (e) => { if (!textEl) return; e.preventDefault(); doc.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });

  bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || !selId) return; e.stopPropagation(); post({ type: 'action', action: b.dataset.a, id: selId }); });
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); post({ type: 'action', action: 'add-after', id: selId }); });

  // messages from the app
  addEventListener('message', (e) => {
    const m = e.data; if (!m || m.src !== 'atrium-app') return;
    const r = m.id ? doc.querySelector(`[data-s="${m.id}"]`) : null;
    if (m.type === 'mode') { editing = m.edit; doc.documentElement.classList.toggle('at-ov-off', !editing); if (!editing) { select(null, null, true); place(hov, null); tag.style.display = 'none'; } }
    if (m.type === 'names') { for (const [id, n] of Object.entries(m.names || {})) { const x = doc.querySelector(`[data-s="${id}"]`); if (x) x.__atName = n; } reposition(); }
    if (m.type === 'select') { if (r) { const el = m.path && m.path.length ? byPath(r, m.path) : null; select(r, el, !m.report); if (m.scroll) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else select(null, null, true); }
    if (m.type === 'scroll' && r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (m.type === 'flash' && r) { r.animate([{ outline: '3px solid rgba(127,140,255,.9)', outlineOffset: '-3px' }, { outline: '3px solid rgba(127,140,255,0)', outlineOffset: '-3px' }], { duration: 1400 }); }
    if (m.type === 'apply' && r) { // style / attribute / text changes from the inspector
      const el = m.path && m.path.length ? byPath(r, m.path) : r; if (!el) return;
      if (m.style) for (const [k, v] of Object.entries(m.style)) { if (v === '' || v == null) el.style.removeProperty(k); else el.style.setProperty(k, v); }
      if (!el.getAttribute('style')) el.removeAttribute('style');
      if (m.attrs) for (const [k, v] of Object.entries(m.attrs)) { if (v === null || v === '') el.removeAttribute(k); else el.setAttribute(k, v); }
      if (m.text != null) el.textContent = m.text;
      if (m.remove) { el.remove(); selEl = null; }
      if (m.duplicate) el.after(el.cloneNode(true));
      if (m.move) { const sib = m.move < 0 ? el.previousElementSibling : el.nextElementSibling; if (sib) m.move < 0 ? sib.before(el) : sib.after(el); }
      commit(r, m.label || 'Edit'); select(r, el.isConnected ? el : null, false);
    }
    if (m.type === 'start-text' && r) { const el = byPath(r, m.path); if (el) startText(el); }
  });

  addEventListener('scroll', reposition, { passive: true }); addEventListener('resize', reposition);
  new ResizeObserver(reposition).observe(doc.body);

  window.__atOverlay = {
    event(e) { if (e.type === 'section' && e.nonce && e.nonce === lastNonce) return false; if (textEl && e.type === 'reload') { finishText(true); } return true; },
    swapped(n) { if (sid(n) === selId) { selEl = null; select(n, null, true); } },
  };
  const ready = () => post({ type: 'ready', page: doc.body.getAttribute('data-page'), sections: [...doc.querySelectorAll('[data-s]')].map((x) => x.getAttribute('data-s')), height: doc.documentElement.scrollHeight });
  if (doc.readyState === 'complete') ready(); else addEventListener('load', ready);
})();

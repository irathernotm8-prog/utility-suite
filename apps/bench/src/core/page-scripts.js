// Bench — small scripts run inside an app window's page: a readable list of what can be clicked or typed into
// (with refs like e12 that Claude can click), finding an element by its text, and waiting for text to appear.
// Each is a self-contained function turned into text; the page only ever sees plain DOM code.
'use strict';

function snapshotFn(opts) {
  opts = opts || {};
  const MAX = opts.max || 250;
  const W = window.innerWidth, H = window.innerHeight;
  const st = (window.__benchRefs = window.__benchRefs || { n: 0, map: new Map(), back: new WeakMap() });
  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=switch],[role=option],[role=combobox],[role=textbox],[role=slider],[role=searchbox],[role=spinbutton],[role=treeitem],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"]),[onclick],[data-act],[data-action],[data-view]';
  const roleOf = (el) => {
    const r = el.getAttribute('role'); if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a') return 'link'; if (t === 'button' || t === 'summary') return 'button'; if (t === 'select') return 'combobox'; if (t === 'textarea') return 'textbox';
    if (t === 'input') { const ty = (el.type || 'text').toLowerCase(); return { checkbox: 'checkbox', radio: 'radio', range: 'slider', button: 'button', submit: 'button', reset: 'button', file: 'file', color: 'color', number: 'spinbutton', search: 'searchbox' }[ty] || 'textbox'; }
    if (el.isContentEditable) return 'textbox';
    return 'clickable';
  };
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const nameOf = (el) => {
    const doc = el.ownerDocument;
    const by = el.getAttribute('aria-labelledby'); if (by) { const t = by.split(/\s+/).map((id) => (doc.getElementById(id) || {}).textContent || '').join(' '); if (t.trim()) return clip(t, 80); }
    const al = el.getAttribute('aria-label'); if (al) return clip(al, 80);
    if (el.labels && el.labels.length) { const t = [...el.labels].map((l) => l.innerText).join(' '); if (t.trim()) return clip(t, 80); }
    const t = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ? '' : el.innerText;
    if (t && t.trim()) return clip(t, 80);
    return clip(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (el.querySelector && el.querySelector('img[alt]') ? el.querySelector('img[alt]').alt : '') || el.getAttribute('data-tip') || el.getAttribute('name') || el.id || '', 80);
  };
  const visible = (el, r) => {
    if (r.width < 2 || r.height < 2) return false;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    return true;
  };
  const items = []; const seen = new Set();
  const visit = (root, ox, oy) => {
    let els = []; try { els = root.querySelectorAll(INTERACTIVE + ',*'); } catch (_) { return; }
    for (const el of els) {
      if (items.length >= MAX) return;
      if (el.shadowRoot) visit(el.shadowRoot, ox, oy);
      if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) { const r = el.getBoundingClientRect(); visit(d, ox + r.left, oy + r.top); } } catch (_) {} continue; }
      let interactive = false; try { interactive = el.matches(INTERACTIVE); } catch (_) {}
      if (!interactive) {
        // plain elements that act like buttons (cursor: pointer with their own text), but not inside a real control
        if (!el.children || el.children.length > 3) continue;
        const cs = el.ownerDocument.defaultView.getComputedStyle(el); if (cs.cursor !== 'pointer') continue;
        if (el.parentElement && el.ownerDocument.defaultView.getComputedStyle(el.parentElement).cursor === 'pointer') continue;
        if (el.closest(INTERACTIVE)) continue;
      }
      if (el.disabled && el.type === 'hidden') continue;
      if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!visible(el, r)) continue;
      let p = el.parentElement; let dup = false; while (p) { if (seen.has(p) && (roleOf(p) === 'button' || roleOf(p) === 'link') && !['textbox', 'checkbox', 'radio', 'combobox'].includes(roleOf(el))) { dup = true; break; } p = p.parentElement; }
      if (dup) continue;
      seen.add(el);
      let ref = st.back.get(el); if (!ref) { ref = 'e' + ++st.n; st.back.set(el, ref); st.map.set(ref, new WeakRef(el)); }
      const cx = Math.round(ox + r.left + r.width / 2), cy = Math.round(oy + r.top + r.height / 2);
      const it = { ref, role: roleOf(el), name: nameOf(el), x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height) };
      if (cx < 0 || cy < 0 || cx > W || cy > H) it.off = true;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') it.disabled = true;
      if ('checked' in el && (el.type === 'checkbox' || el.type === 'radio')) it.checked = el.checked; else if (el.getAttribute('aria-checked')) it.checked = el.getAttribute('aria-checked') === 'true';
      if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.classList.contains('on') || el.classList.contains('active') || el.classList.contains('selected')) it.selected = true;
      if (el.getAttribute('aria-expanded')) it.expanded = el.getAttribute('aria-expanded') === 'true';
      if (it.role === 'textbox' || it.role === 'searchbox' || it.role === 'spinbutton' || it.role === 'combobox' || it.role === 'slider') { const v = el.isContentEditable ? el.innerText : el.value; if (v != null && v !== '') it.value = clip(el.type === 'password' ? '••••' : v, 60); if (el.placeholder && it.name !== el.placeholder) it.placeholder = clip(el.placeholder, 40); }
      if (el.tagName === 'SELECT') it.options = [...el.options].slice(0, 12).map((o) => clip(o.text, 30));
      if (el.tagName === 'A' && el.getAttribute('href') && !/^(#|javascript:)/.test(el.getAttribute('href'))) it.href = clip(el.getAttribute('href'), 60);
      if (el.ownerDocument.activeElement === el) it.focused = true;
      items.push(it);
    }
  };
  visit(document, 0, 0);
  const heads = [...document.querySelectorAll('h1,h2,h3,[role=heading],dialog[open] h1,dialog[open] h2')].filter((h) => { const r = h.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < H && r.bottom > 0; }).slice(0, 12).map((h) => clip(h.innerText, 60)).filter(Boolean);
  const dialogs = [...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]')].filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((d) => clip(d.innerText, 160));
  const alerts = [...document.querySelectorAll('[role=alert],[role=status],.toast,.error,.notice.bad')].filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && d.innerText.trim(); }).slice(0, 6).map((d) => clip(d.innerText, 140));
  return { title: document.title, url: location.href, width: W, height: H, scrollY: Math.round(window.scrollY), scrollH: document.documentElement.scrollHeight, headings: heads, dialogs, alerts, items, more: items.length >= MAX };
}

function refPointFn(ref, scroll) {
  const st = window.__benchRefs; const wr = st && st.map.get(ref); const el = wr && wr.deref();
  if (!el || !el.isConnected) return { error: `${ref} is gone (the page changed). Run inspect again to get fresh refs.` };
  let r = el.getBoundingClientRect(); let ox = 0, oy = 0;
  let win = el.ownerDocument.defaultView;
  while (win && win !== window && win.frameElement) { const fr = win.frameElement.getBoundingClientRect(); ox += fr.left; oy += fr.top; win = win.parent; }
  const inView = r.top + oy >= 0 && r.bottom + oy <= window.innerHeight && r.left + ox >= 0 && r.right + ox <= window.innerWidth;
  if (scroll && !inView) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); r = el.getBoundingClientRect(); }
  return { x: Math.round(ox + r.left + r.width / 2), y: Math.round(oy + r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName.toLowerCase(), editable: el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName), select: el.tagName === 'SELECT', disabled: !!el.disabled };
}

function focusRefFn(ref, clear) {
  const st = window.__benchRefs; const wr = st && st.map.get(ref); const el = wr && wr.deref();
  if (!el || !el.isConnected) return { error: `${ref} is gone (the page changed). Run inspect again.` };
  el.focus();
  if (clear) { if ('value' in el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) { el.select(); } else if (el.isContentEditable) { const s = el.ownerDocument.getSelection(); const rg = el.ownerDocument.createRange(); rg.selectNodeContents(el); s.removeAllRanges(); s.addRange(rg); } }
  return { ok: true };
}

function selectOptionFn(ref, value) {
  const st = window.__benchRefs; const wr = st && st.map.get(ref); const el = wr && wr.deref();
  if (!el || el.tagName !== 'SELECT') return { error: `${ref} isn't a dropdown` };
  const want = String(value).toLowerCase();
  const opt = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) || [...el.options].find((o) => o.text.toLowerCase().includes(want));
  if (!opt) return { error: `No option “${value}”. Options: ${[...el.options].map((o) => o.text.trim()).join(', ')}` };
  el.value = opt.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, picked: opt.text.trim() };
}

function findTextFn(text, opts) {
  opts = opts || {};
  const want = String(text).trim().toLowerCase();
  const W = window.innerWidth, H = window.innerHeight;
  const cands = [];
  const visit = (root, ox, oy) => {
    const walker = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of walker) {
      if (el.shadowRoot) visit(el.shadowRoot, ox, oy);
      if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) { const r = el.getBoundingClientRect(); visit(d, ox + r.left, oy + r.top); } } catch (_) {} continue; }
      if (/^(SCRIPT|STYLE|HTML|BODY|HEAD)$/.test(el.tagName)) continue;
      const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().toLowerCase();
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
      const inner = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      let score = 0;
      if (own === want || label === want) score = 3; else if (inner === want) score = 2.5; else if (own.includes(want) || label.includes(want)) score = 2; else if (inner.includes(want) && inner.length < want.length * 3 + 20) score = 1;
      if (!score) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const cs = el.ownerDocument.defaultView.getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const clickable = el.closest('a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[onclick],[tabindex]');
      if (clickable) score += 0.5;
      cands.push({ el: clickable && opts.click !== false ? clickable : el, score, area: r.width * r.height, ox, oy });
    }
  };
  visit(document, 0, 0);
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score || a.area - b.area);
  const best = cands[0];
  const st = (window.__benchRefs = window.__benchRefs || { n: 0, map: new Map(), back: new WeakMap() });
  let ref = st.back.get(best.el); if (!ref) { ref = 'e' + ++st.n; st.back.set(best.el, ref); st.map.set(ref, new WeakRef(best.el)); }
  const r = best.el.getBoundingClientRect();
  return { ref, x: Math.round(best.ox + r.left + r.width / 2), y: Math.round(best.oy + r.top + r.height / 2), name: (best.el.innerText || best.el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60), matches: cands.filter((c) => c.score === best.score).length, offscreen: r.top < 0 || r.bottom > H || r.left < 0 || r.right > W };
}

function hasTextFn(text) {
  const want = String(text).toLowerCase();
  const docs = [document]; for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (_) {} }
  return docs.some((d) => (d.body && d.body.innerText.toLowerCase().includes(want)) || [...d.querySelectorAll('input,textarea')].some((i) => String(i.value).toLowerCase().includes(want)));
}

const call = (fn, ...args) => `(${fn.toString()})(${args.map((a) => JSON.stringify(a === undefined ? null : a)).join(',')})`;

/** Turns a snapshot into compact lines for Claude. */
function formatSnapshot(s, win) {
  const lines = [];
  lines.push(`Window ${win ? win.id + ' ' : ''}“${s.title || (win && win.title) || ''}” — ${s.width}×${s.height}${s.scrollH > s.height + 4 ? ` (page ${s.scrollH}px tall, scrolled ${s.scrollY})` : ''}`);
  if (s.url && !/^data:/.test(s.url)) lines.push(`Page: ${s.url.length > 120 ? s.url.slice(0, 120) + '…' : s.url}`);
  if (s.dialogs.length) lines.push(`Open dialog: ${s.dialogs.map((d) => `“${d}”`).join(' · ')}`);
  if (s.alerts.length) lines.push(`Messages on screen: ${s.alerts.map((d) => `“${d}”`).join(' · ')}`);
  if (s.headings.length) lines.push(`Headings: ${s.headings.join(' · ')}`);
  lines.push('');
  for (const it of s.items) {
    let l = `${it.ref} ${it.role}${it.name ? ` “${it.name}”` : ''}`;
    if (it.value != null) l += ` value=“${it.value}”`; if (it.placeholder) l += ` placeholder=“${it.placeholder}”`;
    if (it.checked != null) l += it.checked ? ' [checked]' : ' [unchecked]'; if (it.selected) l += ' [selected]'; if (it.expanded != null) l += it.expanded ? ' [open]' : ' [closed]';
    if (it.disabled) l += ' [disabled]'; if (it.focused) l += ' [focused]';
    if (it.options) l += ` options: ${it.options.join(' | ')}`; if (it.href) l += ` → ${it.href}`;
    l += it.off ? ` (off-screen, ${it.x},${it.y})` : ` at ${it.x},${it.y}`;
    lines.push(l);
  }
  if (!s.items.length) lines.push('(nothing clickable found — take a screenshot to see the window)');
  if (s.more) lines.push('… more elements not listed');
  return lines.join('\n');
}

module.exports = { snapshotFn, refPointFn, focusRefFn, selectOptionFn, findTextFn, hasTextFn, call, formatSnapshot };

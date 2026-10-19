// Onward — scripts that run inside web pages (every frame) so Claude can read and fill them.
// Each export is a plain function; it is serialised with fn.toString() and run with frame.executeJavaScript.
// Elements get a data-onward-ref="eN" attribute so later calls can find them again.

/* eslint-disable no-undef */

// Read the page: visible text + interactive elements with refs and human labels.
function readPage(opts) {
  const o = Object.assign({ include: ['fields', 'buttons'], maxText: 12000, maxElements: 220, text: true }, opts || {});
  const W = window;
  W.__onwardN = W.__onwardN || 0;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => { s = norm(s).replace(/\s*\*+\s*$/, '').replace(/^\*\s*/, ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const visible = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const refOf = (el) => {
    let r = el.getAttribute('data-onward-ref');
    if (!r) { r = 'e' + (++W.__onwardN); el.setAttribute('data-onward-ref', r); }
    return r;
  };
  const textOfIds = (ids) => norm(String(ids || '').split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' '));
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && norm(aria)) return norm(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb && textOfIds(lb)) return textOfIds(lb);
    if (el.labels && el.labels.length) return norm([...el.labels].map(l => l.innerText).join(' '));
    const wrap = el.closest('label');
    if (wrap && norm(wrap.innerText)) return norm(wrap.innerText);
    if (el.placeholder) return norm(el.placeholder);
    if (el.title) return norm(el.title);
    // nearest text before the field inside its container
    let n = el, hops = 0;
    while (n && hops++ < 4) {
      let p = n.previousElementSibling;
      while (p) { const t = norm(p.innerText); if (t && t.length < 200) return t; p = p.previousElementSibling; }
      n = n.parentElement;
      if (n) { const own = norm([...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ')); if (own) return own; }
    }
    return el.name ? norm(el.name.replace(/[_\-\[\]]+/g, ' ')) : '';
  };
  const groupLabel = (el) => {
    const fs = el.closest('fieldset');
    if (fs) { const lg = fs.querySelector('legend'); if (lg && norm(lg.innerText)) return norm(lg.innerText); }
    const rg = el.closest('[role=radiogroup],[role=group]');
    if (rg) { const l = rg.getAttribute('aria-label') || textOfIds(rg.getAttribute('aria-labelledby')); if (l) return norm(l); }
    return '';
  };
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    let type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : el.isContentEditable ? 'richtext' : role || tag;
    if (tag === 'a') type = 'link';
    if (tag === 'button' || role === 'button' || ['submit', 'button', 'reset', 'image'].includes(type)) type = 'button';
    return type;
  };

  const out = [];
  const seenRadio = new Set();
  const want = new Set(o.include);
  const sel = 'input, select, textarea, button, a[href], [role=button], [role=link], [role=checkbox], [role=radio], [role=combobox], [role=switch], [role=tab], [role=option], [role=menuitem], [contenteditable=""], [contenteditable=true]';
  for (const el of document.querySelectorAll(sel)) {
    if (out.length >= o.maxElements) break;
    const type = describe(el);
    if (type === 'hidden') continue;
    const isFile = type === 'file';
    if (!isFile && !visible(el)) continue;
    if (el.disabled && type !== 'button') continue;
    const isField = !['button', 'link', 'tab', 'option', 'menuitem'].includes(type);
    if (isField && !want.has('fields')) continue;
    if (type === 'button' && !want.has('buttons')) continue;
    if (type === 'link' && !want.has('links')) continue;
    if (['tab', 'option', 'menuitem'].includes(type) && !want.has('buttons')) continue;

    if (type === 'radio' || el.getAttribute('role') === 'radio') {
      const name = el.name || el.closest('[role=radiogroup]')?.id || '';
      const key = name || refOf(el);
      if (seenRadio.has(key)) continue;
      seenRadio.add(key);
      const members = name && el.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)] : el.closest('[role=radiogroup]') ? [...el.closest('[role=radiogroup]').querySelectorAll('[role=radio],input[type=radio]')] : [el];
      const ref = refOf(el);
      members.forEach(m => m.setAttribute('data-onward-group', ref));
      out.push({ ref, type: 'radio', label: cut(groupLabel(el) || labelOf(el), 160), required: !!(el.required || el.getAttribute('aria-required') === 'true'),
        options: members.map(m => ({ ref: refOf(m), label: cut(labelOf(m) || m.value, 80), checked: !!(m.checked || m.getAttribute('aria-checked') === 'true') })) });
      continue;
    }
    const item = { ref: refOf(el), type, label: cut(type === 'button' || type === 'link' ? (norm(el.innerText) || el.value || el.getAttribute('aria-label') || el.title) : labelOf(el), 160) };
    if (type === 'link') { item.href = el.href; if (!item.label) continue; }
    if (isField) {
      if (el.required || el.getAttribute('aria-required') === 'true') item.required = true;
      if (type === 'checkbox' || el.getAttribute('role') === 'checkbox' || type === 'switch') item.checked = !!(el.checked || el.getAttribute('aria-checked') === 'true');
      else if (type === 'select') {
        item.value = el.options[el.selectedIndex]?.text || '';
        item.options = [...el.options].slice(0, 80).map(op => norm(op.text)).filter(Boolean);
      } else if (type === 'richtext') item.value = cut(el.innerText, 300);
      else if (type === 'file') { item.accept = el.accept || ''; item.hasFile = !!(el.files && el.files.length); if (el.files?.length) item.value = el.files[0].name; }
      else if ('value' in el) item.value = cut(el.value, 300);
      if (el.getAttribute('aria-invalid') === 'true') item.invalid = true;
      if (el.maxLength > 0 && el.maxLength < 100000) item.maxLength = el.maxLength;
    }
    if (type === 'button' && el.disabled) item.disabled = true;
    out.push(item);
  }
  let text = '';
  if (o.text && document.body) {
    text = document.body.innerText.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > o.maxText) text = text.slice(0, o.maxText) + `\n…[${text.length - o.maxText} more characters — call again with a higher maxText or scroll]`;
  }
  // Validation messages near fields help Claude fix mistakes
  const errors = [...document.querySelectorAll('[role=alert], .error, .errors, [class*="error" i][class*="message" i], [id*="error" i]')]
    .filter(visible).map(e => norm(e.innerText)).filter(t => t && t.length < 200).slice(0, 12);
  const h = [...document.querySelectorAll('h1, h2, [role=heading], legend')].filter(visible).map(e => norm(e.innerText)).find(t => t && t.length < 120) || '';
  return { url: location.href, title: document.title, heading: h, text, elements: out, errors, scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight } };
}

// Fill fields: [{ ref, value }]
function fillFields(items) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const find = (ref) => document.querySelector(`[data-onward-ref="${ref}"]`);
  const flash = (el) => { try { const o = el.style.outline, oo = el.style.outlineOffset; el.style.outline = '2px solid #ff7a45'; el.style.outlineOffset = '2px'; setTimeout(() => { el.style.outline = o; el.style.outlineOffset = oo; }, 1400); } catch (e) {} };
  const setNative = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
  };
  const fire = (el, ...types) => types.forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  const truthy = (v) => v === true || /^(true|yes|y|on|checked|1)$/i.test(String(v));
  const match = (list, want, get) => {
    const w = norm(want);
    return list.find(x => norm(get(x)) === w) || list.find(x => norm(get(x)).startsWith(w)) || list.find(x => norm(get(x)).includes(w)) || list.find(x => w && w.includes(norm(get(x))) && norm(get(x)).length > 1);
  };
  const results = [];
  for (const { ref, value } of items) {
    const el = find(ref);
    if (!el) { results.push({ ref, ok: false, note: 'not on this page any more — read the page again' }); continue; }
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      const group = el.getAttribute('data-onward-group') === ref ? [...document.querySelectorAll(`[data-onward-group="${ref}"]`)] : null;
      if (group && group.length > 1 || type === 'radio' || el.getAttribute('role') === 'radio') {
        const members = group && group.length ? group : [el];
        const lab = (m) => (m.labels && m.labels[0]?.innerText) || m.getAttribute('aria-label') || m.closest('label')?.innerText || m.value || m.innerText;
        const pick = match(members, value, lab) || (members.length === 1 ? members[0] : null);
        if (!pick) { results.push({ ref, ok: false, note: 'no option matching "' + value + '"', options: members.map(lab).map(s => String(s).trim()) }); continue; }
        (pick.labels?.[0] || pick).click(); if (!pick.checked && 'checked' in pick) pick.click();
        flash(pick.closest('label') || pick); results.push({ ref, ok: true, value: String(lab(pick)).trim() }); continue;
      }
      if (tag === 'select') {
        const op = match([...el.options], value, o => o.text) || [...el.options].find(o => norm(o.value) === norm(value));
        if (!op) { results.push({ ref, ok: false, note: 'no option matching "' + value + '"', options: [...el.options].map(o => o.text.trim()).slice(0, 60) }); continue; }
        el.focus(); setNative(el, op.value); fire(el, 'input', 'change'); el.blur();
        flash(el); results.push({ ref, ok: true, value: op.text.trim() }); continue;
      }
      if (type === 'checkbox' || el.getAttribute('role') === 'checkbox' || el.getAttribute('role') === 'switch') {
        const on = el.checked ?? el.getAttribute('aria-checked') === 'true';
        if (on !== truthy(value)) el.click();
        flash(el); results.push({ ref, ok: true, value: truthy(value) }); continue;
      }
      if (type === 'file') { results.push({ ref, ok: false, note: 'file input — use onward_browser_upload' }); continue; }
      if (el.isContentEditable) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, String(value));
        fire(el, 'input', 'change');
        flash(el); results.push({ ref, ok: true }); continue;
      }
      if ('value' in el) {
        el.focus();
        setNative(el, String(value));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
        fire(el, 'change');
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        flash(el);
        results.push({ ref, ok: true, ...(el.value !== String(value) ? { note: 'page changed the value to "' + el.value + '"' } : {}) });
        continue;
      }
      results.push({ ref, ok: false, note: 'not a fillable field — try onward_browser_click' });
    } catch (e) { results.push({ ref, ok: false, note: String(e && e.message || e) }); }
  }
  return results;
}

// Type character by character with keyboard + input events (fallback when real keys can't reach a frame)
function typeChars(ref, text) {
  const el = document.querySelector(`[data-onward-ref="${ref}"]`);
  if (!el) return false;
  el.focus();
  const isVal = 'value' in el && el.tagName !== 'BUTTON';
  const setter = isVal ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set : null;
  for (const ch of String(text)) {
    const o = { key: ch, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    if (isVal) { const v = el.value + ch; setter ? setter.call(el, v) : (el.value = v); }
    else document.execCommand('insertText', false, ch);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// Is this the final "submit application" button?
function looksLikeSubmit(ref) {
  const el = document.querySelector(`[data-onward-ref="${ref}"]`);
  if (!el) return { found: false };
  const t = String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const final = /\b(submit|send)\b.*\b(application|applicaton|app)\b|^\s*(submit|send|finish|complete( application)?|submit now|apply now and submit)\s*$|submit your application|finish applying/i.test(t);
  return { found: true, text: t, final };
}

// Would pressing Enter/Space on the focused element submit the application?
function focusedSubmitsFinal() {
  const finalText = (t) => /\b(submit|send)\b.*\b(application|applicaton|app)\b|^\s*(submit|send|finish|complete( application)?|submit now)\s*$|submit your application|finish applying/i.test(String(t || '').replace(/\s+/g, ' ').trim());
  const label = (b) => b.innerText || b.value || b.getAttribute('aria-label') || '';
  const el = document.activeElement;
  if (!el || el === document.body || el.tagName === 'IFRAME') return { final: false };
  const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || ['submit', 'button', 'image'].includes((el.type || '').toLowerCase());
  if (isButton) return { final: finalText(label(el)), ref: el.getAttribute('data-onward-ref'), text: label(el).trim() };
  // Enter inside a single-line field submits its form
  if (el.tagName === 'INPUT' && el.form) {
    const sub = el.form.querySelector('button[type=submit], button:not([type]), input[type=submit]');
    if (sub && finalText(label(sub))) return { final: true, ref: sub.getAttribute('data-onward-ref'), text: label(sub).trim(), viaForm: true };
  }
  return { final: false };
}

// Click an element. Returns what was clicked.
function clickRef(ref) {
  const el = document.querySelector(`[data-onward-ref="${ref}"]`);
  if (!el) return { ok: false, note: 'not on this page any more — read the page again' };
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  try { const o = el.style.outline; el.style.outline = '2px solid #ff7a45'; setTimeout(() => { el.style.outline = o; }, 900); } catch (e) {}
  const opts = { bubbles: true, cancelable: true, view: window };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts));
  } catch (e) {}
  el.click();
  return { ok: true, clicked: String(el.innerText || el.value || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 80) };
}

// Mark the final submit button for the user, and report when they press it.
function markSubmit(ref) {
  const el = document.querySelector(`[data-onward-ref="${ref}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (!document.getElementById('__onward_pulse')) {
    const st = document.createElement('style');
    st.id = '__onward_pulse';
    st.textContent = '@keyframes onwardPulse{0%{box-shadow:0 0 0 0 rgba(255,122,69,.75)}70%{box-shadow:0 0 0 14px rgba(255,122,69,0)}100%{box-shadow:0 0 0 0 rgba(255,122,69,0)}} [data-onward-submit]{animation:onwardPulse 1.6s infinite!important;outline:2px solid #ff7a45!important;outline-offset:3px!important}';
    document.head.appendChild(st);
  }
  el.setAttribute('data-onward-submit', '1');
  if (!el.__onwardHooked) {
    el.__onwardHooked = true;
    el.addEventListener('click', () => {
      let answers = [];
      try { if (window.__onwardSnapshot) answers = window.__onwardSnapshot(); } catch (e) {}
      console.log('__onward_submit__' + JSON.stringify({ answers }));
      el.removeAttribute('data-onward-submit');
    }, true);
  }
  return true;
}

// Hook every final-submit button on the page (no styling) so Onward knows when the user submits,
// and what the form said at that moment. Expects window.__onwardRead = readPage.
function hookSubmits() {
  const finalText = (t) => /\b(submit|send)\b.*\b(application|applicaton|app)\b|^\s*(submit|send|finish|complete( application)?|submit now)\s*$|submit your application|finish applying/i.test(String(t || '').replace(/\s+/g, ' ').trim());
  window.__onwardSnapshot = window.__onwardSnapshot || function () {
    const r = window.__onwardRead ? window.__onwardRead({ include: ['fields'], text: false, maxElements: 300 }) : { elements: [] };
    const out = [];
    for (const el of r.elements) {
      if (['password', 'hidden'].includes(el.type)) continue;
      let v = '';
      if (el.type === 'radio') v = (el.options || []).filter(o => o.checked).map(o => o.label).join(', ');
      else if (el.type === 'checkbox' || el.type === 'switch') v = el.checked ? 'Yes' : '';
      else v = el.value || '';
      v = String(v).trim();
      if (!v || !el.label || /^(select|choose|--)/i.test(v)) continue;
      out.push({ question: el.label.slice(0, 200), answer: v.slice(0, 1500) });
    }
    return out.slice(0, 120);
  };
  const btns = [...document.querySelectorAll('button, input[type=submit], [role=button]')];
  for (const b of btns) {
    if (b.__onwardHooked) continue;
    const t = b.innerText || b.value || b.getAttribute('aria-label') || '';
    if (!finalText(t)) continue;
    b.__onwardHooked = true;
    b.addEventListener('click', () => {
      let answers = [];
      try { answers = window.__onwardSnapshot(); } catch (e) {}
      console.log('__onward_submit__' + JSON.stringify({ answers }));
      b.removeAttribute('data-onward-submit');
    }, true);
  }
  return true;
}

// Put a file into a file input (or drop it on a dropzone). b64 = file bytes.
function setFile(ref, name, mime, b64) {
  const el = document.querySelector(`[data-onward-ref="${ref}"]`);
  if (!el) return { ok: false, note: 'not on this page any more — read the page again' };
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type: mime, lastModified: Date.now() });
  const dt = new DataTransfer(); dt.items.add(file);
  let input = el.tagName === 'INPUT' && el.type === 'file' ? el : el.querySelector('input[type=file]') || el.closest('form, div')?.querySelector('input[type=file]');
  if (input) {
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, via: 'input', name };
  }
  // A dropzone without an input
  for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
  return { ok: true, via: 'drop', name };
}

function scrollPage(o) {
  o = o || {};
  if (o.ref) { const el = document.querySelector(`[data-onward-ref="${o.ref}"]`); if (el) { el.scrollIntoView({ block: 'center' }); return { ok: true }; } }
  // Scroll the biggest scrollable list (e.g. LinkedIn's job results) when asked, else the window
  const amount = (o.direction === 'up' ? -1 : 1) * (o.pages || 1) * innerHeight * 0.85;
  if (o.inner) {
    const boxes = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 200);
    boxes.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    if (boxes[0]) { boxes[0].scrollBy(0, amount); return { ok: true, scrolled: 'list' }; }
  }
  window.scrollBy(0, amount);
  return { ok: true, y: Math.round(scrollY), height: document.documentElement.scrollHeight };
}

const call = (fn, ...args) => `(${fn.toString()})(${args.map(a => JSON.stringify(a === undefined ? null : a)).join(',')})`;

module.exports = { readPage, hookSubmits, fillFields, typeChars, looksLikeSubmit, focusedSubmitsFinal, clickRef, markSubmit, setFile, scrollPage, call };

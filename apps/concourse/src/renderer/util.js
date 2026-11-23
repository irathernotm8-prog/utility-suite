// Concourse — small helpers shared by every view: elements, times, avatars, safe message HTML, modals and toasts.
(() => {
  const C = window.concourse;
  const M = C.model;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /** h('div.a.b#id', { attrs, onclick }, ...children) */
  function h(tag, props, ...kids) {
    tag = String(tag).replace(/\.{2,}/g, '.').replace(/\.+$/, '');
    const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) { if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1); }
    if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.appendChild(k instanceof Node ? k : document.createTextNode(String(k))); }
    return el;
  }
  const icon = (n) => { const s = document.createElement('span'); s.className = 'ic'; s.style.display = 'inline-grid'; s.innerHTML = ic(n); return s.firstChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ───── time
  const pad = (n) => String(n).padStart(2, '0');
  const h12 = () => !!(window.S && S.state && S.state.settings && S.state.settings.h12);
  const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const timeLabel = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayLabel = (ms, o = {}) => new Date(ms).toLocaleDateString([], { weekday: o.long ? 'long' : 'short', day: 'numeric', month: o.long ? 'long' : 'short' });
  const boardDate = (ms) => { const d = new Date(ms); return `${d.toLocaleDateString('en', { weekday: 'short' })} ${pad(d.getDate())} ${d.toLocaleDateString('en', { month: 'short' })}`.toUpperCase(); };
  function ago(ms, now = Date.now()) {
    const d = now - ms; const m = Math.round(d / 60000);
    if (m < 1) return 'now'; if (m < 60) return m + 'm';
    const sameDay = M.startOfDay(ms) === M.startOfDay(now);
    if (sameDay) return timeLabel(ms);
    if (M.startOfDay(now) - M.startOfDay(ms) <= 864e5) return 'Yesterday';
    if (d < 6 * 864e5) return new Date(ms).toLocaleDateString([], { weekday: 'short' });
    return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  const relDay = (ms, now = Date.now()) => {
    const diff = Math.round((M.startOfDay(ms) - M.startOfDay(now)) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : dayLabel(ms);
  };

  // ───── avatars: initials on a colour from the name, swapped for the photo when Graph has one
  const AV = ['#ffb547', '#5ee0ff', '#7dff9b', '#ff8fb1', '#b9a2ff', '#ffd36b', '#6fb7ff', '#ff9f6b', '#9df0d0'];
  const hash = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); };
  const initials = (n) => String(n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  const photoCache = new Map();
  function avatar(person, o = {}) {
    const el = h('span.avatar' + (o.size ? '.' + o.size : ''));
    if (o.group) { el.classList.add('group'); el.textContent = String(o.count || '#'); }
    else { el.textContent = initials(person.name); el.style.setProperty('--av', AV[hash(person.name || person.id) % AV.length]); }
    if (person.id && !o.group && o.accountId) {
      const key = o.accountId + person.id;
      const set = (url) => { if (url) { el.style.backgroundImage = `url(${url})`; el.textContent = ''; } };
      if (photoCache.has(key)) { const v = photoCache.get(key); if (v && v.then) v.then(set); else set(v); }
      else { const p = C.call('photo', { accountId: o.accountId, userId: person.id }).catch(() => null); photoCache.set(key, p); p.then(v => { photoCache.set(key, v); set(v); }); }
    }
    if (o.presence) el.appendChild(h('b.pdot.p-' + o.presence));
    return el;
  }

  // ───── message HTML: Teams sends HTML; we keep a small safe subset
  const ALLOW = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'A', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'BLOCKQUOTE', 'SPAN', 'DIV', 'H1', 'H2', 'H3', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR', 'IMG', 'AT', 'EMOJI']);
  function safeHtml(html, o = {}) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstChild;
    const walk = (node) => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 3) continue;
        if (ch.nodeType !== 1) { ch.remove(); continue; }
        const tag = ch.tagName.toUpperCase();
        if (tag === 'ATTACHMENT' || tag === 'SYSTEMEVENTMESSAGE') { ch.remove(); continue; }
        if (!ALLOW.has(tag)) { walk(ch); ch.replaceWith(...ch.childNodes); continue; }
        const keep = {};
        if (tag === 'A') { const href = ch.getAttribute('href') || ''; if (/^(https?:|mailto:|msteams:)/i.test(href)) keep.href = href; }
        if (tag === 'IMG') {
          const src = ch.getAttribute('src') || '', alt = ch.getAttribute('alt') || '';
          if (ch.getAttribute('itemtype') && /emoji/i.test(ch.getAttribute('itemtype'))) { ch.replaceWith(doc.createTextNode(alt || '')); continue; }
          const img = doc.createElement('span'); img.className = 'img-slot'; img.dataset.src = src; img.textContent = alt || 'image';
          ch.replaceWith(img); continue;
        }
        if (tag === 'EMOJI') { ch.replaceWith(doc.createTextNode(ch.getAttribute('alt') || ch.textContent)); continue; }
        if (tag === 'AT') { const s = doc.createElement('span'); s.className = 'mention' + (o.meName && ch.textContent && o.meName.startsWith(ch.textContent.split(' ')[0]) ? ' me' : ''); s.textContent = '@' + ch.textContent; ch.replaceWith(s); continue; }
        const color = tag === 'SPAN' && /color:\s*(#[0-9a-f]{3,8}|rgb\([^)]+\))/i.exec(ch.getAttribute('style') || '');
        for (const a of [...ch.attributes]) ch.removeAttribute(a.name);
        for (const [k, v] of Object.entries(keep)) ch.setAttribute(k, v);
        if (color) ch.setAttribute('style', 'color:' + color[1]);
        if (tag === 'A') { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noreferrer'); }
        walk(ch);
      }
    };
    walk(root);
    return root.innerHTML;
  }
  /** Loads Graph-hosted images (they need the account's sign-in) into the slots safeHtml left. */
  function hydrateImages(el, accountId) {
    for (const slot of el.querySelectorAll('.img-slot')) {
      const src = slot.dataset.src;
      if (/^https:\/\/graph\.microsoft\.com\//i.test(src)) {
        slot.textContent = 'Loading image…';
        C.call('hosted', { accountId, url: src }).then(u => { const img = h('img', { src: u, loading: 'lazy' }); img.onclick = () => openImage(u); slot.replaceWith(img); }).catch(() => { slot.textContent = '[image]'; });
      } else if (/^data:image\//i.test(src)) { const img = h('img', { src }); slot.replaceWith(img); }
      else slot.textContent = '[image]';
    }
  }
  function openImage(src) { const m = modal({ cls: 'imgview' }); m.body.appendChild(h('img', { src })); }

  /** Composer text → Teams HTML. **bold**, *italic*, `code`, ```blocks```, > quotes, - lists, links. */
  function compose(text, mentions = []) {
    let s = esc(text.trim());
    s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.replace(/^\n/, '')}</code></pre>`);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2">$2</a>');
    mentions.forEach((m, i) => { s = s.replace(esc('@' + m.name), `<at id="${i}">${esc(m.name)}</at>`); });
    const lines = s.split('\n'); const out = []; let list = null;
    for (const ln of lines) {
      const li = /^\s*[-•]\s+(.*)$/.exec(ln);
      if (li) { if (!list) { list = []; } list.push(`<li>${li[1]}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
      const q = /^&gt;\s?(.*)$/.exec(ln);
      out.push(q ? `<blockquote>${q[1]}</blockquote>` : ln);
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    return `<p>${out.join('<br>').replace(/<br>(<\/?(ul|blockquote|pre))/g, '$1').replace(/(<\/(ul|blockquote|pre)>)<br>/g, '$1')}</p>`;
  }

  // ───── layers: modal, drawer, popover menu, toast
  function modal(o = {}) {
    const layer = $('#layer');
    const back = h('div.scrim');
    const box = h('div.modal' + (o.cls ? '.' + o.cls : ''), { role: 'dialog' });
    if (o.title) box.appendChild(h('header', h('div.title.led', o.title), h('div.grow'), h('button.btn.ghost.icon', { onclick: () => close(), html: ic('x') })));
    const body = h('div.mbody'); box.appendChild(body);
    const foot = h('footer'); if (o.foot !== false) box.appendChild(foot);
    back.appendChild(box); layer.appendChild(back);
    const close = () => { back.classList.add('out'); setTimeout(() => back.remove(), 140); document.removeEventListener('keydown', key, true); o.onclose && o.onclose(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    return { box, body, foot, close };
  }
  function menu(anchor, items, o = {}) {
    closeMenus();
    const m = h('div.menu');
    for (const it of items) {
      if (it === '-') { m.appendChild(h('div.sep')); continue; }
      if (it.label && it.header) { m.appendChild(h('div.mh', it.label)); continue; }
      const b = h('button' + (it.danger ? '.danger' : '') + (it.on ? '.on' : ''), { onclick: (e) => { e.stopPropagation(); closeMenus(); it.run && it.run(); } }, it.icon ? icon(it.icon) : (it.dot ? h('b.pdot.p-' + it.dot, { style: { position: 'static', border: 0 } }) : null), h('span', it.label), it.hint ? h('em', it.hint) : null);
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); const mr = m.getBoundingClientRect();
    let x = o.align === 'right' ? r.right - mr.width : r.left; let y = r.bottom + 6;
    if (o.up || y + mr.height > innerHeight - 10) y = r.top - mr.height - 6;
    x = Math.max(8, Math.min(innerWidth - mr.width - 8, x));
    m.style.left = x + 'px'; m.style.top = Math.max(8, y) + 'px';
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    function outside(e) { if (!m.contains(e.target)) closeMenus(); }
    m._off = () => document.removeEventListener('mousedown', outside, true);
    return m;
  }
  function closeMenus() { $$('.menu').forEach(m => { m._off && m._off(); m.remove(); }); }
  function toast(text, o = {}) {
    const t = h('div.toast' + (o.tone ? '.' + o.tone : ''), h('span', text), o.action ? h('button', { onclick: () => { o.action.run(); t.remove(); } }, o.action.label) : null);
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, o.ms || 3800);
  }
  async function run(p, okText) { try { const r = await p; if (okText) toast(okText); return r; } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, ''), { tone: 'red', ms: 6000 }); throw e; } }

  /** People picker (search through Graph's /me/people). Returns { el, get() }. */
  function peoplePicker(accountId, initial = []) {
    let picked = [...initial];
    const chips = h('div.chips');
    const input = h('input.input.bare', { placeholder: 'Add people by name or email' });
    const drop = h('div.pdrop');
    const wrap = h('div.picker', chips, input, drop);
    const draw = () => { chips.textContent = ''; for (const p of picked) chips.appendChild(h('span.chip', avatar({ name: p.name, id: p.id }, { size: 'sm', accountId }), h('span', p.name || p.email), h('button', { html: ic('x'), onclick: () => { picked = picked.filter(x => x.email !== p.email); draw(); } }))); chips.appendChild(input); };
    let t = null, sel = 0, list = [];
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 180); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (list[sel]) add(list[sel]); else if (/\S+@\S+\.\S+/.test(input.value)) add({ email: input.value.trim(), name: input.value.trim() }); }
      else if (e.key === 'Backspace' && !input.value && picked.length) { picked.pop(); draw(); input.focus(); }
    });
    input.addEventListener('blur', () => setTimeout(() => drop.classList.remove('on'), 150));
    async function search() {
      const q = input.value.trim(); if (!q) { drop.classList.remove('on'); return; }
      try { list = (await C.call('people', { accountId, q })).filter(p => !picked.some(x => x.email === p.email)); } catch (_) { list = []; }
      if (!list.length && /\S+@\S+\.\S+/.test(q)) list = [{ email: q, name: q }];
      sel = 0; paint();
    }
    function paint() { drop.textContent = ''; list.forEach((p, i) => drop.appendChild(h('button' + (i === sel ? '.on' : ''), { onmousedown: (e) => { e.preventDefault(); add(p); } }, avatar({ name: p.name, id: p.id }, { size: 'sm', accountId }), h('span', h('b', p.name), h('em', p.email + (p.title ? ' · ' + p.title : '')))))); drop.classList.toggle('on', list.length > 0); }
    function add(p) { picked.push(p); input.value = ''; list = []; drop.classList.remove('on'); draw(); input.focus(); }
    draw();
    return { el: wrap, get: () => picked, focus: () => input.focus() };
  }

  window.S = { views: {} };
  Object.assign(window, { $, $$, h, icon, esc, pad, hm, timeLabel, dayLabel, boardDate, ago, relDay, avatar, initials, safeHtml, hydrateImages, compose, modal, menu, closeMenus, toast, run, peoplePicker, M, C, h12 });
})();

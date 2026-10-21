// Docket — small DOM helpers, icons and formatting shared by the window and the bar.
(function () {
  'use strict';
  // h('div.cls#id', {attrs, on: {click}}, ...children)
  function h(sel, props, ...kids) {
    if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
    const el = document.createElement(m[1] || 'div');
    for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' || k === 'textContent' || k === 'placeholder' || k === 'title') el[k] = v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }

  const P = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    home: '<path d="M4 6.5h16M4 12h10M4 17.5h13"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    ask: '<path d="M4 5.5h16v10H9l-5 4z"/><path d="M9.5 9.2a2.5 2.5 0 0 1 4.8 1c0 1.6-2.3 1.8-2.3 3"/><path d="M12 15.6v.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>',
    more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    export: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    send: '<path d="M4.5 12L20 4.5 13 20l-2.2-6.3z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4v5h-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    note: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 12.5h7M9 16h5"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    shield: '<path d="M12 3.5l7 3v5.5c0 4.2-3 7.5-7 8.5-4-1-7-4.3-7-8.5V6.5z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    expand: '<path d="M14.5 4.5h5v5M19.5 4.5l-6 6M9.5 19.5h-5v-5M4.5 19.5l6-6"/>',
    chev: '<path d="M9 6l6 6-6 6"/>'
  };
  function icon(name, size = 16, cls = '') {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('class', 'ic ' + cls); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = P[name] || '';
    return s;
  }

  let toastTimer = null;
  function toast(msg, opts = {}) {
    const el = document.getElementById('toast'); if (!el) return;
    el.innerHTML = '';
    el.append(h('span', msg));
    if (opts.action) el.append(h('button.toast-act', { on: { click: () => { el.classList.remove('show'); opts.action.fn(); } } }, opts.action.label));
    el.classList.toggle('bad', !!opts.bad);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), opts.ms || (opts.action ? 7000 : 3200));
  }

  const clock = (s) => window.DT.clock(s);
  const dur = (ms) => {
    const m = Math.round((ms || 0) / 60000);
    if (m < 1) return ms > 0 ? '<1 min' : '';
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '');
  };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, y)) return 'Yesterday';
    if (now - d < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'long' });
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }
  const timeOf = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateLong = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  function dueLabel(due) {
    if (!due) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      const d = new Date(due + 'T12:00:00'), now = new Date(), t = new Date(now); t.setDate(now.getDate() + 1);
      if (sameDay(d, now)) return 'Today';
      if (sameDay(d, t)) return 'Tomorrow';
      return d.toLocaleDateString('en-US', { weekday: Math.abs(d - now) < 6 * 864e5 ? 'short' : undefined, month: 'short', day: 'numeric' });
    }
    return due;
  }
  const overdue = (due) => /^\d{4}-\d{2}-\d{2}$/.test(due || '') && new Date(due + 'T23:59:59') < new Date();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const greet = () => { const hr = new Date().getHours(); return hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; };
  const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1) + ' MB';

  window.U = { h, add, icon, toast, clock, dur, dayLabel, timeOf, dateLong, dueLabel, overdue, debounce, greet, mb, sameDay };
})();

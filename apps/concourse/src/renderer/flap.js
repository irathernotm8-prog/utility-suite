// Concourse — split-flap text. flap(el, text, { len, tone }) fills el with flap cells and, when the text changes,
// rolls each changed cell through a few letters before it settles, like a station board.
(() => {
  const ROLL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.flapAnimate = (on) => { animate = on && !matchMedia('(prefers-reduced-motion: reduce)').matches; };

  function flap(el, text, o = {}) {
    text = String(text == null ? '' : text).toUpperCase();
    if (o.len) text = text.length > o.len ? text.slice(0, o.len) : text.padEnd(o.len, ' ');
    el.classList.add('flap');
    for (const t of ['green', 'cyan', 'red', 'dim', 'white']) el.classList.toggle(t, o.tone === t);
    let cells = [...el.children].filter(c => c.classList.contains('c'));
    if (cells.length !== text.length) {
      el.textContent = '';
      cells = [...text].map(() => { const c = document.createElement('span'); c.className = 'c'; el.appendChild(c); return c; });
      el._t = ' '.repeat(text.length);
    }
    const prev = el._t || '';
    el._t = text;
    el.setAttribute('aria-label', text.trim());
    [...text].forEach((ch, i) => {
      const c = cells[i];
      c.classList.toggle('sp', ch === ' ');
      if (!animate || o.instant || prev[i] === ch || !el.isConnected) { c.textContent = ch === ' ' ? '' : ch; return; }
      const steps = 2 + Math.floor(Math.random() * 4);
      let k = 0; clearTimeout(c._tm);
      const tick = () => {
        c.classList.remove('f'); void c.offsetWidth; c.classList.add('f');
        if (k++ >= steps) { c.textContent = ch === ' ' ? '' : ch; return; }
        c.textContent = ROLL[Math.floor(Math.random() * ROLL.length)];
        c._tm = setTimeout(tick, 55 + i * 4);
      };
      c._tm = setTimeout(tick, i * 18);
    });
    return el;
  }
  /** A clock "14:05" with a blinking colon. */
  function flapClock(el, ms, o = {}) {
    const d = new Date(ms);
    const h = o.h12 ? ((d.getHours() + 11) % 12) + 1 : d.getHours();
    const hh = o.h12 ? String(h).padStart(2, ' ') : String(h).padStart(2, '0');
    return flap(el, `${hh}:${String(d.getMinutes()).padStart(2, '0')}`, o);
  }
  window.flap = flap; window.flapClock = flapClock;
  window.makeFlap = (text, o = {}) => { const s = document.createElement('span'); flap(s, text, { ...o, instant: o.instant !== false }); return s; };
})();

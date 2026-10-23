// LayoutCanvas — draws displays as they're arranged, with windows as boxes you can drag, resize and snap.
// Window positions are fractions of a display's work area, so the drawing works at any size and any resolution.
'use strict';
(function () {
  const SNAPS = [0, 1 / 3, 0.5, 2 / 3, 1];
  const MIN = 0.08;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  class LayoutCanvas {
    constructor(el, opts = {}) {
      this.el = el; this.opts = opts; this.displays = []; this.items = []; this.selected = null; this.dragging = false;
      this.el.classList.toggle('mini', !!opts.mini);
      if (opts.editable) this.el.addEventListener('pointerdown', (e) => this.down(e));
      if (opts.editable) this.el.addEventListener('dblclick', (e) => { const w = e.target.closest('.win'); if (w && opts.onChange) { const it = this.item(w.dataset.id); opts.onChange(it.id, { state: it.state === 'maximized' || it.state === 'fullscreen' ? 'normal' : 'maximized', frac: it.state === 'maximized' ? (it.frac.w > 0.97 && it.frac.h > 0.97 ? { x: 0.1, y: 0.08, w: 0.8, h: 0.84 } : it.frac) : it.frac }); } });
      if (!opts.mini && window.ResizeObserver) new ResizeObserver(() => { if (!this.dragging) this.render(); }).observe(el);
    }
    item(id) { return this.items.find((i) => i.id === id); }
    set({ displays, items, selected }) {
      if (displays) this.displays = displays; if (items) this.items = items; if (selected !== undefined) this.selected = selected;
      if (!this.dragging) this.render();
    }
    geom() {
      const W = this.el.clientWidth, H = this.el.clientHeight; const ds = this.displays;
      if (!ds.length || !W || !H) return null;
      const ux = Math.min(...ds.map((d) => d.bounds.x)), uy = Math.min(...ds.map((d) => d.bounds.y));
      const uw = Math.max(...ds.map((d) => d.bounds.x + d.bounds.width)) - ux, uh = Math.max(...ds.map((d) => d.bounds.y + d.bounds.height)) - uy;
      const lab = this.opts.mini ? 0 : 26;
      const s = Math.min(W / uw, (H - lab) / uh);
      const ox = (W - uw * s) / 2, oy = (H - lab - uh * s) / 2;
      return { s, ux, uy, ox, oy };
    }
    render() {
      const g = this.geom(); this.el.innerHTML = ''; if (!g) return;
      const gap = this.opts.mini ? 2 : 4;
      this.dispEls = {};
      for (const d of this.displays) {
        const b = d.bounds, wa = d.workArea;
        const de = document.createElement('div'); de.className = 'disp'; de.dataset.id = d.id;
        const L = (b.x - g.ux) * g.s + g.ox + gap / 2, T = (b.y - g.uy) * g.s + g.oy + gap / 2;
        Object.assign(de.style, { left: L + 'px', top: T + 'px', width: b.width * g.s - gap + 'px', height: b.height * g.s - gap + 'px' });
        const top = (wa.y - b.y) * g.s; const bottomInset = (b.y + b.height - wa.y - wa.height) * g.s;
        if (top > 1) { const mb = document.createElement('div'); mb.className = 'menubar'; mb.style.height = Math.max(2, top) + 'px'; de.appendChild(mb); }
        const we = document.createElement('div'); we.className = 'wa';
        Object.assign(we.style, { left: (wa.x - b.x) * g.s + 'px', top: top + 'px', width: wa.width * g.s - gap + 'px', height: Math.max(10, wa.height * g.s - gap - Math.max(0, bottomInset - gap) * 0) + 'px' });
        de.appendChild(we);
        if (!this.opts.mini) {
          const lb = document.createElement('div'); lb.className = 'dlab';
          lb.innerHTML = `${d.primary ? '<span class="star">●</span>' : ''}<b>${esc(d.label)}</b><span>${b.width}×${b.height}${d.missing ? ' · not connected' : ''}</span>`;
          de.appendChild(lb);
        }
        if (d.missing) de.style.opacity = '.45';
        this.el.appendChild(de); this.dispEls[d.id] = { de, we };
      }
      for (const it of this.items) {
        const host = this.dispEls[it.display] || Object.values(this.dispEls)[0]; if (!host) continue;
        host.we.appendChild(this.winEl(it));
      }
    }
    winEl(it) {
      const e = document.createElement('div');
      e.className = 'win' + (it.id === this.selected ? ' sel' : '') + (it.state === 'minimized' ? ' min' : '') + (it.ghost ? ' ghost' : '') + (it.hidden ? ' hid' : '');
      e.dataset.id = it.id; e.style.setProperty('--ac', it.color || '#888');
      this.place(e, it);
      const icon = it.icon ? `<img class="appic" src="${esc(it.icon)}">` : `<span class="appic ph" style="--ac:${esc(it.color || '#888')}">${esc(it.initials || '')}</span>`;
      const st = it.state === 'maximized' ? 'Fills screen' : it.state === 'fullscreen' ? 'Full screen' : it.state === 'minimized' ? 'Minimised' : '';
      e.innerHTML = `<div class="wbar"><span>${esc(it.label)}</span></div><div class="wbody">${icon}</div>${it.title ? `<div class="wt">${esc(it.title)}</div>` : ''}${st ? `<div class="st">${st}</div>` : ''}`;
      if (this.opts.editable && it.id === this.selected && it.state !== 'maximized' && it.state !== 'fullscreen' && !it.locked) {
        for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) { const h = document.createElement('div'); h.className = 'hd ' + d; h.dataset.dir = d; e.appendChild(h); }
      }
      e.title = it.title ? `${it.label} — ${it.title}` : it.label;
      return e;
    }
    place(e, it) {
      const full = it.state === 'maximized' || it.state === 'fullscreen';
      const f = full ? { x: 0, y: 0, w: 1, h: 1 } : it.frac;
      Object.assign(e.style, { left: f.x * 100 + '%', top: f.y * 100 + '%', width: f.w * 100 + '%', height: f.h * 100 + '%' });
    }
    // ---------------------------------------------------------------- dragging
    waAt(x, y) {
      for (const [id, { we }] of Object.entries(this.dispEls || {})) { const r = we.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id, we, r }; }
      return null;
    }
    down(e) {
      if (e.button !== 0) return;
      const we = e.target.closest('.win'); if (!we) { if (this.opts.onSelect && e.target === this.el) this.opts.onSelect(null); return; }
      const it = this.item(we.dataset.id); if (!it || it.locked) { if (it && this.opts.onSelect) this.opts.onSelect(it.id); return; }
      const dir = e.target.dataset.dir || null;
      const host = this.dispEls[it.display]; const r0 = host.we.getBoundingClientRect(); const wr = we.getBoundingClientRect();
      const st = { x: e.clientX, y: e.clientY, frac: { ...(it.state === 'maximized' || it.state === 'fullscreen' ? { x: 0, y: 0, w: 1, h: 1 } : it.frac) }, display: it.display, gx: (e.clientX - wr.left) / wr.width, gy: (e.clientY - wr.top) / wr.height, moved: false };
      let cur = { display: it.display, frac: { ...st.frac }, state: it.state };
      const guides = [];
      const clearGuides = () => { while (guides.length) guides.pop().remove(); };
      const guide = (we2, kind, v) => { const g = document.createElement('div'); g.className = 'guide ' + kind; if (kind === 'v') Object.assign(g.style, { left: v * 100 + '%', top: 0, bottom: 0 }); else Object.assign(g.style, { top: v * 100 + '%', left: 0, right: 0 }); we2.appendChild(g); guides.push(g); };
      const snap = (v, px) => { const t = 7 / px; for (const s of SNAPS) if (Math.abs(v - s) < t) return { v: s, hit: s }; return { v, hit: null }; };
      we.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!st.moved && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < 3) return;
        if (!st.moved) { st.moved = true; this.dragging = true; if (this.opts.onSelect && this.selected !== it.id) { this.selected = it.id; we.classList.add('sel'); } }
        clearGuides();
        if (!dir) {
          const tgt = this.waAt(ev.clientX, ev.clientY) || { id: cur.display, we: this.dispEls[cur.display].we, r: this.dispEls[cur.display].we.getBoundingClientRect() };
          let f = { ...st.frac };
          if (it.state === 'maximized' || it.state === 'fullscreen') { f = { x: 0, y: 0, w: 0.6, h: 0.7 }; st.gx = 0.5; st.gy = 0.05; }
          f.x = (ev.clientX - tgt.r.left) / tgt.r.width - st.gx * f.w; f.y = (ev.clientY - tgt.r.top) / tgt.r.height - st.gy * f.h;
          const sx = snap(f.x, tgt.r.width), sx2 = snap(f.x + f.w, tgt.r.width);
          if (sx.hit != null) f.x = sx.v; else if (sx2.hit != null) f.x = sx2.v - f.w;
          const sy = snap(f.y, tgt.r.height), sy2 = snap(f.y + f.h, tgt.r.height);
          if (sy.hit != null) f.y = sy.v; else if (sy2.hit != null) f.y = sy2.v - f.h;
          f.x = clamp(f.x, 0, 1 - f.w); f.y = clamp(f.y, 0, 1 - f.h);
          for (const s of SNAPS) { if (Math.abs(f.x - s) < 1e-6 || Math.abs(f.x + f.w - s) < 1e-6) guide(tgt.we, 'v', s); if (Math.abs(f.y - s) < 1e-6 || Math.abs(f.y + f.h - s) < 1e-6) guide(tgt.we, 'h', s); }
          if (tgt.id !== cur.display) { tgt.we.appendChild(we); for (const k of Object.keys(this.dispEls)) this.dispEls[k].de.classList.toggle('drop', k === tgt.id); }
          cur = { display: tgt.id, frac: f, state: it.state === 'minimized' ? 'minimized' : 'normal' };
        } else {
          const dx = (ev.clientX - st.x) / r0.width, dy = (ev.clientY - st.y) / r0.height; const f = { ...st.frac };
          if (dir.includes('e')) { let r = snap(st.frac.x + st.frac.w + dx, r0.width).v; r = clamp(r, f.x + MIN, 1); f.w = r - f.x; }
          if (dir.includes('w')) { let l = snap(st.frac.x + dx, r0.width).v; l = clamp(l, 0, st.frac.x + st.frac.w - MIN); f.w = st.frac.x + st.frac.w - l; f.x = l; }
          if (dir.includes('s')) { let b = snap(st.frac.y + st.frac.h + dy, r0.height).v; b = clamp(b, f.y + MIN, 1); f.h = b - f.y; }
          if (dir.includes('n')) { let t = snap(st.frac.y + dy, r0.height).v; t = clamp(t, 0, st.frac.y + st.frac.h - MIN); f.h = st.frac.y + st.frac.h - t; f.y = t; }
          cur = { display: it.display, frac: f, state: 'normal' };
        }
        this.place(we, { frac: cur.frac, state: cur.state === 'minimized' ? 'minimized' : 'normal' });
      };
      const up = () => {
        we.removeEventListener('pointermove', move); we.removeEventListener('pointerup', up); we.removeEventListener('pointercancel', up);
        clearGuides(); for (const k of Object.keys(this.dispEls || {})) this.dispEls[k].de.classList.remove('drop');
        this.dragging = false;
        const r4 = (f) => ({ x: +f.x.toFixed(4), y: +f.y.toFixed(4), w: +f.w.toFixed(4), h: +f.h.toFixed(4) });
        if (st.moved && this.opts.onChange) this.opts.onChange(it.id, { display: cur.display, frac: r4(cur.frac), state: cur.state });
        else if (!st.moved && this.opts.onSelect) this.opts.onSelect(it.id);
        else this.render();
      };
      we.addEventListener('pointermove', move); we.addEventListener('pointerup', up); we.addEventListener('pointercancel', up);
    }
  }
  window.LayoutCanvas = LayoutCanvas;
})();

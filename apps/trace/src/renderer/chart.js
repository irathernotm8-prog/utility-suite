// Trace — the chart editor: nodes and connections on an infinite canvas, automatic vertical/horizontal layout,
// a smooth camera, trace mode (walk a path with the camera following), scenarios, and "where does this file go?".
(function () {
  const T = window.T;
  const L = () => T.layout;
  const TYPES = () => T.NODE_TYPES;
  const MIN_K = 0.12, MAX_K = 2.6;
  const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

  class ChartView {
    constructor(host, { app, item, mode = 'edit', onExit }) {
      this.app = app; this.c = item; this.mode = mode; this.onExit = onExit;
      this.pos = new Map(); this.els = new Map(); this.edgeEls = new Map(); this.keys = new Map();
      this.sel = new Set(); this.selEdge = null;
      this.cam = { x: 0, y: 0, k: 1 };
      this.trace = null; this.anim = null; this.camAnim = null;
      this.hl = null; // scenario highlight
      this.build(host);
      this.render({ fit: true });
    }
    get pid() { return this.app.project.id; }
    get V() { return this.c.orientation !== 'horizontal'; }
    get present() { return this.mode === 'present'; }
    node(id) { return this.c.nodes.find((n) => n.id === id); }
    edge(id) { return this.c.edges.find((e) => e.id === id); }

    // ---------------------------------------------------------------- DOM
    build(host) {
      const ed = !this.present;
      this.root = T.el(`<div class="chart-view ${this.present ? 'presenting' : ''}">
        <div class="cv-main">
          ${ed ? `<div class="cv-bar">
            <input class="cv-title" spellcheck="false" value="${T.esc(this.c.title)}" aria-label="Chart name">
            <div class="seg orient" title="Orientation (O)">
              <button class="icon-btn" data-o="vertical" title="Vertical">${T.icon('vertical', 17)}</button>
              <button class="icon-btn" data-o="horizontal" title="Horizontal">${T.icon('horizontal', 17)}</button>
            </div>
            <button class="btn ghost sm" data-act="add">${T.icon('plus')}Add<span class="caret">${T.icon('chevdown', 12)}</span></button>
            <button class="icon-btn" data-act="tidy" title="Tidy up">${T.icon('tidy', 17)}</button>
            <div class="grow"></div>
            <div class="seg"><button class="icon-btn" data-act="undo" title="Undo ${T.kbd('Mod+Z')}">${T.icon('undo', 17)}</button><button class="icon-btn" data-act="redo" title="Redo">${T.icon('redo', 17)}</button></div>
            <button class="btn ghost sm accent" data-act="trace" title="Trace a path (T)">${T.icon('trace')}Trace</button>
            <button class="btn ghost sm" data-act="present" title="Present ${T.kbd('Mod+Enter')}">${T.icon('present')}Present</button>
            <button class="icon-btn" data-act="export" title="Export PDF ${T.kbd('Mod+E')}">${T.icon('pdf', 17)}</button>
            <button class="icon-btn" data-act="inspector" title="Show or hide the panel">${T.icon('panel', 17)}</button>
          </div>` : ''}
          <div class="canvas" tabindex="0">
            <div class="world"><svg class="edges"><defs>
              <marker id="arw" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0.5,1 L9,5 L0.5,9 Q2.5,5 0.5,1z" class="arw"/></marker>
              <marker id="arw-on" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0.5,1 L9,5 L0.5,9 Q2.5,5 0.5,1z" class="arw-on"/></marker>
              <linearGradient id="tg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="600" y2="600"><stop offset="0" stop-color="#b393ff"/><stop offset="1" stop-color="#4fd8ff"/></linearGradient>
            </defs><g class="e-base"></g><g class="e-trace"></g><path class="e-temp" d=""/></svg><div class="labels"></div><div class="nodes"></div></div>
            <div class="marquee" hidden></div>
            ${ed ? `<div class="findfile" hidden>${T.icon('search', 15)}<input placeholder="Where does a file go? e.g. invoice-may.pdf" spellcheck="false"><div class="ff-res"></div></div>` : ''}
            <div class="zoombar"><button class="icon-btn" data-z="out" title="Zoom out (-)">${T.icon('minus', 15)}</button><button class="zpct" data-z="100" title="Actual size (1)">100%</button><button class="icon-btn" data-z="in" title="Zoom in (+)">${T.icon('plus', 15)}</button><button class="icon-btn" data-z="fit" title="Fit (F)">${T.icon('fit', 15)}</button></div>
            <div class="minimap"><svg></svg></div>
            <div class="hud" hidden></div>
            <div class="empty-hint" hidden><div>${T.icon('chart', 28)}</div><p>Double-click anywhere to add a step</p></div>
          </div>
        </div>
        ${ed ? '<aside class="inspector"></aside>' : ''}
      </div>`);
      host.appendChild(this.root);
      this.canvas = T.$('.canvas', this.root);
      this.world = T.$('.world', this.root);
      this.nodesEl = T.$('.nodes', this.root);
      this.labelsEl = T.$('.labels', this.root);
      this.eBase = T.$('.e-base', this.root);
      this.eTrace = T.$('.e-trace', this.root);
      this.eTemp = T.$('.e-temp', this.root);
      this.hud = T.$('.hud', this.root);
      this.insp = T.$('.inspector', this.root);
      if (this.insp) this.root.classList.toggle('no-insp', this.app.settings.inspector === false);
      this.bindCanvas();
      if (ed) this.bindBar();
      this.ro = new ResizeObserver(() => { this.applyCam(); });
      this.ro.observe(this.canvas);
      this.renderInspector();
    }
    destroy() { this.stopAuto(); this.ro.disconnect(); if (this.anim) this.anim.stop(); if (this.camAnim) this.camAnim.stop(); this.root.remove(); }

    // ---------------------------------------------------------------- mutations
    mut(fn, key, opts = {}) {
      this.app.mutate(this.c, () => fn(this.c), key);
      if (opts.render !== false) this.render({ animate: opts.animate !== false });
      if (opts.inspector) this.renderInspector();
    }
    reload(item) {
      if (item) this.c = item;
      this.sel = new Set([...this.sel].filter((id) => this.node(id)));
      if (this.selEdge && !this.edge(this.selEdge)) this.selEdge = null;
      const t = T.$('.cv-title', this.root); if (t && document.activeElement !== t) t.value = this.c.title;
      this.render({ animate: true });
      this.renderInspector();
    }

    // ---------------------------------------------------------------- visibility (collapsed branches)
    visible() {
      const ids = new Set(this.c.nodes.map((n) => n.id));
      const out = new Map(), inc = new Map();
      for (const e of this.c.edges) {
        if (!ids.has(e.from) || !ids.has(e.to)) continue;
        if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to);
        if (!inc.has(e.to)) inc.set(e.to, []); inc.get(e.to).push(e.from);
      }
      const ignore = !!this.trace;
      const collapsed = new Set(ignore ? [] : this.c.nodes.filter((n) => n.collapsed).map((n) => n.id));
      if (!collapsed.size) return { vis: ids, hiddenUnder: new Map(), out, inc };
      const seen = new Set();
      const q = this.c.nodes.filter((n) => !(inc.get(n.id) || []).length).map((n) => n.id);
      q.forEach((id) => seen.add(id));
      while (q.length) { const id = q.shift(); if (collapsed.has(id)) continue; for (const t of out.get(id) || []) if (!seen.has(t)) { seen.add(t); q.push(t); } }
      const under = new Set(); const q2 = [];
      collapsed.forEach((id) => (out.get(id) || []).forEach((t) => q2.push(t)));
      while (q2.length) { const id = q2.shift(); if (under.has(id)) continue; under.add(id); (out.get(id) || []).forEach((t) => q2.push(t)); }
      const vis = new Set([...ids].filter((id) => seen.has(id) || !under.has(id)));
      const hiddenUnder = new Map();
      for (const id of collapsed) {
        let n = 0; const st = [...(out.get(id) || [])], s = new Set();
        while (st.length) { const x = st.pop(); if (s.has(x) || vis.has(x)) continue; s.add(x); n++; (out.get(x) || []).forEach((t) => st.push(t)); }
        hiddenUnder.set(id, n);
      }
      return { vis, hiddenUnder, out, inc };
    }

    // ---------------------------------------------------------------- node markup
    nodeColor(n) { return T.colorOf(n.color || (TYPES()[n.type] || {}).color); }
    nodeInner(n, hidden) {
      const t = TYPES()[n.type] || TYPES().step;
      const title = T.esc(n.title || '') || `<span class="ph">${n.type === 'decision' ? 'Ask a question…' : n.type === 'person' ? 'Name' : 'Untitled'}</span>`;
      const badges = [];
      if (n.note && T.textOf(n.note)) badges.push(`<span class="b" title="Has a note">${T.icon('note', 12)}</span>`);
      if (n.images && n.images.length && n.type !== 'image' && n.type !== 'person') badges.push(`<span class="b" title="${n.images.length} image(s)">${T.icon('image', 12)}${n.images.length > 1 ? n.images.length : ''}</span>`);
      if (n.link) badges.push(`<span class="b" title="${T.esc(n.link)}">${T.icon('link', 12)}</span>`);
      if (hidden) badges.push(`<span class="b more" title="Collapsed: ${hidden} hidden">+${hidden}</span>`);
      const bd = badges.length ? `<div class="n-badges">${badges.join('')}</div>` : '';
      const port = this.present ? '' : '<div class="n-port" title="Click to add the next step, drag to connect"></div>';
      if (n.type === 'and' || n.type === 'or') return `<div class="gate">${T.esc(n.title || n.type.toUpperCase())}</div>${bd}${port}`;
      if (n.type === 'person') {
        const m = n.images && n.images[0] && this.app.media.get(n.images[0]);
        const av = m ? `<img src="${T.mediaUrl(this.pid, m.file)}" alt="">` : initials(n.title);
        return `<div class="avatar">${av}</div><div class="n-text"><div class="n-title">${title}</div>${n.sub ? `<div class="n-sub">${T.esc(n.sub)}</div>` : ''}</div>${bd}${port}`;
      }
      if (n.type === 'image') {
        const m = n.images && n.images[0] && this.app.media.get(n.images[0]);
        const pic = m ? T.annot.svg(m, T.mediaUrl(this.pid, m.file), { cls: 'n-pic' }) : `<div class="n-pic empty">${T.icon('image', 22)}<span>Add a screenshot</span></div>`;
        return `${pic}<div class="n-text"><div class="n-title">${title}</div>${n.sub ? `<div class="n-sub">${T.esc(n.sub)}</div>` : ''}</div>${bd}${port}`;
      }
      if (n.type === 'note') {
        const txt = T.textOf(n.note || '');
        return `<div class="n-title">${title}</div>${txt ? `<div class="n-notetext">${T.esc(txt.slice(0, 220))}${txt.length > 220 ? '…' : ''}</div>` : ''}${bd}${port}`;
      }
      const chips = [];
      if ((n.type === 'folder' || n.type === 'file') && n.rules && n.rules.length) chips.push(...n.rules.slice(0, 8).map((r) => `<span class="chip">${T.esc(r)}</span>`), n.rules.length > 8 ? `<span class="chip mute">+${n.rules.length - 8}</span>` : '');
      else if (n.stats && n.stats.length) chips.push(...n.stats.slice(0, 4).map(([x, c]) => `<span class="chip mute">${T.esc(x)} <b>${c}</b></span>`));
      return `<div class="n-head"><span class="n-ic">${T.icon(t.icon, 15)}</span><div class="n-text">${n.type === 'decision' ? '<div class="n-kicker">If</div>' : ''}<div class="n-title">${title}</div>${n.sub ? `<div class="n-sub">${T.esc(n.sub)}</div>` : ''}</div></div>${chips.length ? `<div class="n-chips">${chips.join('')}</div>` : ''}${bd}${port}`;
    }
    nodeKey(n, hidden) {
      const imgs = (n.images || []).map((id) => { const m = this.app.media.get(id); return m ? id + (m.annotations || []).length + JSON.stringify(m.crop) : id; }).join();
      return [n.type, n.title, n.sub, n.color, n.note ? T.textOf(n.note).length : 0, imgs, n.link, (n.rules || []).join(), JSON.stringify(n.stats || ''), hidden, this.V].join('|');
    }

    // ---------------------------------------------------------------- render
    render(opts = {}) {
      const { vis, hiddenUnder } = this.visible();
      this.vis = vis;
      // 1. create/update node elements
      for (const [id, el] of this.els) if (!vis.has(id) || !this.node(id)) { el.remove(); this.els.delete(id); this.keys.delete(id); }
      const fresh = [];
      for (const n of this.c.nodes) {
        if (!vis.has(n.id)) continue;
        let el = this.els.get(n.id);
        const hidden = hiddenUnder.get(n.id) || 0;
        const key = this.nodeKey(n, hidden);
        if (!el) {
          el = document.createElement('div');
          el.dataset.id = n.id;
          this.nodesEl.appendChild(el);
          this.els.set(n.id, el);
          fresh.push(n.id);
        }
        el.className = `node t-${n.type}` + (this.sel.has(n.id) ? ' sel' : '') + (n.collapsed && hidden ? ' collapsed' : '') + (this.V ? ' v' : ' h');
        el.style.setProperty('--c', this.nodeColor(n));
        if (this.keys.get(n.id) !== key) { el.innerHTML = this.nodeInner(n, hidden); this.keys.set(n.id, key); }
      }
      // 2. measure
      const sizes = new Map();
      for (const [id, el] of this.els) sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
      // 3. positions
      const target = new Map();
      const visNodes = this.c.nodes.filter((n) => vis.has(n.id));
      const visEdges = this.c.edges.filter((e) => vis.has(e.from) && vis.has(e.to));
      const sp = this.c.spacing || 1;
      this.gaps = { rankGap: Math.round((this.V ? 72 : 96) * sp), siblingGap: Math.round((this.V ? 26 : 22) * sp), rootGap: Math.round(80 * sp) };
      let lay = null;
      if (this.c.layout !== 'free') {
        lay = L().layout(visNodes.map((n) => ({ id: n.id, ...sizes.get(n.id) })), visEdges, { orientation: this.c.orientation, ...this.gaps });
        for (const n of visNodes) { const p = lay.pos.get(n.id); target.set(n.id, { x: p.x, y: p.y, ...sizes.get(n.id) }); n.x = p.x; n.y = p.y; }
      } else {
        for (const n of visNodes) {
          if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) this.placeFree(n, sizes);
          target.set(n.id, { x: n.x, y: n.y, ...sizes.get(n.id) });
        }
      }
      this.lay = lay;
      this.visEdges = visEdges;
      // 4. animate from old positions
      if (this.anim) this.anim.stop();
      const from = new Map();
      for (const [id, p] of target) {
        const old = this.pos.get(id);
        if (old) from.set(id, old);
        else {
          // new nodes grow out of their parent
          const pe = this.c.edges.find((e) => e.to === id && this.pos.has(e.from));
          const pp = pe && this.pos.get(pe.from);
          from.set(id, pp ? { x: pp.x + (pp.w - p.w) / 2, y: pp.y + (pp.h - p.h) / 2, w: p.w, h: p.h, fresh: true } : { ...p, fresh: true });
        }
      }
      const finish = () => { this.pos = target; this.place(target, 1, from); this.anim = null; this.drawMinimap(); };
      const moving = opts.animate && [...target].some(([id, p]) => { const f = from.get(id); return f && (Math.abs(f.x - p.x) > 0.5 || Math.abs(f.y - p.y) > 0.5); });
      if (moving) {
        this.world.classList.add('moving');
        this.anim = T.animate(380, (e) => {
          const cur = new Map();
          for (const [id, p] of target) { const f = from.get(id); cur.set(id, { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e, w: p.w, h: p.h }); }
          this.pos = cur; this.place(cur, e, from);
        }, () => { this.world.classList.remove('moving'); finish(); });
      } else finish();
      const empty = T.$('.empty-hint', this.root); if (empty) empty.hidden = this.c.nodes.length > 0;
      const ff = T.$('.findfile', this.root); if (ff) ff.hidden = !this.c.nodes.some((n) => (n.rules || []).length);
      T.$$('[data-o]', this.root).forEach((b) => b.classList.toggle('on', b.dataset.o === (this.V ? 'vertical' : 'horizontal')));
      if (this.trace) this.applyTrace();
      else if (this.hl) this.applyHighlight();
      if (opts.fit) requestAnimationFrame(() => this.fit(false));
    }
    placeFree(n, sizes) {
      const pe = this.c.edges.find((e) => e.to === n.id && this.node(e.from) && Number.isFinite(this.node(e.from).x));
      if (pe) {
        const p = this.node(pe.from), ps = sizes.get(p.id) || { w: 160, h: 60 };
        const sibs = this.c.edges.filter((e) => e.from === p.id).map((e) => e.to);
        const i = sibs.indexOf(n.id);
        if (this.V) { n.x = Math.round(p.x + (i - (sibs.length - 1) / 2) * 200); n.y = Math.round(p.y + ps.h + 90); }
        else { n.x = Math.round(p.x + ps.w + 110); n.y = Math.round(p.y + (i - (sibs.length - 1) / 2) * 100); }
      } else {
        const r = this.canvas.getBoundingClientRect();
        const c = this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
        n.x = Math.round(c.x - 80); n.y = Math.round(c.y - 30);
      }
    }
    place(P, e, from) {
      for (const [id, p] of P) {
        const el = this.els.get(id); if (!el) continue;
        el.style.transform = `translate(${p.x}px,${p.y}px)`;
        const f = from && from.get(id);
        el.style.opacity = f && f.fresh && e < 1 ? String(0.2 + 0.8 * e) : '';
      }
      this.drawEdges(P);
    }
    edgeStyle() { return this.c.edgeStyle || 'elbow'; }
    drawEdges(P) {
      const seen = new Set();
      const stacked = this.lay ? this.lay.stacked : new Set();
      for (const e of this.visEdges || []) {
        const a = P.get(e.from), b = P.get(e.to);
        if (!a || !b) continue;
        seen.add(e.id);
        const stackedFrom = stacked.has(e.from) && this.lay && this.lay.parent.get(e.to) === e.from && this.c.layout !== 'free';
        const r = L().route(a, b, { orientation: this.c.orientation, style: this.edgeStyle(), rankGap: this.gaps.rankGap, stackedFrom });
        let g = this.edgeEls.get(e.id);
        if (!g) {
          g = { hit: document.createElementNS('http://www.w3.org/2000/svg', 'path'), path: document.createElementNS('http://www.w3.org/2000/svg', 'path'), label: document.createElement('div') };
          g.hit.setAttribute('class', 'edge-hit'); g.hit.dataset.edge = e.id;
          g.path.dataset.edge = e.id; g.path.setAttribute('marker-end', 'url(#arw)');
          g.label.className = 'e-label'; g.label.dataset.edge = e.id;
          this.eBase.appendChild(g.hit); this.eBase.appendChild(g.path); this.labelsEl.appendChild(g.label);
          this.edgeEls.set(e.id, g);
        }
        g.r = r;
        g.hit.setAttribute('d', r.d); g.path.setAttribute('d', r.d);
        g.path.setAttribute('class', 'edge' + (e.dashed ? ' dashed' : '') + (this.selEdge === e.id ? ' sel' : '') + (r.back ? ' back' : ''));
        if (e.label) {
          if (g.label.textContent !== e.label) g.label.textContent = e.label;
          g.label.hidden = false;
          g.label.style.transform = `translate(${r.lx}px,${r.ly}px) translate(-50%,-50%)`;
          g.label.classList.toggle('sel', this.selEdge === e.id);
          g.label.classList.toggle('yes', /^(yes|y|true|approved|ok)$/i.test(e.label));
          g.label.classList.toggle('no', /^(no|n|false|rejected)$/i.test(e.label));
        } else g.label.hidden = true;
      }
      for (const [id, g] of this.edgeEls) if (!seen.has(id)) { g.hit.remove(); g.path.remove(); g.label.remove(); this.edgeEls.delete(id); }
      if (this.trace || this.hl) this.drawTraceEdges();
    }
    selectionChanged() {
      for (const [id, el] of this.els) el.classList.toggle('sel', this.sel.has(id));
      for (const [id, g] of this.edgeEls) { g.path.classList.toggle('sel', this.selEdge === id); g.label.classList.toggle('sel', this.selEdge === id); }
      this.renderInspector();
    }
    select(ids, opts = {}) {
      if (!opts.add) this.sel.clear();
      for (const id of ids) { if (opts.toggle && this.sel.has(id)) this.sel.delete(id); else this.sel.add(id); }
      this.selEdge = null;
      this.selectionChanged();
    }

    // ---------------------------------------------------------------- camera
    toWorld(cx, cy) { const r = this.canvas.getBoundingClientRect(); return { x: (cx - r.left - this.cam.x) / this.cam.k, y: (cy - r.top - this.cam.y) / this.cam.k }; }
    applyCam() {
      const { x, y, k } = this.cam;
      this.world.style.transform = `translate(${x}px,${y}px) scale(${k})`;
      const g = 24 * k;
      this.canvas.style.backgroundSize = `${g}px ${g}px`;
      this.canvas.style.backgroundPosition = `${x}px ${y}px`;
      const z = T.$('.zpct', this.root); if (z) z.textContent = Math.round(k * 100) + '%';
      this.drawViewport();
    }
    bounds(ids) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of ids || this.pos.keys()) { const p = this.pos.get(id); if (!p) continue; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
      return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    // the part of the canvas not covered by the trace panel
    viewport() {
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      const hud = !this.hud.hidden ? this.hud.offsetHeight + 28 : 0;
      return { W, H: Math.max(160, H - hud), top: this.present ? 64 : 0 };
    }
    camFor(b, opts = {}) {
      const vp = this.viewport();
      const pad = opts.pad != null ? opts.pad : 64;
      const availH = vp.H - vp.top;
      let k = Math.min((vp.W - pad * 2) / Math.max(b.w, 1), (availH - pad * 2) / Math.max(b.h, 1));
      k = T.clamp(k, opts.minK || MIN_K, opts.maxK || 1.25);
      return { k, x: vp.W / 2 - (b.x + b.w / 2) * k, y: vp.top + availH / 2 - (b.y + b.h / 2) * k };
    }
    fit(animate = true, ids) {
      const b = this.bounds(ids); if (!b) { this.cam = { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2, k: 1 }; return this.applyCam(); }
      const t = this.camFor(b, { maxK: ids ? 1.25 : 1 });
      animate ? this.flyTo(t) : (this.cam = t, this.applyCam());
    }
    flyTo(t, opts = {}) {
      if (this.camAnim) this.camAnim.stop();
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      const c0 = [(W / 2 - this.cam.x) / this.cam.k, (H / 2 - this.cam.y) / this.cam.k, W / this.cam.k];
      const c1 = [(W / 2 - t.x) / t.k, (H / 2 - t.y) / t.k, W / t.k];
      const i = L().interpolateZoom(c0, c1, opts.rho || 1.25);
      const dur = opts.duration || T.clamp(i.duration * 0.9, 380, 1500);
      this.world.classList.add('moving');
      this.camAnim = T.animate(dur, (e) => {
        const [cx, cy, w] = i(e); const k = W / w;
        this.cam = { k, x: W / 2 - cx * k, y: H / 2 - cy * k };
        this.applyCam();
      }, () => { this.camAnim = null; this.cam = t; this.applyCam(); this.world.classList.remove('moving'); opts.done && opts.done(); });
    }
    zoomBy(f, cx, cy) {
      const r = this.canvas.getBoundingClientRect();
      if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
      const k = T.clamp(this.cam.k * f, MIN_K, MAX_K);
      const px = cx - r.left, py = cy - r.top;
      this.cam = { k, x: px - ((px - this.cam.x) / this.cam.k) * k, y: py - ((py - this.cam.y) / this.cam.k) * k };
      this.applyCam();
    }
    zoomTo(k, animate = true) {
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      const cx = (W / 2 - this.cam.x) / this.cam.k, cy = (H / 2 - this.cam.y) / this.cam.k;
      const t = { k, x: W / 2 - cx * k, y: H / 2 - cy * k };
      animate ? this.flyTo(t, { duration: 320 }) : (this.cam = t, this.applyCam());
    }
    reveal(id) {
      const p = this.pos.get(id); if (!p) return;
      const r = { x: this.cam.x + p.x * this.cam.k, y: this.cam.y + p.y * this.cam.k, w: p.w * this.cam.k, h: p.h * this.cam.k };
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      if (r.x < 20 || r.y < 64 || r.x + r.w > W - 20 || r.y + r.h > H - 20) this.flyTo({ k: this.cam.k, x: W / 2 - (p.x + p.w / 2) * this.cam.k, y: H / 2 - (p.y + p.h / 2) * this.cam.k }, { duration: 420 });
    }

    // ---------------------------------------------------------------- minimap
    drawMinimap() {
      const svg = T.$('.minimap svg', this.root); if (!svg) return;
      const b = this.bounds(); if (!b) { svg.innerHTML = ''; return; }
      const pad = 40;
      svg.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`);
      this.mm = { b, pad };
      svg.innerHTML = [...this.pos].map(([id, p]) => { const n = this.node(id); return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="10" fill="${n ? this.nodeColor(n) : '#888'}" opacity=".75"/>`; }).join('') + '<rect class="vp" rx="6"/>';
      this.drawViewport();
    }
    drawViewport() {
      const vp = T.$('.minimap .vp', this.root); if (!vp || !this.mm) return;
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      const x = -this.cam.x / this.cam.k, y = -this.cam.y / this.cam.k;
      vp.setAttribute('x', x); vp.setAttribute('y', y); vp.setAttribute('width', W / this.cam.k); vp.setAttribute('height', H / this.cam.k);
      vp.setAttribute('stroke-width', Math.max(this.mm.b.w, this.mm.b.h) / 90);
    }

    // ---------------------------------------------------------------- canvas input
    bindCanvas() {
      const cv = this.canvas;
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const wheelZoom = this.app.settings.wheelZoom != null ? this.app.settings.wheelZoom : !T.isMac;
        const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
        if (e.ctrlKey || e.metaKey || (wheelZoom && mouseWheel)) {
          const f = Math.exp(-e.deltaY * (e.ctrlKey && !mouseWheel ? 0.012 : 0.0018));
          this.zoomBy(f, e.clientX, e.clientY);
        } else { this.cam.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; this.cam.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; this.applyCam(); }
        if (this.camAnim) { this.camAnim.stop(); this.camAnim = null; this.world.classList.remove('moving'); }
      }, { passive: false });

      cv.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.zoombar,.minimap,.hud,.findfile,.empty-hint button')) return;
        if (this.editing) { if (!e.target.closest('.editing')) this.commitEdit(); else return; }
        cv.focus({ preventScroll: true });
        const portEl = e.target.closest('.n-port');
        const nodeEl = e.target.closest('.node');
        const edgeEl = e.target.closest('[data-edge]');
        if (e.button === 1 || (e.button === 0 && this.spaceDown)) return this.panDrag(e);
        if (e.button !== 0) return;
        if (this.present || (this.trace && !nodeEl)) return this.panDrag(e);
        if (portEl && nodeEl) return this.connectDrag(e, nodeEl.dataset.id);
        if (nodeEl) return this.nodeDrag(e, nodeEl.dataset.id);
        if (edgeEl) { this.sel.clear(); this.selEdge = edgeEl.dataset.edge; this.selectionChanged(); return; }
        if (e.shiftKey) return this.marquee(e);
        this.panDrag(e, true);
      });
      cv.addEventListener('dblclick', (e) => {
        if (this.present || this.trace) return;
        const nodeEl = e.target.closest('.node');
        if (nodeEl) return this.startEdit(nodeEl.dataset.id);
        const lab = e.target.closest('.e-label,[data-edge]');
        if (lab) return this.editEdgeLabel(lab.dataset.edge);
        if (e.target.closest('.zoombar,.minimap,.hud,.findfile')) return;
        const p = this.toWorld(e.clientX, e.clientY);
        this.addNode(null, { at: p, edit: true });
      });
      cv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.present) return;
        const nodeEl = e.target.closest('.node'), edgeEl = e.target.closest('[data-edge]');
        if (nodeEl) { if (!this.sel.has(nodeEl.dataset.id)) this.select([nodeEl.dataset.id]); return this.nodeMenu(e.clientX, e.clientY); }
        if (edgeEl) { this.sel.clear(); this.selEdge = edgeEl.dataset.edge; this.selectionChanged(); return this.edgeMenu(e.clientX, e.clientY); }
        const p = this.toWorld(e.clientX, e.clientY);
        T.menu(e.clientX, e.clientY, [
          { label: 'Add step here', icon: 'plus', onClick: () => this.addNode(null, { at: p, edit: true }) },
          { label: 'Add', icon: 'plus', sub: Object.entries(TYPES()).map(([k, t]) => ({ label: t.label, icon: t.icon, onClick: () => this.addNode(null, { at: p, type: k, edit: k !== 'and' && k !== 'or' }) })) },
          { sep: true },
          { label: 'Fit to screen', icon: 'fit', kbd: 'F', onClick: () => this.fit() },
          { label: 'Trace from the top', icon: 'trace', kbd: 'T', onClick: () => this.startTrace() },
          { label: this.V ? 'Make horizontal' : 'Make vertical', icon: this.V ? 'horizontal' : 'vertical', kbd: 'O', onClick: () => this.setOrientation(this.V ? 'horizontal' : 'vertical') },
          { label: 'Select all', kbd: 'Mod+A', onClick: () => this.select(this.c.nodes.map((n) => n.id)) }
        ]);
      });
      cv.addEventListener('keydown', (e) => this.onKey(e));
      cv.addEventListener('keyup', (e) => { if (e.key === ' ') { this.spaceDown = false; cv.classList.remove('grab'); } });
      cv.addEventListener('click', (e) => {
        const z = e.target.closest('[data-z]'); if (!z) return;
        const k = z.dataset.z;
        if (k === 'in') this.zoomTo(T.clamp(this.cam.k * 1.25, MIN_K, MAX_K)); else if (k === 'out') this.zoomTo(T.clamp(this.cam.k / 1.25, MIN_K, MAX_K));
        else if (k === '100') this.zoomTo(1); else this.fit();
      });
      const mm = T.$('.minimap', this.root);
      mm.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const go = (ev) => {
          const svg = mm.firstElementChild; const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
          const w = p.matrixTransform(svg.getScreenCTM().inverse());
          const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
          this.cam.x = W / 2 - w.x * this.cam.k; this.cam.y = H / 2 - w.y * this.cam.k; this.applyCam();
        };
        go(e); T.drag(e, go);
      });
      // drop images from Captures (or files) onto a node
      cv.addEventListener('dragover', (e) => { if (this.present) return; e.preventDefault(); const n = e.target.closest('.node'); T.$$('.node.drop', this.root).forEach((x) => x !== n && x.classList.remove('drop')); if (n) n.classList.add('drop'); });
      cv.addEventListener('dragleave', (e) => { if (!cv.contains(e.relatedTarget)) T.$$('.node.drop', this.root).forEach((x) => x.classList.remove('drop')); });
      cv.addEventListener('drop', async (e) => {
        if (this.present) return;
        e.preventDefault();
        T.$$('.node.drop', this.root).forEach((x) => x.classList.remove('drop'));
        let ids = (e.dataTransfer.getData('application/x-trace-media') || '').split(',').filter(Boolean);
        const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
        for (const f of files) { try { const m = await window.api.mediaFromBuffer(this.pid, new Uint8Array(await f.arrayBuffer()), f.name); this.app.mediaAdded(m, { silent: true }); ids.push(m.id); } catch (err) { T.toast(err.message, { kind: 'error' }); } }
        if (!ids.length) return;
        const nodeEl = e.target.closest('.node');
        if (nodeEl) { const id = nodeEl.dataset.id; this.mut((c) => { const n = c.nodes.find((x) => x.id === id); n.images = [...new Set([...(n.images || []), ...ids])]; }, null, { inspector: true }); this.select([id]); T.toast(T.plural(ids.length, 'image') + ' attached'); }
        else {
          const p = this.toWorld(e.clientX, e.clientY);
          const made = [];
          this.mut((c) => { ids.forEach((mid, i) => { const m = this.app.media.get(mid); const n = T.newNode('image', (m && m.name) || 'Screenshot', { images: [mid], x: Math.round(p.x + i * 30), y: Math.round(p.y + i * 30) }); c.nodes.push(n); made.push(n.id); }); });
          this.select(made);
        }
      });
    }
    panDrag(e, deselect) {
      const sx = e.clientX, sy = e.clientY, c0 = { ...this.cam };
      let moved = false;
      this.canvas.classList.add('panning');
      T.drag(e, (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        if (this.camAnim) { this.camAnim.stop(); this.camAnim = null; }
        this.cam = { ...c0, x: c0.x + dx, y: c0.y + dy }; this.applyCam();
      }, () => {
        this.canvas.classList.remove('panning');
        if (!moved && deselect && (this.sel.size || this.selEdge)) { this.sel.clear(); this.selEdge = null; this.selectionChanged(); }
      });
    }
    marquee(e) {
      const mq = T.$('.marquee', this.root), r = this.canvas.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      const base = new Set(this.sel);
      T.drag(e, (ev) => {
        const x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY), w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
        Object.assign(mq.style, { left: x - r.left + 'px', top: y - r.top + 'px', width: w + 'px', height: h + 'px' }); mq.hidden = false;
        const a = this.toWorld(x, y), b = this.toWorld(x + w, y + h);
        const hit = [...this.pos].filter(([, p]) => p.x < b.x && p.x + p.w > a.x && p.y < b.y && p.y + p.h > a.y).map(([id]) => id);
        this.sel = new Set([...base, ...hit]); this.selEdge = null;
        for (const [id, el] of this.els) el.classList.toggle('sel', this.sel.has(id));
      }, () => { mq.hidden = true; this.renderInspector(); });
    }
    nodeDrag(e, id) {
      if (this.trace) { const n = this.trace.choices && this.trace.choices.find((c) => c.to === id); if (n) this.traceStep(n.id); else if (this.trace.path.includes(id)) this.traceJump(this.trace.path.lastIndexOf(id)); return; }
      const additive = e.shiftKey || T.mod(e);
      if (additive) { this.select([id], { add: true, toggle: true }); return; }
      if (!this.sel.has(id)) this.select([id]);
      const sx = e.clientX, sy = e.clientY;
      const free = this.c.layout === 'free';
      const ids = free ? [...this.sel] : [id];
      const start = new Map(ids.map((i) => [i, { ...this.pos.get(i) }]));
      let moved = false, dropOn = null;
      const el = this.els.get(id);
      T.drag(e, (ev) => {
        const dx = (ev.clientX - sx) / this.cam.k, dy = (ev.clientY - sy) / this.cam.k;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        if (!moved) { moved = true; this.root.classList.add('dragging'); el.classList.add('lifted'); }
        for (const [i, p] of start) this.pos.set(i, { ...p, x: p.x + dx, y: p.y + dy });
        this.place(this.pos);
        if (!free) {
          // auto layout: dropping on another node moves this one under it
          el.style.pointerEvents = 'none';
          const under = document.elementFromPoint(ev.clientX, ev.clientY);
          el.style.pointerEvents = '';
          const t = under && under.closest('.node');
          const tid = t && t.dataset.id !== id && !this.isDescendant(t.dataset.id, id) ? t.dataset.id : null;
          if (dropOn !== tid) { if (dropOn && this.els.get(dropOn)) this.els.get(dropOn).classList.remove('drop'); dropOn = tid; if (tid) this.els.get(tid).classList.add('drop'); }
        }
      }, () => {
        this.root.classList.remove('dragging'); el.classList.remove('lifted');
        if (!moved) return;
        if (free) {
          this.mut((c) => { for (const i of ids) { const n = c.nodes.find((x) => x.id === i); const p = this.pos.get(i); n.x = Math.round(p.x); n.y = Math.round(p.y); } }, null, { animate: false });
        } else if (dropOn) {
          this.els.get(dropOn) && this.els.get(dropOn).classList.remove('drop');
          const target = dropOn;
          this.mut((c) => { c.edges = c.edges.filter((x) => x.to !== id || x.from === target); if (!c.edges.some((x) => x.from === target && x.to === id)) c.edges.push(T.newEdge(target, id, this.autoLabel(target))); });
          T.toast('Moved under “' + (this.node(target).title || 'Untitled') + '”', { action: 'Undo', onAction: () => this.app.undo() });
        } else {
          this.render({ animate: true });
          if (!this.hintedFree) { this.hintedFree = true; T.toast('Drop it on another step to move it there, or switch to free layout to place it anywhere', { action: 'Free layout', onAction: () => this.setLayout('free'), ms: 5000 }); }
        }
      });
    }
    isDescendant(id, of) {
      const st = [of], seen = new Set();
      while (st.length) { const x = st.pop(); if (x === id) return true; if (seen.has(x)) continue; seen.add(x); this.c.edges.filter((e) => e.from === x).forEach((e) => st.push(e.to)); }
      return false;
    }
    connectDrag(e, from) {
      const a = this.pos.get(from); if (!a) return;
      const sx = e.clientX, sy = e.clientY;
      let moved = false, over = null;
      T.drag(e, (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        moved = true; this.root.classList.add('connecting');
        const p = this.toWorld(ev.clientX, ev.clientY);
        const s = this.V ? [a.x + a.w / 2, a.y + a.h] : [a.x + a.w, a.y + a.h / 2];
        const k = Math.max(30, Math.hypot(p.x - s[0], p.y - s[1]) * 0.4);
        this.eTemp.setAttribute('d', this.V ? `M${s[0]},${s[1]} C${s[0]},${s[1] + k} ${p.x},${p.y - k} ${p.x},${p.y}` : `M${s[0]},${s[1]} C${s[0] + k},${s[1]} ${p.x - k},${p.y} ${p.x},${p.y}`);
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const t = under && under.closest('.node');
        const tid = t && t.dataset.id !== from ? t.dataset.id : null;
        if (over !== tid) { if (over && this.els.get(over)) this.els.get(over).classList.remove('drop'); over = tid; if (tid) this.els.get(tid).classList.add('drop'); }
      }, (ev) => {
        this.root.classList.remove('connecting'); this.eTemp.setAttribute('d', '');
        if (over && this.els.get(over)) this.els.get(over).classList.remove('drop');
        if (!moved) return this.addChild(from);
        if (over) {
          if (this.c.edges.some((x) => x.from === from && x.to === over)) return T.toast('Those are already connected');
          const to = over;
          this.mut((c) => c.edges.push(T.newEdge(from, to, this.autoLabel(from))));
          return;
        }
        const p = this.toWorld(ev.clientX, ev.clientY);
        this.addChild(from, { at: p });
      });
    }

    // ---------------------------------------------------------------- editing ops
    autoLabel(from) {
      const n = this.node(from);
      if (!n || n.type !== 'decision') return '';
      const used = this.c.edges.filter((e) => e.from === from).map((e) => (e.label || '').toLowerCase());
      if (!used.includes('yes')) return 'Yes';
      if (!used.includes('no')) return 'No';
      return '';
    }
    defaultChildType(parent) {
      if (!parent) return 'step';
      if (parent.type === 'person') return 'person';
      if (parent.type === 'folder') return 'folder';
      if (parent.type === 'end') return 'step';
      return 'step';
    }
    addNode(parentId, opts = {}) {
      const parent = parentId && this.node(parentId);
      const n = T.newNode(opts.type || this.defaultChildType(parent), opts.title || '');
      if (opts.at && (this.c.layout === 'free' || !parent)) { n.x = Math.round(opts.at.x - 80); n.y = Math.round(opts.at.y - 24); }
      this.mut((c) => {
        c.nodes.push(n);
        if (parent) c.edges.push(T.newEdge(parent.id, n.id, opts.label != null ? opts.label : this.autoLabel(parent.id)));
      });
      this.select([n.id]);
      if (opts.edit !== false) setTimeout(() => { this.reveal(n.id); this.startEdit(n.id, true); }, this.anim ? 400 : 30);
      return n;
    }
    addChild(id, opts = {}) { return this.addNode(id, { ...opts, edit: true }); }
    addSibling(id) {
      const pe = this.c.edges.find((e) => e.to === id);
      if (!pe) return this.addNode(null, { edit: true, type: this.node(id).type });
      const n = this.addNode(pe.from, { edit: true, type: this.node(id).type === 'and' || this.node(id).type === 'or' ? 'step' : this.node(id).type });
      // keep the new sibling right after this one
      this.mut((c) => {
        const ne = c.edges.find((e) => e.to === n.id && e.from === pe.from);
        c.edges = c.edges.filter((e) => e !== ne);
        const i = c.edges.findIndex((e) => e.from === pe.from && e.to === id);
        c.edges.splice(i + 1, 0, ne);
      }, null, { animate: true });
      return n;
    }
    deleteSelection(branch) {
      if (this.selEdge) { const id = this.selEdge; this.selEdge = null; this.mut((c) => { c.edges = c.edges.filter((e) => e.id !== id); }, null, { inspector: true }); return; }
      if (!this.sel.size) return;
      let ids = new Set(this.sel);
      if (branch) for (const id of [...ids]) { const st = [id]; while (st.length) { const x = st.pop(); this.c.edges.filter((e) => e.from === x).forEach((e) => { if (!ids.has(e.to)) { ids.add(e.to); st.push(e.to); } }); } }
      const count = ids.size;
      this.mut((c) => {
        // bridge: when a step with one parent goes, its children move up to that parent
        if (!branch) for (const id of ids) {
          const ins = c.edges.filter((e) => e.to === id && !ids.has(e.from));
          if (ins.length !== 1) continue;
          for (const o of c.edges.filter((e) => e.from === id && !ids.has(e.to))) if (!c.edges.some((x) => x.from === ins[0].from && x.to === o.to)) c.edges.push(T.newEdge(ins[0].from, o.to, o.label || ins[0].label || ''));
        }
        c.nodes = c.nodes.filter((n) => !ids.has(n.id));
        c.edges = c.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
        for (const s of c.scenarios || []) s.path = s.path.filter((x) => !ids.has(x));
      });
      this.sel.clear(); this.selectionChanged();
      T.toast(count === 1 ? 'Deleted' : `Deleted ${count} steps`, { action: 'Undo', onAction: () => this.app.undo() });
    }
    duplicate() {
      if (!this.sel.size) return;
      const data = this.copyData();
      this.pasteData(data, { offset: 40 });
    }
    copyData() {
      const ids = new Set(this.sel);
      return { nodes: this.c.nodes.filter((n) => ids.has(n.id)).map(T.clone), edges: this.c.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map(T.clone) };
    }
    pasteData(data, opts = {}) {
      if (!data || !data.nodes || !data.nodes.length) return;
      const map = {};
      const nodes = data.nodes.map((n) => { const c = T.clone(n); map[n.id] = c.id = T.uid(10); if (Number.isFinite(c.x)) { c.x += opts.offset || 40; c.y += opts.offset || 40; } return c; });
      const edges = data.edges.map((e) => ({ ...T.clone(e), id: T.uid(10), from: map[e.from], to: map[e.to] }));
      const attach = this.sel.size === 1 && !opts.offset ? [...this.sel][0] : null;
      const roots = nodes.filter((n) => !edges.some((e) => e.to === n.id));
      this.mut((c) => {
        c.nodes.push(...nodes); c.edges.push(...edges);
        if (attach) for (const r of roots) c.edges.push(T.newEdge(attach, r.id, this.autoLabel(attach)));
        else if (c.layout !== 'free' && opts.offset) {
          // duplicates in auto layout hang off the same parent as the originals
          for (const n of data.nodes) { const pe = c.edges.find((e) => e.to === n.id && !data.nodes.some((x) => x.id === e.from)); if (pe) c.edges.push(T.newEdge(pe.from, map[n.id], '')); }
        }
      });
      this.select(nodes.map((n) => n.id));
    }
    setOrientation(o) {
      if (o === this.c.orientation) return;
      this.mut((c) => { c.orientation = o; }, null, { inspector: true });
      setTimeout(() => this.fit(), 420);
    }
    setLayout(l) { this.mut((c) => { c.layout = l; }, null, { inspector: true }); }
    tidy() {
      if (this.c.layout === 'free') {
        // run the automatic layout once and keep the result as free positions
        this.mut((c) => { c.layout = 'auto'; }, null, { render: true });
        this.app.mutate(this.c, () => { this.c.layout = 'free'; }, 'tidy-free');
      } else this.render({ animate: true });
      setTimeout(() => this.fit(), 420);
    }
    toggleCollapse(id) {
      const has = this.c.edges.some((e) => e.from === id);
      if (!has) return;
      this.mut((c) => { const n = c.nodes.find((x) => x.id === id); n.collapsed = !n.collapsed; });
    }
    setType(ids, type) {
      this.mut((c) => {
        for (const id of ids) {
          const n = c.nodes.find((x) => x.id === id); n.type = type;
          if ((type === 'and' || type === 'or') && (!n.title || /^(and|or)$/i.test(n.title))) n.title = type.toUpperCase();
          if (type !== 'and' && type !== 'or' && /^(AND|OR)$/.test(n.title)) n.title = '';
        }
      }, null, { inspector: true });
    }

    // inline title editing
    startEdit(id, isNew) {
      if (this.present) return;
      const el = this.els.get(id); if (!el) return;
      this.commitEdit();
      const n = this.node(id);
      const t = el.querySelector('.n-title') || el.querySelector('.gate');
      if (!t) return;
      el.classList.add('editing');
      t.textContent = n.title || '';
      t.contentEditable = 'plaintext-only';
      t.spellcheck = true;
      t.focus();
      const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      this.editing = { id, t, isNew };
      t.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.commitEdit(); if (isNew && !e.metaKey && !e.ctrlKey && this.c.nodes.find((x) => x.id === id)) this.addSibling(id); }
        else if (e.key === 'Tab') { e.preventDefault(); this.commitEdit(); if (this.node(id)) this.addChild(id); }
        else if (e.key === 'Escape') { e.preventDefault(); this.commitEdit(); this.canvas.focus(); }
      };
      t.oninput = () => {
        // live re-measure keeps neighbours from overlapping while typing
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(() => { if (this.editing) this.liveRelayout(); }, 120);
      };
    }
    liveRelayout() {
      if (this.c.layout === 'free') return this.drawEdges(this.pos);
      const sizes = new Map(); for (const [id, el] of this.els) sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
      const lay = L().layout(this.c.nodes.filter((n) => this.vis.has(n.id)).map((n) => ({ id: n.id, ...sizes.get(n.id) })), this.visEdges, { orientation: this.c.orientation, ...this.gaps });
      const P = new Map(); for (const [id, p] of lay.pos) P.set(id, { ...p, ...sizes.get(id) });
      this.lay = lay; this.pos = P; this.place(P);
    }
    commitEdit() {
      const ed = this.editing; if (!ed) return;
      this.editing = null;
      clearTimeout(this.editTimer);
      const v = ed.t.textContent.replace(/\s+/g, ' ').trim();
      ed.t.contentEditable = 'false';
      const el = this.els.get(ed.id); if (el) el.classList.remove('editing');
      const n = this.node(ed.id);
      if (!n) return;
      this.keys.delete(ed.id);
      if (v !== (n.title || '')) this.mut((c) => { c.nodes.find((x) => x.id === ed.id).title = v; }, 'title:' + ed.id, { inspector: true });
      else this.render({ animate: true });
    }
    async editEdgeLabel(id) {
      const e = this.edge(id); if (!e) return;
      const v = await T.prompt('Label this connection', e.label || '', 'Yes, No, If approved…');
      if (v == null) return;
      this.mut((c) => { c.edges.find((x) => x.id === id).label = v; }, null, { inspector: true });
    }

    // ---------------------------------------------------------------- keyboard
    onKey(e) {
      if (this.editing) return;
      if (e.target.closest && e.target.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')) return;
      const k = e.key, mod = T.mod(e);
      if (k === ' ' && !this.trace) { this.spaceDown = true; this.canvas.classList.add('grab'); e.preventDefault(); return; }
      if (this.trace) return this.traceKey(e);
      const one = this.sel.size === 1 ? [...this.sel][0] : null;
      if (this.present) return;
      if (k === 'Tab') { e.preventDefault(); if (one) this.addChild(one); else if (!this.c.nodes.length) this.addNode(null, { type: 'start' }); return; }
      if (k === 'Enter' && !mod) { e.preventDefault(); if (one) this.addSibling(one); return; }
      if (k === 'F2' && one) { e.preventDefault(); return this.startEdit(one); }
      if ((k === 'Delete' || k === 'Backspace') && (this.sel.size || this.selEdge)) { e.preventDefault(); return this.deleteSelection(e.altKey); }
      if (mod && k.toLowerCase() === 'a') { e.preventDefault(); return this.select(this.c.nodes.map((n) => n.id)); }
      if (mod && k.toLowerCase() === 'd') { e.preventDefault(); return this.duplicate(); }
      if (mod && k.toLowerCase() === 'c' && this.sel.size) { e.preventDefault(); this.app.clipboard = this.copyData(); T.toast(T.plural(this.sel.size, 'step') + ' copied'); return; }
      if (mod && k.toLowerCase() === 'x' && this.sel.size) { e.preventDefault(); this.app.clipboard = this.copyData(); this.deleteSelection(); return; }
      if (mod && k.toLowerCase() === 'v' && this.app.clipboard) { e.preventDefault(); return this.pasteData(this.app.clipboard); }
      if (mod) return;
      if (k === 'Escape') { if (this.sel.size || this.selEdge) { this.sel.clear(); this.selEdge = null; this.selectionChanged(); } return; }
      if (k.startsWith('Arrow')) { e.preventDefault(); return this.navigate(k); }
      const lk = k.toLowerCase();
      if (lk === 't') { e.preventDefault(); return e.shiftKey && one ? this.traceTo(one) : this.startTrace(one || undefined); }
      if (lk === 'f') return this.fit(true, this.sel.size ? [...this.sel] : undefined);
      if (k === '1') return this.zoomTo(1);
      if (k === '=' || k === '+') return this.zoomTo(T.clamp(this.cam.k * 1.25, MIN_K, MAX_K));
      if (k === '-') return this.zoomTo(T.clamp(this.cam.k / 1.25, MIN_K, MAX_K));
      if (lk === 'o') return this.setOrientation(this.V ? 'horizontal' : 'vertical');
      if (lk === 'c' && one) return this.toggleCollapse(one);
      if (lk === 'n' && one) return this.focusNote();
    }
    navigate(key) {
      const cur = this.sel.size === 1 ? [...this.sel][0] : null;
      if (!cur) { const first = this.c.nodes.find((n) => this.pos.has(n.id)); if (first) { this.select([first.id]); this.reveal(first.id); } return; }
      const a = this.pos.get(cur); const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key];
      let best = null, bs = Infinity;
      for (const [id, p] of this.pos) {
        if (id === cur) continue;
        const dx = p.x + p.w / 2 - ac.x, dy = p.y + p.h / 2 - ac.y;
        const along = dx * dir[0] + dy * dir[1]; if (along <= 4) continue;
        const across = Math.abs(dx * dir[1] - dy * dir[0]);
        const s = along + across * 2.2;
        if (s < bs) { bs = s; best = id; }
      }
      if (best) { this.select([best]); this.reveal(best); }
    }
    focusNote() { const ed = T.$('.insp-note .rt-body', this.root); if (ed) ed.focus(); }

    // ---------------------------------------------------------------- menus
    nodeMenu(x, y) {
      const ids = [...this.sel], one = ids.length === 1 ? ids[0] : null, n = one && this.node(one);
      T.menu(x, y, [
        one && { label: 'Add next step', icon: 'plus', kbd: 'Tab', onClick: () => this.addChild(one) },
        one && { label: 'Add alongside', icon: 'plus', kbd: 'Enter', onClick: () => this.addSibling(one) },
        one && { label: 'Rename', icon: 'edit', kbd: 'F2', onClick: () => this.startEdit(one) },
        { sep: true },
        { label: 'Type', icon: 'step', sub: Object.entries(TYPES()).map(([k, t]) => ({ label: t.label, icon: t.icon, checked: n && n.type === k, onClick: () => this.setType(ids, k) })) },
        { label: 'Color', icon: 'palette', sub: [{ label: 'Automatic', onClick: () => this.mut((c) => ids.forEach((id) => { c.nodes.find((q) => q.id === id).color = ''; })) }, ...Object.entries(T.COLORS).map(([k, v]) => ({ label: k[0].toUpperCase() + k.slice(1), swatch: v, onClick: () => this.mut((c) => ids.forEach((id) => { c.nodes.find((q) => q.id === id).color = k; })) }))] },
        one && this.c.edges.some((e) => e.from === one) && { label: n.collapsed ? 'Expand branch' : 'Collapse branch', icon: n.collapsed ? 'expand' : 'collapse', kbd: 'C', onClick: () => this.toggleCollapse(one) },
        { sep: true },
        one && { label: 'Trace from here', icon: 'trace', kbd: 'T', onClick: () => this.startTrace(one) },
        one && { label: 'Trace the way here', icon: 'route', kbd: 'Shift+T', onClick: () => this.traceTo(one) },
        { label: 'Duplicate', icon: 'copy', kbd: 'Mod+D', onClick: () => this.duplicate() },
        { sep: true },
        { label: ids.length > 1 ? `Delete ${ids.length} steps` : 'Delete', icon: 'trash', kbd: 'Delete', danger: true, onClick: () => this.deleteSelection() },
        { label: 'Delete with everything below', danger: true, kbd: 'Alt+Delete', onClick: () => this.deleteSelection(true) }
      ]);
    }
    edgeMenu(x, y) {
      const id = this.selEdge, e = this.edge(id);
      const set = (v) => this.mut((c) => { c.edges.find((q) => q.id === id).label = v; }, null, { inspector: true });
      T.menu(x, y, [
        { header: 'Label' },
        ...['Yes', 'No', 'And', 'Or'].map((l) => ({ label: l, checked: e.label === l, onClick: () => set(l) })),
        { label: 'Custom…', icon: 'edit', onClick: () => this.editEdgeLabel(id) },
        e.label && { label: 'Remove label', onClick: () => set('') },
        { sep: true },
        { label: e.dashed ? 'Solid line' : 'Dashed line', onClick: () => this.mut((c) => { const q = c.edges.find((z) => z.id === id); q.dashed = !q.dashed; }) },
        { label: 'Reverse direction', icon: 'repeat', onClick: () => this.mut((c) => { const q = c.edges.find((z) => z.id === id); [q.from, q.to] = [q.to, q.from]; }) },
        { sep: true },
        { label: 'Delete connection', icon: 'trash', danger: true, onClick: () => this.deleteSelection() }
      ]);
    }

    // ---------------------------------------------------------------- toolbar
    bindBar() {
      const bar = T.$('.cv-bar', this.root);
      const title = T.$('.cv-title', bar);
      title.addEventListener('input', () => { this.app.mutate(this.c, () => { this.c.title = title.value; }, 'chart-title'); this.app.renderSidebar(); });
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); this.canvas.focus(); } e.stopPropagation(); });
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.o) return this.setOrientation(b.dataset.o);
        const a = b.dataset.act;
        if (a === 'add') {
          const one = this.sel.size === 1 ? [...this.sel][0] : null;
          T.menuAt(b, [
            { header: one ? 'Add after the selected step' : 'Add a step' },
            ...Object.entries(TYPES()).map(([k, t]) => ({ label: t.label, icon: t.icon, onClick: () => this.addNode(one, { type: k, edit: k !== 'and' && k !== 'or' }) }))
          ]);
        }
        if (a === 'tidy') this.tidy();
        if (a === 'undo') this.app.undo();
        if (a === 'redo') this.app.redo();
        if (a === 'trace') this.trace ? this.endTrace() : this.startTrace(this.sel.size === 1 ? [...this.sel][0] : undefined);
        if (a === 'present') this.app.present(this.c);
        if (a === 'export') this.app.exportItem(this.c);
        if (a === 'inspector') this.app.toggleInspector();
      });
      const ff = T.$('.findfile input', this.root);
      if (ff) {
        ff.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') this.findFile(ff.value);
          if (e.key === 'Escape') { ff.value = ''; T.$('.ff-res', this.root).innerHTML = ''; this.canvas.focus(); if (this.trace) this.endTrace(); }
        });
        ff.addEventListener('input', () => { if (!ff.value) T.$('.ff-res', this.root).innerHTML = ''; });
      }
    }
    findFile(name) {
      name = String(name || '').trim(); if (!name) return;
      const res = T.$('.ff-res', this.root);
      const hits = T.rules.match(name, this.c.nodes);
      if (!hits.length) { res.innerHTML = `<div class="ff-none">No folder has a rule for “${T.esc(name)}” yet. Add one in a folder’s Rules.</div>`; return; }
      const best = hits[0];
      const path = L().pathTo(this.c.nodes, this.c.edges, best.id) || [best.id];
      res.innerHTML = `<div class="ff-hit"><b>${T.esc(name)}</b> goes in <span class="ff-path">${path.map((id) => T.esc(this.node(id).title)).join(' <i>›</i> ')}</span><span class="ff-rule">matched “${T.esc(best.rule)}”</span></div>` +
        (hits.length > 1 ? `<div class="ff-also">Also fits: ${hits.slice(1, 4).map((h) => `<a data-id="${h.id}">${T.esc(this.node(h.id).title)}</a>`).join(', ')}</div>` : '');
      T.$$('.ff-also a', res).forEach((a) => a.addEventListener('click', () => this.traceTo(a.dataset.id, { fast: true })));
      this.traceTo(best.id, { fast: true });
    }

    // ---------------------------------------------------------------- trace mode
    choicesFrom(id) {
      const es = this.c.edges.filter((e) => e.from === id && this.node(e.to));
      const cross = (eid) => { const p = this.pos.get(this.edge(eid).to); return p ? (this.V ? p.x : p.y) : 0; };
      return es.sort((a, b) => cross(a.id) - cross(b.id));
    }
    roots() { return this.c.nodes.filter((n) => !this.c.edges.some((e) => e.to === n.id)); }
    startTrace(from, opts = {}) {
      if (this.editing) this.commitEdit();
      if (!this.c.nodes.length) return T.toast('Add a few steps first');
      if (!from) {
        const roots = this.roots();
        if (roots.length > 1 && !opts.quiet) return this.pickStart(roots);
        from = (roots[0] || this.c.nodes[0]).id;
      }
      this.stopAuto();
      this.hl = null;
      this.trace = { path: [from], edges: [], showAlt: true, scenario: opts.scenario || null, queue: null };
      this.root.classList.add('tracing');
      this.render({ animate: false });
      this.traceUpdate();
    }
    pickStart(roots) {
      this.trace = { path: [], edges: [], picking: true };
      this.root.classList.add('tracing');
      this.render();
      this.hud.hidden = false;
      this.hud.innerHTML = `<div class="hud-top"><span class="hud-kicker">Where should the trace start?</span><button class="icon-btn ghost" data-h="exit">${T.icon('x')}</button></div>
        <div class="hud-choices">${roots.slice(0, 9).map((r, i) => `<button class="choice" data-start="${r.id}"><kbd>${i + 1}</kbd><span>${T.esc(r.title || 'Untitled')}</span></button>`).join('')}</div>`;
      this.hud.onclick = (e) => { const s = e.target.closest('[data-start]'); if (s) this.startTrace(s.dataset.start); if (e.target.closest('[data-h="exit"]')) this.endTrace(); };
      this.fit();
    }
    traceTo(id, opts = {}) {
      const path = L().pathTo(this.c.nodes, this.c.edges, id);
      if (!path) return;
      this.startTrace(path[0], { quiet: true });
      if (path.length < 2) return;
      this.trace.queue = path.slice(1);
      this.trace.replay = true;
      this.autoStep(opts.fast ? 650 : 1100);
    }
    playScenario(sc, opts = {}) {
      const path = (sc.path || []).filter((id) => this.node(id));
      if (!path.length) return T.toast('This scenario has no steps left');
      this.startTrace(path[0], { quiet: true, scenario: sc });
      this.trace.queue = path.slice(1);
      if (opts.autoplay !== false) this.autoStep(opts.speed || 1700);
      else this.traceUpdate();
    }
    autoStep(delay) {
      this.stopAuto();
      if (!this.trace || !this.trace.queue || !this.trace.queue.length) { this.traceUpdate(); return; }
      this.trace.playing = true;
      this.traceUpdate();
      this.autoTimer = setTimeout(() => {
        if (!this.trace) return;
        const next = this.trace.queue.shift();
        const cur = this.trace.path[this.trace.path.length - 1];
        const e = this.c.edges.find((x) => x.from === cur && x.to === next);
        this.trace.path.push(next); this.trace.edges.push(e ? e.id : null);
        if (this.trace.queue.length) this.autoStep(delay); else { this.trace.playing = false; this.traceUpdate(); }
      }, this.trace.path.length === 1 && !this.trace.replay ? Math.max(900, delay * 0.7) : delay);
    }
    stopAuto() { clearTimeout(this.autoTimer); if (this.trace) this.trace.playing = false; }
    togglePlay() {
      if (!this.trace) return;
      if (this.trace.playing) { this.stopAuto(); this.traceUpdate(); }
      else if (this.trace.queue && this.trace.queue.length) this.autoStep(this.trace.speed || 1700);
      else if (this.trace.scenario) this.playScenario(this.trace.scenario);
    }
    traceStep(edgeId) {
      if (!this.trace) return;
      const e = this.edge(edgeId); if (!e) return;
      // choosing by hand: keep following the scenario if it matches, otherwise leave it
      if (this.trace.queue && this.trace.queue[0] === e.to) this.trace.queue.shift();
      else { this.trace.queue = null; this.trace.scenario = null; }
      this.stopAuto();
      this.trace.path.push(e.to); this.trace.edges.push(e.id);
      this.traceUpdate();
    }
    traceBack() {
      if (!this.trace || this.trace.path.length < 2) return;
      this.stopAuto();
      const gone = this.trace.path.pop(); this.trace.edges.pop();
      if (this.trace.queue) this.trace.queue.unshift(gone);
      this.traceUpdate();
    }
    traceJump(i) {
      if (!this.trace) return;
      this.stopAuto();
      const gone = this.trace.path.splice(i + 1); this.trace.edges.splice(i);
      if (this.trace.queue) this.trace.queue = [...gone, ...this.trace.queue];
      this.traceUpdate();
    }
    endTrace() {
      if (!this.trace) return;
      this.stopAuto();
      this.trace = null;
      this.root.classList.remove('tracing');
      this.hud.hidden = true; this.hud.innerHTML = '';
      this.eTrace.innerHTML = '';
      for (const el of this.els.values()) el.classList.remove('on-path', 'current', 'cand', 'dim', 'alt', 'visited');
      for (const g of this.edgeEls.values()) { g.path.classList.remove('on-path', 'cand', 'dim', 'alt'); g.label.classList.remove('on-path', 'cand', 'dim'); }
      this.render({ animate: false });
      if (this.present) { if (this.onExit) this.onExit(); return; }
      this.fit();
      this.canvas.focus();
    }
    traceUpdate() {
      if (!this.trace) return;
      const cur = this.trace.path[this.trace.path.length - 1];
      this.trace.choices = this.choicesFrom(cur);
      this.applyTrace();
      this.renderHud();
      this.focusTrace();
    }
    applyTrace() {
      const t = this.trace; if (!t || t.picking) return;
      const onPath = new Set(t.path), cur = t.path[t.path.length - 1];
      const cand = new Set((t.choices || []).map((e) => e.to));
      const pathEdges = new Set(t.edges.filter(Boolean));
      const alt = new Set(), altEdges = new Set();
      if (t.showAlt) for (let i = 0; i < t.path.length - 1; i++) for (const e of this.choicesFrom(t.path[i])) if (!pathEdges.has(e.id)) { alt.add(e.to); altEdges.add(e.id); }
      for (const [id, el] of this.els) {
        el.classList.toggle('on-path', onPath.has(id));
        el.classList.toggle('current', id === cur);
        el.classList.toggle('cand', cand.has(id) && !onPath.has(id));
        el.classList.toggle('alt', alt.has(id) && !onPath.has(id) && !cand.has(id));
        el.classList.toggle('dim', !onPath.has(id) && !cand.has(id) && !alt.has(id));
      }
      const candEdges = new Set((t.choices || []).map((e) => e.id));
      for (const [id, g] of this.edgeEls) {
        g.path.classList.toggle('on-path', pathEdges.has(id));
        g.path.classList.toggle('cand', candEdges.has(id));
        g.path.classList.toggle('alt', altEdges.has(id) && !candEdges.has(id));
        g.path.classList.toggle('dim', !pathEdges.has(id) && !candEdges.has(id) && !altEdges.has(id));
        g.label.classList.toggle('on-path', pathEdges.has(id));
        g.label.classList.toggle('cand', candEdges.has(id));
        g.label.classList.toggle('dim', !pathEdges.has(id) && !candEdges.has(id) && !altEdges.has(id));
      }
      // numbered choice badges
      T.$$('.n-choice', this.nodesEl).forEach((x) => x.remove());
      (t.choices || []).slice(0, 9).forEach((e, i) => { const el = this.els.get(e.to); if (el) el.appendChild(T.el(`<span class="n-choice">${i + 1}</span>`)); });
      this.drawTraceEdges();
    }
    drawTraceEdges() {
      const ids = this.trace ? this.trace.edges.filter(Boolean) : this.hl ? this.hl.edges : [];
      const color = this.hl ? T.colorOf(this.hl.color) : null;
      this.eTrace.innerHTML = ids.map((id) => { const g = this.edgeEls.get(id); return g && g.r ? `<path class="trace-glow" d="${g.r.d}" ${color ? `style="stroke:${color}"` : ''}/><path class="trace-line" d="${g.r.d}" ${color ? `style="stroke:${color}"` : ''} marker-end="url(#arw-on)"/>` : ''; }).join('');
    }
    focusTrace() {
      const t = this.trace; if (!t) return;
      const cur = t.path[t.path.length - 1];
      const ids = [cur, ...(t.choices || []).map((e) => e.to)];
      if (t.path.length > 1) ids.push(t.path[t.path.length - 2]);
      const b = this.bounds(ids); if (!b) return;
      const target = this.camFor(b, { pad: 70, maxK: this.present ? 1.45 : 1.2, minK: 0.3 });
      this.flyTo(target, { rho: 1.15 });
    }
    edgeLabelFor(eid) { const e = eid && this.edge(eid); return e && e.label ? e.label : ''; }
    renderHud() {
      const t = this.trace, hud = this.hud;
      const cur = this.node(t.path[t.path.length - 1]); if (!cur) return this.endTrace();
      const tp = TYPES()[cur.type] || TYPES().step;
      const crumbs = t.path.map((id, i) => { const n = this.node(id); const lab = i ? this.edgeLabelFor(t.edges[i - 1]) : ''; return `${i ? `<i class="sep">${lab ? `<em>${T.esc(lab)}</em>` : ''}</i>` : ''}<button class="crumb ${i === t.path.length - 1 ? 'on' : ''}" data-i="${i}" title="${T.esc(n ? n.title : '')}">${T.esc((n && n.title) || 'Untitled')}</button>`; }).join('');
      const note = cur.note && T.textOf(cur.note) ? `<div class="hud-note rich">${T.sanitize(cur.note)}</div>` : '';
      const imgs = (cur.images || []).map((id) => this.app.media.get(id)).filter(Boolean);
      const pics = imgs.length && cur.type !== 'person' ? `<div class="hud-imgs">${imgs.map((m) => `<button class="hud-img" data-media="${m.id}">${T.annot.svg(m, T.mediaUrl(this.pid, m.file))}</button>`).join('')}</div>` : '';
      const ch = t.choices || [];
      const nextQ = t.queue && t.queue[0];
      const choices = ch.length ? ch.slice(0, 9).map((e, i) => { const n = this.node(e.to); return `<button class="choice ${nextQ === e.to ? 'next' : ''}" data-e="${e.id}"><kbd>${ch.length === 1 ? '→' : i + 1}</kbd>${e.label ? `<b>${T.esc(e.label)}</b>` : ''}<span>${T.esc((n && n.title) || 'Untitled')}</span>${t.path.includes(e.to) ? `<i class="loop" title="Goes back to an earlier step">${T.icon('repeat', 12)}</i>` : ''}</button>`; }).join('')
        : `<div class="hud-end">${T.icon('check', 16)} End of this path</div><button class="btn sm" data-h="restart">${T.icon('repeat')}Start over</button>${!this.present && !t.scenario ? `<button class="btn sm primary" data-h="save">${T.icon('bookmark')}Save as scenario</button>` : ''}`;
      // what could have been: the other branch at the last fork
      let alt = '';
      for (let i = t.path.length - 2; i >= 0; i--) {
        const opts = this.choicesFrom(t.path[i]).filter((e) => e.id !== t.edges[i]);
        if (opts.length) {
          alt = `<div class="hud-alt">At <b>${T.esc(this.node(t.path[i]).title || 'Untitled')}</b> it could have gone ${opts.slice(0, 3).map((e) => `<a data-alt="${i}:${e.id}">${e.label ? `<em>${T.esc(e.label)}</em> ` : ''}${T.esc((this.node(e.to) || {}).title || 'Untitled')}</a>`).join(' or ')}</div>`;
          break;
        }
      }
      const scen = t.scenario ? `<span class="hud-scen" style="--c:${T.colorOf(t.scenario.color)}">${T.icon('bookmark', 12)}${T.esc(t.scenario.name)}</span>` : '';
      const playable = (t.queue && t.queue.length) || t.scenario;
      hud.hidden = false;
      hud.classList.toggle('big', this.present);
      hud.innerHTML = `<div class="hud-top"><div class="crumbs">${crumbs}</div>
          <div class="hud-actions">${scen}
            ${playable ? `<button class="icon-btn ghost" data-h="play" title="${t.playing ? 'Pause' : 'Play'} (P)">${T.icon(t.playing ? 'pause' : 'play', 15, 'fill')}</button>` : ''}
            <button class="icon-btn ghost ${t.showAlt ? 'on' : ''}" data-h="alt" title="Show other branches (A)">${T.icon('route', 15)}</button>
            ${!this.present && t.path.length > 1 && !t.scenario ? `<button class="icon-btn ghost" data-h="save" title="Save this path as a scenario">${T.icon('bookmark', 15)}</button>` : ''}
            <button class="icon-btn ghost" data-h="exit" title="Stop tracing (Esc)">${T.icon('x', 15)}</button></div></div>
        <div class="hud-body">
          <div class="hud-main">
            <div class="hud-kicker" style="--c:${this.nodeColor(cur)}">${T.icon(tp.icon, 13)}${T.esc(tp.label)} · step ${t.path.length}</div>
            <h3>${T.esc(cur.title || 'Untitled')}</h3>${cur.sub ? `<div class="hud-sub">${T.esc(cur.sub)}</div>` : ''}
            ${note}${cur.link ? `<a class="hud-link" data-link="${T.esc(cur.link)}">${T.icon('link', 13)}${T.esc(cur.link)}</a>` : ''}
          </div>${pics}
        </div>
        <div class="hud-choices">${t.path.length > 1 ? `<button class="icon-btn ghost back" data-h="back" title="Back (←)">${T.icon('back', 16)}</button>` : ''}${choices}</div>${alt}`;
      hud.onclick = (e) => {
        const c = e.target.closest('[data-e]'); if (c) return this.traceStep(c.dataset.e);
        const cr = e.target.closest('[data-i]'); if (cr) return this.traceJump(+cr.dataset.i);
        const al = e.target.closest('[data-alt]'); if (al) { const [i, eid] = al.dataset.alt.split(':'); this.traceJump(+i); return this.traceStep(eid); }
        const im = e.target.closest('[data-media]'); if (im) return this.app.viewMedia(im.dataset.media, imgs.map((m) => m.id));
        const ln = e.target.closest('[data-link]'); if (ln) return window.api.open(ln.dataset.link);
        const h = e.target.closest('[data-h]'); if (!h) return;
        const a = h.dataset.h;
        if (a === 'exit') this.endTrace();
        if (a === 'back') this.traceBack();
        if (a === 'restart') { const sc = t.scenario; sc ? this.playScenario(sc) : this.startTrace(t.path[0]); }
        if (a === 'save') this.saveScenario();
        if (a === 'play') this.togglePlay();
        if (a === 'alt') { t.showAlt = !t.showAlt; this.applyTrace(); this.renderHud(); }
      };
      T.$$('.hud-note a', hud).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.api.open(a.href); }));
    }
    traceKey(e) {
      const t = this.trace, k = e.key;
      if (t.picking) { if (/^[1-9]$/.test(k)) { const r = this.roots()[+k - 1]; if (r) this.startTrace(r.id); } if (k === 'Escape') this.endTrace(); return; }
      if (k === 'Escape') { e.preventDefault(); return this.endTrace(); }
      if (/^[1-9]$/.test(k)) { const c = t.choices[+k - 1]; if (c) this.traceStep(c.id); return; }
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'Enter' || k === 'PageDown') {
        e.preventDefault();
        if (t.queue && t.queue.length) { const next = t.queue[0]; const c = t.choices.find((x) => x.to === next); if (c) return this.traceStep(c.id); }
        if (t.choices.length === 1) return this.traceStep(t.choices[0].id);
        if (t.choices.length > 1) { const hb = T.$('.hud-choices .choice', this.hud); if (hb) { hb.classList.add('nudge'); setTimeout(() => hb.classList.remove('nudge'), 400); } }
        return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'Backspace' || k === 'PageUp') { e.preventDefault(); return this.traceBack(); }
      if (k.toLowerCase() === 'p') return this.togglePlay();
      if (k.toLowerCase() === 'a') { t.showAlt = !t.showAlt; this.applyTrace(); this.renderHud(); return; }
      if (k.toLowerCase() === 'f') return this.fit();
      if (k.toLowerCase() === 's' && !this.present) return this.saveScenario();
    }
    async saveScenario() {
      const t = this.trace; if (!t || t.path.length < 2) return;
      const last = this.node(t.path[t.path.length - 1]);
      const name = await T.prompt('Save this path as a scenario', last ? 'When it ends at “' + (last.title || 'Untitled') + '”' : 'Scenario', 'Name it', 'Save scenario');
      if (!name) return;
      const colors = ['violet', 'green', 'rose', 'amber', 'blue', 'cyan', 'orange', 'pink'];
      const sc = { id: T.uid(8), name, color: colors[(this.c.scenarios || []).length % colors.length], path: [...t.path] };
      this.app.mutate(this.c, () => { this.c.scenarios = [...(this.c.scenarios || []), sc]; });
      t.scenario = sc;
      this.renderHud(); this.renderInspector();
      T.toast('Scenario saved: play it any time from the panel');
    }
    highlightScenario(sc) {
      if (this.trace) return;
      if (!sc) { this.hl = null; for (const el of this.els.values()) el.classList.remove('hl', 'hl-dim'); for (const g of this.edgeEls.values()) g.path.classList.remove('hl-dim'); this.eTrace.innerHTML = ''; return; }
      const edges = [];
      for (let i = 0; i < sc.path.length - 1; i++) { const e = this.c.edges.find((x) => x.from === sc.path[i] && x.to === sc.path[i + 1]); if (e) edges.push(e.id); }
      this.hl = { path: sc.path, edges, color: sc.color };
      this.applyHighlight();
    }
    applyHighlight() {
      const on = new Set(this.hl.path), es = new Set(this.hl.edges);
      for (const [id, el] of this.els) { el.classList.toggle('hl', on.has(id)); el.classList.toggle('hl-dim', !on.has(id)); }
      for (const [id, g] of this.edgeEls) g.path.classList.toggle('hl-dim', !es.has(id));
      this.drawTraceEdges();
    }

    // ---------------------------------------------------------------- inspector
    renderInspector() {
      const box = this.insp; if (!box) return;
      if (this.noteEditor) { this.noteEditor.flush(); this.noteEditor = null; }
      const ids = [...this.sel];
      if (this.selEdge) return this.inspectEdge(box);
      if (ids.length === 1) return this.inspectNode(box, this.node(ids[0]));
      if (ids.length > 1) return this.inspectMany(box, ids);
      return this.inspectChart(box);
    }
    inspectChart(box) {
      const c = this.c;
      const sc = c.scenarios || [];
      const counts = { nodes: c.nodes.length, edges: c.edges.length };
      box.innerHTML = `<div class="insp-sec"><div class="insp-h">Chart</div>
          <label class="fld">Orientation<div class="seg wide">${['vertical', 'horizontal'].map((o) => `<button class="${(c.orientation || 'vertical') === o ? 'on' : ''}" data-set="orientation" data-v="${o}">${T.icon(o, 15)}${o[0].toUpperCase() + o.slice(1)}</button>`).join('')}</div></label>
          <label class="fld">Layout<div class="seg wide">${[['auto', 'Automatic'], ['free', 'Free']].map(([v, l]) => `<button class="${(c.layout || 'auto') === v ? 'on' : ''}" data-set="layout" data-v="${v}">${l}</button>`).join('')}</div></label>
          <label class="fld">Lines<div class="seg wide">${[['elbow', 'Elbow'], ['curve', 'Curved'], ['straight', 'Straight']].map(([v, l]) => `<button class="${(c.edgeStyle || 'elbow') === v ? 'on' : ''}" data-set="edgeStyle" data-v="${v}">${l}</button>`).join('')}</div></label>
          <label class="fld">Spacing<input type="range" min="0.6" max="1.8" step="0.1" value="${c.spacing || 1}" data-range="spacing"></label>
          <div class="insp-meta">${T.plural(counts.nodes, 'step')} · ${T.plural(counts.edges, 'connection')}</div>
        </div>
        <div class="insp-sec"><div class="insp-h">Scenarios<button class="icon-btn ghost sm" data-act="new-scen" title="Trace a path, then save it">${T.icon('plus', 14)}</button></div>
          ${sc.length ? `<div class="scen-list">${sc.map((s) => `<div class="scen" data-scen="${s.id}" style="--c:${T.colorOf(s.color)}"><i class="dot"></i><div class="scen-t"><b>${T.esc(s.name)}</b><span>${T.plural(s.path.length, 'step')}</span></div>
            <button class="icon-btn ghost sm" data-play="${s.id}" title="Play">${T.icon('play', 13, 'fill')}</button><button class="icon-btn ghost sm" data-present="${s.id}" title="Present">${T.icon('present', 14)}</button><button class="icon-btn ghost sm" data-smenu="${s.id}" title="More">${T.icon('more', 14)}</button></div>`).join('')}</div>`
            : `<p class="insp-empty">A scenario is a saved path through the chart, like “what happens if the numbers don’t match”. Press <kbd>T</kbd> to trace, pick your way through, then save it.</p>`}
        </div>
        <div class="insp-sec"><div class="insp-h">Shortcuts</div><div class="keys">
          <span><kbd>Tab</kbd> next step</span><span><kbd>Enter</kbd> alongside</span><span><kbd>T</kbd> trace</span><span><kbd>⇧T</kbd> trace the way here</span>
          <span><kbd>F</kbd> fit</span><span><kbd>O</kbd> flip orientation</span><span><kbd>C</kbd> collapse</span><span><kbd>${T.isMac ? '⇧' : 'Shift'}</kbd>+drag select</span></div></div>`;
      box.onclick = (e) => {
        const s = e.target.closest('[data-set]'); if (s) { if (s.dataset.set === 'orientation') return this.setOrientation(s.dataset.v); this.mut((cc) => { cc[s.dataset.set] = s.dataset.v; }, null, { inspector: true }); if (s.dataset.set !== 'layout') setTimeout(() => this.fit(), 420); return; }
        const p = e.target.closest('[data-play]'); if (p) return this.playScenario(sc.find((x) => x.id === p.dataset.play));
        const pr = e.target.closest('[data-present]'); if (pr) return this.app.present(this.c, { scenario: pr.dataset.present });
        const m = e.target.closest('[data-smenu]'); if (m) return this.scenarioMenu(m, m.dataset.smenu);
        if (e.target.closest('[data-act="new-scen"]')) { this.startTrace(); T.toast('Pick your way through, then save the path'); }
      };
      T.$$('.scen', box).forEach((el) => {
        el.addEventListener('pointerenter', () => this.highlightScenario(sc.find((x) => x.id === el.dataset.scen)));
        el.addEventListener('pointerleave', () => this.highlightScenario(null));
      });
      const r = T.$('[data-range]', box);
      r.addEventListener('input', () => { this.app.mutate(this.c, () => { this.c.spacing = +r.value; }, 'spacing'); this.render({ animate: false }); });
    }
    scenarioMenu(btn, id) {
      const sc = (this.c.scenarios || []).find((x) => x.id === id);
      T.menuAt(btn, [
        { label: 'Play', icon: 'play', onClick: () => this.playScenario(sc) },
        { label: 'Step through', icon: 'next', onClick: () => this.playScenario(sc, { autoplay: false }) },
        { label: 'Rename', icon: 'edit', onClick: async () => { const v = await T.prompt('Rename scenario', sc.name); if (v) this.mut((c) => { c.scenarios.find((x) => x.id === id).name = v; }, null, { inspector: true, render: false }); } },
        { label: 'Color', icon: 'palette', sub: Object.entries(T.COLORS).map(([k, v]) => ({ label: k, swatch: v, onClick: () => this.mut((c) => { c.scenarios.find((x) => x.id === id).color = k; }, null, { inspector: true, render: false }) })) },
        { sep: true },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => { this.highlightScenario(null); this.mut((c) => { c.scenarios = c.scenarios.filter((x) => x.id !== id); }, null, { inspector: true, render: false }); } }
      ]);
    }
    inspectMany(box, ids) {
      box.innerHTML = `<div class="insp-sec"><div class="insp-h">${ids.length} steps selected</div>
        <label class="fld">Type<div class="type-grid">${Object.entries(TYPES()).map(([k, t]) => `<button class="tbtn" data-type="${k}" title="${t.label}">${T.icon(t.icon, 16)}<span>${t.label}</span></button>`).join('')}</div></label>
        <label class="fld">Color<div class="colors">${['', ...Object.keys(T.COLORS)].map((k) => `<button class="sw ${k ? '' : 'auto'}" data-color="${k}" style="--c:${k ? T.COLORS[k] : 'transparent'}" title="${k || 'Automatic'}"></button>`).join('')}</div></label>
        <div class="insp-actions"><button class="btn sm" data-act="dup">${T.icon('copy')}Duplicate</button><button class="btn sm danger" data-act="del">${T.icon('trash')}Delete</button></div></div>`;
      box.onclick = (e) => {
        const t = e.target.closest('[data-type]'); if (t) return this.setType(ids, t.dataset.type);
        const c = e.target.closest('[data-color]'); if (c) return this.mut((cc) => ids.forEach((id) => { cc.nodes.find((n) => n.id === id).color = c.dataset.color; }));
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'dup') this.duplicate(); else this.deleteSelection();
      };
    }
    inspectEdge(box) {
      const e = this.edge(this.selEdge); if (!e) return this.inspectChart(box);
      const a = this.node(e.from), b = this.node(e.to);
      box.innerHTML = `<div class="insp-sec"><div class="insp-h">Connection</div>
        <div class="conn-ends"><span>${T.esc(a ? a.title || 'Untitled' : '?')}</span>${T.icon('next', 14)}<span>${T.esc(b ? b.title || 'Untitled' : '?')}</span></div>
        <label class="fld">Label<input class="input" data-f="label" value="${T.esc(e.label || '')}" placeholder="Yes, No, If approved…"></label>
        <div class="quick">${['Yes', 'No', 'And', 'Or', 'Then', 'Else'].map((l) => `<button class="chip-btn" data-q="${l}">${l}</button>`).join('')}</div>
        <label class="fld row"><input type="checkbox" data-f="dashed" ${e.dashed ? 'checked' : ''}> Dashed line (optional or maybe)</label>
        <div class="insp-actions"><button class="btn sm" data-act="rev">${T.icon('repeat')}Reverse</button><button class="btn sm danger" data-act="del">${T.icon('trash')}Delete</button></div></div>`;
      const lab = T.$('[data-f="label"]', box);
      lab.addEventListener('input', () => { this.app.mutate(this.c, () => { e.label = lab.value; }, 'elabel:' + e.id); this.drawEdges(this.pos); });
      lab.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape') this.canvas.focus(); });
      T.$('[data-f="dashed"]', box).addEventListener('change', (ev) => this.mut(() => { e.dashed = ev.target.checked; }));
      box.onclick = (ev) => {
        const q = ev.target.closest('[data-q]'); if (q) { lab.value = q.dataset.q; this.mut(() => { e.label = q.dataset.q; }, null, { animate: false }); return; }
        const a2 = ev.target.closest('[data-act]'); if (!a2) return;
        if (a2.dataset.act === 'rev') this.mut(() => { [e.from, e.to] = [e.to, e.from]; }, null, { inspector: true });
        else this.deleteSelection();
      };
    }
    inspectNode(box, n) {
      if (!n) return this.inspectChart(box);
      const t = TYPES()[n.type] || TYPES().step;
      const outs = this.c.edges.filter((e) => e.from === n.id);
      const ins = this.c.edges.filter((e) => e.to === n.id);
      const imgs = (n.images || []).map((id) => this.app.media.get(id)).filter(Boolean);
      const subLabel = n.type === 'person' ? 'Role' : n.type === 'folder' || n.type === 'file' ? 'Location' : 'Detail';
      const showRules = n.type === 'folder' || n.type === 'file';
      box.innerHTML = `<div class="insp-sec node-sec" style="--c:${this.nodeColor(n)}">
          <div class="insp-h"><span class="insp-type">${T.icon(t.icon, 14)}${T.esc(t.label)}</span>
            <div class="insp-tools"><button class="icon-btn ghost sm" data-act="trace" title="Trace from here (T)">${T.icon('trace', 15)}</button><button class="icon-btn ghost sm" data-act="traceto" title="Trace the way here (Shift+T)">${T.icon('route', 15)}</button><button class="icon-btn ghost sm" data-act="menu" title="More">${T.icon('more', 15)}</button></div></div>
          <textarea class="input title-in" rows="1" data-f="title" placeholder="${n.type === 'decision' ? 'The question, e.g. Is the data in?' : 'Title'}">${T.esc(n.title || '')}</textarea>
          <input class="input" data-f="sub" value="${T.esc(n.sub || '')}" placeholder="${subLabel}">
          <div class="type-grid compact">${Object.entries(TYPES()).map(([k, tt]) => `<button class="tbtn ${n.type === k ? 'on' : ''}" data-type="${k}" title="${tt.label}">${T.icon(tt.icon, 15)}</button>`).join('')}</div>
          <div class="colors">${['', ...Object.keys(T.COLORS)].map((k) => `<button class="sw ${k ? '' : 'auto'} ${(n.color || '') === k ? 'on' : ''}" data-color="${k}" style="--c:${k ? T.COLORS[k] : this.nodeColor({ ...n, color: '' })}" title="${k || 'Automatic'}"></button>`).join('')}</div>
        </div>
        ${showRules ? `<div class="insp-sec"><div class="insp-h">Rules <span class="hint">what belongs here</span></div>
          <div class="tags" data-tags>${(n.rules || []).map((r, i) => `<span class="tag">${T.esc(r)}<button data-rm="${i}">${T.icon('x', 11)}</button></span>`).join('')}<input class="tag-in" placeholder="${(n.rules || []).length ? 'Add…' : '.pdf, invoice*, receipt'}"></div>
          ${n.stats && n.stats.length ? `<div class="stats">Found here: ${n.stats.map(([x, c]) => `<button class="chip-btn" data-addrule="${T.esc(x)}">${T.esc(x)} <b>${c}</b></button>`).join('')}</div>` : ''}</div>` : ''}
        <div class="insp-sec grow-sec"><div class="insp-h">Note</div><div class="insp-note"></div></div>
        <div class="insp-sec"><div class="insp-h">${n.type === 'person' ? 'Photo' : 'Images'}<button class="icon-btn ghost sm" data-act="addimg" title="Add images">${T.icon('plus', 14)}</button></div>
          ${imgs.length ? `<div class="thumbs">${imgs.map((m) => `<div class="thumb" data-media="${m.id}" draggable="false">${T.annot.svg(m, T.mediaUrl(this.pid, m.file))}<button class="rm" data-rmimg="${m.id}" title="Remove from this step">${T.icon('x', 11)}</button></div>`).join('')}</div>`
            : `<p class="insp-empty">Drop screenshots here or onto the step${n.type === 'person' ? ' to use as their photo' : ''}.</p>`}</div>
        <div class="insp-sec"><div class="insp-h">Link</div><div class="link-row"><input class="input" data-f="link" value="${T.esc(n.link || '')}" placeholder="https://…">${n.link ? `<button class="icon-btn ghost sm" data-act="open" title="Open">${T.icon('next', 14)}</button>` : ''}</div></div>
        <div class="insp-sec"><div class="insp-h">Leads to<button class="icon-btn ghost sm" data-act="child" title="Add next step (Tab)">${T.icon('plus', 14)}</button></div>
          ${outs.length ? outs.map((e) => { const to = this.node(e.to); return `<div class="out-row" data-eid="${e.id}"><input class="input sm" data-elabel="${e.id}" value="${T.esc(e.label || '')}" placeholder="label"><button class="out-to" data-go="${e.to}">${T.esc((to && to.title) || 'Untitled')}</button><button class="icon-btn ghost sm" data-rme="${e.id}" title="Disconnect">${T.icon('x', 12)}</button></div>`; }).join('')
            : '<p class="insp-empty">Nothing yet. Press Tab, or drag from the dot on the step to another step.</p>'}
          ${ins.length ? `<div class="from-row">From ${ins.map((e) => `<button class="link-btn" data-go="${e.from}">${T.esc((this.node(e.from) || {}).title || 'Untitled')}</button>`).join(', ')}</div>` : ''}</div>`;
      const titleIn = T.$('[data-f="title"]', box);
      const grow = () => { titleIn.style.height = 'auto'; titleIn.style.height = titleIn.scrollHeight + 'px'; };
      requestAnimationFrame(grow);
      const bindField = (f) => {
        const el = T.$(`[data-f="${f}"]`, box); if (!el) return;
        el.addEventListener('input', () => {
          if (f === 'title') grow();
          this.app.mutate(this.c, () => { n[f] = el.value; }, f + ':' + n.id);
          this.keys.delete(n.id);
          clearTimeout(this.fieldTimer);
          this.fieldTimer = setTimeout(() => this.render({ animate: true }), f === 'link' ? 0 : 160);
        });
        el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && f !== 'title')) { e.preventDefault(); this.canvas.focus(); } if (e.key === 'Enter' && f === 'title') { e.preventDefault(); this.canvas.focus(); } });
      };
      ['title', 'sub', 'link'].forEach(bindField);
      // note
      this.noteEditor = new T.RichText(T.$('.insp-note', box), {
        html: n.note || '', compact: true, app: this.app, placeholder: 'What happens here, who does it, what to watch for…',
        onChange: (html) => { this.app.mutate(this.c, () => { n.note = html; }, 'note:' + n.id); this.keys.delete(n.id); this.render({ animate: false }); }
      });
      // rules
      const tagIn = T.$('.tag-in', box);
      if (tagIn) {
        tagIn.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && tagIn.value.trim()) {
            e.preventDefault();
            const add = tagIn.value.split(/[\s,]+/).filter(Boolean);
            this.mut(() => { n.rules = [...new Set([...(n.rules || []), ...add])]; }, null, { inspector: true });
            setTimeout(() => { const ti = T.$('.tag-in', this.insp); if (ti) ti.focus(); }, 0);
          } else if (e.key === 'Backspace' && !tagIn.value && (n.rules || []).length) { this.mut(() => { n.rules = n.rules.slice(0, -1); }, null, { inspector: true }); setTimeout(() => { const ti = T.$('.tag-in', this.insp); if (ti) ti.focus(); }, 0); }
        });
      }
      // images drop target
      const imgSec = T.$('[data-act="addimg"]', box).closest('.insp-sec');
      imgSec.addEventListener('dragover', (e) => { e.preventDefault(); imgSec.classList.add('drop'); });
      imgSec.addEventListener('dragleave', () => imgSec.classList.remove('drop'));
      imgSec.addEventListener('drop', async (e) => {
        e.preventDefault(); imgSec.classList.remove('drop');
        const ids = (e.dataTransfer.getData('application/x-trace-media') || '').split(',').filter(Boolean);
        for (const f of Array.from(e.dataTransfer.files || []).filter((x) => x.type.startsWith('image/'))) { const m = await window.api.mediaFromBuffer(this.pid, new Uint8Array(await f.arrayBuffer()), f.name); this.app.mediaAdded(m, { silent: true }); ids.push(m.id); }
        if (ids.length) this.mut(() => { n.images = [...new Set([...(n.images || []), ...ids])]; }, null, { inspector: true });
      });
      T.$$('[data-elabel]', box).forEach((inp) => {
        inp.addEventListener('input', () => { const e = this.edge(inp.dataset.elabel); this.app.mutate(this.c, () => { e.label = inp.value; }, 'elabel:' + e.id); this.drawEdges(this.pos); });
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') this.canvas.focus(); });
      });
      box.onclick = async (e) => {
        const ty = e.target.closest('[data-type]'); if (ty) return this.setType([n.id], ty.dataset.type);
        const co = e.target.closest('[data-color]'); if (co) return this.mut(() => { n.color = co.dataset.color; }, null, { inspector: true });
        const rm = e.target.closest('[data-rm]'); if (rm) return this.mut(() => { n.rules = n.rules.filter((_, i) => i !== +rm.dataset.rm); }, null, { inspector: true });
        const ar = e.target.closest('[data-addrule]'); if (ar) return this.mut(() => { n.rules = [...new Set([...(n.rules || []), ar.dataset.addrule])]; }, null, { inspector: true });
        const ri = e.target.closest('[data-rmimg]'); if (ri) { e.stopPropagation(); return this.mut(() => { n.images = n.images.filter((x) => x !== ri.dataset.rmimg); }, null, { inspector: true }); }
        const th = e.target.closest('[data-media]'); if (th) return this.app.viewMedia(th.dataset.media, imgs.map((m) => m.id));
        const go = e.target.closest('[data-go]'); if (go) { this.select([go.dataset.go]); return this.reveal(go.dataset.go); }
        const rme = e.target.closest('[data-rme]'); if (rme) return this.mut((c) => { c.edges = c.edges.filter((x) => x.id !== rme.dataset.rme); }, null, { inspector: true });
        const a = e.target.closest('[data-act]'); if (!a) return;
        const act = a.dataset.act;
        if (act === 'trace') this.startTrace(n.id);
        if (act === 'traceto') this.traceTo(n.id);
        if (act === 'menu') { const r = a.getBoundingClientRect(); this.nodeMenu(r.left - 160, r.bottom + 6); }
        if (act === 'child') this.addChild(n.id);
        if (act === 'open') window.api.open(n.link);
        if (act === 'addimg') {
          const list = await this.app.pickMedia({ multi: n.type !== 'person', title: n.type === 'person' ? 'Choose a photo' : 'Attach images to this step' });
          if (list && list.length) this.mut(() => { n.images = n.type === 'person' ? [list[0].id] : [...new Set([...(n.images || []), ...list.map((m) => m.id)])]; }, null, { inspector: true });
        }
      };
    }

    // ---------------------------------------------------------------- export
    // A static copy of the chart for PDFs: positioned nodes, edges and labels, offset so the top-left is 0,0.
    staticMarkup(pad = 24) {
      const b = this.bounds(); if (!b) return { html: '', w: 0, h: 0 };
      // include loop-back edges that stick out past the nodes
      let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
      for (const g of this.edgeEls.values()) if (g.r && g.r.back) { if (this.V) x1 = Math.max(x1, g.r.lx + 4); else y1 = Math.max(y1, g.r.ly + 4); }
      const w = Math.ceil(x1 - x0 + pad * 2), h = Math.ceil(y1 - y0 + pad * 2);
      const nodes = [...this.els].map(([id, el]) => { const p = this.pos.get(id); const c = el.cloneNode(true); c.classList.remove('sel', 'dim', 'cand', 'alt', 'current', 'on-path', 'hl', 'hl-dim'); c.style.transform = `translate(${p.x}px,${p.y}px)`; c.style.opacity = ''; c.querySelectorAll('.n-port,.n-choice').forEach((x) => x.remove()); return c.outerHTML; }).join('');
      const edges = [...this.edgeEls.values()].map((g) => `<path class="${g.path.getAttribute('class').replace(/\b(sel|dim|cand|alt|on-path|hl-dim)\b/g, '')}" d="${g.r.d}" marker-end="url(#arw)"/>`).join('');
      const labels = [...this.edgeEls.values()].filter((g) => !g.label.hidden).map((g) => `<div class="e-label ${g.label.className.replace(/\b(e-label|sel|dim|cand|on-path)\b/g, '')}" style="transform:translate(${g.r.lx}px,${g.r.ly}px) translate(-50%,-50%)">${T.esc(g.label.textContent)}</div>`).join('');
      const html = `<div class="static-chart" style="width:${w}px;height:${h}px"><div class="world" style="transform:translate(${pad - x0}px,${pad - y0}px)">
        <svg class="edges"><defs><marker id="arw" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0.5,1 L9,5 L0.5,9 Q2.5,5 0.5,1z" class="arw"/></marker></defs><g class="e-base">${edges}</g></svg>
        <div class="labels">${labels}</div><div class="nodes">${nodes}</div></div></div>`;
      return { html, w, h };
    }
  }

  T.ChartView = ChartView;
})();

// Trace — full-screen presenting for charts (live trace or a saved scenario), notes, guides and screenshot slideshows.
(function () {
  const T = window.T;

  function shell(app, title) {
    const el = T.el(`<div class="presenter">
      <div class="pr-top"><div class="pr-title">${T.esc(title)}</div><div class="grow"></div><div class="pr-tools"></div>
        <button class="icon-btn glass" data-pr="exit" title="Exit (Esc)">${T.icon('x', 17)}</button></div>
      <div class="pr-stage"></div>
      <div class="pr-foot"><div class="pr-progress"><i></i></div></div>
    </div>`);
    document.body.appendChild(el);
    let wasFull = false;
    window.api.fullscreen(true).then(() => { wasFull = true; }).catch(() => {});
    requestAnimationFrame(() => el.classList.add('in'));
    // hide the pointer and controls after a moment of stillness
    let idle;
    const wake = () => { el.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => el.classList.add('idle'), 2200); };
    el.addEventListener('pointermove', wake); wake();
    const close = () => {
      clearTimeout(idle);
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
      if (wasFull) window.api.fullscreen(false).catch(() => {});
      app.presenting = null;
    };
    return { el, stage: T.$('.pr-stage', el), tools: T.$('.pr-tools', el), close, progress: (f) => { T.$('.pr-progress i', el).style.width = (f * 100).toFixed(1) + '%'; } };
  }

  // Slides: an array of HTML strings. Arrow keys, space, click, Home/End.
  function slides(app, title, list, opts = {}) {
    const s = shell(app, title);
    let i = 0;
    s.tools.innerHTML = `<span class="pr-count"></span>`;
    const show = (n, dir = 1) => {
      i = T.clamp(n, 0, list.length - 1);
      const slide = T.el(`<div class="slide ${opts.cls || ''}">${list[i]}</div>`);
      const old = T.$('.slide', s.stage);
      if (old) { old.classList.add(dir > 0 ? 'leave-l' : 'leave-r'); setTimeout(() => old.remove(), 380); }
      slide.classList.add(dir > 0 ? 'enter-r' : 'enter-l');
      s.stage.appendChild(slide);
      requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.remove('enter-r', 'enter-l')));
      T.$('.pr-count', s.el).textContent = `${i + 1} / ${list.length}`;
      s.progress(list.length > 1 ? i / (list.length - 1) : 1);
      T.$$('a', slide).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.api.open(a.href); }));
    };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); return done(); }
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); if (i < list.length - 1) show(i + 1, 1); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); if (i > 0) show(i - 1, -1); }
      if (e.key === 'Home') show(0, -1);
      if (e.key === 'End') show(list.length - 1, 1);
    };
    const done = () => { document.removeEventListener('keydown', key, true); s.close(); };
    document.addEventListener('keydown', key, true);
    s.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-pr="exit"]')) return done();
      if (e.target.closest('button,a,.pr-top')) return;
      if (e.clientX > innerWidth * 0.3) { if (i < list.length - 1) show(i + 1, 1); } else if (i > 0) show(i - 1, -1);
    });
    show(0);
    app.presenting = { close: done };
  }

  // Split a note into slides at each H1/H2 and at dividers.
  function noteSlides(item) {
    const d = document.createElement('div');
    d.innerHTML = T.sanitize(item.html || '');
    const out = [];
    let cur = [];
    const push = () => { if (cur.length && cur.some((n) => (n.textContent || '').trim() || (n.querySelector && n.querySelector('img')))) out.push(cur.map((n) => n.outerHTML || T.esc(n.textContent)).join('')); cur = []; };
    for (const n of Array.from(d.childNodes)) {
      if (n.nodeType === 3 && !n.textContent.trim()) continue;
      if (n.tagName === 'HR') { push(); continue; }
      if ((n.tagName === 'H1' || n.tagName === 'H2') && cur.length) push();
      cur.push(n.nodeType === 3 ? Object.assign(document.createElement('p'), { textContent: n.textContent }) : n);
    }
    push();
    const head = `<div class="slide-cover"><div class="kicker">${T.icon('note', 14)} Note</div><h1>${T.esc(item.title || 'Untitled')}</h1></div>`;
    return [head, ...out.map((h) => `<div class="slide-doc rich">${h}</div>`)];
  }

  function guideSlides(app, item) {
    const pid = app.project.id;
    const cover = `<div class="slide-cover"><div class="kicker">${T.icon('guide', 14)} Guide · ${T.plural(item.steps.length, 'step')}</div><h1>${T.esc(item.title || 'Untitled')}</h1>${item.intro && T.textOf(item.intro) ? `<div class="rich lead">${T.sanitize(item.intro)}</div>` : ''}</div>`;
    return [cover, ...item.steps.map((s, i) => {
      const m = s.media && app.media.get(s.media);
      return `<div class="slide-step ${m ? '' : 'text-only'}">
        <div class="ss-text"><div class="ss-num">${i + 1}</div><h2>${T.esc(s.title || 'Step ' + (i + 1))}</h2>${s.html && T.textOf(s.html) ? `<div class="rich">${T.sanitize(s.html)}</div>` : ''}</div>
        ${m ? `<div class="ss-img">${T.annot.svg(m, T.mediaUrl(pid, m.file))}</div>` : ''}</div>`;
    })];
  }

  function chart(app, item, opts = {}) {
    const s = shell(app, item.title);
    const view = new T.ChartView(s.stage, { app, item, mode: 'present', onExit: () => {} });
    const sc = item.scenarios || [];
    const roots = item.nodes.filter((n) => !item.edges.some((e) => e.to === n.id));
    const done = () => { document.removeEventListener('keydown', key, true); view.destroy(); s.close(); };
    view.onExit = () => chooser();
    s.tools.innerHTML = `${sc.length ? `<button class="btn sm glass" data-pr="scen">${T.icon('bookmark')}Scenarios${T.icon('chevdown', 12)}</button>` : ''}<button class="btn sm glass" data-pr="live">${T.icon('trace')}Live trace</button><button class="icon-btn glass" data-pr="fit" title="Overview (F)">${T.icon('fit', 16)}</button>`;
    const start = (what) => {
      T.$('.pr-chooser', s.el) && T.$('.pr-chooser', s.el).remove();
      if (what === 'live') view.startTrace(roots.length > 1 ? undefined : (roots[0] || item.nodes[0] || {}).id);
      else { const x = sc.find((q) => q.id === what); if (x) view.playScenario(x, { speed: 2600 }); }
      view.canvas.focus();
    };
    // a start screen: the whole chart, plus the ways through it
    const chooser = () => {
      if (view.trace) view.endTrace();
      view.fit();
      s.progress(0);
      if (T.$('.pr-chooser', s.el)) return;
      const c = T.el(`<div class="pr-chooser"><div class="kicker">${T.icon('chart', 14)} ${T.plural(item.nodes.length, 'step')}</div><h1>${T.esc(item.title)}</h1>
        <div class="pr-ways"><button class="way primary" data-way="live">${T.icon('trace', 18)}<b>Walk through it live</b><span>Choose each branch as you go</span></button>
        ${sc.map((x) => `<button class="way" data-way="${x.id}" style="--c:${T.colorOf(x.color)}"><i class="dot"></i><b>${T.esc(x.name)}</b><span>${T.plural(x.path.length, 'step')} · plays on its own</span></button>`).join('')}</div>
        <p class="muted">Space or → to step · numbers pick a branch · ← back · Esc to leave</p></div>`);
      s.el.appendChild(c);
      c.addEventListener('click', (e) => { const w = e.target.closest('[data-way]'); if (w) start(w.dataset.way); });
    };
    const key = (e) => {
      if (T.$('.pr-chooser', s.el)) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return done(); }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); return start('live'); }
        if (/^[1-9]$/.test(e.key) && sc[+e.key - 1]) { e.stopPropagation(); return start(sc[+e.key - 1].id); }
        return;
      }
      if (e.key === 'Escape' && !view.trace) { e.preventDefault(); e.stopPropagation(); done(); }
    };
    document.addEventListener('keydown', key, true);
    // progress follows the trace
    const tick = setInterval(() => {
      if (!s.el.isConnected) return clearInterval(tick);
      const t = view.trace; if (!t || !t.path) return;
      const total = t.path.length + ((t.queue && t.queue.length) || 0);
      s.progress(total > 1 ? (t.path.length - 1) / (total - 1) : 0);
    }, 250);
    s.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pr]'); if (!b) return;
      if (b.dataset.pr === 'exit') return done();
      if (b.dataset.pr === 'fit') return view.fit();
      if (b.dataset.pr === 'live') return start('live');
      if (b.dataset.pr === 'scen') T.menuAt(b, sc.map((x) => ({ label: x.name, swatch: T.colorOf(x.color), onClick: () => start(x.id) })));
    });
    app.presenting = { close: done };
    setTimeout(() => { if (opts.scenario) start(opts.scenario); else chooser(); }, 450);
  }

  T.present = (app, item, opts = {}) => {
    if (app.presenting) app.presenting.close();
    if (item.type === 'chart') return chart(app, item, opts);
    if (item.type === 'note') return slides(app, item.title, noteSlides(item), { cls: 'doc-slide' });
    if (item.type === 'guide') {
      if (!item.steps.length) return T.toast('Add some steps first');
      return slides(app, item.title, guideSlides(app, item));
    }
  };
  T.presentMedia = (app, ids, title) => {
    const pid = app.project.id;
    const list = ids.map((id) => app.media.get(id)).filter(Boolean);
    if (!list.length) return;
    slides(app, title || 'Captures', list.map((m, i) => `<div class="slide-shot"><div class="ss-img">${T.annot.svg(m, T.mediaUrl(pid, m.file))}</div><div class="ss-cap"><b>${i + 1}</b>${T.esc(m.name || '')}</div></div>`));
  };
})();

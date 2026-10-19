/* Relay Reader — images, comics (.cbz/.zip), folders of pages and PDFs.
   Fit whole page / fit width / actual size, two-page spreads, right-to-left (manga), zoom & pan. */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const PDFJS = '../../node_modules/pdfjs-dist/build/pdf.min.mjs';
  const PDFJS_WORKER = '../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs';

  const prefs = (() => { try { return JSON.parse(localStorage.getItem('relay-reader') || '{}'); } catch { return {}; } })();
  const r = {
    root: null, book: null, page: 0, cache: new Map(), thumbCache: new Map(), dims: new Map(), pdf: null, pdfTask: null, pdfChain: Promise.resolve(), epoch: 0,
    spread: prefs.spread ?? false, cover: prefs.cover ?? true, rtl: prefs.rtl ?? false, fit: prefs.fit || 'page',
    zoom: 1, thumbs: false, saveT: null, token: 0
  };
  const savePrefs = () => { try { localStorage.setItem('relay-reader', JSON.stringify({ spread: r.spread, cover: r.cover, rtl: r.rtl, fit: r.fit })); } catch {} };

  /* ---------- opening ---------- */
  async function open(target) {
    try {
      const book = await relay.reader.open(target);
      start(book);
    } catch (e) { R().toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); }
  }
  async function openUrl({ url, title, partition }) {
    start({ id: 'url:' + url, kind: 'url', title: title || 'Image', file: url, pages: [url.split('/').pop().split('?')[0] || 'image'], start: 0, url, partition });
  }
  async function start(book) {
    if (r.book && r.book.id !== book.id && !String(r.book.id).startsWith('url:')) relay.reader.close(r.book.id);
    releaseBook();
    r.dims.clear();
    r.book = book; r.zoom = 1;
    if (!r.root) build();
    r.root.hidden = false;
    document.body.classList.add('overlay-open');
    $('#rdTitle', r.root).textContent = book.title;
    if (book.kind === 'pdf') {
      try {
        const lib = await import(PDFJS);
        lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, location.href).href;
        const bytes = await relay.reader.pdfBytes(book.id);
        r.pdfTask = lib.getDocument({ data: bytes });
        r.pdf = await r.pdfTask.promise;
        book.pages = Array.from({ length: r.pdf.numPages }, (_, i) => `Page ${i + 1}`);
      } catch (e) { R().toast('Couldn’t open this PDF: ' + e.message, 'error'); return close(); }
    }
    r.page = Math.min(book.start || 0, Math.max(0, book.pages.length - 1));
    if (book.pages.length === 1) r.spread = false;
    renderThumbs();
    show();
  }

  /* ---------- page images ---------- */
  async function pageUrl(i) {
    if (r.cache.has(i)) return r.cache.get(i);
    const b = r.book;
    let url;
    if (b.kind === 'url') {
      try { const res = await relay.reader.fetchUrl(b.url, b.partition); url = URL.createObjectURL(new Blob([res.data], { type: res.mime })); }
      catch { url = b.url; }
    } else if (b.kind === 'pdf') {
      url = await renderPdf(i, screenTarget());
      if (!url) return '';
    } else {
      const res = await relay.reader.page(b.id, i);
      if (!res) return '';
      url = URL.createObjectURL(new Blob([res.data], { type: res.mime }));
    }
    r.cache.set(i, url);
    // keep memory in check
    if (r.cache.size > 40) for (const k of [...r.cache.keys()]) { if (Math.abs(k - r.page) > 12) { URL.revokeObjectURL(r.cache.get(k)); r.cache.delete(k); } if (r.cache.size <= 30) break; }
    return url;
  }

  // PDF pages render one at a time (newest request first matters most), sized to the screen rather
  // than a fixed huge size, and pages you've already flipped far away from are skipped.
  function screenTarget() {
    const sc = r.root && $('#rdScroll', r.root);
    const dpr = window.devicePixelRatio || 1;
    const h = sc?.clientHeight || 900, w = (sc?.clientWidth || 1400) / (r.spread ? 2 : 1);
    return Math.round(Math.min(2600, Math.max(1100, Math.max(h, w) * dpr * 1.15)));
  }
  function renderPdf(i, target, thumb = false) {
    const pdf = r.pdf, epoch = r.epoch;
    const job = async () => {
      if (pdf !== r.pdf || epoch !== r.epoch) return '';
      if (!thumb && Math.abs(i - r.page) > 4) return ''; // flipped away — not worth rendering now
      const page = await pdf.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: target / Math.max(vp1.width, vp1.height) });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', thumb ? 0.75 : 0.88));
      c.width = c.height = 0; // free the canvas right away
      page.cleanup();
      return blob && pdf === r.pdf ? URL.createObjectURL(blob) : '';
    };
    const run = r.pdfChain.then(job, job);
    r.pdfChain = run.catch(() => {});
    return run;
  }
  async function thumbUrl(i) {
    if (r.book?.kind !== 'pdf') return pageUrl(i);
    if (r.thumbCache.has(i)) return r.thumbCache.get(i);
    const u = await renderPdf(i, 260, true);
    if (u) r.thumbCache.set(i, u);
    return u;
  }
  function releaseBook() {
    r.epoch++;
    r.cache.forEach(u => URL.revokeObjectURL(u)); r.cache.clear();
    r.thumbCache.forEach(u => URL.revokeObjectURL(u)); r.thumbCache.clear();
    const task = r.pdfTask;
    r.pdf = null; r.pdfTask = null; r.pdfChain = Promise.resolve();
    if (task) setTimeout(() => task.destroy().catch(() => {}), 0); // shuts down the PDF worker
    const stage = r.root && $('#rdPages', r.root); if (stage) stage.innerHTML = '';
    const strip = r.root && $('#rdThumbStrip', r.root); if (strip) strip.innerHTML = '';
  }

  // Which pages are on screen together
  function spreadFor(i) {
    const n = r.book.pages.length;
    if (!r.spread || n < 2) return [i];
    const wide = (k) => { const d = r.dims.get(k); return d && d.w > d.h * 1.1; };
    if (wide(i)) return [i];
    if (r.cover && i === 0) return [0];
    const base = r.cover ? (i % 2 === 1 ? i : i - 1) : (i % 2 === 0 ? i : i - 1);
    const pair = [base, base + 1].filter(k => k >= 0 && k < n && !wide(k));
    return pair.length ? pair : [i];
  }

  async function show() {
    const b = r.book;
    if (!b) return;
    const token = ++r.token;
    const pages = spreadFor(r.page);
    r.page = pages[0];
    const order = r.rtl ? [...pages].reverse() : pages;
    const urls = await Promise.all(order.map(pageUrl));
    if (token !== r.token) return;
    const stage = $('#rdPages', r.root);
    stage.className = `rd-pages fit-${r.fit} ${order.length === 2 ? 'two' : 'one'}`;
    stage.style.setProperty('--zoom', r.zoom);
    measure();
    stage.innerHTML = urls.map((u, k) => `<img src="${u}" data-p="${order[k]}" draggable="false" alt="" decoding="async">`).join('');
    $$('img', stage).forEach(img => img.onload = () => {
      const k = +img.dataset.p;
      const known = r.dims.has(k);
      r.dims.set(k, { w: img.naturalWidth, h: img.naturalHeight });
      // a wide (double-page) scan discovered after layout → re-flow the spread
      if (!known && r.spread && img.naturalWidth > img.naturalHeight * 1.1 && pages.length === 2) show();
    });
    const last = pages[pages.length - 1];
    $('#rdCount', r.root).textContent = b.pages.length > 1 ? `${pages.map(x => x + 1).join('–')} / ${b.pages.length}` : '';
    $('#rdSlider', r.root).max = b.pages.length - 1;
    $('#rdSlider', r.root).value = r.page;
    $('#rdSlider', r.root).style.direction = r.rtl ? 'rtl' : 'ltr';
    $('#rdZoomL', r.root).textContent = Math.round(r.zoom * 100) + '%';
    $$('.rd-thumb', r.root).forEach(t => t.classList.toggle('active', pages.includes(+t.dataset.p)));
    $('.rd-thumb.active', r.root)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    syncButtons();
    const sc = $('#rdScroll', r.root); sc.scrollTop = 0; sc.scrollLeft = r.rtl ? sc.scrollWidth : 0;
    // preload what's next
    const ahead = b.kind === 'pdf' ? [last + 1] : [last + 1, last + 2, pages[0] - 1];
    ahead.filter(k => k >= 0 && k < b.pages.length).forEach(k => pageUrl(k).catch(() => {}));
    if (b.kind !== 'url') { clearTimeout(r.saveT); r.saveT = setTimeout(() => relay.reader.progress({ file: b.file, page: r.page, total: b.pages.length }), 600); }
  }

  function step(dir) { // dir: +1 next, -1 previous (in reading order)
    const n = r.book.pages.length;
    const cur = spreadFor(r.page);
    let next = dir > 0 ? cur[cur.length - 1] + 1 : cur[0] - 1;
    if (next < 0 || next >= n) return;
    if (dir < 0) next = spreadFor(next)[0];
    r.page = next; r.zoom = r.fit === 'page' ? 1 : r.zoom; show();
  }
  const visualStep = (side) => step((side === 'right') !== r.rtl ? 1 : -1);

  /* ---------- UI ---------- */
  function build() {
    r.root = document.createElement('div');
    r.root.className = 'reader';
    r.root.innerHTML = `
      <div class="rd-top">
        <div class="pl-title"><span class="pl-badge rd">${ic('book', 11)} Relay Reader</span><b id="rdTitle"></b><small id="rdCount"></small></div>
        <div class="rd-tools">
          <div class="seg" id="rdFit">
            <button data-fit="page" title="Whole page">${ic('page', 15)}</button>
            <button data-fit="width" title="Fit width">${ic('fitWidth', 15)}</button>
            <button data-fit="original" title="Actual size">1:1</button>
          </div>
          <button class="icon-btn" id="rdSpread" title="Two pages side by side (D)">${ic('pages', 17)}</button>
          <button class="icon-btn" id="rdCover" title="Cover on its own (shift spreads by one page)">${ic('offset', 17)}</button>
          <button class="icon-btn" id="rdRtl" title="Right-to-left (manga)">${ic('rtl', 17)}</button>
          <span class="rd-div"></span>
          <button class="icon-btn" id="rdZoomOut" title="Zoom out (−)">${ic('zoomOut', 17)}</button>
          <button class="pl-chip" id="rdZoomL" title="Reset zoom (0)">100%</button>
          <button class="icon-btn" id="rdZoomIn" title="Zoom in (+)">${ic('zoomIn', 17)}</button>
          <span class="rd-div"></span>
          <button class="icon-btn" id="rdThumbs" title="Pages (T)">${ic('grid', 17)}</button>
          <button class="icon-btn" id="rdOpen" title="Open…">${ic('folder', 17)}</button>
          <button class="icon-btn" id="rdFull" title="Full screen (F)">${ic('fullscreen', 17)}</button>
          <button class="icon-btn" id="rdClose" title="Close (Esc)">${ic('x', 18)}</button>
        </div>
      </div>
      <div class="rd-body">
        <div class="rd-scroll" id="rdScroll">
          <div class="rd-pages" id="rdPages"></div>
        </div>
        <button class="rd-nav left" id="rdLeft" title="Previous">${ic('chevronLeft', 26)}</button>
        <button class="rd-nav right" id="rdRight" title="Next">${ic('chevronRight', 26)}</button>
      </div>
      <div class="rd-bottom"><input type="range" id="rdSlider" min="0" max="0" value="0"></div>
      <div class="rd-thumbs" id="rdThumbStrip" hidden></div>`;
    document.body.appendChild(r.root);

    $('#rdClose', r.root).onclick = close;
    $('#rdLeft', r.root).onclick = () => visualStep('left');
    $('#rdRight', r.root).onclick = () => visualStep('right');
    $$('#rdFit button', r.root).forEach(b => b.onclick = () => { r.fit = b.dataset.fit; r.zoom = 1; savePrefs(); show(); });
    $('#rdSpread', r.root).onclick = () => { r.spread = !r.spread; savePrefs(); show(); };
    $('#rdCover', r.root).onclick = () => { r.cover = !r.cover; savePrefs(); show(); };
    $('#rdRtl', r.root).onclick = () => { r.rtl = !r.rtl; savePrefs(); show(); };
    $('#rdZoomIn', r.root).onclick = () => zoom(1.25);
    $('#rdZoomOut', r.root).onclick = () => zoom(0.8);
    $('#rdZoomL', r.root).onclick = () => { r.zoom = 1; show(); };
    $('#rdThumbs', r.root).onclick = () => { r.thumbs = !r.thumbs; $('#rdThumbStrip', r.root).hidden = !r.thumbs; syncButtons(); renderThumbs(); };
    $('#rdFull', r.root).onclick = () => document.fullscreenElement ? document.exitFullscreen() : r.root.requestFullscreen().catch(() => {});
    $('#rdOpen', r.root).onclick = async () => { const f = await relay.media.pick('reader'); if (f[0]) open(f[0]); };
    $('#rdSlider', r.root).oninput = (e) => { r.page = +e.target.value; show(); };

    const sc = $('#rdScroll', r.root);
    // click left/right third of the page to turn, drag to pan when zoomed
    let drag = null;
    sc.addEventListener('mousedown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, moved: false }; });
    window.addEventListener('mousemove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; sc.scrollLeft = drag.sl - dx; sc.scrollTop = drag.st - dy; sc.classList.toggle('panning', drag.moved); });
    window.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const wasDrag = drag.moved; drag = null; sc.classList.remove('panning');
      if (wasDrag || r.root.hidden || !e.target.closest?.('#rdScroll')) return;
      const rect = sc.getBoundingClientRect(); const x = (e.clientX - rect.left) / rect.width;
      if (x < 0.3) visualStep('left'); else if (x > 0.7) visualStep('right');
    });
    sc.addEventListener('dblclick', (e) => { if (r.zoom > 1) { r.zoom = 1; show(); } else zoom(2, e); });
    sc.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e); return; }
      // in "whole page" mode, scrolling past the edge turns the page
      if (r.fit === 'page' && r.zoom === 1) {
        const now = Date.now();
        if (Math.abs(e.deltaY) > 25 && now - (r.lastWheel || 0) > 450) { r.lastWheel = now; step(e.deltaY > 0 ? 1 : -1); }
      }
    }, { passive: false });
    document.addEventListener('keydown', keys, true);
  }

  function measure() {
    const sc = $('#rdScroll', r.root), stage = $('#rdPages', r.root);
    if (!sc || !stage) return;
    stage.style.setProperty('--h', (sc.clientHeight - 24) + 'px');
    stage.style.setProperty('--w', (sc.clientWidth - 24) + 'px');
  }
  window.addEventListener('resize', () => { if (r.root && !r.root.hidden) measure(); });
  document.addEventListener('fullscreenchange', () => setTimeout(() => { if (r.root && !r.root.hidden) measure(); }, 50));

  function zoom(f, e) {
    const sc = $('#rdScroll', r.root);
    const before = r.zoom;
    r.zoom = Math.min(6, Math.max(0.25, r.zoom * f));
    const stage = $('#rdPages', r.root);
    stage.style.setProperty('--zoom', r.zoom);
    $('#rdZoomL', r.root).textContent = Math.round(r.zoom * 100) + '%';
    // keep the point under the cursor in place
    if (e && sc) {
      const rect = sc.getBoundingClientRect();
      const px = e.clientX - rect.left + sc.scrollLeft, py = e.clientY - rect.top + sc.scrollTop;
      const k = r.zoom / before;
      requestAnimationFrame(() => { sc.scrollLeft = px * k - (e.clientX - rect.left); sc.scrollTop = py * k - (e.clientY - rect.top); });
    }
    syncButtons();
  }

  function syncButtons() {
    if (!r.root) return;
    $$('#rdFit button', r.root).forEach(b => b.classList.toggle('active', b.dataset.fit === r.fit));
    $('#rdSpread', r.root).classList.toggle('on', r.spread);
    $('#rdCover', r.root).classList.toggle('on', r.cover);
    $('#rdCover', r.root).hidden = !r.spread;
    $('#rdRtl', r.root).classList.toggle('on', r.rtl);
    $('#rdThumbs', r.root).classList.toggle('on', r.thumbs);
    $('#rdScroll', r.root).classList.toggle('zoomed', r.zoom > 1 || r.fit !== 'page');
    const multi = r.book && r.book.pages.length > 1;
    $('#rdLeft', r.root).hidden = $('#rdRight', r.root).hidden = !multi;
    r.root.querySelector('.rd-bottom').hidden = !multi;
  }

  async function renderThumbs() {
    const strip = r.root && $('#rdThumbStrip', r.root);
    if (!strip || !r.thumbs || !r.book) return;
    const n = r.book.pages.length;
    strip.innerHTML = Array.from({ length: n }, (_, i) => `<button class="rd-thumb" data-p="${i}"><span class="ph"></span><small>${i + 1}</small></button>`).join('');
    strip.style.direction = r.rtl ? 'rtl' : 'ltr';
    $$('.rd-thumb', strip).forEach(t => t.onclick = () => { r.page = +t.dataset.p; show(); });
    // lazy-load thumbnails as they scroll into view
    const io = new IntersectionObserver((entries) => entries.forEach(async (en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const i = +en.target.dataset.p;
      try { const u = await thumbUrl(i); const ph = $('.ph', en.target); if (u && ph) ph.outerHTML = `<img src="${u}" alt="" loading="lazy" decoding="async">`; } catch {}
    }), { root: strip, rootMargin: '200px' });
    $$('.rd-thumb', strip).forEach(t => io.observe(t));
    syncButtons();
    $('.rd-thumb.active', strip)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function keys(e) {
    if (!r.root || r.root.hidden || e.target.closest?.('input:not([type=range]), textarea')) return;
    const map = {
      ArrowRight: () => visualStep('right'), ArrowLeft: () => visualStep('left'), ' ': () => step(e.shiftKey ? -1 : 1),
      PageDown: () => step(1), PageUp: () => step(-1), Home: () => { r.page = 0; show(); }, End: () => { r.page = r.book.pages.length - 1; show(); },
      d: () => $('#rdSpread', r.root).click(), t: () => $('#rdThumbs', r.root).click(), f: () => $('#rdFull', r.root).click(),
      '+': () => zoom(1.25), '=': () => zoom(1.25), '-': () => zoom(0.8), '0': () => { r.zoom = 1; show(); },
      Escape: () => { if (document.fullscreenElement) document.exitFullscreen(); else close(); }
    };
    const fn = map[e.key];
    if (fn && !e.metaKey) { e.preventDefault(); e.stopPropagation(); fn(); }
  }

  function close() {
    if (!r.root) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    r.root.hidden = true;
    document.body.classList.remove('overlay-open');
    const book = r.book;
    r.book = null;
    // tear down after the overlay is gone so closing feels instant
    setTimeout(() => { if (book && !String(book.id).startsWith('url:')) relay.reader.close(book.id); if (!r.book) releaseBook(); }, 30);
  }

  relay.reader.onOpenUrl((d) => openUrl(d));
  window.Reader = { open, openUrl, close, isOpen: () => r.root && !r.root.hidden };
})();

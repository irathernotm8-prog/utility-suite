(async () => {
  const d = await window.overlay.init();
  const $ = (id) => document.getElementById(id);
  if (!d) return window.overlay.done(null);
  $('shot').src = 'data:image/jpeg;base64,' + d.src;
  const last = d.last;
  if (last) Object.assign($('last').style, { display: 'block', left: last.x + 'px', top: last.y + 'px', width: last.w + 'px', height: last.h + 'px' });
  else $('rk').remove();
  let start = null, rect = null;
  const sel = $('sel'), size = $('size');
  const show = (r) => {
    $('dim').style.display = 'none';
    Object.assign(sel.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    size.style.display = 'block';
    size.textContent = Math.round(r.w) + ' × ' + Math.round(r.h);
    const below = r.y + r.h + 28 < innerHeight;
    size.style.left = Math.min(innerWidth - 90, r.x) + 'px';
    size.style.top = (below ? r.y + r.h + 8 : Math.max(4, r.y - 26)) + 'px';
  };
  addEventListener('pointermove', (e) => {
    $('ch').style.top = e.clientY + 'px'; $('cv').style.left = e.clientX + 'px';
    if (!start) return;
    rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
    if (e.shiftKey) { const s = Math.max(rect.w, rect.h); rect.w = rect.h = s; if (e.clientX < start.x) rect.x = start.x - s; if (e.clientY < start.y) rect.y = start.y - s; }
    show(rect);
  });
  addEventListener('pointerdown', (e) => { if (e.button !== 0) return; start = { x: e.clientX, y: e.clientY }; $('hint').style.opacity = '0'; $('last').style.display = 'none'; });
  addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    if (rect && rect.w >= 4 && rect.h >= 4) window.overlay.done(rect);
    else { rect = null; sel.style.display = 'none'; size.style.display = 'none'; $('dim').style.display = 'block'; $('hint').style.opacity = '1'; }
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.overlay.done(null);
    else if (e.key === 'Enter') window.overlay.done({ full: true });
    else if ((e.key === 'r' || e.key === 'R') && last) window.overlay.done({ x: last.x, y: last.y, w: last.w, h: last.h });
  });
  addEventListener('contextmenu', (e) => { e.preventDefault(); window.overlay.done(null); });
  window.focus();
})();

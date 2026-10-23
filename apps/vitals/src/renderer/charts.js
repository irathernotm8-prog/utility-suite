// Tiny canvas charts: rings, sparklines and two-series area charts with a hover crosshair. No libraries.
(function () {
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function fit(cv) {
    const dpr = window.devicePixelRatio || 1; const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height || cv.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h); return { x, w, h };
  }
  /** Ring gauge: v in 0..1; tone: 'acc' | 'warn' | 'bad' */
  function ring(cv, v, { tone = 'acc', width = 9, text = null } = {}) {
    const { x, w, h } = fit(cv); const c = Math.min(w, h) / 2; const r = c - width / 2 - 1;
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    x.lineCap = 'round'; x.lineWidth = width;
    x.strokeStyle = css('--track'); x.beginPath(); x.arc(w / 2, h / 2, r, a0, a0 + span); x.stroke();
    if (v != null && !isNaN(v)) {
      const vv = Math.max(0.004, Math.min(1, v));
      let st;
      if (tone === 'acc') { st = x.createLinearGradient(0, h, w, 0); st.addColorStop(0, css('--acc')); st.addColorStop(1, css('--acc-2')); }
      else st = css(tone === 'warn' ? '--warn' : '--bad');
      x.strokeStyle = st; x.beginPath(); x.arc(w / 2, h / 2, r, a0, a0 + span * vv); x.stroke();
    }
    if (text) { x.fillStyle = css('--fg'); x.font = `650 ${Math.round(c * 0.42)}px -apple-system, "Segoe UI", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 1); }
  }
  /** Sparkline of one series. max: fixed top (e.g. 100) or null for auto. */
  function spark(cv, data, { max = 100, color = '--acc', fill = true } = {}) {
    const { x, w, h } = fit(cv); const d = (data || []).filter((v) => v != null);
    if (d.length < 2) return;
    const top = max || Math.max(1, ...d) * 1.15; const n = d.length; const step = w / (Math.max(n, 30) - 1);
    const off = w - (n - 1) * step;
    const pts = d.map((v, i) => [off + i * step, h - 2 - (Math.min(v, top) / top) * (h - 4)]);
    const col = css(color);
    if (fill) { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00'); x.fillStyle = g; x.beginPath(); x.moveTo(pts[0][0], h); pts.forEach((p) => x.lineTo(p[0], p[1])); x.lineTo(pts[n - 1][0], h); x.closePath(); x.fill(); }
    x.strokeStyle = col; x.lineWidth = 1.6; x.lineJoin = 'round'; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke();
  }
  /**
   * Area chart for up to two series over the same timeline, with gridlines and a hover crosshair.
   * series: [{ data, color, label }], fmt: value → string, t: timestamps
   */
  function area(cv, series, { t = [], fmt = (v) => String(v), max = null } = {}) {
    const { x, w, h } = fit(cv);
    const all = series.flatMap((s) => s.data.filter((v) => v != null));
    const top = max || niceMax(Math.max(1, ...all));
    const pad = { l: 0, r: 0, t: 6, b: 4 };
    const n = Math.max(...series.map((s) => s.data.length), 2); const N = Math.max(n, 60);
    const step = (w - pad.l - pad.r) / (N - 1); const off = w - pad.r - (n - 1) * step;
    const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - Math.min(v, top) / top);
    x.strokeStyle = css('--line'); x.lineWidth = 1; x.font = '10.5px -apple-system, "Segoe UI", sans-serif'; x.fillStyle = css('--mut'); x.textBaseline = 'top';
    for (let i = 1; i <= 3; i++) { const yy = Math.round(Y(top * i / 4)) + .5; x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke(); }
    x.textAlign = 'left'; x.fillText(fmt(top), 4, pad.t);
    series.forEach((s) => {
      const col = css(s.color); const pts = s.data.map((v, i) => (v == null ? null : [off + i * step, Y(v)])).filter(Boolean);
      if (pts.length < 2) return;
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '40'); g.addColorStop(1, col + '00');
      x.fillStyle = g; x.beginPath(); x.moveTo(pts[0][0], h); pts.forEach((p) => x.lineTo(p[0], p[1])); x.lineTo(pts[pts.length - 1][0], h); x.closePath(); x.fill();
      x.strokeStyle = col; x.lineWidth = 2; x.lineJoin = 'round'; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke();
    });
    cv._chart = { series, t, fmt, off, step, n, Y, h, w };
    if (cv._hover != null) crosshair(cv);
    if (!cv._wired) wireHover(cv);
  }
  function crosshair(cv) {
    const c = cv._chart; if (!c) return; const i = cv._hover; if (i == null || i < 0 || i >= c.n) return;
    const x = cv.getContext('2d'); const px = c.off + i * c.step;
    x.strokeStyle = css('--line-3'); x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(px) + .5, 0); x.lineTo(Math.round(px) + .5, c.h); x.stroke();
    c.series.forEach((s) => { const v = s.data[i]; if (v == null) return; x.fillStyle = css(s.color); x.strokeStyle = css('--panel'); x.lineWidth = 2; x.beginPath(); x.arc(px, c.Y(v), 4, 0, Math.PI * 2); x.fill(); x.stroke(); });
  }
  function wireHover(cv) {
    cv._wired = true; const tip = document.getElementById('tip');
    cv.addEventListener('mousemove', (e) => {
      const c = cv._chart; if (!c) return; const r = cv.getBoundingClientRect();
      const i = Math.round((e.clientX - r.left - c.off) / c.step); if (i < 0 || i >= c.n) { cv._hover = null; tip.hidden = true; return; }
      cv._hover = i; area(cv, c.series, { t: c.t, fmt: c.fmt, max: cv._max });
      const ts = c.t[c.t.length - c.n + i]; const ago = ts ? Math.round((Date.now() - ts) / 1000) : null;
      tip.innerHTML = `<div class="muted small">${ago == null ? '' : ago < 3 ? 'now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ${ago % 60}s ago`}</div>` + c.series.map((s) => `<div><i class="lg" style="background:${css(s.color)}"></i> ${s.label} <b>${s.data[i] == null ? '–' : c.fmt(s.data[i])}</b></div>`).join('');
      tip.hidden = false; tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14) + 'px'; tip.style.top = (e.clientY - 10 - tip.offsetHeight) + 'px';
    });
    cv.addEventListener('mouseleave', () => { cv._hover = null; tip.hidden = true; const c = cv._chart; if (c) area(cv, c.series, { t: c.t, fmt: c.fmt, max: cv._max }); });
  }
  function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  window.Charts = { ring, spark, area, css };
})();

// Tiny dependency-free SVG charts. Colours come from CSS variables so light/dark just works.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a = {}, kids = []) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); kids.forEach((c) => e.append(c)); return e; };
  const nice = (max) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

  function spark(values, color) {
    const w = 200, h = 36, max = Math.max(...values, 1e-9), min = Math.min(...values, 0);
    const x = (i) => (values.length < 2 ? 0 : (i / (values.length - 1)) * w);
    const y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' });
    svg.append(el('path', { d: `M${pts[0]} L${pts.join(' L')} L${w},${h} L0,${h}Z`, fill: color, opacity: '.12' }));
    svg.append(el('path', { d: `M${pts.join(' L')}`, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    return svg;
  }

  // Two-series daily chart: spend as columns (left axis), conversions as a line (right axis).
  function daily(box, series, fmt, opt) {
    opt = opt || { a: { key: 'spend', label: 'Spend', fmt: fmt.money }, b: { key: 'conversions', label: 'Conversions', fmt: fmt.num } };
    const A = opt.a, B = opt.b;
    box.innerHTML = '';
    const W = box.clientWidth || 700, H = 250, m = { l: 46, r: 40, t: 10, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, n = series.length;
    const sMax = nice(Math.max(...series.map((d) => d[A.key]), 1)), cMax = nice(Math.max(...series.map((d) => d[B.key]), 1));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': `Daily ${A.label} and ${B.label}` });
    for (let i = 0; i <= 4; i++) {
      const yy = m.t + ih - (i / 4) * ih;
      svg.append(el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'grid' }));
      const a = el('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }); a.textContent = fmt.compact(sMax * i / 4); svg.append(a);
      const b = el('text', { x: W - m.r + 8, y: yy + 4 }); b.textContent = Math.round(cMax * i / 4); svg.append(b);
    }
    const bw = Math.max(1, Math.min(18, iw / n - 2));
    const cx = (i) => m.l + (n === 1 ? iw / 2 : (i + 0.5) * (iw / n));
    series.forEach((d, i) => {
      const bh = (d[A.key] / sMax) * ih;
      svg.append(el('rect', { x: cx(i) - bw / 2, y: m.t + ih - bh, width: bw, height: Math.max(bh, 0), rx: Math.min(3, bw / 2), fill: 'var(--c1)', opacity: '.85' }));
    });
    const line = series.map((d, i) => `${cx(i).toFixed(1)},${(m.t + ih - (d[B.key] / cMax) * ih).toFixed(1)}`);
    svg.append(el('path', { d: 'M' + line.join(' L'), fill: 'none', stroke: 'var(--c2)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const step = Math.max(1, Math.ceil(n / 7));
    series.forEach((d, i) => { if (i % step === 0) { const t = el('text', { x: cx(i), y: H - 6, 'text-anchor': 'middle' }); t.textContent = d.date.slice(5); svg.append(t); } });

    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true;
    const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect(); const px = e.clientX - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.floor(((px - m.l) / iw) * n))); const d = series[i];
      tip.hidden = false; tip.innerHTML = `<b>${d.date}</b><br>${A.label} ${A.fmt(d[A.key])}<br>${B.label} ${B.fmt(d[B.key])}`;
      tip.style.left = Math.min(W - 150, Math.max(0, cx(i) + 12)) + 'px'; tip.style.top = '8px';
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
    svg.append(hit);
    box.append(svg, tip);
  }

  window.Charts = { spark, daily };
})();

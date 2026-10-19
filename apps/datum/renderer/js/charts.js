// Datum - chart rendering (Chart.js) shared by every sheet type
(function () {
  const C = (D.charts = {});
  C.TYPES = [
    { id: 'bar', label: 'Column', icon: 'chart' },
    { id: 'hbar', label: 'Bar', icon: 'chart' },
    { id: 'stacked', label: 'Stacked column', icon: 'chart' },
    { id: 'line', label: 'Line', icon: 'line' },
    { id: 'area', label: 'Area', icon: 'line' },
    { id: 'pie', label: 'Pie', icon: 'pie' },
    { id: 'doughnut', label: 'Doughnut', icon: 'pie' },
    { id: 'combo', label: 'Bar + line', icon: 'chart' },
    { id: 'scatter', label: 'Scatter', icon: 'line' }
  ];
  if (window.Chart) {
    Chart.defaults.font.family = "'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.color = '#4B5563';
    Chart.defaults.animation = false;
    Chart.defaults.responsive = false;
    Chart.defaults.devicePixelRatio = Math.max(2, window.devicePixelRatio || 1);
  }

  C.palette = (e) => (e && e.colors && e.colors.length ? e.colors : D.brand().palette || D.DEFAULT_BRAND.palette);
  C.dataFor = (e) => (e.link ? D.f.chartData(e.link, { seriesIn: e.seriesIn, cols: e.seriesCols }) : e.staticData) || null;
  C.allSeries = (e) => (e.link ? (D.f.chartData(e.link, {}) || { series: [] }).series : []);

  const alpha = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const numTick = (v) => (typeof v === 'number' ? D.f.format(v, Math.abs(v) >= 1000 ? 'compact' : null) : v);
  // category axis: show the label (shortened), not its index
  function catTick(v) { const l = this.getLabelForValue ? this.getLabelForValue(v) : v; const s = String(l ?? ''); return s.length > 28 ? s.slice(0, 26) + '…' : s; }
  C.config = (e, data, { w, h, scale = 1 } = {}) => {
    const t = e.chartType || 'bar';
    const pal = C.palette(e);
    const round = t === 'pie' || t === 'doughnut';
    const fs = Math.max(9, Math.round(11 * scale * (e.fontScale || 1)));
    if (t === 'scatter') return scatterConfig(e, data, pal, fs, scale);
    const series = round ? data.series.slice(0, 1) : data.series;
    const datasets = series.map((s, i) => {
      const col = pal[i % pal.length];
      if (round) return { label: s.name, data: s.values, backgroundColor: data.labels.map((_, j) => pal[j % pal.length]), borderColor: '#fff', borderWidth: 2 };
      if (t === 'combo' && i > 0) return { type: 'line', label: s.name, data: s.values, yAxisID: 'y1', borderColor: col, backgroundColor: col, tension: 0.35, pointRadius: Math.max(2.5, 3.5 * scale), pointBackgroundColor: '#fff', pointBorderWidth: 2, borderWidth: Math.max(1.5, 2.5 * scale), order: 0 };
      if (t === 'line' || t === 'area') return { label: s.name, data: s.values, borderColor: col, backgroundColor: t === 'area' ? alpha(col, 0.18) : col, fill: t === 'area' ? 'origin' : false, tension: 0.35, pointRadius: Math.max(2, 3 * scale), pointBackgroundColor: col, borderWidth: Math.max(1.5, 2.5 * scale) };
      return { label: s.name, data: s.values, backgroundColor: e.colorEach && series.length === 1 ? data.labels.map((_, j) => pal[j % pal.length]) : col, borderRadius: Math.max(2, 4 * scale), maxBarThickness: 64 * scale, borderSkipped: false };
    });
    const showLegend = e.legend === false ? false : (series.length > 1 || round);
    const grid = { color: '#E8ECF4', drawTicks: false };
    const cfg = {
      type: round ? t : (t === 'area' ? 'line' : t === 'hbar' || t === 'stacked' || t === 'combo' ? 'bar' : t),
      data: { labels: data.labels, datasets },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        indexAxis: t === 'hbar' ? 'y' : 'x',
        layout: { padding: Math.round(8 * scale) },
        cutout: t === 'doughnut' ? '62%' : undefined,
        plugins: {
          legend: { display: showLegend, position: round ? 'right' : 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', font: { size: fs }, padding: 10 * scale } },
          title: { display: !!e.title, text: e.title, align: 'start', color: '#111827', font: { size: Math.round(fs * 1.25), weight: '600' }, padding: { bottom: 10 * scale } },
          tooltip: { enabled: true }
        },
        scales: round ? {} : {
          x: { stacked: t === 'stacked', beginAtZero: t === 'hbar' || undefined, grid: t === 'hbar' ? grid : { display: false }, border: { display: false }, ticks: { font: { size: fs }, padding: 6 * scale, maxRotation: 0, autoSkip: true, ...(t === 'hbar' ? { callback: numTick } : { callback: catTick }) } },
          y: { stacked: t === 'stacked', beginAtZero: true, grid: t === 'hbar' ? { display: false } : grid, border: { display: false }, ticks: { font: { size: fs }, padding: 6 * scale, autoSkip: t !== 'hbar', callback: t === 'hbar' ? catTick : numTick }, title: t === 'combo' && series[0] ? { display: true, text: series[0].name, font: { size: fs } } : undefined },
          ...(t === 'combo' && series.length > 1 ? { y1: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { font: { size: fs }, padding: 6 * scale, callback: (v) => D.f.format(v, Math.abs(v) >= 1000 ? 'compact' : null) }, title: { display: true, text: series[1].name, font: { size: fs } } } } : {})
        }
      },
      plugins: []
    };
    // shares: axis in percent, and a 100% stacked chart tops out at 100%
    if (e.valueFormat === 'pct' && !round) {
      const ax = t === 'hbar' ? cfg.options.scales.x : cfg.options.scales.y;
      ax.ticks.callback = (v) => D.f.format(v, 'pct', { dec: 0 });
      if (e.max100) ax.max = 1;
    }
    if (e.colorEach && series.length === 1) cfg.options.plugins.legend.display = false;
    if (e.showValues) cfg.plugins.push(valueLabels(fs, t, e.valueFormat));
    if (e.showValues && t === 'hbar') cfg.options.layout.padding = { top: Math.round(8 * scale), bottom: Math.round(8 * scale), left: Math.round(8 * scale), right: Math.round(46 * scale) };
    return cfg;
  };

  // scatter: first series is x, second is y; each point keeps its row label
  function scatterConfig(e, data, pal, fs, scale) {
    const [sx, sy] = data.series;
    const pts = sx && sy ? data.labels.map((l, i) => ({ x: sx.values[i], y: sy.values[i], label: l })).filter((p) => p.x != null && p.y != null) : [];
    const col = pal[0];
    const fmt = (v) => D.f.format(v, Math.abs(v) >= 1000 ? 'compact' : null);
    const grid = { color: '#E8ECF4', drawTicks: false };
    const cfg = {
      type: 'scatter',
      data: { datasets: [{ label: sy ? sy.name : '', data: pts, backgroundColor: alpha(col, 0.75), borderColor: col, pointRadius: Math.max(3, 5 * scale), pointHoverRadius: Math.max(4, 6 * scale) }] },
      options: {
        animation: false, responsive: false, maintainAspectRatio: false,
        layout: { padding: Math.round(10 * scale) },
        plugins: {
          legend: { display: false },
          title: { display: !!e.title, text: e.title, align: 'start', color: '#111827', font: { size: Math.round(fs * 1.25), weight: '600' }, padding: { bottom: 10 * scale } },
          tooltip: { callbacks: { label: (c) => `${c.raw.label}: ${fmt(c.raw.x)}, ${fmt(c.raw.y)}` } }
        },
        scales: {
          x: { grid, border: { display: false }, ticks: { font: { size: fs }, callback: fmt }, title: { display: !!sx, text: sx ? sx.name : '', font: { size: fs } } },
          y: { grid, border: { display: false }, beginAtZero: true, ticks: { font: { size: fs }, callback: fmt }, title: { display: !!sy, text: sy ? sy.name : '', font: { size: fs } } }
        }
      },
      plugins: []
    };
    if (e.showValues && pts.length <= 30) cfg.plugins.push({
      id: 'ptLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart; const meta = chart.getDatasetMeta(0);
        ctx.save(); ctx.font = `500 ${Math.max(8, fs - 1)}px 'Inter Variable', Inter, sans-serif`; ctx.fillStyle = '#374151'; ctx.textBaseline = 'middle';
        const area = chart.chartArea;
        const boxes = [];
        const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
        const lh = Math.max(8, fs - 1) + 2;
        // label the points that stand out first (furthest from the centre), skip any label that would overlap
        const cx = (area.left + area.right) / 2, cy = (area.top + area.bottom) / 2;
        meta.data.map((pt, i) => ({ pt, i, d: Math.hypot(pt.x - cx, pt.y - cy) })).sort((a, b) => b.d - a.d).forEach(({ pt, i }) => {
          const txt = String(pts[i].label || '').replace(/\s+(campaign|ad set|store|product)$/i, '');
          const w = ctx.measureText(txt).width;
          for (const [dx, al] of [[7, 'left'], [-7, 'right']]) {
            const x0 = al === 'left' ? pt.x + dx : pt.x + dx - w;
            const b = { x: x0, y: pt.y - lh / 2, w, h: lh };
            if (x0 < area.left || x0 + w > area.right + 30 || hit(b)) continue;
            boxes.push(b); ctx.textAlign = al; ctx.fillText(txt, pt.x + dx, pt.y);
            break;
          }
        });
        ctx.restore();
      }
    });
    return cfg;
  }

  function valueLabels(fs, t, vf) {
    return {
      id: 'vals',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = `600 ${fs}px 'Inter Variable', Inter, sans-serif`;
        ctx.fillStyle = '#1F2937';
        chart.data.datasets.forEach((ds, i) => {
          if (t === 'combo' && i > 0) return;
          const meta = chart.getDatasetMeta(i);
          meta.data.forEach((pt, j) => {
            const v = ds.data[j];
            if (v == null) return;
            const txt = vf && !(Math.abs(v) >= 100000) ? D.f.format(v, vf) : D.f.format(v, Math.abs(v) >= 10000 ? 'compact' : null);
            if (t === 'pie' || t === 'doughnut') {
              const p = pt.tooltipPosition();
              ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(txt, p.x, p.y);
            } else if (t === 'hbar') {
              ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, pt.x + 4, pt.y);
            } else {
              ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, pt.x, pt.y - 3);
            }
          });
        });
        ctx.restore();
      }
    };
  }

  // Render into a host element (replaces content). Returns the Chart instance.
  C.render = (host, e, { w, h, scale = 1 } = {}) => {
    if (host._chart) { host._chart.destroy(); host._chart = null; }
    host.innerHTML = '';
    const data = C.dataFor(e);
    if (!data || !data.series.length) {
      host.append(D.h('div', { class: 'chart-empty', html: `${D.icon('chart', 22)}<span>${e.link ? 'No numeric data in ' + D.esc(e.link.range) : 'Link a data range'}</span>` }));
      return null;
    }
    const cv = D.h('canvas', { width: Math.max(10, Math.round(w)), height: Math.max(10, Math.round(h)) });
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    host.append(cv);
    try {
      host._chart = new Chart(cv.getContext('2d'), C.config(e, data, { w, h, scale }));
    } catch (err) { console.error(err); }
    return host._chart;
  };

  // Offscreen render to PNG data URL (used for docs, PDFs, thumbnails)
  C.toPng = (e, w, h, scale = 1) => {
    const data = C.dataFor(e);
    if (!data || !data.series.length) return null;
    const cv = document.createElement('canvas');
    const dpr = 2;
    cv.width = w; cv.height = h;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const holder = D.h('div', { style: { position: 'fixed', left: '-99999px', top: '0', width: w + 'px', height: h + 'px' } }, cv);
    document.body.append(holder);
    let url = null;
    try {
      const cfg = C.config(e, data, { w, h, scale });
      cfg.options.devicePixelRatio = dpr;
      cfg.plugins.push({ id: 'bg', beforeDraw: (ch) => { const c = ch.ctx; c.save(); c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, ch.width, ch.height); c.restore(); } });
      const ch = new Chart(cv.getContext('2d'), cfg);
      url = cv.toDataURL('image/png');
      ch.destroy();
    } catch (err) { console.error(err); }
    holder.remove();
    return url;
  };
})();

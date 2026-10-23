// Touchline — small SVG charts: pitch markings, momentum, shot maps, line charts.
(() => {
  const C = (window.Charts = {});
  const esc = UI.esc;

  // Full pitch markings, 68 x 105, vertical (goals top and bottom)
  C.pitchLines = (vertical = true) => {
    const s = 'stroke="var(--pitch-line)" stroke-width="0.5" fill="none"';
    const v = `<svg class="lines" viewBox="0 0 68 105" preserveAspectRatio="none">
      <rect x="2" y="2" width="64" height="101" ${s}/><line x1="2" y1="52.5" x2="66" y2="52.5" ${s}/>
      <circle cx="34" cy="52.5" r="9.15" ${s}/><circle cx="34" cy="52.5" r="0.6" fill="var(--pitch-line)"/>
      <rect x="13.84" y="2" width="40.32" height="16.5" ${s}/><rect x="24.84" y="2" width="18.32" height="5.5" ${s}/>
      <rect x="13.84" y="86.5" width="40.32" height="16.5" ${s}/><rect x="24.84" y="97.5" width="18.32" height="5.5" ${s}/>
      <path d="M26.7 18.5a9.15 9.15 0 0 0 14.6 0M26.7 86.5a9.15 9.15 0 0 1 14.6 0" ${s}/></svg>`;
    if (vertical) return v;
    return `<svg class="lines" viewBox="0 0 105 68" preserveAspectRatio="none">
      <rect x="2" y="2" width="101" height="64" ${s}/><line x1="52.5" y1="2" x2="52.5" y2="66" ${s}/>
      <circle cx="52.5" cy="34" r="9.15" ${s}/><rect x="2" y="13.84" width="16.5" height="40.32" ${s}/><rect x="86.5" y="13.84" width="16.5" height="40.32" ${s}/>
      <rect x="2" y="24.84" width="5.5" height="18.32" ${s}/><rect x="97.5" y="24.84" width="5.5" height="18.32" ${s}/></svg>`;
  };

  // Momentum: values -100..100 per minute; positive = home pressure
  C.momentum = (points, homeColor = 'var(--accent)', awayColor = 'var(--mute)') => {
    if (!points || points.length < 3) return '';
    const W = 900, H = 90, mid = H / 2;
    const maxMin = Math.max(90, ...points.map((p) => p[0]));
    const x = (m) => (m / maxMin) * W;
    const y = (v) => mid - (v / 100) * (mid - 4);
    let up = `M0 ${mid}`, down = `M0 ${mid}`;
    for (const [m, v] of points) { up += ` L${x(m).toFixed(1)} ${Math.min(mid, y(v)).toFixed(1)}`; down += ` L${x(m).toFixed(1)} ${Math.max(mid, y(v)).toFixed(1)}`; }
    up += ` L${W} ${mid} Z`; down += ` L${W} ${mid} Z`;
    const ticks = [15, 30, 45, 60, 75, 90].map((m) => `<line x1="${x(m)}" y1="0" x2="${x(m)}" y2="${H}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="${x(m) - 3}" y="${H - 2}" text-anchor="end" font-size="10" fill="var(--mute)">${m}'</text>`).join('');
    return `<svg class="momentum" viewBox="0 0 ${W} ${H}">${ticks}<path d="${up}" fill="${homeColor}" opacity=".85"/><path d="${down}" fill="${awayColor}" opacity=".85"/><line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="var(--line-2)"/></svg>`;
  };

  // Shot map on a horizontal pitch; FotMob shot x/y are in metres on a 105 x 68 pitch, attacking right.
  // Home shots are drawn attacking right, away shots mirrored to attack left.
  C.shotmap = (shots, homeId, colors = {}) => {
    const s = 'stroke="var(--pitch-line)" stroke-width="0.35" fill="none"';
    const dots = shots.map((sh) => {
      const home = sh.teamId === homeId;
      const X = home ? sh.x : 105 - sh.x, Y = home ? sh.y : 68 - sh.y;
      const r = 0.9 + Math.sqrt(Math.max(sh.xg || 0.03, 0.02)) * 3.4;
      const goal = sh.type === 'Goal';
      const col = home ? (colors.home || 'var(--accent)') : (colors.away || '#7cc4ff');
      return `<circle cx="${X.toFixed(2)}" cy="${Y.toFixed(2)}" r="${r.toFixed(2)}" fill="${goal ? col : 'transparent'}" stroke="${col}" stroke-width="${goal ? 0.2 : 0.35}" opacity="${goal ? 1 : 0.85}"><title>${esc(sh.player)} ${sh.minute}' · ${esc(sh.type)}${sh.xg != null ? ` · xG ${Number(sh.xg).toFixed(2)}` : ''}</title></circle>`;
    }).join('');
    return `<div class="pitch h" style="border-radius:12px"><svg class="shotmap" viewBox="0 0 105 68" style="position:absolute;inset:0;width:100%;height:100%">
      <rect x="0.5" y="0.5" width="104" height="67" ${s}/><line x1="52.5" y1="0.5" x2="52.5" y2="67.5" ${s}/><circle cx="52.5" cy="34" r="9.15" ${s}/>
      <rect x="0.5" y="13.84" width="16.5" height="40.32" ${s}/><rect x="88" y="13.84" width="16.5" height="40.32" ${s}/>
      <rect x="0.5" y="24.84" width="5.5" height="18.32" ${s}/><rect x="99" y="24.84" width="5.5" height="18.32" ${s}/>
      ${dots}</svg></div>`;
  };

  // Single-player shot map on a half pitch (attacking up)
  C.halfShots = (shots) => {
    const s = 'stroke="var(--pitch-line)" stroke-width="0.35" fill="none"';
    const dots = (shots || []).map((sh) => {
      const X = sh.y, Y = 105 - sh.x; // rotate: goal at top
      const r = 0.9 + Math.sqrt(Math.max(sh.xg || 0.03, 0.02)) * 3.2;
      const goal = sh.type === 'Goal';
      return `<circle cx="${X.toFixed(2)}" cy="${Y.toFixed(2)}" r="${r.toFixed(2)}" fill="${goal ? 'var(--accent)' : 'transparent'}" stroke="${goal ? 'var(--accent)' : 'rgba(255,255,255,.75)'}" stroke-width=".35"><title>${sh.minute}' · ${esc(sh.type)}${sh.xg != null ? ` · xG ${Number(sh.xg).toFixed(2)}` : ''}</title></circle>`;
    }).join('');
    return `<div class="pitch" style="aspect-ratio:68/52.5;border-radius:12px"><svg viewBox="0 0 68 52.5" style="position:absolute;inset:0;width:100%;height:100%">
      <rect x="0.5" y="0.5" width="67" height="60" ${s}/><rect x="13.84" y="0.5" width="40.32" height="16.5" ${s}/><rect x="24.84" y="0.5" width="18.32" height="5.5" ${s}/>
      <path d="M26.7 17a9.15 9.15 0 0 0 14.6 0" ${s}/><path d="M24.85 52.5a9.15 9.15 0 0 1 18.3 0" ${s}/>${dots}</svg></div>`;
  };

  // Line chart. series: [{ x: label, y: number }]. invert: lower is better (league position)
  C.line = (series, { height = 180, invert = false, min, max, fmt = (v) => v, color = 'var(--accent)', labelEvery, integer = false } = {}) => {
    if (!series.length) return '';
    const W = 900, H = height, pl = 34, pr = 10, pt = 12, pb = 26;
    const ys = series.map((p) => p.y);
    const lo = min ?? Math.min(...ys), hi = max ?? Math.max(...ys);
    const span = hi - lo || 1;
    const x = (i) => pl + (series.length === 1 ? (W - pl - pr) / 2 : (i / (series.length - 1)) * (W - pl - pr));
    const y = (v) => invert ? pt + ((v - lo) / span) * (H - pt - pb) : H - pb - ((v - lo) / span) * (H - pt - pb);
    const step = integer ? Math.max(1, Math.ceil(span / 5)) : 0;
    const tickVals = integer ? Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => lo + i * step) : [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * span);
    const grid = tickVals.map((v) => { const yy = y(v); return `<line class="gridline" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${pl - 6}" y="${yy + 3}" text-anchor="end">${esc(fmt(Math.round(v * 10) / 10))}</text>`; }).join('');
    const every = labelEvery || Math.max(1, Math.ceil(series.length / 12));
    const labels = series.map((p, i) => (i % every === 0 || i === series.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.x)}</text>` : '')).join('');
    const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ');
    const area = `${path} L${x(series.length - 1)} ${H - pb} L${x(0)} ${H - pb} Z`;
    const dots = series.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="${p.mark ? 5 : 3}" fill="${p.color || color}" stroke="var(--panel)" stroke-width="1.5"><title>${esc(p.x)}: ${esc(p.label ?? fmt(p.y))}</title></circle>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}${invert ? '' : `<path d="${area}" fill="${color}" opacity=".10"/>`}<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
  };

  // Percentile colour
  C.pctColor = (p) => (p == null ? 'var(--line-2)' : p >= 80 ? '#2fd27e' : p >= 60 ? '#a6e05a' : p >= 40 ? '#f2c94c' : p >= 20 ? '#f59e4c' : '#ff6b6b');
})();

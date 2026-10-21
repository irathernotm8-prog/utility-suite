// Trace — builds the print-ready HTML that the main process turns into a PDF.
(function () {
  const T = window.T;
  const PAGE = { letter: { w: 8.5, h: 11, css: 'letter' }, a4: { w: 8.27, h: 11.69, css: 'A4' } };
  const MARGIN = 0.5; // inches

  // The app's own stylesheet (for node and chart styling) with print-only rules on top.
  function appCss() {
    let css = '';
    for (const sh of Array.from(document.styleSheets)) {
      try { if (sh.href && !sh.href.endsWith('styles.css')) continue; css += Array.from(sh.cssRules).map((r) => r.cssText).join('\n'); } catch (_) {}
    }
    return css;
  }
  const PRINT = `
    html,body{background:#fff !important;color:#16171c;height:auto !important;overflow:visible !important}
    body{margin:0;font:12.5px/1.55 -apple-system,"SF Pro Text","Segoe UI Variable","Segoe UI",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .pdoc{max-width:none;margin:0}
    .p-head{display:flex;align-items:flex-end;gap:12px;border-bottom:1px solid #e6e6ee;padding-bottom:10px;margin-bottom:18px}
    .p-head h1{font-size:24px;line-height:1.2;margin:0;letter-spacing:-.01em}
    .p-kicker{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#7b7d8c;font-weight:600;margin-bottom:4px}
    .p-meta{margin-left:auto;color:#7b7d8c;font-size:11px;white-space:nowrap}
    .rich{font-size:12.5px}
    .rich h1{font-size:20px;margin:18px 0 8px}.rich h2{font-size:16px;margin:16px 0 6px}.rich h3{font-size:13.5px;margin:14px 0 4px}
    .rich p{margin:0 0 8px}.rich img{max-width:100%;max-height:7in;border-radius:6px;border:1px solid #e6e6ee}
    .rich blockquote{border-left:3px solid #9d8cff;margin:10px 0;padding:4px 12px;color:#444;background:#f6f5ff;border-radius:0 6px 6px 0}
    .rich pre{background:#f4f4f7;padding:10px 12px;border-radius:6px;white-space:pre-wrap;font-size:11px}
    .rich code{background:#f1f1f5;border-radius:4px;padding:1px 4px;font-size:11px}
    .rich ul.checklist{list-style:none;padding-left:4px}
    .rich ul.checklist li{position:relative;padding-left:22px}
    .rich ul.checklist li::before{content:"";position:absolute;left:0;top:3px;width:12px;height:12px;border:1.5px solid #9a9cab;border-radius:3px}
    .rich ul.checklist li[data-checked="true"]::before{background:#7c6cf2;border-color:#7c6cf2}
    .rich ul.checklist li[data-checked="true"]{color:#8a8c99;text-decoration:line-through}
    .rich a{color:#5b4fe0}
    .pbreak{break-before:page}
    .chart-sheet{page:chart;display:flex;flex-direction:column;height:100%}
    .chart-sheet .p-head{margin-bottom:10px}
    .chart-fit{flex:1;display:flex;align-items:flex-start;justify-content:center;overflow:hidden}
    .static-chart{position:relative;transform-origin:0 0}
    .static-chart .world{position:absolute;left:0;top:0;transform-origin:0 0}
    .static-chart .edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible}
    .static-chart .node{position:absolute;left:0;top:0;box-shadow:none !important}
    .static-chart .node .n-port,.static-chart .node .n-choice{display:none}
    .nlist{margin-top:6px}
    .nitem{break-inside:avoid;padding:12px 0;border-top:1px solid #eeeef3;display:grid;grid-template-columns:28px 1fr;gap:10px}
    .nitem .num{width:22px;height:22px;border-radius:7px;background:var(--c);color:#fff;font-weight:700;font-size:11px;display:grid;place-items:center;margin-top:2px}
    .nitem h3{margin:0;font-size:14px}.nitem .sub{color:#6b6d7c;font-size:11.5px;margin-top:1px}
    .nitem .path{color:#8a8c99;font-size:10.5px;margin-bottom:2px}
    .nitem .imgs{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.nitem .imgs svg{max-width:3.2in;max-height:2.4in;width:auto;height:auto;border-radius:6px;border:1px solid #e6e6ee}
    .nitem .rules{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}.nitem .rules span{font-size:10.5px;background:#f2f1fb;border:1px solid #e3e0f7;border-radius:5px;padding:1px 6px;color:#4a3fb8}
    .scen{break-inside:avoid;margin:10px 0;padding:10px 12px;border:1px solid #eeeef3;border-left:4px solid var(--c);border-radius:8px}
    .scen h3{margin:0 0 4px;font-size:13.5px}.scen ol{margin:0;padding-left:18px}.scen li em{color:#7b7d8c;font-style:normal;font-size:11px;margin-right:4px}
    .gstep{break-inside:avoid;display:grid;grid-template-columns:34px 1fr;gap:12px;padding:16px 0;border-top:1px solid #eeeef3}
    .gstep .num{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#8c7bff,#4fc8ff);color:#fff;font-weight:700;display:grid;place-items:center}
    .gstep h3{margin:2px 0 4px;font-size:15px}
    .gstep .shot svg{display:block;max-width:100%;max-height:5.6in;width:auto;height:auto;margin-top:10px;border-radius:8px;border:1px solid #e3e3ea}
    .cover{padding-top:1.4in}.cover h1{font-size:34px;line-height:1.15;margin:8px 0 12px;letter-spacing:-.015em}.cover .rich{font-size:14px;color:#3d3f4a;max-width:6in}
    .toc{margin-top:28px}.toc li{margin:4px 0}
    .foot{color:#9a9cab;font-size:10px;margin-top:22px}
    .shot-page{break-inside:avoid;margin-bottom:18px}.shot-page svg{display:block;max-width:100%;max-height:8in;width:auto;height:auto;border-radius:8px;border:1px solid #e3e3ea}.shot-page .cap{margin-top:6px;color:#555}
  `;
  function doc(body, opts) {
    const p = PAGE[opts.paper || 'letter'];
    const chartPage = opts.chartPage || `${p.css} landscape`;
    return `<!doctype html><html data-theme="light" class="print"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src trace-media: data:; style-src 'unsafe-inline'">
      <title>${T.esc(opts.title || 'Trace')}</title>
      <style>${appCss()}</style><style>@page{size:${p.css};margin:${MARGIN}in}@page chart{size:${chartPage};margin:${opts.chartMargin != null ? opts.chartMargin : MARGIN}in}${PRINT}</style></head>
      <body>${body}</body></html>`;
  }
  const head = (kicker, title, meta) => `<div class="p-head"><div><div class="p-kicker">${T.esc(kicker)}</div><h1>${T.esc(title || 'Untitled')}</h1></div><div class="p-meta">${T.esc(meta || '')}</div></div>`;
  const today = () => new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  const imgSvg = (app, m) => T.annot.svg(m, T.mediaUrl(app.project.id, m.file));

  // ---- note ----
  function noteBody(app, item) {
    return `<article class="pdoc">${head(app.project.name + ' · Note', item.title, today())}<div class="rich">${T.sanitize(item.html || '')}</div></article>`;
  }

  // ---- chart: one page with the whole chart, then the notes on each step and the scenarios ----
  function chartBody(app, item, snap, opts) {
    const p = PAGE[opts.paper || 'letter'];
    let fit, chartPage, chartMargin;
    if (opts.poster) {
      // one page exactly the size of the chart: crisp at any zoom
      const s = Math.min(1, 14400 / Math.max(snap.w, snap.h));
      fit = `<div class="static-wrap" style="width:${snap.w * s}px;height:${snap.h * s}px"><div style="transform:scale(${s});transform-origin:0 0">${snap.html}</div></div>`;
      chartPage = `${Math.ceil(snap.w * s + 48)}px ${Math.ceil(snap.h * s + 120)}px`;
      chartMargin = 0.25;
    } else {
      const land = snap.w >= snap.h * 0.9;
      const pw = (land ? p.h : p.w) - MARGIN * 2, ph = (land ? p.w : p.h) - MARGIN * 2;
      const W = pw * 96, H = ph * 96 - 74;
      const s = Math.min(1, W / snap.w, H / snap.h);
      fit = `<div class="static-wrap" style="width:${snap.w * s}px;height:${snap.h * s}px"><div style="transform:scale(${s});transform-origin:0 0">${snap.html}</div></div>`;
      chartPage = `${p.css} ${land ? 'landscape' : 'portrait'}`;
    }
    const nodes = orderNodes(item);
    const withNotes = nodes.filter((n) => (n.note && T.textOf(n.note)) || (n.images && n.images.length) || n.link || (n.rules && n.rules.length));
    let notes = '';
    if (opts.notes && withNotes.length) {
      notes = `<article class="pdoc pbreak">${head(item.title, 'Steps and notes', T.plural(withNotes.length, 'step'))}<div class="nlist">${withNotes.map((n) => {
        const tp = T.NODE_TYPES[n.type] || T.NODE_TYPES.step;
        const path = T.layout.pathTo(item.nodes, item.edges, n.id) || [];
        const crumbs = path.slice(0, -1).map((id) => (item.nodes.find((x) => x.id === id) || {}).title || 'Untitled').join(' › ');
        const imgs = (n.images || []).map((id) => app.media.get(id)).filter(Boolean);
        return `<div class="nitem" style="--c:${T.colorOf(n.color || tp.color)}"><div class="num">${nodes.indexOf(n) + 1}</div><div>
          ${crumbs ? `<div class="path">${T.esc(crumbs)}</div>` : ''}<h3>${T.esc(n.title || 'Untitled')}</h3>${n.sub ? `<div class="sub">${T.esc(n.sub)}</div>` : ''}
          ${n.rules && n.rules.length ? `<div class="rules">${n.rules.map((r) => `<span>${T.esc(r)}</span>`).join('')}</div>` : ''}
          ${n.note && T.textOf(n.note) ? `<div class="rich" style="margin-top:6px">${T.sanitize(n.note)}</div>` : ''}
          ${n.link ? `<div class="sub"><a href="${T.esc(n.link)}">${T.esc(n.link)}</a></div>` : ''}
          ${imgs.length ? `<div class="imgs">${imgs.map((m) => imgSvg(app, m)).join('')}</div>` : ''}</div></div>`;
      }).join('')}</div></article>`;
    }
    let scen = '';
    if (opts.scenarios && (item.scenarios || []).length) {
      scen = `<article class="pdoc pbreak">${head(item.title, 'Scenarios', T.plural(item.scenarios.length, 'path'))}${item.scenarios.map((s) => `<div class="scen" style="--c:${T.colorOf(s.color)}"><h3>${T.esc(s.name)}</h3><ol>${s.path.map((id, i) => {
        const n = item.nodes.find((x) => x.id === id); const e = i ? item.edges.find((x) => x.from === s.path[i - 1] && x.to === id) : null;
        return n ? `<li>${e && e.label ? `<em>${T.esc(e.label)}</em>` : ''}${T.esc(n.title || 'Untitled')}</li>` : '';
      }).join('')}</ol></div>`).join('')}</article>`;
    }
    const sheet = `<section class="chart-sheet">${head(app.project.name + ' · Chart', item.title, today() + ' · ' + T.plural(item.nodes.length, 'step'))}<div class="chart-fit">${fit}</div></section>`;
    return { body: sheet + notes + scen, chartPage, chartMargin };
  }
  // reading order: breadth-first from the roots, following edge order
  function orderNodes(item) {
    const seen = new Set(), out = [];
    const q = item.nodes.filter((n) => !item.edges.some((e) => e.to === n.id)).map((n) => n.id);
    while (q.length) {
      const id = q.shift(); if (seen.has(id)) continue; seen.add(id);
      const n = item.nodes.find((x) => x.id === id); if (n) out.push(n);
      item.edges.filter((e) => e.from === id).forEach((e) => q.push(e.to));
    }
    item.nodes.forEach((n) => { if (!seen.has(n.id)) out.push(n); });
    return out;
  }

  // ---- guide ----
  function guideBody(app, item) {
    const steps = item.steps.map((s, i) => {
      const m = s.media && app.media.get(s.media);
      return `<div class="gstep"><div class="num">${i + 1}</div><div><h3>${T.esc(s.title || 'Step ' + (i + 1))}</h3>${s.html && T.textOf(s.html) ? `<div class="rich">${T.sanitize(s.html)}</div>` : ''}${m ? `<div class="shot">${imgSvg(app, m)}</div>` : ''}</div></div>`;
    }).join('');
    return `<article class="pdoc">${head(app.project.name + ' · Guide', item.title, today() + ' · ' + T.plural(item.steps.length, 'step'))}
      ${item.intro && T.textOf(item.intro) ? `<div class="rich" style="margin-bottom:8px">${T.sanitize(item.intro)}</div>` : ''}${steps}</article>`;
  }

  function mediaBody(app, ids, title) {
    return `<article class="pdoc">${head(app.project.name + ' · Screenshots', title, today())}${ids.map((id, i) => { const m = app.media.get(id); return m ? `<div class="shot-page">${imgSvg(app, m)}<div class="cap"><b>${i + 1}.</b> ${T.esc(m.name || '')}</div></div>` : ''; }).join('')}</article>`;
  }

  T.exportHtml = { doc, noteBody, chartBody, guideBody, mediaBody, head, today };
})();

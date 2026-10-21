// Trace — screenshot annotations: arrows, boxes, highlights, text, numbered steps, blur and crop.
// Annotations are stored in image pixels on the media sidecar and drawn as SVG over the untouched original.
(function () {
  const T = window.T;
  const COLORS = ['#ff4d6d', '#ffb020', '#22c55e', '#3b82f6', '#9d8cff', '#111318', '#ffffff'];
  const unit = (m) => Math.max(m.w, m.h) / 1000;
  const defaults = (m) => ({ sw: Math.max(3, Math.round(unit(m) * 4.2)), fs: Math.max(14, Math.round(unit(m) * 26)) });
  const norm = (a) => ({ x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) });

  function shapeSvg(a, m, ids, href) {
    const sw = a.sw || defaults(m).sw, c = a.color || COLORS[0];
    const data = `data-id="${a.id}"`;
    switch (a.t) {
      case 'arrow': {
        const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const hl = Math.min(len * 0.6, sw * 4.6), hw = sw * 2.6;
        const bx = a.x2 - ux * hl, by = a.y2 - uy * hl;
        const head = `${a.x2},${a.y2} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`;
        return `<g ${data} class="an an-arrow"><line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="transparent" stroke-width="${sw * 5}"/>
          <line x1="${a.x1}" y1="${a.y1}" x2="${bx + ux * sw * 0.5}" y2="${by + uy * sw * 0.5}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>
          <polygon points="${head}" fill="${c}" stroke="${c}" stroke-width="${sw * 0.4}" stroke-linejoin="round"/></g>`;
      }
      case 'box': { const r = norm(a); return `<rect ${data} class="an" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${sw * 1.6}" fill="transparent" stroke="${c}" stroke-width="${sw}"/>`; }
      case 'ellipse': { const r = norm(a); return `<ellipse ${data} class="an" cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}" fill="transparent" stroke="${c}" stroke-width="${sw}"/>`; }
      case 'highlight': { const r = norm(a); return `<rect ${data} class="an" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${sw}" fill="${c}" fill-opacity="0.32"/>`; }
      case 'blur': {
        const r = norm(a), k = ids + a.id;
        return `<g ${data} class="an"><clipPath id="c${k}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${sw}"/></clipPath>
          <g clip-path="url(#c${k})"><image href="${href}" x="0" y="0" width="${m.w}" height="${m.h}" filter="url(#b${ids})" preserveAspectRatio="none"/>
          <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#888" fill-opacity="0.18"/></g></g>`;
      }
      case 'text': {
        const fs = a.fs || defaults(m).fs;
        const lines = String(a.text || '').split('\n');
        const halo = c.toLowerCase() === '#ffffff' ? '#111318' : '#ffffff';
        return `<text ${data} class="an an-text" x="${a.x1}" y="${a.y1}" font-size="${fs}" font-weight="650" fill="${c}" stroke="${halo}" stroke-width="${fs * 0.16}" paint-order="stroke" stroke-linejoin="round"
          font-family="-apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif">${lines.map((l, i) => `<tspan x="${a.x1}" dy="${i ? fs * 1.2 : fs * 0.85}">${T.esc(l) || ' '}</tspan>`).join('')}</text>`;
      }
      case 'number': {
        const r = (a.fs || defaults(m).fs) * 0.82;
        return `<g ${data} class="an"><circle cx="${a.x1}" cy="${a.y1}" r="${r}" fill="${c}" stroke="#fff" stroke-width="${r * 0.14}"/>
          <text x="${a.x1}" y="${a.y1}" font-size="${r * 1.12}" font-weight="700" fill="${c.toLowerCase() === '#ffffff' ? '#111318' : '#fff'}" text-anchor="middle" dominant-baseline="central"
          font-family="-apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif">${a.n || 1}</text></g>`;
      }
    }
    return '';
  }

  // Full SVG for an annotated image. href: URL or data URL of the original. opts.crop=false shows the whole image.
  function svg(m, href, opts = {}) {
    const ids = 'a' + T.uid(5);
    const c = opts.crop === false || !m.crop ? { x: 0, y: 0, w: m.w, h: m.h } : m.crop;
    const size = opts.size ? `width="${c.w}" height="${c.h}"` : '';
    return `<svg class="ann ${opts.cls || ''}" xmlns="http://www.w3.org/2000/svg" viewBox="${c.x} ${c.y} ${c.w} ${c.h}" ${size} preserveAspectRatio="xMidYMid meet">
      <defs><filter id="b${ids}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${Math.max(6, unit(m) * 14)}"/></filter></defs>
      <image href="${href}" x="0" y="0" width="${m.w}" height="${m.h}" preserveAspectRatio="none"/>
      ${(m.annotations || []).map((a) => shapeSvg(a, m, ids, href)).join('')}${opts.extra || ''}</svg>`;
  }

  // Annotated image → PNG bytes (Uint8Array), flattened at the original resolution.
  async function toPng(pid, m) {
    const data = await window.api.mediaDataUrl(pid, m.id);
    const s = svg(m, data, { size: true });
    const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not draw that image.')); img.src = url; });
      const c = m.crop || { w: m.w, h: m.h };
      const cv = document.createElement('canvas');
      cv.width = Math.round(c.w); cv.height = Math.round(c.h);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    } finally { URL.revokeObjectURL(url); }
  }

  // ---- editor ----
  const TOOLS = [
    ['select', 'cursor', 'Select & move (V)', 'v'], ['arrow', 'arrow', 'Arrow (A)', 'a'], ['box', 'box', 'Box (B)', 'b'], ['ellipse', 'circle', 'Circle (O)', 'o'],
    ['highlight', 'highlight', 'Highlight (H)', 'h'], ['text', 'text', 'Text (T)', 't'], ['number', 'number', 'Step number (N)', 'n'], ['blur', 'blur', 'Blur (X)', 'x'], ['crop', 'crop', 'Crop (C)', 'c']
  ];

  function edit(app, media, opts = {}) {
    return new Promise((resolve) => {
      const pid = app.project.id;
      const m = T.clone(media);
      m.annotations = m.annotations || [];
      const href = T.mediaUrl(pid, m.file);
      const d = defaults(m);
      let tool = m.annotations.length ? 'select' : 'arrow', color = COLORS[0], size = 1, selected = null, drawing = null, cropDraft = null;
      const undo = [], redo = [];
      const snap = () => { undo.push(JSON.stringify({ a: m.annotations, c: m.crop })); if (undo.length > 80) undo.shift(); redo.length = 0; };

      const host = T.el(`<div class="annot">
        <div class="annot-bar">
          <div class="seg tools">${TOOLS.map(([k, ic, tip]) => `<button class="icon-btn" data-tool="${k}" title="${tip}">${T.icon(ic, 17)}</button>`).join('')}</div>
          <div class="seg colors">${COLORS.map((c) => `<button class="swatch" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</div>
          <div class="seg sizes">${[['S', 0.6], ['M', 1], ['L', 1.6]].map(([l, v]) => `<button class="icon-btn txt" data-size="${v}" title="Size ${l}">${l}</button>`).join('')}</div>
          <div class="seg"><button class="icon-btn" data-act="undo" title="Undo">${T.icon('undo', 17)}</button><button class="icon-btn" data-act="redo" title="Redo">${T.icon('redo', 17)}</button>
            <button class="icon-btn" data-act="del" title="Delete selected">${T.icon('trash', 17)}</button></div>
          <div class="grow"></div>
          <input class="input name" placeholder="Name this screenshot" value="${T.esc(m.name || '')}">
          <button class="btn ghost" data-act="copy" title="Copy annotated image">${T.icon('copy')}Copy</button>
          <button class="btn ghost" data-act="png">${T.icon('download')}PNG</button>
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn primary" data-act="done">Done</button>
        </div>
        <div class="annot-stage"><div class="annot-wrap"></div><div class="annot-hint"></div></div>
      </div>`);
      document.body.appendChild(host);
      const wrap = T.$('.annot-wrap', host), stage = T.$('.annot-stage', host);
      let svgEl;

      const hints = { select: 'Click a mark to select it, drag to move, Delete to remove. Double-click text to edit.', arrow: 'Drag from what you’re explaining to the thing to click.', box: 'Drag a box around something.',
        ellipse: 'Drag to circle something.', highlight: 'Drag over text to highlight it.', text: 'Click where the text should go.', number: 'Click to drop numbered steps: 1, 2, 3…', blur: 'Drag over anything private to blur it.',
        crop: 'Drag the area to keep. Click once to remove the crop.' };

      function fit() {
        const c = tool === 'crop' || !m.crop ? { w: m.w, h: m.h } : m.crop;
        const W = stage.clientWidth - 48, H = stage.clientHeight - 48;
        const k = Math.min(W / c.w, H / c.h, 1.25 / (m.scale || 1));
        wrap.style.width = Math.round(c.w * k) + 'px'; wrap.style.height = Math.round(c.h * k) + 'px';
      }
      function draw() {
        const extra = [];
        if (tool === 'crop') {
          const r = cropDraft ? norm(cropDraft) : m.crop;
          if (r) extra.push(`<path d="M0,0H${m.w}V${m.h}H0Z M${r.x},${r.y}v${r.h}h${r.w}v${-r.h}Z" fill="rgba(0,0,0,.55)" fill-rule="evenodd"/><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#fff" stroke-width="${d.sw * 0.5}" stroke-dasharray="${d.sw * 2}"/>`);
        }
        const sel = selected && m.annotations.find((a) => a.id === selected);
        if (sel && tool === 'select') {
          const pts = sel.t === 'text' || sel.t === 'number' ? [] : [[sel.x1, sel.y1, 'p1'], [sel.x2, sel.y2, 'p2']];
          const bb = bbox(sel);
          extra.push(`<rect x="${bb.x - d.sw}" y="${bb.y - d.sw}" width="${bb.w + d.sw * 2}" height="${bb.h + d.sw * 2}" fill="none" stroke="#9d8cff" stroke-width="${d.sw * 0.4}" stroke-dasharray="${d.sw * 1.5}" pointer-events="none"/>`);
          for (const [x, y, k] of pts) extra.push(`<circle class="handle" data-h="${k}" cx="${x}" cy="${y}" r="${d.sw * 1.8}" fill="#fff" stroke="#9d8cff" stroke-width="${d.sw * 0.5}"/>`);
        }
        const view = tool === 'crop' ? { ...m, crop: null } : m;
        wrap.innerHTML = svg(view, href, { extra: extra.join(''), cls: 'tool-' + tool });
        svgEl = wrap.firstElementChild;
        T.$$('[data-tool]', host).forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
        T.$$('[data-color]', host).forEach((b) => b.classList.toggle('on', b.dataset.color === color));
        T.$$('[data-size]', host).forEach((b) => b.classList.toggle('on', +b.dataset.size === size));
        T.$('.annot-hint', host).textContent = hints[tool];
      }
      function bbox(a) {
        if (a.t === 'text') { const fs = a.fs || d.fs; const lines = String(a.text || ' ').split('\n'); return { x: a.x1, y: a.y1, w: Math.max(...lines.map((l) => l.length)) * fs * 0.56 + 4, h: lines.length * fs * 1.2 }; }
        if (a.t === 'number') { const r = (a.fs || d.fs) * 0.82; return { x: a.x1 - r, y: a.y1 - r, w: r * 2, h: r * 2 }; }
        return norm(a);
      }
      const pt = (e) => { const p = svgEl.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const r = p.matrixTransform(svgEl.getScreenCTM().inverse()); return { x: Math.round(r.x), y: Math.round(r.y) }; };
      const setTool = (t) => { tool = t; selected = null; fit(); draw(); };

      function editText(a) {
        const r = svgEl.getBoundingClientRect(), vb = svgEl.viewBox.baseVal, k = r.width / vb.width;
        const fs = (a.fs || d.fs) * k;
        const ta = T.el(`<textarea class="annot-text" spellcheck="false" style="left:${r.left + (a.x1 - vb.x) * k}px;top:${r.top + (a.y1 - vb.y) * k}px;font-size:${fs}px;color:${a.color}"></textarea>`);
        ta.value = a.text || '';
        document.body.appendChild(ta);
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = Math.max(120, ...ta.value.split('\n').map((l) => l.length * fs * 0.6 + 30)) + 'px'; };
        grow(); ta.focus();
        ta.addEventListener('input', grow);
        const commit = () => {
          if (!ta.isConnected) return;
          const v = ta.value.replace(/\s+$/, '');
          ta.remove();
          if (!v) m.annotations = m.annotations.filter((x) => x.id !== a.id); else a.text = v;
          draw();
        };
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.stopPropagation(); commit(); } });
        ta.addEventListener('blur', commit);
      }

      wrap.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const p = pt(e);
        const hit = e.target.closest('[data-id]'), handle = e.target.closest('.handle');
        if (tool === 'select') {
          if (handle && selected) {
            const a = m.annotations.find((x) => x.id === selected); snap();
            T.drag(e, (ev) => { const q = pt(ev); if (handle.dataset.h === 'p1') { a.x1 = q.x; a.y1 = q.y; } else { a.x2 = q.x; a.y2 = q.y; } draw(); });
            return;
          }
          selected = hit ? hit.dataset.id : null;
          draw();
          if (!selected) return;
          const a = m.annotations.find((x) => x.id === selected);
          const o = { ...a }; let moved = false;
          T.drag(e, (ev) => {
            const q = pt(ev);
            if (!moved) { snap(); moved = true; }
            a.x1 = o.x1 + q.x - p.x; a.y1 = o.y1 + q.y - p.y; a.x2 = o.x2 + q.x - p.x; a.y2 = o.y2 + q.y - p.y; draw();
          });
          return;
        }
        if (tool === 'crop') {
          cropDraft = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
          T.drag(e, (ev) => { const q = pt(ev); cropDraft.x2 = T.clamp(q.x, 0, m.w); cropDraft.y2 = T.clamp(q.y, 0, m.h); draw(); }, () => {
            const r = norm(cropDraft); cropDraft = null; snap();
            m.crop = r.w > 8 && r.h > 8 ? r : null;
            setTool('select');
          });
          return;
        }
        const s = Math.round(d.sw * size), fs = Math.round(d.fs * size);
        if (tool === 'text') { snap(); const a = { id: T.uid(6), t: 'text', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, fs, text: '' }; m.annotations.push(a); draw(); setTimeout(() => editText(a), 0); return; }
        if (tool === 'number') {
          snap();
          const n = Math.max(0, ...m.annotations.filter((a) => a.t === 'number').map((a) => a.n || 0)) + 1;
          m.annotations.push({ id: T.uid(6), t: 'number', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, fs, n }); draw(); return;
        }
        snap();
        drawing = { id: T.uid(6), t: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: tool === 'highlight' && color === COLORS[0] ? '#ffd23f' : color, sw: s };
        m.annotations.push(drawing);
        T.drag(e, (ev) => {
          const q = pt(ev);
          drawing.x2 = q.x; drawing.y2 = q.y;
          if (ev.shiftKey && tool !== 'arrow') { const k = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)); drawing.x2 = p.x + Math.sign(q.x - p.x || 1) * k; drawing.y2 = p.y + Math.sign(q.y - p.y || 1) * k; }
          draw();
        }, () => {
          if (Math.hypot(drawing.x2 - drawing.x1, drawing.y2 - drawing.y1) < d.sw * 2) { m.annotations = m.annotations.filter((a) => a !== drawing); undo.pop(); }
          drawing = null; draw();
        });
      });
      wrap.addEventListener('dblclick', (e) => {
        const hit = e.target.closest('[data-id]');
        const a = hit && m.annotations.find((x) => x.id === hit.dataset.id);
        if (a && a.t === 'text') { snap(); editText(a); }
        if (tool === 'crop' && m.crop) { snap(); m.crop = null; draw(); }
      });

      host.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.tool) return setTool(b.dataset.tool);
        if (b.dataset.color) {
          color = b.dataset.color;
          const a = selected && m.annotations.find((x) => x.id === selected); if (a) { snap(); a.color = color; }
          return draw();
        }
        if (b.dataset.size) {
          size = +b.dataset.size;
          const a = selected && m.annotations.find((x) => x.id === selected);
          if (a) { snap(); if (a.t === 'text' || a.t === 'number') a.fs = Math.round(d.fs * size); else a.sw = Math.round(d.sw * size); }
          return draw();
        }
        const act = b.dataset.act;
        if (act === 'undo' && undo.length) { redo.push(JSON.stringify({ a: m.annotations, c: m.crop })); const s = JSON.parse(undo.pop()); m.annotations = s.a; m.crop = s.c; selected = null; fit(); draw(); }
        if (act === 'redo' && redo.length) { undo.push(JSON.stringify({ a: m.annotations, c: m.crop })); const s = JSON.parse(redo.pop()); m.annotations = s.a; m.crop = s.c; selected = null; fit(); draw(); }
        if (act === 'del' && selected) { snap(); m.annotations = m.annotations.filter((x) => x.id !== selected); selected = null; draw(); }
        if (act === 'copy') { try { await window.api.copyImage(await toPng(pid, m)); T.toast('Copied the annotated image'); } catch (err) { T.toast(err.message, { kind: 'error' }); } }
        if (act === 'png') { try { const f = await window.api.saveFile(await toPng(pid, m), m.name || 'Screenshot', 'png'); if (f) T.toast('Saved', { action: 'Show', onAction: () => window.api.reveal(f) }); } catch (err) { T.toast(err.message, { kind: 'error' }); } }
        if (act === 'cancel') close(null);
        if (act === 'done') close(m);
      });
      const nameInput = T.$('.name', host);
      nameInput.addEventListener('input', () => { m.name = nameInput.value; });

      const key = (e) => {
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
        const k = e.key.toLowerCase();
        if (T.mod(e) && k === 'z') { e.preventDefault(); T.$(`[data-act="${e.shiftKey ? 'redo' : 'undo'}"]`, host).click(); return; }
        if (T.mod(e) && k === 'c') { e.preventDefault(); T.$('[data-act="copy"]', host).click(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (selected) { selected = null; draw(); } else close(m); return; }
        if (e.key === 'Enter' && T.mod(e)) { close(m); return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); T.$('[data-act="del"]', host).click(); return; }
        const t = TOOLS.find((x) => x[3] === k); if (t && !T.mod(e)) setTool(t[0]);
        if (/^[1-7]$/.test(k) && !T.mod(e)) { color = COLORS[+k - 1]; draw(); }
      };
      document.addEventListener('keydown', key, true);
      const ro = new ResizeObserver(() => { fit(); });
      ro.observe(stage);

      async function close(result) {
        document.removeEventListener('keydown', key, true);
        ro.disconnect();
        T.$$('.annot-text').forEach((x) => x.remove());
        host.classList.add('out');
        setTimeout(() => host.remove(), 160);
        if (result) {
          const saved = await window.api.updateMedia(pid, m.id, { annotations: result.annotations, crop: result.crop, name: result.name });
          app.mediaChanged(saved);
          resolve(saved);
        } else resolve(null);
      }
      requestAnimationFrame(() => host.classList.add('in'));
      fit(); draw();
      if (opts.tool) setTool(opts.tool);
    });
  }

  T.annot = { svg, toPng, edit, COLORS };
})();

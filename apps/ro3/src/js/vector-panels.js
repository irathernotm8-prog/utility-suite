// Vector workspace — tool rail, options bar, status bar, side panels (Properties, Align & Pathfinder,
// Swatches, Layers, Artboards, History), color picker, gradient editor and font picker.
(() => {
  const S = VX.S;
  const P = paper;
  const pt = (x, y) => new P.Point(x, y);
  const mod = () => ro3.platform === 'darwin' ? '⌘' : 'Ctrl+';

  // ---------- color helpers ----------
  const C = VX.color = {
    rgb2hsb(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0; if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; } return [hh, mx ? d / mx : 0, mx]; },
    hsb2rgb(hh, s, v) { const c = v * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = v - c; const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x]; return [r + m, g + m, b + m]; },
    rgb2cmyk(r, g, b) { const k = 1 - Math.max(r, g, b); if (k >= 1) return [0, 0, 0, 1]; return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]; },
    cmyk2rgb(c, m, y, k) { return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]; },
    toHex(r, g, b) { const x = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0'); return '#' + x(r) + x(g) + x(b); },
    parseHex(s) { s = String(s).trim().replace(/^#/, ''); if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join(''); if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return null; const n = i => parseInt(s.slice(i, i + 2), 16) / 255; return [n(0), n(2), n(4), s.length === 8 ? n(6) : 1]; },
  };
  VX.swatchColor = sw => {
    if (!sw) return null;
    if (sw.g) return new P.Color({ gradient: { stops: sw.g.stops.map(([c, o]) => [c, o]), radial: !!sw.g.radial }, origin: [0, 0], destination: [100, 0] });
    return sw.color === 'none' ? null : new P.Color(sw.color);
  };
  VX.swatchOf = c => !c ? { color: 'none' } : c.type === 'gradient' ? { g: { stops: c.gradient.stops.map(s => [s.color.toCSS(false), s.offset]), radial: c.gradient.radial } } : { color: c.alpha < 1 ? c.toCSS(false) : c.toCSS(true) };
  const swatchCss = sw => sw.g ? `linear-gradient(90deg, ${sw.g.stops.map(([c, o]) => `${c} ${o * 100}%`).join(', ')})` : sw.color === 'none' ? '' : sw.color;
  const paintCss = c => c == null ? '' : c === 'mixed' ? '' : c.type === 'gradient' ? `${c.gradient.radial ? 'radial' : 'linear'}-gradient(${c.gradient.radial ? 'circle' : '90deg'}, ${c.gradient.stops.map(s => `${s.color.toCSS(false)} ${s.offset * 100}%`).join(', ')})` : c.toCSS(false);
  VX.paintCss = paintCss;

  // ---------- tool rail ----------
  const groupCur = new Map();
  VX.buildRail = () => {
    const rail = S.el.rail; rail.innerHTML = '';
    const info = id => VX.TOOL_LIST.find(t => t.id === id);
    const keyLabel = t => t.label || (t.key || '').replace('shift+', 'Shift+').toUpperCase().replace('SHIFT+', 'Shift+');
    for (const g of VX.GROUPS) {
      if (g === 'sep') { rail.appendChild(h('<div class="sep"></div>')); continue; }
      const cur = groupCur.get(g[0]) || g[0], t = info(cur);
      const b = h(`<button class="icon-btn ${g.length > 1 ? 'has-group' : ''}" data-group="${g[0]}" data-tool="${cur}" title="${esc(t.name)} (${esc(keyLabel(t))})${g.length > 1 ? ' — hold or right-click for more' : ''}" aria-label="${esc(t.name)}">${icon(t.icon)}</button>`);
      const flyout = () => menuAt(b, g.map(id => { const x = info(id); return { label: x.name, kbd: keyLabel(x), onClick: () => VX.setTool(id) }; }));
      let hold = null;
      b.addEventListener('pointerdown', () => { if (g.length > 1) hold = setTimeout(() => { hold = 'shown'; flyout(); }, 380); });
      b.addEventListener('pointerup', () => { if (hold !== 'shown') clearTimeout(hold); });
      b.addEventListener('click', () => { if (hold === 'shown') { hold = null; return; } VX.setTool(b.dataset.tool); });
      b.addEventListener('dblclick', () => { const t2 = VX.tools[b.dataset.tool]; if (t2 && t2.dblclick && ['rotate', 'scale', 'reflect'].includes(b.dataset.tool)) t2.dblclick(); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); if (g.length > 1) flyout(); });
      rail.appendChild(b);
    }
    const fs = h(`<div class="vx-fs" title="Fill and stroke — X switches, Shift+X swaps, D resets, / sets none">
      <button class="vx-fs-stroke" aria-label="Stroke color"><i></i></button><button class="vx-fs-fill" aria-label="Fill color"><i></i></button>
      <button class="vx-fs-swap" title="Swap fill and stroke (Shift+X)" aria-label="Swap fill and stroke">${icon('vSwap')}</button>
      <button class="vx-fs-def" title="Default fill and stroke (D)" aria-label="Default colors"><i></i><i></i></button></div>`);
    const modes = h(`<div class="vx-fs-modes"><button data-m="solid" title="Color (,)"></button><button data-m="gradient" title="Gradient (.)"></button><button data-m="none" title="None (/)">${icon('vNone')}</button></div>`);
    const pick = kind => e => {
      if (S.focus !== kind) { S.focus = kind; VX.syncColorWidget(); return; }
      openPaintPicker(e.currentTarget, kind);
    };
    $('.vx-fs-fill', fs).addEventListener('click', pick('fill'));
    $('.vx-fs-stroke', fs).addEventListener('click', pick('stroke'));
    $('.vx-fs-fill', fs).addEventListener('dblclick', e => openPaintPicker(e.currentTarget, 'fill'));
    $('.vx-fs-stroke', fs).addEventListener('dblclick', e => openPaintPicker(e.currentTarget, 'stroke'));
    $('.vx-fs-swap', fs).addEventListener('click', () => VX.ops.swapColors());
    $('.vx-fs-def', fs).addEventListener('click', () => VX.ops.defaultColors());
    $$('button', modes).forEach(b => b.addEventListener('click', () => { const m = b.dataset.m; if (m === 'none') VX.ops.noneColor(); else VX.ops.setFocusType(m); }));
    rail.append(fs, modes);
    VX.markTool(); VX.syncColorWidget();
  };
  VX.markTool = () => {
    const g = VX.GROUPS.find(x => Array.isArray(x) && x.includes(S.tool));
    if (g && (groupCur.get(g[0]) || g[0]) !== S.tool) { groupCur.set(g[0], S.tool); VX.buildRail(); return; }
    $$('[data-tool]', S.el.rail).forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  };
  VX.syncColorWidget = () => {
    const fs = $('.vx-fs', S.el.rail); if (!fs) return;
    const f = S.sel.length ? VX.paintOf('fill') : S.fill, s = S.sel.length ? VX.paintOf('stroke') : S.stroke;
    const show = (el, c) => { const i = $('i', el); i.style.background = paintCss(c === undefined ? null : c); el.classList.toggle('none', c == null); el.classList.toggle('mixed', c === 'mixed'); };
    show($('.vx-fs-fill', fs), f === undefined ? S.fill : f); show($('.vx-fs-stroke', fs), s === undefined ? S.stroke : s);
    fs.classList.toggle('stroke-front', S.focus === 'stroke');
    const cur = S.focus === 'fill' ? (f === undefined ? S.fill : f) : (s === undefined ? S.stroke : s);
    $$('.vx-fs-modes button', S.el.rail).forEach(b => b.classList.toggle('on', b.dataset.m === (cur == null ? 'none' : cur === 'mixed' ? '' : cur.type === 'gradient' ? 'gradient' : 'solid')));
    const solidBtn = $('.vx-fs-modes [data-m="solid"]', S.el.rail); if (solidBtn) solidBtn.style.background = cur && cur !== 'mixed' && cur.type !== 'gradient' ? cur.toCSS(true) : '#fff';
  };
  function openPaintPicker(anchor, kind) {
    const cur = S.sel.length ? VX.paintOf(kind) : (kind === 'fill' ? S.fill : S.stroke);
    const init = cur === 'mixed' || cur === undefined ? (kind === 'fill' ? S.fill : S.stroke) : cur;
    VX.colorPicker(anchor, init, {
      title: kind === 'fill' ? 'Fill' : 'Stroke', allowNone: true, allowGradient: true,
      onInput: c => VX.applyPaint(kind, c, { commit: false }),
      onCommit: c => VX.applyPaint(kind, c, { commit: true }),
    });
  }
  VX.openPaintPicker = openPaintPicker;

  // ---------- color picker popover ----------
  let picker = null;
  VX.closePicker = () => { if (picker) picker.close(); };
  VX.colorPicker = (anchor, initial, { title = 'Color', allowNone = false, allowGradient = false, onInput, onCommit } = {}) => {
    VX.closePicker();
    let color = initial ? initial.clone() : null;
    let mode = localStorage.getItem('ro3.vector.cmode') || 'rgb';
    let gradStop = 0; // index of the edited gradient stop
    let hsb = [0, 0, 0], alpha = 1;
    const el = h(`<div class="vx-picker" role="dialog" aria-label="${esc(title)}">
      <div class="vx-pk-head"><strong>${esc(title)}</strong><div class="seg vx-pk-type">${allowNone ? '<button data-t="none">None</button>' : ''}<button data-t="solid">Solid</button>${allowGradient ? '<button data-t="linear">Linear</button><button data-t="radial">Radial</button>' : ''}</div></div>
      <div class="vx-pk-grad"></div>
      <div class="vx-pk-solid">
        <canvas class="vx-pk-sv" width="248" height="150"></canvas>
        <div class="vx-pk-bars"><input type="range" class="vx-pk-hue hue-track" min="0" max="360" step="1"><input type="range" class="vx-pk-alpha" min="0" max="100" step="1"></div>
        <div class="vx-pk-row"><span class="vx-pk-prev"></span><input class="vx-pk-hex inline" spellcheck="false" maxlength="9"><button class="icon-btn vx-pk-drop" title="Pick a color from the screen">${icon('vDropper')}</button></div>
        <div class="seg vx-pk-modes"><button data-m="rgb">RGB</button><button data-m="hsb">HSB</button><button data-m="cmyk">CMYK</button></div>
        <div class="vx-pk-sliders"></div>
        <div class="vx-pk-sw"></div>
      </div></div>`);
    document.body.appendChild(el);
    const sv = $('.vx-pk-sv', el), svx = sv.getContext('2d'), hue = $('.vx-pk-hue', el), al = $('.vx-pk-alpha', el), hex = $('.vx-pk-hex', el);
    const solid = () => color && color.type === 'gradient' ? color.gradient.stops[gradStop].color : color;
    const setFromSolid = c => { const k = c.convert ? c.convert('rgb') : c; hsb = C.rgb2hsb(k.red, k.green, k.blue); alpha = k.alpha; };
    const curRgb = () => C.hsb2rgb(hsb[0], hsb[1], hsb[2]);
    const makeSolid = () => { const [r, g, b] = curRgb(); return new P.Color(r, g, b, alpha); };
    const emit = (commit) => {
      if (color && color.type === 'gradient') {
        const stops = color.gradient.stops.map((s, i) => [i === gradStop ? makeSolid() : s.color.clone(), s.offset]);
        color = new P.Color({ gradient: { stops, radial: color.gradient.radial }, origin: color.origin, destination: color.destination });
      } else if (color !== null || commit === 'force') color = makeSolid();
      onInput && onInput(color ? color.clone() : null);
      if (commit) onCommit && onCommit(color ? color.clone() : null);
      paint();
    };
    const drawSV = () => {
      const w = sv.width, hh = sv.height;
      const [r, g, b] = C.hsb2rgb(hsb[0], 1, 1);
      svx.fillStyle = C.toHex(r, g, b); svx.fillRect(0, 0, w, hh);
      let gr = svx.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); svx.fillStyle = gr; svx.fillRect(0, 0, w, hh);
      gr = svx.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); svx.fillStyle = gr; svx.fillRect(0, 0, w, hh);
      const x = hsb[1] * w, y = (1 - hsb[2]) * hh;
      svx.beginPath(); svx.arc(x, y, 6, 0, Math.PI * 2); svx.strokeStyle = '#fff'; svx.lineWidth = 2; svx.stroke(); svx.beginPath(); svx.arc(x, y, 7.5, 0, Math.PI * 2); svx.strokeStyle = 'rgba(0,0,0,.5)'; svx.lineWidth = 1; svx.stroke();
    };
    const sliderRow = (label, val, max, onIn) => {
      const r = h(`<label class="vx-pk-sl"><span>${label}</span><input type="range" min="0" max="${max}" step="1" value="${Math.round(val)}"><input type="number" class="inline" min="0" max="${max}" value="${Math.round(val)}"></label>`);
      const [rg, nm] = $$('input', r);
      const fill = () => rg.style.setProperty('--p', (rg.value / max * 100) + '%');
      rg.addEventListener('input', () => { nm.value = rg.value; fill(); onIn(Number(rg.value)); emit(false); });
      rg.addEventListener('change', () => emit(true));
      nm.addEventListener('change', () => { rg.value = clamp(Number(nm.value) || 0, 0, max); fill(); onIn(Number(rg.value)); emit(true); });
      fill(); return r;
    };
    const buildSliders = () => {
      const box = $('.vx-pk-sliders', el); box.innerHTML = '';
      const [r, g, b] = curRgb();
      if (mode === 'rgb') {
        const v = [r * 255, g * 255, b * 255];
        ['R', 'G', 'B'].forEach((L, i) => box.appendChild(sliderRow(L, v[i], 255, x => { v[i] = x; hsb = C.rgb2hsb(v[0] / 255, v[1] / 255, v[2] / 255); drawSV(); hue.value = hsb[0]; })));
      } else if (mode === 'hsb') {
        box.appendChild(sliderRow('H', hsb[0], 360, x => { hsb[0] = x; drawSV(); hue.value = x; }));
        box.appendChild(sliderRow('S', hsb[1] * 100, 100, x => { hsb[1] = x / 100; drawSV(); }));
        box.appendChild(sliderRow('B', hsb[2] * 100, 100, x => { hsb[2] = x / 100; drawSV(); }));
      } else {
        const v = C.rgb2cmyk(r, g, b).map(x => x * 100);
        ['C', 'M', 'Y', 'K'].forEach((L, i) => box.appendChild(sliderRow(L, v[i], 100, x => { v[i] = x; const rgb = C.cmyk2rgb(v[0] / 100, v[1] / 100, v[2] / 100, v[3] / 100); hsb = C.rgb2hsb(...rgb); drawSV(); hue.value = hsb[0]; })));
      }
      $$('.vx-pk-modes button', el).forEach(b2 => b2.classList.toggle('on', b2.dataset.m === mode));
    };
    const paintMeta = () => {
      const [r, g, b] = curRgb();
      hex.value = C.toHex(r, g, b) + (alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, '0') : '');
      $('.vx-pk-prev', el).style.background = `rgba(${r * 255},${g * 255},${b * 255},${alpha})`;
      hue.value = hsb[0]; al.value = Math.round(alpha * 100);
      hue.style.setProperty('--p', (hsb[0] / 360 * 100) + '%'); al.style.setProperty('--p', (alpha * 100) + '%');
      al.style.background = `linear-gradient(90deg, transparent, ${C.toHex(r, g, b)})`;
    };
    const paint = () => {
      const t = color == null ? 'none' : color.type === 'gradient' ? (color.gradient.radial ? 'radial' : 'linear') : 'solid';
      $$('.vx-pk-type button', el).forEach(b => b.classList.toggle('on', b.dataset.t === t));
      $('.vx-pk-solid', el).hidden = t === 'none';
      const gb = $('.vx-pk-grad', el); gb.hidden = !(t === 'linear' || t === 'radial');
      if (!gb.hidden) renderGrad(gb);
      paintMeta();
    };
    const renderGrad = gb => {
      gb.innerHTML = '';
      const ed = VX.gradientBar(color, gradStop, {
        onSelect: i => { gradStop = i; setFromSolid(color.gradient.stops[i].color); drawSV(); buildSliders(); paint(); },
        onChange: (c, commit) => { color = c; gradStop = Math.min(gradStop, c.gradient.stops.length - 1); onInput && onInput(color.clone()); if (commit) onCommit && onCommit(color.clone()); },
      });
      gb.appendChild(ed);
    };
    $$('.vx-pk-type button', el).forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.t;
      if (t === 'none') { color = null; onInput && onInput(null); onCommit && onCommit(null); paint(); return; }
      if (t === 'solid') { const s = solid(); color = s ? s.clone() : makeSolid(); color.alpha = color.alpha || 1; setFromSolid(color); gradStop = 0; drawSV(); buildSliders(); emit(true); return; }
      const radial = t === 'radial';
      if (color && color.type === 'gradient') color = new P.Color({ gradient: { stops: color.gradient.stops.map(s => [s.color.clone(), s.offset]), radial }, origin: color.origin, destination: color.destination });
      else { const s = color || makeSolid(); color = new P.Color({ gradient: { stops: [[s.clone(), 0], [new P.Color(0, 0, 0, s.alpha), 1]], radial }, origin: [0, 0], destination: [100, 0] }); }
      gradStop = 0; setFromSolid(color.gradient.stops[0].color); drawSV(); buildSliders();
      onInput && onInput(color.clone()); onCommit && onCommit(color.clone()); paint();
    }));
    let svDrag = false;
    const svAt = e => { const r = sv.getBoundingClientRect(); hsb[1] = clamp((e.clientX - r.left) / r.width, 0, 1); hsb[2] = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); if (color === null) color = makeSolid(); drawSV(); buildSliders(); emit(false); };
    sv.addEventListener('pointerdown', e => { svDrag = true; sv.setPointerCapture(e.pointerId); svAt(e); });
    sv.addEventListener('pointermove', e => { if (svDrag) svAt(e); });
    sv.addEventListener('pointerup', () => { if (svDrag) { svDrag = false; emit(true); } });
    hue.addEventListener('input', () => { hsb[0] = Number(hue.value); drawSV(); buildSliders(); emit(false); });
    hue.addEventListener('change', () => emit(true));
    al.addEventListener('input', () => { alpha = Number(al.value) / 100; emit(false); });
    al.addEventListener('change', () => emit(true));
    hex.addEventListener('change', () => { const v = C.parseHex(hex.value); if (!v) { paintMeta(); return; } hsb = C.rgb2hsb(v[0], v[1], v[2]); alpha = v[3]; drawSV(); buildSliders(); emit('force'); });
    hex.addEventListener('keydown', e => { if (e.key === 'Enter') hex.dispatchEvent(new Event('change')); e.stopPropagation(); });
    $$('.vx-pk-modes button', el).forEach(b => b.addEventListener('click', () => { mode = b.dataset.m; try { localStorage.setItem('ro3.vector.cmode', mode); } catch (_) {} buildSliders(); }));
    $('.vx-pk-drop', el).addEventListener('click', async () => {
      if (!window.EyeDropper) return toast('Screen color picking isn’t available here.', 'info');
      try { const r = await new EyeDropper().open(); const v = C.parseHex(r.sRGBHex); hsb = C.rgb2hsb(v[0], v[1], v[2]); alpha = 1; drawSV(); buildSliders(); emit('force'); } catch (_) {}
    });
    // swatches row: document swatches + recent
    const swBox = $('.vx-pk-sw', el);
    const sws = [...(S.doc ? S.doc.swatches : []).filter(s => !s.g)];
    swBox.innerHTML = sws.map((s, i) => `<button data-i="${i}" title="${esc(s.name || s.color)}" style="background:${esc(swatchCss(s))}"></button>`).join('') + `<button class="add" title="Add this color to document swatches">${icon('plus')}</button>`;
    $$('button[data-i]', swBox).forEach(b => b.addEventListener('click', () => { const c = new P.Color(sws[Number(b.dataset.i)].color); setFromSolid(c); drawSV(); buildSliders(); emit('force'); }));
    $('button.add', swBox).addEventListener('click', () => { const s = makeSolid(); if (S.doc) { S.doc.swatches.push(VX.swatchOf(s)); VX.commit('Add swatch'); } VX.closePicker(); });

    const s0 = solid(); if (s0) setFromSolid(s0); else { setFromSolid(new P.Color('#000')); }
    drawSV(); buildSliders(); paint();
    // position next to the anchor, left of the side panel if needed
    const r = anchor.getBoundingClientRect(); const pw = el.offsetWidth, ph = el.offsetHeight;
    let left = r.right + 8, top = r.top - 10;
    if (left + pw > innerWidth - 8) left = r.left - pw - 8;
    if (left < 8) left = 8;
    top = clamp(top, 8, innerHeight - ph - 8);
    el.style.left = left + 'px'; el.style.top = top + 'px';
    const off = e => { if (!el.contains(e.target) && e.target !== anchor && !e.target.closest('.menu')) close(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key, true); });
    function close() { if (!picker || picker.el !== el) return; document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key, true); el.remove(); picker = null; VX.refreshPanels(true); }
    picker = { el, close };
    return picker;
  };

  /** Gradient bar with draggable stops. color: gradient paper.Color. */
  VX.gradientBar = (color, selected, { onSelect, onChange }) => {
    const el = h(`<div class="vx-gbar"><div class="vx-gbar-track"><div class="vx-gbar-fill"></div></div><div class="vx-gbar-stops"></div>
      <div class="vx-gbar-row"><label class="opt">Angle <input type="number" class="inline vx-g-angle" step="1"></label><label class="opt" title="Location of the selected stop">Stop <input type="number" class="inline vx-g-loc" min="0" max="100" step="1"><em>%</em></label>
      <button class="icon-btn vx-g-rev" title="Reverse gradient">${icon('vSwap')}</button><button class="icon-btn vx-g-del" title="Delete selected stop">${icon('trash')}</button></div></div>`);
    let sel = selected || 0;
    const stops = () => color.gradient.stops;
    const rebuild = (mutate, commit) => {
      const st = stops().map(s => [s.color.clone(), s.offset]);
      mutate && mutate(st);
      st.sort((a, b) => a[1] - b[1]);
      color = new P.Color({ gradient: { stops: st, radial: color.gradient.radial }, origin: color.origin, destination: color.destination });
      onChange(color, commit); paint();
    };
    const paint = () => {
      $('.vx-gbar-fill', el).style.background = `linear-gradient(90deg, ${stops().map(s => `${s.color.toCSS(false)} ${s.offset * 100}%`).join(', ')})`;
      const box = $('.vx-gbar-stops', el); box.innerHTML = '';
      stops().forEach((s, i) => {
        const b = h(`<button class="vx-gstop ${i === sel ? 'on' : ''}" style="left:${s.offset * 100}%"><i style="background:${s.color.toCSS(false)}"></i></button>`);
        b.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation(); sel = i; onSelect(i); paint();
          const r = box.getBoundingClientRect(); let removed = false;
          const mv = ev => {
            const off = clamp((ev.clientX - r.left) / r.width, 0, 1);
            if (ev.clientY - r.bottom > 30 && stops().length > 2) { removed = true; return; }
            removed = false;
            const cur = stops().map(x => [x.color.clone(), x.offset]); cur[sel][1] = off;
            color = new P.Color({ gradient: { stops: cur, radial: color.gradient.radial }, origin: color.origin, destination: color.destination });
            onChange(color, false); $('.vx-gbar-fill', el).style.background = `linear-gradient(90deg, ${stops().map(s2 => `${s2.color.toCSS(false)} ${s2.offset * 100}%`).join(', ')})`; b.style.left = off * 100 + '%'; $('.vx-g-loc', el).value = Math.round(off * 100);
          };
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (removed) { rebuild(st => st.splice(sel, 1), true); sel = 0; onSelect(0); } else { const keepColor = stops()[sel].color.toCSS(false); rebuild(null, true); sel = stops().findIndex(x => x.color.toCSS(false) === keepColor); if (sel < 0) sel = 0; onSelect(sel); paint(); } };
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        });
        box.appendChild(b);
      });
      const ang = color.origin && color.destination ? Math.round(-color.destination.subtract(color.origin).angle) : 0;
      $('.vx-g-angle', el).value = ang; $('.vx-g-loc', el).value = Math.round((stops()[sel] || stops()[0]).offset * 100);
      $('.vx-g-angle', el).disabled = color.gradient.radial;
    };
    $('.vx-gbar-track', el).addEventListener('pointerdown', e => {
      const r = e.currentTarget.getBoundingClientRect(); const off = clamp((e.clientX - r.left) / r.width, 0, 1);
      // new stop takes the interpolated color at that location
      const st = stops(); let i = st.findIndex(s => s.offset > off); if (i <= 0) i = i === 0 ? 1 : st.length - 1;
      const a = st[i - 1], b = st[i] || st[i - 1]; const t = b.offset - a.offset ? (off - a.offset) / (b.offset - a.offset) : 0;
      const c = new P.Color(a.color.red + (b.color.red - a.color.red) * t, a.color.green + (b.color.green - a.color.green) * t, a.color.blue + (b.color.blue - a.color.blue) * t, a.color.alpha + (b.color.alpha - a.color.alpha) * t);
      rebuild(s => s.push([c, off]), true); sel = stops().findIndex(s => Math.abs(s.offset - off) < 1e-9); onSelect(Math.max(0, sel));
    });
    $('.vx-g-angle', el).addEventListener('change', e => {
      const a = -Number(e.target.value) || 0;
      const o = color.origin, d = color.destination, len = o.getDistance(d) || 100, c = o.add(d).divide(2);
      const dir = new P.Point({ length: len / 2, angle: a });
      color = new P.Color({ gradient: { stops: stops().map(s => [s.color.clone(), s.offset]), radial: color.gradient.radial }, origin: c.subtract(dir), destination: c.add(dir) });
      color._angle = a; onChange(color, true); paint();
    });
    $('.vx-g-loc', el).addEventListener('change', e => rebuild(st => { st[sel][1] = clamp(Number(e.target.value) / 100, 0, 1); }, true));
    $('.vx-g-rev', el).addEventListener('click', () => rebuild(st => st.forEach(s => { s[1] = 1 - s[1]; }), true));
    $('.vx-g-del', el).addEventListener('click', () => { if (stops().length > 2) { rebuild(st => st.splice(sel, 1), true); sel = 0; onSelect(0); } });
    paint();
    return el;
  };

  // ---------- options bar ----------
  const optNum = (label, value, onChange, { min, max, step = 1, unit = '', width = 58, title = '' } = {}) => {
    const o = h(`<label class="opt" title="${esc(title)}">${esc(label)} <span class="vx-num"><input type="number" class="inline" value="${value}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step}" style="width:${width}px">${unit ? `<em>${esc(unit)}</em>` : ''}</span></label>`);
    const i = $('input', o); i.addEventListener('change', () => onChange(Number(i.value))); i.addEventListener('keydown', e => { if (e.key === 'Enter') { i.blur(); } }); return o;
  };
  const optRange = (label, obj, key, min, max, step = 1, fmt) => {
    const id = uid('vo');
    const o = h(`<label class="opt" for="${id}">${esc(label)} <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}"><output>${fmt ? fmt(obj[key]) : obj[key]}</output></label>`);
    const inp = $('input', o), out = $('output', o);
    const paint = () => { inp.style.setProperty('--p', ((inp.value - min) / (max - min) * 100) + '%'); out.textContent = fmt ? fmt(Number(inp.value)) : inp.value; };
    inp.addEventListener('input', () => { obj[key] = Number(inp.value); paint(); VX.req(); });
    paint(); return o;
  };
  const optCheck = (label, obj, key, onChange) => { const c = checkField(label, obj[key]); c.classList.add('opt'); c.input.addEventListener('change', () => { obj[key] = c.get(); onChange && onChange(); }); return c; };
  const optBtn = (ic, title, fn, label = '') => { const b = h(`<button class="btn btn-sm btn-ghost" title="${esc(title)}">${icon(ic)}${esc(label)}</button>`); b.addEventListener('click', fn); return b; };
  const hint = t => h(`<span class="opt muted vx-hint">${esc(t)}</span>`);
  const paintChip = (kind) => {
    const c = S.sel.length ? VX.paintOf(kind) : (kind === 'fill' ? S.fill : S.stroke);
    const b = h(`<button class="vx-chip ${kind} ${c == null ? 'none' : ''} ${c === 'mixed' ? 'mixed' : ''}" title="${kind === 'fill' ? 'Fill' : 'Stroke'}"><i style="background:${esc(paintCss(c === undefined ? null : c))}"></i></button>`);
    b.addEventListener('click', () => openPaintPicker(b, kind));
    return b;
  };
  const alignBtns = () => {
    const w = h('<span class="vx-alignbar"></span>');
    [['alignL', 'left', 'Align left'], ['alignCH', 'hcenter', 'Align horizontal centers'], ['alignR', 'right', 'Align right'], ['alignT', 'top', 'Align top'], ['alignCV', 'vcenter', 'Align vertical centers'], ['alignB', 'bottom', 'Align bottom']].forEach(([ic, k, t]) => {
      const b = h(`<button class="icon-btn" title="${t}${S.sel.length === 1 ? ' (to artboard)' : ''}">${icon(ic)}</button>`); b.addEventListener('click', () => VX.ops.align(k)); w.appendChild(b);
    });
    return w;
  };
  VX.renderOptions = () => {
    const o = S.el.opts; if (!o) return;
    if (o.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'range') return;
    o.innerHTML = '';
    const t = VX.TOOL_LIST.find(x => x.id === S.tool);
    o.appendChild(h(`<span class="tool-name">${esc(t ? t.name : '')}</span>`));
    if (!S.doc) { o.appendChild(hint('Create or open a document to start.')); return; }
    const T = VX.T, id = S.tool;
    const selOpts = () => {
      if (!S.sel.length) return false;
      const one = S.sel.length === 1 ? S.sel[0] : null;
      o.append(h(`<span class="opt vx-selkind">${esc(one ? VX.kindOf(one) : S.sel.length + ' objects')}</span>`), paintChip('fill'), paintChip('stroke'));
      const sw = VX.paintTargets(S.sel)[0];
      o.append(optNum('', sw ? +(sw.strokeWidth || 0).toFixed(2) : S.strokeStyle.width, v => VX.applyStyle({ strokeWidth: Math.max(0, v) }), { min: 0, step: 0.5, unit: 'pt', width: 52, title: 'Stroke weight' }));
      o.append(optNum('Opacity', Math.round((one ? one.opacity : 1) * 100), v => VX.applyItemProps({ opacity: clamp(v, 0, 100) / 100 }, 'Opacity'), { min: 0, max: 100, unit: '%', width: 52 }));
      if (one && one.data && one.data.live) o.append(optNum('Corners', +VX.fmtU(one.data.live.r || 0), v => { VX.setCornerRadius(one, VX.fromU(Math.max(0, v))); VX.commit('Corner radius'); }, { min: 0, step: 'any', unit: VX.unitLabel(), width: 66 }));
      o.append(h('<span class="grow"></span>'), alignBtns());
      if (one && one.className === 'Raster') o.append(optBtn('vTrace', 'Image Trace', () => VX.io.traceDialog(), 'Image Trace'));
      if (one && one.className === 'PointText') o.append(optBtn('vOutlineText', 'Create Outlines (' + mod() + 'Shift+O)', () => VX.io.outlineText(), 'Outline'));
      if (S.isolation) o.append(optBtn('x', 'Exit isolation mode (Esc)', VX.exitIsolation, 'Exit isolation'));
      return true;
    };
    switch (id) {
      case 'select': case 'direct': case 'lasso':
        if (id === 'direct' && S.pts.size) {
          o.append(hint(`${S.pts.size} anchor${S.pts.size > 1 ? 's' : ''}`));
          o.append(optBtn('vConvert', 'Convert to corner', () => { for (const s of S.pts) { s.handleIn = null; s.handleOut = null; } VX.commit('Convert to corner'); }, 'Corner'));
          o.append(optBtn('vCurvature', 'Convert to smooth', () => { for (const s of S.pts) s.smooth({ type: 'catmull-rom' }); VX.commit('Convert to smooth'); }, 'Smooth'));
          o.append(optBtn('trash', 'Remove selected anchor points', () => VX.ops.deletePoints(), 'Remove'));
          o.append(optBtn('vScissors', 'Cut path at selected anchor', () => { const s = [...S.pts][0]; if (s && s.path) { const p = s.path; const other = p.splitAt(p.getLocationOf(s.point) || s.location); VX.select([p, other].filter(Boolean)); S.pts.clear(); VX.commit('Cut path'); } }, 'Cut'));
          o.append(optBtn('vJoin', 'Join (' + mod() + 'J)', VX.ops.join, 'Join'));
          o.append(h('<span class="grow"></span>'), alignBtns());
        } else if (!selOpts()) o.append(hint(id === 'select' ? 'Click to select · Shift-click to add · Drag to marquee · Alt-drag duplicates · Double-click a group to isolate it' : id === 'direct' ? 'Click anchors or path segments · Drag handles to shape curves · Alt-drag breaks a smooth point' : 'Draw around anchor points to select them'));
        break;
      case 'rect': o.append(optNum('Corner radius', +VX.fmtU(T.rect.radius), v => { T.rect.radius = VX.fromU(Math.max(0, v)); }, { min: 0, unit: VX.unitLabel() }), hint('Drag to draw · Shift: square · Alt: from center · Click for exact size')); break;
      case 'ellipse': o.append(hint('Drag to draw · Shift: circle · Alt: from center · Click for exact size')); break;
      case 'polygon': o.append(optNum('Sides', T.polygon.sides, v => { T.polygon.sides = clamp(Math.round(v), 3, 100); }, { min: 3, max: 100 }), hint('Drag from the center · Shift keeps it upright')); break;
      case 'star': o.append(optNum('Points', T.star.points, v => { T.star.points = clamp(Math.round(v), 3, 100); }, { min: 3, max: 100 }), optNum('Inner radius', T.star.ratio, v => { T.star.ratio = clamp(v, 1, 99); }, { min: 1, max: 99, unit: '%' }), hint('Drag from the center')); break;
      case 'line': o.append(hint('Drag to draw · Shift constrains to 45° · Click for exact length')); break;
      case 'arc': o.append(optCheck('Concave', T.arc, 'concave'), optCheck('Closed', T.arc, 'closed'), hint('Drag to draw a quarter arc')); break;
      case 'spiral': o.append(optNum('Decay', T.spiral.decay, v => { T.spiral.decay = clamp(v, 5, 99); }, { min: 5, max: 99, unit: '%' }), optNum('Turns', T.spiral.turns, v => { T.spiral.turns = clamp(v, 1, 20); }, { min: 1, max: 20 }), hint('Drag from the center')); break;
      case 'pen': o.append(hint('Click: corner · Drag: curve · Alt-drag: break handle · Click the first point to close · Click an endpoint to continue a path · Enter/Esc to finish')); break;
      case 'addAnchor': o.append(hint('Click a path segment to add an anchor point')); break;
      case 'delAnchor': o.append(hint('Click an anchor point to remove it')); break;
      case 'convert': o.append(hint('Click an anchor to toggle corner/smooth · Drag from an anchor to pull out handles · Drag a handle to move it on its own')); break;
      case 'curvature': o.append(hint('Click to add points — the path curves through them · Alt-click or double-click: corner point · Drag points to reshape · Esc to finish')); break;
      case 'pencil': o.append(optRange('Smoothness', T.pencil, 'smooth', 0, 100), optCheck('Fill new pencil strokes', T.pencil, 'fill'), hint('Draw freehand · ends near the start close the path')); break;
      case 'brush': o.append(optNum('Width', T.brush.width, v => { T.brush.width = Math.max(0.1, v); }, { min: 0.1, step: 0.5, unit: 'pt' }), optRange('Smoothness', T.brush, 'smooth', 0, 100)); break;
      case 'eraser': o.append(optRange('Size', T.eraser, 'size', 2, 200, 1, v => v + ' px'), hint(S.sel.length ? 'Erases from the selected shapes' : 'Erases from any unlocked shape — select shapes to limit it')); break;
      case 'scissors': o.append(hint('Click on a path to cut it there')); break;
      case 'knife': o.append(hint('Drag across shapes to slice them · Alt: straight line')); break;
      case 'rotate': case 'reflect': case 'scale': o.append(hint('Click to set the origin · Drag to transform · Alt-drag copies · Shift constrains'), optBtn('sliders', 'Exact values', () => VX.tools[id].dblclick(), 'Exact…')); break;
      case 'gradient': o.append(hint('Drag across selected objects to set the gradient direction · Drag the ends to adjust')); break;
      case 'eyedropper': o.append(hint('Click an object to copy its appearance to the selection · Shift-click picks just the color')); break;
      case 'text': textOptions(o); break;
      case 'artboard': artboardOptions(o); break;
      case 'hand': case 'zoom': o.append(optBtn('frame', 'Fit artboard (' + mod() + '0)', () => VX.fitArtboard(), 'Fit artboard'), optBtn('vZoom', 'Fit all (' + mod() + 'Alt+0)', () => VX.fitAll(), 'Fit all'), optBtn('vZoom', 'Actual size', () => VX.actualSize(), '100%')); break;
    }
  };
  function textOptions(o) {
    const texts = S.sel.filter(x => x.className === 'PointText');
    const t0 = texts[0];
    const ts = S.textStyle;
    const fam = t0 ? t0.fontFamily : ts.family, wt = String(t0 ? t0.fontWeight : ts.weight), size = t0 ? t0.fontSize : ts.size;
    const fb = h(`<button class="btn btn-sm vx-fontbtn" title="Font family"><span style="font-family:${esc(VX.cssFamily(fam))}">${esc(fam)}</span>${icon('down')}</button>`);
    fb.addEventListener('click', () => VX.fontPicker(fb, fam, f => { VX.applyTextStyle({ fontFamily: f }); VX.renderOptions(); }));
    const wsel = h(`<select class="inline vx-wsel" title="Weight">${WEIGHTS.map(([v, l]) => `<option value="${v}" ${String(v) === normW(wt) ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    wsel.addEventListener('change', () => VX.applyTextStyle({ fontWeight: wsel.value }));
    o.append(fb, wsel, optNum('', +size.toFixed(2), v => VX.applyTextStyle({ fontSize: Math.max(1, v) }), { min: 1, step: 1, unit: 'pt', width: 54, title: 'Font size' }));
    o.append(optNum('Leading', +((t0 ? t0.leading : ts.leading) || size * 1.2).toFixed(1), v => VX.applyTextStyle({ leading: Math.max(1, v) }), { min: 1, unit: 'pt', width: 54 }));
    o.append(optNum('Tracking', t0 ? t0.tracking || 0 : ts.tracking, v => VX.applyTextStyle({ tracking: v }), { step: 10, width: 54 }));
    const seg = h(`<div class="seg">${['left', 'center', 'right'].map(j => `<button data-j="${j}" class="${(t0 ? t0.justification : ts.justification) === j ? 'on' : ''}" title="Align ${j}">${icon(j === 'left' ? 'alignL' : j === 'center' ? 'alignCH' : 'alignR')}</button>`).join('')}</div>`);
    $$('button', seg).forEach(b => b.addEventListener('click', () => { VX.applyTextStyle({ justification: b.dataset.j }); VX.renderOptions(); }));
    o.append(seg, h('<span class="grow"></span>'));
    if (texts.length) o.append(optBtn('vOutlineText', 'Create Outlines (' + mod() + 'Shift+O)', () => VX.io.outlineText(), 'Create outlines'));
    else o.append(hint('Click for point type · Drag a box for area type'));
  }
  const WEIGHTS = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];
  const normW = w => w === 'bold' ? '700' : w === 'normal' || !w ? '400' : String(parseInt(w, 10) || 400);
  VX.WEIGHTS = WEIGHTS; VX.normW = normW;
  function artboardOptions(o) {
    const a = S.doc.artboards[S.doc.ab];
    const name = h(`<input class="inline vx-abname" value="${esc(a.name)}" title="Artboard name">`);
    name.addEventListener('change', () => VX.ab.rename(S.doc.ab, name.value.trim() || a.name));
    name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
    const pre = h(`<select class="inline" title="Preset"><option value="">Preset…</option>${VX.PRESETS.map(p => `<option value="${p.id}">${esc(p.label)} — ${esc(p.sub)}</option>`).join('')}</select>`);
    pre.addEventListener('change', () => { const p = VX.PRESETS.find(x => x.id === pre.value); if (p) VX.ab.setRect(S.doc.ab, { x: a.x, y: a.y, w: p.w, h: p.h }); VX.renderOptions(); });
    o.append(name, pre,
      optNum('W', +VX.fmtU(a.w), v => { VX.ab.setRect(S.doc.ab, { x: a.x, y: a.y, w: VX.fromU(Math.max(0.01, v)), h: a.h }); }, { min: 0, step: 'any', unit: VX.unitLabel() }),
      optNum('H', +VX.fmtU(a.h), v => { VX.ab.setRect(S.doc.ab, { x: a.x, y: a.y, w: a.w, h: VX.fromU(Math.max(0.01, v)) }); }, { min: 0, step: 'any', unit: VX.unitLabel() }),
      optBtn('rotate', 'Swap orientation', () => VX.ab.setRect(S.doc.ab, { x: a.x, y: a.y, w: a.h, h: a.w }), ''),
      optCheck('Move artwork with artboard', VX.T.artboard, 'moveArt'),
      h('<span class="grow"></span>'),
      optBtn('plus', 'New artboard', () => VX.ab.add(), 'New'), optBtn('copy', 'Duplicate artboard (Alt-drag)', () => VX.ab.duplicate(), 'Duplicate'), optBtn('trash', 'Delete artboard', () => VX.ab.remove(), 'Delete'));
  }

  // ---------- status bar ----------
  VX.updateStatus = () => {
    const st = S.el.status; if (!st) return;
    if (!S.doc) { st.innerHTML = ''; return; }
    if (!st.firstChild) {
      st.innerHTML = `<select class="vx-zoomsel" title="Zoom"></select>
        <span class="vx-abnav"><button class="icon-btn" data-ab="-1" title="Previous artboard">${icon('chevron')}</button><select class="vx-absel" title="Artboard"></select><button class="icon-btn" data-ab="1" title="Next artboard">${icon('chevron')}</button></span>
        <span class="vx-coords"></span><span class="vx-selinfo"></span><span class="grow"></span>
        <span class="vx-toggles">
          <button class="icon-btn" data-t="smart" title="Smart guides (${mod()}U)">${icon('vSmart')}</button>
          <button class="icon-btn" data-t="snapGrid" title="Snap to grid (${mod()}Shift+')">${icon('vSnap')}</button>
          <button class="icon-btn" data-t="grid" title="Grid (${mod()}')">${icon('grid')}</button>
          <button class="icon-btn" data-t="rulers" title="Rulers (${mod()}R)">${icon('ruler')}</button>
          <button class="icon-btn" data-t="outline" title="Outline view (${mod()}Y)">${icon('vOutlineMode')}</button></span>`;
      const zs = $('.vx-zoomsel', st);
      zs.addEventListener('change', () => { const v = zs.value; if (v === 'fit') VX.fitArtboard(); else if (v === 'all') VX.fitAll(); else VX.zoomTo(Number(v)); });
      $('.vx-absel', st).addEventListener('change', e => VX.ab.activate(Number(e.target.value), true));
      $$('[data-ab]', st).forEach(b => b.addEventListener('click', () => { const n = S.doc.artboards.length; VX.ab.activate((S.doc.ab + Number(b.dataset.ab) + n) % n, true); }));
      $$('[data-t]', st).forEach(b => b.addEventListener('click', () => VX.toggleShow(b.dataset.t)));
    }
    const z = VX.zoom();
    const zs = $('.vx-zoomsel', st);
    const zl = [0.0625, 0.125, 0.25, 0.33, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 32, 64];
    const zkey = z.toFixed(4);
    if (zs.dataset.k !== zkey) { zs.dataset.k = zkey; zs.innerHTML = `<option value="${z}" selected>${Math.round(z * 1000) / 10}%</option>` + zl.map(v => `<option value="${v}">${Math.round(v * 1000) / 10}%</option>`).join('') + '<option value="fit">Fit artboard</option><option value="all">Fit all</option>'; }
    const abs = $('.vx-absel', st);
    const akey = S.doc.artboards.map(a => a.name).join('|') + ':' + S.doc.ab;
    if (abs.dataset.k !== akey) { abs.dataset.k = akey; abs.innerHTML = S.doc.artboards.map((a, i) => `<option value="${i}" ${i === S.doc.ab ? 'selected' : ''}>${i + 1}. ${esc(a.name)}</option>`).join(''); }
    const ab = S.doc.artboards[S.doc.ab];
    const c = S.cursorP;
    $('.vx-coords', st).textContent = c ? `X ${VX.fmtU(c.x - ab.x)}  Y ${VX.fmtU(c.y - ab.y)} ${VX.unitLabel()}` : '';
    const n = S.sel.length;
    $('.vx-selinfo', st).textContent = S.pts.size ? `${S.pts.size} anchor point${S.pts.size > 1 ? 's' : ''}` : n ? (n === 1 ? VX.kindOf(S.sel[0]) : `${n} objects`) : '';
    $$('[data-t]', st).forEach(b => b.classList.toggle('on', !!S.show[b.dataset.t]));
  };

  // ---------- side panels ----------
  const TOP_TABS = [['props', 'Properties', 'sliders'], ['align', 'Align', 'alignL'], ['swatches', 'Swatches', 'drop']];
  const BOT_TABS = [['layers', 'Layers', 'layers'], ['artboards', 'Artboards', 'vArtboard'], ['history', 'History', 'undo']];
  VX.buildSide = () => {
    const mk = (box, tabs, key) => {
      box.innerHTML = tabs.map(([id, label, ic]) => `<button data-tab="${id}" role="tab">${icon(ic)}${label}</button>`).join('');
      $$('button', box).forEach(b => b.addEventListener('click', () => { S[key] = b.dataset.tab; VX.refreshPanels(true); }));
    };
    mk(S.el.topTabs, TOP_TABS, 'sideTop'); mk(S.el.botTabs, BOT_TABS, 'sideBottom');
  };
  VX.showPanel = id => { if (TOP_TABS.some(t => t[0] === id)) S.sideTop = id; else S.sideBottom = id; VX.refreshPanels(true); };
  let panelRaf = 0;
  VX.refreshPanels = (now) => {
    if (now) { cancelAnimationFrame(panelRaf); panelRaf = 0; renderPanels(); return; }
    if (!panelRaf) panelRaf = requestAnimationFrame(() => { panelRaf = 0; renderPanels(); });
  };
  /** Re-render a container, keeping keyboard focus on the same field. */
  function rerender(box, fn) {
    const a = document.activeElement;
    const key = a && box.contains(a) && a.dataset ? a.dataset.k : null;
    if (a && box.contains(a) && a.tagName === 'INPUT' && a.type !== 'range' && a.type !== 'checkbox' && !key) return;
    const sel = key && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    const scroll = box.scrollTop;
    fn();
    box.scrollTop = scroll;
    if (key) { const n = $(`[data-k="${key}"]`, box); if (n) { n.focus(); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch (_) {} } }
  }
  function renderPanels() {
    if (!S.el.side) return;
    const has = !!S.doc;
    S.el.side.classList.toggle('disabled', !has);
    // keep current colors in sync with the selection
    if (S.sel.length) { const f = VX.paintOf('fill'), s = VX.paintOf('stroke'); if (f !== 'mixed' && f !== undefined) S.fill = f ? f.clone() : null; if (s !== 'mixed' && s !== undefined) S.stroke = s ? s.clone() : null; }
    VX.syncColorWidget(); VX.renderOptions(); VX.updateStatus();
    $$('button', S.el.topTabs).forEach(b => b.classList.toggle('on', b.dataset.tab === S.sideTop));
    $$('button', S.el.botTabs).forEach(b => b.classList.toggle('on', b.dataset.tab === S.sideBottom));
    if (!has) { S.el.topBody.innerHTML = '<p class="hint vx-pad">Create or open a document to see its properties.</p>'; S.el.botBody.innerHTML = ''; return; }
    rerender(S.el.topBody, () => { const b = S.el.topBody; b.innerHTML = ''; ({ props: propsPanel, align: alignPanel, swatches: swatchPanel })[S.sideTop](b); });
    rerender(S.el.botBody, () => { const b = S.el.botBody; ({ layers: layersPanel, artboards: artboardsPanel, history: historyPanel })[S.sideBottom](b); });
  }

  // small field helpers for panels
  const fld = (label, value, onCommit, { key, unit = '', step = 'any', min, max, title = '' } = {}) => {
    const el = h(`<label class="vx-f" title="${esc(title)}"><span>${esc(label)}</span><input type="number" class="inline" data-k="${key || uid('k')}" value="${value === '' ? '' : value}" step="${step}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} ${value === '' ? 'placeholder="—"' : ''}>${unit ? `<em>${esc(unit)}</em>` : ''}</label>`);
    const i = $('input', el);
    i.addEventListener('change', () => { if (i.value !== '') onCommit(Number(i.value)); });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { i.dispatchEvent(new Event('change')); i.select(); } if (e.key === 'Escape') i.blur(); });
    // scrub on the label like Illustrator
    const lab = $('span', el);
    lab.addEventListener('pointerdown', e => {
      if (i.value === '') return; e.preventDefault(); const x0 = e.clientX, v0 = Number(i.value); const stp = e.shiftKey ? 10 : 1;
      const mv = ev => { i.value = +(v0 + Math.round((ev.clientX - x0) / 2) * stp).toFixed(2); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (Number(i.value) !== v0) onCommit(Number(i.value)); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    return el;
  };
  const section = (title, body, { open = true, id } = {}) => {
    const key = 'ro3.vector.sec.' + (id || title);
    let isOpen = open; try { const v = localStorage.getItem(key); if (v != null) isOpen = v === '1'; } catch (_) {}
    const d = h(`<details class="vx-section" ${isOpen ? 'open' : ''}><summary>${esc(title)}</summary><div class="vx-sec-in"></div></details>`);
    d.addEventListener('toggle', () => { try { localStorage.setItem(key, d.open ? '1' : '0'); } catch (_) {} });
    const inner = $('.vx-sec-in', d); if (body) inner.append(...[].concat(body)); return d;
  };
  const iconBtn = (ic, title, fn, cls = '') => { const b = h(`<button class="icon-btn ${cls}" title="${esc(title)}" aria-label="${esc(title)}">${icon(ic)}</button>`); b.addEventListener('click', fn); return b; };
  const smallBtn = (ic, label, fn, title = '') => { const b = h(`<button class="btn btn-sm" title="${esc(title || label)}">${ic ? icon(ic) : ''}${esc(label)}</button>`); b.addEventListener('click', fn); return b; };

  // ----- Properties -----
  S.refPt = 'tl'; S.linkWH = true;
  function propsPanel(box) {
    const sel = S.sel;
    if (!sel.length) return docProps(box);
    const one = sel.length === 1 ? sel[0] : null;
    box.appendChild(h(`<div class="vx-ph"><strong>${esc(one ? VX.kindOf(one) : sel.length + ' objects')}</strong>${one && one.name ? `<em>${esc(one.name)}</em>` : ''}</div>`));
    box.appendChild(transformSection());
    box.appendChild(appearanceSection());
    const texts = []; const walk = it => { if (it.className === 'PointText') texts.push(it); else if (it.children && it.className === 'Group') it.children.forEach(walk); }; sel.forEach(walk);
    if (texts.length) box.appendChild(typeSection(texts));
    box.appendChild(quickActions());
  }
  function docProps(box) {
    const d = S.doc, a = d.artboards[d.ab], u = VX.unitLabel();
    box.appendChild(h(`<div class="vx-ph"><strong>Document</strong><em>${esc(d.name)}</em></div>`));
    const abBody = h('<div class="stack vx-tight"></div>');
    const nm = h(`<label class="field"><span>Artboard</span><input type="text" data-k="abname" value="${esc(a.name)}"></label>`);
    $('input', nm).addEventListener('change', e => VX.ab.rename(d.ab, e.target.value.trim()));
    $('input', nm).addEventListener('keydown', e => e.stopPropagation());
    const grid = h('<div class="vx-grid2"></div>');
    grid.append(fld('W', +VX.fmtU(a.w), v => VX.ab.setRect(d.ab, { x: a.x, y: a.y, w: VX.fromU(Math.max(0.01, v)), h: a.h }), { key: 'abw', unit: u }), fld('H', +VX.fmtU(a.h), v => VX.ab.setRect(d.ab, { x: a.x, y: a.y, w: a.w, h: VX.fromU(Math.max(0.01, v)) }), { key: 'abh', unit: u }));
    const pre = selectField('Preset', [['', 'Choose a size…'], ...VX.PRESETS.map(p => [p.id, `${p.label} (${p.sub})`])], '');
    pre.select.addEventListener('change', () => { const p = VX.PRESETS.find(x => x.id === pre.get()); if (p) VX.ab.setRect(d.ab, { x: a.x, y: a.y, w: p.w, h: p.h }); });
    const row = h('<div class="vx-btnrow"></div>');
    row.append(smallBtn('vArtboard', 'Edit artboards', () => VX.setTool('artboard')), smallBtn('frame', 'Fit to artwork', () => VX.ab.fitToArt()), smallBtn('plus', 'New', () => VX.ab.add()));
    abBody.append(nm, grid, pre, row);
    box.appendChild(section('Artboard', abBody, { id: 'artboard' }));
    const units = selectField('Units', [['px', 'Pixels'], ['pt', 'Points'], ['in', 'Inches'], ['mm', 'Millimeters']], d.units);
    units.select.addEventListener('change', () => { d.units = units.get(); VX.commit('Units'); });
    const docBody = h('<div class="stack vx-tight"></div>');
    const r2 = h('<div class="vx-btnrow"></div>'); r2.append(smallBtn('sliders', 'Document setup…', () => VX.docSetupDialog()), smallBtn('x', 'Clear guides', () => VX.clearGuides()));
    docBody.append(units, r2);
    box.appendChild(section('Document', docBody, { id: 'doc' }));
    const fs = h('<div class="stack vx-tight"></div>');
    fs.append(paintRow('fill'), paintRow('stroke'), h('<p class="hint">Colors for new objects. Select objects to edit theirs.</p>'));
    box.appendChild(section('Default appearance', fs, { id: 'defapp' }));
    const qa = h('<div class="vx-btnrow"></div>');
    qa.append(smallBtn('vPlace', 'Place…', () => VX.io.place()), smallBtn('export', 'Export…', () => VX.io.exportDialog()), smallBtn('copy', 'Export for screens…', () => VX.io.exportScreens()));
    box.appendChild(section('Quick actions', qa, { id: 'docqa' }));
  }
  function transformSection() {
    const b = VX.selBounds(), u = VX.unitLabel(), a = S.doc.artboards[S.doc.ab];
    const body = h('<div class="vx-tf"></div>');
    const ref = h(`<div class="vx-refpt" title="Reference point">${['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'].map(k => `<button data-r="${k}" class="${S.refPt === k ? 'on' : ''}"></button>`).join('')}</div>`);
    $$('button', ref).forEach(x => x.addEventListener('click', () => { S.refPt = x.dataset.r; VX.refreshPanels(true); }));
    const refOf = r => { const k = S.refPt; return pt(k.includes('l') ? r.left : k.includes('r') ? r.right : r.center.x, k.startsWith('t') ? r.top : k.startsWith('b') ? r.bottom : r.center.y); };
    const rp = b ? refOf(b) : pt(0, 0);
    const grid = h('<div class="vx-grid2"></div>');
    const moveTo = (x, y) => { const d = pt(x, y).subtract(refOf(VX.selBounds())); VX.transformItems(S.sel, new P.Matrix().translate(d)); VX.commit('Move'); };
    const resize = (w, hh) => {
      const r = VX.selBounds(); const sx = r.width ? w / r.width : 1, sy = r.height ? hh / r.height : 1;
      VX.transformItems(S.sel, new P.Matrix().scale(sx || 1, sy || 1, refOf(r))); VX.commit('Resize');
    };
    grid.append(
      fld('X', b ? +VX.fmtU(rp.x - a.x) : '', v => moveTo(VX.fromU(v) + a.x, refOf(VX.selBounds()).y), { key: 'tx', unit: u }),
      fld('Y', b ? +VX.fmtU(rp.y - a.y) : '', v => moveTo(refOf(VX.selBounds()).x, VX.fromU(v) + a.y), { key: 'ty', unit: u }),
      fld('W', b ? +VX.fmtU(b.width) : '', v => { const r = VX.selBounds(); const w = Math.max(0.001, VX.fromU(v)); resize(w, S.linkWH && r.width ? r.height * w / r.width : r.height); }, { key: 'tw', unit: u, min: 0 }),
      fld('H', b ? +VX.fmtU(b.height) : '', v => { const r = VX.selBounds(); const hh = Math.max(0.001, VX.fromU(v)); resize(S.linkWH && r.height ? r.width * hh / r.height : r.width, hh); }, { key: 'th', unit: u, min: 0 }),
    );
    const link = iconBtn('link', 'Constrain width and height proportions', () => { S.linkWH = !S.linkWH; VX.refreshPanels(true); }, 'vx-link ' + (S.linkWH ? 'on' : ''));
    const rot = fld('∠', 0, v => { if (v) VX.ops.rotateBy(-v); }, { key: 'trot', unit: '°', title: 'Rotate by (counter-clockwise degrees)' });
    const flips = h('<div class="vx-btnrow"></div>');
    flips.append(iconBtn('flipH', 'Flip horizontal', () => VX.ops.flip('h')), iconBtn('flipV', 'Flip vertical', () => VX.ops.flip('v')));
    const one = S.sel.length === 1 ? S.sel[0] : null;
    const row2 = h('<div class="vx-tf-row"></div>'); row2.append(rot, flips);
    body.append(ref, grid, link, row2);
    if (one && one.data && one.data.live) body.append(fld('Corner radius', +VX.fmtU(one.data.live.r || 0), v => { VX.setCornerRadius(one, VX.fromU(Math.max(0, v))); VX.commit('Corner radius'); }, { key: 'tcr', unit: u, min: 0 }));
    return section('Transform', body, { id: 'transform' });
  }
  function paintRow(kind) {
    const c = S.sel.length ? VX.paintOf(kind) : (kind === 'fill' ? S.fill : S.stroke);
    const row = h(`<div class="vx-paint"><button class="vx-chip ${kind} ${c == null ? 'none' : ''} ${c === 'mixed' ? 'mixed' : ''}"><i style="background:${esc(paintCss(c === undefined ? null : c))}"></i></button>
      <span class="vx-paint-l">${kind === 'fill' ? 'Fill' : 'Stroke'}</span><input class="inline vx-hex" data-k="hex-${kind}" spellcheck="false" value="${c && c !== 'mixed' && c.type !== 'gradient' ? VX.hex(c) : ''}" placeholder="${c === 'mixed' ? 'Mixed' : c == null ? 'None' : c.type === 'gradient' ? 'Gradient' : ''}"></div>`);
    const chip = $('.vx-chip', row);
    chip.addEventListener('click', () => openPaintPicker(chip, kind));
    const hx = $('.vx-hex', row);
    hx.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') hx.blur(); });
    hx.addEventListener('change', () => { const v = hx.value.trim().toLowerCase(); if (v === 'none' || v === '') { if (v === 'none') VX.applyPaint(kind, null); return; } const p = C.parseHex(v); if (p) VX.applyPaint(kind, new P.Color(p[0], p[1], p[2], p[3])); else toast('Enter a hex color like #2fd67f', 'error'); });
    return row;
  }
  function appearanceSection() {
    const body = h('<div class="stack vx-tight"></div>');
    const fillRow = paintRow('fill'), strokeRow = paintRow('stroke');
    body.append(fillRow);
    const fc = VX.paintOf('fill');
    if (fc && fc !== 'mixed' && fc.type === 'gradient') body.append(gradInline('fill', fc));
    body.append(strokeRow);
    const t0 = VX.paintTargets(S.sel)[0];
    const sc = VX.paintOf('stroke');
    if (sc && sc !== 'mixed' && sc.type === 'gradient') body.append(gradInline('stroke', sc));
    // stroke options
    const sw = t0 ? +(t0.strokeWidth || 0).toFixed(3) : S.strokeStyle.width;
    const st = h('<div class="vx-stroke"></div>');
    st.append(fld('Weight', sw, v => VX.applyStyle({ strokeWidth: Math.max(0, v) }, { label: 'Stroke weight' }), { key: 'sw', unit: 'pt', min: 0, step: 0.25 }));
    const segs = (label, prop, opts, cur) => {
      const w = h(`<div class="vx-f"><span>${label}</span><div class="seg">${opts.map(([v, ic, t]) => `<button data-v="${v}" title="${t}" class="${cur === v ? 'on' : ''}">${ic}</button>`).join('')}</div></div>`);
      $$('button', w).forEach(b => b.addEventListener('click', () => VX.applyStyle({ [prop]: b.dataset.v }, { label: 'Stroke' })));
      return w;
    };
    const capIc = c => `<svg class="ico" viewBox="0 0 24 24"><path d="M4 12h${c === 'butt' ? 12 : 12}" stroke="currentColor" stroke-width="6" stroke-linecap="${c}" fill="none"/><path d="M16 6v12" stroke="#ff3dbb" stroke-width="1"/></svg>`;
    const joinIc = j => `<svg class="ico" viewBox="0 0 24 24"><path d="M5 19V7h12" stroke="currentColor" stroke-width="5" stroke-linejoin="${j}" fill="none"/></svg>`;
    st.append(segs('Cap', 'strokeCap', [['butt', capIc('butt'), 'Butt cap'], ['round', capIc('round'), 'Round cap'], ['square', capIc('square'), 'Projecting cap']], t0 ? t0.strokeCap : S.strokeStyle.cap));
    st.append(segs('Corner', 'strokeJoin', [['miter', joinIc('miter'), 'Miter join'], ['round', joinIc('round'), 'Round join'], ['bevel', joinIc('bevel'), 'Bevel join']], t0 ? t0.strokeJoin : S.strokeStyle.join));
    const al = t0 && t0.data && t0.data.strokeAlign || 'center';
    const alignW = h(`<div class="vx-f"><span>Align</span><div class="seg"><button data-v="center" class="${al === 'center' ? 'on' : ''}" title="Align stroke to center">Center</button><button data-v="inside" class="${al === 'inside' ? 'on' : ''}" title="Align stroke inside">Inside</button><button data-v="outside" class="${al === 'outside' ? 'on' : ''}" title="Align stroke outside">Outside</button></div></div>`);
    $$('button', alignW).forEach(b => b.addEventListener('click', () => VX.applyStyle({ strokeAlign: b.dataset.v }, { label: 'Stroke alignment' })));
    st.append(alignW);
    // dashes
    const dash = t0 && t0.dashArray && t0.dashArray.length ? t0.dashArray : null;
    const dashRow = h(`<div class="vx-dash"><label class="check"><input type="checkbox" ${dash ? 'checked' : ''}><span class="check-box">${icon('check')}</span><span>Dashed</span></label></div>`);
    const dv = dash || [Math.max(4, sw * 3), Math.max(3, sw * 2)];
    const dashFields = h('<div class="vx-grid4"></div>');
    const setDash = vals => VX.applyStyle({ dashArray: vals.filter(v => v > 0) }, { label: 'Dashes' });
    ['dash', 'gap', 'dash', 'gap'].forEach((l, i) => dashFields.append(fld(l, dv[i] != null ? +dv[i].toFixed(2) : '', v => { const cur = [...dv]; cur[i] = Math.max(0, v); setDash(cur.filter((x, k) => x != null && k <= Math.max(i, dv.length - 1))); }, { key: 'd' + i, min: 0 })));
    $('input', dashRow).addEventListener('change', e => setDash(e.target.checked ? dv.slice(0, 2) : []));
    if (dash) dashRow.append(dashFields);
    st.append(dashRow);
    // arrowheads
    const A = t0 && t0.data && t0.data.arrows || {};
    const kinds = [['none', 'None'], ['arrow', 'Arrow'], ['open', 'Open arrow'], ['circle', 'Circle'], ['square', 'Square'], ['bar', 'Bar']];
    const arr = h('<div class="vx-grid2"></div>');
    const arrowSel = (end) => { const s = selectField(end === 'start' ? 'Start' : 'End', kinds, A[end] || 'none'); s.select.addEventListener('change', () => { const cur = { ...(t0 && t0.data.arrows || {}), [end]: s.get() }; VX.applyStyle({ arrows: cur.start === 'none' && cur.end === 'none' ? null : cur }, { label: 'Arrowheads' }); }); return s; };
    arr.append(arrowSel('start'), arrowSel('end'));
    st.append(arr);
    if (A.start || A.end) st.append(fld('Arrow scale', Math.round((A.scale || 1) * 100), v => VX.applyStyle({ arrows: { ...A, scale: Math.max(0.1, v / 100) } }, { label: 'Arrowheads' }), { key: 'asc', unit: '%', min: 10 }));
    const strokeDet = h('<details class="vx-sub"><summary>Stroke options</summary></details>');
    try { strokeDet.open = localStorage.getItem('ro3.vector.strokeopen') === '1'; } catch (_) {}
    strokeDet.addEventListener('toggle', () => { try { localStorage.setItem('ro3.vector.strokeopen', strokeDet.open ? '1' : '0'); } catch (_) {} });
    strokeDet.append(st);
    body.append(strokeDet);
    // opacity & blend
    const one = S.sel[0];
    const op = slider({ label: 'Opacity', min: 0, max: 100, value: Math.round((S.sel.length === 1 ? one.opacity : S.sel.every(x => x.opacity === one.opacity) ? one.opacity : 1) * 100), unit: '%' });
    op.input.addEventListener('input', () => { for (const it of S.sel) it.opacity = op.get() / 100; VX.req(); });
    op.input.addEventListener('change', () => VX.commit('Opacity'));
    const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
    const bm = selectField('Blend mode', modes.map(m => [m, m.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())]), one.blendMode || 'normal');
    bm.select.addEventListener('change', () => VX.applyItemProps({ blendMode: bm.get() }, 'Blend mode'));
    body.append(op, bm);
    return section('Appearance', body, { id: 'appearance' });
  }
  function gradInline(kind, c) {
    const w = h('<div class="vx-ginline"></div>');
    const typeSeg = h(`<div class="seg"><button data-r="0" class="${!c.gradient.radial ? 'on' : ''}">Linear</button><button data-r="1" class="${c.gradient.radial ? 'on' : ''}">Radial</button></div>`);
    $$('button', typeSeg).forEach(b => b.addEventListener('click', () => { const nc = new P.Color({ gradient: { stops: c.gradient.stops.map(s => [s.color.clone(), s.offset]), radial: b.dataset.r === '1' }, origin: c.origin, destination: c.destination }); VX.applyPaint(kind, nc, { label: 'Gradient type' }); }));
    let selStop = 0;
    const apply = (nc, commit) => {
      // Keep each object's own gradient geometry; just swap the stops (and angle when changed).
      for (const t of VX.paintTargets(S.sel)) {
        const cur = kind === 'fill' ? t.fillColor : t.strokeColor;
        let next;
        if (nc._angle != null) next = VX.fitGradient(nc, t, nc._angle);
        else next = new P.Color({ gradient: { stops: nc.gradient.stops.map(s => [s.color.clone(), s.offset]), radial: nc.gradient.radial }, origin: cur && cur.origin || nc.origin, destination: cur && cur.destination || nc.destination });
        if (kind === 'fill') t.fillColor = next; else t.strokeColor = next;
      }
      if (kind === 'fill') S.fill = nc.clone(); else S.stroke = nc.clone();
      VX.req(); if (commit) VX.commit('Gradient');
    };
    const bar = VX.gradientBar(c, 0, {
      onSelect: i => { selStop = i; },
      onChange: (nc, commit) => apply(nc, commit),
    });
    bar.addEventListener('dblclick', e => {
      const st = e.target.closest('.vx-gstop'); if (!st) return;
      const cur = VX.paintOf(kind); if (!cur || cur === 'mixed') return;
      const i = selStop;
      VX.colorPicker(st, cur.gradient.stops[i].color, { title: 'Gradient stop', onInput: col => { const now = VX.paintOf(kind); const stops = now.gradient.stops.map((s, k) => [k === i ? col : s.color.clone(), s.offset]); apply(new P.Color({ gradient: { stops, radial: now.gradient.radial }, origin: now.origin, destination: now.destination }), false); }, onCommit: () => VX.commit('Gradient stop') });
    });
    w.append(typeSeg, bar, h('<p class="hint">Click the bar to add a stop · drag a stop down to remove it · double-click a stop to change its color · use the Gradient tool (G) to set direction on the canvas</p>'));
    return w;
  }
  function typeSection(texts) {
    const t0 = texts[0];
    const body = h('<div class="stack vx-tight"></div>');
    const fb = h(`<button class="btn vx-fontbtn wide" title="Font family"><span style="font-family:${esc(VX.cssFamily(t0.fontFamily))}">${esc(t0.fontFamily)}</span>${icon('down')}</button>`);
    fb.addEventListener('click', () => VX.fontPicker(fb, t0.fontFamily, f => VX.applyTextStyle({ fontFamily: f })));
    const w = selectField('Weight', VX.WEIGHTS.map(([v, l]) => [String(v), l]), VX.normW(String(t0.fontWeight)));
    w.select.addEventListener('change', () => VX.applyTextStyle({ fontWeight: w.get() }));
    const g = h('<div class="vx-grid2"></div>');
    g.append(fld('Size', +t0.fontSize.toFixed(2), v => VX.applyTextStyle({ fontSize: Math.max(1, v) }), { key: 'fsz', unit: 'pt', min: 1 }),
      fld('Leading', +t0.leading.toFixed(2), v => VX.applyTextStyle({ leading: Math.max(1, v) }), { key: 'flead', unit: 'pt', min: 1 }),
      fld('Tracking', t0.tracking || 0, v => VX.applyTextStyle({ tracking: v }), { key: 'ftrack', step: 10 }));
    const seg = h(`<div class="seg">${['left', 'center', 'right'].map(j => `<button data-j="${j}" class="${t0.justification === j ? 'on' : ''}" title="Align ${j}">${icon(j === 'left' ? 'alignL' : j === 'center' ? 'alignCH' : 'alignR')}</button>`).join('')}</div>`);
    $$('button', seg).forEach(b => b.addEventListener('click', () => VX.applyTextStyle({ justification: b.dataset.j })));
    g.append(seg);
    const row = h('<div class="vx-btnrow"></div>');
    row.append(smallBtn('vOutlineText', 'Create outlines', () => VX.io.outlineText(), `Create Outlines (${mod()}Shift+O)`));
    if (texts.length === 1) row.append(smallBtn('vText', t0.data.area ? 'To point type' : 'To area type', () => {
      if (t0.data.area) { t0.content = t0.data.text != null ? t0.data.text : t0.content; delete t0.data.area; delete t0.data.text; delete t0.data.overflow; }
      else { const b = t0.bounds; t0.data.text = t0.content; t0.data.area = { w: Math.max(b.width + 2, 40), h: Math.max(b.height + 2, 20) }; VX.layoutAreaText(t0, b.topLeft); }
      VX.commit('Convert type');
    }));
    row.append(smallBtn('vFonts', 'Load font…', () => VX.io.loadFontDialog()));
    body.append(fb, w, g, row);
    return section('Character', body, { id: 'type' });
  }
  function quickActions() {
    const sel = S.sel, n = sel.length;
    const body = h('<div class="vx-qa"></div>');
    const add = (ic, label, fn, title) => body.appendChild(smallBtn(ic, label, fn, title));
    const shapes = sel.filter(it => VX.isPathish(it) || it.className === 'Group');
    if (n > 1) add('group', 'Group', VX.ops.group, `Group (${mod()}G)`);
    if (sel.some(it => it.className === 'Group')) add('group', 'Ungroup', VX.ops.ungroup, `Ungroup (${mod()}Shift+G)`);
    if (shapes.length > 1) {
      const pf = h('<div class="vx-pfrow"></div>');
      [['pfUnite', 'unite', 'Unite'], ['pfMinus', 'minus-front', 'Minus front'], ['pfIntersect', 'intersect', 'Intersect'], ['pfExclude', 'exclude', 'Exclude'], ['pfDivide', 'divide', 'Divide']].forEach(([ic, k, t]) => pf.appendChild(iconBtn(ic, t, () => VX.ops.pathfinder(k))));
      body.appendChild(h('<span class="vx-qa-l">Pathfinder</span>')); body.appendChild(pf);
    }
    if (n > 1) add('vClip', 'Clipping mask', VX.ops.makeClip, `Make Clipping Mask (${mod()}7)`);
    if (sel.some(it => it.className === 'Group' && it.clipped)) add('vClip', 'Release mask', VX.ops.releaseClip, `Release Clipping Mask (${mod()}Alt+7)`);
    if (sel.some(VX.isPathish)) { add('vOffset', 'Offset path…', VX.ops.offsetDialog); add('vOutline', 'Outline stroke', VX.ops.outlineStroke); }
    if (n > 1 && sel.every(VX.isPathish)) add('vCompound', 'Compound path', VX.ops.makeCompound, `Make Compound Path (${mod()}8)`);
    if (sel.some(it => it.className === 'CompoundPath')) add('vCompound', 'Release compound', VX.ops.releaseCompound);
    if (sel.some(it => it.className === 'Raster')) add('vTrace', 'Image Trace…', () => VX.io.traceDialog());
    const arr = h('<div class="vx-pfrow"></div>');
    [['up', 'front', 'Bring to front'], ['chevron', 'forward', 'Bring forward'], ['chevron', 'backward', 'Send backward'], ['down', 'back', 'Send to back']].forEach(([ic, k, t], i) => { const b = iconBtn(ic, t, () => VX.ops.arrange(k)); if (i === 1) b.style.transform = 'rotate(-90deg)'; if (i === 2) b.style.transform = 'rotate(90deg)'; arr.appendChild(b); });
    body.appendChild(h('<span class="vx-qa-l">Arrange</span>')); body.appendChild(arr);
    return section('Quick actions', body, { id: 'qa' });
  }

  // ----- Align & Pathfinder -----
  function alignPanel(box) {
    const body = h('<div class="stack vx-tight"></div>');
    const row = (items) => { const r = h('<div class="vx-pfrow"></div>'); items.forEach(([ic, t, fn]) => r.appendChild(iconBtn(ic, t, fn))); return r; };
    body.append(h('<span class="vx-qa-l">Align objects</span>'), row([['alignL', 'Horizontal align left', () => VX.ops.align('left')], ['alignCH', 'Horizontal align center', () => VX.ops.align('hcenter')], ['alignR', 'Horizontal align right', () => VX.ops.align('right')], ['alignT', 'Vertical align top', () => VX.ops.align('top')], ['alignCV', 'Vertical align center', () => VX.ops.align('vcenter')], ['alignB', 'Vertical align bottom', () => VX.ops.align('bottom')]]));
    body.append(h('<span class="vx-qa-l">Distribute objects</span>'), row([['alignL', 'Distribute left edges', () => VX.ops.distribute('left')], ['alignCH', 'Distribute horizontal centers', () => VX.ops.distribute('hcenter')], ['alignR', 'Distribute right edges', () => VX.ops.distribute('right')], ['alignT', 'Distribute top edges', () => VX.ops.distribute('top')], ['alignCV', 'Distribute vertical centers', () => VX.ops.distribute('vcenter')], ['alignB', 'Distribute bottom edges', () => VX.ops.distribute('bottom')]]));
    body.append(h('<span class="vx-qa-l">Distribute spacing</span>'), row([['vDistSpaceH', 'Horizontal distribute space', () => VX.ops.distribute('space-h')], ['vDistSpaceV', 'Vertical distribute space', () => VX.ops.distribute('space-v')]]));
    const to = selectField('Align to', [['selection', 'Selection'], ['artboard', 'Artboard'], ['key', 'Key object (click a selected object)']], S.alignTo);
    to.select.addEventListener('change', () => { S.alignTo = to.get(); });
    body.append(to);
    box.appendChild(section('Align', body, { id: 'align' }));
    const pf = h('<div class="stack vx-tight"></div>');
    pf.append(h('<span class="vx-qa-l">Shape modes</span>'), row([['pfUnite', 'Unite', () => VX.ops.pathfinder('unite')], ['pfMinus', 'Minus front', () => VX.ops.pathfinder('minus-front')], ['pfIntersect', 'Intersect', () => VX.ops.pathfinder('intersect')], ['pfExclude', 'Exclude', () => VX.ops.pathfinder('exclude')]]));
    pf.append(h('<span class="vx-qa-l">Pathfinders</span>'), row([['pfDivide', 'Divide', () => VX.ops.pathfinder('divide')], ['pfTrim', 'Trim', () => VX.ops.pathfinder('trim')], ['pfUnite', 'Merge', () => VX.ops.pathfinder('merge')], ['pfCrop', 'Crop', () => VX.ops.pathfinder('crop')], ['pfMinusBack', 'Minus back', () => VX.ops.pathfinder('minus-back')]]));
    box.appendChild(section('Pathfinder', pf, { id: 'pathfinder' }));
    const po = h('<div class="vx-qa"></div>');
    [['vOffset', 'Offset path…', VX.ops.offsetDialog], ['vOutline', 'Outline stroke', VX.ops.outlineStroke], ['vSimplify', 'Simplify…', VX.ops.simplifyDialog], ['vCurvature', 'Smooth', VX.ops.smoothPaths], ['vJoin', 'Join', VX.ops.join], ['vReverse', 'Reverse', VX.ops.reverse], ['vCompound', 'Compound path', VX.ops.makeCompound], ['vCompound', 'Release compound', VX.ops.releaseCompound], ['vClip', 'Clipping mask', VX.ops.makeClip], ['vClip', 'Release mask', VX.ops.releaseClip], ['vRect', 'Round corners…', VX.ops.roundCornersDialog], ['vAddAnchor', 'Add anchors', VX.ops.addAnchors], ['vOutline', 'Expand appearance', VX.ops.expandAppearance]].forEach(([ic, l, fn]) => po.appendChild(smallBtn(ic, l, () => fn())));
    box.appendChild(section('Path', po, { id: 'pathops' }));
    const tf = h('<div class="vx-qa"></div>');
    [['move', 'Move…', VX.ops.moveDialog], ['vRotate', 'Rotate…', VX.ops.rotateDialog], ['vScale', 'Scale…', VX.ops.scaleDialog], ['flipH', 'Flip H', () => VX.ops.flip('h')], ['flipV', 'Flip V', () => VX.ops.flip('v')], ['vRepeat', 'Transform again', VX.ops.transformAgain]].forEach(([ic, l, fn]) => tf.appendChild(smallBtn(ic, l, () => fn())));
    box.appendChild(section('Transform', tf, { id: 'tfops' }));
  }

  // ----- Swatches -----
  const brandKey = 'ro3.vector.brand';
  const loadBrand = () => { try { return JSON.parse(localStorage.getItem(brandKey) || '[]'); } catch (_) { return []; } };
  const saveBrand = g => { try { localStorage.setItem(brandKey, JSON.stringify(g)); } catch (_) {} };
  VX.brandGroups = loadBrand;
  function applySwatch(sw, e) {
    const c = VX.swatchColor(sw);
    const kind = e && e.shiftKey ? (S.focus === 'fill' ? 'stroke' : 'fill') : S.focus;
    VX.applyPaint(kind, c, { label: 'Swatch' });
  }
  function swGrid(list, { onDelete, onRename } = {}) {
    const g = h('<div class="vx-swgrid"></div>');
    list.forEach((sw, i) => {
      const b = h(`<button title="${esc((sw.name ? sw.name + ' — ' : '') + (sw.g ? 'Gradient' : sw.color))}${onDelete ? ' · Alt-click to delete' : ''}" style="background:${esc(swatchCss(sw))}" class="${sw.color === 'none' ? 'none' : ''}"></button>`);
      b.addEventListener('click', e => { if (e.altKey && onDelete) return onDelete(i); applySwatch(sw, e); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); menuAt(b, [{ label: 'Apply to fill', onClick: () => VX.applyPaint('fill', VX.swatchColor(sw)) }, { label: 'Apply to stroke', onClick: () => VX.applyPaint('stroke', VX.swatchColor(sw)) }, ...(onRename ? [{ label: 'Rename…', onClick: () => onRename(i) }] : []), ...(onDelete ? [{ label: 'Delete', onClick: () => onDelete(i) }] : [])]); });
      g.appendChild(b);
    });
    return g;
  }
  function swatchPanel(box) {
    const d = S.doc;
    const docBody = h('<div class="stack vx-tight"></div>');
    const docSw = [{ color: 'none' }, ...d.swatches];
    docBody.append(swGrid(docSw, { onDelete: i => { if (i === 0) return; d.swatches.splice(i - 1, 1); VX.commit('Delete swatch'); }, onRename: async i => { if (!i) return; const n = await promptBox('Rename swatch', 'Name', d.swatches[i - 1].name || ''); if (n != null) { d.swatches[i - 1].name = n; VX.commit('Rename swatch'); } } }));
    const r = h('<div class="vx-btnrow"></div>');
    r.append(smallBtn('plus', 'Add current', () => { const c = S.focus === 'fill' ? S.fill : S.stroke; if (!c) return toast('The current color is None.', 'info'); d.swatches.push(VX.swatchOf(c)); VX.commit('Add swatch'); }, 'Add the current fill/stroke color'),
      smallBtn('vDropper', 'From selection', () => { const set = new Map(); VX.paintTargets(S.sel).forEach(t => [t.fillColor, t.strokeColor].forEach(c => { if (c) { const s = VX.swatchOf(c); set.set(JSON.stringify(s), s); } })); if (!set.size) return toast('Select colored objects first.', 'info'); d.swatches.push(...[...set.values()].filter(s => !d.swatches.some(x => JSON.stringify(x) === JSON.stringify(s)))); VX.commit('Add swatches'); }, 'Add every color used in the selection'));
    docBody.append(r, h('<p class="hint">Click applies to the active fill/stroke (Shift-click: the other one) · Alt-click deletes · right-click for more</p>'));
    box.appendChild(section('Document swatches', docBody, { id: 'docsw' }));
    // brand groups (shared across documents)
    const groups = loadBrand();
    const bb = h('<div class="stack vx-tight"></div>');
    if (!groups.length) bb.append(h('<p class="hint">Save brand palettes here — they’re available in every document.</p>'));
    groups.forEach((g, gi) => {
      const head = h(`<div class="vx-brandhead"><strong>${esc(g.name)}</strong></div>`);
      head.append(iconBtn('plus', 'Add the current color', () => { const c = S.focus === 'fill' ? S.fill : S.stroke; if (!c) return; g.colors.push(VX.swatchOf(c)); saveBrand(groups); VX.refreshPanels(true); }),
        iconBtn('copy', 'Copy into document swatches', () => { d.swatches.push(...g.colors.map(x => ({ ...x }))); VX.commit('Add brand swatches'); }),
        iconBtn('sliders', 'Rename or delete', () => menuAt(head, [{ label: 'Rename…', onClick: async () => { const n = await promptBox('Rename group', 'Name', g.name); if (n) { g.name = n; saveBrand(groups); VX.refreshPanels(true); } } }, { label: 'Delete group', onClick: async () => { if (await confirmBox('Delete brand group?', `Delete “${g.name}”?`, 'Delete', 'danger')) { groups.splice(gi, 1); saveBrand(groups); VX.refreshPanels(true); } } }])));
      bb.append(head, swGrid(g.colors, { onDelete: i => { g.colors.splice(i, 1); saveBrand(groups); VX.refreshPanels(true); } }));
    });
    const nb = h('<div class="vx-btnrow"></div>');
    nb.append(smallBtn('plus', 'New brand group…', async () => {
      const n = await promptBox('New brand group', 'Name', 'Brand'); if (!n) return;
      const set = new Map(); VX.paintTargets(S.sel).forEach(t => [t.fillColor, t.strokeColor].forEach(c => { if (c) { const s = VX.swatchOf(c); set.set(JSON.stringify(s), s); } }));
      groups.push({ id: uid('bg'), name: n, colors: set.size ? [...set.values()] : d.swatches.map(x => ({ ...x })) }); saveBrand(groups); VX.refreshPanels(true);
    }, 'Create a group from the selection’s colors (or the document swatches)'));
    bb.append(nb);
    box.appendChild(section('Brand groups', bb, { id: 'brand' }));
  }

  // ----- Layers -----
  const expanded = new WeakSet();
  let dragRow = null;
  function layersPanel(box) {
    box.innerHTML = '';
    const list = h('<div class="vx-layers" role="tree"></div>');
    const layers = S.project.layers.slice().reverse();
    let count = 0;
    const selSet = new Set(S.sel), anc = new Set();
    for (const s of S.sel) for (let p = s.parent; p && !anc.has(p); p = p.parent) anc.add(p);
    const isSel = it => selSet.has(it);
    const containsSel = it => anc.has(it);
    const row = (it, depth) => {
      if (count++ > 800) return;
      const isL = VX.isLayer(it);
      const kids = it.className === 'Group' || isL ? it.children : null;
      if (isL && !expanded.has(it) && !it.data._seen) { it.data._seen = 1; expanded.add(it); }
      const open = kids && expanded.has(it);
      const col = VX.layerColor(it.layer || it);
      const r = h(`<div class="vx-lrow ${isL ? 'layer' : ''} ${isSel(it) ? 'sel' : ''} ${isL && it === S.project.activeLayer ? 'active' : ''} ${!it.visible ? 'hid' : ''}" style="--d:${depth}" draggable="true" role="treeitem">
        <button class="icon-btn vx-eye" title="${it.visible ? 'Hide' : 'Show'}">${icon(it.visible ? 'eye' : 'eyeOff')}</button>
        <button class="icon-btn vx-lock ${it.locked ? 'on' : ''}" title="${it.locked ? 'Unlock' : 'Lock'}">${icon(it.locked ? 'lock' : 'unlock')}</button>
        <span class="vx-lcol" style="background:${col}"></span>
        ${kids && kids.length ? `<button class="icon-btn vx-chev ${open ? 'open' : ''}">${icon('chevron')}</button>` : '<span class="vx-chev-sp"></span>'}
        <span class="vx-lthumb">${thumbIcon(it)}</span>
        <span class="vx-lname">${esc(isL ? it.name || 'Layer' : VX.nameOf(it))}</span>
        <span class="vx-target ${isSel(it) ? 'on' : containsSel(it) ? 'part' : ''}" style="--c:${col}" title="Select"></span></div>`);
      r._item = it;
      $('.vx-eye', r).addEventListener('click', e => { e.stopPropagation(); it.visible = !it.visible; if (!it.visible) S.sel = S.sel.filter(s => s !== it && !it.isAncestor(s)); VX.selectionChanged(); VX.commit(it.visible ? 'Show' : 'Hide'); });
      $('.vx-lock', r).addEventListener('click', e => { e.stopPropagation(); it.locked = !it.locked; if (it.locked) S.sel = S.sel.filter(s => s !== it && !it.isAncestor(s)); VX.selectionChanged(); VX.commit(it.locked ? 'Lock' : 'Unlock'); });
      const chev = $('.vx-chev', r); if (chev) chev.addEventListener('click', e => { e.stopPropagation(); if (expanded.has(it)) expanded.delete(it); else expanded.add(it); VX.refreshPanels(true); });
      r.addEventListener('click', e => {
        if (isL) { it.activate(); if (e.target.closest('.vx-target')) { VX.select(it.children.filter(c => VX.selectable(c)), { add: e.shiftKey }); return; } VX.refreshPanels(true); return; }
        if (!VX.selectable(it)) return toast('That object is hidden or locked.', 'info', 1400);
        if (S.isolation && !S.isolation.isAncestor(it)) VX.exitIsolation();
        S.pts.clear(); VX.select([it], { toggle: e.shiftKey || e.ctrlKey || e.metaKey });
      });
      r.addEventListener('dblclick', e => {
        if (!e.target.closest('.vx-lname')) return;
        const nm = $('.vx-lname', r); const inp = h(`<input class="inline vx-lrename" value="${esc(isL ? it.name : it.name || '')}" placeholder="${esc(VX.nameOf(it))}">`);
        nm.replaceWith(inp); inp.focus(); inp.select();
        const done = ok => { if (ok) { it.name = inp.value.trim() || null; if (isL && !it.name) it.name = 'Layer'; VX.commit('Rename'); } else VX.refreshPanels(true); };
        inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.dataset.cancel = 1; inp.blur(); } });
        inp.addEventListener('blur', () => done(!inp.dataset.cancel));
      });
      r.addEventListener('dragstart', e => { dragRow = it; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'layer'); r.classList.add('dragging'); });
      r.addEventListener('dragend', () => { dragRow = null; r.classList.remove('dragging'); $$('.drop-a,.drop-b,.drop-in', list).forEach(x => x.classList.remove('drop-a', 'drop-b', 'drop-in')); });
      r.addEventListener('dragover', e => {
        if (!dragRow || dragRow === it || dragRow.isAncestor(it)) return;
        e.preventDefault();
        const b = r.getBoundingClientRect(), f = (e.clientY - b.top) / b.height;
        const into = (it.className === 'Group' || isL) && f > 0.3 && f < 0.7;
        r.classList.toggle('drop-in', into); r.classList.toggle('drop-a', !into && f <= 0.5); r.classList.toggle('drop-b', !into && f > 0.5);
        if (VX.isLayer(dragRow) && !isL) { r.classList.remove('drop-in', 'drop-a', 'drop-b'); e.dataTransfer.dropEffect = 'none'; }
      });
      r.addEventListener('dragleave', () => r.classList.remove('drop-a', 'drop-b', 'drop-in'));
      r.addEventListener('drop', e => {
        e.preventDefault();
        const mode = r.classList.contains('drop-in') ? 'in' : r.classList.contains('drop-a') ? 'above' : 'below';
        r.classList.remove('drop-a', 'drop-b', 'drop-in');
        const src = dragRow; dragRow = null; if (!src || src === it) return;
        if (VX.isLayer(src)) { if (!isL) return; if (mode === 'above') src.insertAbove(it); else src.insertBelow(it); }
        else if (mode === 'in') it.addChild(src);
        else if (isL) { if (mode === 'above') it.addChild(src); else it.insertChild(0, src); }
        else if (mode === 'above') src.insertAbove(it); else src.insertBelow(it);
        VX.commit('Reorder'); VX.refreshPanels(true);
      });
      list.appendChild(r);
      if (open) kids.slice().reverse().forEach(k => row(k, depth + 1));
    };
    // auto-expand ancestors of the selection
    for (const p of anc) expanded.add(p);
    layers.forEach(L => row(L, 0));
    if (count > 800) list.appendChild(h('<p class="hint vx-pad">Showing the first 800 rows.</p>'));
    box.appendChild(list);
    const tools = h('<div class="vx-ltools"></div>');
    tools.append(
      iconBtn('plus', 'New layer', () => { const L = new P.Layer({ name: `Layer ${S.project.layers.length + 1}` }); L.insertAbove(S.project.activeLayer || S.project.layers[0]); L.activate(); expanded.add(L); VX.commit('New layer'); }),
      iconBtn('copy', 'Duplicate selection or layer', () => { if (S.sel.length) VX.ops.duplicate(); else { const L = S.project.activeLayer; const c = L.clone(); c.name = L.name + ' copy'; c.activate(); VX.commit('Duplicate layer'); } }),
      iconBtn('vClip', 'Make/release clipping mask', () => S.sel.some(x => x.clipped) ? VX.ops.releaseClip() : VX.ops.makeClip()),
      iconBtn('group', 'Group selection', () => VX.ops.group()),
      h('<span class="grow"></span>'),
      iconBtn('trash', 'Delete selection or layer', async () => {
        if (S.sel.length) return VX.ops.del();
        const L = S.project.activeLayer; if (S.project.layers.length < 2) return toast('A document needs at least one layer.', 'info');
        if (L.children.length && !await confirmBox('Delete layer?', `“${L.name}” contains artwork. Delete it?`, 'Delete', 'danger')) return;
        L.remove(); S.project.layers[S.project.layers.length - 1].activate(); VX.commit('Delete layer');
      }));
    box.appendChild(tools);
  }
  function thumbIcon(it) {
    const ic = { Layer: 'layers', Group: 'group', CompoundPath: 'vCompound', PointText: 'vText', Raster: 'image', Path: it.data && it.data.live ? 'vRect' : 'vPen' }[it.className] || 'vPen';
    const c = it.className === 'Path' || it.className === 'CompoundPath' ? (it.fillColor && it.fillColor.type !== 'gradient' ? it.fillColor.toCSS(true) : it.strokeColor && it.strokeColor.type !== 'gradient' ? it.strokeColor.toCSS(true) : '') : '';
    if (it.className === 'Group' && it.clipped) return icon('vClip');
    return c ? `<i style="background:${esc(c)}"></i>` : icon(ic);
  }

  // ----- Artboards -----
  function artboardsPanel(box) {
    box.innerHTML = '';
    const list = h('<div class="vx-ablist"></div>');
    S.doc.artboards.forEach((a, i) => {
      const r = h(`<div class="vx-abrow ${i === S.doc.ab ? 'on' : ''}"><span class="vx-abn">${i + 1}</span><span class="vx-abthumb"><i style="aspect-ratio:${a.w}/${a.h}"></i></span><span class="vx-abname">${esc(a.name)}</span><em>${VX.fmtU(a.w)} × ${VX.fmtU(a.h)}</em></div>`);
      r.addEventListener('click', () => VX.ab.activate(i, true));
      r.addEventListener('dblclick', async () => { const n = await promptBox('Rename artboard', 'Name', a.name); if (n) VX.ab.rename(i, n.trim()); });
      r.addEventListener('contextmenu', e => { e.preventDefault(); menuAt(r, [{ label: 'Rename…', onClick: async () => { const n = await promptBox('Rename artboard', 'Name', a.name); if (n) VX.ab.rename(i, n.trim()); } }, { label: 'Duplicate', onClick: () => VX.ab.duplicate(i) }, { label: 'Fit to artwork', onClick: () => VX.ab.fitToArt(i) }, { label: 'Move up', onClick: () => VX.ab.move(i, i - 1), disabled: !i }, { label: 'Move down', onClick: () => VX.ab.move(i, i + 1), disabled: i === S.doc.artboards.length - 1 }, 'sep', { label: 'Delete', onClick: () => VX.ab.remove(i) }]); });
      list.appendChild(r);
    });
    box.appendChild(list);
    const tools = h('<div class="vx-ltools"></div>');
    tools.append(iconBtn('plus', 'New artboard', () => VX.ab.add()), iconBtn('copy', 'Duplicate artboard', () => VX.ab.duplicate()), iconBtn('up', 'Move up', () => VX.ab.move(S.doc.ab, S.doc.ab - 1)), iconBtn('down', 'Move down', () => VX.ab.move(S.doc.ab, S.doc.ab + 1)), iconBtn('vArtboard', 'Artboard tool (Shift+O)', () => VX.setTool('artboard')), h('<span class="grow"></span>'), iconBtn('trash', 'Delete artboard', () => VX.ab.remove()));
    box.appendChild(tools);
  }

  // ----- History -----
  function historyPanel(box) {
    box.innerHTML = '';
    const list = h('<div class="vx-hist"></div>');
    VX.historyLabels().forEach(x => {
      const r = h(`<div class="vx-hrow ${x.current ? 'on' : ''} ${x.i > S.hist.i ? 'future' : ''}">${esc(x.label)}</div>`);
      r.addEventListener('click', () => VX.goHistory(x.i));
      list.appendChild(r);
    });
    box.appendChild(list);
    requestAnimationFrame(() => { const on = $('.vx-hrow.on', list); on && on.scrollIntoView({ block: 'nearest' }); });
  }

  // ---------- font picker ----------
  VX.fontPicker = async (anchor, current, onPick) => {
    $$('.vx-fontpick').forEach(x => x.remove());
    const fams = await VX.io.fontFamilies();
    const el = h(`<div class="vx-fontpick"><input type="search" placeholder="Search fonts…" spellcheck="false"><div class="vx-fp-list"></div><div class="vx-fp-foot"><button class="btn btn-sm">${icon('plus')}Load font file…</button><span class="hint">${fams.length} fonts</span></div></div>`);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.left = clamp(r.left, 8, innerWidth - 300) + 'px';
    el.style.top = (r.bottom + 4 + 380 > innerHeight ? Math.max(8, r.top - 384) : r.bottom + 4) + 'px';
    const inp = $('input', el), list = $('.vx-fp-list', el);
    const paint = () => {
      const q = inp.value.trim().toLowerCase();
      const show = fams.filter(f => !q || f.family.toLowerCase().includes(q)).slice(0, 400);
      list.innerHTML = show.map(f => `<button data-f="${esc(f.family)}" class="${f.family === current ? 'on' : ''}"><span style="font-family:${esc(VX.cssFamily(f.family))}">${esc(f.family)}</span><em>${esc(f.source)}</em></button>`).join('') || '<p class="hint vx-pad">No fonts match.</p>';
      const on = $('.on', list); on && on.scrollIntoView({ block: 'center' });
    };
    const close = () => { el.remove(); document.removeEventListener('pointerdown', off, true); };
    const off = e => { if (!el.contains(e.target)) close(); };
    list.addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; close(); onPick(b.dataset.f); });
    inp.addEventListener('input', paint);
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') { const b = $('button[data-f]', list); if (b) { close(); onPick(b.dataset.f); } } });
    $('.vx-fp-foot .btn', el).addEventListener('click', async () => { close(); const fam = await VX.io.loadFontDialog(); if (fam) onPick(fam); });
    setTimeout(() => document.addEventListener('pointerdown', off, true));
    paint(); inp.focus();
  };
})();

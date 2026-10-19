// Photoshop (.psd) import/export with layers, masks, blend modes, clipping, adjustment layers and basic layer styles.
const PhotoPSD = (() => {
  const O = PhotoOps;
  const TO_PS = {
    'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
    'color-dodge': 'color dodge', 'color-burn': 'color burn', 'hard-light': 'hard light', 'soft-light': 'soft light',
    difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity', lighter: 'linear dodge',
  };
  const FROM_PS = Object.fromEntries(Object.entries(TO_PS).map(([a, b]) => [b, a]));
  const blendFrom = b => FROM_PS[b] || 'source-over';

  const hex2 = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  function colorHex(c) {
    if (!c) return '#000000';
    if ('r' in c) return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
    if ('fr' in c) return '#' + hex2(c.fr * 255) + hex2(c.fg * 255) + hex2(c.fb * 255);
    if ('k' in c && !('c' in c)) { const v = 255 * (1 - c.k / 100); return '#' + hex2(v) + hex2(v) + hex2(v); }
    return '#000000';
  }
  const rgbOf = hx => { const [r, g, b] = PhotoAdjust.hexRgb(hx); return { r, g, b }; };
  const px = v => typeof v === 'number' ? v : (v && v.value) || 0;

  // ---------- adjustments ----------
  function adjFrom(a) {
    const lv = c => c ? { inB: c.shadowInput ?? 0, inW: c.highlightInput ?? 255, gamma: c.midtoneInput ?? 1, outB: c.shadowOutput ?? 0, outW: c.highlightOutput ?? 255 } : undefined;
    const cv = c => c && c.length ? c.map(p => [p.input, p.output]) : undefined;
    const base = k => PhotoAdjust.make(k);
    switch (a.type) {
      case 'levels': { const o = base('levels'); for (const [k, s] of [['rgb', 'rgb'], ['r', 'red'], ['g', 'green'], ['b', 'blue']]) if (a[s]) o[k] = lv(a[s]); return o; }
      case 'curves': { const o = base('curves'); for (const [k, s] of [['rgb', 'rgb'], ['r', 'red'], ['g', 'green'], ['b', 'blue']]) if (cv(a[s])) o[k] = cv(a[s]); return o; }
      case 'brightness/contrast': return { ...base('brightness'), brightness: a.brightness || 0, contrast: a.contrast || 0 };
      case 'exposure': return { ...base('exposure'), exposure: a.exposure || 0, offset: a.offset || 0, gamma: a.gamma || 1 };
      case 'vibrance': return { ...base('vibrance'), vibrance: a.vibrance || 0, saturation: a.saturation || 0 };
      case 'hue/saturation': { const m = a.master || {}; return { ...base('huesat'), hue: m.hue || 0, sat: m.saturation || 0, light: m.lightness || 0 }; }
      case 'color balance': {
        const t = v => v ? [v.cyanRed || 0, v.magentaGreen || 0, v.yellowBlue || 0] : [0, 0, 0];
        return { ...base('colorbalance'), shadows: t(a.shadows), midtones: t(a.midtones), highlights: t(a.highlights), preserve: a.preserveLuminosity !== false };
      }
      case 'black & white': {
        const o = base('bw');
        for (const k of ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas']) if (typeof a[k] === 'number') o[k] = a[k];
        o.tint = !!a.useTint; if (a.tintColor) o.tintColor = colorHex(a.tintColor);
        return o;
      }
      case 'photo filter': return { ...base('photofilter'), color: a.color ? colorHex(a.color) : '#ec8a00', density: a.density ?? 25, preserve: a.preserveLuminosity !== false };
      case 'invert': return base('invert');
      case 'posterize': return { ...base('posterize'), levels: a.levels || 4 };
      case 'threshold': return { ...base('threshold'), level: a.level || 128 };
      case 'gradient map': {
        const s = (a.colorStops || []).slice().sort((x, y) => x.location - y.location);
        return { ...base('gradientmap'), c1: s.length ? colorHex(s[0].color) : '#000000', c2: s.length ? colorHex(s[s.length - 1].color) : '#ffffff', reverse: !!a.reverse };
      }
    }
    return null;
  }
  function adjTo(a) {
    const lv = c => ({ shadowInput: c.inB, highlightInput: c.inW, midtoneInput: c.gamma, shadowOutput: c.outB, highlightOutput: c.outW });
    const cv = c => c.map(([x, y]) => ({ input: x, output: y }));
    switch (a.kind) {
      case 'levels': return { type: 'levels', rgb: lv(a.rgb), red: lv(a.r), green: lv(a.g), blue: lv(a.b) };
      case 'curves': return { type: 'curves', rgb: cv(a.rgb), red: cv(a.r), green: cv(a.g), blue: cv(a.b) };
      case 'brightness': return { type: 'brightness/contrast', brightness: Math.round(a.brightness), contrast: Math.round(a.contrast), useLegacy: false, meanValue: 127, labColorOnly: false, auto: false };
      case 'exposure': return { type: 'exposure', exposure: a.exposure, offset: a.offset, gamma: a.gamma };
      case 'vibrance': return { type: 'vibrance', vibrance: a.vibrance, saturation: a.saturation };
      case 'huesat': return { type: 'hue/saturation', master: { a: 0, b: 0, c: 0, d: 0, hue: a.hue, saturation: a.sat, lightness: a.light } };
      case 'colorbalance': { const t = v => ({ cyanRed: v[0], magentaGreen: v[1], yellowBlue: v[2] }); return { type: 'color balance', shadows: t(a.shadows), midtones: t(a.midtones), highlights: t(a.highlights), preserveLuminosity: !!a.preserve }; }
      case 'bw': return { type: 'black & white', reds: a.reds, yellows: a.yellows, greens: a.greens, cyans: a.cyans, blues: a.blues, magentas: a.magentas, useTint: !!a.tint, tintColor: rgbOf(a.tintColor) };
      case 'photofilter': return { type: 'photo filter', color: rgbOf(a.color), density: a.density, preserveLuminosity: !!a.preserve };
      case 'invert': return { type: 'invert' };
      case 'posterize': return { type: 'posterize', levels: a.levels };
      case 'threshold': return { type: 'threshold', level: a.level };
      case 'gradientmap': return { type: 'gradient map', name: 'RO3 gradient', gradientType: 'solid', reverse: !!a.reverse, smoothness: 1,
        colorStops: [{ color: rgbOf(a.c1), location: 0, midpoint: 0.5 }, { color: rgbOf(a.c2), location: 1, midpoint: 0.5 }],
        opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }, { opacity: 1, location: 1, midpoint: 0.5 }] };
    }
    return null;
  }

  // ---------- layer styles ----------
  function fxFrom(e) {
    if (!e || e.disabled) return null;
    const fx = {};
    const ds = e.dropShadow && e.dropShadow.find(x => x.enabled !== false);
    if (ds) fx.shadow = { on: true, color: colorHex(ds.color), opacity: Math.round((ds.opacity ?? 0.75) * 100), angle: ds.angle ?? 120, distance: px(ds.distance), size: px(ds.size) };
    const g = e.outerGlow;
    if (g && g.enabled !== false) fx.glow = { on: true, color: colorHex(g.color), opacity: Math.round((g.opacity ?? 0.75) * 100), size: px(g.size) };
    const st = e.stroke && e.stroke.find(x => x.enabled !== false && (!x.fillType || x.fillType === 'color'));
    if (st) fx.stroke = { on: true, color: colorHex(st.color), size: px(st.size), opacity: Math.round((st.opacity ?? 1) * 100) };
    const sf = e.solidFill && e.solidFill.find(x => x.enabled !== false);
    if (sf) fx.overlay = { on: true, color: colorHex(sf.color), opacity: Math.round((sf.opacity ?? 1) * 100) };
    return Object.keys(fx).length ? fx : null;
  }
  function fxTo(fx) {
    if (!PhotoCompose.fxOn(fx)) return undefined;
    const e = {};
    const pxv = v => ({ units: 'Pixels', value: v });
    if (fx.shadow && fx.shadow.on) e.dropShadow = [{ enabled: true, present: true, showInDialog: true, color: rgbOf(fx.shadow.color), opacity: fx.shadow.opacity / 100, angle: fx.shadow.angle, distance: pxv(fx.shadow.distance), size: pxv(fx.shadow.size), blendMode: 'multiply', useGlobalLight: false, choke: pxv(0) }];
    if (fx.glow && fx.glow.on) e.outerGlow = { enabled: true, present: true, showInDialog: true, color: rgbOf(fx.glow.color), opacity: fx.glow.opacity / 100, size: pxv(fx.glow.size), blendMode: 'screen', choke: pxv(0), range: 0.5 };
    if (fx.stroke && fx.stroke.on) e.stroke = [{ enabled: true, present: true, showInDialog: true, color: rgbOf(fx.stroke.color), opacity: fx.stroke.opacity / 100, size: pxv(fx.stroke.size), position: 'outside', fillType: 'color', blendMode: 'normal' }];
    if (fx.overlay && fx.overlay.on) e.solidFill = [{ enabled: true, present: true, showInDialog: true, color: rgbOf(fx.overlay.color), opacity: fx.overlay.opacity / 100, blendMode: 'normal' }];
    return e;
  }

  // ---------- masks ----------
  /** PSD grayscale mask → RO3 alpha mask sized like `w×h` at layer offset (lx,ly). */
  function maskFrom(m, w, h, lx, ly) {
    const out = O.mk(w, h), oc = O.cx(out);
    if ((m.defaultColor ?? 0) >= 128) { oc.fillStyle = '#fff'; oc.fillRect(0, 0, w, h); }
    if (m.canvas && m.canvas.width && m.canvas.height) {
      const src = m.canvas, id = O.cx(src).getImageData(0, 0, src.width, src.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 255; }
      const t = O.mk(src.width, src.height); O.cx(t).putImageData(id, 0, 0);
      const mx = (m.left || 0) - lx, my = (m.top || 0) - ly;
      oc.clearRect(mx, my, src.width, src.height); oc.drawImage(t, mx, my);
    }
    return out;
  }
  function maskTo(mask) {
    const id = O.cx(mask).getImageData(0, 0, mask.width, mask.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; d[i] = d[i + 1] = d[i + 2] = a; d[i + 3] = 255; }
    const c = O.mk(mask.width, mask.height); O.cx(c).putImageData(id, 0, 0);
    return c;
  }

  // ---------- open ----------
  async function load(path, makeLayer) {
    const bytes = await ro3.readBytes(path);
    let psd;
    try { psd = agPsd.readPsd(bytes, { skipThumbnail: true, skipLinkedFilesData: true }); }
    catch (e) { throw new Error(`This PSD couldn't be read (${e.message}). Try re-saving it from Photoshop with "Maximize compatibility" on.`); }
    const W = psd.width, H = psd.height, layers = [], notes = new Set(), groups = {};
    let gn = 0;
    const walk = (list, inherit) => {
      for (const L of list || []) {
        const hidden = inherit.hidden || !!L.hidden;
        const opacity = (L.opacity ?? 1) * inherit.opacity;
        const name = (inherit.prefix ? inherit.prefix + ' / ' : '') + (L.name || 'Layer');
        if (L.children) {
          if (!inherit.group) {
            // top-level folder → RO3 group (nested folders fold into it with prefixed names)
            const id = 'psdg' + (++gn);
            groups[id] = { id, name: L.name || 'Group', visible: !L.hidden, opacity: L.opacity ?? 1, blend: !L.blendMode || L.blendMode === 'pass through' ? 'pass' : blendFrom(L.blendMode), collapsed: L.opened === false };
            walk(L.children, { hidden: false, opacity: 1, prefix: '', group: id });
          } else {
            if (L.blendMode && L.blendMode !== 'pass through' && L.blendMode !== 'normal') notes.add('blend modes on nested groups');
            walk(L.children, { hidden, opacity, prefix: name, group: inherit.group });
          }
          continue;
        }
        let l;
        if (L.adjustment) {
          const a = adjFrom(L.adjustment);
          if (!a) { notes.add(`${L.adjustment.type} adjustments`); continue; }
          l = makeLayer(O.mk(W, H), name, 0, 0);
          l.type = 'adjust'; l.adj = a; l.editMask = true;
          l.mask = L.mask ? maskFrom(L.mask, W, H, 0, 0) : (() => { const m = O.mk(W, H), c = O.cx(m); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); return m; })();
        } else if (L.canvas && L.canvas.width && L.canvas.height) {
          l = makeLayer(L.canvas, name, L.left || 0, L.top || 0);
          if (L.mask && (L.mask.canvas || (L.mask.defaultColor ?? 0) < 128)) {
            l.mask = maskFrom(L.mask, L.canvas.width, L.canvas.height, L.left || 0, L.top || 0);
            l.maskOn = !L.mask.disabled;
          }
          l.fx = fxFrom(L.effects);
          if (L.text) notes.add('text layers (kept as pixels)');
          if (L.placedLayer) notes.add('smart objects (kept as pixels)');
        } else {
          if (L.vectorFill || L.vectorMask) notes.add('shape/fill layers without pixels');
          continue;
        }
        l.opacity = opacity; l.blend = blendFrom(L.blendMode); l.visible = !hidden; l.clip = !!L.clipping; l.group = inherit.group || null;
        if (L.blendMode && !FROM_PS[L.blendMode] && L.blendMode !== 'pass through') notes.add(`"${L.blendMode}" blend mode`);
        layers.push(l);
      }
    };
    walk(psd.children, { hidden: false, opacity: 1, prefix: '' });
    if (!layers.length) {
      if (!psd.canvas) throw new Error('This PSD has no readable layers or composite image.');
      layers.push(makeLayer(psd.canvas, 'Background', 0, 0));
    }
    return { width: W, height: H, layers, groups, notes: [...notes] };
  }

  // ---------- save ----------
  async function save(path, doc, composite) {
    const flat = doc.layers.map(l => {
      const o = { name: l.name, opacity: l.opacity, blendMode: TO_PS[l.blend] || 'normal', hidden: !l.visible, clipping: !!l.clip };
      if (l.type === 'adjust') {
        o.adjustment = adjTo(l.adj);
        o.left = 0; o.top = 0;
        if (l.mask) o.mask = { canvas: maskTo(l.mask), left: l.x, top: l.y, defaultColor: 0, disabled: !l.maskOn };
      } else {
        o.canvas = l.canvas; o.left = l.x; o.top = l.y;
        if (l.mask) o.mask = { canvas: maskTo(l.mask), left: l.x, top: l.y, defaultColor: 0, disabled: !l.maskOn };
        const e = fxTo(l.fx); if (e) o.effects = e;
      }
      return o;
    });
    // wrap each contiguous group run in a Photoshop folder
    const G = doc.groups || {}, children = [];
    for (let i = 0; i < doc.layers.length; i++) {
      const g = doc.layers[i].group && G[doc.layers[i].group];
      if (!g) { children.push(flat[i]); continue; }
      const kids = [];
      while (i < doc.layers.length && doc.layers[i].group === g.id) kids.push(flat[i++]);
      i--;
      children.push({ name: g.name, opacity: g.opacity, hidden: !g.visible, opened: !g.collapsed, blendMode: g.blend === 'pass' ? 'pass through' : (TO_PS[g.blend] || 'normal'), children: kids });
    }
    const buf = agPsd.writePsd({ width: doc.width, height: doc.height, children, canvas: composite }, { generateThumbnail: true, noBackground: true });
    await ro3.writeBytes(path, new Uint8Array(buf));
  }

  return { load, save, adjFrom, adjTo };
})();

// Draws the device frames (Pixel-style, Galaxy-style, Island-style, tablet, custom) at any size.
// The frame is laid out in the device's natural orientation and turned with CSS when the device is rotated;
// the live screen sits on top, unrotated, in the rectangle returned by layoutFrame().
'use strict';
(function () {
  // all lengths are fractions of the screen's short edge
  const GEO = {
    pixel: { bezel: 0.05, screenR: 0.085, outerR: 0.13, cam: { kind: 'hole', d: 0.038, top: 0.032 }, buttons: [{ side: 'right', at: 0.2, len: 0.09, power: true }, { side: 'right', at: 0.33, len: 0.17 }] },
    galaxy: { bezel: 0.026, screenR: 0.03, outerR: 0.05, cam: { kind: 'hole', d: 0.032, top: 0.024 }, buttons: [{ side: 'right', at: 0.2, len: 0.13 }, { side: 'right', at: 0.37, len: 0.08, power: true }] },
    island: { bezel: 0.052, screenR: 0.135, outerR: 0.19, cam: { kind: 'island', w: 0.3, h: 0.088, top: 0.03 }, buttons: [{ side: 'right', at: 0.26, len: 0.16, power: true }, { side: 'left', at: 0.17, len: 0.05 }, { side: 'left', at: 0.25, len: 0.09 }, { side: 'left', at: 0.36, len: 0.09 }] },
    tablet: { bezel: 0.065, screenR: 0.03, outerR: 0.08, cam: { kind: 'bezel', d: 0.014 }, buttons: [{ side: 'top', at: 0.08, len: 0.05, power: true }, { side: 'top', at: 0.16, len: 0.09 }] },
    custom: { bezel: 0.035, screenR: 0.04, outerR: 0.07, cam: null, buttons: [{ side: 'right', at: 0.24, len: 0.12, power: true }] },
  };
  const ROT = { PORTRAIT: 0, LANDSCAPE: -90, REVERSE_PORTRAIT: 180, REVERSE_LANDSCAPE: 90 };

  // box: available { w, h } in CSS px. Returns frame + screen rectangles (as displayed) and a scale.
  function layoutFrame(style, natW, natH, rotation, box) {
    const g = GEO[style] || GEO.custom;
    const S = Math.min(natW, natH);
    const fw = natW + 2 * g.bezel * S, fh = natH + 2 * g.bezel * S;   // natural frame, in device px
    const turned = rotation === 'LANDSCAPE' || rotation === 'REVERSE_LANDSCAPE';
    const dispW = turned ? fh : fw, dispH = turned ? fw : fh;
    const k = Math.min(box.w / dispW, box.h / dispH);
    const W = dispW * k, H = dispH * k;
    const sw = (turned ? natH : natW) * k, sh = (turned ? natW : natH) * k;
    const bz = g.bezel * S * k;
    return {
      k, geo: g, turned, deg: ROT[rotation] || 0,
      frame: { w: W, h: H, natW: fw * k, natH: fh * k },
      screen: { x: bz, y: bz, w: sw, h: sh, r: g.screenR * S * k },
    };
  }

  // Builds the frame DOM inside `host` (absolute children). opts: { style, finish:{frame,edge}, natW, natH, rotation, box, onButton }
  function renderFrame(host, opts) {
    const L = layoutFrame(opts.style, opts.natW, opts.natH, opts.rotation || 'PORTRAIT', opts.box);
    const g = L.geo, S = Math.min(opts.natW, opts.natH) * L.k;
    const nw = L.frame.natW, nh = L.frame.natH, bz = g.bezel * S;
    host.classList.add('df');
    host.style.width = `${L.frame.w}px`; host.style.height = `${L.frame.h}px`;
    host.style.setProperty('--df-frame', opts.finish?.frame || '#1d1f23');
    host.style.setProperty('--df-edge', opts.finish?.edge || '#3a3d44');
    const light = isLight(opts.finish?.frame || '#000');
    host.classList.toggle('df-light', light);
    let body = host.querySelector(':scope > .df-body');
    if (!body) { body = document.createElement('div'); body.className = 'df-body'; host.prepend(body); }
    body.style.width = `${nw}px`; body.style.height = `${nh}px`;
    body.style.left = `${(L.frame.w - nw) / 2}px`; body.style.top = `${(L.frame.h - nh) / 2}px`;
    body.style.transform = L.deg ? `rotate(${L.deg}deg)` : '';
    body.style.borderRadius = `${g.outerR * S}px`;
    body.innerHTML = '';
    // glass + screen well (natural orientation)
    const well = div('df-well', { left: bz, top: bz, width: nw - 2 * bz, height: nh - 2 * bz, borderRadius: g.screenR * S });
    body.appendChild(well);
    // camera
    const c = g.cam;
    if (c && c.kind === 'hole') body.appendChild(div('df-cam', { left: nw / 2 - (c.d * S) / 2, top: bz + c.top * S, width: c.d * S, height: c.d * S, borderRadius: c.d * S }));
    if (c && c.kind === 'island') body.appendChild(div('df-cam df-island', { left: nw / 2 - (c.w * S) / 2, top: bz + c.top * S, width: c.w * S, height: c.h * S, borderRadius: c.h * S }));
    if (c && c.kind === 'bezel') {
      const landNat = opts.natW > opts.natH;
      if (landNat) body.appendChild(div('df-cam df-cam-bezel', { left: nw / 2 - (c.d * S) / 2, top: bz / 2 - (c.d * S) / 2, width: c.d * S, height: c.d * S, borderRadius: c.d * S }));
      else body.appendChild(div('df-cam df-cam-bezel', { left: nw / 2 - (c.d * S) / 2, top: bz / 2 - (c.d * S) / 2, width: c.d * S, height: c.d * S, borderRadius: c.d * S }));
    }
    // hardware buttons on the edges
    const long = Math.max(nw, nh), th = Math.max(2, S * 0.012);
    for (const b of g.buttons) {
      const len = b.len * long, pos = b.at * long;
      let st;
      if (b.side === 'right') st = { left: nw - th * 0.35, top: pos, width: th, height: len };
      else if (b.side === 'left') st = { left: -th * 0.65, top: pos, width: th, height: len };
      else st = { left: nw - pos - len, top: -th * 0.65, width: len, height: th };
      const el = div(`df-btn${b.power ? ' df-power' : ''}`, { ...st, borderRadius: th });
      if (opts.onButton) { el.title = b.power ? 'Power' : 'Volume'; el.dataset.btn = b.power ? 'power' : 'volume'; el.addEventListener('click', (e) => { e.stopPropagation(); opts.onButton(b.power ? 'power' : (e.offsetY < len / 2 ? 'volUp' : 'volDown'), e); }); }
      body.appendChild(el);
    }
    // cameras sit on top of the live screen, like on a real phone
    host.querySelectorAll(':scope > .df-top').forEach((e) => e.remove());
    const top = document.createElement('div');
    top.className = 'df-top';
    for (const k of ['width', 'height', 'left', 'top', 'transform', 'borderRadius']) top.style[k] = body.style[k];
    body.querySelectorAll('.df-cam:not(.df-cam-bezel)').forEach((c) => top.appendChild(c.cloneNode()));
    host.appendChild(top);
    return L;
  }

  function div(cls, st) {
    const d = document.createElement('div');
    d.className = cls;
    for (const [k, v] of Object.entries(st)) d.style[k] = typeof v === 'number' ? `${v}px` : v;
    return d;
  }
  function isLight(hex) {
    const m = hex.replace('#', '').match(/../g); if (!m) return false;
    const [r, g, b] = m.map((x) => parseInt(x, 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
  }

  // Maps a point on the displayed (rotated) screen, as 0..1 fractions, to device pixels in natural orientation.
  function toDevice(u, v, rotation, W, H) {
    switch (rotation) {
      case 'LANDSCAPE': return { x: W - v * W, y: u * H };
      case 'REVERSE_PORTRAIT': return { x: W - u * W, y: H - v * H };
      case 'REVERSE_LANDSCAPE': return { x: v * W, y: H - u * H };
      default: return { x: u * W, y: v * H };
    }
  }

  window.Frames = { layoutFrame, renderFrame, toDevice, GEO };
})();

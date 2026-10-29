// The live controller drawing on Home: lights up whatever you press, sticks move, fingers show on the touchpad.
'use strict';
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const TP = { x: 182, y: 70, w: 156, h: 88 };
  const DP = { x: 138, y: 150 }, FC = { x: 382, y: 150 }, LS = { x: 204, y: 214 }, RS = { x: 316, y: 214 };
  const sym = {
    cross: '<path class="sym" d="M-5 -5L5 5M5 -5L-5 5" stroke="#6aa5ff"/>', circle: '<circle class="sym" r="5.5" stroke="#ff6a77"/>',
    square: '<rect class="sym" x="-5" y="-5" width="10" height="10" rx="1" stroke="#e183dc"/>', triangle: '<path class="sym" d="M0 -6L6 4.5H-6Z" stroke="#2fd3a0"/>'
  };
  const xb = { cross: ['A', '#4cc56a'], circle: ['B', '#ff5c5c'], square: ['X', '#4f9cff'], triangle: ['Y', '#e8b623'] };
  function build(fam) {
    const shapes = (extra) => `
      <rect x="72" y="60" width="376" height="150" rx="72" ${extra}/>
      <rect x="64" y="112" width="128" height="196" rx="64" transform="rotate(15 128 150)" ${extra}/>
      <rect x="328" y="112" width="128" height="196" rx="64" transform="rotate(-15 392 150)" ${extra}/>`;
    const L = fam === 'xbox' ? { l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', create: 'View', options: 'Menu' } : { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', create: 'Create', options: 'Options' };
    const face = (k, dx, dy) => {
      const cx = FC.x + dx * 30, cy = FC.y + dy * 30;
      const inner = fam === 'xbox' ? `<text class="lbl" style="fill:${xb[k][1]};font-size:12px">${xb[k][0]}</text>` : sym[k];
      return `<g transform="translate(${cx} ${cy})"><circle class="part" data-b="${k}" r="14"/>${inner}</g>`;
    };
    const arm = (k, x, y, w, h) => `<rect class="part" data-b="${k}" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>`;
    return `<svg class="pad" viewBox="0 0 520 330" xmlns="${NS}">
      <defs><linearGradient id="pad-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#46dcff"/><stop offset=".55" stop-color="#7f7bff"/><stop offset="1" stop-color="#d86aff"/></linearGradient>
      <clipPath id="clip-l2"><rect x="110" y="0" width="96" height="40" rx="14"/></clipPath><clipPath id="clip-r2"><rect x="314" y="0" width="96" height="40" rx="14"/></clipPath></defs>
      <rect class="trig" x="110" y="0" width="96" height="40" rx="14"/><rect class="trig-fill" id="l2f" x="110" y="40" width="96" height="0" clip-path="url(#clip-l2)"/>
      <rect class="trig" x="314" y="0" width="96" height="40" rx="14"/><rect class="trig-fill" id="r2f" x="314" y="40" width="96" height="0" clip-path="url(#clip-r2)"/>
      <text class="lbl" x="158" y="17">${L.l2}</text><text class="lbl" x="362" y="17">${L.r2}</text>
      <rect class="part" data-b="l1" x="104" y="44" width="104" height="18" rx="9"/><text class="lbl" x="156" y="53">${L.l1}</text>
      <rect class="part" data-b="r1" x="312" y="44" width="104" height="18" rx="9"/><text class="lbl" x="364" y="53">${L.r1}</text>
      <g style="stroke:var(--pad-line);stroke-width:3;fill:var(--pad)">${shapes('')}</g>
      <g class="body" style="stroke:none">${shapes('')}</g>
      <rect class="touchpad" id="tp" x="${TP.x}" y="${TP.y}" width="${TP.w}" height="${TP.h}" rx="16"/>
      <g id="fingers"></g>
      <rect class="light" x="${TP.x + 18}" y="${TP.y + TP.h + 6}" width="${TP.w - 36}" height="3" rx="1.5"/>
      <rect class="part" data-b="create" x="152" y="72" width="11" height="24" rx="5.5"/><text class="lbl" x="157" y="108" style="font-size:8.5px">${L.create}</text>
      <rect class="part" data-b="options" x="357" y="72" width="11" height="24" rx="5.5"/><text class="lbl" x="363" y="108" style="font-size:8.5px">${L.options}</text>
      ${arm('up', DP.x - 11, DP.y - 36, 22, 26)}${arm('down', DP.x - 11, DP.y + 10, 22, 26)}${arm('left', DP.x - 36, DP.y - 11, 26, 22)}${arm('right', DP.x + 10, DP.y - 11, 26, 22)}
      ${face('triangle', 0, -1)}${face('circle', 1, 0)}${face('cross', 0, 1)}${face('square', -1, 0)}
      <circle class="stick-base" cx="${LS.x}" cy="${LS.y}" r="33"/><circle class="stick" id="ls" data-b="l3" cx="${LS.x}" cy="${LS.y}" r="22"/>
      <circle class="stick-base" cx="${RS.x}" cy="${RS.y}" r="33"/><circle class="stick" id="rs" data-b="r3" cx="${RS.x}" cy="${RS.y}" r="22"/>
      <circle class="part" data-b="ps" cx="260" cy="200" r="11"/>${fam === 'xbox' ? '' : '<rect class="part" data-b="mute" x="250" y="221" width="20" height="7" rx="3.5"/>'}
    </svg>`;
  }
  class PadView {
    constructor(host) { this.host = host; this.fam = null; this.el = {}; this.draw('ps'); }
    draw(fam) {
      if (fam === this.fam) return; this.fam = fam;
      this.host.innerHTML = build(fam);
      this.svg = this.host.querySelector('svg');
      this.parts = [...this.svg.querySelectorAll('[data-b]')];
      this.ls = this.svg.querySelector('#ls'); this.rs = this.svg.querySelector('#rs');
      this.l2f = this.svg.querySelector('#l2f'); this.r2f = this.svg.querySelector('#r2f');
      this.tp = this.svg.querySelector('#tp'); this.fingers = this.svg.querySelector('#fingers');
    }
    update(f, { on = true } = {}) {
      this.svg.classList.toggle('none', !f); this.svg.classList.toggle('off', !on);
      if (!f) { for (const p of this.parts) p.classList.remove('on'); return; }
      this.draw(f.kind === 'xbox' || f.kind === 'xinput' ? 'xbox' : 'ps');
      for (const p of this.parts) p.classList.toggle('on', !!f.b[p.dataset.b]);
      this.ls.setAttribute('cx', LS.x + f.a.lx * 12); this.ls.setAttribute('cy', LS.y + f.a.ly * 12);
      this.rs.setAttribute('cx', RS.x + f.a.rx * 12); this.rs.setAttribute('cy', RS.y + f.a.ry * 12);
      const tl = (el, v) => { el.setAttribute('y', 40 - 40 * v); el.setAttribute('height', 40 * v); };
      tl(this.l2f, f.a.lt); tl(this.r2f, f.a.rt);
      this.tp.classList.toggle('on', !!f.b.pad); this.tp.style.display = f.touch === false ? 'none' : '';
      this.fingers.innerHTML = (f.t || []).map((p) => `<circle class="finger" cx="${TP.x + p.x * TP.w}" cy="${TP.y + p.y * TP.h}" r="8"/>`).join('');
    }
  }
  window.PadView = PadView;
})();

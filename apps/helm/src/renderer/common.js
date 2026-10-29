// Shared by the Settings window and the overlay: icons, controller button glyphs, small helpers.
'use strict';
(function () {
  const ICONS = {
    home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19h12V9.5"/>',
    controller: '<path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l1 5.2a2.6 2.6 0 0 1-4.6 2.1L15.6 16H8.4l-1.7 1.9a2.6 2.6 0 0 1-4.6-2.1l1-5.2A4.5 4.5 0 0 1 7.5 7z"/><path d="M7 10.5v3M5.5 12h3"/><circle cx="16" cy="11" r=".6"/><circle cx="17.6" cy="12.8" r=".6"/>',
    buttons: '<circle cx="12" cy="6.5" r="2.2"/><circle cx="12" cy="17.5" r="2.2"/><circle cx="6.5" cy="12" r="2.2"/><circle cx="17.5" cy="12" r="2.2"/>',
    pointer: '<path d="M6 3.5v14l3.6-3.4 2.6 5.4 2.4-1.1-2.5-5.3H17z"/>',
    game: '<rect x="3" y="7" width="18" height="11" rx="4"/><path d="M8 10.5v4M6 12.5h4"/><path d="M15 11.5h.01M17 13.5h.01"/><path d="M9 4.5c1 1 2 1.5 3 1.5s2-.5 3-1.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01M18 12.5h.01M8 15.5h8"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
    overview: '<rect x="3" y="4" width="8" height="7" rx="1.6"/><rect x="13" y="4" width="8" height="7" rx="1.6"/><rect x="3" y="13" width="8" height="7" rx="1.6"/><rect x="13" y="13" width="8" height="7" rx="1.6"/>',
    desktop: '<rect x="2.5" y="4" width="19" height="13" rx="2.2"/><path d="M8 21h8M12 17v4"/>',
    apps: '<circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
    camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
    play: '<path d="M7 5.5v13l5.5-6.5zM15 6v12M18.5 6v12"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    volup: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    voldown: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
    media: '<path d="M7 5.5v13l5.5-6.5zM15 6v12M18.5 6v12"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    power: '<path d="M12 3.5v8"/><path d="M6.5 7a7.5 7.5 0 1 0 11 0"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    windows: '<rect x="3" y="5" width="13" height="10" rx="2"/><path d="M8 19h13V9"/>',
    browse: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>', reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    battery: '<rect x="2.5" y="7.5" width="17" height="9" rx="2.2"/><path d="M21.5 10.5v3"/>', bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    usb: '<path d="M12 3v15M12 18a2 2 0 1 0 0 .01M8 8l4-4 4 4M7.5 11v2.5L12 16M16.5 9.5v3L12 15"/>', bt: '<path d="M7 7.5l10 9-5 4.5v-18l5 4.5-10 9"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    swipe: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>', touch: '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="10" cy="12" r="1.6"/><circle cx="14.5" cy="12" r="1.6"/>',
    edit2: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', wave: '<path d="M3 12h3l2-5 3 10 3-8 2 3h5"/>', keys: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M7 12h10"/>',
    desktopnav: '<rect x="2.5" y="4" width="19" height="13" rx="2.2"/><path d="M8 21h8M12 17v4"/>'
  };
  const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;

  // PlayStation symbols drawn as SVG; Xbox letters for Xbox controllers
  const PS_FACE = {
    cross: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>', circle: '<circle cx="12" cy="12" r="5"/>',
    square: '<rect x="7" y="7" width="10" height="10" rx="1"/>', triangle: '<path d="M12 6.5l6 10.5H6z"/>'
  };
  const XBOX = { cross: 'A', circle: 'B', square: 'X', triangle: 'Y' };
  const LABEL = {
    ps: { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3', create: 'Create', options: 'Options', ps: 'PS', mute: 'Mute', pad: 'Pad', paddleL: 'LB', paddleR: 'RB', fnL: 'LFn', fnR: 'RFn' },
    xbox: { l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', l3: 'LS', r3: 'RS', create: 'View', options: 'Menu', ps: 'Xbox', mute: 'Share', pad: 'Pad', paddleL: 'P3', paddleR: 'P1', fnL: 'Fn', fnR: 'Fn' }
  };
  const DPAD = { up: 'M12 5v14M7 10l5-5 5 5', down: 'M12 5v14M7 14l5 5 5-5', left: 'M5 12h14M10 7l-5 5 5 5', right: 'M5 12h14M14 7l5 5-5 5' };
  function glyph(btn, family = 'ps') {
    if (PS_FACE[btn]) {
      if (family === 'xbox') return `<span class="gl face xb-${btn}">${XBOX[btn]}</span>`;
      return `<span class="gl face ps-${btn}"><svg viewBox="0 0 24 24">${PS_FACE[btn]}</svg></span>`;
    }
    if (DPAD[btn]) return `<span class="gl dpad"><svg viewBox="0 0 24 24"><path d="${DPAD[btn]}"/></svg></span>`;
    const t = (LABEL[family] || LABEL.ps)[btn] || btn;
    return `<span class="gl txt${t.length > 2 ? ' wide' : ''}">${t}</span>`;
  }
  const family = (kind) => (kind === 'xbox' || kind === 'xinput' ? 'xbox' : 'ps');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.HelmUI = { ICONS, icon, glyph, family, esc };
})();

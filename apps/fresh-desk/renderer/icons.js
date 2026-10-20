'use strict';
(function (g) {
  const s = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    back: s('<path d="M15 18l-6-6 6-6"/>'),
    forward: s('<path d="M9 18l6-6-6-6"/>'),
    up: s('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    search: s('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    list: s('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6" fill="currentColor"/><circle cx="4" cy="12" r=".6" fill="currentColor"/><circle cx="4" cy="18" r=".6" fill="currentColor"/>'),
    grid: s('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    columns: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.2 4.5v15M14.8 4.5v15"/>'),
    terminal: s('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>'),
    sparkle: s('<path d="M12 3.5l1.6 4.9 4.9 1.6-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
    preview: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>'),
    sidebar: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>'),
    more: s('<circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    close: s('<path d="M7 7l10 10M17 7L7 17"/>'),
    home: s('<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19h4.5v-5h3v5H18V9.5"/>'),
    desktop: s('<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8"/><path d="M9 20h6M12 16v4"/>'),
    doc: s('<path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10A.5.5 0 016 20V4a.5.5 0 01.5-.5z"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6"/>'),
    download: s('<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>'),
    image: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8.5 8.5"/>'),
    music: s('<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'),
    video: s('<rect x="3.5" y="6" width="12.5" height="12" rx="2"/><path d="M16 10.5l4.5-2.5v8L16 13.5"/>'),
    apps: s('<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M12 12v8.5M12 12l7.5-4.3M12 12L4.5 7.7"/>'),
    drive: s('<rect x="3.5" y="13" width="17" height="6.5" rx="2"/><path d="M5.5 13l2-7.5h9l2 7.5"/><circle cx="16.5" cy="16.2" r=".7" fill="currentColor"/>'),
    clock: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    folder: s('<path d="M3.5 7.5a2 2 0 012-2h3.8l2 2h7.2a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>'),
    pin: s('<path d="M12 17v4M8 3.5h8l-1.2 6.2 3.2 3.3H6l3.2-3.3z"/>'),
    gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/>'),
    chevron: s('<path d="M9 6l6 6-6 6"/>'),
    chevronDown: s('<path d="M6 9l6 6 6-6"/>'),
    trash: s('<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 001.5 1.5h7a1.5 1.5 0 001.5-1.5L18 7M9 7V4.5h6V7"/>'),
    undo: s('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
    check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    code: s('<path d="M8.5 8L4.5 12l4 4M15.5 8l4 4-4 4"/>'),
    refresh: s('<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3L19.5 9M19.5 4.5V9H15"/>'),
    eye: s('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
    warn: s('<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17v.5"/>'),
    filter: s('<path d="M4 5.5h16l-6 7.5v5.5l-4 1.5v-7z"/>'),
    ai: s('<rect x="4.5" y="6.5" width="15" height="12" rx="3"/><path d="M12 3.5v3M9 12h.01M15 12h.01M9.5 15.5h5"/>'),
  };

  // Kind colors for file badges (work on light and dark).
  const KIND = {
    Folder: '#3fcf95', Application: '#8a8f98', Image: '#e2833a', PDF: '#e5484d', Document: '#3e7be0', Spreadsheet: '#2fa96a',
    Presentation: '#e0662f', Video: '#8b5cf6', Audio: '#e04f9a', Archive: '#a1824a', Installer: '#6b7280', Code: '#0ea5b7',
    Font: '#64748b', Design: '#d946ef', File: '#94a3b8',
  };
  const kindColor = k => KIND[k] || KIND.File;
  function folderIcon(size = 18, variant = '') {
    const back = variant === 'open' ? '#2bb983' : '#34c78c';
    return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 015.5 6h6.2l2.6 2.6h12.2A2.5 2.5 0 0129 11.1V24a2.5 2.5 0 01-2.5 2.5h-21A2.5 2.5 0 013 24z" fill="${back}"/><path d="M3 12.2A2.2 2.2 0 015.2 10h21.6a2.2 2.2 0 012.2 2.2V24a2.5 2.5 0 01-2.5 2.5h-21A2.5 2.5 0 013 24z" fill="#5fdcab"/><path d="M3 12.2A2.2 2.2 0 015.2 10h21.6a2.2 2.2 0 012.2 2.2v.6H3z" fill="#fff" opacity=".28"/></svg>`;
  }
  function fileIcon(entry, size = 18) {
    if (entry.isDir) return folderIcon(size);
    const color = kindColor(entry.kind?.split(' ')[1] === 'file' ? 'File' : entry.kind);
    const label = (entry.ext || '').slice(0, 4).toUpperCase();
    const big = size >= 40;
    return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><path d="M8 3h11l7 7v17.5A1.5 1.5 0 0124.5 29h-16A1.5 1.5 0 017 27.5v-23A1.5 1.5 0 018.5 3z" class="f-body"/><path d="M19 3v5.5A1.5 1.5 0 0020.5 10H26" class="f-fold"/>${big && label ? `<rect x="4" y="17" width="${Math.max(12, label.length * 4.4 + 5)}" height="8" rx="1.6" fill="${color}"/><text x="${4 + Math.max(12, label.length * 4.4 + 5) / 2}" y="23.1" font-size="5.6" font-weight="700" text-anchor="middle" fill="#fff" font-family="-apple-system,Segoe UI,sans-serif">${label.replace(/[^A-Z0-9]/g, '')}</text>` : `<rect x="10" y="${big ? 18 : 16}" width="12" height="${big ? 3 : 4}" rx="1.2" fill="${color}"/>`}</svg>`;
  }
  g.Icons = {I, folderIcon, fileIcon, kindColor};
})(globalThis);

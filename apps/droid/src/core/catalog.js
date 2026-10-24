// Device styles, presets and Android version names. Pure data + helpers, no Electron.
'use strict';

// Each style is a frame drawn by the renderer plus sensible defaults for a new device.
// `aspect` is long edge / short edge; `diag` (inches) is used to work out screen density.
const STYLES = {
  pixel: {
    id: 'pixel', name: 'Pixel-style phone', short: 'Pixel-style',
    blurb: 'Clean Android with a centered camera and soft corners.',
    aspect: 20 / 9, diag: 6.3, tablet: false, orientation: 'portrait',
    defaults: { res: 1080, ramMB: 4096, cores: 4, storageGB: 64 },
    finishes: [
      { id: 'obsidian', name: 'Obsidian', frame: '#1d1f23', edge: '#3a3d44' },
      { id: 'porcelain', name: 'Porcelain', frame: '#ece7df', edge: '#cfc8bd' },
      { id: 'bay', name: 'Bay', frame: '#9fb8d8', edge: '#7f98bb' },
      { id: 'jade', name: 'Jade', frame: '#b9d6c4', edge: '#93b5a0' },
    ],
  },
  galaxy: {
    id: 'galaxy', name: 'Galaxy-style phone', short: 'Galaxy-style',
    blurb: 'Tall, sharp-cornered flagship with edge-to-edge glass.',
    aspect: 19.5 / 9, diag: 6.8, tablet: false, orientation: 'portrait',
    defaults: { res: 1440, ramMB: 8192, cores: 4, storageGB: 128 },
    finishes: [
      { id: 'titanium-black', name: 'Titanium Black', frame: '#25262a', edge: '#4a4c52' },
      { id: 'titanium-gray', name: 'Titanium Gray', frame: '#8d8f93', edge: '#6c6e72' },
      { id: 'titanium-violet', name: 'Titanium Violet', frame: '#6f6585', edge: '#574e6b' },
      { id: 'titanium-yellow', name: 'Titanium Yellow', frame: '#d8cf9e', edge: '#b9b07f' },
    ],
  },
  tablet: {
    id: 'tablet', name: 'Tablet', short: 'Tablet',
    blurb: 'A big 11-inch screen for split-screen and media.',
    aspect: 16 / 10, diag: 11, tablet: true, orientation: 'landscape',
    defaults: { res: 1600, ramMB: 8192, cores: 4, storageGB: 128 },
    finishes: [
      { id: 'graphite', name: 'Graphite', frame: '#2a2c31', edge: '#45484f' },
      { id: 'silver', name: 'Silver', frame: '#d9dadd', edge: '#b9bbc0' },
      { id: 'sage', name: 'Sage', frame: '#aebfa9', edge: '#8fa18a' },
    ],
  },
  island: {
    id: 'island', name: 'Island-style phone', short: 'Island-style',
    blurb: 'iPhone-like frame with a pill-shaped camera island. Android inside.',
    aspect: 19.5 / 9, diag: 6.1, tablet: false, orientation: 'portrait',
    defaults: { res: 1080, ramMB: 4096, cores: 4, storageGB: 64 },
    finishes: [
      { id: 'natural', name: 'Natural', frame: '#bdb6aa', edge: '#9c9588' },
      { id: 'black', name: 'Black', frame: '#2b2b2d', edge: '#4b4b4e' },
      { id: 'white', name: 'White', frame: '#e9e8e4', edge: '#c9c7c1' },
      { id: 'desert', name: 'Desert', frame: '#c9ab8c', edge: '#a88b6d' },
      { id: 'teal', name: 'Teal', frame: '#8fb3b3', edge: '#6f9393' },
    ],
  },
  custom: {
    id: 'custom', name: 'Custom', short: 'Custom',
    blurb: 'Any screen size and shape, with a plain frame.',
    aspect: 2, diag: 6.5, tablet: false, orientation: 'portrait',
    defaults: { res: 1080, ramMB: 4096, cores: 4, storageGB: 64 },
    finishes: [
      { id: 'midnight', name: 'Midnight', frame: '#1c1d24', edge: '#383a46' },
      { id: 'cloud', name: 'Cloud', frame: '#e6e7ea', edge: '#c8cad0' },
      { id: 'lime', name: 'Lime', frame: '#b7e07a', edge: '#95be58' },
      { id: 'coral', name: 'Coral', frame: '#ff9a7a', edge: '#de7b5c' },
    ],
  },
};

const RES_PRESETS = [
  { id: '1080', label: '1080p', short: 1080 },
  { id: '1440', label: '1440p', short: 1440 },
];
const TABLET_RES_PRESETS = [
  { id: '1200', label: '1200p', short: 1200 },
  { id: '1600', label: '1600p', short: 1600 },
];
const RAM_OPTIONS = [2048, 3072, 4096, 6144, 8192, 12288, 16384];
const CORE_OPTIONS = [2, 4, 6, 8];
const STORAGE_OPTIONS = [32, 64, 128, 256];
const DENSITIES = [120, 160, 213, 240, 260, 280, 300, 320, 340, 360, 400, 420, 440, 450, 480, 520, 560, 600, 640];

// Device accent colours for the dashboard card.
const ACCENTS = ['lime', 'mint', 'sky', 'violet', 'rose', 'amber', 'slate'];

function sizeFor(styleId, shortEdge) {
  const s = STYLES[styleId] || STYLES.pixel;
  const long = Math.round((shortEdge * s.aspect) / 8) * 8;
  return s.orientation === 'landscape' ? { w: long, h: shortEdge } : { w: shortEdge, h: long };
}

// Density from physical size, snapped to the nearest Android density bucket.
function densityFor(w, h, diag) {
  const ppi = Math.sqrt(w * w + h * h) / (diag || 6.3);
  let best = DENSITIES[0];
  for (const d of DENSITIES) if (Math.abs(d - ppi) < Math.abs(best - ppi)) best = d;
  return best;
}

// API level -> marketing name. Minor levels (36.1) are platform releases inside a version.
const VERSION_NAMES = {
  21: ['5.0', 'Lollipop'], 22: ['5.1', 'Lollipop'], 23: ['6', 'Marshmallow'], 24: ['7', 'Nougat'], 25: ['7.1', 'Nougat'],
  26: ['8', 'Oreo'], 27: ['8.1', 'Oreo'], 28: ['9', 'Pie'], 29: ['10', ''], 30: ['11', ''], 31: ['12', ''], 32: ['12L', ''],
  33: ['13', ''], 34: ['14', ''], 35: ['15', ''], 36: ['16', ''], 37: ['17', ''], 38: ['18', ''],
};
function androidName(api) {
  const s = String(api);
  const major = parseInt(s, 10);
  const minor = s.includes('.') ? s.split('.')[1] : null;
  const v = VERSION_NAMES[major];
  const base = v ? `Android ${v[0]}` : `API ${major}`;
  return minor && minor !== '0' ? `${base} (${major}.${minor})` : base;
}

const TAGS = {
  google_apis_playstore: { id: 'google_apis_playstore', name: 'Google Play', blurb: 'Play Store and Google sign-in. Best for everyday apps.', rank: 0 },
  google_apis: { id: 'google_apis', name: 'Google APIs', blurb: 'Google services without the Play Store. Can be rooted.', rank: 1 },
  default: { id: 'default', name: 'Pure Android', blurb: 'Plain open-source Android, nothing from Google.', rank: 2 },
};

function fmtRam(mb) { return mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`; }

module.exports = {
  STYLES, RES_PRESETS, TABLET_RES_PRESETS, RAM_OPTIONS, CORE_OPTIONS, STORAGE_OPTIONS, DENSITIES, ACCENTS, TAGS,
  sizeFor, densityFor, androidName, fmtRam,
};

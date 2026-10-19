const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const COLORS = ['#D4F08A', '#8AD8F0', '#F0A58A', '#C9A8F5', '#F5D27A', '#8AF0C1', '#F58AB8', '#A8B8F5'];

const DEFAULTS = {
  profile: { name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)] },
  personalCode: null,
  roomName: '',
  recentRooms: [],
  signaling: { kind: 'public', urls: [] },
  turn: [],
  quality: '1080p30',
  adblock: true,
  everyoneControls: true,
  onboarded: false
};

let cache = null;
let saveTimer = null;
const file = () => path.join(app.getPath('userData'), 'settings.json');

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = { ...DEFAULTS, ...raw, profile: { ...DEFAULTS.profile, ...(raw.profile || {}) }, signaling: { ...DEFAULTS.signaling, ...(raw.signaling || {}) } };
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, file());
  } catch (error) {
    console.error('[sideby] could not save settings', error);
  }
}

const ALLOWED = new Set(Object.keys(DEFAULTS));

function update(patch) {
  const current = load();
  if (!patch || typeof patch !== 'object') return current;
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED.has(key)) continue;
    current[key] = value && typeof value === 'object' && !Array.isArray(value) && typeof current[key] === 'object' && !Array.isArray(current[key])
      ? { ...current[key], ...value }
      : value;
  }
  if (Array.isArray(current.recentRooms)) current.recentRooms = current.recentRooms.slice(0, 12);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
  return current;
}

module.exports = { load, update, flush, COLORS };

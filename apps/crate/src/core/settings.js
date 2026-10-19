// Crate — settings (kept in the app-data folder, never in the library or the repo)
const fs = require('fs');
const os = require('os');
const path = require('path');

let dataDir = null;
let cache = null;

const DEFAULTS = {
  libraryRoot: path.join(os.homedir(), 'Music', 'Crate'),
  quality: '320',            // '320' | '256' | '192' | 'v0'
  normalize: false,          // loudness-match new downloads (-14 LUFS)
  cleanTitles: true,         // strip "(Official Video)" and friends
  autoLookup: true,          // fill album / year / genre / artwork from the iTunes catalog
  preferCatalogArt: true,    // prefer real album art over the video thumbnail
  organize: true,            // keep files in Artist/Album/NN Title.mp3
  pattern: '{albumartist}/{album}/{track} {title}',
  cookiesBrowser: '',        // '', 'chrome', 'safari', 'firefox', 'edge', 'brave'
  concurrency: 2,
  theme: 'dark',
  exportFolder: '',
  exportStructure: 'artist-album', // 'artist-album' | 'flat'
  exportPlaylists: true,
  toolsCheckedAt: 0,
  volume: 0.8,
  window: null
};

function init(dir) {
  dataDir = dir;
  fs.mkdirSync(dataDir, { recursive: true });
  cache = null;
}

function file() { return path.join(dataDir, 'settings.json'); }

function get() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch {}
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

function set(patch) {
  const s = get();
  for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULTS) s[k] = v;
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file());
  return s;
}

function dir() { return dataDir; }

module.exports = { init, get, set, dir, DEFAULTS };

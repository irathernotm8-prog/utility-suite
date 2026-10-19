// Kiln — global state, profiles, model libraries and secrets.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { createStore } = require('./store');
const { MODEL_TYPES, EXTRA_FOLDERS } = require('./shared/types');

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const COLORS = ['#ff9a4a', '#ffc66b', '#ff6f61', '#e5739a', '#b79cff', '#7fd1b9', '#7ea6ff', '#9bd36a'];

const GLOBAL_DEFAULTS = {
  version: 1,
  setupDone: false,
  dataRoot: null,
  profiles: [],
  libraries: [],
  packages: [],
  activeProfileId: null,
  askOnLaunch: true,
  tools: { uv: null, git: null, pythonDir: null, tagsDir: null },
  imported: { stabilityMatrix: null },
  window: { width: 1360, height: 860 }
};

const PROFILE_DEFAULTS = {
  settings: {
    theme: 'dark',
    nsfw: 'blur',               // 'show' | 'blur' | 'hide'
    searchEngine: 'google',
    adblock: true,
    defaultPackageId: null,
    civitaiKey: null,           // encrypted
    hfToken: null,              // encrypted
    discover: { source: 'civitai', sort: 'Most Downloaded', period: 'AllTime', types: [], baseModels: [] },
    gen: {
      width: 1024, height: 1024, steps: 28, cfg: 6, sampler: 'Euler a', scheduler: 'Automatic', seed: -1,
      batchSize: 1, batchCount: 1, checkpoint: '', vae: '', clipSkip: 1,
      hires: false, hiresScale: 1.5, hiresUpscaler: 'Latent', hiresSteps: 0, hiresDenoise: 0.4,
      denoise: 0.6, negative: ''
    },
    sizes: ['1024 x 1024', '1152 x 896', '896 x 1152', '1216 x 832', '832 x 1216', '1344 x 768', '768 x 1344', '1536 x 640', '640 x 1536', '768 x 768', '512 x 768', '512 x 512']
  },
  prompts: [],          // saved prompts: { id, name, positive, negative, tags[], favorite, createdAt, usedAt }
  history: [],          // recent generations: { id, at, positive, negative, params, images[] }
  browser: {
    tabs: [],
    activeIndex: 0,
    bookmarks: [
      { id: 'civitai', title: 'CivitAI', url: 'https://civitai.com/' },
      { id: 'hf', title: 'Hugging Face', url: 'https://huggingface.co/models?pipeline_tag=text-to-image' },
      { id: 'civarchive', title: 'CivArchive', url: 'https://civitaiarchive.com/' }
    ]
  },
  favorites: { models: [], images: [] },
  downloads: [],
  imageMeta: {}         // per-image extras: { [path]: { favorite, note } }
};

let G = null;                // global store
const profileStores = new Map();

function init() {
  G = createStore(path.join(app.getPath('userData'), 'kiln.json'), GLOBAL_DEFAULTS);
  // Pin every profile's folders to absolute paths, so changing the Kiln folder later never orphans them
  let changed = false;
  for (const p of G.data.profiles) {
    if (!p.dir) { p.dir = path.join(dataRoot(), 'Profiles', p.id); changed = true; }
    if (!p.outputsDir) { p.outputsDir = path.join(p.dir, 'Outputs'); changed = true; }
  }
  if (changed) G.save(true);
  return G;
}
const g = () => G.data;
const saveGlobal = (now) => G.save(now);

/* ---------- secrets ---------- */
function encrypt(s) {
  if (!s) return null;
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64'); } catch {}
  return 'b64:' + Buffer.from(s).toString('base64');
}
function decrypt(v) {
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString();
  } catch {}
  return '';
}

/* ---------- data root ---------- */
function defaultDataRoot() { return path.join(app.getPath('downloads'), 'Kiln', 'Kiln Files'); }
function dataRoot() { return g().dataRoot || defaultDataRoot(); }
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }
function packagesDir() { return ensureDir(path.join(dataRoot(), 'Packages')); }
function toolsDir() { return ensureDir(path.join(dataRoot(), 'Tools')); }

/* ---------- libraries ---------- */
function ensureLibraryFolders(root) {
  ensureDir(root);
  for (const t of MODEL_TYPES) ensureDir(path.join(root, t.id));
  for (const f of EXTRA_FOLDERS) ensureDir(path.join(root, f));
}
function getLibrary(id) { return g().libraries.find(l => l.id === id) || null; }
function createLibrary(name, root) {
  const lib = { id: uid(), name, path: root || path.join(dataRoot(), 'Libraries', slug(name) + '-' + uid().slice(0, 4)), createdAt: Date.now() };
  ensureLibraryFolders(lib.path);
  g().libraries.push(lib);
  saveGlobal();
  return lib;
}
function slug(s) { return String(s || 'library').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'library'; }

/* ---------- profiles ---------- */
function profileDir(id) { const p = getProfile(id); return ensureDir(p?.dir || path.join(dataRoot(), 'Profiles', id)); }
function profileStore(id) {
  if (!profileStores.has(id)) profileStores.set(id, createStore(path.join(profileDir(id), 'profile.json'), PROFILE_DEFAULTS));
  return profileStores.get(id);
}
function getProfile(id) { return g().profiles.find(p => p.id === id) || null; }
function activeProfile() { return getProfile(g().activeProfileId); }
function active() {
  const p = activeProfile();
  if (!p) return null;
  return { profile: p, store: profileStore(p.id), data: profileStore(p.id).data, library: getLibrary(p.libraryId), outputsDir: outputsDir(p) };
}
function outputsDir(p) { return ensureDir(p.outputsDir || path.join(dataRoot(), 'Outputs', p.id)); }
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }

function createProfile({ name, color, avatar, pin, library, outputsDir: out }) {
  const id = uid();
  let libraryId = null;
  if (library && library.startsWith('share:')) libraryId = library.slice(6);
  if (!libraryId || !getLibrary(libraryId)) libraryId = createLibrary(`${name || 'Profile'}’s models`).id;
  const salt = uid();
  const p = {
    id, name: (name || 'Profile').trim().slice(0, 40), color: color || COLORS[g().profiles.length % COLORS.length], avatar: avatar || '',
    pin: pin ? { salt, hash: hashPin(pin, salt) } : null, libraryId, createdAt: Date.now(), lastUsedAt: 0,
    dir: path.join(dataRoot(), 'Profiles', id),
    // images live outside the profile folder, so deleting a profile never takes them with it
    outputsDir: out || path.join(dataRoot(), 'Outputs', `${slug(name)}-${id.slice(0, 4)}`)
  };
  g().profiles.push(p);
  profileStore(id).save(true);
  saveGlobal();
  return p;
}
function updateProfile(id, patch) {
  const p = getProfile(id);
  if (!p) return null;
  if ('name' in patch) p.name = String(patch.name || p.name).trim().slice(0, 40);
  if ('color' in patch) p.color = patch.color;
  if ('avatar' in patch) p.avatar = patch.avatar;
  if ('pin' in patch) { if (patch.pin) { const salt = uid(); p.pin = { salt, hash: hashPin(patch.pin, salt) }; } else p.pin = null; }
  if ('libraryId' in patch && getLibrary(patch.libraryId)) p.libraryId = patch.libraryId;
  if ('outputsDir' in patch && patch.outputsDir) p.outputsDir = patch.outputsDir;
  saveGlobal();
  return p;
}
function removeProfile(id) {
  g().profiles = g().profiles.filter(p => p.id !== id);
  if (g().activeProfileId === id) g().activeProfileId = null;
  profileStores.delete(id);
  saveGlobal();
}
function checkPin(id, pin) {
  const p = getProfile(id);
  if (!p) return false;
  if (!p.pin) return true;
  return hashPin(String(pin || ''), p.pin.salt) === p.pin.hash;
}
function activate(id) {
  const p = getProfile(id);
  if (!p) return null;
  g().activeProfileId = id;
  p.lastUsedAt = Date.now();
  saveGlobal();
  return p;
}

// What the window is allowed to see about a profile
function publicProfile(p) {
  if (!p) return null;
  const lib = getLibrary(p.libraryId);
  const sharedWith = g().profiles.filter(x => x.id !== p.id && x.libraryId === p.libraryId).map(x => x.name);
  return { id: p.id, name: p.name, color: p.color, avatar: p.avatar, hasPin: !!p.pin, libraryId: p.libraryId, libraryName: lib?.name || '', libraryPath: lib?.path || '', sharedWith, outputsDir: outputsDir(p), lastUsedAt: p.lastUsedAt };
}
function publicSettings(s) {
  const out = { ...s };
  out.hasCivitaiKey = !!s.civitaiKey; out.hasHfToken = !!s.hfToken;
  delete out.civitaiKey; delete out.hfToken;
  return out;
}
function secret(name) { const a = active(); return a ? decrypt(a.data.settings[name]) : ''; }

function flushAll() { try { G.flush(); } catch {} for (const s of profileStores.values()) { try { s.flush(); } catch {} } }

module.exports = {
  init, g, saveGlobal, uid, COLORS, encrypt, decrypt, secret,
  dataRoot, defaultDataRoot, ensureDir, packagesDir, toolsDir,
  ensureLibraryFolders, getLibrary, createLibrary,
  profileDir, profileStore, getProfile, activeProfile, active, outputsDir,
  createProfile, updateProfile, removeProfile, checkPin, activate, publicProfile, publicSettings, flushAll
};

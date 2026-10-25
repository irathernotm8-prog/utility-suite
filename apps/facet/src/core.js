// Facet — settings and the folders everything lives in.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  version: 1,
  setupDone: false,
  theme: 'system',            // 'system' | 'dark' | 'light'
  modelsDir: null,            // default: <userData>/Models
  outputDir: null,            // default: ~/Documents/Facet
  device: 'auto',             // 'auto' | 'gpu' | 'cpu'
  keepLoaded: true,
  env: { version: null, python: null, torch: null, accel: null, at: 0 },
  create: {
    mode: 'prompt',           // 'prompt' | 'image' | 'views'
    engine: 'triposr',
    imageModel: 'sd-turbo',
    style: 'object',
    ideas: 4,
    detail: 'medium',
    faces: 0,
    removeBg: true,
    colorize: true,
    seed: -1
  },
  export: { format: 'glb', stlHeight: 100 },
  window: { width: 1380, height: 880 }
};

let S = null, file = null, timer = null;

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

function init() {
  file = path.join(app.getPath('userData'), 'facet.json');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  S = merge(DEFAULTS, raw);
  return S;
}
const get = () => S;
function save(now) {
  clearTimeout(timer);
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(S, null, 2));
      fs.renameSync(file + '.tmp', file);
    } catch {}
  };
  if (now) write(); else timer = setTimeout(write, 250);
}
function patch(p) { S = merge(S, p); save(); return S; }

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }
const engineRoot = () => ensureDir(path.join(app.getPath('userData'), 'Engine'));
const toolsDir = () => ensureDir(path.join(engineRoot(), 'tools'));
const envDir = () => path.join(engineRoot(), 'python-env');
const pythonHome = () => ensureDir(path.join(engineRoot(), 'python'));
const uvCache = () => ensureDir(path.join(engineRoot(), 'uv-cache'));
const defaultModelsDir = () => path.join(app.getPath('userData'), 'Models');
const modelsDir = () => ensureDir(S.modelsDir || defaultModelsDir());
const defaultOutputDir = () => path.join(app.getPath('documents'), 'Facet');
const outputDir = () => ensureDir(S.outputDir || defaultOutputDir());
const scratchDir = () => ensureDir(path.join(app.getPath('userData'), 'Scratch'));
const logFile = () => path.join(engineRoot(), 'engine.log');

// The bundled engine folder (Python worker, TripoSR code, catalog). asar is off, so it is a plain folder.
const bundledEngine = () => path.join(__dirname, '..', 'engine');
const catalog = () => JSON.parse(fs.readFileSync(path.join(bundledEngine(), 'catalog.json'), 'utf8'));

module.exports = { init, get, save, patch, ensureDir, engineRoot, toolsDir, envDir, pythonHome, uvCache, modelsDir, defaultModelsDir, outputDir, defaultOutputDir, scratchDir, logFile, bundledEngine, catalog };

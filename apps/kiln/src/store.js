// Kiln — small JSON stores with atomic writes.
// Global store (profiles, libraries, packages, tools) lives in the app's userData folder.
// Each profile keeps its own file inside its profile folder, so profiles stay separate on disk.
const fs = require('fs');
const path = require('path');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fall through */ }
  try { return JSON.parse(fs.readFileSync(file + '.bak', 'utf8')); } catch { /* fall through */ }
  return fallback;
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch {}
  fs.renameSync(tmp, file);
}

// A store object with debounced saves
function createStore(file, defaults) {
  let data = merge(structuredClone(defaults), readJSON(file, {}));
  let t = null;
  return {
    file,
    get data() { return data; },
    set(next) { data = next; this.save(); },
    save(now = false) {
      clearTimeout(t);
      if (now) { writeJSON(file, data); return; }
      t = setTimeout(() => { try { writeJSON(file, data); } catch (e) { console.error('save', file, e.message); } }, 250);
    },
    flush() { clearTimeout(t); try { writeJSON(file, data); } catch (e) { console.error('flush', file, e.message); } }
  };
}

// Deep-merge saved values over defaults (arrays and primitives from saved win)
function merge(base, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return saved === undefined ? base : saved;
  for (const [k, v] of Object.entries(saved)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

module.exports = { readJSON, writeJSON, createStore, merge };

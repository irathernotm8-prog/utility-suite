// Facet — the model catalog: what is downloaded, downloading it (resumable), removing it.
// Files are laid out as <Models>/<org>/<repo>/<file>, exactly where the engine looks for them.
const fs = require('fs');
const path = require('path');
const core = require('./core');
const tools = require('./tools');

const active = new Map();   // id -> { abort, got, total, file, error }
let emit = () => {};

function globToRe(g) { return new RegExp('^' + g.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'); }
function repoDir(repo) { return path.join(core.modelsDir(), ...repo.split('/')); }
function sources(m) { return m.url ? [] : [{ repo: m.repo, allow: m.allow }, ...(m.also || [])]; }

// Every file a model needs: [{ repo, file, size, url, dest }]
async function plan(m) {
  if (m.url) return [{ file: path.basename(m.dest), url: m.url, dest: path.join(core.modelsDir(), ...m.dest.split('/')), size: 0 }];   // sizeMB is only an estimate; the real size is recorded after download
  const out = [];
  for (const s of sources(m)) {
    const tree = await tools.fetchJson(`https://huggingface.co/api/models/${s.repo}/tree/main?recursive=true`);
    const res = s.allow.map(globToRe);
    for (const e of tree) {
      if (e.type !== 'file' || !res.some(r => r.test(e.path))) continue;
      out.push({ repo: s.repo, file: e.path, size: e.lfs?.size || e.size || 0, url: `https://huggingface.co/${s.repo}/resolve/main/${e.path.split('/').map(encodeURIComponent).join('/')}`, dest: path.join(repoDir(s.repo), ...e.path.split('/')) });
    }
  }
  if (!out.length) throw new Error('Could not find the files for ' + m.name + ' on Hugging Face.');
  return out;
}

// Installed means every expected file is present (checked from a small manifest written after download)
function manifestPath(m) { return path.join(core.modelsDir(), '.facet', m.id + '.json'); }
function readManifest(m) { try { return JSON.parse(fs.readFileSync(manifestPath(m), 'utf8')); } catch { return null; } }
function isInstalled(m) {
  const man = readManifest(m);
  if (!man) return false;
  return man.files.every(f => { try { const n = fs.statSync(path.join(core.modelsDir(), f.rel)).size; return m.url ? n > 0 : (!f.size || n === f.size); } catch { return false; } });
}

function list() {
  const cat = core.catalog();
  return cat.models.map(m => {
    if (m.kind === 'cloud') return { ...m, installed: !!core.get().tripo?.key, bytes: 0, downloading: null, error: null };
    const a = active.get(m.id);
    const man = readManifest(m);
    return {
      ...m,
      installed: !a && isInstalled(m),
      bytes: man?.bytes || 0,
      downloading: a ? { got: a.got, total: a.total, file: a.file, queued: a.queued } : null,
      error: a?.error || null
    };
  });
}
const get = (id) => core.catalog().models.find(m => m.id === id);
const installed = (id) => { const m = get(id); if (m?.kind === 'cloud') return !!core.get().tripo?.key; return !!m && !active.has(id) && isInstalled(m); };

async function download(id) {
  const m = get(id);
  if (!m) throw new Error('Unknown model ' + id);
  if (active.has(id)) return;
  const st = { abort: new AbortController(), got: 0, total: m.sizeMB * 1048576, file: '', error: null, queued: false };
  active.set(id, st);
  emit({ id, type: 'start' });
  try {
    const files = await plan(m);
    st.total = files.reduce((n, f) => n + (f.size || 0), 0) || st.total;
    const est = !files.some((f) => f.size);   // direct downloads report their real size as they go
    let done = 0;
    for (const f of files) {
      if (st.abort.signal.aborted) throw new Error('Stopped');
      st.file = f.file;
      let ok = false;
      try { const n = fs.statSync(f.dest).size; ok = f.size ? n === f.size : n > 0; } catch {}
      if (!ok) {
        // a few retries cover flaky Wi-Fi; .part files make each retry resume
        for (let attempt = 1; ; attempt++) {
          try {
            await tools.downloadFile(f.url, f.dest, {
              signal: st.abort.signal, expectedSize: f.size,
              onProgress: (got, total) => { if (est && total) st.total = done + total; st.got = done + got; emit({ id, type: 'progress', got: st.got, total: st.total, file: f.file }); }
            });
            break;
          } catch (e) {
            if (st.abort.signal.aborted || attempt >= 4) throw e;
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        }
      }
      done += f.size || (() => { try { return fs.statSync(f.dest).size; } catch { return 0; } })();
      st.got = done;
      emit({ id, type: 'progress', got: st.got, total: st.total, file: f.file });
    }
    const root = core.modelsDir();
    const man = { id, at: Date.now(), bytes: done, files: files.map(f => ({ rel: path.relative(root, f.dest), size: (() => { try { return fs.statSync(f.dest).size; } catch { return f.size; } })() })) };
    core.ensureDir(path.dirname(manifestPath(m)));
    fs.writeFileSync(manifestPath(m), JSON.stringify(man, null, 2));
    active.delete(id);
    emit({ id, type: 'done' });
  } catch (e) {
    const stopped = st.abort.signal.aborted;
    active.delete(id);
    emit({ id, type: stopped ? 'stopped' : 'error', error: stopped ? null : e.message });
  }
}

function cancel(id) { active.get(id)?.abort.abort(); }

// Removes a model's own files. Files another installed model also uses (a shared VAE) are kept.
function remove(id) {
  const m = get(id);
  if (!m || active.has(id)) return false;
  const man = readManifest(m);
  if (!man) return false;
  const keep = new Set();
  for (const other of core.catalog().models) {
    if (other.id === id) continue;
    const om = readManifest(other);
    if (om) for (const f of om.files) keep.add(f.rel);
  }
  const root = core.modelsDir();
  for (const f of man.files) {
    if (keep.has(f.rel)) continue;
    try { fs.unlinkSync(path.join(root, f.rel)); } catch {}
    // tidy empty folders back up to the models root
    let d = path.dirname(path.join(root, f.rel));
    while (d.startsWith(root) && d !== root) { try { fs.rmdirSync(d); } catch { break; } d = path.dirname(d); }
  }
  try { fs.unlinkSync(manifestPath(m)); } catch {}
  emit({ id, type: 'removed' });
  return true;
}

function busy() { return active.size > 0; }
function onEvent(fn) { emit = fn; }

module.exports = { list, get, installed, download, cancel, remove, busy, onEvent };

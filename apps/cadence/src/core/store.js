// Cadence — what's kept on disk, all inside the app-data folder:
//   flows/<id>.json   one file per automation (easy to back up or share)
//   runs.json         run history (newest first, outputs trimmed)
//   memory.json       what "Compare with last run" remembers
//   secrets.json      passwords and tokens, encrypted with the system keychain (Electron safeStorage)
//   state.json        scheduler bookkeeping (next/last run per automation)
//   runs/<run id>/    each run's scratch folder (downloads before they're saved, AI attachments)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, p); }

class Store {
  constructor(root, { crypt } = {}) {
    this.root = root;
    this.crypt = crypt || { encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString(), plain: true };
    this.flowsDir = path.join(root, 'flows');
    this.runsDir = path.join(root, 'runs');
    fs.mkdirSync(this.flowsDir, { recursive: true }); fs.mkdirSync(this.runsDir, { recursive: true });
    this.flows = new Map();
    for (const f of fs.readdirSync(this.flowsDir)) if (f.endsWith('.json')) { const j = readJson(path.join(this.flowsDir, f), null); if (j && j.id) this.flows.set(j.id, j); }
    this.history = readJson(path.join(root, 'runs.json'), []);
    this.memoryData = readJson(path.join(root, 'memory.json'), {});
    this.secretData = readJson(path.join(root, 'secrets.json'), {});
    this.stateData = readJson(path.join(root, 'state.json'), {});
    this.profilesData = readJson(path.join(root, 'profiles.json'), [{ id: 'default', name: 'Default' }]);
    this._histTimer = null;
  }
  // ───────── flows
  listFlows() { return [...this.flows.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.name).localeCompare(String(b.name))); }
  getFlow(id) { return this.flows.get(id) || null; }
  saveFlow(flow) {
    const now = Date.now();
    const f = { ...flow, id: flow.id || 'f' + crypto.randomBytes(5).toString('hex'), updatedAt: now, createdAt: flow.createdAt || now };
    this.flows.set(f.id, f); writeJson(path.join(this.flowsDir, f.id + '.json'), f);
    return f;
  }
  deleteFlow(id) {
    const f = this.flows.get(id); if (!f) return false;
    this.flows.delete(id);
    const trash = path.join(this.root, 'deleted'); fs.mkdirSync(trash, { recursive: true });
    try { fs.renameSync(path.join(this.flowsDir, id + '.json'), path.join(trash, `${id}-${Date.now()}.json`)); } catch {}
    delete this.stateData[id]; this.saveState();
    return true;
  }
  // ───────── runs
  addRun(snap, keep = 500) {
    this.history = [snap, ...this.history.filter((r) => r.id !== snap.id)].slice(0, keep);
    clearTimeout(this._histTimer); this._histTimer = setTimeout(() => this.flushRuns(), 400);
  }
  flushRuns() { clearTimeout(this._histTimer); writeJson(path.join(this.root, 'runs.json'), this.history); }
  pruneRunDirs(keepDays = 14, keepMin = 10) {
    let dirs = []; try { dirs = fs.readdirSync(this.runsDir); } catch { return; }
    dirs.sort().reverse();
    const cut = Date.now() - keepDays * 864e5;
    dirs.slice(keepMin).forEach((d) => { const p = path.join(this.runsDir, d); try { if (fs.statSync(p).mtimeMs < cut) fs.rmSync(p, { recursive: true, force: true }); } catch {} });
  }
  // ───────── memory (compare with last run)
  get memory() {
    return {
      get: (flowId, key) => (this.memoryData[flowId] || {})[key],
      set: (flowId, key, value) => { (this.memoryData[flowId] = this.memoryData[flowId] || {})[key] = value; writeJson(path.join(this.root, 'memory.json'), this.memoryData); },
      clear: (flowId) => { delete this.memoryData[flowId]; writeJson(path.join(this.root, 'memory.json'), this.memoryData); },
      keys: (flowId) => Object.keys(this.memoryData[flowId] || {}),
    };
  }
  // ───────── secrets
  get secrets() {
    return {
      get: (name) => { const e = this.secretData[name]; if (!e) return undefined; try { return this.crypt.decrypt(e.v); } catch { return undefined; } },
      set: (name, value) => { if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error('Secret names use letters, numbers and _ (like REPORT_PASSWORD)'); this.secretData[name] = { v: this.crypt.encrypt(String(value)), at: Date.now() }; writeJson(path.join(this.root, 'secrets.json'), this.secretData); },
      remove: (name) => { delete this.secretData[name]; writeJson(path.join(this.root, 'secrets.json'), this.secretData); },
      names: () => Object.keys(this.secretData).sort(),
      list: () => Object.entries(this.secretData).map(([name, e]) => ({ name, at: e.at })).sort((a, b) => a.name.localeCompare(b.name)),
      encrypted: !this.crypt.plain,
    };
  }
  // ───────── browser profiles
  profiles() { return this.profilesData; }
  saveProfiles(list) { this.profilesData = list; writeJson(path.join(this.root, 'profiles.json'), list); }
  ensureProfile(id) { if (!this.profilesData.some((p) => p.id === id)) this.saveProfiles([...this.profilesData, { id, name: id.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }]); }
  // ───────── scheduler state
  state(id) { return (this.stateData[id] = this.stateData[id] || {}); }
  saveState() { writeJson(path.join(this.root, 'state.json'), this.stateData); }
}

module.exports = { Store, readJson, writeJson };

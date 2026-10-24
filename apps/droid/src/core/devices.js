// Saved devices (devices.json in Droid's data folder) and the rules that keep each one valid.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STYLES, sizeFor, densityFor, ACCENTS } = require('./catalog');

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

// Fills in and corrects a device record. `host` = { ramMB, cores } caps what the computer can give.
function normalize(input, host = { ramMB: 16384, cores: 8 }) {
  const d = { ...input };
  d.id = d.id || crypto.randomBytes(5).toString('hex');
  d.style = STYLES[d.style] ? d.style : 'pixel';
  const st = STYLES[d.style];
  d.name = String(d.name || st.short).trim().slice(0, 60) || st.short;
  d.finish = st.finishes.some((f) => f.id === d.finish) ? d.finish : st.finishes[0].id;
  d.accent = ACCENTS.includes(d.accent) ? d.accent : ACCENTS[0];
  const sc = d.screen || {};
  let w = Math.round(num(sc.w, 0)), h = Math.round(num(sc.h, 0));
  if (!w || !h) ({ w, h } = sizeFor(d.style, st.defaults.res));
  w = clamp(Math.round(w / 2) * 2, 320, 4096); h = clamp(Math.round(h / 2) * 2, 320, 4096);
  const dpi = clamp(Math.round(num(sc.dpi, densityFor(w, h, st.diag))), 120, 640);
  d.screen = { w, h, dpi, preset: sc.preset || null };
  d.ramMB = clamp(Math.round(num(d.ramMB, st.defaults.ramMB)), 1536, Math.max(2048, host.ramMB));
  d.cores = clamp(Math.round(num(d.cores, st.defaults.cores)), 1, Math.max(1, host.cores));
  d.storageGB = clamp(Math.round(num(d.storageGB, st.defaults.storageGB)), 8, 2048);
  const n = d.network || {};
  d.network = { mode: ['internet', 'isolated', 'proxy'].includes(n.mode) ? n.mode : 'internet', proxy: n.proxy ? String(n.proxy).trim() : '', dns: n.dns ? String(n.dns).trim() : '', speed: n.speed || 'full', delay: n.delay || 'none' };
  if (d.network.mode === 'proxy' && !d.network.proxy) d.network.mode = 'internet';
  const l = d.location || {};
  d.location = {
    mode: ['actual', 'simulated', 'manual'].includes(l.mode) ? l.mode : 'actual',
    lat: Number.isFinite(+l.lat) ? clamp(+l.lat, -90, 90) : null,
    lng: Number.isFinite(+l.lng) ? clamp(+l.lng, -180, 180) : null,
    label: l.label ? String(l.label).slice(0, 120) : '',
    city: l.city || null,
    motion: ['still', 'walk', 'drive'].includes(l.motion) ? l.motion : 'still',
  };
  const o = d.options || {};
  d.options = {
    quickBoot: o.quickBoot !== false,
    audio: o.audio !== false,
    microphone: !!o.microphone,
    clipboard: o.clipboard !== false,
    gpu: ['auto', 'host', 'swiftshader_indirect', 'guest'].includes(o.gpu) ? o.gpu : 'auto',
  };
  if (!d.image || !d.image.path) throw new Error('Pick an Android version for this device.');
  d.image = { path: d.image.path, api: String(d.image.api), tag: d.image.tag, tagName: d.image.tagName || d.image.tag, abi: d.image.abi, name: d.image.name || `API ${d.image.api}` };
  d.createdAt = d.createdAt || Date.now();
  d.updatedAt = Date.now();
  d.lastUsedAt = d.lastUsedAt || null;
  d.pinned = !!d.pinned;
  d.notes = d.notes ? String(d.notes).slice(0, 2000) : '';
  return d;
}

class DeviceStore {
  constructor(file, host) { this.file = file; this.host = host; this.list = readJson(file, { devices: [] }).devices || []; }
  save() { writeJson(this.file, { version: 1, devices: this.list }); }
  all() { return this.list.slice().sort((a, b) => (b.pinned - a.pinned) || ((b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))); }
  get(id) { return this.list.find((d) => d.id === id) || null; }
  create(input) {
    const d = normalize({ ...input, id: null, createdAt: null }, this.host);
    this.list.push(d); this.save(); return d;
  }
  update(id, patch) {
    const i = this.list.findIndex((d) => d.id === id);
    if (i < 0) throw new Error('Device not found');
    const cur = this.list[i];
    const next = normalize({ ...cur, ...patch, id: cur.id, createdAt: cur.createdAt, options: { ...cur.options, ...(patch.options || {}) }, network: patch.network ? { ...patch.network } : cur.network, location: patch.location ? { ...cur.location, ...patch.location } : cur.location, screen: patch.screen ? { ...patch.screen } : cur.screen }, this.host);
    this.list[i] = next; this.save(); return next;
  }
  touch(id) { const d = this.get(id); if (d) { d.lastUsedAt = Date.now(); this.save(); } }
  remove(id) { this.list = this.list.filter((d) => d.id !== id); this.save(); }
  duplicate(id) {
    const d = this.get(id); if (!d) throw new Error('Device not found');
    let name = `${d.name} copy`, n = 2;
    while (this.list.some((x) => x.name === name)) name = `${d.name} copy ${n++}`;
    return this.create({ ...d, name, pinned: false, lastUsedAt: null });
  }
}

module.exports = { DeviceStore, normalize, readJson, writeJson };

'use strict';
// Waypoint — private things kept encrypted on this computer: booking service keys and traveler
// profiles (names as on passports, dates of birth, contact details). Encrypted with the system keychain
// (Electron safeStorage: Keychain on Mac, DPAPI on Windows). Never in the trips folder, never in
// .waypoint files or offline packs, and the window only ever sees whether a key is set — not the key.
const fs = require('fs');
const path = require('path');

class Secrets {
  constructor(file, crypto) { this.file = file; this.c = crypto; this.data = { keys: {}, travelers: [] }; this.load(); }
  load() {
    try {
      const raw = fs.readFileSync(this.file);
      const txt = this.c && this.c.available() ? this.c.decrypt(raw) : raw.toString('utf8');
      const d = JSON.parse(txt);
      this.data = { keys: d.keys || {}, travelers: Array.isArray(d.travelers) ? d.travelers : [] };
    } catch { /* first run, or unreadable: start empty */ }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const txt = JSON.stringify(this.data);
    const buf = this.c && this.c.available() ? this.c.encrypt(txt) : Buffer.from(txt);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  key(name) { return (this.data.keys[name] || '').trim(); }
  setKey(name, value) { value = String(value || '').trim(); if (value) this.data.keys[name] = value; else delete this.data.keys[name]; this.save(); }
  encrypted() { return !!(this.c && this.c.available()); }
  travelers() { return this.data.travelers; }
  saveTraveler(t) {
    const clean = {}; for (const k of ['id', 'title', 'given', 'family', 'born', 'gender', 'email', 'phone', 'nationality']) clean[k] = String(t[k] || '').trim();
    if (!clean.id) clean.id = Math.random().toString(36).slice(2, 10);
    const i = this.data.travelers.findIndex(x => x.id === clean.id);
    if (i >= 0) this.data.travelers[i] = clean; else this.data.travelers.push(clean);
    this.save(); return this.data.travelers;
  }
  removeTraveler(id) { this.data.travelers = this.data.travelers.filter(x => x.id !== id); this.save(); return this.data.travelers; }
}

// what a key looks like from the outside
function keyMode(service, key) {
  if (!key) return null;
  if (service === 'duffel') return /^duffel_test_/.test(key) ? 'test' : 'live';
  if (service === 'liteapi') return /^sand_/.test(key) ? 'test' : 'live';
  return 'live';
}

module.exports = { Secrets, keyMode };

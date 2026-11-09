// Mixer — songs on disk. Each song is a folder in ~/Documents/Mixer: song.json, audio/ (copies of imported files, so a
// song never breaks when the original moves), exports/ and history/ (a snapshot before every change Claude makes).
// Undo/redo lives here so the window and Claude share one history.
'use strict';
const fs = require('fs');
const path = require('path');
const SG = require('./core/song');

function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function writeJSON(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 1)); fs.renameSync(tmp, f); }
const slug = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled';
const AUDIO_EXT = /\.(wav|wave|mp3|m4a|aac|flac|ogg|oga|opus|webm|mp4|mov|caf)$/i;

class Project {
  constructor(dir) { this.dir = dir; this.id = path.basename(dir); this.song = SG.hydrate(readJSON(this.p('song.json'), null) || SG.newSong({ name: this.id })); this.undo = []; this.redo = []; this.rev = 1; this.saveTimer = null; }
  p(...a) { return path.join(this.dir, ...a); }
  get name() { return this.song.name; }
  save(now) { clearTimeout(this.saveTimer); const w = () => writeJSON(this.p('song.json'), this.song); if (now) w(); else this.saveTimer = setTimeout(w, 250); }
  // every change goes through here: snapshot → change → save
  edit(fn, { label = 'Edit', by = 'you', snapshot = false } = {}) {
    const before = JSON.stringify(this.song);
    const work = JSON.parse(before); SG.hydrate(work);
    const out = fn(work);
    SG.hydrate(work); work.updatedAt = Date.now();
    this.undo.push({ json: before, label, by }); if (this.undo.length > 150) this.undo.shift(); this.redo = [];
    this.song = work; this.rev++; this.save();
    if (snapshot || by !== 'you') this.snapshot(before, label, by);
    return out;
  }
  replace(song, { label = 'Edit', by = 'you' } = {}) { return this.edit((s) => { for (const k of Object.keys(s)) delete s[k]; Object.assign(s, JSON.parse(JSON.stringify(song))); s.id = this.song.id; }, { label, by }); }
  snapshot(json, label, by) { try { const dir = this.p('history'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `${Date.now()}.json`); fs.writeFileSync(f, JSON.stringify({ label, by, at: Date.now(), song: JSON.parse(json) })); const all = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort(); for (const x of all.slice(0, Math.max(0, all.length - 60))) fs.unlinkSync(path.join(dir, x)); } catch {} }
  doUndo(steps = 1) { const done = []; for (let i = 0; i < steps && this.undo.length; i++) { const u = this.undo.pop(); this.redo.push({ json: JSON.stringify(this.song), label: u.label, by: u.by }); this.song = SG.hydrate(JSON.parse(u.json)); done.push(u.label); } if (done.length) { this.rev++; this.save(); } return done; }
  doRedo(steps = 1) { const done = []; for (let i = 0; i < steps && this.redo.length; i++) { const r = this.redo.pop(); this.undo.push({ json: JSON.stringify(this.song), label: r.label, by: r.by }); this.song = SG.hydrate(JSON.parse(r.json)); done.push(r.label); } if (done.length) { this.rev++; this.save(); } return done; }
  history() { return { undo: this.undo.slice(-20).map((u) => ({ label: u.label, by: u.by })).reverse(), redo: this.redo.slice(-20).map((u) => ({ label: u.label, by: u.by })).reverse() }; }
  // copy an audio file into the song folder (same file twice → reused)
  importAudio(src) {
    if (!fs.existsSync(src)) throw new Error('No file at ' + src);
    if (!AUDIO_EXT.test(src)) throw new Error(`Mixer reads WAV, MP3, M4A/AAC, FLAC, OGG/Opus and the audio in MP4/MOV/WebM. “${path.basename(src)}” isn’t one of those.`);
    const dir = this.p('audio'); fs.mkdirSync(dir, { recursive: true }); const st = fs.statSync(src);
    for (const f of fs.readdirSync(dir)) { try { const s2 = fs.statSync(path.join(dir, f)); if (s2.size === st.size && f.replace(/( \d+)?(\.[^.]+)$/, '$2') === path.basename(src)) return f; } catch {} }
    const ext = path.extname(src), base = path.basename(src, ext); let name = base + ext, i = 2; while (fs.existsSync(path.join(dir, name))) name = `${base} ${i++}${ext}`;
    fs.copyFileSync(src, path.join(dir, name)); return name;
  }
  audioPath(rel) { const f = path.join(this.dir, 'audio', path.basename(String(rel))); if (!fs.existsSync(f)) throw new Error('Missing audio file: ' + rel); return f; }
  outDir(sub = 'exports') { const d = this.p(sub); fs.mkdirSync(d, { recursive: true }); return d; }
  info() { const s = this.song; return { id: this.id, name: s.name, bpm: s.bpm, key: s.key, bars: s.bars, tracks: s.tracks.length, updatedAt: s.updatedAt, dir: this.dir }; }
}

class Library {
  constructor(root) { this.setRoot(root); }
  setRoot(root) { this.root = root; fs.mkdirSync(root, { recursive: true }); this.cache = new Map(); }
  list() { const out = []; for (const d of fs.readdirSync(this.root, { withFileTypes: true })) { if (!d.isDirectory()) continue; const f = path.join(this.root, d.name, 'song.json'); if (!fs.existsSync(f)) continue; const s = readJSON(f, null); if (s) out.push({ id: d.name, name: s.name || d.name, bpm: s.bpm, key: s.key, bars: s.bars, tracks: (s.tracks || []).length, updatedAt: s.updatedAt || fs.statSync(f).mtimeMs }); } return out.sort((a, b) => b.updatedAt - a.updatedAt); }
  get(id) { if (this.cache.has(id)) return this.cache.get(id); const dir = path.join(this.root, path.basename(String(id))); if (!fs.existsSync(path.join(dir, 'song.json'))) { const m = this.list().find((x) => x.name.toLowerCase() === String(id).toLowerCase()); if (m) return this.get(m.id); throw new Error(`No song “${id}”.`); } const p = new Project(dir); this.cache.set(p.id, p); return p; }
  create(opts = {}) { const base = slug(opts.name || 'Untitled song'); let id = base, i = 2; while (fs.existsSync(path.join(this.root, id))) id = `${base} ${i++}`; const dir = path.join(this.root, id); fs.mkdirSync(dir, { recursive: true }); writeJSON(path.join(dir, 'song.json'), SG.newSong({ ...opts, name: opts.name || id })); return this.get(id); }
  rename(id, name) { const p = this.get(id); p.edit((s) => { s.name = String(name).slice(0, 80) || s.name; }, { label: 'Rename song' }); return p; }
  duplicate(id) { const p = this.get(id); p.save(true); const n = this.create({ name: p.name + ' copy' }); for (const f of fs.readdirSync(p.dir)) { if (f === 'history') continue; fs.cpSync(path.join(p.dir, f), path.join(n.dir, f), { recursive: true }); } this.cache.delete(n.id); const q = this.get(n.id); q.edit((s) => { s.name = p.name + ' copy'; s.id = SG.uid('song_'); }, { label: 'Duplicate' }); return q; }
}
module.exports = { Library, Project, readJSON, writeJSON, AUDIO_EXT };

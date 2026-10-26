// Atoll — the shelf: files dropped on the island wait there until you drag them somewhere else, and the last
// few things you copied stay one click away. Files are kept as paths (nothing is copied); the clipboard history
// lives in memory only and is gone when Atoll quits.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const KINDS = [
  [/\.(png|jpe?g|gif|webp|heic|bmp|tiff?|svg|avif)$/i, 'image'], [/\.(mp4|mov|m4v|mkv|webm|avi)$/i, 'video'], [/\.(mp3|m4a|wav|flac|aac|ogg|aiff?)$/i, 'audio'],
  [/\.(pdf)$/i, 'pdf'], [/\.(zip|rar|7z|tar|gz|dmg|iso|pkg|exe|msi)$/i, 'archive'], [/\.(docx?|pages|rtf|txt|md)$/i, 'doc'], [/\.(xlsx?|csv|numbers)$/i, 'sheet'],
  [/\.(pptx?|key)$/i, 'slides'], [/\.(js|ts|py|json|html|css|sh|swift|cs|java|c|cpp|go|rs)$/i, 'code']
];
const kindOf = (p, dir) => (dir ? 'folder' : (KINDS.find(([re]) => re.test(p)) || [null, 'file'])[1]);

class Shelf extends EventEmitter {
  constructor({ load = () => [], save = () => {}, clipboard = null, size = () => 12, enabled = () => true }) {
    super();
    this.items = (load() || []).filter((i) => i && i.path);
    this.save = save; this.cb = clipboard; this.size = size; this.enabled = enabled;
    this.clips = []; this.lastClip = null; this.timer = null; this.skipNext = null;
  }
  add(paths) {
    let n = 0;
    for (const p of paths || []) {
      if (!p || this.items.some((i) => i.path === p)) continue;
      let st = null; try { st = fs.statSync(p); } catch { continue; }
      this.items.unshift({ id: Math.random().toString(36).slice(2, 9), path: p, name: path.basename(p), size: st.isDirectory() ? null : st.size, kind: kindOf(p, st.isDirectory()), added: Date.now() });
      n++;
    }
    this.items = this.items.slice(0, 40);
    if (n) { this.save(this.items); this.emit('change'); }
    return n;
  }
  remove(id) { this.items = this.items.filter((i) => i.id !== id); this.save(this.items); this.emit('change'); }
  clear() { this.items = []; this.save(this.items); this.emit('change'); }
  /** Drop entries whose file has gone (moved or deleted elsewhere). */
  prune() { const before = this.items.length; this.items = this.items.filter((i) => fs.existsSync(i.path)); if (this.items.length !== before) { this.save(this.items); this.emit('change'); } }
  get(id) { return this.items.find((i) => i.id === id) || null; }

  // ---------------------------------------------------------------- clipboard
  watch() {
    clearInterval(this.timer);
    if (!this.cb) return;
    try { this.lastClip = this.cb.readText(); } catch (_) {}
    this.timer = setInterval(() => this.sample(), 1000);
  }
  sample() {
    if (!this.enabled()) { if (this.clips.length) { this.clips = []; this.emit('change'); } return; }
    let t = ''; try { t = this.cb.readText(); } catch (_) { return; }
    if (!t || t === this.lastClip) return;
    this.lastClip = t;
    if (this.skipNext === t) { this.skipNext = null; return; }
    const text = t.length > 20000 ? t.slice(0, 20000) : t;
    if (!text.trim()) return;
    this.clips = [{ id: Math.random().toString(36).slice(2, 9), text, at: Date.now() }, ...this.clips.filter((c) => c.text !== text)].slice(0, Math.max(1, this.size()));
    this.emit('change');
  }
  copy(id) {
    const c = this.clips.find((x) => x.id === id); if (!c || !this.cb) return;
    this.skipNext = null; this.lastClip = c.text; this.cb.writeText(c.text);
    this.clips = [c, ...this.clips.filter((x) => x.id !== id)];
    this.emit('change');
  }
  forgetClip(id) { this.clips = this.clips.filter((x) => x.id !== id); this.emit('change'); }
  clearClips() { this.clips = []; this.emit('change'); }
  stop() { clearInterval(this.timer); }
  snapshot() { return { items: this.items, clips: this.clips.map((c) => ({ id: c.id, at: c.at, text: c.text.length > 400 ? c.text.slice(0, 400) + '…' : c.text, long: c.text.length > 400, lines: c.text.split('\n').length })) }; }
}

module.exports = { Shelf, kindOf };

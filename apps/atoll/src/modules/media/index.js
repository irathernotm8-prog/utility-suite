// Atoll — Now Playing: polls the platform backend, picks the player that matters, fetches artwork once per track,
// and tells the island when something changes. Polls quickly while the island is open and slowly otherwise.
'use strict';
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function pickBackend(demo) {
  if (demo || (process.platform !== 'darwin' && process.platform !== 'win32')) return require('./demo');
  return process.platform === 'darwin' ? require('./mac') : require('./win');
}

/** From what every player reports, the one to show: a playing one, else the one shown before, else any paused one. */
function choose(list, prevPlayer) {
  const ok = (list || []).filter((p) => p && !p.error && p.state && p.state !== 'stopped' && p.title);
  return ok.find((p) => p.state === 'playing') || ok.find((p) => p.player === prevPlayer) || ok[0] || null;
}

class Media extends EventEmitter {
  constructor({ dir, demo = false, players = () => ['Music', 'Spotify'], nativeImage = null, fetchBuffer = null } = {}) {
    super();
    this.demo = demo || (process.platform !== 'darwin' && process.platform !== 'win32');
    this.b = pickBackend(this.demo);
    this.dir = dir; this.players = players; this.nativeImage = nativeImage; this.fetchBuffer = fetchBuffer;
    this.cur = null;            // what the island shows
    this.running = [];          // players that are open (Mac)
    this.art = new Map();       // track id -> data URL
    this.fast = false; this.timer = null; this.busy = false; this.stopped = true;
    this.lastError = null; this.volume = null; this.volAt = 0;
  }
  start() { this.stopped = false; this.loop(0); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  setFast(on) { const was = this.fast; this.fast = !!on; if (on && !was) this.loop(0); }
  loop(ms) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(async () => { await this.poll(); this.loop(this.interval()); }, ms);
  }
  interval() {
    if (this.fast) return 1000;
    if (this.cur && this.cur.state === 'playing') return 2500;
    return 5000;
  }

  async poll() {
    if (this.busy) return; this.busy = true;
    try {
      const list = await this.b.poll(this.players());
      this.running = list.filter((p) => p && p.player && !p.error).map((p) => p.player);
      const err = list.find((p) => p && p.error);
      this.lastError = err ? String(err.error).slice(0, 200) : null;
      const next = choose(list, this.cur?.player);
      const prev = this.cur;
      if (!next) { if (prev) { this.cur = null; this.emit('change'); } return; }
      const key = `${next.player}|${next.id || next.title + next.artist}`;
      const newTrack = !prev || prev.key !== key;
      this.cur = { ...next, key, at: Date.now(), art: this.art.get(key) || (newTrack ? null : prev.art) };
      if (newTrack) { this.fetchArt(next, key); if (prev && next.state === 'playing') this.emit('track', this.cur); }
      if (this.fast && Date.now() - this.volAt > 4000) { this.volAt = Date.now(); this.b.getVolume().then((v) => { this.volume = v; }).catch(() => {}); }
      if (newTrack || !prev || prev.state !== next.state || Math.abs((prev.position || 0) + (Date.now() - prev.at) / 1000 * (prev.state === 'playing' ? 1 : 0) - next.position) > 2.5 || prev.volume !== next.volume) this.emit('change');
    } catch (e) { this.lastError = String(e.message || e); }
    finally { this.busy = false; }
  }

  async fetchArt(t, key) {
    if (this.art.has(key)) return;
    let url = null;
    try {
      if (this.demo) url = this.b.artSvg();
      else if (t.art && /^https:\/\//.test(t.art) && this.fetchBuffer) url = this.toData(await this.fetchBuffer(t.art));
      else if (this.dir && ((this.b.musicArt && t.player === 'Music') || (this.b.art && t.hasArt))) {
        fs.mkdirSync(this.dir, { recursive: true });
        const f = path.join(this.dir, `art-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}.img`);
        const got = this.b.musicArt ? await this.b.musicArt(f) : await this.b.art(f);
        if (got) { url = this.toData(fs.readFileSync(f)); fs.rmSync(f, { force: true }); }
      }
    } catch (_) {}
    this.art.set(key, url);
    if (this.art.size > 40) this.art.delete(this.art.keys().next().value);
    if (this.cur && this.cur.key === key) { this.cur.art = url; this.emit('change'); }
  }
  toData(buf) {
    if (!buf || !buf.length) return null;
    if (!this.nativeImage) return `data:image/jpeg;base64,${buf.toString('base64')}`;
    const img = this.nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const s = img.getSize();
    return (s.width > 320 ? img.resize({ width: 320, quality: 'best' }) : img).toDataURL();
  }

  async command(cmd, value) {
    const p = this.cur?.player || this.running[0] || 'Music';
    if (cmd === 'sysvolume') { await this.b.setVolume(value); this.volume = { ...(this.volume || {}), volume: Number(value) }; this.emit('change'); return; }
    if (cmd === 'mute') { await this.b.setMute(value); this.volume = { ...(this.volume || {}), muted: !!value }; this.emit('change'); return; }
    if (cmd === 'open') { if (this.b.openPlayer) await this.b.openPlayer(value || p); return; }
    // answer the click straight away; the next poll confirms it
    if (this.cur && (cmd === 'toggle' || cmd === 'play' || cmd === 'pause')) {
      const pos = this.position();
      this.cur = { ...this.cur, state: cmd === 'play' ? 'playing' : cmd === 'pause' ? 'paused' : this.cur.state === 'playing' ? 'paused' : 'playing', position: pos, at: Date.now() };
      this.emit('change');
    }
    if (this.cur && cmd === 'seek') { this.cur = { ...this.cur, position: Number(value) || 0, at: Date.now() }; this.emit('change'); }
    await this.b.command(p, cmd, value);
    setTimeout(() => this.poll(), cmd === 'next' || cmd === 'prev' ? 350 : 150);
  }
  position() { const c = this.cur; if (!c) return 0; return Math.min(c.duration || Infinity, c.position + (c.state === 'playing' ? (Date.now() - c.at) / 1000 : 0)); }

  snapshot() {
    const c = this.cur;
    return {
      now: c ? { player: c.player, state: c.state, title: c.title, artist: c.artist, album: c.album, duration: c.duration, position: this.position(), at: Date.now(), art: c.art || null, volume: c.volume ?? null, canNext: c.canNext !== false, canPrev: c.canPrev !== false, canSeek: c.canSeek !== false && !!c.duration } : null,
      running: this.running, volume: this.volume, error: this.lastError,
      platform: this.demo ? 'demo' : process.platform
    };
  }
}

module.exports = { Media, choose };

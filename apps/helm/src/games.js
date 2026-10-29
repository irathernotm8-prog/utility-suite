// Helm — steps aside while a game is playing, so the controller only drives the game.
// Helm pauses when:
//   · the app in front is on the Games list (Game Hub and its games are there from the start), or
//   · the app in front fills the whole screen and isn't on the "keep Helm on" list (browsers, video players…), or
//   · another app asks over the Utility Suite link (helm.claim), e.g. Game Hub while it runs a game.
// Holding Create + Options while paused brings Helm back over that app until you switch to another one.
'use strict';

const DEFAULT_GAMES = ['Game Hub', 'Skyline Protocol', 'Danger Room', 'Lethal Protector', 'Valkorath', 'Steam Big Picture'];
const DEFAULT_KEEP = ['Safari', 'Chrome', 'Firefox', 'Edge', 'Brave', 'Arc', 'Opera', 'Vantage', 'Sideby', 'QuickTime Player', 'TV', 'Music', 'Spotify', 'VLC',
  'IINA', 'mpv', 'Netflix', 'Plex', 'Kodi', 'Preview', 'Photos', 'Keynote', 'PowerPoint', 'POWERPNT', 'Finder', 'Explorer', 'Helm', 'Touchline', 'Atoll', 'Zoom', 'Teams'];

const norm = (s) => String(s || '').toLowerCase().replace(/\.exe$/, '').trim();
function matches(list, app) {
  if (!app) return null;
  const keys = [app.name, app.id, app.path && app.path.split(/[\\/]/).pop(), app.title].map(norm).filter(Boolean);
  for (const item of list || []) {
    const n = norm(item); if (!n) continue;
    if (keys.some((k) => k === n || (n.length >= 4 && k.includes(n)))) return item;
  }
  return null;
}

class GameGuard {
  constructor({ platform, settings, screen, onChange, selfPid = process.pid }) {
    this.platform = platform; this.settings = settings; this.screen = screen; this.onChange = onChange; this.selfPid = selfPid;
    this.front = null; this.reason = null; this.claims = new Map(); this.override = null; this.timer = null; this.busy = false;
  }
  start() { this.timer = setInterval(() => this.check(), 900); this.check(); }
  stop() { clearInterval(this.timer); }
  frontKey(app) { return app ? `${app.pid}:${app.name}` : ''; }
  isFull(app) {
    if (!app) return false;
    if (app.full != null) return app.full;
    if (!app.bounds || !this.screen) return false;
    try {
      return this.screen.getAllDisplays().some((d) => Math.abs(d.bounds.x - app.bounds.x) < 2 && Math.abs(d.bounds.y - app.bounds.y) < 2 && Math.abs(d.bounds.width - app.bounds.width) < 2 && Math.abs(d.bounds.height - app.bounds.height) < 2);
    } catch (_) { return false; }
  }
  claim(owner, seconds = 12, label = null) {
    owner = String(owner || 'app'); this.claims.set(owner, { until: Date.now() + Math.max(2, Math.min(600, Number(seconds) || 12)) * 1000, label: label || owner });
    this.decide(); return this.status();
  }
  release(owner) { this.claims.delete(String(owner || 'app')); this.decide(); return this.status(); }
  /** The chord while paused: Helm comes back over this app. */
  overrideNow() { if (!this.reason) return false; this.override = this.frontKey(this.front) || 'claim'; this.decide(); return true; }
  async check() {
    if (this.busy) return; this.busy = true;
    try {
      const app = await this.platform.front();
      if (app && app.pid !== this.selfPid) {
        if (this.frontKey(app) !== this.frontKey(this.front)) { this.override = this.override === 'claim' ? 'claim' : null; }
        this.front = app;
      }
    } catch (_) {}
    this.busy = false; this.decide();
  }
  decide() {
    const s = this.settings();
    const now = Date.now();
    for (const [k, c] of this.claims) if (c.until < now) this.claims.delete(k);
    let reason = null;
    if (s.gameMode !== false) {
      const claim = [...this.claims.values()][0];
      if (claim) reason = claim.label;
      else if (this.front) {
        const hit = matches(s.gameApps || DEFAULT_GAMES, this.front);
        if (hit) reason = this.front.name || hit;
        else if (s.fullscreenGames !== false && this.isFull(this.front) && !matches(s.keepApps || DEFAULT_KEEP, this.front)) reason = this.front.name || 'a full-screen app';
      }
    }
    if (!this.claims.size && this.override === 'claim') this.override = null;
    if (reason && this.override && (this.override === 'claim' ? this.claims.size : this.override === this.frontKey(this.front))) reason = null;
    if (reason !== this.reason) { this.reason = reason; this.onChange(reason); }
  }
  status() {
    return { paused: this.reason, front: this.front ? { name: this.front.name, id: this.front.id, full: this.isFull(this.front) } : null, claims: [...this.claims.entries()].map(([owner, c]) => ({ owner, label: c.label, until: c.until })), override: !!this.override };
  }
}

module.exports = { GameGuard, DEFAULT_GAMES, DEFAULT_KEEP, matches };

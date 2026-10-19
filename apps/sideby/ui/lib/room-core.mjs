// Transport-agnostic room protocol. Everyone is connected to everyone (mesh);
// one member is the host and owns the shared state. If the host leaves, the
// next most senior member takes over. Split-brain (two hosts) resolves to the
// earliest claim.

export const PROTOCOL_VERSION = 2;
const MAX_HISTORY = 150;
const MAX_TEXT = 1000;

export class Emitter {
  constructor() { this._handlers = new Map(); }
  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this._handlers.get(event)?.delete(fn);
  }
  emit(event, ...args) {
    for (const fn of this._handlers.get(event) ?? []) {
      try { fn(...args); } catch (error) { console.error(`[sideby] ${event} handler failed`, error); }
    }
  }
}

const cleanName = n => (typeof n === 'string' ? n.trim().slice(0, 32) : '') || 'Friend';
const cleanColor = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#D4F08A');
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);

export function sanitizePlayback(pb) {
  if (!isObj(pb)) return null;
  if (!finite(pb.t) || !finite(pb.at)) return null;
  return {
    t: Math.max(0, pb.t),
    paused: !!pb.paused,
    rate: finite(pb.rate) && pb.rate > 0 && pb.rate <= 4 ? pb.rate : 1,
    at: pb.at,
    live: !!pb.live,
    lag: finite(pb.lag) ? Math.max(0, pb.lag) : null,
    duration: finite(pb.duration) ? pb.duration : null
  };
}

function claimBeats(a, b) { // a, b: { claimAt, id }
  if (a.claimAt !== b.claimAt) return a.claimAt < b.claimAt;
  return a.id < b.id;
}

export class RoomCore extends Emitter {
  /**
   * transport: { selfId, send(type, data, target?), request(type, data, target, timeoutMs) }
   * The owner must forward transport events to peerJoined / peerLeft / receive / answer.
   */
  constructor({ transport, profile, startAsHost = false, roomName = '', now = Date.now, joinTimeoutMs = 9000, everyoneControls = true }) {
    super();
    this.transport = transport;
    this.now = now;
    this.selfId = transport.selfId;
    this.self = { id: this.selfId, name: cleanName(profile?.name), color: cleanColor(profile?.color) };
    this.members = new Map();
    this.hostId = null;
    this.claimAt = Infinity;
    this.order = [];
    this.messages = [];
    this.state = { mode: 'idle', url: null, title: '', pb: null, broadcaster: null, everyoneControls, roomName: String(roomName || '').slice(0, 60) };
    this.phase = 'connecting';
    this.closed = false;
    if (startAsHost) this._becomeHost(this.now());
    else this._joinTimer = setTimeout(() => { if (!this.hostId && !this.closed) this._becomeHost(this.now(), 'alone'); }, joinTimeoutMs);
  }

  get isHost() { return this.hostId === this.selfId; }
  get host() { return this.hostId === this.selfId ? this.self : this.members.get(this.hostId) ?? null; }
  canControl() { return this.isHost || !!this.state.everyoneControls; }

  memberList() {
    const all = [this.self, ...this.members.values()];
    const rank = id => { const i = this.order.indexOf(id); return i < 0 ? 1e6 : i; };
    return all.map(m => ({ ...m, isHost: m.id === this.hostId, isSelf: m.id === this.selfId }))
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }

  // ---- transport events ----
  peerJoined(id) {
    if (this.closed || id === this.selfId) return;
    if (!this.members.has(id)) this.members.set(id, { id, name: 'Friend', color: '#8A938C', named: false, status: null, joinedAt: this.now() });
    this.transport.send('hello', this._hello(), id);
    if (this.isHost) {
      if (!this.order.includes(id)) this.order.push(id);
      this._broadcastState();
      this._sendHistory(id);
    }
    this.emit('members');
  }

  peerLeft(id) {
    const member = this.members.get(id);
    if (!member) return;
    this.members.delete(id);
    this.order = this.order.filter(x => x !== id);
    if (member.named) this._system(`${member.name} left`);
    if (id === this.state.broadcaster) { this.state.mode = this.state.url ? 'browse' : 'idle'; this.state.broadcaster = null; }
    if (id === this.hostId) this._electAfter(id);
    else if (this.isHost) this._broadcastState();
    this.emit('members');
    this.emit('change');
  }

  receive(type, data, from) {
    if (this.closed || !this.members.has(from)) {
      if (!this.closed && from !== this.selfId && type === 'hello') this.peerJoined(from);
      else return;
    }
    const handler = this[`_on_${type}`];
    if (handler && isObj(data)) handler.call(this, data, from);
  }

  answer(type) { // request/response actions
    if (type === 'clock') return this.now();
    return null;
  }

  // ---- messages ----
  _hello() {
    return { v: PROTOCOL_VERSION, name: this.self.name, color: this.self.color, host: this.isHost ? { claimAt: this.claimAt } : null };
  }

  _on_hello(d, from) {
    const m = this.members.get(from);
    const firstName = !m.named;
    m.name = cleanName(d.name); m.color = cleanColor(d.color); m.named = true; m.v = d.v;
    if (firstName) this._system(`${m.name} joined`);
    if (d.host && this.isHost && finite(d.host.claimAt) && claimBeats({ claimAt: d.host.claimAt, id: from }, { claimAt: this.claimAt, id: this.selfId })) {
      // They were here first; they'll send state and we'll yield then.
    }
    if (this.isHost) this._broadcastState();
    this.emit('members');
  }

  _on_profile(d, from) {
    const m = this.members.get(from);
    const old = m.name;
    m.name = cleanName(d.name); m.color = cleanColor(d.color);
    if (m.named && old !== m.name) this._system(`${old} is now ${m.name}`);
    this.emit('members');
  }

  _on_state(d, from) {
    if (d.hostId !== from && from !== this.hostId) return; // only the host (or a host handing off) speaks for the room
    const claim = { claimAt: finite(d.claimAt) ? d.claimAt : Infinity, id: d.hostId };
    if (this.isHost && from !== this.selfId && d.hostId === from) {
      if (!claimBeats(claim, { claimAt: this.claimAt, id: this.selfId })) {
        this._broadcastState(from); // we win; make sure they hear it
        return;
      }
    } else if (from !== this.hostId && this.hostId && this.members.has(this.hostId)) {
      const current = { claimAt: this.claimAt, id: this.hostId };
      if (!claimBeats(claim, current)) return;
    }
    const wasHost = this.isHost;
    const prevHost = this.hostId;
    this.hostId = typeof d.hostId === 'string' ? d.hostId : from;
    this.claimAt = claim.claimAt;
    this.order = Array.isArray(d.order) ? d.order.filter(x => typeof x === 'string').slice(0, 64) : [this.hostId];
    const prevUrl = this.state.url;
    const prevAction = this.state.lastAction;
    const prevHostKnown = !!prevHost;
    this.state = {
      mode: ['idle', 'browse', 'broadcast'].includes(d.mode) ? d.mode : 'idle',
      url: typeof d.url === 'string' ? d.url.slice(0, 4096) : null,
      title: typeof d.title === 'string' ? d.title.slice(0, 200) : '',
      pb: sanitizePlayback(d.pb),
      broadcaster: typeof d.broadcaster === 'string' ? d.broadcaster : null,
      everyoneControls: d.everyoneControls !== false,
      roomName: typeof d.roomName === 'string' ? d.roomName.slice(0, 60) : this.state.roomName,
      lastAction: sanitizeActivity(d.lastAction)
    };
    const act = this.state.lastAction;
    if (act && act.at !== prevAction?.at && this.phase === 'live' && prevHostKnown) this.emit('activity', act);
    this.phase = 'live';
    clearTimeout(this._joinTimer);
    if (this.hostId === this.selfId && !wasHost) {
      this._system('You’re the host now');
      this._broadcastState();
    }
    if (prevHost !== this.hostId) {
      if (this.hostId !== this.selfId && prevHost) this._system(`${this.host?.name ?? 'Someone'} is the host now`);
      this.emit('host-changed', { wasHost, isHost: this.isHost });
    }
    if (prevUrl !== this.state.url) this.emit('url', this.state.url);
    this.emit('change');
  }

  _on_hist(d, from) {
    if (from !== this.hostId || !Array.isArray(d.messages)) return;
    const known = new Set(this.messages.map(m => m.id));
    const incoming = d.messages.map(sanitizeMessage).filter(m => m && !known.has(m.id));
    if (!incoming.length) return;
    this.messages = [...incoming, ...this.messages].sort((a, b) => a.at - b.at).slice(-MAX_HISTORY);
    this.emit('history', this.messages);
  }

  _on_chat(d, from) {
    const m = this.members.get(from);
    const msg = sanitizeMessage({ ...d, from, name: m.name, color: m.color, kind: 'chat' });
    if (!msg || this.messages.some(x => x.id === msg.id)) return;
    this._pushMessage(msg);
  }

  _on_react(d, from) {
    if (typeof d.emoji !== 'string' || d.emoji.length > 8) return;
    const m = this.members.get(from);
    this.emit('react', { emoji: d.emoji, from, name: m.name, color: m.color });
  }

  _on_status(d, from) {
    const m = this.members.get(from);
    m.status = { sync: typeof d.sync === 'string' ? d.sync.slice(0, 24) : null, drift: finite(d.drift) ? d.drift : null, follow: d.follow !== false, conn: typeof d.conn === 'string' ? d.conn.slice(0, 12) : m.status?.conn };
    this.emit('members');
  }

  _on_typing(d, from) { this.emit('typing', from); }

  _on_ctl(d, from) {
    if (!this.isHost) return;
    if (!this.state.everyoneControls) return;
    const action = sanitizeControl(d);
    if (action) this.emit('control', action, this.members.get(from));
  }

  _on_bye(d, from) { this.peerLeft(from); }

  // ---- host election ----
  _becomeHost(claimAt, reason) {
    clearTimeout(this._joinTimer);
    const wasHost = this.isHost;
    this.hostId = this.selfId;
    this.claimAt = claimAt;
    this.phase = 'live';
    const rest = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt).map(m => m.id);
    this.order = [this.selfId, ...this.order.filter(id => id !== this.selfId && this.members.has(id)), ...rest]
      .filter((id, i, arr) => arr.indexOf(id) === i);
    if (reason === 'alone') this._system('Nobody’s here yet. You’re the host.');
    this._broadcastState();
    if (!wasHost) this.emit('host-changed', { wasHost, isHost: true });
    this.emit('change');
  }

  _electAfter(leftId) {
    const present = id => id === this.selfId || this.members.has(id);
    const next = this.order.find(id => id !== leftId && present(id))
      ?? [this.selfId, ...this.members.keys()].sort()[0];
    if (next === this.selfId) {
      this._system('The host left. You’re the host now.');
      this._becomeHost(this.claimAt === Infinity ? this.now() : this.claimAt);
    } else {
      this.hostId = next; // provisional, so we accept their state when it arrives
      this.emit('host-changed', { wasHost: false, isHost: false });
    }
  }

  // ---- outgoing ----
  _snapshot() {
    return { hostId: this.hostId, claimAt: this.claimAt, order: this.order, ...this.state };
  }

  _broadcastState(target) {
    if (!this.isHost || this.closed) return;
    this.transport.send('state', this._snapshot(), target);
  }

  _sendHistory(target) {
    const messages = this.messages.filter(m => m.kind === 'chat').slice(-100);
    if (messages.length) this.transport.send('hist', { messages }, target);
  }

  _pushMessage(msg) {
    this.messages.push(msg);
    if (this.messages.length > MAX_HISTORY) this.messages.splice(0, this.messages.length - MAX_HISTORY);
    this.emit('message', msg);
  }

  _system(text) {
    this._pushMessage({ id: `sys-${this.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: 'system', text, at: this.now() });
  }

  // ---- public API (anyone) ----
  chat(text) {
    text = String(text ?? '').trim().slice(0, MAX_TEXT);
    if (!text) return null;
    const msg = { id: `${this.selfId.slice(0, 6)}-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, text, at: this.now() };
    this.transport.send('chat', msg);
    const local = { ...msg, from: this.selfId, name: this.self.name, color: this.self.color, kind: 'chat' };
    this._pushMessage(local);
    return local;
  }

  react(emoji) {
    this.transport.send('react', { emoji });
    this.emit('react', { emoji, from: this.selfId, name: this.self.name, color: this.self.color });
  }

  typing() { this.transport.send('typing', {}); }

  setStatus(status) { this.transport.send('status', status); }

  setProfile({ name, color }) {
    this.self.name = cleanName(name ?? this.self.name);
    this.self.color = cleanColor(color ?? this.self.color);
    this.transport.send('profile', { name: this.self.name, color: this.self.color });
    this.emit('members');
  }

  /** Ask the host to play/pause/seek/navigate. Returns false if not allowed. */
  control(action) {
    action = sanitizeControl(action);
    if (!action) return false;
    if (this.isHost) { this.emit('control', action, this.self); return true; }
    if (!this.state.everyoneControls || !this.hostId) return false;
    this.transport.send('ctl', action, this.hostId);
    return true;
  }

  requestClock(timeoutMs = 3000) {
    if (!this.hostId || this.isHost) return Promise.resolve(null);
    return this.transport.request('clock', {}, this.hostId, timeoutMs);
  }

  // ---- public API (host only) ----
  setPlayback(pb, activity) {
    if (!this.isHost) return;
    this.state.pb = sanitizePlayback(pb);
    if (activity) {
      this.state.lastAction = sanitizeActivity({ ...activity, at: this.now() });
      if (this.state.lastAction) this.emit('activity', this.state.lastAction);
    }
    this._broadcastState();
  }

  note(text) { this._system(String(text).slice(0, 200)); }

  navigate(url, title = '') {
    if (!this.isHost) return;
    const changed = url !== this.state.url;
    this.state.url = url || null;
    this.state.title = String(title || '').slice(0, 200);
    if (this.state.mode === 'idle' && url) this.state.mode = 'browse';
    if (changed) this.state.pb = null;
    this._broadcastState();
    if (changed) this.emit('url', this.state.url);
    this.emit('change');
  }

  setTitle(title) {
    if (!this.isHost || title === this.state.title) return;
    this.state.title = String(title || '').slice(0, 200);
    this._broadcastState();
    this.emit('change');
  }

  setBroadcasting(on) {
    if (!this.isHost) return;
    this.state.mode = on ? 'broadcast' : (this.state.url ? 'browse' : 'idle');
    this.state.broadcaster = on ? this.selfId : null;
    this._system(on ? 'You started broadcasting' : 'You stopped broadcasting');
    this._broadcastState();
    this.emit('change');
  }

  setEveryoneControls(on) {
    if (!this.isHost) return;
    this.state.everyoneControls = !!on;
    this._broadcastState();
    this.emit('change');
  }

  setRoomName(name) {
    if (!this.isHost) return;
    this.state.roomName = String(name || '').slice(0, 60);
    this._broadcastState();
    this.emit('change');
  }

  transferHost(id) {
    if (!this.isHost || !this.members.has(id)) return false;
    if (this.state.broadcaster === this.selfId) { this.state.mode = this.state.url ? 'browse' : 'idle'; this.state.broadcaster = null; }
    this.order = [id, ...this.order.filter(x => x !== id)];
    this.hostId = id;
    this.transport.send('state', this._snapshot());
    this._system(`${this.members.get(id).name} is the host now`);
    this.emit('host-changed', { wasHost: true, isHost: false });
    this.emit('change');
    return true;
  }

  leave() {
    if (this.closed) return;
    try { this.transport.send('bye', {}); } catch {}
    this.closed = true;
    clearTimeout(this._joinTimer);
  }
}

function sanitizeMessage(m) {
  if (!isObj(m) || typeof m.id !== 'string' || typeof m.text !== 'string') return null;
  const text = m.text.trim().slice(0, MAX_TEXT);
  if (!text) return null;
  return {
    id: m.id.slice(0, 64), kind: 'chat', text,
    at: finite(m.at) ? m.at : Date.now(),
    from: typeof m.from === 'string' ? m.from : null,
    name: cleanName(m.name), color: cleanColor(m.color)
  };
}

function sanitizeActivity(a) {
  if (!isObj(a) || !finite(a.at) || typeof a.action !== 'string') return null;
  if (!['play', 'pause', 'seek', 'navigate', 'rate', 'go-live'].includes(a.action)) return null;
  return { action: a.action, by: cleanName(a.by), t: finite(a.t) ? a.t : null, at: a.at, title: typeof a.title === 'string' ? a.title.slice(0, 120) : null };
}

function sanitizeControl(a) {
  if (!isObj(a)) return null;
  switch (a.action) {
    case 'play': case 'pause': return { action: a.action, t: finite(a.t) ? Math.max(0, a.t) : undefined };
    case 'seek': return finite(a.t) ? { action: 'seek', t: Math.max(0, a.t) } : null;
    case 'rate': return finite(a.rate) && a.rate > 0 && a.rate <= 4 ? { action: 'rate', rate: a.rate } : null;
    case 'navigate': return typeof a.url === 'string' && /^(https?|sideby-media):/i.test(a.url) ? { action: 'navigate', url: a.url.slice(0, 4096) } : null;
    case 'go-live': return { action: 'go-live' };
    default: return null;
  }
}

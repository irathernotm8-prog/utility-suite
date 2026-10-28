// Bench — every desk: their records (desks.json), the live objects that run them, and a running log of what
// happened on each (who did what: Claude, you or Bench), which the window shows as it happens.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Collection, newId, safeRemove } = require('./store');
const { SandboxDesk } = require('./sandbox-desk');
const { ScreenDesk } = require('./screen-desk');
const { WinSandboxDesk } = require('./winsandbox');

const KINDS = {
  sandbox: { label: 'Sandbox', sub: 'Apps run on this computer, each with its own data' },
  'mac-vm': { label: 'Mac VM', sub: 'A clean macOS desktop in a virtual machine' },
  'linux-vm': { label: 'Linux VM', sub: 'Ubuntu in a virtual machine' },
  'windows-sandbox': { label: 'Windows Sandbox', sub: 'A fresh Windows desktop every time' },
  vnc: { label: 'Another computer', sub: 'Any screen you can reach by VNC, plus SSH for commands' },
};
const COLORS = ['pink', 'violet', 'sky', 'mint', 'amber', 'rose', 'slate'];

class DeskManager extends EventEmitter {
  constructor({ dataDir, ctx, tart, winsb }) {
    super();
    this.dataDir = dataDir; this.ctx = ctx; this.tart = tart; this.winsb = winsb;
    this.recs = new Collection(path.join(dataDir, 'desks.json'));
    this.live = new Map(); this.activityLog = new Map(); this.progress = new Map();
    fs.mkdirSync(path.join(dataDir, 'desks'), { recursive: true });
  }
  dirOf(id) { return path.join(this.dataDir, 'desks', id); }
  ensureDefault() {
    if (!this.recs.all().length) this.create({ name: 'Sandbox', kind: 'sandbox', color: 'pink', hidden: true, notes: 'Your everyday test desk: apps run here with their own data, out of sight.' });
  }
  /** Finds a desk by id or name; with nothing given, the default desk (the first sandbox). */
  find(idOrName) {
    const all = this.recs.all();
    if (!idOrName) return all.find((r) => r.id === this.ctx.defaultDesk()) || all.find((r) => r.kind === 'sandbox') || all[0] || null;
    const s = String(idOrName).toLowerCase();
    return all.find((r) => r.id === idOrName) || all.find((r) => r.name.toLowerCase() === s) || all.find((r) => r.name.toLowerCase().includes(s)) || null;
  }
  need(idOrName) { const r = this.find(idOrName); if (!r) throw new Error(idOrName ? `No desk “${idOrName}”. Desks: ${this.recs.all().map((d) => d.name).join(', ')}` : 'There are no desks yet'); return r; }

  rt(idOrName) {
    const rec = this.need(idOrName);
    let d = this.live.get(rec.id);
    if (d) { d.rec = rec; return d; }
    const dir = this.dirOf(rec.id); fs.mkdirSync(dir, { recursive: true });
    if (rec.kind === 'sandbox') d = new SandboxDesk(rec, { ...this.ctx, dir });
    else if (rec.kind === 'mac-vm' || rec.kind === 'linux-vm') d = new ScreenDesk(rec, { engine: this.tart, dir });
    else if (rec.kind === 'windows-sandbox') d = new WinSandboxDesk(rec, { engine: this.winsb, dir, agentSource: this.ctx.agentSource });
    else if (rec.kind === 'vnc') d = new ScreenDesk(rec, { engine: null, dir });
    else throw new Error(`Unknown desk kind ${rec.kind}`);
    d.on('state', (s) => { this.emit('desk-state', { id: rec.id, ...s }); this.emit('changed'); });
    d.on('changed', () => this.emit('sessions', { id: rec.id }));
    d.on('log', (e) => this.emit('log', { desk: rec.id, session: null, entry: e }));
    d.on('session-log', ({ session, entry }) => this.emit('log', { desk: rec.id, session, entry }));
    d.on('dialog', ({ session, dialog }) => { this.record(rec.id, { who: 'Bench', action: 'dialog', text: `${dialog.kind === 'open' ? 'Open' : dialog.kind === 'save' ? 'Save' : 'Message'} dialog${dialog.message ? `: “${dialog.message.slice(0, 80)}”` : ''}${dialog.pending ? ' — waiting for an answer' : ''}`, session }); this.emit('dialog', { desk: rec.id, session, dialog }); });
    d.on('frame', () => this.emit('frame', { id: rec.id }));
    this.live.set(rec.id, d);
    return d;
  }
  liveIf(id) { return this.live.get(id) || null; }

  list() {
    return this.recs.all().map((r) => {
      const d = this.live.get(r.id); const sum = d ? d.summary() : null;
      const state = r.kind === 'sandbox' ? 'ready' : sum ? sum.state : (r.preparing ? 'preparing' : 'stopped');
      return { ...r, state, detail: (sum && sum.detail) || (this.progress.get(r.id) || {}).label || '', progress: this.progress.get(r.id) || null, live: sum, sessions: d && d.sessions ? d.sessions() : [], kindLabel: KINDS[r.kind] ? KINDS[r.kind].label : r.kind };
    });
  }

  create(o) {
    const kind = o.kind || 'sandbox';
    if (!KINDS[kind]) throw new Error(`Desk kinds: ${Object.keys(KINDS).join(', ')}`);
    const used = this.recs.all().map((r) => r.color);
    const rec = {
      id: newId('d'), name: String(o.name || KINDS[kind].label).trim().slice(0, 60) || KINDS[kind].label, kind,
      color: o.color || COLORS.find((c) => !used.includes(c)) || COLORS[this.recs.all().length % COLORS.length],
      created: Date.now(), hidden: o.hidden !== false, notes: o.notes || '',
    };
    if (kind === 'mac-vm' || kind === 'linux-vm' || kind === 'windows-sandbox') rec.vm = { image: o.image || (kind === 'linux-vm' ? 'ubuntu' : kind === 'mac-vm' ? this.tart.defaultImage() : 'windows'), cpu: o.cpu || null, memoryGB: o.memoryGB || null, display: o.display || (kind === 'mac-vm' ? '1440x900' : null), network: o.network || 'on' };
    if (kind === 'vnc') rec.remote = { host: o.host || '127.0.0.1', vncPort: +o.vncPort || 5900, vncPassword: o.vncPassword || '', sshUser: o.sshUser || '', sshPassword: o.sshPassword || '', sshPort: +o.sshPort || 22, os: o.os || 'unknown' };
    if (kind === 'mac-vm' || kind === 'linux-vm') { const s = this.tart.supported(); if (!s.ok) throw new Error(s.why); }
    if (kind === 'windows-sandbox') { const s = this.winsb.status(); if (!s.supported) throw new Error(s.why); }
    this.recs.add(rec); this.recs.items.sort((a, b) => a.created - b.created); this.recs.save();
    fs.mkdirSync(this.dirOf(rec.id), { recursive: true });
    this.record(rec.id, { who: 'Bench', action: 'create', text: `Desk created (${KINDS[kind].label})` });
    this.emit('changed');
    if (kind === 'mac-vm' || kind === 'linux-vm') this.prepare(rec.id).catch(() => {});
    return rec;
  }
  /** Gets a VM desk's copy ready (downloads the system the first time). */
  async prepare(id) {
    const rec = this.need(id);
    if (!this.tart.bin()) { this._progress(rec.id, { label: 'Downloading Tart (the VM engine)', pct: null }); await this.tart.install((p) => this._progress(rec.id, p)); }
    this.recs.update(rec.id, { preparing: true }); this.emit('changed');
    try { await this.tart.create(rec, (p) => this._progress(rec.id, p)); this.recs.update(rec.id, { preparing: false, prepared: Date.now(), error: null }); this.record(rec.id, { who: 'Bench', action: 'ready', text: 'Virtual machine ready' }); }
    catch (e) { this.recs.update(rec.id, { preparing: false, error: e.message }); this.record(rec.id, { who: 'Bench', action: 'error', text: `Couldn’t set up the VM: ${e.message}`, ok: false }); throw e; }
    finally { this.progress.delete(rec.id); this.emit('changed'); }
  }
  _progress(id, p) { this.progress.set(id, p); this.emit('desk-state', { id, state: 'preparing', detail: p.label, progress: p }); }
  update(id, patch) {
    const rec = this.need(id); const allowed = {};
    for (const k of ['name', 'color', 'hidden', 'notes']) if (patch[k] !== undefined) allowed[k] = patch[k];
    if (patch.vm && rec.vm) allowed.vm = { ...rec.vm, ...patch.vm };
    if (patch.remote && rec.remote) allowed.remote = { ...rec.remote, ...patch.remote };
    const r = this.recs.update(rec.id, allowed);
    const d = this.live.get(rec.id); if (d) d.rec = r;
    if (patch.hidden !== undefined && d && d.sessions) for (const s of d.sessionsMap.values()) if (s.running && s.controlled) s.setHidden(!!patch.hidden).catch(() => {});
    this.emit('changed'); return r;
  }
  async remove(id) {
    const rec = this.need(id); const d = this.live.get(rec.id);
    if (d) { try { await d.stop(); } catch {} this.live.delete(rec.id); }
    if (rec.kind === 'mac-vm' || rec.kind === 'linux-vm') await this.tart.remove(rec).catch(() => {});
    try { safeRemove(this.dirOf(rec.id), [path.join(this.dataDir, 'desks')]); } catch {}
    this.recs.remove(rec.id); this.activityLog.delete(rec.id); this.emit('changed');
    return true;
  }
  async start(id, opts) { const d = this.rt(id); await d.start({ progress: (p) => this.emit('desk-state', { id: d.rec.id, state: 'starting', detail: p.label, progress: p }), ...(opts || {}) }); this.record(d.rec.id, { who: 'Bench', action: 'start', text: 'Desk started' }); return d.summary(); }
  async stop(id) { const d = this.rt(id); await d.stop(); this.record(d.rec.id, { who: 'Bench', action: 'stop', text: d.rec.kind === 'sandbox' ? 'Closed everything on the desk' : 'Desk stopped' }); return d.summary(); }
  async reset(id) { const d = this.rt(id); await d.reset(); this.record(d.rec.id, { who: 'Bench', action: 'reset', text: 'Desk reset to clean' }); return d.summary(); }
  async saveClean(id) { const rec = this.need(id); if (rec.kind !== 'mac-vm' && rec.kind !== 'linux-vm') throw new Error('Only VM desks have a clean copy to save'); const name = await this.tart.saveClean(rec); this.recs.update(rec.id, { vm: { ...rec.vm, resetFrom: name, cleanSaved: Date.now() } }); this.record(rec.id, { who: 'Bench', action: 'save', text: 'Saved this state as the clean copy Reset goes back to' }); this.emit('changed'); return true; }
  /** Starts a stopped VM / screen desk on demand (Claude doesn't have to remember to). */
  async ready(id) { const d = this.rt(id); if (d.rec.kind !== 'sandbox' && d.state !== 'running') await this.start(d.rec.id); return d; }

  record(id, e) {
    const list = this.activityLog.get(id) || []; const entry = { id: newId('a'), t: Date.now(), who: 'Bench', ok: true, ...e, desk: id };
    list.push(entry); if (list.length > 400) list.splice(0, list.length - 400); this.activityLog.set(id, list);
    this.emit('activity', entry); return entry;
  }
  activity(id, { limit = 200 } = {}) { const r = this.find(id); return r ? (this.activityLog.get(r.id) || []).slice(-limit) : []; }
  async stopAll() { await Promise.all([...this.live.values()].map((d) => d.stop().catch(() => {}))); }
}

module.exports = { DeskManager, KINDS, COLORS };

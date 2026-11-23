'use strict';
// Concourse — one account's live copy of Teams: chats, calendar, teams, To Do and presence, refreshed on a schedule
// that's gentle on Microsoft's throttling (and faster while the window is in front). Emits 'change' with the part
// that changed, 'error' with a friendly message, and 'new-messages' when a chat gets something new from someone else.
const { EventEmitter } = require('events');
const M = require('./core/model');

const SEC = 1000;
const EVERY = { chats: 20 * SEC, chatsFocused: 8 * SEC, calendar: 3 * 60 * SEC, todo: 2 * 60 * SEC, presence: 90 * SEC, me: 60 * SEC };

class AccountSync extends EventEmitter {
  /** @param {{ account:object, graph:object, focused:()=>boolean, calendarRange?:()=>[number,number] }} o */
  constructor(o) {
    super();
    this.account = o.account; this.g = o.graph; this.focused = o.focused || (() => false);
    this.range = o.calendarRange || (() => [M.addDays(M.startOfDay(Date.now()), -7), M.addDays(M.startOfDay(Date.now()), 28)]);
    this.s = { me: null, presence: null, chats: [], events: [], teams: null, todoLists: [], todo: [], people: {}, errors: {}, loaded: {} };
    this.timers = {}; this.lastSeen = new Map(); this.stopped = false; this.inflight = {};
  }

  start() {
    this.stopped = false;
    const loop = (key, fn, every) => {
      const run = async () => {
        if (this.stopped) return;
        await this.run(key, fn);
        if (this.stopped) return;
        this.timers[key] = setTimeout(run, typeof every === 'function' ? every() : every);
      };
      run();
    };
    loop('me', () => this.loadMe(), EVERY.me);
    loop('chats', () => this.loadChats(), () => (this.focused() ? EVERY.chatsFocused : EVERY.chats));
    loop('calendar', () => this.loadCalendar(), EVERY.calendar);
    loop('todo', () => this.loadTodo(), EVERY.todo);
    loop('presence', () => this.loadPresence(), EVERY.presence);
  }
  stop() { this.stopped = true; for (const t of Object.values(this.timers)) clearTimeout(t); this.timers = {}; }

  /** Runs one loader, remembering errors per part so the UI can say what's wrong without failing the rest. */
  async run(key, fn) {
    if (this.inflight[key]) return this.inflight[key];
    const p = (async () => {
      try { await fn(); if (this.s.errors[key]) { delete this.s.errors[key]; this.emit('change', 'errors'); } }
      catch (e) {
        const msg = friendly(e, key);
        if (this.s.errors[key] !== msg) { this.s.errors[key] = msg; this.emit('change', 'errors'); }
        this.emit('error', key, e);
      } finally { delete this.inflight[key]; }
    })();
    this.inflight[key] = p; return p;
  }
  refresh(key) {
    const map = { me: () => this.loadMe(), chats: () => this.loadChats(), calendar: () => this.loadCalendar(), todo: () => this.loadTodo(), presence: () => this.loadPresence(), teams: () => this.loadTeams() };
    if (key) return this.run(key, map[key]);
    return Promise.all(Object.entries(map).filter(([k]) => k !== 'teams' || this.s.teams).map(([k, f]) => this.run(k, f)));
  }

  async loadMe() {
    if (!this.s.me) { this.s.me = await this.g.me(); this.emit('change', 'me'); }
    try { const p = await this.g.myPresence(); if (JSON.stringify(p) !== JSON.stringify(this.s.presence)) { this.s.presence = p; this.emit('change', 'presence'); } }
    catch (_) { /* presence is optional */ }
  }

  async loadChats() {
    if (!this.s.me) await this.loadMe();
    const chats = (await this.g.chats()).filter(c => !(c.viewpoint && c.viewpoint.isHidden)).map(c => ({ ...c, accountId: this.account.id }));
    const meId = this.s.me.id;
    const fresh = [];
    for (const c of chats) {
      const p = c.lastMessagePreview; if (!p) continue;
      const prev = this.lastSeen.get(c.id);
      if (this.s.loaded.chats && prev !== p.id && M.chatUnread(c, meId)) fresh.push(M.arrival(c, meId));
      this.lastSeen.set(c.id, p.id);
    }
    const changed = JSON.stringify(chats.map(c => [c.id, c.lastMessagePreview && c.lastMessagePreview.id, c.viewpoint && c.viewpoint.lastMessageReadDateTime, c.topic, (c.members || []).length]))
      !== JSON.stringify(this.s.chats.map(c => [c.id, c.lastMessagePreview && c.lastMessagePreview.id, c.viewpoint && c.viewpoint.lastMessageReadDateTime, c.topic, (c.members || []).length]));
    const first = !this.s.loaded.chats;
    this.s.chats = chats; this.s.loaded.chats = true;
    if (first) this.run('presence', () => this.loadPresence());
    if (changed) this.emit('change', 'chats');
    if (fresh.length) this.emit('new-messages', fresh);
  }

  async loadCalendar() {
    const [a, b] = this.range();
    const evs = (await this.g.calendarView(a, b)).map(e => ({ ...e, accountId: this.account.id }));
    const sig = (l) => JSON.stringify(l.map(e => [e.id, e.subject, e.start, e.end, e.isCancelled, e.responseStatus && e.responseStatus.response]));
    const changed = sig(evs) !== sig(this.s.events);
    this.s.events = evs; this.s.loaded.calendar = true;
    if (changed) this.emit('change', 'calendar');
  }

  async loadTodo() {
    const lists = await this.g.todoLists();
    const all = [];
    for (const l of lists) {
      for (const t of await this.g.todoTasks(l.id)) all.push(M.fromTodo(t, l.id, this.account.id));
    }
    const changed = JSON.stringify(all) !== JSON.stringify(this.s.todo) || JSON.stringify(lists) !== JSON.stringify(this.s.todoLists);
    this.s.todoLists = lists.map(l => ({ id: l.id, name: l.displayName, default: l.wellknownListName === 'defaultList' }));
    this.s.todo = all; this.s.loaded.todo = true;
    if (changed) this.emit('change', 'todo');
  }

  async loadPresence() {
    if (!this.s.me) return;
    const ids = new Set();
    for (const c of this.s.chats.slice(0, 40)) for (const m of c.members || []) if (m.userId && m.userId !== this.s.me.id) ids.add(m.userId);
    if (!ids.size) return;
    const list = await this.g.presences([...ids]);
    const map = {}; for (const p of list) map[p.id] = p.availability;
    if (JSON.stringify(map) !== JSON.stringify(this.s.people)) { this.s.people = map; this.emit('change', 'people'); }
  }

  async loadTeams() {
    const teams = await this.g.teams();
    const out = [];
    for (const t of teams) {
      let channels = [];
      try { channels = await this.g.channels(t.id); } catch (_) { channels = []; }
      out.push({ id: t.id, name: t.displayName, description: t.description || '', channels: channels.map(c => ({ id: c.id, name: c.displayName, type: c.membershipType || 'standard' })) });
    }
    this.s.teams = out; this.emit('change', 'teams');
  }
}

function friendly(e, key) {
  const what = { me: 'your profile', chats: 'chats', calendar: 'the calendar', todo: 'To Do tasks', presence: 'presence', teams: 'teams' }[key] || key;
  if (!e) return `Couldn’t load ${what}.`;
  if (e.status === 0 || e.code === 'offline') return 'Offline — showing what was last loaded.';
  if (e.status === 401) return 'Signed out by Microsoft. Sign in again in Settings › Accounts.';
  if (e.status === 403) return `Your organisation doesn’t let Concourse read ${what}. An admin can approve it (Settings › Accounts › Admin consent link).`;
  if (e.code === 'needsSignIn') return e.message;
  return `Couldn’t load ${what}: ${e.message}`;
}

module.exports = { AccountSync, friendly, EVERY };

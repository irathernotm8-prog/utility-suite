// Atoll — the Touchline plugin: one live match on the island. Follow a team (Atoll finds its match each day and
// shows the next one in between) or pin one match from today's list. Notices goals, kick-off and full-time.
'use strict';
const { EventEmitter } = require('events');

/** Compact match for the island from a Touchline match (detail) and, if known, its row from the day list. */
function shape(m, row = null) {
  if (!m) return null;
  const side = (s, r) => ({ id: s?.id ?? r?.id ?? null, name: s?.name || r?.name || '', short: r?.short || abbreviate(s?.name || r?.name), score: s?.score ?? r?.score ?? null, logo: s?.logo || r?.logo || null, color: s?.color || null, red: r?.red || 0 });
  const events = (m.events || []).filter((e) => ['goal', 'red', 'secondYellow', 'missedPen', 'period', 'yellow', 'var'].includes(e.kind));
  return {
    id: m.id ?? row?.id,
    league: m.league ? { name: m.league.name, round: m.league.round, logo: m.league.logo } : row ? { name: row.leagueName || '', logo: null } : null,
    state: m.state, label: m.label, detail: m.detail, minute: m.minute ?? null, kickoff: m.kickoff || row?.kickoff || null,
    home: side(m.home, row?.home), away: side(m.away, row?.away),
    penalties: m.penalties || null, aggregate: m.aggregate || row?.aggregate || null,
    events: events.map((e) => ({ kind: e.kind, minute: e.minute, added: e.added, home: e.home, player: e.player?.name || '', assist: e.assist?.name || '', penalty: !!e.penalty, ownGoal: !!e.ownGoal, score: e.score || null, label: e.label || '' })).slice(-24),
    venue: m.venue?.name || null
  };
}

/** "Manchester United" -> "MUN", "Real Madrid" -> "RMA", "Arsenal" -> "ARS". */
function abbreviate(name = '') {
  const w = String(name).replace(/\b(FC|CF|AFC|SC|AC|CD|SD|FK|SK)\b/g, '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  if (w.length === 1) return w[0].slice(0, 3).toUpperCase();
  return (w[0].slice(0, 1) + w[w.length - 1].slice(0, 2)).toUpperCase();
}

/** The latest goal in a match's events (for "who scored"). */
function lastGoal(m) { const g = (m?.events || []).filter((e) => e.kind === 'goal'); return g[g.length - 1] || null; }

// The competitions most people look for first (FotMob ids); everything else follows in FotMob's own order.
const POPULAR = [42, 47, 87, 54, 55, 53, 73, 10216, 130, 77, 50, 44, 76, 132, 133, 48, 57, 61, 268, 230, 9134, 112, 71, 64];
const pop = (l) => { const i = POPULAR.indexOf(l.primaryId ?? l.id); return i < 0 ? 999 : i; };

/** Rows for the picker: big competitions first, live matches first inside each, trimmed to what the list shows. */
function pickerRows(day, { limit = 70 } = {}) {
  const rank = { live: 0, pre: 1, post: 2, off: 3 };
  return (day?.leagues || []).map((l, i) => ({ l, i })).sort((a, b) => pop(a.l) - pop(b.l) || (a.l.rank ?? 9999) - (b.l.rank ?? 9999) || a.i - b.i).map((x) => x.l).slice(0, limit).map((l) => ({
    id: l.id, primaryId: l.primaryId, name: l.name, logo: l.logo, ccode: l.ccode,
    matches: l.matches.slice().sort((a, b) => rank[a.state] - rank[b.state] || String(a.kickoff).localeCompare(String(b.kickoff))).map((m) => ({
      id: m.id, state: m.state, label: m.label, kickoff: m.kickoff, leagueName: l.name,
      home: { id: m.home.id, name: m.home.name, short: m.home.short, score: m.home.score, logo: m.home.logo, red: m.home.red },
      away: { id: m.away.id, name: m.away.name, short: m.away.short, score: m.away.score, logo: m.away.logo, red: m.away.red }
    }))
  }));
}

class MatchWatch extends EventEmitter {
  constructor({ data, getFollow, setFollow }) {
    super();
    this.data = data; this.getFollow = getFollow; this.setFollow = setFollow;
    this.cur = null; this.next = null; this.error = null; this.loading = false;
    this.prev = null; this.timer = null; this.stopped = true; this.row = null; this.lastDay = null;
  }
  start() { this.stopped = false; this.loop(0); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  refresh() { this.loop(0); }
  loop(ms) { clearTimeout(this.timer); if (this.stopped) return; this.timer = setTimeout(async () => { const wait = await this.tick(); this.loop(wait); }, ms); }

  async tick() {
    const f = this.getFollow();
    if (!f || !f.mode) { this.cur = null; this.next = null; this.emit('change'); return 10 * 60e3; }
    this.loading = !this.cur; if (this.loading) this.emit('change');
    try {
      let id = null, row = null;
      if (f.mode === 'team') {
        const day = await this.data.day(null);
        this.lastDay = day;
        for (const l of day.leagues || []) for (const m of l.matches) if (m.home.id === f.team.id || m.away.id === f.team.id) { id = m.id; row = { ...m, leagueName: l.name }; }
        if (!id) {
          this.cur = null; this.row = null;
          try {
            const t = await this.data.team(f.team.id);
            const n = t.next;
            this.next = n ? { kickoff: n.kickoff, league: n.league, state: n.state, home: { ...n.home, short: abbreviate(n.home.name) }, away: { ...n.away, short: abbreviate(n.away.name) }, id: n.id } : null;
            if (n && n.state === 'live') { id = n.id; row = null; }
          } catch (_) { this.next = null; }
          if (!id) { this.error = null; this.loading = false; this.emit('change'); return 20 * 60e3; }
        }
      } else id = f.matchId, row = f.row || null;
      this.next = null;
      const m = await this.data.match(id);
      const s = shape(m, row);
      this.notice(s, m);
      this.cur = s; this.row = row; this.error = m._meta?.stale ? m._meta.error : null;
      this.loading = false; this.emit('change');
      if (s.state === 'live') return 20e3;
      if (s.state === 'pre') { const t = Date.parse(s.kickoff) - Date.now(); return t < 15 * 60e3 ? 30e3 : t < 2 * 3600e3 ? 2 * 60e3 : 15 * 60e3; }
      return 15 * 60e3;
    } catch (err) {
      this.error = String(err.message || err); this.loading = false; this.emit('change');
      return 60e3;
    }
  }

  /** Compare with the last look: goals (either side, including disallowed-then-restored), kick-off, full-time. */
  notice(s, raw) {
    const p = this.prev; this.prev = s;
    if (!p || p.id !== s.id) return;
    if (p.state === 'pre' && s.state === 'live') this.emit('moment', { kind: 'kickoff', match: s });
    if (p.state === 'live' && s.state === 'post') this.emit('moment', { kind: 'fulltime', match: s });
    for (const side of ['home', 'away']) {
      const a = Number(p[side].score) || 0, b = Number(s[side].score) || 0;
      if (b > a) {
        const g = lastGoal(raw);
        this.emit('moment', { kind: 'goal', side, match: s, scorer: g?.player?.name || '', minute: g?.minute ?? s.minute, penalty: !!g?.penalty, ownGoal: !!g?.ownGoal });
      }
    }
  }

  async list(date) { const d = await this.data.day(date || null); return { date: d.date, rows: pickerRows(d), backup: d._meta?.backup || null }; }
  async search(q) { return this.data.searchTeams(q); }
  followTeam(team) { this.setFollow({ mode: 'team', team: { id: team.id, name: team.name, logo: team.logo || null } }); this.cur = null; this.refresh(); }
  followMatch(row) { this.setFollow({ mode: 'match', matchId: row.id, row, pickedOn: this.data.today() }); this.cur = null; this.refresh(); }
  clear() { this.setFollow(null); this.cur = null; this.next = null; this.prev = null; this.emit('change'); }
  snapshot() { return { follow: this.getFollow(), cur: this.cur, next: this.next, error: this.error, loading: this.loading }; }
}

module.exports = { MatchWatch, shape, abbreviate, pickerRows, lastGoal };

// Waypoint — the plain logic behind trips: days, times, timeline layout, clashes and free time,
// booking → timeline sync, and budget totals. Loaded by the main process (require) and by the
// window (<script>), so it must stay free of Node and DOM calls.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────── dates and times (dates are 'YYYY-MM-DD', times 'HH:MM', always in the destination's time)
  const pad = (n) => String(n).padStart(2, '0');
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  function toMin(t) { if (!t) return null; const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? Math.min(24 * 60, +m[1] * 60 + +m[2]) : null; }
  function fromMin(m) { m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m))); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
  function snap(m, step = 15) { return Math.round(m / step) * step; }
  function dateObj(d) { const [y, mo, da] = d.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, da)); }
  function dateStr(o) { return `${o.getUTCFullYear()}-${pad(o.getUTCMonth() + 1)}-${pad(o.getUTCDate())}`; }
  function addDays(d, n) { const o = dateObj(d); o.setUTCDate(o.getUTCDate() + n); return dateStr(o); }
  function daysBetween(a, b) { return Math.round((dateObj(b) - dateObj(a)) / 864e5); }
  function dayList(start, end) {
    if (!isDate(start)) return [];
    if (!isDate(end) || end < start) end = start;
    const out = []; for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function todayStr(now = new Date()) { return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; }
  // today and the time of day where the trip is (falls back to this computer's clock)
  function localNow(tz, now = new Date()) {
    if (tz) {
      try {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
        return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
      } catch {}
    }
    return { date: todayStr(now), min: now.getHours() * 60 + now.getMinutes() };
  }
  // hours between this computer and the destination (positive: they're ahead)
  function tzOffsetHours(tz, now = new Date()) {
    if (!tz) return 0;
    try {
      const there = localNow(tz, now), here = { date: todayStr(now), min: now.getHours() * 60 + now.getMinutes() };
      return Math.round(((daysBetween(here.date, there.date) * 1440) + there.min - here.min) / 15) / 4;
    } catch { return 0; }
  }
  // where the trip stands: before (days to go), during (day n of N) or after
  function phase(trip, now = new Date()) {
    const days = dayList(trip.start, trip.end);
    if (!days.length) return { kind: 'undated' };
    const today = localNow(trip.tz, now).date;
    if (today < days[0]) return { kind: 'before', days: daysBetween(today, days[0]), total: days.length };
    if (today > days[days.length - 1]) return { kind: 'after', days: daysBetween(days[days.length - 1], today), total: days.length };
    return { kind: 'during', day: days.indexOf(today) + 1, total: days.length, today };
  }

  // ───────── kinds of plan
  const TYPES = {
    flight: { label: 'Flight', icon: 'plane', tint: 'a-sky' },
    train: { label: 'Train', icon: 'train', tint: 'a-indigo' },
    transit: { label: 'Getting around', icon: 'car', tint: 'a-slate' },
    stay: { label: 'Stay', icon: 'bed', tint: 'a-violet' },
    food: { label: 'Food & drink', icon: 'food', tint: 'a-coral' },
    activity: { label: 'Activity', icon: 'ticket', tint: 'a-gold' },
    sight: { label: 'Sightseeing', icon: 'camera', tint: 'a-teal' },
    rest: { label: 'Free time', icon: 'sun', tint: 'a-lime' },
    note: { label: 'Note', icon: 'note', tint: 'a-rose' },
  };
  const BOOKING_TYPES = {
    flight: { label: 'Flight', icon: 'plane', item: 'flight' },
    stay: { label: 'Stay', icon: 'bed', item: 'stay' },
    car: { label: 'Car hire', icon: 'car', item: 'transit' },
    train: { label: 'Train / bus / ferry', icon: 'train', item: 'train' },
    ticket: { label: 'Tickets', icon: 'ticket', item: 'activity' },
    tour: { label: 'Tour', icon: 'flag', item: 'activity' },
    food: { label: 'Restaurant', icon: 'food', item: 'food' },
    other: { label: 'Other', icon: 'bookmark', item: 'note' },
  };
  const CATEGORIES = {
    flights: { label: 'Flights', tint: 'a-sky' },
    stay: { label: 'Stays', tint: 'a-violet' },
    transport: { label: 'Getting around', tint: 'a-slate' },
    food: { label: 'Food & drink', tint: 'a-coral' },
    activities: { label: 'Activities', tint: 'a-gold' },
    shopping: { label: 'Shopping', tint: 'a-rose' },
    other: { label: 'Other', tint: 'a-teal' },
  };
  const BOOKING_CATEGORY = { flight: 'flights', stay: 'stay', car: 'transport', train: 'transport', ticket: 'activities', tour: 'activities', food: 'food', other: 'other' };

  // ───────── one day on the timeline
  function itemsOn(trip, day) {
    return (trip.items || []).filter(i => i.day === day).sort(byTime);
  }
  function byTime(a, b) {
    const sa = toMin(a.start), sb = toMin(b.start);
    if (sa == null && sb == null) return String(a.title).localeCompare(String(b.title));
    if (sa == null) return 1; if (sb == null) return -1;
    return sa - sb || (toMin(a.end) || 0) - (toMin(b.end) || 0);
  }
  // an item's span in minutes; no end → a short 30-minute mark, an end before the start runs to midnight
  function span(it) {
    const s = toMin(it.start); if (s == null) return null;
    let e = toMin(it.end);
    if (e == null) e = s + 30; else if (e <= s) e = 24 * 60;
    return { s, e: Math.min(24 * 60, e) };
  }
  // side-by-side columns for overlapping plans (like a calendar): each timed item gets col and cols
  function layout(items) {
    const timed = items.filter(i => span(i)).map(i => ({ it: i, ...span(i) })).sort((a, b) => a.s - b.s || b.e - a.e);
    const out = new Map();
    let group = [], groupEnd = -1;
    const flush = () => {
      const cols = [];
      for (const g of group) {
        let c = cols.findIndex(end => end <= g.s);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = g.e; g.col = c;
      }
      for (const g of group) out.set(g.it.id, { s: g.s, e: g.e, col: g.col, cols: cols.length });
      group = []; groupEnd = -1;
    };
    for (const t of timed) {
      if (group.length && t.s >= groupEnd) flush();
      group.push(t); groupEnd = Math.max(groupEnd, t.e);
    }
    if (group.length) flush();
    return out;
  }
  // pairs of plans that overlap (notes and free time never clash)
  function clashes(items) {
    const t = items.filter(i => span(i) && i.end && !['note', 'rest'].includes(i.type)).map(i => ({ id: i.id, ...span(i) })).sort((a, b) => a.s - b.s);
    const out = [];
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length && t[j].s < t[i].e; j++) out.push([t[i].id, t[j].id]);
    return out;
  }
  // free stretches between plans, inside the waking window
  function gaps(items, { from = 8 * 60, to = 22 * 60, min = 60 } = {}) {
    const t = items.filter(i => span(i) && !['note', 'rest'].includes(i.type)).map(span).sort((a, b) => a.s - b.s);
    const out = []; let cur = from;
    for (const x of t) {
      if (x.s - cur >= min && x.s > cur) out.push({ s: cur, e: Math.min(x.s, to) });
      cur = Math.max(cur, x.e);
      if (cur >= to) break;
    }
    if (to - cur >= min) out.push({ s: cur, e: to });
    return out.filter(g => g.e - g.s >= min);
  }
  // the hours a day's grid should show: 7:00–23:00 at least, stretched to fit what's planned
  function window_(items) {
    let lo = 7 * 60, hi = 23 * 60;
    for (const i of items) { const sp = span(i); if (sp) { lo = Math.min(lo, Math.floor(sp.s / 60) * 60); hi = Math.max(hi, Math.ceil(sp.e / 60) * 60); } }
    return { lo: Math.max(0, lo), hi: Math.min(24 * 60, hi) };
  }
  // the next thing coming up (during a trip) or the first plan (before it)
  function nextUp(trip, now = new Date()) {
    const ln = localNow(trip.tz, now);
    const all = (trip.items || []).filter(i => i.day && i.type !== 'note').slice().sort((a, b) => a.day.localeCompare(b.day) || byTime(a, b));
    return all.find(i => i.day > ln.date || (i.day === ln.date && (toMin(i.end || i.start) ?? 1440) >= ln.min)) || null;
  }

  // ───────── bookings put themselves on the timeline
  // Each booking with a date owns its timeline items (item.bookingId + item.part). Re-syncing updates
  // them in place (keeping anything you moved by hand if you said so) and removes ones it no longer needs.
  function bookingParts(b) {
    const T = BOOKING_TYPES[b.type] || BOOKING_TYPES.other;
    const parts = [];
    if (!isDate(b.startDate)) return parts;
    const where = b.type === 'flight' || b.type === 'train' ? [b.from, b.to].filter(Boolean).join(' → ') : b.address || '';
    if (b.type === 'stay') {
      parts.push({ part: 'in', day: b.startDate, start: b.startTime || '15:00', end: '', title: `Check in · ${b.title || 'Stay'}`, type: 'stay', place: b.address || '' });
      if (isDate(b.endDate) && b.endDate > b.startDate) parts.push({ part: 'out', day: b.endDate, start: b.endTime || '11:00', end: '', title: `Check out · ${b.title || 'Stay'}`, type: 'stay', place: b.address || '' });
    } else if (b.type === 'car') {
      parts.push({ part: 'pick', day: b.startDate, start: b.startTime || '', end: '', title: `Pick up · ${b.title || 'Car'}`, type: 'transit', place: b.from || b.address || '' });
      if (isDate(b.endDate)) parts.push({ part: 'drop', day: b.endDate, start: b.endTime || '', end: '', title: `Drop off · ${b.title || 'Car'}`, type: 'transit', place: b.to || b.from || b.address || '' });
    } else {
      const sameDay = !isDate(b.endDate) || b.endDate === b.startDate;
      parts.push({ part: 'main', day: b.startDate, start: b.startTime || '', end: sameDay ? (b.endTime || '') : '23:59', title: b.title || T.label, type: T.item, place: where });
      if (!sameDay && (b.type === 'flight' || b.type === 'train')) parts.push({ part: 'arrive', day: b.endDate, start: '00:00', end: b.endTime || '', title: `Arrive · ${b.to || b.title || ''}`.trim(), type: T.item, place: b.to || '' });
    }
    return parts;
  }
  function syncBooking(trip, b, newId) {
    trip.items = trip.items || [];
    const mine = trip.items.filter(i => i.bookingId === b.id);
    const want = b.onTimeline === false ? [] : bookingParts(b);
    const keep = new Set();
    for (const p of want) {
      let it = mine.find(i => i.part === p.part);
      if (!it) { it = { id: newId(), bookingId: b.id, notes: '' }; trip.items.push(it); }
      Object.assign(it, p, { ref: b.ref || '' });
      keep.add(it.id);
    }
    trip.items = trip.items.filter(i => i.bookingId !== b.id || keep.has(i.id));
    return trip;
  }
  function unlinkBooking(trip, id) { trip.items = (trip.items || []).filter(i => i.bookingId !== id); return trip; }

  // ───────── money
  // rates: { EUR: 1.08 } means 1 EUR = 1.08 of the trip's home currency
  function toHome(amount, cur, trip) {
    const a = Number(amount) || 0;
    const home = trip.currency || 'USD';
    if (!cur || cur === home) return { v: a, ok: true };
    const r = Number((trip.rates || {})[cur]);
    return r > 0 ? { v: a * r, ok: true } : { v: 0, ok: false };
  }
  function budget(trip) {
    const cats = {}; for (const k of Object.keys(CATEGORIES)) cats[k] = { plan: Number(((trip.budget || {}).categories || {})[k]) || 0, booked: 0, spent: 0 };
    const missing = new Set();
    const byDay = {};
    for (const b of trip.bookings || []) {
      if (!(Number(b.cost) > 0)) continue;
      const c = toHome(b.cost, b.currency, trip); if (!c.ok) { missing.add(b.currency); continue; }
      cats[BOOKING_CATEGORY[b.type] || 'other'].booked += c.v;
    }
    const people = {};
    for (const e of trip.expenses || []) {
      const c = toHome(e.amount, e.currency, trip); if (!c.ok) { missing.add(e.currency); continue; }
      const k = cats[e.category] ? e.category : 'other';
      cats[k].spent += c.v;
      if (e.date) byDay[e.date] = (byDay[e.date] || 0) + c.v;
      if (e.paidBy) people[e.paidBy] = (people[e.paidBy] || 0) + c.v;
    }
    const sum = (f) => Object.values(cats).reduce((a, c) => a + c[f], 0);
    const planned = Number((trip.budget || {}).total) || sum('plan');
    const booked = sum('booked'), spent = sum('spent');
    // who owes whom, if more than one person went
    const travelers = (trip.travelers || []).filter(Boolean);
    let settle = [];
    if (travelers.length > 1) {
      const paidTotal = travelers.reduce((a, p) => a + (people[p] || 0), 0);
      const share = paidTotal / travelers.length;
      const bal = travelers.map(p => ({ p, v: (people[p] || 0) - share }));
      const pos = bal.filter(x => x.v > 0.005).sort((a, b) => b.v - a.v), neg = bal.filter(x => x.v < -0.005).sort((a, b) => a.v - b.v);
      let i = 0, j = 0;
      while (i < pos.length && j < neg.length) {
        const amt = Math.min(pos[i].v, -neg[j].v);
        settle.push({ from: neg[j].p, to: pos[i].p, amount: Math.round(amt * 100) / 100 });
        pos[i].v -= amt; neg[j].v += amt;
        if (pos[i].v < 0.005) i++; if (neg[j].v > -0.005) j++;
      }
    }
    return { cats, planned, booked, spent, used: booked + spent, left: planned - booked - spent, byDay, people, settle, missing: [...missing].filter(Boolean) };
  }

  // ───────── small checks the overview shows
  function checks(trip) {
    const out = [];
    for (const b of trip.bookings || []) {
      if (!b.ref && ['flight', 'stay', 'car', 'train'].includes(b.type)) out.push({ kind: 'ref', id: b.id, text: `${b.title || 'A booking'} has no confirmation number` });
      if (!(b.docs || []).length && ['flight', 'train', 'ticket'].includes(b.type)) out.push({ kind: 'doc', id: b.id, text: `No ticket or boarding pass saved for ${b.title || 'a booking'}` });
    }
    const days = dayList(trip.start, trip.end);
    const stays = (trip.bookings || []).filter(b => b.type === 'stay' && isDate(b.startDate));
    const nights = days.slice(0, -1).filter(d => !stays.some(s => d >= s.startDate && d < (s.endDate || addDays(s.startDate, 1))));
    if (stays.length && nights.length) out.push({ kind: 'stay', text: `${nights.length} night${nights.length > 1 ? 's' : ''} without a stay booked`, days: nights });
    for (const d of days) { const c = clashes(itemsOn(trip, d)); if (c.length) out.push({ kind: 'clash', day: d, text: `Plans overlap on ${d}` }); }
    const tags = new Set((trip.docs || []).map(d => d.tag));
    if (trip.abroad !== false && !tags.has('passport')) out.push({ kind: 'passport', text: 'No passport copy saved yet' });
    return out;
  }

  return { pad, isDate, isTime, toMin, fromMin, snap, addDays, daysBetween, dayList, todayStr, localNow, tzOffsetHours, phase,
    TYPES, BOOKING_TYPES, CATEGORIES, BOOKING_CATEGORY, itemsOn, byTime, span, layout, clashes, gaps, window: window_, nextUp,
    bookingParts, syncBooking, unlinkBooking, toHome, budget, checks };
});

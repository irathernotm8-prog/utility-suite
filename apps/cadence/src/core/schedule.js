// Cadence — schedules: when does a trigger fire next, and how to say it in words.
'use strict';
const { DAYS, pad } = require('./dates');

function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '09:00').trim());
  if (!m) return { h: 9, m: 0 };
  return { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) };
}
const at = (d, { h, m }) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const lastDayOfMonth = (y, mo) => new Date(y, mo + 1, 0).getDate();

// Next time after `after` (exclusive) that the schedule fires, or null.
function nextRun(trigger, after = new Date()) {
  if (!trigger || trigger.type !== 'schedule') return null;
  const t = parseTime(trigger.time);
  const every = trigger.every || 'day';
  const a = new Date(after.getTime() + 1000);
  if (every === 'minutes' || every === 'hours') {
    const stepMin = Math.max(1, Number(trigger.interval) || 1) * (every === 'hours' ? 60 : 1);
    const base = new Date(a); base.setHours(0, every === 'hours' ? t.m : 0, 0, 0);
    if (base > a) base.setDate(base.getDate() - 1);
    const since = Math.floor((a - base) / 6e4);
    const k = Math.ceil(since / stepMin);
    let n = new Date(base.getTime() + k * stepMin * 6e4);
    if (n <= after) n = new Date(n.getTime() + stepMin * 6e4);
    const days = Array.isArray(trigger.days) && trigger.days.length ? trigger.days : null;
    for (let i = 0; days && !days.includes(n.getDay()) && i < 4000; i++) { n = new Date(n); n.setDate(n.getDate() + 1); n.setHours(0, every === 'hours' ? t.m : 0, 0, 0); }
    return n;
  }
  if (every === 'day') {
    const days = Array.isArray(trigger.days) && trigger.days.length ? trigger.days : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 8; i++) { const d = at(new Date(a.getFullYear(), a.getMonth(), a.getDate() + i), t); if (d > after && days.includes(d.getDay())) return d; }
    return null;
  }
  if (every === 'week') {
    const days = Array.isArray(trigger.days) && trigger.days.length ? trigger.days : [1];
    const weeks = Math.max(1, Number(trigger.interval) || 1);
    for (let i = 0; i < 7 * weeks + 8; i++) {
      const d = at(new Date(a.getFullYear(), a.getMonth(), a.getDate() + i), t);
      if (d > after && days.includes(d.getDay())) {
        if (weeks > 1 && trigger.anchor) { // every N weeks counted from the anchor date's week
          const anc = new Date(trigger.anchor); const diff = Math.floor((startWeek(d) - startWeek(anc)) / (7 * 864e5));
          if (((diff % weeks) + weeks) % weeks !== 0) continue;
        }
        return d;
      }
    }
    return null;
  }
  if (every === 'month') {
    const want = trigger.dayOfMonth || 1;
    for (let i = 0; i < 14; i++) {
      const y = a.getFullYear(); const mo = a.getMonth() + i;
      const yy = new Date(y, mo, 1).getFullYear(); const mm = new Date(y, mo, 1).getMonth();
      const last = lastDayOfMonth(yy, mm);
      let day;
      if (want === 'last') day = last;
      else if (want === 'firstWeekday' || want === 'lastWeekday') {
        day = want === 'firstWeekday' ? 1 : last;
        const step = want === 'firstWeekday' ? 1 : -1;
        while ([0, 6].includes(new Date(yy, mm, day).getDay())) day += step;
      } else day = Math.min(last, Math.max(1, Number(want) || 1));
      const d = at(new Date(yy, mm, day), t);
      if (d > after) return d;
    }
    return null;
  }
  return null;
}
function startWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }

function fmtTime(t) { const { h, m } = parseTime(t); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; }
function dayList(days) {
  const d = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (d.length === 7) return 'every day';
  if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) return 'weekdays';
  if (d.length === 2 && d.includes(0) && d.includes(6)) return 'weekends';
  const names = d.map((x) => DAYS[x]);
  return names.length === 1 ? names[0] : names.slice(0, -1).map((n) => n.slice(0, 3)).join(', ') + ' and ' + names[names.length - 1].slice(0, 3);
}
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

function describe(trigger) {
  if (!trigger || trigger.type === 'manual') return 'When you run it';
  if (trigger.type === 'watch') return `When a file${trigger.pattern && trigger.pattern !== '*' ? ` matching ${trigger.pattern}` : ''} lands in ${String(trigger.folder || 'a folder').split(/[\\/]/).filter(Boolean).pop() || 'a folder'}`;
  if (trigger.type !== 'schedule') return 'Custom';
  const every = trigger.every || 'day'; const n = Math.max(1, Number(trigger.interval) || 1);
  const days = Array.isArray(trigger.days) && trigger.days.length ? trigger.days : null;
  if (every === 'minutes') return `Every ${n === 1 ? 'minute' : n + ' minutes'}${days ? ', ' + dayList(days).replace(/^every day$/, 'all week') : ''}`;
  if (every === 'hours') return `Every ${n === 1 ? 'hour' : n + ' hours'}${days ? ', ' + dayList(days) : ''}`;
  if (every === 'day') { const dl = dayList(days || [0, 1, 2, 3, 4, 5, 6]); return `${dl === 'every day' ? 'Every day' : dl === 'weekdays' ? 'Weekdays' : dl === 'weekends' ? 'Weekends' : 'Every ' + dl} at ${fmtTime(trigger.time)}`; }
  if (every === 'week') { const dl = dayList(days || [1]); if (n === 1 && (dl === 'weekdays' || dl === 'weekends')) return `${dl[0].toUpperCase() + dl.slice(1)} at ${fmtTime(trigger.time)}`; return `${n > 1 ? `Every ${n} weeks on ` : 'Every '}${dl === 'every day' ? 'every day' : dl} at ${fmtTime(trigger.time)}`; }
  if (every === 'month') {
    const w = trigger.dayOfMonth || 1;
    const dd = w === 'last' ? 'last day' : w === 'firstWeekday' ? 'first weekday' : w === 'lastWeekday' ? 'last weekday' : ord(Number(w));
    return `Monthly on the ${dd} at ${fmtTime(trigger.time)}`;
  }
  return 'Scheduled';
}

module.exports = { nextRun, describe, parseTime, fmtTime };

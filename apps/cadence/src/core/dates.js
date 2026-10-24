// Cadence — dates: week maths, formatting tokens and the date context every run gets ({{week.label}}, {{today}}…).
'use strict';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// First day of the week that contains d. weekStart: 0 = Sunday, 1 = Monday (default).
function weekStartOf(d, weekStart = 1) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  return addDays(x, -diff);
}

// ISO-8601 week number and week-year (weeks start Monday; week 1 holds the first Thursday).
function isoWeek(d) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day + 3); // Thursday of this week
  const year = x.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((x - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return { year, week };
}

// format(date, 'YYYY-MM-DD') — tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a WW W Q
function format(date, fmt = 'YYYY-MM-DD') {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '';
  const w = isoWeek(d);
  const h12 = d.getHours() % 12 || 12;
  const map = {
    YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(-2), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate(), dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()), H: d.getHours(), hh: pad(h12), h: h12, mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM', a: d.getHours() < 12 ? 'am' : 'pm', WW: pad(w.week), W: w.week, GGGG: w.year, Q: Math.floor(d.getMonth() / 3) + 1,
  };
  // [literal text] is kept as-is
  return String(fmt).replace(/\[([^\]]*)\]|YYYY|GGGG|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a|WW|W|Q/g, (m, lit) => (lit !== undefined ? lit : String(map[m])));
}

function rangeLabel(a, b) {
  // "Oct 19 – 25, 2026", "Sep 28 – Oct 4, 2026", "Dec 29, 2025 – Jan 4, 2026"
  if (a.getFullYear() !== b.getFullYear()) return `${format(a, 'MMM D, YYYY')} – ${format(b, 'MMM D, YYYY')}`;
  if (a.getMonth() !== b.getMonth()) return `${format(a, 'MMM D')} – ${format(b, 'MMM D, YYYY')}`;
  return `${format(a, 'MMM D')} – ${format(b, 'D, YYYY')}`;
}

function weekInfo(d, weekStart = 1) {
  const start = weekStartOf(d, weekStart);
  const end = addDays(start, 6);
  const iso = isoWeek(start.getDay() === 1 ? start : addDays(start, 1));
  return {
    start: format(start), end: format(end), number: iso.week, year: iso.year,
    iso: `${iso.year}-W${pad(iso.week)}`,
    label: `Week of ${format(start, 'YYYY-MM-DD')}`,
    range: rangeLabel(start, end),
    title: `Week ${iso.week} · ${rangeLabel(start, end)}`,
    _start: start, _end: end,
  };
}

// Everything a template can read about "now". weekStart from settings.
function dateContext(now = new Date(), weekStart = 1) {
  const week = weekInfo(now, weekStart);
  const last = weekInfo(addDays(now, -7), weekStart);
  const next = weekInfo(addDays(now, 7), weekStart);
  const strip = (w) => { const { _start, _end, ...rest } = w; return rest; };
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    now: now.toISOString(),
    today: format(now), yesterday: format(addDays(now, -1)), tomorrow: format(addDays(now, 1)),
    time: format(now, 'HH:mm'), stamp: format(now, 'YYYY-MM-DD HHmm'),
    year: now.getFullYear(), month: { number: now.getMonth() + 1, name: MONTHS[now.getMonth()], label: format(now, 'MMMM YYYY'), start: format(monthStart), key: format(now, 'YYYY-MM') },
    lastMonth: { number: lastMonth.getMonth() + 1, name: MONTHS[lastMonth.getMonth()], label: format(lastMonth, 'MMMM YYYY'), start: format(lastMonth), end: format(addDays(monthStart, -1)), key: format(lastMonth, 'YYYY-MM') },
    weekday: DAYS[now.getDay()],
    week: strip(week), lastWeek: strip(last), nextWeek: strip(next),
    quarter: `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`,
  };
}

// Parse "YYYY-MM-DD", ISO strings, numbers and Excel serial dates.
function parseDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') { if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4); return new Date(v); }
  const s = String(v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (s === 'now' || s === 'today') return new Date();
  return new Date(s);
}

module.exports = { format, weekInfo, weekStartOf, isoWeek, dateContext, parseDate, addDays, startOfDay, MONTHS, DAYS, pad };

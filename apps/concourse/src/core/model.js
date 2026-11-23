'use strict';
// Concourse — the board model: pure functions that turn Graph data into departures, arrivals and the manifest.
// No Electron and no network here, so test/run.js can check all of it. The renderer gets the same file through
// preload (window.concourse.model) so status words and join links are worked out in exactly one place.

const MIN = 60 * 1000;

/** Join links we recognise, best first. */
const JOIN_PATTERNS = [
  { kind: 'teams', re: /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>)]+/i },
  { kind: 'zoom', re: /https:\/\/[a-z0-9.-]*zoom\.us\/(?:j|my|w)\/[^\s"'<>)]+/i },
  { kind: 'meet', re: /https:\/\/meet\.google\.com\/[a-z0-9-]+/i },
  { kind: 'webex', re: /https:\/\/[a-z0-9.-]*webex\.com\/[^\s"'<>)]+/i },
  { kind: 'gotomeeting', re: /https:\/\/(?:global\.gotomeeting|meet\.goto)\.com\/[^\s"'<>)]+/i },
];

function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

/** The best join link for an event: Teams' own field first, then any meeting link in the location or body. */
function joinLink(ev) {
  if (!ev) return null;
  const direct = (ev.onlineMeeting && ev.onlineMeeting.joinUrl) || ev.onlineMeetingUrl;
  if (direct) return { url: direct, kind: kindOf(direct) };
  const hay = [ev.location && ev.location.displayName, ev.location && ev.location.locationUri, ev.body && ev.body.content, ev.bodyPreview]
    .filter(Boolean).map(decodeEntities).join(' \n ');
  for (const p of JOIN_PATTERNS) { const m = hay.match(p.re); if (m) return { url: m[0].replace(/[.,;]+$/, ''), kind: p.kind }; }
  return null;
}
function kindOf(url) { for (const p of JOIN_PATTERNS) if (p.re.test(url)) return p.kind; return 'link'; }

/** Graph dateTimeTimeZone (we always ask for UTC) → ms. */
function toMs(dt) {
  if (dt == null) return NaN;
  if (typeof dt === 'number') return dt;
  if (typeof dt === 'string') return Date.parse(dt);
  const s = dt.dateTime || '';
  const tz = (dt.timeZone || 'UTC').toUpperCase();
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return Date.parse(s);
  return Date.parse(tz === 'UTC' || tz === 'COORDINATED UNIVERSAL TIME' ? s + 'Z' : s);
}

/**
 * Board status for a meeting, the way a departures board says it.
 *   CANCELLED · DEPARTED (ended) · NOW BOARDING (≤ boardMin before start) · IN PROGRESS · ON TIME · TENTATIVE · DECLINED
 */
function status(ev, now = Date.now(), boardMin = 10) {
  const s = toMs(ev.start), e = toMs(ev.end);
  if (ev.isCancelled) return { code: 'cancelled', label: 'CANCELLED', tone: 'red' };
  const resp = ev.responseStatus && ev.responseStatus.response;
  if (now >= e) return { code: 'departed', label: 'DEPARTED', tone: 'dim' };
  if (ev.isAllDay) return { code: 'allday', label: 'ALL DAY', tone: 'cyan' };
  if (resp === 'declined') return { code: 'declined', label: 'DECLINED', tone: 'dim' };
  if (now >= s) return { code: 'live', label: 'IN PROGRESS', tone: 'green', mins: Math.round((e - now) / MIN) };
  const mins = Math.ceil((s - now) / MIN);
  if (mins <= boardMin) return { code: 'boarding', label: 'NOW BOARDING', tone: 'amber', blink: true, mins };
  if (resp === 'tentativelyAccepted' || resp === 'notResponded' || resp === 'none') {
    if (!ev.isOrganizer && resp === 'notResponded') return { code: 'reply', label: 'AWAITING RSVP', tone: 'cyan', mins };
    if (resp === 'tentativelyAccepted') return { code: 'tentative', label: 'TENTATIVE', tone: 'cyan', mins };
  }
  return { code: 'ontime', label: 'ON TIME', tone: 'green', mins };
}

/** Shapes a Graph event into a departure row. */
function departure(ev, now = Date.now(), opts = {}) {
  const s = toMs(ev.start), e = toMs(ev.end);
  const j = joinLink(ev);
  const attendees = (ev.attendees || []).map(a => ({
    name: (a.emailAddress && (a.emailAddress.name || a.emailAddress.address)) || '',
    email: (a.emailAddress && a.emailAddress.address) || '',
    type: a.type, response: a.status && a.status.response,
  }));
  return {
    id: ev.id, accountId: ev.accountId || opts.accountId || null,
    title: ev.subject || '(no title)',
    start: s, end: e, allDay: !!ev.isAllDay,
    organizer: (ev.organizer && ev.organizer.emailAddress && (ev.organizer.emailAddress.name || ev.organizer.emailAddress.address)) || '',
    isOrganizer: !!ev.isOrganizer,
    location: (ev.location && ev.location.displayName) || '',
    join: j, online: !!j,
    gate: gateFor(ev, j),
    attendees,
    preview: (ev.bodyPreview || '').trim(),
    webLink: ev.webLink || null,
    showAs: ev.showAs || 'busy',
    response: (ev.responseStatus && ev.responseStatus.response) || 'none',
    status: status(ev, now, opts.boardMin),
    cancelled: !!ev.isCancelled,
  };
}

/** The "gate" column: Teams / Zoom / a room name. */
function gateFor(ev, j) {
  if (j) return ({ teams: 'TEAMS', zoom: 'ZOOM', meet: 'MEET', webex: 'WEBEX', gotomeeting: 'GOTO', link: 'LINK' })[j.kind] || 'LINK';
  const loc = ev.location && ev.location.displayName;
  if (loc) return loc.toUpperCase().slice(0, 10);
  return '—';
}

function dayKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }

/** Meetings that touch a local day, sorted, all-day ones first. */
function departuresFor(events, dayMs, now = Date.now(), opts = {}) {
  const a = startOfDay(dayMs), b = addDays(a, 1);
  return events
    .filter(ev => { const s = toMs(ev.start), e = toMs(ev.end); return s < b && e > a; })
    .map(ev => departure(ev, now, opts))
    .sort((x, y) => (y.allDay - x.allDay) || (x.start - y.start) || x.title.localeCompare(y.title));
}

/** The next thing to board: in progress first (if joinable), otherwise the soonest not-cancelled, not-declined. */
function nextDeparture(events, now = Date.now(), opts = {}) {
  const rows = events.map(ev => departure(ev, now, opts)).filter(r => !r.allDay && !r.cancelled && r.response !== 'declined' && r.end > now);
  rows.sort((x, y) => x.start - y.start);
  const live = rows.find(r => r.start <= now && r.online);
  return live || rows.find(r => r.start > now) || rows[0] || null;
}

// ---------------------------------------------------------------- chats

function personName(m) { return (m && (m.displayName || m.email || m.userId)) || 'Someone'; }

/** A short title for a chat: its topic, or the other people in it. */
function chatTitle(chat, meId) {
  if (chat.topic) return chat.topic;
  const others = (chat.members || []).filter(m => m.userId !== meId);
  if (!others.length) return chat.chatType === 'oneOnOne' ? 'You' : 'Chat';
  if (others.length === 1) return personName(others[0]);
  if (others.length <= 3) return others.map(m => personName(m).split(' ')[0]).join(', ');
  return `${others.slice(0, 2).map(m => personName(m).split(' ')[0]).join(', ')} +${others.length - 2}`;
}

/** Is a chat unread for me? Teams keeps a per-user "read up to" time on the chat. */
function chatUnread(chat, meId) {
  const p = chat.lastMessagePreview;
  if (!p || p.isDeleted) return false;
  const fromMe = p.from && p.from.user && p.from.user.id === meId;
  if (fromMe) return false;
  if (p.messageType && p.messageType !== 'message') return false;
  const readAt = chat.viewpoint && chat.viewpoint.lastMessageReadDateTime;
  if (!readAt) return true;
  return Date.parse(p.createdDateTime) > Date.parse(readAt);
}

/** Plain text from Teams' message HTML (for previews, notifications and the board). */
function textOf(html) {
  let s = String(html || '');
  s = s.replace(/<attachment[^>]*>.*?<\/attachment>/gis, ' [attachment] ');
  s = s.replace(/<img[^>]*>/gi, ' [image] ');
  s = s.replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/** Shapes a chat into an arrival row. */
function arrival(chat, meId) {
  const p = chat.lastMessagePreview || {};
  const from = p.from && (p.from.user || p.from.application);
  return {
    id: chat.id, accountId: chat.accountId || null, kind: 'chat', chatType: chat.chatType,
    title: chatTitle(chat, meId),
    from: (from && from.displayName) || '',
    fromId: (p.from && p.from.user && p.from.user.id) || null,
    fromMe: !!(p.from && p.from.user && p.from.user.id === meId),
    text: p.isDeleted ? 'Message deleted' : textOf(p.body && p.body.content),
    at: Date.parse(p.createdDateTime || chat.lastUpdatedDateTime || 0) || 0,
    unread: chatUnread(chat, meId),
    members: (chat.members || []).map(m => ({ id: m.userId, name: personName(m), email: m.email })),
    meetingJoin: chat.onlineMeetingInfo && chat.onlineMeetingInfo.joinWebUrl || null,
  };
}

/** Arrivals on a day: chats whose newest message landed that day, newest first, unread first. */
function arrivalsFor(chats, dayMs, meId) {
  const a = startOfDay(dayMs), b = addDays(a, 1);
  return chats.map(c => arrival(c, meId)).filter(r => r.at >= a && r.at < b).sort((x, y) => (y.unread - x.unread) || (y.at - x.at));
}

/** Does a message mention me? */
function mentionsMe(msg, meId) { return (msg.mentions || []).some(m => m.mentioned && m.mentioned.user && m.mentioned.user.id === meId); }

/** Messages grouped into runs from the same sender within five minutes (how the thread is drawn). */
function groupRuns(msgs) {
  const out = [];
  for (const m of msgs) {
    const fromId = m.from && m.from.user ? m.from.user.id : (m.from && m.from.application ? 'app:' + m.from.application.id : 'system');
    const at = Date.parse(m.createdDateTime);
    const last = out[out.length - 1];
    if (last && last.fromId === fromId && at - last.end < 5 * MIN && m.messageType === 'message' && last.type === 'message') { last.items.push(m); last.end = at; }
    else out.push({ fromId, from: (m.from && (m.from.user || m.from.application) && (m.from.user || m.from.application).displayName) || '', type: m.messageType || 'message', start: at, end: at, items: [m] });
  }
  return out;
}

// ---------------------------------------------------------------- tasks (the manifest)

/** Task due state relative to a day: overdue · today · upcoming · someday. */
function dueState(task, now = Date.now()) {
  if (task.done) return 'done';
  if (!task.due) return 'someday';
  const today = startOfDay(now);
  const d = startOfDay(task.due);
  if (d < today) return 'overdue';
  if (d === today) return 'today';
  return 'upcoming';
}

/** Tasks for a day's manifest: due that day, plus overdue when the day is today, plus undated ones on today. */
function manifestFor(tasks, dayMs, now = Date.now()) {
  const day = startOfDay(dayMs), today = startOfDay(now);
  const rows = tasks.filter(t => {
    if (t.done) return t.doneAt && startOfDay(t.doneAt) === day;
    if (!t.due) return day === today && t.myDay;
    const d = startOfDay(t.due);
    return d === day || (day === today && d < today);
  });
  const rank = { overdue: 0, today: 1, upcoming: 2, someday: 3, done: 4 };
  return rows.sort((a, b) => (rank[dueState(a, now)] - rank[dueState(b, now)]) || ((b.important ? 1 : 0) - (a.important ? 1 : 0)) || ((a.due || 0) - (b.due || 0)));
}

/** Graph To Do task → our task. */
function fromTodo(t, listId, accountId) {
  return {
    id: 'todo:' + t.id, remoteId: t.id, listId, accountId, source: 'todo',
    title: t.title || '', notes: (t.body && t.body.content && t.body.contentType === 'text') ? t.body.content : textOf(t.body && t.body.content),
    due: t.dueDateTime ? dateOnly(t.dueDateTime.dateTime) : null,
    important: t.importance === 'high',
    done: t.status === 'completed',
    doneAt: t.completedDateTime ? toMs(t.completedDateTime) : null,
    createdAt: Date.parse(t.createdDateTime || 0) || 0,
    link: t.linkedResources && t.linkedResources[0] ? { url: t.linkedResources[0].webUrl, title: t.linkedResources[0].displayName } : null,
  };
}

/** To Do due dates are calendar days (midnight in some zone): keep the day, place it at local noon. */
function dateOnly(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : null; }

/** Our task → Graph To Do body. */
function toTodo(t) {
  const body = { title: t.title, importance: t.important ? 'high' : 'normal', status: t.done ? 'completed' : 'notStarted' };
  if (t.notes != null) body.body = { content: t.notes, contentType: 'text' };
  if (t.due) { const d = new Date(t.due); body.dueDateTime = { dateTime: `${dayKey(t.due)}T00:00:00.0000000`, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }; void d; }
  else body.dueDateTime = null;
  return body;
}

// ---------------------------------------------------------------- calendar view helpers

/** Lays meetings on a day's line: overlapping ones get separate tracks (like parallel platforms). */
function layoutTracks(rows) {
  const timed = rows.filter(r => !r.allDay).sort((a, b) => a.start - b.start || b.end - a.end);
  const tracks = [];
  for (const r of timed) {
    let t = tracks.findIndex(end => end <= r.start);
    if (t < 0) { t = tracks.length; tracks.push(0); }
    tracks[t] = r.end; r.track = t;
  }
  return { rows: timed, count: Math.max(1, tracks.length) };
}

/** Free gaps between meetings in working hours, for "find a slot". */
function freeSlots(rows, dayMs, fromHour = 8, toHour = 18, minMins = 15) {
  const a = startOfDay(dayMs) + fromHour * 60 * MIN, b = startOfDay(dayMs) + toHour * 60 * MIN;
  const busy = rows.filter(r => !r.allDay && !r.cancelled && r.response !== 'declined' && r.showAs !== 'free').map(r => [Math.max(a, r.start), Math.min(b, r.end)]).filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
  const out = []; let cur = a;
  for (const [s, e] of busy) { if (s - cur >= minMins * MIN) out.push([cur, s]); cur = Math.max(cur, e); }
  if (b - cur >= minMins * MIN) out.push([cur, b]);
  return out;
}

/** "in 12 min", "in 2 h 5 min", "now". */
function countdown(ms, now = Date.now()) {
  const d = ms - now;
  if (d <= 0) return 'now';
  const m = Math.ceil(d / MIN);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `in ${h} h ${r} min` : `in ${h} h`;
  const dd = Math.round(h / 24); return `in ${dd} day${dd === 1 ? '' : 's'}`;
}

/** Turns a Teams join URL into the other ways of opening it. */
function joinTargets(url) {
  if (!url) return {};
  const out = { browser: url };
  if (/^https:\/\/teams\.(microsoft|live)\.com\//i.test(url)) out.app = url.replace(/^https:/i, 'msteams:');
  return out;
}

module.exports = {
  joinLink, kindOf, toMs, status, departure, departuresFor, nextDeparture, dayKey, startOfDay, addDays,
  chatTitle, chatUnread, textOf, arrival, arrivalsFor, mentionsMe, groupRuns,
  dueState, manifestFor, fromTodo, toTodo, layoutTracks, freeSlots, countdown, joinTargets, decodeEntities,
};

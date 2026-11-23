'use strict';
// Concourse — a pretend Microsoft 365 for CONCOURSE_DEMO=1, the screenshots and the tests. It answers the same calls
// as Graph (src/core/graph.js) with the same JSON shapes, built around "now", so every screen has something to show
// and nothing touches the network. Changes (sent messages, RSVPs, tasks) live in memory until quit.
const crypto = require('crypto');
const { startOfDay, addDays } = require('./core/model');

const MIN = 60000, H = 60 * MIN;
const ME = { id: 'u-me', displayName: 'Bilal Ahmad', mail: 'bilal@northwind.example', userPrincipalName: 'bilal@northwind.example', jobTitle: 'Digital & Social Media Supervisor' };
const P = {
  maya: { id: 'u-maya', displayName: 'Maya Okafor', email: 'maya@northwind.example', title: 'Marketing Director' },
  dev: { id: 'u-dev', displayName: 'Dev Patel', email: 'dev@northwind.example', title: 'Network Operations' },
  lena: { id: 'u-lena', displayName: 'Lena Fischer', email: 'lena@northwind.example', title: 'Sales Lead' },
  marco: { id: 'u-marco', displayName: 'Marco Ruiz', email: 'marco@northwind.example', title: 'Designer' },
  aisha: { id: 'u-aisha', displayName: 'Aisha Rahman', email: 'aisha@northwind.example', title: 'Customer Success' },
  tom: { id: 'u-tom', displayName: 'Tom Becker', email: 'tom@agency.example', title: 'Account Manager, RP Agency' },
  jo: { id: 'u-jo', displayName: 'Jo Nguyen', email: 'jo@northwind.example', title: 'CFO' },
  sam: { id: 'u-sam', displayName: 'Sam Carter', email: 'sam@northwind.example', title: 'Field Marketing' },
};
const PRESENCE = { 'u-me': 'Available', 'u-maya': 'Busy', 'u-dev': 'Available', 'u-lena': 'Away', 'u-marco': 'Available', 'u-aisha': 'DoNotDisturb', 'u-tom': 'Offline', 'u-jo': 'BeRightBack', 'u-sam': 'Available' };

const iso = (ms) => new Date(ms).toISOString();
const dt = (ms) => ({ dateTime: iso(ms).replace('Z', ''), timeZone: 'UTC' });
const id = () => crypto.randomBytes(6).toString('hex');
const member = (p) => ({ userId: p.id, displayName: p.displayName, email: p.email || p.mail, roles: ['owner'] });
const userFrom = (p) => ({ user: { id: p.id, displayName: p.displayName, userIdentityType: 'aadUser' } });

function build(now = Date.now()) {
  const t0 = startOfDay(now);
  const at = (dayOff, h, m = 0) => addDays(t0, dayOff) + h * H + m * MIN;
  const join = (k) => `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${k}%40thread.v2/0?context=%7b%22Tid%22%3a%22demo%22%7d`;

  // ----- calendar: today is busy, with one meeting boarding now and one in progress
  const soon = Math.ceil((now + 6 * MIN) / (5 * MIN)) * 5 * MIN; // starts within ~10 min → NOW BOARDING
  const events = [];
  const ev = (o) => events.push({
    id: 'ev-' + id(), subject: o.title, start: dt(o.start), end: dt(o.end), isAllDay: !!o.allDay, isCancelled: !!o.cancelled,
    isOrganizer: !!o.mine, organizer: { emailAddress: o.mine ? { name: ME.displayName, address: ME.mail } : { name: (o.org || P.maya).displayName, address: (o.org || P.maya).email } },
    attendees: (o.with || []).map(p => ({ type: 'required', status: { response: o.resp && o.resp[p.id] || 'accepted' }, emailAddress: { name: p.displayName, address: p.email } })),
    location: { displayName: o.room || (o.teams === false ? '' : 'Microsoft Teams Meeting') },
    isOnlineMeeting: o.teams !== false && !o.zoom, onlineMeeting: o.teams !== false && !o.zoom ? { joinUrl: join(id()) } : null,
    onlineMeetingProvider: o.teams !== false ? 'teamsForBusiness' : 'unknown',
    bodyPreview: o.notes || '', body: { contentType: 'html', content: (o.notes || '') + (o.zoom ? ` Join Zoom: ${o.zoom}` : '') },
    responseStatus: { response: o.mine ? 'organizer' : (o.my || 'accepted') }, showAs: o.showAs || 'busy', webLink: 'https://outlook.office.com/calendar/', type: 'singleInstance',
  });
  ev({ title: 'Ops stand-up', start: at(0, 8, 30), end: at(0, 8, 45), with: [P.dev, P.maya, P.aisha], notes: 'Daily outage + install numbers.' });
  ev({ title: 'Organic ramp-up review', start: now - 25 * MIN, end: now + 20 * MIN, org: P.maya, with: [P.maya, P.lena, P.sam], notes: 'Walk through the ramp-up plan: digital ads, social, direct mail, events.' });
  ev({ title: 'MidSouth rebrand check-in', start: soon, end: soon + 30 * MIN, org: P.marco, with: [P.marco, P.maya], notes: 'Logo lockups and the door-hanger proofs.' });
  ev({ title: 'Lunch', start: at(0, 12), end: at(0, 13), mine: true, teams: false, showAs: 'oof', room: 'Out' });
  ev({ title: 'RP Agency win-back call', start: at(0, 15), end: at(0, 15, 45), org: P.tom, with: [P.tom, P.lena], my: 'notResponded', teams: false, zoom: 'https://us02web.zoom.us/j/81234567890' });
  ev({ title: 'GA4 / GTM conversion fix', start: at(0, 16, 30), end: at(0, 17), mine: true, with: [P.dev], notes: 'Infinity audit follow-ups.' });
  ev({ title: 'Weekly sign-up breakdown', start: at(0, 9, 30), end: at(0, 10), org: P.jo, with: [P.jo, P.maya], cancelled: true });
  ev({ title: 'Company holiday party planning', start: at(0, 0), end: at(1, 0), allDay: true, teams: false, showAs: 'free', org: P.aisha });
  for (let d = -3; d <= 9; d++) {
    if (d === 0) continue;
    const wd = new Date(addDays(t0, d)).getDay();
    if (wd === 0 || wd === 6) continue;
    ev({ title: 'Ops stand-up', start: at(d, 8, 30), end: at(d, 8, 45), with: [P.dev, P.maya, P.aisha] });
    if (d % 2) ev({ title: 'Content calendar sync', start: at(d, 10), end: at(d, 10, 45), org: P.sam, with: [P.sam, P.marco] });
    if (d % 3 === 1) ev({ title: 'Operations Update', start: at(d, 13), end: at(d, 14), org: P.jo, with: [P.jo, P.maya, P.dev, P.lena], my: d > 0 ? 'tentativelyAccepted' : 'accepted' });
    if (d % 4 === 2) ev({ title: '1:1 Maya / Bilal', start: at(d, 11, 30), end: at(d, 12), org: P.maya, with: [P.maya] });
    if (d === 1) ev({ title: 'Lyte website concepts pitch', start: at(d, 14, 30), end: at(d, 15, 30), mine: true, with: [P.maya, P.jo, P.marco], resp: { 'u-jo': 'tentativelyAccepted' } });
    if (d === 2) ev({ title: 'Vendor demo: door-hanger printer', start: at(d, 15), end: at(d, 15, 30), org: P.sam, with: [P.sam], my: 'notResponded', room: 'Conf B' , teams: false });
  }

  // ----- chats
  const chats = [], msgs = {};
  const chat = (o) => {
    const cid = '19:' + id() + (o.group ? '@thread.v2' : '_unq@unq.gbl.spaces');
    const list = o.lines.map(([who, minsAgo, html, extra = {}]) => ({
      id: id(), messageType: 'message', createdDateTime: iso(now - minsAgo * MIN), lastModifiedDateTime: iso(now - minsAgo * MIN),
      from: userFrom(who === 'me' ? ME : who), body: { contentType: 'html', content: html },
      mentions: extra.mention ? [{ id: 0, mentionText: ME.displayName, mentioned: { user: { id: ME.id, displayName: ME.displayName } } }] : [],
      reactions: (extra.react || []).map(([r, p]) => ({ reactionType: r, createdDateTime: iso(now), user: { user: { id: p.id, displayName: p.displayName } } })),
      attachments: extra.attachments || [], importance: extra.urgent ? 'urgent' : 'normal',
    }));
    msgs[cid] = list;
    const last = list[list.length - 1];
    chats.push({
      id: cid, topic: o.topic || null, chatType: o.group ? 'group' : 'oneOnOne', createdDateTime: iso(now - 30 * 864e5), lastUpdatedDateTime: last.createdDateTime,
      members: [member(ME), ...o.with.map(member)],
      viewpoint: { isHidden: false, lastMessageReadDateTime: o.unread ? iso(now - (o.readAgo || 600) * MIN) : iso(now) },
      lastMessagePreview: { id: last.id, createdDateTime: last.createdDateTime, isDeleted: false, messageType: 'message', body: last.body, from: last.from },
      onlineMeetingInfo: o.meeting ? { joinWebUrl: join(id()) } : null,
    });
  };
  chat({ with: [P.maya], unread: true, readAgo: 30, lines: [
    [P.maya, 180, 'Morning! Did the MidSouth door hangers go to print?'],
    ['me', 170, 'Proofs are with Marco, should be today.'],
    [P.maya, 12, 'Great. Can you pull the <b>ramp-up numbers</b> into the deck before 2?', { mention: true }],
    [P.maya, 11, 'Jo wants sign-ups by channel, not just totals.'],
  ] });
  chat({ topic: 'MidSouth Rebrand', group: true, with: [P.marco, P.maya, P.sam], unread: true, readAgo: 50, lines: [
    [P.marco, 240, 'Uploaded v3 of the lockups to the Design channel.'],
    [P.sam, 90, 'Field team asked for a Spanish version of the door hanger too.'],
    ['me', 80, 'Adding it to the list 👍', { react: [['like', P.sam]] }],
    [P.marco, 26, 'Here’s the blue we landed on <span style="color:#1e6fd9">#1E6FD9</span>. Thoughts?', { react: [['heart', P.maya]] }],
  ] });
  chat({ with: [P.dev], lines: [
    [P.dev, 60 * 20, 'GTM container is published. Purchase event fires twice on the thank-you page though.'],
    ['me', 60 * 19, 'Probably the history-change trigger. I’ll check.'],
    [P.dev, 60 * 18, '<a href="https://tagmanager.google.com">tagmanager.google.com</a> — workspace 14'],
  ] });
  chat({ with: [P.lena], unread: true, readAgo: 200, lines: [
    [P.lena, 150, 'Tom from RP is open to a call this afternoon.'],
    [P.lena, 95, 'I sent the invite. It’s on Zoom, sorry!', { urgent: true }],
  ] });
  chat({ topic: 'Organic ramp-up review', group: true, meeting: true, with: [P.maya, P.lena, P.sam], lines: [
    [P.sam, 28, 'Joining in 2'],
    [P.maya, 24, 'Deck: Organic Ramp-Up v4.pptx', { attachments: [{ id: 'a1', contentType: 'reference', name: 'Organic Ramp-Up v4.pptx', contentUrl: 'https://northwind.sharepoint.com/ramp.pptx' }] }],
  ] });
  chat({ with: [P.aisha], lines: [
    [P.aisha, 60 * 26, 'Holiday party poll is out, vote when you can 🎄'],
    ['me', 60 * 25, 'Done!'],
  ] });
  chat({ with: [P.jo], lines: [
    [P.jo, 60 * 50, 'Thanks for the weekly slides. The sign-up breakdown was exactly what I needed.'],
  ] });
  chat({ topic: 'Social squad', group: true, with: [P.sam, P.marco], lines: [
    [P.sam, 60 * 30, 'Reel from the install crew got 40k views 🔥'],
    [P.marco, 60 * 29, 'Let’s cut a 15s version for ads'],
    ['me', 60 * 28, 'On it — CapCut draft tonight'],
  ] });

  // ----- teams
  const teams = [
    { id: 't-mkt', displayName: 'Marketing', description: 'Campaigns, creative, reporting' },
    { id: 't-ops', displayName: 'Operations', description: 'Installs, outages, network' },
    { id: 't-all', displayName: 'Northwind (Everyone)', description: 'Company-wide' },
  ];
  const channels = {
    't-mkt': [{ id: '19:mkt-general@thread.tacv2', displayName: 'General' }, { id: '19:mkt-design@thread.tacv2', displayName: 'Design' }, { id: '19:mkt-paid@thread.tacv2', displayName: 'Paid Media' }],
    't-ops': [{ id: '19:ops-general@thread.tacv2', displayName: 'General' }, { id: '19:ops-outages@thread.tacv2', displayName: 'Outages' }],
    't-all': [{ id: '19:all-general@thread.tacv2', displayName: 'General' }, { id: '19:all-kudos@thread.tacv2', displayName: 'Kudos' }],
  };
  const post = (who, minsAgo, subject, html, replies = []) => ({
    id: id(), messageType: 'message', subject, createdDateTime: iso(now - minsAgo * MIN), from: userFrom(who === 'me' ? ME : who), body: { contentType: 'html', content: html }, reactions: [], mentions: [], attachments: [],
    replies: replies.map(([w, m, h]) => ({ id: id(), messageType: 'message', createdDateTime: iso(now - m * MIN), from: userFrom(w === 'me' ? ME : w), body: { contentType: 'html', content: h }, reactions: [], mentions: [], attachments: [] })),
  });
  const chanMsgs = {
    '19:mkt-general@thread.tacv2': [
      post(P.maya, 60 * 26, 'Q1 planning', 'Kicking off Q1 planning next week. Bring your top three channel bets.', [[P.sam, 60 * 25, 'Events + door-to-door for me'], ['me', 60 * 24, 'Paid social retargeting + the referral push']]),
      post(P.jo, 60 * 4, 'Budget', 'Reminder: December spend needs to be booked by the 15th.', []),
    ],
    '19:mkt-design@thread.tacv2': [post(P.marco, 240, 'MidSouth lockups v3', 'v3 attached. Horizontal and stacked, light and dark.', [[P.maya, 200, 'Stacked dark is the one']])],
    '19:mkt-paid@thread.tacv2': [post(P.lena, 60 * 30, 'Infinity audit', 'Infinity’s audit is in. Big one: duplicate conversions inflating CPA.', [['me', 60 * 29, 'Fixing the GTM trigger this week.']])],
    '19:ops-outages@thread.tacv2': [post(P.dev, 75, '⚠ Planned maintenance', 'Planned maintenance Thursday 1–3 AM, north node. ~400 subscribers.', [])],
    '19:all-kudos@thread.tacv2': [post(P.aisha, 60 * 6, 'Kudos', 'Shout-out to the install crew for 112 installs last week! 🎉', [[P.jo, 60 * 5, '👏👏']])],
  };

  // ----- To Do
  const lists = [{ id: 'l-tasks', displayName: 'Tasks', wellknownListName: 'defaultList', isOwner: true }, { id: 'l-mkt', displayName: 'Marketing', wellknownListName: 'none', isOwner: true }];
  const task = (title, dueOff, o = {}) => ({ id: id(), title, status: o.done ? 'completed' : 'notStarted', importance: o.imp ? 'high' : 'normal', createdDateTime: iso(now - 3 * 864e5),
    dueDateTime: dueOff == null ? null : { dateTime: new Date(addDays(t0, dueOff)).toISOString().slice(0, 10) + 'T00:00:00.0000000', timeZone: 'UTC' },
    completedDateTime: o.done ? { dateTime: iso(now - H).replace('Z', ''), timeZone: 'UTC' } : null, body: { content: o.notes || '', contentType: 'text' }, linkedResources: [] });
  const todos = {
    'l-tasks': [task('Pull ramp-up numbers into the deck', 0, { imp: true, notes: 'Sign-ups by channel for Jo.' }), task('Send Spanish door-hanger copy to Marco', 0), task('Book the January billboard flight', -1, { imp: true }), task('Weekly sign-up breakdown slides', 2), task('Reply to Tom (RP Agency)', 0, { done: true })],
    'l-mkt': [task('15s cut of the install crew reel', 1), task('Review Infinity audit notes', null)],
  };

  return { now, events, chats, msgs, teams, channels, chanMsgs, lists, todos };
}

/** Same calls as Graph, from memory. */
class DemoGraph {
  constructor(now) { this.d = build(now); this.me_ = ME; }
  async me() { return { ...ME }; }
  async photo() { const e = new Error('no photo'); e.status = 404; throw e; }
  async people(q) { const s = String(q).toLowerCase(); return Object.values(P).filter(p => (p.displayName + ' ' + p.email).toLowerCase().includes(s)).map(p => ({ id: p.id, name: p.displayName, email: p.email, title: p.title })); }
  async presences(ids) { return ids.map(i => ({ id: i, availability: PRESENCE[i] || 'PresenceUnknown', activity: PRESENCE[i] || 'PresenceUnknown' })); }
  async myPresence() { return { id: ME.id, availability: PRESENCE['u-me'], activity: PRESENCE['u-me'], statusMessage: this.status || null }; }
  async setPreferredPresence(_u, a) { PRESENCE['u-me'] = a || 'Available'; return null; }
  async setStatusMessage(_u, text) { this.status = text ? { message: { content: text } } : null; return null; }
  async chats() { return JSON.parse(JSON.stringify(this.d.chats)); }
  async chat(cid) { return JSON.parse(JSON.stringify(this.d.chats.find(c => c.id === cid))); }
  async messages(cid) { return JSON.parse(JSON.stringify(this.d.msgs[cid] || [])); }
  async sendMessage(cid, html) {
    const m = { id: id(), messageType: 'message', createdDateTime: iso(Date.now()), from: userFrom(ME), body: { contentType: 'html', content: html }, reactions: [], mentions: [], attachments: [] };
    (this.d.msgs[cid] = this.d.msgs[cid] || []).push(m);
    const c = this.d.chats.find(x => x.id === cid);
    if (c) { c.lastMessagePreview = { id: m.id, createdDateTime: m.createdDateTime, messageType: 'message', body: m.body, from: m.from }; c.viewpoint.lastMessageReadDateTime = m.createdDateTime; }
    // a teammate answers, so the demo feels alive
    if (c && !this._replying) {
      this._replying = true;
      setTimeout(() => {
        this._replying = false;
        const other = c.members.find(x => x.userId !== ME.id);
        const r = { id: id(), messageType: 'message', createdDateTime: iso(Date.now()), from: { user: { id: other.userId, displayName: other.displayName } }, body: { contentType: 'html', content: ['Sounds good 👍', 'Perfect, thanks!', 'On it.', 'Got it — I’ll take a look.'][Math.floor(Math.random() * 4)] }, reactions: [], mentions: [], attachments: [] };
        this.d.msgs[cid].push(r);
        c.lastMessagePreview = { id: r.id, createdDateTime: r.createdDateTime, messageType: 'message', body: r.body, from: r.from };
      }, 4000);
    }
    return m;
  }
  async editMessage(cid, mid, html) { const m = (this.d.msgs[cid] || []).find(x => x.id === mid); if (m) m.body.content = html; return null; }
  async deleteMessage(_u, cid, mid) { const m = (this.d.msgs[cid] || []).find(x => x.id === mid); if (m) { m.deletedDateTime = iso(Date.now()); m.body.content = ''; } return null; }
  async react(cid, mid, type, on) {
    const m = (this.d.msgs[cid] || []).find(x => x.id === mid); if (!m) return null;
    m.reactions = (m.reactions || []).filter(r => !(r.reactionType === type && r.user.user.id === ME.id));
    if (on) m.reactions.push({ reactionType: type, createdDateTime: iso(Date.now()), user: { user: { id: ME.id, displayName: ME.displayName } } });
    return null;
  }
  async markRead(cid) { const c = this.d.chats.find(x => x.id === cid); if (c) c.viewpoint.lastMessageReadDateTime = iso(Date.now()); return null; }
  async markUnread(cid) { const c = this.d.chats.find(x => x.id === cid); if (c) c.viewpoint.lastMessageReadDateTime = iso(Date.parse(c.lastMessagePreview.createdDateTime) - 1000); return null; }
  async createChat(_me, emails, topic) {
    const ppl = emails.map(e => Object.values(P).find(p => p.email === e) || { id: 'u-' + id(), displayName: e, email: e });
    const existing = emails.length === 1 && this.d.chats.find(c => c.chatType === 'oneOnOne' && c.members.some(m => m.email === emails[0]));
    if (existing) return existing;
    const cid = '19:' + id() + '@thread.v2';
    const c = { id: cid, topic: topic || null, chatType: emails.length > 1 ? 'group' : 'oneOnOne', members: [member(ME), ...ppl.map(member)], viewpoint: { lastMessageReadDateTime: iso(Date.now()) }, lastUpdatedDateTime: iso(Date.now()), lastMessagePreview: null };
    this.d.chats.unshift(c); this.d.msgs[cid] = [];
    return c;
  }
  async teams() { return this.d.teams; }
  async channels(t) { return this.d.channels[t] || []; }
  async channelMessages(_t, c) { return JSON.parse(JSON.stringify(this.d.chanMsgs[c] || [])); }
  async postChannel(_t, c, html, subject) { const p = { id: id(), messageType: 'message', subject: subject || '', createdDateTime: iso(Date.now()), from: userFrom(ME), body: { contentType: 'html', content: html }, replies: [], reactions: [], mentions: [], attachments: [] }; (this.d.chanMsgs[c] = this.d.chanMsgs[c] || []).push(p); return p; }
  async replyChannel(_t, c, mid, html) { const p = (this.d.chanMsgs[c] || []).find(x => x.id === mid); const r = { id: id(), messageType: 'message', createdDateTime: iso(Date.now()), from: userFrom(ME), body: { contentType: 'html', content: html }, reactions: [], mentions: [], attachments: [] }; if (p) p.replies.push(r); return r; }
  async calendarView(a, b) { return JSON.parse(JSON.stringify(this.d.events.filter(e => Date.parse(e.start.dateTime + 'Z') < b && Date.parse(e.end.dateTime + 'Z') > a))); }
  async rsvp(eid, how) { const e = this.d.events.find(x => x.id === eid); if (e) e.responseStatus.response = { accept: 'accepted', tentative: 'tentativelyAccepted', decline: 'declined' }[how]; return null; }
  async createEvent(o) {
    const e = { id: 'ev-' + id(), subject: o.title, start: dt(o.start), end: dt(o.end), isAllDay: false, isCancelled: false, isOrganizer: true, organizer: { emailAddress: { name: ME.displayName, address: ME.mail } },
      attendees: (o.attendees || []).map(a => ({ type: 'required', status: { response: 'none' }, emailAddress: { name: a.name || a.email, address: a.email } })), location: { displayName: o.location || (o.teams ? 'Microsoft Teams Meeting' : '') },
      isOnlineMeeting: !!o.teams, onlineMeeting: o.teams ? { joinUrl: `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${id()}%40thread.v2/0` } : null, bodyPreview: '', body: { content: o.body || '' }, responseStatus: { response: 'organizer' }, showAs: 'busy' };
    this.d.events.push(e); return e;
  }
  async cancelEvent(eid) { const e = this.d.events.find(x => x.id === eid); if (e) e.isCancelled = true; return null; }
  async deleteEvent(eid) { this.d.events = this.d.events.filter(x => x.id !== eid); return null; }
  async todoLists() { return this.d.lists; }
  async todoTasks(l) { return JSON.parse(JSON.stringify(this.d.todos[l] || [])); }
  async createTodo(l, b) { const t = { id: id(), createdDateTime: iso(Date.now()), status: 'notStarted', importance: 'normal', ...b, linkedResources: [] }; (this.d.todos[l] = this.d.todos[l] || []).push(t); return t; }
  async updateTodo(l, tid, b) { const t = (this.d.todos[l] || []).find(x => x.id === tid); if (t) { Object.assign(t, b); if (b.status === 'completed') t.completedDateTime = { dateTime: iso(Date.now()).replace('Z', ''), timeZone: 'UTC' }; if (b.status === 'notStarted') t.completedDateTime = null; } return t; }
  async deleteTodo(l, tid) { this.d.todos[l] = (this.d.todos[l] || []).filter(x => x.id !== tid); return null; }
}

module.exports = { DemoGraph, build, ME, PEOPLE: P };

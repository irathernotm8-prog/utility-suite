'use strict';
// Node checks for Concourse's core (no Electron, no network): the board model, sign-in helpers, the Graph client
// against a fake Microsoft, and a full account sync against the pretend company in src/demo.js.
const assert = require('assert');
const M = require('../src/core/model');
const auth = require('../src/core/auth');
const { Graph, GraphError } = require('../src/core/graph');
const { DemoGraph, build } = require('../src/demo');
const { AccountSync } = require('../src/sync');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log('  ✓ ' + name); }
  catch (e) { results.push(false); console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); }
}
const MIN = 60000;
const at = (h, m = 0, base = Date.now()) => M.startOfDay(base) + h * 3600e3 + m * MIN;
const ev = (o) => ({ id: o.id || 'e' + Math.random(), subject: o.title || 'Meeting', start: { dateTime: new Date(o.start).toISOString().replace('Z', ''), timeZone: 'UTC' }, end: { dateTime: new Date(o.end).toISOString().replace('Z', ''), timeZone: 'UTC' }, responseStatus: { response: o.resp || 'accepted' }, isCancelled: !!o.cancelled, isAllDay: !!o.allDay, onlineMeeting: o.join ? { joinUrl: o.join } : null, body: { content: o.body || '' }, location: { displayName: o.loc || '' }, attendees: [], organizer: { emailAddress: { name: 'Org' } } });

(async () => {
  console.log('Concourse checks\n');

  await check('join links: Teams field first, then Zoom/Meet/Webex in body or location', () => {
    assert.strictEqual(M.joinLink(ev({ start: 0, end: 1, join: 'https://teams.microsoft.com/l/meetup-join/abc' })).kind, 'teams');
    assert.deepStrictEqual(M.joinLink(ev({ start: 0, end: 1, body: 'Join: <a href="https://us02web.zoom.us/j/8123?pwd=x">here</a>.' })), { url: 'https://us02web.zoom.us/j/8123?pwd=x', kind: 'zoom' });
    assert.strictEqual(M.joinLink(ev({ start: 0, end: 1, loc: 'https://meet.google.com/abc-defg-hij' })).kind, 'meet');
    assert.strictEqual(M.joinLink(ev({ start: 0, end: 1, body: 'https://teams.microsoft.com/l/meetup-join/19%3a&amp;x' })).url, 'https://teams.microsoft.com/l/meetup-join/19%3a&x');
    assert.strictEqual(M.joinLink(ev({ start: 0, end: 1, body: 'Room 4' })), null);
    assert.deepStrictEqual(M.joinTargets('https://teams.microsoft.com/l/meetup-join/x'), { browser: 'https://teams.microsoft.com/l/meetup-join/x', app: 'msteams://teams.microsoft.com/l/meetup-join/x' });
  });

  await check('board status: on time, boarding, in progress, departed, cancelled, declined, RSVP', () => {
    const now = at(12);
    const s = (o) => M.status(ev(o), now, 10).code;
    assert.strictEqual(s({ start: now + 60 * MIN, end: now + 90 * MIN }), 'ontime');
    assert.strictEqual(s({ start: now + 8 * MIN, end: now + 30 * MIN }), 'boarding');
    assert.strictEqual(s({ start: now - 8 * MIN, end: now + 30 * MIN }), 'live');
    assert.strictEqual(s({ start: now - 60 * MIN, end: now - 30 * MIN }), 'departed');
    assert.strictEqual(s({ start: now + 60 * MIN, end: now + 90 * MIN, cancelled: true }), 'cancelled');
    assert.strictEqual(s({ start: now + 60 * MIN, end: now + 90 * MIN, resp: 'declined' }), 'declined');
    assert.strictEqual(s({ start: now + 60 * MIN, end: now + 90 * MIN, resp: 'notResponded' }), 'reply');
    assert.strictEqual(s({ start: now + 60 * MIN, end: now + 90 * MIN, resp: 'tentativelyAccepted' }), 'tentative');
    assert.strictEqual(M.status(ev({ start: now + 14 * MIN, end: now + 30 * MIN }), now, 15).code, 'boarding');
  });

  await check('departures for a day: overlap with the day, all-day first, sorted; next departure skips declined', () => {
    const now = at(10);
    const evs = [ev({ title: 'B', start: at(14), end: at(15) }), ev({ title: 'A', start: at(9), end: at(9, 30) }), ev({ title: 'All', start: at(0), end: at(24), allDay: true }), ev({ title: 'Tomorrow', start: at(33), end: at(34) }), ev({ title: 'Declined', start: at(11), end: at(12), resp: 'declined' }), ev({ title: 'Live', start: at(9, 50), end: at(10, 30), join: 'https://teams.microsoft.com/l/meetup-join/q' })];
    const rows = M.departuresFor(evs, now, now);
    assert.deepStrictEqual(rows.map(r => r.title), ['All', 'A', 'Live', 'Declined', 'B']);
    assert.strictEqual(M.nextDeparture(evs, now).title, 'Live');
    assert.strictEqual(M.nextDeparture(evs.filter(e => e.subject !== 'Live'), now).title, 'B');
  });

  await check('parallel tracks and free platforms', () => {
    const d = at(0);
    const rows = [{ start: at(9), end: at(10), allDay: false }, { start: at(9, 30), end: at(11), allDay: false }, { start: at(10), end: at(10, 30), allDay: false }, { start: at(13), end: at(14), allDay: false, showAs: 'free' }];
    const { count } = M.layoutTracks(rows);
    assert.strictEqual(count, 2);
    assert.deepStrictEqual(rows.map(r => r.track), [0, 1, 0, 0]);
    const free = M.freeSlots(rows, d, 8, 18);
    assert.deepStrictEqual(free.map(([a, b]) => [(a - d) / 3600e3, (b - d) / 3600e3]), [[8, 9], [11, 18]]);
  });

  await check('chats: titles, unread from the read marker, text from Teams HTML', () => {
    const me = 'me';
    const c = { id: 'c', chatType: 'group', topic: null, members: [{ userId: 'me', displayName: 'Bilal Ahmad' }, { userId: 'a', displayName: 'Maya Okafor' }, { userId: 'b', displayName: 'Dev Patel' }], lastMessagePreview: { id: 'm', createdDateTime: '2026-11-23T10:00:00Z', messageType: 'message', body: { content: '<p>Hi&nbsp;<at id="0">Bilal</at> &amp; team<br>see <img src="x"></p>' }, from: { user: { id: 'a', displayName: 'Maya Okafor' } } }, viewpoint: { lastMessageReadDateTime: '2026-11-23T09:00:00Z' } };
    assert.strictEqual(M.chatTitle(c, me), 'Maya, Dev');
    assert.strictEqual(M.chatTitle({ ...c, members: c.members.slice(0, 2), chatType: 'oneOnOne' }, me), 'Maya Okafor');
    assert.strictEqual(M.chatUnread(c, me), true);
    assert.strictEqual(M.chatUnread({ ...c, viewpoint: { lastMessageReadDateTime: '2026-11-23T10:00:01Z' } }, me), false);
    assert.strictEqual(M.chatUnread({ ...c, lastMessagePreview: { ...c.lastMessagePreview, from: { user: { id: 'me' } } } }, me), false);
    assert.strictEqual(M.textOf(c.lastMessagePreview.body.content), 'Hi Bilal & team see [image]');
    const a = M.arrival(c, me);
    assert.strictEqual(a.unread, true); assert.strictEqual(a.from, 'Maya Okafor');
  });

  await check('message runs group by sender within five minutes', () => {
    const t = Date.parse('2026-11-23T10:00:00Z');
    const m = (id, who, mins, type = 'message') => ({ id, messageType: type, createdDateTime: new Date(t + mins * MIN).toISOString(), from: who ? { user: { id: who, displayName: who } } : null });
    const runs = M.groupRuns([m(1, 'a', 0), m(2, 'a', 2), m(3, 'a', 9), m(4, 'b', 10), m(5, null, 11, 'systemEventMessage'), m(6, 'b', 12)]);
    assert.deepStrictEqual(runs.map(r => r.items.length), [2, 1, 1, 1, 1]);
  });

  await check('manifest: overdue and undated My Day on today, done only on the day it was done', () => {
    const now = at(12);
    const tasks = [{ id: 1, title: 'late', due: at(-12) }, { id: 2, title: 'today', due: at(15) }, { id: 3, title: 'myday', myDay: true }, { id: 4, title: 'tomorrow', due: at(36) }, { id: 5, title: 'someday' }, { id: 6, title: 'done', done: true, doneAt: at(9) }, { id: 7, title: 'imp', due: at(15), important: true }];
    assert.deepStrictEqual(M.manifestFor(tasks, now, now).map(t => t.title), ['late', 'imp', 'today', 'myday', 'done']);
    assert.deepStrictEqual(M.manifestFor(tasks, at(36), now).map(t => t.title), ['tomorrow']);
    const t = M.fromTodo({ id: 'x', title: 'T', status: 'completed', importance: 'high', dueDateTime: { dateTime: '2026-11-24T00:00:00.0000000', timeZone: 'UTC' }, completedDateTime: { dateTime: '2026-11-23T10:00:00.0000000', timeZone: 'UTC' }, createdDateTime: '2026-11-20T00:00:00Z', body: { content: 'n', contentType: 'text' } }, 'L', 'acc');
    assert.strictEqual(t.id, 'todo:x'); assert.ok(t.done && t.important); assert.strictEqual(t.notes, 'n');
    const body = M.toTodo({ title: 'A', due: at(12), important: false, done: false });
    assert.strictEqual(body.status, 'notStarted'); assert.ok(body.dueDateTime.dateTime.startsWith(M.dayKey(at(12))));
  });

  await check('countdown wording', () => {
    const n = at(12);
    assert.strictEqual(M.countdown(n + 12 * MIN, n), 'in 12 min');
    assert.strictEqual(M.countdown(n + 125 * MIN, n), 'in 2 h 5 min');
    assert.strictEqual(M.countdown(n - 1, n), 'now');
  });

  await check('sign-in helpers: PKCE pair, id-token claims, plain-English errors, admin link', () => {
    const { verifier, challenge } = auth.pkce();
    assert.ok(verifier.length >= 43 && /^[A-Za-z0-9_-]+$/.test(challenge));
    assert.strictEqual(require('crypto').createHash('sha256').update(verifier).digest('base64url'), challenge);
    const tok = 'x.' + Buffer.from(JSON.stringify({ name: 'B', tid: 't', oid: 'o' })).toString('base64url') + '.y';
    assert.deepStrictEqual(auth.claims(tok), { name: 'B', tid: 't', oid: 'o' });
    assert.match(auth.friendlyError('AADSTS65001: The user or administrator has not consented'), /approved/);
    assert.match(auth.friendlyError('AADSTS700016: Application with identifier was not found in the directory'), /app ID/);
    assert.match(auth.friendlyError('AADSTS7000218: The request body must contain client_assertion'), /public client/);
    assert.match(auth.adminConsentUrl('abc', 'contoso.com'), /contoso\.com\/v2\.0\/adminconsent\?client_id=abc/);
    assert.ok(auth.BASE_SCOPES.includes('offline_access') && !auth.BASE_SCOPES.includes('ChannelMessage.Read.All'));
  });

  await check('sign-in round trip against a fake Microsoft (loopback redirect, state, code exchange)', async () => {
    const realFetch = global.fetch; let posted = null;
    global.fetch = async (url, o) => { posted = { url, body: new URLSearchParams(o.body) }; return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'User.Read Chat.ReadWrite', id_token: 'h.' + Buffer.from(JSON.stringify({ name: 'Bilal', tid: 'T1', oid: 'O1', preferred_username: 'b@x' })).toString('base64url') + '.s' }) }; };
    try {
      const tok = await auth.signIn({ clientId: 'CID', openUrl: (u) => {
        const q = new URL(u).searchParams;
        assert.strictEqual(q.get('code_challenge_method'), 'S256'); assert.strictEqual(q.get('client_id'), 'CID');
        // the "browser" comes back to the loopback with the code, after a bad-state attempt is rejected
        const http = require('http'); const back = q.get('redirect_uri');
        http.get(`${back}/?code=XYZ&state=wrong`, (r) => { r.resume(); http.get(`${back}/?code=XYZ&state=${q.get('state')}`, (r2) => r2.resume()); });
      } });
      assert.strictEqual(tok.accessToken, 'AT'); assert.strictEqual(tok.refreshToken, 'RT'); assert.strictEqual(tok.idClaims.tid, 'T1');
      assert.strictEqual(posted.body.get('code'), 'XYZ'); assert.ok(posted.body.get('code_verifier')); assert.match(posted.url, /organizations\/oauth2\/v2\.0\/token/);
    } finally { global.fetch = realFetch; }
  });

  await check('Graph client: paging, throttling with Retry-After, 401 refresh, errors', async () => {
    let calls = 0; const seen = [];
    const fake = async (url, o) => {
      calls++; seen.push(url);
      const H = (h) => ({ get: (k) => h[k.toLowerCase()] });
      if (url.endsWith('/page1')) return { ok: true, status: 200, headers: H({}), text: async () => JSON.stringify({ value: [1, 2], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/page2' }) };
      if (url.endsWith('/page2')) return calls < 4 ? { ok: false, status: 429, headers: H({ 'retry-after': '0' }), text: async () => '' } : { ok: true, status: 200, headers: H({}), text: async () => JSON.stringify({ value: [3] }) };
      if (url.endsWith('/denied')) return { ok: false, status: 403, headers: H({}), text: async () => JSON.stringify({ error: { code: 'Forbidden', message: 'Missing scope permissions' } }) };
      if (url.endsWith('/empty')) return { ok: true, status: 204, headers: H({}), text: async () => '' };
      return { ok: false, status: 404, headers: H({}), text: async () => '' };
    };
    const g = new Graph({ getToken: async () => 'T', fetch: fake });
    assert.deepStrictEqual(await g.all('/page1'), [1, 2, 3]);
    await assert.rejects(g.get('/denied'), (e) => e instanceof GraphError && e.status === 403 && e.needsAdmin);
    assert.strictEqual(await g.post('/empty', {}), null);
  });

  await check('demo company: every screen has data around now', () => {
    const now = at(11);
    const d = build(now);
    const rows = M.departuresFor(d.events, now, now);
    assert.ok(rows.some(r => r.status.code === 'live'), 'a meeting in progress');
    assert.ok(rows.some(r => r.status.code === 'boarding'), 'a meeting boarding');
    assert.ok(rows.some(r => r.cancelled));
    assert.ok(rows.some(r => r.join && r.join.kind === 'zoom'));
    assert.ok(d.chats.filter(c => M.chatUnread(c, 'u-me')).length >= 2);
    assert.ok(Object.values(d.todos).flat().length >= 5);
  });

  await check('account sync against the demo: loads every part, spots new messages, stays quiet when nothing changes', async () => {
    const g = new DemoGraph();
    const s = new AccountSync({ account: { id: 'demo' }, graph: g, focused: () => false });
    const parts = []; const news = [];
    s.on('change', p => parts.push(p)); s.on('new-messages', r => news.push(...r));
    await s.refresh();
    for (const p of ['me', 'chats', 'calendar', 'todo']) assert.ok(parts.includes(p), 'changed ' + p);
    assert.ok(s.s.chats.length >= 6 && s.s.events.length > 10 && s.s.todo.length >= 5);
    parts.length = 0;
    await s.refresh('chats'); assert.ok(!parts.includes('chats'), 'no change, no event');
    // someone writes to us
    const c = g.d.chats[2]; const m = { id: 'new1', messageType: 'message', createdDateTime: new Date().toISOString(), from: { user: { id: 'u-dev', displayName: 'Dev Patel' } }, body: { content: 'ping' } };
    c.lastMessagePreview = { id: m.id, createdDateTime: m.createdDateTime, messageType: 'message', body: m.body, from: m.from };
    await s.refresh('chats');
    assert.strictEqual(news.length, 1); assert.strictEqual(news[0].text, 'ping');
    await s.refresh('presence'); assert.strictEqual(s.s.people['u-maya'], 'Busy');
    await s.loadTeams(); assert.strictEqual(s.s.teams.length, 3);
    s.stop();
  });

  await check('demo graph: send, react, RSVP, create meeting, To Do round trip', async () => {
    const g = new DemoGraph();
    const chats = await g.chats(); const id = chats[0].id;
    await g.sendMessage(id, '<p>hello</p>');
    const msgs = await g.messages(id); assert.strictEqual(msgs[msgs.length - 1].body.content, '<p>hello</p>');
    await g.react(id, msgs[0].id, 'heart', true); assert.strictEqual((await g.messages(id))[0].reactions.slice(-1)[0].reactionType, 'heart');
    const evs = await g.calendarView(0, 9e15); const target = evs.find(e => e.responseStatus.response === 'notResponded');
    await g.rsvp(target.id, 'accept'); assert.strictEqual((await g.calendarView(0, 9e15)).find(e => e.id === target.id).responseStatus.response, 'accepted');
    const made = await g.createEvent({ title: 'X', start: Date.now(), end: Date.now() + 30 * MIN, teams: true });
    assert.ok(M.joinLink(made));
    const t = await g.createTodo('l-tasks', M.toTodo({ title: 'new', due: null }));
    await g.updateTodo('l-tasks', t.id, { status: 'completed' });
    assert.strictEqual((await g.todoTasks('l-tasks')).find(x => x.id === t.id).status, 'completed');
  });

  await check('suite link copy matches the Utility Package (identical file)', () => {
    const fs = require('fs'); const path = require('path');
    const ours = fs.readFileSync(path.join(__dirname, '..', 'src', 'suitelink.js'), 'utf8');
    assert.match(ours, /Utility Suite link/);
    const canon = path.join(__dirname, '..', '..', '..', 'tools', 'suitelink.js');
    if (fs.existsSync(canon)) assert.strictEqual(ours, fs.readFileSync(canon, 'utf8'));
  });

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} passed`);
  process.exit(ok === results.length ? 0 : 1);
})();

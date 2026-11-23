'use strict';
// Concourse — Microsoft Graph client. One per account. Everything Concourse shows comes through here.
// Handles token refresh (through getToken), throttling (429/503 + Retry-After), paging and Graph's error shapes.
const BASE = 'https://graph.microsoft.com/v1.0';

class GraphError extends Error {
  constructor(status, code, message, path) { super(message); this.status = status; this.code = code; this.path = path; }
  get needsAdmin() { return this.status === 403 && /Forbidden|Authorization_RequestDenied|AccessDenied|insufficient/i.test(this.code + ' ' + this.message); }
}

class Graph {
  /** @param {{ getToken:()=>Promise<string>, fetch?:typeof fetch, base?:string }} o */
  constructor(o) { this.getToken = o.getToken; this.fetch = o.fetch || fetch; this.base = o.base || BASE; }

  async req(method, path, body, opts = {}) {
    const url = /^https?:/.test(path) ? path : this.base + path;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      const headers = { authorization: 'Bearer ' + token, ...opts.headers };
      if (body !== undefined && !(body instanceof Uint8Array)) headers['content-type'] = 'application/json';
      let res;
      try {
        res = await this.fetch(url, { method, headers, body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)) });
      } catch (e) {
        if (attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
        throw new GraphError(0, 'offline', 'Can’t reach Microsoft right now. Check the connection.', path);
      }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
        const ra = Number(res.headers.get('retry-after')) || (2 ** attempt);
        await sleep(Math.min(30, ra) * 1000); continue;
      }
      if (res.status === 401 && attempt === 0 && opts.onUnauthorized) { await opts.onUnauthorized(); continue; }
      if (res.status === 204 || res.status === 202) return null;
      if (opts.raw) {
        if (!res.ok) throw new GraphError(res.status, 'http', `HTTP ${res.status}`, path);
        return Buffer.from(await res.arrayBuffer());
      }
      const text = await res.text();
      let j = null; try { j = text ? JSON.parse(text) : null; } catch (_) { j = null; }
      if (!res.ok) {
        const e = (j && j.error) || {};
        throw new GraphError(res.status, e.code || 'http', e.message || `HTTP ${res.status}`, path);
      }
      return j;
    }
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b, o) { return this.req('POST', p, b === undefined ? {} : b, o); }
  patch(p, b, o) { return this.req('PATCH', p, b, o); }
  del(p, o) { return this.req('DELETE', p, undefined, o); }

  /** Follows @odata.nextLink up to `max` items. */
  async all(path, max = 500, o) {
    let out = [], next = path;
    while (next && out.length < max) {
      const j = await this.get(next, o);
      out = out.concat((j && j.value) || []);
      next = j && j['@odata.nextLink'];
    }
    return out.slice(0, max);
  }

  // ---------------------------------------------------------------- people
  me() { return this.get('/me?$select=id,displayName,mail,userPrincipalName,jobTitle,officeLocation'); }
  photo(userId, size = '96x96') { return this.get(`/users/${encodeURIComponent(userId)}/photos/${size}/$value`, { raw: true }); }
  async people(q) {
    const enc = encodeURIComponent(`"${String(q).replace(/"/g, '')}"`);
    const j = await this.get(`/me/people?$search=${enc}&$top=12&$select=id,displayName,scoredEmailAddresses,jobTitle,userPrincipalName`);
    return ((j && j.value) || []).map(p => ({ id: p.id, name: p.displayName, email: (p.scoredEmailAddresses && p.scoredEmailAddresses[0] && p.scoredEmailAddresses[0].address) || p.userPrincipalName, title: p.jobTitle || '' })).filter(p => p.email);
  }
  async presences(ids) {
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 650) {
      const j = await this.post('/communications/getPresencesByUserId', { ids: ids.slice(i, i + 650) });
      out.push(...((j && j.value) || []));
    }
    return out;
  }
  myPresence() { return this.get('/me/presence'); }
  /** availability: Available | Busy | DoNotDisturb | BeRightBack | Away | Offline. Uses the preferred presence (what Teams' status menu sets). */
  setPreferredPresence(userId, availability, activity, expiration) {
    if (!availability) return this.post(`/users/${userId}/presence/clearUserPreferredPresence`, {});
    const body = { availability, activity: activity || (availability === 'Offline' ? 'OffWork' : availability) };
    if (expiration) body.expirationDuration = expiration;
    return this.post(`/users/${userId}/presence/setUserPreferredPresence`, body);
  }
  setStatusMessage(userId, text, expiresAt) {
    const sm = { message: { content: text || '', contentType: 'text' } };
    if (expiresAt) sm.expiryDateTime = { dateTime: new Date(expiresAt).toISOString().replace('Z', ''), timeZone: 'UTC' };
    return this.post(`/users/${userId}/presence/setStatusMessage`, { statusMessage: sm });
  }

  // ---------------------------------------------------------------- chats
  chats(max = 80) {
    return this.all('/me/chats?$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc&$top=50', max);
  }
  async chat(id) { return this.get(`/chats/${encodeURIComponent(id)}?$expand=members,lastMessagePreview`); }
  async messages(chatId, top = 50) {
    const j = await this.get(`/chats/${encodeURIComponent(chatId)}/messages?$top=${top}&$orderby=createdDateTime desc`);
    return (((j && j.value) || []).slice().reverse());
  }
  sendMessage(chatId, html, extra = {}) {
    return this.post(`/chats/${encodeURIComponent(chatId)}/messages`, { body: { contentType: 'html', content: html }, ...extra });
  }
  editMessage(chatId, msgId, html) { return this.patch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(msgId)}`, { body: { contentType: 'html', content: html } }); }
  deleteMessage(userId, chatId, msgId) { return this.post(`/users/${userId}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(msgId)}/softDelete`, {}); }
  react(chatId, msgId, reactionType, on = true) {
    return this.post(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(msgId)}/${on ? 'setReaction' : 'unsetReaction'}`, { reactionType });
  }
  markRead(chatId, userId, tenantId) {
    return this.post(`/chats/${encodeURIComponent(chatId)}/markChatReadForUser`, { user: { id: userId, tenantId } });
  }
  markUnread(chatId, userId, tenantId, lastMessageReadDateTime) {
    return this.post(`/chats/${encodeURIComponent(chatId)}/markChatUnreadForUser`, { user: { id: userId, tenantId }, lastMessageReadDateTime });
  }
  /** Starts a chat: one email → oneOnOne, several → group (topic optional). Graph returns the existing 1:1 if there is one. */
  createChat(meId, emails, topic) {
    const bind = (id) => ({ '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${id}')` });
    const members = [bind(meId), ...emails.map(e => bind(e))];
    const body = { chatType: emails.length > 1 ? 'group' : 'oneOnOne', members };
    if (emails.length > 1 && topic) body.topic = topic;
    return this.post('/chats', body);
  }
  hostedContent(url) { return this.get(url, { raw: true }); }

  // ---------------------------------------------------------------- teams and channels
  teams() { return this.all('/me/joinedTeams?$select=id,displayName,description', 200); }
  channels(teamId) { return this.all(`/teams/${teamId}/channels?$select=id,displayName,description,membershipType,webUrl`, 200); }
  async channelMessages(teamId, channelId, top = 30) {
    const j = await this.get(`/teams/${teamId}/channels/${encodeURIComponent(channelId)}/messages?$top=${top}&$expand=replies`);
    return ((j && j.value) || []).slice().reverse();
  }
  postChannel(teamId, channelId, html, subject) {
    const b = { body: { contentType: 'html', content: html } }; if (subject) b.subject = subject;
    return this.post(`/teams/${teamId}/channels/${encodeURIComponent(channelId)}/messages`, b);
  }
  replyChannel(teamId, channelId, msgId, html) {
    return this.post(`/teams/${teamId}/channels/${encodeURIComponent(channelId)}/messages/${msgId}/replies`, { body: { contentType: 'html', content: html } });
  }

  // ---------------------------------------------------------------- calendar
  calendarView(fromMs, toMs) {
    const sel = 'id,subject,start,end,isAllDay,isCancelled,isOrganizer,organizer,attendees,location,isOnlineMeeting,onlineMeeting,onlineMeetingUrl,onlineMeetingProvider,bodyPreview,body,responseStatus,showAs,webLink,seriesMasterId,type';
    const q = `startDateTime=${new Date(fromMs).toISOString()}&endDateTime=${new Date(toMs).toISOString()}&$select=${sel}&$orderby=start/dateTime&$top=250`;
    return this.all(`/me/calendarView?${q}`, 1000, { headers: { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="html"' } });
  }
  rsvp(eventId, how, comment = '') {
    const verb = { accept: 'accept', tentative: 'tentativelyAccept', decline: 'decline' }[how];
    if (!verb) throw new Error('bad rsvp');
    return this.post(`/me/events/${encodeURIComponent(eventId)}/${verb}`, { comment, sendResponse: true });
  }
  /** Creates a meeting. teams:true makes it a Teams meeting with a join link. */
  createEvent({ title, start, end, attendees = [], teams = true, body = '', location = '' }) {
    const ev = {
      subject: title,
      start: { dateTime: new Date(start).toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: new Date(end).toISOString().replace('Z', ''), timeZone: 'UTC' },
      attendees: attendees.map(a => ({ emailAddress: { address: a.email || a, name: a.name || undefined }, type: 'required' })),
      body: { contentType: 'html', content: body || '' },
    };
    if (location) ev.location = { displayName: location };
    if (teams) { ev.isOnlineMeeting = true; ev.onlineMeetingProvider = 'teamsForBusiness'; }
    return this.post('/me/events', ev, { headers: { Prefer: 'outlook.timezone="UTC"' } });
  }
  cancelEvent(eventId, comment = '') { return this.post(`/me/events/${encodeURIComponent(eventId)}/cancel`, { comment }); }
  deleteEvent(eventId) { return this.del(`/me/events/${encodeURIComponent(eventId)}`); }

  // ---------------------------------------------------------------- To Do
  todoLists() { return this.all('/me/todo/lists?$select=id,displayName,wellknownListName,isOwner', 100); }
  todoTasks(listId) { return this.all(`/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=100&$filter=status ne 'completed' or completedDateTime/dateTime ge '${new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 19)}'`, 400); }
  createTodo(listId, body) { return this.post(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`, body); }
  updateTodo(listId, taskId, body) { return this.patch(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, body); }
  deleteTodo(listId, taskId) { return this.del(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { Graph, GraphError, BASE };

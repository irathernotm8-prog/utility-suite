// Concourse — Chats: every 1:1, group and meeting chat, with a thread you can read, react to, reply in and turn into tasks.
(() => {
  const REACT = { like: '👍', heart: '❤️', laugh: '😆', surprised: '😮', sad: '😢', angry: '😡' };
  let root, els = {}, filter = 'all', query = '', current = null, msgs = [], offMsgs = null, offErr = null, replyTo = null, editing = null, mentions = [];

  function mount(main, arg) {
    root = main; els = {};
    els.list = h('div.clist');
    const search = h('input.input', { placeholder: 'Search chats', value: query });
    search.addEventListener('input', () => { query = search.value; drawList(); });
    const seg = h('div.seg', ...['all', 'unread', 'pinned', 'meetings'].map(f => h('button' + (f === filter ? '.on' : ''), { onclick: (e) => { filter = f; $$('button', seg).forEach(b => b.classList.toggle('on', b === e.currentTarget)); drawList(); } }, f)));
    els.side = h('aside.cside', h('div.chead', h('span.title.led', 'Chats'), h('span.grow'), h('button.btn.sm.icon', { title: 'New chat (⌘N)', html: ic('plus'), onclick: () => window.newChat() })), h('div.cfil', search, seg), els.list);
    els.thread = h('section.thread');
    main.append(els.side, els.thread);
    offMsgs = C.on('messages', (p) => { if (current && p.chatId === current.chatId) { msgs = p.messages; drawMessages(true); } });
    offErr = C.on('messages-error', (p) => { if (current && p.chatId === current.chatId && els.err) els.err.textContent = p.error; });
    drawList();
    if (arg && arg.chatId) open(arg.accountId, arg.chatId);
    else if (current) open(current.accountId, current.chatId);
    else emptyThread();
  }
  function unmount() { offMsgs && offMsgs(); offErr && offErr(); C.call('closeChat').catch(() => {}); }

  function rowsFiltered() {
    let rows = D.rows();
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter(r => (r.title + ' ' + r.members.map(m => m.name).join(' ') + ' ' + r.text).toLowerCase().includes(q));
    if (filter === 'unread') rows = rows.filter(r => r.unread);
    if (filter === 'pinned') rows = rows.filter(r => r.pinned);
    if (filter === 'meetings') rows = rows.filter(r => r.chatType === 'meeting' || r.meetingJoin);
    const pins = S.state.settings.pinned;
    return rows.sort((a, b) => (b.pinned - a.pinned) || (a.pinned && b.pinned ? pins.indexOf(a.id) - pins.indexOf(b.id) : 0) || (b.at - a.at));
  }

  function drawList() {
    const list = els.list; if (!list) return; list.textContent = '';
    const rows = rowsFiltered();
    if (!rows.length) { list.append(h('div.empty', query ? 'No chats match' : filter === 'unread' ? 'All caught up' : 'No chats')); return; }
    let pinHead = false, restHead = false;
    for (const r of rows) {
      if (r.pinned && !pinHead) { pinHead = true; list.append(h('div.lh.eyebrow', 'Pinned')); }
      if (!r.pinned && pinHead && !restHead) { restHead = true; list.append(h('div.lh.eyebrow', 'Recent')); }
      const other = r.chatType === 'oneOnOne' ? (r.members.find(m => m.id !== D.meId(r.accountId)) || {}) : null;
      list.append(h('button.crow' + (r.unread ? '.unread' : '') + (current && current.chatId === r.id ? '.on' : '') + (r.muted ? '.muted' : ''), { onclick: () => open(r.accountId, r.id), oncontextmenu: (e) => { e.preventDefault(); chatMenu(e.currentTarget, r); } },
        other ? avatar(other, { accountId: r.accountId, presence: D.presence(other.id) }) : avatar({ name: r.title }, { group: true, count: r.members.length }),
        h('div.cb', h('div.ct', h('span.cn', r.title), r.meetingJoin ? h('span.tag.cyan', 'MTG') : null, h('span.cw.mono', ago(r.at))), h('div.cx', r.fromMe ? h('span.you', 'You: ') : (r.chatType !== 'oneOnOne' && r.from ? h('b', r.from.split(' ')[0] + ': ') : null), r.text || 'No messages yet')),
        r.muted ? h('span.mutei', { html: ic('belloff') }) : null,
        S.state.accounts.length > 1 ? h('span.accdot', { style: { background: (D.acc(r.accountId) || {}).color } }) : null));
    }
  }

  function chatMenu(anchor, r) {
    menu(anchor, [
      { label: r.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', run: () => run(C.call('pin', { chatId: r.id, on: !r.pinned })) },
      { label: r.muted ? 'Unmute' : 'Mute notifications', icon: r.muted ? 'bell' : 'belloff', run: () => run(C.call('mute', { chatId: r.id, on: !r.muted })) },
      r.unread ? { label: 'Mark as read', icon: 'check', run: () => run(C.call('markRead', { accountId: r.accountId, chatId: r.id })) } : { label: 'Mark as unread', icon: 'bell', run: () => run(C.call('markUnread', { accountId: r.accountId, chatId: r.id })) },
      '-',
      { label: 'Start a meeting here', icon: 'video', run: () => meetNow(r) },
      r.meetingJoin ? { label: 'Join this chat’s meeting', icon: 'train', run: () => window.joinMeeting({ id: null, join: { url: r.meetingJoin }, title: r.title, gate: 'TEAMS', accountId: r.accountId }) } : null,
    ].filter(Boolean));
  }

  function emptyThread() {
    els.thread.textContent = '';
    const t = h('span'); flap(t, 'SELECT A CHAT', { tone: 'dim' });
    els.thread.append(h('div.tempty', t, h('p', 'Pick a conversation on the left, or start a new one with ⌘N.')));
  }

  async function open(accountId, chatId) {
    const r = D.rows().find(x => x.id === chatId) || { id: chatId, accountId, title: 'Chat', members: [], chatType: 'group' };
    current = { accountId: r.accountId || accountId, chatId, row: r }; msgs = []; replyTo = null; editing = null; mentions = [];
    drawList(); drawThread();
    try { msgs = await C.call('openChat', { accountId: current.accountId, chatId }); if (current && current.chatId === chatId) drawMessages(false); }
    catch (e) { if (els.err) els.err.textContent = e.message.replace(/^Error invoking remote method 'call': (Error: )?/, ''); }
  }

  function drawThread() {
    const r = current.row; const t = els.thread; t.textContent = '';
    const meId = D.meId(current.accountId);
    const others = r.members.filter(m => m.id !== meId);
    const people = h('div.tpeople', ...others.slice(0, 8).map(m => h('span.tp', { title: m.name }, avatar(m, { size: 'sm', accountId: current.accountId, presence: D.presence(m.id) }), r.chatType === 'oneOnOne' ? h('span', presenceWord(D.presence(m.id))) : null)), others.length > 8 ? h('span.more', `+${others.length - 8}`) : null);
    const head = h('header.thead',
      h('div.tt', h('div.tn', r.title), people),
      h('div.tacts',
        r.meetingJoin ? h('button.btn.sm.lamp', { onclick: () => window.joinMeeting({ join: { url: r.meetingJoin }, title: r.title, gate: 'TEAMS', accountId: r.accountId }) }, icon('video'), 'Join meeting') : h('button.btn.sm', { title: 'Start a Teams meeting with everyone in this chat', onclick: () => meetNow(r) }, icon('video'), 'Meet now'),
        h('button.btn.sm.icon', { title: r.pinned ? 'Unpin' : 'Pin', html: ic('pin'), class: r.pinned ? 'onlamp' : '', onclick: () => run(C.call('pin', { chatId: r.id, on: !r.pinned })) }),
        h('button.btn.sm.icon', { title: 'More', html: ic('dots'), onclick: (e) => chatMenu(e.currentTarget, D.rows().find(x => x.id === r.id) || r) })));
    els.msgs = h('div.msgs');
    els.err = h('div.terr');
    els.composer = composer();
    t.append(head, els.err, els.msgs, els.composer);
    els.msgs.append(h('div.loading.led.dim', 'Loading…'));
  }
  const presenceWord = (p) => ({ Available: 'Available', AvailableIdle: 'Available', Busy: 'Busy', BusyIdle: 'Busy', DoNotDisturb: 'Do not disturb', Away: 'Away', BeRightBack: 'Be right back', Offline: 'Offline' })[p] || '';

  function drawMessages(keepScroll) {
    const box = els.msgs; if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const prevTop = box.scrollTop;
    box.textContent = '';
    const meId = D.meId(current.accountId); const meName = (D.me(current.accountId) || {}).displayName || '';
    if (!msgs.length) { box.append(h('div.empty', 'No messages yet — say hello')); return; }
    let lastDay = null;
    for (const run_ of M.groupRuns(msgs)) {
      const day = M.startOfDay(run_.start);
      if (day !== lastDay) { lastDay = day; const f = h('span'); flap(f, relDay(day) === 'Today' ? 'TODAY' : boardDate(day), { instant: true, tone: 'dim' }); box.append(h('div.dsep', f)); }
      if (run_.type !== 'message') { for (const m of run_.items) box.append(h('div.sys', systemText(m))); continue; }
      const mine = run_.fromId === meId;
      const g = h('div.run' + (mine ? '.mine' : ''));
      const other = current.row.members.find(x => x.id === run_.fromId) || { name: run_.from, id: run_.fromId };
      if (!mine) g.append(avatar(other, { accountId: current.accountId }));
      const col = h('div.rcol');
      if (!mine) col.append(h('div.rname', run_.from || 'Unknown', h('span.mono', timeLabel(run_.start))));
      for (const m of run_.items) col.append(bubble(m, mine, meName));
      if (mine) col.append(h('div.rtime.mono', timeLabel(run_.end)));
      g.append(col); box.append(g);
    }
    hydrateImages(box, current.accountId);
    if (!keepScroll || nearBottom) box.scrollTop = box.scrollHeight; else box.scrollTop = prevTop;
  }
  function systemText(m) {
    const e = m.eventDetail || {}; const t = (e['@odata.type'] || '').replace('#microsoft.graph.', '');
    const who = (x) => (x && x.user && x.user.displayName) || 'Someone';
    if (t === 'callStartedEventMessageDetail') return '📞 Meeting started';
    if (t === 'callEndedEventMessageDetail') return '📞 Meeting ended';
    if (t === 'membersAddedEventMessageDetail') return `${who(e.initiator)} added ${(e.members || []).map(x => x.displayName).filter(Boolean).join(', ') || 'someone'}`;
    if (t === 'membersDeletedEventMessageDetail') return `${who(e.initiator)} removed someone`;
    if (t === 'chatRenamedEventMessageDetail') return `${who(e.initiator)} renamed the chat to “${e.chatDisplayName}”`;
    return M.textOf(m.body && m.body.content) || '·';
  }

  function bubble(m, mine, meName) {
    const deleted = !!m.deletedDateTime;
    const urgent = m.importance === 'urgent' || m.importance === 'high';
    const b = h('div.bub' + (deleted ? '.deleted' : '') + (urgent ? '.urgent' : '') + (M.mentionsMe(m, D.meId(current.accountId)) ? '.atme' : ''));
    if (urgent && !deleted) b.append(h('div.urg.led.red', m.importance === 'urgent' ? '! URGENT' : '! IMPORTANT'));
    for (const a of m.attachments || []) if (a.contentType === 'messageReference') { let c = {}; try { c = JSON.parse(a.content); } catch (_) {} b.append(h('div.quote', h('b', (c.messageSender && c.messageSender.user && c.messageSender.user.displayName) || ''), h('span', c.messagePreview || ''))); }
    const body = h('div.btext'); body.innerHTML = deleted ? '<i>This message was deleted</i>' : safeHtml(m.body && m.body.content, { meName });
    if (m.subject) b.append(h('div.subj', m.subject));
    b.append(body);
    for (const a of m.attachments || []) {
      if (a.contentType === 'reference' || (a.contentUrl && a.contentType !== 'messageReference')) b.append(h('a.file', { href: a.contentUrl, target: '_blank' }, icon('attach'), h('span', a.name || 'Attachment')));
      else if (/card/.test(a.contentType || '')) b.append(h('div.file', icon('board'), h('span', 'Card — open in Teams to view')));
    }
    if (m.lastEditedDateTime && !deleted) b.append(h('span.edited', 'edited'));
    const reacts = groupReactions(m.reactions || []);
    if (reacts.length) b.append(h('div.reacts', ...reacts.map(r => h('button.rc' + (r.mine ? '.mine' : ''), { title: r.who.join(', '), onclick: () => react(m, r.type, !r.mine) }, h('span', REACT[r.type] || r.type), h('b', r.n)))));
    if (!deleted) {
      const tools = h('div.tools',
        ...Object.entries(REACT).map(([k, e]) => h('button.rq', { title: k, onclick: () => react(m, k, true) }, e)),
        h('button', { title: 'Reply with quote', html: ic('reply'), onclick: () => { replyTo = m; drawReply(); els.input.focus(); } }),
        h('button', { title: 'Make a task', html: ic('task'), onclick: () => window.newTask({ title: M.textOf(m.body && m.body.content).slice(0, 120), notes: `From ${(m.from && m.from.user && m.from.user.displayName) || ''} in ${current.row.title}`, link: { chatId: current.chatId, accountId: current.accountId, title: current.row.title } }) }),
        h('button', { title: 'Copy text', html: ic('copy'), onclick: () => { C.call('copy', { text: M.textOf(m.body && m.body.content) }); toast('Copied'); } }),
        mine ? h('button', { title: 'Edit', html: ic('edit'), onclick: () => startEdit(m) }) : null,
        mine ? h('button.danger', { title: 'Delete', html: ic('trash'), onclick: () => del(m) }) : null);
      b.append(tools);
    }
    return b;
  }
  function groupReactions(list) {
    const meId = D.meId(current.accountId); const map = new Map();
    for (const r of list) { const k = r.reactionType; const e = map.get(k) || { type: k, n: 0, who: [], mine: false }; e.n++; e.who.push((r.user && r.user.user && r.user.user.displayName) || ''); if (r.user && r.user.user && r.user.user.id === meId) e.mine = true; map.set(k, e); }
    return [...map.values()];
  }
  async function react(m, type, on) {
    const meId = D.meId(current.accountId);
    m.reactions = (m.reactions || []).filter(r => !(r.reactionType === type && r.user && r.user.user && r.user.user.id === meId));
    if (on) m.reactions.push({ reactionType: type, user: { user: { id: meId, displayName: 'You' } } });
    drawMessages(true);
    run(C.call('react', { accountId: current.accountId, chatId: current.chatId, messageId: m.id, reaction: type, on }));
  }
  function startEdit(m) { editing = m; els.input.value = M.textOf(m.body.content); els.input.focus(); drawReply(); autosize(); }
  async function del(m) { if (!confirm('Delete this message for everyone?')) return; await run(C.call('deleteMessage', { accountId: current.accountId, chatId: current.chatId, messageId: m.id })); }

  // ───── composer
  let urgent = false;
  function composer() {
    const input = h('textarea.cinput', { rows: 1, placeholder: 'Message…  (**bold**, *italic*, `code`, - list, @name)' });
    els.input = input;
    const pop = h('div.atpop'); els.atpop = pop;
    els.replyBar = h('div.replybar');
    const urg = h('button.btn.sm.icon', { title: 'Mark as urgent', html: ic('alert'), onclick: () => { urgent = !urgent; urg.classList.toggle('onred', urgent); } });
    const sendBtn = h('button.btn.lamp.sendb', { onclick: send }, icon('send'), 'Send');
    input.addEventListener('input', () => { autosize(); atCheck(); });
    input.addEventListener('keydown', (e) => {
      if (pop.classList.contains('on')) {
        const items = $$('button', pop); let i = items.findIndex(b => b.classList.contains('on'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((b, k) => b.classList.toggle('on', k === i)); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); (items[i] || items[0]).dispatchEvent(new MouseEvent('mousedown')); return; }
        if (e.key === 'Escape') { pop.classList.remove('on'); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      if (e.key === 'Escape' && (editing || replyTo)) { editing = null; replyTo = null; input.value = ''; drawReply(); }
      if (e.key === 'ArrowUp' && !input.value) { const mine = [...msgs].reverse().find(m => m.from && m.from.user && m.from.user.id === D.meId(current.accountId) && !m.deletedDateTime); if (mine) { e.preventDefault(); startEdit(mine); } }
    });
    return h('div.composer', els.replyBar, pop, h('div.crow2', input, urg, sendBtn), h('div.chint', 'Enter to send · Shift+Enter for a new line · ↑ to edit your last message'));
  }
  function autosize() { const i = els.input; i.style.height = 'auto'; i.style.height = Math.min(220, i.scrollHeight) + 'px'; }
  function drawReply() {
    const b = els.replyBar; b.textContent = '';
    if (editing) b.append(h('span.led', 'EDITING'), h('span', M.textOf(editing.body.content).slice(0, 80)), h('button', { html: ic('x'), onclick: () => { editing = null; els.input.value = ''; drawReply(); } }));
    else if (replyTo) b.append(h('span.led', 'REPLYING'), h('span', `${(replyTo.from && replyTo.from.user && replyTo.from.user.displayName) || ''}: ${M.textOf(replyTo.body.content).slice(0, 80)}`), h('button', { html: ic('x'), onclick: () => { replyTo = null; drawReply(); } }));
    b.classList.toggle('on', !!(editing || replyTo));
  }
  function atCheck() {
    const i = els.input; const before = i.value.slice(0, i.selectionStart);
    const m = /@([\w.-]{0,30})$/.exec(before); const pop = els.atpop;
    if (!m) { pop.classList.remove('on'); return; }
    const q = m[1].toLowerCase(); const meId = D.meId(current.accountId);
    const list = current.row.members.filter(x => x.id !== meId && x.name.toLowerCase().includes(q)).slice(0, 6);
    if (current.row.chatType !== 'oneOnOne') list.push({ id: '__everyone', name: 'Everyone' });
    pop.textContent = '';
    list.forEach((p, k) => pop.append(h('button' + (k === 0 ? '.on' : ''), { onmousedown: (e) => { e.preventDefault(); pick(p, m[0]); } }, p.id === '__everyone' ? icon('users') : avatar(p, { size: 'sm', accountId: current.accountId }), h('span', p.name))));
    pop.classList.toggle('on', list.length > 0);
  }
  function pick(p, typed) {
    const i = els.input; const pos = i.selectionStart; const start = pos - typed.length;
    if (p.id === '__everyone') { i.value = i.value.slice(0, start) + '@everyone ' + i.value.slice(pos); }
    else { i.value = i.value.slice(0, start) + '@' + p.name + ' ' + i.value.slice(pos); mentions.push(p); }
    els.atpop.classList.remove('on'); i.focus(); const np = start + p.name.length + 2; i.setSelectionRange(np, np);
  }
  async function send() {
    const text = els.input.value; if (!text.trim()) return;
    const used = mentions.filter((p, k, a) => text.includes('@' + p.name) && a.findIndex(x => x.id === p.id) === k);
    let html = compose(text, used);
    if (replyTo) html = `<blockquote><b>${esc((replyTo.from && replyTo.from.user && replyTo.from.user.displayName) || '')}</b>: ${esc(M.textOf(replyTo.body.content).slice(0, 200))}</blockquote>` + html;
    const payload = { accountId: current.accountId, chatId: current.chatId, html, importance: urgent ? 'urgent' : 'normal', mentions: used.map((p, k) => ({ id: k, mentionText: p.name, mentioned: { user: { id: p.id, displayName: p.name, userIdentityType: 'aadUser' } } })) };
    const ed = editing; els.input.value = ''; autosize(); replyTo = null; editing = null; mentions = []; drawReply();
    if (ed) { ed.body.content = html; drawMessages(true); return run(C.call('editMessage', { accountId: current.accountId, chatId: current.chatId, messageId: ed.id, html })); }
    const meId = D.meId(current.accountId);
    msgs.push({ id: 'pending', messageType: 'message', createdDateTime: new Date().toISOString(), from: { user: { id: meId, displayName: 'You' } }, body: { content: html }, importance: payload.importance, reactions: [], attachments: [], mentions: [] });
    drawMessages(false);
    try { await C.call('send', payload); } catch (e) { msgs = msgs.filter(m => m.id !== 'pending'); drawMessages(true); els.input.value = text; toast('Not sent: ' + e.message.replace(/^Error invoking remote method 'call': (Error: )?/, ''), { tone: 'red' }); }
    if (urgent) { urgent = false; $$('.composer .onred').forEach(b => b.classList.remove('onred')); }
  }

  async function meetNow(r) {
    toast('Starting a Teams meeting…');
    const res = await run(C.call('meetNow', { accountId: r.accountId, chatId: r.id }));
    if (res && S.state.demo) toast('Sample data — the meeting link was posted in the chat.');
  }

  // ───── new chat
  window.newChat = (pre = {}) => {
    if (!D.hasAccount() && !S.state.demo) return go('settings');
    const accountId = pre.accountId || D.firstAcc();
    const m = modal({ title: 'New chat' });
    const picker = peoplePicker(accountId, pre.people || []);
    const topic = h('input.input', { placeholder: 'Group name (optional)' });
    const msg = h('textarea.input', { rows: 3, placeholder: 'First message (optional)' });
    m.body.append(h('div.field', h('label', 'To'), picker.el), h('div.field', h('label', 'Group name'), topic), h('div.field', h('label', 'Message'), msg));
    m.foot.append(h('div.grow'), h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.lamp', { onclick: async () => {
      const people = picker.get(); if (!people.length) return toast('Add at least one person');
      const r = await run(C.call('newChat', { accountId, emails: people.map(p => p.email), topic: topic.value.trim(), message: msg.value.trim() }));
      m.close(); go('chats', r);
    } }, 'Start chat'));
    setTimeout(() => picker.focus(), 50);
  };

  function update(parts) {
    drawList();
    if (current && (parts.includes('chats') || parts.includes('people') || parts.includes('all'))) {
      const r = D.rows().find(x => x.id === current.chatId); if (r) current.row = r;
    }
  }
  function arg(a) { if (a && a.chatId) open(a.accountId, a.chatId); }
  function tick() { drawList(); }

  S.views.chats = { mount, unmount, update, arg, tick };
})();

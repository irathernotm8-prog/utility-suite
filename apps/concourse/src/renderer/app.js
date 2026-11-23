// Concourse — the window: state, the rail, the live ticker, the command palette and view switching.
(() => {
  const S = window.S; Object.assign(S, { state: null, view: null, day: M.startOfDay(Date.now()), current: null, chat: null });

  // ───── derived data every view uses
  const D = window.D = {
    acc: (id) => S.state.accounts.find(a => a.id === id),
    me: (accId) => (S.state.me || {})[accId] || null,
    meId: (accId) => (D.me(accId) || {}).id,
    firstAcc: () => S.state.accounts[0] && S.state.accounts[0].id,
    opts: () => ({ boardMin: S.state.settings.boardMin }),
    events: () => S.state.events || [],
    departures: (day) => M.departuresFor(D.events(), day, Date.now(), D.opts()),
    next: () => M.nextDeparture(D.events(), Date.now(), D.opts()),
    rows: () => (S.state.chats || []).map(c => { const r = M.arrival(c, D.meId(c.accountId)); r.muted = S.state.settings.muted.includes(r.id); r.pinned = S.state.settings.pinned.includes(r.id); if (r.muted) r.unread = false; return r; }),
    arrivals: (day) => { const a = M.startOfDay(day), b = M.addDays(a, 1); return D.rows().filter(r => r.at >= a && r.at < b && !r.fromMe).sort((x, y) => (y.unread - x.unread) || (y.at - x.at)); },
    unread: () => D.rows().filter(r => r.unread).length,
    tasks: () => [...(S.state.tasks || []), ...(S.state.settings.showTodo ? (S.state.todo || []) : [])],
    presence: (userId) => (S.state.people || {})[userId] || null,
    myPresence: () => { const me = D.me(D.firstAcc()); return (me && me.presence && me.presence.availability) || (S.state.demo ? 'Available' : 'PresenceUnknown'); },
    hasAccount: () => S.state.accounts.length > 0,
  };

  // ───── views
  const VIEWS = ['home', 'chats', 'teams', 'calendar', 'tasks', 'settings'];
  function go(view, arg) {
    if (!VIEWS.includes(view)) view = 'home';
    if (!D.hasAccount() && !['settings', 'home'].includes(view)) view = 'home';
    if (S.view !== view) {
      if (S.current && S.current.unmount) S.current.unmount();
      S.view = view; S.current = S.views[view];
      const main = $('#main'); main.textContent = ''; main.className = 'v-' + view;
      S.current.mount(main, arg);
    } else if (arg && S.current.arg) S.current.arg(arg);
    $$('#rail .nav').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  }
  window.go = go;

  function applySettings() {
    const st = S.state.settings;
    document.body.className = document.body.className.replace(/lamp-\w+/g, '').trim() + ' lamp-' + (st.lamp || 'amber');
    document.body.classList.toggle('win', st.platform === 'win32');
    document.body.classList.toggle('mac', st.platform === 'darwin');
    document.body.classList.toggle('demo', !!S.state.demo);
    flapAnimate(st.flaps !== false);
  }

  function onState(state, parts = ['all']) {
    const first = !S.state;
    S.state = state;
    applySettings(); rail(); ticker();
    if (first) { go(D.hasAccount() ? 'home' : 'home'); return; }
    if (S.current && S.current.update) S.current.update(parts);
  }

  // ───── rail
  function rail() {
    const unread = D.unread();
    const pc = $('#pipChats'); pc.textContent = unread ? String(unread) : ''; pc.classList.toggle('on', unread > 0);
    const now = Date.now();
    const due = D.tasks().filter(t => !t.done && t.due && M.startOfDay(t.due) <= M.startOfDay(now)).length;
    const pt = $('#pipTasks'); pt.textContent = due ? String(due) : ''; pt.classList.toggle('on', due > 0);
    const n = D.next(); const ph = $('#pipHome');
    const boarding = n && (n.status.code === 'boarding' || n.status.code === 'live');
    ph.classList.toggle('on', !!boarding); ph.classList.toggle('dotonly', true);
    const accId = D.firstAcc(); const me = D.me(accId);
    const av = $('#meAvatar'); av.textContent = '';
    if (me) { const a = avatar({ name: me.displayName, id: me.id }, { size: 'sm', accountId: accId }); av.replaceWith(a); a.id = 'meAvatar'; }
    else av.textContent = '·';
    $('#meDot').className = 'dot p-' + D.myPresence();
  }

  // ───── ticker: a scrolling line of what matters right now
  let tickerSig = '';
  function ticker() {
    const now = Date.now(); const bits = [];
    if (S.state.demo) bits.push(['SAMPLE DATA — CONNECT AN ACCOUNT IN SETTINGS', 'cyan']);
    for (const [accId, errs] of Object.entries(S.state.errors || {})) for (const e of Object.values(errs)) bits.push([`${(D.acc(accId) || {}).username || ''}: ${e}`, 'red']);
    if (!D.hasAccount() && !S.state.demo) bits.push(['NO ACCOUNT CONNECTED — SETTINGS › ACCOUNTS', 'lamp']);
    const n = D.next();
    if (n) bits.push([n.start <= now ? `IN PROGRESS: ${n.title} — ${Math.max(0, Math.round((n.end - now) / 60000))} MIN LEFT` : `NEXT DEPARTURE ${hm(n.start)} ${n.title} · ${n.gate} · ${M.countdown(n.start, now).toUpperCase()}`, n.status.tone]);
    if (!D.hasAccount() && !S.state.demo) { finishTicker(bits); return; }
    const u = D.unread(); bits.push([u ? `${u} UNREAD CHAT${u === 1 ? '' : 'S'}` : 'ALL CHATS READ', u ? 'lamp' : 'dim']);
    const rows = D.departures(now).filter(r => !r.allDay && !r.cancelled);
    const left = rows.filter(r => r.end > now).length; bits.push([`${left} OF ${rows.length} MEETINGS LEFT TODAY`, 'dim']);
    const rsvp = rows.filter(r => r.status.code === 'reply').length; if (rsvp) bits.push([`${rsvp} AWAITING YOUR RSVP`, 'cyan']);
    const t = D.tasks().filter(x => !x.done && x.due && M.startOfDay(x.due) <= M.startOfDay(now)); if (t.length) bits.push([`${t.length} TASK${t.length === 1 ? '' : 'S'} DUE`, 'lamp']);
    finishTicker(bits);
  }
  function finishTicker(bits) {
    const sig = JSON.stringify(bits); if (sig === tickerSig) return; tickerSig = sig;
    const tape = $('#tape'); tape.textContent = '';
    for (let k = 0; k < 2; k++) for (const [txt, tone] of bits) tape.appendChild(h('span.led.' + (tone === 'lamp' ? 'x' : tone), '◆ ' + txt));
    tape.style.animationDuration = Math.max(30, bits.join('').length / 4) + 's';
  }

  // ───── presence menu
  $('#presenceBtn').addEventListener('click', (e) => {
    if (!D.hasAccount()) return go('settings');
    const accId = D.firstAcc(); const cur = D.myPresence();
    const set = (availability, minutes) => run(C.call('setPresence', { accountId: accId, availability, minutes }));
    const me = D.me(accId); const msg = me && me.presence && me.presence.statusMessage && me.presence.statusMessage.message && me.presence.statusMessage.message.content;
    menu(e.currentTarget, [
      { label: (me && me.displayName) || 'You', header: true },
      { label: 'Available', dot: 'Available', on: /Available/.test(cur), run: () => set('Available') },
      { label: 'Busy', dot: 'Busy', on: cur === 'Busy', run: () => set('Busy') },
      { label: 'Do not disturb', dot: 'DoNotDisturb', on: cur === 'DoNotDisturb', run: () => set('DoNotDisturb') },
      { label: 'Do not disturb · 1 hour', dot: 'DoNotDisturb', run: () => set('DoNotDisturb', 60) },
      { label: 'Be right back', dot: 'BeRightBack', on: cur === 'BeRightBack', run: () => set('BeRightBack') },
      { label: 'Appear away', dot: 'Away', on: cur === 'Away', run: () => set('Away') },
      { label: 'Appear offline', dot: 'Offline', on: cur === 'Offline', run: () => set('Offline') },
      { label: 'Reset status', icon: 'refresh', run: () => set(null) },
      '-',
      { label: msg ? `Status: “${msg.slice(0, 30)}”` : 'Set status message…', icon: 'edit', run: () => statusMessage(accId, msg) },
    ], { up: true });
  });
  function statusMessage(accountId, cur) {
    const m = modal({ title: 'Status message' });
    const input = h('textarea.input', { rows: 3, placeholder: 'In the field until 2 · back on Teams after lunch', maxlength: 280 }); input.value = cur || '';
    const until = h('select.input', h('option', { value: '' }, 'Don’t clear'), h('option', { value: '60' }, '1 hour'), h('option', { value: '240' }, '4 hours'), h('option', { value: 'today' }, 'Today'), h('option', { value: 'week' }, 'This week'));
    m.body.append(h('div.field', h('label', 'Message'), input), h('div.field', h('label', 'Clear after'), until));
    m.foot.append(h('button.btn.ghost', { onclick: () => { run(C.call('setStatusMessage', { accountId, text: '' })); m.close(); } }, 'Clear'), h('div.grow'), h('button.btn.lamp', { onclick: () => {
      const v = until.value; let at = null; const now = Date.now();
      if (v === 'today') at = M.addDays(M.startOfDay(now), 1); else if (v === 'week') at = M.addDays(M.startOfDay(now), 7 - new Date(now).getDay()); else if (v) at = now + Number(v) * 60000;
      run(C.call('setStatusMessage', { accountId, text: input.value.trim(), until: at }), 'Status set'); m.close();
    } }, 'Set'));
    input.focus();
  }

  // ───── command palette (Cmd/Ctrl+K)
  function palette() {
    if ($('.modal.palette')) return;
    const m = modal({ cls: 'palette', foot: false });
    const input = h('input.input.big', { placeholder: 'Jump to a chat, meeting, channel or command…' });
    const list = h('div.plist');
    m.body.append(input, list);
    let sel = 0, items = [];
    const cmds = [
      { label: 'New chat', hint: '⌘N', icon: 'chat', run: () => window.newChat() },
      { label: 'New meeting', hint: '⇧⌘M', icon: 'video', run: () => window.newMeeting() },
      { label: 'New task', hint: '⌘T', icon: 'task', run: () => window.newTask() },
      { label: 'Join next meeting', hint: '⌘J', icon: 'train', run: () => joinNext() },
      { label: 'Board', icon: 'board', run: () => go('home') }, { label: 'Timetable', icon: 'cal', run: () => go('calendar') }, { label: 'Manifest', icon: 'tasks', run: () => go('tasks') }, { label: 'Settings', icon: 'gear', run: () => go('settings') },
    ];
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      const chats = D.rows().filter(r => !q || (r.title + ' ' + r.members.map(x => x.name).join(' ')).toLowerCase().includes(q)).slice(0, q ? 8 : 5).map(r => ({ label: r.title, sub: r.text, icon: 'chat', unread: r.unread, run: () => go('chats', { chatId: r.id, accountId: r.accountId }) }));
      const now = Date.now();
      const evs = q ? D.events().map(e => M.departure(e, now, D.opts())).filter(r => r.title.toLowerCase().includes(q) && r.end > now - 864e5).sort((a, b) => a.start - b.start).slice(0, 6).map(r => ({ label: r.title, sub: `${relDay(r.start)} ${timeLabel(r.start)}`, icon: 'cal', run: () => go('calendar', { day: r.start, eventId: r.id }) })) : [];
      const tasks = q ? D.tasks().filter(t => !t.done && t.title.toLowerCase().includes(q)).slice(0, 4).map(t => ({ label: t.title, sub: t.due ? relDay(t.due) : 'Task', icon: 'task', run: () => go('tasks') })) : [];
      const cs = cmds.filter(c => !q || c.label.toLowerCase().includes(q));
      items = [...cs.map(c => ({ ...c, group: 'Commands' })), ...chats.map(c => ({ ...c, group: 'Chats' })), ...evs.map(c => ({ ...c, group: 'Meetings' })), ...tasks.map(c => ({ ...c, group: 'Tasks' }))];
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.textContent = ''; let g = '';
      items.forEach((it, i) => {
        if (it.group !== g) { g = it.group; list.appendChild(h('div.pg.eyebrow', g)); }
        list.appendChild(h('button.pi' + (i === sel ? '.on' : ''), { onmousemove: () => { if (sel !== i) { sel = i; paint(); } }, onclick: () => { m.close(); it.run(); } }, icon(it.icon), h('span.pl', it.label, it.sub ? h('em', it.sub) : null), it.unread ? h('b.udot') : null, it.hint ? h('kbd', it.hint) : null));
      });
      if (!items.length) list.appendChild(h('div.empty', 'Nothing on the board for that'));
    };
    input.addEventListener('input', () => { sel = 0; paint(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
      if (e.key === 'Enter' && items[sel]) { m.close(); items[sel].run(); }
    });
    paint(); input.focus();
  }
  window.palette = palette;

  async function joinNext() {
    const n = D.next();
    if (!n || !n.online) return toast('No meeting to join right now.');
    window.joinMeeting(n);
  }
  window.joinNext = joinNext;
  window.joinMeeting = async (row, mode) => {
    const r = await run(C.call('join', { eventId: row.id, url: row.join && row.join.url, title: row.title, accountId: row.accountId, mode }));
    if (r && r.demo) toast(`Sample data — this would open the ${row.gate.toLowerCase()} meeting ${r.mode === 'window' ? 'in a Concourse window' : r.mode === 'app' ? 'in the Teams app' : r.mode === 'vantage' ? 'in Vantage' : 'in your browser'}.`);
    else if (r && r.note) toast(r.note);
    else toast(`Boarding ${row.title}…`, { tone: 'green' });
  };

  // ───── keyboard
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
    if (e.key === 'Escape') closeMenus();
  });

  // ───── wiring
  $$('#rail .nav').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  hydrateIcons();
  C.on('state', onState);
  C.on('go', (a) => { if (typeof a === 'string') go(a); else go(a.view, a); });
  C.on('toast', (t) => toast(t.text, { tone: t.tone }));
  C.on('cmd', (c) => ({ palette, 'new-chat': () => window.newChat(), 'new-meeting': () => window.newMeeting(), 'new-task': () => window.newTask(), 'join-next': joinNext })[c]?.());

  // a clock tick refreshes countdowns and statuses once a minute (and the home clock each second)
  setInterval(() => { if (S.state) { rail(); ticker(); S.current && S.current.tick && S.current.tick(); } }, 15000);

  (async () => {
    const cached = await C.call('cached').catch(() => null);
    const st = await C.call('state');
    if (cached && st.accounts.length && !st.chats.length && !st.events.length) {
      Object.assign(st, { chats: cached.chats || [], events: cached.events || [], todo: cached.todo || [], me: { ...cached.me, ...Object.fromEntries(Object.entries(st.me).filter(([, v]) => v)) } });
    }
    onState(st);
  })();
})();

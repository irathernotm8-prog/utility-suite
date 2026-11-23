// Concourse — Board: the home page. Today's departures (meetings), arrivals (messages) and manifest (your tasks),
// with the next departure up top and a day switcher to look ahead or back.
(() => {
  let root, els = {}, clockT = null;

  function mount(main) {
    root = main; els = {};
    if (!D.hasAccount() && !S.state.demo) return welcome(main);
    S.day = S.day || M.startOfDay(Date.now());
    const clock = h('span.bigclock'); const date = h('span.bigdate');
    const dayFlap = h('span.dayflap');
    els.clock = clock; els.date = date; els.dayFlap = dayFlap;
    const nav = h('div.daynav',
      h('button.btn.icon', { title: 'Previous day', html: ic('left'), onclick: () => setDay(M.addDays(S.day, -1)) }),
      h('button.dayname', { onclick: () => setDay(M.startOfDay(Date.now())), title: 'Back to today' }, dayFlap),
      h('button.btn.icon', { title: 'Next day', html: ic('right'), onclick: () => setDay(M.addDays(S.day, 1)) }));
    els.hero = h('div.hero');
    main.append(
      h('header.top', h('div.clockwrap', clock, h('div.cl2', date, h('span.eyebrow', 'Local time'))), els.hero, nav),
      h('div.homegrid',
        els.dep = board('Departures', 'Meetings', 'dep', h('button.btn.sm.ghost', { onclick: () => window.newMeeting({ day: S.day }) }, icon('plus'), 'Meeting')),
        els.arr = board('Arrivals', 'Messages', 'arr', h('button.btn.sm.ghost', { onclick: () => window.newChat() }, icon('plus'), 'Chat')),
        els.man = board('Manifest', 'Your tasks', 'man', null)));
    tickClock(true); clockT = setInterval(() => tickClock(false), 1000);
    draw();
  }
  function unmount() { clearInterval(clockT); clockT = null; }

  function board(title, sub, key, action) {
    const count = h('span.count', { hidden: true });
    const body = h('div.body');
    const b = h('section.board.' + key, h('header', h('span.title', title), h('span.sub', sub), count, h('span.grow'), action), body);
    b._count = count; b._body = body; return b;
  }

  function tickClock(instant) {
    const now = Date.now();
    flapClock(els.clock, now, { instant });
    flap(els.date, boardDate(now), { instant });
  }

  function setDay(d) { S.day = M.startOfDay(d); draw(); C.call('range', { from: M.addDays(S.day, -1), to: M.addDays(S.day, 2) }).catch(() => {}); }

  function draw() {
    const now = Date.now();
    const isToday = S.day === M.startOfDay(now);
    flap(els.dayFlap, isToday ? 'TODAY' : relDay(S.day).length <= 9 && /Tomorrow|Yesterday/.test(relDay(S.day)) ? relDay(S.day) : boardDate(S.day), { len: 10, tone: isToday ? undefined : 'white' });
    hero(now); departures(now, isToday); arrivals(now); manifest(now, isToday);
  }

  // ───── the next departure
  function hero(now) {
    const n = D.next(); const el = els.hero; el.textContent = '';
    if (!n) { el.append(h('div.heroempty', h('span.eyebrow', 'Next departure'), h('span.led.dim', 'No more meetings today'))); el.className = 'hero none'; return; }
    const live = n.start <= now;
    el.className = 'hero ' + (live ? 'live' : n.status.code === 'boarding' ? 'boarding' : '');
    const cd = h('span'); flap(cd, live ? `${Math.max(0, Math.round((n.end - now) / 60000))}M LEFT` : M.countdown(n.start, now).replace('in ', ''), { tone: live ? 'green' : n.status.code === 'boarding' ? undefined : 'white', instant: true });
    el.append(
      h('div.hl', h('span.eyebrow', live ? 'In progress' : 'Next departure'), h('div.ht', n.title), h('div.hm', `${timeLabel(n.start)} – ${timeLabel(n.end)}`, n.organizer ? ` · ${n.organizer}` : '', ` · ${n.attendees.length} aboard`)),
      h('div.hc', h('span.eyebrow', live ? 'Remaining' : 'Departs in'), cd),
      n.online ? h('button.btn.' + (live ? 'green' : 'lamp') + '.joinbig', { onclick: () => window.joinMeeting(n) }, icon('video'), live ? 'Join now' : 'Join') : h('span.tag', n.location || 'No link'));
    el.onclick = (e) => { if (!e.target.closest('button')) window.eventDrawer(n); };
  }

  // ───── departures board
  function departures(now, isToday) {
    const rows = D.departures(S.day); const body = els.dep._body; body.textContent = '';
    const live = rows.filter(r => !r.allDay && r.end > now && !r.cancelled).length;
    els.dep._count.hidden = !live; els.dep._count.textContent = live;
    if (!rows.length) { body.append(h('div.empty', isToday ? 'No departures today. Enjoy the quiet.' : 'No departures this day')); return; }
    const tb = h('tbody');
    const table = h('table.rows', h('thead', h('tr', h('th', 'Time'), h('th', 'Meeting'), h('th', 'Gate'), h('th', 'Status'), h('th', ''))), tb);
    for (const r of rows) {
      const tm = h('span'); flap(tm, r.allDay ? 'ALL ' : hm(r.start), { instant: true, tone: r.status.code === 'departed' || r.cancelled ? 'dim' : undefined });
      const st = h('span.led.' + r.status.tone + (r.status.blink ? '.blink' : ''), r.status.label);
      const act = h('td.act');
      if (r.online && !r.cancelled && r.status.code !== 'departed') act.append(h('button.btn.sm.' + (r.status.code === 'live' ? 'green' : r.status.code === 'boarding' ? 'lamp' : 'ghost'), { onclick: (e) => { e.stopPropagation(); window.joinMeeting(r); } }, icon('video'), 'Join'));
      if (r.status.code === 'reply') act.append(h('button.btn.sm', { onclick: (e) => { e.stopPropagation(); window.rsvpMenu(e.currentTarget, r); } }, 'RSVP'));
      tb.append(h('tr.drow' + (r.status.code === 'departed' || r.response === 'declined' ? '.gone' : '') + (r.cancelled ? '.cancel' : ''), { onclick: () => window.eventDrawer(r) },
        h('td.time', tm),
        h('td', h('div.title', r.title), h('div.meta', [r.organizer && !r.isOrganizer ? r.organizer : r.isOrganizer ? 'You organised' : '', r.attendees.length ? `${r.attendees.length} aboard` : '', r.allDay ? 'All day' : `until ${timeLabel(r.end)}`].filter(Boolean).join(' · '))),
        h('td.gate', r.gate), h('td.status', st), act));
    }
    body.append(table);
    const slots = isToday ? M.freeSlots(rows, S.day, ...S.state.settings.workHours).filter(([s, e]) => e > now) : M.freeSlots(rows, S.day, ...S.state.settings.workHours);
    if (slots.length) body.append(h('div.open', h('span.eyebrow', 'Open platforms'), ...slots.slice(0, 5).map(([s, e]) => h('button.tag.green', { title: 'Book a meeting here', onclick: () => window.newMeeting({ start: Math.max(s, now), end: e }) }, `${hm(Math.max(s, isToday ? roundUp(now) : s))}–${hm(e)}`))));
  }
  const roundUp = (ms) => Math.ceil(ms / (15 * 60000)) * 15 * 60000;

  // ───── arrivals board
  function arrivals(now) {
    const rows = D.arrivals(S.day); const body = els.arr._body; body.textContent = '';
    const u = rows.filter(r => r.unread).length; els.arr._count.hidden = !u; els.arr._count.textContent = u;
    if (!rows.length) { body.append(h('div.empty', S.day === M.startOfDay(now) ? 'No messages yet today' : 'No messages this day')); return; }
    const list = h('div.arrlist');
    for (const r of rows.slice(0, 40)) {
      const other = r.members.find(m => m.id === r.fromId) || { name: r.from, id: r.fromId };
      list.append(h('button.arow' + (r.unread ? '.unread' : ''), { onclick: () => go('chats', { chatId: r.id, accountId: r.accountId }) },
        avatar(r.chatType === 'oneOnOne' ? other : { name: r.title }, { accountId: r.accountId, presence: r.chatType === 'oneOnOne' ? D.presence(other.id) : null, group: r.chatType !== 'oneOnOne', count: r.members.length }),
        h('div.ab', h('div.at', h('span.an', r.title), h('span.aw.mono', hm(r.at))), h('div.ax', r.chatType !== 'oneOnOne' ? h('b', r.from.split(' ')[0] + ': ') : null, r.text || '…')),
        h('span.acts', h('span.mini', { title: 'Make a task from this', onclick: (e) => { e.stopPropagation(); window.newTask({ title: r.text.slice(0, 120), notes: `From ${r.from} in ${r.title}`, link: { chatId: r.id, accountId: r.accountId, title: r.title } }); }, html: ic('task') }))));
    }
    body.append(list);
  }

  // ───── manifest board
  function manifest(now, isToday) {
    const tasks = M.manifestFor(D.tasks(), S.day, now); const body = els.man._body; body.textContent = '';
    const open = tasks.filter(t => !t.done).length; els.man._count.hidden = !open; els.man._count.textContent = open;
    const input = h('input.input.bare', { placeholder: isToday ? 'Add to today’s manifest…' : `Add for ${relDay(S.day)}…` });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const title = input.value.trim(); input.value = '';
      await run(C.call('addTask', { title, due: isToday ? M.startOfDay(now) + 12 * 3600e3 : S.day + 12 * 3600e3, myDay: isToday }));
    });
    body.append(h('div.quickadd', icon('plus'), input));
    if (!tasks.length) { body.append(h('div.empty', 'Manifest clear')); return; }
    for (const t of tasks) body.append(window.taskRow(t, { compact: true }));
  }

  // ───── first run
  function welcome(main) {
    const steps = h('ol.steps',
      h('li', h('b', 'Connect your Microsoft 365 work account. '), 'Concourse talks to Teams through Microsoft Graph, so it needs an app ID once (Settings walks you through it — about five minutes, free).'),
      h('li', h('b', 'Sign in. '), 'Microsoft’s own sign-in page opens in your browser, so MFA and company SSO work as usual.'),
      h('li', h('b', 'All aboard. '), 'Chats, channels, your calendar and To Do arrive on the board.'));
    const title = h('span'); flap(title, 'WELCOME TO CONCOURSE', { instant: false });
    main.append(h('div.welcome',
      h('div.wbrd', h('div.wt', title), h('p.lede', 'Microsoft Teams, rebuilt as a departures board. Your meetings depart, your messages arrive, and your own tasks ride along — none of the bloat.'), steps,
        h('div.wbtns', h('button.btn.lamp', { onclick: () => go('settings', { section: 'accounts' }) }, 'Connect an account'), h('button.btn', { onclick: () => C.call('demo', { on: true }) }, 'Look around with sample data')))));
  }

  function update(parts) {
    if (!els.dep) { if (D.hasAccount() || S.state.demo) { root.textContent = ''; mount(root); } return; }
    draw();
  }
  function tick() { if (els.dep) draw(); }
  function arg(a) { if (a && a.day) setDay(a.day); }

  S.views.home = { mount, unmount, update, tick, arg };
})();

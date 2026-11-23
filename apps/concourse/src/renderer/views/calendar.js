// Concourse — Timetable: the calendar as a transit system. Week view draws each day as a line with meetings as
// stations along it (overlaps run on parallel tracks, a train marks now); Day view is that day's departures board.
// Also the meeting drawer, RSVP menu and the new-meeting form, which other views use too.
(() => {
  let root, els = {}, mode = 'week', anchor = M.startOfDay(Date.now()), selected = null;

  const weekStart = (ms) => { const d = new Date(M.startOfDay(ms)); const wd = (d.getDay() + 6) % 7; return M.addDays(d.getTime(), -wd); };

  function mount(main, arg) {
    root = main; els = {};
    if (arg && arg.day) anchor = M.startOfDay(arg.day);
    const seg = h('div.seg', ...['week', 'day'].map(m => h('button' + (m === mode ? '.on' : ''), { onclick: (e) => { mode = m; $$('button', seg).forEach(b => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, m)));
    els.title = h('span.ttl');
    els.head = h('header.top.cal',
      h('div.cl', h('span.eyebrow', 'Timetable'), els.title),
      h('div.calnav', h('button.btn.icon', { html: ic('left'), onclick: () => step(-1) }), h('button.btn', { onclick: () => { anchor = M.startOfDay(Date.now()); draw(); } }, 'Today'), h('button.btn.icon', { html: ic('right'), onclick: () => step(1) })),
      h('div.grow'), seg, h('button.btn.lamp', { onclick: () => window.newMeeting({ day: mode === 'day' ? anchor : undefined }) }, icon('plus'), 'New meeting'));
    els.body = h('div.calbody');
    main.append(els.head, els.body);
    draw();
    if (arg && arg.eventId) { const ev = D.events().find(e => e.id === arg.eventId); if (ev) window.eventDrawer(M.departure(ev, Date.now(), D.opts())); }
  }
  function step(n) { anchor = M.addDays(anchor, mode === 'week' ? 7 * n : n); ensureRange(); draw(); }
  function ensureRange() { const a = mode === 'week' ? weekStart(anchor) : anchor; C.call('range', { from: M.addDays(a, -1), to: M.addDays(a, 8) }).catch(() => {}); }

  function draw() {
    if (!els.body) return;
    const now = Date.now();
    if (mode === 'week') {
      const a = weekStart(anchor);
      flap(els.title, `${boardDate(a).slice(4)} – ${boardDate(M.addDays(a, 6)).slice(4)}`, { instant: true });
      week(a, now);
    } else {
      flap(els.title, boardDate(anchor), { instant: true });
      day(anchor, now);
    }
  }

  // ───── week: one line per day
  function week(a, now) {
    const body = els.body; const keep = body.scrollTop; body.textContent = '';
    const days = [...Array(7)].map((_, i) => M.addDays(a, i));
    const [wh0, wh1] = S.state.settings.workHours;
    let H0 = wh0, H1 = wh1;
    const perDay = days.map(d => D.departures(d));
    for (const rows of perDay) for (const r of rows) if (!r.allDay) { const s = new Date(Math.max(r.start, M.startOfDay(r.start))).getHours(); const e = new Date(r.end).getHours() + (new Date(r.end).getMinutes() ? 1 : 0); H0 = Math.min(H0, s); H1 = Math.max(H1, Math.min(24, e || 24)); }
    const span = (H1 - H0) * 3600e3;
    const scale = h('div.scale', h('div.lbl'), h('div.ticks', ...[...Array(H1 - H0 + 1)].map((_, i) => h('span', { style: { left: (i / (H1 - H0) * 100) + '%' } }, pad((H0 + i) % 24)))));
    const lines = h('div.lines');
    days.forEach((d, i) => {
      const rows = perDay[i]; const isToday = d === M.startOfDay(now); const past = d < M.startOfDay(now);
      const { rows: timed, count } = M.layoutTracks(rows.filter(r => !r.allDay));
      const allDay = rows.filter(r => r.allDay);
      const dl = h('span'); flap(dl, boardDate(d).slice(0, 6), { instant: true, tone: isToday ? undefined : past ? 'dim' : 'white' });
      const TH = 50;
      const track = h('div.track', { style: { height: (TH * count + 4) + 'px' } });
      for (let t = 0; t < count; t++) track.append(h('div.rail' + (t ? '.branch' : ''), { style: { top: (12 + t * TH) + 'px' } }));
      for (let hh = 0; hh <= H1 - H0; hh++) track.append(h('i.tick', { style: { left: (hh / (H1 - H0) * 100) + '%' } }));
      const base = d + H0 * 3600e3;
      const pct = (ms) => Math.max(0, Math.min(100, (ms - base) / span * 100));
      for (const r of timed) {
        const left = pct(r.start), right = pct(r.end);
        const nextOnTrack = timed.filter(x => x.track === r.track && x.start > r.start).sort((a, b) => a.start - b.start)[0];
        const room = (nextOnTrack ? pct(nextOnTrack.start) : 100) - left;
        const st = r.status.code;
        const top = 12 + r.track * TH;
        const stn = h('button.stn.s-' + st + (r.cancelled ? '.cx' : '') + (r.response === 'declined' ? '.dec' : '') + (selected === r.id ? '.sel' : ''), {
          style: { left: left + '%', top: (top - 8) + 'px', maxWidth: `calc(${Math.max(room, 4)}% - 6px)` },
          title: `${timeLabel(r.start)}–${timeLabel(r.end)} ${r.title}`, onclick: () => { selected = r.id; window.eventDrawer(r); draw(); },
        }, h('b.dot'), h('span.lab', h('span.sn', r.title), h('span.st.mono', `${hm(r.start)}–${hm(r.end)}`)));
        track.append(h('i.leg.s-' + st + (r.cancelled ? '.cx' : ''), { style: { left: left + '%', width: Math.max(0.6, right - left) + '%', top: (top - 1) + 'px' } }), stn);
      }
      if (isToday && now > base && now < base + span) {
        const x = (now - base) / span * 100;
        track.append(h('div.now', { style: { left: x + '%' } }, h('span.train', { html: ic('train') })));
      }
      const meta = h('div.dmeta', allDay.map(r => h('button.tag.cyan', { onclick: () => window.eventDrawer(r) }, r.title)), h('span.mono.dim', `${timed.filter(r => !r.cancelled).length} stops`));
      lines.append(h('div.line' + (isToday ? '.today' : '') + (past ? '.past' : ''), h('button.lbl', { onclick: () => { anchor = d; mode = 'day'; $$('.seg button', els.head).forEach(b => b.classList.toggle('on', b.textContent === 'day')); draw(); } }, dl), h('div.lwrap', track, meta)));
    });
    body.append(h('div.weekmap', scale, lines), legend());
    body.scrollTop = keep;
  }
  function legend() {
    return h('div.legend', ...[['ontime', 'On time'], ['boarding', 'Boarding'], ['live', 'In progress'], ['reply', 'Awaiting RSVP'], ['tentative', 'Tentative'], ['departed', 'Departed'], ['cancelled', 'Cancelled']].map(([k, l]) => h('span', h('b.dot.s-' + k), l)));
  }

  // ───── day: a full departures board with free platforms
  function day(d, now) {
    const body = els.body; body.textContent = '';
    const rows = D.departures(d);
    const tb = h('tbody');
    for (const r of rows) {
      const tm = h('span'); flap(tm, r.allDay ? 'ALL ' : hm(r.start), { instant: true, tone: r.status.code === 'departed' || r.cancelled ? 'dim' : undefined });
      const en = h('span'); flap(en, r.allDay ? 'DAY ' : hm(r.end), { instant: true, tone: 'dim' });
      const act = h('td.act');
      if (r.online && !r.cancelled && r.status.code !== 'departed') act.append(h('button.btn.sm.' + (r.status.code === 'live' ? 'green' : r.status.code === 'boarding' ? 'lamp' : 'ghost'), { onclick: (e) => { e.stopPropagation(); window.joinMeeting(r); } }, icon('video'), 'Join'));
      tb.append(h('tr.drow' + (r.status.code === 'departed' ? '.gone' : '') + (r.cancelled ? '.cancel' : '') + (selected === r.id ? '.sel' : ''), { onclick: () => { selected = r.id; window.eventDrawer(r); draw(); } },
        h('td.time', tm), h('td.time', en),
        h('td', h('div.title', r.title), h('div.meta', [r.isOrganizer ? 'You organised' : r.organizer, r.attendees.length ? `${r.attendees.length} aboard` : '', r.location && !r.online ? r.location : ''].filter(Boolean).join(' · '))),
        h('td.gate', r.gate), h('td.status', h('span.led.' + r.status.tone + (r.status.blink ? '.blink' : ''), r.status.label)), act));
    }
    const brd = h('section.board.dayboard', h('header', h('span.title', 'Departures'), h('span.sub', relDay(d)), h('span.grow')), h('div.body', rows.length ? h('table.rows', h('thead', h('tr', h('th', 'Departs'), h('th', 'Arrives'), h('th', 'Meeting'), h('th', 'Gate'), h('th', 'Status'), h('th', ''))), tb) : h('div.empty', 'No departures this day')));
    const slots = M.freeSlots(rows, d, ...S.state.settings.workHours).filter(([, e]) => e > now);
    const free = h('section.board.freeboard', h('header', h('span.title', 'Open platforms'), h('span.sub', 'Free time')), h('div.body', slots.length ? h('div.slots', ...slots.map(([s, e]) => h('button.slot', { onclick: () => window.newMeeting({ start: Math.max(s, Math.ceil(now / 9e5) * 9e5), end: e }) }, h('span.mono', `${hm(s)} – ${hm(e)}`), h('span.dim', `${Math.round((e - s) / 60000)} min`), h('span.tag.green', 'Book')))) : h('div.empty', 'Fully booked')));
    body.append(h('div.daygrid', brd, free));
  }

  // ───── meeting drawer
  window.eventDrawer = (r) => {
    $$('.drawer').forEach(d => d.remove());
    const now = Date.now();
    const ev = D.events().find(e => e.id === r.id); if (ev) r = M.departure(ev, now, D.opts());
    const dr = h('aside.drawer');
    const close = () => { dr.classList.add('out'); setTimeout(() => dr.remove(), 160); selected = null; document.removeEventListener('keydown', key); if (S.view === 'calendar') draw(); };
    const key = (e) => { if (e.key === 'Escape' && !$('.modal')) close(); };
    document.addEventListener('keydown', key);
    const tm = h('span'); flap(tm, r.allDay ? 'ALL DAY' : `${hm(r.start)}-${hm(r.end)}`, { instant: true });
    const resp = { accepted: ['Accepted', 'green'], tentativelyAccepted: ['Tentative', 'cyan'], declined: ['Declined', 'red'], none: ['No reply', ''], notResponded: ['No reply', ''], organizer: ['Organiser', 'lamp'] };
    const acts = h('div.dacts');
    if (r.online && !r.cancelled && r.status.code !== 'departed') {
      acts.append(h('button.btn.' + (r.status.code === 'live' ? 'green' : 'lamp'), { onclick: () => window.joinMeeting(r) }, icon('video'), 'Join'));
      acts.append(h('button.btn', { title: 'Other ways to join', onclick: (e) => menu(e.currentTarget, [
        { label: 'In your browser', icon: 'ext', run: () => window.joinMeeting(r, 'browser') },
        { label: 'In a Concourse window', icon: 'video', run: () => window.joinMeeting(r, 'window') },
        r.join.kind === 'teams' ? { label: 'In the Teams app', icon: 'teams', run: () => window.joinMeeting(r, 'app') } : null,
        { label: 'In Vantage', icon: 'link', run: () => window.joinMeeting(r, 'vantage') },
        '-', { label: 'Copy join link', icon: 'copy', run: () => { C.call('copy', { text: r.join.url }); toast('Join link copied'); } },
      ].filter(Boolean)) }, 'Join with…'));
    }
    if (!r.isOrganizer && !r.cancelled && r.status.code !== 'departed') acts.append(h('button.btn', { onclick: (e) => window.rsvpMenu(e.currentTarget, r) }, 'RSVP', r.response && resp[r.response] ? h('span.tag.' + resp[r.response][1], resp[r.response][0]) : null));
    acts.append(h('button.btn.icon', { title: 'More', html: ic('dots'), onclick: (e) => menu(e.currentTarget, [
      { label: 'Add a prep task', icon: 'task', run: () => window.newTask({ title: `Prep: ${r.title}`, due: r.start, link: { eventId: r.id, title: r.title } }) },
      r.webLink ? { label: 'Open in Outlook', icon: 'ext', run: () => C.call('openExternal', { url: r.webLink }) } : null,
      { label: 'Email attendees', icon: 'send', run: () => C.call('openExternal', { url: 'mailto:' + r.attendees.map(a => a.email).filter(Boolean).join(',') + '?subject=' + encodeURIComponent(r.title) }) },
      r.attendees.length ? { label: 'Chat with attendees', icon: 'chat', run: () => window.newChat({ accountId: r.accountId, people: r.attendees.filter(a => a.email).map(a => ({ name: a.name, email: a.email })) }) } : null,
      r.isOrganizer && !r.cancelled ? '-' : null,
      r.isOrganizer && !r.cancelled ? { label: 'Cancel meeting', icon: 'trash', danger: true, run: async () => { if (!confirm(`Cancel “${r.title}” for everyone?`)) return; await run(C.call('cancelEvent', { accountId: r.accountId, eventId: r.id }), 'Meeting cancelled'); close(); } } : null,
    ].filter(Boolean), { align: 'right' }) }));
    const people = h('div.att', ...r.attendees.map(a => h('div.ap', avatar({ name: a.name }, { size: 'sm' }), h('span', a.name || a.email), a.response && resp[a.response] && a.response !== 'none' ? h('span.tag.' + resp[a.response][1], resp[a.response][0]) : null)));
    const notes = ev && ev.body && ev.body.content ? (() => { const n = h('div.dnotes.btext'); n.innerHTML = safeHtml(ev.body.content.replace(/_{10,}[\s\S]*$/, '')); return M.textOf(n.innerHTML).length > 2 ? n : null; })() : null;
    dr.append(
      h('header', h('span.led.' + r.status.tone + (r.status.blink ? '.blink' : ''), r.status.label), h('span.grow'), h('button.btn.ghost.icon', { html: ic('x'), onclick: close })),
      h('div.dtitle', r.title),
      h('div.dtime', tm, h('span', relDay(r.start) + (r.allDay ? '' : ` · ${Math.round((r.end - r.start) / 60000)} min`), r.start > now ? h('span.dim', ' · ' + M.countdown(r.start, now)) : null)),
      h('div.dkv', h('span.eyebrow', 'Gate'), h('span.mono', r.gate), r.location && r.location !== 'Microsoft Teams Meeting' ? h('span.dim', r.location) : null),
      h('div.dkv', h('span.eyebrow', 'Organiser'), h('span', r.isOrganizer ? 'You' : r.organizer || '—')),
      acts,
      r.attendees.length ? h('div.dsec', h('span.eyebrow', `${r.attendees.length} aboard`), people) : null,
      notes ? h('div.dsec', h('span.eyebrow', 'Notes'), notes) : null);
    document.body.append(dr);
  };

  window.rsvpMenu = (anchor, r) => menu(anchor, [
    { label: 'Accept', icon: 'check', run: () => rsvp(r, 'accept', 'Accepted') },
    { label: 'Tentative', icon: 'clock', run: () => rsvp(r, 'tentative', 'Marked tentative') },
    { label: 'Decline', icon: 'x', danger: true, run: () => rsvp(r, 'decline', 'Declined') },
  ]);
  async function rsvp(r, how, msg) { await run(C.call('rsvp', { accountId: r.accountId, eventId: r.id, how }), msg); if ($('.drawer')) window.eventDrawer(r); }

  // ───── new meeting
  window.newMeeting = (pre = {}) => {
    if (!D.hasAccount() && !S.state.demo) return go('settings');
    const accountId = pre.accountId || D.firstAcc();
    const now = Date.now();
    let start = pre.start || (pre.day && pre.day !== M.startOfDay(now) ? pre.day + 10 * 3600e3 : Math.ceil((now + 5 * 60000) / 9e5) * 9e5);
    let dur = pre.end ? Math.min(60, Math.round((pre.end - start) / 60000)) : 30;
    const m = modal({ title: 'New meeting', cls: 'wide' });
    const title = h('input.input', { placeholder: 'Meeting title', value: pre.title || '' });
    const date = h('input.input', { type: 'date', value: M.dayKey(start) });
    const time = h('input.input', { type: 'time', value: hm(start), step: 300 });
    const durs = h('div.seg', ...[15, 30, 45, 60, 90].map(n => h('button' + (n === dur ? '.on' : ''), { onclick: (e) => { dur = n; $$('button', durs).forEach(b => b.classList.toggle('on', b === e.currentTarget)); paintSlots(); } }, n < 60 ? n + 'm' : (n / 60) + 'h')));
    const picker = peoplePicker(accountId, pre.people || []);
    const teams = h('input', { type: 'checkbox', checked: true });
    const loc = h('input.input', { placeholder: 'Room or address (optional)' });
    const notes = h('textarea.input', { rows: 3, placeholder: 'Agenda (optional)' });
    const slots = h('div.slotpick');
    const paintSlots = () => {
      slots.textContent = '';
      const d = new Date(date.value + 'T00:00').getTime(); if (isNaN(d)) return;
      const free = M.freeSlots(D.departures(d), d, ...S.state.settings.workHours, dur).filter(([, e]) => e > Date.now());
      if (!free.length) { slots.append(h('span.dim', 'No free slot that long in working hours')); return; }
      slots.append(h('span.eyebrow', 'Free'), ...free.slice(0, 6).map(([s]) => { const st = Math.max(s, Math.ceil(Date.now() / 9e5) * 9e5); return h('button.tag.green', { onclick: () => { time.value = hm(st); } }, hm(st)); }));
    };
    date.addEventListener('change', paintSlots);
    m.body.append(
      h('div.field', h('label', 'Title'), title),
      h('div.frow', h('div.field', h('label', 'Date'), date), h('div.field', h('label', 'Departs'), time)),
      h('div.field', h('label', 'Length'), durs),
      slots,
      h('div.field', h('label', 'Attendees'), picker.el),
      h('label.check', teams, h('span.sw'), h('span', 'Teams meeting (adds a join link)')),
      h('div.field', h('label', 'Location'), loc),
      h('div.field', h('label', 'Agenda'), notes));
    if (S.state.accounts.length > 1) m.body.prepend(h('div.field', h('label', 'Calendar'), (() => { const s = h('select.input', ...S.state.accounts.map(a => h('option', { value: a.id }, a.username))); s.onchange = () => { pre.accountId = s.value; }; return s; })()));
    m.foot.append(h('div.grow'), h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.lamp', { onclick: async () => {
      if (!title.value.trim()) return toast('Give it a title');
      const st = new Date(`${date.value}T${time.value}`).getTime();
      const ev = await run(C.call('createEvent', { accountId: pre.accountId || accountId, title: title.value.trim(), start: st, end: st + dur * 60000, attendees: picker.get(), teams: teams.checked, location: loc.value.trim(), body: notes.value.trim() ? compose(notes.value) : '' }), 'Meeting scheduled');
      m.close(); if (ev && S.view === 'calendar') draw();
    } }, 'Schedule'));
    paintSlots(); title.focus();
  };

  function update(parts) { if (parts.some(p => ['calendar', 'all', 'settings'].includes(p))) draw(); }
  function tick() { draw(); }
  function arg(a) { if (a.day) { anchor = M.startOfDay(a.day); draw(); } if (a.eventId) { const ev = D.events().find(e => e.id === a.eventId); if (ev) window.eventDrawer(M.departure(ev, Date.now(), D.opts())); } }
  S.views.calendar = { mount, update, tick, arg, unmount: () => { $$('.drawer').forEach(d => d.remove()); } };
})();

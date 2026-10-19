/* Relay — unified calendar */
(() => {
  const R = () => window.RelayApp;
  const DAY = 86400000;
  const HOUR_PX = 48;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const cal = {
    cursor: startOfDay(new Date()),
    view: null,
    feeds: new Map(), // accountId -> { key, events, error, loading }
    el: null, side: null
  };

  /* ---------- date utils ---------- */
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function weekStart(d) {
    const mon = R().state.settings.weekStartsMonday;
    const x = startOfDay(d);
    const dow = x.getDay();
    return addDays(x, -((dow - (mon ? 1 : 0) + 7) % 7));
  }
  function fmtTime(d) {
    const h = d.getHours(), m = d.getMinutes();
    return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
  }
  function toLocalInput(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function toTimeInput(d) { const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; }
  function dowLabels() { const mon = R().state.settings.weekStartsMonday; return mon ? [...DOW.slice(1), DOW[0]] : DOW; }

  function viewRange() {
    const v = currentView();
    if (v === 'week') { const s = weekStart(cal.cursor); return [s, addDays(s, 7)]; }
    if (v === 'day') { const s = startOfDay(cal.cursor); return [s, addDays(s, 1)]; }
    const first = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), 1);
    const s = weekStart(first);
    return [s, addDays(s, 42)];
  }
  function currentView() { return cal.view || R().state.settings.calendarView || 'month'; }

  /* ---------- calendars & colors ---------- */
  function calendars() {
    const { state } = R();
    return [
      { id: 'personal', name: 'Personal', sub: 'Stored in Relay', color: state.settings.personalColor || '#ff9a1f', personal: true },
      ...R().mailAccounts().map(a => ({ id: a.id, name: a.name || a.email, sub: a.email || R().PLATFORMS[a.platform].label, color: a.color, account: a }))
    ];
  }
  function hidden() { return new Set(R().state.ui.hiddenCals || []); }
  function colorOf(calId) { return calendars().find(c => c.id === calId)?.color || '#888'; }

  /* ---------- feeds ---------- */
  async function loadFeeds(force = false) {
    const { state } = R();
    const [s, e] = viewRange();
    // fetch a wider window so navigation feels instant
    const ws = addDays(s, -35), we = addDays(e, 35);
    const key = toLocalInput(ws) + '|' + toLocalInput(we);
    const jobs = R().mailAccounts().filter(a => a.icsUrl).map(async (a) => {
      const f = cal.feeds.get(a.id);
      if (!force && f && f.url === a.icsUrl && f.from <= s && f.to >= e) return;
      cal.feeds.set(a.id, { ...(f || {}), loading: true, events: f?.events || [] });
      try {
        const events = await relay.fetchCalendar({ url: a.icsUrl, accountId: a.id, start: ws.toISOString(), end: we.toISOString() });
        cal.feeds.set(a.id, { url: a.icsUrl, key, from: ws, to: we, events, error: null, loading: false });
      } catch (err) {
        cal.feeds.set(a.id, { url: a.icsUrl, key, from: ws, to: we, events: [], error: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), loading: false });
      }
    });
    if (jobs.length) { renderSidebar(cal.side); await Promise.all(jobs); render(cal.el); renderSidebar(cal.side); window.Home?.onCalendar?.(); }
  }

  function allEvents() {
    const { state } = R();
    const hid = hidden();
    const out = [];
    for (const ev of state.events) {
      if (hid.has(ev.accountId)) continue;
      if (ev.accountId !== 'personal' && !R().accountById(ev.accountId)) continue;
      out.push({ ...ev, start: new Date(ev.start), end: new Date(ev.end), calId: ev.accountId, local: true });
    }
    for (const [id, f] of cal.feeds) {
      if (hid.has(id) || !R().accountById(id)) continue;
      for (const ev of f.events) out.push({ ...ev, id: ev.uid, start: new Date(ev.start), end: new Date(ev.end), calId: id, local: false });
    }
    return out;
  }
  function eventsOnDay(list, day) {
    const ds = startOfDay(day), de = addDays(ds, 1);
    return list.filter(ev => ev.start < de && (ev.end > ds || (+ev.end === +ev.start && ev.start >= ds)))
      .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  }

  /* ---------- main render ---------- */
  function render(el) {
    if (!el || R().state.ui.platform !== 'calendar') return;
    cal.el = el;
    const v = currentView();
    const [s] = viewRange();
    let title;
    if (v === 'month') title = `<b>${MONTHS[cal.cursor.getMonth()]}</b> ${cal.cursor.getFullYear()}`;
    else if (v === 'week') {
      const e = addDays(s, 6);
      title = s.getMonth() === e.getMonth()
        ? `<b>${MONTHS[s.getMonth()]}</b> ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`
        : `<b>${MONTHS[s.getMonth()].slice(0, 3)} ${s.getDate()}</b> – <b>${MONTHS[e.getMonth()].slice(0, 3)} ${e.getDate()}</b>, ${e.getFullYear()}`;
    } else title = `<b>${DOW[s.getDay()]}, ${MONTHS[s.getMonth()]} ${s.getDate()}</b> ${s.getFullYear()}`;

    const loading = [...cal.feeds.values()].some(f => f.loading);
    el.innerHTML = `
      <div class="cal-toolbar">
        <div class="cal-title">${title}</div>
        <div class="cal-nav">
          <button class="icon-btn" data-nav="-1" title="Previous">${ic('chevronLeft', 18)}</button>
          <button class="btn" data-nav="0">Today</button>
          <button class="icon-btn" data-nav="1" title="Next">${ic('chevronRight', 18)}</button>
        </div>
        <span class="spacer"></span>
        <button class="icon-btn ${loading ? 'spin' : ''}" id="calRefresh" title="Refresh feeds">${ic('refresh', 17)}</button>
        <div class="seg" id="calView">${['day', 'week', 'month'].map(x => `<button data-v="${x}" class="${v === x ? 'active' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
        <button class="btn brand" id="calNew" style="--c:var(--calendar)">${ic('plus', 15)} New event</button>
      </div>
      <div class="cal-body">${v === 'month' ? monthHTML() : timeGridHTML(v === 'week' ? 7 : 1)}</div>`;

    $$('[data-nav]', el).forEach(b => b.onclick = () => navigate(+b.dataset.nav));
    $$('#calView button', el).forEach(b => b.onclick = () => { cal.view = b.dataset.v; relay.saveSettings({ calendarView: b.dataset.v }); R().state.settings.calendarView = b.dataset.v; refresh(); });
    $('#calNew', el).onclick = () => newEvent();
    $('#calRefresh', el).onclick = () => loadFeeds(true);
    bindEvents(el);
    if (v !== 'month') {
      const sc = $('.tg-scroll', el);
      if (sc && !sc.dataset.scrolled) { sc.scrollTop = Math.max(0, (new Date().getHours() - 2) * HOUR_PX); sc.dataset.scrolled = 1; }
    }
  }

  function navigate(dir) {
    const v = currentView();
    if (dir === 0) cal.cursor = startOfDay(new Date());
    else if (v === 'month') cal.cursor = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth() + dir, 1);
    else cal.cursor = addDays(cal.cursor, dir * (v === 'week' ? 7 : 1));
    refresh();
  }

  function pillHTML(ev, compact = true) {
    const c = colorOf(ev.calId);
    if (ev.allDay) return `<button class="ev allday" data-ev="${R().esc(ev.id)}" style="--c:${c}" title="${R().esc(ev.title)}">${R().esc(ev.title)}</button>`;
    return `<button class="ev timed" data-ev="${R().esc(ev.id)}" style="--c:${c}" title="${R().esc(ev.title)}"><span class="evdot"></span><span class="evtime">${fmtTime(ev.start)}</span><span class="evtitle">${R().esc(ev.title)}</span></button>`;
  }

  function monthHTML() {
    const [s] = viewRange();
    const today = new Date();
    const list = allEvents();
    cal.visible = list;
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(s, i);
      const evs = eventsOnDay(list, d);
      const out = d.getMonth() !== cal.cursor.getMonth();
      const max = 3;
      cells += `<div class="mcell ${out ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''} ${[0, 6].includes(d.getDay()) ? 'weekend' : ''}" data-day="${toLocalInput(d)}">
        <div class="mnum"><span>${d.getDate() === 1 ? MONTHS[d.getMonth()].slice(0, 3) + ' ' : ''}${d.getDate()}</span></div>
        <div class="mevents">${evs.slice(0, max).map(e => pillHTML(e)).join('')}${evs.length > max ? `<button class="more-evs" data-goday="${toLocalInput(d)}">+${evs.length - max} more</button>` : ''}</div>
      </div>`;
    }
    return `<div class="month">
      <div class="mhead">${dowLabels().map(d => `<div>${d}</div>`).join('')}</div>
      <div class="mgrid">${cells}</div></div>`;
  }

  function layoutColumns(evs) {
    // assign overlapping timed events to columns
    const sorted = [...evs].sort((a, b) => a.start - b.start || b.end - a.end);
    const groups = []; let group = []; let groupEnd = 0;
    for (const ev of sorted) {
      if (group.length && ev.start >= groupEnd) { groups.push(group); group = []; groupEnd = 0; }
      group.push(ev); groupEnd = Math.max(groupEnd, +ev.end);
    }
    if (group.length) groups.push(group);
    for (const g of groups) {
      const cols = [];
      for (const ev of g) {
        let ci = cols.findIndex(end => end <= ev.start);
        if (ci < 0) { ci = cols.length; cols.push(0); }
        cols[ci] = +ev.end; ev._col = ci;
      }
      g.forEach(ev => ev._cols = cols.length);
    }
    return sorted;
  }

  function timeGridHTML(days) {
    const s = days === 7 ? weekStart(cal.cursor) : startOfDay(cal.cursor);
    const today = new Date();
    const list = allEvents();
    cal.visible = list;
    const dayList = Array.from({ length: days }, (_, i) => addDays(s, i));
    const head = dayList.map(d => `<div class="tg-dh ${sameDay(d, today) ? 'today' : ''}" data-goday="${toLocalInput(d)}"><span class="dow">${DOW[d.getDay()]}</span><span class="dn">${d.getDate()}</span></div>`).join('');
    const allday = dayList.map(d => `<div class="tg-ad" data-day="${toLocalInput(d)}">${eventsOnDay(list, d).filter(e => e.allDay).map(e => pillHTML(e)).join('')}</div>`).join('');
    const hours = Array.from({ length: 24 }, (_, h) => `<div class="tg-hour"><span>${h === 0 ? '' : fmtTime(new Date(2000, 0, 1, h))}</span></div>`).join('');
    const cols = dayList.map(d => {
      const ds = startOfDay(d), de = addDays(ds, 1);
      const evs = layoutColumns(eventsOnDay(list, d).filter(e => !e.allDay));
      const blocks = evs.map(ev => {
        const st = Math.max(ev.start, ds), en = Math.min(Math.max(ev.end, +ev.start + 15 * 60000), de);
        const top = (st - ds) / 3600000 * HOUR_PX;
        const h = Math.max(20, (en - st) / 3600000 * HOUR_PX - 2);
        const w = 100 / ev._cols;
        const c = colorOf(ev.calId);
        return `<button class="tg-ev ${h < 36 ? 'short' : ''}" data-ev="${R().esc(ev.id)}" style="--c:${c};top:${top}px;height:${h}px;left:calc(${ev._col * w}% + 2px);width:calc(${w}% - 4px)">
          <span class="t">${R().esc(ev.title)}</span><span class="m">${fmtTime(ev.start)} – ${fmtTime(ev.end)}${ev.location ? ' · ' + R().esc(ev.location) : ''}</span></button>`;
      }).join('');
      const now = sameDay(d, today) ? `<div class="tg-now" style="top:${(today - ds) / 3600000 * HOUR_PX}px"></div>` : '';
      return `<div class="tg-col ${sameDay(d, today) ? 'today' : ''}" data-day="${toLocalInput(d)}">${blocks}${now}</div>`;
    }).join('');
    return `<div class="timegrid" style="--days:${days}">
      <div class="tg-head"><div class="tg-gutter"></div>${head}</div>
      <div class="tg-allday"><div class="tg-gutter"><span>all-day</span></div>${allday}</div>
      <div class="tg-scroll"><div class="tg-inner" style="height:${24 * HOUR_PX}px"><div class="tg-hours">${hours}</div><div class="tg-cols">${cols}</div></div></div>
    </div>`;
  }

  function bindEvents(el) {
    $$('[data-ev]', el).forEach(b => b.onclick = (e) => { e.stopPropagation(); showEvent(b.dataset.ev, b); });
    $$('[data-goday]', el).forEach(b => b.onclick = (e) => { e.stopPropagation(); cal.cursor = new Date(b.dataset.goday + 'T00:00'); cal.view = 'day'; refresh(); });
    $$('.mcell', el).forEach(c => c.ondblclick = () => newEvent({ date: new Date(c.dataset.day + 'T09:00') }));
    $$('.tg-col', el).forEach(c => c.onclick = (e) => {
      if (e.target !== c) return;
      const y = e.offsetY;
      const mins = Math.floor(y / HOUR_PX * 2) * 30;
      const d = new Date(c.dataset.day + 'T00:00'); d.setMinutes(mins);
      newEvent({ date: d });
    });
    $$('.tg-ad', el).forEach(c => c.ondblclick = (e) => { if (e.target === c) newEvent({ date: new Date(c.dataset.day + 'T00:00'), allDay: true }); });
  }

  /* ---------- event details ---------- */
  function showEvent(id, anchor) {
    const ev = (cal.visible || allEvents()).find(e => String(e.id) === String(id));
    if (!ev) return;
    const c = calendars().find(x => x.id === ev.calId);
    const r = anchor.getBoundingClientRect();
    const when = ev.allDay
      ? ev.start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
      : `${ev.start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(ev.start)} – ${fmtTime(ev.end)}`;
    const items = [{ html: `<div class="evpop" style="--c:${c?.color}">
        <div class="evpop-title"><span class="sq"></span>${R().esc(ev.title)}</div>
        <div class="evpop-row">${ic('clock', 14)}<span>${when}</span></div>
        ${ev.location ? `<div class="evpop-row">${ic('pin', 14)}<span>${R().esc(ev.location)}</span></div>` : ''}
        <div class="evpop-row">${ic('calendar', 14)}<span>${R().esc(c?.name || '')}${ev.local ? '' : ' · from feed'}</span></div>
        ${(ev.notes || ev.description) ? `<div class="evpop-notes">${R().esc(String(ev.notes || ev.description).slice(0, 400))}</div>` : ''}
      </div>` }];
    if (ev.local) {
      items.push('-', { label: 'Edit event…', icon: 'edit', onClick: () => newEvent({ existing: R().state.events.find(e => e.id === ev.id) }) },
        { label: 'Delete event', icon: 'trash', danger: true, onClick: async () => { R().state.events = await relay.removeEvent(ev.id); refresh(); R().toast('Event deleted'); } });
    }
    items.push('-', { label: 'Ask AI to prep me for this', icon: 'sparkles', onClick: () => { R().toggleAI(true); window.AI?.prompt(`Help me prepare for this event:\n\nTitle: ${ev.title}\nWhen: ${when}\n${ev.location ? 'Where: ' + ev.location + '\n' : ''}${ev.notes || ev.description ? 'Notes: ' + (ev.notes || ev.description) : ''}`); } });
    R().popMenu(r.right + 6 > innerWidth - 300 ? r.left - 300 : r.right + 6, r.top, items);
  }

  /* ---------- new / edit event ---------- */
  function newEvent({ date, allDay = false, existing } = {}) {
    const { state, esc } = R();
    const cals = calendars();
    const base = existing ? new Date(existing.start) : (date || (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })());
    const end = existing ? new Date(existing.end) : new Date(+base + 3600000);
    const ev = existing ? { ...existing } : { id: R().uid(), accountId: state.ui.lastCal && cals.find(c => c.id === state.ui.lastCal) ? state.ui.lastCal : 'personal', title: '', allDay, location: '', notes: '' };
    R().openModal({
      title: existing ? 'Edit event' : 'New event',
      icon: 'calendar', color: 'var(--calendar)',
      body: `
        <div class="field"><input class="input" id="eTitle" placeholder="Add a title" value="${esc(ev.title)}" style="height:42px;font-size:15px;font-weight:600"></div>
        <div class="field"><label>Calendar</label>
          <div class="cal-pick" id="eCal">${cals.map(c => `<button data-c="${c.id}" class="${c.id === ev.accountId ? 'active' : ''}" style="--c:${c.color}"><span class="cdot"></span>${esc(c.name)}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" id="eAllDay" ${ev.allDay ? 'checked' : ''}> All day</label>
        <div class="row">
          <div class="field"><label>Starts</label><div class="row"><input class="input" type="date" id="eSD" value="${toLocalInput(base)}"><input class="input" type="time" id="eST" value="${toTimeInput(base)}" step="900"></div></div>
          <div class="field"><label>Ends</label><div class="row"><input class="input" type="date" id="eED" value="${toLocalInput(end)}"><input class="input" type="time" id="eET" value="${toTimeInput(end)}" step="900"></div></div>
        </div>
        <div class="field"><label>Location</label><input class="input" id="eLoc" value="${esc(ev.location || '')}" placeholder="Add a place or link"></div>
        <div class="field"><label>Notes</label><textarea class="textarea" id="eNotes" placeholder="Add notes">${esc(ev.notes || '')}</textarea></div>
        ${cals.length === 1 ? '' : '<div class="hint" style="font-size:11.5px;color:var(--muted)">Events you add here live in Relay. Events from account feeds are read-only.</div>'}`,
      actions: [
        { label: 'Cancel' },
        { label: existing ? 'Save' : 'Add event', cls: 'brand', style: '--c:var(--calendar)', onClick: async (m) => {
            ev.title = $('#eTitle', m).value.trim() || '(No title)';
            ev.allDay = $('#eAllDay', m).checked;
            const sd = $('#eSD', m).value, ed = $('#eED', m).value || sd;
            const st = ev.allDay ? '00:00' : ($('#eST', m).value || '09:00');
            const et = ev.allDay ? '00:00' : ($('#eET', m).value || st);
            let s = new Date(`${sd}T${st}`), e = new Date(`${ed}T${et}`);
            if (ev.allDay) e = addDays(new Date(`${ed}T00:00`), 1);
            if (e <= s) e = new Date(+s + (ev.allDay ? DAY : 3600000));
            ev.start = s.toISOString(); ev.end = e.toISOString();
            ev.location = $('#eLoc', m).value.trim();
            ev.notes = $('#eNotes', m).value.trim();
            R().state.events = await relay.saveEvent(ev);
            R().state.ui.lastCal = ev.accountId; relay.saveUI({ lastCal: ev.accountId });
            cal.cursor = startOfDay(s);
            refresh();
          } }
      ],
      onMount: (m) => {
        $$('#eCal button', m).forEach(b => b.onclick = () => { ev.accountId = b.dataset.c; $$('#eCal button', m).forEach(x => x.classList.toggle('active', x === b)); });
        const ad = $('#eAllDay', m);
        const sync = () => { $('#eST', m).disabled = $('#eET', m).disabled = ad.checked; };
        ad.onchange = sync; sync();
        $('#eSD', m).onchange = () => { if ($('#eED', m).value < $('#eSD', m).value) $('#eED', m).value = $('#eSD', m).value; };
      }
    });
  }

  /* ---------- sidebar ---------- */
  function miniMonthHTML() {
    const first = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), 1);
    const s = weekStart(first);
    const today = new Date();
    const evDays = new Set(allEvents().map(e => toLocalInput(e.start)));
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(s, i);
      cells += `<button class="mm-d ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''} ${sameDay(d, cal.cursor) ? 'sel' : ''} ${evDays.has(toLocalInput(d)) ? 'has' : ''}" data-mm="${toLocalInput(d)}">${d.getDate()}</button>`;
    }
    return `<div class="minimonth">
      <div class="mm-head"><span>${MONTHS[first.getMonth()]} ${first.getFullYear()}</span>
        <span><button class="icon-btn sm" data-mmnav="-1">${ic('chevronLeft', 14)}</button><button class="icon-btn sm" data-mmnav="1">${ic('chevronRight', 14)}</button></span></div>
      <div class="mm-grid">${dowLabels().map(d => `<span class="mm-dow">${d[0]}</span>`).join('')}${cells}</div>
    </div>`;
  }

  function upcomingHTML() {
    const now = new Date();
    const until = addDays(startOfDay(now), 7);
    const list = allEvents().filter(e => e.end > now && e.start < until).sort((a, b) => a.start - b.start).slice(0, 6);
    if (!list.length) return `<div class="upc-empty">Nothing in the next 7 days</div>`;
    return list.map(e => `<button class="upc" data-ev-side="${R().esc(e.id)}" style="--c:${colorOf(e.calId)}">
      <span class="bar"></span><span class="upc-meta"><span class="upc-t">${R().esc(e.title)}</span>
      <span class="upc-w">${sameDay(e.start, now) ? 'Today' : sameDay(e.start, addDays(now, 1)) ? 'Tomorrow' : DOW[e.start.getDay()]}${e.allDay ? '' : ' · ' + fmtTime(e.start)}</span></span></button>`).join('');
  }

  function renderSidebar(side) {
    if (!side) return;
    cal.side = side;
    if (R().state.ui.platform !== 'calendar') return;
    const hid = hidden();
    const cals = calendars();
    side.innerHTML = `
      <div class="cal-side">
        ${miniMonthHTML()}
        <div class="side-head" style="padding-top:14px"><div class="side-title" style="--c:var(--calendar)"><span class="dot"></span>Calendars</div></div>
        <div class="cal-list">
          ${cals.map(c => {
            const f = cal.feeds.get(c.id);
            const status = c.personal ? '' : !c.account.icsUrl ? `<button class="feed-link" data-addfeed="${c.id}">Add feed</button>` :
              f?.loading ? '<span class="feed-st">Syncing…</span>' : f?.error ? `<button class="feed-st err" data-feederr="${c.id}" title="${R().esc(f.error)}">Fix sync</button>` : '';
            return `<div class="cal-item" style="--c:${c.color}">
              <label class="cal-check"><input type="checkbox" data-vis="${c.id}" ${hid.has(c.id) ? '' : 'checked'}><span class="box">${ic('check', 12)}</span></label>
              ${c.account ? R().avatarHTML(c.account, 'sm') : `<span class="cal-ico">${ic('calendar', 13)}</span>`}
              <span class="cal-name" title="${R().esc(c.sub)}">${R().esc(c.name)}</span>
              ${status}
              <button class="cal-color" data-color-for="${c.id}" title="Change color"></button>
            </div>`;
          }).join('')}
        </div>
        ${R().state.accounts.length ? '' : '<div class="cal-tip">Add accounts from the mail tabs, then paste each account’s calendar feed to see everything in one place.</div>'}
        <div class="side-head" style="padding-top:16px"><div class="side-title">Coming up</div></div>
        <div class="upcoming">${upcomingHTML()}</div>
      </div>`;

    $$('[data-mm]', side).forEach(b => b.onclick = () => { cal.cursor = new Date(b.dataset.mm + 'T00:00'); if (currentView() === 'month') cal.view = cal.view || 'month'; refresh(); });
    $$('[data-mmnav]', side).forEach(b => b.onclick = () => { cal.cursor = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth() + +b.dataset.mmnav, 1); refresh(); });
    $$('[data-vis]', side).forEach(cb => cb.onchange = () => {
      const set = hidden();
      cb.checked ? set.delete(cb.dataset.vis) : set.add(cb.dataset.vis);
      R().state.ui.hiddenCals = [...set];
      relay.saveUI({ hiddenCals: [...set] });
      render(cal.el); renderSidebar(side);
    });
    $$('[data-color-for]', side).forEach(b => b.onclick = (e) => {
      const id = b.dataset.colorFor;
      const r = b.getBoundingClientRect();
      R().popMenu(r.left, r.bottom + 6, [{ html: R().colorPickerHTML(colorOf(id)), mount: (m, close) => R().bindColorPicker(m, async (c) => {
        if (id === 'personal') { R().state.settings = await relay.saveSettings({ personalColor: c }); R().state.settings.personalColor = c; }
        else await R().updateAccount(id, { color: c });
        close(); refresh();
      }) }]);
    });
    $$('[data-addfeed]', side).forEach(b => b.onclick = () => R().openAccountModal(R().accountById(b.dataset.addfeed)));
    $$('[data-feederr]', side).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const a = R().accountById(b.dataset.feederr), f = cal.feeds.get(b.dataset.feederr);
      R().openModal({ title: `${a.name || a.email}: calendar didn’t sync`, subtitle: f?.error || '', icon: 'calendar', color: 'var(--calendar)', body: '',
        actions: [{ label: 'Close' }, { label: 'Try again', onClick: () => { cal.feeds.delete(a.id); refresh(true); } }, { label: 'Fix the link', cls: 'brand', onClick: () => setTimeout(() => R().openAccountModal(a), 50) }] });
    });
    $$('[data-ev-side]', side).forEach(b => b.onclick = () => showEvent(b.dataset.evSide, b));
  }

  function refresh(force) {
    if (R().state.ui.platform !== 'calendar') return;
    render(cal.el); renderSidebar(cal.side);
    loadFeeds(!!force);
  }

  function $(s, el = document) { return el.querySelector(s); }
  function $$(s, el = document) { return [...el.querySelectorAll(s)]; }

  let nowTimer = setInterval(() => { if (R()?.state.ui.platform === 'calendar' && currentView() !== 'month') render(cal.el); }, 60000);
  // keep account calendars fresh (every 15 minutes) and retry failed ones
  setInterval(() => { try { loadFeeds(true); } catch {} }, 15 * 60000);

  window.Calendar = {
    render: (el) => { render(el); loadFeeds(); },
    renderSidebar,
    refresh,
    newEvent: (o) => newEvent(o),
    invalidate: (id) => cal.feeds.delete(id),
    ensureFeeds: () => loadFeeds(),
    colorOf: (id) => colorOf(id),
    eventsBetween: (start, end) => allEvents().filter(e => e.start < end && (e.end > start || (+e.end === +e.start && e.start >= start)))
      .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start))
      .map(e => ({ ...e, color: colorOf(e.calId), calName: calendars().find(c => c.id === e.calId)?.name || '' })),
    fmtTime: (d) => fmtTime(d),
    open: (date) => { cal.cursor = startOfDay(date || new Date()); cal.view = 'day'; R().setPlatform('calendar'); },
    upcomingText: () => {
      const now = new Date(); const until = addDays(startOfDay(now), 8);
      const list = allEvents().filter(e => e.end > now && e.start < until).sort((a, b) => a.start - b.start);
      return list.map(e => `- ${e.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${e.allDay ? '(all day)' : fmtTime(e.start) + '–' + fmtTime(e.end)}: ${e.title}${e.location ? ' @ ' + e.location : ''} [${calendars().find(c => c.id === e.calId)?.name}]`).join('\n');
    }
  };
})();

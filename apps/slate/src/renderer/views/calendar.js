/* Slate — Calendar: annual fees, renewal decisions, credits about to reset, statement days, your own reminders */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt, save, modal, toast } = X;
  let month = null;
  const KIND = { fee: 'Annual fee', due: 'Payment due', renew: 'Keep or cancel', credit: 'Credit resets', stmt: 'Statement', custom: 'Reminder' };

  function editEvent(e, date) {
    const d = e ? { ...e } : { id: X.uid(), title: '', date: date || X.today(), repeat: 'none', amount: null };
    modal({
      title: e ? 'Edit reminder' : 'Add a reminder', sub: e ? '' : 'Bills, transfers, a 401(k) contribution change — anything with a date.',
      body: `<div class="field"><label>What</label><input class="input" id="evT" value="${esc(d.title)}" placeholder="e.g. Move $500 to savings"></div>
        <div class="grid3"><div class="field"><label>Date</label><input class="input" type="date" id="evD" value="${esc(d.date)}"></div>
        <div class="field"><label>Repeats</label><select class="input" id="evR">${X.opts([['none', 'Doesn’t repeat'], ['monthly', 'Every month'], ['yearly', 'Every year']], d.repeat)}</select></div>
        <div class="field"><label>Amount <span class="muted">(optional)</span></label><input class="input money" id="evA" value="${d.amount ?? ''}" placeholder="$0"></div></div>`,
      left: e ? `<button class="btn ghost danger" id="evDel">Delete</button>` : '',
      actions: [{ label: 'Cancel' }, { label: e ? 'Save' : 'Add reminder', cls: 'primary', onClick: (m) => {
        d.title = $('#evT', m).value.trim(); if (!d.title) { toast('Say what the reminder is for', 'error'); return false; }
        d.date = $('#evD', m).value || X.today(); d.repeat = $('#evR', m).value; d.amount = X.num($('#evA', m).value);
        const i = S.store.events.findIndex(x => x.id === d.id);
        if (i >= 0) S.store.events[i] = d; else S.store.events.push(d);
        save('events'); X.refresh();
      } }],
      onMount: (m, close) => $('#evDel', m)?.addEventListener('click', () => { S.store.events = S.store.events.filter(x => x.id !== d.id); save('events'); close(); X.refresh(); })
    });
  }

  function openEvent(ev) {
    if (ev.kind === 'custom') return editEvent(S.store.events.find(x => x.id === ev.eventId));
    if (ev.kind === 'stmt') return X.go('statements');
    if (ev.kind === 'due') return X.views.accounts.detail(X.account(ev.accountId));
    const w = S.store.wallet.find(x => x.id === ev.walletId);
    const c = w && X.card(w.cardId);
    if (!c) return;
    if (ev.kind === 'credit') {
      const cr = c.credits.find(x => x.id === ev.creditId);
      modal({ title: cr.name, sub: `${esc(X.views.cards.label(c, w))} · resets after ${X.dateLabel(ev.date)}`,
        body: `<p style="margin-top:0">${fmt(ev.amount, { cents: ev.amount % 1 !== 0 })} of ${fmt(cr.amount, { cents: cr.amount % 1 !== 0 })} is still unused this period.${cr.note ? ` <span class="muted">${esc(cr.note)}</span>` : ''}</p>`,
        actions: [{ label: 'Close' }, { label: 'Mark as used', cls: 'primary', onClick: () => {
          w.usage = (w.usage || []).filter(u => !(u.creditId === cr.id && u.period === ev.period));
          w.usage.push({ creditId: cr.id, period: ev.period, amount: cr.amount, date: ev.date < X.today() ? ev.date : X.today() });
          save('wallet'); toast('Marked as used'); X.refresh();
        } }] });
      return;
    }
    const fee = X.feeOn(w, ev.kind === 'fee' ? ev.date : X.addDays(ev.date, S.store.settings.renewalLeadDays ?? 45));
    const st = X.views.cards.cardYearStats(w);
    modal({
      title: ev.kind === 'fee' ? `${X.views.cards.label(c, w)} annual fee` : `Keep ${X.views.cards.label(c, w)}?`,
      sub: ev.kind === 'fee' ? `${fmt(fee)} posts around ${X.dateLabel(ev.date, true)}` : `The ${fmt(fee)} fee posts in ${S.store.settings.renewalLeadDays ?? 45} days.`,
      body: `<div class="row" style="gap:20px;align-items:flex-start">${X.ccHTML(c, 170)}<div>
        <div class="muted small">Credits used this card year</div><div class="mid">${fmt(st.captured)}</div>
        <p class="small" style="color:var(--text-2)">${st.captured >= fee ? `It has already covered its fee by ${fmt(st.captured - fee)}.` : `${fmt(fee - st.captured)} short of covering the fee so far.`} Before it renews you can ask the issuer about a retention offer, or move to a no-fee version of the card to keep the credit history.</p></div></div>`,
      actions: [{ label: 'Close' }, { label: 'Open in wallet', cls: 'primary', onClick: () => { X.views.cards.open('wallet'); X.go('cards'); } }]
    });
  }

  function render(el) {
    month = month || X.ym(new Date());
    const first = X.parse(X.monthStart(month));
    const lead = first.getDay();
    const gridStart = X.addDays(X.monthStart(month), -lead);
    const days = Array.from({ length: 42 }, (_, i) => X.addDays(gridStart, i));
    const weeks = days[35] > X.monthEnd(month) ? 5 : 6;
    const shown = days.slice(0, weeks * 7);
    const evs = X.eventsBetween(shown[0], shown[shown.length - 1]);
    const upcoming = X.eventsBetween(X.today(), X.addDays(X.today(), 60)).filter(e => e.kind !== 'credit' || X.daysBetween(X.today(), e.date) <= 14);
    const y = month.slice(0, 4);
    const yearFees = X.eventsBetween(`${y}-01-01`, `${y}-12-31`).filter(e => e.kind === 'fee');
    el.innerHTML = `<div class="page" style="max-width:1320px">
      <div class="row" style="align-items:flex-end"><div><h1>${X.monthLabel(month)}</h1><p class="lede">Annual fees, the day to decide on each card, credits that are about to reset, and your own reminders.</p></div><span class="spacer"></span>
        <div class="row" style="margin-bottom:26px"><button class="icon-btn" id="cPrev" title="Previous month">${ic('chevronLeft', 18)}</button><button class="btn sm" id="cToday">Today</button><button class="icon-btn" id="cNext" title="Next month">${ic('chevronRight', 18)}</button><button class="btn primary" id="cAdd">${ic('plus', 15)} Add reminder</button></div></div>
      <div class="cal-wrap">
        <div>
          <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('')}
          ${shown.map(d => { const list = evs.filter(e => e.date === d); const more = list.length - 3;
            return `<div class="day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === X.today() ? 'today' : ''}" data-day="${d}"><span class="dn">${Number(d.slice(8))}</span>
              ${list.slice(0, more > 0 ? 2 : 3).map(e => `<div class="ev ${e.kind}" data-ev="${evs.indexOf(e)}" title="${esc(e.title + (e.sub ? ' — ' + e.sub : ''))}">${e.amount && e.kind !== 'credit' ? `${fmt(e.amount)} ` : ''}${esc(e.title)}</div>`).join('')}
              ${more > 0 ? `<div class="ev more" data-more="${d}">+${more + 1} more</div>` : ''}</div>`; }).join('')}</div>
          <div class="legend" style="margin-top:12px">${Object.entries(KIND).map(([k, l]) => `<span><i style="--c:var(${{ fee: '--neg', due: '--s2', renew: '--warn', credit: '--pos', stmt: '--s1', custom: '--text-2' }[k]})"></i>${l}</span>`).join('')}</div>
        </div>
        <div>
          <h2>Next 60 days</h2>
          <div class="list-plain">${upcoming.slice(0, 14).map(e => `<div class="li click" data-up="${upcoming.indexOf(e)}" style="cursor:pointer"><div class="datebox"><b>${Number(e.date.slice(8))}</b><small>${X.MON[Number(e.date.slice(5, 7)) - 1]}</small></div>
            <div class="grow"><div class="t1">${esc(e.title)}</div><div class="t2">${esc(e.sub || KIND[e.kind])}</div></div>${e.amount && e.kind !== 'credit' ? `<b class="num">${fmt(e.amount)}</b>` : ''}</div>`).join('') || '<p class="muted small">Nothing coming up. Add cards to your wallet to see their fees here.</p>'}</div>
          <div class="section"><h2>Annual fees in ${y}</h2>
            ${yearFees.length ? `<div class="list-plain">${yearFees.map(e => `<div class="li"><div class="grow"><div class="t1">${esc(e.title.replace(' annual fee', ''))}</div><div class="t2">${X.dateLabel(e.date)}</div></div><b class="num">${fmt(e.amount)}</b></div>`).join('')}
              <div class="li"><div class="grow"><b>Total</b></div><b class="num">${fmt(yearFees.reduce((s, e) => s + e.amount, 0))}</b></div></div>` : '<p class="muted small">No annual fees this year.</p>'}</div>
        </div>
      </div></div>`;
    $('#cPrev', el).onclick = () => { month = X.addMonths(month, -1); render(el); };
    $('#cNext', el).onclick = () => { month = X.addMonths(month, 1); render(el); };
    $('#cToday', el).onclick = () => { month = X.ym(new Date()); render(el); };
    $('#cAdd', el).onclick = () => editEvent(null);
    $$('[data-ev]', el).forEach(b => b.onclick = (e) => { e.stopPropagation(); openEvent(evs[b.dataset.ev]); });
    $$('[data-up]', el).forEach(b => b.onclick = () => openEvent(upcoming[b.dataset.up]));
    $$('[data-more]', el).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const list = evs.filter(x => x.date === b.dataset.more);
      modal({ title: X.dateLabel(b.dataset.more, true), body: `<div class="list-plain">${list.map((x, i) => `<div class="li" data-i="${i}" style="cursor:pointer"><span class="ev ${x.kind}" style="width:6px;padding:0;height:30px"></span><div class="grow"><div class="t1">${esc(x.title)}</div><div class="t2">${esc(x.sub || KIND[x.kind])}</div></div>${x.amount ? `<b>${fmt(x.amount, { cents: x.amount % 1 !== 0 })}</b>` : ''}</div>`).join('')}</div>`,
        onMount: (m, close) => $$('[data-i]', m).forEach(r => r.onclick = () => { close(); setTimeout(() => openEvent(list[r.dataset.i]), 10); }) });
    });
    $$('[data-day]', el).forEach(d => d.ondblclick = () => editEvent(null, d.dataset.day));
  }

  X.views.calendar = { render };
})();

// Budget: what you planned, what's booked, what you've spent (in any currency, with your own rates so
// it works offline), spending by day, and who owes whom when you travel together.
'use strict';

VIEWS.budget = {
  head: () => `<h1>Budget <small>in ${esc(S.trip.currency)}</small></h1>`,
  actions: () => `<button class="btn" id="bgPlan"><span data-icon="edit" data-size="15"></span>Set budget</button><button class="btn primary" id="bgAdd"><span data-icon="plus" data-size="15"></span>Add expense</button>`,
  render(v) {
    const t = S.trip;
    const b = TL.budget(t);
    const pct = b.planned ? b.used / b.planned * 100 : 0;
    const spentPct = b.planned ? b.spent / b.planned * 100 : 0;
    const days = TL.dayList(t.start, t.end);
    const maxDay = Math.max(1, ...days.map(d => b.byDay[d] || 0));
    const dailyTarget = b.planned && days.length ? (b.planned - b.booked) / days.length : 0;
    const curs = [...new Set([t.localCurrency, ...t.bookings.map(x => x.currency), ...t.expenses.map(x => x.currency), ...Object.keys(t.rates || {})])].filter(c => c && c !== t.currency);
    const exp = t.expenses.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || 0);
    const cur0 = S.lastCur || t.localCurrency || t.currency;
    v.innerHTML = `
    <div class="bg-top">
      <div class="card bg-ring-card">
        <div class="ring" style="--p:${Math.min(100, pct)};--s:${Math.min(100, spentPct)}"><div><b>${b.planned ? Math.round(pct) + '%' : '—'}</b><span>${b.planned ? 'used' : 'no budget'}</span></div></div>
        <div class="bg-nums">
          <div><span>Budget</span><b>${b.planned ? esc(money(b.planned)) : '<button class="link-btn" id="bgSet">Set one</button>'}</b></div>
          <div><span><i class="sw booked"></i>Booked</span><b>${esc(money(b.booked))}</b></div>
          <div><span><i class="sw spent"></i>Spent there</span><b>${esc(money(b.spent))}</b></div>
          <div><span>${b.left < 0 ? 'Over by' : 'Left'}</span><b class="${b.left < 0 ? 'bad-t' : 'ok-t'}">${b.planned ? esc(money(Math.abs(b.left))) : '—'}</b></div>
          ${dailyTarget > 0 ? `<div class="bg-daily">${icon('sun', 14)}About <b>${esc(money(dailyTarget))}</b> a day after bookings</div>` : ''}
        </div>
      </div>
      <div class="card bg-cats">
        <div class="card-head"><b>By category</b><span class="muted small">bar = budget · striped = booked · solid = spent</span></div>
        ${Object.entries(TL.CATEGORIES).map(([k, c]) => { const x = b.cats[k]; const top = Math.max(x.plan, x.booked + x.spent, 1); if (!x.plan && !x.booked && !x.spent) return ''; return `<div class="cat-row ${c.tint}">${tile(c.tint, catIcon(k), 'sm', 14)}<span class="cat-l">${esc(c.label)}</span><div class="cat-bar"><i class="bk" style="width:${x.booked / top * 100}%"></i><i class="sp" style="left:${x.booked / top * 100}%;width:${x.spent / top * 100}%"></i>${x.plan ? `<em style="left:${x.plan / top * 100}%"></em>` : ''}</div><span class="cat-v ${x.plan && x.booked + x.spent > x.plan ? 'bad-t' : ''}">${esc(money(x.booked + x.spent))}${x.plan ? `<small> / ${esc(money(x.plan))}</small>` : ''}</span></div>`; }).join('') || '<div class="muted small">Add bookings with a cost or log expenses and they show up here.</div>'}
      </div>
    </div>

    ${days.length ? `<div class="card bg-days"><div class="card-head"><b>Spending by day</b>${dailyTarget > 0 ? `<span class="muted small">dashed line = daily budget</span>` : ''}</div>
      <div class="day-bars">${dailyTarget > 0 ? `<div class="db-target" style="bottom:calc(18px + (100% - 18px) * ${(dailyTarget / Math.max(maxDay, dailyTarget) / 1.08).toFixed(4)})"><span>${esc(money(dailyTarget))}/day</span></div>` : ''}${days.map((d, i) => { const v2 = b.byDay[d] || 0; const h = v2 / Math.max(maxDay, dailyTarget || 0) / 1.08 * 100; return `<div class="db" title="${esc(fmtDate(d))}: ${esc(money(v2))}"><i style="height:${h}%" class="${dailyTarget && v2 > dailyTarget ? 'over' : ''}"></i><span>${i + 1}</span></div>`; }).join('')}</div></div>` : ''}

    <div class="bg-bottom">
      <div class="card bg-exp">
        <div class="card-head"><b>Expenses</b><span class="muted small">${plural(t.expenses.length, 'entry', 'entries')}</span></div>
        <form class="quick-add" id="qa" autocomplete="off">
          <input class="input grow" name="title" placeholder="Coffee, taxi, museum…" required>
          <input class="input amt" name="amount" type="number" step="0.01" min="0" placeholder="0.00" required>
          <select class="select cur" name="currency">${[...new Set([t.localCurrency, t.currency, ...curs])].filter(Boolean).map(c => `<option ${c === cur0 ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <select class="select" name="category">${Object.entries(TL.CATEGORIES).map(([k, c]) => `<option value="${k}" ${k === (S.lastCat || 'food') ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
          ${t.travelers.length > 1 ? `<select class="select" name="paidBy">${t.travelers.map(p => `<option ${p === (S.lastPayer || t.travelers[0]) ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
          <button class="btn primary" type="submit">${icon('plus', 15)}</button>
        </form>
        <div class="exp-list">${exp.length ? exp.map(e => { const h = TL.toHome(e.amount, e.currency, t); const c = TL.CATEGORIES[e.category] || TL.CATEGORIES.other; return `<div class="exp-row" data-id="${e.id}">${tile(c.tint, catIcon(e.category), 'sm', 13)}<div class="grow" style="min-width:0"><b class="ellip">${esc(e.title)}</b><span>${esc(e.date ? fmtDate(e.date) : 'No date')}${e.paidBy ? ' · ' + esc(e.paidBy) + ' paid' : ''}</span></div><div class="exp-amt"><b>${esc(money(Number(e.amount), e.currency || t.currency))}</b>${e.currency && e.currency !== t.currency ? `<span>${h.ok ? '≈ ' + esc(money(h.v)) : 'no rate'}</span>` : ''}</div><button class="icon-btn xs" data-del="${e.id}" title="Delete">${icon('x', 13)}</button></div>`; }).join('') : '<div class="muted small" style="padding:10px 2px">Log spending as you go — it works offline, in any currency.</div>'}</div>
      </div>
      <div class="bg-side">
        <div class="card">
          <div class="card-head"><b>Exchange rates</b><span class="muted small">your own, so they work offline</span></div>
          ${curs.length ? curs.map(c => `<div class="rate-row ${b.missing.includes(c) ? 'missing' : ''}"><span>1 ${esc(c)} =</span><input class="input" type="number" step="any" min="0" data-rate="${c}" value="${esc(t.rates[c] || '')}" placeholder="?"><span>${esc(t.currency)}</span></div>`).join('') + (b.missing.length ? `<div class="hint bad-t" style="margin-top:6px">Add a rate for ${esc(b.missing.join(', '))} to count those amounts.</div>` : '') : '<div class="muted small">Everything is in ' + esc(t.currency) + '.</div>'}
        </div>
        ${t.travelers.length > 1 ? `<div class="card">
          <div class="card-head"><b>Splitting it</b><span class="muted small">evenly, expenses only</span></div>
          ${t.travelers.map(p => `<div class="split-row"><span class="grow">${esc(p)} paid</span><b>${esc(money(b.people[p] || 0))}</b></div>`).join('')}
          <div class="settle">${b.settle.length ? b.settle.map(s => `<div>${icon('arrowUp', 14)}<span class="grow"><b>${esc(s.from)}</b> owes <b>${esc(s.to)}</b></span><b>${esc(money(s.amount))}</b></div>`).join('') : `<div class="muted small">${icon('check', 13)} All square.</div>`}</div>
        </div>` : ''}
      </div>
    </div>`;
    const qa = $('#qa');
    qa.onsubmit = (e) => {
      e.preventDefault();
      const f = formVals(qa);
      if (!f.title || !(f.amount > 0)) return;
      const today = TL.localNow(t.tz).date;
      const date = days.includes(today) ? today : (S.view === 'budget' && S.day) || days[0] || today;
      t.expenses.push({ id: newId(), date, title: f.title, amount: f.amount, currency: f.currency, category: f.category, paidBy: f.paidBy || (t.travelers[0] || '') });
      S.lastCur = f.currency; S.lastCat = f.category; S.lastPayer = f.paidBy;
      persist(); render(); setTimeout(() => $('#qa [name=title]') && $('#qa [name=title]').focus(), 10);
    };
    $$('[data-rate]', v).forEach(i => i.onchange = () => { const n = Number(i.value); if (n > 0) t.rates[i.dataset.rate] = n; else delete t.rates[i.dataset.rate]; persist(); render(); });
    $$('[data-del]', v).forEach(bt => bt.onclick = () => { const e = t.expenses.find(x => x.id === bt.dataset.del); t.expenses = t.expenses.filter(x => x.id !== bt.dataset.del); persist(); render(); toast('Expense deleted', e.title, 'ok', 5000, [{ label: 'Undo', run: () => { t.expenses.push(e); persist(); render(); } }]); });
    $$('.exp-row', v).forEach(r => r.ondblclick = () => expenseSheet(t.expenses.find(x => x.id === r.dataset.id)));
    if ($('#bgSet')) $('#bgSet').onclick = () => planSheet();
  },
  after() { $('#bgPlan').onclick = () => planSheet(); $('#bgAdd').onclick = () => expenseSheet(); },
};
function catIcon(k) { return { flights: 'plane', stay: 'bed', transport: 'car', food: 'food', activities: 'ticket', shopping: 'bookmark', other: 'wallet' }[k] || 'wallet'; }

function planSheet() {
  const t = S.trip; const c = t.budget.categories || {};
  const el = openSheet(`<div class="sheet-head">${tile('a-sunset', 'wallet', 'md', 18)}<div class="grow"><h3>Trip budget</h3><div class="muted small">In ${esc(t.currency)}. Leave the total empty to use the sum of the categories.</div></div></div>
    <div class="sheet-body">
      <div class="field"><label>Total</label><input class="input" type="number" min="0" step="10" name="total" value="${esc(t.budget.total || '')}" placeholder="${esc(Object.values(c).reduce((a, x) => a + (Number(x) || 0), 0) || '')}"></div>
      <div class="grid2">${Object.entries(TL.CATEGORIES).map(([k, x]) => `<div class="field"><label>${esc(x.label)}</label><input class="input" type="number" min="0" step="10" name="c_${k}" value="${esc(c[k] || '')}"></div>`).join('')}</div>
    </div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">Save</button></div>`, { width: 520 });
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('#ok').onclick = () => {
    const f = formVals(el);
    t.budget = { total: Number(f.total) || 0, categories: Object.fromEntries(Object.keys(TL.CATEGORIES).map(k => [k, Number(f['c_' + k]) || 0])) };
    persist(); closeSheet(); render();
  };
}
function expenseSheet(e) {
  const t = S.trip, days = TL.dayList(t.start, t.end);
  const x = e ? { ...e } : { id: newId(), date: days.includes(TL.localNow(t.tz).date) ? TL.localNow(t.tz).date : days[0] || '', title: '', amount: '', currency: S.lastCur || t.localCurrency || t.currency, category: 'food', paidBy: t.travelers[0] || '' };
  const el = openSheet(`<div class="sheet-head">${tile('a-coral', 'wallet', 'md', 18)}<div class="grow"><h3>${e ? 'Edit expense' : 'Add expense'}</h3></div></div>
    <div class="sheet-body">
      <div class="field"><label>What</label><input class="input" name="title" value="${esc(x.title)}" placeholder="Dinner, taxi, tickets…"></div>
      <div class="grid3"><div class="field"><label>Amount</label><input class="input" type="number" step="0.01" min="0" name="amount" value="${esc(x.amount)}"></div>
        <div class="field"><label>Currency</label><select class="select" name="currency">${[...new Set([t.localCurrency, t.currency, ...PLACES.CURRENCIES])].filter(Boolean).map(c => `<option ${c === x.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Day</label><input class="input" type="date" name="date" value="${esc(x.date)}"></div></div>
      <div class="grid2"><div class="field"><label>Category</label><select class="select" name="category">${Object.entries(TL.CATEGORIES).map(([k, c]) => `<option value="${k}" ${k === x.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Paid by</label>${t.travelers.length ? `<select class="select" name="paidBy">${t.travelers.map(p => `<option ${p === x.paidBy ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : `<input class="input" name="paidBy" value="${esc(x.paidBy)}">`}</div></div>
    </div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">${e ? 'Save' : 'Add'}</button></div>`, { width: 520 });
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('#ok').onclick = () => {
    const f = formVals(el); if (!f.title || !(f.amount > 0)) return;
    Object.assign(x, f);
    const i = t.expenses.findIndex(q => q.id === x.id); if (i >= 0) t.expenses[i] = x; else t.expenses.push(x);
    S.lastCur = x.currency; persist(); closeSheet(); if (S.view !== 'budget') go('budget'); else render();
  };
}

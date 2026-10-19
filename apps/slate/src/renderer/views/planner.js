/* Slate — Planner: how much you meant to save each month, per account, versus what you actually saved */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt, save, toast } = X;
  let month = null;
  const plan = (m) => (S.store.plans[m] = S.store.plans[m] || {});

  function totals(m) {
    let planned = 0, saved = 0, reported = 0;
    const list = X.plannerAccounts();
    for (const a of list) {
      planned += plan(m)[a.id]?.planned || 0;
      const s = X.savedIn(a, m);
      if (s.value != null) { saved += s.value; reported++; }
    }
    return { planned, saved, reported, count: list.length };
  }

  function render(el) {
    month = month || X.ym(new Date());
    const list = X.plannerAccounts();
    const t = totals(month);
    const goal = S.store.settings.monthlyGoal || 0;
    const y = month.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => `${y}-${X.pad(i + 1)}`);
    const yt = months.map(m => totals(m));
    const yPlanned = yt.reduce((s, x) => s + x.planned, 0), ySaved = yt.reduce((s, x) => s + x.saved, 0);
    el.innerHTML = `<div class="page">
      <div class="row" style="align-items:flex-end"><div><h1>${X.monthLabel(month)}</h1><p class="lede">Set how much you plan to put into each account this month. Slate fills in what you actually saved from balance changes; type over it with your real contribution when you know it.</p></div><span class="spacer"></span>
        <div class="row" style="margin-bottom:26px"><button class="icon-btn" id="pPrev" title="Previous month">${ic('chevronLeft', 18)}</button><button class="btn sm" id="pNow">This month</button><button class="icon-btn" id="pNext" title="Next month">${ic('chevronRight', 18)}</button></div></div>
      ${list.length ? `
      <div class="plan-summary">
        <div><div class="k">Planned</div><div class="big" style="font-size:52px">${fmt(t.planned)}</div></div>
        <div><div class="k">Saved so far</div><div class="big" style="font-size:52px">${fmt(t.saved)}</div></div>
        <div><div class="k">${t.saved >= t.planned ? 'Ahead of plan' : 'Still to save'}</div><div class="mid ${t.saved >= t.planned ? 'pos' : ''}" style="margin-bottom:6px">${fmt(Math.abs(t.saved - t.planned))}</div></div>
        ${goal ? `<div><div class="k">Monthly goal</div><div class="mid" style="margin-bottom:6px">${fmt(goal)}</div></div>` : ''}
      </div>
      <div class="panel plan-table"><table class="t"><thead><tr><th>Account</th><th class="r">Planned</th><th class="r">Saved</th><th class="r">Difference</th><th>Progress</th></tr></thead><tbody>
      ${list.map(a => {
        const p = plan(month)[a.id] || {};
        const s = X.savedIn(a, month);
        const diff = s.value != null && p.planned ? s.value - p.planned : null;
        const pct = p.planned ? Math.max(0, Math.min(100, (s.value || 0) / p.planned * 100)) : 0;
        return `<tr><td><b>${esc(a.name)}</b><div class="muted small">${esc(a.institution || '')} · ${X.TYPES[a.type]?.label}</div></td>
          <td class="r"><input class="input money" data-plan="${a.id}" value="${p.planned ?? ''}" placeholder="$0" aria-label="Planned for ${esc(a.name)}"></td>
          <td class="r"><input class="input money" data-act="${a.id}" value="${s.value != null && !s.auto ? s.value : ''}" placeholder="${s.value != null ? fmt(s.value, { cents: s.value % 1 !== 0 }) : '—'}" aria-label="Saved in ${esc(a.name)}">
            <span class="auto-note">${s.auto ? (s.value != null ? 'From balance change' : 'Needs this month’s balance') : '<a href="#" data-auto="' + a.id + '" style="color:inherit">Typed in · use balance change</a>'}</span></td>
          <td class="r num ${diff == null ? 'muted' : diff >= 0 ? 'pos' : 'neg'}">${diff == null ? '—' : fmt(diff, { sign: true })}</td>
          <td class="meter-cell">${p.planned ? `<div class="meter"><i style="width:${pct}%"></i></div>` : '<span class="muted small">No plan</span>'}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${fmt(t.planned)}</td><td class="r">${fmt(t.saved)}</td><td class="r ${t.saved - t.planned >= 0 ? 'pos' : 'neg'}">${t.planned ? fmt(t.saved - t.planned, { sign: true }) : '—'}</td><td class="muted small">${t.reported} of ${t.count} accounts have this month’s numbers</td></tr></tfoot></table></div>
      <div class="row" style="margin-top:12px"><button class="btn sm" id="pCopy">${ic('copy', 14)} Copy ${X.monthLabel(X.addMonths(month, -1), true)} plan</button><button class="btn sm ghost" id="pFill">Use this plan for the rest of ${y}</button><span class="spacer"></span><button class="btn sm ghost" id="pUpd">${ic('edit', 14)} Update balances</button></div>
      <div class="section"><div class="section-head"><h2>${y}</h2><span class="muted small">${fmt(ySaved)} saved of ${fmt(yPlanned)} planned</span></div>
        <div class="chart-legend"><span><i class="box outline" style="--c:var(--text-2)"></i>Planned</span><span><i class="box" style="--c:var(--s3)"></i>Saved</span></div>
        <div id="pChart"></div></div>`
      : `<div class="empty"><h3>Nothing to plan yet</h3><p>The planner covers savings, investment and retirement accounts. Add them on the Accounts page, or tick “Include in the savings planner” on any account.</p><button class="btn primary" id="pAddAcc">${ic('plus', 15)} Add an account</button></div>`}
    </div>`;
    $('#pPrev', el).onclick = () => { month = X.addMonths(month, -1); render(el); };
    $('#pNext', el).onclick = () => { month = X.addMonths(month, 1); render(el); };
    $('#pNow', el).onclick = () => { month = X.ym(new Date()); render(el); };
    $('#pAddAcc', el)?.addEventListener('click', () => X.views.accounts.editAccount(null, () => render(el)));
    if (!list.length) return;
    const commit = () => { save('plans'); render(el); };
    $$('[data-plan]', el).forEach(inp => inp.onchange = () => { const p = plan(month); p[inp.dataset.plan] = { ...(p[inp.dataset.plan] || {}), planned: X.num(inp.value) }; commit(); });
    $$('[data-act]', el).forEach(inp => inp.onchange = () => { const p = plan(month); p[inp.dataset.act] = { ...(p[inp.dataset.act] || {}), actual: X.num(inp.value) }; commit(); });
    $$('[data-auto]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); const p = plan(month); if (p[a.dataset.auto]) p[a.dataset.auto].actual = null; commit(); });
    $('#pCopy', el).onclick = () => {
      const prev = S.store.plans[X.addMonths(month, -1)] || {};
      if (!Object.values(prev).some(v => v.planned)) return toast(`No plan in ${X.monthLabel(X.addMonths(month, -1))} to copy`, 'error');
      const p = plan(month); for (const [id, v] of Object.entries(prev)) if (v.planned != null) p[id] = { ...(p[id] || {}), planned: v.planned };
      commit(); toast('Plan copied');
    };
    $('#pFill', el).onclick = () => {
      const cur = plan(month); let m = X.addMonths(month, 1), n = 0;
      while (m.slice(0, 4) === y) { const p = plan(m); for (const [id, v] of Object.entries(cur)) if (v.planned != null) p[id] = { ...(p[id] || {}), planned: v.planned }; m = X.addMonths(m, 1); n++; }
      commit(); toast(n ? `Applied to the next ${n} month${n > 1 ? 's' : ''}` : 'This is the last month of the year');
    };
    $('#pUpd', el).onclick = () => X.views.accounts.updateAll();
    X.planChart($('#pChart', el), { months, planned: yt.map(x => x.planned || null), actual: yt.map(x => (x.reported ? x.saved : null)) });
  }

  X.views.planner = { render, totals };
})();

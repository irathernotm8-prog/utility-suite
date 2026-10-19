/* Slate — Overview: net worth, your cards, this month's plan, what's coming up, credit */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt } = X;

  function fan(el) {
    const fee = (w) => { const c = X.card(w.cardId); return c.annualFee ?? c.fee ?? 0; };
    // most premium card ends up on top of the fan
    const ws = X.wallet().filter(w => X.card(w.cardId)).sort((a, b) => fee(a) - fee(b)).slice(-5);
    if (!ws.length) {
      el.innerHTML = `<div class="fan-empty"><div><div style="margin-bottom:10px;color:var(--muted)">${ic('card', 28)}</div><b>Add the cards you carry</b><p class="small muted" style="margin:4px 0 12px">Fees go on your calendar and credits get tracked.</p><button class="btn sm" id="ovCards">Browse cards</button></div></div>`;
      $('#ovCards', el).onclick = () => { X.views.cards.open('catalog'); X.go('cards'); };
      return;
    }
    const n = ws.length;
    el.innerHTML = `<div class="fan" id="fan">${ws.map((w, i) => X.ccHTML(X.card(w.cardId), 250)).join('')}</div>`;
    const cards = $$('.cc', el);
    const place = (hover = -1) => cards.forEach((c, i) => {
      const mid = (n - 1) / 2, off = i - mid;
      const rot = off * (n > 3 ? 7 : 9), x = off * (n > 3 ? 46 : 62), y = Math.abs(off) * 8;
      const lift = hover === i ? -28 : 0;
      c.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y + lift}px)) rotate(${rot}deg)`;
      c.style.zIndex = hover === i ? 20 : i + 1;
    });
    place();
    cards.forEach((c, i) => { c.onmouseenter = () => place(i); c.onclick = () => { X.views.cards.open('wallet'); X.go('cards'); }; c.title = X.views.cards.label(X.card(ws[i].cardId), ws[i]); });
    $('#fan', el).onmouseleave = () => place();
  }

  function render(el) {
    const t = X.today();
    const now = X.netWorthAt(t);
    const m = X.ym(new Date());
    const prev = X.netWorthAt(X.monthEnd(X.addMonths(m, -1)));
    const yearAgo = X.netWorthAt(X.addDays(t, -365));
    const groups = X.byGroup(t);
    const assetGroups = ['cash', 'invest', 'retire', 'other'].filter(g => groups[g]);
    const assetTotal = assetGroups.reduce((s, g) => s + groups[g], 0);
    const plan = X.views.planner.totals(m);
    const up = X.eventsBetween(t, X.addDays(t, 45)).filter(e => e.kind !== 'credit' || X.daysBetween(t, e.date) <= 7).slice(0, 6);
    const creditLeft = X.eventsBetween(t, X.monthEnd(m)).filter(e => e.kind === 'credit').reduce((s, e) => s + e.amount, 0);
    const inbox = S.statements.filter(s => s.status === 'inbox').length;
    const name = (S.store.settings.name || '').split(' ')[0];
    const hasAny = X.accounts().length > 0;
    const stale = X.accounts().filter(a => { const l = X.latest(a); return !l || X.daysBetween(l.date, t) > 40; }).length;

    el.innerHTML = `<div class="page">
      <div class="hero">
        <div>
          <div class="label">${name ? `${esc(name)}’s net worth` : 'Net worth'}${now ? ` · ${X.dateLabel(t)}` : ''}</div>
          ${hasAny && now ? `<div class="big">${X.bigMoney(now.net)}</div>
            <div class="delta">
              ${prev ? `<span><b class="${now.net - prev.net >= 0 ? 'pos' : 'neg'}">${fmt(now.net - prev.net, { sign: true })}</b> since ${X.monthLabel(X.addMonths(m, -1), true).split(' ')[0]}</span>` : ''}
              ${yearAgo ? `<span><b class="${now.net - yearAgo.net >= 0 ? 'pos' : 'neg'}">${fmt(now.net - yearAgo.net, { sign: true })}</b> over the year</span>` : ''}
              <span>${fmt(now.assets)} assets${now.debts ? ` · ${fmt(now.debts)} owed` : ''}</span>
              ${X.views.connections.state().connected ? `<span><a href="#" id="ovSync" style="color:inherit">Balances updated ${X.views.connections.ago(X.views.connections.state().lastSync)}</a></span>` : ''}
            </div>
            ${assetTotal ? `<div class="split-bar" role="img" aria-label="Assets by type">${assetGroups.map(g => `<span style="--c:${X.GROUPS[g].color};flex:${groups[g]}" title="${X.GROUPS[g].label}: ${fmt(groups[g])}"></span>`).join('')}</div>
              <div class="split-legend">${assetGroups.map(g => `<span><span class="dot" style="--c:${X.GROUPS[g].color}"></span>${X.GROUPS[g].label} ${fmt(groups[g], { compact: true })}</span>`).join('')}</div>` : ''}`
          : `<div class="big muted">$0<span class="cents">.00</span></div>
            <p class="lede" style="margin-top:16px">Add your accounts to see everything in one number: checking, savings, your 401(k) and IRAs, minus what you owe.</p>
            <div class="row"><button class="btn primary" id="ovAdd">${ic('plus', 15)} Add an account</button><button class="btn" id="ovStmt">${ic('globe', 15)} Get statements</button></div>`}
        </div>
        <div id="ovFan"></div>
      </div>

      ${inbox || (hasAny && stale) ? `<div class="row wrap" style="margin-top:22px;gap:10px">
        ${inbox ? `<button class="chip" id="ovInbox">${ic('inbox', 14)} ${inbox} statement${inbox > 1 ? 's' : ''} to file</button>` : ''}
        ${hasAny && stale ? `<button class="chip" id="ovStale">${ic('edit', 14)} ${stale} balance${stale > 1 ? 's' : ''} older than 40 days</button>` : ''}</div>` : ''}

      <div class="section cols">
        <div>
          <div class="section-head"><h2>${X.MONTHS[new Date().getMonth()]} plan</h2><span class="spacer"></span><button class="btn sm ghost" data-go="planner">Open planner</button></div>
          ${plan.count ? `<div class="row" style="align-items:baseline;gap:8px"><span class="mid">${fmt(plan.saved)}</span><span class="muted">saved of ${fmt(plan.planned)} planned</span></div>
            <div class="meter" style="margin:12px 0 14px"><i style="width:${plan.planned ? Math.max(0, Math.min(100, plan.saved / plan.planned * 100)) : 0}%"></i></div>
            <div class="list-plain">${X.plannerAccounts().slice(0, 4).map(a => { const p = S.store.plans[m]?.[a.id]?.planned; const s = X.savedIn(a, m).value; return `<div class="li"><div class="grow"><div class="t1">${esc(a.name)}</div></div><span class="num small ${s != null && p && s >= p ? 'pos' : 'muted'}">${s != null ? fmt(s) : '—'} / ${p ? fmt(p) : '—'}</span></div>`; }).join('')}</div>`
          : '<p class="muted small">Add savings, investment or retirement accounts to plan each month.</p>'}
        </div>
        <div>
          <div class="section-head"><h2>Coming up</h2><span class="spacer"></span><button class="btn sm ghost" data-go="calendar">Calendar</button></div>
          ${creditLeft > 0 ? `<p class="small" style="margin:-4px 0 6px"><span class="pos">${fmt(creditLeft, { cents: creditLeft % 1 !== 0 })}</span> <span class="muted">in card credits resets by ${X.dateLabel(X.monthEnd(m))}</span></p>` : ''}
          <div class="list-plain">${up.map(e => `<div class="li" data-go="calendar" style="cursor:pointer"><div class="datebox"><b>${Number(e.date.slice(8))}</b><small>${X.MON[Number(e.date.slice(5, 7)) - 1]}</small></div><div class="grow"><div class="t1">${esc(e.title)}</div><div class="t2">${esc(e.sub || ({ fee: 'Annual fee', due: 'Payment due', stmt: 'Statement', custom: 'Reminder', credit: 'Credit resets', renew: 'Keep or cancel' })[e.kind])}</div></div>${e.amount && e.kind !== 'credit' ? `<b class="num">${fmt(e.amount)}</b>` : ''}</div>`).join('') || '<p class="muted small">Nothing in the next 45 days.</p>'}</div>
        </div>
        <div>
          <div class="section-head"><h2>Credit</h2><span class="spacer"></span><button class="btn sm ghost" data-go="credit">History</button></div>
          ${S.store.scores.length ? `<div style="display:grid;gap:8px">${X.BUREAUS.map(b => { const l = X.scoresFor(b.id); const cur = l[l.length - 1]; return `<div class="bureau compact" data-go="credit" style="cursor:pointer"><div class="b-name"><span class="dot" style="--c:${b.color}"></span>${b.label}<span class="spacer"></span><span class="muted small" style="font-weight:500">${cur ? X.dateLabel(cur.date) : ''}</span></div><div class="b-score">${cur ? cur.score : '<span class="muted" style="font-size:16px">No score yet</span>'}</div>${cur ? `<div class="b-meta">${X.scoreBand(cur.score)} · ${esc(cur.model)}</div>` : ''}</div>`; }).join('')}</div>`
          : `<p class="muted small">Log your Equifax, Experian and TransUnion scores whenever you check them.</p><button class="btn sm" id="ovScore">${ic('plus', 14)} Add scores</button>`}
        </div>
      </div></div>`;

    fan($('#ovFan', el));
    $$('[data-go]', el).forEach(b => b.onclick = () => X.go(b.dataset.go));
    $('#ovAdd', el)?.addEventListener('click', () => X.views.accounts.editAccount(null, () => render(el)));
    $('#ovStmt', el)?.addEventListener('click', () => X.go('browser'));
    $('#ovInbox', el)?.addEventListener('click', () => X.go('statements'));
    $('#ovSync', el)?.addEventListener('click', (e) => { e.preventDefault(); X.views.connections.refreshNow(false); });
    $('#ovStale', el)?.addEventListener('click', () => X.views.accounts.updateAll());
    $('#ovScore', el)?.addEventListener('click', () => X.views.credit.addScores());
  }

  X.views.overview = { render };
})();

/* Slate — Accounts: every account, its balance history, quick monthly balance updates */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt, save, modal, toast } = X;
  const INSTITUTIONS = ['Chase', 'American Express', 'Capital One', 'Citi', 'Bank of America', 'Discover', 'Wells Fargo', 'Barclays', 'Apple', 'Fidelity', 'Vanguard', 'Charles Schwab', 'Empower', 'Principal', 'Robinhood', 'Ally', 'Marcus', 'SoFi', 'US Bank', 'PNC', 'Truist', 'Navy Federal', 'USAA', 'Credit One'];
  const ORDER = ['cash', 'invest', 'retire', 'other', 'credit', 'loans'];

  function loginFor(inst) { const b = (S.store.browser.bookmarks || []).find(x => x.title.toLowerCase() === String(inst).toLowerCase()); return b ? b.url : ''; }

  function editAccount(a, onDone) {
    const isNew = !a;
    const d = a ? { ...a } : { id: X.uid(), name: '', institution: '', type: 'checking', last4: '', loginUrl: '', statementDay: '', balances: [] };
    modal({
      title: isNew ? 'Add an account' : 'Edit account',
      sub: isNew ? 'Checking, savings, a 401(k), an IRA, a loan — anything with a balance.' : '',
      body: `
        <div class="grid2">
          <div class="field"><label>Name</label><input class="input" id="aName" value="${esc(d.name)}" placeholder="e.g. Fidelity 401(k)"></div>
          <div class="field"><label>Type</label><select class="input" id="aType">${Object.entries(X.TYPES).map(([k, t]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Bank or provider</label><input class="input" id="aInst" list="instList" value="${esc(d.institution)}" placeholder="e.g. Fidelity"><datalist id="instList">${INSTITUTIONS.map(i => `<option value="${esc(i)}">`).join('')}</datalist></div>
          <div class="field"><label>Last 4 digits <span class="muted">(optional)</span></label><input class="input" id="aLast4" maxlength="4" value="${esc(d.last4 || '')}" placeholder="Helps match statements"></div>
        </div>
        ${isNew ? `<div class="grid2">
          <div class="field"><label>Current balance</label><input class="input money" id="aBal" placeholder="$0.00"><span class="hint" id="aBalHint">What it holds today.</span></div>
          <div class="field"><label>As of</label><input class="input" type="date" id="aDate" value="${X.today()}"></div>
        </div>` : ''}
        <div class="grid3">
          <div class="field"><label>Opened <span class="muted">(optional)</span></label><input class="input" type="date" id="aOpened" value="${esc(d.opened || '')}"></div>
          <div class="field"><label>Credit limit <span class="muted">(cards)</span></label><input class="input money" id="aLimit" value="${d.creditLimit ?? ''}" placeholder="—"></div>
          <div class="field"><label>Interest rate (APY)</label><input class="input money" id="aApy" value="${d.apy ?? ''}" placeholder="e.g. 4.1"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Sign-in page <span class="muted">(optional)</span></label><input class="input" id="aUrl" value="${esc(d.loginUrl || '')}" placeholder="Opens in Slate’s browser"></div>
          <div class="field"><label>Statement reminder <span class="muted">(optional)</span></label><select class="input" id="aDay"><option value="">No reminder</option>${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${Number(d.statementDay) === i + 1 ? 'selected' : ''}>Day ${i + 1} of each month</option>`).join('')}</select></div>
        </div>
        <label class="check"><input type="checkbox" id="aPlan" ${(d.inPlanner ?? (!X.TYPES[d.type]?.liability && d.type !== 'checking')) ? 'checked' : ''}> Include in the savings planner</label>`,
      left: isNew ? '' : `<button class="btn ghost danger" id="aDel">Delete account</button>`,
      actions: [{ label: 'Cancel' }, { label: isNew ? 'Add account' : 'Save', cls: 'primary', onClick: (m) => {
        d.name = $('#aName', m).value.trim();
        if (!d.name) { toast('Give the account a name', 'error'); return false; }
        d.type = $('#aType', m).value; d.institution = $('#aInst', m).value.trim(); d.last4 = $('#aLast4', m).value.trim();
        d.loginUrl = $('#aUrl', m).value.trim() || loginFor(d.institution); d.statementDay = Number($('#aDay', m).value) || null;
        d.inPlanner = $('#aPlan', m).checked;
        d.opened = $('#aOpened', m).value || null; d.creditLimit = X.num($('#aLimit', m).value); d.apy = X.num($('#aApy', m).value);
        if (isNew) {
          const b = X.num($('#aBal', m).value);
          if (b != null) d.balances = [{ date: $('#aDate', m).value || X.today(), amount: X.TYPES[d.type].liability ? Math.abs(b) : b, source: 'manual' }];
          S.store.accounts.push(d);
        } else Object.assign(a, d);
        save('accounts');
        toast(isNew ? `Added ${d.name}` : 'Saved');
        onDone?.(d);
      } }],
      onMount: (m) => {
        const hint = () => { const h = $('#aBalHint', m); if (h) h.textContent = X.TYPES[$('#aType', m).value].liability ? 'What you owe today.' : 'What it holds today.'; };
        $('#aType', m).onchange = () => { hint(); $('#aPlan', m).checked = !X.TYPES[$('#aType', m).value].liability && $('#aType', m).value !== 'checking'; };
        $('#aDel', m)?.addEventListener('click', async () => {
          if (!await X.confirm(`Delete ${a.name}?`, 'Its balance history goes too. Statement files stay in your statements folder.')) return;
          S.store.accounts = S.store.accounts.filter(x => x.id !== a.id);
          for (const w of S.store.wallet) if (w.accountId === a.id) w.accountId = null;
          save('accounts', 'wallet'); X.refresh();
        });
      }
    });
  }

  // One screen to type in every balance — the monthly routine
  function updateAll() {
    const list = X.accounts();
    if (!list.length) return editAccount(null, () => X.refresh());
    modal({
      title: 'Update balances', wide: true,
      sub: 'Type what each account shows today. Leave a box empty to skip it.',
      body: `<div class="field" style="max-width:220px"><label>As of</label><input class="input" type="date" id="ubDate" value="${X.today()}"></div>
        <table class="t"><thead><tr><th>Account</th><th class="r">Last recorded</th><th class="r" style="width:180px">New balance</th></tr></thead><tbody>
        ${list.map(a => { const l = X.latest(a); return `<tr><td><b>${esc(a.name)}</b><div class="muted small">${esc(a.institution || '')} · ${X.TYPES[a.type]?.label || ''}</div></td>
          <td class="r">${l ? `${fmt(l.amount, { cents: true })}<div class="muted small">${X.dateLabel(l.date)}</div>` : '<span class="muted">—</span>'}</td>
          <td class="r"><input class="input money" data-ub="${a.id}" placeholder="${X.TYPES[a.type]?.liability ? 'Owed' : '$0.00'}"></td></tr>`; }).join('')}</tbody></table>`,
      actions: [{ label: 'Cancel' }, { label: 'Save balances', cls: 'primary', onClick: (m) => {
        const date = $('#ubDate', m).value || X.today();
        let n = 0;
        $$('[data-ub]', m).forEach(inp => {
          const v = X.num(inp.value); if (v == null) return;
          const a = X.account(inp.dataset.ub);
          a.balances = (a.balances || []).filter(b => !(b.date === date && b.source === 'manual'));
          a.balances.push({ date, amount: X.isLiability(a) ? Math.abs(v) : v, source: 'manual' }); n++;
        });
        save('accounts'); toast(n ? `Updated ${n} balance${n > 1 ? 's' : ''}` : 'Nothing changed'); X.refresh();
      } }]
    });
  }

  function detail(a) {
    const rows = X.balances(a).slice().reverse();
    modal({
      title: a.name, wide: true,
      sub: `${esc(a.institution || '')}${a.institution ? ' · ' : ''}${X.TYPES[a.type]?.label || ''}${a.last4 ? ' · ••' + esc(a.last4) : ''}${a.opened ? ` · opened ${X.dateLabel(a.opened, true)}` : ''}${a.creditLimit ? ` · ${fmt(a.creditLimit)} limit` : ''}${a.apy != null ? ` · ${a.apy}% APY` : ''}${a.card?.apr != null ? ` · ${a.card.apr}% APR` : a.apr != null ? ` · ${a.apr}% rate` : ''}${a.simplefin ? ' · updates automatically' : ''}`,
      body: `<div id="adChart" style="margin-bottom:18px"></div>
        <div class="section-head"><h2>Balance history</h2><span class="spacer"></span></div>
        <div class="row" style="margin-bottom:12px;gap:8px"><input class="input" type="date" id="adDate" value="${X.today()}" style="width:170px"><input class="input money" id="adAmt" placeholder="${X.isLiability(a) ? 'Amount owed' : 'Balance'}" style="width:170px"><button class="btn" id="adAdd">${ic('plus', 15)} Add</button></div>
        <div class="panel"><table class="t"><thead><tr><th>Date</th><th class="r">Balance</th><th>From</th><th></th></tr></thead><tbody>
        ${rows.map(b => `<tr><td>${X.dateLabel(b.date, true)}</td><td class="r">${fmt(b.amount, { cents: true })}</td><td class="muted">${b.source === 'statement' ? 'Statement' : 'Typed in'}</td><td class="r"><button class="icon-btn sm" data-del="${b.date}|${b.amount}|${b.statementId || ''}" title="Remove">${ic('trash', 14)}</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No balances yet. Add one above, or file a statement for this account.</td></tr>'}
        </tbody></table></div>`,
      left: `<button class="btn ghost" id="adEdit">${ic('edit', 14)} Edit account</button>${a.loginUrl ? `<button class="btn ghost" id="adOpen">${ic('globe', 14)} Open sign-in page</button>` : ''}`,
      actions: [{ label: 'Done', cls: 'primary', onClick: () => X.refresh() }],
      onMount: (m, close) => {
        const pts = X.balances(a).map(b => ({ x: b.date, y: b.amount }));
        if (pts.length > 1) X.lineChart($('#adChart', m), { series: [{ name: X.isLiability(a) ? 'Owed' : 'Balance', color: X.isLiability(a) ? 'var(--neg)' : 'var(--s1)', points: pts }], height: 200, yFmt: (v) => fmt(v, { compact: true }) });
        else $('#adChart', m).innerHTML = '<p class="muted small">Add a couple of balances over time to see a trend.</p>';
        $('#adAdd', m).onclick = () => { const v = X.num($('#adAmt', m).value); if (v == null) return toast('Type a balance', 'error'); a.balances = a.balances || []; a.balances.push({ date: $('#adDate', m).value || X.today(), amount: X.isLiability(a) ? Math.abs(v) : v, source: 'manual' }); save('accounts'); close(); detail(a); };
        $$('[data-del]', m).forEach(b => b.onclick = () => { const [d, amt, sid] = b.dataset.del.split('|'); const i = a.balances.findIndex(x => x.date === d && String(x.amount) === amt && String(x.statementId || '') === sid); if (i >= 0) a.balances.splice(i, 1); save('accounts'); close(); detail(a); });
        $('#adEdit', m).onclick = () => { close(); editAccount(a, () => X.refresh()); };
        $('#adOpen', m)?.addEventListener('click', () => { close(); X.go('browser'); X.views.browser.openTab(a.loginUrl); });
      }
    });
  }

  function render(el) {
    const list = X.accounts();
    const now = X.netWorthAt(X.today());
    el.innerHTML = `<div class="page">
      <div class="row" style="align-items:flex-end"><div><h1>Accounts</h1><p class="lede">${list.length ? `${list.length} account${list.length > 1 ? 's' : ''} · ${fmt(now?.assets || 0)} in assets${now?.debts ? `, ${fmt(now.debts)} owed` : ''}.` : 'Add your bank accounts, retirement accounts and loans. Balances come from statements you file or numbers you type in.'}</p></div>
        <span class="spacer"></span><div class="row" style="margin-bottom:26px">${list.length ? `<button class="btn" id="acUpd">${ic('edit', 15)} Update balances</button>` : ''}<button class="btn primary" id="acAdd">${ic('plus', 15)} Add account</button></div></div>
      <div id="plPanel">${X.views.connections.panelHTML()}</div>
      ${list.length ? `<div class="panel"><table class="t"><thead><tr><th>Account</th><th>Trend</th><th class="r">Balance</th><th class="r">Last updated</th><th></th></tr></thead><tbody>
        ${ORDER.filter(g => list.some(a => (X.TYPES[a.type]?.group || 'other') === g)).map(g => {
          const items = list.filter(a => (X.TYPES[a.type]?.group || 'other') === g);
          const total = items.reduce((s, a) => s + Math.abs(X.latest(a)?.amount || 0), 0);
          return `<tr class="grp"><td colspan="2"><span class="row" style="gap:8px"><span class="dot" style="--c:${X.GROUPS[g].color}"></span>${X.GROUPS[g].label}</span></td><td class="r">${fmt(total)}</td><td colspan="2"></td></tr>` +
            items.map(a => { const l = X.latest(a); const stale = l && !a.simplefin && X.daysBetween(l.date, X.today()) > 40;
              return `<tr class="click" data-acc="${a.id}"><td><b>${esc(a.name)}</b>${a.simplefin ? ` <span class="tag" title="Updates automatically through SimpleFIN" style="margin-left:4px">${ic('link', 11)} Auto</span>` : ''}<div class="muted small">${esc(a.institution || '')}${a.institution ? ' · ' : ''}${X.TYPES[a.type]?.label || ''}${a.last4 ? ' · ••' + esc(a.last4) : ''}</div></td>
                <td>${X.sparkline(X.balances(a).slice(-12).map(b => b.amount), { color: X.isLiability(a) ? 'var(--neg)' : 'var(--text-2)' })}</td>
                <td class="r num"><b>${l ? fmt(l.amount, { cents: true }) : '—'}</b>${a.creditLimit && l ? `<div class="muted small">${Math.round(Math.abs(l.amount) / a.creditLimit * 100)}% of ${fmt(a.creditLimit, { compact: true })}${a.type === 'credit' ? '' : ' left to pay'}</div>` : a.apy ? `<div class="muted small">${a.apy}% APY</div>` : ''}${a.card?.dueDate && a.card.dueDate >= X.today() ? `<div class="muted small">Due ${X.dateLabel(a.card.dueDate)}${a.card.minimumPayment ? ' · min ' + fmt(a.card.minimumPayment) : ''}</div>` : ''}</td>
                <td class="r ${stale ? '' : 'muted'}">${l ? `${X.dateLabel(l.date)}${stale ? ' <span class="tag" title="Over 40 days old">Due for an update</span>' : ''}` : '<span class="muted">No balance yet</span>'}</td>
                <td class="r"><button class="icon-btn sm" data-more="${a.id}" title="More">${ic('dots', 16)}</button></td></tr>`; }).join('');
        }).join('')}</tbody></table></div>` : `<div class="empty"><h3>No accounts yet</h3><p>The quickest way: download a statement from each bank in Slate’s browser (or drop the PDFs here). Slate creates every account it finds, including checking and savings bundled in one statement. Your credit report adds every card and loan with its open date.</p><div class="row"><button class="btn primary" id="acStmt">${ic('globe', 15)} Get statements</button><button class="btn" id="acRep">${ic('download', 15)} Import credit report</button><button class="btn ghost" id="acAdd2">${ic('plus', 15)} Add one by hand</button></div></div>`}
    </div>`;
    X.views.connections.bindPanel($('#plPanel', el));
    $('#acAdd', el).onclick = () => editAccount(null, () => X.refresh());
    $('#acAdd2', el)?.addEventListener('click', () => editAccount(null, () => X.refresh()));
    $('#acStmt', el)?.addEventListener('click', () => X.go('browser'));
    $('#acRep', el)?.addEventListener('click', () => X.views.importer.explain());
    $('#acUpd', el)?.addEventListener('click', updateAll);
    $$('[data-acc]', el).forEach(r => r.onclick = (e) => { if (e.target.closest('[data-more]')) return; detail(X.account(r.dataset.acc)); });
    $$('[data-more]', el).forEach(b => b.onclick = (e) => {
      const a = X.account(b.dataset.more), r = b.getBoundingClientRect();
      X.menu(r.left - 150, r.bottom + 4, [
        { label: 'Balance history', icon: 'trend', onClick: () => detail(a) },
        { label: 'Edit', icon: 'edit', onClick: () => editAccount(a, () => X.refresh()) },
        ...(a.loginUrl ? [{ label: 'Open sign-in page', icon: 'globe', onClick: () => { X.go('browser'); X.views.browser.openTab(a.loginUrl); } }] : []),
        { label: 'Statements', icon: 'inbox', onClick: () => X.go('statements', { account: a.id }) }
      ]);
    });
  }

  X.views.accounts = { render, editAccount, updateAll, detail };
})();

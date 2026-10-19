/* Slate — Statements: the inbox (downloads from Slate's browser, dropped files) and the filed archive */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt, toast } = X;
  const ui = { account: '', year: '' };
  const ext = (n) => (n.split('.').pop() || '').slice(0, 4).toUpperCase();

  function suggestedBalance(s, acc) {
    const p = s.parsed || {};
    if (p.owed != null) return Math.abs(p.owed);
    if (p.endingBalance == null) return null;
    return acc && X.isLiability(acc) ? Math.abs(p.endingBalance) : p.endingBalance;
  }

  function foundLine(s) {
    const p = s.parsed;
    if (s.parsing) return '<span class="muted">Reading the file…</span>';
    if (!p) return '';
    if (p.error) return `<span class="neg">${esc(p.error)}</span>`;
    const bits = [];
    if (p.kind === 'pdf') bits.push(`${p.pages} page${p.pages === 1 ? '' : 's'}`);
    if (p.transactions) bits.push(`${p.transactions} transactions${p.from ? ` from ${X.dateLabel(p.from)} to ${X.dateLabel(p.to)}` : ''}`);
    if (p.endingBalance != null || p.owed != null) bits.push(`Found ${p.owed != null ? 'amount owed' : (p.balanceLabel || 'ending balance')}: <b>${fmt(p.owed ?? p.endingBalance, { cents: true })}</b>${p.endingDate ? ` on ${X.dateLabel(p.endingDate, true)}` : ''}`);
    else if (p.kind === 'pdf' && p.textChars < 40) bits.push('This PDF is a scanned image, so type the balance in');
    else if (p.kind === 'pdf' || p.kind === 'csv') bits.push('No ending balance found, so type it in if you want it recorded');
    return bits.join(' · ');
  }

  const TYPE_LABEL = (t) => X.TYPES[t]?.label || 'Account';
  // a name for an account the statement found
  function detName(s, d) {
    if (d.name) return d.name;
    const p = s.parsed || {};
    if (d.type === 'credit') { const c = (p.products || [])[0] && X.card(p.products[0]); return c ? X.views.cards.label(c, { last4: d.last4, cardId: c.id }) : `${s.institution || 'Credit'} card${d.last4 ? ' ••' + d.last4 : ''}`; }
    return `${s.institution || ''} ${TYPE_LABEL(d.type)}`.trim();
  }
  const detBalance = (d) => (d.ending == null ? '' : (d.type === 'credit' || X.TYPES[d.type]?.liability ? Math.abs(d.ending) : d.ending).toFixed(2));
  function source(s) { return `${s.source === 'browser' ? `Downloaded${s.sourceHost ? ' from ' + esc(s.sourceHost.replace(/^www\./, '')) : ''}` : s.source === 'downloads' ? 'Picked up from Downloads' : 'Added'} · ${X.dateLabel(X.iso(new Date(s.addedAt)))}`; }

  // cards this statement shows being paid, that aren't in the wallet yet
  function suggestions(s) {
    const p = s.parsed || {};
    const out = [];
    for (const pc of p.paidCards || []) {
      if (pc.last4 && X.wallet().some(w => w.last4 === pc.last4)) continue;
      if (!pc.last4 && X.wallet().some(w => { const c = X.card(w.cardId); return c && (c.issuer === pc.issuer || (pc.issuer === 'Apple' && c.issuer === 'Goldman Sachs')); })) continue;
      out.push({ issuer: pc.issuer, last4: pc.last4, label: `${pc.issuer === 'Apple' ? 'Apple Card' : pc.issuer + ' card'}${pc.last4 ? ' ••' + pc.last4 : ''}` });
    }
    return out;
  }

  function itemHTML(s) {
    const p = s.parsed || {};
    const head = `<div class="fi">${esc(ext(s.name))}</div><div><div class="row" style="gap:8px"><b style="word-break:break-all">${esc(s.name)}</b>${s.exists ? '' : '<span class="tag neg">File missing</span>'}${p.report ? '<span class="tag accent">Credit report</span>' : ''}</div>
      <div class="muted small">${source(s)}</div>`;
    const tools = `<button class="icon-btn" data-open title="Open">${ic('eye', 16)}</button><button class="icon-btn" data-more title="More">${ic('dots', 16)}</button>`;
    if (s.parsing || p.error) return `<div class="inbox-item" data-s="${s.id}">${head}<div class="found">${foundLine(s)}</div></div><div class="row">${tools}</div></div>`;
    if (p.report) {
      const open = (p.tradelines || []).filter(t => !t.closed).length;
      return `<div class="inbox-item" data-s="${s.id}">${head}<div class="found">${(p.tradelines || []).length} accounts with open dates, limits and balances (${open} open)</div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-import>${ic('download', 15)} Review and import</button><button class="btn" data-file-report>File it</button></div></div><div class="row">${tools}</div></div>`;
    }
    const dets = p.accounts || [];
    const sugg = suggestions(s);
    if (!dets.length) {
      const acc = s.accountId ? X.account(s.accountId) : null;
      const bal = suggestedBalance(s, acc);
      return `<div class="inbox-item" data-s="${s.id}">${head}<div class="found">${foundLine(s)}</div>
        <div class="inbox-form">
          <div class="field"><label>Account</label><select class="input" data-f="account">${X.accountOptions(s.accountId, () => true, 'Choose an account')}<option value="__new">New account…</option></select></div>
          <div class="field"><label>Statement month</label><input class="input" type="month" data-f="period" value="${esc(s.period || '')}"></div>
          <div class="field"><label>${acc && X.isLiability(acc) ? 'Amount owed' : 'Ending balance'}</label><input class="input money" data-f="bal" value="${bal != null ? Number(bal).toFixed(2) : ''}" placeholder="Optional"></div>
          <div class="field"><label>&nbsp;</label><div class="row"><button class="btn primary" data-file>${ic('check', 15)} File it</button></div></div>
        </div></div><div class="row">${tools}</div></div>`;
    }
    return `<div class="inbox-item" data-s="${s.id}">${head}
      <div class="found">${dets.length > 1 ? `${dets.length} accounts in this statement` : 'Found'}${p.endingDate ? ` · statement ends ${X.dateLabel(p.endingDate, true)}` : ''}${p.card?.dueDate ? ` · payment due ${X.dateLabel(p.card.dueDate)}` : ''}${p.card?.annualFee ? ` · <span class="neg">annual fee ${fmt(p.card.annualFee.amount)} on this statement</span>` : ''}</div>
      <table class="t alloc" style="margin-top:10px"><thead><tr><th style="width:28px"></th><th>On the statement</th><th>Goes to</th><th class="r" style="width:150px">Balance</th></tr></thead><tbody>
      ${dets.map((d, i) => `<tr data-det="${i}"><td><input type="checkbox" data-inc checked aria-label="Include ${esc(detName(s, d))}"></td>
        <td><b>${esc(detName(s, d))}</b><div class="muted small">${esc(TYPE_LABEL(d.type))}${d.last4 ? ' · ••' + esc(d.last4) : ''}${d.apy != null ? ` · ${d.apy}% APY` : ''}${d.creditLimit ? ` · ${fmt(d.creditLimit)} limit` : ''}</div></td>
        <td><select class="input" data-to>${d.match ? '' : `<option value="__new" selected>New account: ${esc(detName(s, d))}</option>`}${X.accounts().map(a => `<option value="${a.id}" ${a.id === d.match ? 'selected' : ''}>${esc(a.name)}${a.last4 ? ' ••' + esc(a.last4) : ''}</option>`).join('')}${d.match ? `<option value="__new">New account: ${esc(detName(s, d))}</option>` : ''}</select></td>
        <td class="r"><input class="input money" data-bal value="${detBalance(d)}" placeholder="Optional"></td></tr>`).join('')}
      </tbody></table>
      <div class="row" style="margin-top:12px"><label class="small muted" style="display:flex;align-items:center;gap:8px">Statement month <input class="input" type="month" data-f="period" value="${esc(s.period || '')}" style="width:170px"></label><span class="spacer"></span><button class="btn primary" data-file-multi>${ic('check', 15)} File it</button></div>
      ${sugg.length ? `<div class="row wrap" style="margin-top:12px;gap:8px"><span class="small muted">Paid from this account:</span>${sugg.map((g, i) => `<button class="chip" data-sugg="${i}">${ic('plus', 13)} Add ${esc(g.label)} to my wallet</button>`).join('')}</div>` : ''}
      </div><div class="row">${tools}</div></div>`;
  }

  function render(el, arg) {
    if (arg?.account) ui.account = arg.account;
    const inbox = S.statements.filter(s => s.status === 'inbox');
    let filed = S.statements.filter(s => s.status === 'filed');
    const years = [...new Set(filed.map(s => (s.period || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    if (ui.account) filed = filed.filter(s => s.accountId === ui.account || (s.accountIds || []).includes(ui.account));
    if (ui.year) filed = filed.filter(s => (s.period || '').startsWith(ui.year));
    filed.sort((a, b) => ((b.period || '') > (a.period || '') ? 1 : (b.period || '') < (a.period || '') ? -1 : b.filedAt - a.filedAt));
    el.innerHTML = `<div class="page">
      <div class="row" style="align-items:flex-end"><div><h1>Statements</h1><p class="lede">Sign in to your bank in Slate’s browser and download a statement: it lands here. File it to an account and Slate records the ending balance for you.</p></div><span class="spacer"></span>
        <div class="row" style="margin-bottom:26px"><button class="btn" id="stFolder">${ic('folder', 15)} Open folder</button><button class="btn" id="stPick">${ic('upload', 15)} Add files…</button><button class="btn primary" id="stBrowser">${ic('globe', 15)} Get statements</button></div></div>

      <div class="section-head"><h2>Inbox</h2><span class="muted small">${inbox.length ? `${inbox.length} to file` : ''}</span></div>
      ${inbox.length ? `<div class="panel">${inbox.map(itemHTML).join('')}</div>`
      : `<div class="drop-zone">${ic('inbox', 22)}<div><b>Nothing waiting.</b> Downloads from Slate’s browser show up here, or drop PDF, CSV and OFX files anywhere in the window.</div></div>`}

      <div class="section"><div class="section-head"><h2>Filed</h2><span class="spacer"></span>
        <select class="input" id="stAcc" style="width:auto;height:30px">${X.accountOptions(ui.account, () => true, 'All accounts')}</select>
        <select class="input" id="stYear" style="width:auto;height:30px"><option value="">All years</option>${years.map(y => `<option ${y === ui.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        ${filed.length ? `<div class="panel"><table class="t"><thead><tr><th>Month</th><th>Account</th><th>File</th><th class="r">Balance recorded</th><th></th></tr></thead><tbody>
          ${filed.map(s => { const names = (s.accountIds?.length ? s.accountIds : [s.accountId]).map(id => X.account(id)?.name).filter(Boolean); return `<tr data-s="${s.id}"><td>${s.period ? X.monthLabel(s.period, true) : '—'}</td><td>${names.length ? names.map(esc).join('<br>') : '<span class="muted">No account</span>'}<div class="muted small">${esc(s.institution || '')}</div></td>
            <td class="muted small" style="word-break:break-all">${esc(s.name)}${s.exists ? '' : ' <span class="tag neg">Missing</span>'}</td><td class="r num">${(s.recordedAll?.length ? s.recordedAll : s.recorded ? [s.recorded] : []).map(r => fmt(r.amount, { cents: true })).join('<br>') || '<span class="muted">—</span>'}</td>
            <td class="r"><div class="row" style="justify-content:flex-end;gap:2px"><button class="icon-btn sm" data-open title="Open">${ic('eye', 15)}</button><button class="icon-btn sm" data-more title="More">${ic('dots', 15)}</button></div></td></tr>`; }).join('')}
          </tbody></table></div>` : `<p class="muted small">${S.statements.some(s => s.status === 'filed') ? 'No statements match those filters.' : 'Filed statements are listed here and sorted into folders by institution and year.'}</p>`}</div>
    </div>`;

    $('#stFolder', el).onclick = () => slate.statements.openFolder();
    $('#stPick', el).onclick = async () => { const n = await slate.statements.pick(); if (n) toast(`Added ${n} file${n > 1 ? 's' : ''} to your inbox`); };
    $('#stBrowser', el).onclick = () => X.go('browser');
    $('#stAcc', el).onchange = (e) => { ui.account = e.target.value; render(el); };
    $('#stYear', el).onchange = (e) => { ui.year = e.target.value; render(el); };

    $$('.inbox-item', el).forEach(row => {
      const s = S.statements.find(x => x.id === row.dataset.s);
      const p = s.parsed || {};
      $('[data-open]', row).onclick = () => slate.statements.open(s.id);
      $('[data-more]', row).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); X.menu(r.left - 170, r.bottom + 4, [
        { label: 'Show in Finder', icon: 'folder', onClick: () => slate.statements.show(s.id) },
        { label: 'Read it again', icon: 'refresh', onClick: () => slate.statements.reparse(s.id) },
        '-', { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => slate.statements.trash(s.id) }]); };
      // credit report
      $('[data-import]', row)?.addEventListener('click', () => X.views.importer.open(p.tradelines, { source: 'report' }));
      $('[data-file-report]', row)?.addEventListener('click', async () => { await slate.statements.file(s.id, { period: s.period || X.ym(new Date()), institution: 'Credit reports', allocations: [] }); toast('Filed under Credit reports'); });
      // cards seen being paid
      const sugg = suggestions(s);
      $$('[data-sugg]', row).forEach(b => b.onclick = () => { const g = sugg[b.dataset.sugg]; X.views.cards.chooseCard({ issuer: g.issuer, last4: g.last4 }); });
      // several accounts (or one we recognised)
      $('[data-file-multi]', row)?.addEventListener('click', async () => {
        const period = $('[data-f="period"]', row).value;
        if (!period) return toast('Pick the statement month', 'error');
        const allocations = $$('tr[data-det]', row).filter(tr => $('[data-inc]', tr).checked).map(tr => {
          const i = Number(tr.dataset.det), d = p.accounts[i], to = $('[data-to]', tr).value;
          return { index: i, accountId: to === '__new' ? null : to, create: to === '__new' ? { name: detName(s, d), type: d.type, institution: s.institution, last4: d.last4 } : null, amount: X.num($('[data-bal]', tr).value), date: d.closingDate || (p.endingDate && p.endingDate.startsWith(period) ? p.endingDate : X.monthEnd(period)) };
        });
        if (!allocations.length) return toast('Tick at least one account', 'error');
        try {
          const rec = await slate.statements.file(s.id, { period, allocations });
          const fresh = await slate.load(); S.store.accounts = fresh.accounts; S.store.wallet = fresh.wallet;
          // a new card account from a card statement that names the card → put the card in the wallet too
          const prod = (p.products || [])[0];
          allocations.forEach((al, k) => {
            const d = p.accounts[al.index];
            if (d.type !== 'credit' || !al.create || !prod) return;
            const accId = rec.accountIds[k];
            if (X.wallet().some(w => w.accountId === accId)) return;
            S.store.wallet.push({ id: X.uid(), cardId: prod, accountId: accId, last4: d.last4 || '', usage: [], feeMonth: p.card?.annualFee ? Number((p.card.annualFee.md || '').split('/')[0]) || Number(period.slice(5)) : null });
            X.save('wallet');
          });
          const created = allocations.filter(a => a.create).length;
          toast(`Filed · ${allocations.filter(a => a.amount != null).length} balance${allocations.length > 1 ? 's' : ''} recorded${created ? ` · ${created} new account${created > 1 ? 's' : ''}` : ''}`);
          X.renderNav();
        } catch (e) { toast(e.message, 'error'); }
      });
      // nothing recognised: the simple form
      const accSel = $('[data-f="account"]', row);
      if (!accSel) return;
      accSel.onchange = async () => {
        if (accSel.value === '__new') {
          accSel.value = s.accountId || '';
          X.views.accounts.editAccount(null, async (a) => { await slate.statements.update(s.id, { accountId: a.id }); });
          return;
        }
        await slate.statements.update(s.id, { accountId: accSel.value || null });
      };
      $('[data-file]', row).onclick = async () => {
        const accountId = accSel.value && accSel.value !== '__new' ? accSel.value : null;
        const period = $('[data-f="period"]', row).value;
        if (!period) return toast('Pick the statement month', 'error');
        const amount = X.num($('[data-f="bal"]', row).value);
        const acc = X.account(accountId);
        if (amount != null && !acc) return toast('Choose an account to record the balance on', 'error');
        try {
          await slate.statements.file(s.id, { accountId, period, recordBalance: amount != null ? { amount, date: p.endingDate && p.endingDate.startsWith(period) ? p.endingDate : X.monthEnd(period) } : null });
          toast(`Filed${acc ? ' to ' + acc.name : ''}${amount != null ? ` · ${fmt(amount, { cents: true })} recorded` : ''}`);
          if (amount != null) { const fresh = await slate.load(); S.store.accounts = fresh.accounts; }
        } catch (e) { toast(e.message, 'error'); }
      };
    });
    $$('tr[data-s]', el).forEach(row => {
      const s = S.statements.find(x => x.id === row.dataset.s);
      $('[data-open]', row).onclick = () => slate.statements.open(s.id);
      $('[data-more]', row).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); X.menu(r.left - 190, r.bottom + 4, [
        { label: 'Show in Finder', icon: 'folder', onClick: () => slate.statements.show(s.id) },
        { label: 'Move back to inbox', icon: 'inbox', onClick: async () => { await slate.statements.unfile(s.id); } },
        '-', { label: 'Move to Trash', icon: 'trash', danger: true, onClick: async () => { if (await X.confirm('Move this statement to the Trash?', s.recorded ? 'The balance it recorded is removed too.' : '', 'Move to Trash')) slate.statements.trash(s.id); } }]); };
    });
  }

  X.views.statements = { render };
})();

/* Slate — review what a credit report found (open dates, limits, balances) and fill in cards and accounts */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt, save, modal, toast } = X;
  const ISSUER_FOR_CATALOG = { Apple: 'Goldman Sachs' };
  const KIND_LABEL = { credit: 'Credit card', loan: 'Loan', 'auto-loan': 'Car loan', 'student-loan': 'Student loan', mortgage: 'Mortgage' };

  // What each tradeline should become
  function options(t) {
    if (t.kind !== 'credit') return [[`new:${t.kind}`, `Add as a ${KIND_LABEL[t.kind].toLowerCase()} account`], ['skip', 'Skip']];
    const issuer = ISSUER_FOR_CATALOG[t.issuer] || t.issuer;
    const wal = X.wallet().filter(w => { const c = X.card(w.cardId); return c && (!issuer || c.issuer === issuer); });
    const cat = X.allCards().filter(c => !issuer || c.issuer === issuer);
    return [
      ...wal.map(w => [`w:${w.id}`, `Update ${X.views.cards.label(X.card(w.cardId), w)} in my wallet`]),
      ...cat.map(c => [`c:${c.id}`, `Add ${c.issuer === 'American Express' ? 'Amex' : c.issuer} ${c.name}`]),
      ['acct', 'Just track the balance for now'], ['skip', 'Skip']
    ];
  }
  function guess(t, taken) {
    if (t.kind !== 'credit') return t.closed ? 'skip' : `new:${t.kind}`;
    if (t.closed) return 'skip';
    const issuer = ISSUER_FOR_CATALOG[t.issuer] || t.issuer;
    // same last 4 as a wallet card → update it
    const byLast4 = t.last4 && X.wallet().find(w => w.last4 === t.last4);
    if (byLast4) return `w:${byLast4.id}`;
    // same last 4 as an account → update that account
    const acc = t.last4 && X.accounts().find(a => a.last4 === t.last4);
    if (acc) return `a:${acc.id}`;
    // wallet card from this issuer that doesn't have an opened date yet
    const open = X.wallet().find(w => { const c = X.card(w.cardId); return c && c.issuer === issuer && !w.opened && !taken.has(w.id); });
    if (open) { taken.add(open.id); return `w:${open.id}`; }
    // only one card in the catalog from this issuer
    const cat = X.allCards().filter(c => c.issuer === issuer);
    if (cat.length === 1) return `c:${cat[0].id}`;
    return 'acct';
  }

  function open(lines, { source = 'credit report' } = {}) {
    if (!lines || !lines.length) {
      modal({ title: 'No accounts found', sub: `Slate couldn’t find any accounts with an opened date in that ${esc(source)}. Reports from annualcreditreport.com, Experian, Equifax, TransUnion and Credit Karma’s account pages work best.` });
      return;
    }
    const taken = new Set();
    const rows = lines.map((t, i) => ({ t, i, choice: guess(t, taken) }));
    const open = rows.filter(r => !r.t.closed).length;
    modal({
      title: `${lines.length} account${lines.length === 1 ? '' : 's'} found`, wide: true,
      sub: `${open} open, ${lines.length - open} closed. Choose what each one is and Slate fills in when it was opened, the credit line and the balance. Reports name the bank, not the exact card, so pick the card for each line.`,
      body: `<div class="panel" style="max-height:52vh;overflow:auto"><table class="t"><thead><tr><th></th><th>Lender</th><th>Opened</th><th class="r">Limit</th><th class="r">Balance</th><th style="width:38%">Becomes</th></tr></thead><tbody>
        ${rows.map(r => { const t = r.t; const opts = options(t);
          if (r.choice.startsWith('a:')) { const a = X.account(r.choice.slice(2)); opts.unshift([r.choice, `Update ${a.name}`]); }
          return `<tr data-r="${r.i}" style="${t.closed ? 'opacity:.6' : ''}"><td><input type="checkbox" data-inc ${r.choice !== 'skip' ? 'checked' : ''} aria-label="Import ${esc(t.creditor)}"></td>
          <td><b>${esc(t.issuer && t.kind === 'credit' ? (t.issuer === 'Apple' ? 'Apple Card' : t.issuer) : t.creditor.replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase()))}</b><div class="muted small">${t.issuer && t.kind === 'credit' ? esc(t.creditor) + ' · ' : ''}${esc(KIND_LABEL[t.kind] || 'Account')}${t.last4 ? ' · ••' + esc(t.last4) : ''}${t.closed ? ' · closed' : ''}${t.authorizedUser ? ' · authorized user' : ''}</div></td>
          <td style="white-space:nowrap">${X.dateLabel(t.opened, true)}</td><td class="r num">${t.limit ? fmt(t.limit) : '—'}</td><td class="r num">${t.balance != null ? fmt(t.balance) : '—'}</td>
          <td><select class="input" data-ch>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === r.choice ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="muted small" style="margin:12px 0 0">Balances are recorded as of today. Nothing is sent anywhere; the report stays on your computer.</p>`,
      actions: [{ label: 'Cancel' }, { label: 'Import', cls: 'primary', onClick: (m) => {
        const picks = $$('tr[data-r]', m).map(tr => ({ r: rows[tr.dataset.r], inc: $('[data-inc]', tr).checked, ch: $('[data-ch]', tr).value })).filter(p => p.inc && p.ch !== 'skip');
        const res = apply(picks);
        toast([res.added && `${res.added} card${res.added > 1 ? 's' : ''} added`, res.updated && `${res.updated} updated`, res.accounts && `${res.accounts} account${res.accounts > 1 ? 's' : ''} added`].filter(Boolean).join(' · ') || 'Nothing imported');
        X.refresh();
      } }],
      onMount: (m) => $$('tr[data-r]', m).forEach(tr => { $('[data-ch]', tr).onchange = (e) => { $('[data-inc]', tr).checked = e.target.value !== 'skip'; }; })
    });
  }

  function newAccount(t, name, type) {
    const a = { id: X.uid(), name, institution: t.issuer || t.creditor, type, last4: t.last4 || '', opened: t.opened, creditLimit: t.limit || null, balances: [], inPlanner: false };
    if (t.balance != null) a.balances.push({ date: X.today(), amount: Math.abs(t.balance), source: 'report' });
    S.store.accounts.push(a);
    return a;
  }
  function touchAccount(a, t) {
    if (!a) return;
    if (t.opened) a.opened = t.opened;
    if (t.limit) a.creditLimit = t.limit;
    if (!a.last4 && t.last4) a.last4 = t.last4;
    if (t.balance != null && !(a.balances || []).some(b => b.date === X.today())) { a.balances = a.balances || []; a.balances.push({ date: X.today(), amount: Math.abs(t.balance), source: 'report' }); }
  }
  function apply(picks) {
    const res = { added: 0, updated: 0, accounts: 0 };
    for (const { r, ch } of picks) {
      const t = r.t;
      if (ch.startsWith('w:')) {
        const w = S.store.wallet.find(x => x.id === ch.slice(2));
        w.opened = t.opened; if (!w.last4 && t.last4) w.last4 = t.last4;
        if (w.accountId) touchAccount(X.account(w.accountId), t);
        else { const c = X.card(w.cardId); w.accountId = newAccount(t, X.views.cards.label(c, w), 'credit').id; }
        res.updated++;
      } else if (ch.startsWith('c:')) {
        const c = X.card(ch.slice(2));
        const w = { id: X.uid(), cardId: c.id, opened: t.opened, last4: t.last4 || '', usage: [] };
        const existing = t.last4 && X.accounts().find(a => a.last4 === t.last4);
        w.accountId = existing ? (touchAccount(existing, t), existing.id) : newAccount(t, X.views.cards.label(c, w), 'credit').id;
        S.store.wallet.push(w); res.added++;
      } else if (ch.startsWith('a:')) { touchAccount(X.account(ch.slice(2)), t); res.updated++; }
      else if (ch === 'acct') { newAccount(t, `${t.issuer || t.creditor} card${t.last4 ? ' ••' + t.last4 : ''}`, 'credit'); res.accounts++; }
      else if (ch.startsWith('new:')) { const kind = ch.slice(4); newAccount(t, `${t.creditor.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase())} ${KIND_LABEL[kind].toLowerCase()}`, kind); res.accounts++; }
    }
    save('wallet', 'accounts');
    return res;
  }

  async function pickFile() {
    try { const lines = await slate.creditReport.pick(); if (lines) open(lines); }
    catch (e) { toast('Couldn’t read that report: ' + (e.message || e), 'error'); }
  }

  function explain() {
    modal({
      title: 'Fill in open dates from your credit report',
      sub: 'Your credit report lists every card and loan with the date it was opened, its limit and balance. It’s free once a week from each bureau and checking it doesn’t affect your score.',
      body: `<ol style="margin:0;padding-left:20px;color:var(--text-2);line-height:1.7">
        <li>Open <b>annualcreditreport.com</b> (or Credit Karma’s account pages) in Slate’s browser.</li>
        <li>Either click <b>Read accounts from this page</b> in the toolbar, or save the report as a PDF and choose it here.</li>
        <li>Check what each line becomes, then import.</li></ol>
        <p class="muted small" style="margin:14px 0 0">Bank accounts (checking, savings) aren’t on credit reports. Their open date is on the bank’s account details page; type it into the account.</p>`,
      actions: [{ label: 'Choose a report file…', onClick: () => { setTimeout(pickFile, 10); } }, { label: 'Open annualcreditreport.com', cls: 'primary', onClick: () => { X.go('browser'); X.views.browser.openTab('https://www.annualcreditreport.com'); } }]
    });
  }

  X.views.importer = { open, pickFile, explain };
})();

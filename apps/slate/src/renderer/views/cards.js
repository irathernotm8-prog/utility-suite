/* Slate — Cards: your wallet (fees, credits, is it paying for itself) and the card catalog */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt, save, modal, toast } = X;
  const ui = { tab: null, q: '', issuer: '', fee: 'any', best: '', reach: false, sort: 'fee' };
  const shortIssuer = (i) => (i === 'American Express' ? 'Amex' : i === 'Bank of America' ? 'BofA' : i);
  // "Chase Freedom Unlimited ••1234" — the last 4 (or a number) tells two of the same card apart
  const label = (c, w) => {
    if (w?.nickname) return w.nickname;
    const base = `${shortIssuer(c.issuer)} ${c.name}`;
    if (!w) return base;
    if (w.last4) return `${base} ••${w.last4}`;
    const same = X.wallet().filter(x => x.cardId === w.cardId);
    return same.length > 1 ? `${base} (${same.indexOf(w) + 1})` : base;
  };

  /* ---------- wallet ---------- */
  function cardYearStats(w) {
    const c = X.card(w.cardId);
    const cy = X.cardYear(w);
    const fee = X.feeOn(w, cy.start);
    const captured = X.capturedIn(w, cy.start, cy.end);
    const nextFeeDate = X.addDays(cy.end, 1); // the day after this card year ends is the next fee date
    return { c, cy, fee, captured, net: captured - fee, nextFee: { date: nextFeeDate, amount: X.feeOn(w, nextFeeDate) }, possible: X.creditYearValue(c) };
  }

  function creditTile(w, cr) {
    const p = X.periodOf(cr, w);
    const u = X.used(w, cr.id, p.key);
    const done = u >= cr.amount - 0.009, part = u > 0 && !done;
    const ends = X.daysBetween(X.today(), p.end);
    const when = cr.period === 'monthly' ? X.MON[Number(p.start.slice(5, 7)) - 1] : cr.period === 'quarterly' ? p.key.slice(5) : cr.period === 'semiannual' ? (p.key.endsWith('H1') ? 'Jan–Jun' : 'Jul–Dec') : cr.period === 'every4years' ? `through ${p.end.slice(0, 4)}` : cr.resets === 'cardmember' ? 'this card year' : p.key;
    const cents = cr.amount % 1 !== 0 || u % 1 !== 0;
    return `<div class="credit ${done ? 'done' : part ? 'part' : ''}" data-w="${w.id}" data-cr="${cr.id}" title="${esc(cr.name + (cr.note ? ' — ' + cr.note : ''))}">
      <button class="tick" data-tick aria-label="${done ? 'Mark unused' : 'Mark used'}: ${esc(cr.name)}">${ic(part ? 'minus' : 'check', 14)}</button>
      <div class="grow"><div class="c1">${esc(cr.name)}</div><div class="c2">${done ? `Used ${fmt(u, { cents })}` : part ? `${fmt(u, { cents })} of ${fmt(cr.amount, { cents })} used` : `${fmt(cr.amount, { cents })} available`} · ${esc(when)}${!done && ends <= 10 && ends >= 0 ? ` · <span class="neg">${ends === 0 ? 'ends today' : `${ends}d left`}</span>` : ''}</div></div>
      <button class="icon-btn sm" data-amt title="Enter an amount">${ic('edit', 13)}</button></div>`;
  }

  function setUsage(w, cr, amount) {
    const p = X.periodOf(cr, w);
    w.usage = (w.usage || []).filter(u => !(u.creditId === cr.id && u.period === p.key));
    if (amount > 0) w.usage.push({ creditId: cr.id, period: p.key, amount: Math.min(amount, cr.amount * 1.0), date: X.today() < p.end ? X.today() : p.end });
    save('wallet');
  }

  function renderWallet(el) {
    const list = X.wallet();
    if (!list.length) {
      el.innerHTML = `<div class="empty"><h3>Your wallet is empty</h3><p>Add the cards you carry. Slate puts each annual fee on your calendar, reminds you before it posts, and tracks the credits so you can see whether a card is paying for itself.</p><div class="row"><button class="btn primary" id="toCat">${ic('card', 15)} Browse the catalog</button><button class="btn" id="toRep">${ic('download', 15)} Add them from my credit report</button></div></div>`;
      $('#toCat', el).onclick = () => { ui.tab = 'catalog'; render($('#view')); };
      $('#toRep', el).onclick = () => X.views.importer.explain();
      return;
    }
    const totals = list.reduce((s, w) => { const st = cardYearStats(w); s.fees += st.fee; s.cap += st.captured; return s; }, { fees: 0, cap: 0 });
    el.innerHTML = `
      <div class="plan-summary">
        <div><div class="k">Annual fees, this card year</div><div class="mid">${fmt(totals.fees)}</div></div>
        <div><div class="k">Credits used so far</div><div class="mid">${fmt(totals.cap)}</div></div>
        <div><div class="k">Net</div><div class="mid ${totals.cap - totals.fees >= 0 ? 'pos' : 'neg'}">${fmt(totals.cap - totals.fees, { sign: true })}</div></div>
        <span class="spacer"></span>
        <div class="row" style="margin-bottom:6px">${list.some(w => !w.opened) ? `<span class="small muted">${list.filter(w => !w.opened).length} missing an open date</span>` : ''}<button class="btn" id="wImport">${ic('download', 15)} Fill in from credit report</button></div>
      </div>
      <div class="wallet">${list.map(w => {
        const st = cardYearStats(w), c = st.c;
        if (!c) return '';
        const pct = st.fee ? Math.min(100, st.captured / Math.max(st.fee, st.possible || st.fee) * 100) : 0;
        const feeMark = st.fee && st.possible ? Math.min(100, st.fee / Math.max(st.fee, st.possible) * 100) : 100;
        const acc = w.accountId ? X.account(w.accountId) : null;
        const owed = acc ? X.latest(acc) : null;
        return `<div class="panel wcard" data-wallet="${w.id}">
          ${X.ccHTML(c, 260)}
          <div>
            <div class="w-head"><div><div class="w-title">${esc(label(c, w))}</div><div class="muted small">${esc(c.issuer)} · ${esc(c.network)}${w.opened ? ` · opened ${X.dateLabel(w.opened, true)}` : ''}</div></div><span class="spacer"></span>
              <button class="icon-btn" data-wmenu="${w.id}" title="More">${ic('dots', 18)}</button></div>
            <div class="w-stats">
              <div><div class="k">Annual fee</div><div class="v">${st.nextFee.amount ? fmt(st.nextFee.amount) : '$0'}</div><div class="muted small">${!st.nextFee.amount ? 'no fee' : w.opened || w.feeMonth ? `next ${X.dateLabel(st.nextFee.date)}` : `<a href="#" data-setdate="${w.id}" style="color:var(--accent)">Add the open date</a>`}</div></div>
              <div><div class="k">Credits this card year</div><div class="v">${fmt(st.captured)}</div><div class="muted small">${st.possible ? `of ${fmt(st.possible)} a year` : 'no credits'}</div></div>
              ${owed ? `<div><div class="k">Balance</div><div class="v">${fmt(owed.amount, { cents: true })}</div><div class="muted small">${X.dateLabel(owed.date)}</div></div>` : '<div></div>'}
              <div></div>
            </div>
            ${st.fee ? `<div class="value-bar" title="${fmt(st.captured)} of credits used against a ${fmt(st.fee)} fee"><i style="width:${pct}%"></i><span class="fee-mark" style="left:calc(${feeMark}% - 1px)"></span></div>
              <div class="row small" style="margin-top:7px"><span class="${st.net >= 0 ? 'pos' : 'muted'}">${st.net >= 0 ? `Paid for itself, ${fmt(st.net)} ahead` : `${fmt(-st.net)} to go to cover the fee`}</span><span class="spacer"></span><span class="muted">Card year ${X.dateLabel(st.cy.start)} – ${X.dateLabel(st.cy.end)}</span></div>` : ''}
            ${(c.credits || []).length ? `<div class="credits">${c.credits.map(cr => creditTile(w, cr)).join('')}</div>` : ''}
          </div></div>`;
      }).join('')}</div>`;

    $('#wImport', el).onclick = () => X.views.importer.explain();
    $$('[data-setdate]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); editWallet(S.store.wallet.find(x => x.id === a.dataset.setdate)); });
    $$('.credit', el).forEach(t => {
      const w = S.store.wallet.find(x => x.id === t.dataset.w), c = X.card(w.cardId), cr = c.credits.find(x => x.id === t.dataset.cr);
      $('[data-tick]', t).onclick = () => { const p = X.periodOf(cr, w); setUsage(w, cr, X.used(w, cr.id, p.key) >= cr.amount - 0.009 ? 0 : cr.amount); renderWallet(el); };
      $('[data-amt]', t).onclick = () => {
        const p = X.periodOf(cr, w);
        modal({ title: cr.name, sub: `${esc(label(c, w))} · ${fmt(cr.amount, { cents: cr.amount % 1 !== 0 })} ${X.PERIOD_LABEL[cr.period]}${cr.note ? '<br>' + esc(cr.note) : ''}`,
          body: `<div class="field"><label>Used so far this period</label><input class="input money" id="crAmt" value="${X.used(w, cr.id, p.key) || ''}" placeholder="$0.00"></div>`,
          actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: (m) => { setUsage(w, cr, X.num($('#crAmt', m).value) || 0); renderWallet(el); } }] });
      };
    });
    $$('[data-wmenu]', el).forEach(b => b.onclick = () => {
      const w = S.store.wallet.find(x => x.id === b.dataset.wmenu), c = X.card(w.cardId), r = b.getBoundingClientRect();
      X.menu(r.left - 170, r.bottom + 4, [
        { label: 'Card details', icon: 'info', onClick: () => detail(c) },
        { label: 'Edit dates & account', icon: 'edit', onClick: () => editWallet(w) },
        { label: 'Change card image', icon: 'image', onClick: () => changeImage(c) },
        ...(w.accountId ? [{ label: 'Balance history', icon: 'trend', onClick: () => X.views.accounts.detail(X.account(w.accountId)) }] : []),
        '-',
        { label: 'Remove from wallet', icon: 'trash', danger: true, onClick: async () => {
          if (!await X.confirm(`Remove ${label(c, w)}?`, 'Its fee reminders and credit tracking go too. The linked account and its balances stay.', 'Remove')) return;
          S.store.wallet = S.store.wallet.filter(x => x.id !== w.id); save('wallet'); render($('#view'));
        } }
      ]);
    });
    $$('.wcard .cc', el).forEach(cc => cc.onclick = () => detail(X.card(cc.dataset.card)));
  }

  function editWallet(w, isNew) {
    const c = X.card(w.cardId);
    const creditAccts = X.accounts().filter(a => a.type === 'credit');
    modal({
      title: isNew ? `Add ${c.name}` : label(c, w),
      sub: isNew ? 'When you opened it decides when the annual fee posts and when your card year resets.' : '',
      body: `<div class="grid2">
          <div class="field"><label>Opened</label><input class="input" type="date" id="wOpen" value="${esc(w.opened || '')}"><span class="hint">Don’t know it? <a href="#" id="wReport" style="color:var(--accent)">Get it from your credit report</a></span></div>
          <div class="field"><label>Annual fee posts in</label><select class="input" id="wFeeM"><option value="">Same month it was opened</option>${X.MONTHS.map((m, i) => `<option value="${i + 1}" ${w.feeMonth === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Last 4 digits</label><input class="input" id="wLast4" maxlength="4" inputmode="numeric" value="${esc(w.last4 || '')}" placeholder="Tells two of the same card apart"></div>
          <div class="field"><label>Nickname <span class="muted">(optional)</span></label><input class="input" id="wNick" value="${esc(w.nickname || '')}" placeholder="${esc(label(c))}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Fee you actually pay <span class="muted">(optional)</span></label><input class="input money" id="wFee" value="${w.feeOverride ?? ''}" placeholder="${fmt(c.annualFee ?? c.fee ?? 0)}"><span class="hint">For retention offers or a different version.</span></div>
          <div></div>
        </div>
        <div class="field"><label>Balance tracking</label><select class="input" id="wAcc">
          ${isNew ? `<option value="__new">Create a credit card account for it</option>` : ''}
          <option value="">Don’t track the balance</option>
          ${creditAccts.map(a => `<option value="${a.id}" ${a.id === (w.accountId || (w.last4 && creditAccts.find(x => x.last4 === w.last4)?.id)) ? 'selected' : ''}>${esc(a.name)}${a.last4 ? ' ••' + esc(a.last4) : ''}</option>`).join('')}</select>
          <span class="hint">Lets statements for this card update what you owe.</span></div>`,
      actions: [{ label: 'Cancel' }, { label: isNew ? 'Add to wallet' : 'Save', cls: 'primary', onClick: (m) => {
        w.opened = $('#wOpen', m).value || null;
        w.feeMonth = Number($('#wFeeM', m).value) || null;
        w.nickname = $('#wNick', m).value.trim();
        w.last4 = $('#wLast4', m).value.replace(/\D/g, '').slice(-4);
        w.feeOverride = X.num($('#wFee', m).value);
        const acc = $('#wAcc', m).value;
        if (acc === '__new') {
          const a = { id: X.uid(), name: label(c, w), institution: c.issuer === 'Goldman Sachs' ? 'Apple' : c.issuer, type: 'credit', last4: w.last4 || '', opened: w.opened || null, balances: [], inPlanner: false };
          S.store.accounts.push(a); w.accountId = a.id; save('accounts');
        } else w.accountId = acc || null;
        if (isNew) S.store.wallet.push(w);
        save('wallet');
        toast(isNew ? `${label(c, w)} added to your wallet` : 'Saved');
        if (isNew) ui.tab = 'wallet';
        render($('#view'));
      } }],
      onMount: (m, close) => $('#wReport', m).onclick = (e) => { e.preventDefault(); close(); X.views.importer.explain(); }
    });
  }

  // Pick which card it is (used for cards spotted on statements: "Payment to Chase card ending in 1234")
  function chooseCard({ issuer, last4, title } = {}) {
    const iss = issuer === 'Apple' ? 'Goldman Sachs' : issuer;
    const list = X.allCards().filter(c => !iss || c.issuer === iss);
    modal({
      title: title || `Which ${issuer || ''} card is ${last4 ? '••' + last4 : 'it'}?`, wide: true,
      body: `<div class="catalog" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:18px">${list.map(c => `<button class="cat-item" data-pick="${esc(c.id)}">${X.ccHTML(c, 170)}<div class="ci-name small">${esc(c.name)}</div></button>`).join('')}</div>`,
      left: `<button class="btn ghost" id="ccOther">${ic('plus', 14)} It’s not listed</button>`,
      actions: [{ label: 'Cancel' }],
      onMount: (m, close) => {
        $$('[data-pick]', m).forEach(b => b.onclick = () => { close(); setTimeout(() => editWallet({ id: X.uid(), cardId: b.dataset.pick, last4: last4 || '', usage: [] }, true), 10); });
        $('#ccOther', m).onclick = () => { close(); setTimeout(() => editCustom(null, { issuer }), 10); };
      }
    });
  }

  /* ---------- catalog ---------- */
  function filtered() {
    const q = ui.q.trim().toLowerCase();
    const score = X.myScore();
    let list = X.allCards().filter(c => {
      if (q && !`${c.issuer} ${c.name} ${c.bestFor} ${c.network}`.toLowerCase().includes(q)) return false;
      if (ui.issuer && c.issuer !== ui.issuer) return false;
      const fee = c.annualFee ?? c.fee ?? 0;
      if (ui.fee === 'none' && fee > 0) return false;
      if (ui.fee === 'low' && (fee === 0 || fee > 100)) return false;
      if (ui.fee === 'premium' && fee <= 100) return false;
      if (ui.best) {
        if (ui.best === 'flat') { if ((c.rewards || []).length > 2 || !(c.rewards || []).some(r => r.cat === 'base' && r.rate >= 1.5)) return false; }
        else if (ui.best === 'build') { if (!/build|student/i.test(c.bestFor)) return false; }
        else { const r = (c.rewards || []).find(x => x.cat === ui.best); if (!r || r.rate < 3) return false; }
      }
      if (ui.reach && score && c.score && score < c.score[0]) return false;
      return true;
    });
    const fee = (c) => c.annualFee ?? c.fee ?? 0;
    list.sort(ui.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : ui.sort === 'issuer' ? (a, b) => a.issuer.localeCompare(b.issuer) || fee(a) - fee(b) : (a, b) => fee(a) - fee(b) || a.issuer.localeCompare(b.issuer));
    return list;
  }

  function renderCatalog(el) {
    const issuers = [...new Set(X.allCards().map(c => c.issuer))].sort();
    const score = X.myScore();
    const inWallet = new Set(X.wallet().map(w => w.cardId));
    const count = (id) => X.wallet().filter(w => w.cardId === id).length;
    const list = filtered();
    el.innerHTML = `
      <div class="toolbar" style="margin-bottom:10px">
        <div class="search">${ic('search', 15)}<input class="input" id="cq" placeholder="Search cards" value="${esc(ui.q)}"></div>
        <select class="input" id="ciss" style="width:auto"><option value="">All issuers</option>${issuers.map(i => `<option ${i === ui.issuer ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select>
        <select class="input" id="cbest" style="width:auto">${X.opts([['', 'Best for anything'], ['dining', 'Dining'], ['travel', 'Travel'], ['groceries', 'Groceries'], ['gas', 'Gas'], ['flat', 'Flat-rate cash back'], ['build', 'Building credit']], ui.best)}</select>
        <span class="spacer"></span>
        <select class="input" id="csort" style="width:auto">${X.opts([['fee', 'Sort by fee'], ['issuer', 'Sort by issuer'], ['name', 'Sort by name']], ui.sort)}</select>
        <button class="btn" id="cadd">${ic('plus', 15)} Add a card</button>
      </div>
      <div class="toolbar">
        <div class="seg" id="cfee">${[['any', 'Any fee'], ['none', 'No fee'], ['low', 'Up to $100'], ['premium', 'Premium']].map(([k, l]) => `<button data-f="${k}" class="${ui.fee === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${score ? `<label class="check small"><input type="checkbox" id="creach" ${ui.reach ? 'checked' : ''}> Within reach of my ${score}</label>` : ''}
      </div>
      <p class="muted small" style="margin:-8px 0 20px">${list.length} of ${X.allCards().length} cards · ${esc(S.catalogMeta.verifiedNote || '')}</p>
      <div class="catalog">${list.map(c => {
        const fee = c.annualFee ?? c.fee ?? 0;
        const out = score && c.score && score < c.score[0];
        return `<button class="cat-item" data-c="${esc(c.id)}">${X.ccHTML(c, 240)}
          <div><div class="ci-name">${esc(c.name)}</div>
          <div class="ci-meta"><span>${esc(shortIssuer(c.issuer))}</span>·<span class="ci-fee">${fee ? fmt(fee) + '/yr' : 'No annual fee'}</span>${c.firstYearFee === 0 && fee ? '<span class="tag">$0 first year</span>' : ''}${inWallet.has(c.id) ? `<span class="tag accent">${ic('check', 11)} In wallet${count(c.id) > 1 ? ' ×' + count(c.id) : ''}</span>` : ''}${out ? `<span class="tag" title="Usually needs ${c.score[0]}+">Needs ${c.score[0]}+</span>` : ''}</div>
          <div class="ci-meta">${esc(c.bestFor || '')}</div></div></button>`;
      }).join('') || '<div class="muted">No cards match those filters.</div>'}</div>`;
    let t;
    $('#cq', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.q = e.target.value; renderCatalog(el); $('#cq', el).focus(); const v = $('#cq', el); v.setSelectionRange(v.value.length, v.value.length); }, 140); };
    $('#ciss', el).onchange = (e) => { ui.issuer = e.target.value; renderCatalog(el); };
    $('#cbest', el).onchange = (e) => { ui.best = e.target.value; renderCatalog(el); };
    $('#csort', el).onchange = (e) => { ui.sort = e.target.value; renderCatalog(el); };
    $('#creach', el)?.addEventListener('change', (e) => { ui.reach = e.target.checked; renderCatalog(el); });
    $$('#cfee [data-f]', el).forEach(b => b.onclick = () => { ui.fee = b.dataset.f; renderCatalog(el); });
    $$('[data-c]', el).forEach(b => b.onclick = () => detail(X.card(b.dataset.c)));
    $('#cadd', el).onclick = () => editCustom();
  }

  function detail(c) {
    const fee = c.annualFee ?? c.fee ?? 0;
    const score = X.myScore();
    const inW = X.wallet().find(w => w.cardId === c.id);
    const cents = (n) => n % 1 !== 0;
    modal({
      title: `${c.issuer} ${c.name}`, wide: true,
      sub: `${esc(c.network)} · ${esc(c.currency || '')}`,
      body: `<div class="detail">
        <div>
          <div data-own-drop id="dImg" title="Drop an image here to replace the card art">${X.ccHTML(c, 300)}</div>
          <div class="row small" style="margin-top:10px;gap:6px"><button class="btn sm ghost" id="dFind">${ic('search', 14)} Find a better image</button><button class="btn sm ghost" id="dChange">${ic('image', 14)} From a file</button>${S.overrides[c.id] ? `<button class="btn sm ghost" id="dReset">Use original</button>` : ''}</div>
          ${c.imageNote && !S.overrides[c.id] ? `<p class="small" style="color:var(--warn);margin:8px 0 0">${esc(c.imageNote)}</p>` : ''}
          <div style="margin-top:20px">
            <div class="muted small">Annual fee</div><div class="mid">${fee ? fmt(fee) : '$0'}</div>
            ${c.firstYearFee === 0 && fee ? '<div class="small pos">$0 the first year</div>' : ''}${c.feeNote ? `<div class="small muted">${esc(c.feeNote)}</div>` : ''}
            <div class="muted small" style="margin-top:14px">Typical credit score</div>
            <div style="font-weight:650">${c.score ? `${c.score[0]}–${c.score[1]}` : '—'}</div>
            ${score && c.score ? `<div class="small ${score >= c.score[0] ? 'pos' : 'neg'}">Your ${score} is ${score >= c.score[0] ? 'in range' : 'below the usual range'}</div>` : ''}
          </div>
        </div>
        <div>
          <h2>Earning</h2>
          ${(c.rewards || []).length ? `<div class="rates">${c.rewards.map(r => `<div class="rate">${X.rateStr(r)}</div><div class="what"><b style="color:var(--text);font-weight:600">${esc(X.CAT_LABEL[r.cat] || r.cat)}</b>${r.label ? ` — ${esc(r.label)}` : ''}</div>`).join('')}</div>` : '<p class="muted">No rewards on this card.</p>'}
          ${(c.credits || []).length ? `<h2 style="margin-top:22px">Credits <span class="muted" style="font-weight:500">· worth up to ${fmt(X.creditYearValue(c))} a year</span></h2>
            <table class="t"><tbody>${c.credits.map(cr => `<tr><td style="padding-left:0">${esc(cr.name)}${cr.note ? `<div class="muted small">${esc(cr.note)}</div>` : ''}</td><td class="r">${fmt(cr.amount, { cents: cents(cr.amount) })}</td><td class="muted" style="white-space:nowrap">${X.PERIOD_LABEL[cr.period]}${cr.resets === 'cardmember' && cr.period === 'annual' ? ' (card year)' : ''}</td></tr>`).join('')}</tbody></table>` : ''}
          ${(c.perks || []).length ? `<h2 style="margin-top:22px">Also</h2><ul style="margin:0;padding-left:18px;color:var(--text-2)">${c.perks.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          ${c.note ? `<p class="small" style="margin-top:16px;color:var(--text-2)">${ic('info', 14)} ${esc(c.note)}</p>` : ''}
          ${(c.changes || []).length ? `<details style="margin-top:16px"><summary class="small muted" style="cursor:pointer">What changed from The Credit File</summary><ul class="small" style="color:var(--text-2);padding-left:18px">${c.changes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
        </div></div>`,
      left: `<button class="btn ghost" id="dWeb">${ic('external', 14)} Check the issuer’s page</button>${c.custom ? `<button class="btn ghost" id="dEdit">${ic('edit', 14)} Edit</button>` : ''}`,
      actions: inW ? [{ label: 'Add another', onClick: () => { setTimeout(() => editWallet({ id: X.uid(), cardId: c.id, usage: [] }, true), 10); } }, { label: 'Open in wallet', cls: 'primary', onClick: () => { ui.tab = 'wallet'; X.go('cards'); } }]
        : [{ label: 'Close' }, { label: 'Add to wallet', cls: 'primary', onClick: () => { setTimeout(() => editWallet({ id: X.uid(), cardId: c.id, usage: [] }, true), 10); } }],
      onMount: (m, close) => {
        const done = (p) => { if (!p) return; S.overrides[c.id] = p; toast('Card image updated'); close(); render($('#view')); detail(X.card(c.id)); };
        $('#dChange', m).onclick = async () => done(await slate.cardImage.set(c.id));
        $('#dFind', m).onclick = () => { close(); findImage(c); };
        $('#dReset', m)?.addEventListener('click', async () => { await slate.cardImage.reset(c.id); delete S.overrides[c.id]; close(); render($('#view')); detail(X.card(c.id)); });
        const zone = $('#dImg', m);
        zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drop-hint'); };
        zone.ondragleave = () => zone.classList.remove('drop-hint');
        zone.ondrop = async (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('drop-hint'); const f = e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) done(await slate.cardImage.set(c.id, slate.pathForFile(f))); };
        $('#dWeb', m).onclick = () => { close(); X.go('browser'); X.views.browser.openTab(`https://www.google.com/search?q=${encodeURIComponent(c.issuer + ' ' + c.name + ' credit card')}`); };
        $('#dEdit', m)?.addEventListener('click', () => { close(); editCustom(c); });
      }
    });
  }
  const changeImage = async (c) => { const p = await slate.cardImage.set(c.id); if (p) { S.overrides[c.id] = p; toast('Card image updated'); render($('#view')); } };

  function editCustom(existing, pre = {}) {
    const c = existing ? { ...existing } : { id: 'custom-' + X.uid(), custom: true, issuer: pre.issuer === 'Apple' ? 'Goldman Sachs' : (pre.issuer || ''), name: '', network: 'Visa', annualFee: 0, bestFor: '', rewards: [], credits: [], perks: [], score: null };
    modal({
      title: existing ? 'Edit card' : 'Add a card to the catalog',
      sub: existing ? '' : 'For cards that aren’t in the catalog yet. You can add the image afterwards.',
      body: `<div class="grid2"><div class="field"><label>Issuer</label><input class="input" id="xIss" value="${esc(c.issuer)}" placeholder="e.g. Chase"></div><div class="field"><label>Card name</label><input class="input" id="xName" value="${esc(c.name)}" placeholder="e.g. Ink Business Preferred"></div></div>
        <div class="grid3"><div class="field"><label>Network</label><select class="input" id="xNet">${X.opts(['Visa', 'Mastercard', 'Amex', 'Discover'].map(v => [v, v]), c.network)}</select></div><div class="field"><label>Annual fee</label><input class="input money" id="xFee" value="${c.annualFee || ''}" placeholder="$0"></div><div class="field"><label>Score range</label><input class="input" id="xScore" value="${c.score ? c.score.join('-') : ''}" placeholder="e.g. 700-850"></div></div>
        <div class="field"><label>Best for</label><input class="input" id="xBest" value="${esc(c.bestFor)}" placeholder="e.g. Business travel"></div>
        <div class="field"><label>Earning <span class="muted">(one per line, like “3x dining” or “2% everything”)</span></label><textarea class="input" id="xRew">${esc((c.rewards || []).map(r => `${X.rateStr(r)} ${r.cat === 'base' ? 'everything' : (X.CAT_LABEL[r.cat] || r.cat).toLowerCase()}`).join('\n'))}</textarea></div>
        <div class="field"><label>Credits <span class="muted">(one per line, like “$10 monthly Uber Cash” or “$300 annual travel”)</span></label><textarea class="input" id="xCred">${esc((c.credits || []).map(cr => `$${cr.amount} ${cr.period} ${cr.name}`).join('\n'))}</textarea></div>`,
      left: existing ? `<button class="btn ghost danger" id="xDel">Delete card</button>` : '',
      actions: [{ label: 'Cancel' }, { label: existing ? 'Save' : 'Add card', cls: 'primary', onClick: (m) => {
        c.issuer = $('#xIss', m).value.trim(); c.name = $('#xName', m).value.trim();
        if (!c.issuer || !c.name) { toast('Add the issuer and card name', 'error'); return false; }
        c.network = $('#xNet', m).value; c.annualFee = X.num($('#xFee', m).value) || 0; c.bestFor = $('#xBest', m).value.trim();
        const sc = $('#xScore', m).value.match(/(\d{3})\D+(\d{3})/); c.score = sc ? [Number(sc[1]), Number(sc[2])] : null;
        const catOf = (s) => { s = s.toLowerCase(); for (const [k, v] of Object.entries(X.CAT_LABEL)) if (s.includes(v.toLowerCase()) || s.includes(k)) return k; return /every|all|other/.test(s) ? 'base' : 'base'; };
        c.rewards = $('#xRew', m).value.split('\n').map(l => l.match(/([\d.]+)\s*(x|%)\s*(.*)/i)).filter(Boolean).map(mm => ({ cat: catOf(mm[3]), rate: Number(mm[1]), unit: mm[2].toLowerCase() === 'x' ? 'x' : '%', label: mm[3].trim() }));
        c.credits = $('#xCred', m).value.split('\n').map(l => l.match(/\$?([\d.]+)\s*(monthly|quarterly|semiannual|annual|yearly)?\s*(.*)/i)).filter(mm => mm && mm[3]).map((mm, i) => ({ id: 'c' + i, name: mm[3].trim(), amount: Number(mm[1]), period: (mm[2] || 'annual').toLowerCase().replace('yearly', 'annual'), resets: 'calendar' }));
        const i = S.store.customCards.findIndex(x => x.id === c.id);
        if (i >= 0) S.store.customCards[i] = c; else S.store.customCards.push(c);
        save('customCards'); render($('#view'));
        if (!existing) setTimeout(() => detail(c), 10);
      } }],
      onMount: (m, close) => $('#xDel', m)?.addEventListener('click', async () => {
        if (X.wallet().some(w => w.cardId === c.id)) return toast('Remove it from your wallet first', 'error');
        S.store.customCards = S.store.customCards.filter(x => x.id !== c.id); save('customCards'); close(); render($('#view'));
      })
    });
  }

  function render(el) {
    if (!ui.tab) ui.tab = X.wallet().length ? 'wallet' : 'catalog';
    el.innerHTML = `<div class="page">
      <div class="row" style="align-items:flex-end"><div><h1>Cards</h1><p class="lede">${ui.tab === 'wallet' ? 'The cards you carry, what their fees cost, and how much of their credits you’ve used this card year.' : `Every card from The Credit File, cleaned up and checked. Add one to your wallet to track its fee and credits.`}</p></div><span class="spacer"></span>
      <div class="seg" style="margin-bottom:26px"><button data-t="wallet" class="${ui.tab === 'wallet' ? 'on' : ''}">My wallet${X.wallet().length ? ` (${X.wallet().length})` : ''}</button><button data-t="catalog" class="${ui.tab === 'catalog' ? 'on' : ''}">All cards</button></div></div>
      <div id="cardsBody"></div></div>`;
    $$('[data-t]', el).forEach(b => b.onclick = () => { ui.tab = b.dataset.t; render(el); });
    (ui.tab === 'wallet' ? renderWallet : renderCatalog)($('#cardsBody', el));
  }

  // Look for official card art in Slate's browser; right-click an image → Use Image as Card Art…
  function findImage(c) {
    X.go('browser');
    X.views.browser.openTab(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${c.issuer} ${c.name} credit card art`)}`);
    pendingImageFor = c.id;
    toast('Right-click the image you want and choose “Use Image as Card Art…”');
  }
  let pendingImageFor = null;
  // A right-clicked image from the browser: confirm which card it's for
  function useCandidate({ url, page }) {
    const all = X.allCards();
    const guess = pendingImageFor || (all.find(c => (page || '').toLowerCase().includes(c.name.toLowerCase().replace(/ /g, '-'))) || {}).id || '';
    modal({
      title: 'Use this as card art?',
      body: `<div class="row" style="gap:22px;align-items:flex-start"><div class="cc" style="width:260px;--w:260px"><img src="${esc(url)}" alt="" style="object-fit:cover"></div>
        <div style="flex:1"><div class="field"><label>For which card</label><select class="input" id="cuCard">${all.map(c => `<option value="${esc(c.id)}" ${c.id === guess ? 'selected' : ''}>${esc(c.issuer)} ${esc(c.name)}</option>`).join('')}</select></div>
        <p class="muted small">Pick an image that shows just the card, straight on. Bigger is better: at least 500 pixels wide looks sharp.</p></div></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Use image', cls: 'primary', onClick: async (m) => {
        const id = $('#cuCard', m).value;
        const p = await slate.cardImage.fromUrl(id, url);
        S.overrides[id] = p; pendingImageFor = null;
        toast(`Card art updated for ${X.card(id).name}`);
      } }]
    });
  }

  X.views.cards = { render, detail, label, cardYearStats, chooseCard, useCandidate, editWallet, open(tab) { ui.tab = tab; } };
})();

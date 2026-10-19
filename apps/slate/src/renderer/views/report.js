/* Slate — Monthly report: one page per month, saved as a PDF */
(() => {
  const X = Slate;
  const { S, $, esc, fmt, save, toast } = X;
  let month = null;

  function data(m) {
    const end = X.monthEnd(m) > X.today() && X.monthStart(m) <= X.today() ? X.today() : X.monthEnd(m), prevEnd = X.monthEnd(X.addMonths(m, -1)), start = X.monthStart(m);
    const nw = X.netWorthAt(end), nwPrev = X.netWorthAt(prevEnd);
    const rows = X.accounts().map(a => ({ a, start: X.balanceAt(a, prevEnd), end: X.balanceAt(a, end) })).filter(r => r.start != null || r.end != null);
    const t = X.views.planner.totals(m);
    const planRows = X.plannerAccounts().map(a => ({ a, planned: S.store.plans[m]?.[a.id]?.planned || 0, saved: X.savedIn(a, m).value })).filter(r => r.planned || r.saved != null);
    const evs = X.eventsBetween(start, end);
    const fees = evs.filter(e => e.kind === 'fee');
    const upcoming = X.eventsBetween(X.addDays(end, 1), X.addDays(end, 90)).filter(e => e.kind === 'fee');
    const credits = X.wallet().map(w => {
      const c = X.card(w.cardId);
      const usedM = (w.usage || []).filter(u => u.date >= start && u.date <= end).reduce((s, u) => s + u.amount, 0);
      const st = X.views.cards.cardYearStats(w);
      return { w, c, usedM, st };
    }).filter(r => r.c && (r.usedM || (r.c.credits || []).length));
    const models = {}; S.store.scores.forEach(s => models[s.model] = (models[s.model] || 0) + 1);
    const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0];
    const scores = X.BUREAUS.map(b => {
      const l = X.scoresFor(b.id, model);
      const now = [...l].reverse().find(s => s.date <= end), before = [...l].reverse().find(s => s.date <= prevEnd);
      return { b, now, before };
    }).filter(r => r.now);
    const stmts = S.statements.filter(s => s.status === 'filed' && s.period === m);
    return { end, prevEnd, nw, nwPrev, rows, t, planRows, fees, upcoming, credits, model, scores, stmts };
  }

  function render(el) {
    month = month || X.addMonths(X.ym(new Date()), new Date().getDate() < 8 ? -1 : 0);
    const d = data(month);
    const name = S.store.settings.name;
    const change = d.nw && d.nwPrev ? d.nw.net - d.nwPrev.net : null;
    const feeTotal = d.fees.reduce((s, e) => s + e.amount, 0);
    const pctSaved = d.t.planned ? Math.round(d.t.saved / d.t.planned * 100) : null;
    el.innerHTML = `<div class="page">
      <div class="row no-print" style="align-items:flex-end"><div><h1>Monthly report</h1><p class="lede">A one-page summary for any month: net worth, planned versus saved, card fees and credits, and your credit scores.</p></div><span class="spacer"></span>
        <div class="row" style="margin-bottom:26px"><button class="icon-btn" id="rPrev" title="Previous month">${ic('chevronLeft', 18)}</button><span style="font-weight:650;min-width:120px;text-align:center">${X.monthLabel(month)}</span><button class="icon-btn" id="rNext" title="Next month">${ic('chevronRight', 18)}</button><button class="btn primary" id="rPdf">${ic('download', 15)} Save as PDF</button></div></div>
      <div class="report-doc">
        <h1>${X.monthLabel(month)}</h1>
        <div class="r-sub">Slate monthly report${name ? ` for ${esc(name)}` : ''} · balances as of ${X.dateLabel(d.end, true)}</div>
        <div class="kpis">
          <div><div class="k">Net worth</div><div class="v">${d.nw ? fmt(d.nw.net) : '—'}</div></div>
          <div><div class="k">Change from last month</div><div class="v ${change == null ? '' : change >= 0 ? 'pos' : 'neg'}">${change == null ? '—' : fmt(change, { sign: true })}</div></div>
          <div><div class="k">Saved vs planned</div><div class="v">${d.t.planned ? `${fmt(d.t.saved)}<span style="font-size:14px;color:#69727c"> of ${fmt(d.t.planned)}</span>` : d.t.reported ? fmt(d.t.saved) : '—'}</div></div>
          <div><div class="k">Card fees this month</div><div class="v">${fmt(feeTotal)}</div></div>
        </div>

        <h2>Accounts</h2>
        ${d.rows.length ? `<table class="t"><thead><tr><th>Account</th><th class="r">${X.dateLabel(d.prevEnd)}</th><th class="r">${X.dateLabel(d.end)}</th><th class="r">Change</th></tr></thead><tbody>
          ${d.rows.map(r => { const ch = r.start != null && r.end != null ? (r.end - r.start) * (X.isLiability(r.a) ? -1 : 1) : null; return `<tr><td>${esc(r.a.name)}<div class="small" style="color:#69727c">${X.TYPES[r.a.type]?.label}${X.isLiability(r.a) ? ' · owed' : ''}</div></td><td class="r">${fmt(r.start, { cents: true })}</td><td class="r">${fmt(r.end, { cents: true })}</td><td class="r ${ch == null ? '' : ch >= 0 ? 'pos' : 'neg'}">${ch == null ? '—' : fmt(ch, { sign: true, cents: true })}</td></tr>`; }).join('')}
          </tbody><tfoot><tr><td>Net worth</td><td class="r">${fmt(d.nwPrev?.net)}</td><td class="r">${fmt(d.nw?.net)}</td><td class="r">${change == null ? '—' : fmt(change, { sign: true })}</td></tr></tfoot></table>` : '<p class="small" style="color:#69727c">No balances recorded for this month.</p>'}

        <h2>Savings plan</h2>
        ${d.planRows.length ? `<table class="t"><thead><tr><th>Account</th><th class="r">Planned</th><th class="r">Saved</th><th class="r">Difference</th></tr></thead><tbody>
          ${d.planRows.map(r => `<tr><td>${esc(r.a.name)}</td><td class="r">${fmt(r.planned)}</td><td class="r">${fmt(r.saved)}</td><td class="r ${r.saved == null || !r.planned ? '' : r.saved >= r.planned ? 'pos' : 'neg'}">${r.saved == null || !r.planned ? '—' : fmt(r.saved - r.planned, { sign: true })}</td></tr>`).join('')}
          </tbody><tfoot><tr><td>Total</td><td class="r">${fmt(d.t.planned)}</td><td class="r">${fmt(d.t.saved)}</td><td class="r">${d.t.planned ? fmt(d.t.saved - d.t.planned, { sign: true }) : '—'}${pctSaved != null ? ` <span style="color:#69727c;font-weight:500">(${pctSaved}%)</span>` : ''}</td></tr></tfoot></table>` : '<p class="small" style="color:#69727c">No plan set for this month.</p>'}

        <h2>Credit cards</h2>
        ${d.credits.length || d.fees.length ? `<table class="t"><thead><tr><th>Card</th><th class="r">Credits used this month</th><th class="r">This card year</th><th class="r">Annual fee</th></tr></thead><tbody>
          ${d.credits.map(r => `<tr><td>${esc(X.views.cards.label(r.c, r.w))}</td><td class="r">${fmt(r.usedM, { cents: r.usedM % 1 !== 0 })}</td><td class="r">${fmt(r.st.captured)}</td><td class="r">${fmt(r.st.fee)}</td></tr>`).join('')}</tbody></table>
          ${d.fees.length ? `<p class="small" style="margin:10px 0 0">Fees posted this month: ${d.fees.map(e => `${esc(e.title.replace(' annual fee', ''))} ${fmt(e.amount)} (${X.dateLabel(e.date)})`).join(', ')}.</p>` : ''}
          ${d.upcoming.length ? `<p class="small" style="margin:6px 0 0;color:#46505b">Coming in the next 90 days: ${d.upcoming.map(e => `${esc(e.title.replace(' annual fee', ''))} ${fmt(e.amount)} on ${X.dateLabel(e.date)}`).join(', ')}.</p>` : ''}`
          : '<p class="small" style="color:#69727c">No cards in your wallet.</p>'}

        <h2>Credit score${d.model ? ` <span style="font:500 13px var(--font);color:#69727c">· ${esc(d.model)}</span>` : ''}</h2>
        ${d.scores.length ? `<table class="t"><thead><tr><th>Bureau</th><th class="r">Score</th><th class="r">Change</th><th>As of</th></tr></thead><tbody>
          ${d.scores.map(r => { const ch = r.before ? r.now.score - r.before.score : null; return `<tr><td>${r.b.label}</td><td class="r"><b>${r.now.score}</b></td><td class="r ${ch == null ? '' : ch >= 0 ? 'pos' : 'neg'}">${ch == null ? '—' : (ch > 0 ? '+' : ch < 0 ? '−' : '±') + Math.abs(ch)}</td><td>${X.dateLabel(r.now.date, true)}</td></tr>`; }).join('')}</tbody></table>`
          : '<p class="small" style="color:#69727c">No scores logged.</p>'}

        ${d.stmts.length ? `<h2>Statements filed</h2><p class="small" style="margin:0;color:#46505b">${d.stmts.map(s => esc(X.account(s.accountId)?.name || s.name)).join(' · ')}</p>` : ''}

        <h2>Notes</h2>
        <textarea class="input no-print" id="rNotes" placeholder="Anything worth remembering about this month: a bonus, a big purchase, a card you cancelled.">${esc(S.store.notes[month] || '')}</textarea>
        <div class="note-print" id="rNotesPrint" style="display:none">${esc(S.store.notes[month] || '')}</div>
      </div></div>`;
    $('#rPrev', el).onclick = () => { month = X.addMonths(month, -1); render(el); };
    $('#rNext', el).onclick = () => { month = X.addMonths(month, 1); render(el); };
    $('#rNotes', el).oninput = (e) => { S.store.notes[month] = e.target.value; $('#rNotesPrint', el).textContent = e.target.value; save('notes'); };
    $('#rPdf', el).onclick = async () => {
      const np = $('#rNotesPrint', el); np.style.display = S.store.notes[month] ? 'block' : 'none';
      const prevTheme = document.documentElement.dataset.theme;
      document.documentElement.dataset.theme = 'light';
      try { const p = await slate.reportPdf(month); toast(`Saved ${p.split(/[/\\]/).pop()}`); }
      catch (e) { toast('Couldn’t save the PDF', 'error'); }
      finally { document.documentElement.dataset.theme = prevTheme; np.style.display = 'none'; }
    };
  }

  X.views.report = { render, data };
})();

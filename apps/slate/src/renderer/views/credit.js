/* Slate — Credit score: one score per bureau, any date (so you can backfill), charted by scoring model */
(() => {
  const X = Slate;
  const { S, $, $$, esc, save, modal, toast } = X;
  const SOURCES = ['Credit Karma', 'Chase Credit Journey', 'Amex MyCredit Guide', 'Capital One CreditWise', 'Discover Credit Scorecard', 'Experian app', 'myFICO', 'Bank or card app', 'Lender'];
  let model = null;

  function modelsUsed() {
    const count = {};
    for (const s of S.store.scores) count[s.model] = (count[s.model] || 0) + 1;
    return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }

  function addScores(prefill = {}) {
    modal({
      title: 'Add credit scores',
      sub: 'Any date works, so you can fill in older scores too. Leave a bureau empty to skip it.',
      body: `<div class="grid3">
          <div class="field"><label>Date</label><input class="input" type="date" id="scD" value="${prefill.date || X.today()}" max="${X.today()}"></div>
          <div class="field"><label>Scoring model</label><select class="input" id="scM">${X.MODELS.map(m => `<option ${m === (prefill.model || model || 'FICO 8') ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="field"><label>Where you saw it</label><input class="input" id="scS" list="scSrc" value="${esc(prefill.source || '')}" placeholder="e.g. Credit Karma"><datalist id="scSrc">${SOURCES.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
        </div>
        <div class="grid3">${X.BUREAUS.map(b => `<div class="field"><label><span class="row" style="gap:7px"><span class="dot" style="--c:${b.color}"></span>${b.label}</span></label><input class="input" inputmode="numeric" data-b="${b.id}" placeholder="300–850"></div>`).join('')}</div>
        <p class="muted small" style="margin:0">Credit Karma shows VantageScore 3.0; most card apps show FICO 8. Slate charts each model separately so the lines stay comparable.</p>`,
      actions: [{ label: 'Cancel' }, { label: 'Save scores', cls: 'primary', onClick: (m) => {
        const date = $('#scD', m).value || X.today(), mdl = $('#scM', m).value, src = $('#scS', m).value.trim();
        let n = 0;
        for (const inp of $$('[data-b]', m)) {
          const v = Number(inp.value); if (!inp.value) continue;
          if (!(v >= 300 && v <= 900)) { toast(`${inp.value} isn’t a valid score`, 'error'); return false; }
          S.store.scores = S.store.scores.filter(s => !(s.date === date && s.bureau === inp.dataset.b && s.model === mdl));
          S.store.scores.push({ id: X.uid(), date, bureau: inp.dataset.b, score: v, model: mdl, source: src }); n++;
        }
        if (!n) { toast('Type at least one score', 'error'); return false; }
        model = mdl; save('scores'); toast(`Saved ${n} score${n > 1 ? 's' : ''}`); X.refresh();
      } }]
    });
  }

  function backfill() {
    modal({
      title: 'Paste a score history', wide: true,
      sub: 'One score per line: date, bureau, score, and optionally the model. Commas or tabs both work, so you can paste straight from a spreadsheet.',
      body: `<textarea class="input" id="bfT" style="min-height:200px;font-variant-numeric:tabular-nums" placeholder="2026-01-15, Equifax, 742, FICO 8&#10;2026-01-15, TransUnion, 738&#10;02/12/2026	Experian	751	VantageScore 3.0"></textarea>
        <div class="field" style="margin-top:12px;max-width:260px"><label>Model when a line doesn’t say</label><select class="input" id="bfM">${X.MODELS.map(m => `<option>${m}</option>`).join('')}</select></div>
        <div id="bfPrev" class="small muted"></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Add scores', cls: 'primary', onClick: (m) => {
        const rows = parseLines($('#bfT', m).value, $('#bfM', m).value);
        if (!rows.ok.length) { toast('No lines could be read', 'error'); return false; }
        for (const r of rows.ok) { S.store.scores = S.store.scores.filter(s => !(s.date === r.date && s.bureau === r.bureau && s.model === r.model)); S.store.scores.push({ id: X.uid(), ...r, source: 'Backfilled' }); }
        save('scores'); toast(`Added ${rows.ok.length} scores`); X.refresh();
      } }],
      onMount: (m) => { const upd = () => { const r = parseLines($('#bfT', m).value, $('#bfM', m).value); $('#bfPrev', m).innerHTML = r.ok.length || r.bad.length ? `${r.ok.length} line${r.ok.length === 1 ? '' : 's'} ready${r.bad.length ? ` · <span class="neg">${r.bad.length} couldn’t be read (line ${r.bad.slice(0, 5).join(', ')})</span>` : ''}` : ''; }; $('#bfT', m).oninput = upd; $('#bfM', m).onchange = upd; }
    });
  }
  function parseLines(text, defModel) {
    const ok = [], bad = [];
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const parts = line.split(/\t|,(?=\s*\S)/).map(s => s.trim()).filter(Boolean);
      const dateRaw = parts.find(p => /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(p));
      const b = X.BUREAUS.find(bb => parts.some(p => p.toLowerCase().replace(/\s/g, '').startsWith(bb.id.slice(0, 5))));
      const sc = parts.map(Number).find(n => n >= 300 && n <= 900);
      const mdl = X.MODELS.find(mm => parts.some(p => p.toLowerCase().replace(/\s/g, '') === mm.toLowerCase().replace(/\s/g, ''))) || (parts.some(p => /vantage/i.test(p)) ? 'VantageScore 3.0' : parts.some(p => /fico/i.test(p)) ? 'FICO 8' : defModel);
      let date = null;
      if (dateRaw) { const m1 = dateRaw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), m2 = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m1) date = `${m1[1]}-${X.pad(m1[2])}-${X.pad(m1[3])}`; else if (m2) date = `${m2[3].length === 2 ? '20' + m2[3] : m2[3]}-${X.pad(m2[1])}-${X.pad(m2[2])}`; }
      if (date && b && sc) ok.push({ date, bureau: b.id, score: sc, model: mdl }); else bad.push(i + 1);
    });
    return { ok, bad };
  }

  function render(el) {
    const used = modelsUsed();
    if (!model || !used.includes(model)) model = used[0] || 'FICO 8';
    const has = S.store.scores.length > 0;
    const series = X.BUREAUS.map(b => ({ name: b.label, color: b.color, points: X.scoresFor(b.id, model).map(s => ({ x: s.date, y: s.score, note: s.source || '' })) })).filter(s => s.points.length);
    const my = X.myScore();
    const inRange = my ? X.allCards().filter(c => c.score && my >= c.score[0]).length : 0;
    const hist = S.store.scores.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.bureau.localeCompare(b.bureau)));
    el.innerHTML = `<div class="page">
      <div class="row" style="align-items:flex-end"><div><h1>Credit score</h1><p class="lede">Log the score each bureau reports whenever you check it. Backfill older scores to see the longer trend.</p></div><span class="spacer"></span>
        <div class="row" style="margin-bottom:26px">${has ? `<button class="btn" id="crBf">Paste history…</button>` : ''}<button class="btn primary" id="crAdd">${ic('plus', 15)} Add scores</button></div></div>
      ${has ? `
        ${used.length > 1 ? `<div class="row wrap" style="margin-bottom:16px;gap:6px">${used.map(m => `<button class="chip ${m === model ? 'on' : ''}" data-m="${esc(m)}">${esc(m)}</button>`).join('')}</div>` : ''}
        <div class="bureaus">${X.BUREAUS.map(b => {
          const l = X.scoresFor(b.id, model); const cur = l[l.length - 1], prev = l[l.length - 2];
          const d = cur && prev ? cur.score - prev.score : null;
          return `<div class="bureau"><div class="b-name"><span class="dot" style="--c:${b.color}"></span>${b.label}</div>
            ${cur ? `<div class="b-score">${cur.score}</div><div class="b-meta">${X.scoreBand(cur.score)}${d != null ? ` · <span class="${d >= 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</span> since ${X.dateLabel(prev.date)}` : ''}</div><div class="b-meta">${X.dateLabel(cur.date, true)}${cur.source ? ' · ' + esc(cur.source) : ''}</div>`
              : `<div class="b-score muted" style="font-size:28px;margin:16px 0 10px">No ${esc(model)} score</div><button class="btn sm" data-addb="${b.id}">Add one</button>`}</div>`;
        }).join('')}</div>
        <div class="section"><div class="section-head"><h2>${esc(model)} over time</h2></div>
          ${series.length ? `<div class="chart-legend">${series.map(s => `<span><i style="--c:${s.color}"></i>${s.name}</span>`).join('')}</div><div id="crChart"></div>` : ''}</div>
        ${my ? `<p class="small row" style="color:var(--text-2);gap:8px">${ic('card', 15)}<span>With an average of ${my}, you’re in the usual range for ${inRange} of the ${X.allCards().length} cards in the catalog. <a href="#" id="crCards" style="color:var(--accent)">See which ones</a></span></p>` : ''}
        <div class="section"><div class="section-head"><h2>History</h2><span class="muted small">${hist.length} score${hist.length === 1 ? '' : 's'}</span></div>
          <div class="panel"><table class="t"><thead><tr><th>Date</th><th>Bureau</th><th class="r">Score</th><th>Model</th><th>Source</th><th></th></tr></thead><tbody>
          ${hist.map(s => { const b = X.BUREAUS.find(x => x.id === s.bureau); return `<tr><td>${X.dateLabel(s.date, true)}</td><td><span class="row" style="gap:7px"><span class="dot" style="--c:${b.color}"></span>${b.label}</span></td><td class="r"><b>${s.score}</b></td><td class="muted">${esc(s.model)}</td><td class="muted">${esc(s.source || '')}</td><td class="r"><button class="icon-btn sm" data-del="${s.id}" title="Delete">${ic('trash', 14)}</button></td></tr>`; }).join('')}
          </tbody></table></div></div>`
      : `<div class="empty"><h3>No scores yet</h3><p>Add today’s scores from whichever app you use. If you have older screenshots or a spreadsheet, paste the whole history at once.</p><div class="row"><button class="btn primary" id="crAdd2">${ic('plus', 15)} Add scores</button><button class="btn" id="crBf2">Paste history…</button></div></div>`}
    </div>`;
    $('#crAdd', el).onclick = () => addScores();
    $('#crAdd2', el)?.addEventListener('click', () => addScores());
    $('#crBf', el)?.addEventListener('click', backfill);
    $('#crBf2', el)?.addEventListener('click', backfill);
    $$('[data-m]', el).forEach(b => b.onclick = () => { model = b.dataset.m; render(el); });
    $$('[data-addb]', el).forEach(b => b.onclick = () => addScores({ model }));
    $$('[data-del]', el).forEach(b => b.onclick = () => { S.store.scores = S.store.scores.filter(s => s.id !== b.dataset.del); save('scores'); render(el); });
    $('#crCards', el)?.addEventListener('click', (e) => { e.preventDefault(); X.views.cards.open('catalog'); X.go('cards'); });
    if (series.length && $('#crChart', el)) {
      const all = series.flatMap(s => s.points.map(p => p.y));
      X.lineChart($('#crChart', el), { series, height: 250, yMin: Math.max(300, Math.min(...all) - 20), yMax: Math.min(850, Math.max(...all) + 20), yFmt: (v) => String(Math.round(v)), xFmt: (d) => X.dateLabel(d, true) });
    }
  }

  X.views.credit = { render, addScores };
})();

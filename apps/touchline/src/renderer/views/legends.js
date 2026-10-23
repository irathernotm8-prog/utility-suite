// Touchline — Legends: the Football Hub Hall of Fame, with each player's career
// and their full historical record from Wikidata.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});
  let data = null;
  const load = async () => (data ||= await UI.api('legends'));
  const GROUPS = [['', 'All'], ['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['FWD', 'Forwards']];
  const posName = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

  const years = (p) => {
    const ys = p.career.flatMap((c) => [c.start, c.end]).map(Number).filter(Boolean);
    return ys.length ? `${Math.min(...ys)}–${Math.max(...ys)}` : '';
  };

  Views.legends = {
    card(p, club) {
      const sub = club ? (p.career.find((c) => c.club && c.club.toLowerCase().includes(String(club).toLowerCase().split(' ')[0])) || {}) : null;
      return `<div class="lg-card" data-go="legend:${p.id}">
        <div class="ph">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="ini">${esc(UI.initials(p.name))}</span>`}</div>
        <div class="cap"><b>${esc(p.name)}</b><small>${esc(sub && sub.start ? `${sub.start}–${sub.end || ''}` : `${posName[p.group] || ''} · ${p.nationality || ''}`)}</small></div>
      </div>`;
    },

    async render(el, _params, ctx) {
      el.innerHTML = UI.loading(6);
      const L = await load();
      if (!ctx.alive()) return;
      let group = '', nat = '', q = '';
      const nats = [...new Set(L.list.map((p) => p.nationality).filter(Boolean))].sort();
      el.innerHTML = `
        <div class="hero lg-hero" style="padding:22px 26px">
          <div style="color:var(--gold)">${icon('legend', 44)}</div>
          <div class="grow"><h1>Legends</h1><div class="sub">${L.list.length} retired greats. Open anyone for their club career, caps and goals.</div></div>
        </div>
        <div class="day-head">
          ${UI.seg(GROUPS, group, 'pos')}
          <select class="select" id="nat"><option value="">Every nation</option>${nats.map((n) => `<option>${esc(n)}</option>`).join('')}</select>
          <div class="grow"></div>
          <input class="input" id="lgq" placeholder="Find a legend" style="width:220px">
        </div>
        <div id="lg"></div>`;
      const draw = () => {
        const list = L.list.filter((p) => (!group || p.group === group) && (!nat || p.nationality === nat) && (!q || p.name.toLowerCase().includes(q) || p.career.some((c) => (c.club || '').toLowerCase().includes(q))));
        UI.$('#lg', el).innerHTML = list.length ? `<div class="legend-grid">${list.map((p) => Views.legends.card(p)).join('')}</div>` : UI.empty('No legends match', '', 'legend');
      };
      UI.onSeg(el, 'pos', (v) => { group = v; draw(); });
      UI.$('#nat', el).addEventListener('change', (e) => { nat = e.target.value; draw(); });
      UI.$('#lgq', el).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
      draw();
    }
  };

  Views.legend = {
    async render(el, params, ctx) {
      const L = await load();
      const p = L.list.find((x) => x.id === params[0]);
      if (!p) { el.innerHTML = UI.empty('Legend not found', '', 'legend'); return; }
      el.innerHTML = `
        <div class="hero lg-hero">
          ${p.photo ? `<img class="avatar lg" src="${esc(p.photo)}" alt="">` : UI.photo(null, p.name, 'lg')}
          <div class="grow">
            <h1>${esc(p.name)}</h1>
            <div class="sub"><span>${esc(posName[p.group] || p.position || '')}</span><span class="dot"></span><span>${esc(p.nationality || '')}</span>${years(p) ? `<span class="dot"></span><span>${esc(years(p))}</span>` : ''}</div>
            <div class="facts" id="lg-facts"></div>
          </div>
          <div class="actions" id="lg-actions"></div>
        </div>
        <div class="grid two">
          <div>
            <div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Club career</h3><span class="source-tag">Hall of Fame</span></div><div class="ctimeline">
              ${p.career.map((c) => `<div class="ct"><span class="yrs">${esc(c.start || '?')}–${esc(c.end || '')}</span><span></span><span class="nm">${esc(c.club)}</span><span></span></div>`).join('') || '<div class="muted" style="padding:10px 0">Not recorded</div>'}
            </div></div>
            ${p.national.length ? `<div class="card"><div class="card-head"><h3>International</h3></div><div class="ctimeline">${p.national.map((c) => `<div class="ct"><span class="yrs">${esc(c.start || '?')}–${esc(c.end || '')}</span><span>${UI.flag(null)}</span><span class="nm">${esc(c.team)}</span><span></span></div>`).join('')}</div></div>` : ''}
          </div>
          <div id="lg-wiki"><div class="card">${UI.empty('Looking up the historical record…', 'Appearances and goals for every club, from Wikidata.', 'history')}</div></div>
        </div>`;

      // FotMob profile (trophies, coaching career) if FotMob knows them
      UI.api('search', p.name).then((r) => {
        if (!ctx.alive()) return;
        const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const hit = r.players.find((x) => norm(x.name) === norm(p.name)) || (p.fotmobId ? { id: p.fotmobId } : null);
        if (hit) UI.$('#lg-actions', el).innerHTML = `<button class="btn" data-go="player:${hit.id}">${icon('arrowRight', 15)}Full profile & trophies</button>`;
      }).catch(() => {});

      try {
        const W = await UI.api('history', p.name, null);
        if (!ctx.alive()) return;
        const row = (c) => `<div class="ct compact"><span class="yrs">${esc(c.start || '?')}–${esc(c.end || '')}</span><div><span class="nm">${esc(c.team)}${c.loan ? ' <span class="source-tag">Loan</span>' : ''}</span><span class="nums small">${c.apps != null ? `${c.apps} apps · ${c.goals ?? 0} goals` : 'Appearances not recorded'}</span></div></div>`;
        if (!W.clubs.length && !W.national.length) { UI.$('#lg-wiki', el).innerHTML = `<div class="card">${UI.empty('No historical record found', '', 'history')}</div>`; return; }
        const club = W.clubs.reduce((a, c) => ({ apps: a.apps + (c.apps || 0), goals: a.goals + (c.goals || 0) }), { apps: 0, goals: 0 });
        const intl = W.national.reduce((a, c) => ({ apps: a.apps + (c.apps || 0), goals: a.goals + (c.goals || 0) }), { apps: 0, goals: 0 });
        UI.$('#lg-facts', el).innerHTML = [
          club.apps ? ['Club apps', club.apps] : null, club.goals ? ['Club goals', club.goals] : null,
          intl.apps ? ['Caps', intl.apps] : null, intl.apps ? ['Int. goals', intl.goals] : null,
          W.birth ? ['Born', UI.date(W.birth, { day: 'numeric', month: 'short', year: 'numeric' })] : null
        ].filter(Boolean).map(([k, v]) => `<div class="fact"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');
        UI.$('#lg-wiki', el).innerHTML = `<div class="card"><div class="card-head"><h3>Historical record</h3><span class="source-tag">Wikidata</span><button class="icon-btn" data-href="${esc(W.url)}" title="Open on Wikidata">${icon('external', 15)}</button></div>
          ${W.description ? `<div class="compare-note" style="border-top:0">${esc(W.description)}</div>` : ''}
          <div class="ctimeline">${W.clubs.map(row).join('')}</div>
          ${W.national.length ? `<div class="card-head" style="border-top:1px solid var(--line)"><h3>International</h3></div><div class="ctimeline">${W.national.map(row).join('')}</div>` : ''}
          ${W.youthNational.length ? `<div class="compare-note">Youth: ${W.youthNational.map((y) => `${esc(y.team)}${y.apps != null ? ` (${y.apps}/${y.goals ?? 0})` : ''}`).join(' · ')}</div>` : ''}
        </div>`;
      } catch (err) {
        if (ctx.alive()) UI.$('#lg-wiki', el).innerHTML = UI.error(err, 'the historical record');
      }
    }
  };
})();

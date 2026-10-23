// Touchline — Competitions: everything FotMob covers, grouped by country, with follow stars.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});

  const item = (l, sub = '') => `
    <div class="comp-item" data-go="league:${l.id}">
      ${UI.crest(l.logo || UI.leagueLogo(l.id), l.name)}
      <div class="nm">${esc(l.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <button class="icon-btn ${UI.following('leagues', l.id) ? 'on' : ''}" data-follow="leagues:${l.id}:${UI.attr(l.name)}" title="Follow">${icon(UI.following('leagues', l.id) ? 'starFill' : 'star', 16)}</button>
    </div>`;

  Views.leagues = {
    async render(el, _p, ctx) {
      el.innerHTML = `
        <div class="day-head"><h1>Competitions</h1><div class="grow"></div><input class="input" id="lq" placeholder="Find a competition or country" style="width:280px"></div>
        <div id="lbody">${UI.loading(6)}</div>`;
      let cat;
      try { cat = await UI.api('catalog', { force: ctx.force }); }
      catch (err) { UI.$('#lbody', el).innerHTML = UI.error(err, 'competitions'); return; }
      if (!ctx.alive()) return;
      const byId = new Map(cat.leagues.map((l) => [l.id, l]));
      let q = '';

      const draw = () => {
        const followed = UI.store.following.leagues || [];
        const match = (l) => !q || `${l.name} ${l.country}`.toLowerCase().includes(q);
        const groups = new Map();
        for (const l of cat.leagues) { if (!match(l)) continue; if (!groups.has(l.country)) groups.set(l.country, []); groups.get(l.country).push(l); }
        const countries = [...groups.keys()].sort((a, b) => (a === 'International' ? -1 : b === 'International' ? 1 : a.localeCompare(b)));
        UI.$('#lbody', el).innerHTML = `
          ${!q ? `<section class="section" style="margin-top:4px">
            <div class="section-head"><h2>Following</h2><span class="muted small">Use the arrows to set the order they appear in Matchday</span></div>
            ${followed.length ? `<div class="card follow-list">${followed.map((f, i) => {
              const l = byId.get(Number(f.id)) || { id: f.id, name: f.name, country: '' };
              return `<div class="set-row" style="padding:8px 14px">
                ${UI.crest(l.logo || UI.leagueLogo(l.id), l.name)}
                <div class="grow" style="cursor:pointer" data-go="league:${l.id}"><b>${esc(l.name || f.name)}</b><small>${esc(l.country || '')}</small></div>
                <button class="icon-btn" data-move="${i}:-1" ${i === 0 ? 'disabled' : ''} title="Move up">${icon('up', 16)}</button>
                <button class="icon-btn" data-move="${i}:1" ${i === followed.length - 1 ? 'disabled' : ''} title="Move down">${icon('down', 16)}</button>
                <button class="icon-btn on" data-follow="leagues:${l.id}:${UI.attr(l.name || f.name)}" title="Unfollow">${icon('starFill', 16)}</button>
              </div>`;
            }).join('')}</div>` : `<div class="card">${UI.empty('No competitions followed', 'Star any competition below to put it in Matchday and the sidebar.', 'star')}</div>`}
          </section>
          <section class="section"><div class="section-head"><h2>Popular</h2></div><div class="comp-grid">${cat.popular.map((id) => byId.get(id)).filter(Boolean).map((l) => item(l, l.country)).join('')}</div></section>` : ''}
          <section class="section">${q ? '' : '<div class="section-head"><h2>By country</h2></div>'}
            ${countries.length ? countries.map((c) => `<div class="country-block"><h3>${UI.flag(groups.get(c)[0].ccode)}${esc(c)}</h3><div class="comp-grid">${groups.get(c).map((l) => item(l)).join('')}</div></div>`).join('') : UI.empty('Nothing matches that', 'Try a country name or a shorter search.', 'search')}
          </section>`;
      };
      draw();
      UI.$('#lq', el).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
      el.addEventListener('click', async (e) => {
        const mv = e.target.closest('[data-move]');
        if (mv) {
          const [i, d] = mv.dataset.move.split(':').map(Number);
          const ids = UI.store.following.leagues.map((l) => l.id);
          const j = i + d; [ids[i], ids[j]] = [ids[j], ids[i]];
          UI.store = await window.tl.store.reorder('leagues', ids);
          App.renderRail(); draw();
        }
        if (e.target.closest('[data-follow]')) setTimeout(draw, 50);
      });
    }
  };
})();

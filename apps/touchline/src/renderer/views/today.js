// Touchline — Matchday: every match on a day, grouped by competition.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});

  Views.today = {
    async render(el, params, ctx) {
      let date = params[0] || UI.today();
      let liveOnly = params[1] === 'live';
      let scope = UI.store.scope || 'following';
      let filter = '';
      let data = null;

      el.innerHTML = `
        <div class="day-head">
          <h1 id="day-title">${esc(UI.dayLabel(date))}</h1>
          <div class="grow"></div>
          <input class="input" id="day-filter" placeholder="Filter teams or competitions" style="width:230px">
          <button class="chip ${liveOnly ? 'on' : ''}" id="live-only"><span class="live-dot" style="${liveOnly ? 'background:currentColor' : ''}"></span>Live</button>
          ${UI.seg([['following', 'Following'], ['all', 'All competitions']], scope, 'scope')}
          <button class="btn cal-btn" title="Pick a date">${icon('calendar', 15)}<input type="date" id="day-pick" value="${date}"></button>
        </div>
        <div class="date-strip" id="strip"></div>
        <div id="mine"></div>
        <div id="list">${UI.loading(8)}</div>`;

      const strip = () => {
        const t = UI.today();
        const days = Array.from({ length: 21 }, (_, i) => UI.addDays(date, i - 10));
        UI.$('#strip', el).innerHTML = days.map((d) => {
          const dt = new Date(`${d}T12:00:00`);
          return `<button class="date-pill ${d === date ? 'on' : ''} ${d === t ? 'today' : ''}" data-d="${d}"><small>${d === t ? 'Today' : dt.toLocaleDateString([], { weekday: 'short' })}</small><b>${dt.getDate()}</b><small>${dt.toLocaleDateString([], { month: 'short' })}</small></button>`;
        }).join('');
        const on = UI.$('.date-pill.on', el);
        if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
      };

      const setDate = (d) => {
        date = d;
        ctx.replaceParams([date, liveOnly ? 'live' : '']);
        UI.$('#day-title', el).textContent = UI.dayLabel(date);
        UI.$('#day-pick', el).value = date;
        strip();
        load();
      };

      UI.$('#strip', el).addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) setDate(b.dataset.d); });
      UI.$('#day-pick', el).addEventListener('change', (e) => { if (e.target.value) setDate(e.target.value); });
      UI.$('#live-only', el).addEventListener('click', (e) => { liveOnly = !liveOnly; e.currentTarget.classList.toggle('on', liveOnly); ctx.replaceParams([date, liveOnly ? 'live' : '']); draw(); });
      UI.$('#day-filter', el).addEventListener('input', (e) => { filter = e.target.value.trim().toLowerCase(); draw(); });
      UI.onSeg(el, 'scope', (v) => { scope = v; window.tl.store.set({ scope: v }).then((s) => (UI.store = s)); draw(); });

      async function load(silent = false) {
        if (!silent) UI.$('#list', el).innerHTML = UI.loading(8);
        const want = date;
        try {
          const d = await UI.api('day', date, { force: ctx.force && !silent });
          if (!ctx.alive() || want !== date) return;
          data = d;
          draw();
        } catch (err) {
          if (!ctx.alive() || want !== date) return;
          UI.$('#list', el).innerHTML = UI.error(err, 'matches');
        }
      }

      function draw() {
        if (!data) return;
        const followed = UI.store.following.leagues || [];
        const order = new Map(followed.map((l, i) => [Number(l.id), i]));
        const mine = UI.myTeamIds();
        let leagues = data.leagues.map((l) => ({ ...l, matches: l.matches.filter((m) => {
          if (liveOnly && m.state !== 'live') return false;
          if (filter && !`${m.home.name} ${m.away.name} ${l.name}`.toLowerCase().includes(filter)) return false;
          return true;
        }) })).filter((l) => l.matches.length);
        const isMine = (l) => order.has(l.primaryId) || l.matches.some((m) => mine.has(m.home.id) || mine.has(m.away.id));
        leagues.sort((a, b) => {
          const fa = order.has(a.primaryId) ? order.get(a.primaryId) : 1e4, fb = order.has(b.primaryId) ? order.get(b.primaryId) : 1e4;
          return fa - fb || a.rank - b.rank || a.name.localeCompare(b.name);
        });
        const shown = scope === 'all' || filter ? leagues : leagues.filter(isMine);
        const hidden = leagues.length - shown.length;

        // your teams today
        const myMatches = data.leagues.flatMap((l) => l.matches.map((m) => ({ ...m, league: l.name }))).filter((m) => mine.has(m.home.id) || mine.has(m.away.id));
        UI.$('#mine', el).innerHTML = myMatches.length ? `<div class="my-strip">${myMatches.map((m) => `
          <div class="card my-card" data-go="match:${m.id}">
            <div class="meta">${m.state === 'live' ? '<span class="live-dot"></span>' : icon('star', 12)}<span class="ellipsis">${esc(m.league)}</span><span style="margin-left:auto">${m.state === 'live' ? esc(m.label) : m.state === 'pre' ? esc(UI.time(m.kickoff)) : esc(m.label)}</span></div>
            <div class="line">${UI.crest(m.home.logo, m.home.name)}<span class="grow">${esc(m.home.name)}</span><b>${m.state === 'pre' ? '' : m.home.score}</b></div>
            <div class="line">${UI.crest(m.away.logo, m.away.name)}<span class="grow">${esc(m.away.name)}</span><b>${m.state === 'pre' ? '' : m.away.score}</b></div>
          </div>`).join('')}</div>` : '';

        const notice = UI.staleNotice(data._meta);
        if (!shown.length) {
          UI.$('#list', el).innerHTML = notice + `<div class="card">${UI.empty(liveOnly ? 'Nothing live right now' : filter ? 'No matches match that filter' : scope === 'following' && leagues.length ? 'None of your competitions play today' : 'No matches on this day', hidden ? '' : 'Try another day from the strip above.', liveOnly ? 'clock' : 'calendar')}${hidden ? `<div style="text-align:center;padding-bottom:28px"><button class="btn" id="show-all">Show all ${leagues.length} competitions</button></div>` : ''}</div>`;
        } else {
          UI.$('#list', el).innerHTML = notice + shown.map((l) => `
            <section class="card league-block">
              <div class="card-head" ${l.source === 'espn' ? '' : `data-go="league:${l.primaryId}"`}>
                ${UI.crest(l.logo, l.name)}<h3 class="ellipsis">${esc(l.name)}</h3>
                ${l.ccode && l.ccode !== 'INT' ? `<span class="ccode">${esc(l.ccode)}</span>` : ''}
                ${l.source === 'espn' ? '' : `<button class="icon-btn ${UI.following('leagues', l.primaryId) ? 'on' : ''}" data-follow="leagues:${l.primaryId}:${UI.attr(l.name)}" title="Follow">${icon(UI.following('leagues', l.primaryId) ? 'starFill' : 'star', 16)}</button>`}
              </div>
              ${l.matches.map((m) => UI.matchRow(m, { mine })).join('')}
            </section>`).join('') + (hidden ? `<div style="text-align:center;margin-top:18px"><button class="btn" id="show-all">${icon('plus', 15)}${hidden} more competition${hidden > 1 ? 's' : ''} playing</button></div>` : '');
        }
        const sa = UI.$('#show-all', el);
        if (sa) sa.onclick = () => { scope = 'all'; UI.$$('[data-seg="scope"] button', el).forEach((b) => b.classList.toggle('on', b.dataset.v === 'all')); window.tl.store.set({ scope: 'all' }).then((s) => (UI.store = s)); draw(); };
      }

      strip();
      await load();
      ctx.every(30 * 1000, () => {
        if (!data) return;
        const live = data.leagues.some((l) => l.matches.some((m) => m.state === 'live'));
        const soon = data.leagues.some((l) => l.matches.some((m) => m.state === 'pre' && Math.abs(Date.parse(m.kickoff) - Date.now()) < 5 * 60 * 1000));
        if (date === UI.today() && (live || soon)) load(true);
      });
    }
  };
})();

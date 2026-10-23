// Touchline — Settings: look, start page, alerts, saved data and sources.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});

  Views.settings = {
    async render(el, _p, ctx) {
      const s = UI.store;
      const sw = (key, on) => `<button class="switch ${on ? 'on' : ''}" data-alert="${key}" aria-pressed="${on}"></button>`;
      el.innerHTML = `
        <h1 style="margin-bottom:18px">Settings</h1>
        <div class="card" style="margin-bottom:16px">
          <div class="set-row"><div class="grow"><b>Appearance</b><small>Night is the default. System follows your computer.</small></div>${UI.seg([['dark', 'Night'], ['light', 'Day'], ['system', 'System']], s.theme, 'theme')}</div>
          <div class="set-row"><div class="grow"><b>Open to</b><small>The page Touchline shows when it starts.</small></div>${UI.seg([['today', 'Matchday'], ['following', 'Following'], ['leagues', 'Competitions']], s.startPage, 'start')}</div>
        </div>
        <h2 style="margin:22px 0 10px">Match alerts</h2>
        <div class="card" style="margin-bottom:16px">
          <div class="set-row"><div class="grow"><b>Alerts for teams you follow</b><small>Checks every minute while one of your teams is playing. ${s.following.teams.length ? `${s.following.teams.length} team${s.following.teams.length > 1 ? 's' : ''} followed.` : 'Follow a team to get alerts.'}</small></div>${sw('enabled', s.alerts.enabled)}</div>
          <div class="set-row"><div class="grow"><b>Kick-off</b></div>${sw('kickoff', s.alerts.kickoff)}</div>
          <div class="set-row"><div class="grow"><b>Goals</b></div>${sw('goals', s.alerts.goals)}</div>
          <div class="set-row"><div class="grow"><b>Red cards</b></div>${sw('redCards', s.alerts.redCards)}</div>
          <div class="set-row"><div class="grow"><b>Full-time</b></div>${sw('fulltime', s.alerts.fulltime)}</div>
        </div>
        <h2 style="margin:22px 0 10px">Saved data</h2>
        <div class="card" style="margin-bottom:16px">
          <div class="set-row"><div class="grow"><b>Offline copy</b><small id="cache-size">Everything you've opened is kept so it loads instantly and works offline. Finished matches and past seasons are kept for weeks; live data refreshes every 20–30 seconds.</small></div><button class="btn" id="clear">${icon('trash', 15)}Clear</button></div>
        </div>
        <h2 style="margin:22px 0 10px">Where the data comes from</h2>
        <div class="card" style="margin-bottom:16px">
          <div class="set-row"><div class="grow"><b>FotMob</b><small>Scores, tables, fixtures, lineups, stats, shot maps, squads, careers and every season back to each competition's first. Unofficial and free; Touchline asks politely and caches what it gets.</small></div><span class="chip" id="fm-status">Checking…</span></div>
          <div class="set-row"><div class="grow"><b>ESPN</b><small>Backup for scores and tables if FotMob is unreachable.</small></div><span class="chip">Backup</span></div>
          <div class="set-row"><div class="grow"><b>Wikidata</b><small>Historical club and international careers with appearances and goals, for players FotMob covers only partly.</small></div><span class="chip">History</span></div>
          <div class="set-row"><div class="grow"><b>Football Hub</b><small>The Hall of Fame and its legend photos come from your Football Hub site.</small></div><span class="chip">Bundled</span></div>
        </div>
        <p class="muted small">Touchline ${esc(UI.info.version)} · times shown in ${esc(UI.info.tz)}</p>`;

      UI.onSeg(el, 'theme', async (v) => { UI.store = await window.tl.store.set({ theme: v }); const info = await window.tl.app.info(); UI.applyTheme(info.dark); });
      UI.onSeg(el, 'start', async (v) => { UI.store = await window.tl.store.set({ startPage: v }); });
      el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-alert]');
        if (!a) return;
        const k = a.dataset.alert;
        const alerts = { ...UI.store.alerts, [k]: !UI.store.alerts[k] };
        UI.store = await window.tl.store.set({ alerts });
        a.classList.toggle('on', alerts[k]);
      });
      UI.$('#clear', el).onclick = async () => { await window.tl.data.cacheClear(); UI.toast('Cleared saved data'); size(); };
      const size = async () => {
        const c = await window.tl.data.cacheInfo();
        if (!ctx.alive()) return;
        UI.$('#cache-size', el).textContent = `${(c.bytes / 1048576).toFixed(1)} MB saved (${c.data.files.toLocaleString()} pages, ${c.images.files.toLocaleString()} images). Finished matches and past seasons are kept for weeks; live data refreshes every 20–30 seconds.`;
      };
      size();
      const st = await window.tl.data.status();
      const chip = UI.$('#fm-status', el);
      if (chip) chip.textContent = st.fotmob === 'ok' ? `Connected · ${UI.ago(st.lastOk)}` : st.fotmob === 'down' ? 'Unreachable' : 'Not used yet';
    }
  };
})();

// Touchline — XI Builder: pick any player from any squad (or any legend) into
// a formation, and save as many XIs as you like.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});
  const F = {"4-3-3":[["GK",50,88],["RB",82,72],["CB",63,72],["CB",37,72],["LB",18,72],["CM",72,50],["CM",50,50],["CM",28,50],["RW",78,22],["ST",50,18],["LW",22,22]],"4-4-2":[["GK",50,88],["RB",82,72],["CB",63,72],["CB",37,72],["LB",18,72],["RM",82,48],["CM",60,48],["CM",40,48],["LM",18,48],["ST",63,20],["ST",37,20]],"4-2-3-1":[["GK",50,88],["RB",82,72],["CB",63,72],["CB",37,72],["LB",18,72],["DM",62,56],["DM",38,56],["AM",76,36],["AM",50,33],["AM",24,36],["ST",50,16]],"3-5-2":[["GK",50,88],["CB",70,72],["CB",50,74],["CB",30,72],["RM",88,52],["CM",66,50],["CM",50,48],["CM",34,50],["LM",12,52],["ST",63,20],["ST",37,20]],"5-3-2":[["GK",50,88],["RB",88,68],["CB",70,74],["CB",50,76],["CB",30,74],["LB",12,68],["CM",66,50],["CM",50,48],["CM",34,50],["ST",63,20],["ST",37,20]],"3-4-3":[["GK",50,88],["CB",68,74],["CB",50,76],["CB",32,74],["RM",84,52],["CM",62,50],["CM",38,50],["LM",16,52],["RW",76,20],["ST",50,16],["LW",24,20]],"4-1-4-1":[["GK",50,88],["RB",82,72],["CB",63,72],["CB",37,72],["LB",18,72],["DM",50,58],["RM",82,42],["CM",62,40],["CM",38,40],["LM",18,42],["ST",50,16]],"5-4-1":[["GK",50,88],["RB",88,68],["CB",70,74],["CB",50,76],["CB",30,74],["LB",12,68],["RM",82,44],["CM",62,44],["CM",38,44],["LM",18,44],["ST",50,16]]};

  Views.builder = {
    async render(el, _p, ctx) {
      let xi = { name: 'My XI', formation: '4-3-3', players: Array(11).fill(null) };
      let sel = 0;
      let source = 'search';     // search | team | legends
      let teamId = UI.store.following.teams[0]?.id || null;
      let pool = [];             // current picker list
      let q = '';
      let group = 'ALL';

      el.innerHTML = `
        <div class="day-head"><h1>XI Builder</h1><div class="grow"></div>
          <input class="input" id="xi-name" value="${esc(xi.name)}" style="width:200px">
          <select class="select" id="xi-saved"><option value="">Saved XIs…</option></select>
          <button class="btn" id="xi-copy">${icon('copy', 15)}Copy</button>
          <button class="btn" id="xi-clear">${icon('trash', 15)}Clear</button>
          <button class="btn primary" id="xi-save">${icon('save', 15)}Save</button>
        </div>
        <div class="chips" id="forms" style="margin-bottom:14px">${Object.keys(F).map((f) => `<button class="chip ${f === xi.formation ? 'on' : ''}" data-f="${f}">${f}</button>`).join('')}</div>
        <div class="builder">
          <div><div class="pitch" id="xi-pitch"></div><div class="muted small" style="margin-top:8px" id="xi-count"></div></div>
          <div class="card">
            <div class="card-head" style="flex-wrap:wrap;gap:8px">
              <h3 id="pick-title">Pick a player</h3>
              ${UI.seg([['search', 'Search'], ['team', 'From a squad'], ['legends', 'Legends']], source, 'src')}
            </div>
            <div style="padding:12px 14px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line)" id="pick-controls"></div>
            <div class="picker-list" id="pick-list"></div>
          </div>
        </div>`;

      const saved = () => {
        const s = UI.$('#xi-saved', el);
        s.innerHTML = `<option value="">Saved XIs (${UI.store.xis.length})</option>${UI.store.xis.map((x, i) => `<option value="${i}">${esc(x.name)} · ${esc(x.formation)}</option>`).join('')}${UI.store.xis.length ? '<option value="del">Delete the loaded XI…</option>' : ''}`;
      };

      const pitch = () => {
        const pts = F[xi.formation];
        UI.$('#xi-pitch', el).innerHTML = Charts.pitchLines(true) + pts.map(([lbl, x, y], i) => {
          const p = xi.players[i];
          return `<div class="slot ${p ? 'filled' : ''} ${i === sel ? 'sel' : ''}" style="left:${x}%;top:${y}%" data-slot="${i}">
            <div class="disc">${p ? (p.photo ? `<img src="${p.photo.startsWith('legends/') ? esc(p.photo) : UI.src(p.photo)}" alt="" data-fb="${esc(UI.initials(p.name))}">` : esc(UI.initials(p.name))) : esc(lbl)}</div>
            <span class="nm">${p ? esc(p.name.split(' ').slice(-1)[0]) : ''}</span></div>`;
        }).join('');
        const n = xi.players.filter(Boolean).length;
        UI.$('#xi-count', el).textContent = `${n} / 11 picked · click a position, then a player${n ? ' · click a picked player again to remove them' : ''}`;
        UI.$('#pick-title', el).textContent = `Pick a ${pts[sel][0]}`;
      };

      const controls = async () => {
        const c = UI.$('#pick-controls', el);
        const pos = UI.seg([['ALL', 'All'], ['GK', 'GK'], ['DEF', 'DEF'], ['MID', 'MID'], ['FWD', 'FWD']], group, 'grp');
        if (source === 'search') c.innerHTML = `<input class="input" id="pq" placeholder="Search any current or past player" style="flex:1" value="${esc(q)}">`;
        else if (source === 'team') c.innerHTML = `<select class="select" id="pteam" style="flex:1">${UI.store.following.teams.map((t) => `<option value="${t.id}" ${Number(t.id) === Number(teamId) ? 'selected' : ''}>${esc(t.name)}</option>`).join('') || '<option value="">Follow a team to pick from its squad</option>'}</select><input class="input" id="pteamq" placeholder="…or search a team" style="flex:1">${pos}`;
        else c.innerHTML = `<input class="input" id="pq" placeholder="Filter legends" style="flex:1" value="${esc(q)}">${pos}`;
        UI.onSeg(c, 'grp', (v) => { group = v; list(); });
        const pq = UI.$('#pq', c);
        if (pq) { pq.addEventListener('input', debounce(() => { q = pq.value.trim(); fetchPool(); }, 300)); setTimeout(() => pq.focus(), 0); }
        const pt = UI.$('#pteam', c);
        if (pt) pt.addEventListener('change', () => { teamId = pt.value; fetchPool(); });
        const ptq = UI.$('#pteamq', c);
        if (ptq) ptq.addEventListener('input', debounce(async () => {
          const term = ptq.value.trim();
          if (term.length < 2) return;
          const r = await UI.api('search', term).catch(() => null);
          if (!r || !r.teams.length) return;
          teamId = r.teams[0].id;
          pt.insertAdjacentHTML('afterbegin', `<option value="${teamId}" selected>${esc(r.teams[0].name)}</option>`);
          fetchPool();
        }, 400));
        fetchPool();
      };

      async function fetchPool() {
        const box = UI.$('#pick-list', el);
        if (source === 'search') {
          if (q.length < 2) { pool = []; box.innerHTML = UI.empty('Search for anyone', 'Current players, former players and legends.', 'search'); return; }
          box.innerHTML = UI.loading(5, 40);
          const r = await UI.api('search', q).catch(() => ({ players: [], legends: [] }));
          pool = [...r.players.map((p) => ({ id: p.id, name: p.name, sub: p.team || (p.coach ? 'Coach' : ''), photo: p.photo })), ...(r.legends || []).map((l) => ({ legend: l.id, name: l.name, sub: 'Legend', photo: l.photo, group: l.group }))];
        } else if (source === 'team') {
          if (!teamId) { pool = []; box.innerHTML = UI.empty('No squad picked', 'Follow a team or search one above.', 'users'); return; }
          box.innerHTML = UI.loading(8, 40);
          const T = await UI.api('team', teamId).catch(() => null);
          pool = (T?.squad || []).filter((g) => g.title !== 'coach').flatMap((g) => g.members.map((m) => ({ id: m.id, name: m.name, sub: `${m.pos || ''} · ${T.short}`, photo: m.photo, group: UI.posGroup(m.pos || g.title) })));
        } else {
          const L = await UI.api('legends');
          pool = L.list.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).map((p) => ({ legend: p.id, name: p.name, sub: `${p.nationality || ''} · Legend`, photo: p.photo, group: p.group }));
        }
        list();
      }

      function list() {
        const box = UI.$('#pick-list', el);
        const items = pool.filter((p) => group === 'ALL' || !p.group || p.group === group);
        if (!items.length) { if (pool.length || source !== 'search') box.innerHTML = UI.empty('Nobody here', '', 'users'); return; }
        box.innerHTML = items.map((p, i) => `<div class="pick" data-pick="${pool.indexOf(p)}">${p.photo && p.photo.startsWith('legends/') ? `<img class="avatar sm" src="${esc(p.photo)}" alt="">` : UI.photo(p.photo, p.name, 'sm')}<div class="grow"><b>${esc(p.name)}</b><div class="muted small">${esc(p.sub || '')}</div></div>${xi.players.some((x) => x && x.name === p.name) ? `<span class="muted small">${icon('check', 15)}</span>` : ''}</div>`).join('');
      }

      function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

      el.addEventListener('click', async (e) => {
        const s = e.target.closest('[data-slot]');
        if (s) {
          const i = Number(s.dataset.slot);
          if (i === sel && xi.players[i]) xi.players[i] = null;
          sel = i;
          if (source !== 'search') { group = UI.posGroup(F[xi.formation][i][0]); UI.$$('[data-seg="grp"] button', el).forEach((b) => b.classList.toggle('on', b.dataset.v === group)); }
          pitch(); list(); return;
        }
        const pk = e.target.closest('[data-pick]');
        if (pk) {
          const p = pool[Number(pk.dataset.pick)];
          const dup = xi.players.findIndex((x) => x && x.name === p.name);
          if (dup >= 0) xi.players[dup] = null;
          xi.players[sel] = { id: p.id || null, legend: p.legend || null, name: p.name, photo: p.photo || null };
          const next = xi.players.findIndex((x, i) => !x && i > sel);
          sel = next >= 0 ? next : xi.players.findIndex((x) => !x) >= 0 ? xi.players.findIndex((x) => !x) : sel;
          pitch(); list(); return;
        }
        const f = e.target.closest('[data-f]');
        if (f) { xi.formation = f.dataset.f; UI.$$('#forms .chip', el).forEach((c) => c.classList.toggle('on', c === f)); sel = Math.min(sel, 10); pitch(); }
      });
      UI.onSeg(el, 'src', (v) => { source = v; q = ''; group = 'ALL'; controls(); });
      UI.$('#xi-name', el).addEventListener('input', (e) => { xi.name = e.target.value || 'My XI'; });
      UI.$('#xi-clear', el).onclick = () => { xi.players = Array(11).fill(null); sel = 0; pitch(); list(); };
      UI.$('#xi-copy', el).onclick = () => {
        const pts = F[xi.formation];
        const text = `${xi.name} (${xi.formation})\n` + pts.map(([l], i) => `${l.padEnd(3)} ${xi.players[i]?.name || '—'}`).join('\n');
        window.tl.app.copy(text); UI.toast('Copied the XI');
      };
      UI.$('#xi-save', el).onclick = async () => {
        const list = [...UI.store.xis];
        const i = list.findIndex((x) => x.name === xi.name);
        const entry = { ...xi, players: [...xi.players], saved: new Date().toISOString() };
        if (i >= 0) list[i] = entry; else list.push(entry);
        UI.store = await window.tl.store.set({ xis: list });
        saved(); UI.toast(`Saved “${xi.name}”`);
      };
      UI.$('#xi-saved', el).addEventListener('change', async (e) => {
        const v = e.target.value;
        if (v === 'del') {
          const list = UI.store.xis.filter((x) => x.name !== xi.name);
          UI.store = await window.tl.store.set({ xis: list }); saved(); UI.toast(`Deleted “${xi.name}”`); return;
        }
        if (v === '') return;
        const x = UI.store.xis[Number(v)];
        xi = { name: x.name, formation: x.formation, players: [...x.players] };
        UI.$('#xi-name', el).value = xi.name;
        UI.$$('#forms .chip', el).forEach((c) => c.classList.toggle('on', c.dataset.f === xi.formation));
        sel = 0; pitch(); list();
      });

      saved(); pitch(); controls();
    }
  };
})();

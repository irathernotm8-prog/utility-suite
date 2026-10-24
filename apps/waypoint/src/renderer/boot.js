// Start-up: load state, theme, drag-and-drop, menu commands, then open the last trip.
'use strict';

function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// drop files anywhere: .waypoint files open as trips, everything else becomes a document of the open trip
function wireDrop() {
  let depth = 0;
  const shade = $('#dropShade');
  const hasFiles = (e) => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); depth++;
    $('#dsTitle').textContent = S.trip ? `Drop to add to ${S.trip.name}` : 'Drop a trip file to open it';
    $('#dsText').textContent = S.trip ? 'Documents are copied into the trip folder so they open offline. .waypoint files open as trips.' : 'Open a trip first to add documents to it.';
    shade.classList.add('on');
  });
  addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) shade.classList.remove('on'); });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); depth = 0; shade.classList.remove('on');
    const paths = [...e.dataTransfer.files].map(f => W.pathFor(f)).filter(Boolean);
    const trips = paths.filter(p => /\.waypoint$/i.test(p)), docs = paths.filter(p => !/\.waypoint$/i.test(p));
    if (trips.length) bundleSheet(trips[0]);
    if (docs.length) { if (S.trip) addDocs({}, docs); else toast('Open a trip first', 'Then drop documents on it.', 'info'); }
  });
}

(async () => {
  if (W.platform === 'win32') document.documentElement.classList.add('win');
  const st = await call('state');
  Object.assign(S, { settings: st.settings, trips: st.trips, dataDir: st.dataDir, version: st.version, home: st.home, beam: st.beam, demo: st.demo, user: st.user });
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $$('#navTop button').forEach(b => b.onclick = () => { S.trip = null; go('trips'); });
  wireDrop();
  const hash = location.hash.slice(1).split('/');
  const last = S.trips.find(t => t.id === (hash[1] || S.settings.lastTrip));
  if (hash[0] === 'trips' || !last) go('trips');
  else await openTrip(last.id, hash[0] && VIEWS[hash[0]] ? hash[0] : 'overview');
  hydrateIcons(document);
  document.body.classList.add('ready');

  W.on('theme', () => applyTheme());
  W.on('open-bundle', (p) => bundleSheet(p));
  W.on('captured', (c) => captured(c));
  W.on('visit', (v) => { if (S.share) { S.share.visits = [v, ...(S.share.visits || [])]; const b = $('#takeBody'); if (b && $('.phone-take', b)) drawPhone(b, S.share); } toast(`${v.dev} ${v.what}`, S.trip ? S.trip.name : '', 'ok', 4000); });
  W.on('progress', (p) => { const bar = $('#tfProg i') || (S.importing && $('#prog', S.importing)); if (bar) { const el = bar.tagName === 'I' ? bar : bar.querySelector('i'); if (el) { if (bar.classList) bar.classList.remove('indet'); el.style.width = (p.total ? p.done / p.total * 100 : 100) + '%'; } } });
  W.on('menu', (c) => {
    if (c === 'new-trip') return tripSheet();
    if (c === 'open-bundle') return pickBundle();
    if (!S.trip) return toast('Open a trip first', '', 'info');
    if (c === 'add-plan') { if (S.view !== 'timeline') go('timeline'); addPlan(); }
    else if (c === 'add-booking') bookingSheet();
    else if (c === 'add-docs') addDocs();
    else if (c === 'add-expense') expenseSheet();
    else if (c === 'take') takeSheet();
    else if (c === 'book') go('book');
  });
  for (const p of W.pending()) bundleSheet(p);
  // keep "now" lines, countdowns and local clocks fresh
  setInterval(() => { if (['timeline', 'overview', 'research'].includes(S.view) && !TLV.drag && !$('#sheetHost').firstChild && !$('#popHost').firstChild && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) { if (S.view === 'timeline') refreshDay(); else render(); } }, 60000);
  addEventListener('beforeunload', () => { if (saveTimer) persist(true); });
})();

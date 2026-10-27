// Atoll — drives the real windows and saves screenshots of every shape and view.
// Run: test/e2e/run.sh   (Linux: under Xvfb; it uses the pretend music player, saved Touchline responses and,
// for the second half, a pretend MacBook notch). Screenshots land in test/e2e/out.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const N = require('../../src/touchline/vendor/normalize');

const OUT = process.env.ATOLL_E2E_OUT || path.join(__dirname, 'out');
const FX = path.join(__dirname, '..', 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FX, n))).toString());

module.exports = async function drive({ app, island, openSettings, settingsWin, API, timers, media, match, burst }) {
  fs.mkdirSync(OUT, { recursive: true });
  const results = []; let n = 0;
  const log = (line) => { console.log(line); fs.appendFileSync(path.join(OUT, 'log.txt'), line + '\n'); };
  const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' · ' + extra : ''}`); };
  const js = (code) => island().win.webContents.executeJavaScript(code);
  const shot = async (name, win = island().win) => {
    await sleep(80);
    log(`    shot ${name} visible=${win.isVisible()}`);
    const f = path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
    if (win !== island().win) { const img = await win.webContents.capturePage(); fs.writeFileSync(f, img.toPNG()); return img.getSize(); }
    // the island: crop to the island (and its bubble) with room for the shadow, report the island's own size
    const r = await js(`(() => { const a = document.querySelector('#island').getBoundingClientRect(), b = document.querySelector('#bubble'); let x0 = a.left, x1 = a.right, y1 = a.bottom; if (b.classList.contains('on')) { const q = b.getBoundingClientRect(); x0 = Math.min(x0, q.left); x1 = Math.max(x1, q.right); y1 = Math.max(y1, q.bottom); } return { x0, x1, y1, w: a.width, h: a.height, W: innerWidth, H: innerHeight }; })()`);
    const x = Math.max(0, Math.floor(r.x0 - 30)), w = Math.min(r.W - x, Math.ceil(r.x1 - r.x0 + 60)), h = Math.min(r.H, Math.ceil(r.y1 + 40));
    const img = await win.webContents.capturePage({ x, y: 0, width: w, height: h });
    fs.writeFileSync(f, img.toPNG());
    return { width: Math.round(r.w), height: Math.round(r.h) };
  };
  const errors = [];
  island().win.webContents.on('console-message', (e) => { const level = e.level ?? e.params?.level; const msg = e.message ?? e.params?.message; if (level === 'error' || level === 3) errors.push(msg); });

  try {
    if (process.env.ATOLL_FAKE_NOTCH) API.setSettings({ style: 'float' });
    await sleep(1800);
    let sz = await shot('float-idle-clock');
    check('floating island starts small (music playing)', sz.width < 260 && sz.height < 60, `${sz.width}×${sz.height}`);

    // a live match from the saved Touchline responses: Brighton v Crystal Palace at 67'
    const raw = N.match(fx('match.json.gz'));
    let minute = 67, extraGoal = 0;
    const liveData = {
      today: () => '2026-10-23',
      day: async () => N.matchDay(fx('day.json.gz')),
      team: async () => N.team(fx('team.json.gz')),
      searchTeams: async () => N.search(fx('search.json.gz')).teams.concat([{ id: 10204, name: 'Brighton & Hove Albion', country: 'ENG', logo: N.img.team(10204) }, { id: 9825, name: 'Arsenal', country: 'ENG', logo: N.img.team(9825) }]),
      match: async (id) => {
        const evs = raw.events.filter((e) => (e.minute || 0) <= minute);
        const goals = evs.filter((e) => e.kind === 'goal');
        const hs = goals.filter((g) => g.home).length + extraGoal, as = goals.filter((g) => !g.home).length;
        return { ...raw, id, state: 'live', label: `${minute}’`, detail: `Live · ${minute}’`, minute, events: evs, home: { ...raw.home, score: hs }, away: { ...raw.away, score: as }, _meta: {} };
      }
    };
    match.data = liveData;
    const dayRow = N.matchDay(fx('day.json.gz')).leagues[0].matches[0];
    API.matchFollowMatch({ ...dayRow, id: raw.id, home: { ...dayRow.home, name: raw.home.name, short: 'BHA', logo: raw.home.logo }, away: { ...dayRow.away, name: raw.away.name, short: 'CRY', logo: raw.away.logo }, leagueName: 'Premier League' });
    await sleep(600);
    check('live match loaded through the Touchline plugin', match.cur && match.cur.state === 'live', match.cur ? `${match.cur.home.short} ${match.cur.home.score}-${match.cur.away.score} ${match.cur.away.short}` : 'none');

    timers.add(4 * 60e3 + 32e3, 'Tea');
    await sleep(700);
    sz = await shot('float-compact-timer-and-bubble');
    check('compact island shows the timer with a bubble for the match', sz.width > 120, `${sz.width}×${sz.height}`);
    const hasBubble = await js("document.querySelector('#bubble').classList.contains('on')");
    check('second live activity sits in the bubble', hasBubble);

    for (const v of ['home', 'media', 'timers', 'match', 'shelf']) {
      await js(`window.__atoll.open('${v}')`); await sleep(650);
      sz = await shot(`float-open-${v}`);
      const ok = await js(`window.__atoll.mode === 'open' && window.__atoll.view === '${v}'`);
      check(`open: ${v}`, ok && sz.height > 220, `${sz.width}×${sz.height}`);
    }
    // timers sub views
    timers.focusStart(); await js("window.__atoll.open('timers'); window.__atoll.setSub('timers','focus')"); await sleep(500); await shot('float-timers-focus');
    timers.watchToggle(); await sleep(1300); timers.watchLap(); await sleep(400); await js("window.__atoll.setSub('timers','watch')"); await sleep(400); await shot('float-timers-stopwatch');
    check('focus and stopwatch run', timers.focus && timers.watch.running);
    timers.focusStop(); timers.watchReset();
    await js("window.__atoll.setSub('timers','timers')");
    // add a timer by typing
    await js("document.querySelector('#t-time').value='1h 15m'; document.querySelector('#t-label').value='Laundry'; document.querySelector('[data-act=addTimer]').click()"); await sleep(400);
    check('typing "1h 15m" starts a timer', timers.list.some((t) => t.label === 'Laundry' && t.duration === 4500e3));
    await shot('float-timers-list');

    // match picker and team search
    await js("window.__atoll.open('match'); window.__atoll.setSub('match','pick'); window.__atoll.loadPicker(true)"); await sleep(800); await shot('float-match-picker');
    check('picker lists today’s matches', await js("document.querySelectorAll('.mrow').length > 3"));
    const teams = await API.matchSearch('bri');
    await js(`window.__atoll.setSub('match','team'); window.__atoll.setTeams(${JSON.stringify(teams)}, 'bri')`); await sleep(400); await shot('float-match-team-search');
    await js("window.__atoll.setSub('match','today')"); await sleep(300);

    // media controls
    const before = media.cur?.state;
    await js("window.__atoll.open('media')"); await sleep(400);
    await js("document.querySelector('[data-cmd=toggle]').click()"); await sleep(500);
    check('play/pause from the island reaches the player', media.cur && media.cur.state !== before, `${before} → ${media.cur?.state}`);
    await js("document.querySelector('[data-cmd=toggle]').click()"); await sleep(300);

    // bursts
    await js('window.__atoll.close()'); await sleep(700);
    extraGoal = 1; minute = 71; match.refresh(); await sleep(900);
    sz = await shot('float-peek-goal');
    check('a goal grows the island into a moment', await js("window.__atoll.mode === 'peek'"), `${sz.width}×${sz.height}`);
    await js("window.__atoll.close(); window.__atoll.setMode('compact')"); await sleep(200);
    await js("document.querySelectorAll('#peek').forEach(()=>0)");
    await sleep(8500);
    await media.command('next'); await sleep(1200);
    await shot('float-peek-track');
    await sleep(4200);
    const quick = timers.add(1000, 'Pasta'); await sleep(1700);
    sz = await shot('float-peek-timer-done');
    check('a finished timer rings and waits for you', await js("window.__atoll.mode === 'peek'") && timers.get(quick.id)?.state === 'done');
    await js("document.querySelector('#peek [data-act=stopRing]').click()"); await sleep(700);
    check('Stop clears the finished timer', !timers.get(quick.id));

    // settings window
    openSettings(); await sleep(1500);
    const sw = settingsWin();
    for (const s of ['general', 'island', 'timers', 'match', 'weather']) { sw.webContents.send('atoll:section', s); await sleep(450); await shot(`settings-${s}`, sw); }
    check('settings window opens', !!sw);
    sw.close();

    // a notched MacBook
    // notch style: a real MacBook notch with ATOLL_FAKE_NOTCH=1, otherwise the notch-style tab Windows gets
    {
      const tag = process.env.ATOLL_FAKE_NOTCH ? 'notch' : 'tab';
      timers.add(3 * 60e3, 'Tea');
      API.setSettings({ style: 'notch' }); await sleep(900);
      await shot(`${tag}-compact-timer`);
      check(`${tag}: notch style is available here`, await js("document.body.classList.contains('notch')"));
      sz = await shot(`${tag}-compact`);
      await js("window.__atoll.open('home')"); await sleep(700); await shot(`${tag}-open-home`);
      await js("window.__atoll.open('match')"); await sleep(700); await shot(`${tag}-open-match`);
      await js("window.__atoll.open('media')"); await sleep(700); await shot(`${tag}-open-media`);
      await js('window.__atoll.close()'); await sleep(700);
      timers.list.slice().forEach((t) => timers.remove(t.id)); match.clear(); await sleep(700);
      await shot(`${tag}-compact-music`);
      extraGoal = 0;
    }
  } catch (e) { check('run finished', false, e.stack); }

  // fixed-size window (Windows/Linux): it never resizes, and only takes clicks over the island
  if (API.state().geo?.fixed) {
    try {
      const w = island().win; const b0 = w.getBounds();
      await js("window.__atoll.open('home')"); await sleep(700); await js('window.__atoll.close()'); await sleep(700);
      const b1 = w.getBounds();
      check('window keeps one size while the island opens and closes', b0.width === b1.width && b0.height === b1.height, `${b1.width}×${b1.height}`);
      const r = await js("(() => { const a = document.querySelector('#island').getBoundingClientRect(); return { x: Math.round(a.left + a.width / 2), y: Math.round(a.top + a.height / 2) }; })()");
      w.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y }); await sleep(300);
      const over = island().hit;
      w.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: b1.height - 5 }); await sleep(300);
      check('clicks go to the island only when the pointer is over it', over === true && island().hit === false, `over=${over} away=${island().hit}`);
    } catch (e) { check('fixed window checks', false, e.message); }
  }

  check('no errors in the island page', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  log(`\n${results.length - failed}/${results.length} e2e checks passed · screenshots in ${OUT}`);
  app.exit(failed ? 1 : 0);
};

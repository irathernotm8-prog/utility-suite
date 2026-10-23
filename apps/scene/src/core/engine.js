// The switch itself: quit or hide what doesn't belong, launch what's missing, wait for windows, put every window
// in its place, then apply volume, appearance, wallpaper and actions. Reports each step as it goes.
'use strict';
const P = require('./plan');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// A window's identity across two snapshots. Windows handles are stable; on a Mac we only have pid + title + frame.
const winKey = (w) => (w.handle ? String(w.handle) : `${w.pid}|${w.title}|${w.bounds.x},${w.bounds.y},${w.bounds.width},${w.bounds.height}`);

class Engine {
  /**
   * @param {object} o
   *   platform   mac / win / demo module
   *   displays() current displays as plan.describeDisplay objects
   *   openDefault(target) open a URL, file or folder with its default app
   *   keepAwake(on, label)
   *   appIndex() Map(path -> installed app) to name running apps
   *   settings() { waitSeconds, keepApps }
   */
  constructor(o) { Object.assign(this, o); this.busy = false; }

  async snapshot() {
    const displays = this.displays();
    try {
      const s = await this.platform.snapshot();
      return { displays, windows: s.windows, apps: s.apps, error: null };
    } catch (e) { return { displays, windows: [], apps: [], error: e.code || e.message }; }
  }

  async running() { try { return await this.platform.runningApps(this.appIndex && this.appIndex()); } catch { return []; } }

  /** A transient scene that puts things back as they are right now (used for "Restore previous"). */
  previousFrom(snap, scene, launched) {
    return {
      id: 'previous', name: `Before ${scene.name}`, color: 'slate', displays: P.captureDisplays(snap),
      apps: P.captureApps(snap).map((a) => ({ ...a, launch: true })), others: 'leave', extras: [], actions: [], system: {}, quitApps: launched, at: Date.now()
    };
  }

  async activate(scene, { progress = () => {}, trigger = 'manual', dryRun = false } = {}) {
    if (this.busy) throw new Error('A switch is already running');
    this.busy = true;
    const t0 = Date.now(); const steps = []; const warn = [];
    const step = (id, label, status, detail = '') => {
      let s = steps.find((x) => x.id === id);
      if (!s) { s = { id, label }; steps.push(s); }
      Object.assign(s, { label, status, detail }); progress({ scene: scene.id, name: scene.name, steps: steps.map((x) => ({ ...x })), done: false });
    };
    let previous = null;
    try {
      const settings = this.settings();
      // 1. look around
      step('look', 'Reading your windows', 'run');
      const snap = await this.snapshot();
      const running = await this.running();
      if (snap.error === 'accessibility') warn.push('accessibility');
      const keep = (settings.keepApps || []);
      const plan = P.planSwitch(scene, snap, { running, keep });
      step('look', 'Read your windows', 'ok', `${snap.windows.length} windows on ${snap.displays.length} display${snap.displays.length === 1 ? '' : 's'}`);
      previous = this.previousFrom(snap, scene, plan.launch.map((a) => ({ name: a.name, bundleId: a.bundleId, path: a.path, aumid: a.aumid })));
      if (dryRun) return { plan, previous };

      // 2. the apps that don't belong
      if (scene.others === 'quit' || scene.others === 'hide') {
        const verb = scene.others === 'quit' ? 'Quit' : 'Hid';
        if (plan.others.length) {
          step('others', `${scene.others === 'quit' ? 'Quitting' : 'Hiding'} other apps`, 'run');
          const r = await (scene.others === 'quit' ? this.platform.quit(plan.others) : this.platform.hide(plan.others));
          step('others', `${verb} other apps`, r && r.ok === false ? 'warn' : 'ok', plan.others.map((a) => a.name).join(', '));
        } else step('others', 'No other apps to ' + scene.others, 'ok');
      }
      if (scene.quitApps && scene.quitApps.length) {
        const live = [...snap.windows.map((w) => w.app), ...running];
        const q = scene.quitApps.filter((a) => live.some((l) => P.sameApp(a, l)));
        if (q.length) { await this.platform.quit(q); step('undo', 'Closed what the last scene opened', 'ok', q.map((a) => a.name).join(', ')); }
      }

      // 3. launch and open
      const before = new Map();   // app id -> keys of its windows before we touched it
      for (const a of scene.apps || []) before.set(a.id, new Set(snap.windows.filter((w) => P.sameApp(a, w.app)).map(winKey)));
      // launch what isn't running, anything with links to open, and running apps that have no window right now
      // (a Mac app with its last window closed is still running; `open` asks it for a window again)
      const noWindow = (a) => (a.windows || []).some((w) => w.state !== 'minimized') && !snap.error && !snap.windows.some((w) => P.sameApp(a, w.app));
      const toLaunch = (scene.apps || []).filter((a) => a.launch !== false && (plan.launch.includes(a) || (a.open && a.open.length) || noWindow(a)));
      if (toLaunch.length) {
        step('launch', `Opening ${toLaunch.length} app${toLaunch.length === 1 ? '' : 's'}`, 'run');
        const res = await Promise.all(toLaunch.map((a) => this.platform.launch(a, { open: (a.open || []).map((o) => o.target || o), args: a.args || '' }).catch((e) => ({ ok: false, error: e.message }))));
        const bad = toLaunch.filter((_, i) => res[i] && res[i].ok === false);
        step('launch', `Opened ${toLaunch.length - bad.length} of ${toLaunch.length} app${toLaunch.length === 1 ? '' : 's'}`, bad.length ? 'warn' : 'ok', bad.length ? `Couldn't open ${bad.map((a) => a.name).join(', ')}` : toLaunch.map((a) => a.name).join(', '));
      }
      for (const x of scene.extras || []) { try { await this.openDefault(x.target || x); } catch (_) {} }
      if ((scene.extras || []).length) step('extras', `Opened ${scene.extras.length} link${scene.extras.length === 1 ? '' : 's'} and file${scene.extras.length === 1 ? '' : 's'}`, 'ok');

      // 4. wait for windows, then place them
      const withRules = (scene.apps || []).filter((a) => (a.windows || []).length && (a.launch !== false || plan.already.includes(a)));
      let placed = 0, missed = []; const placedWins = new Map();
      if (withRules.length && snap.error !== 'accessibility') {
        step('place', 'Waiting for windows', 'run');
        const deadline = Date.now() + (settings.waitSeconds || 20) * 1000;
        let cur = snap;
        // ready when every app has a window per rule, or has some windows and that number hasn't changed for ~2 s
        // (an app asked for two windows may only ever open one)
        const steady = new Map();
        const ready = (s) => withRules.map((a) => {
          const ws = s.windows.filter((w) => P.sameApp(a, w.app));
          const fresh = ws.filter((w) => !before.get(a.id).has(winKey(w)));
          if (a.open && a.open.length && !fresh.length) return false;
          if (ws.length >= a.windows.length) return true;
          const st = steady.get(a.id) || { n: -1, k: 0 };
          if (st.n === ws.length) st.k++; else { st.n = ws.length; st.k = 0; }
          steady.set(a.id, st);
          return ws.length > 0 && st.k >= 3;
        }).every(Boolean);
        if (toLaunch.length) { await wait(700); cur = await this.snapshot(); }
        while (!ready(cur) && Date.now() < deadline) { await wait(600); cur = await this.snapshot(); step('place', 'Waiting for windows', 'run', `${Math.max(0, Math.round((deadline - Date.now()) / 1000))} s left`); }
        if (toLaunch.length) await wait(500);   // let freshly opened windows settle their own size first
        const doPlace = async (s) => {
          const ops = []; const missing = [];
          for (const a of withRules) {
            const live = s.windows.filter((w) => P.sameApp(a, w.app));
            const fresh = new Set(live.filter((w) => !before.get(a.id).has(winKey(w))).map((w) => w.id));
            const rules = a.windows.map((r, i) => ({ ...r, fresh: !!(a.open && a.open.length && i === 0) }));
            const pairs = P.matchWindows(rules, live, { appName: a.name, fresh });
            for (const r of a.windows) if (!pairs.some((p) => p.rule.id === r.id)) missing.push(a.name);
            for (const p of pairs) {
              const pl = plan.placements.find((x) => x.rule.id === p.rule.id);
              ops.push({ win: p.win, rect: pl.rect, state: p.rule.state || 'normal', app: a });
            }
          }
          const res = ops.length ? await this.platform.place(ops) : [];
          return { ops, res, missing };
        };
        let r = await doPlace(cur);
        if (r.res.some((x) => !x.ok)) { await wait(1200); const again = await doPlace(await this.snapshot()); if (again.res.filter((x) => x.ok).length >= r.res.filter((x) => x.ok).length) r = again; }
        r.ops.forEach((o, i) => { if (r.res[i] && r.res[i].ok && o.state !== 'minimized' && !placedWins.has(o.app.id)) placedWins.set(o.app.id, o.win); });
        placed = r.res.filter((x) => x.ok).length; missed = [...new Set([...r.missing, ...r.ops.filter((_, i) => !r.res[i].ok).map((o) => o.app.name)])];
        const axFail = r.res.some((x) => x.error === 'accessibility');
        if (axFail) warn.push('accessibility');
        step('place', `Placed ${placed} window${placed === 1 ? '' : 's'}`, missed.length ? 'warn' : 'ok', missed.length ? `Didn't find ${missed.join(', ')}` : plan.displayFallback.length ? 'A saved display is missing, so its windows went to the main one' : '');
      } else if (withRules.length) step('place', 'Couldn’t move windows', 'warn', 'Scene needs Accessibility access');

      // 5. system
      const sys = scene.system || {};
      const sysDone = [];
      if (sys.volume != null) { await this.platform.setVolume(sys.volume); sysDone.push(`volume ${sys.volume}%`); }
      if (sys.mute != null) { await this.platform.setMute(sys.mute); sysDone.push(sys.mute ? 'muted' : 'unmuted'); }
      if (sys.appearance) { await this.platform.setAppearance(sys.appearance); sysDone.push(`${sys.appearance} mode`); }
      if (sys.wallpaper) { await this.platform.setWallpaper(sys.wallpaper); sysDone.push('wallpaper'); }
      this.keepAwake(!!sys.keepAwake, scene.name); if (sys.keepAwake) sysDone.push('kept awake');
      if (sysDone.length) step('system', 'Set ' + sysDone.join(', '), 'ok');

      // 6. actions
      for (const [i, a] of (scene.actions || []).entries()) {
        if (!a || !a.value) continue;
        const label = a.kind === 'shortcut' ? `Shortcut “${a.value}”` : a.kind === 'delay' ? `Wait ${a.value} s` : 'Command';
        step('act' + i, label, 'run');
        let r;
        if (a.kind === 'delay') { await wait(Math.min(60, Number(a.value) || 0) * 1000); r = { ok: true }; }
        else {
          const job = a.kind === 'shortcut' ? this.platform.runShortcut(a.value) : this.platform.runCommand(a.value);
          r = a.wait ? await job : (job.catch(() => {}), { ok: true });
        }
        step('act' + i, label, r && r.ok === false ? 'warn' : 'ok', r && r.ok === false ? (r.stderr || r.error || '').trim().slice(0, 140) : '');
      }

      // 7. raise the scene's apps over everything else, the chosen front app last so it ends up on top
      const front = (scene.apps || []).find((a) => a.id === scene.focusApp) || null;
      const raise = (scene.apps || []).filter((a) => a !== front && a.windows && a.windows.some((w) => w.state !== 'minimized') && placedWins.has(a.id)).slice(0, 8).reverse();
      for (const a of [...raise, ...(front ? [front] : [])]) { try { await this.platform.focus(a, placedWins.get(a.id)); } catch (_) {} }
      const ms = Date.now() - t0;
      const ok = !steps.some((s) => s.status === 'warn');
      progress({ scene: scene.id, name: scene.name, steps: steps.map((x) => ({ ...x })), done: true, ok, ms });
      return { ok, ms, steps, warn: [...new Set(warn)], previous, placed, missed, trigger };
    } catch (e) {
      step('error', 'Something went wrong', 'warn', e.message);
      progress({ scene: scene.id, name: scene.name, steps: steps.map((x) => ({ ...x })), done: true, ok: false, ms: Date.now() - t0 });
      return { ok: false, ms: Date.now() - t0, steps, warn, previous, error: e.message, trigger };
    } finally { this.busy = false; }
  }

  /** Move one live window (Desktop page). zone is a ZONES key or a {x,y,w,h} fraction; display is a display id. */
  async arrange(win, { zone, displayId, state }) {
    const displays = this.displays();
    const d = displays.find((x) => x.id === String(displayId)) || P.displayForRect(win.bounds, displays);
    const fr = typeof zone === 'string' ? P.ZONES[zone] : zone;
    const full = state === 'maximized' || state === 'fullscreen';
    const rect = full ? { ...d.workArea } : P.fromFrac(fr || P.toFrac(win.bounds, P.displayForRect(win.bounds, displays)), d);
    const [r] = await this.platform.place([{ win, rect, state: state || 'normal' }]);
    return r;
  }

  /** Spread the visible windows on one display into a grid. */
  async tidy(displayId) {
    const snap = await this.snapshot();
    const d = snap.displays.find((x) => x.id === String(displayId)) || snap.displays[0];
    const ws = snap.windows.filter((w) => w.state !== 'minimized' && !w.hidden && P.displayForRect(w.bounds, snap.displays).id === d.id && !P.isProtected(w.app));
    const zones = P.autoZones(ws.length);
    return this.platform.place(ws.map((w, i) => ({ win: w, rect: P.fromFrac(zones[i], d), state: 'normal' })));
  }
}

module.exports = { Engine, winKey };

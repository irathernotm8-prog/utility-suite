// Bench — what each Claude tool does. Plain functions over the desks, runs and findings; every action is written
// to the desk's activity log so the person can watch what Claude did, live.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tail, fmtMs } = require('./core/proc');
const apps = require('./core/apps');

const text = (t) => ({ type: 'text', text: String(t) });
const ok = (...content) => ({ content: content.flat().filter(Boolean) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gb = (n) => `${Math.round(n / 1024 ** 3)} GB`;
const plat = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' };

function makeHandlers(ctx) {
  const { desks, runs, findings } = ctx;
  const image = (shot) => { const { data, mime } = ctx.encode(shot.buffer, shot.mime); return { type: 'image', data, mimeType: mime }; };
  const isSandbox = (d) => d.rec.kind === 'sandbox';
  const deskFor = async (args, { start = false } = {}) => { const d = start ? await desks.ready(args.desk) : desks.rt(args.desk); return d; };
  const needRunning = (d) => { if (!isSandbox(d) && d.state !== 'running') throw new Error(`${d.rec.name} is ${d.state}. Start it with desk_control {action:"start"} (VMs take a minute to boot).`); };
  const needSandbox = (d, what) => { if (!isSandbox(d)) throw new Error(`${what} works on sandbox desks (Electron apps). On ${d.rec.name}, use screenshot and click by coordinates.`); };
  const act = (d, who, e) => desks.record(d.rec.id, { who, ...e });

  /** What changed after an action: new errors, dialogs, windows. */
  async function after(d, args, beforeSeq, { shot = false } = {}) {
    const out = [];
    if (isSandbox(d)) {
      await sleep(260);
      let s; try { s = d.app(args.session); } catch { return out; }
      if (s.exit) out.push(text(`${s.name} has quit (${s.exit.signal || 'code ' + s.exit.code}).`));
      const fresh = s.logs.query({ since: beforeSeq, level: 'warnings', limit: 20 });
      const errs = fresh.filter((e) => e.level === 'error');
      const notes = [];
      if (errs.length) notes.push(`New error${errs.length > 1 ? 's' : ''}: ${errs.slice(0, 5).map((e) => `“${e.text.slice(0, 300)}”`).join('; ')}`);
      const dl = s.pendingDialogs ? s.pendingDialogs() : [];
      if (dl.length) notes.push(`A ${dl[0].kind === 'open' ? 'file Open' : dl[0].kind === 'save' ? 'Save' : 'message'} dialog is waiting${dl[0].message ? `: “${dl[0].message}”${dl[0].buttons.length ? ` [${dl[0].buttons.map((b, i) => `${i}: ${b}`).join(', ')}]` : ''}` : dl[0].title ? ` (“${dl[0].title}”)` : ''} — answer it with answer_dialog.`);
      if (!s.exit) { const ws = await s.windows(); if (ws.length !== (args._wins || ws.length)) notes.push(`Windows now: ${ws.map((w) => `${w.id} “${w.title}”`).join(', ')}`); }
      if (notes.length) out.push(text(notes.join('\n')));
      if (shot && !s.exit) { try { const sh = await d.screenshot({ session: args.session, win: args.window, maxSide: args.max_side || 1400 }); out.push(image(sh)); } catch {} }
    } else if (shot) { await sleep(300); try { out.push(image(await d.screenshot({ maxSide: args.max_side || 1400 }))); } catch {} }
    return out;
  }
  const seqOf = (d, args) => { if (!isSandbox(d)) return 0; try { const s = d.app(args.session); args._wins = (s.windowsCache || []).length; return s.logs.seq; } catch { return 0; } };

  const H = {
    async bench_overview() {
      const h = ctx.host(); const L = [];
      L.push(`This computer: ${plat[h.platform] || h.platform} · ${h.cpu} · ${h.cores} cores · ${gb(h.totalMem)} memory (${gb(h.freeMem)} free). Comfortably runs ~${h.limits.apps} app${h.limits.apps === 1 ? '' : 's'} or ${h.limits.tests} test suite${h.limits.tests === 1 ? '' : 's'} at once.`);
      L.push('', 'Desks:');
      for (const r of desks.list()) {
        const live = r.sessions.filter((s) => s.state !== 'exited');
        L.push(`- ${r.name} [${r.id}] ${r.kindLabel} · ${r.state}${r.detail ? ` (${r.detail})` : ''}${r.kind === 'sandbox' ? (r.hidden !== false ? ' · windows out of sight' : ' · windows on screen') : ''}${live.length ? ` · running: ${live.map((s) => `${s.name} (${s.id}${s.kind === 'electron' ? `, ${(s.windows || []).length} window${(s.windows || []).length === 1 ? '' : 's'}` : s.kind === 'command' ? ', command' : ''})`).join(', ')}` : ''}`);
      }
      const t = await ctx.tart.status().catch(() => null); const w = ctx.winsb.status();
      L.push('', `Mac/Linux VMs: ${t && t.supported ? (t.installed ? `ready (Tart ${t.version || ''})` : 'available (Tart downloads with the first VM desk)') : (t && t.why) || 'not available'}. Windows Sandbox: ${w.supported ? (w.installed ? 'available' : w.why) : w.why}.`);
      const pkg = ctx.pkgDir();
      const inst = apps.installedSuite(pkg);
      L.push('', `Installed Utility Suite apps (${inst.length}): ${inst.map((a) => `${a.name}${a.version ? ' ' + a.version : ''}`).join(', ') || 'none found'}`);
      if (pkg) { const pr = apps.projects(pkg); L.push(`App sources in ${pkg.replace(os.homedir(), '~')}/apps (${pr.length}): ${pr.map((p) => `${p.id} ${p.version}${p.electron ? '' : p.hasDeps ? ' (no Electron)' : ' (packages not installed)'}`).join(', ')}`); }
      else L.push('Utility Package folder: not found (set it in Bench › Settings to run apps from source).');
      const open = findings.list({ status: 'open' });
      L.push('', `Findings: ${open.length} open${open.length ? ` — latest: ${open.slice(0, 3).map((f) => `#${f.number} “${f.title}” (${f.app || '?'})`).join('; ')}` : ''}.`);
      const rr = runs.list().slice(0, 3);
      if (rr.length) L.push(`Recent runs: ${rr.map((r) => `${r.label} — ${r.state}${r.counts ? ` (${r.counts.pass || 0} pass, ${r.counts.warn || 0} warn, ${r.counts.fail || 0} fail)` : ''} [${r.id}]`).join('; ')}`);
      return ok(text(L.join('\n')));
    },

    async launch(args, who) {
      const d = await deskFor(args, { start: true });
      const spec = { ...args }; delete spec.desk;
      act(d, who, { action: 'launch', text: `Opening ${args.app || args.project || args.path || args.url || args.file || args.command}` });
      if (isSandbox(d)) {
        const r = await d.launch(spec, { onProgress: (p) => act(d, 'Bench', { action: 'progress', text: p.label }) });
        const s = r.session; const L = [];
        L.push(`Launched ${s.name}${s.meta && s.meta.version ? ' ' + s.meta.version : ''} on ${d.rec.name} as session ${s.id}${s.kind === 'electron' ? ` (${s.controlled ? 'controllable' : 'logs only'}, data: ${(s.meta && s.meta.data) || 'desk'}, ${s.hidden ? 'out of sight' : 'on screen'})` : ''}.`);
        if (r.note) L.push(r.note);
        const out = [];
        if (s.kind === 'electron' && s.controlled) {
          const a = d.app(s.id); const ws = await a.windows();
          L.push(ws.length ? `Windows: ${ws.map((w) => `${w.id} “${w.title}” ${w.width}×${w.height}${w.visible ? '' : ' (hidden)'}`).join(', ')}` : 'No window yet.');
          if (s.firstWindowMs) L.push(`First window after ${fmtMs(s.firstWindowMs)}.`);
          const errs = a.logs.query({ level: 'errors', limit: 8 }); if (errs.length) L.push(`Errors so far: ${errs.map((e) => `“${e.text.slice(0, 240)}”`).join('; ')}`);
          if (ws.some((w) => w.visible)) { try { out.push(image(await d.screenshot({ session: s.id, maxSide: args.max_side || 1200 }))); } catch (e) { L.push(`(No screenshot: ${e.message})`); } }
        }
        act(d, 'Bench', { action: 'launched', text: `${s.name} is running (${s.id})`, session: s.id });
        return ok(text(L.join('\n')), out);
      }
      needRunning(d);
      const r = await d.launch(spec);
      await sleep(2500);
      const out = []; try { out.push(image(await d.screenshot({ maxSide: 1400 }))); } catch {}
      return ok(text(r.text || (r.output != null ? `Exit code ${r.code}\n${tail(r.output, 8000)}` : 'Done')), out);
    },

    async list_sessions(args) {
      const d = desks.rt(args.desk); const L = [`${d.rec.name} [${d.rec.id}] — ${d.rec.kind === 'sandbox' ? 'ready' : d.state}${d.detail ? ' (' + d.detail + ')' : ''}`];
      if (isSandbox(d)) {
        const list = d.sessions();
        if (!list.length) L.push('Nothing has run yet.');
        for (const s of list) {
          let line = `- ${s.id} ${s.name}${s.meta && s.meta.version ? ' ' + s.meta.version : ''} · ${s.kind} · ${s.state}${s.exit ? ` (${s.exit.signal || 'code ' + s.exit.code})` : ''}`;
          if (s.errors || s.warnings) line += ` · ${s.errors} errors, ${s.warnings} warnings`;
          if (s.crashes) line += ` · ${s.crashes} crash${s.crashes > 1 ? 'es' : ''}`;
          L.push(line);
          if (s.kind === 'electron' && s.state !== 'exited' && s.controlled) {
            const a = d.app(s.id); const ws = await a.windows();
            for (const w of ws) L.push(`    window ${w.id} “${w.title}” ${w.width}×${w.height}${w.visible ? '' : ' hidden'}${w.focused ? ' focused' : ''}${w.loading ? ' loading' : ''}${w.crashed ? ' CRASHED' : ''}`);
            for (const dl of a.pendingDialogs()) L.push(`    waiting dialog ${dl.id}: ${dl.kind}${dl.title ? ` “${dl.title}”` : ''}${dl.message ? ` “${dl.message}”` : ''}${dl.buttons.length ? ` buttons [${dl.buttons.map((b, i) => `${i}: ${b}`).join(', ')}]` : ''}`);
          }
        }
      } else {
        const sz = d.size; L.push(sz ? `Screen ${sz.width}×${sz.height}. Commands: ${d.ssh || d.rec.kind === 'windows-sandbox' ? 'yes' : 'no (no SSH)'}` : 'Not running.');
        if (d.rec.kind === 'windows-sandbox' && d.state === 'running') { try { const ws = await d.windowsList(); L.push(`Windows open: ${ws.map((w) => `${w.name} “${w.title}”`).join(', ') || 'none'}`); } catch {} }
      }
      return ok(text(L.join('\n')));
    },

    async screenshot(args, who) {
      const d = desks.rt(args.desk); needRunning(d);
      const s = await d.screenshot({ session: args.session, win: args.window, maxSide: args.max_side || 1400 });
      act(d, who, { action: 'look', text: 'Took a screenshot', session: s.session, win: s.win, thumb: true });
      const cap = isSandbox(d) ? `${s.app} · window ${s.win} “${s.title}” · ${s.width}×${s.height}${s.scale !== 1 ? ` (shrunk ×${(1 / s.scale).toFixed(2)}; coordinates refer to this picture)` : ''}` : `${d.rec.name} screen${d.size ? ` ${d.size.width}×${d.size.height}` : ''}${s.scale !== 1 ? `, shown at ${s.width}×${s.height} — coordinates refer to this picture` : ''}`;
      return ok(text(cap), image(s));
    },

    async inspect(args, who) {
      const d = desks.rt(args.desk); needSandbox(d, 'inspect');
      const r = await d.inspect({ session: args.session, win: args.window });
      act(d, who, { action: 'inspect', text: `Read window ${r.win} (${r.snapshot.items.length} elements)`, session: r.session, win: r.win });
      return ok(text(`${r.app} (session ${r.session})\n${r.text}`));
    },

    async click(args, who) {
      const d = desks.rt(args.desk); needRunning(d);
      const before = seqOf(d, args);
      const r = await d.click({ session: args.session, win: args.window, x: args.x, y: args.y, ref: args.ref, text: args.text, button: args.button || 'left', count: args.double ? 2 : 1 });
      const what = args.ref ? `${args.ref}${r.tag ? ' (' + r.tag + ')' : ''}` : args.text ? `“${args.text}”` : `${args.x},${args.y}`;
      act(d, who, { action: 'click', text: `${args.double ? 'Double-clicked' : args.button === 'right' ? 'Right-clicked' : 'Clicked'} ${what}`, x: r.x, y: r.y, win: r.win, session: r.session || args.session });
      return ok(text(`${args.double ? 'Double-clicked' : 'Clicked'} ${what}${r.x != null && (args.ref || args.text) ? ` at ${r.x},${r.y}` : ''}${r.win ? ` in window ${r.win}` : ''}${r.matches > 1 ? ` (best of ${r.matches} matches for that text)` : ''}.`), await after(d, args, before, { shot: args.then_screenshot }));
    },
    async type(args, who) {
      const d = desks.rt(args.desk); needRunning(d);
      if (args.ref) needSandbox(d, 'Typing into a ref');
      const before = seqOf(d, args);
      const r = await d.type({ session: args.session, win: args.window, text: args.text, ref: args.ref, submit: args.submit, clear: args.clear });
      const shown = args.text.length > 60 ? args.text.slice(0, 60) + '…' : args.text;
      act(d, who, { action: 'type', text: `Typed “${shown}”${args.ref ? ` into ${args.ref}` : ''}${args.submit ? ' and pressed Enter' : ''}`, session: args.session, win: r && r.win });
      if (!isSandbox(d) && args.submit) await d.press({ keys: 'Enter' });
      return ok(text(r && r.picked ? `Picked “${r.picked}”.` : `Typed ${args.text.length} characters${args.submit ? ' and pressed Enter' : ''}.`), await after(d, args, before, { shot: args.then_screenshot }));
    },
    async press_keys(args, who) {
      const d = desks.rt(args.desk); needRunning(d); const before = seqOf(d, args);
      const r = await d.press({ session: args.session, win: args.window, keys: args.keys, repeat: args.repeat || 1 });
      act(d, who, { action: 'keys', text: `Pressed ${args.keys}${args.repeat > 1 ? ' ×' + args.repeat : ''}${r && r.menu ? ` (menu: ${r.menu})` : ''}`, session: args.session });
      return ok(text(`Pressed ${args.keys}${r && r.menu ? ` — that’s the app’s menu item “${r.menu}”, so Bench chose it from the menu` : ''}.`), await after(d, args, before, { shot: args.then_screenshot }));
    },
    async scroll(args, who) {
      const d = desks.rt(args.desk); needRunning(d); const before = seqOf(d, args);
      let { x, y } = args;
      if (x == null || y == null) { if (isSandbox(d)) { const a = d.app(args.session); const ws = await a.windows(); const w = args.window ? ws.find((q) => q.id === +args.window) : ws.find((q) => q.visible) || ws[0]; const sc = (a.lastShot.get(w && w.id) || { scale: 1 }).scale; x = Math.round(((w ? w.width : 800) / 2) / sc); y = Math.round(((w ? w.height : 600) / 2) / sc); } else { const sz = d.size || { width: 1280, height: 800 }; x = Math.round(sz.width / 2 / d.shotScale); y = Math.round(sz.height / 2 / d.shotScale); } }
      await d.scroll({ session: args.session, win: args.window, x, y, dx: args.dx || 0, dy: args.dy == null && !args.dx ? 300 : args.dy || 0 });
      act(d, who, { action: 'scroll', text: `Scrolled ${args.dy < 0 ? 'up' : args.dx ? 'sideways' : 'down'}`, x, y, session: args.session });
      return ok(text(`Scrolled at ${x},${y}.`), await after(d, args, before, { shot: args.then_screenshot }));
    },
    async drag(args, who) {
      const d = desks.rt(args.desk); needRunning(d); const before = seqOf(d, args);
      const [x1, y1] = args.from, [x2, y2] = args.to;
      await d.drag({ session: args.session, win: args.window, x1, y1, x2, y2 });
      act(d, who, { action: 'drag', text: `Dragged from ${x1},${y1} to ${x2},${y2}`, x: x2, y: y2, session: args.session });
      return ok(text(`Dragged from ${x1},${y1} to ${x2},${y2}.`), await after(d, args, before, { shot: args.then_screenshot }));
    },
    async wait_for(args) {
      const d = desks.rt(args.desk); needSandbox(d, 'wait_for');
      const r = await d.waitFor({ session: args.session, win: args.window, text: args.text, gone: args.gone, timeout: (args.timeout_seconds || 10) * 1000 });
      return ok(text(r.timedOut ? `Timed out after ${fmtMs(r.ms)}: “${args.text}” ${args.gone ? 'is still there' : 'didn’t appear'}.` : `“${args.text}” ${args.gone ? 'is gone' : `appeared in window ${r.win}`} after ${fmtMs(r.ms)}.`));
    },
    async menu(args, who) {
      const d = desks.rt(args.desk); needSandbox(d, 'menu');
      const before = seqOf(d, args);
      const r = await d.menu({ session: args.session, win: args.window, path: args.path });
      if (r.clicked) { act(d, who, { action: 'menu', text: `Chose ${r.clicked} from the menu`, session: args.session }); return ok(text(`Chose ${r.clicked}.`), await after(d, args, before)); }
      const lines = []; const walk = (items, depth) => { for (const it of items || []) { lines.push(`${'  '.repeat(depth)}${it.label}${it.accelerator ? `  (${it.accelerator})` : ''}${it.enabled === false ? '  [disabled]' : ''}${it.checked != null ? (it.checked ? '  [✓]' : '  [ ]') : ''}`); if (it.submenu) walk(it.submenu, depth + 1); } };
      walk(r.items, 0);
      return ok(text(lines.length ? lines.join('\n') : 'This app has no menu bar.'));
    },
    async answer_dialog(args, who) {
      const d = desks.rt(args.desk); needSandbox(d, 'answer_dialog');
      const a = d.app(args.session); const pending = a.pendingDialogs();
      const kind = args.kind || (pending[0] && pending[0].kind) || (args.paths ? 'open' : args.path ? 'save' : 'message');
      const ans = args.cancel ? { kind, cancel: true } : kind === 'open' ? { kind, paths: (args.paths || (args.path ? [args.path] : [])).map((p) => p.replace(/^~(?=$|[\\/])/, os.homedir())) } : kind === 'save' ? { kind, path: String(args.path || '').replace(/^~(?=$|[\\/])/, os.homedir()) } : { kind, button: args.button != null ? args.button : 0 };
      if (kind === 'open' && !args.cancel && !ans.paths.length) throw new Error('Give paths for the Open dialog (or cancel:true)');
      if (kind === 'save' && !args.cancel && !ans.path) throw new Error('Give a path for the Save dialog (or cancel:true)');
      const r = await a.answerDialog(ans);
      act(d, who, { action: 'dialog', text: `${r.answered ? 'Answered' : 'Will answer the next'} ${kind} dialog: ${args.cancel ? 'Cancel' : kind === 'message' ? 'button ' + ans.button : (ans.paths || [ans.path]).join(', ')}`, session: a.id });
      await sleep(300);
      return ok(text(r.answered ? `Answered the ${kind} dialog${r.answered.title ? ` “${r.answered.title}”` : ''}.` : `No ${kind} dialog is open; Bench will use that answer for the next one.`), await after(d, args, a.logs.seq));
    },
    async evaluate(args, who) {
      const d = desks.rt(args.desk); needSandbox(d, 'evaluate');
      const v = await d.evaluate({ session: args.session, win: args.window, code: args.code, where: args.where || 'window' });
      act(d, who, { action: 'code', text: `Ran JavaScript in the ${args.where === 'main' ? 'main process' : 'window'}`, session: args.session });
      let s; try { s = v === undefined ? 'undefined' : JSON.stringify(v, null, 2); } catch { s = String(v); }
      return ok(text(tail(s, 20000)));
    },
    async logs(args) {
      const d = desks.rt(args.desk); let src = null; let label = d.rec.name;
      if (isSandbox(d)) { try { src = d.session(args.session); label = `${src.name} (${src.id})`; } catch { src = null; } }
      const buf = src ? src.logs : d.logs;
      const items = buf.query({ since: args.since || 0, level: args.level || 'all', limit: Math.min(args.limit || 120, 500) });
      const c = buf.counts();
      const lines = items.map((e) => `#${e.seq} ${new Date(e.t).toLocaleTimeString()} [${e.level}] ${e.source}${e.win ? ' w' + e.win : ''}: ${e.text}${e.url && !/^node:|^electron/.test(e.url) ? `  (${String(e.url).split('/').slice(-2).join('/')}${e.line ? ':' + e.line : ''})` : ''}`);
      return ok(text(`${label} — ${c.errors} errors, ${c.warnings} warnings in total. Latest seq: ${buf.seq}.\n${lines.join('\n') || '(nothing' + (args.since ? ' new' : '') + ')'}`));
    },
    async run_command(args, who) {
      const d = await deskFor(args, { start: false }); needRunning(d);
      if (isSandbox(d) && !ctx.settings().allowCommands) throw new Error('Running commands on this computer is switched off in Bench › Claude.');
      act(d, who, { action: 'command', text: `$ ${args.command.slice(0, 200)}` });
      const r = await d.run(args.command, { timeout: (args.timeout_seconds || 120) * 1000, cwd: args.cwd, isolate: args.isolate });
      act(d, 'Bench', { action: 'command-done', text: r.timedOut ? 'Still running' : `Exit code ${r.code} · ${fmtMs(r.ms)}`, ok: r.code === 0 });
      return ok(text(`${r.timedOut ? `Still running after ${args.timeout_seconds || 120} s${r.session ? ` (session ${r.session}; read more with logs or stop it with stop_session)` : ''}` : `Exit code ${r.code}`} · ${fmtMs(r.ms)}\n${tail(r.output, 16000) || '(no output)'}`));
    },
    async copy_files(args, who) {
      const d = desks.rt(args.desk); needRunning(d);
      const exp = (p) => (p ? String(p).replace(/^~(?=$|[\\/])/, os.homedir()) : p);
      let r;
      if (args.direction === 'in') { r = await d.copyIn(exp(args.from), args.to); act(d, who, { action: 'copy', text: `Copied ${path.basename(args.from)} in` }); return ok(text(`Copied into the desk: ${r.to}`)); }
      const to = exp(args.to) || path.join(os.homedir(), 'Downloads', 'Bench', path.basename(String(args.from).replace(/[\\/]+$/, '')));
      r = await d.copyOut(args.from, to); act(d, who, { action: 'copy', text: `Copied ${args.from} out` });
      return ok(text(`Copied out to ${r.to}`));
    },
    async set_window(args, who) {
      const d = desks.rt(args.desk); needSandbox(d, 'set_window'); const a = d.app(args.session); const L = [];
      if (args.visible != null) { await a.setHidden(!args.visible); L.push(args.visible ? 'Windows are on screen' : 'Windows are out of sight'); }
      if (args.width && args.height) { const w = await a.call('setSize', args.window || null, args.width, args.height); L.push(`Window ${w.id} is now ${w.width}×${w.height}`); }
      if (args.focus) { await a.focus(args.window); L.push('Brought forward'); }
      if (args.reload) { await a.call('reload', args.window || null); L.push('Reloaded'); }
      if (args.close) { await a.closeWindow(args.window || (await a._resolveWin())); L.push('Closed the window'); }
      act(d, who, { action: 'window', text: L.join(', ') || 'No change', session: a.id });
      return ok(text(L.join('. ') + '.'));
    },
    async stop_session(args, who) {
      const d = desks.rt(args.desk); needSandbox(d, 'stop_session');
      const s = await d.quit(d.session(args.session).id);
      act(d, who, { action: 'stop', text: `Stopped ${s.name}`, session: s.id });
      return ok(text(`Stopped ${s.name}${s.errors ? ` (it logged ${s.errors} errors while running)` : ''}.`));
    },
    async desk_control(args, who) {
      const d = desks.rt(args.desk); const id = d.rec.id; let msg;
      switch (args.action) {
        case 'start': await desks.start(id); msg = `${d.rec.name} is running.`; break;
        case 'stop': await desks.stop(id); msg = `${d.rec.name} is stopped.`; break;
        case 'reset': await desks.reset(id); msg = isSandbox(d) ? `${d.rec.name}’s data was wiped; apps start fresh.` : `${d.rec.name} is back to its clean copy.`; break;
        case 'save_clean': await desks.saveClean(id); msg = 'Saved as the clean copy.'; break;
        case 'show_windows': case 'hide_windows': desks.update(id, { hidden: args.action === 'hide_windows' }); msg = args.action === 'hide_windows' ? 'Windows on this desk are now out of sight.' : 'Windows on this desk are now on screen.'; break;
        default: throw new Error('Unknown action');
      }
      act(d, who, { action: args.action, text: msg });
      return ok(text(msg));
    },
    async create_desk(args, who) {
      const rec = desks.create({ name: args.name, kind: args.kind, image: args.image, cpu: args.cpu, memoryGB: args.memory_gb, hidden: args.hidden, host: args.host, vncPort: args.vnc_port, vncPassword: args.vnc_password, sshUser: args.ssh_user, sshPassword: args.ssh_password, sshPort: args.ssh_port });
      desks.record(rec.id, { who, action: 'create', text: 'Created by ' + who });
      const vm = rec.kind === 'mac-vm' || rec.kind === 'linux-vm';
      return ok(text(`Created ${rec.name} [${rec.id}] (${rec.kind}).${vm ? ' Bench is getting the VM ready in the background (the first one downloads the system, which can take a while); start it with desk_control when it’s ready.' : rec.kind === 'sandbox' ? ' Ready to launch apps.' : ' Start it with desk_control.'}`));
    },

    async smoke_test(args, who) {
      const run = await runs.smoke({ apps: args.apps && args.apps.length ? args.apps : 'all', source: args.source || 'auto', parallel: args.parallel, wait_seconds: args.wait_seconds != null ? args.wait_seconds : 4, who });
      if (args.wait === false) return ok(text(`Started ${run.label} [${run.id}] — ${run.items.length} apps, ${run.parallel} at a time. Check it with get_run.`));
      await run.promise; return H.get_run({ id: run.id, images: true });
    },
    async run_tests(args, who) {
      const run = await runs.tests({ projects: args.projects && args.projects.length ? args.projects : 'all', script: args.script || 'test', parallel: args.parallel, timeout_minutes: args.timeout_minutes || 10, who });
      if (args.wait === false) return ok(text(`Started ${run.label} [${run.id}] — ${run.items.length} projects, ${run.parallel} at a time. Check it with get_run.`));
      await run.promise; return H.get_run({ id: run.id });
    },
    async get_run(args) {
      if (!args.id) { const rr = runs.list().slice(0, 8); return ok(text(rr.map((r) => `${r.id} · ${r.label} · ${r.state}${r.counts ? ` · ${r.counts.pass || 0} pass, ${r.counts.warn || 0} warn, ${r.counts.fail || 0} fail` : ''} · ${new Date(r.started).toLocaleString()}`).join('\n') || 'No runs yet.')); }
      const r = runs.get(args.id); if (!r) throw new Error(`No run ${args.id}`);
      const mark = { pass: '✓', warn: '!', fail: '✗', skipped: '–', running: '…', queued: '·' };
      const L = [`${r.label} — ${r.state}${r.ms ? ` in ${fmtMs(r.ms)}` : ''}, ${r.parallel} at a time${r.counts ? ` · ${r.counts.pass || 0} pass, ${r.counts.warn || 0} with warnings, ${r.counts.fail || 0} fail` : ''}`];
      for (const it of r.items) {
        let l = `${mark[it.status] || '?'} ${it.name}${it.version ? ' ' + it.version : ''}${it.source && r.kind === 'smoke' ? ` (${it.source})` : ''} — ${it.status}`;
        if (r.kind === 'smoke') { if (it.windowMs) l += ` · window in ${fmtMs(it.windowMs)}`; if (it.windows) l += ` · ${it.windows.length} window${it.windows.length === 1 ? '' : 's'}`; if (it.warnings) l += ` · ${it.warnings} warnings`; }
        else if (it.summary) l += ` · ${it.summary}`;
        if (it.ms) l += ` · ${fmtMs(it.ms)}`;
        L.push(l);
        if (it.fatal) L.push(`    ${it.fatal}`);
        for (const c of it.crashes || []) L.push(`    crash: ${c}`);
        for (const e of (it.errors || []).slice(0, args.full ? 40 : 6)) L.push(`    ${e}`);
        if (args.full && it.output) L.push('    --- output ---', tail(it.output, 6000).split('\n').map((x) => '    ' + x).join('\n'));
        if (args.full && it.log) L.push('    --- log ---', tail(it.log, 6000).split('\n').map((x) => '    ' + x).join('\n'));
      }
      const out = [text(L.join('\n'))];
      if (args.images && r.kind === 'smoke') {
        for (const it of r.items.filter((i) => (i.status === 'fail' || i.status === 'warn') && i.shots && i.shots.length).slice(0, 4)) {
          try { out.push(text(`${it.name}:`), image({ buffer: fs.readFileSync(it.shots[0].file), mime: 'image/png' })); } catch {}
        }
      }
      return ok(out);
    },

    async report_finding(args, who) {
      let d = null; try { d = desks.rt(args.desk); } catch {}
      let app = args.app || '', version = ''; const shots = []; let logs = '';
      if (d && isSandbox(d)) {
        let s = null; try { s = d.session(args.session); } catch {}
        if (s) {
          if (!app) app = s.name; version = (s.meta && s.meta.version) || '';
          if (args.screenshot !== false && s.running && s.controlled) { try { const sh = await d.screenshot({ session: s.id, win: args.window, maxSide: 1600 }); shots.push(sh); } catch {} }
          if (args.logs !== false) logs = s.logs.query({ limit: 400 }).map((e) => `${new Date(e.t).toISOString()} [${e.level}] ${e.source}${e.win ? ' w' + e.win : ''}: ${e.text}`).join('\n');
        }
      } else if (d && d.state === 'running') {
        if (args.screenshot !== false) { try { shots.push(await d.screenshot({ maxSide: 1600 })); } catch {} }
        if (args.logs !== false) logs = d.logs.query({ limit: 200 }).map((e) => `[${e.level}] ${e.text}`).join('\n');
      }
      const f = findings.add({ title: args.title, severity: args.severity, app, version, desk: d ? d.rec.id : '', deskName: d ? d.rec.name : '', steps: args.steps, expected: args.expected, actual: args.actual, notes: args.notes, screenshots: shots, logs, who });
      if (d) act(d, who, { action: 'finding', text: `Filed finding #${f.number}: ${f.title}`, ok: false });
      return ok(text(`Filed finding #${f.number} “${f.title}” (${f.severity})${app ? ` for ${app}${version ? ' ' + version : ''}` : ''}${shots.length ? ' with a screenshot' : ''}${logs ? `${shots.length ? ' and' : ' with'} logs` : ''}. The user sees it in Bench › Findings.`));
    },
    async list_findings(args) {
      const list = findings.list({ status: args.status || 'open', app: args.app });
      return ok(text(list.length ? list.map((f) => `#${f.number} [${f.id}] ${f.status} · ${f.severity} · ${f.app || '?'}${f.version ? ' ' + f.version : ''} — ${f.title}${f.actual ? `\n    ${f.actual.slice(0, 200)}` : ''}`).join('\n') : `No ${args.status && args.status !== 'all' ? args.status + ' ' : ''}findings.`));
    },
    async update_finding(args, who) {
      const f = findings.update(args.id, { status: args.status, note: args.note ? `${who}: ${args.note}` : undefined });
      return ok(text(`Finding #${f.number} is ${f.status}.`));
    },
  };
  return async (name, args, who = 'Claude') => {
    const fn = H[name]; if (!fn) throw new Error('Unknown tool ' + name);
    const label = /codex/i.test(who) ? 'Codex' : /claude-code|claude code/i.test(who) ? 'Claude Code' : 'Claude';
    try { return await fn(args || {}, label); }
    catch (e) {
      try { const d = desks.find(args && args.desk); if (d && !['bench_overview', 'list_findings', 'get_run', 'logs'].includes(name)) desks.record(d.id, { who: label, action: name, text: `${name.replace(/_/g, ' ')} failed: ${e.message}`, ok: false }); } catch {}
      return { content: [text(`Error: ${e.message}`)], isError: true };
    }
  };
}

module.exports = { makeHandlers };

// Cadence — answers tool calls from Claude / Codex (through the bridge). Plain functions over the engine so they
// can be tested without Electron.
'use strict';
const { referenceText } = require('./core/catalog');
const { describe } = require('./core/schedule');
const ai = require('./core/ai');

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const err = (m) => ({ content: [{ type: 'text', text: m }], isError: true });

function runReport(snap) {
  return {
    run_id: snap.id, automation: snap.flowName, status: snap.status, error: snap.error || undefined, note: snap.result || undefined,
    started: snap.startedAt ? new Date(snap.startedAt).toISOString() : null, seconds: snap.endedAt && snap.startedAt ? Math.round((snap.endedAt - snap.startedAt) / 100) / 10 : null,
    steps: snap.steps.map((s) => ({ id: s.id, name: s.name, status: s.status, summary: s.summary || undefined, error: s.error || undefined, log: (s.log || []).slice(-12).map((l) => (l.level !== 'info' ? `[${l.level}] ` : '') + l.msg) })),
    outputs: snap.outputs, files: snap.files,
  };
}

function makeHandlers(engine, { settings = () => ({}), onActivity = () => {} } = {}) {
  const wait = (run, secs) => new Promise((res) => { if (['done', 'failed', 'cancelled'].includes(run.status)) return res(true); const t = setTimeout(() => res(false), secs * 1000); run.once('end', () => { clearTimeout(t); res(true); }); });
  const H = {
    cadence_reference: () => text(referenceText()),
    cadence_context: () => {
      const av = ai.available(engine.store.secrets);
      return text({
        automations: engine.list().map((f) => ({ id: f.id, name: f.name, enabled: f.enabled, when: f.when, next_run: f.nextAt ? new Date(f.nextAt).toISOString() : null, last_run: f.lastRun ? { status: f.lastRun.status, at: new Date(f.lastRun.at).toISOString() } : null })),
        browser_profiles: engine.store.profiles().map((p) => p.id),
        secrets: engine.store.secrets.names(),
        ai: { claude_code: !!av.claude, codex: !!av.codex, anthropic_api_key: av.anthropic, openai_api_key: av.openai },
        default_output_folder: settings().outputRoot || '~/Documents/Cadence/<automation name>', week_starts_on: Number(settings().weekStart ?? 1) === 0 ? 'Sunday' : 'Monday',
        now: new Date().toString(), platform: process.platform,
      });
    },
    list_automations: () => text(engine.list().map((f) => ({ id: f.id, name: f.name, description: f.description, enabled: f.enabled, when: f.when, steps: f.steps, next_run: f.nextAt ? new Date(f.nextAt).toISOString() : null, last_run: f.lastRun }))),
    get_automation: ({ id }) => text(engine.get(id)),
    create_automation: ({ automation }) => {
      if (!automation || typeof automation !== 'object') return err('Pass the automation JSON as "automation"');
      const a = { ...automation }; delete a.id;
      if (a.enabled === undefined) a.enabled = false;
      const { flow, problems } = engine.save({ ...a, createdBy: 'ai' });
      onActivity(`Created “${flow.name}”`, flow.id);
      return text({ id: flow.id, name: flow.name, enabled: flow.enabled, when: describe(flow.trigger), step_ids: flow.steps.map((s) => s.id), problems: problems.errors, warnings: problems.warnings, next: problems.ok ? 'Test it with test_step or run_automation.' : 'Fix the problems with update_automation.' });
    },
    update_automation: ({ id, automation }) => {
      const cur = engine.get(id);
      if (!automation || typeof automation !== 'object') return err('Pass the whole automation JSON as "automation"');
      const { flow, problems } = engine.save({ ...automation, id: cur.id, createdAt: cur.createdAt });
      onActivity(`Updated “${flow.name}”`, flow.id);
      return text({ id: flow.id, name: flow.name, enabled: flow.enabled, when: describe(flow.trigger), step_ids: flow.steps.map((s) => s.id), problems: problems.errors, warnings: problems.warnings });
    },
    set_enabled: ({ id, enabled }) => { const f = engine.setEnabled(id, !!enabled); const c = engine.card(f); return text({ id, enabled: c.enabled, when: c.when, next_run: c.nextAt ? new Date(c.nextAt).toString() : null }); },
    run_automation: async ({ id, inputs, wait_seconds }, client) => {
      const v = engine.check(engine.get(id)); if (!v.ok) return err('Fix these first:\n' + v.errors.map((e) => `- ${e.step ? e.step + ': ' : ''}${e.msg}`).join('\n'));
      const run = engine.start(id, { trigger: { kind: 'ai', client }, inputs: inputs || {} });
      if (!run) return err('That automation is already running');
      onActivity(`Running “${run.flow.name}”`, id);
      const finished = await wait(run, Math.min(1800, Number(wait_seconds) || 600));
      return text(finished ? runReport(engine.getRun(run.id)) : { run_id: run.id, status: 'running', note: 'Still running — check with get_run.' });
    },
    test_step: async ({ id, step_id }, client) => {
      const f = engine.get(id);
      if (!f.steps.some((s) => s.id === step_id)) return err(`No step “${step_id}”. Steps: ${f.steps.map((s) => s.id).join(', ')}`);
      const run = engine.start(id, { trigger: { kind: 'test', client }, upTo: step_id });
      await wait(run, 900);
      const snap = engine.getRun(run.id); const rep = runReport(snap);
      return text({ ...rep, step_output: snap.outputs[step_id] });
    },
    get_run: ({ run_id }) => text(runReport(engine.getRun(run_id))),
    list_runs: ({ id, limit }) => text(engine.runs({ flowId: id || null, limit: Math.min(100, Number(limit) || 20) }).map((r) => ({ run_id: r.id, automation: r.flowName, status: r.status, trigger: r.trigger && r.trigger.kind, started: r.startedAt ? new Date(r.startedAt).toISOString() : null, error: r.error || undefined, test: r.partial || undefined }))),
    cancel_run: ({ run_id }) => text({ cancelled: engine.cancel(run_id) }),
    delete_automation: ({ id }) => { const f = engine.get(id); engine.remove(id); onActivity(`Deleted “${f.name}”`); return text({ deleted: id, name: f.name }); },
  };
  return async (name, args, client) => {
    const fn = H[name]; if (!fn) return err('Unknown tool ' + name);
    try { return await fn(args || {}, client); } catch (e) { return err(e.message || String(e)); }
  };
}

module.exports = { makeHandlers, runReport };

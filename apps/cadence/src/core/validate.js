// Cadence — checks an automation before it's saved or run: known step types, required fields, and that every
// {{steps.x}} points at an earlier step. Returns problems in plain words (shown in the editor and to Claude/Codex).
'use strict';
const { STEPS } = require('./catalog');
const { refs } = require('./template');

const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

function slugId(s, taken) {
  let base = String(s || 'step').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 's$1').slice(0, 28) || 'step';
  let id = base; let n = 2; while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id); return id;
}

// Fix up what can be fixed safely (ids, names, missing with{}), so hand-written or AI-written JSON just works.
function normalize(flow) {
  const f = JSON.parse(JSON.stringify(flow || {}));
  f.name = String(f.name || 'Untitled automation').trim().slice(0, 120);
  f.trigger = f.trigger && typeof f.trigger === 'object' ? f.trigger : { type: 'manual' };
  if (!f.trigger.type) f.trigger.type = 'manual';
  if (f.trigger.type === 'schedule') { f.trigger.every = f.trigger.every || 'week'; if (f.trigger.catchUp === undefined) f.trigger.catchUp = true; if (!f.trigger.time && !['minutes', 'hours'].includes(f.trigger.every)) f.trigger.time = '09:00'; }
  f.steps = Array.isArray(f.steps) ? f.steps.filter((s) => s && typeof s === 'object') : [];
  const taken = new Set();
  for (const s of f.steps) {
    if (s.id && ID_RE.test(s.id) && !taken.has(s.id)) taken.add(s.id); else s.id = null;
  }
  for (const s of f.steps) {
    if (!s.id) s.id = slugId(s.name || (STEPS[s.type] && STEPS[s.type].label) || s.type, taken);
    if (!s.with || typeof s.with !== 'object') s.with = {};
    // tolerate fields placed at the top level of the step
    if (STEPS[s.type]) for (const fl of STEPS[s.type].fields) if (s[fl.key] !== undefined && s.with[fl.key] === undefined) { s.with[fl.key] = s[fl.key]; delete s[fl.key]; }
  }
  if (f.enabled === undefined) f.enabled = true;
  return f;
}

function isBlank(v) { return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length); }

function validate(flow, { secretNames = null, flowIds = null, profiles = null } = {}) {
  const errors = []; const warnings = [];
  const add = (list, step, field, msg) => list.push({ step: step || null, field: field || null, msg });
  if (!flow.name) add(errors, null, 'name', 'Give the automation a name');
  const t = flow.trigger || {};
  if (!['manual', 'schedule', 'watch'].includes(t.type)) add(errors, null, 'trigger', `Unknown trigger “${t.type}”`);
  if (t.type === 'schedule') {
    if (!['minutes', 'hours', 'day', 'week', 'month'].includes(t.every)) add(errors, null, 'trigger', 'Pick how often it runs');
    if (t.time && !/^\d{1,2}:\d{2}$/.test(t.time)) add(errors, null, 'trigger', 'Time should look like 08:00');
    if (t.every === 'minutes' && Number(t.interval) < 5) add(warnings, null, 'trigger', 'Runs more often than every 5 minutes can be heavy');
    if (t.every === 'week' && Array.isArray(t.days) && !t.days.length) add(errors, null, 'trigger', 'Pick at least one day');
  }
  if (t.type === 'watch' && isBlank(t.folder)) add(errors, null, 'trigger', 'Pick a folder to watch');
  if (!flow.steps.length) add(warnings, null, null, 'Add a step');
  const seen = [];
  for (const s of flow.steps) {
    const def = STEPS[s.type];
    if (!def) { add(errors, s.id, null, `Unknown step type “${s.type}”`); seen.push(s.id); continue; }
    if (s.off) { seen.push(s.id); continue; }
    for (const fl of def.fields) {
      if (!fl.required) continue;
      if (fl.show) { const ok = Object.entries(fl.show).every(([k, v]) => (Array.isArray(v) ? v.includes(s.with[k]) : s.with[k] === v)); if (!ok) continue; }
      if (isBlank(s.with[fl.key])) add(errors, s.id, fl.key, `${fl.label} is needed`);
    }
    for (const r of refs(s.with)) {
      if (r.startsWith('steps.')) {
        const id = r.slice(6);
        if (id === s.id) add(errors, s.id, null, `Uses its own output ({{steps.${id}}})`);
        else if (!seen.includes(id)) add(errors, s.id, null, flow.steps.some((x) => x.id === id) ? `Uses {{steps.${id}}} before that step has run — move it lower` : `There’s no step “${id}”`);
      } else if (r.startsWith('secrets.') && secretNames && !secretNames.includes(r.slice(8))) add(warnings, s.id, null, `Secret “${r.slice(8)}” isn’t saved yet (Connections › Secrets)`);
    }
    if (s.type === 'web.browser') {
      if (!Array.isArray(s.with.actions)) add(errors, s.id, 'actions', 'Actions should be a list');
      if (profiles && s.with.profile && !profiles.includes(s.with.profile)) add(warnings, s.id, 'profile', `Browser profile “${s.with.profile}” will be created; sign in to it once from Connections`);
    }
    if (s.type === 'logic.run' && flowIds && s.with.flow && !flowIds.includes(s.with.flow)) add(errors, s.id, 'flow', 'That automation doesn’t exist');
    if (s.type === 'doc.slides' && isBlank(s.with.slides) && isBlank(s.with.slidesFrom)) add(errors, s.id, 'slides', 'Add slides');
    if (s.type === 'doc.report' && isBlank(s.with.sections) && isBlank(s.with.sectionsFrom)) add(errors, s.id, 'sections', 'Add sections');
    seen.push(s.id);
  }
  return { ok: !errors.length, errors, warnings };
}

module.exports = { validate, normalize, slugId, ID_RE };

// Cadence — "Describe it": turns a sentence into an automation with Claude or Codex, then checks it and asks
// the AI to fix anything the checker finds (once).
'use strict';
const { referenceText } = require('./catalog');
const { normalize, validate } = require('./validate');
const ai = require('./ai');

function buildPrompt(description, { existing, context } = {}) {
  return [
    'You write automations for Cadence, a desktop automation app (Mac and Windows). Reply with ONLY the automation JSON.',
    referenceText(),
    'Guidance: use a web.browser step with a sign-in profile for sites that need logging in (the user signs in once; never put passwords in actions — use {{secrets.NAME}}). Put weekly folders under ~/Documents/<something>/{{week.label}}. Keep downloads in the run folder and use file.save to file them. Use data.read → data.transform → data.compare → doc.slides / doc.report for reports. Column names you do not know: make a sensible guess and say so in "description". Give steps short snake_case ids and clear names.',
    context ? `What exists on this computer:\n${context}` : '',
    existing ? `Change this existing automation as asked, keeping its id and everything not mentioned:\n${JSON.stringify(existing, null, 1)}` : '',
    `The user wants: ${description}`,
  ].filter(Boolean).join('\n\n');
}

async function draft({ description, existing, context, provider = 'auto', secrets, dir, signal, log = () => {}, check }) {
  const prompt = buildPrompt(description, { existing, context });
  let r = await ai.ask({ provider, prompt, json: true, timeout: 300, signal, dir, secrets, log });
  let flow = normalize(r.json);
  let v = check ? check(flow) : validate(flow);
  if (!v.ok) {
    log('Fixing a few problems…');
    const fix = `${prompt}\n\nYour previous answer:\n${JSON.stringify(r.json)}\n\nIt has these problems:\n${v.errors.map((e) => `- ${e.step ? e.step + ': ' : ''}${e.msg}`).join('\n')}\n\nReply with the corrected automation JSON only.`;
    r = await ai.ask({ provider, prompt: fix, json: true, timeout: 300, signal, dir, secrets, log });
    flow = normalize(r.json);
    v = check ? check(flow) : validate(flow);
  }
  if (existing && existing.id) flow.id = existing.id;
  return { flow, problems: v, provider: r.provider };
}

module.exports = { draft, buildPrompt };

// "Map with AI": read the template's map and the values this automation produces, and say what goes where.
async function mapTemplate({ analysis, values, provider = 'auto', secrets, dir, signal, log = () => {} }) {
  const slides = analysis.slides.map((s) => ({ slide: s.index, title: s.title, shapes: s.shapes.filter((x) => ['text', 'table', 'chart', 'picture'].includes(x.kind)).map((x) => ({ id: x.id, name: x.name, kind: x.kind, text: x.text ? x.text.slice(0, 200) : undefined, table: x.table ? { header: x.table.header, sampleRow: x.table.cells[1], rows: x.table.rows, totalRow: x.table.totalRow } : undefined, chart: x.chart ? { type: x.chart.type, series: x.chart.series, categories: x.chart.categories.slice(0, 8) } : undefined, isTitle: x.isTitle || undefined })) }));
  const prompt = [
    'You map a PowerPoint template to live data for Cadence, an automation app. Each run copies the template and puts new values where the old ones were, keeping the formatting.',
    'TEMPLATE (slides, with each element’s id, name, kind and current content):', JSON.stringify(slides),
    'VALUES AVAILABLE (template expressions, what they are, and an example value from the last run):', JSON.stringify(values.slice(0, 400)),
    'Return JSON {"fills": [...], "repeat": [...], "notes": "one or two sentences on anything you could not map"}.',
    'fills items: {"slide": N, "shape": {"id": "…", "name": "…"}, "kind": "text"|"replace"|"table"|"chart"|"picture", ...}.',
    '- "text": replace an element’s whole text: {"value": "{{expression | filter}}"}. Use for a box that is only a number or a sentence that should be rewritten. You may combine: "Week of {{lastWeek.start | date:\'MMMM D\'}}".',
    '- "replace": swap just part of the text and keep the rest: {"find": "6.7%", "value": "{{steps.compare.totals.Signups.changePct | change}}"}. Prefer this for numbers inside sentences.',
    '- "table": {"table": "{{steps.<id>.table}}", "columns": ["data column for template column 1", "…for column 2", …]} in the template’s column order.',
    '- "chart": {"table": "{{steps.<id>.table}}", "x": "label column", "y": ["value column", …]} matching the chart’s series.',
    '- "picture": {"value": "{{steps.<id>.file}}"} only for screenshots/images.',
    'repeat items (optional): {"slide": N, "table": "{{steps.<id>.table}}"} when a slide is clearly one-per-item (e.g. one per campaign); inside it use {{row.Column}}.',
    'Numbers are formatted like the template automatically ($, %, decimals), so pass raw numbers for numeric boxes (no number/currency filters needed unless text is combined). Use filters such as change (0.12 → +12.0%), number, currency when building sentences. Leave static text (titles that never change, labels) alone. Only use expressions from VALUES AVAILABLE and the date values (week.*, lastWeek.*, today, month.*, lastMonth.*). Only use ids that exist.',
  ].join('\n\n');
  const r = await ai.ask({ provider, prompt, json: true, timeout: 300, signal, dir, secrets, log });
  const j = r.json || {};
  const ok = new Set(); analysis.slides.forEach((s) => s.shapes.forEach((x) => ok.add(`${s.index}:${x.id}`)));
  const fills = (Array.isArray(j.fills) ? j.fills : []).filter((f) => f && f.slide && f.shape && ok.has(`${f.slide}:${f.shape.id}`));
  const repeat = (Array.isArray(j.repeat) ? j.repeat : []).filter((x) => x && x.slide && x.table && analysis.slides.some((s) => s.index === Number(x.slide)));
  return { fills, repeat, notes: j.notes || '', provider: r.provider, dropped: (Array.isArray(j.fills) ? j.fills.length : 0) - fills.length };
}
module.exports.mapTemplate = mapTemplate;

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

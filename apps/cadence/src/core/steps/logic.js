// Cadence — flow and system steps: conditions, notifications, open, wait, scripts, run another automation; plus the AI steps.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const T = require('../table');
const ai = require('../ai');

function check(left, test, right, right2) {
  const row = { v: left };
  const f = { column: 'v', test, value: right, value2: right2 };
  return T._testRow(row, f);
}

function runScript({ language, code, cwd, env, timeout = 600, signal, log }) {
  return new Promise((resolve, reject) => {
    let bin, args, tmp = null;
    const IS_WIN = process.platform === 'win32';
    if (language === 'python') {
      tmp = path.join(os.tmpdir(), `cadence-${Date.now()}.py`); fs.writeFileSync(tmp, code);
      bin = IS_WIN ? (ai.which('py') ? 'py' : 'python') : (ai.which('python3') || 'python3'); args = [tmp];
    } else if (language === 'node') {
      tmp = path.join(os.tmpdir(), `cadence-${Date.now()}.js`); fs.writeFileSync(tmp, code);
      bin = process.execPath; args = [tmp]; env = { ...env, ELECTRON_RUN_AS_NODE: '1' };
    } else { bin = code; args = []; }
    const child = spawn(bin, args, { cwd, env: { ...process.env, PATH: ai.searchPath(), ...env }, shell: language === 'shell' || language == null, windowsHide: true });
    let out = '', err = '', done = false;
    const end = (e, v) => { if (done) return; done = true; clearTimeout(t); if (tmp) try { fs.unlinkSync(tmp); } catch {} ; e ? reject(e) : resolve(v); };
    const t = setTimeout(() => { child.kill(); end(new Error(`The script ran longer than ${timeout} seconds`)); }, timeout * 1000);
    signal.addEventListener('abort', () => { child.kill(); end(new Error('Cancelled')); }, { once: true });
    child.stdout.on('data', (d) => { out += d; String(d).split('\n').filter((l) => l.trim()).slice(0, 20).forEach((l) => log(l)); });
    child.stderr.on('data', (d) => { err += d; String(d).split('\n').filter((l) => l.trim()).slice(0, 20).forEach((l) => log(l, 'warn')); });
    child.on('error', (e) => end(new Error(`Couldn’t start the script: ${e.message}`)));
    child.on('close', (c) => end(null, { out, err, code: c }));
  });
}

module.exports = {
  'logic.if': async (w, x) => {
    const pass = check(w.left, w.test || 'gt', w.right, w.right2);
    x.log(`${JSON.stringify(w.left)} ${w.test || 'gt'} ${JSON.stringify(w.right ?? '')}${w.test === 'between' ? ' and ' + JSON.stringify(w.right2) : ''} → ${pass ? 'yes' : 'no'}`);
    if (pass) return { passed: true };
    if (w.otherwise === 'fail') throw new Error('The condition wasn’t met');
    if (w.otherwise === 'skip') return { passed: false, __skipNext: true };
    return { passed: false, __stop: 'Stopped: the condition wasn’t met' };
  },

  'logic.notify': async (w, x) => {
    const open = w.open ? (typeof w.open === 'object' ? (w.open.file || w.open.folder) : String(w.open)) : '';
    if (x.services.notify) x.services.notify(String(w.title || x.run.flow.name), String(w.body || ''), open);
    x.log(`Notified: ${w.title}`);
    return {};
  },

  'logic.open': async (w, x) => {
    const t = typeof w.target === 'object' && w.target ? (w.target.file || w.target.folder || '') : String(w.target || '');
    if (!t) throw new Error('Nothing to open');
    const target = /^https?:\/\//.test(t) ? t : x.resolvePath(t);
    if (x.services.open) await x.services.open(target);
    x.log(`Opened ${target}`);
    return {};
  },

  'logic.wait': async (w, x) => {
    const s = Math.max(0, Math.min(86400, Number(w.seconds) || 0));
    x.log(`Waiting ${s}s`);
    await require('../runner').sleep(s * 1000, x.signal);
    return {};
  },

  'logic.script': async (w, x) => {
    if (!w.code || !String(w.code).trim()) throw new Error('Write a script first');
    const cwd = w.cwd ? x.resolvePath(w.cwd) : x.dir;
    fs.mkdirSync(cwd, { recursive: true });
    const ctxFile = path.join(x.dir, 'context.json');
    fs.writeFileSync(ctxFile, JSON.stringify({ steps: require('../runner').summarize(x.run.outputs), vars: x.run.vars, inputs: x.run.inputs, runDir: x.dir }, null, 2));
    const r = await runScript({ language: w.language || 'shell', code: String(w.code), cwd, env: { CADENCE_RUN_DIR: x.dir, CADENCE_CONTEXT: ctxFile }, signal: x.signal, log: x.log });
    let json = null; try { json = JSON.parse(r.out.trim()); } catch {}
    if (r.code !== 0) throw new Error(`The script stopped with exit code ${r.code}${r.err ? ': ' + r.err.trim().split('\n').slice(-3).join(' ') : ''}`);
    return { text: r.out.trim(), json, code: r.code };
  },

  'logic.run': async (w, x) => {
    if (!x.services.runFlow) throw new Error('Running other automations isn’t available here');
    if (w.flow === x.run.flow.id) throw new Error('An automation can’t run itself');
    const inputs = {}; if (Array.isArray(w.inputs)) for (const r of w.inputs) { if (r && r.key) inputs[r.key] = x.render(r.value); }
    const snap = await x.services.runFlow(w.flow, inputs, x.signal, (x.run.trigger.depth || 0) + 1);
    x.log(`${snap.flowName}: ${snap.status}`);
    if (snap.status === 'failed') throw new Error(`${snap.flowName} failed: ${snap.error}`);
    return { outputs: snap.rawOutputs || snap.outputs, status: snap.status, files: snap.files };
  },

  'ai.ask': async (w, x) => {
    const attach = Array.isArray(w.attach) ? w.attach : w.attach != null && w.attach !== '' ? [w.attach] : [];
    const r = await ai.ask({ provider: w.provider, prompt: String(w.prompt || ''), attach, json: !!w.json, shape: w.shape, model: w.model, timeout: Number(w.timeout) || 300, signal: x.signal, dir: path.join(x.dir, 'ai-' + x.step.id), secrets: x.services.secrets, log: x.log });
    x.log(r.text.length > 400 ? r.text.slice(0, 400) + '…' : r.text);
    return { text: r.text, json: r.json };
  },

  'ai.agent': async (w, x) => {
    const folder = x.resolvePath(w.folder || x.dir);
    const r = await ai.agent({ provider: w.provider, folder, task: String(w.task || ''), allowEdits: w.allowEdits !== false, allowCommands: !!w.allowCommands, timeout: Number(w.timeout) || 900, signal: x.signal, secrets: x.services.secrets, log: x.log });
    if (r.text) x.log(r.text.length > 600 ? r.text.slice(0, 600) + '…' : r.text);
    return { text: r.text, files: r.files, file: r.file, folder };
  },
};

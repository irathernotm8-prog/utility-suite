#!/usr/bin/env node
// Headless runner: node src/cli.js <file or folder> [--out DIR] [--mode max|balanced|quiet] [--engines DIR] [--no-deep] [--no-native]
'use strict';
const path = require('path');
const os = require('os');
const { createContext } = require('./core/context');
const { Job } = require('./core/pipeline');
const detect = require('./core/detect');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const input = args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--') && !['--no-deep', '--no-native', '--quiet-log'].includes(args[i - 1])));
if (!input) { console.log('Usage: node src/cli.js <file> [--out DIR] [--mode max] [--engines DIR]'); process.exit(1); }
const ctx = createContext({ enginesDir: flag('--engines', path.join(os.homedir(), '.decomp-engines')), mode: flag('--mode', 'max') });
const identity = detect.full(path.resolve(input));
console.log(`${identity.name}: ${identity.label}${identity.traits.length ? ' [' + identity.traits.join(', ') + ']' : ''}`);
const job = new Job({ input: path.resolve(input), identity, outRoot: path.resolve(flag('--out', 'decomp-out')), options: { deep: !args.includes('--no-deep'), native: !args.includes('--no-native') }, ctx });
const seen = new Map();
job.on('change', () => {
  for (const s of job.steps) {
    const key = s.state + (s.state === 'running' ? Math.floor((s.progress || 0) * 4) : '');
    if (seen.get(s.id) === key) continue; seen.set(s.id, key);
    if (args.includes('--quiet-log') && s.state === 'running') continue;
    console.log(`  [${s.state}] ${s.title}${s.threads ? ` (${s.threads} threads)` : ''}${s.detail ? ' — ' + s.detail : ''}`);
  }
});
job.run().then((r) => {
  console.log(`\n${r.status} in ${r.stats.seconds}s · ${r.stats.sources} source files · peak ${r.stats.peakThreads} threads → ${r.outDir}`);
  if (r.notes.length) console.log('Notes:\n  ' + r.notes.join('\n  '));
  if (r.needs.length) console.log('Needs engines: ' + r.needs.join(', '));
  ctx.close(); process.exit(r.status === 'done' ? 0 : 2);
});

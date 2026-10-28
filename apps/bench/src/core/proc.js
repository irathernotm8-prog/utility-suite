// Bench — commands on a desk (npm test, scripts, builds): runs through the login shell, keeps the output, and can
// be waited on, read later or stopped.
'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { LogBuffer, killTree } = require('./electron-app');

const IS_WIN = process.platform === 'win32';

function shellFor(command, shell) {
  if (IS_WIN) {
    if (shell === 'powershell') return { cmd: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command] };
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], verbatim: true };
  }
  const sh = shell || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { cmd: sh, args: ['-lc', command] };
}

class CommandSession extends EventEmitter {
  constructor({ id, name, command, cwd, env, shell, maxOutput = 400000 }) {
    super();
    Object.assign(this, { id, name: name || command.slice(0, 60), command, cwd, env, shell, maxOutput });
    this.logs = new LogBuffer(5000); this.output = ''; this.state = 'starting'; this.exit = null; this.startedAt = null;
  }
  start() {
    const { cmd, args, verbatim } = shellFor(this.command, this.shell);
    const env = { ...process.env, ...(this.env || {}), FORCE_COLOR: '0', NO_COLOR: '1', CI: process.env.CI || '' };
    delete env.ELECTRON_RUN_AS_NODE;
    this.startedAt = Date.now();
    const child = spawn(cmd, args, { cwd: this.cwd, env, detached: !IS_WIN, windowsHide: true, windowsVerbatimArguments: !!verbatim, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child; this.pid = child.pid; this.state = 'running';
    const take = (stream) => { let carry = ''; return (d) => {
      const s = d.toString(); this.output += s; if (this.output.length > this.maxOutput) this.output = '…' + this.output.slice(-this.maxOutput);
      const lines = (carry + s).split(/\r?\n/); carry = lines.pop();
      for (const raw of lines) { const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); if (line.trim()) this.emit('log', this.logs.add({ source: 'command', stream, level: stream === 'stderr' && /error|fail|exception/i.test(line) ? 'error' : stream === 'stderr' && /warn/i.test(line) ? 'warning' : 'info', text: line })); }
    }; };
    child.stdout.on('data', take('stdout')); child.stderr.on('data', take('stderr'));
    child.on('error', (e) => { this.output += `\n${e.message}`; this.logs.add({ source: 'bench', level: 'error', text: e.message }); });
    this.done = new Promise((res) => child.on('close', (code, signal) => {
      this.exit = { code, signal, at: Date.now() }; this.state = 'exited';
      this.emit('log', this.logs.add({ source: 'bench', level: code === 0 ? 'info' : 'error', text: signal ? `Stopped (${signal})` : `Finished with code ${code} in ${fmtMs(Date.now() - this.startedAt)}` }));
      this.emit('exit', this.exit); this.emit('changed'); res(this.exit);
    }));
    this.emit('changed');
    return this;
  }
  async wait(timeoutMs = 120000) {
    let timedOut = false;
    const r = await Promise.race([this.done, new Promise((res) => setTimeout(() => { timedOut = true; res(null); }, timeoutMs))]);
    return { code: r ? r.code : null, signal: r ? r.signal : null, timedOut, ms: Date.now() - this.startedAt, output: this.output };
  }
  stop() { this.state = 'stopping'; killTree(this.child, 'SIGTERM'); setTimeout(() => { if (!this.exit) killTree(this.child, 'SIGKILL'); }, 4000); }
  get running() { return !this.exit; }
  summary() { const c = this.logs.counts(); return { id: this.id, name: this.name, kind: 'command', command: this.command, cwd: this.cwd, state: this.exit ? 'exited' : this.state, pid: this.pid, startedAt: this.startedAt, exit: this.exit, errors: c.errors, warnings: c.warnings }; }
}
const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
/** Keeps the end of long output (the part with the result) and the start (what ran). */
function tail(s, max = 12000) { s = String(s || ''); if (s.length <= max) return s; return s.slice(0, 1500) + `\n… (${s.length - max} characters cut) …\n` + s.slice(-(max - 1500)); }

module.exports = { CommandSession, shellFor, tail, fmtMs };

// Runs the outside engines with Decomp's power budget: thread counts, Java heap, processor caps and
// priority, and turns their console output into progress.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, 'ghidra');

// Spawns a process; onLine gets each stdout/stderr line ('\r' also splits). Cancels via signal.
function proc(cmd, args, { env, cwd, onLine, signal, priority = 0, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, detached: process.platform !== 'win32' });
    if (priority) { try { os.setPriority(p.pid, priority); } catch {} }
    let tail = []; let killed = false;
    const kill = () => {
      killed = true;
      try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch {} }
    };
    if (signal) { if (signal.aborted) kill(); signal.addEventListener('abort', kill, { once: true }); }
    const timer = timeoutMs ? setTimeout(() => { tail.push('(stopped: took longer than the time limit)'); kill(); }, timeoutMs) : null;
    const feed = (stream) => {
      let buf = '';
      stream.on('data', (d) => {
        buf += d.toString('utf8');
        const parts = buf.split(/\r\n|\n|\r/); buf = parts.pop();
        for (const l of parts) { if (!l.trim() || /^Picked up (JAVA_TOOL_OPTIONS|_JAVA_OPTIONS)/.test(l)) continue; tail.push(l); if (tail.length > 60) tail = tail.slice(-40); onLine && onLine(l); }
      });
    };
    feed(p.stdout); feed(p.stderr);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (killed && signal && signal.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      resolve({ code, tail: tail.slice(-12).join('\n') });
    });
  });
}

const jvmArgs = ({ threads, heapMB }) => [`-Xmx${heapMB}m`, `-XX:ActiveProcessorCount=${threads}`, `-XX:ParallelGCThreads=${Math.max(1, Math.min(threads, 8))}`, '-XX:+UseParallelGC', '-Djava.awt.headless=true', '-Dfile.encoding=UTF-8', '-Djdk.util.zip.disableZip64ExtraFieldValidation=true'];

// ───────── 7-Zip
async function sevenZipList(bin, archive, opts = {}) {
  const lines = []; await proc(bin, ['l', '-slt', '-ba', '-sccUTF-8', '-p', archive], { ...opts, onLine: (l) => lines.push(l) });
  const entries = []; let cur = null; const props = {};
  for (const l of lines) {
    const m = l.match(/^([A-Za-z ]+) = (.*)$/); if (!m) continue;
    if (m[1] === 'Path') { if (cur) entries.push(cur); cur = { path: m[2] }; }
    else if (cur) cur[m[1]] = m[2]; else props[m[1]] = m[2];
  }
  if (cur) entries.push(cur);
  return { entries: entries.map((e) => ({ path: e.path, size: +e.Size || 0, dir: /D/.test(e.Attributes || '') || e.Folder === '+', encrypted: e.Encrypted === '+' })), solid: props.Solid === '+', type: props.Type };
}
async function sevenZip(bin, archive, outDir, { threads = 1, onProgress, signal, priority, only, password } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const args = ['x', '-y', '-bsp1', '-bb0', '-sccUTF-8', `-mmt=${threads}`, '-o' + outDir, '-p' + (password || ''), archive];
  if (only) { const list = path.join(os.tmpdir(), `decomp-7z-${process.pid}-${Math.random().toString(36).slice(2)}.txt`); fs.writeFileSync(list, only.join('\n')); args.push('@' + list, '-spf2'); }
  const r = await proc(bin, args, { signal, priority, onLine: (l) => { const m = l.match(/^\s*(\d+)%/); if (m && onProgress) onProgress(+m[1] / 100); } });
  if (r.code > 1) throw new Error(/Wrong password|encrypted/i.test(r.tail) ? 'The archive is password-protected.' : /Can not open|not archive/i.test(r.tail) ? '7-Zip couldn’t open this file as an archive.' : '7-Zip: ' + r.tail.split('\n').slice(-3).join(' '));
  return { warnings: r.code === 1 ? r.tail : null };
}

// ───────── JADX (Android)
async function jadx({ java, jar }, input, outDir, { threads, heapMB, onProgress, signal, priority, deobf } = {}) {
  const args = [...jvmArgs({ threads, heapMB }), '--enable-native-access=ALL-UNNAMED', '-cp', jar, 'jadx.cli.JadxCLI', '-d', outDir, '-j', String(threads), '--show-bad-code', '--log-level', 'progress'];
  if (deobf) args.push('--deobf');
  args.push(input);
  const r = await proc(java, args, { signal, priority, onLine: (l) => { const m = l.match(/progress: (\d+) of (\d+)/); if (m && onProgress) onProgress(+m[1] / Math.max(1, +m[2]), `${m[1]} of ${m[2]} classes`); } });
  if (!fs.existsSync(path.join(outDir, 'sources')) && !fs.existsSync(path.join(outDir, 'resources'))) throw new Error('JADX: ' + r.tail.split('\n').slice(-3).join(' '));
  return { errors: (r.tail.match(/finished with errors, count: (\d+)/) || [])[1] | 0 };
}

// ───────── Vineflower (Java)
async function vineflower({ java, jar }, inputs, outDir, { threads, heapMB, onProgress, signal, priority, total } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  const args = [...jvmArgs({ threads, heapMB }), '-jar', jar, `--thread-count=${threads}`, '--decompile-generics=true', '--remove-bridge=true', '--log-level=info', ...[].concat(inputs), outDir];
  const r = await proc(java, args, { signal, priority, onLine: (l) => { if (/Decompiling class/.test(l)) { n++; onProgress && total && onProgress(Math.min(0.99, n / total), `${n} of ${total} classes`); } } });
  if (r.code !== 0) throw new Error('Vineflower: ' + r.tail.split('\n').slice(-3).join(' '));
  return { classes: n };
}

// ───────── ILSpy (.NET)
async function ilspy({ dotnet, dll }, input, outDir, { threads, onProgress, signal, priority, refs = [] } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const env = { DOTNET_ROOT: path.dirname(dotnet), DOTNET_PROCESSOR_COUNT: String(threads), DOTNET_gcServer: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_ROLL_FORWARD: 'Major' };
  const args = [dll, '-p', '-o', outDir, '--nested-directories', '-lv', 'Latest'];
  for (const r of refs) args.push('-r', r);
  args.push(input);
  let lines = 0;
  const r = await proc(dotnet, args, { env, signal, priority, onLine: () => { lines++; onProgress && onProgress(null, `${lines} messages`); } });
  const made = fs.existsSync(outDir) && fs.readdirSync(outDir).length;
  if (r.code !== 0 && !made) throw new Error('ILSpy: ' + (/BadImageFormat|not a valid|PE file does not contain any managed metadata/i.test(r.tail) ? 'this file isn’t a .NET assembly.' : r.tail.split('\n').slice(-4).join(' ')));
  return { warnings: r.code !== 0 ? r.tail : null };
}

// ───────── Ghidra (native)
// Ghidra is started with Java directly (the same way its launch scripts do), so there is no shell or
// .bat quoting to trip over on Windows, and the thread and memory limits are ours.
const ghidraVmCache = new Map();
async function ghidraVmArgs(java, home) {
  if (ghidraVmCache.has(home)) return ghidraVmCache.get(home);
  const lines = [];
  try { await proc(java, ['-cp', path.join(home, 'support', 'LaunchSupport.jar'), 'LaunchSupport', home, '-vmargs'], { onLine: (l) => lines.push(l.trim()) }); } catch {}
  const args = lines.filter((l) => l.startsWith('-'));
  if (!args.length) args.push('-Djava.system.class.loader=ghidra.GhidraClassLoader', '-Dfile.encoding=UTF8', '-Duser.country=US', '-Duser.language=en', '-Xshare:off', '--enable-native-access=ALL-UNNAMED');
  ghidraVmCache.set(home, args);
  return args;
}
async function ghidra({ home, java }, input, outDir, { threads, heapMB, onProgress, signal, priority, timeoutMin = 60, processor } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'decomp-ghidra-'));
  const vm = (await ghidraVmArgs(java, home)).filter((a) => !/^-Dcpu\.core\.(limit|override)=/.test(a));
  const args = [...vm, `-Xmx${Math.max(1024, heapMB)}m`, `-XX:ActiveProcessorCount=${threads}`, `-Dcpu.core.limit=${threads}`, `-XX:ParallelGCThreads=${Math.max(1, Math.min(threads, 8))}`, '-Djava.awt.headless=true',
    '-cp', path.join(home, 'Ghidra', 'Framework', 'Utility', 'lib', 'Utility.jar'), 'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless',
    proj, 'decomp', '-import', input, '-scriptPath', SCRIPTS, '-postScript', 'DecompExport.java', outDir, '-deleteProject', '-max-cpu', String(threads), '-analysisTimeoutPerFile', String(timeoutMin * 60)];
  if (processor) args.push('-processor', processor);
  let phase = 0;
  const r = await proc(java, args, {
    env: { JAVA_HOME: path.dirname(path.dirname(java)) }, cwd: home, signal, priority, timeoutMs: (timeoutMin + 20) * 60000,
    onLine: (l) => {
      if (!onProgress) return;
      if (/IMPORTING|Import succeeded|ANALYZING/i.test(l) && phase < 1) { phase = 1; onProgress(0.05, 'Analyzing (finding functions and types)'); }
      const t = l.match(/DECOMP total (\d+)/); if (t) onProgress(0.4, `Decompiling ${t[1]} functions`);
      const m = l.match(/DECOMP progress (\d+) (\d+)/); if (m) onProgress(0.4 + 0.58 * (+m[1] / Math.max(1, +m[2])), `${m[1]} of ${m[2]} functions`);
    },
  });
  fs.rmSync(proj, { recursive: true, force: true });
  const made = fs.existsSync(path.join(outDir, 'functions.tsv'));
  if (!made) throw new Error('Ghidra: ' + (/No load spec found/i.test(r.tail) ? 'it doesn\u2019t recognise this file as a program.' : r.tail.split('\n').slice(-4).join(' ')));
  return {};
}

// ───────── small tools
async function upx(bin, input, output, opts = {}) {
  const r = await proc(bin, ['-d', '-o', output, input], opts);
  if (r.code !== 0 || !fs.existsSync(output)) throw new Error('UPX couldn’t unpack it: ' + r.tail.split('\n').slice(-2).join(' '));
}
async function pycdc(bin, input, output, opts = {}) {
  const lines = []; const r = await proc(bin, [input], { ...opts, onLine: (l) => lines.push(l) });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, lines.join('\n') + '\n');
  return { ok: r.code === 0 };
}
async function pythonDis(bin, input, output, opts = {}) {
  const code = 'import sys,marshal,dis\nf=open(sys.argv[1],"rb");d=f.read()\nimport importlib.util as u\nh=16 if sys.version_info>=(3,7) else 12\nif d[:4]!=u.MAGIC_NUMBER: print("# pyc is for another Python version"); sys.exit(3)\ndis.dis(marshal.loads(d[h:]))';
  const lines = []; const r = await proc(bin, ['-c', code, input], { ...opts, onLine: (l) => lines.push(l) });
  if (r.code !== 0) return { ok: false };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, lines.join('\n') + '\n'); return { ok: true };
}
async function innoextract(bin, input, outDir, opts = {}) {
  const r = await proc(bin, ['-e', '-q', '-d', outDir, input], opts);
  if (r.code !== 0) throw new Error('innoextract: ' + r.tail.split('\n').slice(-2).join(' '));
}

module.exports = { proc, sevenZip, sevenZipList, jadx, vineflower, ilspy, ghidra, upx, pycdc, pythonDis, innoextract, jvmArgs, SCRIPTS };

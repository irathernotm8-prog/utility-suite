// Facet — builds and repairs the private Python environment the engine runs in.
// Everything lands in Facet's app-data folder; nothing touches a system Python.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./core');
const tools = require('./tools');

const PYTHON = '3.11';
const HY3DGEN_SHA = 'f8db63096c8282cb27354314d896feba5ba6ff8a';
const HY3DGEN_URL = `https://github.com/Tencent/Hunyuan3D-2/archive/${HY3DGEN_SHA}.zip`;
const TORCH_INDEX = { cuda: 'https://download.pytorch.org/whl/cu128', cpu: 'https://download.pytorch.org/whl/cpu' };

let state = { running: false, stage: null, pct: 0, msg: '', error: null };
let emit = () => {};
let abort = null;

function venvPython() { return path.join(core.envDir(), tools.IS_WIN ? 'Scripts' : 'bin', tools.IS_WIN ? 'python.exe' : 'python'); }

function uvEnv() {
  return {
    UV_PYTHON_INSTALL_DIR: core.pythonHome(), UV_CACHE_DIR: core.uvCache(), UV_LINK_MODE: 'copy',
    UV_PYTHON_PREFERENCE: 'only-managed', UV_NO_PROGRESS: '1', VIRTUAL_ENV: core.envDir()
  };
}

// Which PyTorch build this computer gets
async function torchFlavor() {
  const hw = await tools.detectHardware();
  if (tools.IS_MAC) return 'mac';
  if (hw.accel === 'cuda') return 'cuda';
  return 'cpu';
}

async function wantedVersion() {
  const req = fs.readFileSync(path.join(core.bundledEngine(), 'requirements.txt'), 'utf8');
  return crypto.createHash('sha1').update(req + HY3DGEN_SHA + PYTHON + (await torchFlavor())).digest('hex').slice(0, 12);
}

async function status() {
  const s = core.get().env;
  const py = venvPython();
  const installed = tools.exists(py) && !!s.version;
  const wanted = await wantedVersion();
  return {
    installed, upToDate: installed && s.version === wanted, python: s.python, torch: s.torch, accel: s.accel, at: s.at,
    path: core.envDir(), running: state.running, stage: state.stage, pct: state.pct, msg: state.msg, error: state.error,
    flavor: await torchFlavor()
  };
}

function log(line) {
  try { fs.appendFileSync(core.logFile(), line + '\n'); } catch {}
  emit({ type: 'log', line });
}
function step(stage, pct, msg) {
  state = { ...state, stage, pct, msg };
  emit({ type: 'progress', stage, pct, msg });
  log('» ' + msg);
}

async function uv(uvBin, args, signal) {
  log('$ uv ' + args.join(' '));
  const code = await tools.run(uvBin, args, { env: uvEnv(), onLine: (l) => l.trim() && log(l), signal });
  if (signal?.aborted) throw new Error('Stopped');
  if (code !== 0) throw new Error(`uv ${args[0]} ${args[1] || ''} failed (exit ${code}). See the engine log for details.`);
}

async function install({ repair = false } = {}) {
  if (state.running) return status();
  state = { running: true, stage: 'start', pct: 0, msg: 'Starting', error: null };
  abort = new AbortController();
  const signal = abort.signal;
  emit({ type: 'start' });
  try {
    step('uv', 0.03, 'Getting the Python manager');
    const uvBin = await tools.ensureUv(core.toolsDir(), log);

    const py = venvPython();
    if (repair && tools.exists(core.envDir())) {
      step('python', 0.06, 'Clearing the old environment');
      fs.rmSync(core.envDir(), { recursive: true, force: true });
    }
    if (!tools.exists(py)) {
      step('python', 0.08, `Installing Python ${PYTHON}`);
      await uv(uvBin, ['python', 'install', PYTHON], signal);
      await uv(uvBin, ['venv', '--python', PYTHON, core.envDir()], signal);
    }

    const flavor = await torchFlavor();
    step('torch', 0.18, flavor === 'cuda' ? 'Installing PyTorch for your NVIDIA card (about 3 GB)' : flavor === 'mac' ? 'Installing PyTorch with Metal support' : 'Installing PyTorch for the CPU');
    const torchArgs = ['pip', 'install', '--python', py, 'torch>=2.5,<3', 'torchvision'];
    if (TORCH_INDEX[flavor]) torchArgs.push('--index-url', TORCH_INDEX[flavor], '--extra-index-url', 'https://pypi.org/simple');
    await uv(uvBin, torchArgs, signal);

    step('libs', 0.62, 'Installing the 3D, image and mesh libraries');
    await uv(uvBin, ['pip', 'install', '--python', py, '-r', path.join(core.bundledEngine(), 'requirements.txt')], signal);

    step('hy3dgen', 0.84, 'Installing Hunyuan3D');
    await uv(uvBin, ['pip', 'install', '--python', py, '--no-deps', `hy3dgen @ ${HY3DGEN_URL}`], signal);

    step('check', 0.93, 'Checking everything loads');
    const probe = await tools.capture(py, ['-c', [
      'import json, torch, diffusers, transformers, trimesh, rembg, skimage, hy3dgen',
      'a = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"',
      'import platform',
      'print(json.dumps({"python": platform.python_version(), "torch": torch.__version__, "accel": a}))'
    ].join('\n')], { timeout: 180000, env: { PYTHONNOUSERSITE: '1' } });
    if (!probe.ok) { log(probe.err); throw new Error('The engine installed but would not start: ' + (probe.err.trim().split('\n').pop() || 'unknown error')); }
    const info = JSON.parse(probe.out.trim().split('\n').pop());
    core.get().env = { version: await wantedVersion(), python: info.python, torch: info.torch, accel: info.accel, at: Date.now() };
    core.save(true);
    step('done', 1, `Engine ready: PyTorch ${info.torch} on ${info.accel === 'cuda' ? 'your NVIDIA GPU' : info.accel === 'mps' ? 'the Apple GPU' : 'the CPU'}`);
    state.running = false;
    emit({ type: 'done', status: await status() });
  } catch (e) {
    state = { ...state, running: false, error: signal.aborted ? 'Stopped' : e.message };
    log('✗ ' + state.error);
    emit({ type: 'error', error: state.error });
  } finally {
    abort = null;
  }
  return status();
}

function cancel() { abort?.abort(); }
function onEvent(fn) { emit = fn; }
function envSize() { return tools.dirSize(core.envDir()) + tools.dirSize(core.pythonHome()); }

module.exports = { install, cancel, status, onEvent, venvPython, envSize };

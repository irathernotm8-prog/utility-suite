'use strict';
// Opening things in other apps: terminals, code editors, "Open With",
// zip / unzip using tools that ship with the OS.
const {spawn, execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const TERMINALS = {
  darwin: [['Terminal', 'Terminal'], ['iTerm', 'iTerm'], ['Warp', 'Warp'], ['Ghostty', 'Ghostty'], ['WezTerm', 'WezTerm'], ['kitty', 'kitty'], ['Alacritty', 'Alacritty']],
  win32: [['wt', 'Windows Terminal'], ['powershell', 'PowerShell'], ['pwsh', 'PowerShell 7'], ['cmd', 'Command Prompt']],
  linux: [['x-terminal-emulator', 'Default terminal'], ['gnome-terminal', 'GNOME Terminal'], ['konsole', 'Konsole'], ['kitty', 'kitty'], ['alacritty', 'Alacritty']],
};
const EDITORS = {
  darwin: [['Visual Studio Code', 'VS Code'], ['Cursor', 'Cursor'], ['Zed', 'Zed'], ['Sublime Text', 'Sublime Text'], ['BBEdit', 'BBEdit'], ['TextEdit', 'TextEdit']],
  win32: [['code', 'VS Code'], ['cursor', 'Cursor'], ['notepad', 'Notepad']],
  linux: [['code', 'VS Code'], ['cursor', 'Cursor'], ['gedit', 'gedit']],
};
const plat = () => (process.platform in TERMINALS ? process.platform : 'linux');

function detached(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {detached: true, stdio: 'ignore', windowsHide: false, ...opts});
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => execFile(cmd, args, {timeout: 10 * 60 * 1000, ...opts}, (err, stdout, stderr) => err ? reject(Error((stderr || err.message).toString().trim().split('\n').pop())) : resolve(stdout)));
}
async function dirFor(p) { const st = await fs.stat(p); return st.isDirectory() ? p : path.dirname(p); }

async function installedMacApps(list) {
  const out = [];
  for (const [id, label] of list) {
    for (const base of ['/Applications', '/System/Applications/Utilities', '/System/Applications', path.join(process.env.HOME || '', 'Applications')]) {
      try { await fs.access(path.join(base, `${id}.app`)); out.push({id, label}); break; } catch {}
    }
  }
  return out;
}
async function available() {
  const p = plat();
  if (p === 'darwin') return {terminals: await installedMacApps(TERMINALS.darwin), editors: await installedMacApps(EDITORS.darwin)};
  return {terminals: TERMINALS[p].map(([id, label]) => ({id, label})), editors: EDITORS[p].map(([id, label]) => ({id, label}))};
}

async function openTerminal(target, choice) {
  const dir = await dirFor(target);
  const p = plat();
  if (p === 'darwin') return detached('open', ['-a', choice || 'Terminal', dir]);
  if (p === 'win32') {
    const t = choice || 'wt';
    // "start" opens a new console window; cwd sets where it begins.
    const exe = {wt: ['wt.exe', '-d', '.'], powershell: ['powershell.exe', '-NoExit'], pwsh: ['pwsh.exe', '-NoExit'], cmd: ['cmd.exe']}[t] || ['wt.exe', '-d', '.'];
    const verbatim = {cwd: dir, windowsVerbatimArguments: true};
    try { return await detached('cmd.exe', ['/c', 'start', '""', ...exe], verbatim); }
    catch { return detached('cmd.exe', ['/c', 'start', '""', 'powershell.exe', '-NoExit'], verbatim); }
  }
  return detached(choice || 'x-terminal-emulator', [], {cwd: dir});
}
async function openInEditor(target, choice) {
  const p = plat();
  if (p === 'darwin') return detached('open', ['-a', choice || 'Visual Studio Code', target]);
  if (p === 'win32') return detached('cmd.exe', ['/c', choice || 'code', `"${target}"`], {windowsHide: true, windowsVerbatimArguments: true});
  return detached(choice || 'code', [target]);
}
// macOS: open with an app chosen by the user. Windows: system "Open with" dialog.
async function openWith(target, appPath) {
  if (process.platform === 'darwin') return detached('open', ['-a', appPath, target]);
  if (process.platform === 'win32') return detached('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', target]);
  return detached('xdg-open', [target]);
}

async function compress(paths, destZip) {
  if (process.platform === 'darwin') {
    if (paths.length === 1) return run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', paths[0], destZip]);
    return run('zip', ['-r', '-y', '-q', destZip, ...paths.map(p => path.basename(p))], {cwd: path.dirname(paths[0])});
  }
  if (process.platform === 'win32') {
    const list = paths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -LiteralPath ${list} -DestinationPath '${destZip.replace(/'/g, "''")}'`]);
  }
  return run('zip', ['-r', '-y', '-q', destZip, ...paths.map(p => path.basename(p))], {cwd: path.dirname(paths[0])});
}
async function extract(zip, destDir) {
  await fs.mkdir(destDir);
  if (process.platform === 'darwin') return run('ditto', ['-x', '-k', zip, destDir]);
  if (process.platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}'`]);
  return run('unzip', ['-q', zip, '-d', destDir]);
}

module.exports = {available, openTerminal, openInEditor, openWith, compress, extract};

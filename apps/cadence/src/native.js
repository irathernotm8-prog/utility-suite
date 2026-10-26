// Cadence — driving any app from the outside: bring it to the front, press shortcuts, type, pick menu items,
// read the clipboard, run AppleScript (Mac) or PowerShell (Windows).
// Mac needs Cadence allowed under System Settings › Privacy & Security › Accessibility (and Automation for
// System Events) for keystrokes and menus.
'use strict';
const { execFile } = require('child_process');

const IS_MAC = process.platform === 'darwin', IS_WIN = process.platform === 'win32';
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function run(bin, args, input, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const p = execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 20 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(friendly(String(stderr || err.message).trim())));
      resolve(String(stdout).trim());
    });
    if (input != null) { p.stdin.end(input); }
  });
}
function friendly(msg) {
  if (/not allowed to send keystrokes|not allowed assistive access|-25211|-1719/i.test(msg)) return 'Cadence isn’t allowed to control other apps yet. Open System Settings › Privacy & Security › Accessibility, switch on Cadence, then try again.';
  if (/Not authorized to send Apple events|-1743/i.test(msg)) return 'Cadence isn’t allowed to control that app. Open System Settings › Privacy & Security › Automation and allow Cadence to control it (and System Events).';
  return msg.split('\n').slice(-3).join(' ').slice(0, 500);
}
const osa = (script) => run('osascript', ['-e', script]);
const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], script);

// "cmd+shift+e", "ctrl+s", "enter", "alt+f, x" (a comma makes a sequence)
const MAC_KEYCODES = { enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111, forwarddelete: 117 };
const WIN_KEYS = { enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', space: ' ', delete: '{DEL}', backspace: '{BACKSPACE}', escape: '{ESC}', esc: '{ESC}', left: '{LEFT}', right: '{RIGHT}', down: '{DOWN}', up: '{UP}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', forwarddelete: '{DEL}' };
function parseCombo(s) {
  const parts = String(s).toLowerCase().split('+').map((x) => x.trim()).filter(Boolean);
  const key = parts.pop() || '';
  const mods = new Set(parts.map((m) => ({ command: 'cmd', '⌘': 'cmd', control: 'ctrl', option: 'alt', opt: 'alt', '⌥': 'alt', '⇧': 'shift', win: 'cmd', meta: 'cmd', cmdorctrl: IS_MAC ? 'cmd' : 'ctrl', mod: IS_MAC ? 'cmd' : 'ctrl' }[m] || m)));
  return { key, mods };
}
const winSendKeysText = (t) => String(t).replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\n/g, '{ENTER}');

class Native {
  constructor(app) { this.app = app; }
  get name() { return this.app.name; }
  async focus() {
    if (IS_MAC) return osa(`tell application "${esc(this.app.path || this.app.name)}" to activate`);
    if (IS_WIN) return ps(`$w = New-Object -ComObject WScript.Shell; $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.Path -eq "${esc(this.app.exec || '')}" -or $_.ProcessName -eq "${esc(this.app.process || this.app.name)}") } | Select-Object -First 1; if ($p) { [void]$w.AppActivate($p.Id) } else { [void]$w.AppActivate("${esc(this.app.name)}") }`);
    throw new Error('Controlling other apps works on Mac and Windows');
  }
  async shortcut(spec) {
    const seq = String(spec).split(',').map((s) => s.trim()).filter(Boolean);
    if (!seq.length) throw new Error('Type a shortcut, like cmd+shift+e');
    if (IS_MAC) {
      const lines = seq.map((s) => {
        const { key, mods } = parseCombo(s);
        const using = [...mods].map((m) => ({ cmd: 'command down', ctrl: 'control down', alt: 'option down', shift: 'shift down' }[m])).filter(Boolean);
        const u = using.length ? ` using {${using.join(', ')}}` : '';
        return MAC_KEYCODES[key] != null ? `key code ${MAC_KEYCODES[key]}${u}` : `keystroke "${esc(key)}"${u}`;
      });
      return osa(`tell application "${esc(this.app.path || this.app.name)}" to activate\ndelay 0.3\ntell application "System Events"\n${lines.join('\ndelay 0.25\n')}\nend tell`);
    }
    if (IS_WIN) {
      const keys = seq.map((s) => { const { key, mods } = parseCombo(s); const m = [...mods].map((x) => ({ ctrl: '^', cmd: '^', alt: '%', shift: '+' }[x] || '')).join(''); const k = WIN_KEYS[key] || (/^f\d+$/.test(key) ? `{${key.toUpperCase()}}` : winSendKeysText(key)); return m + (m && k.length > 1 && !k.startsWith('{') ? `(${k})` : k); });
      await this.focus();
      return ps(`$w = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 250; ${keys.map((k) => `$w.SendKeys('${k.replace(/'/g, "''")}'); Start-Sleep -Milliseconds 250`).join('; ')}`);
    }
    throw new Error('Shortcuts work on Mac and Windows');
  }
  async typeText(text) {
    if (IS_MAC) return osa(`tell application "${esc(this.app.path || this.app.name)}" to activate\ndelay 0.2\ntell application "System Events" to keystroke "${esc(text)}"`);
    if (IS_WIN) { await this.focus(); return ps(`$w = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 200; $w.SendKeys('${winSendKeysText(text).replace(/'/g, "''")}')`); }
    throw new Error('Typing into apps works on Mac and Windows');
  }
  // "File > Export > CSV…"
  async menu(pathSpec) {
    const parts = String(pathSpec).split(/\s*[>›]\s*/).filter(Boolean);
    if (parts.length < 2) throw new Error('Write the menu path like File > Export…');
    if (IS_MAC) {
      const proc = this.app.process || this.app.name;
      let ref = `menu bar item "${esc(parts[0])}" of menu bar 1`;
      for (let i = 1; i < parts.length; i++) ref = `menu item "${esc(parts[i])}" of menu 1 of ${ref}`;
      return osa(`tell application "${esc(this.app.path || this.app.name)}" to activate\ndelay 0.3\ntell application "System Events" to tell process "${esc(proc)}"\nclick ${ref}\nend tell`);
    }
    if (IS_WIN) throw new Error('Menus can’t be clicked by name on Windows. Use a Shortcut action instead, e.g. alt+f, e for File › Export.');
    throw new Error('Menus work on Mac');
  }
  async script(code) {
    if (IS_MAC) return /^\s*(\/\/|var |let |const |Application\()/.test(code) ? run('osascript', ['-l', 'JavaScript', '-e', code]) : osa(code);
    if (IS_WIN) return ps(code);
    throw new Error('Scripts work on Mac (AppleScript) and Windows (PowerShell)');
  }
  async openFile(file) {
    if (IS_MAC) return run('open', ['-a', this.app.path || this.app.name, file]);
    if (IS_WIN) return ps(`Start-Process -FilePath "${esc(this.app.exec)}" -ArgumentList '"${String(file).replace(/'/g, "''")}"'`);
    throw new Error('Opening files in apps works on Mac and Windows');
  }
  readClipboard() { try { return require('electron').clipboard.readText(); } catch { return ''; } }
}

module.exports = { Native, parseCombo, osa, ps, IS_MAC, IS_WIN };

// Bench — one way to name keys ("cmd+s", "Enter", "ctrl+shift+t", "F5") turned into what each desk understands:
// X keysyms for VNC desks, Electron accelerator key codes for app windows, Windows virtual-key codes for Windows Sandbox.
'use strict';

const ALIAS = {
  cmd: 'meta', command: 'meta', super: 'meta', win: 'meta', windows: 'meta', meta: 'meta',
  ctrl: 'control', control: 'control', ctl: 'control',
  alt: 'alt', option: 'alt', opt: 'alt',
  shift: 'shift',
  // "mod" = the platform's main shortcut key (Cmd on a Mac, Ctrl elsewhere); resolved by parseCombo's `mac` option
  mod: 'mod', cmdorctrl: 'mod', commandorcontrol: 'mod',
};
const NAMED = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', del: 'Delete',
  space: 'Space', ' ': 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown', insert: 'Insert', ins: 'Insert',
  plus: 'Plus', minus: '-', capslock: 'CapsLock', printscreen: 'PrintScreen', menu: 'Menu',
};

/** "cmd+shift+s" → { mods: ['meta','shift'], key: 's' }. Keys are Enter/Tab/… or one character or F1–F24. */
function parseCombo(combo, { mac = process.platform === 'darwin' } = {}) {
  const raw = String(combo || '').trim();
  if (!raw) throw new Error('No key given');
  const parts = raw === '+' ? ['+'] : raw.split(/\s*\+\s*/).filter((p, i, a) => p !== '' || i === a.length - 1);
  const mods = []; let key = null;
  parts.forEach((p, i) => {
    const low = p.toLowerCase();
    if (i < parts.length - 1) {
      let m = ALIAS[low]; if (!m) throw new Error(`“${p}” isn't a modifier (use cmd, ctrl, alt, shift)`);
      if (m === 'mod') m = mac ? 'meta' : 'control';
      if (!mods.includes(m)) mods.push(m);
    } else {
      if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(p)) key = p.toUpperCase();
      else if (NAMED[low]) key = NAMED[low];
      else if (p === '') key = '+';
      else if ([...p].length === 1) key = p;
      else throw new Error(`Unknown key “${p}”. Use names like Enter, Tab, Escape, Backspace, Delete, Up, Down, Left, Right, Home, End, PageUp, PageDown, Space, F1–F24, or one character`);
    }
  });
  if (!key) throw new Error('No key after the modifiers');
  return { mods, key };
}

// ── X keysyms (VNC)
const KEYSYM = {
  Enter: 0xff0d, Tab: 0xff09, Escape: 0xff1b, Backspace: 0xff08, Delete: 0xffff, Space: 0x20, Up: 0xff52, Down: 0xff54, Left: 0xff51, Right: 0xff53,
  Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56, Insert: 0xff63, Plus: 0x2b, CapsLock: 0xffe5, PrintScreen: 0xff61, Menu: 0xff67,
};
const MOD_KEYSYM = { shift: 0xffe1, control: 0xffe3, alt: 0xffe9, meta: 0xffeb };
function charKeysym(ch) { const cp = ch.codePointAt(0); if (cp === 10 || cp === 13) return 0xff0d; if (cp === 9) return 0xff09; return cp < 0x100 ? cp : 0x01000000 + cp; }
function keysymFor(key) { if (KEYSYM[key] != null) return KEYSYM[key]; const f = /^F(\d+)$/.exec(key); if (f) return 0xffbe + (+f[1] - 1); return charKeysym(key); }

// ── Electron webContents.sendInputEvent
function electronKey(key) { if (key === 'Space') return 'Space'; if (key === 'Plus') return 'Plus'; return key; }
const ELECTRON_MOD = { meta: 'meta', control: 'control', alt: 'alt', shift: 'shift' };

// ── Windows virtual-key codes (Windows Sandbox agent)
const VK = {
  Enter: 0x0d, Tab: 0x09, Escape: 0x1b, Backspace: 0x08, Delete: 0x2e, Space: 0x20, Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, Insert: 0x2d, Plus: 0xbb, CapsLock: 0x14, PrintScreen: 0x2c, Menu: 0x5d,
};
const MOD_VK = { shift: 0x10, control: 0x11, alt: 0x12, meta: 0x5b };
function vkFor(key) {
  if (VK[key] != null) return VK[key];
  const f = /^F(\d+)$/.exec(key); if (f) return 0x70 + (+f[1] - 1);
  const c = key.toUpperCase();
  if (/^[A-Z0-9]$/.test(c)) return c.charCodeAt(0);
  const punct = { ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0, '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde };
  if (punct[key] != null) return punct[key];
  return null; // agent types it as a Unicode character instead
}

// ── DevTools-protocol key events (Electron app windows, driven from inside the app)
const CDP_NAMED = {
  Enter: ['Enter', 'Enter', 13, '\r'], Tab: ['Tab', 'Tab', 9], Escape: ['Escape', 'Escape', 27], Backspace: ['Backspace', 'Backspace', 8], Delete: ['Delete', 'Delete', 46],
  Space: [' ', 'Space', 32, ' '], Up: ['ArrowUp', 'ArrowUp', 38], Down: ['ArrowDown', 'ArrowDown', 40], Left: ['ArrowLeft', 'ArrowLeft', 37], Right: ['ArrowRight', 'ArrowRight', 39],
  Home: ['Home', 'Home', 36], End: ['End', 'End', 35], PageUp: ['PageUp', 'PageUp', 33], PageDown: ['PageDown', 'PageDown', 34], Insert: ['Insert', 'Insert', 45],
  Plus: ['+', 'Equal', 187, '+'], CapsLock: ['CapsLock', 'CapsLock', 20], PrintScreen: ['PrintScreen', 'PrintScreen', 44], Menu: ['ContextMenu', 'ContextMenu', 93],
};
const MOD_BIT = { alt: 1, control: 2, meta: 4, shift: 8 };
// On a Mac, Chromium only edits text for these when told the editing command (normally added by the OS key bindings).
const MAC_COMMANDS = {
  Backspace: 'deleteBackward', Delete: 'deleteForward', Enter: 'insertNewline', Tab: 'insertTab',
  Up: 'moveUp', Down: 'moveDown', Left: 'moveLeft', Right: 'moveRight', Home: 'scrollToBeginningOfDocument', End: 'scrollToEndOfDocument', PageUp: 'scrollPageUp', PageDown: 'scrollPageDown',
  'shift+Left': 'moveLeftAndModifySelection', 'shift+Right': 'moveRightAndModifySelection', 'shift+Up': 'moveUpAndModifySelection', 'shift+Down': 'moveDownAndModifySelection',
  'alt+Backspace': 'deleteWordBackward', 'meta+Backspace': 'deleteToBeginningOfLine', 'alt+Delete': 'deleteWordForward',
  'alt+Left': 'moveWordLeft', 'alt+Right': 'moveWordRight', 'meta+Left': 'moveToLeftEndOfLine', 'meta+Right': 'moveToRightEndOfLine',
  'meta+Up': 'moveToBeginningOfDocument', 'meta+Down': 'moveToEndOfDocument', 'shift+meta+Left': 'moveToLeftEndOfLineAndModifySelection', 'shift+meta+Right': 'moveToRightEndOfLineAndModifySelection',
  'meta+a': 'selectAll', 'meta+c': 'copy', 'meta+x': 'cut', 'meta+v': 'paste', 'meta+z': 'undo', 'shift+meta+z': 'redo',
};
function cdpKeyEvents(combo, { mac = process.platform === 'darwin' } = {}) {
  const { mods, key } = parseCombo(combo, { mac });
  let def = CDP_NAMED[key];
  if (!def) {
    const f = /^F(\d+)$/.exec(key);
    if (f) def = [key, key, 111 + +f[1]];
    else {
      const lower = key.toLowerCase(); const upper = key.toUpperCase();
      const shifted = mods.includes('shift');
      const ch = /^[a-z]$/i.test(key) ? (shifted ? upper : lower) : key;
      const code = /^[a-z]$/i.test(key) ? 'Key' + upper : /^[0-9]$/.test(key) ? 'Digit' + key : '';
      def = [ch, code, vkFor(key) || 0, ch];
    }
  }
  const [k, code, vk, text0] = def;
  const modifiers = mods.reduce((a, m) => a | MOD_BIT[m], 0);
  const printable = text0 != null && !mods.some((m) => m === 'control' || m === 'meta');
  const sorted = mods.slice().sort((a, b) => ['shift', 'control', 'alt', 'meta'].indexOf(a) - ['shift', 'control', 'alt', 'meta'].indexOf(b));
  const cmdKey = (sorted.length ? sorted.join('+') + '+' : '') + (key.length === 1 ? key.toLowerCase() : key);
  const commands = mac && MAC_COMMANDS[cmdKey] ? [MAC_COMMANDS[cmdKey]] : undefined;
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  return {
    down: { ...base, type: printable ? 'keyDown' : 'rawKeyDown', ...(printable ? { text: text0, unmodifiedText: text0 } : {}), ...(commands ? { commands } : {}) },
    up: { ...base, type: 'keyUp' },
    mods, key,
  };
}
/** "CmdOrCtrl+Shift+S" (an Electron menu accelerator) → "shift+meta+s"-style key for comparing with a pressed combo. */
function acceleratorKey(acc, { mac = process.platform === 'darwin' } = {}) {
  if (!acc) return null;
  const parts = String(acc).split('+').map((p) => p.trim()).filter(Boolean); if (!parts.length) return null;
  const keyRaw = parts.pop(); const mods = new Set();
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'cmdorctrl' || l === 'commandorcontrol') mods.add(mac ? 'meta' : 'control');
    else if (l === 'cmd' || l === 'command' || l === 'super' || l === 'meta') mods.add('meta');
    else if (l === 'ctrl' || l === 'control') mods.add('control');
    else if (l === 'alt' || l === 'option' || l === 'altgr') mods.add('alt');
    else if (l === 'shift') mods.add('shift');
  }
  let key; try { key = parseCombo(keyRaw === 'Plus' ? 'Plus' : keyRaw).key; } catch { key = keyRaw; }
  return comboKey([...mods], key);
}
const comboKey = (mods, key) => [...mods].sort().join('+') + '|' + (String(key).length === 1 ? String(key).toLowerCase() : key);

module.exports = { cdpKeyEvents, acceleratorKey, comboKey, parseCombo, keysymFor, charKeysym, MOD_KEYSYM, electronKey, ELECTRON_MOD, vkFor, MOD_VK };

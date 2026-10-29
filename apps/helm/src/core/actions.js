// Helm — everything a button can do. Each action names how it runs on a Mac and on Windows; the mapper turns a press
// into these and the platform layer turns them into real input.
//   kind 'mouse'   a mouse button, held for as long as the controller button is (so drags work)
//   kind 'key'     a key held while the button is held, repeating like a keyboard when `repeat` is set
//   kind 'combo'   a shortcut tapped once per press
//   kind 'cmd'     something the platform does directly (open Mission Control, lock the screen…)
//   kind 'media'   volume and playback keys
//   kind 'helm'    Helm itself: the keyboard, the quick panel, the command layer, precision, on/off
//   kind 'switcher' the app switcher (holds ⌘ / Alt while the command layer is held)
'use strict';

const A = (id, label, group, kind, spec = {}) => ({ id, label, group, kind, ...spec });
const both = (key, mods = []) => ({ mac: { key, mods }, win: { key, mods } });
const cmdCtrl = (key, extra = []) => ({ mac: { key, mods: ['cmd', ...extra] }, win: { key, mods: ['ctrl', ...extra] } });

const ACTIONS = [
  A('none', 'Nothing', 'Helm', 'helm'),
  // pointer
  A('click', 'Click', 'Pointer', 'mouse', { button: 'left', icon: 'click' }),
  A('rightClick', 'Right-click', 'Pointer', 'mouse', { button: 'right', icon: 'rclick' }),
  A('middleClick', 'Middle-click', 'Pointer', 'mouse', { button: 'middle' }),
  A('precision', 'Slow, precise pointer (hold)', 'Pointer', 'helm', { analog: true }),
  A('precisionToggle', 'Precision on / off', 'Pointer', 'helm'),
  // keys
  A('enter', 'Return / Enter', 'Keys', 'key', both('return')),
  A('escape', 'Escape', 'Keys', 'key', both('escape')),
  A('tab', 'Tab', 'Keys', 'key', { ...both('tab'), repeat: true }),
  A('space', 'Space', 'Keys', 'key', { ...both('space'), repeat: true }),
  A('backspace', 'Delete back', 'Keys', 'key', { ...both('backspace'), repeat: true }),
  A('arrowUp', 'Arrow up', 'Keys', 'key', { ...both('up'), repeat: true }),
  A('arrowDown', 'Arrow down', 'Keys', 'key', { ...both('down'), repeat: true }),
  A('arrowLeft', 'Arrow left', 'Keys', 'key', { ...both('left'), repeat: true }),
  A('arrowRight', 'Arrow right', 'Keys', 'key', { ...both('right'), repeat: true }),
  A('pageUp', 'Page up', 'Keys', 'key', { ...both('pageup'), repeat: true }),
  A('pageDown', 'Page down', 'Keys', 'key', { ...both('pagedown'), repeat: true }),
  // browsing and editing
  A('back', 'Back', 'Browse', 'combo', { mac: { key: '[', mods: ['cmd'] }, win: { key: 'left', mods: ['alt'] } }),
  A('forward', 'Forward', 'Browse', 'combo', { mac: { key: ']', mods: ['cmd'] }, win: { key: 'right', mods: ['alt'] } }),
  A('prevTab', 'Previous tab', 'Browse', 'combo', { ...both('tab', ['ctrl', 'shift']), repeat: true }),
  A('nextTab', 'Next tab', 'Browse', 'combo', { ...both('tab', ['ctrl']), repeat: true }),
  A('newTab', 'New tab', 'Browse', 'combo', cmdCtrl('t')),
  A('refresh', 'Reload', 'Browse', 'combo', { mac: { key: 'r', mods: ['cmd'] }, win: { key: 'f5', mods: [] } }),
  A('zoomIn', 'Zoom in', 'Browse', 'combo', { ...cmdCtrl('='), repeat: true }),
  A('zoomOut', 'Zoom out', 'Browse', 'combo', { ...cmdCtrl('-'), repeat: true }),
  A('copy', 'Copy', 'Edit', 'combo', cmdCtrl('c')),
  A('paste', 'Paste', 'Edit', 'combo', cmdCtrl('v')),
  A('cut', 'Cut', 'Edit', 'combo', cmdCtrl('x')),
  A('undo', 'Undo', 'Edit', 'combo', { ...cmdCtrl('z'), repeat: true }),
  A('selectAll', 'Select all', 'Edit', 'combo', cmdCtrl('a')),
  // windows and apps
  A('closeWindow', 'Close window or tab', 'Windows', 'combo', cmdCtrl('w')),
  A('quitApp', 'Quit app', 'Windows', 'combo', { mac: { key: 'q', mods: ['cmd'] }, win: { key: 'f4', mods: ['alt'] } }),
  A('minimize', 'Minimize', 'Windows', 'combo', { mac: { key: 'm', mods: ['cmd'] }, win: { key: 'down', mods: ['win'] } }),
  A('fullscreen', 'Full screen', 'Windows', 'combo', { mac: { key: 'f', mods: ['cmd', 'ctrl'] }, win: { key: 'f11', mods: [] } }),
  A('appNext', 'Next app (switcher)', 'Windows', 'switcher', { dir: 1 }),
  A('appPrev', 'Previous app (switcher)', 'Windows', 'switcher', { dir: -1 }),
  // desktop
  A('overview', 'Mission Control / Task View', 'Desktop', 'cmd', { mac: { cmd: 'missionControl' }, win: { key: 'tab', mods: ['win'] }, icon: 'overview' }),
  A('appWindows', 'This app’s windows', 'Desktop', 'cmd', { mac: { key: 'down', mods: ['ctrl'] }, win: { key: 'tab', mods: ['win'] } }),
  A('desktopLeft', 'Desktop to the left', 'Desktop', 'combo', { mac: { key: 'left', mods: ['ctrl'] }, win: { key: 'left', mods: ['ctrl', 'win'] }, hud: 'Desktop ←' }),
  A('desktopRight', 'Desktop to the right', 'Desktop', 'combo', { mac: { key: 'right', mods: ['ctrl'] }, win: { key: 'right', mods: ['ctrl', 'win'] }, hud: 'Desktop →' }),
  A('showDesktop', 'Show desktop', 'Desktop', 'combo', { mac: { key: 'f11', mods: [] }, win: { key: 'd', mods: ['win'] } }),
  A('search', 'Spotlight / Start search', 'Desktop', 'cmd', { mac: { key: 'space', mods: ['cmd'] }, win: { key: 'win', mods: [] }, icon: 'search' }),
  A('apps', 'All apps', 'Desktop', 'cmd', { mac: { cmd: 'launchpad' }, win: { key: 'win', mods: [] } }),
  A('screenshot', 'Screenshot', 'Desktop', 'combo', { mac: { key: '5', mods: ['cmd', 'shift'] }, win: { key: 's', mods: ['win', 'shift'] } }),
  A('notifications', 'Notifications', 'Desktop', 'cmd', { win: { key: 'n', mods: ['win'] } }),
  A('dictation', 'Dictation / voice typing', 'Desktop', 'cmd', { win: { key: 'h', mods: ['win'] } }),
  A('lock', 'Lock screen', 'Desktop', 'cmd', { mac: { key: 'q', mods: ['cmd', 'ctrl'] }, win: { cmd: 'lock' } }),
  // media
  A('playPause', 'Play / pause', 'Media', 'media', { media: 'playpause', hud: 'Play / pause' }),
  A('nextTrack', 'Next track', 'Media', 'media', { media: 'nexttrack' }),
  A('prevTrack', 'Previous track', 'Media', 'media', { media: 'prevtrack' }),
  A('volumeUp', 'Volume up', 'Media', 'media', { media: 'volumeup', repeat: true }),
  A('volumeDown', 'Volume down', 'Media', 'media', { media: 'volumedown', repeat: true }),
  A('mute', 'Mute', 'Media', 'media', { media: 'volumemute' }),
  // Helm
  A('keyboard', 'On-screen keyboard', 'Helm', 'helm', { icon: 'keyboard' }),
  A('quickPanel', 'Quick panel', 'Helm', 'helm', { icon: 'grid' }),
  A('layer', 'Command layer (hold)', 'Helm', 'helm'),
  A('toggleHelm', 'Turn Helm off', 'Helm', 'helm'),
  A('openHelm', 'Open Helm', 'Helm', 'helm')
];
const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const GROUPS = [...new Set(ACTIONS.map((a) => a.group))];

/** The platform-specific part of an action: { key, mods } or { cmd } (or null when it doesn't apply there). */
function specFor(action, platform) {
  const s = platform === 'win32' ? action.win : action.mac;
  return s || null;
}

// The buttons a person can bind, in the order the Buttons page shows them.
const BINDABLE = [
  ['cross', 'Cross', 'A'], ['circle', 'Circle', 'B'], ['square', 'Square', 'X'], ['triangle', 'Triangle', 'Y'],
  ['l1', 'L1', 'LB'], ['r1', 'R1', 'RB'], ['l2', 'L2', 'LT'], ['r2', 'R2', 'RT'], ['l3', 'L3 (press left stick)', 'LS'], ['r3', 'R3 (press right stick)', 'RS'],
  ['up', 'D-pad up', 'D-pad up'], ['down', 'D-pad down', 'D-pad down'], ['left', 'D-pad left', 'D-pad left'], ['right', 'D-pad right', 'D-pad right'],
  ['create', 'Create', 'View'], ['options', 'Options', 'Menu'], ['ps', 'PS button', 'Xbox button'], ['mute', 'Mute', 'Share'],
  ['paddleL', 'Left back paddle (Edge)', null], ['paddleR', 'Right back paddle (Edge)', null], ['fnL', 'Left Fn (Edge)', null], ['fnR', 'Right Fn (Edge)', null]
];

const DEFAULT_BINDINGS = {
  base: {
    cross: 'click', circle: 'escape', square: 'rightClick', triangle: 'keyboard',
    l1: 'back', r1: 'forward', l2: 'precision', r2: 'layer', l3: 'precisionToggle', r3: 'middleClick',
    up: 'arrowUp', down: 'arrowDown', left: 'arrowLeft', right: 'arrowRight',
    create: 'search', options: 'overview', ps: 'quickPanel', mute: 'mute',
    paddleL: 'back', paddleR: 'forward', fnL: 'none', fnR: 'none'
  },
  layer: {
    cross: 'enter', circle: 'closeWindow', square: 'copy', triangle: 'paste',
    l1: 'appPrev', r1: 'appNext', l2: 'undo', r2: 'none', l3: 'showDesktop', r3: 'refresh',
    up: 'overview', down: 'appWindows', left: 'desktopLeft', right: 'desktopRight',
    create: 'screenshot', options: 'playPause', ps: 'toggleHelm', mute: 'none',
    paddleL: 'prevTab', paddleR: 'nextTab', fnL: 'none', fnR: 'none'
  }
};

module.exports = { ACTIONS, BY_ID, GROUPS, specFor, BINDABLE, DEFAULT_BINDINGS };

// Starter scenes. Each slot lists apps in order of preference (Mac bundle id, Windows exe name, or a name pattern);
// the first one that's installed is used, and slots with nothing installed are skipped.
'use strict';
const P = require('./plan');

const C = {
  browser: [{ mac: 'com.google.chrome', win: 'chrome' }, { mac: 'company.thebrowser.browser', win: 'arc' }, { mac: 'com.microsoft.edgemac', win: 'msedge' }, { mac: 'com.brave.browser', win: 'brave' }, { mac: 'org.mozilla.firefox', win: 'firefox' }, { mac: 'com.apple.safari' }],
  chat: [{ mac: 'com.tinyspeck.slackmacgap', win: 'slack' }, { mac: 'com.microsoft.teams2', win: 'ms-teams' }, { mac: 'com.microsoft.teams', win: 'teams' }],
  mail: [{ mac: 'com.bilal.relay', win: 'relay' }, { mac: 'com.microsoft.outlook', win: 'olk' }, { win: 'outlook' }, { mac: 'com.apple.mail' }],
  docket: [{ mac: 'com.bilal.docket', win: 'docket' }],
  datum: [{ mac: 'com.bilal.datum', win: 'datum' }],
  lumen: [{ mac: 'com.bilal.lumen', win: 'lumen' }],
  steam: [{ mac: 'com.valvesoftware.steam', win: 'steam' }, { win: 'epicgameslauncher' }, { mac: 'com.blizzard.bnetlauncher', win: 'battle.net' }],
  discord: [{ mac: 'com.hnc.discord', win: 'discord' }],
  music: [{ mac: 'com.spotify.client', win: 'spotify', name: /^spotify$/i }, { mac: 'com.apple.music' }],
  touchline: [{ mac: 'com.bilal.touchline', win: 'touchline' }],
  messages: [{ mac: 'net.whatsapp.whatsapp', win: 'whatsapp', name: /^whatsapp$/i }, { mac: 'com.apple.mobilesms' }],
  editor: [{ mac: 'com.microsoft.vscode', win: 'code' }, { mac: 'com.todesktop.230313mzl4w4u92', win: 'cursor' }],
  creative: [{ mac: 'com.adobe.photoshop', name: /photoshop/i }, { mac: 'com.lemon.lvoverseas', win: 'capcut', name: /^capcut$/i }, { mac: 'com.bilal.ro3', win: 'ro3' }],
  notes: [{ mac: 'com.apple.notes' }, { mac: 'notion.id', win: 'notion' }, { mac: 'md.obsidian', win: 'obsidian' }]
};

// zone fractions on a display; `on: 'second'` means the biggest non-main display when there is one
const TEMPLATES = [
  {
    id: 'work', name: 'Work', color: 'blue', glyph: 'briefcase', blurb: 'Browser and chat side by side, inbox and meeting notes on the laptop.',
    others: 'leave', system: {},
    slots: [
      { want: 'browser', on: 'second', zone: 'left-two-thirds', alone: 'left-two-thirds' },
      { want: 'chat', on: 'second', zone: 'right-third', alone: 'right-third' },
      { want: 'mail', on: 'main', zone: 'left', alone: null },
      { want: 'docket', on: 'main', zone: 'right', alone: null }
    ]
  },
  {
    id: 'gaming', name: 'Gaming', color: 'violet', glyph: 'gamepad', blurb: 'Launcher up front, Discord on the side screen, everything else closed.',
    others: 'quit', system: { volume: 70, appearance: 'dark', keepAwake: true },
    slots: [
      { want: 'steam', on: 'main', state: 'maximized' },
      { want: 'discord', on: 'second', zone: 'right-third', alone: null },
      { want: 'music', on: 'second', zone: 'left-two-thirds', alone: null, state: 'minimized' }
    ]
  },
  {
    id: 'matchday', name: 'Match day', color: 'green', glyph: 'ball', blurb: 'The stream big, Touchline’s live stats next to it, the group chat in reach.',
    others: 'hide', system: { volume: 80, keepAwake: true },
    slots: [
      { want: 'browser', on: 'second', state: 'maximized', alone: 'left-two-thirds', open: ['https://www.youtube.com/'] },
      { want: 'touchline', on: 'main', zone: 'left', alone: 'right-third' },
      { want: 'messages', on: 'main', zone: 'right', alone: null }
    ]
  },
  {
    id: 'focus', name: 'Deep work', color: 'amber', glyph: 'target', blurb: 'One app, full screen. Everything else hidden and quiet.',
    others: 'hide', system: { mute: true },
    slots: [{ want: 'datum', on: 'main', state: 'maximized' }, { want: 'notes', on: 'second', zone: 'right-third', alone: null }],
    actions: [{ kind: 'shortcut', value: '', mac: true, hint: 'Pick a Shortcut that turns on a Focus' }]
  },
  {
    id: 'create', name: 'Create', color: 'rose', glyph: 'brush', blurb: 'Editor wide on the big screen, references and music beside it.',
    others: 'hide', system: { appearance: 'dark' },
    slots: [{ want: 'creative', on: 'second', state: 'maximized', alone: 'left-two-thirds' }, { want: 'browser', on: 'main', zone: 'left', alone: 'right-third' }, { want: 'music', on: 'main', zone: 'right', alone: null }]
  },
  {
    id: 'movie', name: 'Movie night', color: 'teal', glyph: 'film', blurb: 'One window full screen, dark mode, volume up, screen stays on.',
    others: 'hide', system: { volume: 60, appearance: 'dark', keepAwake: true },
    slots: [{ want: 'browser', on: 'main', state: 'fullscreen', open: ['https://www.netflix.com/'] }]
  },
  { id: 'blank', name: 'Blank scene', color: 'slate', glyph: 'spark', blurb: 'Start empty and add apps yourself.', others: 'leave', system: {}, slots: [] }
];

function pick(cands, installed) {
  for (const c of cands) {
    const a = installed.find((x) => (c.mac && x.bundleId && x.bundleId.toLowerCase() === c.mac) || (c.win && x.path && P.baseName(x.path) === c.win) || (c.name && c.name.test(x.name)));
    if (a) return a;
  }
  return null;
}

/** Build a scene from a template for this computer's displays and installed apps. */
function fromTemplate(tid, installed, displays, { platform = process.platform } = {}) {
  const t = TEMPLATES.find((x) => x.id === tid) || TEMPLATES[TEMPLATES.length - 1];
  const main = displays.find((d) => d.primary) || displays[0];
  const second = displays.filter((d) => d !== main).sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0] || null;
  const apps = [];
  for (const s of t.slots) {
    const a = pick(C[s.want] || [], installed); if (!a || apps.some((x) => P.sameApp(x, a))) continue;
    // With two displays every slot goes where it says; on one display, `alone` says where it goes instead (null: leave it out)
    let d = main, zoneName = s.zone, state = s.state;
    if (second) d = s.on === 'second' ? second : main;
    else if (s.alone === null) continue;
    else if (s.alone) { zoneName = s.alone; if (state === 'maximized') state = 'normal'; }
    const zone = zoneName ? P.ZONES[zoneName] : P.ZONES.full;
    apps.push({
      id: P.uid('a'), name: a.name, bundleId: a.bundleId || null, path: a.path || null, aumid: a.aumid || null, launch: true, args: '',
      open: (s.open || []).map((u) => ({ target: u })),
      windows: [{ id: P.uid('w'), title: '', match: 'any', display: d.id, frac: { ...(zone || P.ZONES.full) }, state: state === 'fullscreen' && platform !== 'darwin' ? 'maximized' : (state || 'normal') }]
    });
  }
  return {
    id: P.uid('s'), name: t.name, color: t.color, glyph: t.glyph, hotkey: '', createdAt: Date.now(), updatedAt: Date.now(),
    displays: displays.map((d) => ({ ...d })), apps, extras: [], others: t.others, focusApp: apps[0] ? apps[0].id : null,
    system: { ...t.system }, actions: (t.actions || []).filter((a) => !a.mac || platform === 'darwin').filter((a) => a.value).map((a) => ({ ...a })),
    triggers: [], triggerMode: 'auto'
  };
}

module.exports = { TEMPLATES: TEMPLATES.map(({ slots, ...t }) => ({ ...t, slots: slots.map((s) => s.want) })), fromTemplate, CANDIDATES: C };

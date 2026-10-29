// Helm's Mac input helper (JavaScript for Automation, run by osascript). It stays running, reads one command per line
// on stdin and posts real mouse, scroll and keyboard events with Quartz. Needs Accessibility permission for Helm.
//   m x y              move the pointer to x,y (points, global, top-left origin); drags if a button is down
//   b l|r|m 1|0        mouse button down / up where the pointer is
//   w dy dx c          scroll by pixels (dy > 0 shows what's further down); c = 1 for trackpad-style continuous
//   k code 1|0 flags   key down / up with modifier flags
//   n type             a media key (NX key type: 0 vol+, 1 vol-, 7 mute, 16 play, 17 next, 18 previous)
//   f                  answer "F pid<TAB>bundle<TAB>name<TAB>x,y,w,h" for the frontmost window's app
//   p                  answer "P"
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
ObjC.import('stdlib');

const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
function say(s) { stdout.writeData($.NSString.alloc.initWithString(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }

const BTN = { l: [1, 2, 6, 0], r: [3, 4, 7, 1], m: [25, 26, 27, 2] }; // down, up, dragged, button number
const down = { l: false, r: false, m: false };
let held = 0;               // modifier flags held by key-downs (⌘ during the app switcher)
const MOD_KEYS = { 55: 0x100000, 54: 0x100000, 56: 0x20000, 60: 0x20000, 58: 0x80000, 61: 0x80000, 59: 0x40000, 62: 0x40000 };
let lastClick = { t: 0, x: -1e9, y: -1e9, n: 0, b: '' };

function here() { const e = $.CGEventCreate(null); const p = $.CGEventGetLocation(e); return { x: p.x, y: p.y }; }
function post(e) { if (held) $.CGEventSetFlags(e, $.CGEventGetFlags(e) | held); $.CGEventPost(0, e); }

function move(x, y) {
  let type = 5, button = 0;
  for (const k of ['l', 'r', 'm']) if (down[k]) { type = BTN[k][2]; button = BTN[k][3]; break; }
  const e = $.CGEventCreateMouseEvent(null, type, { x: x, y: y }, button);
  post(e);
}
function button(k, isDown) {
  const b = BTN[k]; if (!b) return;
  const p = here();
  const e = $.CGEventCreateMouseEvent(null, isDown ? b[0] : b[1], p, b[3]);
  if (isDown) {
    const now = Date.now();
    const near = Math.abs(p.x - lastClick.x) < 5 && Math.abs(p.y - lastClick.y) < 5;
    lastClick.n = (now - lastClick.t < 450 && near && lastClick.b === k) ? Math.min(3, lastClick.n + 1) : 1;
    lastClick.t = now; lastClick.x = p.x; lastClick.y = p.y; lastClick.b = k;
  }
  $.CGEventSetIntegerValueField(e, 1, lastClick.n); // kCGMouseEventClickState: lets double-clicks register
  down[k] = isDown;
  post(e);
}
let scroll2 = true;
function scroll(dy, dx, cont) {
  let e = null;
  if (scroll2) { try { e = $.CGEventCreateScrollWheelEvent2(null, 0, 2, -dy, -dx, 0); } catch (err) { scroll2 = false; } }
  if (!e) {
    e = $.CGEventCreate(null); $.CGEventSetType(e, 22);
    $.CGEventSetIntegerValueField(e, 96, -dy); $.CGEventSetIntegerValueField(e, 97, -dx); // point deltas
    $.CGEventSetIntegerValueField(e, 11, dy > 0 ? -1 : dy < 0 ? 1 : 0); $.CGEventSetIntegerValueField(e, 12, dx > 0 ? -1 : dx < 0 ? 1 : 0);
  }
  if (cont) $.CGEventSetIntegerValueField(e, 88, 1); // kCGScrollWheelEventIsContinuous
  post(e);
}
function key(code, isDown, flags) {
  const e = $.CGEventCreateKeyboardEvent(null, code, isDown);
  if (MOD_KEYS[code]) { if (isDown) held |= MOD_KEYS[code]; else held &= ~MOD_KEYS[code]; }
  $.CGEventSetFlags(e, flags | held);
  $.CGEventPost(0, e);
}
function media(type) {
  for (const isDown of [true, false]) {
    const flags = isDown ? 0xa00 : 0xb00;
    const data1 = (type << 16) | ((isDown ? 0xa : 0xb) << 8);
    const ev = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(14, { x: 0, y: 0 }, flags, 0, 0, null, 8, data1, -1);
    $.CGEventPost(0, ev.CGEvent);
  }
}
function front() {
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
  for (const w of list) {
    if (w.kCGWindowLayer !== 0 || !(w.kCGWindowAlpha > 0)) continue;
    const b = w.kCGWindowBounds || {}; if ((b.Width || 0) < 60 || (b.Height || 0) < 60) continue;
    const pid = w.kCGWindowOwnerPID; let bundle = '';
    try { const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid); bundle = app.bundleIdentifier.js || ''; } catch (e) {}
    return 'F ' + [pid, bundle, (w.kCGWindowOwnerName || '').replace(/\t/g, ' '), [b.X, b.Y, b.Width, b.Height].join(',')].join('\t');
  }
  return 'F ';
}

function handle(line) {
  const a = line.split(' ');
  switch (a[0]) {
    case 'm': move(parseFloat(a[1]), parseFloat(a[2])); break;
    case 'b': button(a[1], a[2] === '1'); break;
    case 'w': scroll(parseInt(a[1], 10) || 0, parseInt(a[2], 10) || 0, a[3] === '1'); break;
    case 'k': key(parseInt(a[1], 10), a[2] === '1', parseInt(a[3], 10) || 0); break;
    case 'n': media(parseInt(a[1], 10)); break;
    case 'f': say(front()); break;
    case 'p': say('P'); break;
    case 'q': $.exit(0); break;
  }
}

function run() {
  const stdin = $.NSFileHandle.fileHandleWithStandardInput;
  let buf = '';
  let trusted = '?'; try { ObjC.import('ApplicationServices'); trusted = $.AXIsProcessTrusted() ? '1' : '0'; } catch (e) {}
  say('READY ' + trusted);
  for (;;) {
    const data = stdin.availableData;           // blocks until there's input; empty at end of input
    const chunk = data ? $.NSString.alloc.initWithDataEncoding(data, 4).js : '';
    if (!chunk) break;                            // (NSData.length isn't reliable through the bridge)
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line) continue;
      try { handle(line); } catch (e) { say('E ' + String(e).replace(/\n/g, ' ')); }
    }
  }
}

// Windows: a small C# helper (compiled once per PowerShell session with Add-Type) enumerates real top-level
// windows, reads their frames and moves them with SetWindowPos; Core Audio sets the volume. Apps come from
// Get-StartApps. Coordinates from the helper are physical pixels; main.js converts them to/from Electron DIPs.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { run, ps, psJson } = require('./run');

const CS = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class SceneWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT { public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, uint p, string v, uint flags);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmRect(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmInt(IntPtr h, int a, out int v, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int size);

  static void Dpi() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { } }

  static Dictionary<uint, string> paths = new Dictionary<uint, string>();
  static string ProcPath(uint pid) {
    string p;
    if (paths.TryGetValue(pid, out p)) return p;
    p = "";
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h != IntPtr.Zero) {
      StringBuilder sb = new StringBuilder(1024); int n = sb.Capacity;
      if (QueryFullProcessImageName(h, 0, sb, ref n)) p = sb.ToString();
      CloseHandle(h);
    }
    paths[pid] = p; return p;
  }
  static string Esc(string s) {
    if (s == null) return "";
    StringBuilder b = new StringBuilder(s.Length + 8);
    foreach (char c in s) {
      if (c == '"') b.Append("\\\""); else if (c == '\\') b.Append("\\\\");
      else if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.ToString();
  }
  static string Text(IntPtr h) { int n = GetWindowTextLength(h); if (n <= 0) return ""; StringBuilder sb = new StringBuilder(n + 2); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  static string Cls(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
  static RECT Frame(IntPtr h) {
    RECT r;
    if (DwmRect(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;
  }
  static bool Cloaked(IntPtr h) { int v = 0; try { DwmInt(h, 14, out v, 4); } catch (Exception) { } return v != 0; }

  // Store apps live inside ApplicationFrameHost; the real process owns a child CoreWindow.
  static uint uwpPid;
  static uint RealPid(IntPtr h, uint pid) {
    uwpPid = 0;
    EnumChildWindows(h, delegate (IntPtr c, IntPtr l) { uint p2; GetWindowThreadProcessId(c, out p2); if (p2 != pid) { uwpPid = p2; return false; } return true; }, IntPtr.Zero);
    return uwpPid != 0 ? uwpPid : pid;
  }

  public static string List() {
    Dpi();
    paths.Clear();
    StringBuilder o = new StringBuilder("[");
    IntPtr fg = GetForegroundWindow();
    int z = 0; bool first = true;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true;
      int ex = GetWindowLong(h, -20);
      if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;
      if (Cloaked(h)) return true;
      string title = Text(h); if (title.Length == 0) return true;
      string cls = Cls(h);
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string p = ProcPath(pid);
      if (p.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase)) { pid = RealPid(h, pid); p = ProcPath(pid); }
      WINDOWPLACEMENT wp = new WINDOWPLACEMENT(); wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT)); GetWindowPlacement(h, ref wp);
      bool mini = IsIconic(h), max = IsZoomed(h);
      RECT r = mini ? wp.rcNormalPosition : Frame(h);
      if (!first) o.Append(","); first = false;
      o.Append("{\"h\":").Append(h.ToInt64()).Append(",\"pid\":").Append(pid)
       .Append(",\"path\":\"").Append(Esc(p)).Append("\",\"title\":\"").Append(Esc(title)).Append("\",\"cls\":\"").Append(Esc(cls))
       .Append("\",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top).Append(",\"w\":").Append(r.Right - r.Left).Append(",\"hh\":").Append(r.Bottom - r.Top)
       .Append(",\"state\":\"").Append(mini ? "minimized" : (max ? "maximized" : "normal")).Append("\",\"fg\":").Append(h == fg ? "true" : "false").Append(",\"z\":").Append(z++).Append("}");
      return true;
    }, IntPtr.Zero);
    return o.Append("]").ToString();
  }

  static void SetBounds(IntPtr h, int x, int y, int w, int hh) {
    RECT wr, fr; GetWindowRect(h, out wr); fr = Frame(h);
    int dl = fr.Left - wr.Left, dt = fr.Top - wr.Top, dr = wr.Right - fr.Right, db = wr.Bottom - fr.Bottom;
    if (dl < 0 || dl > 40) dl = 0; if (dt < 0 || dt > 40) dt = 0; if (dr < 0 || dr > 40) dr = 0; if (db < 0 || db > 40) db = 0;
    SetWindowPos(h, IntPtr.Zero, x - dl, y - dt, w + dl + dr, hh + dt + db, 0x0004 | 0x0010);
  }
  public static string Place(long handle, int x, int y, int w, int hh, string state) {
    Dpi();
    IntPtr h = new IntPtr(handle);
    if (!IsWindow(h)) return "missing";
    if (state == "minimized") { ShowWindow(h, 7); return "ok"; }
    if (IsIconic(h) || IsZoomed(h)) ShowWindow(h, 9);
    SetBounds(h, x, y, w, hh);
    SetBounds(h, x, y, w, hh);   // again: crossing to a screen with another scale makes the window resize itself
    if (state == "maximized" || state == "fullscreen") ShowWindow(h, 3);
    return "ok";
  }
  public static void Focus(long handle) {
    IntPtr h = new IntPtr(handle);
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h); BringWindowToTop(h);
  }
  public static void Close(long handle) { PostMessage(new IntPtr(handle), 0x10, IntPtr.Zero, IntPtr.Zero); }
  public static void Minimize(long handle) { ShowWindow(new IntPtr(handle), 7); }
  public static bool Wallpaper(string p) { return SystemParametersInfo(20, 0, p, 3); }
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, ref Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface); }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class SceneAudio {
  static IAudioEndpointVolume Vol() {
    IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static string Get() { IAudioEndpointVolume v = Vol(); float f; bool m; v.GetMasterVolumeLevelScalar(out f); v.GetMute(out m); return ((int)Math.Round(f * 100)).ToString() + "," + (m ? "true" : "false"); }
  public static void Set(int pct) { Guid g = Guid.Empty; Vol().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref g); }
  public static void Mute(bool on) { Guid g = Guid.Empty; Vol().SetMute(on, ref g); }
}
`;

const PRELUDE = `if (-not ('SceneWin' -as [type])) { Add-Type -TypeDefinition @'\n${CS}\n'@ }\n`;
const call = (expr, opts = {}) => ps(PRELUDE + expr, { shell: 'fast', timeout: 25000, ...opts });

// Electron converts between physical pixels and DIPs; main.js passes those functions in.
let conv = { toDip: (r) => r, toScreen: (r) => r };
function setConverters(c) { conv = c; }

/** Parse SceneWin.List() output into Scene's window shape (rects still physical). Exported for tests. */
function parseList(text, selfPid = 0) {
  const line = String(text || '').split('\n').find((l) => l.trim().startsWith('['));
  let arr = []; try { arr = JSON.parse(line); } catch { return []; }
  const out = [];
  for (const w of arr) {
    if (w.pid === selfPid) continue;
    if (w.state !== 'minimized' && (w.w < 80 || w.hh < 50)) continue;
    const exe = w.path || '';
    const name = exeName(exe) || w.title;
    out.push({ id: String(w.h), handle: w.h, pid: w.pid, app: { name, path: exe || null, pid: w.pid }, title: w.title, cls: w.cls, physical: { x: w.x, y: w.y, width: w.w, height: w.hh }, state: w.state, focused: !!w.fg, z: w.z });
  }
  return out;
}
const exeName = (p) => { const b = String(p || '').split('\\').pop().replace(/\.exe$/i, ''); return b ? b.charAt(0).toUpperCase() + b.slice(1) : ''; };

// friendly names from the Start menu, keyed by exe path
let startIndex = new Map();
async function snapshot() {
  const r = await call('[SceneWin]::List()');
  if (!r.ok) { const e = new Error((r.error || r.stdout || 'Windows did not answer').trim()); e.code = 'list'; throw e; }
  const wins = parseList(r.stdout, process.pid);
  for (const w of wins) {
    const known = w.app.path && startIndex.get(w.app.path.toLowerCase());
    if (known) { w.app.name = known.name; w.app.aumid = known.aumid; }
    w.bounds = conv.toDip(w.physical);
  }
  const apps = []; const seen = new Set();
  for (const w of wins) { const k = (w.app.path || w.app.name).toLowerCase(); if (!seen.has(k)) { seen.add(k); apps.push(w.app); } }
  return { windows: wins, apps };
}
async function runningApps() { try { return (await snapshot()).apps; } catch { return []; } }

// ---------------------------------------------------------------- installed apps (Start menu)
const KNOWN = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files',
  '{905E63B6-C1BF-494E-B29C-65B732D3D21A}': process.env.ProgramFiles || 'C:\\Program Files',
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': process.env.SystemRoot || 'C:\\Windows',
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
  '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': process.env.LOCALAPPDATA || '',
  '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': process.env.APPDATA || '',
  '{F7F1ED05-9F6D-47A2-AAAE-29D317C6F066}': process.env.CommonProgramFiles || ''
};
/** Get-StartApps AppID -> exe path, when the AppID is a path (desktop apps). Store apps return null. */
function resolveAppId(id) {
  if (!id || !/\.exe$/i.test(id)) return null;
  const m = id.match(/^(\{[0-9A-F-]+\})\\(.*)$/i);
  if (m) { const base = KNOWN[m[1].toUpperCase()]; return base ? path.join(base, m[2]) : null; }
  return /^[a-z]:\\/i.test(id) ? id : null;
}
async function listApps() {
  const rows = await psJson('Get-StartApps | Select-Object Name, AppID', { shell: 'slow', timeout: 30000 });
  const out = []; const idx = new Map();
  for (const r of rows) {
    if (!r || !r.Name || !r.AppID) continue;
    if (/^(uninstall|readme|help|website|documentation)\b/i.test(r.Name) || /uninstall/i.test(r.AppID)) continue;
    const exe = resolveAppId(r.AppID);
    if (/^https?:/i.test(r.AppID)) continue;
    const a = { name: r.Name, aumid: r.AppID, path: exe };
    out.push(a); if (exe) idx.set(exe.toLowerCase(), a);
  }
  startIndex = idx;
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------------------------------------------------------------- launching
const CHROMIUM = /\\(chrome|msedge|brave|vivaldi|opera|chromium)\.exe$/i;
const FIREFOX = /\\firefox\.exe$/i;
const splitArgs = (s) => (String(s || '').match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
function detached(cmd, args, cwd) {
  return new Promise((resolve) => {
    try {
      const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, cwd: cwd || undefined });
      c.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
      c.unref(); setTimeout(() => resolve({ ok: true }), 300);
    } catch (e) { resolve({ ok: false, error: String(e.message || e) }); }
  });
}
async function launch(app, { open = [], args = '', newWindow = true } = {}) {
  const extra = splitArgs(args);
  if (app.path && fs.existsSync(app.path)) {
    const nw = open.length && newWindow ? (CHROMIUM.test(app.path) ? ['--new-window'] : FIREFOX.test(app.path) ? ['-new-window'] : []) : [];
    return detached(app.path, [...extra, ...nw, ...open], path.dirname(app.path));
  }
  if (app.aumid) {
    const r = await detached('explorer.exe', [`shell:AppsFolder\\${app.aumid}`]);
    // Store apps can't be handed files on the command line; open those with their default app instead
    if (open.length) for (const t of open) await detached('cmd.exe', ['/c', 'start', '""', t]);
    return r;
  }
  return { ok: false, error: `Can't find ${app.name}` };
}

async function place(ops) {
  if (!ops.length) return [];
  const lines = ops.map((o) => {
    const r = conv.toScreen(o.rect);
    return `[SceneWin]::Place(${Number(o.win.handle)}, ${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)}, ${Math.round(r.height)}, '${(o.state || 'normal').replace(/'/g, '')}')`;
  });
  const r = await call(lines.join('\n'), { timeout: 20000 + ops.length * 1500 });
  const res = r.stdout.split('\n').map((s) => s.trim()).filter((s) => s === 'ok' || s === 'missing');
  return ops.map((_, i) => (res[i] === 'ok' ? { ok: true } : { ok: false, error: res[i] === 'missing' ? 'window closed' : (r.error || 'failed') }));
}

const handlesOf = (apps, snap) => snap.windows.filter((w) => apps.some((a) => (a.path && w.app.path && a.path.toLowerCase() === w.app.path.toLowerCase()) || (!a.path && a.name === w.app.name))).map((w) => w.handle);
async function quit(apps) {
  const snap = await snapshot(); const hs = handlesOf(apps, snap);
  if (!hs.length) return { ok: true };
  return call(hs.map((h) => `[SceneWin]::Close(${h})`).join('\n'));
}
async function hide(apps) {
  const snap = await snapshot(); const hs = handlesOf(apps, snap);
  if (!hs.length) return { ok: true };
  return call(hs.map((h) => `[SceneWin]::Minimize(${h})`).join('\n'));
}
async function focus(app, win) {
  let h = win && win.handle;
  if (!h) { const snap = await snapshot(); const w = snap.windows.find((x) => (app.path && x.app.path && x.app.path.toLowerCase() === app.path.toLowerCase()) || x.app.name === app.name); h = w && w.handle; }
  if (!h) return { ok: false, error: 'no window' };
  return call(`[SceneWin]::Focus(${h})`);
}

// ---------------------------------------------------------------- system settings
async function getVolume() { const r = await call('[SceneAudio]::Get()'); const m = r.stdout.match(/(\d+),(true|false)/); return m ? { volume: Number(m[1]), muted: m[2] === 'true' } : { volume: null, muted: null }; }
const setVolume = (v) => call(`[SceneAudio]::Set(${Math.round(Number(v) || 0)})`);
const setMute = (m) => call(`[SceneAudio]::Mute($${m ? 'true' : 'false'})`);
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
async function getAppearance() { const r = await run('reg.exe', ['query', KEY, '/v', 'AppsUseLightTheme'], { timeout: 5000 }); return /0x0\b/.test(r.stdout) ? 'dark' : 'light'; }
async function setAppearance(mode) {
  const v = mode === 'dark' ? '0' : '1';
  await run('reg.exe', ['add', KEY, '/v', 'AppsUseLightTheme', '/t', 'REG_DWORD', '/d', v, '/f'], { timeout: 5000 });
  return run('reg.exe', ['add', KEY, '/v', 'SystemUsesLightTheme', '/t', 'REG_DWORD', '/d', v, '/f'], { timeout: 5000 });
}
const setWallpaper = (p) => call(`[SceneWin]::Wallpaper('${String(p).replace(/'/g, "''")}')`);
const listShortcuts = async () => [];
const runShortcut = async () => ({ ok: false, error: 'Shortcuts are a Mac feature' });
const runCommand = (cmd) => run('cmd.exe', ['/d', '/s', '/c', cmd], { timeout: 120000 });

module.exports = {
  name: 'win', snapshot, runningApps, listApps, launch, place, quit, hide, focus,
  getVolume, setVolume, setMute, getAppearance, setAppearance, setWallpaper, listShortcuts, runShortcut, runCommand,
  supports: { fullscreen: false, shortcuts: false, wallpaper: true, appearance: true, volume: true, hide: true },
  setConverters, parseList, resolveAppId, CS, PRELUDE
};

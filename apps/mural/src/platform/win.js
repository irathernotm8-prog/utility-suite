// Mural — Windows: puts each wallpaper window behind the desktop icons and watches the desktop.
//
// How: Explorer draws the wallpaper in a WorkerW window behind the icons (SHELLDLL_DefView). Sending Progman message
// 0x052C makes Explorer split that WorkerW off; our window becomes its child, so it sits exactly where the wallpaper
// is: behind the icons, under every app, on all virtual desktops. On Windows 11 24H2+ the WorkerW is a child of Progman
// instead, so the window goes into Progman just below the icons.
//
// The helper is C# compiled by Windows PowerShell (C# 5: no $"", no ?., no out var). One long-lived process:
//   stdin  (commands)  attach <seq> <hwnd> <x> <y> <w> <h> | move … | refresh <seq> | getwp <seq> | setwp <seq> <b64path> | clicks 0|1 | cover 0|1 | quit
//   stdout (JSON lines) {"re":seq,…}  {"ev":"click","x","y","b"}  {"ev":"cover","mons":[{x,y,w,h,c}]}  {"ev":"ready"}
// Coordinates are physical pixels (the helper is per-monitor DPI aware); win.js converts to Electron's DIPs.
'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const CS = String.raw`
using System; using System.Text; using System.Threading; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class MuralWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public delegate bool MonProc(IntPtr m, IntPtr dc, ref RECT r, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string n);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonProc f, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW")] static extern bool SpiGet(uint a, uint b, StringBuilder p, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW")] static extern bool SpiSet(uint a, uint b, string p, uint f);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);

  static readonly object Gate = new object();
  static volatile bool clicks = false, cover = true;
  static int ownPid;
  static List<IntPtr> ours = new List<IntPtr>();

  static void Out(string s) { lock (Gate) { Console.Out.WriteLine(s); Console.Out.Flush(); } }
  static string Cls(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

  static IntPtr defView = IntPtr.Zero;
  // Returns the window to parent wallpapers into; mode tells which layout Explorer uses.
  static IntPtr Host(out string mode) {
    IntPtr progman = FindWindow("Progman", null); IntPtr res;
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);
    IntPtr worker = IntPtr.Zero; defView = IntPtr.Zero;
    EnumProc f = delegate (IntPtr h, IntPtr l) {
      IntPtr dv = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (dv != IntPtr.Zero) { defView = dv; worker = FindWindowEx(IntPtr.Zero, h, "WorkerW", null); }
      return true;
    };
    EnumWindows(f, IntPtr.Zero); GC.KeepAlive(f);
    if (worker != IntPtr.Zero && GetParent(defView) != progman) { mode = "workerw"; return worker; }
    // Windows 11 24H2+: Progman holds both the icons and a WorkerW child
    IntPtr dv2 = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (dv2 != IntPtr.Zero) { defView = dv2; mode = "progman"; return progman; }
    mode = worker != IntPtr.Zero ? "workerw" : "none"; return worker;
  }

  static string Attach(IntPtr hwnd, int x, int y, int w, int h) {
    string mode; IntPtr host = Host(out mode);
    if (host == IntPtr.Zero) return "{\"ok\":false,\"error\":\"desktop window not found\"}";
    SetParent(hwnd, host);
    Place(hwnd, x, y, w, h, mode);
    lock (Gate) { if (!ours.Contains(hwnd)) ours.Add(hwnd); }
    return "{\"ok\":true,\"mode\":\"" + mode + "\"}";
  }
  static void Place(IntPtr hwnd, int x, int y, int w, int h, string mode) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77); // the parent spans the whole virtual screen
    IntPtr after = mode == "progman" && defView != IntPtr.Zero ? defView : IntPtr.Zero; // 24H2: just below the icons
    uint flags = 0x0050u | (after == IntPtr.Zero ? 0x0004u : 0u); // NOACTIVATE | SHOWWINDOW | NOZORDER
    SetWindowPos(hwnd, after, x - vx, y - vy, w, h, flags);
  }
  static string Wallpaper() { StringBuilder sb = new StringBuilder(520); SpiGet(0x73, 520, sb, 0); return sb.ToString(); }
  // Re-setting the same picture makes Explorer repaint the desktop, wiping the last frame we drew.
  static void Refresh() { string p = Wallpaper(); SpiSet(20, 0, p, 0); }

  static bool IsDesktop(IntPtr h) {
    IntPtr root = GetAncestor(h, 2); string c = Cls(root);
    if (c == "Progman" || c == "WorkerW") return true;
    lock (Gate) { return ours.Contains(root) || ours.Contains(h); }
  }

  static List<RECT> Monitors() {
    List<RECT> list = new List<RECT>();
    MonProc f = delegate (IntPtr m, IntPtr dc, ref RECT r, IntPtr l) { list.Add(r); return true; };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, f, IntPtr.Zero); GC.KeepAlive(f);
    return list;
  }
  static string lastCover = "";
  static void CheckCover() {
    List<RECT> mons = Monitors(); bool[] cov = new bool[mons.Count];
    EnumProc f = delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid); if (pid == ownPid) return true;
      int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return true;
      int ex = GetWindowLong(h, -20); if ((ex & 0x20) != 0) return true; // click-through overlays
      string c = Cls(h);
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Windows.UI.Core.CoreWindow" || c == "XamlExplorerHostIslandWindow") return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      for (int i = 0; i < mons.Count; i++) {
        RECT m = mons[i];
        int x0 = Math.Max(r.L, m.L), y0 = Math.Max(r.T, m.T), x1 = Math.Min(r.R, m.R), y1 = Math.Min(r.B, m.B);
        if (x1 > x0 && y1 > y0) { double a = (double)(x1 - x0) * (y1 - y0) / ((double)(m.R - m.L) * (m.B - m.T)); if (a >= 0.97) cov[i] = true; }
      }
      return true;
    };
    EnumWindows(f, IntPtr.Zero); GC.KeepAlive(f);
    StringBuilder sb = new StringBuilder("{\"ev\":\"cover\",\"mons\":[");
    for (int i = 0; i < mons.Count; i++) { RECT m = mons[i]; if (i > 0) sb.Append(','); sb.Append("{\"x\":" + m.L + ",\"y\":" + m.T + ",\"w\":" + (m.R - m.L) + ",\"h\":" + (m.B - m.T) + ",\"c\":" + (cov[i] ? "true" : "false") + "}"); }
    sb.Append("]}"); string s = sb.ToString();
    if (s != lastCover) { lastCover = s; Out(s); }
  }

  static void Watch() {
    bool down = false; int tick = 0;
    while (true) {
      try {
        if (clicks) {
          bool l = (GetAsyncKeyState(0x01) & 0x8000) != 0, r = (GetAsyncKeyState(0x02) & 0x8000) != 0;
          if ((l || r) && !down) { POINT p; GetCursorPos(out p); if (IsDesktop(WindowFromPoint(p))) Out("{\"ev\":\"click\",\"x\":" + p.X + ",\"y\":" + p.Y + ",\"b\":" + (r ? 2 : 0) + "}"); }
          down = l || r;
        }
        if (cover && tick % 60 == 0) CheckCover();
      } catch (Exception) { }
      tick++; Thread.Sleep(clicks ? 16 : 200); if (!clicks) tick += 11;
    }
  }

  public static void Run(int pid) {
    ownPid = pid;
    try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
    Thread t = new Thread(Watch); t.IsBackground = true; t.Start();
    Out("{\"ev\":\"ready\"}");
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      string[] a = line.Trim().Split(' ');
      if (a.Length == 0 || a[0] == "") continue;
      try {
        switch (a[0]) {
          case "attach": Out("{\"re\":" + a[1] + ",\"data\":" + Attach(new IntPtr(long.Parse(a[2])), int.Parse(a[3]), int.Parse(a[4]), int.Parse(a[5]), int.Parse(a[6])) + "}"); break;
          case "move": { string mode; Host(out mode); Place(new IntPtr(long.Parse(a[2])), int.Parse(a[3]), int.Parse(a[4]), int.Parse(a[5]), int.Parse(a[6]), mode); Out("{\"re\":" + a[1] + ",\"data\":{\"ok\":true}}"); break; }
          case "forget": { IntPtr h = new IntPtr(long.Parse(a[2])); lock (Gate) { ours.Remove(h); } Out("{\"re\":" + a[1] + ",\"data\":{\"ok\":true}}"); break; }
          case "refresh": Refresh(); Out("{\"re\":" + a[1] + ",\"data\":{\"ok\":true}}"); break;
          case "getwp": Out("{\"re\":" + a[1] + ",\"data\":{\"ok\":true,\"path\":\"" + Esc(Wallpaper()) + "\"}}"); break;
          case "setwp": { string p = Encoding.UTF8.GetString(Convert.FromBase64String(a[2])); bool ok = SpiSet(20, 0, p, 3); Out("{\"re\":" + a[1] + ",\"data\":{\"ok\":" + (ok ? "true" : "false") + "}}"); break; }
          case "clicks": clicks = a[1] == "1"; break;
          case "cover": cover = a[1] == "1"; if (cover) lastCover = ""; break;
          case "quit": return;
        }
      } catch (Exception e) { if (a.Length > 1) Out("{\"re\":" + a[1] + ",\"data\":{\"ok\":false,\"error\":\"" + Esc(e.Message) + "\"}}"); }
    }
  }
}
`;

class WinDesktop extends EventEmitter {
  constructor({ dataDir, screen, log }) { super(); this.dataDir = dataDir; this.screen = screen; this.log = log || (() => {}); this.child = null; this.seq = 0; this.pending = new Map(); this.opts = { clicks: false, cover: true }; this.restarts = 0; this.stopped = false; }
  get name() { return 'windows'; }
  windowOptions() { return { type: 'toolbar' }; } // toolbar windows stay out of Alt+Tab and the taskbar

  start(opts = {}) {
    Object.assign(this.opts, opts); this.stopped = false;
    if (this.child) return;
    const file = path.join(this.dataDir, 'mural-desktop.ps1');
    const ps1 = "$ErrorActionPreference = 'Stop'\r\nAdd-Type -TypeDefinition @'\r\n" + CS.replace(/\n/g, '\r\n') + "\r\n'@\r\n[MuralWin]::Run([int]$args[0])\r\n";
    try { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== ps1) fs.writeFileSync(file, ps1); } catch (e) { this.log('helper write failed', e.message); }
    const c = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = c; let buf = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (ln) this.onLine(ln); } });
    c.stderr.on('data', (d) => this.log('helper:', String(d).trim()));
    c.stdin.on('error', () => {});
    c.on('exit', (code) => {
      if (this.child !== c) return; this.child = null;
      for (const p of this.pending.values()) p({ ok: false, error: 'helper stopped' }); this.pending.clear();
      this.log('desktop helper exited', code);
      if (!this.stopped && this.restarts < 5) { this.restarts++; setTimeout(() => { this.start(); this.emit('restarted'); }, 1500 * this.restarts); }
    });
    this.ready = new Promise((res) => { this._ready = res; setTimeout(res, 15000); });
    this.send(`clicks ${this.opts.clicks ? 1 : 0}`); this.send(`cover ${this.opts.cover ? 1 : 0}`);
  }
  onLine(ln) {
    let m; try { m = JSON.parse(ln); } catch (_) { this.log('helper says', ln); return; }
    if (m.re != null) { const p = this.pending.get(m.re); if (p) { this.pending.delete(m.re); p(m.data || {}); } return; }
    if (m.ev === 'ready') { this.restarts = 0; if (this._ready) this._ready(); return; }
    if (m.ev === 'click') { const pt = this.toDip({ x: m.x, y: m.y }); this.emit('click', { x: pt.x, y: pt.y, button: m.b }); return; }
    if (m.ev === 'cover') { this.emit('cover', (m.mons || []).map((r) => ({ bounds: this.rectToDip({ x: r.x, y: r.y, width: r.w, height: r.h }), covered: !!r.c }))); }
  }
  toDip(p) { try { return this.screen.screenToDipPoint(p); } catch (_) { return p; } }
  rectToDip(r) { try { return this.screen.screenToDipRect(null, r); } catch (_) { return r; } }
  send(line) { if (this.child) try { this.child.stdin.write(line + '\n'); } catch (_) {} }
  call(cmd, rest = '') {
    if (!this.child) this.start();
    const seq = ++this.seq;
    return new Promise((res) => { this.pending.set(seq, res); this.send(`${cmd} ${seq}${rest ? ' ' + rest : ''}`); setTimeout(() => { if (this.pending.has(seq)) { this.pending.delete(seq); res({ ok: false, error: 'timed out' }); } }, 20000); });
  }
  configure(opts) { Object.assign(this.opts, opts); if ('clicks' in opts) this.send(`clicks ${opts.clicks ? 1 : 0}`); if ('cover' in opts) this.send(`cover ${opts.cover ? 1 : 0}`); }
  hwnd(win) { const b = win.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0)); }
  phys(display) { try { return this.screen.dipToScreenRect(null, display.bounds); } catch (_) { return display.bounds; } }
  async attach(win, display) {
    await this.ready;
    const r = this.phys(display);
    const res = await this.call('attach', `${this.hwnd(win)} ${Math.round(r.x)} ${Math.round(r.y)} ${Math.round(r.width)} ${Math.round(r.height)}`);
    if (res.ok) this.mode = res.mode;
    return res;
  }
  async place(win, display) { const r = this.phys(display); return this.call('move', `${this.hwnd(win)} ${Math.round(r.x)} ${Math.round(r.y)} ${Math.round(r.width)} ${Math.round(r.height)}`); }
  forget(win) { try { return this.call('forget', this.hwnd(win)); } catch (_) { return Promise.resolve(); } }
  /** After our windows close: make Explorer repaint the normal wallpaper. */
  restoreDesktop() { return this.child ? this.call('refresh') : Promise.resolve({ ok: true }); }
  async getWallpaper() { const r = await this.call('getwp'); return r.ok ? r.path : null; }
  setWallpaper(p) { return this.call('setwp', Buffer.from(String(p), 'utf8').toString('base64')); }
  stop() { this.stopped = true; const c = this.child; this.child = null; if (c) { try { c.stdin.write('quit\n'); } catch (_) {} setTimeout(() => { try { c.kill(); } catch (_) {} }, 800); } }
}

module.exports = { WinDesktop, CS };

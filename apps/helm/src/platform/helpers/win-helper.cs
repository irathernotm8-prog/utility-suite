// Helm's Windows input helper. Compiled once on the PC (csc.exe from .NET Framework, or PowerShell's Add-Type) into
// helm-input.exe in Helm's data folder. It reads one command per line on stdin, sends real input with SendInput, and
// reports XInput (Xbox-style) controllers on stdout. Keep it C# 5: Windows PowerShell 5.1 compiles with that.
//   m x y              move the pointer to x,y (physical pixels on the virtual desktop)
//   b l|r|m 1|0        mouse button down / up
//   w dy dx            scroll (120 = one notch; dy > 0 shows what's further down)
//   k vk 1|0           key down / up
//   u <base64 utf8>    type text
//   x 1|0              start / stop reporting XInput controllers ("X slot buttons lt rt lx ly rx ry", "XD slot")
//   f                  answer "F pid<TAB>process<TAB>title<TAB>full(0|1)<TAB>path"
//   p                  answer "P"
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class HelmInput
{
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] struct XGAMEPAD { public ushort wButtons; public byte bLeftTrigger; public byte bRightTrigger; public short sThumbLX; public short sThumbLY; public short sThumbRX; public short sThumbRY; }
    [StructLayout(LayoutKind.Sequential)] struct XSTATE { public uint dwPacketNumber; public XGAMEPAD Gamepad; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("xinput1_4.dll", EntryPoint = "#100")] static extern int XInputGetStateEx(int i, out XSTATE s);
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")] static extern int XInputGetState14(int i, out XSTATE s);
    [DllImport("xinput9_1_0.dll", EntryPoint = "XInputGetState")] static extern int XInputGetState910(int i, out XSTATE s);

    const uint MOVE = 0x1, LDOWN = 0x2, LUP = 0x4, RDOWN = 0x8, RUP = 0x10, MDOWN = 0x20, MUP = 0x40, WHEEL = 0x800, HWHEEL = 0x1000, VDESK = 0x4000, ABS = 0x8000;
    const uint KEYUP = 0x2, EXTENDED = 0x1, UNICODE = 0x4;
    static readonly object outLock = new object();
    static TextWriter output;

    static void Say(string s) { lock (outLock) { output.Write(s + "\n"); output.Flush(); } }

    static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
    static INPUT Mouse(int dx, int dy, uint data, uint flags) { INPUT i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags; return i; }
    static bool Extended(int vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || (vk >= 0xAD && vk <= 0xB3); }
    static void Key(int vk, bool down)
    {
        INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = (ushort)vk; i.u.ki.wScan = (ushort)MapVirtualKey((uint)vk, 0);
        i.u.ki.dwFlags = (down ? 0 : KEYUP) | (Extended(vk) ? EXTENDED : 0); Send(i);
    }
    static void Text(string s)
    {
        foreach (char c in s)
        {
            if (c == '\n') { Key(0x0D, true); Key(0x0D, false); continue; }
            INPUT a = new INPUT(); a.type = 1; a.u.ki.wScan = c; a.u.ki.dwFlags = UNICODE; Send(a);
            INPUT b = new INPUT(); b.type = 1; b.u.ki.wScan = c; b.u.ki.dwFlags = UNICODE | KEYUP; Send(b);
        }
    }
    static void MoveTo(double x, double y)
    {
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        if (vw < 2 || vh < 2) return;
        int nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1)), ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
        Send(Mouse(nx, ny, 0, MOVE | ABS | VDESK));
    }
    static void Button(string b, bool down)
    {
        uint f = b == "r" ? (down ? RDOWN : RUP) : b == "m" ? (down ? MDOWN : MUP) : (down ? LDOWN : LUP);
        Send(Mouse(0, 0, 0, f));
    }
    static void Wheel(int dy, int dx)
    {
        if (dy != 0) Send(Mouse(0, 0, unchecked((uint)(-dy)), WHEEL));
        if (dx != 0) Send(Mouse(0, 0, unchecked((uint)dx), HWHEEL));
    }
    static string Front()
    {
        IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return "F ";
        uint pid; GetWindowThreadProcessId(h, out pid);
        StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
        StringBuilder cls = new StringBuilder(256); GetClassName(h, cls, 256);
        string name = "", path = "";
        try { Process p = Process.GetProcessById((int)pid); name = p.ProcessName; try { path = p.MainModule.FileName; } catch (Exception) { } } catch (Exception) { }
        bool full = false;
        string c = cls.ToString();
        if (c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd")
        {
            RECT r; MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (GetWindowRect(h, out r) && GetMonitorInfo(MonitorFromWindow(h, 2), ref mi))
                full = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
        }
        return "F " + pid + "\t" + name + "\t" + t.ToString().Replace("\t", " ") + "\t" + (full ? "1" : "0") + "\t" + path;
    }

    // ---------------------------------------------------------------- XInput
    static volatile bool polling = false;
    static int xapi = 0; // 0 GetStateEx (has the guide button), 1 xinput1_4, 2 xinput9_1_0, -1 none
    static int GetState(int i, out XSTATE s)
    {
        s = new XSTATE();
        try
        {
            if (xapi == 0) return XInputGetStateEx(i, out s);
            if (xapi == 1) return XInputGetState14(i, out s);
            if (xapi == 2) return XInputGetState910(i, out s);
        }
        catch (Exception) { xapi = xapi == 2 ? -1 : xapi + 1; return GetState(i, out s); }
        return 1167;
    }
    static void Poll()
    {
        uint[] last = new uint[4]; bool[] on = new bool[4]; long[] nextCheck = new long[4];
        Stopwatch sw = Stopwatch.StartNew();
        while (polling)
        {
            long now = sw.ElapsedMilliseconds;
            for (int i = 0; i < 4; i++)
            {
                if (!on[i] && now < nextCheck[i]) continue;
                XSTATE s; int r = GetState(i, out s);
                if (r != 0)
                {
                    if (on[i]) { on[i] = false; Say("XD " + i); }
                    nextCheck[i] = now + 1500; continue;
                }
                if (!on[i] || s.dwPacketNumber != last[i])
                {
                    on[i] = true; last[i] = s.dwPacketNumber; XGAMEPAD g = s.Gamepad;
                    Say("X " + i + " " + g.wButtons + " " + g.bLeftTrigger + " " + g.bRightTrigger + " " + g.sThumbLX + " " + g.sThumbLY + " " + g.sThumbRX + " " + g.sThumbRY);
                }
            }
            Thread.Sleep(4);
        }
    }

    public static void Main()
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
        output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        TextReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        Say("READY 1");
        string line;
        while ((line = input.ReadLine()) != null)
        {
            try
            {
                string[] a = line.Split(' ');
                switch (a[0])
                {
                    case "m": MoveTo(double.Parse(a[1], System.Globalization.CultureInfo.InvariantCulture), double.Parse(a[2], System.Globalization.CultureInfo.InvariantCulture)); break;
                    case "b": Button(a[1], a[2] == "1"); break;
                    case "w": Wheel(int.Parse(a[1]), int.Parse(a[2])); break;
                    case "k": Key(int.Parse(a[1]), a[2] == "1"); break;
                    case "u": Text(Encoding.UTF8.GetString(Convert.FromBase64String(a[1]))); break;
                    case "x":
                        if (a[1] == "1" && !polling) { polling = true; Thread t = new Thread(Poll); t.IsBackground = true; t.Start(); }
                        else if (a[1] == "0") polling = false;
                        break;
                    case "f": Say(Front()); break;
                    case "p": Say("P"); break;
                    case "q": return;
                }
            }
            catch (Exception e) { Say("E " + e.Message.Replace("\n", " ")); }
        }
    }
}

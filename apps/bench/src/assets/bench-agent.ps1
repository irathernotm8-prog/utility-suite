# Bench agent: runs inside Windows Sandbox (started by the sandbox's logon command) and answers Bench through the
# shared folder C:\Bench. Bench drops a job in C:\Bench\in\<id>.json; the agent writes C:\Bench\out\<id>.json
# (and <id>.png for screenshots). Jobs: screenshot, click, move, button, drag, scroll, type, key, run, launch,
# install, windows, copyout, shutdown. Commands run in the background so screenshots keep flowing.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$In = Join-Path $Root 'in'; $Out = Join-Path $Root 'out'
New-Item -ItemType Directory -Force -Path $In, $Out, (Join-Path $Out 'files') | Out-Null
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BenchInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  public static void Unicode(string s) {
    foreach (char c in s) {
      INPUT[] a = new INPUT[2];
      a[0].type = 1; a[0].U.ki.wScan = c; a[0].U.ki.dwFlags = 4;
      a[1].type = 1; a[1].U.ki.wScan = c; a[1].U.ki.dwFlags = 4 | 2;
      SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(6);
    }
  }
  public static void Key(byte vk, bool up) {
    uint f = up ? 2u : 0u;
    if (vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24 || vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || vk == 0x2D || vk == 0x2E || vk == 0x5B) f |= 1;
    keybd_event(vk, 0, f, UIntPtr.Zero);
  }
}
"@
[BenchInput]::SetProcessDPIAware() | Out-Null

function Now { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Screen { [System.Windows.Forms.SystemInformation]::VirtualScreen }
function Reply($id, $obj) {
  $tmp = Join-Path $Out ("$id.tmp"); $dst = Join-Path $Out ("$id.json")
  [IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Depth 8 -Compress), (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -Force -Path $tmp -Destination $dst
}
function Shot($id, $maxSide, $fmt) {
  $b = Screen; $bmp = $null; $g = $null; $small = $null
  try {
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $scale = 1.0; $out = $bmp
    if ($maxSide -gt 0 -and [Math]::Max($b.Width, $b.Height) -gt $maxSide) {
      $scale = [Math]::Max($b.Width, $b.Height) / $maxSide
      $small = New-Object System.Drawing.Bitmap $bmp, ([int]($b.Width / $scale)), ([int]($b.Height / $scale)); $out = $small
    }
    $ext = if ($fmt -eq 'jpeg') { 'jpg' } else { 'png' }
    $file = Join-Path $Out ("$id.$ext")
    if ($fmt -eq 'jpeg') { $out.Save($file, [System.Drawing.Imaging.ImageFormat]::Jpeg) } else { $out.Save($file, [System.Drawing.Imaging.ImageFormat]::Png) }
    return @{ file = (Split-Path -Leaf $file); width = $out.Width; height = $out.Height; scale = $scale; screenW = $b.Width; screenH = $b.Height }
  } finally {
    if ($g) { $g.Dispose() }; if ($small) { $small.Dispose() }; if ($bmp) { $bmp.Dispose() }
  }
}
$Flags = @{ left = @(0x2, 0x4); right = @(0x8, 0x10); middle = @(0x20, 0x40) }
function Click($j) {
  $b = Screen; [BenchInput]::SetCursorPos([int]$j.x + $b.Left, [int]$j.y + $b.Top) | Out-Null; Start-Sleep -Milliseconds 30
  $btn = if ($j.button) { $j.button } else { 'left' }; $n = if ($j.count) { [int]$j.count } else { 1 }
  for ($i = 0; $i -lt $n; $i++) { [BenchInput]::mouse_event($Flags[$btn][0], 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [BenchInput]::mouse_event($Flags[$btn][1], 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60 }
  return $true
}
function Drag($j) {
  $b = Screen; [BenchInput]::SetCursorPos([int]$j.x1 + $b.Left, [int]$j.y1 + $b.Top) | Out-Null; Start-Sleep -Milliseconds 40
  [BenchInput]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
  for ($i = 1; $i -le 14; $i++) { [BenchInput]::SetCursorPos([int]($j.x1 + ($j.x2 - $j.x1) * $i / 14) + $b.Left, [int]($j.y1 + ($j.y2 - $j.y1) * $i / 14) + $b.Top) | Out-Null; Start-Sleep -Milliseconds 16 }
  [BenchInput]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero); return $true
}
function Keys($j) {
  $mods = @($j.mods | Where-Object { $_ -ne $null })
  foreach ($m in $mods) { [BenchInput]::Key([byte]$m, $false); Start-Sleep -Milliseconds 15 }
  $times = if ($j.repeat) { [int]$j.repeat } else { 1 }
  for ($i = 0; $i -lt $times; $i++) {
    if ($j.vk) { [BenchInput]::Key([byte]$j.vk, $false); Start-Sleep -Milliseconds 20; [BenchInput]::Key([byte]$j.vk, $true) } else { [BenchInput]::Unicode([string]$j.char) }
    Start-Sleep -Milliseconds 20
  }
  if ($mods.Count -gt 1) { [array]::Reverse($mods) }; foreach ($m in $mods) { [BenchInput]::Key([byte]$m, $true) }
  return $true
}
$Running = @{}
function KillTree($p) { try { & taskkill.exe /T /F /PID $p.Id 2>$null | Out-Null } catch {}; try { if (-not $p.HasExited) { $p.Kill() } } catch {} }
function StartRun($j) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  if ($j.shell -eq 'powershell') { $psi.FileName = 'powershell.exe'; $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$j.command)) }
  else { $psi.FileName = 'cmd.exe'; $psi.Arguments = '/d /s /c "' + $j.command + '"' }
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = if ($j.cwd) { $j.cwd } else { $env:USERPROFILE }
  $p = [System.Diagnostics.Process]::Start($psi)
  try { $p.StandardInput.Close() } catch {}
  $Running[$j.id] = @{ kind = 'run'; p = $p; o = $p.StandardOutput.ReadToEndAsync(); e = $p.StandardError.ReadToEndAsync(); deadline = (Now) + [int64]$j.timeoutMs; start = (Now); exitedAt = $null }
}
function CheckRunning {
  foreach ($id in @($Running.Keys)) {
    $r = $Running[$id]; $done = $r.p.HasExited; $late = (Now) -gt $r.deadline
    if (-not $done -and -not $late) { continue }
    if ($late -and -not $done) { KillTree $r.p; $r.killed = $true }
    if ($r.kind -eq 'msi') {
      $code = $null; try { $code = $r.p.ExitCode } catch {}
      $msg = if ($r.killed) { "The installer didn't finish in time and was stopped" } elseif ($code -eq 0 -or $code -eq 3010) { "Installed $($r.name)" } else { "The installer failed (code $code)" }
      Reply $id @{ ok = ($code -eq 0 -or $code -eq 3010); result = $msg; error = $msg }; $Running.Remove($id); continue
    }
    # output pipes stay open while a child the command started is still alive: never block on them
    if (-not $r.exitedAt) { $r.exitedAt = Now }
    $streamsDone = $r.o.IsCompleted -and $r.e.IsCompleted
    if (-not $streamsDone -and ((Now) - $r.exitedAt) -lt 2000) { continue }
    $out = ''
    if ($r.o.IsCompleted) { try { $out += $r.o.Result } catch {} }
    if ($r.e.IsCompleted) { try { $out += $r.e.Result } catch {} }
    if (-not $streamsDone) { $out += "`n(Bench: something the command started is still running, so its later output isn't shown)" }
    $code = $null; if ($done) { try { $code = $r.p.ExitCode } catch {} }
    Reply $id @{ ok = $true; result = @{ code = $code; timedOut = [bool]$r.killed; output = $out; ms = (Now) - $r.start } }
    $Running.Remove($id)
  }
}
function Install($j) {
  $src = [string]$j.path; $name = [IO.Path]::GetFileNameWithoutExtension($src); $desk = [Environment]::GetFolderPath('Desktop')
  if ($src -match '\.zip$') {
    $dest = Join-Path $desk $name; Expand-Archive -Force -LiteralPath $src -DestinationPath $dest
    $exe = Get-ChildItem -LiteralPath $dest -Recurse -Filter '*.exe' | Where-Object { $_.Name -notmatch 'unins|update|crash|helper' } | Sort-Object { $_.FullName.Length } | Select-Object -First 1
    if ($exe) { Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.DirectoryName; return "Unzipped to $dest and opened $($exe.Name)" }
    return "Unzipped to $dest"
  }
  if ($src -match '\.msi$') {
    # runs in the background (like commands) so screenshots and clicks keep working while it installs
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$src`" /qb /norestart" -PassThru
    $Running[$j.id] = @{ kind = 'msi'; p = $p; name = $name; deadline = (Now) + 900000; start = (Now) }
    return '__async__'
  }
  Start-Process -FilePath $src; return "Opened $name"
}
function Quote($a) { ($a | ForEach-Object { '"' + ([string]$_ -replace '"', '\"') + '"' }) -join ' ' }
function Handle($j) {
  switch ($j.op) {
    'ping' { return @{ pong = $true } }
    'screenshot' { return Shot $j.id ([int]$j.maxSide) $j.fmt }
    'click' { return Click $j }
    'move' { $b = Screen; [BenchInput]::SetCursorPos([int]$j.x + $b.Left, [int]$j.y + $b.Top) | Out-Null; return $true }
    'button' { $b = Screen; [BenchInput]::SetCursorPos([int]$j.x + $b.Left, [int]$j.y + $b.Top) | Out-Null; $btn = if ($j.button) { $j.button } else { 'left' }; [BenchInput]::mouse_event($Flags[$btn][$(if ($j.down) { 0 } else { 1 })], 0, 0, 0, [UIntPtr]::Zero); return $true }
    'drag' { return Drag $j }
    'scroll' {
      $b = Screen; [BenchInput]::SetCursorPos([int]$j.x + $b.Left, [int]$j.y + $b.Top) | Out-Null
      if ($j.dy) { [BenchInput]::mouse_event(0x800, 0, 0, [int](-[double]$j.dy * 1.2), [UIntPtr]::Zero) }
      if ($j.dx) { [BenchInput]::mouse_event(0x1000, 0, 0, [int]([double]$j.dx * 1.2), [UIntPtr]::Zero) }
      return $true
    }
    'type' { [BenchInput]::Unicode([string]$j.text); return $true }
    'key' { return Keys $j }
    'run' { StartRun $j; return '__async__' }
    'launch' { $a = @{ FilePath = [string]$j.path }; if ($j.args) { $a.ArgumentList = (Quote $j.args) }; if ($j.cwd) { $a.WorkingDirectory = $j.cwd }; Start-Process @a; return $true }
    'install' { return Install $j }
    'windows' { return @(Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { @{ pid = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle } }) }
    'copyout' { $dest = Join-Path (Join-Path $Out 'files') $j.id; New-Item -ItemType Directory -Force -Path $dest | Out-Null; Copy-Item -Recurse -Force -LiteralPath ([string]$j.path) -Destination $dest; return @{ folder = $j.id } }
    'shutdown' { Reply $j.id @{ ok = $true; result = $true }; Stop-Computer -Force; return '__async__' }
    default { throw "Unknown job $($j.op)" }
  }
}

$lastBeat = 0; $beat = 0
while ($true) {
  try {
    if ((Now) - $lastBeat -gt 1000) {
      $lastBeat = Now; $beat++; $b = Screen
      try { [IO.File]::WriteAllText((Join-Path $Root 'agent.json'), (@{ ready = $true; t = $lastBeat; beat = $beat; version = 2; pid = $PID; width = $b.Width; height = $b.Height; running = $Running.Count } | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false))) } catch {}
    }
    foreach ($f in @(Get-ChildItem -Path $In -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)) {
      $j = $null; $jid = [IO.Path]::GetFileNameWithoutExtension($f.Name)
      try { $j = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json }
      catch { try { Move-Item -Force -LiteralPath $f.FullName -Destination ($f.FullName + '.bad') } catch {}; try { Reply $jid @{ ok = $false; error = "Bench's helper couldn't read that job: $($_.Exception.Message)" } } catch {}; continue }
      try { Remove-Item -Force -LiteralPath $f.FullName } catch {}
      try { $r = Handle $j; if (-not ($r -is [string] -and $r -eq '__async__')) { Reply $j.id @{ ok = $true; result = $r } } }
      catch { try { Reply $j.id @{ ok = $false; error = $_.Exception.Message } } catch {} }
    }
    CheckRunning
  } catch {}
  Start-Sleep -Milliseconds 60
}

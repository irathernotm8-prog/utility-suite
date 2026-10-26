// Atoll — Now Playing on Windows, through the same system media controls as the volume flyout
// (GlobalSystemMediaTransportControlsSessionManager). That covers Spotify, Apple Music, Media Player, browsers
// (YouTube, SoundCloud…) and anything else that reports what it plays. One PowerShell stays open, so polls are fast.
'use strict';
const { ps } = require('../../platform/run');

// Volume: Core Audio through a tiny C# class (same approach as Scene's SceneAudio). C# 5 only — Windows PowerShell 5.1.
const CS = `
using System; using System.Runtime.InteropServices;
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAtollEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, ref Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAtollMMDevice { int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface); }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAtollMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IAtollMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class AtollMMDeviceEnumerator { }
public static class AtollAudio {
  static IAtollEndpointVolume Vol() {
    IAtollMMDeviceEnumerator en = (IAtollMMDeviceEnumerator)(new AtollMMDeviceEnumerator());
    IAtollMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    Guid iid = typeof(IAtollEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAtollEndpointVolume)o;
  }
  public static string Get() { IAtollEndpointVolume v = Vol(); float f; bool m; v.GetMasterVolumeLevelScalar(out f); v.GetMute(out m); return ((int)Math.Round(f * 100)).ToString() + "," + (m ? "true" : "false"); }
  public static void Set(int pct) { Guid g = Guid.Empty; Vol().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref g); }
  public static void Mute(bool on) { Guid g = Guid.Empty; Vol().SetMute(on, ref g); }
}`;

const PRELUDE = `
if (-not $global:AtollReady) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $global:AtollAsTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function global:AtollAwait($op, [Type]$t) { $task = $global:AtollAsTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(5000); $task.Result }
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $global:AtollMgr = AtollAwait ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  if (-not ('AtollAudio' -as [type])) { Add-Type -TypeDefinition @'
${CS}
'@ }
  $global:AtollReady = $true
}
function global:AtollSession {
  $all = @($global:AtollMgr.GetSessions())
  $playing = $all | Where-Object { [string]$_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
  if ($playing) { return $playing }
  $cur = $global:AtollMgr.GetCurrentSession(); if ($cur) { return $cur }
  return ($all | Select-Object -First 1)
}
`;

const POLL = `
$s = AtollSession
if ($null -eq $s) { '{"none":true}' } else {
  $p = AtollAwait ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $pb = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
  [pscustomobject]@{
    app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
    state = [string]$pb.PlaybackStatus; position = $tl.Position.TotalSeconds; duration = ($tl.EndTime - $tl.StartTime).TotalSeconds
    updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds(); hasArt = ($null -ne $p.Thumbnail)
    canNext = $pb.Controls.IsNextEnabled; canPrev = $pb.Controls.IsPreviousEnabled; canSeek = $pb.Controls.IsPlaybackPositionEnabled
    sessions = @($global:AtollMgr.GetSessions()).Count
  } | ConvertTo-Json -Compress
}`;

const call = (script, timeout = 8000) => ps(PRELUDE + script, { shell: 'media', timeout });

/** Friendly name for a media session's app id. */
function appName(aumid = '') {
  const s = String(aumid).toLowerCase();
  const known = [[/spotify/, 'Spotify'], [/applemusic|appleinc\.apple/, 'Apple Music'], [/zunemusic|mediaplayer/, 'Media Player'], [/chrome/, 'Chrome'], [/msedge|microsoftedge/, 'Edge'], [/firefox/, 'Firefox'],
    [/brave/, 'Brave'], [/opera/, 'Opera'], [/arc\b|thebrowsercompany/, 'Arc'], [/vlc/, 'VLC'], [/itunes/, 'iTunes'], [/tidal/, 'TIDAL'], [/deezer/, 'Deezer'], [/amazon/, 'Amazon Music'], [/youtube/, 'YouTube Music'], [/crate/, 'Crate']];
  for (const [re, n] of known) if (re.test(s)) return n;
  const base = String(aumid).split('!')[0].split('\\').pop().replace(/\.exe$/i, '').replace(/_[a-z0-9]{13}$/i, '');
  const last = base.split('.').pop() || 'Media';
  return last.charAt(0).toUpperCase() + last.slice(1);
}

async function poll() {
  const r = await call(POLL);
  if (!r.ok) return [{ error: r.error || 'media unavailable' }];
  const line = (r.stdout.split('\n').find((l) => /^\s*\{/.test(l)) || '').trim();
  let v; try { v = JSON.parse(line); } catch { return []; }
  if (!v || v.none) return [];
  const state = /playing/i.test(v.state) ? 'playing' : /paused/i.test(v.state) ? 'paused' : /stopped|closed/i.test(v.state) ? 'stopped' : 'paused';
  // the timeline position is as of `updated`; while playing, move it on to now
  let position = Number(v.position) || 0;
  if (state === 'playing' && v.updated > 0) position += Math.max(0, (Date.now() - v.updated) / 1000);
  const duration = Number(v.duration) || 0;
  if (duration) position = Math.min(position, duration);
  return [{ player: appName(v.app), app: v.app, state, title: v.title || '', artist: v.artist || '', album: v.album || '', duration, position, hasArt: !!v.hasArt, id: `${v.app}|${v.title}|${v.artist}`, canNext: v.canNext !== false, canPrev: v.canPrev !== false, canSeek: !!v.canSeek }];
}

async function command(_player, cmd, value) {
  const op = {
    toggle: 'TryTogglePlayPauseAsync()', play: 'TryPlayAsync()', pause: 'TryPauseAsync()', next: 'TrySkipNextAsync()', prev: 'TrySkipPreviousAsync()',
    seek: `TryChangePlaybackPositionAsync([long](${Math.max(0, Number(value) || 0)} * 10000000))`,
    shuffle: 'TryChangeShuffleActiveAsync(-not [bool]$s.GetPlaybackInfo().IsShuffleActive)'
  }[cmd];
  if (!op) return { ok: false };
  return call(`$s = AtollSession; if ($s) { [void](AtollAwait ($s.${op}) ([bool])) }; 'ok'`);
}

/** The current session's thumbnail, written to `file`. */
async function art(file) {
  const f = String(file).replace(/'/g, "''");
  const r = await call(`
$s = AtollSession; $done = 'none'
if ($s) {
  $p = AtollAwait ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ($p.Thumbnail) {
    $st = AtollAwait ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $ns = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
    $fs = [System.IO.File]::Create('${f}'); $ns.CopyTo($fs); $fs.Close(); $ns.Close(); $done = 'ok'
  }
}
$done`, 10000);
  return r.ok && /ok/.test(r.stdout);
}

async function getVolume() {
  const r = await call('[AtollAudio]::Get()');
  const m = r.stdout.match(/(\d+),(true|false)/); return m ? { volume: Number(m[1]), muted: m[2] === 'true' } : { volume: null, muted: null };
}
const setVolume = (v) => call(`[AtollAudio]::Set(${Math.round(Number(v) || 0)}); 'ok'`);
const setMute = (m) => call(`[AtollAudio]::Mute($${m ? 'true' : 'false'}); 'ok'`);

module.exports = { poll, command, art, getVolume, setVolume, setMute, appName, PRELUDE, POLL, CS };

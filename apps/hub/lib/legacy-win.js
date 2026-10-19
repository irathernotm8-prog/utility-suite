'use strict';
// Windows only: find and remove copies of the apps that weren't installed by the hub —
// versions installed with an app's own Setup .exe (Settings > Apps), portable .exes,
// unzipped app folders, old setup files and unzipped suite downloads.
const path = require('path');
const fs = require('./fsx');
const { run, powershell, powershellJSON, waitFor, psQuote } = require('./sys');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRe = (name) => new RegExp(`^${escapeRe(name)}(\\s+[\\d.]+.*)?$`, 'i');

async function findSeparateInstalls(metas, publisher) {
  const rows = await powershellJSON(`
    $keys = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -and $_.UninstallString } |
      Select-Object PSChildName, PSPath, DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, QuietUninstallString |
      ConvertTo-Json -Compress`);
  const out = [];
  for (const r of rows) {
    if (['UtilityHub', 'UtilitySuite'].includes(r.PSChildName)) continue;
    for (const m of metas) {
      if (!nameRe(m.name).test(r.DisplayName)) continue;
      const ours = r.Publisher === publisher || new RegExp(`Uninstall ${escapeRe(m.name)}\\.exe`, 'i').test(r.UninstallString);
      if (!ours) continue;
      const { exe, args } = parseCommand(r.QuietUninstallString || r.UninstallString);
      out.push({
        id: m.id, displayName: r.DisplayName, displayVersion: r.DisplayVersion || null, key: r.PSPath,
        installLocation: r.InstallLocation || (exe ? path.dirname(exe) : null), uninstallExe: exe, args,
        allUsers: /HKEY_LOCAL_MACHINE/i.test(r.PSPath),
      });
    }
  }
  return out;
}

function parseCommand(cmd) {
  if (!cmd) return { exe: null, args: '' };
  let exe, args;
  const m = cmd.match(/^\s*"([^"]+)"\s*(.*)$/);
  if (m) { exe = m[1]; args = m[2]; }
  else { const i = cmd.toLowerCase().indexOf('.exe'); exe = cmd.slice(0, i + 4).trim(); args = cmd.slice(i + 4).trim(); }
  if (!/(^|\s)\/S(\s|$)/.test(args)) args = `${args} /S`.trim();
  return { exe, args };
}

const keyExists = async (key) => (await powershell(`if (Test-Path -LiteralPath ${psQuote(key)}) { 'yes' }`, { allowFail: true })).stdout.includes('yes');

async function uninstallSeparate(item) {
  if (!item.uninstallExe || !fs.existsSync(item.uninstallExe)) {
    // files are already gone; clear the leftover Settings > Apps entry
    await powershell(`Remove-Item -LiteralPath ${psQuote(item.key)} -Recurse -Force -ErrorAction SilentlyContinue`, { allowFail: true });
    return;
  }
  const verb = item.allUsers ? ' -Verb RunAs' : '';
  const argList = item.args ? ` -ArgumentList ${psQuote(item.args)}` : '';
  await powershell(`Start-Process -FilePath ${psQuote(item.uninstallExe)}${argList}${verb} -Wait`, { allowFail: true });
  // NSIS uninstallers hand off to a temp copy and return early; wait for the entry to go away
  const gone = await waitFor(async () => !(await keyExists(item.key)), 90000, 1000);
  if (!gone) throw new Error(`${item.displayName} didn't finish uninstalling. Remove it in Settings > Apps, then try again.`);
}

async function findLooseCopies(metas, publisher, skipRoots) {
  const names = metas.map((m) => m.name);
  const script = `
    $names = ${psQuote(JSON.stringify(names))} | ConvertFrom-Json
    $publisher = ${psQuote(publisher || '')}
    $skip = (${psQuote(JSON.stringify(skipRoots.filter(Boolean)))} | ConvertFrom-Json) | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\\') + '\\' }
    $roots = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), (Join-Path $env:USERPROFILE 'Downloads')) |
      Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
    $out = @()
    foreach ($dir in $roots) {
      Get-ChildItem -Path $dir -Filter *.exe -File -Recurse -Depth 4 -ErrorAction SilentlyContinue | ForEach-Object {
        $full = $_.FullName
        foreach ($s in $skip) { if ($full.StartsWith($s, [StringComparison]::OrdinalIgnoreCase)) { return } }
        if ($_.Attributes -band 0x441000) { return }   # OneDrive online-only: don't download it
        $vi = $_.VersionInfo
        if ($names -notcontains $vi.ProductName) { return }
        $folder = $_.Directory.FullName
        $unpacked = Test-Path (Join-Path $folder 'resources\\app.asar')
        $byUs = ($vi.CompanyName -eq $publisher) -or ($vi.LegalCopyright -match [regex]::Escape($publisher)) -or $unpacked
        if (-not $byUs) { return }
        if ($unpacked) {
          if ($_.BaseName -ne $vi.ProductName) { return }
          $suiteDir = Split-Path -Parent (Split-Path -Parent $folder)
          if ((Test-Path (Join-Path $suiteDir 'suite-info.json')) -or (Test-Path (Join-Path $suiteDir 'Packages\\catalog.json'))) {
            $out += [pscustomobject]@{ name = 'Utility Suite download'; kind = 'old suite download'; path = $suiteDir }
          } else {
            $out += [pscustomobject]@{ name = $vi.ProductName; kind = 'unzipped app folder'; path = $folder }
          }
        } else {
          $kind = if ($_.Name -match 'setup|install') { 'old setup file' } else { 'portable copy' }
          $out += [pscustomobject]@{ name = $vi.ProductName; kind = $kind; path = $full }
        }
      }
    }
    $out | Sort-Object path -Unique | ConvertTo-Json -Compress`;
  return powershellJSON(script);
}

async function unblock(dir) {
  await powershell(`Get-ChildItem -LiteralPath ${psQuote(dir)} -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue`, { allowFail: true });
}

// key like 'HKCU:\Software\...\Uninstall\UtilityHub'
async function regSet(key, values) {
  const lines = [`New-Item -Path ${psQuote(key)} -Force | Out-Null`];
  for (const [name, v] of Object.entries(values)) {
    lines.push(typeof v === 'number'
      ? `New-ItemProperty -Path ${psQuote(key)} -Name ${psQuote(name)} -Value ${v} -PropertyType DWord -Force | Out-Null`
      : `New-ItemProperty -Path ${psQuote(key)} -Name ${psQuote(name)} -Value ${psQuote(v)} -PropertyType String -Force | Out-Null`);
  }
  await powershell(lines.join('\n'), { allowFail: true });
}
const regDelete = (key) => powershell(`Remove-Item -Path ${psQuote(key)} -Recurse -Force -ErrorAction SilentlyContinue`, { allowFail: true });

module.exports = { findSeparateInstalls, uninstallSeparate, findLooseCopies, unblock, parseCommand, nameRe, regSet, regDelete };

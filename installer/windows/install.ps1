# Installs every app in .\apps for the current user (no admin rights needed):
#   %LOCALAPPDATA%\Programs\<Suite>\<App>\  + Start Menu folder + optional desktop shortcuts
#   + an entry in Settings > Apps so it can be uninstalled normally.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$info = Get-Content -Raw -Path (Join-Path $here 'suite-info.json') | ConvertFrom-Json
$suite = $info.suiteName
$root = Join-Path $env:LOCALAPPDATA "Programs\$suite"
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$suite"
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

Write-Host ""
Write-Host "$suite $($info.version)" -ForegroundColor Cyan
Write-Host "Installing to $root"
Write-Host ""
$makeDesktop = (Read-Host "Add desktop shortcuts too? (Y/n)") -notmatch '^[nN]'

function Close-App($app) {
  $procName = [IO.Path]::GetFileNameWithoutExtension($app.exe)
  $running = Get-Process -Name $procName -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host "  Closing $($app.name)..."
    $running | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    Start-Sleep -Seconds 3
    Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force
  }
}

# ---------------------------------------------------------------------------
# Remove older copies of these apps that weren't installed by this suite:
#   1. versions installed with an app's own Setup .exe (listed in Settings > Apps)
#   2. loose copies: portable .exe files, unzipped app folders and old setup files
#      in Downloads, Desktop and Documents (sent to the Recycle Bin, not deleted)
#   3. shortcuts left pointing at copies that no longer exist
# App data (settings, accounts, vaults) lives in %APPDATA% and is never touched.
# ---------------------------------------------------------------------------
$appNames = @($info.apps | ForEach-Object { $_.name })
$skipRoots = @($here, $root) | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' }
function Test-Skipped($p) {
  $full = [IO.Path]::GetFullPath($p)
  foreach ($s in $skipRoots) { if ($full.StartsWith($s, [StringComparison]::OrdinalIgnoreCase)) { return $true } }
  return $false
}

# 1. Installed versions (per-user and all-users registrations)
$installed = @()
$uninstallKeys = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($k in $uninstallKeys) {
  Get-ChildItem -Path $k -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
    if (-not $p -or -not $p.DisplayName -or -not $p.UninstallString) { return }
    if ($_.PSChildName -eq ($suite -replace '\s', '')) { return }   # this suite's own entry
    foreach ($app in $info.apps) {
      $nameMatch = $p.DisplayName -match ('^' + [regex]::Escape($app.name) + '(\s+[\d.]+.*)?$')
      $ours = ($p.Publisher -eq $info.publisher) -or ($p.UninstallString -match ('Uninstall ' + [regex]::Escape($app.name) + '\.exe'))
      if ($nameMatch -and $ours) {
        $installed += [pscustomobject]@{
          App = $app; Name = $p.DisplayName; Version = $p.DisplayVersion; KeyPath = $_.PSPath
          Quiet = $p.QuietUninstallString; Command = $p.UninstallString; AllUsers = $k.StartsWith('HKLM')
        }
      }
    }
  }
}

# 2. Loose copies in the usual places
$loose = @()
$searchRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('MyDocuments'),
  (Join-Path $env:USERPROFILE 'Downloads')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
foreach ($dir in $searchRoots) {
  Get-ChildItem -Path $dir -Filter *.exe -File -Recurse -Depth 4 -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-Skipped $_.FullName) { return }
    if ($_.Attributes -band 0x441000) { return }   # OneDrive online-only file: don't trigger a download
    $vi = $_.VersionInfo
    if ($appNames -notcontains $vi.ProductName) { return }
    $folder = $_.Directory.FullName
    $isUnpacked = Test-Path (Join-Path $folder 'resources\app.asar')
    $byUs = ($vi.CompanyName -eq $info.publisher) -or ($vi.LegalCopyright -match [regex]::Escape($info.publisher)) -or $isUnpacked
    if (-not $byUs) { return }
    if ($isUnpacked) {
      if ($_.BaseName -ne $vi.ProductName) { return }    # only the main exe of an unzipped app folder
      $suiteDir = Split-Path -Parent (Split-Path -Parent $folder)
      if (Test-Path (Join-Path $suiteDir 'suite-info.json')) {
        $loose += [pscustomobject]@{ Name = $suite; Kind = 'older suite download'; Path = $suiteDir; IsFolder = $true }
      } else {
        $loose += [pscustomobject]@{ Name = $vi.ProductName; Kind = 'unzipped app folder'; Path = $folder; IsFolder = $true }
      }
    } else {
      $kind = if ($_.Name -match 'setup|install') { 'old setup file' } else { 'portable copy' }
      $loose += [pscustomobject]@{ Name = $vi.ProductName; Kind = $kind; Path = $_.FullName; IsFolder = $false }
    }
  }
}
$loose = @($loose | Sort-Object Path -Unique)

if ($installed.Count -or $loose.Count) {
  Write-Host ""
  Write-Host "Found older copies of these apps on this PC:" -ForegroundColor Yellow
  foreach ($i in $installed) { Write-Host "  [installed]  $($i.Name) $($i.Version)$(if ($i.AllUsers) { '  (all users - Windows will ask for permission)' })" }
  foreach ($l in $loose) { Write-Host "  [$($l.Kind)]  $($l.Path)" }
  Write-Host ""
  Write-Host "Installed versions will be uninstalled; loose copies go to the Recycle Bin."
  Write-Host "Your settings, accounts and files are kept."
  $doClean = (Read-Host "Remove them before installing? (Y/n)") -notmatch '^[nN]'

  if ($doClean) {
    Add-Type -AssemblyName Microsoft.VisualBasic
    foreach ($app in $info.apps) { Close-App $app }

    foreach ($i in $installed) {
      try {
        $cmd = if ($i.Quiet) { $i.Quiet } else { "$($i.Command) /S" }
        if ($cmd -notmatch '(^|\s)/S(\s|$)') { $cmd += ' /S' }
        if ($cmd -match '^\s*"([^"]+)"\s*(.*)$') { $exe = $Matches[1]; $uargs = $Matches[2] }
        else { $exe = ($cmd -split '\.exe', 2)[0] + '.exe'; $uargs = ($cmd -split '\.exe', 2)[1].Trim() }
        if (-not (Test-Path $exe)) {
          Remove-Item -Path $i.KeyPath -Force -ErrorAction SilentlyContinue    # stale entry, files already gone
          Write-Host "  [OK] Cleared stale entry for $($i.Name)" -ForegroundColor Green
          continue
        }
        Write-Host "  Uninstalling $($i.Name)..."
        if ($i.AllUsers) { Start-Process -FilePath $exe -ArgumentList $uargs -Verb RunAs -Wait | Out-Null }
        else { Start-Process -FilePath $exe -ArgumentList $uargs -Wait | Out-Null }
        # NSIS uninstallers hand off to a temp copy and return early: wait for the entry to go away
        $deadline = (Get-Date).AddSeconds(90)
        while ((Test-Path $i.KeyPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
        if (Test-Path $i.KeyPath) { Write-Host "  [!] $($i.Name) may not have fully uninstalled - check Settings > Apps." -ForegroundColor Yellow }
        else { Write-Host "  [OK] Uninstalled $($i.Name)" -ForegroundColor Green }
      } catch {
        Write-Host "  [!] Couldn't uninstall $($i.Name): $($_.Exception.Message)" -ForegroundColor Yellow
      }
    }

    foreach ($l in $loose) {
      try {
        if (-not (Test-Path $l.Path)) { continue }
        if ($l.IsFolder) {
          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($l.Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
        } else {
          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($l.Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
        }
        Write-Host "  [OK] Recycled $($l.Path)" -ForegroundColor Green
      } catch {
        Write-Host "  [!] Couldn't move $($l.Path) to the Recycle Bin: $($_.Exception.Message)" -ForegroundColor Yellow
      }
    }
  }
}

# 3. Shortcuts pointing at copies that no longer exist (outside this suite's Start Menu folder)
$lnkRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
) | Where-Object { $_ -and (Test-Path $_) }
foreach ($dir in $lnkRoots) {
  Get-ChildItem -Path $dir -Filter *.lnk -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.DirectoryName -eq $startMenu) { return }
    $isOurs = $false
    foreach ($n in $appNames) { if ($_.BaseName -match ('^' + [regex]::Escape($n) + '(\s+[\d.]+.*)?$')) { $isOurs = $true } }
    if (-not $isOurs) { return }
    try {
      $t = $shell.CreateShortcut($_.FullName).TargetPath
      if ($t -and -not (Test-Path $t)) {
        Remove-Item -Force $_.FullName
        Write-Host "  [OK] Removed broken shortcut $($_.Name)" -ForegroundColor Green
      }
    } catch {}
  }
}
Write-Host ""

New-Item -ItemType Directory -Force -Path $root, $startMenu | Out-Null

foreach ($app in $info.apps) {
  $src = Join-Path $here "apps\$($app.folder)"
  $dest = Join-Path $root $app.folder
  Close-App $app

  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Copy-Item -Recurse -Path $src -Destination $dest
  Get-ChildItem -Recurse -File $dest | Unblock-File

  $target = Join-Path $dest $app.exe
  foreach ($dir in @($startMenu) + $(if ($makeDesktop) { @($desktop) } else { @() })) {
    $lnk = $shell.CreateShortcut((Join-Path $dir "$($app.name).lnk"))
    $lnk.TargetPath = $target
    $lnk.WorkingDirectory = $dest
    $lnk.IconLocation = "$target,0"
    $lnk.Description = $app.description
    $lnk.Save()
  }
  Write-Host "  [OK] $($app.name) $($app.version)" -ForegroundColor Green
}

# Keep the uninstaller and the app list with the install
Copy-Item -Force (Join-Path $here 'uninstall.ps1') $root
Copy-Item -Force (Join-Path $here 'suite-info.json') $root

# Register in Settings > Apps > Installed apps
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($suite -replace '\s','')"
New-Item -Path $key -Force | Out-Null
$firstExe = Join-Path (Join-Path $root $info.apps[0].folder) $info.apps[0].exe
$props = @{
  DisplayName     = $suite
  DisplayVersion  = $info.version
  Publisher       = $info.publisher
  InstallLocation = $root
  DisplayIcon     = $firstExe
  UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$root\uninstall.ps1`""
  NoModify        = 1
  NoRepair        = 1
}
foreach ($k in $props.Keys) { Set-ItemProperty -Path $key -Name $k -Value $props[$k] }

Write-Host ""
Write-Host "Done. Find the apps in the Start Menu under '$suite'." -ForegroundColor Cyan
Write-Host "Your settings and data were left untouched."
Write-Host ""
Read-Host "Press Enter to close"

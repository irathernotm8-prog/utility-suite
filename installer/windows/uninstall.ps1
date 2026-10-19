# Removes the suite's apps and shortcuts. App data in %APPDATA% (settings, accounts) is kept.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$info = Get-Content -Raw -Path (Join-Path $root 'suite-info.json') | ConvertFrom-Json
$suite = $info.suiteName

if ((Read-Host "Remove $suite and all its apps? (y/N)") -notmatch '^[yY]') { exit }

foreach ($app in $info.apps) {
  Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($app.exe)) -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Desktop')) "$($app.name).lnk")
}
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$suite")
Remove-Item -Force -ErrorAction SilentlyContinue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($suite -replace '\s','')"
Set-Location $env:TEMP
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $root
Write-Host "$suite removed. Your app data in $env:APPDATA was kept."
Start-Sleep -Seconds 2

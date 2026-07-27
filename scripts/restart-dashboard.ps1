param(
  [switch]$Background
)

$ErrorActionPreference = "Stop"

$port = 8787
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$listeners = netstat -ano | Select-String "127.0.0.1:$port\s"
$processIds = @()

foreach ($line in $listeners) {
  $parts = ($line.ToString().Trim() -replace "\s+", " ").Split(" ")
  $candidate = $parts[-1]
  if ($candidate -match "^\d+$" -and [int]$candidate -gt 0) {
    $processIds += [int]$candidate
  }
}

$processIds | Sort-Object -Unique | ForEach-Object {
  Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

if ($Background) {
  Start-Process -FilePath "npm.cmd" -ArgumentList @("start") -WorkingDirectory $root.Path -WindowStyle Hidden
  Start-Sleep -Seconds 6

  $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/stores" -TimeoutSec 5
  $storeKeys = ($response | ForEach-Object { $_.key }) -join ", "
  Write-Host "Dashboard restarted in background: http://127.0.0.1:$port"
  Write-Host "Stores: $storeKeys"
  exit 0
}

Write-Host "Dashboard restarting in foreground: http://127.0.0.1:$port"
Write-Host "Keep this terminal open to keep scraping."
& npm.cmd start

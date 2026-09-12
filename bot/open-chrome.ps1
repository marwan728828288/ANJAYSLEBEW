$ErrorActionPreference = 'Stop'
$port = 9222
if ($args.Count -gt 0) { $port = [int]$args[0] }

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" }

$profile = Join-Path $env:LOCALAPPDATA "ScaterCDPProfile"
New-Item -ItemType Directory -Force -Path $profile | Out-Null

Write-Host "Buka Chrome debug di port $port — lalu login/buka halaman bonus di dalamnya."
Start-Process $chrome -ArgumentList @(
  "--remote-debugging-port=$port",
  "--user-data-dir=$profile",
  "--no-first-run",
  "--disable-background-networking"
)
Start-Sleep -Seconds 2
try {
  $tabs = Invoke-RestMethod "http://127.0.0.1:$port/json"
  Write-Host "Chrome terdeteksi. Jumlah tab: $($tabs.Count)"
} catch {
  Write-Host "Chrome belum siap — tunggu beberapa detik lalu cek http://127.0.0.1:$port/json"
}
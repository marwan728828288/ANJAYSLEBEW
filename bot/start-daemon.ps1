$ErrorActionPreference = 'Stop'
$dir = "C:\Users\GOLDENWARE\Videos\AUTO SCATER FULL HD&LOG LIVE v2\AUTO SCATER FULL HD&LOG LIVE v2"
$pidfile = Join-Path $dir 'bot\daemon.pid'
if (Test-Path $pidfile) {
  $old = (Get-Content $pidfile | Select-Object -First 1).Trim()
  if ($old -match '^\d+$') { taskkill /F /PID $old 2>$null | Out-Null }
}
Start-Sleep -Seconds 1
$p = Start-Process -FilePath "node" -ArgumentList @("bot/worker.js") -WorkingDirectory $dir -RedirectStandardOutput "$env:TEMP\scatur_out6.log" -RedirectStandardError "$env:TEMP\scatur_err6.log" -PassThru -WindowStyle Hidden
$p.Id | Out-File -Encoding ascii -FilePath $pidfile -Force
Write-Host "PID $($p.Id)"
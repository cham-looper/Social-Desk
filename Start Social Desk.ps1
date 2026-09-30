$ErrorActionPreference = 'Stop'
$socialRoot = $PSScriptRoot
$socialUrl = 'http://127.0.0.1:4318/'
$socialRunning = $false
try {
    $socialPage = Invoke-WebRequest -Uri $socialUrl -UseBasicParsing -TimeoutSec 2
    $socialRunning = $socialPage.StatusCode -eq 200 -and $socialPage.Content.Contains('Social Desk')
} catch { }
if (-not $socialRunning) {
    $socialNode = (Get-Command node.exe -ErrorAction Stop).Source
    $socialServer = Join-Path $socialRoot 'server.mjs'
    Start-Process -FilePath $socialNode -ArgumentList @('"' + $socialServer + '"') -WorkingDirectory $socialRoot -WindowStyle Hidden
    for ($socialAttempt = 0; $socialAttempt -lt 20; $socialAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $socialPage = Invoke-WebRequest -Uri $socialUrl -UseBasicParsing -TimeoutSec 1
            if ($socialPage.StatusCode -eq 200 -and $socialPage.Content.Contains('Social Desk')) { $socialRunning = $true; break }
        } catch { }
    }
}
if (-not $socialRunning) { throw 'Social Desk could not start. Port 4318 may be in use.' }
Start-Process $socialUrl

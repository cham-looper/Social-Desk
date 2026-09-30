$ErrorActionPreference = 'Stop'
$socialRoot = $PSScriptRoot
$socialDesktop = Join-Path $socialRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $socialDesktop)) {
    throw 'The desktop runtime is missing. Open a terminal in this folder, run npm ci then npm run setup-desktop, and try again.'
}
Start-Process -FilePath $socialDesktop -ArgumentList @('"' + $socialRoot + '"') -WorkingDirectory $socialRoot -WindowStyle Normal

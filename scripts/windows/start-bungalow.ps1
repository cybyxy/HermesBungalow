# HermesBungalow — Windows 单端口启动（发布包：脚本与 backend 同级；仓库：位于 scripts\windows）
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (Test-Path (Join-Path $ScriptDir "backend")) {
    $Root = $ScriptDir
} else {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
    if (Test-Path (Join-Path $RepoRoot "backend")) {
        $Root = $RepoRoot
    } else {
        throw "HermesBungalow: put start-bungalow.ps1 next to ``backend``, or run the copy under repo ``scripts\windows\``."
    }
}

Set-Location $Root

$Backend = Join-Path $Root "backend"
if (Test-Path (Join-Path $Root "requirements.txt")) {
    $Req = Join-Path $Root "requirements.txt"
} else {
    $Req = Join-Path $Backend "requirements.txt"
}

$VenvPy = Join-Path $Backend ".venv\Scripts\python.exe"
$VenvPip = Join-Path $Backend ".venv\Scripts\pip.exe"

if (-not (Test-Path $Backend)) { throw "missing backend folder: $Backend" }
if (-not (Test-Path $Req)) { throw "missing requirements file: $Req" }
if (-not (Test-Path (Join-Path $Root "frontend\dist\index.html"))) {
    Write-Warning "frontend\dist missing — open http://127.0.0.1:8000/ may 404 for UI; API still works."
}

if (-not (Test-Path $VenvPy)) {
    Write-Host "[bungalow] creating venv..."
    python -m venv (Join-Path $Backend ".venv")
    if (-not (Test-Path $VenvPip)) { throw "venv pip not found" }
    & $VenvPip install -U pip
    & $VenvPip install -r $Req
}

$env:PYTHONPATH = "."
$env:PYTHONUNBUFFERED = "1"
if (-not $env:PORT) { $env:PORT = "8000" }
if (-not $env:HOST) { $env:HOST = "0.0.0.0" }

Write-Host "[bungalow] starting http://${env:HOST}:${env:PORT}/ (Ctrl+C to stop)"
Set-Location $Backend
& $VenvPy -m uvicorn server:app --host $env:HOST --port $env:PORT

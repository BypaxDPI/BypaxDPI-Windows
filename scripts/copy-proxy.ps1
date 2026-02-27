# Sadece mevcut bypax-proxy.exe'i src-tauri\binaries'e kopyala
# Kullanım: PowerShell'de .\scripts\copy-proxy.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$SrcExe = Join-Path $Root "spoofdpi\bypax-proxy.exe"
$BinariesDir = Join-Path $Root "src-tauri\binaries"

if (-not (Test-Path $SrcExe)) {
    Write-Host "HATA: spoofdpi\bypax-proxy.exe bulunamadi. Once build-proxy.ps1 calistirin." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $BinariesDir)) {
    New-Item -ItemType Directory -Path $BinariesDir -Force | Out-Null
}
Copy-Item -Path $SrcExe -Destination (Join-Path $BinariesDir "bypax-proxy.exe") -Force
Copy-Item -Path $SrcExe -Destination (Join-Path $BinariesDir "bypax-proxy-x86_64-pc-windows-msvc.exe") -Force
Write-Host "Kopyalandi: src-tauri\binaries\" -ForegroundColor Green

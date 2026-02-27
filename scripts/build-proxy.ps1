# Bypax proxy (SpoofDPI 1.2.1) - PowerShell ile derleme ve kopyalama
# Kullanım: PowerShell'de proje kökünde .\scripts\build-proxy.ps1
# veya script'e sağ tık -> "PowerShell ile Çalıştır"

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$SpoofDpiSrc = Join-Path $Root "SpoofDPI-1.2.1\SpoofDPI-1.2.1"
$OutExe = Join-Path $Root "spoofdpi\bypax-proxy.exe"
$BinariesDir = Join-Path $Root "src-tauri\binaries"

# Go var mı?
$go = Get-Command go -ErrorAction SilentlyContinue
if (-not $go) {
    Write-Host "HATA: Go bulunamadi. PATH'e ekleyin veya https://go.dev/dl adresinden yukleyin." -ForegroundColor Red
    exit 1
}

# Kaynak klasoru var mi?
if (-not (Test-Path (Join-Path $SpoofDpiSrc "go.mod"))) {
    Write-Host "HATA: SpoofDPI kaynagi bulunamadi: $SpoofDpiSrc" -ForegroundColor Red
    exit 1
}

# spoofdpi klasorunu olustur
$spoofdpiDir = Join-Path $Root "spoofdpi"
if (-not (Test-Path $spoofdpiDir)) {
    New-Item -ItemType Directory -Path $spoofdpiDir -Force | Out-Null
}

Write-Host "SpoofDPI (bypax-proxy) derleniyor..." -ForegroundColor Cyan
Push-Location $SpoofDpiSrc
try {
    go build -o $OutExe ./cmd/spoofdpi
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Derleme basarisiz (go build)." -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

Write-Host "Derleme tamam: $OutExe" -ForegroundColor Green

# src-tauri\binaries klasorune kopyala
if (-not (Test-Path $BinariesDir)) {
    New-Item -ItemType Directory -Path $BinariesDir -Force | Out-Null
}
Copy-Item -Path $OutExe -Destination (Join-Path $BinariesDir "bypax-proxy.exe") -Force
Copy-Item -Path $OutExe -Destination (Join-Path $BinariesDir "bypax-proxy-x86_64-pc-windows-msvc.exe") -Force
Write-Host "Kopyalandi: src-tauri\binaries\bypax-proxy.exe (ve -x86_64-pc-windows-msvc.exe)" -ForegroundColor Green
Write-Host "Bitti. Uygulamayi calistirabilirsiniz (npm run tauri dev veya build)." -ForegroundColor Cyan

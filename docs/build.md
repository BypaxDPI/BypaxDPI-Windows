# Build & Dağıtım

## Gereksinimler

| Araç | Sürüm | Amaç |
|------|-------|------|
| Node.js | ≥ 20 | Frontend build |
| Rust (rustup) | stable | Tauri backend |
| Go | ≥ 1.21 | SpoofDPI sidecar |
| Visual Studio Build Tools | 2022 | MSVC bağlayıcı |
| NSIS | ≥ 3.0 | Windows kurulum paketi |

---

## Build Adımları

### 1. Bağımlılık Kurulumu

```powershell
# Node.js paketleri
npm install

# Rust araçları (ilk kurulumda)
rustup target add x86_64-pc-windows-msvc
```

### 2. Sidecar Derleme

```powershell
# Go proxy binary'sini derle (debug semboller kaldırılır)
npm run build-proxy

# Derlenmiş binary'yi Tauri binaries dizinine kopyala
npm run copy-proxy
```

`build-proxy.cjs` içindeki derleme komutu:

```
go build -ldflags="-s -w" -o bypax-proxy-x86_64-pc-windows-msvc.exe
```

`-s -w` flag'leri sembol tablosunu ve DWARF hata ayıklama bilgisini kaldırır; binary boyutunu küçültür.

### 3. İkon Güncelleme

```powershell
# PNG → ICO dönüşümü ve bypax-proxy.exe'ye gömme
npm run update-proxy-icon
```

### 4. Production Build

```powershell
# Frontend + Tauri paketleme (NSIS + MSI + Portable)
npm run tauri build
```

Çıktı: `src-tauri/target/release/bundle/`

---

## Çıktı Paketleri

| Dosya | Format | Açıklama |
|-------|--------|----------|
| `BypaxDPI_*_x64-setup.exe` | NSIS | Tam kurulum dosyası |
| `BypaxDPI_*_x64_en-US.msi` | MSI | Windows Installer paketi |
| `BypaxDPI_*.exe` | Portable | Kurulum gerektirmeyen |

---

## Tauri Yapılandırması

`src-tauri/tauri.conf.json` temel ayarları:

```json
{
  "app": {
    "windows": [{
      "title": "BypaxDPI",
      "width": 380,
      "height": 700,
      "resizable": false,
      "center": true,
      "devtools": false
    }]
  },
  "bundle": {
    "identifier": "com.consolaktif.bypaxdpi",
    "targets": ["nsis", "msi"]
  }
}
```

---

## NSIS Kurulum Yapılandırması

`src-tauri/installer.nsi` ve `hooks.nsi` kurulum davranışını belirler:

- Mevcut kurulum tespit edilirse kaldırma önerilir
- Npcap kurulum seçeneği sunulur
- Başlangıç menüsü kısayolları oluşturulur
- Windows Registry kayıt (kalıcı yüklemeler için)

---

## Geliştirme Ortamı

```powershell
# Hot reload ile geliştirme sunucusu başlat
npm run tauri dev
```

Bu komut şunları yapar:
1. Vite dev sunucusunu başlatır (port 5173)
2. Tauri uygulamasını debug modunda derler ve başlatır
3. Frontend değişikliklerini anında yansıtır
4. Rust değişikliklerinde yeniden derleme başlatır

---

## Ortam Değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `TAURI_SIGNING_PRIVATE_KEY` | Güncelleme imzalama anahtarı |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | İmzalama anahtarı parolası |

---

## Sürüm Yönetimi

Sürüm numarasını güncellemek için iki dosyayı düzenleyin:

1. `package.json` → `"version"` alanı
2. `src-tauri/Cargo.toml` → `[package]` altında `version`
3. `src-tauri/tauri.conf.json` → `"version"` alanı

---

## CI/CD Notu

Otomatik build için şu platformlar kullanılabilir:

- **GitHub Actions** — `windows-latest` runner ile Tauri build action
- Gerekli secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Örnek workflow dosyası için [Tauri resmi dokümantasyonuna](https://tauri.app/distribute/updater/) bakın.

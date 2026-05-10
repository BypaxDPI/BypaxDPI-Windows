# Geliştirici Kılavuzu

## Teknoloji Yığını

| Katman | Teknoloji | Sürüm |
|--------|-----------|-------|
| Frontend | React | 19.1.0 |
| Build Aracı | Vite | 7.0.4 |
| Animasyon | Framer Motion | 12.29.2 |
| İkonlar | Lucide React | 0.563.0 |
| XSS Koruması | DOMPurify | 3.3.3 |
| QR Kod | QRCode.react | 4.2.0 |
| Desktop Framework | Tauri | 2.10.0 |
| Backend | Rust (2021 edition) | — |
| Windows API | winapi 0.3, winreg 0.52 | — |
| Sidecar | Go (SpoofDPI 1.2.1) | — |
| Kurulum | NSIS | — |

---

## Proje Yapısı

```
BypaxDPI-Windows/
├── src/                        # React frontend
│   ├── App.jsx                 # Ana UI bileşeni
│   ├── Settings.jsx            # Ayarlar paneli
│   ├── constants.js            # Sabitler
│   ├── profiles.js             # ISP profilleri
│   ├── i18n.js                 # Çeviriler
│   ├── App.css                 # Stil (dark mode)
│   ├── main.jsx                # React giriş noktası
│   ├── assets/                 # SVG ikonlar, ISP logoları
│   └── fonts/                  # Inter (WOFF2)
│
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── lib.rs              # Tauri komutları ve sistem entegrasyonu
│   │   └── main.rs             # Panic işleyici, giriş noktası
│   ├── Cargo.toml
│   ├── build.rs                # Build scripti
│   ├── tauri.conf.json         # Tauri yapılandırması
│   ├── capabilities/           # İzin tanımları
│   │   ├── default.json
│   │   └── desktop.json
│   ├── hooks.nsi               # NSIS installer hooks
│   └── installer.nsi           # NSIS installer yapılandırması
│
├── scripts/                    # Build otomasyon
│   ├── build-proxy.cjs         # Go binary derleme
│   ├── copy-proxy.cjs          # Binary kopyalama
│   ├── build-proxy.ps1
│   └── copy-proxy.ps1
│
├── public/                     # Statik varlıklar
├── images/                     # Ekran görüntüleri
├── package.json
├── vite.config.js
└── index.html
```

---

## Geliştirme Ortamı Kurulumu

### Gereksinimler

- **Node.js** ≥ 20
- **Rust** (rustup ile, `stable` toolchain)
- **Go** ≥ 1.21 (sidecar derlemek için)
- **Visual Studio Build Tools** (MSVC bağlayıcı)
- **Npcap SDK** (isteğe bağlı, Strong mod testi için)

### Kurulum

```powershell
# Bağımlılıkları yükle
npm install

# Geliştirme modunda başlat (hot reload)
npm run tauri dev
```

### Sidecar Derleme

```powershell
# Go proxy binary'sini derle
npm run build-proxy

# Derlenmiş binary'yi Tauri binaries dizinine kopyala
npm run copy-proxy
```

---

## Build Süreci

```
1. npm run update-proxy-icon   # PNG → ICO dönüşümü, bypax-proxy.exe'ye gömme
2. npm run build               # Vite ile frontend derle → /dist
3. npm run build-proxy         # Go SpoofDPI binary derle (-ldflags="-s -w")
4. npm run tauri build         # Tauri: NSIS + MSI + Portable EXE
```

**Tauri hedef paketler:**
- `setup.exe` — NSIS yükleyici
- `.msi` — Windows Installer paketi
- Portable `.exe` — tek dosya çalıştırılabilir

---

## Yeni Tauri Komutu Ekleme

### 1. Rust tarafı (`lib.rs`)

```rust
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
    // implementasyon
    Ok("sonuç".to_string())
}
```

### 2. Tauri builder'a kaydet (`lib.rs` → `run()`)

```rust
.invoke_handler(tauri::generate_handler![
    // ... mevcut komutlar ...
    my_command,
])
```

### 3. Frontend çağrısı

```js
import { invoke } from "@tauri-apps/api/core";

const result = await invoke("my_command", { param: "değer" });
```

### 4. İzin tanımı (`capabilities/default.json`)

```json
{
  "permissions": [
    "core:default",
    "my-plugin:allow-my-command"
  ]
}
```

---

## Yeni ISP Profili Ekleme

`src/profiles.js` içindeki `ISP_PROFILES` dizisine yeni nesne ekleyin:

```js
{
  id: "my_isp",
  mode: "1",                        // "0"=Turbo, "1"=Balanced, "2"=Strong
  chunk: 4,                         // Varsayılan chunk boyutu
  color: "#60a5fa",
  bg: "rgba(96, 165, 250, 0.1)",
  icon: "🌐",
  logos: [myIspLogo],               // import edilen PNG/SVG dizisi
  // i18n key'leri: my_ispName, my_ispDesc (i18n.js'e ekle)
}
```

---

## Yeni DPI Atlama Modu Ekleme

1. `src/constants.js` içinde timeout değeri tanımlayın.
2. `src/profiles.js` içindeki `BYPASS_MODES` dizisine giriş ekleyin.
3. `src/App.jsx` içindeki `startEngine()` fonksiyonunda argüman üretim mantığını genişletin.
4. `i18n.js`'e Türkçe ve İngilizce çeviri anahtarları ekleyin.

---

## Tasarım Kalıpları

### Ref Tabanlı State Yönetimi

Render döngülerini engellemeden gerçek zamanlı değerlere erişmek için `useRef` kullanılır:

```js
const configRef = useRef(config);
useEffect(() => { configRef.current = config; }, [config]);

// Event listener içinde her zaman güncel değer
const currentConfig = configRef.current;
```

### i18n Dinamik Mesajlar

Parametre içeren log mesajları fonksiyon olarak tanımlanır:

```js
// i18n.js
logPortInUse: (port) => `Port ${port} meşgul, yeni port deneniyor...`,
```

```js
// App.jsx
addLog(t("logPortInUse")(currentPort), "warning");
```

### Hata Sınırları

Tüm `invoke()` çağrıları `try/catch` ile sarılır; hata mesajı log paneline yansıtılır ve kullanıcı sessizce bilgilendirilir.

---

## Test

Şu anda otomatik test altyapısı bulunmamaktadır. Manuel test kapsamı:

1. **Bağlantı:** Her üç DPI modunda bağlantı kur ve kes.
2. **Port çakışması:** 8080 portunu blokla; uygulamanın 8081'e geçtiğini doğrula.
3. **Kirli kapanma:** Görev yöneticisinden uygulamayı zorla kapat; yeniden açınca sentinel temizliğini doğrula.
4. **LAN paylaşımı:** Mobil cihazdan PAC URL'ye erişimi doğrula.
5. **Npcap eksik:** Npcap olmadan Strong modunu dene; chunk-only fallback'i doğrula.

---

## Katkı Rehberi

1. Projeyi fork edin.
2. Feature branch oluşturun: `git checkout -b feature/yeni-ozellik`
3. Değişikliklerinizi commit edin.
4. PR açın; başlığı açıklayıcı tutun.

**Commit mesajı formatı:** `feat:`, `fix:`, `refactor:`, `docs:` önekleri kullanın.

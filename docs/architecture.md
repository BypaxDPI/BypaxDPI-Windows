# Mimari

## Genel Bakış

BypaxDPI üç ana katmandan oluşur:

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND  —  React 19 + Vite                           │
│  App.jsx · Settings.jsx · i18n.js · profiles.js        │
└────────────────────┬────────────────────────────────────┘
                     │  Tauri IPC (invoke / emit)
┌────────────────────┴────────────────────────────────────┐
│  BACKEND  —  Rust (Tauri v2)                            │
│  lib.rs · main.rs                                       │
│  Proxy yönetimi · PAC sunucu · Registry · WinAPI       │
└────────────────────┬────────────────────────────────────┘
                     │  Process spawn (sidecar)
┌────────────────────┴────────────────────────────────────┐
│  SIDECAR  —  Go (SpoofDPI 1.2.1)                        │
│  SNI bypass · Chunk split · Sahte paket · DNS/DoH      │
└─────────────────────────────────────────────────────────┘
```

---

## Katman Detayları

### Frontend (React)

`src/` dizinindeki React bileşenleri, tüm kullanıcı etkileşimini yönetir.

**Temel Bileşenler:**

| Dosya | Satır | Sorumluluk |
|-------|-------|-----------|
| `App.jsx` | 2 809 | Ana UI, bağlantı state yönetimi, log görüntüleyici |
| `Settings.jsx` | ~1 200 | Ayarlar paneli, DNS testi, ISP profilleri |
| `i18n.js` | 585 | Türkçe/İngilizce çeviriler |
| `constants.js` | 60 | DNS uç noktaları, URL'ler, sabit değerler |
| `profiles.js` | 165 | ISP profilleri, atlama modları, chunk yapılandırması |

**State Yönetimi:**

`App.jsx` içindeki iki ayrı state katmanı vardır:

- **`useState` ile yönetilen:** UI yeniden render'ı gerektiren veriler (isConnected, logs, config)
- **`useRef` ile yönetilen:** Render'ı tetiklemeden tutulması gereken değerler (currentPort, childProcess, yeniden bağlanma sayaçları)

Stale closure sorununu önlemek için config ve port değerleri ref olarak tutulur; `configRef.current` ve `currentPortRef.current` her zaman güncel değere erişir.

---

### Backend (Rust / Tauri)

`src-tauri/src/lib.rs` (1 687 satır) tüm sistem entegrasyonunu barındırır.

#### Modüller

**`registry` modülü**
- Windows Registry HKCU üzerinden proxy ayarlarını okur/yazar.
- Mevcut kurumsal proxy varsa yedekler ve geri yükler.

**Sentinel Sistemi**
- Bağlantı aktifken `%TEMP%\bypaxdpi_proxy_active.lock` dosyası oluşturulur.
- Temiz kapatmada silinir.
- Uygulama açılışında dosya bulunursa → kirli kapanma tespiti → otomatik temizlik başlatılır.

**PAC Sunucu**
- Port 8787–8887 aralığında yerleşik HTTP sunucu.
- Mobil/LAN cihazlara otomatik proxy yapılandırması için `.pac` dosyası sunar.
- Maksimum 50 eş zamanlı bağlantı.

**Ağ Arayüzü Tespiti (`get_safe_lan_ip`)**

Sanal adaptörleri (VirtualBox, VMware, Hyper-V, Docker, WSL, Hamachi, VPN) üç geçişli bir algoritmayla eleyerek gerçek LAN IP'sini bulur:
1. Gerçek adaptör + gerçek IP aralığı
2. Yedek: sadece IP aralığı kontrolü
3. Son çare: loopback olmayan herhangi bir IP

---

### Sidecar (Go / SpoofDPI)

`src-tauri/binaries/bypax-proxy-*.exe` olarak paketlenir.

**Atlama Teknikleri:**

| Mod | Ad | Yöntem | Gecikme |
|-----|----|--------|---------|
| 0 | Turbo | Yalnızca SNI ayrıştırma | Minimum |
| 1 | Balanced | Chunk bölme (1, 2, 4, 8 bayt) | Orta |
| 2 | Strong | Chunk + disorder + sahte paket* | Yüksek |

*Npcap sürücüsü gerektirir.

**DNS Modları:**

- **DoH (DNS-over-HTTPS):** ISP DNS yönlendirmesini atlar; uç noktalara IP ile bağlanır.
- **UDP:** Standart DNS, DoH desteklenmediğinde.
- **System:** İşletim sistemi DNS'i kullanılır.

---

## Bağlantı Yaşam Döngüsü

```
Kullanıcı → Bağlan
    │
    ├─ 1. İnternet bağlantısı kontrolü
    ├─ 2. Yönetici yetkisi kontrolü
    ├─ 3. Port + LAN IP tespiti (Rust)
    ├─ 4. Zombie süreç temizliği
    ├─ 5. Önceki proxy temizliği
    ├─ 6. SpoofDPI başlatma (spawn sidecar)
    ├─ 7. "listening on" log bekleme
    ├─ 8. TCP port doğrulama
    ├─ 9. Windows proxy → Registry yaz
    ├─ 10. WinHTTP güncelleme (netsh)
    ├─ 11. UWP loopback muafiyeti
    ├─ 12. Sentinel dosyası oluştur
    ├─ 13. PAC sunucu başlat (LAN paylaşımı aktifse)
    └─ 14. Tray tooltip güncelle → Bağlantı kuruldu

Kullanıcı → Bağlantıyı Kes
    │
    ├─ 1. SpoofDPI sonlandır
    ├─ 2. Windows proxy temizle
    ├─ 3. Kurumsal proxy varsa geri yükle
    ├─ 4. Sentinel dosyasını sil
    └─ 5. PAC sunucu durdur
```

---

## Veri Akışı

### Proxy Ayarlama

```
Frontend  →  invoke("set_system_proxy", {port, enableWinhttp})
             │
             Rust lib.rs
             ├─ registry::set_proxy(port)          → HKCU Registry
             └─ netsh winhttp set proxy ...         → WinHTTP stack
```

### Log Akışı

```
SpoofDPI stdout
    │
    Tauri Command event listener (onStdout)
    │
    addLog() → logs useState → LogViewer bileşeni
```

---

## Durum Kalıcılığı

| Depolama | Anahtar / Yol | İçerik |
|----------|--------------|--------|
| `localStorage` | `bypax_config` | Tüm kullanıcı ayarları (JSON) |
| `localStorage` | `bypax_first_run_done` | İlk çalıştırma bayrak |
| Registry | `HKCU\...\Internet Settings` | Sistem proxy değerleri |
| Temp dosya | `%TEMP%\bypaxdpi_proxy_active.lock` | Sentinel (crash tespiti) |
| Temp dosya | `%TEMP%\bypaxdpi_sidecar.pid` | SpoofDPI PID |

---

## Otomatik Kurtarma

| Senaryo | Tespit | Eylem |
|---------|--------|-------|
| Çökme / BSOD | Başlangıçta sentinel dosyası var | `startup_proxy_cleanup()` |
| Port çakışması | Logda "bind … already in use" | Port artır (8080→8081→…), yeniden dene |
| Wpcap eksik | SpoofDPI çıktısında hata | Sahte paket devre dışı, chunk-only'ye geç |
| Bağlantı kopması | Süreç exit kodu ≠ 0 | Üstel geri çekilme ile yeniden bağlan (maks 5) |
| Ağ çevrimdışı | `window.offline` olayı | Uyarı göster, yeniden bağlanmayı durdur |

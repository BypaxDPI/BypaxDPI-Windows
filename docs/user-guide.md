# Kullanıcı Kılavuzu

## Sistem Gereksinimleri

- **İşletim Sistemi:** Windows 10 (20H2+) veya Windows 11
- **Mimari:** x86-64 (64-bit)
- **Yönetici Yetkisi:** Proxy ayarlarını yapılandırmak için gerekli
- **Npcap (İsteğe Bağlı):** Güçlü (Strong) atlama modu için gerekli

---

## Kurulum

1. GitHub Releases sayfasından en son `.exe` kurulum dosyasını indirin.
2. Yükleyiciyi yönetici olarak çalıştırın.
3. Kurulum sırasında Npcap sürücüsünü yükleme seçeneği sunulur — **Güçlü mod** kullanacaksanız seçin.
4. Kurulum tamamlandıktan sonra uygulamayı başlatın.

---

## İlk Başlatma

Uygulama ilk kez açıldığında ISP profili seçim ekranı görünür. Bu ekranda internet servis sağlayıcınızı seçin:

| Profil | Simge | Hedef ISP | Varsayılan Mod |
|--------|-------|-----------|---------------|
| **Light** | ⚡ | TurkNet | Turbo (0) |
| **Mid** | 🛡️ | Genel / Belirsiz | Balanced (1) |
| **Heavy** | 🔒 | Kablonet, Superonline, Türk Telekom, Vodafone, Milenicom | Strong (2) |
| **Other** | 🌐 | Diğer / Bilinmiyor | Strong (2) |

Bu seçim varsayılan DPI modunu ve chunk boyutunu belirler; daha sonra Settings'ten değiştirilebilir.

---

## Ana Ekran

### Bağlan / Bağlantıyı Kes

- **Bağlan** düğmesine tıklandığında bağlantı başlatılır.
- Bağlantı kurulunca durum göstergesi yeşile döner ve aktif port numarası görünür.
- **Bağlantıyı Kes** tıklandığında proxy temizlenir ve orijinal ayarlar geri yüklenir.

### Log Paneli

Bağlantı sürecindeki olaylar renkli satırlar halinde listelenir:

| Renk | Anlam |
|------|-------|
| Mavi | Bilgi |
| Sarı | Uyarı |
| Kırmızı | Hata |
| Yeşil | Başarı |

Maksimum 100 log satırı tutulur; eski satırlar otomatik silinir.

---

## Ayarlar

### Genel

| Ayar | Açıklama |
|------|----------|
| **Dil** | Türkçe veya İngilizce |
| **Otomatik Başlat** | Windows ile birlikte başlat |
| **Tray'e Küçült** | Kapatınca sistem tepsisinde çalışmaya devam et |

### Bağlantı

#### DPI Atlama Modu

| Mod | Yöntem | Öneri |
|-----|--------|-------|
| **Turbo (0)** | Yalnızca SNI | Hafif DPI, düşük gecikme |
| **Balanced (1)** | Chunk bölme | Çoğu ISP için önerilen ✓ |
| **Strong (2)** | Chunk + disorder + sahte paket | Ağır DPI, Npcap gerektirir |

#### Chunk Boyutu

TLS ClientHello paketinin kaç baytlık parçalara bölüneceğini belirler.

| Boyut | Kullanım |
|-------|---------|
| 1 bayt | Maksimum uyumluluk, en yavaş |
| 2 bayt | Güçlü uyumluluk |
| 4 bayt | Dengeli (varsayılan) |
| 8 bayt | Hızlı, hafif DPI için yeterli |

Uygulama arayüzünde `[1, 2, 4, 8]` seçenekleri sunulur.

### DNS

#### DNS Sağlayıcısı

| Sağlayıcı | IP | Özellik |
|-----------|-----|---------|
| Cloudflare | 1.1.1.1 | Gizlilik odaklı |
| Google | 8.8.8.8 | Geniş altyapı |
| AdGuard | 94.140.14.14 | Reklam filtreli |
| Quad9 | 9.9.9.9 | Güvenlik odaklı |
| OpenDNS | 208.67.222.222 | Filtreleme seçenekleri |

#### DNS Modu

| Mod | Açıklama |
|-----|----------|
| **DoH** | DNS-over-HTTPS; ISP yönlendirmesini atlar (önerilen) |
| **UDP** | Standart DNS; basit, yaygın |
| **System** | İşletim sistemi DNS'i kullanılır |

**Gecikme Testi:** Ayarlar panelinde her DNS sağlayıcısı için anlık gecikme ölçümü yapılabilir.

### Ağ — LAN Paylaşımı

Aktif edildiğinde aynı ağdaki diğer cihazlar (telefon, tablet) proxy'yi kullanabilir.

**Kurulum:**
1. LAN Paylaşımı'nı etkinleştirin.
2. Ana ekranda QR kod görünür.
3. Mobil cihazda QR kodu tarayın → tarayıcıda kurulum kılavuzu açılır.
4. Kılavuzdaki PAC URL'yi cihazınıza girin: `http://192.168.x.x:8787/pac`

**PAC URL Yapısı:**
```
http://<LAN_IP>:<PAC_PORT>/pac
```

### Otomasyon

| Ayar | Açıklama |
|------|----------|
| **Otomatik Bağlan** | Uygulama açılınca bağlantıyı başlat |
| **Otomatik Yeniden Bağlan** | Bağlantı koparsa otomatik yeniden dene |

Yeniden bağlanma gecikmeleri: 2.5 s → 3 s → 6 s → 12 s → 20 s (üstel geri çekilme)

### Sürücü (Npcap)

**Strong** modu için Npcap gereklidir. Bu bölümden Npcap'in kurulu olup olmadığını kontrol edebilir, yüklü değilse kurulum başlatabilirsiniz.

---

## Sistem Tepsisi

Uygulama kapatılmak yerine tepsiye küçültüldüğünde:

- **Sol tık:** Pencereyi göster/gizle
- **Sağ tık:** Menüyü aç (Göster / Destek / Çıkış)
- **Tooltip:** Aktif bağlantı durumu ve port numarası

---

## Proxy Atlama Listesi

Aşağıdaki hedefler proxy'den **muaf tutulur** (doğrudan bağlantı kullanılır):

- Yerel ağ: `<local>`, `10.*`, `172.16–31.*`, `192.168.*`
- Windows Update ve Connectivity Check servisleri
- Oyun platformları: Steam, Epic, Riot, EA, Blizzard, Ubisoft, Xbox
- CDN: cachefly.net

Bu liste `lib.rs` içindeki `registry::set_proxy()` fonksiyonunda tanımlıdır.

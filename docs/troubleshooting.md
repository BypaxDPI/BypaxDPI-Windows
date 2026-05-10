# Sorun Giderme

## Hızlı Tanı Adımları

Herhangi bir sorunla karşılaştığınızda önce şunları kontrol edin:

1. Uygulamayı **yönetici olarak** çalıştırdığınızdan emin olun.
2. **Güvenlik duvarı / antivirüs** yazılımının `bypax-proxy.exe`'yi engellemediğini doğrulayın.
3. Log panelindeki mesajları okuyun — genellikle sorunun nedeni orada belirtilir.

---

## Bağlantı Sorunları

### Uygulama "Bağlanıyor" durumunda takılı kalıyor

**Olası nedenler ve çözümler:**

| Neden | Kontrol | Çözüm |
|-------|---------|-------|
| Port meşgul | Log'da "already in use" var mı? | Başka proxy yazılımı kapatın; uygulama otomatik 8081'e geçer |
| Wpcap eksik | Log'da "wpcap.dll" hatası var mı? | Strong mod → Balanced moda geçin veya Npcap kurun |
| Yönetici yetkisi yok | Ana ekranda uyarı simgesi var mı? | Uygulamayı sağ tıklayıp "Yönetici olarak çalıştır" seçin |
| Antivirus engeli | — | `bypax-proxy.exe`'yi dışlamalar listesine ekleyin |

---

### Bağlantı kuruldu ama internet hâlâ çalışmıyor

1. **Tarayıcı önbelleğini temizleyin** (Ctrl+Shift+Del) ve sayfayı yenileyin.
2. Tarayıcının sistem proxy'sini kullandığını doğrulayın (doğrudan veya eklenti aracılığıyla değil).
3. Hedef site proxy bypass listesinde mi? (`lib.rs` → `PROXY_BYPASS` sabitine bakın; bazı CDN ve oyun platformları listededir).
4. Farklı bir DNS sağlayıcısı deneyin: **Cloudflare → Google → AdGuard**.
5. DNS modunu **DoH → UDP → System** sırasıyla deneyin.

---

### Oyunlar proxy üzerinden çalışmıyor

Oyunların büyük çoğunluğu WinINET yerine WinHTTP veya custom TCP kullanır.

**Çözüm:**  
Settings → Bağlantı → **Oyun Modu (WinHTTP)** seçeneğini etkinleştirin.

Bu seçenek hem `netsh winhttp` proxy'sini günceller hem de UWP uygulamaları için loopback muafiyeti ekler.

---

### Discord, Roblox veya Xbox Game Pass çalışmıyor

Bu uygulamalar UWP (Universal Windows Platform) çerçevesini kullanır ve varsayılan olarak localhost proxy'ye bağlanamaz.

**Çözüm:**  
Settings → Bağlantı → **Oyun Modu (WinHTTP)** etkinleştirin.  
Bu seçenek PowerShell aracılığıyla tüm UWP uygulamalarına loopback muafiyeti ekler.

---

## DNS Sorunları

### "DNS zaman aşımı" hatası

1. Seçili DNS sağlayıcısını **Gecikme Testi** düğmesiyle test edin.
2. Gecikme yüksekse (> 500ms) farklı bir sağlayıcı seçin.
3. DNS modunu **DoH → UDP** olarak değiştirin; UDP daha basit ve güvenilirdir.
4. ISP'niz DoH bağlantılarını engelliyorsa **UDP** veya **System** kullanın.

---

## Npcap / Wpcap Sorunları

### "wpcap.dll bulunamadı" hatası

Strong (Güçlü) mod Npcap sürücüsüne ihtiyaç duyar.

**Çözüm:**  
1. Settings → Sürücü → **Npcap Kur** düğmesine tıklayın.  
2. Kurulum tamamlanınca uygulamayı yeniden başlatın.  
3. Alternatif: Balanced (Dengeli) moda geçin — Npcap gerektirmez.

---

## Kirli Kapanma / Proxy Takılması

### Uygulama kapandıktan sonra internet çalışmıyor

Uygulama beklenmedik şekilde kapandığında Windows proxy ayarları eski haline döndürülemeyebilir.

**Otomatik Kurtarma:**  
Uygulamayı yeniden açın — başlangıçta sentinel dosyası tespit edilirse proxy otomatik temizlenir.

**Manuel Kurtarma:**

```powershell
# Registry proxy'sini devre dışı bırak
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f

# WinHTTP proxy'sini sıfırla
netsh winhttp reset proxy

# DNS önbelleğini temizle
ipconfig /flushdns

# Kalan proxy süreçlerini sonlandır
taskkill /F /IM bypax-proxy.exe
```

---

## LAN Paylaşımı Sorunları

### Mobil cihaz PAC URL'ye erişemiyor

1. PC ve mobil cihazın aynı WiFi ağında olduğunu doğrulayın.
2. PC güvenlik duvarının 8787 portunu (PAC sunucu) engellememesi gerekir.
3. Log panelinde gösterilen **LAN IP**'nin doğru olduğunu kontrol edin.
4. Mobil tarayıcıda `http://<LAN_IP>:8787/pac` adresini açmayı deneyin.

### Sanal adaptör yanlış LAN IP'si seçiyor

Uygulama sanal adaptörleri (VirtualBox, VMware, WSL, Docker) otomatik filtreler. Yanlış IP görünüyorsa:

1. Sanal ağ adaptörlerini geçici olarak devre dışı bırakın.
2. Uygulamayı yeniden başlatın.

---

## Sık Sorulan Sorular

**S: Hangi DPI modunu seçmeliyim?**  
A: Çoğu kullanıcı için **Balanced (Dengeli)** önerilir. Hâlâ erişim sorunu yaşıyorsanız Strong modunu deneyin (Npcap gerektirir).

**S: Hangi chunk boyutunu seçmeliyim?**  
A: 4 bayt iyi bir başlangıçtır. Bağlantı sorunu devam ederse 1–2 bayta düşürün; hız sorununda 8–16 bayta çıkın.

**S: Uygulama otomatik olarak yeniden bağlanır mı?**  
A: Evet, **Otomatik Yeniden Bağlan** aktifse bağlantı koptuğunda maksimum 5 deneme yapılır: 2.5s → 3s → 6s → 12s → 20s.

**S: Proxy hangi uygulamaları etkiler?**  
A: Sistem proxy'sini destekleyen tüm uygulamalar etkilenir (tarayıcılar, Discord, Teams vb.). Oyun modu etkinleştirilirse WinHTTP kullanan oyunlar da dahil olur.

**S: VPN ile birlikte kullanabilir miyim?**  
A: Teknik olarak mümkün ancak desteklenmez; çakışmalar yaşanabilir. Birini kullanırken diğerini devre dışı bırakın.

---

## Log Mesajı Referansı

| Mesaj | Anlam | Eylem |
|-------|-------|-------|
| `Port X meşgul` | 8080 dolu | Otomatik 8081'e geçilir |
| `Bağlantı kuruldu (Port X)` | Başarılı | — |
| `wpcap.dll bulunamadı` | Npcap eksik | Npcap kur veya modu değiştir |
| `DNS zaman aşımı` | DNS ulaşılamaz | Farklı sağlayıcı/mod seç |
| `Proxy temizlendi` | Temiz kapanma | — |
| `Kirli kapanma tespit edildi` | Sentinel bulundu | Otomatik temizlendi |
| `Yönetici yetkisi gerekli` | Admin değil | Yönetici olarak çalıştır |

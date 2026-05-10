# Issue Rehberi

Bu rehber, GitHub Issues üzerinden hata bildirimi, özellik isteği ve soru göndermek için izlenmesi gereken adımları açıklar.

---

## Issue Açmadan Önce

1. **[Sorun Giderme](./troubleshooting.md)** belgesini okuyun — sorununuzun cevabı orada olabilir.
2. **Mevcut issue'ları arayın** — aynı sorun daha önce bildirilmiş olabilir.
3. **En güncel sürümü kullandığınızdan emin olun** — sorun zaten düzeltilmiş olabilir.

---

## Issue Türleri

### 🐛 Hata Bildirimi (Bug Report)

Uygulama beklenmedik şekilde davrandığında kullanın.

**Şablon:**

```
**Açıklama**
Hatayı kısaca açıklayın.

**Yeniden Oluşturma Adımları**
1. Şu ayarla başlatın: ...
2. ... düğmesine tıklayın
3. Hata oluştu

**Beklenen Davranış**
Ne olmasını bekliyordunuz?

**Gerçekleşen Davranış**
Ne oldu?

**Ekran Görüntüsü / Log**
Varsa log panelinden kopyalayıp yapıştırın.

**Ortam**
- Windows Sürümü: (örn. Windows 11 23H2)
- BypaxDPI Sürümü: (örn. 1.0.0)
- ISP: (örn. Türk Telekom)
- DPI Modu: (Turbo / Balanced / Strong)
- DNS Modu: (DoH / UDP / System)
- Npcap Kurulu mu?: (Evet / Hayır)
```

---

### 💡 Özellik İsteği (Feature Request)

Mevcut olmayan bir özelliği önermek için kullanın.

**Şablon:**

```
**Özellik Açıklaması**
Ne eklenmesini istiyorsunuz?

**Motivasyon / Kullanım Senaryosu**
Bu özelliğe neden ihtiyaç duyuyorsunuz? Hangi sorunu çözüyor?

**Önerilen Çözüm**
Varsa bir fikriniz: nasıl çalışmasını öngörüyorsunuz?

**Alternatifler**
Şu an nasıl idare ediyorsunuz?
```

---

### ❓ Soru (Question)

Kullanım, kurulum veya yapılandırma hakkında soru sormak için kullanın.

**Şablon:**

```
**Sorum**
Sorunuzu açıkça yazın.

**Ne Denedim**
Belgelerde veya issue'larda aradınız mı? Ne buldunuz?

**Ortam**
- Windows Sürümü:
- BypaxDPI Sürümü:
```

---

### 🌐 Çeviri / Dil Hatası (Translation)

Türkçe veya İngilizce arayüzde yanlış/eksik çeviri bulduğunuzda kullanın.

**Şablon:**

```
**Dil**
Türkçe / İngilizce

**Hatalı Metin**
Ekranda görünen mevcut metin

**Doğru Olması Gereken**
Önerdiğiniz düzeltme

**Ekran Konumu**
Nerede görünüyor? (Örn: Ayarlar → DNS sekmesi)
```

---

### 🔒 Güvenlik Açığı (Security)

**Güvenlik açıklarını kamuya açık issue olarak bildirmeyin.**

Bunun yerine:
- GitHub'ın **Private Security Advisory** özelliğini kullanın.
- Veya proje sahibiyle doğrudan iletişime geçin.

Detaylar için [Güvenlik Modeli](./security.md) belgesine bakın.

---

## Etiketler (Labels)

| Etiket | Anlam |
|--------|-------|
| `bug` | Onaylanmış hata |
| `feature` | Yeni özellik isteği |
| `question` | Soru veya destek talebi |
| `translation` | Çeviri düzeltmesi |
| `good first issue` | Yeni katkıcılar için uygun |
| `help wanted` | Harici yardım aranıyor |
| `wontfix` | Kasıtlı davranış veya kapsam dışı |
| `duplicate` | Daha önce bildirilmiş |
| `needs info` | Daha fazla bilgi bekleniyor |
| `npcap` | Npcap sürücüsüyle ilgili |
| `dns` | DNS yapılandırmasıyla ilgili |
| `lan` | LAN paylaşımıyla ilgili |

---

## Log Nasıl Paylaşılır?

Log panelindeki mesajlar hata tespiti için çok değerlidir. Kopyalarken dikkat edilecekler:

1. Bağlantı kurulumu başından itibaren tüm satırları alın.
2. Kişisel bilgi (IP adresi, kullanıcı adı) içeriyorsa sansürleyin.
3. Kod bloğu olarak yapıştırın:

````
```
[12:34:56] Bağlantı başlatılıyor... (Port: 8080)
[12:34:57] Port 8080 meşgul, 8081 deneniyor...
[12:34:58] SpoofDPI başlatıldı: listening on :8081
[12:34:58] Proxy ayarlandı (127.0.0.1:8081)
```
````

---

## Sistem Bilgisi Nasıl Alınır?

Issue açarken aşağıdaki bilgileri ekleyin:

```powershell
# Windows sürümü
winver

# Ağ adaptörleri (sanal adaptörler dahil)
ipconfig /all | findstr "Adapter\|IPv4"

# Proxy durumu (kirli kapanma şüphesinde)
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer
```

---

## İyi Bir Issue'nun Özellikleri

✅ **Yapın:**
- Başlığı kısa ve açıklayıcı yazın: `Strong mod Npcap olmadan çöküyor` gibi.
- Yeniden oluşturma adımlarını numaralı liste olarak yazın.
- Hangi sürümü kullandığınızı belirtin.
- Log çıktısını ekleyin.
- Bir issue'da tek bir konuya odaklanın.

❌ **Yapmayın:**
- `Çalışmıyor`, `Hata var` gibi belirsiz başlıklar kullanmayın.
- Birden fazla sorunu tek issue'da karıştırmayın.
- Log olmadan hata bildirmeyin.
- Kişisel bilgilerinizi (gerçek IP, şifre) paylaşmayın.

---

## Issue Süreci

```
Issue Açıldı
    │
    ├─ needs info etiketi → Ek bilgi istenir
    │       │
    │       └─ 7 gün içinde yanıt yoksa → kapatılır
    │
    ├─ bug onaylandı → Milestone'a eklenir
    │
    ├─ feature incelendi → Kabul / wontfix
    │
    └─ Düzeltme PR'ı → Merge → Issue kapatılır
```

---

## Katkı Yapmak İstiyorum

Bir bug'ı kendiniz düzeltmek veya özellik eklemek istiyorsanız [Geliştirici Kılavuzu](./developer-guide.md)'na bakın. İyi bir başlangıç noktası için `good first issue` etiketli issue'ları inceleyin.

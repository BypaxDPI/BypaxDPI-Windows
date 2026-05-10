# Güvenlik Modeli

## Genel Bakış

BypaxDPI, birden fazla güvenlik katmanıyla tasarlanmıştır. Bu katmanlar; kullanıcı verilerini, yerel sistemi ve uygulama bütünlüğünü korur.

---

## Tauri Sandbox Kısıtlamaları

### Shell Komut İzinleri

`tauri.conf.json` ve `capabilities/` dosyaları yalnızca belirli ikililerin çalıştırılmasına izin verir:

```json
{
  "permissions": [
    "shell:allow-execute",
    "shell:allow-open"
  ]
}
```

Tauri'nin `shell:allow-execute` izni yalnızca önceden tanımlanmış ikililere uygulanır (`binaries/bypax-proxy`). Frontend, keyfi kabuk komutları çalıştıramaz.

### Dosya Sistemi Erişimi

Uygulama yalnızca `%TEMP%` dizinine doğrudan erişir. Kullanıcı belgelerine veya sistem dizinlerine erişim yoktur.

### Tauri CSP (Content Security Policy)

Gömülü WebView için aşağıdaki CSP uygulanır:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src ipc: http://ipc.localhost;
object-src 'none';
frame-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'none';
worker-src 'none'
```

Bu politika, harici script enjeksiyonunu ve veri sızıntısını engeller.

---

## XSS Koruması

Tüm log mesajları ve kullanıcıdan gelen veriler `DOMPurify` ile filtrelenir:

```js
import DOMPurify from "dompurify";

const clean = DOMPurify.sanitize(userContent, {
  ALLOWED_TAGS: ["strong", "em", "br", "span", "b"],
  ALLOWED_ATTR: ["class"]
});
```

SpoofDPI çıktısı log panelinde `innerHTML` ile render edilmeden önce temizlenir.

---

## Yönetici Yetki Yönetimi

### Yetki Tespiti

`check_admin` komutu WinAPI ile çalışır:

```rust
unsafe {
    OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token);
    GetTokenInformation(token, TokenElevation, ...);
}
```

### Yetki Gerektiren İşlemler

- Windows Registry proxy ayarları (`ProxyEnable`, `ProxyServer`)
- `netsh winhttp` komutları
- Güvenlik duvarı kuralları
- Npcap sürücü kurulumu

Uygulama admin yetkisi olmadan çalışırsa uyarı görüntüler; proxy ayarlaması başarısız olur.

---

## Proxy Güvenlik Katmanları

### Bypass Listesi

Kritik Windows servisleri ve oyun platformları proxy'den muaf tutulur:

```
Yerel ağ:    <local>, 10.*, 172.16-31.*, 192.168.*
Microsoft:   *.windowsupdate.com, *.microsoft.com, msftncsi.com
Oyun:        *.steam*, *.epicgames.com, *.riotgames.com
CDN:         *.cachefly.net
```

Bu liste istemeden Windows Update'i veya oyun içi kimlik doğrulamayı bozmayı engeller.

### WinHTTP Ayrımı

`enableWinhttp = true` (Oyun Modu) etkinleştirildiğinde:
- Sistem proxy'si (WinINET katmanı) güncellenir
- WinHTTP katmanı da güncellenir (`netsh winhttp set proxy`)
- UWP loopback muafiyeti aktif edilir (PowerShell ile)

Bu üç adım, hem tarayıcı tabanlı hem de C++ oyun motorlarının proxy'yi kullanmasını sağlar.

---

## Sentinel Anti-Crash Koruması

Sistem çökmesi veya zorla kapatma durumunda proxy Registry'de kalabilir. Bunu önlemek için:

### Yazma

```rust
let sentinel = sentinel_path(); // %TEMP%\bypaxdpi_proxy_active.lock
fs::write(&sentinel, b"active").ok();
```

### Okuma (Başlangıç)

```rust
if sentinel.exists() {
    // Kirli kapanma tespit edildi
    clear_system_proxy();
    Command::new("ipconfig").args(["/flushdns"]).output().ok();
    remove_firewall_rules();
    fs::remove_file(&sentinel).ok();
}
```

### Panic İşleyici (`main.rs`)

Rust panic'i yakalanır ve aşağıdaki acil temizlik yapılır:

```rust
std::panic::set_hook(Box::new(|_| {
    // ProxyEnable'ı 0'a çek (sil değil — reg add /d 0)
    Command::new("reg").args([
        "add",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f",
    ]).creation_flags(CREATE_NO_WINDOW).status();

    // ProxyServer değerini boşalt
    Command::new("reg").args([
        "add",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        "/v", "ProxyServer", "/t", "REG_SZ", "/d", "", "/f",
    ]).creation_flags(CREATE_NO_WINDOW).status();

    // Zombie süreci sonlandır
    Command::new("taskkill")
        .args(["/F", "/IM", "bypax-proxy.exe"])
        .output().ok();
}));
```

---

## Tek Örnek Zorlaması

Yalnızca bir uygulama örneği çalışabilir. Windows Global Mutex kullanılır:

```rust
let mutex_name: Vec<u16> = "Global\\BypaxDPI_SingleInstance\0".encode_utf16().collect();
let handle = CreateMutexW(null_mut(), 0, mutex_name.as_ptr());
if handle.is_null() || GetLastError() == ERROR_ALREADY_EXISTS {
    // Mevcut pencereyi ön plana getir ve bu örneği sessizce kapat
    focus_existing_window();
    return;
}
```

Bu mekanizma, aynı anda iki proxy örneğinin çalışmasını engeller.

---

## DNS Güvenliği

### DoH (DNS-over-HTTPS)

DNS sorgularının ISP tarafından ele geçirilmesini önler. Uç noktalara domain yerine IP ile bağlanılır:

```js
// constants.js
DOH_ENDPOINTS: {
  cloudflare: "https://1.1.1.1/dns-query",   // domain değil IP
  google:     "https://8.8.8.8/dns-query",
  adguard:    "https://94.140.14.14/dns-query"
}
```

Domain kullanılsaydı, DoH isteği kendisi ISP DNS'ine bağımlı olurdu (bootstrap sorunu).

---

## PAC Sunucu Güvenliği

- Maksimum **50 eş zamanlı bağlantı** (DDoS koruması)
- Yalnızca `/pac` yoluna yanıt verilir
- Dinleme adresi `0.0.0.0` (LAN erişimi için gerekli); internet'e açık port yönlendirmesi yapılmamalı

---

## Güvenlik Açığı Bildirimi

Güvenlik açığı tespitinde:
1. GitHub Issues'a **gizli** olarak bildirin veya
2. Proje sahibiyle doğrudan iletişime geçin.

Kamuya açıklama yapmadan önce makul bir düzeltme süresi tanınması beklenir.

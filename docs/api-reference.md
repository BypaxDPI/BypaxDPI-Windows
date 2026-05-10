# API Referansı

Bu belge, `src-tauri/src/lib.rs` içinde tanımlanan Tauri komutlarını, Registry anahtarlarını ve PAC sunucu formatını kapsar.

---

## Tauri Komutları

Frontend, `invoke()` ile bu komutları çağırır:

```js
import { invoke } from "@tauri-apps/api/core";
```

---

### `set_system_proxy`

Windows sistem proxy'sini etkinleştirir.

```ts
invoke("set_system_proxy", {
  port: number,          // Proxy portu (8080–8090 arası veya sistem ataması)
  enableWinhttp: boolean // WinHTTP katmanını da güncelle (oyun modu)
}): Promise<void>
```

**Yaptıkları:**
1. `HKCU\...\Internet Settings\ProxyServer` → `127.0.0.1:<port>`
2. `ProxyEnable` → `1`
3. `ProxyOverride` → bypass listesi
4. `enableWinhttp = true` ise: `netsh winhttp set proxy` çalıştırır ve UWP loopback muafiyeti ekler.

---

### `clear_system_proxy`

Proxy ayarlarını kaldırır ve orijinal ayarları geri yükler.

```ts
invoke("clear_system_proxy"): Promise<void>
```

**Yaptıkları:**
1. `ProxyEnable` → `0`
2. `ProxyServer` temizle
3. `AutoConfigURL` temizle
4. Daha önce yedeklenmiş kurumsal proxy varsa geri yükle
5. WinHTTP proxy'sini sıfırla

---

### `get_sidecar_config`

SpoofDPI başlatmak için port ve LAN IP bilgisini döner.

```ts
invoke("get_sidecar_config", {
  allowLanSharing: boolean,
  enableGameMode: boolean
}): Promise<{
  port: number,         // Kullanılabilir port (8080–8090; hepsi doluysa sistem ataması)
  lan_ip: string,       // Gerçek LAN IP adresi
  bind_address: string  // "0.0.0.0" (LAN/oyun modu) veya "127.0.0.1"
}>
```

Port tespiti: 8080–8090 aralığını sırayla dener; hepsi doluysa OS'tan rastgele port ister.

---

### `check_port_open`

Verilen portun TCP üzerinde dinlenip dinlenmediğini kontrol eder.

```ts
invoke("check_port_open", { port: number }): Promise<boolean>
```

---

### `check_admin`

Uygulamanın yönetici yetkileriyle çalışıp çalışmadığını döner.

```ts
invoke("check_admin"): Promise<boolean>
```

WinAPI `OpenProcessToken` + `TokenElevation` kullanır.

---

### `check_driver`

Npcap sürücüsünün kurulu olup olmadığını döner.

```ts
invoke("check_driver"): Promise<boolean>
```

`wpcap.dll` dosyasının `System32`'de varlığını kontrol eder.

---

### `install_driver`

Npcap kurulum dosyasını başlatır.

```ts
invoke("install_driver"): Promise<void>
```

---

### `check_dns_latency`

Belirtilen DNS sunucusuna TCP bağlantı gecikmesini ölçer.

```ts
invoke("check_dns_latency", {
  dnsIp: string   // Örn: "1.1.1.1"
}): Promise<number>  // Gecikme ms cinsinden; ulaşılamazsa 9999
```

Port 53 üzerinden TCP bağlantısıyla ölçülür (ICMP admin yetkisi gerektirdiğinden kullanılmaz). Güvenlik için yalnızca `DNS_MAP`'te tanımlı bilinen IP'ler kabul edilir; bilinmeyen bir IP iletilirse hata döner.

---

### `startup_proxy_cleanup`

Uygulama açılışında kirli kapanma tespiti yaparak temizlik başlatır.

```ts
invoke("startup_proxy_cleanup"): Promise<boolean>
// true: Temizlik yapıldı (sentinel bulundu)
// false: Temiz başlangıç
```

**Kirli kapanma tespitinde:**
1. Registry proxy'sini temizle
2. `ipconfig /flushdns` çalıştır
3. Firewall kurallarını kaldır
4. Sentinel dosyasını sil

---

### `update_tray_tooltip`

Sistem tepsisi simgesinin tooltip metnini günceller.

```ts
invoke("update_tray_tooltip", { tooltip: string }): Promise<void>
```

---

### `kill_zombie_sidecar`

Arka planda kalmış `bypax-proxy.exe` süreçlerini sonlandırır.

```ts
invoke("kill_zombie_sidecar"): Promise<string>
// Dönen string: işlem özeti
```

---

### `start_pac_server`

PAC HTTP sunucusunu başlatır.

```ts
invoke("start_pac_server", {
  proxyPort: number
}): Promise<{
  pacPort: number,  // Dinlenen port (8787–8887)
  pacUrl: string    // Tam URL: http://<LAN_IP>:<port>/pac
}>
```

---

### `stop_pac_server`

PAC sunucusunu kapatmaz; PAC içeriğini `DIRECT` moduna geçirir. Böylece LAN cihazları internet erişimini kaybetmez.

```ts
invoke("stop_pac_server"): Promise<void>
```

---

### `save_sidecar_pid`

SpoofDPI sürecinin PID değerini `%TEMP%\bypaxdpi_sidecar.pid` dosyasına yazar.

```ts
invoke("save_sidecar_pid", { pid: number }): Promise<void>
```

---

### `quit_app`

Uygulamayı temiz biçimde kapatır (`perform_app_exit` çalışır: proxy temizlenir, sentinel silinir).

```ts
invoke("quit_app"): Promise<void>
```

---

## Windows Registry Anahtarları

Tüm proxy ayarları şu yol altındadır:

```
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
```

| Değer | Tür | İçerik |
|-------|-----|--------|
| `ProxyEnable` | DWORD | `1` = etkin, `0` = devre dışı |
| `ProxyServer` | String | `127.0.0.1:<port>` |
| `ProxyOverride` | String | Semicolon ayrılmış bypass listesi |
| `AutoConfigURL` | String | PAC URL (LAN paylaşımı aktifken) |

### Proxy Bypass Listesi

```
<local>;localhost;127.*;10.*;172.16.*;172.17.*; ... ;*.windowsupdate.com;
*.steam*;*.epicgames.com;*.riotgames.com; ...
```

Tam liste `lib.rs` içindeki `registry::set_proxy()` fonksiyonunda satır içi tanımlıdır.

---

## PAC Dosya Formatı

PAC sunucu `/pac` yolunda aşağıdaki formatta bir JavaScript dosyası sunar:

### Bağlantı Aktifken

```javascript
function FindProxyForURL(url, host) {
  // 1) Localhost ve yerel adresler
  if (isPlainHostName(host) || host === "localhost" ||
      shExpMatch(host, "127.*") ||
      shExpMatch(host, "10.*") ||
      shExpMatch(host, "192.168.*") ||
      shExpMatch(host, "172.16.*") || shExpMatch(host, "172.17.*") ||
      shExpMatch(host, "*.local") || shExpMatch(host, "*.internal"))
    return "DIRECT";

  // 2) OS Connectivity Check (sarı WiFi ikonu engelleme)
  if (shExpMatch(host, "*.msftconnecttest.com") ||
      shExpMatch(host, "*.msftncsi.com") ||
      host === "connectivitycheck.gstatic.com" ||
      shExpMatch(host, "*.windowsupdate.com"))
    return "DIRECT";

  // Diğer tüm trafik → proxy; proxy yoksa doğrudan bağlan
  return "PROXY 192.168.x.x:8080; DIRECT";
}
```

### Bağlantı Kesildiğinde

```javascript
function FindProxyForURL(url, host) {
  return "DIRECT";
}
```

---

## SpoofDPI Komut Satırı Argümanları

`App.jsx` içindeki `startEngine()` fonksiyonu aşağıdaki argümanlarla sidecar'ı başlatır:

| Argüman | Örnek | Açıklama |
|---------|-------|----------|
| `-port` | `8080` | Proxy dinleme portu |
| `-dns` | `1.1.1.1` | DNS sunucu IP |
| `-doh` | `https://1.1.1.1/dns-query` | DoH uç noktası (DoH modunda) |
| `-dns-type` | `doh` / `udp` / `system` | DNS modu |
| `-http-chunk-size` | `4` | HTTP chunk boyutu (bayt) |
| `-https-chunk-size` | `4` | HTTPS chunk boyutu (bayt) |
| `-window-size` | `1` | Pencere boyutu (Strong modda) |
| `-dns-qtype` | `ipv4` | IPv4-only DNS (isteğe bağlı) |
| `-timeout` | `5000` | Bağlantı zaman aşımı (ms) |

---

## Tauri Olayları (Events)

Frontend, backend'den aşağıdaki olayları dinler:

```js
import { listen } from "@tauri-apps/api/event";

// Örnek
await listen("proxy-status-changed", (event) => {
  console.log(event.payload);
});
```

| Olay | Payload | Tetiklenme |
|------|---------|-----------|
| `tauri://window-created` | — | Pencere oluşturulduğunda |
| `tauri://close-requested` | — | Pencere kapatma isteği |

SpoofDPI çıktısı doğrudan Tauri `Command` API'si aracılığıyla `onStdout` / `onStderr` callback'leriyle alınır; ayrı bir event gerekmez.

---

## Geçici Dosyalar

| Yol | Amaç |
|-----|------|
| `%TEMP%\bypaxdpi_proxy_active.lock` | Sentinel: proxy aktif |
| `%TEMP%\bypaxdpi_sidecar.pid` | SpoofDPI süreç ID |

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use local_ip_address::list_afinet_netifas;
use std::io::Write;
use std::net::{IpAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;

// ═══════════════════════════════════════════════════════════════════
// P0-FIX-1: Sentinel dosyası sistemi — crash sonrası proxy kurtarma
// P0-FIX-2: Orijinal proxy ayarları yedekleme / geri yükleme
// ═══════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
mod registry {
    use winreg::enums::*;
    use winreg::RegKey;

    const INTERNET_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    pub fn read_value_string(name: &str) -> Option<String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.open_subkey(INTERNET_SETTINGS).ok()?;
        let val: String = key.get_value(name).ok()?;
        Some(val)
    }

    pub fn read_value_dword(name: &str) -> Option<u32> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.open_subkey(INTERNET_SETTINGS).ok()?;
        key.get_value(name).ok()
    }

    pub fn set_proxy(proxy_addr: &str, port: u16) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(INTERNET_SETTINGS)
            .map_err(|e| format!("Registry açılamadı: {}", e))?;

        key.set_value("ProxyServer", &format!("{}:{}", proxy_addr, port))
            .map_err(|e| format!("ProxyServer: {}", e))?;
        key.set_value("ProxyEnable", &1u32)
            .map_err(|e| format!("ProxyEnable: {}", e))?;
        let proxy_override = [
            "<local>",
            // ✅ FIX: LAN IP aralıkları — olmazsa tarayıcı LAN'daki PAC sunucusuna
            //    SpoofDPI proxy üzerinden gider → döngü → timeout
            "10.*",
            "172.16.*",
            "172.17.*",
            "172.18.*",
            "172.19.*",
            "172.20.*",
            "172.21.*",
            "172.22.*",
            "172.23.*",
            "172.24.*",
            "172.25.*",
            "172.26.*",
            "172.27.*",
            "172.28.*",
            "172.29.*",
            "172.30.*",
            "172.31.*",
            "192.168.*",
            // NCSI — WiFi "internet yok" simgesi fix
            "*.msftconnecttest.com",
            "*.msftncsi.com",
            "dns.msn.com",
            "ipv6.msftconnecttest.com",
            // Android/iOS connectivity check
            "connectivitycheck.gstatic.com",
            "connectivitycheck.android.com",
            "clients3.google.com",
            "play.googleapis.com",
            "captive.apple.com",
            "gsp1.apple.com",
            "connectivitycheck.samsung.com",
            // Windows Update
            "*.windowsupdate.com",
            "*.delivery.mp.microsoft.com",
            // ── Oyun & Uygulama Launcher/Updater Bypass ──
            // Bu domainler DPI ile engellenmez ama bazı uygulamaların C++ HTTP
            // istemcileri SpoofDPI'nin TLS parçalamasıyla uyumsuz çalışabilir.
            // Bypass ile direkt bağlansınlar, oyun/uygulama trafiği proxy'den geçsin.
            //
            // Steam
            "*.steamcontent.com",
            "*.steamstatic.com",
            "clientconfig.akamai.steamstatic.com",
            "*.cm.steampowered.com",
            // Epic Games
            "*.epicgames.com",
            "*.unrealengine.com",
            "download.epicgames.com",
            "launcher-public-service-prod06.ol.epicgames.com",
            // Riot Games (LoL, Valorant)
            "*.riotgames.com",
            "*.leagueoflegends.com",
            "riotgames-update.akamaized.net",
            // EA / Origin
            "*.ea.com",
            "*.origin.com",
            // Blizzard / Battle.net
            "*.blizzard.com",
            "*.battle.net",
            "blzddist1-a.akamaihd.net",
            // Ubisoft
            "*.ubisoft.com",
            "*.ubi.com",
            // Microsoft / Xbox
            "*.xboxlive.com",
            "*.xbox.com",
            "*.microsoft.com",
            // Genel CDN'ler (installer/updater dağıtımı)
            "*.cachefly.net",
        ]
        .join(";");
        key.set_value("ProxyOverride", &proxy_override)
            .map_err(|e| format!("ProxyOverride: {}", e))?;
        Ok(())
    }

    pub fn clear_proxy() -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(INTERNET_SETTINGS)
            .map_err(|e| format!("Registry açılamadı: {}", e))?;

        key.set_value("ProxyEnable", &0u32)
            .map_err(|e| format!("ProxyEnable: {}", e))?;
        let _ = key.delete_value("ProxyServer");
        let _ = key.delete_value("ProxyOverride");
        let _ = key.delete_value("AutoConfigURL");
        Ok(())
    }

    pub fn restore_proxy(
        server: &str,
        enable: u32,
        override_val: Option<&str>,
    ) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(INTERNET_SETTINGS)
            .map_err(|e| format!("Registry açılamadı: {}", e))?;

        key.set_value("ProxyServer", &server)
            .map_err(|e| format!("ProxyServer: {}", e))?;
        key.set_value("ProxyEnable", &enable)
            .map_err(|e| format!("ProxyEnable: {}", e))?;
        if let Some(ov) = override_val {
            key.set_value("ProxyOverride", &ov)
                .map_err(|e| format!("ProxyOverride: {}", e))?;
        }
        Ok(())
    }

    pub fn can_access() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey(INTERNET_SETTINGS).is_ok()
    }
}

#[cfg(target_os = "macos")]
mod proxy_macos {
    use std::process::Command;

    #[derive(Debug, Clone)]
    pub struct ServiceProxy {
        pub service: String,
        pub web_enabled: bool,
        pub web_server: String,
        pub web_port: u16,
        pub https_enabled: bool,
        pub https_server: String,
        pub https_port: u16,
    }

    pub fn list_services() -> Vec<String> {
        Command::new("networksetup")
            .arg("-listallnetworkservices")
            .output()
            .map(|out| {
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .filter(|l| !l.contains("asterisk") && !l.trim().is_empty())
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default()
    }

    fn parse_proxy_fields(output: &str) -> (String, u16, bool) {
        let mut server = String::new();
        let mut port = 0u16;
        let mut enabled = false;
        for line in output.lines() {
            let line = line.trim();
            if let Some(v) = line.strip_prefix("Server: ") {
                server = v.to_string();
            } else if let Some(v) = line.strip_prefix("Port: ") {
                port = v.parse().unwrap_or(0);
            } else if let Some(v) = line.strip_prefix("Enabled: ") {
                enabled = v == "Yes";
            }
        }
        (server, port, enabled)
    }

    pub fn get_service_proxy(service: &str) -> ServiceProxy {
        let web_out = Command::new("networksetup")
            .args(&["-getwebproxy", service])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        let (web_server, web_port, web_enabled) = parse_proxy_fields(&web_out);

        let https_out = Command::new("networksetup")
            .args(&["-getsecurewebproxy", service])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        let (https_server, https_port, https_enabled) = parse_proxy_fields(&https_out);

        ServiceProxy {
            service: service.to_string(),
            web_enabled,
            web_server,
            web_port,
            https_enabled,
            https_server,
            https_port,
        }
    }

    pub fn set_proxy(port: u16) -> Result<(), String> {
        let services = list_services();
        if services.is_empty() {
            return Err("Ağ servisi bulunamadı".to_string());
        }
        for service in &services {
            let port_str = port.to_string();
            let _ = Command::new("networksetup")
                .args(&["-setwebproxy", service, "127.0.0.1", &port_str])
                .status();
            let _ = Command::new("networksetup")
                .args(&["-setsecurewebproxy", service, "127.0.0.1", &port_str])
                .status();
        }
        Ok(())
    }

    pub fn clear_proxy() -> Result<(), String> {
        for service in list_services() {
            let _ = Command::new("networksetup")
                .args(&["-setwebproxystate", &service, "off"])
                .status();
            let _ = Command::new("networksetup")
                .args(&["-setsecurewebproxystate", &service, "off"])
                .status();
        }
        Ok(())
    }

    pub fn can_access() -> bool {
        Command::new("networksetup")
            .arg("-listallnetworkservices")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Sentinel dosya yolu — proxy aktifken var, kapanınca silinir.
/// Crash/BSOD/force-kill sonrası hâlâ duruyorsa → dirty shutdown algılanır.
fn sentinel_path() -> std::path::PathBuf {
    std::env::temp_dir().join("bypaxdpi_proxy_active.lock")
}

/// PAC dosyası yolu — AutoConfigURL ile proxy yapılandırması için

/// Orijinal proxy ayarlarını tutan yapı
#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
struct OriginalProxySettings {
    proxy_enable: Option<u32>,
    proxy_server: Option<String>,
    proxy_override: Option<String>,
}

/// Orijinal proxy ayarlarını saklayan global state
fn original_proxy_store() -> &'static Mutex<Option<OriginalProxySettings>> {
    static STORE: OnceLock<Mutex<Option<OriginalProxySettings>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "macos")]
fn macos_proxy_store() -> &'static Mutex<Option<Vec<proxy_macos::ServiceProxy>>> {
    static STORE: OnceLock<Mutex<Option<Vec<proxy_macos::ServiceProxy>>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "macos")]
fn backup_proxy_settings_macos() {
    let services = proxy_macos::list_services();
    let backups: Vec<proxy_macos::ServiceProxy> = services
        .iter()
        .map(|s| proxy_macos::get_service_proxy(s))
        .collect();
    if let Ok(mut guard) = macos_proxy_store().lock() {
        if guard.is_none() {
            eprintln!("[PROXY-BACKUP] macOS proxy yedeklendi: {} servis", backups.len());
            *guard = Some(backups);
        }
    }
}

#[cfg(target_os = "macos")]
fn restore_proxy_settings_macos() -> bool {
    let original = match macos_proxy_store().lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };

    if let Some(backups) = original {
        let mut restored = false;
        for b in &backups {
            if b.web_enabled && !b.web_server.is_empty() && !b.web_server.starts_with("127.0.0.1") {
                eprintln!("[PROXY-RESTORE] macOS: {} geri yükleniyor", b.service);
                let _ = std::process::Command::new("networksetup")
                    .args(&["-setwebproxy", &b.service, &b.web_server, &b.web_port.to_string()])
                    .status();
                let _ = std::process::Command::new("networksetup")
                    .args(&["-setwebproxystate", &b.service, "on"])
                    .status();
                if b.https_enabled && !b.https_server.is_empty() {
                    let _ = std::process::Command::new("networksetup")
                        .args(&["-setsecurewebproxy", &b.service, &b.https_server, &b.https_port.to_string()])
                        .status();
                    let _ = std::process::Command::new("networksetup")
                        .args(&["-setsecurewebproxystate", &b.service, "on"])
                        .status();
                }
                restored = true;
            }
        }
        return restored;
    }
    false
}

/// Proxy ayarlarını set etmeden ÖNCE mevcut değerleri yedekler
#[cfg(target_os = "windows")]
fn backup_proxy_settings() {
    let settings = OriginalProxySettings {
        proxy_enable: registry::read_value_dword("ProxyEnable"),
        proxy_server: registry::read_value_string("ProxyServer"),
        proxy_override: registry::read_value_string("ProxyOverride"),
    };

    if let Ok(mut guard) = original_proxy_store().lock() {
        // Sadece ilk backup'ı al — sonraki set_system_proxy çağrıları üzerine yazmasın
        if guard.is_none() {
            eprintln!("[PROXY-BACKUP] Orijinal ayarlar yedeklendi: {:?}", settings);
            *guard = Some(settings);
        }
    }
}

/// Yedeklenen proxy ayarlarını geri yükler.
/// Eğer orijinal ayarlarda proxy aktifse → geri yükle
/// Eğer orijinal ayarlarda proxy yoksa → sil (mevcut davranış)
#[cfg(target_os = "windows")]
fn restore_proxy_settings() -> bool {
    let original = match original_proxy_store().lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => {
            eprintln!("[WARN] proxy backup lock poisoned, recovering");
            poisoned.into_inner().clone()
        }
    };

    if let Some(orig) = original {
        // Orijinal ProxyServer varsa geri yükle (kurumsal proxy koruması)
        if let Some(ref server) = orig.proxy_server {
            if !server.is_empty() && !server.starts_with("127.0.0.1:") {
                eprintln!("[PROXY-RESTORE] Kurumsal proxy geri yükleniyor: {}", server);

                let enable_val = orig.proxy_enable.unwrap_or(0);
                let _ = registry::restore_proxy(server, enable_val, orig.proxy_override.as_deref());

                return true; // Geri yükleme yapıldı, silme işlemine geçme
            }
        }
    }
    // Orijinal proxy yoktu veya bizimkiyle aynıydı → normal silme prosedürü (mevcut davranış)
    false
}

/// Sanal ağ adaptörlerini filtreleyen akıllı LAN IP bulucu.
/// VirtualBox, VMware, Hamachi, VPN gibi sanal adaptörleri atlar.
fn get_safe_lan_ip() -> String {
    // Filtrelenecek sanal adaptör anahtar kelimeleri (küçük harf)
    const VIRTUAL_KEYWORDS: &[&str] = &[
        "virtual",
        "vmware",
        "vmnet",
        "vbox",
        "virtualbox",
        "pseudo",
        "hamachi",
        "vpn",
        "vethernet",
        "loopback",
        "docker",
        "wsl",
        "hyper-v",
        "bluetooth",
        "teredo",
        "isatap",
        "6to4",
        "tap-",
        "tun",
        "warp",
        "tailscale",
        "zerotier",
        "nordlynx",
        "wireguard",
        "proton",
        "mullvad",
        "windscribe",
        "surfshark",
        "host-only",
        "hostonly",
        "vEthernet",
        "npcap",
        "miniport",
    ];

    /// Bilinen sanal ağ IP aralıklarını kontrol eder.
    /// Adaptör adı filtreleri yakalayamadığında (Windows generic isimlendirme) bu devreye girer.
    fn is_virtual_ip_range(ip: &std::net::Ipv4Addr) -> bool {
        let octets = ip.octets();
        match (octets[0], octets[1]) {
            // VirtualBox Host-Only: 192.168.56.x (varsayılan)
            (192, 168) if octets[2] == 56 => true,
            // VMware NAT: 192.168.19x.x
            (192, 168) if octets[2] >= 190 => true,
            // Docker default bridge: 172.17.x.x
            (172, 17) => true,
            // WSL: 172.x.x.x (genellikle 172.16-31 arası ama 172.17+ sanal olma ihtimali yüksek)
            // Hamachi: 25.x.x.x
            (25, _) => true,
            // APIPA (otomatik atanmış, ağ bağlantısı yok): 169.254.x.x
            (169, 254) => true,
            _ => false,
        }
    }

    if let Ok(netifs) = list_afinet_netifas() {
        // Debug: Tüm arayüzleri logla (sorun tespiti için)
        for (name, ip) in &netifs {
            eprintln!("[NET-DEBUG] Interface: '{}' → {}", name, ip);
        }

        // PASS 1: Gerçek adaptör + gerçek IP aralığı
        for (name, ip) in &netifs {
            if let IpAddr::V4(v4) = ip {
                if v4.is_loopback() || v4.is_link_local() {
                    continue;
                }
                let name_lower = name.to_lowercase();
                let is_virtual_name = VIRTUAL_KEYWORDS.iter().any(|kw| name_lower.contains(kw));
                let is_virtual_range = is_virtual_ip_range(v4);

                if !is_virtual_name && !is_virtual_range {
                    eprintln!(
                        "[NET-SELECT] ✅ Gerçek adaptör seçildi: '{}' → {}",
                        name, v4
                    );
                    return v4.to_string();
                }
            }
        }

        // PASS 2: Fallback — ad filtresi atlayıp sadece IP aralığı kontrol et
        for (name, ip) in &netifs {
            if let IpAddr::V4(v4) = ip {
                if !v4.is_loopback() && !v4.is_link_local() && !is_virtual_ip_range(v4) {
                    eprintln!("[NET-SELECT] ⚠️ Fallback adaptör: '{}' → {}", name, v4);
                    return v4.to_string();
                }
            }
        }

        // PASS 3: Son çare — sanal bile olsa bir IP ver (sadece loopback olmasın)
        for (_, ip) in &netifs {
            if let IpAddr::V4(v4) = ip {
                if !v4.is_loopback() {
                    return v4.to_string();
                }
            }
        }
    }

    "127.0.0.1".to_string()
}

/// Basit string hash — PAC body değişti mi kontrolü için
fn simple_hash(s: &str) -> u64 {
    let mut h: u64 = 5381;
    for b in s.bytes() {
        h = h.wrapping_mul(33).wrapping_add(b as u64);
    }
    h
}

/// Ön-derlenmiş PAC HTTP yanıtı — her istekte format! çağırmaz
pub struct PacCache {
    pub pac_response: Vec<u8>,
    pub body_hash: u64,
}

/// PAC sunucusu durumu: thread handle + shutdown flag + dinamik body
pub struct PacServerState {
    pub join_handle: Mutex<Option<thread::JoinHandle<()>>>,
    pub shutdown: Arc<AtomicBool>,
    pub pac_body: Arc<Mutex<String>>,
    pub pac_cache: Arc<Mutex<PacCache>>,
    pub pac_port: Mutex<u16>,
    pub pac_url: Mutex<String>,
}

impl Default for PacServerState {
    fn default() -> Self {
        Self {
            join_handle: Mutex::new(None),
            shutdown: Arc::new(AtomicBool::new(false)),
            pac_body: Arc::new(Mutex::new(make_pac_direct_body())),
            pac_cache: Arc::new(Mutex::new(PacCache {
                pac_response: Vec::new(),
                body_hash: 0,
            })),
            pac_port: Mutex::new(0),
            pac_url: Mutex::new(String::new()),
        }
    }
}

const PAC_PORT_START: u16 = 8787;
const PAC_PORT_END: u16 = 8887;
const SUPPORT_URL: &str = "https://www.patreon.com/join/ConsolAktif";

/// Bağlantı kesildiğinde kullanılan fallback PAC: tüm trafiği DIRECT yönlendirir
/// Bu sayede cihazlar internet erişimini kaybetmez
fn make_pac_direct_body() -> String {
    r#"function FindProxyForURL(url, host) {
    // BypaxDPI proxy devre dışı — tüm trafik doğrudan çıkış
    // Bu PAC dosyası otomatik olarak sunulur; ayar değişikliği gerekmez
    return "DIRECT";
}
"#
    .to_string()
}

/// Production PAC: yerel ağ DIRECT, diğerleri PROXY ip:port; DIRECT (fail-safe)
/// dnsResolve çağrıları try-catch ile korunuyor — DNS timeout olursa PAC script çökmez
fn make_pac_body(lan_ip: &str, proxy_port: u16) -> String {
    let proxy = format!("{}:{}", lan_ip, proxy_port);
    format!(
        r#"function FindProxyForURL(url, host) {{
    // 1) Localhost & plain hostnames → DIRECT (anında, DNS yok)
    if (isPlainHostName(host) ||
        host === "localhost" ||
        shExpMatch(host, "127.*") ||
        shExpMatch(host, "10.*") ||
        shExpMatch(host, "192.168.*") ||
        shExpMatch(host, "172.16.*") || shExpMatch(host, "172.17.*") ||
        shExpMatch(host, "172.18.*") || shExpMatch(host, "172.19.*") ||
        shExpMatch(host, "172.2?.*") || shExpMatch(host, "172.30.*") ||
        shExpMatch(host, "172.31.*") ||
        shExpMatch(host, "*.local") ||
        shExpMatch(host, "*.localhost") ||
        shExpMatch(host, "*.internal"))
        return "DIRECT";

    // 2) OS Connectivity Check domainleri → DIRECT
    //    Bu olmazsa Windows/Android/iOS "internet yok" simgesi gösterir
    if (shExpMatch(host, "*.msftconnecttest.com") ||
        shExpMatch(host, "*.msftncsi.com") ||
        host === "dns.msn.com" ||
        host === "ipv6.msftconnecttest.com" ||
        host === "connectivitycheck.gstatic.com" ||
        host === "connectivitycheck.android.com" ||
        host === "clients3.google.com" ||
        host === "play.googleapis.com" ||
        host === "captive.apple.com" ||
        host === "gsp1.apple.com" ||
        host === "connectivitycheck.samsung.com" ||
        shExpMatch(host, "*.windowsupdate.com") ||
        shExpMatch(host, "*.delivery.mp.microsoft.com"))
        return "DIRECT";

    // NOT: Oyun/uygulama launcher bypass'ı burada YOK!
    // PAC server telefon/LAN cihazlarına hizmet eder — bu cihazlarda DPI engeli aktif,
    // bu yüzden oyun trafiği proxy üzerinden geçmeli.
    // Windows masaüstünde ise Registry ProxyOverride + WinHTTP bypass ile çözülür.

    return "PROXY {}; DIRECT";
}}"#,
        proxy
    )
}

fn make_setup_html(pac_url: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
<title>BypaxDPI – Kurulum</title>
<style>
:root {{
    --bg-color: #09090b;
    --card-bg: #18181b;
    --primary: #3b82f6;
    --primary-hover: #2563eb;
    --success: #22c55e;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --border: rgba(255,255,255,0.08);
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-tap-highlight-color: transparent; }}
body {{ background-color: var(--bg-color); color: var(--text-main); line-height: 1.5; padding: 20px 16px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }}
.container {{ width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 20px; }}

/* Header */
.header {{ text-align: center; margin-bottom: 10px; animation: fadeDown 0.6s ease; }}
.title {{ font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 4px; }}
.subtitle {{ font-size: 0.9rem; color: var(--text-muted); }}

/* Card */
.card {{ background: var(--card-bg); border: 1px solid var(--border); border-radius: 20px; padding: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); animation: fadeUp 0.6s ease; }}
.card-title {{ font-size: 1.05rem; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }}

/* Input Group */
.input-group {{ position: relative; margin-bottom: 16px; }}
.url-input {{ width: 100%; background: #27272a; border: 1px solid #3f3f46; color: var(--text-main); font-size: 0.9rem; padding: 14px 16px; border-radius: 12px; outline: none; transition: border-color 0.2s; -webkit-user-select: all; user-select: all; }}
.url-input:focus {{ border-color: var(--primary); }}

/* Copy Button */
.btn-copy {{ width: 100%; height: 50px; background: var(--primary); color: #fff; font-size: 1.05rem; font-weight: 600; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(59,130,246,0.3); }}
.btn-copy:active {{ transform: scale(0.98); }}
.btn-copy.success {{ background: var(--success); box-shadow: 0 4px 12px rgba(34,197,94,0.3); }}

/* Guide Button */
.btn-guide {{ display: inline-flex; align-items: center; justify-content: center; background: var(--success); color: #fff; text-decoration: none; padding: 12px 16px; border-radius: 12px; font-size: 0.9rem; font-weight: 600; border: none; width: 100%; margin-top: 12px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(34,197,94,0.3); }}
.btn-guide:active {{ transform: scale(0.98); opacity: 0.9; }}

/* Steps */
.step-list {{ list-style: none; counter-reset: custom-counter; margin-top: 10px; display: flex; flex-direction: column; gap: 12px; }}
.step-item {{ position: relative; padding-left: 36px; font-size: 0.9rem; color: #a1a1aa; }}
.step-item::before {{ content: counter(custom-counter); counter-increment: custom-counter; position: absolute; left: 0; top: -1px; width: 24px; height: 24px; background: rgba(255,255,255,0.1); color: #fff; font-size: 0.75rem; font-weight: 600; display: flex; align-items: center; justify-content: center; border-radius: 50%; }}
.step-item strong {{ color: #e2e8f0; font-weight: 600; display: block; margin-bottom: 2px; }}

/* Language Switcher */
.lang-switcher {{ display: flex; justify-content: center; gap: 12px; margin-bottom: 8px; animation: fadeDown 0.6s ease; }}
.lang-btn {{ background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: #fff; padding: 6px 16px; border-radius: 10px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; font-weight: 500; }}
.lang-btn.active {{ background: var(--primary); border-color: var(--primary); font-weight: 700; box-shadow: 0 0 15px rgba(59,130,246,0.3); }}

/* Divider */
.divider {{ height: 1px; background: var(--border); margin: 24px 0; }}

/* Animations */
@keyframes fadeUp {{ from {{ opacity: 0; transform: translateY(15px); }} to {{ opacity: 1; transform: translateY(0); }} }}
@keyframes fadeDown {{ from {{ opacity: 0; transform: translateY(-15px); }} to {{ opacity: 1; transform: translateY(0); }} }}

/* Notice */
.notice {{ background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); padding: 12px; border-radius: 12px; margin-top: 20px; font-size: 0.85rem; color: #fca5a5; display: flex; align-items: flex-start; gap: 10px; }}
.notice-icon {{ font-size: 1.2rem; }}
</style>
</head>
<body>
<div class="container">
    <div class="lang-switcher">
        <button class="lang-btn active" id="btn-tr">TÜRKÇE</button>
        <button class="lang-btn" id="btn-en">ENGLISH</button>
    </div>

    <header class="header">
        <h1 class="title" data-tr="BypaxDPI'a Bağlan" data-en="Connect to BypaxDPI">BypaxDPI'a Bağlan</h1>
        <p class="subtitle" data-tr="İnternet trafiğinizi şifreleyin ve engelleri aşın" data-en="Bypass Internet Restrictions">İnternet Engellerini Aşın</p>
    </header>

    <div class="notice" style="margin-top: 0; margin-bottom: 20px;">
        <span class="notice-icon">⚠</span>
        <div>
            <strong data-tr="DİKKAT:" data-en="ATTENTION:">DİKKAT:</strong>
            <span data-tr="Bypax kapatıldıktan sonra YouTube vb. uygulamalarda internet sorunu yaşarsanız (eski önbellek nedeniyle), Wi-Fi bağlantısını kapatıp açmanız yeterlidir." data-en="If apps like YouTube lose internet access after closing Bypax (due to cached connections), simply toggle your Wi-Fi off and on.">Bypax kapatıldıktan sonra YouTube vb. uygulamalarda internet sorunu yaşarsanız (eski önbellek nedeniyle), Wi-Fi bağlantısını kapatıp açmanız yeterlidir.</span>
        </div>
    </div>

    <div class="card">
        <div class="card-title">
            <span>📱</span> <span data-tr="Android & iPhone Kurulumu" data-en="Android & iPhone Setup">Android & iPhone Kurulumu</span>
        </div>

        <div class="input-group">
            <input type="text" class="url-input" id="pacurl" value="{}" readonly onclick="this.select();">
        </div>

        <button class="btn-copy" id="copybtn" data-tr="Adresi Kopyala" data-en="Copy Address">
            Adresi Kopyala
        </button>

        <a href="https://bypaxdpi.vercel.app/proxy" target="_blank" class="btn-guide" data-tr="❓ Görsel Kurulum Rehberi" data-en="❓ Visual Setup Guide">
            ❓ Görsel Kurulum Rehberi
        </a>

        <div class="divider"></div>

        <div class="card-title" style="font-size:0.95rem; margin-bottom:12px;" data-tr="Nasıl yapılır kısaca?" data-en="Quick Guide">Nasıl yapılır kısaca?</div>
        <ul class="step-list">
            <li class="step-item">
                <strong data-tr="Yeşil butona basarak adresi kopyalayın." data-en="Copy the address using the green button.">Yeşil butona basarak adresi kopyalayın.</strong>
                <span data-tr="Kopyalanmazsa kutuya uzun basıp elle kopyalayın." data-en="If copy fails, long press the box to copy manually.">Kopyalanmazsa kutuya uzun basıp elle kopyalayın.</span>
            </li>
            <li class="step-item">
                <strong data-tr="Wi-Fi ayarlarınıza gidin." data-en="Go to Wi-Fi settings.">Wi-Fi ayarlarınıza gidin.</strong>
                <span data-tr="Bağlı olduğunuz ağın yanındaki (Ayarlar ⚙️ / i) ikonuna dokunun." data-en="Tap the (Settings ⚙️ / i) icon next to your network.">Bağlı olduğunuz ağın yanındaki (Ayarlar ⚙️ / i) ikonuna dokunun.</span>
            </li>
            <li class="step-item">
                <strong data-tr="Proxy ayarını 'Otomatik / PAC' olarak değiştirin." data-en="Change Proxy to 'Automatic / PAC'.">Proxy ayarını "Otomatik / PAC" olarak değiştirin.</strong>
                <span data-tr="Gelişmiş ayarlar menüsünün altında bulunabilir." data-en="Can be found under advanced settings.">Gelişmiş ayarlar menüsünün altında bulunabilir.</span>
            </li>
            <li class="step-item">
                <strong data-tr="Kopyaladığınız adresi yapıştırın ve kaydedin." data-en="Paste the copied address and save.">Kopyaladığınız adresi yapıştırın ve kaydedin.</strong>
                <span data-tr="Artık bağlantınız güvende!" data-en="Your connection is now secure!">Artık bağlantınız güvende!</span>
            </li>
        </ul>
    </div>
</div>

<script>
(function() {{
    var url = document.getElementById('pacurl').value;
    var btn = document.getElementById('copybtn');
    var currentLang = 'tr';

    function setLanguage(lang) {{
        currentLang = lang;
        document.querySelectorAll('[data-tr]').forEach(function(el) {{
            el.innerHTML = el.getAttribute('data-' + lang);
        }});
        document.getElementById('btn-tr').classList.toggle('active', lang === 'tr');
        document.getElementById('btn-en').classList.toggle('active', lang === 'en');
        
        // Kopyalanmış buton metnini koruyalım eğer o andaysa
        if (btn.classList.contains('success')) {{
             btn.innerHTML = (lang === 'tr' ? '✓ Kopyalandı!' : '✓ Copied!');
        }}
    }}

    document.getElementById('btn-tr').onclick = function() {{ setLanguage('tr'); }};
    document.getElementById('btn-en').onclick = function() {{ setLanguage('en'); }};

    function tryCopy() {{
        if (navigator.clipboard && navigator.clipboard.writeText) {{
            navigator.clipboard.writeText(url).then(function() {{
                showSuccess();
            }}).catch(fallbackCopyTextToClipboard);
        }} else {{
            fallbackCopyTextToClipboard();
        }}
    }}

    function showSuccess() {{
        var originalText = btn.getAttribute('data-' + currentLang);
        btn.innerHTML = (currentLang === 'tr' ? '✓ Kopyalandı!' : '✓ Copied!');
        btn.classList.add('success');
        setTimeout(function() {{
            btn.innerHTML = originalText;
            btn.classList.remove('success');
        }}, 2500);
    }}

    function fallbackCopyTextToClipboard() {{
        var textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {{
            var successful = document.execCommand('copy');
            if (successful) showSuccess();
        }} catch (err) {{ }}
        document.body.removeChild(textArea);
    }}

    btn.onclick = tryCopy;
}})();
</script>
</body>
</html>"#,
        html_escape(pac_url)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Absolute URL'den path kısmını çıkarır.
/// "http://192.168.1.5:8787/proxy.pac" → "/proxy.pac"
/// "http://192.168.1.5:8787/"          → "/"
/// "/proxy.pac"                         → "/proxy.pac"  (zaten relative)
fn normalize_path(raw: &str) -> &str {
    if let Some(pos) = raw.find("://") {
        let after_scheme = &raw[pos + 3..];
        if let Some(slash_pos) = after_scheme.find('/') {
            return &after_scheme[slash_pos..];
        }
        return "/";
    }
    raw
}

fn handle_pac_request(
    stream: TcpStream,
    pac_body: &Arc<Mutex<String>>,
    pac_cache: &Arc<Mutex<PacCache>>,
    pac_url: &str,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

    let mut reader = std::io::BufReader::new(stream);
    let mut first_line = String::new();

    if std::io::BufRead::read_line(&mut reader, &mut first_line).is_err() || first_line.is_empty() {
        return;
    }

    // TCP RST önleme — request header'ları tamamen tüketilmeli
    let mut discard = String::new();
    while let Ok(n) = std::io::BufRead::read_line(&mut reader, &mut discard) {
        if n <= 2 {
            break;
        }
        discard.clear();
    }

    let mut stream = reader.into_inner();

    // ✅ FIX: Absolute URL desteği — proxy üzerinden gelen istekleri de doğru parse et
    let raw_path = first_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/");
    let path = normalize_path(raw_path);

    let is_get = first_line.to_uppercase().starts_with("GET ");

    // ── 1) Logo ──
    if is_get && path == "/logo" {
        let img = include_bytes!("../icons/128x128.png");
        let hdr = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
            img.len()
        );
        let _ = stream.write_all(hdr.as_bytes());
        let _ = stream.write_all(img);
        let _ = stream.flush();
        return;
    }

    // ── 2) PAC dosyası (/proxy.pac veya /wpad.dat) ──
    // Bazı senaryolarda tarayıcılar absolute URL (http://ip:port/proxy.pac) olarak gönderebilir.
    if is_get && (path.ends_with("/proxy.pac") || path.ends_with("/wpad.dat")) {
        let current_body = pac_body
            .lock()
            .map(|b| b.clone())
            .unwrap_or_else(|_| make_pac_direct_body());
        let current_hash = simple_hash(&current_body);

        // Dinamik Cache-Control: PROXY aktifken 60s, DIRECT modda 0
        let is_direct_mode = !current_body.contains("PROXY");
        let cache_header = if is_direct_mode {
            "Cache-Control: no-cache, no-store, must-revalidate, max-age=0"
        } else {
            "Cache-Control: max-age=60"
        };

        let mode_bit: u64 = if is_direct_mode { 1 } else { 0 };
        let cache_key = current_hash.wrapping_add(mode_bit);

        if let Ok(mut cache) = pac_cache.lock() {
            if cache.body_hash != cache_key || cache.pac_response.is_empty() {
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n{}\r\nContent-Length: {}\r\n\r\n{}",
                    cache_header,
                    current_body.len(),
                    current_body
                );
                cache.pac_response = response.into_bytes();
                cache.body_hash = cache_key;
            }
            let _ = stream.write_all(&cache.pac_response);
        } else {
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n{}\r\nContent-Length: {}\r\n\r\n{}",
                cache_header,
                current_body.len(),
                current_body
            );
            let _ = stream.write_all(response.as_bytes());
        }
        let _ = stream.flush();
        return; // ← ÖNEMLİ: Burada fonksiyondan çık
    }

    // ── 3) GET olmayan istekler ──
    if !is_get {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        let _ = stream.flush();
        return;
    }

    // ── 4) HTML kurulum sayfası (/) veya 404 ──
    let (status, content_type, body) = if path == "/" || path.is_empty() {
        (
            "200 OK",
            "text/html; charset=utf-8",
            make_setup_html(pac_url),
        )
    } else {
        ("404 Not Found", "text/plain", String::new())
    };

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nContent-Length: {}\r\n\r\n{}",
        status,
        content_type,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[derive(serde::Serialize)]
struct PacResponse {
    pac_port: u16,
}

/// P1-FIX: PAC sunucusu eşzamanlı bağlantı limiti
const MAX_PAC_CONNECTIONS: u32 = 50;

#[cfg(target_os = "windows")]
fn manage_firewall_rules(enable: bool, proxy_port: u16, pac_port: u16) {
    std::thread::spawn(move || {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Önce mevcut kuralları temizle
        let _ = std::process::Command::new("netsh")
            .args(&[
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                "name=BypaxDPI_Proxy",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        let _ = std::process::Command::new("netsh")
            .args(&[
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                "name=BypaxDPI_PAC",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        if enable {
            let _ = std::process::Command::new("netsh")
                .args(&[
                    "advfirewall",
                    "firewall",
                    "add",
                    "rule",
                    "name=BypaxDPI_Proxy",
                    "dir=in",
                    "action=allow",
                    "protocol=TCP",
                    &format!("localport={}", proxy_port),
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();

            let _ = std::process::Command::new("netsh")
                .args(&[
                    "advfirewall",
                    "firewall",
                    "add",
                    "rule",
                    "name=BypaxDPI_PAC",
                    "dir=in",
                    "action=allow",
                    "protocol=TCP",
                    &format!("localport={}", pac_port),
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    });
}

#[tauri::command]
fn start_pac_server(
    proxy_port: u16,
    state: tauri::State<'_, PacServerState>,
) -> Result<PacResponse, String> {
    let lan_ip = get_safe_lan_ip();

    // PAC body'yi güncelle — proxy moduna geç
    let new_pac_body = make_pac_body(&lan_ip, proxy_port);
    if let Ok(mut body) = state.pac_body.lock() {
        *body = new_pac_body;
    }

    // Sunucu zaten çalışıyorsa, sadece body güncellendi — port bilgisini döndür
    let guard = state.join_handle.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        let current_port = *state.pac_port.lock().map_err(|e| e.to_string())?;
        // PAC URL'yi de güncelle (port aynı kalsa bile proxy_port değişmiş olabilir)
        if let Ok(mut url) = state.pac_url.lock() {
            *url = format!("http://{}:{}/proxy.pac", lan_ip, current_port);
        }
        return Ok(PacResponse {
            pac_port: current_port,
        });
    }
    drop(guard); // Lock'u serbest bırak

    // P1-FIX: LAN paylaşımı her zaman 0.0.0.0'a bind eder (fonksiyon zaten sadece LAN aktifken çağrılır)
    // Ama yerel cihazların güvenliği için bind adresi sabitlenir
    let bind_addr = "0.0.0.0";

    // Dinamik PAC port: 8787-8887 arasında müsait olanı bul
    let mut found_port: u16 = 0;
    let mut listener_result = None;
    for port in PAC_PORT_START..=PAC_PORT_END {
        match TcpListener::bind((bind_addr, port)) {
            Ok(l) => {
                found_port = port;
                listener_result = Some(l);
                break;
            }
            Err(_) => continue,
        }
    }
    // Fallback: OS'tan rastgele port iste
    if listener_result.is_none() {
        match TcpListener::bind((bind_addr, 0u16)) {
            Ok(l) => {
                if let Ok(addr) = l.local_addr() {
                    found_port = addr.port();
                }
                listener_result = Some(l);
            }
            Err(e) => return Err(format!("PAC için uygun port bulunamadı: {}", e)),
        }
    }
    let listener = listener_result.unwrap();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    manage_firewall_rules(true, proxy_port, found_port);

    let pac_url = format!("http://{}:{}/proxy.pac", lan_ip, found_port);

    // State'e kaydet
    if let Ok(mut p) = state.pac_port.lock() {
        *p = found_port;
    }
    if let Ok(mut u) = state.pac_url.lock() {
        *u = pac_url.clone();
    }

    let shutdown = Arc::clone(&state.shutdown);
    shutdown.store(false, Ordering::Relaxed);
    let pac_body_arc = Arc::clone(&state.pac_body);
    let pac_cache_arc = Arc::clone(&state.pac_cache);
    let pac_url_for_thread = pac_url.clone();

    // P1-FIX: Thread limiti için atomik sayaç
    let active_connections = Arc::new(std::sync::atomic::AtomicU32::new(0));

    let join_handle = thread::spawn(move || {
        while !shutdown.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let current = active_connections.load(Ordering::Relaxed);
                    if current >= MAX_PAC_CONNECTIONS {
                        drop(stream);
                        continue;
                    }
                    active_connections.fetch_add(1, Ordering::Relaxed);

                    let body = Arc::clone(&pac_body_arc);
                    let cache = Arc::clone(&pac_cache_arc);
                    let url = pac_url_for_thread.clone();
                    let conn_counter = Arc::clone(&active_connections);
                    thread::spawn(move || {
                        let _ = stream.set_nonblocking(false);
                        let _ = stream.set_nodelay(true);
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        handle_pac_request(stream, &body, &cache, &url);
                        conn_counter.fetch_sub(1, Ordering::Relaxed);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // ✅ 5ms → 50ms: CPU wake-up %90 azalır, PAC latency hâlâ imperceptible
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {}
            }
        }
    });

    let mut guard = state.join_handle.lock().map_err(|e| e.to_string())?;
    *guard = Some(join_handle);
    Ok(PacResponse {
        pac_port: found_port,
    })
}

/// Bağlantı kesildiğinde PAC body'yi DIRECT moduna geçir.
/// Sunucu çalışmaya devam eder — cihazlar internet erişimini kaybetmez.
#[tauri::command]
fn stop_pac_server(state: tauri::State<'_, PacServerState>) -> Result<(), String> {
    // Sunucuyu kapatmak yerine PAC body'yi DIRECT moduna geçir
    if let Ok(mut body) = state.pac_body.lock() {
        *body = make_pac_direct_body();
    }

    // ✅ P0-FIX: Cache'i hemen invalidate et
    if let Ok(mut cache) = state.pac_cache.lock() {
        cache.body_hash = 0;
        cache.pac_response.clear();
    }

    #[cfg(target_os = "windows")]
    manage_firewall_rules(false, 0, 0);

    Ok(())
}

#[derive(serde::Serialize)]
struct ConfigResponse {
    port: u16,
    lan_ip: String,
    bind_address: String,
}

#[tauri::command]
fn get_sidecar_config(
    allow_lan_sharing: bool,
    enable_game_mode: bool,
) -> Result<ConfigResponse, String> {
    // Game Mode (WinHTTP) açıkken 0.0.0.0'a bind et — UWP uygulamaları (Roblox vb.)
    // AppContainer sandbox yüzünden 127.0.0.1'e erişemez, LAN IP üzerinden bağlanır
    let bind_addr = if allow_lan_sharing || enable_game_mode {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };

    // Öncelikli Portlar: 8080 - 8090 arası kontrol et
    let mut selected_port = 0;
    for port in 8080..=8090 {
        if TcpListener::bind((bind_addr, port)).is_ok() {
            selected_port = port;
            break;
        }
    }

    // Fallback: Eğer hepsi doluysa, sistemden rastgele bir port iste (Port 0)
    if selected_port == 0 {
        if let Ok(listener) = TcpListener::bind((bind_addr, 0)) {
            if let Ok(addr) = listener.local_addr() {
                selected_port = addr.port();
            }
        }
    }

    if selected_port == 0 {
        return Err("Uygun port bulunamadı.".to_string());
    }

    // Yerel IP Adresini Bul (LAN Paylaşımı için) — Sanal adaptörleri filtreler
    let lan_ip = get_safe_lan_ip();

    Ok(ConfigResponse {
        port: selected_port,
        lan_ip,
        bind_address: bind_addr.to_string(),
    })
}

/// Registry proxy işlemlerini serialize eden global lock
/// set_system_proxy ve clear_system_proxy eş zamanlı çağrılabilir (reconnect sırasında)
fn proxy_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// P0-FIX-3: Poisoned mutex recovery — panic sonrası bile proxy temizleme çalışsın
fn acquire_proxy_lock() -> std::sync::MutexGuard<'static, ()> {
    match proxy_lock().lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[WARN] Proxy lock was poisoned (previous panic?), recovering");
            poisoned.into_inner()
        }
    }
}

#[tauri::command]
fn clear_system_proxy() -> Result<(), String> {
    let _guard = acquire_proxy_lock(); // P0-FIX-3: Poisoned mutex recovery
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // P0-FIX-2: Önce orijinal ayarları geri yüklemeyi dene
        let has_original = restore_proxy_settings();

        if !has_original {
            let _ = registry::clear_proxy();
        }

        // 4. DNS Önbelleğini Temizle (Race condition / DNS sorunlarını önler)
        let _ = Command::new("ipconfig")
            .arg("/flushdns")
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        // 5. Notify browsers about the change
        notify_proxy_change();

        // 6. Native/C++ ve arka plan servisleri için WinHTTP sistem proxy'sini sıfırla
        let _ = std::process::Command::new("netsh")
            .args(&["winhttp", "reset", "proxy"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        manage_firewall_rules(false, 0, 0);
    }

    #[cfg(target_os = "macos")]
    {
        let has_original = restore_proxy_settings_macos();
        if !has_original {
            let _ = proxy_macos::clear_proxy();
        }
        let _ = std::process::Command::new("dscacheutil")
            .arg("-flushcache")
            .status();
        if let Ok(mut guard) = macos_proxy_store().lock() {
            *guard = None;
        }
    }

    // P0-FIX-1: Sentinel dosyasını sil — proxy artık aktif değil
    let _ = std::fs::remove_file(sentinel_path());

    // P0-FIX-2: Backup'ı temizle — geri yükleme tamamlandı
    if let Ok(mut guard) = original_proxy_store().lock() {
        *guard = None;
    }

    Ok(())
}

/// Notify Windows that internet settings have changed
/// This forces browsers to immediately pick up the new proxy settings
#[cfg(target_os = "windows")]
fn notify_proxy_change() {
    use std::ptr::null_mut;
    use winapi::um::wininet::{
        InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
    };

    unsafe {
        // Notify that settings have changed
        InternetSetOptionW(null_mut(), INTERNET_OPTION_SETTINGS_CHANGED, null_mut(), 0);
        InternetSetOptionW(null_mut(), INTERNET_OPTION_REFRESH, null_mut(), 0);
    }
}

/// P1-FIX: UWP AppContainer'ları arka planda otomatik olarak Loopback Proxy için yetkilendirir.
/// Bu sayede Roblox, Speedtest ve diğer Windows Mağaza uygulamaları 127.0.0.1 proxy sunucusuna başarılı şekilde bağlanabilir.
#[cfg(target_os = "windows")]
fn exempt_all_uwp_apps() {
    std::thread::spawn(|| {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let script = r#"
            try {
                $packages = Get-AppxPackage -ErrorAction SilentlyContinue
                foreach ($pkg in $packages) {
                    if ($pkg.PackageFamilyName) {
                        CheckNetIsolation.exe LoopbackExempt -a "-n=$($pkg.PackageFamilyName)"
                    }
                }
            } catch {}
        "#;

        let _ = std::process::Command::new("powershell")
            .args(&["-NoProfile", "-WindowStyle", "Hidden", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    });
}

#[tauri::command]
fn set_system_proxy(port: u16, enable_winhttp: bool) -> Result<(), String> {
    let _guard = acquire_proxy_lock();
    let _ = enable_winhttp; // Windows-only; macOS'ta WinHTTP karşılığı yok
    if port < 1024 {
        return Err("Geçersiz port numarası (1024-65535 arası olmalı)".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if !registry::can_access() {
            return Err(
                "Registry yazma izni yok. Uygulamayı yönetici olarak çalıştırın.".to_string(),
            );
        }

        // P0-FIX-2: Proxy ayarlamadan ÖNCE mevcut ayarları yedekle
        backup_proxy_settings();

        // ✅ CRITICAL FIX: Asla LAN IP kullanma! Roblox vb. UWP Uygulamaları 'privateNetworkClientServer'
        // yetkisine sahip DEĞİLDİR. Bu yüzden 192.168.x.x (LAN IP) üzerinden bağlandıklarında sistem
        // güvenlik duvarı (AppContainer) bağlantıyı tamamen keser.
        // UWP LoopbackExempt (Sanal İzolasyon Kaldırma) SADECE "127.0.0.1" için çalışır.
        let proxy_addr = "127.0.0.1".to_string();

        registry::set_proxy(&proxy_addr, port).map_err(|e| {
            // Rollback
            let _ = registry::clear_proxy();
            format!("Registry güncelleme başarısız, geri alındı: {}", e)
        })?;

        // 3. CRITICAL: Notify Windows about the change so browsers pick it up immediately
        notify_proxy_change();

        // 4. UWP (Windows Mağaza) uygulamaları için loopback isolation yetkisini bypass et
        exempt_all_uwp_apps();

        // 5. Native/C++ ve arka plan servisleri için WinHTTP sistem proxy'si ayarla
        if enable_winhttp {
            // WinHTTP bypass listesini Registry ProxyOverride ile senkronize tut
            let winhttp_bypass = format!(
                "bypass-list=\"<local>;{};*.steamcontent.com;*.steamstatic.com;*.cm.steampowered.com;*.epicgames.com;*.unrealengine.com;*.riotgames.com;*.leagueoflegends.com;*.ea.com;*.origin.com;*.blizzard.com;*.battle.net;*.ubisoft.com;*.ubi.com;*.xboxlive.com;*.xbox.com;*.microsoft.com;*.cachefly.net;*.msftconnecttest.com;*.windowsupdate.com\"",
                proxy_addr
            );
            let _ = std::process::Command::new("netsh")
                .args(&[
                    "winhttp",
                    "set",
                    "proxy",
                    &format!("{}:{}", proxy_addr, port),
                    &winhttp_bypass,
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    }

    #[cfg(target_os = "macos")]
    {
        if !proxy_macos::can_access() {
            return Err("networksetup erişim izni yok. Uygulamayı yönetici olarak çalıştırın.".to_string());
        }
        backup_proxy_settings_macos();
        proxy_macos::set_proxy(port).map_err(|e| format!("macOS proxy ayarlanamadı: {}", e))?;
    }

    // P0-FIX-1: Sentinel dosyası oluştur — proxy artık aktif
    let _ = std::fs::write(sentinel_path(), format!("port={}", port));

    Ok(())
}

/// P1-FIX: Tooltip uzunluk sınırı — Windows tooltip limiti 128 karakter
#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    let sanitized: String = tooltip.chars().take(128).collect();
    if let Some(tray) = app.tray_by_id("tray") {
        tray.set_tooltip(Some(sanitized))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// P1-FIX: Port aralığı kısıtlama — XSS ile localhost port taraması engellenir
#[tauri::command]
fn check_port_open(port: u16) -> bool {
    // Sadece privileged portları engelle, dinamik portlara (OS ataması) izin ver
    if port < 1024 {
        return false;
    }
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(500),
    )
    .is_ok()
}

#[tauri::command]
fn check_admin() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::mem;
        use std::ptr;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::processthreadsapi::{GetCurrentProcess, OpenProcessToken};
        use winapi::um::securitybaseapi::GetTokenInformation;
        use winapi::um::winnt::{TokenElevation, HANDLE, TOKEN_ELEVATION, TOKEN_QUERY};

        unsafe {
            let mut token: HANDLE = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }

            let mut elevation: TOKEN_ELEVATION = mem::zeroed();
            let mut size: u32 = 0;
            let result = GetTokenInformation(
                token,
                TokenElevation,
                &mut elevation as *mut _ as *mut _,
                mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut size,
            );

            CloseHandle(token);
            result != 0 && elevation.TokenIsElevated != 0
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

fn perform_app_exit(app: &tauri::AppHandle) {
    // clear_system_proxy zaten RunEvent::ExitRequested'da çağrılacak
    // Burada tekrar çağırma — app.exit() ExitRequested tetikler
    app.exit(0);
}

/// Uygulama açıldığında eski bypax-proxy süreçlerini temizle (Zombi süreç önleme)
#[tauri::command]
fn save_sidecar_pid(pid: u32) {
    let pid_file = std::env::temp_dir().join("bypaxdpi_sidecar.pid");
    let _ = std::fs::write(&pid_file, pid.to_string());
}

/// Uygulama açıldığında eski bypax-proxy süreçlerini temizle (Zombi süreç önleme)
#[tauri::command]
fn kill_zombie_sidecar() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let pid_file = std::env::temp_dir().join("bypaxdpi_sidecar.pid");
        if let Ok(pid_str) = std::fs::read_to_string(&pid_file) {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                if pid > 0 {
                    let output = std::process::Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string()])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();

                    let _ = std::fs::remove_file(&pid_file);

                    if let Ok(out) = output {
                        if out.status.success() {
                            return Ok(format!("Zombi süreç (PID {}) durduruldu.", pid));
                        }
                    }
                }
            }
        }
        Ok("Zombi PID dosyası bulunamadı.".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let pid_file = std::env::temp_dir().join("bypaxdpi_sidecar.pid");
        if let Ok(pid_str) = std::fs::read_to_string(&pid_file) {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                if pid > 0 {
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .status();
                    let _ = std::fs::remove_file(&pid_file);
                    return Ok(format!("Zombi süreç (PID {}) durduruldu.", pid));
                }
            }
        }
        Ok("Zombi PID dosyası bulunamadı.".to_string())
    }
}

/// P0-FIX: Ortadaki Adam (Network Reconnaissance) Riskini Engellemek İçin Özel Ping Doğrulayıcı
#[tauri::command]
async fn check_dns_latency(dns_ip: String) -> Result<u32, String> {
    // Sadece bilinen DNS IP'lerini kabul et (Arbitrary internal network scan'i önler)
    let allowed_ips = [
        "1.1.1.1",        // Cloudflare
        "8.8.8.8",        // Google
        "9.9.9.9",        // Quad9
        "94.140.14.14",   // AdGuard
        "208.67.222.222", // OpenDNS
    ];

    if !allowed_ips.contains(&dns_ip.as_str()) {
        return Err("Bilinmeyen DNS adresi".to_string());
    }

    let start = std::time::Instant::now();
    let addr = format!("{}:53", dns_ip)
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;

    match std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(1500)) {
        Ok(_) => Ok(start.elapsed().as_millis() as u32),
        Err(_) => Ok(999),
    }
}

/// P0-FIX-1: Uygulama başlangıcında crash/BSOD sonrası kalan kirli proxy'yi temizle
/// Sentinel dosyası varsa = önceki oturum düzgün kapanmamış demektir
#[tauri::command]
fn startup_proxy_cleanup() -> Result<bool, String> {
    let sentinel = sentinel_path();

    if sentinel.exists() {
        eprintln!("[STARTUP] ⚠️ Dirty shutdown detected — sentinel file found");
        eprintln!("[STARTUP] Cleaning orphaned proxy settings...");

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let _ = registry::clear_proxy();

            // DNS cache temizle
            let _ = Command::new("ipconfig")
                .arg("/flushdns")
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();

            // Tarayıcılara bildir
            notify_proxy_change();

            // ✅ Sadece dirty shutdown'da firewall temizle
            manage_firewall_rules(false, 0, 0);
        }

        #[cfg(target_os = "macos")]
        {
            let _ = proxy_macos::clear_proxy();
            let _ = std::process::Command::new("dscacheutil")
                .arg("-flushcache")
                .status();
        }

        let _ = std::fs::remove_file(&sentinel);
        eprintln!("[STARTUP] ✅ Orphaned proxy + firewall rules cleaned");

        return Ok(true);
    }

    // ✅ FIX: Temiz başlangıçta firewall temizleme YAPMA
    // Eski kod: manage_firewall_rules(false, 0, 0) — autoConnect ile race condition yaratıyordu
    // Sentinel yoksa zaten önceki oturum düzgün kapanmış, firewall kuralları da temizlenmiş demektir

    Ok(false) // Temiz başlangıç
}

#[tauri::command]
fn check_driver() -> bool {
    #[cfg(target_os = "windows")]
    {
        return std::path::Path::new("C:\\Windows\\System32\\wpcap.dll").exists()
            || std::path::Path::new("C:\\Windows\\SysWOW64\\wpcap.dll").exists();
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
fn install_driver(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err("Sürücü kurulumu bu platformda gerekli değil.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("binaries/npcap-installer.exe");

        if !resource_path.exists() {
            return Err("Sürücü dosyası bulunamadı. Lütfen uygulamayı yeniden yükleyin.".into());
        }

        let status = std::process::Command::new(resource_path)
            .status()
            .map_err(|e| e.to_string())?;

        if status.success() {
            Ok(())
        } else {
            Err("Kurulum kullanıcı tarafından iptal edildi veya başarısız oldu.".into())
        }
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    perform_app_exit(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // P0-FIX: Single-instance enforcement — aynı anda sadece bir BypaxDPI çalışabilir
    #[cfg(target_os = "windows")]
    {
        use std::ptr::null_mut;
        use winapi::shared::winerror::ERROR_ALREADY_EXISTS;
        use winapi::um::errhandlingapi::GetLastError;
        use winapi::um::synchapi::CreateMutexW;

        let mutex_name: Vec<u16> = "Global\\BypaxDPI_SingleInstance\0".encode_utf16().collect();

        unsafe {
            let handle = CreateMutexW(null_mut(), 0, mutex_name.as_ptr());
            if handle.is_null() || GetLastError() == ERROR_ALREADY_EXISTS {
                eprintln!("[STARTUP] ❌ BypaxDPI zaten çalışıyor — çıkılıyor");

                use winapi::um::winuser::{
                    FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
                };
                let window_name: Vec<u16> = "BypaxDPI\0".encode_utf16().collect();
                let hwnd = FindWindowW(null_mut(), window_name.as_ptr());
                if !hwnd.is_null() {
                    if IsIconic(hwnd) != 0 {
                        ShowWindow(hwnd, SW_RESTORE);
                    }
                    SetForegroundWindow(hwnd);
                }

                // Sessizce çık (Multi-user ortamında diğer kullanıcıları rahatsız etme)
                std::process::exit(0);
            }
            // Windows process sonlandığında mutex handle'ını otomatik temizler
            let _ = handle;
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::io::Read;
        let lock_path = std::env::temp_dir().join("bypaxdpi_instance.lock");
        if lock_path.exists() {
            if let Ok(mut f) = std::fs::File::open(&lock_path) {
                let mut pid_str = String::new();
                let _ = f.read_to_string(&mut pid_str);
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    let alive = std::process::Command::new("kill")
                        .args(&["-0", &pid.to_string()])
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false);
                    if alive {
                        eprintln!("[STARTUP] ❌ BypaxDPI zaten çalışıyor — çıkılıyor");
                        std::process::exit(0);
                    }
                }
            }
        }
        let _ = std::fs::write(&lock_path, std::process::id().to_string());
    }

    tauri::Builder::default()
        .manage(PacServerState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                    // Başlık çubuğu alanını içerikle paylaş, traffic lights kalır
                }
            }

            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                use tauri::Manager;

                let show_i = MenuItem::with_id(app, "show", "Uygulamayı Aç", true, None::<&str>)?;
                let support_i =
                    MenuItem::with_id(app, "support", "Destekle ❤", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;

                use tauri::menu::PredefinedMenuItem;
                let s1 = PredefinedMenuItem::separator(app)?;
                let s2 = PredefinedMenuItem::separator(app)?;

                let menu = Menu::with_items(app, &[&show_i, &s1, &support_i, &s2, &quit_i])?;

                // ✅ Debounce için flag
                let is_showing = Arc::new(AtomicBool::new(false));

                let _tray = TrayIconBuilder::with_id("tray")
                    .menu(&menu)
                    .show_menu_on_left_click(false) // ✅ Sol tıkta menü açılmasın, sadece sağ tıkta
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("BypaxDPI - Kapalı")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus(); // ✅ Pencereyi kapatmadan önce onay kutusu için öne getir!

                                let _ = window.emit("tray_quit", ());
                                let _ = window.close();
                            } else {
                                perform_app_exit(app);
                            }
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "support" => {
                            use tauri_plugin_opener::OpenerExt;
                            app.opener()
                                .open_url(SUPPORT_URL, None::<&str>)
                                .unwrap_or(());
                        }
                        _ => {}
                    })
                    .on_tray_icon_event({
                        let is_showing = Arc::clone(&is_showing);
                        move |tray, event| {
                            use tauri::tray::{MouseButton, TrayIconEvent};

                            match event {
                                // ✅ Sol tık: pencereyi öne getir
                                TrayIconEvent::Click {
                                    button: MouseButton::Left,
                                    ..
                                } => {
                                    if is_showing.load(Ordering::Relaxed) {
                                        return;
                                    }
                                    is_showing.store(true, Ordering::Relaxed);

                                    let app = tray.app_handle();
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.unminimize();
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }

                                    let is_showing_clone = Arc::clone(&is_showing);
                                    std::thread::spawn(move || {
                                        std::thread::sleep(std::time::Duration::from_millis(300));
                                        is_showing_clone.store(false, Ordering::Relaxed);
                                    });
                                }
                                // ✅ Çift tık: pencereyi öne getir
                                TrayIconEvent::DoubleClick { .. } => {
                                    let app = tray.app_handle();
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.unminimize();
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                }
                                // Sağ tık: menü otomatik açılır
                                _ => {}
                            }
                        }
                    })
                    .build(app)?;

                // LAYER 2: Window close cleanup
                if let Some(window) = app.get_webview_window("main") {
                    let app_handle = app.handle().clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::Destroyed = event {
                            let _ = clear_system_proxy();
                            // ✅ P2-FIX: PAC'i de DIRECT'e geçir
                            if let Some(pac_state) = app_handle.try_state::<PacServerState>() {
                                if let Ok(mut body) = pac_state.pac_body.lock() {
                                    *body = make_pac_direct_body();
                                }
                                if let Ok(mut cache) = pac_state.pac_cache.lock() {
                                    cache.body_hash = 0;
                                    cache.pac_response.clear();
                                }
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // notification plugin zaten yukarıda kayıtlı, tekrar ekleme
        .invoke_handler(tauri::generate_handler![
            clear_system_proxy,
            set_system_proxy,
            update_tray_tooltip,
            check_admin,
            check_port_open,
            get_sidecar_config,
            start_pac_server,
            stop_pac_server,
            kill_zombie_sidecar,
            check_dns_latency,
            save_sidecar_pid,
            startup_proxy_cleanup,
            check_driver,
            install_driver,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // LAYER 3: App exit cleanup (fallback)
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let _ = clear_system_proxy();
                if let Some(state) = app_handle.try_state::<PacServerState>() {
                    // Grace period'u kısalt — App.jsx zaten 1.5s (şimdi 0.5s) bekledi
                    // DIRECT'e geç ama uzun bekleme
                    if let Ok(mut body) = state.pac_body.lock() {
                        *body = make_pac_direct_body();
                    }
                    if let Ok(mut cache) = state.pac_cache.lock() {
                        cache.body_hash = 0;
                        cache.pac_response.clear();
                    }
                    // 500ms yeterli — cihazlar genelde 200ms içinde PAC'i çeker
                    std::thread::sleep(Duration::from_millis(500));
                    state.shutdown.store(true, Ordering::Relaxed);
                    if let Ok(mut guard) = state.join_handle.lock() {
                        let _ = guard.take();
                    }
                    #[cfg(target_os = "windows")]
                    manage_firewall_rules(false, 0, 0);
                }
            }
            #[cfg(target_os = "macos")]
            {
                let lock_path = std::env::temp_dir().join("bypaxdpi_instance.lock");
                let _ = std::fs::remove_file(lock_path);
            }
        });
}

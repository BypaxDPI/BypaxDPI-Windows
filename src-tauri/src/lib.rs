// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use local_ip_address::local_ip;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;

/// PAC sunucusu durumu: thread handle + shutdown flag
pub struct PacServerState {
    pub join_handle: Mutex<Option<thread::JoinHandle<()>>>,
    pub shutdown: Arc<AtomicBool>,
}

impl Default for PacServerState {
    fn default() -> Self {
        Self {
            join_handle: Mutex::new(None),
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

const PAC_PORT: u16 = 8787;

/// Production PAC: yerel ağ DIRECT, diğerleri PROXY ip:port; DIRECT (fail-safe)
fn make_pac_body(lan_ip: &str, proxy_port: u16) -> String {
    let proxy = format!("{}:{}", lan_ip, proxy_port);
    format!(
        r#"function FindProxyForURL(url, host) {{
    if (isPlainHostName(host) || host === "localhost" || host.indexOf("127.") === 0 ||
        shExpMatch(host, "*.local") ||
        isInNet(dnsResolve(host), "192.168.0.0", "255.255.0.0") ||
        isInNet(dnsResolve(host), "10.0.0.0", "255.0.0.0") ||
        isInNet(dnsResolve(host), "127.0.0.0", "255.0.0.0"))
        return "DIRECT";
    return "PROXY {}; DIRECT";
}}
"#,
        proxy
    )
}

fn make_setup_html(pac_url: &str) -> String {
    format!(r#"<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BypaxDPI – Proxy Kurulum</title>
<style>
* {{ box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: linear-gradient(180deg, #0c0c0e 0%, #0f0f0f 100%); color: #e4e4e7; min-height: 100vh; }}
.brand-header {{ text-align: center; padding: 24px 16px 20px; background: linear-gradient(135deg, rgba(59,130,246,0.08) 0%, transparent 50%); border-bottom: 1px solid rgba(255,255,255,0.06); }}
.brand-logo-wrap {{ margin-bottom: 12px; }}
.brand-logo-wrap img {{ width: 56px; height: 56px; display: block; margin: 0 auto; }}
.brand-name {{ font-size: 1.5rem; font-weight: 800; margin: 0; letter-spacing: 0.05em; color: #fafafa; }}
.brand-tagline {{ font-size: 0.85rem; color: #94a3b8; margin: 4px 0 0; }}
.main {{ padding: 16px; max-width: 400px; margin: 0 auto; }}
p {{ font-size: 0.9rem; color: #a1a1aa; line-height: 1.5; margin: 0 0 12px; }}
.url-input {{ width: 100%; background: #27272a; border: 1px solid #3f3f46; border-radius: 10px; padding: 12px; font-size: 0.85rem; color: #e4e4e7; margin: 8px 0; -webkit-user-select: all; user-select: all; }}
.btn {{ display: inline-block; background: #3b82f6; color: #fff; border: none; padding: 12px 24px; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; margin: 8px 4px 8px 0; width: 100%; max-width: 280px; }}
.btn:active {{ opacity: 0.9; }}
.btn-android {{ background: #22c55e; font-size: 1.05rem; padding: 14px; }}
.link {{ color: #60a5fa; text-decoration: none; display: inline-block; margin: 8px 0; }}
.link:active {{ text-decoration: underline; }}
h2 {{ font-size: 0.95rem; color: #d4d4d8; margin: 20px 0 8px; }}
ul {{ margin: 0; padding-left: 20px; color: #a1a1aa; font-size: 0.88rem; line-height: 1.6; }}
.copied {{ background: #22c55e !important; }}
.step {{ margin: 10px 0; padding: 12px; background: rgba(34,197,94,0.08); border-radius: 12px; border-left: 4px solid #22c55e; }}
</style>
</head>
<body>
<header class="brand-header">
  <div class="brand-logo-wrap"><img src="/logo" alt="BypaxDPI" class="brand-logo"></div>
  <h1 class="brand-name">BypaxDPI</h1>
  <p class="brand-tagline">Proxy Kurulum</p>
</header>
<main class="main">
<p><strong>Android:</strong> Önce «Kopyala»ya bas, sonra aşağıdaki adımları izle. <strong>iPhone:</strong> Aşağı kaydır.</p>
<input type="text" class="url-input" id="pacurl" value="{}" readonly onclick="this.select();">
<button class="btn btn-android" id="copybtn">Kopyala (önce buna bas)</button>
<p id="copyhint" style="font-size:0.8rem;color:#71717a;margin-top:0;">Kopyalamadıysa yukarıdaki kutuya uzun bas → Kopyala</p>
<script>
(function(){{ var url=document.getElementById('pacurl').value; var btn=document.getElementById('copybtn'); var hint=document.getElementById('copyhint');
function tryCopy(){{ if(navigator.clipboard && navigator.clipboard.writeText){{ navigator.clipboard.writeText(url).then(function(){{ btn.textContent='Kopyalandı!'; btn.classList.add('copied'); hint.textContent='Şimdi Ayarlar\'a gidip proxy alanına yapıştırın.'; setTimeout(function(){{ btn.textContent='Tekrar kopyala'; btn.classList.remove('copied'); }}, 3000); }}).catch(function(){{ selectAndHint(); }}); }} else selectAndHint(); }}
function selectAndHint(){{ var inp=document.getElementById('pacurl'); inp.select(); inp.setSelectionRange(0,99999); hint.textContent='Kutuyu seçildi. Uzun bas → Kopyala seçin.'; }}
btn.onclick=tryCopy; document.getElementById('pacurl').onclick=function(){{ this.select(); }}; }})();
</script>
<h2>iPhone / iPad</h2>
<ul>
<li>Ayarlar → Wi-Fi → Bağlı ağın yanındaki (i) → Proxy Yapılandırması → Otomatik → URL’yi yapıştırın.</li>
</ul>
<div class="step"><strong>Android adımlar:</strong>
<ol style="margin:8px 0 0 16px; padding:0; color:#a1a1aa; font-size:0.9rem; line-height:1.7;">
<li>Yukarıdan adresi kopyala</li>
<li><a href="intent://android.settings.WIRELESS_SETTINGS#Intent;scheme=android-app;package=com.android.settings;end" class="link">Ayarlar / Ağ veya Wi-Fi'yi aç</a></li>
<li>Bağlı olduğun Wi-Fi ağına dokun (veya ağ adının yanındaki dişli/ok)</li>
<li>Gelişmiş veya Proxy bölümüne gir</li>
<li>Proxy: Otomatik yapılandırma veya PAC seç</li>
<li>PAC adresi / URL alanına yapıştır</li>
</ol></div>
</main>
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


fn handle_pac_request(mut stream: TcpStream, pac_body: &str, pac_url: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 512];
    let first_line = match stream.read(&mut buf) {
        Ok(n) if n > 0 => std::str::from_utf8(&buf[..n])
            .ok()
            .and_then(|s| s.lines().next())
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    };
    let path = first_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/");
    let is_get = first_line.to_uppercase().starts_with("GET ");

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

    let (status, content_type, body) = if !is_get {
        ("404 Not Found", "text/plain", String::new())
    } else if path == "/proxy.pac" {
        (
            "200 OK",
            "application/x-ns-proxy-autoconfig",
            pac_body.to_string(),
        )
    } else if path == "/" || path.is_empty() {
        (
            "200 OK",
            "text/html; charset=utf-8",
            make_setup_html(pac_url),
        )
    } else {
        ("404 Not Found", "text/plain", String::new())
    };

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        status,
        content_type,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[tauri::command]
fn start_pac_server(proxy_port: u16, state: tauri::State<'_, PacServerState>) -> Result<(), String> {
    let mut guard = state.join_handle.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("PAC sunucusu zaten çalışıyor.".to_string());
    }
    let lan_ip = local_ip()
        .ok()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let pac_body = make_pac_body(&lan_ip, proxy_port);
    let pac_url = format!("http://{}:{}/proxy.pac", lan_ip, PAC_PORT);
    let shutdown = Arc::clone(&state.shutdown);
    shutdown.store(false, Ordering::Relaxed);

    let listener = TcpListener::bind(("0.0.0.0", PAC_PORT)).map_err(|e| format!("PAC portu {} açılamadı: {}", PAC_PORT, e))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let join_handle = thread::spawn(move || {
        while !shutdown.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let body = pac_body.clone();
                    let url = pac_url.clone();
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    handle_pac_request(stream, &body, &url);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => {}
            }
        }
    });

    *guard = Some(join_handle);
    Ok(())
}

#[tauri::command]
fn stop_pac_server(state: tauri::State<'_, PacServerState>) -> Result<(), String> {
    state.shutdown.store(true, Ordering::Relaxed);
    let mut guard = state.join_handle.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.take() {
        let _ = handle.join();
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct ConfigResponse {
    port: u16,
    lan_ip: String,
    bind_address: String,
}

#[tauri::command]
fn get_sidecar_config(allow_lan_sharing: bool) -> Result<ConfigResponse, String> {
    let bind_addr = if allow_lan_sharing {
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

    // Yerel IP Adresini Bul (LAN Paylaşımı için)
    let lan_ip = local_ip()
        .ok()
        .map(|ip| ip.to_string())
        .unwrap_or("127.0.0.1".to_string());

    Ok(ConfigResponse {
        port: selected_port,
        lan_ip,
        bind_address: bind_addr.to_string(),
    })
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn clear_system_proxy() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 1. ProxyEnable = 0
        let status = Command::new("reg")
            .args(&[
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
                "/v",
                "ProxyEnable",
                "/t",
                "REG_DWORD",
                "/d",
                "0",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;

        if !status.success() {
            return Err("Failed to clear proxy via registry".to_string());
        }

        // 2. ProxyServer değerini tamamen sil (boş string yaz)
        let _ = Command::new("reg")
            .args(&[
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
                "/v",
                "ProxyServer",
                "/t",
                "REG_SZ",
                "/d",
                "",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();

        // 3. ProxyOverride değerini de temizle
        let _ = Command::new("reg")
            .args(&[
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
                "/v",
                "ProxyOverride",
                "/t",
                "REG_SZ",
                "/d",
                "",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();

        // 4. Notify browsers about the change
        notify_proxy_change();
    }
    Ok(())
}

/// Notify Windows that internet settings have changed
/// This forces browsers to immediately pick up the new proxy settings
#[cfg(target_os = "windows")]
fn notify_proxy_change() {
    use std::ptr::null_mut;
    use winapi::um::wininet::{
        INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED, InternetSetOptionW,
    };

    unsafe {
        // Notify that settings have changed
        InternetSetOptionW(null_mut(), INTERNET_OPTION_SETTINGS_CHANGED, null_mut(), 0);
        // Refresh the settings
        InternetSetOptionW(null_mut(), INTERNET_OPTION_REFRESH, null_mut(), 0);
    }
}

#[tauri::command]
fn set_system_proxy(port: u16) -> Result<(), String> {
    // ✅ Port aralığı validasyonu
    if port < 1024 {
        return Err("Geçersiz port numarası (1024-65535 arası olmalı)".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let proxy_address = format!("127.0.0.1:{}", port);

        // ✅ Registry yazma iznini kontrol et
        let test_status = Command::new("reg")
            .args(&[
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Registry erişim hatası: {e}"))?;

        if !test_status.status.success() {
            return Err(
                "Registry yazma izni yok. Uygulamayı yönetici olarak çalıştırın.".to_string(),
            );
        }

        // ✅ ProxyOverride ekle (localhost bypass)
        let _ = Command::new("reg")
            .args(&[
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
                "/v",
                "ProxyOverride",
                "/t",
                "REG_SZ",
                "/d",
                "<local>",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();

        // 1. Set Proxy Server Address
        let status_server = Command::new("reg")
            .args(&[
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
                "/v",
                "ProxyServer",
                "/t",
                "REG_SZ",
                "/d",
                &proxy_address,
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("ProxyServer ayarlanamadı: {e}"))?;

        // 2. Enable Proxy
        let status_enable = Command::new("reg")
            .args(&[
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
                "/v",
                "ProxyEnable",
                "/t",
                "REG_DWORD",
                "/d",
                "1",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("ProxyEnable ayarlanamadı: {e}"))?;

        if !status_server.success() || !status_enable.success() {
            // ✅ Rollback yap
            let _ = Command::new("reg")
                .args(&[
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
                    "/v",
                    "ProxyEnable",
                    "/t",
                    "REG_DWORD",
                    "/d",
                    "0",
                    "/f",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .status();

            return Err("Registry güncelleme başarısız, geri alındı.".to_string());
        }

        // 3. CRITICAL: Notify Windows about the change so browsers pick it up immediately
        notify_proxy_change();
    }
    Ok(())
}

#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("tray") {
        tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn check_port_open(port: u16) -> bool {
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
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Basit ve etkili yöntem: 'net session' komutu sadece admin yetkisiyle çalışır
        // Exit code 0 ise admindir, değilse (veya access denied ise) değildir
        let status = std::process::Command::new("net")
            .arg("session")
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        if let Ok(s) = status {
            return s.success();
        }
        return false;
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Unix-like sistemlerde uid kontrolü yapılabilir ama şimdilik true dönüyoruz
        true
    }
}

fn perform_app_exit(app: &tauri::AppHandle) {
    let _ = clear_system_proxy();
    std::thread::sleep(std::time::Duration::from_millis(200));
    app.exit(0);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    perform_app_exit(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PacServerState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;

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
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("BypaxDPI - Kapalı")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray_quit", ());
                                let _ = window.close();
                            } else {
                                perform_app_exit(app);
                            }
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "support" => {
                            use tauri_plugin_opener::OpenerExt;
                            app.opener()
                                .open_url("https://www.patreon.com/join/ConsolAktif", None::<&str>)
                                .unwrap_or(());
                        }
                        _ => {}
                    })
                    .on_tray_icon_event({
                        let is_showing = Arc::clone(&is_showing);
                        move |tray, event| {
                            use tauri::tray::{MouseButton, TrayIconEvent};

                            // ✅ Debounce: 300ms içinde tekrar tıklanırsa ignore et
                            if is_showing.load(Ordering::Relaxed) {
                                return;
                            }

                            match event {
                                TrayIconEvent::Click {
                                    button: MouseButton::Left,
                                    ..
                                }
                                | TrayIconEvent::DoubleClick { .. } => {
                                    is_showing.store(true, Ordering::Relaxed);

                                    let app = tray.app_handle();
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }

                                    // 300ms sonra flag'i sıfırla
                                    let is_showing_clone = Arc::clone(&is_showing);
                                    std::thread::spawn(move || {
                                        std::thread::sleep(std::time::Duration::from_millis(300));
                                        is_showing_clone.store(false, Ordering::Relaxed);
                                    });
                                }
                                _ => {}
                            }
                        }
                    })
                    .build(app)?;

                // LAYER 2: Window close cleanup
                if let Some(window) = app.get_webview_window("main") {
                    window.on_window_event(|event| {
                        if let tauri::WindowEvent::Destroyed = event {
                            let _ = clear_system_proxy();
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
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            clear_system_proxy,
            set_system_proxy,
            update_tray_tooltip,
            check_admin,
            check_port_open,
            get_sidecar_config,
            start_pac_server,
            stop_pac_server,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // LAYER 3: App exit cleanup (fallback)
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let _ = clear_system_proxy();
                if let Some(state) = app_handle.try_state::<PacServerState>() {
                    state.shutdown.store(true, Ordering::Relaxed);
                    if let Ok(mut guard) = state.join_handle.lock() {
                        let handle: Option<thread::JoinHandle<()>> = guard.take();
                        if let Some(h) = handle {
                            let _ = h.join();
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        });
}

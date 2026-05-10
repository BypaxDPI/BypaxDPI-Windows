// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ✅ Sorun 1: Panic handler — uygulama çökerse proxy'yi temizle
    // Bu sayede kullanıcı internet erişimini kaybetmez
    std::panic::set_hook(Box::new(|panic_info| {
        // Proxy'yi temizlemeye çalış (best-effort)
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            // ProxyEnable = 0 yap
            let _ = std::process::Command::new("reg")
                .args([
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

            // ProxyServer değerini temizle
            let _ = std::process::Command::new("reg")
                .args([
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

            // Zombi bypass-proxy süreçlerini de öldür
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "bypax-proxy.exe"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }

        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("pkill")
                .arg("bypax-proxy")
                .status();
        }

        eprintln!("BypaxDPI PANIC: {}", panic_info);
    }));

    bypax_tauri_lib::run()
}

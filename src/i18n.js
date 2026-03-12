const translations = {
  tr: {
    // ===== APP.JSX - Header =====
    appName: 'BYPAXDPI',
    statusActive: 'AKTİF',
    statusInactive: 'KESİK',
    statusReady: 'HAZIR',

    // ===== APP.JSX - Main Status =====
    statusConnected: 'GÜVENLİ',
    statusConnecting: 'BAĞLANIYOR...',
    statusDisconnecting: 'KESİLİYOR...',
    statusReady2: 'HAZIR',
    descConnected: 'Bağlantınız şifrelendi ve korunuyor.',
    descConnecting: 'İşlem yapılıyor, lütfen bekleyin.',
    descReady: 'DPI Bypass için bağlanın.',

    // ===== APP.JSX - Buttons =====
    btnConnect: 'BAĞLAN',
    btnDisconnect: 'BAĞLANTIYI KES',
    btnConnecting: 'BAĞLANIYOR...',
    btnDisconnecting: 'KESİLİYOR...',
    btnConnectDevices: 'Diğer Cihazları Bağla',

    // ===== APP.JSX - Bottom Nav =====
    navSettings: 'AYARLAR',
    navLogs: 'LOGLAR',
    navExit: 'ÇIKIŞ',

    // ===== APP.JSX - Logs Panel =====
    logsTitle: 'SİSTEM LOGLARI',
    logsClear: 'TEMİZLE',
    logsCopy: 'KOPYALA',
    logsCopied: 'KOPYALANDI!',
    logsCopyError: 'HATA!',

    // ===== APP.JSX - Connection Modal =====
    modalTitle: 'Cihaz Bağlama',
    modalSubtitle: 'LAN Paylaşımı',
    modalDesc: 'Cihazınızın Wi-Fi ayarlarında <strong>Proxy</strong> kısmını <strong>Manuel</strong> yapın ve bilgileri girin.',
    modalDescPac: 'Diğer cihazlarda <strong>Otomatik (PAC)</strong> kullanımı önerilir.',
    modalPacQrHint: 'QR\'ı tarayıp adresi kopyalayın ve telefonunuzun <strong>Wi-Fi → Proxy → Otomatik URL</strong> kısmına yapıştırın.<br><br><span style="color:#ef4444;font-weight:600">⚠ ÖNEMLİ:</span> Bağlantıyı sonlandırdıktan sonra telefonda internet sorunu yaşarsanız, Wi-Fi bağlantınızı kapatıp açın.',
    modalPacUrl: 'PAC Adresi (Önerilen)',
    modalManualFallback: 'Alternatif: Manuel proxy',
    modalTabPac: 'Otomatik (PAC)',
    modalTabManual: 'Manuel',
    modalPacQrCaption: 'QR → Kurulum sayfası (tara ve kopyala)',
    modalHost: 'Sunucu (Host)',
    modalPort: 'Port',
    modalTutorial: 'Nasıl Yapılır? (Rehber)',

    // ===== APP.JSX - Admin Modal =====
    adminTitle: 'Yönetici İzni Gerekli',
    adminDesc: 'BypaxDPI\'ın düzgün çalışması için yönetici olarak çalıştırılması gereklidir.',
    adminStep: 'Uygulamaya sağ tıklayın → <strong>"Yönetici olarak çalıştır"</strong> seçin',
    adminClose: 'KAPAT',
    adminHowItWorks: 'Nasıl Çalışır?',

    // ===== APP.JSX - No Internet =====
    noInternetTitle: 'İnternet Bağlantısı Yok',
    noInternetDesc: 'Lütfen internet bağlantınızı kontrol edin.',
    noInternetRetry: 'Tekrar Dene',

    // ===== APP.JSX - Log Messages =====
    logEngineStarting: (port) => `Bypax Motoru başlatılıyor (Port: ${port})...`,
    logDnsUsed: (name, ip) => `Kullanılan DNS: ${name} (${ip})`,
    logDnsDefault: 'DNS: Sistem Varsayılanı',
    logConnected: 'Bağlantı başarılı! Trafik şifreleniyor.',
    logDisconnected: 'Bağlantı kesildi.',
    logProxySet: (port) => `Sistem Proxy ayarlandı: 127.0.0.1:${port}`,
    logProxyCleared: 'Sistem Proxy Temizlendi',
    logEngineStopped: (code) => `Bypax motoru beklenmedik şekilde durduruldu (Kod: ${code})`,
    logEngineStartError: (err) => `Motor başlatılamadı: ${err}`,
    logAutoReconnect: 'Otomatik yeniden bağlanma aktif...',
    logReconnecting: (n) => `Yeniden bağlanılıyor... (Deneme ${n}/5)`,
    logReconnectWait: (sec, n) => `${sec} saniye sonra yeniden denenecek... (Deneme ${n}/5)`,
    logReconnectNow: 'Yeniden bağlanılıyor...',
    logMaxRetries: 'Bağlantı kurulamadı. Maksimum deneme sayısına ulaşıldı.',
    logPossibleReasons: 'Olası sebepler:',
    logReasonInternet: 'İnternet bağlantınız kesilmiş olabilir',
    logReasonFirewall: 'Firewall/Antivirüs BypaxDPI\'ı engelliyor olabilir',
    logReasonPorts: '8080-8084 portları sistem tarafından kullanılıyor',
    logSolutions: 'Çözüm önerileri:',
    logSolInternet: 'İnternet bağlantınızı kontrol edin',
    logSolFirewall: 'Firewall ayarlarınızı kontrol edin',
    logSolAdmin: 'Uygulamayı yönetici olarak çalıştırın',
    logSolLogs: 'Logları kopyalayıp destek için paylaşabilirsiniz',
    logLanRestart: 'Yerel ağ paylaşımı değişti, bağlantı yeniden başlatılıyor...',
    logDpiRestart: 'DPI modu değişti, bağlantı yeniden başlatılıyor...',
    logEngineStoppedGrace: 'Bypax motoru kapatıldı.',
    logServiceStopped: 'Servis durduruldu.',
    logShutdownStarting: 'Kapatma başlatılıyor...',
    logProcessStopped: 'İşlem sonlandırıldı.',
    logSpoofReady: (port) => `✓ SpoofDPI Motoru başlatıldı (Port: ${port})`,
    logPacStarted: '✓ PAC sunucusu başlatıldı (Yerel ağ cihazları için)',
    logPacStartError: (err) => `PAC sunucusu başlatılamadı: ${err}`,
    logEngineActive: '✓ Bypax motoru aktif',
    logPortBusy: (port) => `⚠ Port ${port} dolu, başka port deneniyor...`,
    logInitializing: '⏳ Motor başlatılıyor...',
    logPortRetryOpen: (port) => `Port ${port} açılamadı, yeniden deneniyor...`,
    logProxyClearError: (err) => `Proxy temizleme hatası: ${err}`,
    logProxySetError: (err) => `Proxy ayarlanamadı: ${err}`,
    logServiceStopError: (err) => `Servis durdurma hatası: ${err}`,
    logConfigError: (err) => `Yapılandırma hatası: ${err}`,
    logAdminMissing: 'Yönetici izni eksik! Uygulama düzgün çalışmayabilir.',
    logInternetBack: 'İnternet bağlantısı tekrar sağlandı.',
    logInternetLost: 'İnternet bağlantısı kesildi!',
    logPortRetry: (count) => `Port çakışması, yeni port deneniyor... (${count}/20)`,
    logNoPort: 'Uygun port bulunamadı.',
    logWpcapMissing: 'SpoofDPI, wpcap.dll kütüphanesini bulamadı. Lütfen Npcap veya WinPcap kurun ve ardından uygulamayı yeniden başlatın.',
    logAntivirusWarning: 'Windows Defender veya antivirüs yazılımınız \'bypax-proxy.exe\' dosyasını engellemiş olabilir. Lütfen dosyayı antivirüs dışlama listesine (exclusion) ekleyin.',

    // ===== SETTINGS.JSX =====
    settingsTitle: 'AYARLAR',

    // Section: Connection Method
    sectionMethod: 'BAĞLANTI YÖNTEMİ',
    sectionMethodWhy: 'Tek ayar, tüm ISS\'ler. LAN ile tüm cihazlarda kullanın. Proxy tabanlı olduğu için oyunlarda ping/jitter yapmaz.',
    methodStrong: 'Güçlü Mod',
    methodStrongDesc: 'En güçlü bypass, zor ISP\'ler için (latency ekler)',
    methodTurbo: 'Turbo Mod',
    methodTurboDesc: 'En düşük gecikme, hafif DPI için',
    methodBalanced: 'Dengeli Mod (Önerilen)',
    methodBalancedDesc: 'Hızlı + güçlü bypass, çoğu ISP\'de çalışır',

    // Section: Advanced (Güçlü mod)
    sectionAdvanced: 'GELİŞMİŞ',
    chunkSizeLabel: 'Parça boyutu (chunk size)',
    chunkSizeDesc: 'HTTPS trafiğini kaç parçaya böleceğini belirler. ISS\'e göre 4 veya 16 daha hızlı olabilir; 8 çoğu zaman dengeli (varsayılan). Deneyerek en iyisini seçebilirsiniz.',
    chunkSize4: '4 — En güçlü (bazı ISS\'ler)',
    chunkSize8: '8 — Dengeli (varsayılan)',
    chunkSize16: '16 — Daha hızlı (bazı ISS\'ler)',

    // Section: Network
    sectionNetwork: 'AĞ AYARLARI',
    lanSharing: 'Yerel Ağ Paylaşımı',
    lanSharingDesc: 'Diğer cihazlardan (Tel, Konsol) bağlanmaya izin ver',

    // Section: Automation
    sectionAutomation: 'OTOMASYON',
    autoConnect: 'Otomatik Bağlan',
    autoConnectDesc: 'Uygulama açılır açılmaz bağlan',
    autoReconnect: 'Otomatik Yeniden Bağlan',
    autoReconnectDesc: 'Bağlantı koparsa otomatik yeniden dene',

    // Section: General
    sectionGeneral: 'GENEL',
    autoStart: 'Başlangıçta Çalıştır',
    autoStartDesc: 'Windows açılınca BypaxDPI\'ı başlat',
    minimizeToTray: 'Tepsiye Küçült',
    minimizeToTrayDesc: 'Kapatıldığında arka planda çalışsın',
    alwaysOnTop: 'Her Şeyin Üzerinde Tut',
    alwaysOnTopDesc: 'Pencere her zaman diğer pencerelerin üzerinde kalır',
    requireConfirmation: 'İşlem Onayı',
    requireConfirmationDesc: 'Bağlantıyı keserken veya çıkarken sor',
    language: 'UYGULAMA DILI',
    languageDesc: 'Arayüz dilini değiştirin',

    // Section: Notifications
    sectionNotifications: 'BİLDİRİMLER',
    notifications: 'Masaüstü Bildirimleri',
    notificationsDesc: 'Ana bildirim anahtarı (Tümünü Aç/Kapat)',
    notifyOnConnect: 'Bağlantı Kurulduğunda',
    notifyOnConnectDesc: 'Bağlantı başarıyla sağlandığında bildir',
    notifyOnDisconnect: 'Bağlantı Koptuğunda',
    notifyOnDisconnectDesc: 'Beklenmedik kopmalarda bildir',
    notifDisconnectManual: 'Bağlantı başarıyla sonlandırıldı.',

    // Section: DNS
    sectionDns: 'DNS LİSTESİ',
    dnsAutoSelect: 'Otomatik Seçim (Önerilen)',
    dnsAutoSelectDesc: 'En hızlı sunucuyu otomatik bulur',
    dnsSystemDefault: 'Sistem Varsayılanı',
    dnsSystemDefaultDesc: 'SpoofDPI Varsayılan DNS',
    dnsCfDesc: 'Hızlı ve Gizli',
    dnsAdguardDesc: 'Reklam Engelleyici',
    dnsGoogleDesc: 'Güvenilir',
    dnsQuad9Desc: 'Güvenlik Odaklı',
    dnsOpenDnsDesc: 'Cisco Güvencesi',
    dnsCheckSpeed: 'DNS Ping Test',
    dnsChecking: 'Ölçülüyor...',

    // Section: Troubleshooting
    sectionTroubleshoot: 'SORUN GİDERME',
    fixInternet: 'İnternet Bağlantısını Onar',
    fixInternetDesc: 'Proxy takılı kalırsa interneti otomatik düzeltir.',
    fixRepairing: 'Onarılıyor...',
    fixRepairingDesc: 'Sistem ayarları sıfırlanıyor, lütfen bekleyin.',
    fixDone: 'Onarıldı!',
    fixDoneDesc: 'Proxy ayarları temizlendi ve internet onarıldı.',
    fixError: 'Hata Oluştu!',
    fixErrorDesc: 'İşlem sırasında bir sorun meydana geldi.',

    // Section: Developer
    sectionDev: 'GELİŞTİRİCİ',
    devRole: 'BypaxDPI Geliştiricisi',
    devSubscribe: 'Abone Ol',
    devSupport: 'Destekle',

    // Section: Important Notice
    sectionNotice: 'ÖNEMLİ BİLGİ',
    noticeTitle: 'Güvenlik ve Yanlış Pozitif',
    noticeDesc: 'Bypax motoru, Windows Defender AI gibi yapay zeka tabanlı sistemler tarafından bazen "yanlış pozitif" olarak algılanabilir. Bu durum tamamen zararsızdır. Ayrıca Kaspersky, ESET gibi yazılımlar HTTPS tarama özelliğiyle bağlantıyı engelleyebilir. Erişim sorunu yaşarsanız bu ayarları kontrol edin.',

    // Dialogs
    confirmExitTitle: 'Çıkış',
    confirmExitDesc: 'Bypax motorunu durdurup çıkmak istediğinize emin misiniz?',
    confirmDisconnectTitle: 'Bağlantıyı Kes',
    confirmDisconnectDesc: 'Güvenli bağlantınızı sonlandırmak istediğinize emin misiniz?',

    // Settings Tabs
    tabGeneral: 'GENEL',
    tabNetwork: 'AĞ',
    tabNotification: 'BİLDİRİM',
    tabSystem: 'SİSTEM',
  },

  en: {
    // ===== APP.JSX - Header =====
    appName: 'BYPAXDPI',
    statusActive: 'ACTIVE',
    statusInactive: 'OFF',
    statusReady: 'READY',

    // ===== APP.JSX - Main Status =====
    statusConnected: 'SECURE',
    statusConnecting: 'CONNECTING...',
    statusDisconnecting: 'DISCONNECTING...',
    statusReady2: 'READY',
    descConnected: 'Your connection is encrypted and protected.',
    descConnecting: 'Processing, please wait.',
    descReady: 'Connect for DPI Bypass.',

    // ===== APP.JSX - Buttons =====
    btnConnect: 'CONNECT',
    btnDisconnect: 'DISCONNECT',
    btnConnecting: 'CONNECTING...',
    btnDisconnecting: 'DISCONNECTING...',
    btnConnectDevices: 'Connect Other Devices',

    // ===== APP.JSX - Bottom Nav =====
    navSettings: 'SETTINGS',
    navLogs: 'LOGS',
    navExit: 'EXIT',

    // ===== APP.JSX - Logs Panel =====
    logsTitle: 'SYSTEM LOGS',
    logsClear: 'CLEAR',
    logsCopy: 'COPY',
    logsCopied: 'COPIED!',
    logsCopyError: 'ERROR!',

    // ===== APP.JSX - Connection Modal =====
    modalTitle: 'Connect Device',
    modalSubtitle: 'LAN Sharing',
    modalDesc: 'Go to your device\'s Wi-Fi settings, set <strong>Proxy</strong> to <strong>Manual</strong> and enter the details below.',
    modalDescPac: 'Using <strong>Automatic (PAC)</strong> on other devices is recommended.',
    modalPacQrHint: 'Scan the QR, copy the address and paste it into your phone\'s <strong>Wi-Fi → Proxy → Automatic URL</strong> settings.<br><br><span style="color:#ef4444;font-weight:600">⚠ IMPORTANT:</span> If you experience network issues after disconnecting, turn your phone\'s Wi-Fi off and on again.',
    modalPacUrl: 'PAC URL (Recommended)',
    modalManualFallback: 'Alternative: Manual proxy',
    modalTabPac: 'Automatic (PAC)',
    modalTabManual: 'Manual',
    modalPacQrCaption: 'QR → Setup page (scan and copy)',
    modalHost: 'Server (Host)',
    modalPort: 'Port',
    modalTutorial: 'How To? (Guide)',

    // ===== APP.JSX - Admin Modal =====
    adminTitle: 'Administrator Required',
    adminDesc: 'BypaxDPI needs to run as administrator to work correctly.',
    adminStep: 'Right-click the app → Select <strong>"Run as administrator"</strong>',
    adminClose: 'CLOSE',
    adminHowItWorks: 'How it Works?',

    // ===== APP.JSX - No Internet =====
    noInternetTitle: 'No Internet Connection',
    noInternetDesc: 'Please check your internet connection.',
    noInternetRetry: 'Retry',

    // ===== APP.JSX - Log Messages =====
    logEngineStarting: (port) => `Bypax Engine starting (Port: ${port})...`,
    logDnsUsed: (name, ip) => `DNS: ${name} (${ip})`,
    logDnsDefault: 'DNS: System Default',
    logConnected: 'Connection successful! Traffic is encrypted.',
    logDisconnected: 'Disconnected.',
    logProxySet: (port) => `System Proxy set: 127.0.0.1:${port}`,
    logProxyCleared: 'System Proxy Cleared',
    logEngineStopped: (code) => `Bypax engine stopped unexpectedly (Code: ${code})`,
    logEngineStartError: (err) => `Engine failed to start: ${err}`,
    logAutoReconnect: 'Auto-reconnect enabled...',
    logReconnecting: (n) => `Reconnecting... (Attempt ${n}/5)`,
    logReconnectWait: (sec, n) => `Retrying in ${sec} seconds... (Attempt ${n}/5)`,
    logReconnectNow: 'Reconnecting...',
    logMaxRetries: 'Connection failed. Maximum attempts reached.',
    logPossibleReasons: 'Possible reasons:',
    logReasonInternet: 'Your internet may be disconnected',
    logReasonFirewall: 'Firewall/Antivirus may be blocking Bypax',
    logReasonPorts: 'Ports 8080-8084 may be in use',
    logSolutions: 'Suggested solutions:',
    logSolInternet: 'Check your internet connection',
    logSolFirewall: 'Check your firewall settings',
    logSolAdmin: 'Run the application as administrator',
    logSolLogs: 'Copy and share logs for support',
    logLanRestart: 'LAN sharing changed, restarting connection...',
    logDpiRestart: 'DPI mode changed, restarting connection...',
    logEngineStoppedGrace: 'Bypax engine stopped.',
    logServiceStopped: 'Service stopped.',
    logShutdownStarting: 'Shutdown started...',
    logProcessStopped: 'Process stopped.',
    logSpoofReady: (port) => `✓ SpoofDPI engine started (Port: ${port})`,
    logPacStarted: '✓ PAC server started (for LAN devices)',
    logPacStartError: (err) => `PAC server failed to start: ${err}`,
    logEngineActive: '✓ Bypax engine active',
    logPortBusy: (port) => `⚠ Port ${port} is busy, trying another one...`,
    logInitializing: '⏳ Engine is initializing...',
    logPortRetryOpen: (port) => `Port ${port} could not be opened, retrying...`,
    logProxyClearError: (err) => `Failed to clear proxy: ${err}`,
    logProxySetError: (err) => `Failed to set proxy: ${err}`,
    logServiceStopError: (err) => `Failed to stop service: ${err}`,
    logConfigError: (err) => `Configuration error: ${err}`,
    logAdminMissing: 'Admin permission missing! App may not work correctly.',
    logInternetBack: 'Internet connection restored.',
    logInternetLost: 'Internet connection lost!',
    logPortRetry: (count) => `Port conflict, trying new port... (${count}/20)`,
    logNoPort: 'No available port found.',
    logWpcapMissing: 'SpoofDPI could not find wpcap.dll. Please install Npcap or WinPcap, then restart the application.',
    logAntivirusWarning: 'Windows Defender or your antivirus software may have blocked \'bypax-proxy.exe\'. Please add the file to your antivirus exclusion list.',

    // ===== SETTINGS.JSX =====
    settingsTitle: 'SETTINGS',

    // Section: Connection Method
    sectionMethod: 'CONNECTION METHOD',
    sectionMethodWhy: 'One setting for all ISPs. Use on all devices via LAN. Proxy-based so no ping/jitter in games.',
    methodStrong: 'Strong Mode',
    methodStrongDesc: 'Strongest bypass for tough ISPs (adds latency)',
    methodTurbo: 'Turbo Mode',
    methodTurboDesc: 'Lowest latency, for light DPI',
    methodBalanced: 'Balanced Mode (Recommended)',
    methodBalancedDesc: 'Fast + strong bypass, works on most ISPs',

    // Section: Advanced (Strong mode)
    sectionAdvanced: 'ADVANCED',
    chunkSizeLabel: 'Chunk size',
    chunkSizeDesc: 'Controls how many pieces HTTPS traffic is split into. Depending on your ISP, 4 or 16 may be faster; 8 is usually balanced (default). Try and pick what works best.',
    chunkSize4: '4 — Strongest (some ISPs)',
    chunkSize8: '8 — Balanced (default)',
    chunkSize16: '16 — Faster (some ISPs)',

    // Section: Network
    sectionNetwork: 'NETWORK',
    lanSharing: 'LAN Sharing',
    lanSharingDesc: 'Allow connections from other devices (Phone, Console)',

    // Section: Automation
    sectionAutomation: 'AUTOMATION',
    autoConnect: 'Auto Connect',
    autoConnectDesc: 'Connect as soon as the app opens',
    autoReconnect: 'Auto Reconnect',
    autoReconnectDesc: 'Automatically retry if connection drops',

    // Section: General
    sectionGeneral: 'GENERAL',
    autoStart: 'Start at Boot',
    autoStartDesc: 'Launch Bypax when Windows starts',
    minimizeToTray: 'Minimize to Tray',
    minimizeToTrayDesc: 'Run in background when closed',
    alwaysOnTop: 'Always on Top',
    alwaysOnTopDesc: 'Window stays above all other windows',
    requireConfirmation: 'Action Confirmation',
    requireConfirmationDesc: 'Ask before disconnecting or exiting',
    language: 'LANGUAGE',
    languageDesc: 'Change interface language',

    // Section: Notifications
    sectionNotifications: 'NOTIFICATIONS',
    notifications: 'Desktop Notifications',
    notificationsDesc: 'Master notification switch (Enable/Disable All)',
    notifyOnConnect: 'On Connection Established',
    notifyOnConnectDesc: 'Notify when connection is successfully secured',
    notifyOnDisconnect: 'On Connection Dropped',
    notifyOnDisconnectDesc: 'Notify on unexpected drops or repairs',
    notifDisconnectManual: 'Connection successfully terminated.',

    // Section: DNS
    sectionDns: 'DNS LIST',
    dnsAutoSelect: 'Auto Select (Recommended)',
    dnsAutoSelectDesc: 'Automatically finds the fastest server',
    dnsSystemDefault: 'System Default',
    dnsSystemDefaultDesc: 'SpoofDPI Default DNS',
    dnsCfDesc: 'Fast & Private',
    dnsAdguardDesc: 'Ad Blocker',
    dnsGoogleDesc: 'Reliable',
    dnsQuad9Desc: 'Security Focused',
    dnsOpenDnsDesc: 'Powered by Cisco',
    dnsCheckSpeed: 'DNS Ping Test',
    dnsChecking: 'Measuring...',

    // Section: Troubleshooting
    sectionTroubleshoot: 'TROUBLESHOOTING',
    fixInternet: 'Fix Internet Connection',
    fixInternetDesc: 'Fixes internet if proxy gets stuck.',
    fixRepairing: 'Repairing...',
    fixRepairingDesc: 'Resetting system settings, please wait.',
    fixDone: 'Repaired!',
    fixDoneDesc: 'Proxy settings cleared, internet restored.',
    fixError: 'Error Occurred!',
    fixErrorDesc: 'Something went wrong during the process.',

    // Section: Developer
    sectionDev: 'DEVELOPER',
    devRole: 'BypaxDPI Developer',
    devSubscribe: 'Subscribe',
    devSupport: 'Support',

    // Section: Important Notice
    sectionNotice: 'IMPORTANT',
    noticeTitle: 'Security & False Positives',
    noticeDesc: 'The Bypax engine may sometimes be flagged as a "false positive" by AI-based systems like Windows Defender. This is completely harmless. Also, antivirus software like Kaspersky or ESET may block connections with their HTTPS scanning. If you experience issues, check those settings.',

    // Dialogs
    confirmExitTitle: 'Exit',
    confirmExitDesc: 'Are you sure you want to stop the Bypax engine and exit?',
    confirmDisconnectTitle: 'Disconnect',
    confirmDisconnectDesc: 'Are you sure you want to terminate your secure connection?',

    // Settings Tabs
    tabGeneral: 'GENERAL',
    tabNetwork: 'NETWORK',
    tabNotification: 'ALERTS',
    tabSystem: 'SYSTEM',
  }
};

// Aktif dili getiren hook/fonksiyon
export const getTranslations = (lang = 'tr') => {
  return translations[lang] || translations.tr;
};

export const SUPPORTED_LANGUAGES = [
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
];

export default translations;

import Settings from "./Settings";
import { motion, AnimatePresence } from "framer-motion";
// autostart importları Settings.jsx'te kullanılıyor, burada gerek yok
import { useState, useRef, useEffect, useMemo } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { getTranslations } from "./i18n";
import { DNS_MAP, DOH_MAP, URLS, APP, RETRY_DELAYS, DPI_TIMEOUTS } from "./constants";
import { ISP_PROFILES, VALID_CHUNK_SIZES, VALID_DPI_METHODS, DEFAULT_CHUNKS } from "./profiles";

// Re-add missing imports
import DOMPurify from "dompurify";
import {
  Power,
  Shield,
  Settings as SettingsIcon,
  FileText,
  X,
  Copy,
  Trash2,
  WifiOff,
  Globe,
  Smartphone,
  HelpCircle,
  AlertTriangle,
  Check,
  ZoomIn,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  onAction,
} from "@tauri-apps/plugin-notification";
import { QRCodeSVG } from "qrcode.react";

import "./App.css";

const IS_MACOS = /Mac/.test(navigator.userAgent) && !/Windows/.test(navigator.userAgent);

// ✅ Constants — constants.js'den import ediliyor (DNS_MAP, DOH_MAP, URLS, APP, RETRY_DELAYS, DPI_TIMEOUTS)

const PURIFY_CONFIG = { ALLOWED_TAGS: ['strong', 'em', 'br', 'span', 'b'], ALLOWED_ATTR: ['class'] };

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [currentPort, setCurrentPort] = useState(8080);
  const currentPortRef = useRef(8080); // ✅ #6: Stale closure önleme
  const [lanIp, setLanIp] = useState("127.0.0.1"); // ✅ LAN IP State
  const [pacPort, setPacPort] = useState(8787); // ✅ PAC port (dinamik)
  const [showConnectionModal, setShowConnectionModal] = useState(false); // ✅ Modal State
  const [connectionModalTab, setConnectionModalTab] = useState("pac"); // pac | manual
  const [copiedField, setCopiedField] = useState(null);
  const [showLargeQr, setShowLargeQr] = useState(false);

  const handleCopyField = async (text, fieldName) => {
    try {
      await writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 1500);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  };
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine); // ✅ Internet Durumu
  const [dnsLatencies, setDnsLatencies] = useState({}); // ✅ #5: DNS ping sonuçları kalcı
  const [appIsClosingState, setAppIsClosingState] = useState(false); // Shutdown UX
  const [closingStep, setClosingStep] = useState(0);
  const [closingDots, setClosingDots] = useState("");

  useEffect(() => {
    if (appIsClosingState) {
      const stepTimer = setTimeout(() => {
        setClosingStep(1);
      }, 500);

      const dotTimer = setInterval(() => {
        setClosingDots(prev => prev.length >= 3 ? "" : prev + ".");
      }, 300);

      return () => {
        clearTimeout(stepTimer);
        clearInterval(dotTimer);
      };
    }
  }, [appIsClosingState]);

  // Check Admin on Mount
  useEffect(() => {
    invoke("check_admin")
      .then((result) => {
        setIsAdmin(result);
        if (!result) {
          addLog(t.logAdminMissing, "error", { i18nKey: "logAdminMissing" });
        }
      })
      .catch((err) => {
        console.error("Admin check warning:", err);
        setIsAdmin(true);
      });

    // ✅ Internet Connection Listeners
    const handleOnline = () => {
      setIsOnline(true);
      addLog(t.logInternetBack, "success", { i18nKey: "logInternetBack" });
    };
    const handleOffline = () => {
      setIsOnline(false);
      addLog(t.logInternetLost, "error", { i18nKey: "logInternetLost" });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // ✅ Bildirime tıklanınca uygulamayı öne getir
    let unlistenNotificationAction = null;
    const setupNotificationListener = async () => {
      try {
        unlistenNotificationAction = await onAction((notification) => {
          getCurrentWindow().show();
          getCurrentWindow().setFocus();
        });
      } catch (err) {
        console.error("Failed to setup notification listener:", err);
      }
    };
    setupNotificationListener();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (unlistenNotificationAction) {
        unlistenNotificationAction();
      }
    };
  }, []);

  // Settings State
  // ✅ İlk giriş overlay state
  const [showFirstRunISS, setShowFirstRunISS] = useState(() => {
    return !localStorage.getItem('bypax_first_run_done');
  });

  const [config, setConfig] = useState(() => {
    const defaultSettings = {
      language: "tr",
      autoStart: false,
      autoConnect: false,
      minimizeToTray: false,
      dnsMode: "manual",
      selectedDns: "cloudflare",
      autoReconnect: true,
      dpiMethod: "2",
      httpsChunkSize: 1,
      ipv4Only: true,
      selectedIspProfile: "heavy",
    };

    const saved = localStorage.getItem("bypax_config");
    if (saved) {
      try {
        // P1-FIX: LocalStorage Obfuscation (Uyumluluk için önce düz metin mi kontrol et)
        let parsedStr = saved;
        if (!saved.startsWith("{")) {
          parsedStr = decodeURIComponent(escape(atob(saved))); // Geriye dönük uyumluluk (eski config)
        }
        const parsed = JSON.parse(parsedStr);
        if (typeof parsed !== 'object' || parsed === null) return defaultSettings;
        
        // P1-FIX: Load esnasında Sidecar Injection'u engellemek için tip güvenlik (Config Validation)
        // ✅ FIX: httpsChunkSize artık 1 ve 2 değerlerini de kabul ediyor (ISS profil değerleri)
        return { 
          ...defaultSettings, 
          ...parsed,
          dpiMethod: ['0', '1', '2'].includes(String(parsed.dpiMethod)) ? String(parsed.dpiMethod) : defaultSettings.dpiMethod,
          httpsChunkSize: [1, 2, 4, 8, 16, 32, 64, 128].includes(Number(parsed.httpsChunkSize)) ? Number(parsed.httpsChunkSize) : defaultSettings.httpsChunkSize,
          selectedDns: typeof parsed.selectedDns === 'string' ? parsed.selectedDns : defaultSettings.selectedDns,
        };
      } catch (e) {
        console.error("Failed to parse config:", e);
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  // ✅ i18n: Reactive translations (config'den sonra olmalı!)
  const t = useMemo(
    () => getTranslations(config.language || "tr"),
    [config.language],
  );

  const childProcess = useRef(null);
  const isStartingEngine = useRef(false);
  const logsEndRef = useRef(null);
  const isRetrying = useRef(false);

  // ✅ Auto-reconnect mekanizması
  const retryCount = useRef(0);
  const retryTimer = useRef(null);
  const userIntentDisconnect = useRef(false);
  const fatalErrorRef = useRef(false);
  // ✅ Çıkış işlemi başladı mı? (çift modal engellemek için)
  const isExiting = useRef(false);
  const trayQuitRef = useRef(false);
  const prevLanSharingRef = useRef(config.lanSharing ?? false);
  const prevDpiMethodRef = useRef(config.dpiMethod);
  const prevChunkSizeRef = useRef(config.httpsChunkSize ?? 4);
  const prevSelectedDnsRef = useRef(config.selectedDns);
  const prevDnsModeRef = useRef(config.dnsMode);
  const prevEnableWinhttpRef = useRef(config.enableWinhttp !== false);
  const prevIpv4OnlyRef = useRef(config.ipv4Only !== false);

  // DNS_MAP ve DOH_MAP artık component dışında tanımlı (yukarıda)

  const updateConfig = (keyOrObj, value) => {
    setConfig((prev) => {
      let newConfig;
      if (typeof keyOrObj === 'object' && keyOrObj !== null) {
        newConfig = { ...prev, ...keyOrObj };
      } else {
        newConfig = { ...prev, [keyOrObj]: value };
      }
      // P1-FIX: Base64 kodlaması kaldırıldı, plaintext validasyonlu yazılıyor
      localStorage.setItem("bypax_config", JSON.stringify(newConfig));
      return newConfig;
    });
  };

  // Custom Confirm State
  const confirmResolver = useRef(null);
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: "",
    desc: "",
  });

  const customConfirm = (desc, options) => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        title: options?.title || "",
        desc: desc,
      });
      confirmResolver.current = resolve;
    });
  };

  const handleConfirmResult = (result) => {
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
    if (confirmResolver.current) {
      confirmResolver.current(result);
      confirmResolver.current = null;
    }
  };

  const notifyUser = async (title, body, eventType) => {
    try {
      if (configRef.current.notifications === false) return; // Kullanıcı bildirimleri kapattıysa
      if (
        eventType === "connect" &&
        configRef.current.notifyOnConnect === false
      )
        return;
      if (
        eventType === "disconnect" &&
        configRef.current.notifyOnDisconnect === false
      )
        return;
      if (
        eventType === "disconnect_manual" &&
        configRef.current.notifyOnDisconnect === false
      )
        return;

      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === "granted";
      }
      if (permissionGranted) {
        sendNotification({ title, body });
      }
    } catch (err) {
      console.error("Notification error:", err);
    }
  };

  const resolveI18nMessage = (key, params = []) => {
    if (!key) return "";
    const value = t[key];
    if (!value) return "";
    if (typeof value === "function") {
      return value(...params);
    }
    return value;
  };

  const addLog = (msg, type = "info", meta = {}) => {
    const { i18nKey, i18nParams } = meta;

    let finalMsg = msg;
    if (i18nKey) {
      finalMsg = resolveI18nMessage(i18nKey, i18nParams);
    }

    if (!finalMsg || finalMsg.toString().trim().length === 0) return;

    const cleanMsg = finalMsg.toString().replace(/\x1b\[[0-9;]*m/g, "");
    // ✅ #12: Sadece 100'ü aşınca kırp (her seferinde slice yerine)
    setLogs((prev) => {
      const next = [
        ...prev,
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString(),
          msg: cleanMsg,
          type,
          i18nKey: i18nKey || null,
          i18nParams: i18nParams || null,
        },
      ];
      return next.length > APP.maxLogs ? next.slice(-APP.maxLogs) : next;
    });
  };

  // Dil değiştiğinde i18n loglarını güncelle
  useEffect(() => {
    setLogs((prev) =>
      prev.map((log) => {
        if (!log.i18nKey) return log;
        const msg = resolveI18nMessage(log.i18nKey, log.i18nParams || []);
        return { ...log, msg };
      }),
    );
  }, [t]);

  const [copyStatus, setCopyStatus] = useState("idle"); // idle, success, error

  const copyLogs = async () => {
    if (logs.length === 0) return;

    const logText = logs.map((l) => `[${l.time}] ${l.msg}`).join("\n");

    try {
      await writeText(logText);
      setCopyStatus("success");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch (e) {
      console.error("Tauri clipboard failed, trying navigator:", e);
      try {
        await navigator.clipboard.writeText(logText);
        setCopyStatus("success");
        setTimeout(() => setCopyStatus("idle"), 1500);
      } catch (navError) {
        console.error("Navigator clipboard also failed:", navError);
        setCopyStatus("error");
        setTimeout(() => setCopyStatus("idle"), 1500);
      }
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const clearProxy = async (silent = false) => {
    try {
      await invoke("clear_system_proxy");
      if (!silent) {
        addLog(t.logProxyCleared, "success", { i18nKey: "logProxyCleared" });
      }
    } catch (e) {
      addLog(t.logProxyClearError(e), "warn", {
        i18nKey: "logProxyClearError",
        i18nParams: [e],
      });
      console.error(e);
    }
  };

  // ✅ Exponential backoff hesaplama — ilk retry'da da 2.5s bekle (TIME_WAIT)
  const getRetryDelay = (attempt) => {
    return RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
  };

  // ✅ Tray tooltip güncelle — configRef + currentPortRef kullanarak stale closure önlenir
  const updateTrayTooltip = async (status) => {
    try {
      let tooltip = "";
      switch (status) {
        case "connected":
          const selectedDns = configRef.current.selectedDns;
          const dnsName = DNS_MAP[selectedDns]
            ? Object.keys(DNS_MAP)
                .find((key) => DNS_MAP[key] === DNS_MAP[selectedDns])
                ?.toUpperCase()
            : "SYSTEM";
          tooltip = `🟢 BypaxDPI - ${t.statusConnected}\n127.0.0.1:${currentPortRef.current}\nDNS: ${dnsName}`;
          break;
        case "disconnected":
          tooltip = `🔴 BypaxDPI - ${t.statusInactive}`;
          break;
        case "retrying":
          tooltip = `🔄 BypaxDPI - ${t.btnConnecting}\n${retryCount.current}/5...`;
          break;
        case "connecting":
          tooltip = `⏳ BypaxDPI - ${t.btnConnecting}`;
          break;
        default:
          tooltip = "🛡️ BypaxDPI";
      }
      await invoke("update_tray_tooltip", { tooltip });
    } catch (e) {
      console.error("Tray tooltip güncelleme hatası:", e);
    }
  };

  // ✅ Otomatik yeniden bağlanma
  const attemptReconnect = () => {
    // Timer varsa temizle
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    const currentAttempt = retryCount.current;
    const maxAttempts = APP.maxReconnectAttempts;

    if (currentAttempt >= maxAttempts) {
      // Maksimum deneme aşıldı
      addLog(`=4 ${t.logMaxRetries}`, "error", { i18nKey: "logMaxRetries" });
      addLog("", "info");
      addLog(`=� ${t.logPossibleReasons}`, "warn", {
        i18nKey: "logPossibleReasons",
      });
      addLog(`  • ${t.logReasonInternet}`, "info", {
        i18nKey: "logReasonInternet",
      });
      addLog(`  • ${t.logReasonFirewall}`, "info", {
        i18nKey: "logReasonFirewall",
      });
      addLog(`  • ${t.logReasonPorts}`, "info", { i18nKey: "logReasonPorts" });
      addLog("", "info");
      addLog(`=� ${t.logSolutions}`, "warn", { i18nKey: "logSolutions" });
      addLog(`  • ${t.logSolInternet}`, "info", { i18nKey: "logSolInternet" });
      addLog(`  • ${t.logSolFirewall}`, "info", { i18nKey: "logSolFirewall" });
      addLog(`  • ${t.logSolAdmin}`, "info", { i18nKey: "logSolAdmin" });
      addLog(`  • ${t.logSolLogs}`, "info", { i18nKey: "logSolLogs" });

      retryCount.current = 0;
      setIsProcessing(false);
      return;
    }

    const delay = getRetryDelay(currentAttempt);
    retryCount.current++;

    if (delay === 0) {
      addLog(`🔄 ${t.logReconnecting(currentAttempt + 1)}`, "warn", {
        i18nKey: "logReconnecting",
        i18nParams: [currentAttempt + 1],
      });
      startEngine(8080);
    } else {
      addLog(
        `⏳ ${t.logReconnectWait(delay / 1000, currentAttempt + 1)}`,
        "warn",
        {
          i18nKey: "logReconnectWait",
          i18nParams: [delay / 1000, currentAttempt + 1],
        },
      );
      updateTrayTooltip("retrying");
      retryTimer.current = setTimeout(() => {
        addLog(`🔄 ${t.logReconnectNow}`, "info", {
          i18nKey: "logReconnectNow",
        });
        startEngine(8080);
      }, delay);
    }
  };

  // Port açık mı? Rust ile TCP bağlantı dener
  const waitForPort = async (port, maxAttempts = APP.portCheckMaxAttempts) => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const open = await invoke("check_port_open", { port });
        if (open) return true;
      } catch (e) {
        console.warn("Port check error:", e);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  const startEngine = async (ignoredPort, portRetryCount = 0) => {
    // P2-FIX: Asynchronous execution lock -> Aynı anda iki instance spawn edilmesini önler
    if (isStartingEngine.current || childProcess.current) return;
    isStartingEngine.current = true;

    updateTrayTooltip("connecting");

    // ✅ #2: fatalErrorRef'i sıfırla — önceki oturumdaki wpcap hatası yeni bağlantıyı bloklamasın
    fatalErrorRef.current = false;

    // Max 20 retries
    if (portRetryCount >= APP.maxPortRetries) {
      addLog(t.logNoPort, "error", { i18nKey: "logNoPort" });
      setIsProcessing(false);
      isStartingEngine.current = false;
      return;
    }

    // ✅ Rust'tan Smart Configuration al (Port & IP)
    let configData;
    let port;
    let bindAddr;

    try {
      configData = await invoke("get_sidecar_config", {
        allowLanSharing: configRef.current.lanSharing || false,
        enableGameMode: configRef.current.enableWinhttp !== false,
      });
      port = configData.port;
      bindAddr = configData.bind_address;
      setLanIp(configData.lan_ip); // IP'yi state'e kaydet
    } catch (e) {
      addLog(t.logConfigError(e), "error", {
        i18nKey: "logConfigError",
        i18nParams: [e],
      });
      setIsProcessing(false);
      isStartingEngine.current = false;
      return;
    }

    if (childProcess.current) {
        try {
          await childProcess.current.kill();
        } catch (_) {}
        childProcess.current = null;
    }
    await clearProxy(true);

    // ✅ #3: configRef.current kullan — stale closure önlenir
    const currentDns = configRef.current.selectedDns;
    const dnsIP = DNS_MAP[currentDns];

    addLog(t.logEngineStarting(port), "info", {
      i18nKey: "logEngineStarting",
      i18nParams: [port],
    });

    // DNS bilgisi
    if (dnsIP) {
      addLog(t.logDnsUsed(currentDns.toUpperCase(), dnsIP), "info", {
        i18nKey: "logDnsUsed",
        i18nParams: [currentDns.toUpperCase(), dnsIP],
      });
    } else {
      addLog(t.logDnsDefault, "info", { i18nKey: "logDnsDefault" });
    }

    isRetrying.current = false;

    try {
      // ✅ Yeni 3-mod timeout sistemi: 0=Turbo, 1=Dengeli, 2=Güçlü
      const TIMEOUT_MS = DPI_TIMEOUTS[configRef.current.dpiMethod] ?? 5000;

      const listenAddr = `${bindAddr}:${port}`;

      const args =[
        "--clean", 
        "--listen-addr", listenAddr,
        "--timeout", TIMEOUT_MS.toString(),
        "--silent",
        "--log-level", "info",
      ];

      // IPv4 Zorlaması (Sende çalışan stabil yapı)
      if (configRef.current.ipv4Only !== false) {
        args.push("--dns-qtype", "ipv4");
      } else {
        args.push("--dns-qtype", "all");
      }

      // DNS ayarı
      if (currentDns === "system" || !dnsIP) {
        args.push("--dns-mode", "system");
      } else {
        const dohUrl = DOH_MAP[currentDns];
        if (dohUrl) {
          args.push("--dns-mode", "https", "--dns-https-url", dohUrl);
        } else {
          args.push("--dns-addr", `${dnsIP}:53`, "--dns-mode", "udp");
        }
      }

      // ========================================================
      // SÜRÜCÜSÜZ (PORTABLE) DPI BYPASS
      // Sadece 'chunk' modu ile Kablonet/Superonline geçilir.
      // ========================================================
      const dpiMethod = configRef.current.dpiMethod || "1";
      const userChunk = [1, 2, 4, 8, 16].includes(Number(configRef.current.httpsChunkSize))
        ? String(configRef.current.httpsChunkSize)
        : "2";

      // 🛑 Önemli: Sürücü kontrolü yap (Rust tarafındaki check_driver komutunu kullan)
      const hasDriver = await invoke('check_driver');
      
      if (dpiMethod === "2") {
        const advancedBypass = configRef.current.advancedBypass !== false; // default true if driver installed
        if (hasDriver && advancedBypass) {
          // Sürücü var ve gelişmiş bypass açık: Fake packet ile en güçlü atlatma
          args.push("--https-split-mode", "chunk", "--https-chunk-size", "1", "--https-fake-count", "3");
          addLog(t.logStrongFake || "🚀 Güçlü Mod: Fake Paket (3) aktif.", "success");
        } else {
          // Sürücü yok veya gelişmiş bypass kapalı: Sadece Chunk 1
          args.push("--https-split-mode", "chunk", "--https-chunk-size", "1");
          if (!hasDriver && !IS_MACOS) {
            addLog(t.logStrongNoDriver || "⚠️ Güçlü Mod: Sürücü yok, sadece Chunk-1 aktif.", "warn");
          } else {
            addLog(t.logStrongChunkOnly || "🛡️ Güçlü Mod: Chunk-1 aktif.", "info");
          }
        }
      } else if (dpiMethod === "1") {
        args.push("--https-split-mode", "chunk", "--https-chunk-size", userChunk);
      } else {
        args.push("--https-split-mode", "sni");
      }

      const command = Command.sidecar("binaries/bypax-proxy", args);

      let connectionConfirmed = false;
      let isReady = false;

      // Optimized regex pattern - compiled once (regex literal / karışmasın diye string + new RegExp)
      const SKIP_PATTERN = new RegExp(
        "\\[(?:PROXY|DNS|HTTPS|CACHE|app)]|method:\\s*CONNECT|cache (?:miss|hit)|resolving|routing|resolution took|new conn|client sent hello|shouldExploit|useSystemDns|fragmentation|conn established|writing chunked|caching \\d+ records|[a-f0-9]{8}-[a-f0-9]{8}|d88|Y88|88P|level=|ctrl \\+ c|listen_addr|dns_addr|github\\.com|spoofdpi|connection timeout|\\[::1\\]|ipv6|AAAA|no suitable address|network is unreachable|connectex.*\\[|telemetry\\.net|dns lookup failed",
        "i",
      );
      // Bağlantı kesilirken / yeniden bağlanırken SpoofDPI tüm tünelleri kapatır; her biri "error handling request" / "wsarecv ... aborted" WRN basar - kullanıcı loguna taşıma
      const isTunnelShutdownNoise = (l) =>
        /\[pxy\].*error handling request|unsuccessful tunnel|wsarecv|aborted by the software in your host machine|failed to read http request|malformed HTTP request|invalid method/i.test(
          l,
        );

      const handleOutput = async (line, type) => {
        const trimmedLine = line.trim();
        const lowerLine = line.toLowerCase();

        if (trimmedLine.length === 0) return;
        if (/^(DBG|INF|WRN|ERR)\s+\d{4}-/.test(trimmedLine)) return;
        if (line.includes("888")) return;
        if (isTunnelShutdownNoise(line)) return;

        if (SKIP_PATTERN.test(line)) return;

        // Optimized alpha check
        const alphaCount = line.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, "").length;
        if (alphaCount < 5 && trimmedLine.length > 3) return;

        let friendlyKey = null;
        let friendlyParams = [];

        const isWpcapError =
          lowerLine.includes("couldn't load wpcap.dll") ||
          lowerLine.includes("error starting network detector");

        if (isWpcapError) {
          fatalErrorRef.current = true;
          friendlyKey = "logWpcapMissing";
        }

        // Port hatası (sadece gerçekten "in use" hatalarında tetikle)
        const isPortInUse =
          (lowerLine.includes("bind") || lowerLine.includes("yuva adresi")) &&
          (lowerLine.includes("already in use") ||
            lowerLine.includes("only one usage"));

        if (
          lowerLine.includes("listening on") ||
          lowerLine.includes("created a listener")
        ) {
          isReady = true;
          friendlyKey = "logSpoofReady";
          friendlyParams = [port];
        } else if (lowerLine.includes("server started")) {
          isReady = true;
          friendlyKey = "logEngineActive";
        } else if (isPortInUse) {
          friendlyKey = "logPortBusy";
          friendlyParams = [port];
        } else if (lowerLine.includes("initializing")) {
          friendlyKey = "logInitializing";
        }

        if (friendlyKey) {
          const msg = resolveI18nMessage(friendlyKey, friendlyParams);
          // Her mesaj tipine uygun renk ata
          let logType = "info";
          if (friendlyKey === "logWpcapMissing") {
            logType = "error";
          } else if (friendlyKey === "logPortBusy") {
            logType = "warn";
          } else if (friendlyKey === "logSpoofReady" || friendlyKey === "logEngineActive") {
            logType = "success";
          } else if (friendlyKey === "logInitializing") {
            logType = "info";
          }
          addLog(msg, logType, {
            i18nKey: friendlyKey,
            i18nParams: friendlyParams,
          });
        } else {
          // Friendly mapping yoksa, ham SpoofDPI çıktısını da göster ki hata detayları kaybolmasın
          addLog(trimmedLine, type === "warn" ? "warn" : "info");
        }

        // Wait for port to be actually ready (listener log geldikten sonra kısa bekle; SpoofDPI 1.2.1 bazen geç bind ediyor)
        if (!connectionConfirmed && isReady) {
          connectionConfirmed = true;
          await new Promise((r) => setTimeout(r, 400));
          const portReady = await waitForPort(port);
          if (!portReady) {
            addLog(t.logPortRetryOpen(port), "warn", {
              i18nKey: "logPortRetryOpen",
              i18nParams: [port],
            });
            // Sonraki portu dene: process'i kapat, Rust yeni port verecek, yeniden başlat
            if (portRetryCount < 19) {
              isRetrying.current = true;
              if (childProcess.current) {
                childProcess.current.kill().catch(() => {});
                childProcess.current = null;
              }
              setTimeout(() => {
                isRetrying.current = false;
                startEngine(0, portRetryCount + 1);
              }, 2000);
            }
            return;
          }

          setCurrentPort(port);
          currentPortRef.current = port;
          try {
            await invoke("set_system_proxy", { port, enableWinhttp: configRef.current.enableWinhttp !== false });
            addLog(t.logProxySet(port), "success", {
              i18nKey: "logProxySet",
              i18nParams: [port],
            });
            if (configRef.current.enableWinhttp !== false) {
              addLog(t.logWinHttpEnabled, "warn", { i18nKey: "logWinHttpEnabled" });
            }
          } catch (err) {
            addLog(t.logProxySetError(err), "error", {
              i18nKey: "logProxySetError",
              i18nParams: [err],
            });
            return;
          }

          // ✅ Başarılı bağlantı - retry mekanizmasını sıfırla
          retryCount.current = 0;
          userIntentDisconnect.current = false;

          setIsConnected(true);
          setIsProcessing(false);
          addLog(t.logConnected, "success", { i18nKey: "logConnected" });
          notifyUser("Bypax", t.logConnected, "connect");
          updateTrayTooltip("connected");
          if (configRef.current.lanSharing) {
            (async () => {
              try {
                const pacResult = await invoke("start_pac_server", { proxyPort: port });
                if (pacResult?.pac_port) setPacPort(pacResult.pac_port);
                addLog(t.logPacStarted, "success", {
                  i18nKey: "logPacStarted",
                });
              } catch (e) {
                addLog(t.logPacStartError(e), "warn", {
                  i18nKey: "logPacStartError",
                  i18nParams: [e],
                });
              }
            })();
          }
        }

        const isPortError = isPortInUse;

        if (
          !fatalErrorRef.current &&
          isPortError &&
          (lowerLine.includes("error") ||
            lowerLine.includes("fail") ||
            lowerLine.includes("ftl")) &&
          !isRetrying.current
        ) {
          isRetrying.current = true;

          if (childProcess.current) {
            childProcess.current.kill().catch(() => {});
            childProcess.current = null;
          }

          setTimeout(() => {
            // Smart Retry: Port increment yerine Rust'ın yeni port bulmasına güveniyoruz
            // Ama yine de recursion için count artırıyoruz
            startEngine(0, portRetryCount + 1);
          }, 1000);
        }
      };

      command.on("close", (data) => {
        if (!isRetrying.current) {
          const isUnexpectedClose = data.code !== 0 && data.code !== null;

          // ✅ ÖNCE user intent kontrol et
          if (userIntentDisconnect.current) {
            // Kullanıcı kasıtlı kapattı - normal mesaj göster
            addLog(t.logEngineStoppedGrace, "info", {
              i18nKey: "logEngineStoppedGrace",
            });
            setIsConnected(false);
            setIsProcessing(false);
            childProcess.current = null;
            (async () => {
              try {
                await invoke("stop_pac_server");
                await clearProxy(true);
              } catch (err) {
                console.error(err);
              }
            })();

            // Reset flags
            retryCount.current = 0;
            userIntentDisconnect.current = false;
            return; // Erken çık, retry yapma
          }

          // Kullanıcı kasıtlı kapatmadı - beklenmedik kapanma
          if (isUnexpectedClose) {
            const exitCode = data.code ?? "Bilinmiyor (Zorla Kapatıldı)";
            const warnMsg = `⚠️ ${t.logEngineStopped(exitCode)}`;
            addLog(warnMsg, "warn", {
              i18nKey: "logEngineStopped",
              i18nParams: [exitCode],
            });
          } else {
            addLog(t.logEngineStoppedGrace, "info", {
              i18nKey: "logEngineStoppedGrace",
            });
          }

          // ✅ childProcess null yapılmadan önce backup al
          const hadActiveProcess = childProcess.current !== null;

          setIsConnected(false);
          setIsProcessing(false);
          childProcess.current = null;
          (async () => {
            try {
              await invoke("stop_pac_server");
              await clearProxy(true);
            } catch (err) {
              console.error(err);
            }
          })();
          updateTrayTooltip("disconnected"); // ✅ Bağlantı koptu (geçici)

          // ✅ Hızlı crash tespiti: Güçlü Mod + Fake Paket crash’i ise Npcap sorunu (Ölümcül hatayı override et)
          const isStrongWithFake = configRef.current.dpiMethod === '2' && configRef.current.advancedBypass !== false;
          if (fatalErrorRef.current && isStrongWithFake) {
            addLog(t.logNpcapFallback || "⚠️ Npcap sürücüsü yanıt vermiyor. Gelişmiş bypass kapatılıp tekrar deneniyor...", "warn");
            configRef.current = { ...configRef.current, advancedBypass: false };
            setConfig(prev => ({ ...prev, advancedBypass: false }));
            localStorage.setItem('bypax_config', JSON.stringify({ ...configRef.current, advancedBypass: false }));
            retryCount.current = 0; // Reset retry
            fatalErrorRef.current = false; // Hatayı temizle, tekrar denesin
            setIsProcessing(true);
            attemptReconnect();
            return;
          }

          // ✅ Otomatik yeniden bağlanma kontrol
          const autoReconnectEnabled =
            configRef.current.autoReconnect !== false; // undefined veya true ise açık

          const shouldReconnect =
            autoReconnectEnabled && // Ayarda açık mı?
            !userIntentDisconnect.current && // Kullanıcı kasıtlı kapatmadı mı?
            !fatalErrorRef.current && // Ölümcül hata yok mu?
            hadActiveProcess; // Process çalışıyor muydu?

          if (shouldReconnect) {
            addLog(`🔄 ${t.logAutoReconnect}`, "info", {
              i18nKey: "logAutoReconnect",
            });
            notifyUser("BypaxDPI", t.logAutoReconnect, "disconnect");
            setIsProcessing(true);
            attemptReconnect();
          }
        }
      });

      command.stderr.on("data", (line) => handleOutput(line, "warn"));
      command.stdout.on("data", (line) => handleOutput(line, "info"));

      const child = await command.spawn();
      childProcess.current = child;
      invoke("save_sidecar_pid", { pid: child.pid }).catch(console.warn);
      isStartingEngine.current = false; // Mülkiyeti childProcess'e devret

      // Failsafe timeout
      setTimeout(async () => {
        if (
          childProcess.current &&
          !connectionConfirmed &&
          !isRetrying.current
        ) {
          // P1-FIX: Proxy'yi Windows'a yazmadan önce uygulamanın gerçekten port dinlediğini TCP ile doğrula
          const portReady = await waitForPort(port, 3);
          if (!portReady) {
            addLog(t.logFailsafePortClosed || "Beklenmeyen Hata: Proxy başlatılamadı", "error");
            if (childProcess.current) {
              childProcess.current.kill().catch(() => {});
              childProcess.current = null;
            }
            setIsProcessing(false);
            return;
          }

          connectionConfirmed = true;
          setCurrentPort(port);
          currentPortRef.current = port;

          try {
            await invoke("set_system_proxy", { port: port, enableWinhttp: configRef.current.enableWinhttp !== false });
          } catch (err) {
            addLog(t.logProxySetError(err), "error", {
              i18nKey: "logProxySetError",
              i18nParams: [err],
            });
          }

          // ✅ Başarılı bağlantı - retry mekanizmasını sıfırla
          retryCount.current = 0;
          userIntentDisconnect.current = false;

          setIsConnected(true);
          setIsProcessing(false);
          addLog(t.logConnected, "info", { i18nKey: "logConnected" });
          notifyUser("BypaxDPI", t.logConnected, "connect");
          updateTrayTooltip("connected"); // ✅ Auto-connect başarılı
          if (configRef.current.lanSharing) {
            try {
              const pacResult = await invoke("start_pac_server", { proxyPort: port });
              if (pacResult?.pac_port) setPacPort(pacResult.pac_port);
              addLog(t.logPacStarted, "success", { i18nKey: "logPacStarted" });
            } catch (e) {
              addLog(t.logPacStartError(e), "warn", {
                i18nKey: "logPacStartError",
                i18nParams: [e],
              });
            }
          }
        }
      }, DPI_TIMEOUTS[configRef.current.dpiMethod] ?? 5000); // Mod'a uygun failsafe timeout
    } catch (e) {
      isStartingEngine.current = false; // Lock release on start failure
      addLog(t.logEngineStartError(e), "error", {
        i18nKey: "logEngineStartError",
        i18nParams: [e],
      });

      const errStr = String(e).toLowerCase();
      if (errStr.includes("denied") || errStr.includes("access") || errStr.includes("not found") || errStr.includes("os error")) {
        const msg = IS_MACOS
          ? "⚠️ bypax-proxy çalıştırma izni reddedildi. Terminal'de: chmod +x bypax-proxy"
          : "⚠️ " + (t.logAntivirusWarning || "Windows Defender veya antivirüs yazılımınız 'bypax-proxy.exe' dosyasını engellemiş olabilir. Lütfen dosyayı antivirüs dışlama listesine (exclusion) ekleyin.");
        addLog(msg, "warn", IS_MACOS ? {} : { i18nKey: "logAntivirusWarning" });
      }
      setIsConnected(false);
      setIsProcessing(false);
      try {
        await clearProxy();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const toggleConnection = async () => {
    // ✅ FIX: isProcessing VEYA restart sırasında toggle'ı engelle (race condition fix)
    if (isProcessing || isRestartingDpi.current || isRestartingLan.current) return;

    if (isConnected) {
      if (configRef.current.requireConfirmation !== false) {
        const confirmed = await customConfirm(
          t.confirmDisconnectDesc ||
            "Güvenli bağlantınızı sonlandırmak istediğinize emin misiniz?",
          { title: t.confirmDisconnectTitle || "Bağlantıyı Kes" },
        );
        if (!confirmed) return;
      }

      // ✅ Kullanıcı kasıtlı olarak bağlantıyı kesiyor
      userIntentDisconnect.current = true;

      // Retry timer varsa iptal et
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }

      setIsProcessing(true);
      if (childProcess.current) {
        try {
          addLog(t.logDisconnected, "warn", { i18nKey: "logDisconnected" });
          try {
            await invoke("stop_pac_server");
          } catch (_) {}
          await childProcess.current.kill();
        } catch (e) {
          addLog(t.logServiceStopError(e), "error", {
            i18nKey: "logServiceStopError",
            i18nParams: [e],
          });
        }
        childProcess.current = null;
      }
      setIsConnected(false);
      await clearProxy();
      addLog(t.logServiceStopped, "success", { i18nKey: "logServiceStopped" });

      // Eğer kapatma (shutdown) sırasındaysa, bildirim yollama.
      if (!isAppClosingRef.current) {
        notifyUser("BypaxDPI", t.notifDisconnectManual, "disconnect_manual"); // Özel notification event tipi
      }

      setIsProcessing(false);
      updateTrayTooltip("disconnected"); // ✅ Manuel durdurma
    } else {
      // ✅ Kullanıcı manuel bağlanıyor - retry counter sıfırla
      retryCount.current = 0;
      userIntentDisconnect.current = false;

      setIsProcessing(true);
      startEngine(8080);
    }
  };

  useEffect(() => {
    // logsEndRef
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ✅ #4: useRef kullanarak stale closure önlenir (useState idi)
  const isAppClosingRef = useRef(false);

  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // ✅ "Her şeyin üzerinde tut" ayarı değişince pencereye uygula
  useEffect(() => {
    (async () => {
      try {
        const win = getCurrentWindow();
        await win.setAlwaysOnTop(config.alwaysOnTop || false);
      } catch (e) {
        console.error("setAlwaysOnTop failed:", e);
      }
    })();
  }, [config.alwaysOnTop]);

  // ✅ LAN Sharing değişince bağlı bağlantıyı yeni ayarla yeniden başlat
  const isRestartingLan = useRef(false);
  useEffect(() => {
    if (prevLanSharingRef.current === config.lanSharing) return;
    prevLanSharingRef.current = config.lanSharing;

    if (!isConnected || isRestartingLan.current) return;
    isRestartingLan.current = true;

    addLog(t.logLanRestart, "warn", { i18nKey: "logLanRestart" });

    // Kullanıcıya süreç boyunca "yeniden bağlanıyor" hissi ver
    setIsProcessing(true);
    updateTrayTooltip("connecting");

    // Manuel restart: auto-reconnect karışmasın
    userIntentDisconnect.current = true;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    if (childProcess.current) {
      childProcess.current.kill().catch(() => {});
      childProcess.current = null;
    }
    (async () => {
      try {
        await invoke("stop_pac_server");
      } catch (_) {}
    })();
    setIsConnected(false);

    setTimeout(() => {
      userIntentDisconnect.current = false;
      isRestartingLan.current = false;
      setIsProcessing(true);
      startEngine(0);
    }, 2500); // Portun serbest kalması için (SpoofDPI 1.2.1 / TIME_WAIT)
  }, [config.lanSharing, isConnected]);

  // ✅ P1-FIX: DPI modu, chunk size VEYA DNS değişince bağlı bağlantıyı otomatik yeniden başlat (Stale DNS önleme)
  const isRestartingDpi = useRef(false);
  const [isApplyingSettings, setIsApplyingSettings] = useState(false);
  useEffect(() => {
    const chunkSize = config.httpsChunkSize ?? 4;
    const winhttp = config.enableWinhttp !== false;
    const ipv4 = config.ipv4Only !== false;
    if (
      prevDpiMethodRef.current === config.dpiMethod &&
      prevChunkSizeRef.current === chunkSize &&
      prevSelectedDnsRef.current === config.selectedDns &&
      prevDnsModeRef.current === config.dnsMode &&
      prevEnableWinhttpRef.current === winhttp &&
      prevIpv4OnlyRef.current === ipv4
    )
      return;
    prevDpiMethodRef.current = config.dpiMethod;
    prevChunkSizeRef.current = chunkSize;
    prevSelectedDnsRef.current = config.selectedDns;
    prevDnsModeRef.current = config.dnsMode;
    prevEnableWinhttpRef.current = winhttp;
    prevIpv4OnlyRef.current = ipv4;

    if (!isConnected || isRestartingDpi.current) return;
    isRestartingDpi.current = true;
    setIsApplyingSettings(true);

    addLog(t.logDpiRestart, "warn", { i18nKey: "logDpiRestart" });

    setIsProcessing(true);
    updateTrayTooltip("connecting");

    userIntentDisconnect.current = true;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    if (childProcess.current) {
      childProcess.current.kill().catch(() => {});
      childProcess.current = null;
    }
    setIsConnected(false);

    setTimeout(() => {
      userIntentDisconnect.current = false;
      isRestartingDpi.current = false;
      setIsApplyingSettings(false);
      setIsProcessing(true);
      startEngine(0);
    }, 2500); // Portun serbest kalması için (SpoofDPI 1.2.1 / TIME_WAIT)
  }, [config.dpiMethod, config.httpsChunkSize, config.selectedDns, config.dnsMode, config.enableWinhttp, config.ipv4Only, isConnected]);

  useEffect(() => {
    // Initial cleanup on mount
    (async () => {
      try {
        // P0-FIX-1: Crash/BSOD sonrası kalan proxy ayarlarını sentinel ile tespit edip temizle
        const wasDirty = await invoke("startup_proxy_cleanup").catch((e) => {
          console.warn("Startup proxy cleanup:", e);
          return false;
        });
        if (wasDirty) {
          addLog("⚠️ Önceki oturum düzgün kapanmamış — proxy ayarları temizlendi", "warn", {
            i18nKey: "logDirtyShutdownRecovery",
          });
        }

        // ✅ Sorun 4: Zombi süreçleri temizle (önceki çökme/force kill sonrası kalmış olabilir)
        await invoke("kill_zombie_sidecar").catch((e) =>
          console.log("Zombi temizleme:", e)
        );
        // ✅ Sorun 1: Proxy'yi temizle (çökme sonrası kalıntı)
        await clearProxy(true);
        updateTrayTooltip("disconnected");

        // P1-FIX: Auto-Connect Race Condition çözümü (Temizlik adımları tamamlandıktan SONRA bağlan)
        // ✅ İlk giriş overlay'ı açıksa auto-connect yapma — kullanıcı ISS seçsin önce
        const isFirstRun = !localStorage.getItem('bypax_first_run_done');
        if (configRef.current.autoConnect && !childProcess.current && !isFirstRun) {
          setIsProcessing(true);
          startEngine(8080);
        }
      } catch (e) {
        console.error("Initial cleanup failed:", e);
      }
    })();

    // Listen for window close event
    const initListener = async () => {
      const win = getCurrentWindow();
      const unlisten = await win.onCloseRequested(async (event) => {
        event.preventDefault();

        // ✅ handleExit zaten çıkış yapıyorsa — hemen kapat, tekrar modal gösterme
        if (isExiting.current) {
          await getCurrentWindow().destroy();
          return;
        }

        isAppClosingRef.current = true;

        if (configRef.current.minimizeToTray && !trayQuitRef.current) {
          isAppClosingRef.current = false;
          try {
            await win.hide();
          } catch (e) {
            console.error("Failed to hide window:", e);
          }
          return;
        }

        if (configRef.current.requireConfirmation !== false) {
          getCurrentWindow().show();
          getCurrentWindow().setFocus();
          const confirmed = await customConfirm(
            t.confirmExitDesc ||
              "Bypax motorunu durdurup çıkmak istediğinize emin misiniz?",
            { title: t.confirmExitTitle || "Çıkış" },
          );
          if (!confirmed) {
            isAppClosingRef.current = false;
            if (trayQuitRef.current) {
              trayQuitRef.current = false;
            }
            return;
          }
        }

        isExiting.current = true;
        userIntentDisconnect.current = true;
        setAppIsClosingState(true);

        // ✅ Timer'ı temizle
        if (retryTimer.current) {
          clearTimeout(retryTimer.current);
          retryTimer.current = null;
        }

        // ✅ Cleanup'ı 3 saniyelik bir timeout ile koru
        // Windows, çıkış işlemi çok uzarsa "düzgün kapatılmadı" uyarısı gösterir
        const cleanupPromise = (async () => {
          try {
            if (childProcess.current) {
              await childProcess.current.kill().catch(() => {});
              childProcess.current = null;
            }
            await clearProxy(true);
            
            // ✅ Animasyonun görünmesi ve PAC grace period için bekle
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (e) {
            console.error("Cleanup failed:", e);
          }
        })();

        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 4000));
        await Promise.race([cleanupPromise, timeoutPromise]);

        try {
          await invoke("quit_app");
        } catch (e) {
          console.error("Quit app failed:", e);
          await getCurrentWindow().destroy();
        }
      });
      const unlistenTrayQuit = await win.listen("tray_quit", () => {
        trayQuitRef.current = true;
      });
      return { unlisten, unlistenTrayQuit };
    };

    let unlistenFn;
    initListener().then((fn) => (unlistenFn = fn));

    return () => {
      if (unlistenFn) {
        if (unlistenFn.unlisten) unlistenFn.unlisten();
        if (unlistenFn.unlistenTrayQuit) unlistenFn.unlistenTrayQuit();
      }

      // ✅ Retry timer'ı temizle
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }

      // Cleanup on unmount
      const cleanup = async () => {
        isAppClosingRef.current = true;
        userIntentDisconnect.current = true; // prevent false notifications on reload/close
        try {
          await invoke("stop_pac_server");
        } catch (_) {}
        if (childProcess.current) {
          try {
            await childProcess.current.kill();
            childProcess.current = null;
          } catch (e) {
            console.error("Process kill failed:", e);
          }
        }
        try {
          await invoke("clear_system_proxy");
        } catch (e) {
          console.error("Proxy cleanup failed:", e);
        }
      };

      cleanup();
    };
  }, []);

  const handleExit = async () => {
    // ✅ Zaten çıkış yapılıyorsa tekrar tetikleme
    if (isExiting.current) return;

    if (configRef.current.requireConfirmation !== false) {
      const confirmed = await customConfirm(
        t.confirmExitDesc ||
          "Bypax motorunu durdurup çıkmak istediğinize emin misiniz?",
        { title: t.confirmExitTitle || "Çıkış" },
      );
      if (!confirmed) return;
    }

    // ✅ Flag'i set et — onCloseRequested'ın tekrar modal göstermesini engeller
    isExiting.current = true;
    isAppClosingRef.current = true;
    userIntentDisconnect.current = true; // Reconnect engelle
    setAppIsClosingState(true);
    addLog(t.logShutdownStarting, "warn", { i18nKey: "logShutdownStarting" });

    // ✅ Timer'ı temizle
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    // ✅ Cleanup'ı 3 saniyelik timeout ile koru — Windows "düzgün kapatılmadı" uyarısını önler
    const cleanupPromise = (async () => {
      try {
        if (childProcess.current) {
          await childProcess.current.kill().catch(() => {});
          childProcess.current = null;
          addLog(t.logProcessStopped, "success", {
            i18nKey: "logProcessStopped",
          });
        }
        try {
          await invoke("stop_pac_server");
        } catch (_) {}
        await clearProxy(true);
        
        // ✅ Animasyonun görünmesi ve PAC grace period için bekle
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (e) {
        console.error("Cleanup failed:", e);
      }
    })();

    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 4000));
    await Promise.race([cleanupPromise, timeoutPromise]);

    try {
      await invoke("quit_app");
    } catch (e) {
      console.error("Quit app failed:", e);
      await getCurrentWindow().destroy();
    }
  };

  // Auto-connect on mount mantığı P1-FIX kapsamında main cleanup rutinine taşındı (Race Condition'ı önlemek için)
  // P1-FIX: Ayarlardan manuel "İnterneti Onar" tetiklendiğinde senkronize olarak Sidecar'ı kapat ve state'i sıfırla
  useEffect(() => {
    const handleForceDisconnect = async (e) => {
      console.log('[FORCE-DISCONNECT]', e.detail?.reason);
      
      // Bağlıysa kes
      if (childProcess.current) {
        userIntentDisconnect.current = true;
        try {
          await invoke('stop_pac_server');
          await childProcess.current.kill();
        } catch (_) {}
        childProcess.current = null;
      }
      
      setIsConnected(false);
      setIsProcessing(false);
      updateTrayTooltip('disconnected');
    };
    
    window.addEventListener('bypax-force-disconnect', handleForceDisconnect);
    return () => window.removeEventListener('bypax-force-disconnect', handleForceDisconnect);
  }, []);

  // DPI & Layout Scaling Fix
  useEffect(() => {
    const handleResize = () => {
      // Hedef tasarım boyutları (Tauri config ile uyumlu)
      const DESIGN_WIDTH = APP.designWidth;
      const DESIGN_HEIGHT = APP.designHeight;

      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;

      // X ve Y eksenlerindeki sığma oranlarını hesapla
      const scaleX = currentWidth / DESIGN_WIDTH;
      const scaleY = currentHeight / DESIGN_HEIGHT;

      // En kısıtlı alana göre scale belirle (Aspect Ratio koruyarak sığdır)
      // %98'in altındaysa scale et (titremeyi önlemek için tolerans)
      const scale = Math.min(scaleX, scaleY);

      if (scale < 0.99) {
        document.body.style.transform = `scale(${scale})`;
        document.body.style.transformOrigin = "top left";
        document.body.style.width = `${100 / scale}%`;
        document.body.style.height = `${100 / scale}%`;
      } else {
        document.body.style.transform = "";
        document.body.style.transformOrigin = "";
        document.body.style.width = "";
        document.body.style.height = "";
      }
    };

    window.addEventListener("resize", handleResize);

    // Initial checks
    handleResize();
    setTimeout(handleResize, 100);
    setTimeout(handleResize, 500); // Yüklenme gecikmeleri için

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Native App Experience: Disable browser-like behaviors
  useEffect(() => {
    // Disable right-click
    const handleContextMenu = (e) => e.preventDefault();

    // Disable refresh and dev shortcuts
    const handleKeyDown = (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // Block F5, F11 (Fullscreen), F12
      if (["F5", "F11", "F12"].includes(e.key)) {
        e.preventDefault();
      }

      // Block Ctrl+R, Ctrl+Shift+R, Ctrl+Shift+I, Ctrl+P, Ctrl+S, Ctrl+U (View Source)
      if (
        isCmdOrCtrl &&
        ["r", "R", "i", "I", "p", "P", "s", "S", "u", "U"].includes(e.key)
      ) {
        e.preventDefault();
      }
    };

    // Prevent accidental text selection (optional but recommended for buttons/UI)
    // and prevent dragging of images/links
    const handleDragStart = (e) => e.preventDefault();

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("dragstart", handleDragStart);

    // CSS level text selection prevention (best for all browsers)
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("dragstart", handleDragStart);
    };
  }, []);

  // Render
  return (
    <div className="app-container fade-in">
      <AnimatePresence>
        {appIsClosingState && (
          <motion.div
            className="closing-screen-overlay"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{
              zIndex: 999999,
              background: "#09090b",
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "2rem",
            }}
          >
            <div
              style={{
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <img
                src="/bypax-logo.png"
                alt="BypaxDPI"
                style={{
                  width: "70px",
                  height: "70px",
                  marginBottom: "1.5rem",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                  animation: "pulse 2s infinite ease-in-out",
                }}
              />
              <h1 style={{ fontSize: "1.3rem", fontWeight: "600", color: "#fff", marginBottom: "0.5rem" }}>
                {t.confirmExitTitle || "BypaxDPI Kapatılıyor"}
              </h1>
              <p style={{ color: "#a1a1aa", fontSize: "0.95rem" }}>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={closingStep}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.2 }}
                    style={{ display: "inline-block" }}
                  >
                    {closingStep === 0 
                      ? (t.logShutdownStarting || "Güvenli bağlantı sonlandırılıyor").replace(/\.+$/, "")
                      : "Uygulama kapatılıyor"}
                    <span style={{ display: "inline-block", width: "16px", textAlign: "left" }}>
                      {closingDots}
                    </span>
                  </motion.span>
                </AnimatePresence>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isAdmin && !import.meta.env.DEV && !appIsClosingState && (
          <motion.div
            className="v2-settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              zIndex: 99999,
              background: "#09090b",
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "2rem",
            }}
          >
            {/* Background Glow */}
            <div
              style={{
                position: "absolute",
                top: "40%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "100%",
                height: "400px",
                background:
                  "radial-gradient(circle, rgba(239, 68, 68, 0.08) 0%, rgba(0,0,0,0) 60%)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />

            <div
              style={{
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                maxWidth: "420px",
              }}
            >
              <img
                src="/bypax-logo.png"
                alt="BypaxDPI"
                style={{
                  width: "80px",
                  height: "80px",
                  marginBottom: "1.5rem",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                }}
              />

              <h1
                style={{
                  fontSize: "1.5rem",
                  marginBottom: "0.75rem",
                  color: "#fff",
                  fontWeight: "700",
                }}
              >
                {t.adminTitle}
              </h1>

              <p
                style={{
                  color: "#a1a1aa",
                  marginBottom: "1.5rem",
                  lineHeight: "1.6",
                  fontSize: "0.95rem",
                }}
              >
                {t.adminDesc}
              </p>

              <div
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: "12px",
                  padding: "1rem",
                  marginBottom: "2rem",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      background: "rgba(239, 68, 68, 0.15)",
                      padding: "10px",
                      borderRadius: "8px",
                      color: "#ef4444",
                      flexShrink: 0,
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Shield size={22} />
                  </div>
                  <div>
                    <div
                      style={{
                        color: "#d4d4d8",
                        fontSize: "0.85rem",
                        lineHeight: "1.4",
                      }}
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.adminStep, PURIFY_CONFIG) }}
                    />
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  width: "100%",
                }}
              >
                <button
                  style={{
                    background: "#3b82f6",
                    color: "white",
                    padding: "0.8rem 2rem",
                    border: "none",
                    borderRadius: "10px",
                    fontSize: "0.95rem",
                    fontWeight: "600",
                    cursor: "pointer",
                    width: "100%",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    boxShadow: "0 4px 14px rgba(59, 130, 246, 0.3)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#2563eb";
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow =
                      "0 6px 20px rgba(59, 130, 246, 0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#3b82f6";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 4px 14px rgba(59, 130, 246, 0.3)";
                  }}
                  onClick={() =>
                    openUrl(URLS.tutorialHowItWorks)
                  }
                >
                  <HelpCircle size={18} />
                  {t.adminHowItWorks}
                </button>

                <button
                  style={{
                    background: "#ef4444",
                    color: "white",
                    padding: "0.8rem 2rem",
                    border: "none",
                    borderRadius: "10px",
                    fontSize: "0.95rem",
                    fontWeight: "600",
                    cursor: "pointer",
                    width: "100%",
                    transition: "opacity 0.2s",
                  }}
                  onMouseEnter={(e) => (e.target.style.opacity = "0.9")}
                  onMouseLeave={(e) => (e.target.style.opacity = "1")}
                  onClick={async () => {
                    try {
                      await invoke("quit_app");
                    } catch (e) {
                      console.error("Quit app failed:", e);
                      await getCurrentWindow().destroy();
                    }
                  }}
                >
                  {t.adminClose}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* İlk Giriş ISS Seçim Overlay */}
      <AnimatePresence>
        {isAdmin && showFirstRunISS && !showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              zIndex: 99998,
              background: "#09090b",
              position: "fixed",
              top: 0, left: 0, right: 0, bottom: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "1.5rem",
            }}
          >
            <div style={{
              position: "absolute", top: "35%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: "100%", height: "400px",
              background: "radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, rgba(0,0,0,0) 60%)",
              pointerEvents: "none", zIndex: 0,
            }} />

            <div style={{ zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", maxWidth: "420px", width: "100%" }}>
              <img src="/bypax-logo.png" alt="BypaxDPI" style={{ width: "56px", height: "56px", marginBottom: "1rem", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)" }} />
              <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "#fff", fontWeight: "700" }}>{t.issOverlayTitle}</h1>
              <p style={{ color: "#a1a1aa", marginBottom: "1.25rem", lineHeight: "1.5", fontSize: "0.85rem" }}>{t.issOverlayDesc}</p>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", marginBottom: "1.25rem" }}>
                {ISP_PROFILES.map((isp) => {
                  const nameKey = `iss${isp.id.charAt(0).toUpperCase() + isp.id.slice(1)}Name`;
                  const ispName = t[nameKey] || isp.id;
                  const isSelected = config.selectedIspProfile === isp.id;
                  return (
                    <motion.div
                      key={isp.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        updateConfig('dpiMethod', isp.mode);
                        updateConfig('httpsChunkSize', isp.chunk);
                        updateConfig('selectedIspProfile', isp.id);
                      }}
                      style={{
                        padding: "14px 16px",
                        borderRadius: "14px",
                        background: isSelected ? isp.bg : "rgba(255,255,255,0.03)",
                        border: isSelected ? `1px solid ${isp.color}40` : "1px solid rgba(255,255,255,0.06)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div style={{
                        width: "40px", height: "40px", borderRadius: "12px",
                        background: isp.bg, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "1.2rem", flexShrink: 0,
                      }}>
                        {isp.icon}
                      </div>
                      <div style={{ flex: 1, textAlign: "left" }}>
                        <div style={{ color: isSelected ? isp.color : "#f8fafc", fontWeight: 600, fontSize: "0.9rem" }}>{ispName}</div>
                        {isp.logos && isp.logos.length > 0 && (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                            {isp.logos.map((logo, idx) => (
                              <img key={idx} src={logo} alt="ISP Logo" style={{ height: '16px', opacity: 0.8, filter: 'grayscale(0.2)' }} />
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{
                        width: "20px", height: "20px", borderRadius: "50%",
                        border: isSelected ? `2px solid ${isp.color}` : "2px solid rgba(255,255,255,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.2s ease",
                      }}>
                        {isSelected && <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: isp.color }} />}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <button
                onClick={() => {
                  localStorage.setItem('bypax_first_run_done', 'true');
                  setShowFirstRunISS(false);
                  // Otomatik bağlan
                  if (!isConnected && !isProcessing) {
                    retryCount.current = 0;
                    userIntentDisconnect.current = false;
                    setIsProcessing(true);
                    startEngine(8080);
                  }
                }}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                  color: "white",
                  padding: "0.85rem",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "0.95rem",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  boxShadow: "0 4px 14px rgba(59, 130, 246, 0.3)",
                  marginBottom: "0.75rem",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(59, 130, 246, 0.4)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(59, 130, 246, 0.3)"; }}
              >
                <Power size={18} />
                {t.issOverlayApply}
              </button>

              <button
                onClick={() => {
                  localStorage.setItem('bypax_first_run_done', 'true');
                  setShowFirstRunISS(false);
                }}
                style={{
                  background: "transparent",
                  color: "#71717a",
                  border: "none",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  padding: "0.5rem",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "#a1a1aa"}
                onMouseLeave={(e) => e.currentTarget.style.color = "#71717a"}
              >
                {t.issOverlaySkip}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <img src="/bypax-logo.png" alt="BypaxDPI" className="brand-logo" />
          <span className="brand-name">BYPAXDPI</span>
        </div>
        <div
          className={`status-badge ${isConnected ? "active" : isProcessing ? "processing" : "passive"}`}
        >
          <div className="status-dot" />
          <span>
            {isProcessing
              ? isConnected
                ? t.statusDisconnecting
                : t.statusConnecting
              : isConnected
                ? t.statusActive
                : t.statusReady}
          </span>
        </div>
      </header>

      {/* Offline Alert */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden", background: "#eab308" }} // Yellow/Amber background for warning
          >
            <div
              style={{
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                color: "#000",
                fontSize: "0.85rem",
                fontWeight: "600",
              }}
            >
              <WifiOff size={16} />
              <span>{t.noInternetTitle}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="main-content">
        <div className="shield-wrapper">
          <div
            className={`shield-circle ${isConnected ? "connected" : isProcessing ? "processing" : ""}`}
          >
            <Shield size={56} strokeWidth={1.5} className="shield-icon" />
          </div>
        </div>

        <div className="status-text">
          <h1
            className={`status-title ${isConnected ? "connected" : isProcessing ? "processing" : ""}`}
          >
            {isProcessing
              ? isConnected
                ? t.statusDisconnecting
                : t.statusConnecting
              : isConnected
                ? t.statusConnected
                : t.statusReady2}
          </h1>
          <p className="status-desc">
            {isProcessing
              ? t.descConnecting
              : isConnected
                ? t.descConnected
                : t.descReady}
          </p>

          <AnimatePresence>
            {isConnected &&
              config.selectedDns &&
              config.selectedDns !== "system" && (
                <motion.div
                  initial={{ opacity: 0, y: -5, height: 0 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    height: "auto",
                    marginTop: "12px",
                  }}
                  exit={{ opacity: 0, y: -5, height: 0, marginTop: 0 }}
                  style={{ display: "flex", justifyContent: "center" }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      color: "#a1a1aa",
                      padding: "5px 14px",
                      borderRadius: "20px",
                      fontSize: "0.75rem",
                      fontWeight: "500",
                      letterSpacing: "0.02em",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                  >
                    <Globe
                      size={13}
                      strokeWidth={2.5}
                      style={{ color: "#60a5fa" }}
                    />
                    <span>
                      DNS:{" "}
                      <span style={{ color: "#e2e8f0", fontWeight: "600" }}>
                        {config.selectedDns.toUpperCase()}
                      </span>
                    </span>
                  </div>
                </motion.div>
              )}
          </AnimatePresence>
        </div>
      </main>

      {/* Action Button */}
      <div className="action-area">
        {/* LAN Connect Button */}
        <AnimatePresence>
          {config.lanSharing && isConnected && (
            <motion.button
              initial={{ opacity: 0, y: 10, height: 0 }}
              animate={{
                opacity: 1,
                y: 0,
                height: "auto",
                marginBottom: "1rem",
              }}
              exit={{ opacity: 0, y: 10, height: 0, marginBottom: 0 }}
              className="lan-connect-pill-btn"
              onClick={() => setShowConnectionModal(true)}
            >
              <Smartphone size={16} />
              <span>{t.btnConnectDevices}</span>
              <div className="arrow-icon">›</div>
            </motion.button>
          )}
        </AnimatePresence>

        <button
          className={`main-btn ${isConnected ? "disconnect" : "connect"} ${isProcessing ? "processing" : ""}`}
          onClick={toggleConnection}
          disabled={isProcessing || isRestartingDpi.current || isRestartingLan.current}
        >
          <Power size={22} strokeWidth={2.5} />
          <span>
            {isApplyingSettings
              ? t.btnApplyingSettings
              : isProcessing
                ? isConnected
                  ? t.btnDisconnecting
                  : t.btnConnecting
                : isConnected
                  ? t.btnDisconnect
                  : t.btnConnect}
          </span>
        </button>
      </div>

      {/* Social Links — animasyonlu giriş/çıkış */}
      <AnimatePresence>
        {!isConnected && !isProcessing && (
          <motion.div
            className="social-links-bar"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <button
              className="social-link-btn youtube-btn"
              onClick={() => openUrl(URLS.youtube)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              <span>{t.devSubscribe}</span>
            </button>
            <button
              className="social-link-btn patreon-btn"
              onClick={() => openUrl(URLS.patreon)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.386.524c-4.764 0-8.64 3.876-8.64 8.64 0 4.75 3.876 8.613 8.64 8.613 4.75 0 8.614-3.864 8.614-8.613C24 4.4 20.136.524 15.386.524zM.003 23.537h4.22V.524H.003v23.013z"/>
              </svg>
              <span>{t.devSupport}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button className="nav-btn" onClick={() => setShowSettings(true)}>
          <SettingsIcon size={22} strokeWidth={2} />
          <span>{t.navSettings}</span>
        </button>
        <div className="nav-divider" />
        <button className="nav-btn" onClick={() => setShowLogs(true)}>
          <FileText size={22} strokeWidth={2} />
          <span>{t.navLogs}</span>
        </button>
        <div className="nav-divider" />
        <button className="nav-btn exit" onClick={handleExit}>
          <Power size={22} strokeWidth={2} />
          <span>{t.navExit}</span>
        </button>
      </nav>

      {showLogs && (
        <div className="logs-overlay">
          <div className="logs-header">
            <button
              className="logs-back-btn"
              onClick={() => setShowLogs(false)}
            >
              <X size={24} />
            </button>
            <div className="logs-title">
              <FileText size={20} className="logs-title-icon" />
              <h3>{t.logsTitle}</h3>
            </div>
          </div>

          <div className="console-content">
            {logs.map((log, index) => (
              <div key={log.id} className={`log-line log-${log.type}`}>
                <span className="log-number">
                  {String(index + 1).padStart(3, "0")}
                </span>
                <span className="log-time">[{log.time}]</span>
                <span className="log-msg">{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>

          <div className="logs-footer">
            <button className="logs-action-btn clear-btn" onClick={clearLogs}>
              <Trash2 size={18} />
              <span>{t.logsClear}</span>
            </button>
            <button
              className={`logs-action-btn copy-btn ${copyStatus}`}
              onClick={copyLogs}
              disabled={logs.length === 0}
            >
              <Copy size={18} />
              <span>
                {copyStatus === "success"
                  ? t.logsCopied
                  : copyStatus === "error"
                    ? t.logsCopyError
                    : t.logsCopy}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Connection Info Modal */}
      <AnimatePresence>
        {showConnectionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            style={{
              zIndex: 10000,
              background: "rgba(9, 9, 11, 0.65)",
              backdropFilter: "blur(6px)",
            }}
            onClick={() => setShowConnectionModal(false)}
          >
            <div
              style={{
                position: "absolute",
                top: "40%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "100%",
                height: "400px",
                background:
                  "radial-gradient(circle, rgba(59, 130, 246, 0.12) 0%, rgba(0,0,0,0) 50%)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />

            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="connection-modal"
              style={{
                zIndex: 1,
                maxWidth: "450px",
                width: "125%",
                background: "#18181b",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                padding: "24px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="modal-header"
                style={{
                  marginBottom: "1.5rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "14px",
                    background: "rgba(59, 130, 246, 0.1)",
                    border: "1px solid rgba(59, 130, 246, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Smartphone size={24} color="#3b82f6" />
                </div>
                <div>
                  <h2
                    style={{
                      fontSize: "1.15rem",
                      fontWeight: "700",
                      color: "#f8fafc",
                      margin: 0,
                      marginBottom: "2px",
                    }}
                  >
                    {t.modalTitle}
                  </h2>
                  <p
                    style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}
                  >
                    {t.modalSubtitle}
                  </p>
                </div>
                <button
                  className="close-btn"
                  onClick={() => setShowConnectionModal(false)}
                  style={{
                    position: "absolute",
                    right: "-5px",
                    top: "-5px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#a1a1aa",
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255, 255, 255, 0.1)";
                    e.currentTarget.style.color = "#fff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255, 255, 255, 0.05)";
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="modal-body">
                {/* Sekmeler */}
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    marginBottom: "1.25rem",
                    background: "rgba(255,255,255,0.06)",
                    padding: "4px",
                    borderRadius: "10px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setConnectionModalTab("pac")}
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      borderRadius: "8px",
                      border: "none",
                      background:
                        connectionModalTab === "pac"
                          ? "rgba(34, 197, 94, 0.25)"
                          : "transparent",
                      color:
                        connectionModalTab === "pac" ? "#4ade80" : "#94a3b8",
                      fontWeight: connectionModalTab === "pac" ? 600 : 500,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    {t.modalTabPac}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectionModalTab("manual")}
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      borderRadius: "8px",
                      border: "none",
                      background:
                        connectionModalTab === "manual"
                          ? "rgba(59, 130, 246, 0.2)"
                          : "transparent",
                      color:
                        connectionModalTab === "manual" ? "#60a5fa" : "#94a3b8",
                      fontWeight: connectionModalTab === "manual" ? 600 : 500,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    {t.modalTabManual}
                  </button>
                </div>

                {connectionModalTab === "pac" && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '0.5rem' }}>
                    {/* Note */}
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '12px',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        textAlign: 'left'
                    }}>
                        <AlertTriangle size={18} color="#f87171" style={{ flexShrink: 0, marginTop: '1px' }} />
                        <div style={{ fontSize: '0.75rem', color: '#fca5a5', lineHeight: 1.4 }}>
                           <strong style={{ color: '#ef4444' }}>{t.modalPacWarningTitle}</strong> {t.modalPacWarningDesc}
                        </div>
                    </div>
                    {/* Step 1: Install Guide */}
                    <div style={{
                        background: 'rgba(59, 130, 246, 0.08)',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        borderRadius: '12px',
                        padding: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                       <div
                         onClick={() => setShowLargeQr(true)}
                         title="Büyütmek için tıklayın"
                         style={{ background: '#fff', padding: '4px', borderRadius: '8px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', position: 'relative', transition: 'transform 0.2s', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                         onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                         onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                       >
                         <QRCodeSVG value={`http://${lanIp}:${pacPort}/`} size={64} level="M" />
                         <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(59, 130, 246, 0.1)', color: '#2563eb', fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', marginTop: '4px' }}>
                           <ZoomIn size={10} strokeWidth={3} />
                           BÜYÜT
                         </div>
                       </div>
                       <div>
                         <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#60a5fa', marginBottom: '2px' }}>{t.modalPacStep1Title}</div>
                         <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4 }}>{t.modalPacStep1Desc}</div>
                       </div>
                    </div>

                    {/* Step 2: PAC URL */}
                    <div style={{
                        background: 'rgba(34, 197, 94, 0.08)',
                        border: '1px solid rgba(34, 197, 94, 0.2)',
                        borderRadius: '12px',
                        padding: '12px',
                    }}>
                       <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#4ade80', marginBottom: '4px' }}>{t.modalPacStep2Title}</div>
                       <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '8px', lineHeight: 1.4 }}>{t.modalPacStep2Desc}</div>
                       
                       <div
                          className="code-box"
                          onClick={() => handleCopyField(`http://${lanIp}:${pacPort}/proxy.pac`, 'pac')}
                          title="Kopyala"
                          style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34, 197, 94, 0.15)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'all 0.2s', margin: 0 }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)'; e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.3)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.3)'; e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.15)'; }}
                        >
                          <span style={{ fontSize: '0.8rem', whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: '#f8fafc', fontWeight: 500, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                            http://{lanIp}:{pacPort}/proxy.pac
                          </span>
                          {copiedField === 'pac' ? <Check size={16} color="#4ade80" style={{ flexShrink: 0, marginLeft: '8px' }} /> : <Copy size={16} color="#4ade80" style={{ flexShrink: 0, marginLeft: '8px' }} />}
                        </div>
                    </div>
                  </div>
                )}

                {connectionModalTab === "manual" && (
                  <>
                    {/* Note */}
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '12px',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        marginBottom: '1rem',
                        textAlign: 'left'
                    }}>
                        <AlertTriangle size={18} color="#f87171" style={{ flexShrink: 0, marginTop: '1px' }} />
                        <div style={{ fontSize: '0.75rem', color: '#fca5a5', lineHeight: 1.4 }}>
                           <strong style={{ color: '#ef4444' }}>{t.modalManualWarningTitle}</strong> {t.modalManualWarningDesc}
                        </div>
                    </div>
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "#94a3b8",
                        lineHeight: "1.5",
                        marginBottom: "1rem",
                      }}
                    >
                      <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.modalDesc, PURIFY_CONFIG) }} />
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                        marginBottom: "1.5rem",
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "#71717a",
                            marginBottom: "0.5rem",
                            textTransform: "uppercase",
                            fontWeight: "600",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {t.modalHost}
                        </label>
                        <div
                          className="code-box"
                          onClick={() => handleCopyField(lanIp, 'host')}
                          title="Kopyala"
                          style={{ transition: 'all 0.2s', background: copiedField === 'host' ? 'rgba(34, 197, 94, 0.1)' : undefined, borderColor: copiedField === 'host' ? 'rgba(34, 197, 94, 0.3)' : undefined }}
                        >
                          <span style={{ color: copiedField === 'host' ? '#4ade80' : undefined }}>{lanIp}</span>
                          {copiedField === 'host' ? <Check size={16} color="#4ade80" /> : <Copy size={16} color="#71717a" />}
                        </div>
                      </div>
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "#71717a",
                            marginBottom: "0.5rem",
                            textTransform: "uppercase",
                            fontWeight: "600",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {t.modalPort}
                        </label>
                        <div
                          className="code-box"
                          onClick={() => handleCopyField(currentPort.toString(), 'port')}
                          title="Kopyala"
                          style={{ transition: 'all 0.2s', background: copiedField === 'port' ? 'rgba(34, 197, 94, 0.1)' : undefined, borderColor: copiedField === 'port' ? 'rgba(34, 197, 94, 0.3)' : undefined }}
                        >
                          <span style={{ color: copiedField === 'port' ? '#4ade80' : undefined }}>{currentPort}</span>
                          {copiedField === 'port' ? <Check size={16} color="#4ade80" /> : <Copy size={16} color="#71717a" />}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <button
                  style={{
                    width: "100%",
                    background:
                      "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                    color: "white",
                    border: "none",
                    padding: "0.85rem",
                    borderRadius: "12px",
                    fontWeight: "600",
                    fontSize: "0.95rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    boxShadow: "0 4px 14px rgba(59, 130, 246, 0.3)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow =
                      "0 6px 20px rgba(59, 130, 246, 0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 4px 14px rgba(59, 130, 246, 0.3)";
                  }}
                  onClick={() => openUrl(URLS.tutorialProxy)}
                >
                  <HelpCircle size={18} />
                  {t.modalTutorial}
                </button>
              </div>

              {/* Büyütülmüş QR Kod Overlay */}
              <AnimatePresence>
                {showLargeQr && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(24, 24, 27, 0.95)",
                      backdropFilter: "blur(8px)",
                      zIndex: 10,
                      borderRadius: "16px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "24px",
                      cursor: "pointer"
                    }}
                    onClick={() => setShowLargeQr(false)}
                  >
                    <div style={{ background: 'white', padding: '16px', borderRadius: '16px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
                      <QRCodeSVG value={`http://${lanIp}:${pacPort}/`} size={240} level="M" />
                    </div>
                    <div style={{ marginTop: '24px', color: '#a1a1aa', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '20px' }}>
                      <X size={16} />
                      Kapatmak için dokunun
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Confirm Modal */}
      <AnimatePresence>
        {confirmState.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            style={{
              zIndex: 999999,
              background: "rgba(9, 9, 11, 0.65)",
              backdropFilter: "blur(6px)",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "40%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "100%",
                height: "400px",
                background:
                  "radial-gradient(circle, rgba(239, 68, 68, 0.12) 0%, rgba(0,0,0,0) 50%)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />

            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="connection-modal"
              style={{
                zIndex: 1,
                textAlign: "center",
                maxWidth: "340px",
                background: "#18181b",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                padding: "24px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    color: "#ef4444",
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "1.25rem",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                  }}
                >
                  <AlertTriangle size={30} strokeWidth={1.5} />
                </div>

                <h2
                  style={{
                    fontSize: "1.25rem",
                    color: "#f8fafc",
                    marginBottom: "0.75rem",
                    fontWeight: "600",
                  }}
                >
                  {confirmState.title}
                </h2>
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                    marginBottom: "2rem",
                    lineHeight: "1.6",
                  }}
                >
                  {confirmState.desc}
                </p>

                <div style={{ display: "flex", gap: "12px", width: "100%" }}>
                  <button
                    onClick={() => handleConfirmResult(false)}
                    style={{
                      fontFamily: "inherit",
                      flex: 1,
                      background: "rgba(255, 255, 255, 0.03)",
                      color: "#cbd5e1",
                      padding: "0.85rem",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "10px",
                      fontWeight: "500",
                      fontSize: "0.95rem",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255, 255, 255, 0.08)";
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255, 255, 255, 0.03)";
                      e.currentTarget.style.color = "#cbd5e1";
                    }}
                  >
                    {t.btnNo || "İptal"}
                  </button>
                  <button
                    onClick={() => handleConfirmResult(true)}
                    style={{
                      fontFamily: "inherit",
                      flex: 1,
                      background: "#ef4444",
                      color: "#ffffff",
                      padding: "0.85rem",
                      border: "none",
                      borderRadius: "10px",
                      fontWeight: "600",
                      fontSize: "0.95rem",
                      cursor: "pointer",
                      boxShadow: "0 4px 14px rgba(239, 68, 68, 0.3)",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#dc2626";
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow =
                        "0 6px 20px rgba(239, 68, 68, 0.4)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#ef4444";
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow =
                        "0 4px 14px rgba(239, 68, 68, 0.3)";
                    }}
                  >
                    {t.btnYes || "Onayla"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showSettings && (
        <Settings
          onBack={() => setShowSettings(false)}
          config={config}
          updateConfig={updateConfig}
          dnsLatencies={dnsLatencies}
          setDnsLatencies={setDnsLatencies}
        />
      )}
    </div>
  );
}

export default App;

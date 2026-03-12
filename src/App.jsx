import Settings from "./Settings";
import { motion, AnimatePresence } from "framer-motion";
// autostart importları Settings.jsx'te kullanılıyor, burada gerek yok
import { useState, useRef, useEffect, useMemo } from "react";
import { Command, open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { getTranslations } from "./i18n";
import { DNS_MAP, DOH_MAP, URLS, APP, RETRY_DELAYS, DPI_TIMEOUTS } from "./constants";

// Re-add missing imports
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

// ✅ Constants — constants.js'den import ediliyor (DNS_MAP, DOH_MAP, URLS, APP, RETRY_DELAYS, DPI_TIMEOUTS)

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [currentPort, setCurrentPort] = useState(8080);
  const currentPortRef = useRef(8080); // ✅ #6: Stale closure önleme
  const [lanIp, setLanIp] = useState("127.0.0.1"); // ✅ LAN IP State
  const [pacPort, setPacPort] = useState(8787); // ✅ PAC port (dinamik)
  const [showConnectionModal, setShowConnectionModal] = useState(false); // ✅ Modal State
  const [connectionModalTab, setConnectionModalTab] = useState("pac"); // pac | manual
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine); // ✅ Internet Durumu
  const [dnsLatencies, setDnsLatencies] = useState({}); // ✅ #5: DNS ping sonuçları kalcı

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
  const [config, setConfig] = useState(() => {
    const defaultSettings = {
      language: "tr",
      autoStart: false,
      autoConnect: false,
      minimizeToTray: false,
      dnsMode: "manual",
      selectedDns: "cloudflare",
      autoReconnect: true,
      dpiMethod: "1", // ✅ Varsayılan: Dengeli mod (0=Turbo, 1=Dengeli, 2=Güçlü)
      httpsChunkSize: 4,
    };

    const saved = localStorage.getItem("bypax_config");
    if (saved) {
      try {
        return { ...defaultSettings, ...JSON.parse(saved) };
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

  // DNS_MAP ve DOH_MAP artık component dışında tanımlı (yukarıda)

  const updateConfig = (key, value) => {
    setConfig((prev) => {
      const newConfig = { ...prev, [key]: value };
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
    updateTrayTooltip("connecting");

    // ✅ #2: fatalErrorRef'i sıfırla — önceki oturumdaki wpcap hatası yeni bağlantıyı bloklamasın
    fatalErrorRef.current = false;

    // Max 20 retries
    if (portRetryCount >= APP.maxPortRetries) {
      addLog(t.logNoPort, "error", { i18nKey: "logNoPort" });
      setIsProcessing(false);
      return;
    }

    // ✅ Rust'tan Smart Configuration al (Port & IP)
    let configData;
    let port;
    let bindAddr;

    try {
      configData = await invoke("get_sidecar_config", {
        allowLanSharing: configRef.current.lanSharing || false,
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
      return;
    }

    if (childProcess.current) return;
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

      const args = [
        "--clean", // Ev / config dosyasını yok say; sadece bizim flag'ler geçerli (timeout vs. doğru kalsın)
        "--listen-addr",
        listenAddr,
        "--timeout",
        TIMEOUT_MS.toString(),
        "--silent",
        "--log-level",
        "info",
      ];

      // DNS ayarı: DoH (HTTPS üzerinden) veya sistem DNS'i
      // DoH kullanımı: ISP'lerin port 53 trafiğini yakalamasını (DNS hijacking) engeller
      // Hiçbir DLL gerektirmez — binary'nin içinde gömülü
      if (currentDns === "system" || !dnsIP) {
        args.push("--dns-mode", "system");
      } else {
        const dohUrl = DOH_MAP[currentDns];
        if (dohUrl) {
          // DoH: DNS sorguları HTTPS üzerinden → ISP yakalayamaz
          args.push("--dns-mode", "https", "--dns-https-url", dohUrl);
        } else {
          // Fallback: Bilinmeyen sağlayıcı → UDP ile dene
          args.push("--dns-addr", `${dnsIP}:53`, "--dns-mode", "udp");
        }
      }

      // ✅ Yeni 3 Katmanlı DPI Bypass Sistemi
      // 0 = Turbo: SNI split (en hızlı, hafif DPI için)
      // 1 = Dengeli: Chunk split BEZ disorder (hızlı + güçlü, çoğu ISP'de çalışır)
      // 2 = Güçlü: Chunk split + disorder (en güçlü, zor ISP'ler için)
      const dpiMethod = configRef.current.dpiMethod || "1";
      if (dpiMethod === "2") {
        // Güçlü Mod: chunk + disorder (en agresif, latency ekler)
        const chunkSize = [4, 8, 16].includes(
          Number(configRef.current.httpsChunkSize),
        )
          ? String(configRef.current.httpsChunkSize)
          : "4";
        args.push(
          "--https-split-mode",
          "chunk",
          "--https-chunk-size",
          chunkSize,
          "--https-disorder",
        );
      } else if (dpiMethod === "1") {
        // Dengeli Mod: chunk BEZ disorder (latency eklemez, çoğu ISP'de çalışır)
        const chunkSize = [4, 8, 16].includes(
          Number(configRef.current.httpsChunkSize),
        )
          ? String(configRef.current.httpsChunkSize)
          : "4";
        args.push(
          "--https-split-mode",
          "chunk",
          "--https-chunk-size",
          chunkSize,
        );
      } else {
        // Turbo Mod (0): sadece SNI split — en düşük gecikme
        args.push("--https-split-mode", "sni");
      }

      const command = Command.sidecar("binaries/bypax-proxy", args);

      let connectionConfirmed = false;
      let isReady = false;

      // Optimized regex pattern - compiled once (regex literal / karışmasın diye string + new RegExp)
      const SKIP_PATTERN = new RegExp(
        "\\[(?:PROXY|DNS|HTTPS|CACHE|app)]|method:\\s*CONNECT|cache (?:miss|hit)|resolving|routing|resolution took|new conn|client sent hello|shouldExploit|useSystemDns|fragmentation|conn established|writing chunked|caching \\d+ records|[a-f0-9]{8}-[a-f0-9]{8}|d88|Y88|88P|level=|ctrl \\+ c|listen_addr|dns_addr|github\\.com|spoofdpi|connection timeout",
        "i",
      );
      // Bağlantı kesilirken / yeniden bağlanırken SpoofDPI tüm tünelleri kapatır; her biri "error handling request" / "wsarecv ... aborted" WRN basar - kullanıcı loguna taşıma
      const isTunnelShutdownNoise = (l) =>
        /\[pxy\].*error handling request|unsuccessful tunnel|wsarecv|aborted by the software in your host machine/i.test(
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
            await invoke("set_system_proxy", { port });
            addLog(t.logProxySet(port), "success", {
              i18nKey: "logProxySet",
              i18nParams: [port],
            });
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

          // ✅ Otomatik yeniden bağlanma kontrol
          const autoReconnectEnabled =
            configRef.current.autoReconnect !== false; // undefined veya true ise açık

          const shouldReconnect =
            autoReconnectEnabled && // Ayarda açık mı?
            !userIntentDisconnect.current && // Kullanıcı kasıtlı kapatmadı mı?
            !fatalErrorRef.current && // Ölümcül hata yok mu? (örn. wpcap.dll eksik)
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

      // Failsafe timeout
      setTimeout(async () => {
        if (
          childProcess.current &&
          !connectionConfirmed &&
          !isRetrying.current
        ) {
          connectionConfirmed = true;
          setCurrentPort(port);
          currentPortRef.current = port;

          try {
            await invoke("set_system_proxy", { port: port });
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
      addLog(t.logEngineStartError(e), "error", {
        i18nKey: "logEngineStartError",
        i18nParams: [e],
      });

      // ✅ Sorun 2: Antivirüs uyarısı — spawn başarısızsa Defender engellemiş olabilir
      const errStr = String(e).toLowerCase();
      if (errStr.includes("denied") || errStr.includes("access") || errStr.includes("not found") || errStr.includes("os error")) {
        addLog(
          "⚠️ " + (t.logAntivirusWarning || "Windows Defender veya antivirüs yazılımınız 'bypax-proxy.exe' dosyasını engellemiş olabilir. Lütfen dosyayı antivirüs dışlama listesine (exclusion) ekleyin."),
          "warn",
          { i18nKey: "logAntivirusWarning" }
        );
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
    if (isProcessing) return;

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

  // ✅ DPI modu veya chunk size değişince bağlı bağlantıyı yeniden başlat
  const isRestartingDpi = useRef(false);
  useEffect(() => {
    const chunkSize = config.httpsChunkSize ?? 4;
    if (
      prevDpiMethodRef.current === config.dpiMethod &&
      prevChunkSizeRef.current === chunkSize
    )
      return;
    prevDpiMethodRef.current = config.dpiMethod;
    prevChunkSizeRef.current = chunkSize;

    if (!isConnected || isRestartingDpi.current) return;
    isRestartingDpi.current = true;

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
      setIsProcessing(true);
      startEngine(0);
    }, 2500); // Portun serbest kalması için (SpoofDPI 1.2.1 / TIME_WAIT)
  }, [config.dpiMethod, config.httpsChunkSize, isConnected]);

  useEffect(() => {
    // Initial cleanup on mount
    (async () => {
      try {
        // ✅ Sorun 4: Zombi süreçleri temizle (önceki çökme/force kill sonrası kalmış olabilir)
        await invoke("kill_zombie_sidecar").catch((e) =>
          console.log("Zombi temizleme:", e)
        );
        // ✅ Sorun 1: Proxy'yi temizle (çökme sonrası kalıntı)
        await clearProxy(true);
        updateTrayTooltip("disconnected");
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
          } catch (e) {
            console.error("Cleanup failed:", e);
          }
        })();

        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3000));
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
      } catch (e) {
        console.error("Cleanup failed:", e);
      }
    })();

    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3000));
    await Promise.race([cleanupPromise, timeoutPromise]);

    try {
      await invoke("quit_app");
    } catch (e) {
      console.error("Quit app failed:", e);
      await getCurrentWindow().destroy();
    }
  };

  // Auto-connect on mount
  useEffect(() => {
    const shouldAutoConnect = configRef.current.autoConnect;
    let isMounted = true;

    if (shouldAutoConnect && !childProcess.current) {
      const timeoutId = setTimeout(() => {
        if (!childProcess.current && isMounted) {
          setIsProcessing(true);
          startEngine(8080);
        }
      }, 300); // ✅ 1000ms -> 300ms (Uygulama açılışında daha hızlı bağlan)

      return () => {
        isMounted = false;
        clearTimeout(timeoutId);
      };
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        {!isAdmin && !import.meta.env.DEV && (
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
                      dangerouslySetInnerHTML={{ __html: t.adminStep }}
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
                    open(URLS.tutorialHowItWorks)
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
          disabled={isProcessing}
        >
          <Power size={22} strokeWidth={2.5} />
          <span>
            {isProcessing
              ? isConnected
                ? t.btnDisconnecting
                : t.btnConnecting
              : isConnected
                ? t.btnDisconnect
                : t.btnConnect}
          </span>
        </button>
      </div>

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
                maxWidth: "360px",
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
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <QRCodeSVG
                        value={`http://${lanIp}:${pacPort}/`}
                        size={120}
                        level="M"
                      />
                    </div>
                    <p
                      style={{
                        fontSize: "0.75rem",
                        color: "#71717a",
                        textAlign: "center",
                        margin: "0 0 1rem",
                      }}
                    >
                      {t.modalPacQrCaption}
                    </p>
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "#94a3b8",
                        lineHeight: "1.5",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <span
                        dangerouslySetInnerHTML={{ __html: t.modalDescPac }}
                      />
                    </p>
                    <div style={{ marginBottom: "0.75rem" }}>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.75rem",
                          color: "#22c55e",
                          marginBottom: "0.5rem",
                          textTransform: "uppercase",
                          fontWeight: "600",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {t.modalPacUrl}
                      </label>
                      <div
                        className="code-box"
                        onClick={() =>
                          writeText(`http://${lanIp}:${pacPort}/proxy.pac`)
                        }
                        title="Kopyala"
                      >
                        <span
                          style={{ fontSize: "0.8rem", wordBreak: "break-all" }}
                        >
                          http://{lanIp}:{pacPort}/proxy.pac
                        </span>
                        <Copy size={16} color="#71717a" />
                      </div>
                    </div>
                    <p
                      style={{
                        fontSize: "0.8rem",
                        color: "#94a3b8",
                        lineHeight: "1.5",
                        marginBottom: "0.5rem",
                        padding: "0 0.5rem",
                      }}
                    >
                      <span
                        dangerouslySetInnerHTML={{ __html: t.modalPacQrHint }}
                      />
                    </p>
                  </>
                )}

                {connectionModalTab === "manual" && (
                  <>
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "#94a3b8",
                        lineHeight: "1.5",
                        marginBottom: "1rem",
                      }}
                    >
                      <span dangerouslySetInnerHTML={{ __html: t.modalDesc }} />
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
                          onClick={() => writeText(lanIp)}
                          title="Kopyala"
                        >
                          <span>{lanIp}</span>
                          <Copy size={16} color="#71717a" />
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
                          onClick={() => writeText(currentPort.toString())}
                          title="Kopyala"
                        >
                          <span>{currentPort}</span>
                          <Copy size={16} color="#71717a" />
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
                  onClick={() => open(URLS.tutorialProxy)}
                >
                  <HelpCircle size={18} />
                  {t.modalTutorial}
                </button>
              </div>
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

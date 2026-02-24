import Settings from './Settings';
import { motion, AnimatePresence } from 'framer-motion';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Command, open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { getTranslations } from './i18n';

// Re-add missing imports
import { Power, Shield, Settings as SettingsIcon, FileText, X, Copy, Trash2, WifiOff, Globe, Smartphone, HelpCircle, AlertTriangle } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { exit } from '@tauri-apps/plugin-process';
import { isPermissionGranted, requestPermission, sendNotification, onAction } from '@tauri-apps/plugin-notification';

import './App.css';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [currentPort, setCurrentPort] = useState(8080);
  const [lanIp, setLanIp] = useState('127.0.0.1'); // ✅ LAN IP State
  const [showConnectionModal, setShowConnectionModal] = useState(false); // ✅ Modal State
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true); 
  const [isOnline, setIsOnline] = useState(navigator.onLine); // ✅ Internet Durumu

  // Check Admin on Mount
  useEffect(() => {
    invoke('check_admin')
      .then(result => {
        setIsAdmin(result);
        if (!result) {
          addLog(getTranslations(configRef.current.language || 'tr').logAdminMissing, "error");
        }
      })
      .catch(err => {
        console.error('Admin check warning:', err);
        setIsAdmin(true); 
      });

    // ✅ Internet Connection Listeners
    const handleOnline = () => {
        setIsOnline(true);
        addLog(getTranslations(configRef.current.language || 'tr').logInternetBack, "success");
    };
    const handleOffline = () => {
        setIsOnline(false);
        addLog(getTranslations(configRef.current.language || 'tr').logInternetLost, "error");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

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
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        if (unlistenNotificationAction) {
          unlistenNotificationAction();
        }
    };
  }, []);
  
  // Settings State
  const [config, setConfig] = useState(() => {
    const defaultSettings = {
      language: 'tr',
      autoStart: false,
      autoConnect: false,
      minimizeToTray: false,
      dnsMode: 'auto',
      selectedDns: 'cloudflare',
      autoReconnect: true,
      dpiMethod: '0'
    };
    
    const saved = localStorage.getItem('bypax_config');
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
  const t = useMemo(() => getTranslations(config.language || 'tr'), [config.language]);

  const childProcess = useRef(null);
  const logsEndRef = useRef(null);
  const isRetrying = useRef(false);
  
  // ✅ Auto-reconnect mekanizması
  const retryCount = useRef(0);
  const retryTimer = useRef(null);
  const userIntentDisconnect = useRef(false);
  // ✅ Çıkış işlemi başladı mı? (çift modal engellemek için)
  const isExiting = useRef(false);

  // Constants
  const DNS_MAP = {
    system: null, 
    cloudflare: '1.1.1.1',
    adguard: '94.140.14.14',
    google: '8.8.8.8',
    quad9: '9.9.9.9',
    opendns: '208.67.222.222'
  };



  const updateConfig = (key, value) => {
    setConfig(prev => {
      const newConfig = { ...prev, [key]: value };
      localStorage.setItem('bypax_config', JSON.stringify(newConfig));
      return newConfig;
    });
  };



  // Custom Confirm State
  const confirmResolver = useRef(null);
  const [confirmState, setConfirmState] = useState({ isOpen: false, title: '', desc: '' });

  const customConfirm = (desc, options) => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        title: options?.title || '',
        desc: desc
      });
      confirmResolver.current = resolve;
    });
  };

  const handleConfirmResult = (result) => {
    setConfirmState(prev => ({ ...prev, isOpen: false }));
    if (confirmResolver.current) {
      confirmResolver.current(result);
      confirmResolver.current = null;
    }
  };

  const notifyUser = async (title, body, eventType) => {
    try {
      if (configRef.current.notifications === false) return; // Kullanıcı bildirimleri kapattıysa
      if (eventType === 'connect' && configRef.current.notifyOnConnect === false) return;
      if (eventType === 'disconnect' && configRef.current.notifyOnDisconnect === false) return;
      if (eventType === 'disconnect_manual' && configRef.current.notifyOnDisconnect === false) return;

      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }
      if (permissionGranted) {
        sendNotification({ title, body });
      }
    } catch (err) {
      console.error('Notification error:', err);
    }
  };

  const addLog = (msg, type = 'info') => {
    // Prevent empty messages
    if (!msg || msg.trim().length === 0) return;

    const cleanMsg = msg.replace(/\x1b\[[0-9;]*m/g, '');
    setLogs(prev => [...prev.slice(-99), { 
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(), 
      msg: cleanMsg, 
      type 
    }]);
  };

  const [copyStatus, setCopyStatus] = useState('idle'); // idle, success, error

  const copyLogs = async () => {
    if (logs.length === 0) return;
    
    const logText = logs.map(l => `[${l.time}] ${l.msg}`).join('\n');
    
    try {
      await writeText(logText);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 1500);
    } catch (e) {
      console.error('Tauri clipboard failed, trying navigator:', e);
      try {
        await navigator.clipboard.writeText(logText);
        setCopyStatus('success');
        setTimeout(() => setCopyStatus('idle'), 1500);
      } catch (navError) {
        console.error('Navigator clipboard also failed:', navError);
        setCopyStatus('error');
        setTimeout(() => setCopyStatus('idle'), 1500);
      }
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const clearProxy = async (silent = false) => {
    try {
      await invoke('clear_system_proxy');
      if (!silent) {
        addLog(t.logProxyCleared, 'success');
      }
    } catch (e) {
      addLog(`Proxy temizleme hatası: ${e}`, 'warn');
      console.error(e);
    }
  };

  // ✅ Exponential backoff hesaplama
  const getRetryDelay = (attempt) => {
    const delays = [0, 3000, 6000, 12000, 20000]; // 0s, 3s, 6s, 12s, 20s
    return delays[Math.min(attempt, delays.length - 1)];
  };

  // ✅ Tray tooltip güncelle
  const updateTrayTooltip = async (status) => {
    try {
      let tooltip = '';
      switch (status) {
        case 'connected':
          const dnsName = DNS_MAP[config.selectedDns] 
            ? Object.keys(DNS_MAP).find(key => DNS_MAP[key] === DNS_MAP[config.selectedDns])?.toUpperCase()
            : 'SYSTEM';
          tooltip = `🟢 BypaxDPI - ${t.statusConnected}\n127.0.0.1:${currentPort}\nDNS: ${dnsName}`;
          break;
        case 'disconnected':
          tooltip = `🔴 BypaxDPI - ${t.statusInactive}`;
          break;
        case 'retrying':
          tooltip = `🔄 BypaxDPI - ${t.btnConnecting}\n${retryCount.current}/5...`;
          break;
        case 'connecting':
          tooltip = `⏳ BypaxDPI - ${t.btnConnecting}`;
          break;
        default:
          tooltip = '🛡️ BypaxDPI';
      }
      await invoke('update_tray_tooltip', { tooltip });
    } catch (e) {
      console.error('Tray tooltip güncelleme hatası:', e);
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
    const maxAttempts = 5;

    if (currentAttempt >= maxAttempts) {
      // Maksimum deneme aşıldı
      addLog(`=4 ${t.logMaxRetries}`, 'error');
      addLog('', 'info');
      addLog(`=� ${t.logPossibleReasons}`, 'warn');
      addLog(`  • ${t.logReasonInternet}`, 'info');
      addLog(`  • ${t.logReasonFirewall}`, 'info');
      addLog(`  • ${t.logReasonPorts}`, 'info');
      addLog('', 'info');
      addLog(`=� ${t.logSolutions}`, 'warn');
      addLog(`  • ${t.logSolInternet}`, 'info');
      addLog(`  • ${t.logSolFirewall}`, 'info');
      addLog(`  • ${t.logSolAdmin}`, 'info');
      addLog(`  • ${t.logSolLogs}`, 'info');
      
      retryCount.current = 0;
      setIsProcessing(false);
      return;
    }

    const delay = getRetryDelay(currentAttempt);
    retryCount.current++;

    if (delay === 0) {
      addLog(`🔄 ${t.logReconnecting(currentAttempt + 1)}`, 'warn');
      startEngine(8080);
    } else {
      addLog(`⏳ ${t.logReconnectWait(delay / 1000, currentAttempt + 1)}`, 'warn');
      updateTrayTooltip('retrying');
      retryTimer.current = setTimeout(() => {
        addLog(`🔄 ${t.logReconnectNow}`, 'info');
        startEngine(8080);
      }, delay);
    }
  };

  // Wait for port to be ready
  const waitForPort = async (port, maxAttempts = 10) => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(500)
        });
        return true;
      } catch {
        await new Promise(r => setTimeout(r, 150)); // ✅ 300ms -> 150ms (Daha sık kontrol)
      }
    }
    return false;
  };

  const startEngine = async (ignoredPort, portRetryCount = 0) => {
    updateTrayTooltip('connecting'); 
    
    // Max 20 retries
    if (portRetryCount >= 20) {
      addLog(t.logNoPort, 'error');
      setIsProcessing(false);
      return;
    }

    // ✅ Rust'tan Smart Configuration al (Port & IP)
    let configData;
    let port;
    let bindAddr;
    
    try {
        configData = await invoke('get_sidecar_config', { 
            allowLanSharing: configRef.current.lanSharing || false 
        });
        port = configData.port;
        bindAddr = configData.bind_address;
        setLanIp(configData.lan_ip); // IP'yi state'e kaydet
    } catch (e) {
        addLog(t.logConfigError(e), 'error');
        setIsProcessing(false);
        return;
    }
    
    if (childProcess.current) return;
    await clearProxy(true);

    const dnsIP = DNS_MAP[config.selectedDns];
    
    addLog(t.logEngineStarting(port), 'info');
    
    // DNS bilgisi
    if (dnsIP) {
      addLog(t.logDnsUsed(config.selectedDns.toUpperCase(), dnsIP), 'info');
    } else {
      addLog(t.logDnsDefault, 'info');
    }
    
    isRetrying.current = false;

    try {
      // Base arguments
      const args = [
          '-listen-port', port.toString(),
          '-listen-addr', bindAddr // ✅ Flag updated to match binary
      ];
      
      // ✅ Sadece DNS seçiliyse ekle
      if (dnsIP) {
        args.push('-dns-addr', dnsIP);
      }
      
      // Diğer parametreler
      args.push(
        '-window-size', configRef.current.dpiMethod || '1', 
        '-enable-doh',            
        '-timeout', '5000'        
      );
      
      const command = Command.sidecar('binaries/bypax-proxy', args);

      
      let connectionConfirmed = false;
      let isReady = false;

      // Optimized regex pattern - compiled once
      const SKIP_PATTERN = /\[(?:PROXY|DNS|HTTPS|CACHE)\]|method:\s*CONNECT|cache (?:miss|hit)|resolving|routing|resolution took|new conn|client sent hello|shouldExploit|useSystemDns|fragmentation|conn established|writing chunked|caching \d+ records|[a-f0-9]{8}-[a-f0-9]{8}|d88|Y88|88P|level=|ctrl \+ c|listen_addr|dns_addr|github\.com|spoofdpi/i;

      const handleOutput = async (line, type) => {
        const trimmedLine = line.trim();
        const lowerLine = line.toLowerCase();
        
        if (trimmedLine.length === 0) return;
        if (/^(DBG|INF|WRN|ERR)\s+\d{4}-/.test(trimmedLine)) return;
        if (line.includes('888')) return;

        if (SKIP_PATTERN.test(line)) return;

        // Optimized alpha check
        const alphaCount = line.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, '').length;
        if (alphaCount < 5 && trimmedLine.length > 3) return;
        
        let friendlyMsg = null;
        
        if (lowerLine.includes('listening on') || lowerLine.includes('created a listener')) {
          isReady = true;
          friendlyMsg = `✓ SpoofDPI Motoru başlatıldı (Port: ${port})`;
        } else if (lowerLine.includes('server started')) {
          isReady = true;
          friendlyMsg = "✓ Bypax motoru aktif";
        } else if (lowerLine.includes('bind') || lowerLine.includes('usage') || lowerLine.includes('yuva adresi')) {
          friendlyMsg = `⚠ Port ${port} dolu, başka port deneniyor...`;
        } else if (lowerLine.includes('initializing')) {
          friendlyMsg = `⏳ Motor başlatılıyor...`;
        }
        
        if (friendlyMsg) {
          addLog(friendlyMsg, type === 'warn' ? 'warn' : 'success');
        }
        
        // Wait for port to be actually ready
        if (!connectionConfirmed && isReady) {
          connectionConfirmed = true;
          
          const portReady = await waitForPort(port);
          if (!portReady) {
            addLog(`Port ${port} açılamadı, yeniden deneniyor...`, 'warn');
            return;
          }
          
          setCurrentPort(port);
          try {
            await invoke('set_system_proxy', { port });
            addLog(t.logProxySet(port), 'success');
          } catch (err) {
            addLog(`Proxy ayarlanamadı: ${err}`, 'error');
            return;
          }
          
          // ✅ Başarılı bağlantı - retry mekanizmasını sıfırla
          retryCount.current = 0;
          userIntentDisconnect.current = false;
          
          setIsConnected(true);
          setIsProcessing(false);
          addLog(t.logConnected, 'success');
          notifyUser('Bypax', t.logConnected, 'connect');
          updateTrayTooltip('connected'); 
          updateTrayTooltip('connected');
        }

        const isPortError = lowerLine.includes('bind') || 
                            lowerLine.includes('usage') || 
                            lowerLine.includes('listener') || 
                            lowerLine.includes('kullanıma izin veriliyor'); 

        if (isPortError && (lowerLine.includes('error') || lowerLine.includes('fail') || lowerLine.includes('ftl')) && !isRetrying.current) {
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

      command.on('close', data => {
        if (!isRetrying.current) {
          const wasConnected = isConnected;
          const isUnexpectedClose = data.code !== 0 && data.code !== null;
          
          // ✅ ÖNCE user intent kontrol et
          if (userIntentDisconnect.current) {
            // Kullanıcı kasıtlı kapattı - normal mesaj göster
            addLog('Bypax motoru kapatıldı.', 'info');
            setIsConnected(false);
            setIsProcessing(false);
            childProcess.current = null;
            clearProxy(true).catch(console.error);
            
            // Reset flags
            retryCount.current = 0;
            userIntentDisconnect.current = false;
            return; // Erken çık, retry yapma
          }
          
          // Kullanıcı kasıtlı kapatmadı - beklenmedik kapanma
          if (isUnexpectedClose) {
              const warnMsg = `⚠️ ${t.logEngineStopped(data.code)}`;
              addLog(warnMsg, 'warn');
          } else {
              addLog('Bypax motoru kapatıldı.', 'info');
          }
          
          // ✅ childProcess null yapılmadan önce backup al
          const hadActiveProcess = childProcess.current !== null;
          
          setIsConnected(false);
          setIsProcessing(false);
          childProcess.current = null;
          clearProxy(true).catch(console.error);
          updateTrayTooltip('disconnected'); // ✅ Bağlantı koptu (geçici)
          
          // ✅ Otomatik yeniden bağlanma kontrol
          const autoReconnectEnabled = configRef.current.autoReconnect !== false; // undefined veya true ise açık
          
          const shouldReconnect = 
            autoReconnectEnabled &&               // Ayarda açık mı?
            !userIntentDisconnect.current &&      // Kullanıcı kasıtlı kapatmadı mı?
            hadActiveProcess;                     // Process çalışıyor muydu?
          
          if (shouldReconnect) {
            addLog(`🔄 ${t.logAutoReconnect}`, 'info');
            notifyUser('Bypax', t.logAutoReconnect, 'disconnect');
            setIsProcessing(true);
            attemptReconnect();
          }
        }
      });

      command.stderr.on('data', line => handleOutput(line, 'warn'));
      command.stdout.on('data', line => handleOutput(line, 'info'));
      
      const child = await command.spawn();
      childProcess.current = child;

      // Failsafe timeout
      setTimeout(async () => {
        if (childProcess.current && !connectionConfirmed && !isRetrying.current) {
             connectionConfirmed = true;
             setCurrentPort(port);

             try {
                await invoke('set_system_proxy', { port: port });
                addLog(t.logProxySet(port), 'success');
             } catch (err) {
                addLog(`Proxy ayarlanamadı: ${err}`, 'error');
             }

             // ✅ Başarılı bağlantı - retry mekanizmasını sıfırla
             retryCount.current = 0;
             userIntentDisconnect.current = false;

             setIsConnected(true);
             setIsProcessing(false);
             addLog(t.logConnected, 'info');
             notifyUser('Bypax', t.logConnected, 'connect');
             updateTrayTooltip('connected'); // ✅ Auto-connect başarılı
        }
      }, 2000); // (Fail-safe timeout)

    } catch (e) {
      addLog(t.logEngineStartError(e), 'error');
      setIsConnected(false);
      setIsProcessing(false);
      clearProxy();
    }
  };

  const toggleConnection = async () => {
    if (isProcessing) return;

    if (isConnected) {
      if (configRef.current.requireConfirmation !== false) {
         const confirmed = await customConfirm(
             t.confirmDisconnectDesc || 'Güvenli bağlantınızı sonlandırmak istediğinize emin misiniz?', 
             { title: t.confirmDisconnectTitle || 'Bağlantıyı Kes' }
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
          addLog(t.logDisconnected, 'warn');
          await childProcess.current.kill();
        } catch (e) {
          addLog(`Servis durdurma hatası: ${e}`, 'error');
        }
        childProcess.current = null;
      }
      setIsConnected(false);
      await clearProxy(); 
      addLog('Servis Durduruldu', 'success');

      // Eğer kapatma (shutdown) sırasındaysa, bildirim yollama.
      if (!isAppClosing) {
         notifyUser('Bypax', 'Bağlantı başarıyla sonlandırıldı.', 'disconnect_manual'); // Özel notification event tipi
      }
      
      setIsProcessing(false);
      updateTrayTooltip('disconnected'); // ✅ Manuel durdurma
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
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // isAppClosing state - uygulamayı kapatırken/tepsiye alırken sahte disconnect atlaması
  const [isAppClosing, setIsAppClosing] = useState(false);

  // ✅ LAN Sharing Değişince Restart (Side-Effect)
  useEffect(() => {
      if (config.lanSharing !== configRef.current.lanSharing) {
           if (isConnected) {
               addLog(t.logLanRestart, 'warn');
               childProcess.current?.kill().catch(() => {});
               childProcess.current = null;
               setIsConnected(false);
               setTimeout(() => startEngine(0), 1500); // 1.5s bekle (Portun boşa çıkması için)
           }
      }
  }, [config.lanSharing]);

  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    // Initial cleanup on mount
    (async () => {
      try {
        await clearProxy(true);
        updateTrayTooltip('disconnected');
      } catch (e) {
        console.error('Initial proxy cleanup failed:', e);
      }
    })();
    
    // Listen for window close event
    const initListener = async () => {
      const win = getCurrentWindow();
      const unlisten = await win.onCloseRequested(async (event) => {
        event.preventDefault();

        // ✅ handleExit zaten çıkış yapıyorsa tekrar modal gösterme
        if (isExiting.current) {
          return;
        }
        
        setIsAppClosing(true);

        if (configRef.current.minimizeToTray) {
          setIsAppClosing(false); 
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
              t.confirmExitDesc || 'Bypax motorunu durdurup çıkmak istediğinize emin misiniz?', 
              { title: t.confirmExitTitle || 'Çıkış' }
          );
          if (!confirmed) {
             setIsAppClosing(false);
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

        try {
          if (childProcess.current) {
            await childProcess.current.kill().catch(() => {}); 
          }
          await clearProxy(true);
        } catch (e) {
          console.error('Cleanup failed:', e);
        }
        await exit(0);
      });
      return unlisten;
    };

    let unlistenFn;
    initListener().then(fn => unlistenFn = fn);

    return () => {
      if (unlistenFn) unlistenFn();
      
      // ✅ Retry timer'ı temizle
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      
      // Cleanup on unmount
      const cleanup = async () => {
        setIsAppClosing(true);
        userIntentDisconnect.current = true; // prevent false notifications on reload/close
        if (childProcess.current) {
          try {
            await childProcess.current.kill();
            childProcess.current = null;
          } catch (e) {
            console.error('Process kill failed:', e);
          }
        }
        try {
          await invoke('clear_system_proxy');
        } catch (e) {
          console.error('Proxy cleanup failed:', e);
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
          t.confirmExitDesc || 'Bypax motorunu durdurup çıkmak istediğinize emin misiniz?', 
          { title: t.confirmExitTitle || 'Çıkış' }
      );
      if (!confirmed) return;
    }

    // ✅ Flag'i set et — onCloseRequested'ın tekrar modal göstermesini engeller
    isExiting.current = true;
    setIsAppClosing(true);
    userIntentDisconnect.current = true; // Reconnect engelle
    addLog('Kapatma başlatılıyor...', 'warn');
    
    // ✅ Timer'ı temizle
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    
    try {
      if (childProcess.current) {
        await childProcess.current.kill().catch(() => {}); 
        childProcess.current = null;
        addLog('İşlem sonlandırıldı', 'success');
      }
      await clearProxy(true);
      // ✅ Direkt exit(0) çağır — close() çağrısı onCloseRequested'ı tetikler ve çift çıkışa neden olur
      await exit(0);
    } catch (e) {
      await exit(1);
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
      const DESIGN_WIDTH = 380;
      const DESIGN_HEIGHT = 700;
      
      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;
      
      // X ve Y eksenlerindeki sığma oranlarını hesapla
      const scaleX = currentWidth / DESIGN_WIDTH;
      const scaleY = currentHeight / DESIGN_HEIGHT;
      
      // En kısıtlı alana göre scale belirle (Aspect Ratio koruyarak sığdır)
      // %98'in altındaysa scale et (titremeyi önlemek için tolerans)
      const scale = Math.min(scaleX, scaleY);
      
      if (scale < 0.99) {
        document.body.style.zoom = `${scale}`;
      } else {
        document.body.style.zoom = '1';
      }
    };

    window.addEventListener('resize', handleResize);
    
    // Initial checks
    handleResize();
    setTimeout(handleResize, 100);
    setTimeout(handleResize, 500); // Yüklenme gecikmeleri için

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Native App Experience: Disable browser-like behaviors
  useEffect(() => {
    // Disable right-click
    const handleContextMenu = (e) => e.preventDefault();
    
    // Disable refresh and dev shortcuts
    const handleKeyDown = (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      
      // Block F5, F11 (Fullscreen), F12
      if (['F5', 'F11', 'F12'].includes(e.key)) {
        e.preventDefault();
      }

      // Block Ctrl+R, Ctrl+Shift+R, Ctrl+Shift+I, Ctrl+P, Ctrl+S, Ctrl+U (View Source)
      if (isCmdOrCtrl && ['r', 'R', 'i', 'I', 'p', 'P', 's', 'S', 'u', 'U'].includes(e.key)) {
        e.preventDefault();
      }
    };

    // Prevent accidental text selection (optional but recommended for buttons/UI)
    // and prevent dragging of images/links
    const handleDragStart = (e) => e.preventDefault();

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragstart', handleDragStart);

    // CSS level text selection prevention (best for all browsers)
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('dragstart', handleDragStart);
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
              background: '#09090b', 
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              textAlign: 'center',
              padding: '2rem'
            }}
          >
            {/* Background Glow */}
            <div style={{
                position: 'absolute',
                top: '40%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '100%',
                height: '400px',
                background: 'radial-gradient(circle, rgba(239, 68, 68, 0.08) 0%, rgba(0,0,0,0) 60%)',
                pointerEvents: 'none',
                zIndex: 0
            }} />

            <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '420px' }}>
                <img 
                  src="/bypax-logo.png" 
                  alt="Bypax" 
                  style={{ 
                    width: '80px', 
                    height: '80px', 
                    marginBottom: '1.5rem',
                    borderRadius: '12px',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                  }} 
                />

                <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem', color: '#fff', fontWeight: '700' }}>
                    {t.adminTitle}
                </h1>
                
                <p style={{ color: '#a1a1aa', marginBottom: '1.5rem', lineHeight: '1.6', fontSize: '0.95rem' }}>
                    {t.adminDesc}
                </p>

                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '12px',
                  padding: '1rem',
                  marginBottom: '2rem',
                  textAlign: 'left',
                  width: '100%'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}>
                    <div style={{ 
                      background: 'rgba(239, 68, 68, 0.15)', 
                      padding: '10px', 
                      borderRadius: '8px',
                      color: '#ef4444',
                      flexShrink: 0,
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <Shield size={22} />
                    </div>
                    <div>
                      <div style={{ color: '#d4d4d8', fontSize: '0.85rem', lineHeight: '1.4' }}>
                        {t.adminStep}
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  style={{ 
                    background: '#ef4444', 
                    color: 'white', 
                    padding: '0.8rem 2rem', 
                    border: 'none', 
                    borderRadius: '10px', 
                    fontSize: '0.95rem', 
                    fontWeight: '600', 
                    cursor: 'pointer',
                    width: '100%',
                    transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={(e) => e.target.style.opacity = '0.9'}
                  onMouseLeave={(e) => e.target.style.opacity = '1'}
                  onClick={() => exit(0)}
                >
                  {t.adminClose}
                </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <img src="/bypax-logo.png" alt="Bypax" className="brand-logo" />
          <span className="brand-name">BYPAXDPI</span>
        </div>
        <div className={`status-badge ${isConnected ? 'active' : (isProcessing ? 'processing' : 'passive')}`}>
          <div className="status-dot" />
          <span>
            {isProcessing 
              ? (isConnected ? t.statusDisconnecting : t.statusConnecting) 
              : (isConnected ? t.statusActive : t.statusReady)}
          </span>
        </div>
      </header>

      {/* Offline Alert */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden', background: '#eab308' }} // Yellow/Amber background for warning
          >
             <div style={{ 
                padding: '8px 16px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '8px',
                color: '#000',
                fontSize: '0.85rem',
                fontWeight: '600'
             }}>
                <WifiOff size={16} />
                <span>{t.noInternetTitle}</span>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="main-content">
        <div className="shield-wrapper">
          <div className={`shield-circle ${isConnected ? 'connected' : (isProcessing ? 'processing' : '')}`}>
            <Shield 
              size={56} 
              strokeWidth={1.5}
              className="shield-icon"
            />
          </div>
        </div>

        <div className="status-text">
          <h1 className={`status-title ${isConnected ? 'connected' : (isProcessing ? 'processing' : '')}`}>
            {isProcessing 
              ? (isConnected ? t.statusDisconnecting : t.statusConnecting)
              : (isConnected ? t.statusConnected : t.statusReady2)}
          </h1>
          <p className="status-desc">
            {isProcessing
              ? t.descConnecting
              : (isConnected 
                  ? t.descConnected
                  : t.descReady)}
          </p>

          <AnimatePresence>
            {isConnected && config.selectedDns && config.selectedDns !== 'system' && (
              <motion.div
                initial={{ opacity: 0, y: -5, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto', marginTop: '12px' }}
                exit={{ opacity: 0, y: -5, height: 0, marginTop: 0 }}
                style={{ display: 'flex', justifyContent: 'center' }}
              >
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#a1a1aa',
                  padding: '5px 14px',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: '500',
                  letterSpacing: '0.02em',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}>
                  <Globe size={13} strokeWidth={2.5} style={{ color: '#60a5fa' }} />
                  <span>DNS: <span style={{color: '#e2e8f0', fontWeight: '600'}}>{config.selectedDns.toUpperCase()}</span></span>
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
                    animate={{ opacity: 1, y: 0, height: 'auto', marginBottom: '1rem' }}
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
          className={`main-btn ${isConnected ? 'disconnect' : 'connect'} ${isProcessing ? 'processing' : ''}`}
          onClick={toggleConnection}
          disabled={isProcessing}
        >
          <Power size={22} strokeWidth={2.5} />
          <span>
            {isProcessing 
              ? (isConnected ? t.btnDisconnecting : t.btnConnecting)
              : (isConnected ? t.btnDisconnect : t.btnConnect)
            }
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
            <button className="logs-back-btn" onClick={() => setShowLogs(false)}>
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
                <span className="log-number">{String(index + 1).padStart(3, '0')}</span>
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
              <span>{copyStatus === 'success' ? t.logsCopied : copyStatus === 'error' ? t.logsCopyError : t.logsCopy}</span>
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
                onClick={() => setShowConnectionModal(false)}
            >
                <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    className="connection-modal"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="modal-header">
                        <div className="modal-icon-bg">
                            <Smartphone size={24} color="#a855f7" />
                        </div>
                        <div>
                           <h2>{t.modalTitle}</h2>
                           <p style={{fontSize: '0.8rem', color: '#a1a1aa', margin: 0}}>{t.modalSubtitle}</p>
                        </div>
                        <button className="close-btn" onClick={() => setShowConnectionModal(false)}>
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="modal-body">
                        <p className="modal-desc">
                            <span dangerouslySetInnerHTML={{ __html: t.modalDesc }} />
                        </p>
                        
                        <div className="info-row">
                            <div className="info-group">
                                <label>{t.modalHost}</label>
                                <div className="code-box" onClick={() => writeText(lanIp)}>
                                    <span>{lanIp}</span>
                                    <Copy size={16} />
                                </div>
                            </div>
                            <div className="info-group">
                                <label>{t.modalPort}</label>
                                <div className="code-box" onClick={() => writeText(currentPort.toString())}>
                                    <span>{currentPort}</span>
                                    <Copy size={16} />
                                </div>
                            </div>
                        </div>

                        <button className="tutorial-btn" onClick={() => open('https://bypaxdpi.vercel.app/proxy')}> 
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
                style={{ zIndex: 999999 }}
            >
                <div style={{
                   position: 'absolute',
                   top: '40%',
                   left: '50%',
                   transform: 'translate(-50%, -50%)',
                   width: '100%',
                   height: '400px',
                   background: 'radial-gradient(circle, rgba(234, 179, 8, 0.08) 0%, rgba(0,0,0,0) 60%)',
                   pointerEvents: 'none',
                   zIndex: 0
                }} />
                
                <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    className="connection-modal"
                    style={{ zIndex: 1, textAlign: 'center', maxWidth: '320px' }}
                    onClick={e => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ 
                            background: 'rgba(234, 179, 8, 0.15)', 
                            color: '#eab308', 
                            width: '56px', 
                            height: '56px', 
                            borderRadius: '50%', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            marginBottom: '1rem' 
                        }}>
                           <AlertTriangle size={28} />
                        </div>
                        
                        <h2 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: '0.5rem' }}>{confirmState.title}</h2>
                        <p style={{ color: '#a1a1aa', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                            {confirmState.desc}
                        </p>
                        
                        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                            <button 
                                onClick={() => handleConfirmResult(false)}
                                style={{
                                    fontFamily: 'inherit',
                                    flex: 1,
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    color: '#d4d4d8',
                                    padding: '0.75rem',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '8px',
                                    fontWeight: '500',
                                    cursor: 'pointer'
                                }}
                            >
                                {t.btnNo || 'Hayır'}
                            </button>
                            <button 
                                onClick={() => handleConfirmResult(true)}
                                style={{
                                    fontFamily: 'inherit',
                                    flex: 1,
                                    background: '#eab308',
                                    color: '#000',
                                    padding: '0.75rem',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                {t.btnYes || 'Evet'}
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
        />
      )}
    </div>
  );
}

export default App;

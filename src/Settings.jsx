import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronLeft, Globe, Power, Zap, RotateCw, Activity, 
  Youtube, Coffee, AlertTriangle, Check, Wrench, Languages, Bell, Shield, Settings as SettingsIcon
} from 'lucide-react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { open, Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { getTranslations, SUPPORTED_LANGUAGES } from './i18n';
import './App.css';

const Toggle = ({ checked, onChange }) => (
  <div 
    className={`v2-toggle ${checked ? 'active' : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      onChange(!checked);
    }}
  >
    <div className="v2-toggle-thumb" />
  </div>
);

const Settings = ({ onBack, config, updateConfig }) => {
  const [activeTab, setActiveTab] = useState('general');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeTab]);
  const [latencies, setLatencies] = useState({});
  const [isChecking, setIsChecking] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [sortedProviders, setSortedProviders] = useState([]);
  const [fixStatus, setFixStatus] = useState('idle');

  const lang = config.language || 'tr';
  const t = getTranslations(lang);

  // DNS Providers with translations
  const DNS_PROVIDERS = [
    { id: 'system', name: t.dnsSystemDefault, desc: t.dnsSystemDefaultDesc, ip: null },
    { id: 'cloudflare', name: 'Cloudflare', desc: t.dnsCfDesc, ip: '1.1.1.1' },
    { id: 'adguard', name: 'AdGuard', desc: t.dnsAdguardDesc, ip: '94.140.14.14' },
    { id: 'google', name: 'Google', desc: t.dnsGoogleDesc, ip: '8.8.8.8' },
    { id: 'quad9', name: 'Quad9', desc: t.dnsQuad9Desc, ip: '9.9.9.9' },
    { id: 'opendns', name: 'OpenDNS', desc: t.dnsOpenDnsDesc, ip: '208.67.222.222' }
  ];

  useEffect(() => {
    setSortedProviders(DNS_PROVIDERS);
  }, [lang]);

  useEffect(() => {
    checkAutostart();
  }, []);

  // Only run auto-latency on initial mount if dnsMode is already 'auto'
  // (Do NOT re-run every time settings screen opens to avoid changing active DNS)
  const didAutoCheck = useRef(false);
  useEffect(() => {
    if (config.dnsMode === 'auto' && !didAutoCheck.current) {
      didAutoCheck.current = true;
      // Only check latencies once on first mount, never on re-opens
    }
  }, []);

  const checkAutostart = async () => {
    try {
      const active = await isEnabled();
      setAutostartEnabled(active);
    } catch (e) {
      console.error('Autostart check failed:', e);
    }
  };

  const toggleAutostart = async (val) => {
    try {
      if (val) {
        await enable();
      } else {
        await disable();
      }
      setAutostartEnabled(val);
      updateConfig('autoStart', val);
    } catch (e) {
      console.error('Autostart toggle failed:', e);
    }
  };

  const checkAllLatencies = async (forceSelectBest = false) => {
    setIsChecking(true);
    const newLatencies = {};
    
    const pingableProviders = DNS_PROVIDERS.filter(p => p.ip !== null);
    
    const isSlowConnection = navigator.connection?.effectiveType === '3g' || navigator.connection?.effectiveType === '2g';
    const TIMEOUT_MS = isSlowConnection ? 3000 : 1500;

    const results = await Promise.allSettled(
      pingableProviders.map(async (provider) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS + 500); 
        
        try {
          const command = Command.create('ping', [
            provider.ip, 
            '-n', '1', 
            '-w', String(TIMEOUT_MS) 
          ]);
          
          const output = await command.execute();
          clearTimeout(timeoutId);
          
          const match = output.stdout.match(/(?:time|süre|zaman)[=<\s]+([\d]+)\s*ms/i);
          return { id: provider.id, latency: match ? parseInt(match[1], 10) : 999 };
        } catch (e) {
          clearTimeout(timeoutId);
          console.error(`Ping failed for ${provider.name}:`, e);
          return { id: provider.id, latency: 999 };
        }
      })
    );

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        newLatencies[result.value.id] = result.value.latency;
      }
    });
    
    setLatencies(newLatencies);
    
    const systemDns = DNS_PROVIDERS.find(p => p.id === 'system');
    const otherDns = DNS_PROVIDERS.filter(p => p.id !== 'system').sort((a, b) => 
      (newLatencies[a.id] || 999) - (newLatencies[b.id] || 999)
    );
    
    const sorted = systemDns ? [systemDns, ...otherDns] : otherDns;
    setSortedProviders(sorted);
    
    if (forceSelectBest || config.dnsMode === 'auto') {
      const bestDns = otherDns[0];
      if (bestDns) {
        updateConfig('selectedDns', bestDns.id);
      }
    }

    setIsChecking(false);
  };

  const handleFixInternet = async () => {
    setFixStatus('fixing');
    
    setTimeout(async () => {
      try {
        await invoke('clear_system_proxy');
        setFixStatus('fixed');
        setTimeout(() => setFixStatus('idle'), 2000);
      } catch (e) {
        console.error('Fix failed:', e);
        setFixStatus('error');
        setTimeout(() => setFixStatus('idle'), 2000);
      }
    }, 1200);
  };

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === lang) || SUPPORTED_LANGUAGES[0];

  return (
    <div className="v2-settings-overlay">
      {/* Header */}
      <div className="v2-settings-header">
        <button className="v2-back-btn" onClick={onBack}>
          <ChevronLeft size={28} />
        </button>
        <h1>{t.settingsTitle}</h1>
      </div>

      {/* Scrollable Content */}
      <div className="v2-settings-content" ref={scrollRef}>
        <AnimatePresence mode="wait">
          
          {/* ================= GENERAL TAB ================= */}
          {activeTab === 'general' && (
            <motion.div
              key="general-tab"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}
            >
              {/* ========== 1. DİL (En üstte) ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.language}</div>
                <p style={{ fontSize: '0.8rem', color: '#a1a1aa', margin: '-4px 0 12px 6px' }}>{t.languageDesc}</p>
                <div className="v2-card">
                  {SUPPORTED_LANGUAGES.map((l, index) => (
                    <React.Fragment key={l.code}>
                      <div 
                        className={`v2-item hover-effect ${lang === l.code ? 'v2-selected' : ''}`}
                        style={{ 
                          background: lang === l.code ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                          opacity: lang === l.code ? 1 : 0.6,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          padding: '12px 16px'
                        }}
                        onClick={() => updateConfig('language', l.code)}
                      >
                        <div className="v2-icon blue" style={{ background: lang === l.code ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)', width: '36px', height: '36px', borderRadius: '10px' }}>
                          <span style={{ fontSize: '1.2rem', lineHeight: '1' }}>{l.flag}</span>
                        </div>
                        <div className="v2-item-text">
                          <h3 style={{ color: lang === l.code ? '#60a5fa' : '#e2e8f0', fontSize: '0.95rem' }}>{l.name}</h3>
                          <p style={{ fontSize: '0.75rem', color: lang === l.code ? '#93c5fd' : '#71717a', marginTop: '2px' }}>
                             {l.code.toUpperCase() === 'EN' ? 'EN' : l.code.toUpperCase()}
                          </p>
                        </div>
                        <div className={`v2-radio ${lang === l.code ? 'on' : ''}`}>
                           {lang === l.code && <div className="v2-radio-dot" />}
                        </div>
                      </div>
                      {index < SUPPORTED_LANGUAGES.length - 1 && <div className="v2-divider" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* ========== 3. OTOMASYON ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionAutomation}</div>
                <div className="v2-card">
                  <div className="v2-item">
                    <div className="v2-icon yellow"><Zap size={20} /></div>
                    <div className="v2-item-text">
                      <h3>{t.autoConnect}</h3>
                      <p>{t.autoConnectDesc}</p>
                    </div>
                    <Toggle checked={config.autoConnect} onChange={(v) => updateConfig('autoConnect', v)} />
                  </div>

                  <div className="v2-divider" />

                  <div className="v2-item">
                    <div className="v2-icon green"><RotateCw size={20} /></div>
                    <div className="v2-item-text">
                      <h3>{t.autoReconnect}</h3>
                      <p>{t.autoReconnectDesc}</p>
                    </div>
                    <Toggle checked={config.autoReconnect} onChange={(v) => updateConfig('autoReconnect', v)} />
                  </div>
                </div>
              </div>

              {/* ========== 5. GENEL ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionGeneral}</div>
                <div className="v2-card">
                  
                  <div className="v2-item">
                    <div className="v2-icon green"><Power size={20} /></div>
                    <div className="v2-item-text">
                      <h3>{t.autoStart}</h3>
                      <p>{t.autoStartDesc}</p>
                    </div>
                    <Toggle checked={autostartEnabled} onChange={toggleAutostart} />
                  </div>

                  <div className="v2-divider" />

                  <div className="v2-item">
                    <div className="v2-icon gray"><ChevronLeft size={20} style={{transform:'rotate(-90deg)'}} /></div>
                    <div className="v2-item-text">
                      <h3>{t.minimizeToTray}</h3>
                      <p>{t.minimizeToTrayDesc}</p>
                    </div>
                    <Toggle checked={config.minimizeToTray} onChange={(v) => updateConfig('minimizeToTray', v)} />
                  </div>

                  <div className="v2-divider" />

                  <div className="v2-item">
                    <div className="v2-icon yellow" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}><AlertTriangle size={20} /></div>
                    <div className="v2-item-text">
                      <h3>{t.requireConfirmation}</h3>
                      <p>{t.requireConfirmationDesc}</p>
                    </div>
                    <Toggle checked={config.requireConfirmation !== false} onChange={(v) => updateConfig('requireConfirmation', v)} />
                  </div>

                </div>
              </div>
            </motion.div>
          )}


          {/* ================= NETWORK TAB ================= */}
          {activeTab === 'network' && (
            <motion.div
              key="network-tab"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}
            >
              {/* ========== 2. BAĞLANTI YÖNTEMİ ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionMethod}</div>
                <div className="v2-card">
                    {/* Hızlı Mod (Önerilen) - Üstte */}
                    <div 
                      className={`v2-item hover-effect ${config.dpiMethod === '0' ? 'v2-selected' : ''}`}
                      style={{ 
                        background: config.dpiMethod === '0' ? 'rgba(234, 179, 8, 0.1)' : 'transparent',
                        opacity: config.dpiMethod === '0' ? 1 : 0.5,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => updateConfig('dpiMethod', '0')}
                    >
                      <div className="v2-icon yellow" style={{ background: config.dpiMethod === '0' ? 'rgba(234, 179, 8, 0.2)' : '' }}>
                        <Activity size={20} className={config.dpiMethod === '0' ? 'active-icon' : ''} />
                      </div>
                      <div className="v2-item-text">
                        <h3 style={{ color: config.dpiMethod === '0' ? '#facc15' : '' }}>{t.methodFast}</h3>
                        <p>{t.methodFastDesc}</p>
                      </div>
                      <div className={`v2-radio ${config.dpiMethod === '0' ? 'on' : ''}`}>
                         {config.dpiMethod === '0' && <div className="v2-radio-dot" />}
                      </div>
                    </div>

                    <div className="v2-divider" />

                    {/* Güçlü Mod - Altta */}
                    <div 
                      className={`v2-item hover-effect ${config.dpiMethod === '1' ? 'v2-selected' : ''}`}
                      style={{ 
                        background: config.dpiMethod === '1' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                        opacity: config.dpiMethod === '1' ? 1 : 0.5,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => updateConfig('dpiMethod', '1')}
                    >
                      <div className="v2-icon blue" style={{ background: config.dpiMethod === '1' ? 'rgba(59, 130, 246, 0.2)' : '' }}>
                        <Zap size={20} className={config.dpiMethod === '1' ? 'active-icon' : ''} />
                      </div>
                      <div className="v2-item-text">
                        <h3 style={{ color: config.dpiMethod === '1' ? '#60a5fa' : '' }}>{t.methodStrong}</h3>
                        <p>{t.methodStrongDesc}</p>
                      </div>
                      <div className={`v2-radio ${config.dpiMethod === '1' ? 'on' : ''}`}>
                         {config.dpiMethod === '1' && <div className="v2-radio-dot" />}
                      </div>
                    </div>
                </div>
              </div>

              {/* ========== 2. AĞ AYARLARI ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionNetwork}</div>
                <div className="v2-card">
                  <div className="v2-item">
                    <div className="v2-icon purple" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#a855f7' }}>
                      <Globe size={20} />
                    </div>
                    <div className="v2-item-text">
                      <h3 style={{ color: '#d8b4fe' }}>{t.lanSharing}</h3>
                      <p>{t.lanSharingDesc}</p>
                    </div>
                    <Toggle checked={config.lanSharing || false} onChange={(v) => updateConfig('lanSharing', v)} />
                  </div>
                </div>
              </div>

              {/* ========== 4. DNS LİSTESİ ========== */}
              <div className="v2-section">
                <div className="v2-section-header-row">
                  <div className="v2-section-title">{t.sectionDns}</div>
                  <button className="v2-refresh-btn" onClick={checkAllLatencies} disabled={isChecking}>
                    <RotateCw size={16} className={isChecking ? 'spin' : ''} />
                  </button>
                </div>
                
                <div className="v2-card">
                  <div className="v2-item">
                    <div className="v2-item-text">
                      <h3>{t.dnsAutoSelect}</h3>
                      <p>{t.dnsAutoSelectDesc}</p>
                    </div>
                    <Toggle 
                      checked={config.dnsMode === 'auto'} 
                      onChange={(v) => {
                        updateConfig('dnsMode', v ? 'auto' : 'manual');
                        if (v) checkAllLatencies(true); // forceSelectBest=true: picks best DNS immediately without waiting for state update
                      }} 
                    />
                  </div>

                  <div className="v2-dns-list">
                    <AnimatePresence>
                      {sortedProviders.map((p) => {
                        const isSelected = config.selectedDns === p.id;
                        const isAutoMode = config.dnsMode === 'auto';
                        const isDisabled = isAutoMode && p.id !== 'system';
                        const isSystemOption = p.id === 'system';
                        return (
                          <motion.div 
                            layout
                            key={p.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ 
                              opacity: isDisabled
                                ? (isSelected ? 1 : 0.5)
                                : (!isSystemOption && !isSelected ? 0.45 : 1),
                              y: 0 
                            }}
                            whileHover={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            className={`v2-dns-item ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                            style={isSystemOption ? {
                              background: isSelected
                                ? 'rgba(100, 116, 139, 0.25)'
                                : 'rgba(71, 85, 105, 0.12)',
                              borderLeft: '3px solid rgba(148, 163, 184, 0.35)',
                              borderRadius: '8px',
                            } : {}}
                            onClick={() => {
                              if (isDisabled) return;
                              // If user picks system, turn off auto mode
                              if (isSystemOption && isAutoMode) {
                                updateConfig('dnsMode', 'manual');
                              }
                              updateConfig('selectedDns', p.id);
                            }}
                          >
                            <div className={`v2-radio ${isSelected ? 'on' : ''}`}>
                              {isSelected && <div className="v2-radio-dot" />}
                            </div>
                            <div className="v2-dns-info">
                              <span className="v2-dns-name" style={isSystemOption ? { color: '#94a3b8' } : {}}>{p.name}</span>
                              <span className="v2-dns-desc">{p.desc}</span>
                            </div>
                            {latencies[p.id] && (
                              <div className="v2-latency">{latencies[p.id]}ms</div>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </motion.div>
          )}


          {/* ================= NOTIFICATIONS TAB ================= */}
          {activeTab === 'notifications' && (
            <motion.div
              key="notifications-tab"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}
            >
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionNotifications}</div>
                <div className="v2-card">
                  
                  <div className="v2-item">
                    <div className="v2-icon blue" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}><Bell size={20} /></div>
                    <div className="v2-item-text">
                      <h3>{t.notifications}</h3>
                      <p>{t.notificationsDesc}</p>
                    </div>
                    <Toggle checked={config.notifications !== false} onChange={(v) => updateConfig('notifications', v)} />
                  </div>

                  <div className="v2-divider" />

                  <div 
                    className="v2-item hover-effect"
                    style={{
                      opacity: config.notifications !== false ? 1 : 0.4,
                      pointerEvents: config.notifications !== false ? 'auto' : 'none',
                      transition: 'opacity 0.2s ease',
                      paddingLeft: '1.5rem'
                    }}
                    onClick={() => {
                       if (config.notifications !== false) {
                          updateConfig('notifyOnConnect', config.notifyOnConnect !== false ? false : true);
                       }
                    }}
                  >
                    <div className="v2-icon green" style={{ width: '30px', height: '30px', borderRadius: '8px' }}>
                       <Check size={16} />
                    </div>
                    <div className="v2-item-text">
                      <h3 style={{ fontSize: '0.85rem' }}>{t.notifyOnConnect}</h3>
                      <p style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>{t.notifyOnConnectDesc}</p>
                    </div>
                    <Toggle checked={config.notifyOnConnect !== false} onChange={(v) => updateConfig('notifyOnConnect', v)} />
                  </div>

                  <div className="v2-divider" style={{ marginLeft: '3.5rem' }} />

                  <div 
                    className="v2-item hover-effect"
                    style={{
                      opacity: config.notifications !== false ? 1 : 0.4,
                      pointerEvents: config.notifications !== false ? 'auto' : 'none',
                      transition: 'opacity 0.2s ease',
                      paddingLeft: '1.5rem'
                    }}
                    onClick={() => {
                       if (config.notifications !== false) {
                          updateConfig('notifyOnDisconnect', config.notifyOnDisconnect !== false ? false : true);
                       }
                    }}
                  >
                    <div className="v2-icon yellow" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', width: '30px', height: '30px', borderRadius: '8px' }}>
                       <AlertTriangle size={16} />
                    </div>
                    <div className="v2-item-text">
                      <h3 style={{ fontSize: '0.85rem' }}>{t.notifyOnDisconnect}</h3>
                      <p style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>{t.notifyOnDisconnectDesc}</p>
                    </div>
                    <Toggle checked={config.notifyOnDisconnect !== false} onChange={(v) => updateConfig('notifyOnDisconnect', v)} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}


          {/* ================= SYSTEM TAB ================= */}
          {activeTab === 'system' && (
            <motion.div
              key="system-tab"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}
            >
              {/* ========== 7. SORUN GİDERME ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionTroubleshoot}</div>
                <div className="v2-card" style={{ 
                  background: fixStatus === 'fixing' ? '#b45309' : fixStatus === 'fixed' ? '#10b981' : fixStatus === 'error' ? '#ef4444' : '#002c1dff', 
                  border: 'none',
                  transition: 'all 0.4s ease'
                }}>
                  <div className="v2-item hover-effect" onClick={handleFixInternet} style={{cursor: fixStatus === 'idle' ? 'pointer' : 'default'}}>
                     <div className="v2-icon" style={{ 
                       color: fixStatus === 'fixing' ? '#b45309' : fixStatus === 'fixed' ? '#10b981' : fixStatus === 'error' ? '#ef4444' : '#10b981', 
                       background: '#ffffff',
                       transition: 'all 0.4s ease'
                     }}>
                       <Wrench size={20} className={fixStatus === 'fixing' ? 'spinning-slow' : ''} />
                     </div>
                      <div className="v2-item-text">
                        <h3 style={{ color: '#ffffff', transition: 'all 0.4s ease' }}>
                          {fixStatus === 'fixing' ? t.fixRepairing : fixStatus === 'fixed' ? t.fixDone : fixStatus === 'error' ? t.fixError : t.fixInternet}
                        </h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.82)', transition: 'all 0.4s ease' }}>
                          {fixStatus === 'fixing' ? t.fixRepairingDesc : fixStatus === 'fixed' ? t.fixDoneDesc : fixStatus === 'error' ? t.fixErrorDesc : t.fixInternetDesc}
                        </p>
                      </div>
                     <div style={{ padding: '0 0.5rem' }}>
                       {fixStatus === 'fixing' && <RotateCw size={20} className="spinning" color="#ffffff" />}
                       {fixStatus === 'fixed' && <Check size={24} color="#ffffff" />}
                       {fixStatus === 'error' && <AlertTriangle size={24} color="#ffffff" />}
                     </div>
                  </div>
                </div>
              </div>

              {/* ========== 8. GELİŞTİRİCİ ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionDev}</div>
                <div className="v2-card">
                  <div className="v2-dev-profile">
                    <img 
                      src="https://yt3.ggpht.com/M-YH7dPjl40d2cXHK30at3hYyn1seO_RO4MJ-ee8FMN6wHrRQ6ZVaX48JIwHt0BqZSA3do8N2g=s88-c-k-c0x00ffffff-no-rj" 
                      alt="ConsolAktif"
                      className="v2-avatar-img"
                    />
                    <div className="v2-dev-details">
                      <span className="v2-dev-name">ConsolAktif</span>
                      <span className="v2-dev-role">{t.devRole}</span>
                    </div>
                  </div>
                  <div className="v2-dev-actions">
                     <button className="v2-btn youtube" onClick={() => open('https://youtube.com/@ConsolAktif')}>
                       <Youtube size={18} /> {t.devSubscribe}
                     </button>
                     <button className="v2-btn coffee" onClick={() => open('https://www.patreon.com/join/ConsolAktif')}>
                       <Coffee size={18} /> {t.devSupport}
                     </button>
                  </div>
                </div>
              </div>

              {/* ========== 9. ÖNEMLİ BİLGİ ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionNotice}</div>
                <div className="v2-card" style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <div className="v2-item">
                     <div className="v2-icon" style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' }}>
                       <AlertTriangle size={20} />
                     </div>
                     <div className="v2-item-text">
                       <h3 style={{ color: '#fca5a5' }}>{t.noticeTitle}</h3>
                       <p style={{ color: '#f87171', fontSize: '0.75rem', lineHeight: '1.4' }}>
                         {t.noticeDesc}
                       </p>
                     </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tabs / Bottom Nav */}
      <nav className="bottom-nav" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(10, 10, 18, 0.95)' }}>
        <button className="nav-btn" onClick={() => setActiveTab('general')} style={{ color: activeTab === 'general' ? '#fff' : '' }}>
          <SettingsIcon size={22} strokeWidth={activeTab === 'general' ? 2.5 : 2} style={{ color: activeTab === 'general' ? '#60a5fa' : '' }} />
          <span>{t.tabGeneral || 'GENEL'}</span>
        </button>
        <div className="nav-divider" />
        <button className="nav-btn" onClick={() => setActiveTab('network')} style={{ color: activeTab === 'network' ? '#fff' : '' }}>
          <Globe size={22} strokeWidth={activeTab === 'network' ? 2.5 : 2} style={{ color: activeTab === 'network' ? '#a855f7' : '' }} />
          <span>{t.tabNetwork || 'AĞ'}</span>
        </button>
        <div className="nav-divider" />
        <button className="nav-btn" onClick={() => setActiveTab('notifications')} style={{ color: activeTab === 'notifications' ? '#fff' : '' }}>
          <Bell size={22} strokeWidth={activeTab === 'notifications' ? 2.5 : 2} style={{ color: activeTab === 'notifications' ? '#10b981' : '' }} />
          <span>{t.tabNotification || 'BİLDİRİM'}</span>
        </button>
        <div className="nav-divider" />
        <button className="nav-btn" onClick={() => setActiveTab('system')} style={{ color: activeTab === 'system' ? '#fff' : '' }}>
          <Shield size={22} strokeWidth={activeTab === 'system' ? 2.5 : 2} style={{ color: activeTab === 'system' ? '#eab308' : '' }} />
          <span>{t.tabSystem || 'SİSTEM'}</span>
        </button>
      </nav>
    </div>
  );
};

export default Settings;

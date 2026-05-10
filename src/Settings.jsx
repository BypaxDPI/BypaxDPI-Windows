import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronLeft, ChevronDown, Globe, Power, Zap, RotateCw, Activity, Pin,
  Youtube, Coffee, AlertTriangle, Check, Wrench, Languages, Bell, Shield, Settings as SettingsIcon
} from 'lucide-react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { Command } from '@tauri-apps/plugin-shell';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { getTranslations, SUPPORTED_LANGUAGES } from './i18n';
import { URLS } from './constants';
import { ISP_PROFILES, CHUNK_SIZES, DEFAULT_CHUNKS } from './profiles';
import './App.css';

const IS_MACOS = /Mac/.test(navigator.userAgent) && !/Windows/.test(navigator.userAgent);

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

const Settings = ({ onBack, config, updateConfig, dnsLatencies, setDnsLatencies }) => {
  const [activeTab, setActiveTab] = useState('general');
  const scrollRef = useRef(null);

  const[expandedISP, setExpandedISP] = useState(null);
  const [driverInstalled, setDriverInstalled] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [showNpcapDetails, setShowNpcapDetails] = useState(false);

  useEffect(() => {
    invoke('check_driver').then(setDriverInstalled);
}, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeTab]);
  // DNS latencies App.jsx'ten prop olarak geliyor — ayarlardan çıkınca kaybolmaz
  const latencies = dnsLatencies || {};
  const setLatencies = setDnsLatencies || (() => {});
  const [isChecking, setIsChecking] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [sortedProviders, setSortedProviders] = useState([]);
  const [fixStatus, setFixStatus] = useState('idle');

  const lang = config.language || 'tr';
  const t = getTranslations(lang);

  // DNS Providers with translations
  // P2-FIX: Bellek sızıntısı önlendi - Her renderda tekrardan oluşmasını engelledik
  const DNS_PROVIDERS = useMemo(() => [
    { id: 'system', name: t.dnsSystemDefault, desc: t.dnsSystemDefaultDesc, ip: null },
    { id: 'cloudflare', name: 'Cloudflare', desc: t.dnsCfDesc, ip: '1.1.1.1' },
    { id: 'adguard', name: 'AdGuard', desc: t.dnsAdguardDesc, ip: '94.140.14.14' },
    { id: 'google', name: 'Google', desc: t.dnsGoogleDesc, ip: '8.8.8.8' },
    { id: 'quad9', name: 'Quad9', desc: t.dnsQuad9Desc, ip: '9.9.9.9' },
    { id: 'opendns', name: 'OpenDNS', desc: t.dnsOpenDnsDesc, ip: '208.67.222.222' }
  ], [t]);

  // P2-FIX: Dil değiştirildiğinde mevcut internet gecikmesi (Ping) sırasının kalıcı olması sağlandı
  useEffect(() => {
    if (Object.keys(latencies).length > 0) {
      const systemDns = DNS_PROVIDERS.find(p => p.id === 'system');
      const otherDns = DNS_PROVIDERS.filter(p => p.id !== 'system')
        .sort((a, b) => (latencies[a.id] || 999) - (latencies[b.id] || 999));
      setSortedProviders(systemDns ? [systemDns, ...otherDns] : otherDns);
    } else {
      setSortedProviders(DNS_PROVIDERS);
    }
  }, [lang, latencies, DNS_PROVIDERS]);

  useEffect(() => {
    checkAutostart();
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
        try {
          // P0-FIX: Frontend shell bypass edildi, güvenli arka uç kullanılıyor.
          const latency = await invoke('check_dns_latency', { dnsIp: provider.ip });
          return { id: provider.id, latency };
        } catch (e) {
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
    if (fixStatus === 'fixing') return; // P2-FIX: Rapid click guard
    setFixStatus('fixing');
    try {
      await invoke('clear_system_proxy');
      
      // P1-FIX: Ana ekrandaki bağlantı durumunu eşzamanlı güncelle
      window.dispatchEvent(new CustomEvent('bypax-force-disconnect', {
        detail: { reason: 'manual-fix' }
      }));
      
      setFixStatus('fixed');
      setTimeout(() => setFixStatus('idle'), 2000);
    } catch (e) {
      console.error('Fix failed:', e);
      setFixStatus('error');
      setTimeout(() => setFixStatus('idle'), 2000);
    }
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
                    <div className="v2-icon blue"><Pin size={20} /></div>
                    <div className="v2-item-text">
                      <h3>{t.alwaysOnTop || 'Her Şeyin Üzerinde Tut'}</h3>
                      <p>{t.alwaysOnTopDesc || 'Pencere her zaman diğer pencerelerin üzerinde kalır'}</p>
                    </div>
                    <Toggle checked={config.alwaysOnTop || false} onChange={(v) => updateConfig('alwaysOnTop', v)} />
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
              {/* ========== 1. İSS AKILLI REHBERİ (PREMIUM UX) ========== */}
              <div className="v2-section">
                <div className="v2-section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Globe size={14} /> {t.issGuideTitle}
                </div>
                
                <div style={{
                  background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.4) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '16px',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  {ISP_PROFILES.filter(p => p.id !== 'other').map((isp) => {
                    const nameKey = `iss${isp.id.charAt(0).toUpperCase() + isp.id.slice(1)}Name`;
                    const descKey = `iss${isp.id.charAt(0).toUpperCase() + isp.id.slice(1)}Desc`;
                    const ICON_MAP = { light: <Activity size={18} />, mid: <Zap size={18} />, heavy: <Shield size={18} /> };
                    const ispData = {
                      ...isp,
                      name: t[nameKey] || isp.id,
                      desc: t[descKey] || '',
                      icon: ICON_MAP[isp.id] || <Globe size={18} />,
                    };
                    const isApplied = config.dpiMethod === ispData.mode && 
                                     Number(config.httpsChunkSize) === Number(ispData.chunk);
                    const isExpanded = expandedISP === ispData.id;

                    return (
                      <div 
                        key={ispData.id} 
                        style={{ 
                          background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                          borderRadius: '12px',
                          border: isExpanded ? `1px solid ${ispData.bg}` : '1px solid transparent',
                          transition: 'all 0.3s ease',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Başlık / Tıklanabilir Alan */}
                        <div
                          onClick={() => setExpandedISP(isExpanded ? null : ispData.id)}
                          style={{ 
                            padding: '12px 14px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '12px',
                            cursor: 'pointer' 
                          }}
                        >
                          <div style={{ 
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '36px', height: '36px', borderRadius: '10px',
                            background: ispData.bg, color: ispData.color
                          }}>
                            {ispData.icon}
                          </div>
                          
                          <div style={{ flex: 1 }}>
                            <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>{ispData.name}</h4>
                            {ispData.logos && ispData.logos.length > 0 && (
                              <div style={{ display: 'flex', gap: '6px', marginTop: '4px', marginBottom: '2px', alignItems: 'center' }}>
                                {ispData.logos.map((logo, idx) => (
                                  <img key={idx} src={logo} alt="ISP Logo" style={{ height: '14px', opacity: 0.7, filter: 'grayscale(0.3)' }} />
                                ))}
                              </div>
                            )}
                            <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem' }}>
                              {isApplied ? <span style={{ color: ispData.color, fontWeight: 600 }}>✓ {t.issProfileActive}</span> : t.issProfileSee}
                            </p>
                          </div>

                          <ChevronLeft 
                            size={18} color="#64748b" 
                            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(-90deg)', transition: 'transform 0.3s ease' }} 
                          />
                        </div>
                        
                        {/* Animasyonlu İçerik */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }} 
                              animate={{ height: 'auto', opacity: 1 }} 
                              exit={{ height: 0, opacity: 0 }} 
                              style={{ overflow: 'hidden' }}
                            >
                              <div style={{ padding: '0 14px 14px 60px' }}>
                                <p style={{ color: '#94a3b8', fontSize: '0.8rem', lineHeight: 1.5, margin: '0 0 12px 0' }}>{ispData.desc}</p>

                                {!isApplied ? (
                                  <button
                                    onClick={() => {
                                      updateConfig({
                                        dpiMethod: ispData.mode,
                                        httpsChunkSize: ispData.chunk,
                                        selectedIspProfile: ispData.id
                                      });
                                    }}
                                    style={{ 
                                      background: ispData.color, color: '#000', border: 'none', 
                                      padding: '8px 16px', borderRadius: '8px', fontSize: '0.8rem', 
                                      fontWeight: 700, cursor: 'pointer', display: 'flex', 
                                      alignItems: 'center', gap: '6px', boxShadow: `0 4px 12px ${ispData.bg}`,
                                      transition: 'transform 0.2s'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                                  >
                                    <Check size={16} /> {t.issApplyBtn}
                                  </button>
                                ) : (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', color: '#cbd5e1', fontSize: '0.75rem' }}>
                                    <Check size={14} color={ispData.color} /> {t.issAppliedMsg}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ========== 2. MANUEL BAĞLANTI YÖNTEMİ ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionBypass}</div>
                <div className="v2-card">
                    {/* Turbo Mod */}
                    <div 
                      className={`v2-item hover-effect ${config.dpiMethod === '0' ? 'v2-selected' : ''}`}
                      style={{ background: config.dpiMethod === '0' ? 'rgba(234, 179, 8, 0.1)' : 'transparent', opacity: config.dpiMethod === '0' ? 1 : 0.5, cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onClick={() => { updateConfig({ dpiMethod: '0', httpsChunkSize: 4, selectedIspProfile: 'custom' }); }}
                    >
                      <div className="v2-icon yellow" style={{ background: config.dpiMethod === '0' ? 'rgba(234, 179, 8, 0.2)' : '' }}>
                        <Activity size={20} className={config.dpiMethod === '0' ? 'active-icon' : ''} />
                      </div>
                      <div className="v2-item-text">
                        <h3 style={{ color: config.dpiMethod === '0' ? '#facc15' : '' }}>{t.modeTurboName}</h3>
                        <p>{t.modeTurboDesc}</p>
                      </div>
                      <div className={`v2-radio ${config.dpiMethod === '0' ? 'on' : ''}`}>
                         {config.dpiMethod === '0' && <div className="v2-radio-dot" />}
                      </div>
                    </div>

                    <div className="v2-divider" />

                    {/* Dengeli Mod */}
                    <div 
                      className={`v2-item hover-effect ${config.dpiMethod === '1' ? 'v2-selected' : ''}`}
                      style={{ background: config.dpiMethod === '1' ? 'rgba(34, 197, 94, 0.1)' : 'transparent', opacity: config.dpiMethod === '1' ? 1 : 0.5, cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onClick={() => { updateConfig({ dpiMethod: '1', httpsChunkSize: 2, selectedIspProfile: 'custom' }); }}
                    >
                      <div className="v2-icon green" style={{ background: config.dpiMethod === '1' ? 'rgba(34, 197, 94, 0.2)' : '' }}>
                        <Zap size={20} className={config.dpiMethod === '1' ? 'active-icon' : ''} />
                      </div>
                      <div className="v2-item-text">
                        <h3 style={{ color: config.dpiMethod === '1' ? '#4ade80' : '' }}>{t.modeBalancedName}</h3>
                        <p>{t.modeBalancedDesc}</p>
                      </div>
                      <div className={`v2-radio ${config.dpiMethod === '1' ? 'on' : ''}`}>
                         {config.dpiMethod === '1' && <div className="v2-radio-dot" />}
                      </div>
                    </div>

                    <div className="v2-divider" />

                   {/* Güçlü Mod*/}
                    <div 
                      className={`v2-item hover-effect ${config.dpiMethod === '2' ? 'v2-selected' : ''}`}
                      style={{ 
                        background: config.dpiMethod === '2' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                        opacity: config.dpiMethod === '2' ? 1 : 0.5,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => { updateConfig({ dpiMethod: '2', httpsChunkSize: 1, selectedIspProfile: 'custom' }); }}
                    >
                      <div className="v2-icon blue" style={{ background: config.dpiMethod === '2' ? 'rgba(59, 130, 246, 0.2)' : '' }}>
                        <Shield size={20} className={config.dpiMethod === '2' ? 'active-icon' : ''} />
                      </div>
                      <div className="v2-item-text">
                        <h3 style={{ color: config.dpiMethod === '2' ? '#60a5fa' : '' }}>{t.modeStrongName}</h3>
                        <p>{t.modeStrongDesc}</p>
                      </div>
                      <div className={`v2-radio ${config.dpiMethod === '2' ? 'on' : ''}`}>
                         {config.dpiMethod === '2' && <div className="v2-radio-dot" />}
                      </div>
                    </div>

                    {/* Npcap Gelişmiş Bypass — Güçlü Mod altında (sadece Windows) */}
                    <AnimatePresence>
                      {!IS_MACOS && config.dpiMethod === '2' && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.25, ease: 'easeInOut' }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div className="v2-divider" />
                          {driverInstalled ? (
                            <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div 
                                className="v2-item" 
                                style={{ padding: 0 }}
                              >
                                <div className="v2-icon" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', width: '32px', height: '32px', minWidth: '32px' }}>
                                  <Shield size={16} />
                                </div>
                                <div className="v2-item-text">
                                  <h3 style={{ color: config.advancedBypass !== false ? '#d8b4fe' : '', fontSize: '0.85rem' }}>{t.advancedFeaturesToggle}</h3>
                                  <p style={{ fontSize: '0.7rem' }}>{t.advancedFeaturesToggleDesc}</p>
                                </div>
                                <Toggle checked={config.advancedBypass !== false} onChange={(v) => updateConfig('advancedBypass', v)} />
                              </div>
                              {needsRestart && (
                                <div style={{ 
                                  display: 'flex', alignItems: 'center', gap: '6px',
                                  padding: '6px 10px', borderRadius: '6px',
                                  background: 'rgba(251, 146, 60, 0.08)', 
                                  border: '1px solid rgba(251, 146, 60, 0.15)'
                                }}>
                                  <AlertTriangle size={12} color="#fb923c" />
                                  <span style={{ fontSize: '0.65rem', color: '#fb923c', fontWeight: 500 }}>
                                    {t.npcapRestartWarning}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div style={{ padding: '6px 16px 10px' }}>
                              {/* Subtle hint pill */}
                              <div 
                                onClick={() => setShowNpcapDetails(!showNpcapDetails)}
                                style={{ 
                                  display: 'inline-flex', alignItems: 'center', gap: '6px', 
                                  cursor: 'pointer', padding: '5px 10px',
                                  borderRadius: '8px',
                                  background: 'rgba(245, 158, 11, 0.06)',
                                  border: '1px solid rgba(245, 158, 11, 0.12)',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)';
                                  e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.2)';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.background = 'rgba(245, 158, 11, 0.06)';
                                  e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.12)';
                                }}
                              >
                                <Zap size={11} color="#f59e0b" />
                                <span style={{ fontSize: '0.68rem', color: '#d4a14a', fontWeight: 500 }}>
                                  {t.advancedNpcapHint}
                                </span>
                                <ChevronDown size={11} color="#d4a14a" style={{ 
                                  transform: showNpcapDetails ? 'rotate(180deg)' : 'rotate(0)', 
                                  transition: 'transform 0.2s',
                                  marginLeft: '2px'
                                }} />
                              </div>

                              {/* Açılabilir detay */}
                              <AnimatePresence>
                                {showNpcapDetails && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    style={{ overflow: 'hidden' }}
                                  >
                                    <div style={{ paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                      <p style={{ fontSize: '0.7rem', color: '#64748b', margin: 0, lineHeight: 1.4 }}>{t.advancedNpcapWhy}</p>
                                      <motion.button 
                                        whileHover={{ scale: 1.01 }}
                                        whileTap={{ scale: 0.99 }}
                                        onClick={async () => {
                                          try {
                                            await invoke('install_driver');
                                            const installed = await invoke('check_driver');
                                            setDriverInstalled(installed);
                                            if (installed) setNeedsRestart(true);
                                          } catch (e) {
                                            console.error('Driver install failed:', e);
                                          }
                                        }} 
                                        style={{ 
                                          background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                                          color: '#000', border: 'none', padding: '8px 12px', borderRadius: '8px', 
                                          fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          gap: '6px', width: '100%', textTransform: 'uppercase', letterSpacing: '0.5px',
                                          boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)'
                                        }}
                                      >
                                        <Wrench size={13} />
                                        {t.advancedNpcapInstallBtn}
                                      </motion.button>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Chunk size Seçimi */}
                    {(config.dpiMethod === '1' || config.dpiMethod === '2') && (
                      <>
                        <div className="v2-divider" />
                        <div style={{ display: 'flex', width: '100%', padding: '6px 12px', boxSizing: 'border-box' }}>
                          {CHUNK_SIZES.map((opt) => {
                            const fallbackChunk = DEFAULT_CHUNKS[config.dpiMethod] || 2;
                            const isSelected = Number(config.httpsChunkSize || fallbackChunk) === opt.value;
                            const accentColor = config.dpiMethod === '2' ? '#60a5fa' : '#4ade80';
                            const accentBg = config.dpiMethod === '2' ? 'rgba(59, 130, 246, 0.18)' : 'rgba(34, 197, 94, 0.18)';
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => updateConfig({ httpsChunkSize: opt.value, selectedIspProfile: 'custom' })}
                                style={{
                                  flex: 1, height: '32px', border: 'none', margin: '0 4px', borderRadius: '6px',
                                  background: isSelected ? accentBg : 'rgba(255, 255, 255, 0.03)',
                                  color: isSelected ? accentColor : '#94a3b8',
                                  fontSize: '0.85rem', fontWeight: isSelected ? 700 : 500, cursor: 'pointer', transition: 'all 0.2s'
                                }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                </div>
              </div>

              {/* ========== 3. EKSTRA AĞ AYARLARI (IPv4 ve LAN) ========== */}
              <div className="v2-section">
                <div className="v2-section-title">{t.sectionExtraNetwork}</div>
                <div className="v2-card">
                  
                  {/* YENİ EKLENEN IPv4 TOGGLE'I */}
                  <div className="v2-item" style={{ padding: '1rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div className="v2-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                      <Activity size={20} />
                    </div>
                    <div className="v2-item-text">
                      <h3 style={{ color: '#fca5a5' }}>{t.ipv4ForceTitle}</h3>
                      <p>{t.ipv4ForceDesc}</p>
                    </div>
                    {/* ipv4Only undefined ise default true kabul ediyoruz */}
                    <Toggle checked={config.ipv4Only !== false} onChange={(v) => updateConfig('ipv4Only', v)} />
                  </div>

                  {/* YENİ: WinHTTP OYUN MODU TOGGLE'I */}
                  <div className="v2-item" style={{ padding: '1rem' }}>
                    <div className="v2-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
                       <Youtube size={20} />
                    </div>
                    <div className="v2-item-text">
                      <h3 style={{ color: '#93c5fd' }}>{t.winHttpForceTitle}</h3>
                      <p>{t.winHttpForceDesc}</p>
                    </div>
                    <Toggle checked={config.enableWinhttp !== false} onChange={(v) => updateConfig('enableWinhttp', v)} />
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
                <div className="v2-section-title">{t.sectionDns}</div>
                
                <div className="v2-card">
                  {/* Sistem Varsayılanı Toggle */}
                  <div className="v2-item">
                    <div className="v2-item-text">
                      <h3>{t.dnsSystemDefault}</h3>
                      <p>{t.dnsSystemDefaultDesc}</p>
                    </div>
                    <Toggle 
                      checked={config.selectedDns === 'system'} 
                      onChange={(v) => {
                        if (v) {
                          updateConfig('selectedDns', 'system');
                          updateConfig('dnsMode', 'manual');
                        } else {
                          updateConfig('selectedDns', 'cloudflare'); // Varsayılan bir değere geç
                        }
                      }} 
                    />
                  </div>

                  <div className="v2-divider" />

                  <div style={{ opacity: config.selectedDns === 'system' ? 0.4 : 1, pointerEvents: config.selectedDns === 'system' ? 'none' : 'auto', transition: 'all 0.3s ease' }}>
                    <div className="v2-item">
                      <div className="v2-item-text">
                        <h3>{t.dnsAutoSelect}</h3>
                        <p>{t.dnsAutoSelectDesc}</p>
                      </div>
                      <Toggle 
                        checked={config.dnsMode === 'auto' && config.selectedDns !== 'system'} 
                        onChange={(v) => {
                          updateConfig('dnsMode', v ? 'auto' : 'manual');
                          if (v) checkAllLatencies(true); 
                        }} 
                      />
                    </div>

                    <div style={{ padding: '0 16px 16px 16px' }}>
                      <button 
                        onClick={checkAllLatencies} 
                        disabled={isChecking}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          background: isChecking ? 'rgba(59, 130, 246, 0.05)' : 'rgba(59, 130, 246, 0.1)',
                          color: isChecking ? '#93c5fd' : '#60a5fa',
                          border: '1px solid rgba(59, 130, 246, 0.2)',
                          padding: '10px 0',
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          cursor: isChecking ? 'wait' : 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => { if(!isChecking) e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)' }}
                        onMouseLeave={(e) => { if(!isChecking) e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)' }}
                      >
                        {isChecking ? <RotateCw size={16} className="spin" /> : <Activity size={16} />}
                        {isChecking ? t.dnsChecking : t.dnsCheckSpeed}
                      </button>
                    </div>

                    <div className="v2-divider" style={{ margin: 0 }} />

                    <div className="v2-dns-list">
                      <AnimatePresence>
                        {sortedProviders.filter(p => p.id !== 'system').map((p) => {
                          const isSelected = config.selectedDns === p.id;
                          const isAutoMode = config.dnsMode === 'auto';
                          const isDisabled = isAutoMode;
                          return (
                            <motion.div 
                              layout
                              key={p.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ 
                                opacity: isDisabled 
                                  ? (isSelected ? 1 : 0.5) 
                                  : (!isSelected ? 0.45 : 1),
                                y: 0 
                              }}
                              whileHover={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                              className={`v2-dns-item ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                              onClick={() => {
                                if (isDisabled) return;
                                updateConfig('selectedDns', p.id);
                              }}
                            >
                              <div className={`v2-radio ${isSelected ? 'on' : ''}`}>
                                {isSelected && <div className="v2-radio-dot" />}
                              </div>
                              <div className="v2-dns-info">
                                <span className="v2-dns-name">{p.name}</span>
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
                      src="/consolaktif-logo.jpg" 
                      alt="ConsolAktif"
                      className="v2-avatar-img"
                    />
                    <div className="v2-dev-details">
                      <span className="v2-dev-name">ConsolAktif</span>
                      <span className="v2-dev-role">{t.devRole}</span>
                    </div>
                  </div>
                  <div className="v2-dev-actions">
                     <button className="v2-btn youtube" onClick={() => openUrl(URLS.youtube)}>
                       <Youtube size={18} /> {t.devSubscribe}
                     </button>
                     <button className="v2-btn coffee" onClick={() => openUrl(URLS.patreon)}>
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

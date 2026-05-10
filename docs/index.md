# BypaxDPI Dokümantasyon

BypaxDPI, yerel ağ problemleri eğitimi, soket debugging ve erişilebilirlik laboratuvarı (Bypass algoritmalarını simüle etme) amaçlı yazılmıştır.

## İçerik

| Belge | Açıklama |
|-------|----------|
| [Kullanıcı Kılavuzu](./user-guide.md) | Kurulum, ayarlar, ISP profilleri, LAN paylaşımı |
| [Mimari](./architecture.md) | Sistem mimarisi, katman yapısı, bileşen ilişkileri |
| [Güvenlik Modeli](./security.md) | İzin mimarisi, sandbox, CSP, güvenlik katmanları |
| [Sorun Giderme](./troubleshooting.md) | Hata kodları, kurtarma prosedürleri, SSS |
| [Geliştirici Kılavuzu](./developer-guide.md) | Build süreci, proje yapısı, katkı rehberi |
| [Build & Dağıtım](./build.md) | Derleme adımları, paketleme, sürüm yönetimi |
| [API Referansı](./api-reference.md) | Tauri komutları, registry anahtarları, PAC formatı |
| [i18n Kılavuzu](./i18n.md) | Çeviri sistemi, yeni dil ekleme |
| [Issue Rehberi](./issue-guide.md) | Hata bildirimi, özellik isteği, etiketler, şablonlar |

## Hızlı Başlangıç

```
Uygulama Katmanları:
  React Frontend  →  Tauri IPC  →  Rust Backend  →  Go SpoofDPI
```

Detaylar için [Mimari](./architecture.md) belgesine bakın.

## Sürüm

- **Uygulama:** 1.0.0
- **SpoofDPI:** 1.2.1
- **Tauri:** 2.10.0
- **Lisans:** MIT

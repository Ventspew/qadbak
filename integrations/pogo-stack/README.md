# PoGo Stack

Self-hosted Pokemon GO infrastructure for **Qadbak** VPS: account pool, dashboard, mapping stack, **physical Android** (Cosmog) and **jailbroken iPhone** (Exeggcute/GC) workers, plus optional **deviceless** Redroid.

Inspired by [PGPool](https://github.com/codename-art/PGPool), [UnownHash](https://github.com/UnownHash), [ReactMap](https://github.com/WatWowMap/ReactMap), [Cosmog deviceless](https://sylvie.fyi/cosmog/redroid.html).

## Quick start (full stack on one Qadbak server)

```bash
sudo bash scripts/setup-qadbak-host.sh   # ARM64 VPS: kernel modules + adb
cp .env.example .env && nano .env
# Place cosmog.apk in services/cosmog/apk/

# First live workers: mapping + phones
bash scripts/deploy-on-qadbak.sh --with-android --with-ios
bash scripts/provision-android.sh --device-id pixel-1
bash scripts/provision-ios.sh --usb --device-id iphone-1

# Or everything including Redroid:
# bash scripts/deploy-on-qadbak.sh --full
```

| Mode | Command |
|------|---------|
| Core only | `bash scripts/deploy-on-qadbak.sh` |
| + Mapping | `bash scripts/deploy-on-qadbak.sh --with-mapping` |
| + Physical Android | `bash scripts/deploy-on-qadbak.sh --with-android` |
| + Jailbroken iPhone | `bash scripts/deploy-on-qadbak.sh --with-ios` |
| + Deviceless workers | `bash scripts/deploy-on-qadbak.sh --with-workers` |
| **Everything** | `bash scripts/deploy-on-qadbak.sh --full` |

Docs: [Qadbak deploy](docs/QADBAK-DEPLOY.md) · [Physical Android](docs/ANDROID.md) · [Jailbroken iOS](docs/IOS.md) · [Deviceless workers](docs/DEVICELESS.md)

Dashboard login (set in `.env`): `DASHBOARD_USER` / `DASHBOARD_PASSWORD`. The site, map, Koji, Rotom, and phone controls all require this session.

## Architecture

```
Qadbak VPS
├── Dashboard + Account API + MariaDB
├── Golbat ← Rotom ← Dragonite
├── ReactMap, Koji, PoracleNG
├── Physical Android (USB/Wi-Fi ADB) → Cosmog → Rotom :7070
├── Jailbroken iPhone (SSH) → Exeggcute/GC → Rotom :7070
└── Optional: Redroid × N → Cosmog (worker-agent) + Houndour
```

## Services

| Service | Profile | Description |
|---------|---------|-------------|
| `account-api`, `dashboard` | core | Account pool + admin UI |
| `golbat`, `rotom`, `reactmap`, `koji`, `poracle`, `dragonite` | mapping / full | Scanner stack |
| `android-agent` | android / full | Optional wireless-ADB keep-alive for phones |
| `ios-agent` | ios / full | Optional SSH keep-alive for jailbroken iPhones |
| `redroid-*`, `worker-agent`, `houndour` | workers / full | Virtual Android + Cosmog |

## Host requirements (deviceless)

- **ARM64 VPS** (Ampere) for Redroid/Cosmog
- Ubuntu 22.04/24.04 with `binder_linux` + `ashmem_linux`
- 16 GB+ RAM for 2 Redroid containers
- Cosmog license + APK (see `services/cosmog/apk/README.md`)

x86 Qadbak VPS: core + mapping work; workers need ARM64.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/setup-qadbak-host.sh` | Host prep (kernel modules, adb) |
| `scripts/deploy-on-qadbak.sh` | Deploy stack (`--full`) |
| `scripts/provision-android.sh` | Install Cosmog on a USB/Wi-Fi Android device |
| `scripts/provision-ios.sh` | Push Exeggcute/GC config to a jailbroken iPhone |
| `scripts/render-config.sh` | Render Golbat + Rotom + Cosmog + Exeggcute configs |
| `scripts/install-dragonite.sh` | Dragonite binary helper |

## License

MIT — own code. Third-party APKs/binaries retain their licenses.

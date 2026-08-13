# PoGo Stack

Self-hosted Pokemon GO infrastructure for **Qadbak** VPS: account pool, dashboard, mapping stack, and **deviceless workers** (Redroid + Cosmog — no physical Android phones).

Inspired by [PGPool](https://github.com/codename-art/PGPool), [UnownHash](https://github.com/UnownHash), [ReactMap](https://github.com/WatWowMap/ReactMap), [Cosmog deviceless](https://sylvie.fyi/cosmog/redroid.html).

## Quick start (full stack on one Qadbak server)

```bash
sudo bash scripts/setup-qadbak-host.sh   # ARM64 VPS: kernel modules + adb
cp .env.example .env && nano .env
# Place cosmog.apk in services/cosmog/apk/

bash scripts/deploy-on-qadbak.sh --full
```

| Mode | Command |
|------|---------|
| Core only | `bash scripts/deploy-on-qadbak.sh` |
| + Mapping | `bash scripts/deploy-on-qadbak.sh --with-mapping` |
| + Deviceless workers | `bash scripts/deploy-on-qadbak.sh --with-workers` |
| **Everything** | `bash scripts/deploy-on-qadbak.sh --full` |

Docs: [Qadbak deploy](docs/QADBAK-DEPLOY.md) · [Deviceless workers](docs/DEVICELESS.md)

## Architecture

```
Qadbak VPS (ARM64 recommended)
├── Dashboard + Account API + MariaDB
├── Golbat ← Rotom ← Dragonite
├── ReactMap, Koji, PoracleNG
└── Redroid × N → Cosmog (worker-agent) — no phones
         └── Houndour watchdog
```

## Services

| Service | Profile | Description |
|---------|---------|-------------|
| `account-api`, `dashboard` | core | Account pool + admin UI |
| `golbat`, `rotom`, `reactmap`, `koji`, `poracle`, `dragonite` | mapping / full | Scanner stack |
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
| `scripts/render-config.sh` | Render Golbat + Cosmog configs |
| `scripts/install-dragonite.sh` | Dragonite binary helper |

## License

MIT — own code. Third-party APKs/binaries retain their licenses.

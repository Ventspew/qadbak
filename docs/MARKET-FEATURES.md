# Market competition features (phases 1–12)

Shipped on `main` for native VPS installs. Phases 1–8 have checklists in `docs/MARKET-PHASE-N.md`. Phases 9–12 are **Site tools** (customer UI — no phase labels).

## Overview

| Phase | Summary | Doc | Panel |
|-------|---------|-----|-------|
| **1** | Native production hardening, E2E matrix | [MARKET-PHASE-1.md](./MARKET-PHASE-1.md) | Health, Status, Domains |
| **2** | One-click app catalog | [MARKET-PHASE-2.md](./MARKET-PHASE-2.md) | App catalog, Domain → Apps |
| **3** | Node, Python, Docker runtimes | [MARKET-PHASE-3.md](./MARKET-PHASE-3.md) | Domain → Runtimes, PHP |
| **4** | Encrypted offsite backups | [MARKET-PHASE-4.md](./MARKET-PHASE-4.md) | Cloud, Backups offsite |
| **5** | Granular backup restore | [MARKET-PHASE-5.md](./MARKET-PHASE-5.md) | Backups archive wizard |
| **6** | Metrics + alerts | [MARKET-PHASE-6.md](./MARKET-PHASE-6.md) | Status, metrics 24h/7d/30d |
| **7** | Firewall, WAF, ClamAV | [MARKET-PHASE-7.md](./MARKET-PHASE-7.md) | Firewall, Domain security |
| **8** | REST API v1, integrations | [MARKET-PHASE-8.md](./MARKET-PHASE-8.md) | API keys, OpenAPI |
| **9–12** | Site tools + newsletter + demo | [PANEL-PHASES-9-12.md](./PANEL-PHASES-9-12.md), [DEMO.md](./DEMO.md) | Domain → Site tools, Mail → Newsletter, [demo.qadbak.com](https://demo.qadbak.com/login) |

The phase roadmap is **not** shown in the customer-facing panel (internal/docs and `scripts/run-market-phases-check.sh` only).

## Since v1.0

| Release | Highlights |
|---------|------------|
| **v1.2.0** | Discord + Telegram bots (per-domain + host operator), isolation, Admin Updates shows version/changelog |
| **v1.1.0** | Ubuntu LTS release upgrade from Admin → Updates (Premium) |
| **v1.0.0** | Debian 12, Ubuntu 26.04, panel-only Linux install |
| **v1.0.0** | Jellyfin app, domain media library, HTML5 quick player |

## Quick verify on a VPS

```bash
cd /opt/qadbak
sudo bash scripts/run-market-phases-check.sh   # all 8 phases
sudo bash scripts/run-market-phase1-check.sh   # phase 1 only
```

## Operator highlights

- **Linux support:** [LINUX-SUPPORT.md](./LINUX-SUPPORT.md) — Debian 12, Ubuntu 26.04, panel-only, [LTS upgrade](./LINUX-SUPPORT.md#ubuntu-lts-release-upgrade-panel)
- **Media:** [MEDIA-JELLYFIN.md](./MEDIA-JELLYFIN.md) — Jellyfin, library folder, HTML5 player
- **Live demo:** `https://demo.qadbak.com/login` — [DEMO.md](./DEMO.md) · enable with `sudo bash scripts/apply-demo-vhost.sh`
- **Marketing site:** `marketing-site/index.html` — redeploy via `npm run build` on panel host
- **Panel URLs:** `https://panel.<customer-domain>/login` — [CLOUDFLARE.md](./CLOUDFLARE.md)
- **After update:** `sudo bash scripts/fix-panel-now.sh`
- **API:** [api/openapi.yaml](./api/openapi.yaml) · [WHMCS](./integrations/WHMCS-INTEGRATION.md)

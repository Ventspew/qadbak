<div align="center">

# Qadbak

### Self-hosted control panel for Linux VPS hosting.

Manage domains, mail, DNS, TLS, databases, backups, and cron on your own server. Includes a native iOS app for iPhone and iPad. Optional Premium modules add reseller, webmail, and white-label features.

[![License](https://img.shields.io/badge/License-Panel%20use%20only-blue.svg)](LICENSE)
[![iOS app](https://img.shields.io/badge/iOS%20app-1.2.3-0A84FF?logo=apple&logoColor=white)](ios/README.md)
[![Release](https://img.shields.io/github/v/release/macdirtycow/qadbak?label=release)](https://github.com/macdirtycow/qadbak/releases)
[![Ubuntu](https://img.shields.io/badge/Ubuntu-22.04%20%7C%2024.04%20%7C%2026.04-E95420?logo=ubuntu&logoColor=white)](docs/LINUX-SUPPORT.md)
[![Debian](https://img.shields.io/badge/Debian-12-D70A53?logo=debian&logoColor=white)](docs/LINUX-SUPPORT.md)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js)](https://nextjs.org)
[![Premium from €2.50](https://img.shields.io/badge/Premium-from%20%E2%82%AC2.50-14b8a6)](https://qadbak.com/#pricing)
[![Made by Inveil](https://img.shields.io/badge/by-Inveil-94a3b8)](https://inveil.net)

[**Website**](https://qadbak.com) ·
[**Pricing**](https://qadbak.com/#pricing) ·
[**iOS app**](ios/README.md) ·
[**Buy a license**](https://license.inveil.dev/buy) ·
[**Check a license**](https://license.inveil.dev) ·
[**Docs**](docs/) ·
[**About the name**](docs/ABOUT-THE-NAME.md)

</div>

---

## What is Qadbak?

Qadbak is a self-hosted hosting control panel. Install it on a fresh **Ubuntu or Debian** VPS, sign in, and manage sites, mailboxes, DNS records, and databases from one UI. It separates administrator access from client access so each role sees only what it needs.

If you want a modern panel you can run yourself (with an optional native iOS app), Qadbak is built for that use case.

```bash
git clone https://github.com/macdirtycow/qadbak.git /opt/qadbak
cd /opt/qadbak
sudo bash install/qadbak-install.sh
```

Setup asks for the hostname, admin password, and Let's Encrypt email first, then mail hostname, public IP, and optional Premium/demo settings. Post-install verification runs automatically.

## Features

### Core panel

| Area | What you get |
|------|--------------|
| **Domains** | Sites, subdomains, aliases, redirects, reverse proxies. |
| **Mail** | Mailboxes, forwarding, SPF/DKIM/DMARC helpers, delivery logs. |
| **DNS** | BIND9 records + registrar checklist for clients. |
| **TLS** | Let's Encrypt with per-host renewal status. |
| **Databases** | MariaDB per domain, phpMyAdmin shortcut. |
| **Files & terminal** | File manager and shell as the **domain unix user**. |
| **PHP** | Version switching and per-user PHP-FPM pools. |
| **Backups** | Downloadable archives: files, **all mailboxes**, panel settings, DNS zone, certs, crontab. |
| **Operations** | Action journal, undo (mail/DNS), health checks, WordPress install flow. |
| **Cron** | Scheduled jobs with plain-language editor. |
| **Security** | ModSecurity WAF toggle, ClamAV scans, admin firewall UI. |
| **Runtimes** | Node, Python, Docker compose beside PHP-FPM per domain. |
| **Media** | Jellyfin one-click (Docker), per-domain media library folder, HTML5 quick player. |
| **Apps** | 25 one-click catalog installs into `public_html` (incl. Jellyfin). |
| **Backups+** | Offsite S3/B2/GCS, browse archive, restore single files or DB. |
| **Monitoring** | Metrics history, alert rules (email / Slack / Telegram). |
| **API v1** | Bearer keys with scopes - domains, mail, DNS, SSL, suspend, backups. |
| **Billing** | WHMCS module + Blesta starter in `integrations/`. |
| **Panel URLs** | `panel.<domain>` vhosts + Cloudflare Flexible/Full - [CLOUDFLARE.md](docs/CLOUDFLARE.md). |

### Premium (license key)

| Module | Description |
|--------|-------------|
| **Client portal & RBAC** | End customers manage only their domains. |
| **Panel vhost provisioning** | Separate panel URLs per reseller brand. |
| **Qmail** | Built-in IMAP mail in the panel and iOS app. |
| **White-label** | Logo, colours, product name. |
| **License admin** | View activations, move VPS, heartbeat status. |
| **Admin updates** | Pull/rebuild panel from the UI; **Ubuntu LTS release upgrade** (22→24→26). |
| **Offsite backups** | Encrypted cloud credentials + per-domain upload policy. |

Website: [qadbak.com](https://qadbak.com) · Market features: [docs/MARKET-FEATURES.md](docs/MARKET-FEATURES.md)

## iOS app (v1.2.3, TestFlight beta)

Native SwiftUI app for iPhone and iPad. Requires **iOS 17+**. Source in [`ios/`](ios/), build notes in [ios/README.md](ios/README.md).

There are **two ways** to use the app:

### Path 1: Your Qadbak panel (full hosting)

Point the app at your panel URL over **HTTPS**. Same Bearer auth as the mobile API ([docs/MOBILE-IOS-APP.md](docs/MOBILE-IOS-APP.md)). Login, TOTP, and refresh tokens use the iOS Keychain.

| Area | In the app |
|------|------------|
| **Domains** | List, add domain, health, logs |
| **DNS** | List, add, delete records |
| **Mail** | Mailboxes, create accounts |
| **Qmail** | INBOX, read, compose (Premium `webmail-ui`) |
| **SSL** | Certificates, Let's Encrypt renew |
| **Backups** | List, run now, download, save to iCloud Drive |
| **Files** | Browse `public_html`, view text, delete |
| **Terminal** | Domain shell and admin root shell (WebSocket) |
| **Admin** | Panel updates, server health widget |
| **Multi-server** | Save and switch panel URLs |
| **Widget** | Domain count and SSL alerts (Home Screen) |
| **Push** | APNs registration when configured on the panel |
| **Security** | Face ID / Touch ID lock, client RBAC when Premium |

Premium features (Qmail, client logins, etc.) follow the server license. The app reads `premiumActive` from `GET /api/mobile/v1/me`.

### Path 2: Linux agent (existing VPS)

For servers that already run **HestiaCP**, **Coolify**, **CasaOS**, or plain Linux on Debian 12 / Ubuntu 22.04 / 24.04:

1. In the app: **Servers → Add server → Linux server via SSH**
2. The app installs `qadbak-agent` (v0.5.0) and pairs over HTTPS on port **9443**
3. You get metrics, systemd services, Docker, logs, apt updates, reboot/shutdown
4. Optional: **link the detected panel** with a local API token (read-only lists of users, domains, or apps)

Panel API credentials stay on the server (`/var/lib/qadbak-agent/panel-link.json`). The app only stores the agent token.

| Panel | Link support | What you see |
|-------|--------------|--------------|
| HestiaCP | Yes | Users, domains, version |
| Coolify | Yes | Projects, applications |
| CasaOS | Yes | Installed apps |
| Plesk / DirectAdmin | Detected only | System ops via agent, no panel API yet |

Docs: [docs/ios/EXTERNAL_SERVERS.md](docs/ios/EXTERNAL_SERVERS.md), [docs/agent/PANEL-LINKING.md](docs/agent/PANEL-LINKING.md)

Rebuild bundled agent binaries after agent changes:

```bash
bash scripts/copy-agent-to-ios.sh
```

### Get the app

| Channel | How |
|---------|-----|
| **TestFlight** | Email **support@inveil.net** for an invite |
| **Xcode** | `open ios/Qadbak.xcodeproj`, set Development Team, run on device |
| **Unsigned IPA** | `bash ios/scripts/build-ipa.sh` → sign with ESign / Sideloadly |

App Store notes: [ios/docs/APP-STORE.md](ios/docs/APP-STORE.md). The iOS app has separate terms: [ios/LICENSE](ios/LICENSE).

## Pricing

| Plan | Price | Use it for |
|------|-------|------------|
| Pro · **1 month** | **€2.50/mo** | Trying things out (subscription) |
| Pro · 3 months | €7.45 | Short project |
| Pro · 6 months | €10.50 | Half-year of hosting |
| Pro · **1 year** ★ Most popular | **€20** | Annual usage |
| Pro · **3 years** | **€55** | Billed every 3 years (subscription) |

All plans cover **50 domains** on **1 VPS** with full Premium modules. Monthly
plans are **Stripe subscriptions** (renew until cancelled in Stripe). The panel
runs without a Premium key for single-admin use - Premium unlocks multi-tenant
client modules, RBAC, panel-vhost provisioning, per-user PHP-FPM isolation,
Qmail, and live admin updates.

> [Buy a license →](https://license.inveil.dev/buy) · [Check or refund an existing key →](https://license.inveil.dev) · [Refund policy](https://qadbak.com/refund)

## Quick comparison

|                                 | **Qadbak** | cPanel | Plesk | HestiaCP |
|---------------------------------|:----------:|:------:|:-----:|:--------:|
| Starting price / month          | **€2.50**  | ~€35   | ~€15  | Free     |
| 3-year subscription (€55)       | **€55**    |   ✗    |   ✗   | Free     |
| Modern web UI                   | ✅         | Legacy | Mixed | Functional |
| Native iOS app                | ✅ Panel + Linux agent | Apps   | Apps  | ✗        |
| Admin / client role split       | ✅ Native  | WHM    | ✅    | ✅       |
| Panel license (self-host)       | ✅ Panel use |   ✗    |   ✗   | GPL      |
| EU-based vendor (GDPR)          | 🇳🇱 NL   |  🇺🇸  | EU+US | EU       |
| Activation in <1 minute         | Email key  | License srv | License key | Install only |

## Quick start (local dev)

```bash
git clone https://github.com/macdirtycow/qadbak.git
cd qadbak
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

On first start `data/users.json` is created from `data/users.example.json`:

| User | Default password | Role |
|------|-----------------|------|
| `admin` | `changeme` | administrator |
| `client` | `changeme` | client (mock domain `example.com`) |

Hash your own password before sharing:

```bash
node scripts/hash-password.mjs your-password
```

## Install on a VPS

**Requirements (full stack):** Ubuntu 22.04/24.04/26.04 or Debian 12, root, DNS A-record, 1 GB+ RAM. **Panel-only:** any Linux with Node 20+ - see [docs/LINUX-SUPPORT.md](docs/LINUX-SUPPORT.md).

```bash
git clone https://github.com/macdirtycow/qadbak.git /opt/qadbak
cd /opt/qadbak
sudo bash install/qadbak-install.sh
```

The installer:
1. Installs nginx, Apache, MariaDB, Postfix, Dovecot, BIND, PHP-FPM, certbot.
2. Clones Qadbak to `/opt/qadbak`, runs `npm install && npm run build`.
3. Creates the system user `qadbak`, sets up pm2 + systemd.
4. Generates a `SESSION_SECRET`, writes `/opt/qadbak/.env.local`.
5. Asks for panel hostname, mail hostname, public IP, admin password, optional Premium license, optional demo client.
6. Optionally issues a Let's Encrypt certificate for the panel host.
7. Runs `post-install-verify.sh` (preflight + API + optional Playwright E2E).

When it's done, open `https://your-panel-host/login`. Optional: `sudo bash scripts/configure-ufw-qadbak.sh` for UFW.

**iOS app:** Qadbak panel URL for full hosting, or Linux agent for existing servers. See [iOS app](#ios-app-v123-testflight-beta) and [docs/MOBILE-IOS-APP.md](docs/MOBILE-IOS-APP.md).

### Panel-only (any Linux + Node 20+)

```bash
sudo bash install/qadbak-install-panel.sh
```

See [docs/LINUX-SUPPORT.md](docs/LINUX-SUPPORT.md#panel-only).

### Resume a partial install

```bash
sudo bash /opt/qadbak/install/qadbak-install-resume.sh
```

### Update on the server

```bash
cd /opt/qadbak && sudo bash scripts/update.sh
```

Premium admins can also update from **Admin → Updates** (Qadbak pull/rebuild, apt packages, and Ubuntu LTS release upgrade).

Panel unreachable after update (Cloudflare **520** or `panel.<domain>`):

```bash
sudo bash /opt/qadbak/scripts/fix-panel-now.sh
sudo bash /opt/qadbak/scripts/diagnose-panel-access.sh panel.example.com
```

That's the whole update flow for all customers. Premium modules in this repo
are gated by `isPremiumFeatureEnabled()` against the license server's
feature list - there is no encrypted artifact to download and no
second activation step. `git pull && npm run build && pm2 restart` is
equivalent under the hood.

### Bought a Premium license on an existing install?

One-shot pull + rebuild + activate:

```bash
sudo bash /opt/qadbak/scripts/buy-premium.sh QAD-XXXX-YYYY-ZZZZ-WWWW
```

### Uninstall

```bash
sudo bash /opt/qadbak/install/qadbak-uninstall.sh           # safe default
sudo bash /opt/qadbak/install/qadbak-uninstall.sh --help    # all flags
sudo bash /opt/qadbak/install/qadbak-uninstall.sh --dry-run # preview, no changes
```

Defaults are conservative - only the Qadbak panel is removed. Use
`--remove-stack` / `--remove-customers` for a full wipe (test VPS only).

## Architecture

```mermaid
flowchart LR
    B[Browser] -->|"HTTPS"| N[nginx]
    I[iOS app] -->|"HTTPS Bearer"| Q
    I -->|"HTTPS agent JWT"| A1[qadbak-agent]
    N -->|"panel host"| Q[Qadbak Next.js]
    N -->|"customer domain"| A[Apache + PHP-FPM]
    A1 -->|"local API"| P2[Hestia / Coolify / CasaOS]
    Q --> P["Native provisioner"]
    P --> S["nginx Apache MariaDB Postfix Dovecot BIND"]
    Q -.-> L[("license.inveil.dev")]
```

- **Auth:** JWT (httpOnly cookie), users in `data/users.json`.
- **RBAC:** `src/lib/rbac.ts` + `src/lib/features.ts`.
- **Domains:** `data/native-domains.json` + host helpers.
- **Audit log:** `data/audit.log`.
- **Self-host first:** all sites, mail and DBs live on YOUR VPS. The only
  outbound call is a small license heartbeat - see [Privacy](https://qadbak.com/privacy).

## Project layout

```
src/app/          Next.js routes (UI + API)
src/lib/          provisioner, auth, RBAC, domain helpers
src/components/   UI per domain / admin
scripts/          install, native helpers, update, tests
install/          qadbak-install.sh, qadbak-uninstall.sh
deploy/           nginx examples
ios/              SwiftUI app, widget, bundled Linux agent binaries
agent/            qadbak-agent (Go) for external Linux servers
docs/             guides and checklists
data/             users.example.json (template)
marketing-site/   static HTML for qadbak.com + legal pages
```

## Documentation

| File | Contents |
|------|----------|
| [docs/MOBILE-IOS-APP.md](docs/MOBILE-IOS-APP.md) | Mobile API, Bearer auth, push, widgets, iCloud backups |
| [docs/ios/EXTERNAL_SERVERS.md](docs/ios/EXTERNAL_SERVERS.md) | Linux agent onboarding, SSH pairing, capabilities |
| [docs/agent/PANEL-LINKING.md](docs/agent/PANEL-LINKING.md) | HestiaCP, Coolify, CasaOS read-only links |
| [agent/README.md](agent/README.md) | Agent build, install, API overview |
| [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) | Cloudflare 502/520/523 + panel SSL |
| [ios/README.md](ios/README.md) | Xcode setup, IPA build, TestFlight, feature list |
| [ios/docs/APP-STORE.md](ios/docs/APP-STORE.md) | App Store / TestFlight submission |
| [docs/LINUX-SUPPORT.md](docs/LINUX-SUPPORT.md) | Ubuntu/Debian native + panel-only + LTS upgrade |
| [docs/MEDIA-JELLYFIN.md](docs/MEDIA-JELLYFIN.md) | Jellyfin, media library, HTML5 player |
| [docs/QADBAK-NATIVE-INSTALL.md](docs/QADBAK-NATIVE-INSTALL.md) | Native VPS install in depth |
| [docs/V1-TEST-SERVER.md](docs/V1-TEST-SERVER.md) | Step-by-step test server |
| [docs/UBUNTU-24-LTS.md](docs/UBUNTU-24-LTS.md) | Ubuntu version notes |
| [docs/PHASE-8-INDEPENDENT.md](docs/PHASE-8-INDEPENDENT.md) | Independent native mode |
| [docs/E2E-CHECKLIST.md](docs/E2E-CHECKLIST.md) | Sign-off checklist |
| [docs/PHASES.md](docs/PHASES.md) | Feature phases |
| [docs/MARKET-FEATURES.md](docs/MARKET-FEATURES.md) | Market competition phases 1–8 |
| [docs/integrations/WHMCS-INTEGRATION.md](docs/integrations/WHMCS-INTEGRATION.md) | WHMCS + API v1 |
| [docs/api/openapi.yaml](docs/api/openapi.yaml) | REST API v1 OpenAPI |
| [docs/HOSTING-NGINX.md](docs/HOSTING-NGINX.md) | nginx + Apache for sites |
| [docs/TERMINAL-NATIVE.md](docs/TERMINAL-NATIVE.md) | In-panel terminal |
| [docs/MIGRATE-FROM-LEGACY-HOSTING.md](docs/MIGRATE-FROM-LEGACY-HOSTING.md) | Migrate from another panel |
| [docs/ABOUT-THE-NAME.md](docs/ABOUT-THE-NAME.md) | Why "Qadbak" |

## Common commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server (mocked native ops) |
| `npm run build` | Production Next.js build |
| `npm run test-api` | API + domain-registry sanity check |
| `npm run preflight` | VPS checks (env, ports, services) |
| `bash scripts/update.sh` | Pull + sudoers + build + restart pm2 (standard VPS update) |
| `bash scripts/update-qadbak.sh` | Full update (hosting stack, E2E, repairs) |
| `sudo bash install/qadbak-install.sh` | Fresh VPS install |
| `sudo bash install/qadbak-uninstall.sh` | Remove the panel cleanly |

## Marketing site (qadbak.com)

Pricing, feature copy, and **live demo** CTAs live in `marketing-site/`. The panel serves them at `/` via
`npm run build` (runs `scripts/sync-landing-public.sh` for CSS/JS assets).

**Live demo:** [demo.qadbak.com](https://demo.qadbak.com/login) - enable on your VPS with
`sudo bash scripts/apply-demo-vhost.sh` ([docs/DEMO.md](docs/DEMO.md)).

**After changing prices or terms**, redeploy so qadbak.com updates:

```bash
cd /opt/qadbak && git pull && sudo -u qadbak npm run build
sudo bash scripts/pm2-restart-qadbak.sh
```

Static-only host (no Next.js): rebuild and upload the zip:

```bash
bash scripts/build-marketing-zip.sh   # dist/qadbak-site-upload.zip
```

Static pages included: landing, about, privacy, terms, refund. Checkout prices
always come from `license.inveil.dev/buy` (license-server repo).

## Contributing

External pull requests are accepted for bug fixes and documentation only - see
[CONTRIBUTING.md](CONTRIBUTING.md). New features are scoped through GitHub
issues first.

Security disclosures: please email **security@inveil.net** rather than opening
a public issue. See [SECURITY.md](.github/SECURITY.md).

## About the name

In 2009, [Qadbak Investments](https://en.wikipedia.org/wiki/Qadbak_Investments)
made headlines around Notts County and BMW Sauber F1 - later remembered as hype
without substance. This panel reuses the name for the **opposite**: working
code on **your** server (not affiliated with that entity). Full story:
[docs/ABOUT-THE-NAME.md](docs/ABOUT-THE-NAME.md) or `/about` inside the panel.

## License

**Qadbak Panel License** - panel use only. Copyright © 2026 MacDirtyCow /
Qadbak and Inveil.

You may install and run the panel on servers you control to manage hosting.
You may **not** redistribute, mirror, or republish the software as your own
product. Premium modules require a paid license key (heartbeat via
`license.inveil.dev`) - see [COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md).

The iOS companion app has separate terms: [ios/LICENSE](ios/LICENSE).

See [LICENSE](LICENSE), [COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md),
[NOTICE](NOTICE), and [Terms of Service](https://qadbak.com/terms).

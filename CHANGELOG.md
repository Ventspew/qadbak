# Changelog

All notable changes to Qadbak are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-18

### Added

- **Host Discord operator bot** — prefix commands (`!status`, `!ping`, …) plus slash commands, hosted from Server → Discord without a public `bot.*` page
- **Per-domain Discord Bot and Telegram Bot apps** — each customer uses their own Discord application or BotFather token at `bot.` / `tg.`
- **Minecraft Java** one-click app with Discord status commands
- **Admin → Updates** shows the installed version, origin version, and the latest changelog notes (not only git-behind count)

### Changed

- Host Discord invite and OAuth are admin-only; customer `bot.*` pages never reuse the host token
- Telegram `/start` polling starts reliably; BotFather command menu follows enabled tasks and refreshes after save
- Discord gateway retries without privileged intents if Message Content or Server Members is off in the Developer Portal
- Host scheduled posts run on the operator gateway; channel digest stays on the panel notify daemon (no double spam)

### Security

- Discord OAuth state is a signed JWT (`jose`) instead of a password-style HMAC that CodeQL flagged
- Host Discord credentials are refused on customer Discord/Minecraft installs
- Host DMs are panel subscribers only (customer subscriber lists are not merged in)

### Install

```bash
git clone https://github.com/macdirtycow/qadbak.git /opt/qadbak
cd /opt/qadbak
sudo bash install/qadbak-install.sh
```

Existing installs: Admin → Updates → Update Qadbak, or `sudo bash /opt/qadbak/scripts/update-qadbak.sh`.

## [1.1.0] - 2026-06-15

### Added

- **Ubuntu LTS release upgrade** in Admin → Updates — in-place upgrade 22.04→24.04 or 24.04→26.04 via `do-release-upgrade`, with preflight checks, live job log, and automatic stack repair + reboot
- `scripts/ubuntu-release-upgrade.sh` and `scripts/post-ubuntu-release-upgrade.sh`
- API route `/api/admin/updates/ubuntu-release`

## [1.0.0] - 2026-06-15

First stable release after 334 commits of active development.

### Highlights

- **Native hosting stack** — nginx, Apache, MariaDB, Postfix, Dovecot, BIND9, PHP-FPM, certbot on Ubuntu 22.04/24.04/26.04 and Debian 12
- **Panel-only install** — run the Next.js UI on any Linux with Node 20+ (mock demo or hybrid remote API)
- **Domain lifecycle** — sites, mail, DNS, TLS, databases, backups, cron, file manager, per-domain terminal
- **App store** — 24+ one-click catalog installs into `public_html`
- **Media server** — Jellyfin one-click + panel media library + HTML5 quick player
- **Operations** — action journal with undo, health checks, metrics history, alert rules
- **API v1** — bearer keys with scoped access for domains, mail, DNS, SSL, suspend, backups
- **Security** — ModSecurity WAF, ClamAV scans, fail2ban, rate limits, TOTP, defense-in-depth controls
- **Premium modules** — client portal, RBAC, webmail, white-label, license admin (gated by license key)
- **CI** — GitHub Actions build, E2E smoke, and Linux distro support checks

### Install

```bash
# Full native stack (Ubuntu / Debian)
git clone https://github.com/macdirtycow/qadbak.git /opt/qadbak
cd /opt/qadbak
sudo bash install/qadbak-install.sh

# Panel-only (any Linux + Node 20+)
sudo bash install/qadbak-install-panel.sh
```

See [docs/LINUX-SUPPORT.md](docs/LINUX-SUPPORT.md) and [docs/QADBAK-NATIVE-INSTALL.md](docs/QADBAK-NATIVE-INSTALL.md).

[1.2.0]: https://github.com/macdirtycow/qadbak/releases/tag/v1.2.0
[1.1.0]: https://github.com/macdirtycow/qadbak/releases/tag/v1.1.0
[1.0.0]: https://github.com/macdirtycow/qadbak/releases/tag/v1.0.0

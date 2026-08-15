# PoGo Stack in Qadbak

Bundled under `integrations/pogo-stack/`. Installed via **Admin → Apps → PoGo Stack → Install**.

## One-click install

1. Open **Admin → Apps**
2. Click **PoGo Stack** (⚡)
3. Choose domain, subdomain (`pogo`), mode (`phones` — mapping + Android Cosmog + jailbroken iPhone)
4. Install — Qadbak provisions Docker, nginx HTTPS proxy, and starts containers

Dashboard login is `DASHBOARD_USER` / `DASHBOARD_PASSWORD` in `/opt/qadbak/integrations/pogo-stack/.env` (shown after install).

## iPhone workers

Jailbroken iPhones run Exeggcute/GC against the same Rotom as Android (`ws://SERVER_PUBLIC_IP:7070`). After install:

1. Set `EXEGGCUTE_API_KEY` in `.env`
2. Optional: drop `gc.deb` in `integrations/pogo-stack/services/exeggcute/debs/`
3. `bash scripts/provision-ios.sh --usb --device-id iphone-1` (or `--host <lan-ip>`)

See [integrations/pogo-stack/docs/IOS.md](../integrations/pogo-stack/docs/IOS.md).

## Updates

When `data/pogo-stack.json` exists (installed once), **`scripts/update-qadbak.sh`** automatically refreshes PoGo containers after each panel git sync.

Manual refresh:

```bash
sudo bash /opt/qadbak/scripts/lib/pogo-stack-update.sh
```

## Files

| Path | Role |
|------|------|
| `integrations/pogo-stack/` | Docker stack source |
| `scripts/lib/provision-pogo-stack.mjs` | Install/status/update provisioning |
| `src/lib/apps/templates/pogo-stack.ts` | App store template |
| `data/pogo-stack.json` | Install state (created on first install) |

Physical Android: [integrations/pogo-stack/docs/ANDROID.md](../integrations/pogo-stack/docs/ANDROID.md). Deviceless Redroid: [integrations/pogo-stack/docs/DEVICELESS.md](../integrations/pogo-stack/docs/DEVICELESS.md).

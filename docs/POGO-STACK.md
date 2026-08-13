# PoGo Stack in Qadbak

Bundled under `integrations/pogo-stack/`. Installed via **Admin → Apps → PoGo Stack → Install**.

## One-click install

1. Open **Admin → Apps**
2. Click **PoGo Stack** (⚡)
3. Choose domain, subdomain (`pogo`), mode (`full` recommended on ARM64)
4. Install — Qadbak provisions Docker, nginx HTTPS proxy, and starts containers

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

See [integrations/pogo-stack/docs/DEVICELESS.md](./pogo-stack/docs/DEVICELESS.md) for worker setup.

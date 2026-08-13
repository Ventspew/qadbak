# Deviceless on one x86 Contabo (hard-try path)

Goal: run scanning **on this VPS only** — no second VPS, no phones.

## What we will not do

We **do not** fork / recompile Pokémon GO or Cosmog into “x86 native apps”:

- PoGo is Niantic proprietary (no source, ToS forbids modified clients)
- Cosmog is a third-party closed release (license + their APKs)

The workable path is: **x86 Redroid (Android VM) + ARM APKs** (translation / best-effort), same Cosmog you already use.

## Stack on one machine

```text
Dashboard accounts
       ↓ sync CSV
   Dragonite  →  Rotom  →  Cosmog-in-Redroid  →  Golbat  →  ReactMap
```

## Checklist (do in order)

### A. Host prep
```bash
sudo bash /opt/qadbak/integrations/pogo-stack/scripts/setup-qadbak-host.sh
# If binder missing: reboot after linux-modules-extra install
lsmod | grep binder
```

### B. Mapping + Dragonite
```bash
cd /opt/qadbak/integrations/pogo-stack
bash scripts/repair-pogo-mapping.sh
bash scripts/install-dragonite.sh          # pulls official GHCR image + renders config
bash scripts/sync-accounts-to-dragonite.sh
docker compose --profile mapping --profile workers up -d dragonite rotom golbat
```

Draw geofences/routes in Koji (`https://koji.inveil.net/`).

### C. Cosmog materials (required)
Put in `services/cosmog/apk/`:
- `cosmog.apk` (Cosmog Discord, licensed)
- `pogo.apk` (matching PoGo **arm64-v8a** build Cosmog expects)

Set in `.env`:
```bash
COSMOG_TOKEN=...
ROTOM_SECRET=...          # must match Rotom
SERVER_PUBLIC_IP=<Contabo public IPv4>
REDROID_IMAGE=redroid/redroid:11.0.0-latest
REDROID_INSTANCES=1       # start with 1 on low RAM
COSMOG_WORKERS_PER_CONTAINER=8
```

### D. Start workers (hard try)
```bash
bash scripts/render-config.sh
sudo bash scripts/repair-pogo-workers.sh
```

Watch:
```bash
docker compose --profile workers ps
docker compose logs -f worker-agent redroid-1
adb connect 127.0.0.1:5555
adb -s 127.0.0.1:5555 shell getprop ro.product.cpu.abi
adb -s 127.0.0.1:5555 shell pm list packages | grep -E 'cosmog|niantic|pokemon'
```

## Success signals

| Check | Good |
|-------|------|
| Redroid up | `docker compose ps redroid-1` healthy/running |
| ADB | `adb devices` shows `127.0.0.1:5555` |
| APKs | packages installed (not INSTALL_FAILED_NO_MATCHING_ABIS) |
| Cosmog | activity starts; Rotom shows devices |
| Golbat | new pokemon/fort rows |
| ReactMap | spawns appear on `https://map.inveil.net/` |

## If APK install fails with ABI / architecture

Redroid amd64 rejected ARM APK → translation missing in that image.

Try (one at a time):
1. Confirm `pogo.apk` / `cosmog.apk` are the builds Cosmog docs list for your version
2. Keep `REDROID_IMAGE=redroid/redroid:11.0.0-latest` (official x86)
3. Lower workers (`COSMOG_WORKERS_PER_CONTAINER=4`) and **one** Redroid to save RAM
4. Re-run `repair-pogo-workers.sh` after each change

If ABI errors persist after several image/config tries, the next *still single-server* upgrade is **move this stack to one ARM64 VPS** — not “write our own PoGo”.

## Play Integrity later

`use_local_safetynet: false` is already set so Cosmog can use remote attestation.  
If logins die on integrity only, that’s a separate problem (solver) — not a reason to stop the Redroid path early.

## One-liner status

```bash
sudo bash /opt/qadbak/integrations/pogo-stack/scripts/repair-pogo-workers.sh --status
```

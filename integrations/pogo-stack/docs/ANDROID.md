# Physical Android workers

Connect a real phone or Android TV box to Rotom with **Cosmog**. This is the fastest way to run a live worker without Redroid.

Physical devices that pass Play Integrity should set `use_local_safetynet: true` (already the default in `config/cosmog/android.json.template`).

## What you need

| Item | Notes |
|------|--------|
| Mapping stack | `bash scripts/deploy-on-qadbak.sh --with-mapping` (Rotom + Dragonite + Golbat) |
| Cosmog APK | `services/cosmog/apk/cosmog.apk` from Cosmog Discord `#apk-releases` |
| Klefki token | `COSMOG_TOKEN` in `.env` |
| Rotom secret | `ROTOM_SECRET` in `.env` — must match Cosmog and Dragonite |
| Reachable Rotom | Phone must reach `ws://SERVER_PUBLIC_IP:7070` |
| Magisk | Hide Magisk from Pokémon GO / Cosmog workers (scripts in Cosmog Discord) |
| Pokémon GO | Play Store install is preferred on a physical device |

Android 8.1+ (`armeabi-v7a` or `arm64-v8a`). Root/Magisk is required for Cosmog.

## 1. Point the phone at Rotom

On the **host that runs Docker**, set a LAN or public IP the phone can actually reach. `127.0.0.1` will not work from a phone.

```bash
# .env
SERVER_PUBLIC_IP=192.168.1.20          # or your VPS public IP
ROTOM_PUBLIC_WS=ws://192.168.1.20:7070
ROTOM_SECRET=change-me-rotom-secret
COSMOG_TOKEN=your-klefki-token
ANDROID_WORKERS_PER_DEVICE=8
```

Open **TCP 7070** toward the phone (same Wi-Fi, or a public/firewall rule on the VPS). Port 7071 (Dragonite) stays localhost-only.

```bash
bash scripts/render-config.sh
bash scripts/deploy-on-qadbak.sh --with-mapping
```

Optional keep-alive agent (wireless ADB from the server):

```bash
docker compose --profile mapping --profile android up -d
```

## 2. Enable ADB on the phone

1. Settings → About → tap **Build number** 7 times
2. Developer options → **USB debugging**
3. Plug in USB, accept the RSA fingerprint prompt
4. Confirm:

```bash
adb devices
# ABCDEF123    device
```

macOS: `brew install android-platform-tools`

Wireless (same LAN):

```bash
adb tcpip 5555
adb connect 192.168.1.42:5555
```

## 3. Provision Cosmog

From this repo (Mac, Linux, or the VPS — wherever `adb devices` shows the phone):

```bash
bash scripts/provision-android.sh --device-id pixel-1 --workers 8
```

Wireless:

```bash
bash scripts/provision-android.sh --connect 192.168.1.42:5555 --device-id atv-1
```

The script installs Cosmog, writes `/data/local/tmp/cosmog.json`, and launches the app.

Libraries (if you extracted them with the Cosmog Discord tool):

```
services/cosmog/apk/libs/   →   /data/data/com.sy1vi3.cosmog/files/
```

## 4. Confirm the worker

1. Dashboard → **Android devices** (online + worker counts)
2. Rotom UI: `http://127.0.0.1:7072` or dashboard link **Rotom**
3. Add PTC/Google accounts in the dashboard so Dragonite can log workers in

Cosmog talks **outbound** to Rotom. The phone does not need a public IP.

## Magisk / Play Integrity

On a real device:

- Install Magisk; deny/hide it from Pokémon GO and Cosmog worker processes (Cosmog Discord has the current hide script)
- Keep `use_local_safetynet: true`
- Prefer Play Store Pokémon GO over a sideloaded `pogo.apk`

Cheap ATVs are also valid workers; the same provision script applies.

## Wireless keep-alive from the VPS

If the server can ADB to the phone (LAN or VPN), set:

```bash
# .env
ANDROID_DEVICES=pixel-1@192.168.1.42:5555
ANDROID_DEVICE_IDS=pixel-1
```

```bash
bash scripts/render-config.sh
docker compose --profile android up -d android-agent
```

USB-only phones do not need `android-agent` — `provision-android.sh` is enough.

## Troubleshooting

```bash
adb devices
adb -s SERIAL shell cat /data/local/tmp/cosmog.json
docker logs pogo-stack-rotom-1
curl -sS -H "X-Rotom-Secret: $ROTOM_SECRET" http://127.0.0.1:7072/api/device
```

| Symptom | Likely cause |
|---------|----------------|
| Device never appears in Rotom | Phone cannot reach `SERVER_PUBLIC_IP:7070`; Cosmog token/secret mismatch |
| Connected but 0 workers | Magisk hide / missing native libs / PoGo not installed |
| Play Integrity failures | Use a physical device with `use_local_safetynet: true`, not Redroid |
| `adb devices` empty | USB cable is charge-only, or RSA prompt not accepted |

## Related

- [Jailbroken iOS / Exeggcute](./IOS.md)
- [Deviceless / Redroid](./DEVICELESS.md) — virtual Android on a VPS
- [Qadbak deploy](./QADBAK-DEPLOY.md)
- [Cosmog config](https://sylvie.fyi/cosmog/config.html)
- [Cosmog install](https://sylvie.fyi/cosmog/installation.html)

# Jailbroken iOS workers (Exeggcute / GC)

Jailbroken iPhones run **Exeggcute** (codename GC) and connect to the **same Rotom** as Android Cosmog. Dragonite does not care which MITM produced a worker — both platforms share one pool.

## What you need

| Item | Notes |
|------|--------|
| Mapping stack | Same Rotom as Android (`--with-mapping` / `--with-android` / `--with-ios`) |
| Jailbroken iPhone | Dopamine / palera1n / equivalent, with **OpenSSH** |
| Exeggcute/GC | `.deb` from the Exeggcute Discord, or Sileo repo |
| `EXEGGCUTE_API_KEY` | In `.env` |
| `ROTOM_SECRET` | Must match Android Cosmog and Dragonite |
| Reachable Rotom | Phone must reach `ws://SERVER_PUBLIC_IP:7070` |

Do not use Cosmog on iOS — Cosmog is Android-only.

## 1. Same Rotom URL as Android

```bash
# .env
SERVER_PUBLIC_IP=192.168.1.20
ROTOM_PUBLIC_WS=ws://192.168.1.20:7070
ROTOM_SECRET=change-me-rotom-secret
EXEGGCUTE_API_KEY=your-exeggcute-key
IOS_WORKERS_PER_DEVICE=4
```

TCP **7070** must be reachable from the iPhone (same Wi-Fi, or VPS firewall). Android and iOS both use this port.

```bash
bash scripts/render-config.sh
bash scripts/deploy-on-qadbak.sh --with-ios
```

You can run Android and iOS together:

```bash
bash scripts/deploy-on-qadbak.sh --with-android --with-ios
```

## 2. SSH onto the phone

Install OpenSSH from Sileo. Default user/password is `root` / `alpine` — **change that**.

**USB (Mac):**

```bash
brew install libimobiledevice hudochenkov/sshpass/sshpass
iproxy 2222 22          # palera1n USB is often: iproxy 2222 44
ssh -p 2222 root@127.0.0.1
```

**Wi-Fi:** Settings → Wi-Fi → (i) → IP address, then `ssh root@192.168.1.50`.

## 3. Provision Exeggcute

Optional files (not git-tracked):

```
services/exeggcute/debs/gc.deb
services/exeggcute/ipa/pogo.ipa
```

USB:

```bash
bash scripts/provision-ios.sh --usb --device-id iphone-1 --workers 4
```

LAN:

```bash
bash scripts/provision-ios.sh --host 192.168.1.50 --device-id iphone-1
```

The script writes `/var/mobile/Application Support/GoCheats/config.json` (and the rootless `/var/jb/...` copy when that jailbreak layout exists), then resprings.

## 4. Confirm both platforms

Dashboard → **Devices** lists Android and iOS in one table. Rotom UI (`http://127.0.0.1:7072`) shows the same pool.

Unique `device_id` / `device_name` values are required. Do not reuse `iphone-1` on two phones.

## Wireless keep-alive from the VPS

If the server can SSH to the phone:

```bash
# .env
IOS_DEVICES=iphone-1@192.168.1.50:22
IOS_DEVICE_IDS=iphone-1
IOS_SSH_USER=root
# Prefer a key mounted into the agent; password is a last resort:
# IOS_SSH_PASSWORD=...
```

```bash
bash scripts/render-config.sh
docker compose --profile ios up -d ios-agent
```

USB-only phones do not need `ios-agent`.

## Troubleshooting

```bash
ssh -p 2222 root@127.0.0.1 'cat "/var/mobile/Application Support/GoCheats/config.json"'
curl -sS -H "X-Rotom-Secret: $ROTOM_SECRET" http://127.0.0.1:7072/api/device
```

| Symptom | Likely cause |
|---------|----------------|
| Device never appears | Phone cannot reach `:7070`; API key / Rotom secret mismatch |
| Connected but 0 workers | GC tweak not loaded; Pokémon GO missing; tweak not resprung |
| SSH connection refused | OpenSSH not installed, or palera1n USB is port **44** (`--device-port 44`) |
| Android online, iOS not | iOS still pointing at `127.0.0.1` instead of `ROTOM_PUBLIC_WS` |

## Related

- [Physical Android / Cosmog](./ANDROID.md)
- [Exeggcute docs](https://jorgschulze73.github.io/gc-docs/)
- [dmon](https://github.com/clburlison/dmon) — optional keep-alive tweak on the phone itself

# Deviceless workers on Qadbak (no physical Android phones)

Run the **complete** PoGo stack on a single Qadbak VPS using **Redroid** (virtual Android in Docker) and **Cosmog** (MITM worker).

For a **physical phone or ATV** instead, see [ANDROID.md](./ANDROID.md).

## Requirements

| Requirement | Details |
|-------------|---------|
| **VPS architecture** | **x86 or ARM64** — Full starts on both. Cosmog/PoGo ARM APKs are more reliable on ARM64 (Ampere). |
| **OS** | Ubuntu 22.04 / 24.04 (Qadbak native stack) |
| **RAM** | 16 GB+ recommended (2 Redroid × 17 workers) |
| **Kernel** | `binder_linux` (+ `ashmem_linux` on older kernels) |
| **Cosmog license** | From Cosmog Discord |
| **APKs** | `cosmog.apk` + `pogo.apk` in `services/cosmog/apk/` |

On **x86** Qadbak uses `redroid/redroid:11.0.0-latest` (amd64). On **ARM64** it uses the Magisk ARM image.

## One-command full deploy

```bash
sudo bash scripts/setup-qadbak-host.sh    # once: kernel modules + adb
cp .env.example .env && nano .env         # set secrets + SERVER_PUBLIC_IP
# Add cosmog.apk (+ optional pogo.apk) to services/cosmog/apk/

bash scripts/deploy-on-qadbak.sh --full
```

## What `--full` starts

```
Core          MariaDB, Redis, Account API, Dashboard
Mapping       Golbat, RotomNG, ReactMap, Koji, PoracleNG, Dragonite*
Workers       redroid-1, redroid-2, worker-agent, Houndour

* Dragonite binary still required — scripts/install-dragonite.sh
```

## Worker services

| Service | Role |
|---------|------|
| **redroid-1/2** | Virtual Android 11 (official Redroid on x86, Magisk image on ARM64) |
| **worker-agent** | ADB: install APKs, push `cosmog.json`, start Cosmog |
| **houndour** | Watchdog: restart Redroid if Rotom is unreachable |
| **rotom** | Connects Cosmog workers → Dragonite → Golbat |

## Scaling Redroid containers

1. Duplicate `redroid-2` block in `docker-compose.yml` → `redroid-3`, port `5557`
2. Add host to `REDROID_HOSTS` in `worker-agent`
3. Set `REDROID_INSTANCES=3` in `.env`
4. `bash scripts/render-config.sh`

Cosmog docs suggest **max ~50 workers per container**; ~10 containers on a 32 GB Ampere VPS.

## Play Integrity

Large deviceless setups may still need **1–2 cheap Android TV boxes** as attestation solvers only (not scan devices). Set `use_local_safetynet: false` in Cosmog config (default in our template) to forward attestation.

## Config files

| Path | Purpose |
|------|---------|
| `config/cosmog/cosmog.json.template` | Template |
| `config/cosmog/rendered/1.json` | Generated per Redroid instance |
| `.env` → `COSMOG_TOKEN`, `ROTOM_SECRET`, `SERVER_PUBLIC_IP` | Secrets |

## Troubleshooting

```bash
# Redroid logs
docker logs pogo-stack-redroid-1-1

# Worker agent (ADB push loop)
docker logs pogo-stack-worker-agent-1

# Manual ADB from host
adb connect 127.0.0.1:5555
adb -s 127.0.0.1:5555 shell getprop ro.build.version.release

# Restart workers only
docker compose --profile workers restart
```

## References

- [Cosmog deviceless / Redroid](https://sylvie.fyi/cosmog/redroid.html)
- [Cosmog configuration](https://sylvie.fyi/cosmog/config.html)
- [Redroid documentation](https://github.com/remote-android/redroid-doc)
- [Houndour watchdog](https://github.com/sy1vi3/houndour)

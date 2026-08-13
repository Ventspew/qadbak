# PoGo Stack — Qadbak deployment

Deploy the combined Pokemon GO stack on a VPS that already runs **Qadbak**.

## 1. Copy stack to the server

```bash
sudo mkdir -p /opt/pogo-stack
sudo chown "$USER":"$USER" /opt/pogo-stack
git clone <your-repo-url> /opt/pogo-stack
cd /opt/pogo-stack
cp .env.example .env
# Edit secrets in .env
```

## 2. Ensure Docker is available

On a Qadbak native-stack VPS:

```bash
sudo bash /opt/qadbak/scripts/lib/ensure-docker.sh
sudo usermod -aG docker qadbak   # if the panel runs as qadbak
```

## 3. Deploy

```bash
bash scripts/render-config.sh
bash scripts/deploy-on-qadbak.sh --full
```

**Full stack** includes deviceless workers (Redroid + Cosmog) — no Android phones. See [DEVICELESS.md](./DEVICELESS.md).

Host prep (once, as root):

```bash
sudo bash scripts/setup-qadbak-host.sh
```

Place `cosmog.apk` in `services/cosmog/apk/` before starting workers.

Deploy modes:

| Flag | Starts |
|------|--------|
| (none) | Core: MariaDB, Account API, Dashboard |
| `--with-mapping` | + Golbat, Rotom, ReactMap, Koji, Poracle, Dragonite |
| `--with-workers` | + Redroid, worker-agent, Houndour |
| `--full` | All of the above |

Mapping images (Golbat/Poracle) need GHCR login:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

## 4. Qadbak reverse proxy

Create a domain/subdomains in Qadbak and reverse-proxy to localhost ports:

| Public URL | Proxy target | Notes |
|------------|--------------|-------|
| `admin.pogo.example.com` | `http://127.0.0.1:8080` | Dashboard |
| `accounts.pogo.example.com` | `http://127.0.0.1:4242` | Account API (restrict by IP or add auth gateway) |
| `map.example.com` | via dashboard `/map/` or ReactMap port | After mapping profile |
| `koji.example.com` | via dashboard `/koji/` | After mapping profile |

Enable Let's Encrypt in Qadbak for each vhost.

## 5. Dragonite (closed source)

```bash
bash scripts/install-dragonite.sh
# Follow UnownHash instructions, place binary at:
# services/dragonite/binary/dragonite
cp services/dragonite/config/config.toml.example services/dragonite/config/config.toml
docker compose --profile mapping up -d dragonite
```

## 6. Manage via Qadbak

- **Server → Docker** — start/stop containers, paste compose updates
- **Qadbak iOS app** — metrics, Docker, logs via Agent
- **Dashboard** — accounts, release workers, quick links

## 7. Account workflow

1. Add accounts in dashboard or `POST /account`
2. Workers call `GET /account/request?system_id=worker-1`
3. Workers report status via `POST /account/update`
4. Release via dashboard or `POST /account/release`

Export for Dragonite:

```bash
bash scripts/sync-accounts-to-dragonite.sh accounts.csv
```

## Resource guidance

| Accounts | RAM | CPU |
|----------|-----|-----|
| Core only | 4 GB | 2 |
| + mapping (small) | 8 GB | 4 |
| 50+ workers | 16–32 GB | 8 |

## Reference repos used

- [PGPool](https://github.com/codename-art/PGPool) — account API design
- [Rotomina](https://github.com/f3ger/rotomina) — dashboard patterns
- [UnownHash/Golbat](https://github.com/UnownHash/Golbat) — data processor
- [UnownHash/RotomNG](https://github.com/UnownHash/RotomNG) — device connector
- [WatWowMap/ReactMap](https://github.com/WatWowMap/ReactMap) — map UI
- [TurtIeSocks/Koji](https://github.com/TurtIeSocks/Koji) — geofences
- [jfberry/PoracleNG](https://github.com/jfberry/PoracleNG) — alerts

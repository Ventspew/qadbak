#!/usr/bin/env bash
# Install PoGo stack on a Qadbak VPS
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit secrets before production use."
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

bash scripts/render-config.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. On Qadbak native stack run:"
  echo "  sudo bash /opt/qadbak/scripts/lib/ensure-docker.sh"
  exit 1
fi

WITH_MAPPING=0
WITH_ANDROID=0
WITH_IOS=0
WITH_WORKERS=0
MODE_LABEL="core"

for arg in "$@"; do
  case "$arg" in
    --full)
      WITH_MAPPING=1
      WITH_ANDROID=1
      WITH_IOS=1
      WITH_WORKERS=1
      MODE_LABEL="full"
      ;;
    --with-mapping)
      WITH_MAPPING=1
      MODE_LABEL="mapping"
      ;;
    --with-android)
      WITH_MAPPING=1
      WITH_ANDROID=1
      MODE_LABEL="android"
      ;;
    --with-ios)
      WITH_MAPPING=1
      WITH_IOS=1
      MODE_LABEL="ios"
      ;;
    --with-workers)
      WITH_MAPPING=1
      WITH_WORKERS=1
      MODE_LABEL="workers"
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: bash scripts/deploy-on-qadbak.sh [--with-mapping] [--with-android] [--with-ios] [--with-workers] [--full]"
      exit 1
      ;;
  esac
done

if [ "$WITH_ANDROID" -eq 1 ] && [ "$WITH_IOS" -eq 1 ] && [ "$WITH_WORKERS" -eq 0 ]; then
  MODE_LABEL="android+ios"
fi

if [ "$WITH_WORKERS" -eq 1 ]; then
  echo "Checking Qadbak host for Redroid kernel modules..."
  if [ "$(id -u)" -eq 0 ]; then
    bash scripts/setup-qadbak-host.sh
  else
    echo "Tip: run once as root for Redroid host prep:"
    echo "  sudo bash scripts/setup-qadbak-host.sh"
  fi
fi

echo "Starting core stack (MariaDB, Redis, Account API, Dashboard)..."
docker compose up -d mariadb redis account-api dashboard

echo "Waiting for account API..."
for _ in $(seq 1 30); do
  if curl -sf -H "X-API-Key: ${ACCOUNT_API_KEY:-dev-api-key}" "http://127.0.0.1:${ACCOUNT_API_PORT:-14242}/health" >/dev/null 2>&1; then
    echo "Account API is up."
    break
  fi
  sleep 2
done

if [ "$WITH_MAPPING" -eq 1 ]; then
  echo "Starting mapping profile (Koji, Golbat, Rotom, ReactMap, Poracle, Dragonite)..."
  echo "Note: Golbat/Poracle/RotomNG images require GHCR login:"
  echo "  echo \$GITHUB_TOKEN | docker login ghcr.io -u USER --password-stdin"
  docker compose --profile mapping up -d
fi

if [ "$WITH_ANDROID" -eq 1 ]; then
  echo "Starting android-agent (wireless ADB keep-alive; USB phones use provision-android.sh)..."
  docker compose --profile android up -d android-agent
fi

if [ "$WITH_IOS" -eq 1 ]; then
  echo "Starting ios-agent (wireless SSH keep-alive; USB phones use provision-ios.sh)..."
  docker compose --profile ios up -d ios-agent
fi

if [ "$WITH_WORKERS" -eq 1 ]; then
  if [ ! -f services/cosmog/apk/cosmog.apk ]; then
    echo ""
    echo "WARNING: services/cosmog/apk/cosmog.apk not found."
    echo "Download Cosmog APK from the Cosmog Discord (#apk-releases) and place it there."
    echo "Optional: add services/cosmog/apk/pogo.apk (matching PoGo version)."
    echo ""
  fi
  echo "Starting deviceless workers (Redroid, worker-agent, Houndour)..."
  docker compose --profile workers up -d
fi

cat <<EOF

PoGo stack deployed (mode: ${MODE_LABEL}).

Dashboard:   http://127.0.0.1:${DASHBOARD_PORT:-18080}
Account API: http://127.0.0.1:${ACCOUNT_API_PORT:-14242}/docs
ReactMap:    http://127.0.0.1:${REACTMAP_PORT:-18081}
Koji:        http://127.0.0.1:${KOJI_PORT:-18082}

Deploy modes (flags can be combined):
  (default)         core only — account API + dashboard
  --with-mapping  + Golbat, ReactMap, Rotom, Koji, Poracle, Dragonite
  --with-android  + mapping + android-agent (Cosmog phones)
  --with-ios      + mapping + ios-agent (jailbroken Exeggcute phones)
  --with-workers  + Redroid + Cosmog agent
  --full          everything on one Qadbak server

Next steps:
1. Place Cosmog APK in services/cosmog/apk/ and/or Exeggcute gc.deb in services/exeggcute/debs/
2. Android:  bash scripts/provision-android.sh --device-id pixel-1
   iPhone:   bash scripts/provision-ios.sh --usb --device-id iphone-1
3. bash scripts/install-dragonite.sh
4. Docs: docs/ANDROID.md · docs/IOS.md · docs/QADBAK-DEPLOY.md

EOF

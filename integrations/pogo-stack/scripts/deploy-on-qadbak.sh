#!/usr/bin/env bash
# Install PoGo stack on a Qadbak VPS
set -euo pipefail

ROOT="${QADBAK_DIR:-/opt/qadbak}"
POGO_DIR="${POGO_STACK_DIR:-$ROOT/integrations/pogo-stack}"
cd "$POGO_DIR"

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

MODE="${1:-}"

if [ "$MODE" = "--full" ] || [ "$MODE" = "--with-workers" ]; then
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
  if curl -sf -H "X-API-Key: ${ACCOUNT_API_KEY:-dev-api-key}" "http://127.0.0.1:${ACCOUNT_API_PORT:-4242}/health" >/dev/null 2>&1; then
    echo "Account API is up."
    break
  fi
  sleep 2
done

if [ "$MODE" = "--with-mapping" ] || [ "$MODE" = "--full" ]; then
  echo "Starting mapping profile (Koji, Golbat, Rotom, ReactMap, Poracle, Dragonite)..."
  echo "Note: Golbat/Poracle images require GHCR login:"
  echo "  echo \$GITHUB_TOKEN | docker login ghcr.io -u USER --password-stdin"
  docker compose --profile mapping up -d
fi

if [ "$MODE" = "--with-workers" ] || [ "$MODE" = "--full" ]; then
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

PoGo stack deployed (mode: ${MODE:-core}).

Dashboard:   http://127.0.0.1:${DASHBOARD_PORT:-8080}
Account API: http://127.0.0.1:${ACCOUNT_API_PORT:-4242}/docs

Deploy modes:
  (default)         core only — account API + dashboard
  --with-mapping  + Golbat, ReactMap, Rotom, Koji, Poracle, Dragonite
  --with-workers  + Redroid + Cosmog agent (needs mapping/Rotom)
  --full          everything on one Qadbak server

Next steps:
1. sudo bash scripts/setup-qadbak-host.sh   (once, x86 or ARM64)
2. Place Cosmog APK in services/cosmog/apk/
3. bash scripts/install-dragonite.sh
4. Qadbak reverse proxy — docs/QADBAK-DEPLOY.md

EOF

#!/usr/bin/env bash
# Bring Koji + Golbat + ReactMap up and verify /map/ + /koji/ via the dashboard.
# Usage: sudo bash /opt/qadbak/integrations/pogo-stack/scripts/repair-pogo-mapping.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env"
  exit 1
fi

echo "==> Render configs"
bash scripts/render-config.sh

echo "==> Ensure MariaDB is up"
docker compose up -d mariadb
for i in $(seq 1 30); do
  if docker compose exec -T mariadb healthcheck.sh --connect --innodb_initialized &>/dev/null; then
    break
  fi
  sleep 1
done

echo "==> Ensure mapping databases"
bash scripts/ensure-databases.sh || true

echo "==> Pull + start koji, golbat, reactmap"
docker compose --profile mapping pull koji golbat reactmap
docker compose --profile mapping up -d koji golbat reactmap

echo "==> Rebuild dashboard (proxy /map/ /koji/)"
docker compose up -d --build dashboard

echo "==> Wait for containers"
sleep 5
docker compose ps koji golbat reactmap dashboard || true

echo "==> Logs (tail)"
docker compose logs --tail=30 reactmap || true
docker compose logs --tail=20 koji || true

echo "==> HTTP checks via dashboard"
for i in $(seq 1 30); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/map/ || true)"
  if [[ "$code" != "502" && "$code" != "000" ]]; then
    echo "map ready: HTTP $code (after ${i}s)"
    break
  fi
  sleep 2
done

curl -sS -o /dev/null -w "map  %{http_code}\n" http://127.0.0.1:18080/map/ || true
curl -sS -o /dev/null -w "koji %{http_code}\n" http://127.0.0.1:18080/koji/ || true
curl -sS -o /dev/null -w "dash %{http_code}\n" http://127.0.0.1:18080/ || true

echo "OK — if map/koji still 502, inspect: docker compose logs -f reactmap koji"

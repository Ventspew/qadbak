#!/usr/bin/env bash
# Bring Koji + Golbat + ReactMap up and verify localhost ports + dashboard links.
# Usage: sudo bash /opt/qadbak/integrations/pogo-stack/scripts/repair-pogo-mapping.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-mapping}"

log() { printf '%s\n' "$*"; }
fail_soft() { printf 'WARN: %s\n' "$*" >&2; }

if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

REACTMAP_PORT="${REACTMAP_PORT:-18081}"
KOJI_PORT="${KOJI_PORT:-18082}"

log "==> Render configs"
bash scripts/render-config.sh || exit 1
ls -la config/rendered/reactmap.local.json config/rendered/golbat.toml config/reactmap/areas.json 2>&1 || true

log "==> Ensure MariaDB is up"
docker compose up -d mariadb || exit 1
for i in $(seq 1 45); do
  if docker compose exec -T mariadb healthcheck.sh --connect --innodb_initialized &>/dev/null; then
    log "MariaDB healthy (${i}s)"
    break
  fi
  sleep 1
done

log "==> Ensure mapping databases"
bash scripts/ensure-databases.sh || \
  docker compose exec -T -e MYSQL_PWD="${DB_ROOT_PASSWORD}" mariadb mariadb -uroot < config/mariadb/02-databases.sql || \
  fail_soft "database ensure failed"

log "==> Pull images (best effort)"
docker compose pull koji golbat reactmap || fail_soft "pull had errors — continuing"

log "==> Start koji / golbat / reactmap"
docker compose up -d koji || fail_soft "koji up failed"
sleep 2
docker compose up -d golbat || fail_soft "golbat up failed"
docker compose up -d --force-recreate reactmap || fail_soft "reactmap up failed"

log "==> Rebuild dashboard"
docker compose up -d --build dashboard || fail_soft "dashboard rebuild failed"

log "==> Wait for localhost ports"
map_code="000"
koji_code="000"
for i in $(seq 1 60); do
  map_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${REACTMAP_PORT}/" || true)"
  koji_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${KOJI_PORT}/" || true)"
  if [[ "$map_code" != "000" && "$map_code" != "502" && "$map_code" != "504" ]]; then
    log "reactmap :${REACTMAP_PORT} → $map_code (${i}s)"
    break
  fi
  sleep 2
done

log "==> Status"
docker compose ps koji golbat reactmap dashboard || true
curl -sS -o /dev/null -w "reactmap :${REACTMAP_PORT} → %{http_code}\n" "http://127.0.0.1:${REACTMAP_PORT}/" || true
curl -sS -o /dev/null -w "koji     :${KOJI_PORT} → %{http_code}\n" "http://127.0.0.1:${KOJI_PORT}/" || true

if [[ "$map_code" == "000" || "$map_code" == "502" || "$map_code" == "504" ]]; then
  log "FAILED — reactmap not healthy. Logs:"
  docker compose logs --tail=120 reactmap || true
  exit 1
fi

log "==> Apply nginx vhosts for map./koji. subdomains"
if [[ -f /opt/qadbak/scripts/lib/repair-pogo-proxy.sh ]]; then
  bash /opt/qadbak/scripts/lib/repair-pogo-proxy.sh || fail_soft "proxy repair failed"
fi

log "OK — open map/koji via their own hostnames (not /map/ path):"
log "  https://map.<your-domain>/"
log "  https://koji.<your-domain>/"
log "Add Cloudflare A records for map + koji → same origin IP as pogo."

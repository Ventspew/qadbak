#!/usr/bin/env bash
# Bring Koji + Golbat + ReactMap up and verify /map/ + /koji/ via the dashboard.
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

log "==> Render configs"
if ! bash scripts/render-config.sh; then
  echo "render-config.sh failed" >&2
  exit 1
fi
ls -la config/rendered/reactmap.local.json config/rendered/golbat.toml 2>&1 || true

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
if ! bash scripts/ensure-databases.sh; then
  fail_soft "ensure-databases failed — trying inline SQL"
  docker compose exec -T -e MYSQL_PWD="${DB_ROOT_PASSWORD}" mariadb \
    mariadb -uroot < config/mariadb/02-databases.sql || fail_soft "inline SQL also failed"
fi

log "==> Pull images (best effort)"
docker compose pull koji golbat reactmap || fail_soft "pull had errors — continuing with local/cached images"

log "==> Start koji (alone first)"
docker compose up -d koji || fail_soft "koji up failed"
sleep 3
docker compose ps koji || true
docker compose logs --tail=40 koji || true

log "==> Start golbat"
docker compose up -d golbat || fail_soft "golbat up failed"
sleep 2
docker compose logs --tail=30 golbat || true

log "==> Start reactmap"
docker compose up -d --force-recreate reactmap || fail_soft "reactmap up failed"
sleep 5
docker compose ps reactmap || true
docker compose logs --tail=60 reactmap || true

log "==> Rebuild dashboard proxy"
docker compose up -d --build dashboard || fail_soft "dashboard rebuild failed"
sleep 3

log "==> Container status"
docker compose ps mariadb koji golbat reactmap dashboard || true

log "==> Direct upstream checks from dashboard network"
docker compose exec -T dashboard sh -c 'wget -qO- --timeout=3 http://reactmap:8080/ >/dev/null && echo reactmap:8080 OK || echo reactmap:8080 FAIL' || true
docker compose exec -T dashboard sh -c 'wget -qO- --timeout=3 http://koji:8080/ >/dev/null && echo koji:8080 OK || echo koji:8080 FAIL' || true

log "==> HTTP checks via dashboard :18080"
map_code="000"
for i in $(seq 1 45); do
  map_code="$(curl -sS -o /tmp/pogo-map.out -w '%{http_code}' http://127.0.0.1:18080/map/ || true)"
  if [[ "$map_code" != "502" && "$map_code" != "000" && "$map_code" != "504" ]]; then
    log "map ready: HTTP $map_code (after ${i}s)"
    break
  fi
  sleep 2
done

curl -sS -o /dev/null -w "map  %{http_code}\n" http://127.0.0.1:18080/map/ || true
curl -sS -o /dev/null -w "koji %{http_code}\n" http://127.0.0.1:18080/koji/ || true
curl -sS -o /dev/null -w "dash %{http_code}\n" http://127.0.0.1:18080/ || true

if [[ "$map_code" == "502" || "$map_code" == "000" || "$map_code" == "504" ]]; then
  log ""
  log "FAILED — /map/ still $map_code. Dumping reactmap logs:"
  docker compose logs --tail=120 reactmap || true
  log ""
  log "Paste the output above if you need help."
  exit 1
fi

log "OK — mapping endpoints responding"

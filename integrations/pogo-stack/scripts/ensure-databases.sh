#!/usr/bin/env bash
# Create mapping databases inside the PoGo MariaDB *container*.
# Never uses the Qadbak host socket (/run/mysqld/mysqld.sock).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "Missing .env"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${DB_ROOT_PASSWORD:-}" ]]; then
  echo "DB_ROOT_PASSWORD is empty in .env" >&2
  exit 1
fi

DB_USER_SAFE="${DB_USER:-pogo}"
if [[ ! "$DB_USER_SAFE" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo "Invalid DB_USER: ${DB_USER_SAFE}" >&2
  exit 1
fi

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "docker compose is not installed" >&2
    exit 1
  fi
}

echo "==> Starting PoGo MariaDB container (not host mysqld)"
compose up -d mariadb

echo "==> Waiting for PoGo MariaDB to accept connections"
ok=0
for i in $(seq 1 90); do
  if compose exec -T mariadb healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then
    ok=1
    echo "MariaDB healthy (${i})"
    break
  fi
  if compose exec -T -e MYSQL_PWD="${DB_ROOT_PASSWORD}" mariadb \
      mariadb-admin ping --protocol=tcp -h127.0.0.1 -uroot --silent >/dev/null 2>&1; then
    ok=1
    echo "MariaDB ping ok (${i})"
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "PoGo MariaDB container did not become ready (host mysql is not used)." >&2
  compose ps mariadb >&2 || true
  compose logs --tail=80 mariadb >&2 || true
  exit 1
fi

echo "==> Ensuring golbat/reactmap/koji/poracle databases for user ${DB_USER_SAFE}"
compose exec -T -e MYSQL_PWD="${DB_ROOT_PASSWORD}" mariadb \
  mariadb --protocol=tcp -h127.0.0.1 -uroot --connect-timeout=10 <<SQL
CREATE DATABASE IF NOT EXISTS golbat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS reactmap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS koji CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS poracle CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON golbat.* TO '${DB_USER_SAFE}'@'%';
GRANT ALL PRIVILEGES ON reactmap.* TO '${DB_USER_SAFE}'@'%';
GRANT ALL PRIVILEGES ON koji.* TO '${DB_USER_SAFE}'@'%';
GRANT ALL PRIVILEGES ON poracle.* TO '${DB_USER_SAFE}'@'%';
FLUSH PRIVILEGES;
SQL
echo "OK — mapping databases ready"

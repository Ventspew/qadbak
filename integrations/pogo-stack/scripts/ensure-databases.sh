#!/usr/bin/env bash
# Ensure mapping databases exist on an already-initialized MariaDB volume.
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

SQL_FILE="$ROOT/config/mariadb/02-databases.sql"
if [ ! -f "$SQL_FILE" ]; then
  echo "Missing $SQL_FILE"
  exit 1
fi

echo "==> Ensuring golbat/reactmap/koji/poracle/dragonite databases"
# Prefer MYSQL_PWD so the password is not visible on the process argv.
if docker compose exec -T -e MYSQL_PWD="${DB_ROOT_PASSWORD}" mariadb \
  mariadb -uroot < "$SQL_FILE"; then
  echo "OK — mapping databases ready"
  exit 0
fi

# Fallback for older images that only ship `mysql`.
docker compose exec -T -e MYSQL_PWD="${DB_ROOT_PASSWORD}" mariadb \
  mysql -uroot < "$SQL_FILE"
echo "OK — mapping databases ready"

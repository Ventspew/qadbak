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

echo "==> Ensuring golbat/reactmap/koji/poracle databases"
docker compose exec -T mariadb \
  mariadb -uroot -p"${DB_ROOT_PASSWORD}" < "$SQL_FILE"
echo "OK — mapping databases ready"

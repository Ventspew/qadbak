#!/usr/bin/env bash
# Reset the ReactMap MariaDB schema (fixes knex "migration directory is corrupt").
# Usage: bash scripts/reset-reactmap-db.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

echo "==> Dropping and recreating database 'reactmap'"
docker compose exec -T -e MYSQL_PWD="${DB_ROOT_PASSWORD}" mariadb mariadb -uroot <<SQL
DROP DATABASE IF EXISTS reactmap;
CREATE DATABASE reactmap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON reactmap.* TO '${DB_USER}'@'%';
FLUSH PRIVILEGES;
SQL
echo "OK — reactmap DB is empty; ReactMap will re-run migrations on next start"

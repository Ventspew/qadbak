#!/usr/bin/env bash
# Drop extra PHP-FPM pools for a unix user except the given pool ids.
# Usage: sudo bash prune-php-fpm-named-pools.sh UNIX_USER [POOL_ID ...]
set -euo pipefail

USER="${1:?unix-user}"
shift || true

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

ROOT="${QADBAK_DIR:-/opt/qadbak}"
# shellcheck source=lib/php-fpm-pool.sh
source "$ROOT/scripts/lib/php-fpm-pool.sh"

prune_php_fpm_named_pools "$USER" "$@"
echo "OK — pruned extra PHP-FPM pools for ${USER}"

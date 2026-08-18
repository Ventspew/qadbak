#!/usr/bin/env bash
# Create a per-directory PHP-FPM pool.
# Usage: sudo bash apply-php-fpm-named-pool.sh UNIX_USER PHP_VERSION CHDIR POOL_ID HOME
set -euo pipefail

USER="${1:?unix-user}"
VER="${2:?php-version}"
CHDIR="${3:?chdir}"
POOL_ID="${4:?pool-id}"
HOME_DIR="${5:-/home/${USER}}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

ROOT="${QADBAK_DIR:-/opt/qadbak}"
# shellcheck source=lib/php-fpm-pool.sh
source "$ROOT/scripts/lib/php-fpm-pool.sh"

apply_php_fpm_named_pool "$USER" "$VER" "$CHDIR" "$POOL_ID" "$HOME_DIR"

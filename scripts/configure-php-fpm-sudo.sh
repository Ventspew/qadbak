#!/usr/bin/env bash
# Allow Qadbak user to manage PHP-FPM pools (via provisioning helper / panel repair).
set -euo pipefail

QADBAK_DIR="${QADBAK_DIR:-/opt/qadbak}"
QADBAK_USER="${QADBAK_USER:-qadbak}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/configure-php-fpm-sudo.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$(readlink -f "$SCRIPT_DIR/lib")"
GEN="$LIB_DIR/generate-sudoers-domain-users.sh"
APPLY="$(readlink -f "$QADBAK_DIR/scripts/apply-php-fpm-pool.sh")"
REMOVE="$(readlink -f "$QADBAK_DIR/scripts/remove-php-fpm-pool.sh")"
ALL="$(readlink -f "$QADBAK_DIR/scripts/apply-all-php-fpm-pools.sh")"
NAMED="$(readlink -f "$QADBAK_DIR/scripts/apply-php-fpm-named-pool.sh")"
PRUNE="$(readlink -f "$QADBAK_DIR/scripts/prune-php-fpm-named-pools.sh")"

for s in "$APPLY" "$REMOVE" "$ALL" "$NAMED" "$PRUNE"; do
  [[ -f "$s" ]] || { echo "Missing $s" >&2; exit 1; }
  chmod 755 "$s"
done
chmod 755 "$GEN" "$LIB_DIR/list-sudo-unix-users.sh"

SUDOERS="/etc/sudoers.d/qadbak-php-fpm"
{
  bash "$GEN" "$QADBAK_USER" "$APPLY" "# Qadbak PHP-FPM apply — per unix-user"
  bash "$GEN" "$QADBAK_USER" "$REMOVE" "# Qadbak PHP-FPM remove — per unix-user" | grep -v '^#'
  echo "$QADBAK_USER ALL=(root) NOPASSWD: $ALL"
} >"$SUDOERS"
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS"

if ! sudo -u "$QADBAK_USER" sudo -n "$APPLY" __probe__ 2>/dev/null | grep -q OK; then
  echo "FAILED: sudo rule not active." >&2
  exit 1
fi
echo "OK — PHP-FPM pool scripts (per-user apply/remove)"

#!/usr/bin/env bash
# Install PoGo Stack without the panel UI (use if Admin → Apps returns HTTP 502).
# Usage: sudo bash /opt/qadbak/scripts/install-pogo-stack-cli.sh example.com [phones|android|mapping]
set -euo pipefail

ROOT="${QADBAK_DIR:-/opt/qadbak}"
DOMAIN="${1:-}"
MODE="${2:-phones}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash $0 example.com [phones|android|mapping|ios|core|full]" >&2
  exit 1
fi

echo "==> PoGo Stack CLI install  domain=$DOMAIN  mode=$MODE"
echo "    Log: $ROOT/data/provisioning-helper.log"
exec bash "$ROOT/scripts/run-provisioning-helper.sh" pogo-stack-install "$DOMAIN" \
  "{\"subdomain\":\"pogo\",\"mode\":\"${MODE}\"}"

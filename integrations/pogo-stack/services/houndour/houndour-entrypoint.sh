#!/usr/bin/env bash
set -euo pipefail

# Lightweight watchdog: restart redroid containers if Rotom health fails.
# Falls back to periodic docker restart when houndour repo scripts are unavailable.

ROTOM_URL="${ROTOM_URL:-ws://rotom:7070}"
INTERVAL="${CHECK_INTERVAL:-120}"
REDROID_CONTAINERS="${REDROID_CONTAINERS:-pogo-stack-redroid-1-1 pogo-stack-redroid-2-1}"

check_rotom() {
  # 7070/7071 are websockets; HTTP UI/API is on 7072.
  curl -sf "http://rotom:7072/" >/dev/null 2>&1 || return 1
  return 0
}

restart_redroid() {
  for name in $REDROID_CONTAINERS; do
    docker restart "$name" 2>/dev/null || true
  done
}

echo "Houndour watchdog started (interval ${INTERVAL}s)"

while true; do
  if ! check_rotom; then
    echo "$(date -Is) Rotom unreachable — restarting Redroid containers"
    restart_redroid
  fi
  sleep "$INTERVAL"
done

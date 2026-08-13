#!/usr/bin/env bash
# Refresh PoGo stack containers after Qadbak git update (when installed via app store).
set -euo pipefail

ROOT="${QADBAK_DIR:-/opt/qadbak}"
STATE="$ROOT/data/pogo-stack.json"

if [[ ! -f "$STATE" ]]; then
  exit 0
fi

echo "==> PoGo stack update (installed via app store)"
if [[ "$(id -u)" -eq 0 ]]; then
  sudo -u "${QADBAK_USER:-qadbak}" sudo -n "$ROOT/scripts/run-provisioning-helper.sh" pogo-stack-update 2>/dev/null || \
    node "$ROOT/scripts/provisioning-helper.mjs" pogo-stack-update 2>/dev/null || true
else
  bash "$ROOT/scripts/run-provisioning-helper.sh" pogo-stack-update 2>/dev/null || true
fi

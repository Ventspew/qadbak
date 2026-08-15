#!/usr/bin/env bash
# Refresh PoGo stack after Qadbak git update (when installed via app store).
set -euo pipefail

ROOT="${QADBAK_DIR:-/opt/qadbak}"
STATE="$ROOT/data/pogo-stack.json"
STACK="$ROOT/integrations/pogo-stack"
UPDATE="$STACK/scripts/update-pogo-stack.sh"

# Prefer full one-shot updater when present (with or without app-store state).
if [[ -x "$UPDATE" ]] && [[ -f "$STACK/.env" ]]; then
  echo "==> PoGo stack one-shot update"
  bash "$UPDATE" || echo "    WARN: update-pogo-stack failed" >&2
  exit 0
fi

if [[ ! -f "$STATE" ]]; then
  exit 0
fi

echo "==> PoGo stack update (legacy app-store path)"
if [[ "$(id -u)" -eq 0 ]]; then
  sudo -u "${QADBAK_USER:-qadbak}" sudo -n "$ROOT/scripts/run-provisioning-helper.sh" pogo-stack-update 2>/dev/null || \
    node "$ROOT/scripts/provisioning-helper.mjs" pogo-stack-update 2>/dev/null || true
else
  bash "$ROOT/scripts/run-provisioning-helper.sh" pogo-stack-update 2>/dev/null || true
fi

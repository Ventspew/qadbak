#!/bin/bash
# NOPASSWD sudo — native provisioning (phase 8).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QADBAK_NODE_BIN="${QADBAK_NODE_BIN:-$(command -v node 2>/dev/null || echo /usr/bin/node)}"
export QADBAK_DIR="${QADBAK_DIR:-$(dirname "$SCRIPT_DIR")}"
ENV_FILE="$QADBAK_DIR/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  set +eu
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE" || true
  set +a
  set -eu
fi

CMD="${1:-}"
ALLOWLIST="$SCRIPT_DIR/lib/provisioning-helper-commands.txt"
if [[ -z "$CMD" ]] || ! grep -qxF "$CMD" "$ALLOWLIST" 2>/dev/null; then
  echo "Disallowed provisioning command: ${CMD:-(empty)}" >&2
  exit 1
fi

LOG="$QADBAK_DIR/data/provisioning-helper.log"
mkdir -p "$QADBAK_DIR/data"
echo "==== $(date -Is) $* ====" >>"$LOG"
exec > >(tee -a "$LOG") 2> >(tee -a "$LOG" >&2)
exec "$QADBAK_NODE_BIN" "$SCRIPT_DIR/provisioning-helper.mjs" "$@"

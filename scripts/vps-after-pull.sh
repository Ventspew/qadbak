#!/usr/bin/env bash
# Minimal steps after git pull when you skip full update-qadbak.sh.
set -euo pipefail

ROOT="${QADBAK_DIR:-/opt/qadbak}"
USER="${QADBAK_USER:-qadbak}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/vps-after-pull.sh" >&2
  exit 1
fi

cd "$ROOT"
command -v jq &>/dev/null || apt-get install -y -qq jq

if [[ -f "$ROOT/scripts/git-sync-origin.sh" ]]; then
  bash "$ROOT/scripts/reset-git-drift-before-pull.sh"
  bash "$ROOT/scripts/git-sync-origin.sh"
fi
bash "$ROOT/scripts/fix-qadbak-ownership.sh"
if [[ -f "$ROOT/.env.local" ]]; then
  bash "$ROOT/scripts/ensure-install-salt.sh" --quiet || true
fi
sudo -u "$USER" bash -c "cd '$ROOT' && rm -rf .next && npm install && npm run build"
bash "$ROOT/scripts/repair-terminal-ws.sh" 2>/dev/null || bash "$ROOT/scripts/ensure-terminal-deps.sh"
bash "$ROOT/scripts/configure-all-sudo.sh" 2>/dev/null || true
bash "$ROOT/scripts/apply-all-php-fpm-pools.sh" 2>/dev/null || true
bash "$ROOT/scripts/ensure-fail2ban.sh" 2>/dev/null || true
bash "$ROOT/scripts/pm2-restart-qadbak.sh"

# Open-core model: Premium source is part of this repo, so a `git pull`
# is the artifact refresh. The only license-side step is a heartbeat to
# confirm status with the license server.
if [[ -f "$ROOT/data/license.json" ]]; then
  echo "==> License heartbeat"
  sudo -u "$USER" bash -c "cd '$ROOT' && node scripts/qadbak-license-cli.mjs heartbeat" || \
    echo "    WARN: heartbeat call failed — the in-process scheduler will retry." >&2
fi

echo "Done — panel, terminal WS and PHP-FPM pools refreshed."
echo "Tip: sudo bash $ROOT/scripts/update-qadbak.sh for a full stack repair + E2E."

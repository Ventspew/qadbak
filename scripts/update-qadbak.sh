#!/usr/bin/env bash
# Update Qadbak from git and restart (run on server as root or qadbak user).
set -euo pipefail

ROOT="${QADBAK_DIR:-/opt/qadbak}"
USER="${QADBAK_USER:-qadbak}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/installer-ui.sh
source "$SCRIPT_DIR/lib/installer-ui.sh"

UPDATE_MODE=full
UPDATE_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      UPDATE_MODE=quick
      shift
      ;;
    -y|--yes)
      UPDATE_YES=1
      shift
      ;;
    -h|--help)
      qadbak_update_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (try --help)" >&2
      exit 1
      ;;
  esac
done

VERSION_BEFORE="$(qadbak_install_version_from_repo "$ROOT" 2>/dev/null || echo unknown)"
qadbak_update_banner "$VERSION_BEFORE"
qadbak_update_show_plan "$UPDATE_MODE"
if [[ "$UPDATE_YES" != "1" ]] && [[ -t 0 ]]; then
  qadbak_install_prompt_continue "Proceed with update? [y/N]: "
fi

run_as_qadbak() {
  if [[ "$(id -un)" == "$USER" ]]; then
    bash -c "$1"
  else
    sudo -u "$USER" bash -c "$1"
  fi
}

bootstrap_env_git_branch() {
  local env_file="$ROOT/.env.local"
  [[ -f "$env_file" ]] || return 0
  local branch
  branch="$(grep -E '^[[:space:]]*QADBAK_GIT_BRANCH=' "$env_file" | tail -1 | cut -d= -f2- | tr -d " \"'" || true)"
  [[ -n "$branch" ]] || return 0
  cd "$ROOT"
  git fetch --prune origin 2>/dev/null || true
  if ! git show-ref --quiet "refs/remotes/origin/$branch"; then
    return 0
  fi
  local current
  current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  if [[ "$current" == "$branch" ]]; then
    return 0
  fi
  echo "==> Bootstrap checkout $branch (QADBAK_GIT_BRANCH; before git-sync)"
  git checkout -B "$branch" "origin/$branch"
}

echo "==> Sync git $ROOT"
if [[ "$(id -u)" -eq 0 ]]; then
  cd "$ROOT"
  bootstrap_env_git_branch || true
  bash "$ROOT/scripts/reset-git-drift-before-pull.sh"
  bash "$ROOT/scripts/git-sync-origin.sh"
  bash "$ROOT/scripts/fix-qadbak-ownership.sh"
  bash "$ROOT/scripts/install-node-build-deps.sh" 2>/dev/null || true
  bash "$ROOT/scripts/ensure-npm-current.sh" 2>/dev/null || true
else
  run_as_qadbak "cd '$ROOT' && bash scripts/reset-git-drift-before-pull.sh && bash scripts/git-sync-origin.sh"
fi

ENV_FILE="$ROOT/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  migrate_env_key() {
    local old="$1" new="$2"
    if grep -q "^${old}=" "$ENV_FILE" 2>/dev/null && ! grep -q "^${new}=" "$ENV_FILE" 2>/dev/null; then
      sed -i.bak "s/^${old}=/${new}=/" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
      echo "==> Renamed ${old} → ${new} in .env.local"
    fi
  }
  migrate_env_key VIRTUALMIN_URL QADBAK_LEGACY_API_URL
  migrate_env_key VIRTUALMIN_USER QADBAK_LEGACY_API_USER
  migrate_env_key VIRTUALMIN_PASS QADBAK_LEGACY_API_PASS
  migrate_env_key VIRTUALMIN_MOCK QADBAK_LEGACY_API_MOCK
  migrate_env_key VIRTUALMIN_UI_URL QADBAK_LEGACY_PANEL_URL
  migrate_env_key WEBMIN_UI_URL QADBAK_LEGACY_PANEL_URL
  migrate_env_key USERMIN_UI_URL QADBAK_ACCOUNT_PANEL_UI_URL
  migrate_env_key QADBAK_VIRTUALMIN_FALLBACK QADBAK_LEGACY_API_FALLBACK
  migrate_env_key QADBAK_DISABLE_WEBMIN QADBAK_DISABLE_LEGACY_PANEL
  migrate_env_key QADBAK_WEBMIN_EMBED_BASE QADBAK_LEGACY_PANEL_EMBED_BASE
  migrate_env_key QADBAK_SHOW_WEBMIN_NAV QADBAK_SHOW_LEGACY_PANEL_NAV
fi
if [[ -f "$ENV_FILE" ]] && grep -q '^QADBAK_NATIVE_FEATURES=' "$ENV_FILE" 2>/dev/null; then
  if ! grep '^QADBAK_NATIVE_FEATURES=' "$ENV_FILE" | grep -qE '(^|,)(imap)(,|$)'; then
    sed -i.bak -E 's/^(QADBAK_NATIVE_FEATURES=.*)$/\1,imap/' "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
    echo "==> Added imap to QADBAK_NATIVE_FEATURES (restart after build)"
  fi
fi
if [[ -f "$ENV_FILE" ]]; then
  bash "$ROOT/scripts/ensure-install-salt.sh" --quiet || {
    echo "    WARN: ensure-install-salt.sh failed" >&2
  }
fi

echo "==> Syntax check (domain-fs-helper)"
node --check "$ROOT/scripts/domain-fs-helper.mjs"

echo "==> Build (as $USER — never npm install/build as root)"
if [[ "$(id -u)" -eq 0 ]] && [[ -f "$ROOT/scripts/fix-qadbak-ownership.sh" ]]; then
  bash "$ROOT/scripts/fix-qadbak-ownership.sh"
fi
run_as_qadbak "cd '$ROOT' && npm install && npm run build"
bash "$ROOT/scripts/ensure-terminal-deps.sh"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "==> Sudo helpers"
  bash "$ROOT/scripts/configure-all-sudo.sh" || echo "    WARN: configure-all-sudo.sh failed" >&2
fi

if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]]; then
  echo "==> Hosting stack (nginx, Apache)"
  QADBAK_NATIVE_INSTALL=1 QADBAK_DISABLE_LEGACY_PANEL=true \
    bash "$ROOT/scripts/install-hosting-stack.sh" || echo "    WARN: install-hosting-stack.sh failed" >&2
  if [[ -f "$ROOT/scripts/prune-stale-hosting.sh" ]]; then
    bash "$ROOT/scripts/prune-stale-hosting.sh" || echo "    WARN: prune-stale-hosting.sh failed" >&2
  fi
fi

if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]]; then
  echo "==> Backup schedules (enable automatic + refresh stale)"
  if sudo -u "$USER" sudo -n "$ROOT/scripts/run-provisioning-helper.sh" backup-schedule-ensure-all '{"runStale":true,"staleDays":1}' 2>/dev/null; then
    echo "    OK — automatic backups enabled on qadbak crontab"
  else
    echo "    WARN: backup-schedule-ensure-all failed — run:" >&2
    echo "    sudo -u $USER sudo -n $ROOT/scripts/run-provisioning-helper.sh backup-schedule-ensure-all '{\"runStale\":true}'" >&2
  fi
fi

echo "==> Restart (load .env.local into pm2)"
run_as_qadbak "cd '$ROOT' && bash scripts/pm2-restart-qadbak.sh"

if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]] && [[ -f "$ROOT/scripts/repair-panel-access.sh" ]]; then
  echo ""
  echo "==> Panel access (panel.<domain> + main host — fixes Cloudflare 520)"
  bash "$ROOT/scripts/repair-panel-access.sh" || \
    echo "    WARN: repair-panel-access.sh failed — run: sudo bash $ROOT/scripts/fix-panel-now.sh" >&2
fi

if [[ -f "$ROOT/data/license.json" ]]; then
  echo "==> License heartbeat (open-core: no artifact sync needed)"
  run_as_qadbak "cd '$ROOT' && node scripts/qadbak-license-cli.mjs heartbeat" || \
    echo "    WARN: heartbeat call failed — the in-process scheduler will retry." >&2
fi

echo "==> Verify"
run_as_qadbak "cd '$ROOT' && bash scripts/v1-test-preflight.sh" || true
HEALTH_OK=0
if HEALTH_BODY="$(curl -sf "http://127.0.0.1:${PORT:-3000}/api/health" 2>/dev/null | head -c 200)"; then
  HEALTH_OK=1
  echo "$HEALTH_BODY"
  echo ""
else
  echo "    WARN: /api/health failed" >&2
fi

if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]]; then
  if bash "$ROOT/scripts/sync-e2e-credentials.sh" 2>/dev/null; then
    echo "==> Install E2E (Playwright on live panel)"
    bash "$ROOT/scripts/run-install-e2e.sh" || echo "    WARN: install E2E failed (see above)" >&2
  else
    echo "==> Install E2E skipped — set QADBAK_E2E_ADMIN_PASS in .env.local, then:" >&2
    echo "    sudo bash $ROOT/scripts/sync-e2e-credentials.sh" >&2
  fi
fi

if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]] && [[ -f "$ROOT/scripts/configure-bind-native.sh" ]]; then
  echo ""
  echo "==> BIND9 (native DNS)"
  bash "$ROOT/scripts/configure-bind-native.sh" 2>/dev/null || true
fi
if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]] && [[ -f "$ROOT/scripts/repair-panel-webmail.sh" ]]; then
  echo ""
  echo "==> Qmail (IMAP / Dovecot)"
  bash "$ROOT/scripts/repair-panel-webmail.sh" 2>/dev/null || true
fi
if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]] && [[ -f "$ROOT/scripts/repair-panel-premium.sh" ]]; then
  echo ""
  echo "==> Premium + mobile app (Qmail, push, license sync)"
  bash "$ROOT/scripts/repair-panel-premium.sh" || echo "    WARN: repair-panel-premium.sh failed" >&2
fi
if [[ "$UPDATE_MODE" == "full" ]] && [[ "$(id -u)" -eq 0 ]] && [[ -f "$ROOT/scripts/apply-phase8-independent.sh" ]]; then
  echo "Re-apply native flags: sudo bash $ROOT/scripts/apply-phase8-independent.sh"
fi

VERSION_AFTER="$(qadbak_install_version_from_repo "$ROOT" 2>/dev/null || echo unknown)"
qadbak_update_summary "$ROOT" "$VERSION_BEFORE" "$VERSION_AFTER" "$HEALTH_OK"

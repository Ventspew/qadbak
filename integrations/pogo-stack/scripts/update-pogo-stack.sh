#!/usr/bin/env bash
# One-shot PoGo stack update after git pull (Qadbak or standalone).
# Usage (on VPS):
#   cd /opt/qadbak && git pull
#   sudo bash integrations/pogo-stack/scripts/update-pogo-stack.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QADBAK_DIR="${QADBAK_DIR:-$(cd "$ROOT/../.." && pwd)}"
cd "$ROOT"

log() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

if [[ ! -f .env ]]; then
  fail "Missing $ROOT/.env — copy .env.example and fill secrets first"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

COMPOSE=(docker compose --profile mapping --profile android --profile ios --profile workers)

download_apk() {
  local url="$1"
  local dest="$2"
  local label="$3"
  if [[ -z "$url" || "$url" == change-me* ]]; then
    return 1
  fi
  mkdir -p "$(dirname "$dest")"
  log "==> Download $label from private URL"
  if curl -fsSL --connect-timeout 30 --max-time 600 -o "${dest}.part" "$url"; then
    mv -f "${dest}.part" "$dest"
    chmod 644 "$dest"
    ls -lh "$dest"
    return 0
  fi
  rm -f "${dest}.part"
  warn "Failed to download $label"
  return 1
}

log "==> PoGo one-shot update"

bash scripts/ensure-secrets.sh || fail "ensure-secrets failed"

set -a
# shellcheck disable=SC1091
source .env
set +a

download_apk "${COSMOG_APK_URL:-}" "services/cosmog/apk/cosmog.apk" "cosmog.apk" || true
download_apk "${POGO_APK_URL:-}" "services/cosmog/apk/pogo.apk" "pogo.apk" || true

if [[ "$(id -u)" -eq 0 ]]; then
  bash scripts/setup-qadbak-host.sh || warn "host prep had warnings"
else
  warn "Not root — skip binder/host prep (re-run with sudo for Redroid)"
fi

bash scripts/render-config.sh || fail "render-config failed"
bash scripts/ensure-databases.sh || warn "ensure-databases failed"

log "==> Core + mapping"
"${COMPOSE[@]}" up -d --build mariadb redis account-api dashboard || warn "core up failed"
"${COMPOSE[@]}" up -d koji golbat reactmap rotom || warn "mapping up failed"
"${COMPOSE[@]}" up -d dragonite || warn "dragonite up failed"

if [[ -x scripts/sync-accounts-to-dragonite.sh ]]; then
  bash scripts/sync-accounts-to-dragonite.sh || warn "account sync export failed"
fi

if [[ -n "${ANDROID_DEVICES:-}" ]]; then
  log "==> android-agent"
  docker compose --profile android up -d android-agent || warn "android-agent failed"
fi
if [[ -n "${IOS_DEVICES:-}" ]]; then
  log "==> ios-agent"
  docker compose --profile ios up -d ios-agent || warn "ios-agent failed"
fi

if [[ -f "$QADBAK_DIR/scripts/lib/repair-pogo-proxy.sh" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    bash "$QADBAK_DIR/scripts/lib/repair-pogo-proxy.sh" || warn "proxy repair failed"
  else
    warn "Run as root to refresh nginx: sudo bash $QADBAK_DIR/scripts/lib/repair-pogo-proxy.sh"
  fi
fi

missing=0
[[ -f services/cosmog/apk/cosmog.apk ]] || { warn "Missing cosmog.apk (needed for Redroid, not physical phones)"; missing=1; }
if [[ -z "${COSMOG_TOKEN:-}" || "$COSMOG_TOKEN" == change-me* ]]; then
  warn "Set COSMOG_TOKEN in .env for Android/Redroid workers"
  missing=1
fi
if [[ -z "${SERVER_PUBLIC_IP:-}" || "$SERVER_PUBLIC_IP" == "127.0.0.1" ]]; then
  warn "Set SERVER_PUBLIC_IP in .env (VPS IPv4 the phones can reach)"
fi

if [[ "$missing" -eq 0 && -f scripts/repair-pogo-workers.sh ]]; then
  log "==> Workers (Redroid + Cosmog)"
  if [[ "$(id -u)" -eq 0 ]]; then
    bash scripts/repair-pogo-workers.sh || warn "workers repair had issues"
  else
    warn "Re-run with sudo to start Redroid workers"
  fi
else
  warn "Skipping Redroid workers until APKs + COSMOG_TOKEN are set"
fi

log ""
log "==> Status"
"${COMPOSE[@]}" ps || true
curl -sS -o /dev/null -w "dashboard :${DASHBOARD_PORT:-18080} → %{http_code}\n" "http://127.0.0.1:${DASHBOARD_PORT:-18080}/" 2>/dev/null || true
curl -sS -o /dev/null -w "reactmap  :${REACTMAP_PORT:-18081} → %{http_code}\n" "http://127.0.0.1:${REACTMAP_PORT:-18081}/" 2>/dev/null || true
curl -sS -o /dev/null -w "koji      :${KOJI_PORT:-18082} → %{http_code}\n" "http://127.0.0.1:${KOJI_PORT:-18082}/" 2>/dev/null || true

log ""
log "Dashboard login = DASHBOARD_USER / DASHBOARD_PASSWORD in .env"
log "Koji login password = KOJI_BEARER_TOKEN from .env"
log "iPhone: docs/IOS.md — jailbreak, OpenSSH, Exeggcute, then provision-ios.sh"
log "OK — PoGo update finished"

#!/usr/bin/env bash
# One-shot PoGo stack update after git pull.
# Usage (on VPS):
#   cd /opt/qadbak && git pull
#   sudo bash integrations/pogo-stack/scripts/update-pogo-stack.sh
#
# APKs are NEVER fetched from GitHub. Optionally download from YOUR private URLs:
#   COSMOG_APK_URL=https://…/cosmog.apk
#   POGO_APK_URL=https://…/pogo.apk
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

COMPOSE=(docker compose --profile mapping --profile workers)

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
log "    (PoGo/Cosmog APKs are not stored in git — use private URLs or drop files once)"

bash scripts/ensure-secrets.sh || fail "ensure-secrets failed"

# reload env after secrets may have changed
set -a
# shellcheck disable=SC1091
source .env
set +a

# Optional private APK fetch (you host these; not Qadbak/GitHub)
download_apk "${COSMOG_APK_URL:-}" "services/cosmog/apk/cosmog.apk" "cosmog.apk" || true
download_apk "${POGO_APK_URL:-}" "services/cosmog/apk/pogo.apk" "pogo.apk" || true

if [[ "$(id -u)" -eq 0 ]]; then
  bash scripts/setup-qadbak-host.sh || warn "host prep had warnings"
else
  warn "Not root — skip binder/host prep (re-run with sudo for workers)"
fi

bash scripts/render-config.sh || fail "render-config failed"
bash scripts/ensure-databases.sh || warn "ensure-databases failed"

# Mapping control plane
log "==> Mapping services (koji/golbat/reactmap/rotom/dragonite)"
docker pull "${KOJI_IMAGE:-ghcr.io/turtiesocks/koji:main}" || true
docker pull ghcr.io/unownhash/golbat:main || true
docker pull "${REACTMAP_IMAGE:-ghcr.io/watwowmap/reactmap:v1.27.2}" || true
docker pull "${ROTOM_IMAGE:-ghcr.io/unownhash/rotom:main}" || true
docker pull "${DRAGONITE_IMAGE:-ghcr.io/unownhash/dragonite-public:latest}" || true

"${COMPOSE[@]}" up -d mariadb account-api dashboard || warn "core up failed"
"${COMPOSE[@]}" up -d koji golbat reactmap rotom || warn "mapping up failed"
"${COMPOSE[@]}" up -d dragonite || warn "dragonite up failed"

# Accounts → Dragonite export (metadata CSV; passwords via API if needed)
if [[ -x scripts/sync-accounts-to-dragonite.sh ]]; then
  bash scripts/sync-accounts-to-dragonite.sh || warn "account sync export failed"
fi

# Outer nginx + TLS for pogo/map/koji
if [[ -f "$QADBAK_DIR/scripts/lib/repair-pogo-proxy.sh" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    bash "$QADBAK_DIR/scripts/lib/repair-pogo-proxy.sh" || warn "proxy repair failed"
  else
    warn "Run as root to refresh nginx: sudo bash $QADBAK_DIR/scripts/lib/repair-pogo-proxy.sh"
  fi
fi

# Workers only if APKs + token present
missing=0
[[ -f services/cosmog/apk/cosmog.apk ]] || { warn "Missing cosmog.apk"; missing=1; }
[[ -f services/cosmog/apk/pogo.apk ]] || { warn "Missing pogo.apk"; missing=1; }
if [[ -z "${COSMOG_TOKEN:-}" || "$COSMOG_TOKEN" == change-me* ]]; then
  warn "Set COSMOG_TOKEN in .env"
  missing=1
fi
if [[ -z "${SERVER_PUBLIC_IP:-}" || "$SERVER_PUBLIC_IP" == "127.0.0.1" ]]; then
  warn "Set SERVER_PUBLIC_IP in .env (Contabo IPv4)"
fi

if [[ "$missing" -eq 0 ]]; then
  log "==> Workers (Redroid + Cosmog)"
  if [[ "$(id -u)" -eq 0 ]]; then
    bash scripts/repair-pogo-workers.sh || warn "workers repair had issues"
  else
    warn "Re-run with sudo to start Redroid workers"
  fi
else
  warn "Skipping workers until APKs + COSMOG_TOKEN are set"
  log "    Place APKs in services/cosmog/apk/  OR set COSMOG_APK_URL / POGO_APK_URL"
fi

log ""
log "==> Status"
"${COMPOSE[@]}" ps || true
curl -sS -o /dev/null -w "dashboard :18080 → %{http_code}\n" http://127.0.0.1:18080/ 2>/dev/null || true
curl -sS -o /dev/null -w "reactmap  :18081 → %{http_code}\n" http://127.0.0.1:18081/ 2>/dev/null || true
curl -sS -o /dev/null -w "koji      :18082 → %{http_code}\n" http://127.0.0.1:18082/ 2>/dev/null || true
curl -sS -o /dev/null -w "rotom     :7072  → %{http_code}\n" http://127.0.0.1:7072/ 2>/dev/null || true
curl -sS -o /dev/null -w "golbat    :9001  → %{http_code}\n" http://127.0.0.1:9001/ 2>/dev/null || true

log ""
log "Koji login password = KOJI_BEARER_TOKEN from .env"
log "Dashboard accounts: https://pogo.inveil.net/"
log "OK — PoGo update finished"

#!/usr/bin/env bash
# Hard-try Redroid + Cosmog workers on this VPS (x86 or ARM64).
# Usage:
#   sudo bash scripts/repair-pogo-workers.sh
#   sudo bash scripts/repair-pogo-workers.sh --status
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODE="${1:-}"

log() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }

COMPOSE=(docker compose --profile mapping --profile workers)

if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

ARCH="$(uname -m)"
REDROID_IMAGE="${REDROID_IMAGE:-redroid/redroid:11.0.0-latest}"
INSTANCES="${REDROID_INSTANCES:-1}"

status_only() {
  log "==> Host arch: $ARCH"
  log "==> REDROID_IMAGE=$REDROID_IMAGE"
  lsmod | grep -E 'binder|ashmem' || warn "binder/ashmem not loaded — run setup-qadbak-host.sh"
  "${COMPOSE[@]}" ps || true
  log "==> APKs"
  ls -la services/cosmog/apk/*.apk 2>/dev/null || warn "No APKs in services/cosmog/apk/"
  log "==> Dragonite image/config"
  docker image inspect "${DRAGONITE_IMAGE:-ghcr.io/unownhash/dragonite-public:latest}" >/dev/null 2>&1 \
    || warn "Dragonite image not pulled — run scripts/install-dragonite.sh"
  ls -la config/rendered/dragonite.toml 2>/dev/null || warn "Missing config/rendered/dragonite.toml"
  if command -v adb >/dev/null 2>&1; then
    adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
    adb devices || true
    adb -s 127.0.0.1:5555 shell getprop ro.product.cpu.abi 2>/dev/null || true
    adb -s 127.0.0.1:5555 shell pm list packages 2>/dev/null | grep -Ei 'cosmog|pokemon|niantic' || true
  fi
  curl -sS -o /dev/null -w "rotom  :7072 → %{http_code}\n" http://127.0.0.1:7072/ 2>/dev/null || true
  curl -sS -o /dev/null -w "golbat :9001 → %{http_code}\n" http://127.0.0.1:9001/ 2>/dev/null || true
}

if [[ "$MODE" == "--status" ]]; then
  status_only
  exit 0
fi

log "==> PoGo workers hard-try on $ARCH"
log "    We use Redroid + Cosmog APKs — we do NOT rebuild Pokémon GO for x86."

if [[ "$(id -u)" -eq 0 ]]; then
  bash scripts/setup-qadbak-host.sh || warn "host prep had warnings"
else
  warn "Not root — skip setup-qadbak-host.sh (run with sudo for binder modules)"
fi

# Prefer 1 Redroid first on small x86 boxes
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
  if [[ "${INSTANCES}" -gt 1 ]] && [[ -z "${FORCE_MULTI_REDROID:-}" ]]; then
    log "==> x86: forcing REDROID_INSTANCES=1 for first hard-try (set FORCE_MULTI_REDROID=1 to override)"
    INSTANCES=1
  fi
fi

# Persist image + instance count + REDROID_HOSTS
HOSTS="redroid-1:5555"
if [[ "$INSTANCES" -ge 2 ]]; then
  HOSTS="redroid-1:5555,redroid-2:5555"
fi

python3 - <<PY
from pathlib import Path
import re
p=Path(".env")
t=p.read_text()
def upsert(text,k,v):
  if re.search(rf'^{k}=', text, re.M):
    return re.sub(rf'^{k}=.*$', f'{k}={v}', text, count=1, flags=re.M)
  return text.rstrip()+f"\n{k}={v}\n"
t=upsert(t,"REDROID_IMAGE","$REDROID_IMAGE")
t=upsert(t,"REDROID_INSTANCES","$INSTANCES")
t=upsert(t,"REDROID_HOSTS","$HOSTS")
p.write_text(t)
print("env: REDROID_IMAGE=$REDROID_IMAGE REDROID_INSTANCES=$INSTANCES REDROID_HOSTS=$HOSTS")
PY

bash scripts/render-config.sh || exit 1
bash scripts/ensure-databases.sh || warn "ensure-databases failed"

missing=0
if [[ ! -f services/cosmog/apk/cosmog.apk ]]; then
  warn "Missing services/cosmog/apk/cosmog.apk (Cosmog Discord + license)"
  missing=1
fi
if [[ ! -f services/cosmog/apk/pogo.apk ]]; then
  warn "Missing services/cosmog/apk/pogo.apk (matching PoGo arm64 APK)"
  missing=1
fi
if [[ -z "${COSMOG_TOKEN:-}" || "$COSMOG_TOKEN" == change-me* ]]; then
  warn "Set COSMOG_TOKEN in .env"
  missing=1
fi
if [[ -z "${SERVER_PUBLIC_IP:-}" || "$SERVER_PUBLIC_IP" == "127.0.0.1" ]]; then
  warn "Set SERVER_PUBLIC_IP to this VPS public IPv4 in .env"
fi

log "==> Pull / start control plane (rotom + golbat + dragonite)"
docker pull "${ROTOM_IMAGE:-ghcr.io/unownhash/rotom:main}" || warn "rotom pull failed"
docker pull ghcr.io/unownhash/golbat:main || warn "golbat pull failed"
docker pull "${DRAGONITE_IMAGE:-ghcr.io/unownhash/dragonite-public:latest}" || warn "dragonite pull failed"

"${COMPOSE[@]}" up -d rotom golbat || warn "rotom/golbat failed"
"${COMPOSE[@]}" up -d dragonite || warn "dragonite failed"

log "==> Start Redroid + worker-agent (+ houndour)"
# Reset install marker so APKs reinstall after new files
"${COMPOSE[@]}" run --rm --entrypoint rm worker-agent -f /app/.apks_installed 2>/dev/null || true
"${COMPOSE[@]}" up -d redroid-1 || warn "redroid-1 failed"
if [[ "$INSTANCES" -ge 2 ]]; then
  "${COMPOSE[@]}" up -d redroid-2 || warn "redroid-2 failed"
fi
"${COMPOSE[@]}" up -d worker-agent houndour || warn "worker-agent/houndour failed"

sleep 8
status_only

log ""
log "Next:"
log "  1) Fix any WARN above (APKs, COSMOG_TOKEN, SERVER_PUBLIC_IP)"
log "  2) docker compose --profile mapping --profile workers logs -f worker-agent redroid-1 rotom"
log "  3) When Cosmog connects, check Golbat DB / ReactMap for spawns"
log "Docs: docs/DEVICELESS-X86.md"
if [[ "$missing" -eq 1 ]]; then
  exit 2
fi
exit 0

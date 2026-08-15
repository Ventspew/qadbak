#!/usr/bin/env bash
# Push Exeggcute/GC config onto a jailbroken iPhone so it joins the same Rotom pool as Android.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Provision a jailbroken iPhone with Exeggcute/GC so it can join Rotom
alongside Android Cosmog workers.

Usage:
  bash scripts/provision-ios.sh --host 192.168.1.50 --device-id iphone-1
  bash scripts/provision-ios.sh --usb --device-id iphone-1

Options:
  --host HOST           iPhone IP (LAN SSH)
  --usb                 USB via iproxy (localhost)
  --port PORT           SSH port (LAN default 22, USB default 2222)
  --device-port PORT    Device SSH port when using --usb (default 22; palera1n USB often 44)
  --user USER           SSH user (default: root)
  --password PASS       SSH password (default: IOS_SSH_PASSWORD or alpine)
  --device-id NAME      Unique Rotom/Exeggcute name (default: ios-<host>)
  --workers N           Exeggcute workers (default: 4)
  --skip-packages       Do not install gc.deb / pogo.ipa
  --no-respring         Do not run sbreload after pushing config
  -h, --help            Show this help
EOF
}

HOST=""
USB=0
PORT=""
DEVICE_PORT="22"
USER_NAME="root"
PASSWORD=""
DEVICE_ID=""
WORKERS=""
SKIP_PACKAGES=0
NO_RESPRING=0
IPROXY_PID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    --usb) USB=1; shift ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --device-port) DEVICE_PORT="${2:-}"; shift 2 ;;
    --user) USER_NAME="${2:-}"; shift 2 ;;
    --password) PASSWORD="${2:-}"; shift 2 ;;
    --device-id) DEVICE_ID="${2:-}"; shift 2 ;;
    --workers) WORKERS="${2:-}"; shift 2 ;;
    --skip-packages) SKIP_PACKAGES=1; shift ;;
    --no-respring) NO_RESPRING=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

cleanup() {
  if [ -n "$IPROXY_PID" ] && kill -0 "$IPROXY_PID" 2>/dev/null; then
    kill "$IPROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and set EXEGGCUTE_API_KEY, ROTOM_SECRET, SERVER_PUBLIC_IP."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

PASSWORD="${PASSWORD:-${IOS_SSH_PASSWORD:-alpine}}"
WORKERS="${WORKERS:-${IOS_WORKERS_PER_DEVICE:-4}}"

if [ "$USB" -eq 1 ]; then
  HOST="127.0.0.1"
  PORT="${PORT:-2222}"
  if ! command -v iproxy >/dev/null 2>&1; then
    echo "iproxy not found. On macOS: brew install libimobiledevice"
    exit 1
  fi
  echo "Starting iproxy $PORT -> device:$DEVICE_PORT ..."
  iproxy "$PORT" "$DEVICE_PORT" >/dev/null 2>&1 &
  IPROXY_PID=$!
  sleep 1
elif [ -z "$HOST" ]; then
  echo "Pass --host <iphone-ip> or --usb"
  usage >&2
  exit 1
else
  PORT="${PORT:-22}"
fi

if [ -z "$DEVICE_ID" ]; then
  if [ "$USB" -eq 1 ]; then
    DEVICE_ID="ios-iphone"
  else
    DEVICE_ID="ios-${HOST}"
  fi
fi
DEVICE_ID="$(echo "$DEVICE_ID" | tr ' [:upper:]' '-[:lower:]' | tr -cd 'a-z0-9._-' | tr -s '-' | sed 's/-$//')"

PUBLIC_IP="${SERVER_PUBLIC_IP:-}"
PUBLIC_WS="${ROTOM_PUBLIC_WS:-}"
if [ -z "$PUBLIC_WS" ]; then
  if [ -z "$PUBLIC_IP" ] || [ "$PUBLIC_IP" = "127.0.0.1" ] || [ "$PUBLIC_IP" = "localhost" ]; then
    LAN_IP=""
    if command -v ipconfig >/dev/null 2>&1; then
      LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    fi
    echo "SERVER_PUBLIC_IP is localhost. An iPhone cannot reach Rotom at 127.0.0.1."
    if [ -n "$LAN_IP" ]; then
      echo "Set in .env: SERVER_PUBLIC_IP=$LAN_IP"
      echo "             ROTOM_PUBLIC_WS=ws://$LAN_IP:7070"
    fi
    exit 1
  fi
  PUBLIC_WS="ws://${PUBLIC_IP}:7070"
fi
PUBLIC_WS="${PUBLIC_WS%/}"

if [ -z "${EXEGGCUTE_API_KEY:-}" ] || [ "${EXEGGCUTE_API_KEY}" = "change-me-exeggcute-key" ]; then
  echo "Set EXEGGCUTE_API_KEY in .env (Exeggcute/GC dashboard or Discord)."
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10)
SSH_TARGET="${USER_NAME}@${HOST}"

run_ssh() {
  if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "$PASSWORD" ssh "${SSH_OPTS[@]}" -p "$PORT" "$SSH_TARGET" "$@"
  else
    ssh "${SSH_OPTS[@]}" -p "$PORT" "$SSH_TARGET" "$@"
  fi
}

run_scp() {
  if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "$PASSWORD" scp "${SSH_OPTS[@]}" -P "$PORT" "$1" "${SSH_TARGET}:$2"
  else
    scp "${SSH_OPTS[@]}" -P "$PORT" "$1" "${SSH_TARGET}:$2"
  fi
}

if ! command -v sshpass >/dev/null 2>&1; then
  echo "Tip: brew install hudochenkov/sshpass/sshpass  (or esolitos/ipa/sshpass) for non-interactive SSH."
  echo "Trying SSH; you may be prompted for the password (default jailbreak password is alpine)."
fi

echo "Checking SSH ${SSH_TARGET}:${PORT} ..."
if command -v sshpass >/dev/null 2>&1; then
  sshpass -p "$PASSWORD" ssh "${SSH_OPTS[@]}" -p "$PORT" "$SSH_TARGET" "uname -s && sw_vers -productVersion 2>/dev/null || true"
else
  ssh "${SSH_OPTS[@]}" -p "$PORT" "$SSH_TARGET" "uname -s && sw_vers -productVersion 2>/dev/null || true"
fi

bash scripts/render-config.sh >/dev/null

python3 - <<PY
import json, os, pathlib, copy

root = pathlib.Path("$ROOT")
template = json.loads((root / "config/exeggcute/ios.json.template").read_text())
cfg = copy.deepcopy(template)
cfg["device_name"] = "$DEVICE_ID"
cfg["rotom_url"] = "$PUBLIC_WS"
cfg["rotom_secret"] = os.environ.get("ROTOM_SECRET", "change-me")
cfg["api_key"] = os.environ.get("EXEGGCUTE_API_KEY", "change-me")
cfg["workers_count"] = int("$WORKERS")
out_dir = root / "config/exeggcute/rendered"
out_dir.mkdir(parents=True, exist_ok=True)
out = out_dir / f"ios-{cfg['device_name']}.json"
out.write_text(json.dumps(cfg, indent=2) + "\n")
print(f"Wrote {out}")
PY

CFG="config/exeggcute/rendered/ios-${DEVICE_ID}.json"
REMOTE_DIR="/var/mobile/Application Support/GoCheats"
ROOTLESS_DIR="/var/jb/var/mobile/Application Support/GoCheats"

echo "Pushing $CFG → ${REMOTE_DIR}/config.json"
run_ssh "mkdir -p \"$REMOTE_DIR\""
run_scp "$CFG" "/tmp/exeggcute-config.json"
run_ssh "cp /tmp/exeggcute-config.json \"$REMOTE_DIR/config.json\"; chown -R mobile:mobile \"$REMOTE_DIR\" 2>/dev/null || true"
run_ssh "if [ -d /var/jb ]; then mkdir -p \"$ROOTLESS_DIR\"; cp /tmp/exeggcute-config.json \"$ROOTLESS_DIR/config.json\"; chown -R mobile:mobile \"$ROOTLESS_DIR\" 2>/dev/null || true; fi" || true

if [ "$SKIP_PACKAGES" -eq 0 ]; then
  DEB_DIR="services/exeggcute/debs"
  IPA="services/exeggcute/ipa/pogo.ipa"
  if [ -d "$DEB_DIR" ] && [ "$(ls -A "$DEB_DIR"/*.deb 2>/dev/null || true)" ]; then
    echo "Installing .deb packages from $DEB_DIR ..."
    run_ssh "mkdir -p /tmp/pogo-debs"
    for deb in "$DEB_DIR"/*.deb; do
      run_scp "$deb" "/tmp/pogo-debs/$(basename "$deb")"
    done
    run_ssh "dpkg -i /tmp/pogo-debs/*.deb || apt-get install -f -y; rm -rf /tmp/pogo-debs" || true
  else
    echo "No gc.deb in services/exeggcute/debs/ — install Exeggcute/GC from Sileo first."
  fi
  if [ -f "$IPA" ]; then
    if command -v ideviceinstaller >/dev/null 2>&1 && [ "$USB" -eq 1 ]; then
      echo "Installing Pokémon GO IPA via ideviceinstaller ..."
      ideviceinstaller -i "$IPA" || true
    else
      echo "pogo.ipa present but ideviceinstaller needs USB. Install Pokémon GO on the device, or brew install ideviceinstaller and re-run with --usb."
    fi
  fi
fi

if [ "$NO_RESPRING" -eq 0 ]; then
  echo "Respringing ..."
  run_ssh "sbreload || killall -9 SpringBoard" || true
fi

cat <<EOF

Device '$DEVICE_ID' is provisioned (Exeggcute/GC).

Rotom websocket:  $PUBLIC_WS
Workers:          $WORKERS
Config on device: $REMOTE_DIR/config.json

This iPhone joins the SAME Rotom worker pool as Android Cosmog devices.

Checklist:
  1. Mapping stack is up (Rotom :7070 reachable from the phone)
  2. Exeggcute/GC tweak is installed (Sileo) and Pokémon GO is installed
  3. Dashboard → Devices should show this id next to Android workers
  4. Change the default SSH password (alpine) if you have not already

EOF

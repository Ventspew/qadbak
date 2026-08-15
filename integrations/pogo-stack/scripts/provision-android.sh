#!/usr/bin/env bash
# Install Cosmog on a physical Android phone/ATV and point it at Rotom.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Provision a physical Android device with Cosmog so it can join Rotom.

Usage:
  bash scripts/provision-android.sh [options]

Options:
  --serial SERIAL       ADB serial (default: first connected device)
  --connect HOST:PORT   Run `adb connect` first (wireless debugging)
  --device-id NAME      Unique Rotom/Cosmog name (default: android-<model>)
  --workers N           Cosmog workers on this device (default: 8)
  --skip-apk            Do not reinstall Cosmog / Pokémon GO APKs
  --no-launch           Push config only; do not start Cosmog
  -h, --help            Show this help

Examples:
  bash scripts/provision-android.sh
  bash scripts/provision-android.sh --device-id pixel-1 --workers 6
  bash scripts/provision-android.sh --connect 192.168.1.42:5555 --device-id atv-1
EOF
}

SERIAL=""
CONNECT=""
DEVICE_ID=""
WORKERS=""
SKIP_APK=0
NO_LAUNCH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --serial) SERIAL="${2:-}"; shift 2 ;;
    --connect) CONNECT="${2:-}"; shift 2 ;;
    --device-id) DEVICE_ID="${2:-}"; shift 2 ;;
    --workers) WORKERS="${2:-}"; shift 2 ;;
    --skip-apk) SKIP_APK=1; shift ;;
    --no-launch) NO_LAUNCH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and set COSMOG_TOKEN, ROTOM_SECRET, SERVER_PUBLIC_IP."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. On macOS: brew install android-platform-tools"
  echo "On Ubuntu: sudo apt-get install -y adb"
  exit 1
fi

COSMOG_APK="services/cosmog/apk/cosmog.apk"
POGO_APK="services/cosmog/apk/pogo.apk"
LIBS_DIR="services/cosmog/apk/libs"

if [ ! -f "$COSMOG_APK" ]; then
  echo "Missing $COSMOG_APK"
  echo "Download Cosmog from the Cosmog Discord (#apk-releases) and place it there."
  exit 1
fi

PUBLIC_IP="${SERVER_PUBLIC_IP:-}"
PUBLIC_WS="${ROTOM_PUBLIC_WS:-}"
if [ -z "$PUBLIC_WS" ]; then
  if [ -z "$PUBLIC_IP" ] || [ "$PUBLIC_IP" = "127.0.0.1" ] || [ "$PUBLIC_IP" = "localhost" ]; then
    LAN_IP=""
    if command -v ipconfig >/dev/null 2>&1; then
      LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    fi
    if [ -z "$LAN_IP" ] && command -v hostname >/dev/null 2>&1; then
      LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    fi
    echo "SERVER_PUBLIC_IP is localhost. A phone cannot reach Rotom at 127.0.0.1."
    if [ -n "$LAN_IP" ]; then
      echo "Set in .env, then re-run:"
      echo "  SERVER_PUBLIC_IP=$LAN_IP"
      echo "  ROTOM_PUBLIC_WS=ws://$LAN_IP:7070"
    else
      echo "Set SERVER_PUBLIC_IP (LAN or public IP of the host that runs Rotom) in .env."
    fi
    exit 1
  fi
  PUBLIC_WS="ws://${PUBLIC_IP}:7070"
fi
PUBLIC_WS="${PUBLIC_WS%/}"
WORKERS="${WORKERS:-${ANDROID_WORKERS_PER_DEVICE:-8}}"

adb start-server >/dev/null 2>&1 || true

if [ -n "$CONNECT" ]; then
  echo "Connecting wireless ADB $CONNECT ..."
  adb connect "$CONNECT"
  SERIAL="${SERIAL:-$CONNECT}"
fi

pick_serial() {
  if [ -n "$SERIAL" ]; then
    echo "$SERIAL"
    return
  fi
  local lines
  lines="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
  local count
  count="$(printf '%s\n' "$lines" | awk 'NF' | wc -l | tr -d ' ')"
  if [ "$count" = "0" ]; then
    echo ""
    return
  fi
  printf '%s\n' "$lines" | awk 'NF' | head -n 1
}

SERIAL="$(pick_serial)"
if [ -z "$SERIAL" ]; then
  echo "No Android device found."
  echo "1. Enable Developer options → USB debugging (and Wireless debugging if remote)."
  echo "2. Plug in USB, accept the RSA prompt on the phone, then re-run."
  echo "   adb devices"
  exit 1
fi

echo "Using ADB serial: $SERIAL"
adb -s "$SERIAL" wait-for-device

MODEL="$(adb -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r' | tr ' [:upper:]' '-[:lower:]' | tr -cd 'a-z0-9._-' || true)"
ANDROID_VER="$(adb -s "$SERIAL" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r' || true)"
ABI="$(adb -s "$SERIAL" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r' || true)"
echo "Device: ${MODEL:-unknown}  Android ${ANDROID_VER:-?}  ABI ${ABI:-?}"

if [ -z "$DEVICE_ID" ]; then
  DEVICE_ID="android-${MODEL:-device}"
fi
DEVICE_ID="$(echo "$DEVICE_ID" | tr ' [:upper:]' '-[:lower:]' | tr -cd 'a-z0-9._-' | tr -s '-' | sed 's/-$//')"

bash scripts/render-config.sh >/dev/null

python3 - <<PY
import json, os, pathlib, copy

root = pathlib.Path("$ROOT")
template = json.loads((root / "config/cosmog/android.json.template").read_text())
cfg = copy.deepcopy(template)
cfg["device_id"] = os.environ.get("DEVICE_ID", "$DEVICE_ID")
cfg["device_id"] = "$DEVICE_ID"
cfg["rotom_worker_endpoint"] = "$PUBLIC_WS"
cfg["rotom_device_endpoint"] = "$PUBLIC_WS/control"
cfg["public_ip"] = os.environ.get("SERVER_PUBLIC_IP", "$PUBLIC_IP")
cfg["token"] = os.environ.get("COSMOG_TOKEN", "change-me")
cfg["rotom_secret"] = os.environ.get("ROTOM_SECRET", "change-me")
cfg["workers"] = int("$WORKERS")
out = root / "config/cosmog/rendered" / f"android-{cfg['device_id']}.json"
out.write_text(json.dumps(cfg, indent=2) + "\n")
print(f"Wrote {out}")
PY

CFG="config/cosmog/rendered/android-${DEVICE_ID}.json"

if [ "$SKIP_APK" -eq 0 ]; then
  echo "Installing Cosmog ..."
  adb -s "$SERIAL" install -r "$COSMOG_APK"
  if [ -f "$POGO_APK" ]; then
    echo "Installing Pokémon GO APK from repo ..."
    adb -s "$SERIAL" install -r "$POGO_APK" || true
  else
    echo "No pogo.apk in services/cosmog/apk/ — install Pokémon GO from Play Store on the device (preferred for Play Integrity)."
  fi
fi

echo "Starting Cosmog once so its data dir exists ..."
adb -s "$SERIAL" shell monkey -p com.sy1vi3.cosmog -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
  || adb -s "$SERIAL" shell am start -n com.sy1vi3.cosmog/.MainActivity >/dev/null 2>&1 \
  || true
sleep 2

echo "Pushing $CFG → /data/local/tmp/cosmog.json"
adb -s "$SERIAL" push "$CFG" /data/local/tmp/cosmog.json
adb -s "$SERIAL" shell chmod 666 /data/local/tmp/cosmog.json

if [ -d "$LIBS_DIR" ] && [ "$(ls -A "$LIBS_DIR" 2>/dev/null || true)" ]; then
  echo "Pushing Cosmog libraries from $LIBS_DIR ..."
  adb -s "$SERIAL" shell mkdir -p /data/data/com.sy1vi3.cosmog/files || true
  adb -s "$SERIAL" push "$LIBS_DIR/." /data/data/com.sy1vi3.cosmog/files/ || true
  adb -s "$SERIAL" shell chmod -R 777 /data/data/com.sy1vi3.cosmog/files || true
fi

if [ "$NO_LAUNCH" -eq 0 ]; then
  echo "Launching Cosmog ..."
  adb -s "$SERIAL" shell am start -n com.sy1vi3.cosmog/.MainActivity >/dev/null 2>&1 \
    || adb -s "$SERIAL" shell monkey -p com.sy1vi3.cosmog -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
    || true
fi

cat <<EOF

Device '$DEVICE_ID' is provisioned.

Rotom websocket:  $PUBLIC_WS
Workers:          $WORKERS
Config on device: /data/local/tmp/cosmog.json

Checklist:
  1. Mapping stack is up:  docker compose --profile mapping up -d
  2. Port 7070 on the Rotom host is reachable from this phone (LAN or public IP).
  3. Magisk is installed; hide it from Pokémon GO / Cosmog workers (see Cosmog Discord).
  4. Add scanner accounts in the dashboard, then watch Rotom:
       Dashboard → Android devices
       http://127.0.0.1:${ROTOM_UI_PORT:-7072}

If Cosmog stays disconnected, from the phone's network test:
  nc -vz ${PUBLIC_IP:-rotom-host} ${ROTOM_DEVICE_PORT:-7070}

EOF

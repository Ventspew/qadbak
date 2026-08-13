#!/usr/bin/env bash
set -euo pipefail

adb start-server >/dev/null 2>&1 || true

hosts="${REDROID_HOSTS:-redroid-1:5555}"
IFS=',' read -ra HOST_LIST <<< "$hosts"

connect_all() {
  for host in "${HOST_LIST[@]}"; do
    host="$(echo "$host" | xargs)"
    [ -z "$host" ] && continue
    adb connect "$host" >/dev/null 2>&1 || adb connect "$host" || true
  done
}

push_configs() {
  local idx=1
  for host in "${HOST_LIST[@]}"; do
    host="$(echo "$host" | xargs)"
    [ -z "$host" ] && continue
    cfg="${CONFIG_DIR}/${idx}.json"
    if [ -f "$cfg" ]; then
      adb -s "$host" push "$cfg" /data/local/tmp/cosmog.json >/dev/null 2>&1 || \
        adb -s "$host" push "$cfg" /data/local/tmp/cosmog.json || true
      adb -s "$host" shell chmod 666 /data/local/tmp/cosmog.json 2>/dev/null || true
    fi
    idx=$((idx + 1))
  done
}

install_apks_once() {
  local marker="/app/.apks_installed"
  [ -f "$marker" ] && return 0

  cosmog="${APK_DIR}/cosmog.apk"
  pogo="${APK_DIR}/pogo.apk"
  if [ ! -f "$cosmog" ]; then
    echo "Place Cosmog APK at services/cosmog/apk/cosmog.apk (from Cosmog Discord)."
    return 0
  fi

  connect_all
  for host in "${HOST_LIST[@]}"; do
    host="$(echo "$host" | xargs)"
    [ -z "$host" ] && continue
    echo "Installing APKs on $host ..."
    adb -s "$host" wait-for-device
    echo "Device ABI: $(adb -s "$host" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r')"
    echo "Supported ABIs: $(adb -s "$host" shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r')"
    if ! adb -s "$host" install -r "$cosmog"; then
      echo "ERROR: cosmog.apk install failed on $host (often ABI mismatch on x86 Redroid)."
    fi
    if [ -f "$pogo" ]; then
      if ! adb -s "$host" install -r "$pogo"; then
        echo "ERROR: pogo.apk install failed on $host (need Cosmog-matching arm64 build + translation)."
      fi
    else
      echo "WARN: pogo.apk missing — Cosmog needs Pokémon GO installed."
    fi
    adb -s "$host" shell pm list packages 2>/dev/null | grep -Ei 'cosmog|pokemon|niantic' || true
  done
  touch "$marker"
}

launch_cosmog() {
  for host in "${HOST_LIST[@]}"; do
    host="$(echo "$host" | xargs)"
    [ -z "$host" ] && continue
    adb -s "$host" shell am start -n com.sy1vi3.cosmog/.MainActivity 2>/dev/null || true
  done
}

echo "Worker agent started. Hosts: $hosts"
install_apks_once

while true; do
  connect_all
  push_configs
  launch_cosmog
  sleep "${PUSH_INTERVAL:-60}"
done

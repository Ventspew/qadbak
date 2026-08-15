#!/usr/bin/env bash
set -euo pipefail

adb start-server >/dev/null 2>&1 || true

hosts="${REDROID_HOSTS:-}"
android_devices="${ANDROID_DEVICES:-}"
IFS=',' read -ra HOST_LIST <<< "$hosts"

# ANDROID_DEVICES format: "pixel-1@192.168.1.40:5555,atv-1@192.168.1.41:5555"
# or a bare host:port (config file android-<sanitized>.json)
declare -a ANDROID_HOSTS=()
declare -a ANDROID_IDS=()

parse_android_devices() {
  local entry host device_id
  IFS=',' read -ra raw <<< "$android_devices"
  for entry in "${raw[@]}"; do
    entry="$(echo "$entry" | xargs)"
    [ -z "$entry" ] && continue
    if [[ "$entry" == *"@"* ]]; then
      device_id="${entry%%@*}"
      host="${entry#*@}"
    else
      host="$entry"
      device_id="$(echo "$host" | tr '.:' '--')"
    fi
    ANDROID_HOSTS+=("$host")
    ANDROID_IDS+=("$device_id")
  done
}

parse_android_devices

connect_redroid() {
  local host
  for host in "${HOST_LIST[@]}"; do
    host="$(echo "$host" | xargs)"
    [ -z "$host" ] && continue
    adb connect "$host" >/dev/null 2>&1 || adb connect "$host" || true
  done
}

connect_android() {
  local host
  for host in "${ANDROID_HOSTS[@]+"${ANDROID_HOSTS[@]}"}"; do
    [ -z "$host" ] && continue
    adb connect "$host" >/dev/null 2>&1 || adb connect "$host" || true
  done
}

push_redroid_configs() {
  local idx=1 host cfg
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

push_android_configs() {
  local i host cfg device_id
  for i in "${!ANDROID_HOSTS[@]}"; do
    host="${ANDROID_HOSTS[$i]}"
    device_id="${ANDROID_IDS[$i]}"
    cfg="${CONFIG_DIR}/android-${device_id}.json"
    if [ ! -f "$cfg" ]; then
      echo "No config for $device_id ($cfg) — run scripts/render-config.sh"
      continue
    fi
    adb -s "$host" push "$cfg" /data/local/tmp/cosmog.json >/dev/null 2>&1 || \
      adb -s "$host" push "$cfg" /data/local/tmp/cosmog.json || true
    adb -s "$host" shell chmod 666 /data/local/tmp/cosmog.json 2>/dev/null || true
  done
}

install_apks_on() {
  local host="$1"
  local cosmog="${APK_DIR}/cosmog.apk"
  local pogo="${APK_DIR}/pogo.apk"
  [ ! -f "$cosmog" ] && return 0
  echo "Installing APKs on $host ..."
  adb -s "$host" wait-for-device || true
  adb -s "$host" install -r "$cosmog" || true
  if [ -f "$pogo" ]; then
    adb -s "$host" install -r "$pogo" || true
  fi
}

install_apks_once() {
  local marker="/app/.apks_installed"
  [ -f "$marker" ] && return 0

  local cosmog="${APK_DIR}/cosmog.apk"
  if [ ! -f "$cosmog" ]; then
    echo "Place Cosmog APK at services/cosmog/apk/cosmog.apk (from Cosmog Discord)."
    return 0
  fi

  connect_redroid
  connect_android
  local host
  for host in "${HOST_LIST[@]}"; do
    host="$(echo "$host" | xargs)"
    [ -z "$host" ] && continue
    install_apks_on "$host"
  done
  for host in "${ANDROID_HOSTS[@]+"${ANDROID_HOSTS[@]}"}"; do
    [ -z "$host" ] && continue
    install_apks_on "$host"
  done
  touch "$marker"
}

launch_cosmog_on() {
  local host="$1"
  adb -s "$host" shell am start -n com.sy1vi3.cosmog/.MainActivity 2>/dev/null || true
}

launch_all() {
  local host
  for host in "${HOST_LIST[@]}"; do
    host="$(echo "$host" | xargs)"
    [ -z "$host" ] && continue
    launch_cosmog_on "$host"
  done
  for host in "${ANDROID_HOSTS[@]+"${ANDROID_HOSTS[@]}"}"; do
    [ -z "$host" ] && continue
    launch_cosmog_on "$host"
  done
}

echo "Worker agent started."
echo "  Redroid hosts: ${hosts:-<none>}"
echo "  Android devices: ${android_devices:-<none>}"

if [ -z "$hosts" ] && [ -z "$android_devices" ]; then
  echo "No REDROID_HOSTS or ANDROID_DEVICES set."
  echo "USB phones: run bash scripts/provision-android.sh on a machine with ADB."
  echo "Wireless: set ANDROID_DEVICES=pixel-1@192.168.1.40:5555 and restart this agent."
  while true; do sleep 3600; done
fi

install_apks_once

while true; do
  connect_redroid
  connect_android
  push_redroid_configs
  push_android_configs
  launch_all
  sleep "${PUSH_INTERVAL:-60}"
done

#!/usr/bin/env bash
set -euo pipefail

# IOS_DEVICES format: "iphone-1@192.168.1.50:22,ipad-1@192.168.1.51:22"
devices="${IOS_DEVICES:-}"
user="${IOS_SSH_USER:-root}"
interval="${PUSH_INTERVAL:-60}"
config_dir="${CONFIG_DIR:-/configs}"
remote_dir="/var/mobile/Application Support/GoCheats"
rootless_dir="/var/jb/var/mobile/Application Support/GoCheats"
ssh_opts="-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8"

ssh_base() {
  local host="$1" port="$2"
  shift 2
  if [ -n "${IOS_SSH_PASSWORD:-}" ]; then
    sshpass -p "$IOS_SSH_PASSWORD" ssh $ssh_opts -p "$port" "${user}@${host}" "$@"
  else
    ssh $ssh_opts -p "$port" "${user}@${host}" "$@"
  fi
}

scp_base() {
  local host="$1" port="$2" src="$3" dest="$4"
  if [ -n "${IOS_SSH_PASSWORD:-}" ]; then
    sshpass -p "$IOS_SSH_PASSWORD" scp $ssh_opts -P "$port" "$src" "${user}@${host}:${dest}"
  else
    scp $ssh_opts -P "$port" "$src" "${user}@${host}:${dest}"
  fi
}

push_one() {
  local device_id="$1" host="$2" port="$3"
  local cfg="${config_dir}/ios-${device_id}.json"
  if [ ! -f "$cfg" ]; then
    echo "No config for $device_id ($cfg) — run scripts/render-config.sh"
    return 0
  fi
  echo "Pushing Exeggcute config to $device_id ($host:$port) ..."
  ssh_base "$host" "$port" "mkdir -p \"$remote_dir\"; mkdir -p \"$rootless_dir\" 2>/dev/null || true" || true
  scp_base "$host" "$port" "$cfg" "/tmp/exeggcute-config.json" || return 0
  ssh_base "$host" "$port" "cp /tmp/exeggcute-config.json \"$remote_dir/config.json\"; chown -R mobile:mobile \"$remote_dir\" 2>/dev/null || true; if [ -d /var/jb ]; then mkdir -p \"$rootless_dir\"; cp /tmp/exeggcute-config.json \"$rootless_dir/config.json\"; chown -R mobile:mobile \"$rootless_dir\" 2>/dev/null || true; fi" || true
}

echo "iOS agent started. Devices: ${devices:-<none>}"

if [ -z "$devices" ]; then
  echo "No IOS_DEVICES set. USB phones: run bash scripts/provision-ios.sh on a Mac with iproxy."
  echo "Wireless: set IOS_DEVICES=iphone-1@192.168.1.50:22 and restart this agent."
  while true; do sleep 3600; done
fi

while true; do
  IFS=',' read -ra raw <<< "$devices"
  for entry in "${raw[@]}"; do
    entry="$(echo "$entry" | xargs)"
    [ -z "$entry" ] && continue
    device_id="${entry%%@*}"
    rest="${entry#*@}"
    host="${rest%%:*}"
    port="${rest##*:}"
    if [ "$port" = "$rest" ]; then
      port="22"
    fi
    push_one "$device_id" "$host" "$port"
  done
  sleep "$interval"
done

#!/usr/bin/env bash
# Prepare Ubuntu/Debian host (Qadbak VPS) for Redroid + Cosmog deviceless workers.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/setup-qadbak-host.sh"
  exit 1
fi

echo "==> Installing host packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  adb \
  curl \
  jq \
  kmod \
  linux-modules-extra-"$(uname -r)" 2>/dev/null || apt-get install -y linux-modules-extra-generic

echo "==> Loading kernel modules for Redroid..."
modprobe binder_linux devices="binder,hwbinder,vndbinder" 2>/dev/null || modprobe binder_linux 2>/dev/null || true
modprobe ashmem_linux 2>/dev/null || true

cat >/etc/modules-load.d/pogo-redroid.conf <<'EOF'
binder_linux
ashmem_linux
EOF

cat >/etc/modprobe.d/pogo-redroid.conf <<'EOF'
options binder_linux devices="binder,hwbinder,vndbinder"
EOF

if ! grep -q 'binder_linux' /proc/modules 2>/dev/null && ! lsmod | grep -q binder; then
  echo "WARNING: binder module not loaded. Redroid requires binder_linux + ashmem_linux."
  echo "         Use an ARM64 (Ampere) Ubuntu 22.04/24.04 VPS for Cosmog deviceless."
fi

ARCH="$(uname -m)"
echo "==> Host architecture: $ARCH"
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
  echo "WARNING: Cosmog deviceless expects ARM64 (Ampere). x86 hosts cannot run PoGo workers in Redroid."
  echo "         Core stack (dashboard + account API) still works; use --full only on ARM64."
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Install via Qadbak:"
  echo "  bash /opt/qadbak/scripts/lib/ensure-docker.sh"
fi

echo "==> Host setup complete."

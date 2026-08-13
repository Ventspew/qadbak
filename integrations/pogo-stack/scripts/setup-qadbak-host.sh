#!/usr/bin/env bash
# Prepare Ubuntu/Debian host (Qadbak VPS) for Redroid + Cosmog workers.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/setup-qadbak-host.sh"
  exit 1
fi

echo "==> Installing host packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y adb curl jq kmod
apt-get install -y "linux-modules-extra-$(uname -r)" \
  || apt-get install -y linux-modules-extra-generic \
  || true

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
  echo "WARNING: binder_linux is not loaded. Redroid needs binder_linux (and ashmem_linux on older kernels)."
  echo "         Install linux-modules-extra-$(uname -r) and reboot if the module is missing."
fi

ARCH="$(uname -m)"
echo "==> Host architecture: $ARCH"
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  echo "ARM64: Cosmog workers use the Magisk Redroid image."
else
  echo "x86: official Redroid amd64 is used so Full can start on this VPS."
  echo "     Cosmog/PoGo ARM APKs are more reliable on ARM64 Ampere hosts."
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Install via Qadbak:"
  echo "  bash /opt/qadbak/scripts/lib/ensure-docker.sh"
fi

echo "==> Host setup complete."

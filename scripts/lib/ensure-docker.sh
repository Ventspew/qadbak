#!/usr/bin/env bash
# Install Docker Engine + Compose plugin for Qadbak apps (Jellyfin, Minecraft, runtimes).
# Debian/Ubuntu via apt (docker.io) with Docker CE repo fallback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=linux-distro.sh
source "$SCRIPT_DIR/linux-distro.sh"

export PATH="/usr/bin:/usr/local/bin:/bin:${PATH:-}"

docker_ok() {
  command -v docker &>/dev/null && docker info &>/dev/null 2>&1
}

start_docker() {
  systemctl enable docker 2>/dev/null || true
  systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true
}

if docker_ok; then
  exit 0
fi

# Binary present but daemon down — start it instead of reinstalling.
if command -v docker &>/dev/null; then
  start_docker
  if docker_ok; then
    exit 0
  fi
  echo "Docker is installed but the daemon is not running. Check: systemctl status docker" >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/lib/ensure-docker.sh" >&2
  exit 1
fi

qadbak_load_os_release || true

install_compose_plugin() {
  apt-get install -y docker-compose-plugin \
    || apt-get install -y docker-compose-v2 \
    || apt-get install -y docker-compose \
    || return 1
}

compose_ok() {
  docker compose version &>/dev/null 2>&1 || docker-compose version &>/dev/null 2>&1
}

install_docker_official() {
  export DEBIAN_FRONTEND=noninteractive
  local os_id="${QADBAK_OS_ID:-ubuntu}"
  local codename="${QADBAK_OS_CODENAME:-}"
  case "$os_id" in
    debian) os_id=debian ;;
    *) os_id=ubuntu ;;
  esac
  if [[ -z "$codename" && -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    codename="${VERSION_CODENAME:-}"
  fi
  if [[ -z "$codename" ]]; then
    echo "Cannot determine OS codename for Docker CE repo." >&2
    return 1
  fi
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${os_id}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${os_id} ${codename} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

case "${QADBAK_PKG_MGR:-}" in
  apt)
    export DEBIAN_FRONTEND=noninteractive
    qadbak_pkg_update || apt-get update -qq
    # docker-compose-plugin is not in stock Ubuntu/Debian repos (only Docker CE).
    # Installing it together with docker.io used to fail the whole transaction
    # while the helper still reported success.
    if ! apt-cache show docker.io &>/dev/null; then
      echo "docker.io not in apt — enabling universe and retrying" >&2
      add-apt-repository -y universe 2>/dev/null || true
      apt-get update -qq || true
    fi
    if apt-get install -y docker.io; then
      install_compose_plugin || true
      if ! compose_ok; then
        echo "Compose plugin missing — installing Docker CE (includes compose plugin)" >&2
        install_docker_official
      fi
    else
      echo "apt docker.io failed — installing Docker CE from download.docker.com" >&2
      install_docker_official
    fi
    start_docker
    ;;
  dnf)
    dnf install -y docker docker-compose-plugin 2>/dev/null || dnf install -y docker
    start_docker
    ;;
  *)
    echo "Install Docker manually on this OS (${QADBAK_OS_PRETTY_NAME:-unknown}), then retry." >&2
    exit 1
    ;;
esac

hash -r 2>/dev/null || true

if ! command -v docker &>/dev/null; then
  echo "Docker install failed: docker binary not on PATH after package install." >&2
  exit 1
fi

start_docker
if ! docker info &>/dev/null 2>&1; then
  echo "Docker is installed but the daemon did not start. Check: journalctl -u docker -n 50" >&2
  exit 1
fi

if ! compose_ok; then
  echo "Docker Compose is not available after install. Check: docker compose version" >&2
  exit 1
fi

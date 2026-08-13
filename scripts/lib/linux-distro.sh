#!/usr/bin/env bash
# Linux distro detection for Qadbak install scripts.
# Supported native stack: Ubuntu 22.04/24.04/26.04 LTS, Debian 12 (Bookworm).
# shellcheck shell=bash

QADBAK_OS_ID="${QADBAK_OS_ID:-}"
QADBAK_OS_VERSION_ID="${QADBAK_OS_VERSION_ID:-}"
QADBAK_OS_CODENAME="${QADBAK_OS_CODENAME:-}"
QADBAK_OS_PRETTY_NAME="${QADBAK_OS_PRETTY_NAME:-}"
QADBAK_PKG_MGR="${QADBAK_PKG_MGR:-}"

qadbak_load_os_release() {
  QADBAK_OS_ID=""
  QADBAK_OS_VERSION_ID=""
  QADBAK_OS_CODENAME=""
  QADBAK_OS_PRETTY_NAME=""
  QADBAK_PKG_MGR=""
  local release_file="${QADBAK_OS_RELEASE_FILE:-/etc/os-release}"
  if [[ ! -f "$release_file" ]]; then
    return 1
  fi
  # shellcheck disable=SC1090
  . "$release_file"
  QADBAK_OS_ID="${ID:-}"
  QADBAK_OS_VERSION_ID="${VERSION_ID:-}"
  QADBAK_OS_CODENAME="${VERSION_CODENAME:-}"
  QADBAK_OS_PRETTY_NAME="${PRETTY_NAME:-$ID}"
  case "$QADBAK_OS_ID" in
    ubuntu | debian) QADBAK_PKG_MGR=apt ;;
    rhel | centos | rocky | almalinux | fedora) QADBAK_PKG_MGR=dnf ;;
    alpine) QADBAK_PKG_MGR=apk ;;
    *) QADBAK_PKG_MGR=unknown ;;
  esac
  return 0
}

qadbak_os_is_supported_native() {
  case "${QADBAK_OS_ID}:${QADBAK_OS_VERSION_ID}" in
    ubuntu:22.04 | ubuntu:24.04 | ubuntu:26.04 | debian:12) return 0 ;;
    *) return 1 ;;
  esac
}

# Full native hosting stack (nginx, mail, BIND, …).
qadbak_detect_linux_distro() {
  qadbak_load_os_release || return 1
  if qadbak_os_is_supported_native; then
    return 0
  fi
  echo "WARN: ${QADBAK_OS_PRETTY_NAME:-Unknown OS} is not in the tested native list (Ubuntu 22.04/24.04/26.04, Debian 12)" >&2
  return 1
}

# Ubuntu-only check (legacy scripts).
qadbak_detect_ubuntu_release() {
  qadbak_load_os_release || return 1
  if [[ "$QADBAK_OS_ID" != "ubuntu" ]]; then
    return 1
  fi
  case "$QADBAK_OS_VERSION_ID" in
    22.04 | 24.04 | 26.04) return 0 ;;
    *)
      echo "WARN: Ubuntu $QADBAK_OS_VERSION_ID is not in the tested LTS list (22.04, 24.04, 26.04)" >&2
      return 1
      ;;
  esac
}

qadbak_linux_release_label() {
  if [[ -n "$QADBAK_OS_VERSION_ID" ]]; then
    echo "${QADBAK_OS_ID^} ${QADBAK_OS_VERSION_ID} (${QADBAK_OS_CODENAME})"
  else
    echo "${QADBAK_OS_ID:-Linux}"
  fi
}

# Backward-compatible alias used in older scripts/docs.
qadbak_ubuntu_release_label() {
  qadbak_linux_release_label
}

# Next in-place LTS upgrade (one hop only - 22.04→24.04, 24.04→26.04).
qadbak_ubuntu_next_lts_version() {
  if [[ -z "$QADBAK_OS_VERSION_ID" ]]; then
    qadbak_load_os_release || return 1
  fi
  [[ "$QADBAK_OS_ID" == "ubuntu" ]] || return 1
  case "$QADBAK_OS_VERSION_ID" in
    22.04) echo "24.04" ;;
    24.04) echo "26.04" ;;
    *) return 1 ;;
  esac
}

qadbak_ubuntu_lts_codename() {
  case "$1" in
    22.04) echo "jammy" ;;
    24.04) echo "noble" ;;
    26.04) echo "resolute" ;;
    *) echo "" ;;
  esac
}

qadbak_ubuntu_lts_label() {
  local ver="$1"
  local code
  code="$(qadbak_ubuntu_lts_codename "$ver")"
  if [[ -n "$code" ]]; then
    echo "Ubuntu ${ver} LTS (${code})"
  else
    echo "Ubuntu ${ver}"
  fi
}

qadbak_has_apt() {
  [[ "$QADBAK_PKG_MGR" == "apt" ]] && command -v apt-get &>/dev/null
}

qadbak_pkg_update() {
  if qadbak_has_apt; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    return 0
  fi
  return 1
}

qadbak_pkg_install() {
  if qadbak_has_apt; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq "$@"
    return $?
  fi
  if [[ "$QADBAK_PKG_MGR" == "dnf" ]] && command -v dnf &>/dev/null; then
    dnf install -y "$@"
    return $?
  fi
  echo "No supported package manager to install: $*" >&2
  return 1
}

# bind9utils (Jammy) vs bind9-utils (Noble/Debian)
qadbak_bind_apt_packages() {
  if apt-cache show bind9utils &>/dev/null 2>&1; then
    echo "bind9 bind9utils"
  else
    echo "bind9 bind9-utils"
  fi
}

qadbak_php_extra_apt_packages() {
  case "${QADBAK_OS_ID}:${QADBAK_OS_VERSION_ID}" in
    ubuntu:26.04)
      echo "php8.4-fpm php8.4-cli php8.4-mysql php8.4-curl php8.4-xml php8.4-mbstring php8.4-zip"
      ;;
    ubuntu:24.04)
      echo "php8.3-fpm php8.3-cli php8.3-mysql php8.3-curl php8.3-xml php8.3-mbstring php8.3-zip"
      ;;
    ubuntu:22.04)
      echo "php8.1-fpm php8.1-cli"
      ;;
    debian:12)
      echo "php8.2-fpm php8.2-cli php8.2-mysql php8.2-curl php8.2-xml php8.2-mbstring php8.2-zip"
      ;;
    *) echo "" ;;
  esac
}

qadbak_install_nodejs() {
  local major="${1:-20}"
  local min_major="${QADBAK_MIN_NODE_MAJOR:-20}"
  if [[ "$major" -lt "$min_major" ]]; then
    major="$min_major"
  fi
  if command -v node &>/dev/null; then
    local ver
    ver="$(node -v | cut -d. -f1 | tr -d v)"
    if [[ "$ver" -ge "$major" ]]; then
      echo "  OK   Node.js $(node -v) (>= ${major})"
      command -v npm &>/dev/null && echo "  OK   npm $(npm -v)" || true
      return 0
    fi
    echo "  Node.js $(node -v) is below required ${major}+ - upgrading…" >&2
  else
    echo "  Node.js not found - installing Node.js ${major}.x LTS…" >&2
  fi
  case "$QADBAK_OS_ID" in
    ubuntu | debian)
      NS_SCRIPT="/tmp/qadbak-nodesource-setup-${major}.sh"
      if ! curl -fsSL "https://deb.nodesource.com/setup_${major}.x" -o "$NS_SCRIPT"; then
        echo "FAIL: could not download NodeSource setup script" >&2
        rm -f "$NS_SCRIPT"
        return 1
      fi
      if ! bash "$NS_SCRIPT"; then
        echo "FAIL: NodeSource setup script failed for Node.js ${major}.x" >&2
        rm -f "$NS_SCRIPT"
        return 1
      fi
      rm -f "$NS_SCRIPT"
      if ! qadbak_pkg_install nodejs; then
        echo "FAIL: could not install nodejs package" >&2
        return 1
      fi
      ;;
    *)
      echo "Install Node.js ${major}+ on this system, then re-run." >&2
      return 1
      ;;
  esac
  if ! command -v node &>/dev/null; then
    echo "FAIL: node not on PATH after install" >&2
    return 1
  fi
  local installed
  installed="$(node -v | cut -d. -f1 | tr -d v)"
  if [[ "$installed" -lt "$major" ]]; then
    echo "FAIL: expected Node.js ${major}+ but found $(node -v)" >&2
    return 1
  fi
  if ! command -v npm &>/dev/null; then
    echo "FAIL: npm not on PATH after Node.js install" >&2
    return 1
  fi
  echo "  OK   Node.js $(node -v)"
  echo "  OK   npm $(npm -v)"
}

# awscli (v1) exists on Jammy; Noble/Debian removed it - try apt, then snap, else warn.
qadbak_install_aws_cli() {
  if command -v aws &>/dev/null; then
    echo "  OK   aws CLI already on PATH"
    return 0
  fi
  if apt-cache show awscli &>/dev/null 2>&1; then
    if qadbak_pkg_install awscli 2>/dev/null; then
      apt-mark manual awscli 2>/dev/null || true
      echo "  OK   awscli (apt)"
      return 0
    fi
  fi
  if command -v snap &>/dev/null && snap install aws-cli --classic 2>/dev/null; then
    ln -sf /snap/bin/aws /usr/local/bin/aws 2>/dev/null || true
    echo "  OK   aws-cli (snap)"
    return 0
  fi
  echo "  WARN aws CLI not installed (optional - S3 backup tab needs it)" >&2
  echo "       Install later: snap install aws-cli --classic" >&2
  return 0
}

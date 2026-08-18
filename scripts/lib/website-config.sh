#!/usr/bin/env bash
# Read per-domain website.json (web root, static vs PHP). Sourced by nginx/mail scripts.
set -euo pipefail

website_config_file() {
  local domain="${1:?domain}"
  echo "${QADBAK_DIR:-/opt/qadbak}/data/domain-config/${domain}/website.json"
}

website_config_exists() {
  [[ -f "$(website_config_file "$1")" ]]
}

website_web_root() {
  local domain="$1" user="$2"
  local cfg
  cfg="$(website_config_file "$domain")"
  if [[ -f "$cfg" ]] && command -v jq &>/dev/null; then
    local root
    root="$(jq -r '.webRoot // empty' "$cfg" 2>/dev/null | head -1)"
    if [[ -n "$root" ]]; then
      echo "$root"
      return 0
    fi
  fi
  local reg="${QADBAK_DIR:-/opt/qadbak}/data/native-domains.json"
  if [[ -f "$reg" ]] && command -v jq &>/dev/null; then
    local type parent parent_user
    type="$(jq -r --arg d "$domain" '.[] | select(.name==$d) | .type // "top"' "$reg" 2>/dev/null | head -1)"
    parent="$(jq -r --arg d "$domain" '.[] | select(.name==$d) | .parent // empty' "$reg" 2>/dev/null | head -1)"
    if [[ "$type" == "sub" && -n "$parent" ]]; then
      parent_user="$(jq -r --arg p "$parent" '.[] | select(.name==$p) | .user // empty' "$reg" 2>/dev/null | head -1)"
      if [[ -z "$parent_user" || "$parent_user" == "$user" ]]; then
        echo "/home/${user}/domains/${domain}/public_html"
        return 0
      fi
    fi
  fi
  echo "/home/${user}/public_html"
}

website_mode() {
  local domain="$1"
  local cfg
  cfg="$(website_config_file "$domain")"
  if [[ -f "$cfg" ]] && command -v jq &>/dev/null; then
    jq -r '.mode // "php"' "$cfg" 2>/dev/null | head -1
    return 0
  fi
  echo "php"
}

website_www_redirect() {
  local domain="$1"
  local cfg
  cfg="$(website_config_file "$domain")"
  if [[ -f "$cfg" ]] && command -v jq &>/dev/null; then
    jq -r '.wwwRedirect // "none"' "$cfg" 2>/dev/null | head -1
    return 0
  fi
  echo "none"
}

website_cache_static_assets() {
  local domain="$1"
  local cfg
  cfg="$(website_config_file "$domain")"
  if [[ -f "$cfg" ]] && command -v jq &>/dev/null; then
    jq -r '.cacheStaticAssets // false' "$cfg" 2>/dev/null | head -1
    return 0
  fi
  echo "false"
}

website_has_publishable_root() {
  local domain="$1" user="$2"
  if website_config_exists "$domain"; then
    return 0
  fi
  local root
  root="$(website_web_root "$domain" "$user")"
  [[ -d "$root" ]]
}

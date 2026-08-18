#!/usr/bin/env bash
# Per-customer PHP-FPM pools (unix user isolation). Sourced by apply-php-fpm-pool.sh / apply-domain-nginx.sh.
set -euo pipefail

php_fpm_detect_version() {
  local preferred="${1:-}"
  if [[ -n "$preferred" && -d "/etc/php/${preferred}/fpm" ]]; then
    echo "$preferred"
    return 0
  fi
  local v
  for v in 8.5 8.4 8.3 8.2 8.1 8.0; do
    if [[ -d "/etc/php/${v}/fpm" ]]; then
      echo "$v"
      return 0
    fi
  done
  echo "8.2"
}

php_fpm_domain_version() {
  local domain="${1:-}" qadbak_dir="${2:-/opt/qadbak}"
  local cfg="$qadbak_dir/data/domain-config/${domain}/php.json"
  local v=""
  if [[ -f "$cfg" ]] && command -v jq &>/dev/null; then
    v="$(jq -r '.defaultVersion // empty' "$cfg" 2>/dev/null | head -1)"
  fi
  echo "$v"
}

php_fpm_pool_conf_path() {
  local ver="$1" user="$2"
  echo "/etc/php/${ver}/fpm/pool.d/qadbak-${user}.conf"
}

php_fpm_socket_path() {
  local user="$1"
  echo "/run/php/qadbak-${user}.sock"
}

php_fpm_nginx_user() {
  if id nginx &>/dev/null; then
    echo "nginx"
  else
    echo "www-data"
  fi
}

php_fpm_pool_available() {
  local user="$1"
  [[ -S "$(php_fpm_socket_path "$user")" ]]
}

apply_php_fpm_pool() {
  local user="$1"
  local ver="${2:-}"
  local home="${3:-/home/${user}}"

  if ! id "$user" &>/dev/null; then
    echo "ERROR: unix user does not exist: $user" >&2
    return 1
  fi

  ver="$(php_fpm_detect_version "$ver")"
  if [[ ! -d "/etc/php/${ver}/fpm" ]]; then
    echo "ERROR: PHP ${ver} FPM not installed (/etc/php/${ver}/fpm missing)" >&2
    return 1
  fi

  local pub="${home}/public_html"
  mkdir -p "$pub" "${home}/tmp"
  chown -R "${user}:${user}" "$pub" 2>/dev/null || true
  chown -R "${user}:${user}" "${home}/tmp" 2>/dev/null || true

  local sock
  sock="$(php_fpm_socket_path "$user")"
  local ngx_user
  ngx_user="$(php_fpm_nginx_user)"
  local pool_file
  pool_file="$(php_fpm_pool_conf_path "$ver" "$user")"

  cat >"$pool_file" <<EOF
; Qadbak per-tenant PHP-FPM pool — ${user}
[qadbak-${user}]
user = ${user}
group = ${user}
listen = ${sock}
listen.owner = ${ngx_user}
listen.group = ${ngx_user}
listen.mode = 0660

pm = ondemand
pm.max_children = 8
pm.process_idle_timeout = 10s

chdir = ${pub}
php_admin_value[open_basedir] = ${home}/:/tmp/:/var/tmp/:/usr/share/php/
php_admin_value[upload_tmp_dir] = ${home}/tmp
php_admin_flag[log_errors] = on
EOF

  # Remove duplicate pool definitions for this user on other PHP versions
  local other
  for other in /etc/php/*/fpm; do
    [[ -d "$other" ]] || continue
    local ov="${other#/etc/php/}"
    ov="${ov%/fpm}"
    [[ "$ov" == "$ver" ]] && continue
    rm -f "${other}/pool.d/qadbak-${user}.conf" 2>/dev/null || true
  done

  systemctl enable "php${ver}-fpm" 2>/dev/null || true
  systemctl start "php${ver}-fpm" 2>/dev/null || true
  systemctl reload "php${ver}-fpm" 2>/dev/null || systemctl restart "php${ver}-fpm" 2>/dev/null || true

  echo "OK — PHP ${ver} FPM pool qadbak-${user} → ${sock}"
}

php_fpm_named_socket_path() {
  local user="$1" pool_id="$2"
  echo "/run/php/qadbak-${user}-d-${pool_id}.sock"
}

php_fpm_named_pool_conf_path() {
  local ver="$1" user="$2" pool_id="$3"
  echo "/etc/php/${ver}/fpm/pool.d/qadbak-${user}-d-${pool_id}.conf"
}

# Extra directory pool (does not chown public_html / home).
apply_php_fpm_named_pool() {
  local user="$1"
  local ver="${2:-}"
  local chdir="$3"
  local pool_id="$4"
  local home="${5:-/home/${user}}"

  if ! id "$user" &>/dev/null; then
    echo "ERROR: unix user does not exist: $user" >&2
    return 1
  fi
  if [[ ! "$pool_id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "ERROR: invalid PHP pool id" >&2
    return 1
  fi
  if [[ "$chdir" != "${home}/public_html/"* ]]; then
    echo "ERROR: extra PHP pool chdir must be under ${home}/public_html/" >&2
    return 1
  fi

  ver="$(php_fpm_detect_version "$ver")"
  if [[ ! -d "/etc/php/${ver}/fpm" ]]; then
    echo "ERROR: PHP ${ver} FPM not installed" >&2
    return 1
  fi

  mkdir -p "$chdir" "${home}/tmp"
  chown "${user}:${user}" "$chdir" "${home}/tmp" 2>/dev/null || true

  local sock ngx_user pool_file
  sock="$(php_fpm_named_socket_path "$user" "$pool_id")"
  ngx_user="$(php_fpm_nginx_user)"
  pool_file="$(php_fpm_named_pool_conf_path "$ver" "$user" "$pool_id")"

  cat >"$pool_file" <<EOF
; Qadbak per-directory PHP-FPM pool — ${user} ${pool_id}
[qadbak-${user}-d-${pool_id}]
user = ${user}
group = ${user}
listen = ${sock}
listen.owner = ${ngx_user}
listen.group = ${ngx_user}
listen.mode = 0660

pm = ondemand
pm.max_children = 4
pm.process_idle_timeout = 10s

chdir = ${chdir}
php_admin_value[open_basedir] = ${home}/:/tmp/:/var/tmp/:/usr/share/php/
php_admin_value[upload_tmp_dir] = ${home}/tmp
php_admin_flag[log_errors] = on
EOF

  local other ov
  for other in /etc/php/*/fpm; do
    [[ -d "$other" ]] || continue
    ov="${other#/etc/php/}"
    ov="${ov%/fpm}"
    [[ "$ov" == "$ver" ]] && continue
    rm -f "$(php_fpm_named_pool_conf_path "$ov" "$user" "$pool_id")" 2>/dev/null || true
  done

  systemctl enable "php${ver}-fpm" 2>/dev/null || true
  systemctl start "php${ver}-fpm" 2>/dev/null || true
  systemctl reload "php${ver}-fpm" 2>/dev/null || systemctl restart "php${ver}-fpm" 2>/dev/null || true

  echo "OK — PHP ${ver} extra pool qadbak-${user}-d-${pool_id} → ${sock}"
}

prune_php_fpm_named_pools() {
  local user="$1"
  shift
  local keep="|$(IFS='|'; echo "$*")|"
  local pool_dir f base id ver
  for pool_dir in /etc/php/*/fpm/pool.d; do
    [[ -d "$pool_dir" ]] || continue
    ver="${pool_dir#/etc/php/}"
    ver="${ver%/fpm/pool.d}"
    for f in "${pool_dir}/qadbak-${user}-d-"*.conf; do
      [[ -f "$f" ]] || continue
      base="${f##*/}"
      id="${base#qadbak-${user}-d-}"
      id="${id%.conf}"
      if [[ "$keep" != *"|${id}|"* ]]; then
        rm -f "$f"
        rm -f "$(php_fpm_named_socket_path "$user" "$id")" 2>/dev/null || true
        systemctl reload "php${ver}-fpm" 2>/dev/null || true
      fi
    done
  done
}

remove_php_fpm_pool() {
  local user="$1"
  local removed=0
  local pool_dir pool_file ver
  for pool_dir in /etc/php/*/fpm/pool.d; do
    [[ -d "$pool_dir" ]] || continue
    pool_file="${pool_dir}/qadbak-${user}.conf"
    if [[ -f "$pool_file" ]]; then
      rm -f "$pool_file"
      removed=1
      ver="${pool_dir#/etc/php/}"
      ver="${ver%/fpm/pool.d}"
      systemctl reload "php${ver}-fpm" 2>/dev/null || true
    fi
    local extra
    for extra in "${pool_dir}/qadbak-${user}-d-"*.conf; do
      [[ -f "$extra" ]] || continue
      rm -f "$extra"
      removed=1
    done
  done
  rm -f "$(php_fpm_socket_path "$user")" 2>/dev/null || true
  if [[ "$removed" -eq 1 ]]; then
    echo "OK — removed PHP-FPM pool(s) for ${user}"
  else
    echo "OK — no PHP-FPM pool for ${user}"
  fi
}

# Emit nginx location block for PHP (stdout). Uses FPM socket when present, else Apache proxy.
nginx_php_location_lines() {
  local user="$1"
  local apache_backend="${2:-127.0.0.1:8080}"
  local sock
  sock="$(php_fpm_socket_path "$user")"

  if php_fpm_pool_available "$user"; then
    cat <<NGX
    location ~ \.php(/|\$) {
        try_files \$uri =404;
        fastcgi_split_path_info ^(.+\.php)(/.*)\$;
        fastcgi_pass unix:${sock};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param PATH_INFO \$fastcgi_path_info;
    }
NGX
  else
    cat <<NGX
    location ~ \.php(/|\$) {
        proxy_pass http://${apache_backend};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
NGX
  fi
}

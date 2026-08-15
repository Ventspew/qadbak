#!/usr/bin/env bash
# Rebuild customer nginx vhost (redirects + reverse proxies from domain-config).
# Web root: data/domain-config/DOMAIN/website.json (default: ~/public_html).
# PHP: per-user PHP-FPM socket when mode=php; static sites skip PHP.
#
# Usage:  sudo bash apply-domain-nginx.sh DOMAIN USER [--ssl|--no-ssl]
set -euo pipefail
DOMAIN="${1:?domain}"
USER="${2:?unix-user}"
SSL_FLAG="${3:-}"
QADBAK_DIR="${QADBAK_DIR:-/opt/qadbak}"
APACHE_BACKEND="${APACHE_BACKEND:-127.0.0.1:8080}"
REDIR_JSON="$QADBAK_DIR/data/domain-config/${DOMAIN}/redirects.json"
PROXY_JSON="$QADBAK_DIR/data/domain-config/${DOMAIN}/proxies.json"

# Needed for websocket proxies: Connection: upgrade only when client sends Upgrade.
WS_MAP="/etc/nginx/conf.d/00-qadbak-websocket-map.conf"
if [[ ! -f "$WS_MAP" ]]; then
  cat >"$WS_MAP" <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF
fi

ISSUE_SSL_RESOLVED="${ISSUE_SSL:-${QADBAK_AUTO_SSL:-}}"
case "$SSL_FLAG" in
  --ssl)    ISSUE_SSL_RESOLVED=1 ;;
  --no-ssl) ISSUE_SSL_RESOLVED=0 ;;
esac

# shellcheck source=lib/php-fpm-pool.sh
source "$QADBAK_DIR/scripts/lib/php-fpm-pool.sh"
# shellcheck source=lib/nginx-customer-vhost.sh
source "$QADBAK_DIR/scripts/lib/nginx-customer-vhost.sh"
# shellcheck source=lib/ensure-home-web-access.sh
source "$QADBAK_DIR/scripts/lib/ensure-home-web-access.sh"
# shellcheck source=lib/website-config.sh
source "$QADBAK_DIR/scripts/lib/website-config.sh"

if ! id "$USER" &>/dev/null; then
  echo "SKIP — unix user does not exist: $USER (domain $DOMAIN)" >&2
  exit 1
fi

PUB="$(website_web_root "$DOMAIN" "$USER")"
SITE_MODE="$(website_mode "$DOMAIN")"
WWW_REDIRECT="$(website_www_redirect "$DOMAIN")"
CACHE_STATIC="$(website_cache_static_assets "$DOMAIN")"

[[ -d "$PUB" ]] || mkdir -p "$PUB"
if [[ "$PUB" == /home/* ]]; then
  chown -R "${USER}:${USER}" "/home/${USER}" 2>/dev/null || {
    echo "SKIP — cannot chown /home/${USER} for $DOMAIN" >&2
    exit 1
  }
  ensure_home_web_access "$USER"
else
  chown -R www-data:www-data "$PUB" 2>/dev/null || chown -R nginx:nginx "$PUB" 2>/dev/null || true
fi

PHP_VER="$(php_fpm_domain_version "$DOMAIN" "$QADBAK_DIR")"
PHP_VER="$(php_fpm_detect_version "$PHP_VER")"
if [[ "$SITE_MODE" != "static" && -f "$QADBAK_DIR/scripts/apply-php-fpm-pool.sh" ]]; then
  bash "$QADBAK_DIR/scripts/apply-php-fpm-pool.sh" "$USER" "$PHP_VER" "/home/${USER}" 2>/dev/null || true
fi

# Detect root reverse proxy before writing/status (must not be function-local).
HAS_ROOT_PROXY=0
if [[ -f "$PROXY_JSON" ]] && command -v jq &>/dev/null; then
  if jq -e '[.[] | select(.path == "/" and (.dest // "") != "")] | length > 0' "$PROXY_JSON" &>/dev/null; then
    HAS_ROOT_PROXY=1
  fi
fi

# Subdomains like pogo.example.com almost never have www — skip it for LE / server_name.
INCLUDE_WWW=1
dot_count="${DOMAIN//[^.]/}"
if (( ${#dot_count} >= 2 )); then
  INCLUDE_WWW=0
fi
if [[ "$WWW_REDIRECT" == "apex" ]]; then
  HTTP_SERVER_NAMES="$DOMAIN"
else
  if [[ "$INCLUDE_WWW" == "1" ]]; then
    HTTP_SERVER_NAMES="${DOMAIN} www.${DOMAIN}"
  else
    HTTP_SERVER_NAMES="$DOMAIN"
  fi
fi

write_acme_challenge_location() {
  # Must come before location / when a root proxy exists, otherwise HTTP-01
  # challenges are forwarded to the upstream app (certbot sees HTML → fail).
  echo "    location ^~ /.well-known/acme-challenge/ {"
  echo "        root ${PUB};"
  echo "        default_type \"text/plain\";"
  echo "        allow all;"
  echo "        try_files \$uri =404;"
  echo "    }"
}

write_common_locations() {
  MODSEC_JSON="$QADBAK_DIR/data/domain-config/${DOMAIN}/modsecurity.json"
  MODSEC_RULES="$QADBAK_DIR/data/domain-config/${DOMAIN}/modsecurity-nginx.conf"
  if [[ -f "$MODSEC_JSON" ]] && [[ -f "$MODSEC_RULES" ]] && command -v jq &>/dev/null; then
    if jq -e '.enabled == true' "$MODSEC_JSON" &>/dev/null; then
      echo "    modsecurity on;"
      echo "    modsecurity_rules_file ${MODSEC_RULES};"
    fi
  fi

  write_acme_challenge_location

  if [[ -f "$PROXY_JSON" ]] && command -v jq &>/dev/null; then
    while IFS=$'\t' read -r ppath pdest pws; do
      [[ -z "$ppath" || -z "$pdest" ]] && continue
      if [[ "$ppath" == "/" ]]; then
        loc="/"
      else
        loc="${ppath%/}/"
      fi
      echo "    location ${loc} {"
      echo "        proxy_pass ${pdest};"
      echo "        proxy_http_version 1.1;"
      echo "        proxy_set_header Host \$host;"
      echo "        proxy_set_header X-Real-IP \$remote_addr;"
      echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
      echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
      # Keep Location on the public host/HTTPS. Upstream apps that listen on
      # 8080/18080 otherwise leak those ports (Cloudflare 521 on :8080).
      echo "        proxy_redirect http://\$host:8080/ /;"
      echo "        proxy_redirect http://\$host:18080/ /;"
      echo "        proxy_redirect http://\$host:8080/login /login;"
      echo "        proxy_redirect https://\$host:8080/ /;"
      echo "        proxy_redirect https://\$host:18080/ /;"
      echo "        add_header Cache-Control \"no-store\" always;"
      if [[ "$pws" == "true" ]]; then
        # Only upgrade when the client asks — never force Connection: upgrade on
        # every request (breaks fetch/XHR to the same location).
        echo "        proxy_set_header Upgrade \$http_upgrade;"
        echo "        proxy_set_header Connection \$connection_upgrade;"
      else
        echo "        proxy_set_header Connection \"\";"
      fi
      echo "    }"
    done < <(jq -r 'unique_by(.path) | .[] | [.path,.dest,(.websocket // false)] | @tsv' "$PROXY_JSON" 2>/dev/null)
  fi

  if [[ -f "$REDIR_JSON" ]] && command -v jq &>/dev/null; then
    while IFS=$'\t' read -r rpath rdest rtype; do
      [[ -z "$rpath" ]] && continue
      code="${rtype:-301}"
      [[ "$code" == "302" ]] && code=302 || code=301
      echo "    location = ${rpath} { return ${code} \"${rdest}\"; }"
    done < <(jq -r '.[] | [.path,.dest,.type] | @tsv' "$REDIR_JSON" 2>/dev/null)
  fi

  if [[ "$CACHE_STATIC" == "true" ]]; then
    echo "    location ~* \\.(css|js|svg|png|jpg|webp|woff2)\$ {"
    echo "        expires 7d;"
    echo "        add_header Cache-Control \"public, immutable\";"
    echo "    }"
  fi

  if [[ "${HAS_ROOT_PROXY:-0}" != "1" ]]; then
    echo "    location / { try_files \$uri \$uri/ =404; }"
  fi
  if [[ "$SITE_MODE" != "static" && "${HAS_ROOT_PROXY:-0}" != "1" ]]; then
    nginx_php_location_lines "$USER" "$APACHE_BACKEND"
  fi
}

write_site_server() {
  local listen_ssl="$1"
  local cert_dir="${2:-}"
  local server_names="$3"

  echo "server {"
  if [[ "$listen_ssl" == "1" ]]; then
    echo "    listen 443 ssl http2;"
    echo "    listen [::]:443 ssl http2;"
    echo "    server_name ${server_names};"
    echo "    ssl_certificate     ${cert_dir}/fullchain.pem;"
    echo "    ssl_certificate_key ${cert_dir}/privkey.pem;"
  else
    echo "    listen 80;"
    echo "    listen [::]:80;"
    echo "    server_name ${server_names};"
  fi
  echo "    root ${PUB};"
  if [[ "$SITE_MODE" == "static" ]]; then
    echo "    index index.html;"
  else
    echo "    index index.html index.htm index.php;"
  fi
  echo "    client_max_body_size 100g;"
  write_common_locations
  echo "}"
}

write_vhost_file() {
  local out="$1"
  {
    echo "# Qadbak — ${DOMAIN} (user ${USER}, mode ${SITE_MODE}, root ${PUB})"
    if [[ -n "$SSL_CERT_DIR" ]]; then
      if [[ "$WWW_REDIRECT" == "apex" ]]; then
        write_site_server 1 "$SSL_CERT_DIR" "$DOMAIN"
        if [[ "$INCLUDE_WWW" == "1" ]]; then
          echo ""
          echo "server {"
          echo "    listen 443 ssl http2;"
          echo "    listen [::]:443 ssl http2;"
          echo "    server_name www.${DOMAIN};"
          echo "    ssl_certificate     ${SSL_CERT_DIR}/fullchain.pem;"
          echo "    ssl_certificate_key ${SSL_CERT_DIR}/privkey.pem;"
          echo "    return 301 https://${DOMAIN}\$request_uri;"
          echo "}"
        fi
        echo ""
        echo "server {"
        echo "    listen 80;"
        echo "    listen [::]:80;"
        echo "    server_name ${HTTP_SERVER_NAMES};"
        echo "    root ${PUB};"
        echo "    client_max_body_size 100g;"
        if [[ "${HAS_ROOT_PROXY:-0}" == "1" ]]; then
          write_common_locations
        else
          write_acme_challenge_location
          echo "    location / { return 301 https://${DOMAIN}\$request_uri; }"
        fi
        echo "}"
      else
        write_site_server 1 "$SSL_CERT_DIR" "$HTTP_SERVER_NAMES"
        echo ""
        echo "server {"
        echo "    listen 80;"
        echo "    listen [::]:80;"
        echo "    server_name ${HTTP_SERVER_NAMES};"
        echo "    root ${PUB};"
        echo "    client_max_body_size 100g;"
        # Behind Cloudflare Flexible the edge talks HTTP to origin. Redirecting
        # that to HTTPS breaks browser fetch/XHR. Serve the same app on :80.
        if [[ "${HAS_ROOT_PROXY:-0}" == "1" ]]; then
          write_common_locations
        else
          write_acme_challenge_location
          echo "    location / { return 301 https://\$host\$request_uri; }"
        fi
        echo "}"
      fi
    else
      if [[ "$WWW_REDIRECT" == "apex" && "$INCLUDE_WWW" == "1" ]]; then
        write_site_server 0 "" "$DOMAIN"
        echo ""
        echo "server {"
        echo "    listen 80;"
        echo "    listen [::]:80;"
        echo "    server_name www.${DOMAIN};"
        echo "    return 301 http://${DOMAIN}\$request_uri;"
        echo "}"
      else
        write_site_server 0 "" "$HTTP_SERVER_NAMES"
      fi
    fi
  } >"$out"
}

ensure_origin_self_signed() {
  local dir="/etc/qadbak/ssl/${DOMAIN}"
  mkdir -p "$dir"
  if [[ -f "$dir/fullchain.pem" && -f "$dir/privkey.pem" ]]; then
    echo "$dir"
    return 0
  fi
  echo "==> TLS: generating origin self-signed cert for $DOMAIN (Cloudflare Full OK)" >&2
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$dir/privkey.pem" \
    -out "$dir/fullchain.pem" \
    -subj "/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN}" 2>/dev/null \
  || openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$dir/privkey.pem" \
    -out "$dir/fullchain.pem" \
    -subj "/CN=${DOMAIN}"
  chmod 640 "$dir/privkey.pem" 2>/dev/null || true
  echo "$dir"
}

reload_nginx_if_needed() {
  if [[ "${NGINX_BATCH:-}" != "1" ]]; then
    nginx -t
    systemctl reload nginx
  fi
}

OUT="$(nginx_customer_conf_available "$DOMAIN")"
ENABLED_LINK="$(nginx_customer_conf_enabled "$DOMAIN")"

# Phase 1: always write/reload HTTP (or existing cert) first so ACME + proxy work.
SSL_CERT_DIR=""
for candidate in "$DOMAIN" "www.${DOMAIN}"; do
  if [[ -f "/etc/letsencrypt/live/${candidate}/fullchain.pem" ]]; then
    SSL_CERT_DIR="/etc/letsencrypt/live/${candidate}"
    break
  fi
done
if [[ -z "$SSL_CERT_DIR" && -f "/etc/qadbak/ssl/${DOMAIN}/fullchain.pem" ]]; then
  SSL_CERT_DIR="/etc/qadbak/ssl/${DOMAIN}"
fi

write_vhost_file "$OUT"
ln -sf "$OUT" "$ENABLED_LINK"
reload_nginx_if_needed

# Phase 2: issue cert only after ACME location is live (critical with root proxies).
if [[ "$ISSUE_SSL_RESOLVED" == "1" ]] && command -v certbot &>/dev/null; then
  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    LE_EMAIL="${QADBAK_LE_EMAIL:-${LE_EMAIL:-admin@${DOMAIN}}}"
    echo "==> TLS: certbot webroot for $DOMAIN (email: $LE_EMAIL)"
    cert_ok=0
    if [[ "$INCLUDE_WWW" == "1" ]]; then
      if certbot certonly --webroot -w "$PUB" -d "$DOMAIN" -d "www.${DOMAIN}" \
           --non-interactive --agree-tos -m "$LE_EMAIL" --keep-until-expiring; then
        cert_ok=1
        echo "    OK — Let's Encrypt cert issued via webroot"
      fi
    fi
    if [[ "$cert_ok" != "1" ]]; then
      if certbot certonly --webroot -w "$PUB" -d "$DOMAIN" \
           --non-interactive --agree-tos -m "$LE_EMAIL" --keep-until-expiring; then
        cert_ok=1
        echo "    OK — Let's Encrypt cert issued for $DOMAIN"
      else
        echo "    WARN — certbot failed for $DOMAIN (often Cloudflare orange cloud)" >&2
        SSL_CERT_DIR="$(ensure_origin_self_signed)"
        echo "    OK — origin self-signed installed; keep Cloudflare SSL mode Full (not Flexible)" >&2
        write_vhost_file "$OUT"
        ln -sf "$OUT" "$ENABLED_LINK"
        reload_nginx_if_needed
      fi
    fi
    if [[ "$cert_ok" == "1" ]]; then
      SSL_CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
      write_vhost_file "$OUT"
      ln -sf "$OUT" "$ENABLED_LINK"
      reload_nginx_if_needed
    fi
  fi
elif [[ "$ISSUE_SSL_RESOLVED" == "1" && -z "$SSL_CERT_DIR" ]]; then
  SSL_CERT_DIR="$(ensure_origin_self_signed)"
  write_vhost_file "$OUT"
  ln -sf "$OUT" "$ENABLED_LINK"
  reload_nginx_if_needed
fi

if [[ "${HAS_ROOT_PROXY:-0}" == "1" ]]; then
  echo "OK — nginx vhost ${DOMAIN} (reverse proxy root${SSL_CERT_DIR:+, HTTPS})"
elif [[ "$SITE_MODE" == "static" ]]; then
  echo "OK — nginx vhost ${DOMAIN} (static ${PUB}${SSL_CERT_DIR:+, HTTPS})"
elif php_fpm_pool_available "$USER"; then
  echo "OK — nginx vhost ${DOMAIN} (PHP-FPM unix:$(php_fpm_socket_path "$USER")${SSL_CERT_DIR:+, HTTPS})"
else
  echo "OK — nginx vhost ${DOMAIN} (PHP → Apache ${APACHE_BACKEND}${SSL_CERT_DIR:+, HTTPS})"
fi

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

if [[ "$ISSUE_SSL_RESOLVED" == "1" ]] && command -v certbot &>/dev/null; then
  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    LE_EMAIL="${QADBAK_LE_EMAIL:-${LE_EMAIL:-admin@${DOMAIN}}}"
    echo "==> TLS: certbot webroot for $DOMAIN (email: $LE_EMAIL)"
    if certbot certonly --webroot -w "$PUB" -d "$DOMAIN" -d "www.${DOMAIN}" \
         --non-interactive --agree-tos -m "$LE_EMAIL" --keep-until-expiring; then
      echo "    OK — Let's Encrypt cert issued via webroot"
    elif certbot certonly --webroot -w "$PUB" -d "$DOMAIN" \
         --non-interactive --agree-tos -m "$LE_EMAIL" --keep-until-expiring; then
      echo "    OK — Let's Encrypt cert issued for $DOMAIN only (www variant skipped)"
    else
      echo "    WARN — certbot failed for $DOMAIN" >&2
    fi
  fi
fi

SSL_CERT_HOST=""
for candidate in "$DOMAIN" "www.${DOMAIN}"; do
  if [[ -f "/etc/letsencrypt/live/${candidate}/fullchain.pem" ]]; then
    SSL_CERT_HOST="$candidate"
    break
  fi
done

write_common_locations() {
  local HAS_ROOT_PROXY=0
  MODSEC_JSON="$QADBAK_DIR/data/domain-config/${DOMAIN}/modsecurity.json"
  MODSEC_RULES="$QADBAK_DIR/data/domain-config/${DOMAIN}/modsecurity-nginx.conf"
  if [[ -f "$MODSEC_JSON" ]] && [[ -f "$MODSEC_RULES" ]] && command -v jq &>/dev/null; then
    if jq -e '.enabled == true' "$MODSEC_JSON" &>/dev/null; then
      echo "    modsecurity on;"
      echo "    modsecurity_rules_file ${MODSEC_RULES};"
    fi
  fi

  HAS_ROOT_PROXY=0
  if [[ -f "$PROXY_JSON" ]] && command -v jq &>/dev/null; then
    while IFS=$'\t' read -r ppath pdest pws; do
      [[ -z "$ppath" || -z "$pdest" ]] && continue
      if [[ "$ppath" == "/" ]]; then
        loc="/"
        HAS_ROOT_PROXY=1
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
      if [[ "$pws" == "true" ]]; then
        echo "        proxy_set_header Upgrade \$http_upgrade;"
        echo "        proxy_set_header Connection \"upgrade\";"
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
  local cert_host="${2:-}"
  local server_names="$3"

  echo "server {"
  if [[ "$listen_ssl" == "1" ]]; then
    echo "    listen 443 ssl http2;"
    echo "    listen [::]:443 ssl http2;"
    echo "    server_name ${server_names};"
    echo "    ssl_certificate     /etc/letsencrypt/live/${cert_host}/fullchain.pem;"
    echo "    ssl_certificate_key /etc/letsencrypt/live/${cert_host}/privkey.pem;"
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

OUT="$(nginx_customer_conf_available "$DOMAIN")"
ENABLED_LINK="$(nginx_customer_conf_enabled "$DOMAIN")"
{
  echo "# Qadbak — ${DOMAIN} (user ${USER}, mode ${SITE_MODE}, root ${PUB})"
  if [[ -n "$SSL_CERT_HOST" ]]; then
    if [[ "$WWW_REDIRECT" == "apex" ]]; then
      write_site_server 1 "$SSL_CERT_HOST" "$DOMAIN"
      echo ""
      echo "server {"
      echo "    listen 443 ssl http2;"
      echo "    listen [::]:443 ssl http2;"
      echo "    server_name www.${DOMAIN};"
      echo "    ssl_certificate     /etc/letsencrypt/live/${SSL_CERT_HOST}/fullchain.pem;"
      echo "    ssl_certificate_key /etc/letsencrypt/live/${SSL_CERT_HOST}/privkey.pem;"
      echo "    return 301 https://${DOMAIN}\$request_uri;"
      echo "}"
      echo ""
      echo "server {"
      echo "    listen 80;"
      echo "    listen [::]:80;"
      echo "    server_name ${DOMAIN} www.${DOMAIN};"
      echo "    location ^~ /.well-known/acme-challenge/ {"
      echo "        root ${PUB};"
      echo "        allow all;"
      echo "        try_files \$uri =404;"
      echo "    }"
      echo "    location / { return 301 https://${DOMAIN}\$request_uri; }"
      echo "}"
    else
      write_site_server 1 "$SSL_CERT_HOST" "${DOMAIN} www.${DOMAIN}"
      echo ""
      echo "server {"
      echo "    listen 80;"
      echo "    listen [::]:80;"
      echo "    server_name ${DOMAIN} www.${DOMAIN};"
      echo "    root ${PUB};"
      echo "    location ^~ /.well-known/acme-challenge/ {"
      echo "        allow all;"
      echo "        try_files \$uri =404;"
      echo "    }"
      echo "    location / { return 301 https://\$host\$request_uri; }"
      echo "}"
    fi
  else
    if [[ "$WWW_REDIRECT" == "apex" ]]; then
      write_site_server 0 "" "$DOMAIN"
      echo ""
      echo "server {"
      echo "    listen 80;"
      echo "    listen [::]:80;"
      echo "    server_name www.${DOMAIN};"
      echo "    return 301 http://${DOMAIN}\$request_uri;"
      echo "}"
    else
      write_site_server 0 "" "${DOMAIN} www.${DOMAIN}"
    fi
  fi
} >"$OUT"

ln -sf "$OUT" "$ENABLED_LINK"
if [[ "${NGINX_BATCH:-}" != "1" ]]; then
  nginx -t
  systemctl reload nginx
fi
if [[ "${HAS_ROOT_PROXY:-0}" == "1" ]]; then
  echo "OK — nginx vhost ${DOMAIN} (reverse proxy root${SSL_CERT_HOST:+, HTTPS})"
elif [[ "$SITE_MODE" == "static" ]]; then
  echo "OK — nginx vhost ${DOMAIN} (static ${PUB}${SSL_CERT_HOST:+, HTTPS})"
elif php_fpm_pool_available "$USER"; then
  echo "OK — nginx vhost ${DOMAIN} (PHP-FPM unix:$(php_fpm_socket_path "$USER")${SSL_CERT_HOST:+, HTTPS})"
else
  echo "OK — nginx vhost ${DOMAIN} (PHP → Apache ${APACHE_BACKEND}${SSL_CERT_HOST:+, HTTPS})"
fi

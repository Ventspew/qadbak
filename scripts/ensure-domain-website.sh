#!/usr/bin/env bash
# ensure-domain-website.sh — single source of truth for "make this Qadbak
# domain fully serving over HTTP and HTTPS".
#
# Idempotent: safe to run repeatedly. Best-effort: a failing optional step
# (e.g. certbot rate-limited) prints a clear warning but never destroys an
# already-working domain or aborts the whole run.
#
# Usage:  sudo bash scripts/ensure-domain-website.sh DOMAIN USER
#
# Internal/test modes:
#   ensure-domain-website.sh __probe__                          → echo OK (sudoers probe)
#   ensure-domain-website.sh __test_placeholder__ FILE          → exit 0 if FILE is
#       a known placeholder (empty/"Hello"/"OK"/Qadbak landing — safe to
#       overwrite). Exit 1 if FILE is real customer content.

set -uo pipefail

if [[ "${1:-}" == "__probe__" ]]; then
  echo "OK"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QADBAK_DIR="${QADBAK_DIR:-$ROOT}"
# shellcheck source=lib/website-config.sh
source "$QADBAK_DIR/scripts/lib/website-config.sh"
# website-config.sh enables errexit; this script is best-effort.
set +e
set -uo pipefail

# -----------------------------------------------------------------------------
# Placeholder detection
# -----------------------------------------------------------------------------
# Returns 0 (success) if it is SAFE to overwrite the given index.html with a
# fresh Qadbak landing page. Returns 1 if the file looks like real customer
# content and must not be touched.
#
# Safe-to-overwrite cases:
#   - File does not exist
#   - File is empty / whitespace only
#   - File body is just "Hello" / "OK" (Apache/nginx welcome stubs)
#   - File contains a Qadbak landing marker (we wrote it ourselves)
#
# Real-content cases (never overwrite):
#   - File size > 1024 bytes AND no Qadbak marker
#   - File contains `<html` or `<?php` AND no Qadbak marker
#   - Anything else we do not recognize (be conservative)
is_safe_to_overwrite_landing() {
  local file="${1:?file path required}"

  if [[ ! -e "$file" ]]; then
    return 0
  fi

  local size
  size="$(wc -c <"$file" 2>/dev/null | tr -d '[:space:]' || echo 0)"
  size="${size:-0}"

  if (( size == 0 )); then
    return 0
  fi

  # Trivial stub bodies — strip whitespace, lowercase, then compare.
  local trimmed=""
  trimmed="$(tr -d '[:space:]' <"$file" 2>/dev/null | tr 'A-Z' 'a-z' | head -c 256)"
  case "$trimmed" in
    ""|"hello"|"ok"|"hellofromqadbak") return 0 ;;
  esac

  # Our own Qadbak landing — safe to refresh (not an external marketing site).
  if grep -qF 'hosted on Qadbak' "$file" 2>/dev/null \
     || grep -qF 'Qadbak file manager' "$file" 2>/dev/null; then
    return 0
  fi

  # Anything that looks like real HTML/PHP and is not ours → keep it.
  if (( size > 1024 )); then
    return 1
  fi
  if grep -qiE '<html|<\?php' "$file" 2>/dev/null; then
    return 1
  fi

  # Small, unrecognized content (could be a custom one-liner the customer
  # wrote). Default to NOT overwriting.
  return 1
}

if [[ "${1:-}" == "__test_placeholder__" ]]; then
  test_path="${2:-}"
  if [[ -z "$test_path" ]]; then
    echo "Usage: $0 __test_placeholder__ FILE" >&2
    exit 2
  fi
  if is_safe_to_overwrite_landing "$test_path"; then
    echo "placeholder (safe to overwrite)"
    exit 0
  fi
  echo "real content (do not overwrite)"
  exit 1
fi

# -----------------------------------------------------------------------------
# Real entry point
# -----------------------------------------------------------------------------
DOMAIN="${1:-}"
USER="${2:-}"
if [[ -z "$DOMAIN" || -z "$USER" ]]; then
  echo "Usage: sudo bash $0 DOMAIN USER" >&2
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0 $DOMAIN $USER" >&2
  exit 1
fi

HOME_DIR="/home/${USER}"
PUB="$(website_web_root "$DOMAIN" "$USER")"
BAK="${HOME_DIR}/backups"
PARENT_PUB="${HOME_DIR}/public_html"

# Bot / Minecraft / similar used to publish into ~/apps/*/www. Move that
# tree into the subdomain document root so Files and nginx share one place.
REG="${QADBAK_DIR}/data/native-domains.json"
TYPE=""
if [[ -f "$REG" ]] && command -v jq >/dev/null 2>&1; then
  TYPE="$(jq -r --arg d "$DOMAIN" '.[] | select(.name==$d) | .type // "top"' "$REG" 2>/dev/null | head -1)"
fi
if [[ "$TYPE" == "sub" && "$PUB" == "${HOME_DIR}/apps/"*"/www" ]]; then
  CANONICAL="${HOME_DIR}/domains/${DOMAIN}/public_html"
  mkdir -p "$CANONICAL"
  if [[ -d "$PUB" ]]; then
    cp -a "${PUB}/." "$CANONICAL/" 2>/dev/null || true
  fi
  cfg="$(website_config_file "$DOMAIN")"
  if [[ -f "$cfg" ]] && command -v jq >/dev/null 2>&1; then
    tmp="$(mktemp)"
    if jq --arg r "$CANONICAL" '.webRoot = $r' "$cfg" >"$tmp" 2>/dev/null; then
      mv "$tmp" "$cfg"
    else
      rm -f "$tmp"
    fi
  fi
  chown -R "${USER}:${USER}" "${HOME_DIR}/domains/${DOMAIN}" 2>/dev/null || true
  PUB="$CANONICAL"
fi

if ! id "$USER" >/dev/null 2>&1; then
  echo "cannot ensure $DOMAIN without unix user $USER" >&2
  exit 2
fi
if [[ ! -d "$HOME_DIR" ]]; then
  echo "cannot ensure $DOMAIN without home directory $HOME_DIR" >&2
  exit 2
fi

# -----------------------------------------------------------------------------
# Step accounting (printed at the end as a tidy summary)
# -----------------------------------------------------------------------------
declare -a STEP_NAMES=()
declare -a STEP_STATUS=()

mark() {
  STEP_NAMES+=("$1")
  STEP_STATUS+=("$2")
}

step_header() {
  echo ""
  echo "==> $1"
}

step_header "ensure-domain-website.sh $DOMAIN (user $USER)"

# -----------------------------------------------------------------------------
# 3. public_html + backups + ownership
# -----------------------------------------------------------------------------
step_header "public_html / backups / ownership"
created_any=0
if [[ ! -d "$PUB" ]]; then
  mkdir -p "$PUB" && created_any=1
fi
if [[ ! -d "$BAK" ]]; then
  mkdir -p "$BAK" && created_any=1
fi
if [[ "$PUB" == "$PARENT_PUB" ]]; then
  # public_html + backups only — mailbox homes/ must keep their own UIDs.
  if chown -R "${USER}:${USER}" "$PUB" "$BAK" 2>/dev/null; then
    if (( created_any )); then
      echo "    created missing public_html/backups + chown ${USER}:${USER}"
    else
      echo "    public_html + backups already present; re-asserted ownership"
    fi
    mark "public_html/backups" "ok"
  else
    echo "    WARN — chown failed for $HOME_DIR (continuing)" >&2
    mark "public_html/backups" "warn"
  fi
else
  if chown -R "${USER}:${USER}" "$PUB" "$BAK" 2>/dev/null; then
    echo "    subdomain docroot $PUB + backups; chown ${USER}:${USER}"
    mark "public_html/backups" "ok"
  else
    echo "    WARN — chown failed for $PUB (continuing)" >&2
    mark "public_html/backups" "warn"
  fi
  cfg="$(website_config_file "$DOMAIN")"
  if [[ ! -f "$cfg" ]]; then
    node "$QADBAK_DIR/scripts/lib/write-website-config.mjs" "$DOMAIN" --webRoot "$PUB" --mode php \
      && echo "    wrote website.json webRoot=$PUB" \
      || echo "    WARN — could not write website.json" >&2
  fi
fi

# -----------------------------------------------------------------------------
# 4. Qadbak landing (only when safe — never overwrite real content)
# -----------------------------------------------------------------------------
step_header "Qadbak landing page"
INDEX_HTML="$PUB/index.html"
LANDING_LIB="$ROOT/scripts/lib/qadbak-landing-html.sh"
if [[ ! -f "$LANDING_LIB" ]]; then
  echo "    SKIP — missing $LANDING_LIB"
  mark "landing" "skip"
elif [[ -f "$PUB/index.php" || -f "$PUB/index.htm" ]]; then
  echo "    SKIP — customer has index.php/index.htm — landing not needed"
  mark "landing" "skip"
elif is_safe_to_overwrite_landing "$INDEX_HTML"; then
  # write_qadbak_landing only writes when no index exists, so we
  # nudge it by removing a placeholder first.
  if [[ -e "$INDEX_HTML" ]]; then
    rm -f "$INDEX_HTML"
  fi
  # shellcheck source=lib/qadbak-landing-html.sh
  source "$LANDING_LIB"
  if write_qadbak_landing "$PUB" "$DOMAIN" "${USER}:${USER}"; then
    echo "    wrote Qadbak landing → $INDEX_HTML"
    mark "landing" "ok"
  else
    echo "    WARN — write_qadbak_landing returned non-zero" >&2
    mark "landing" "warn"
  fi
else
  echo "    KEEP — $INDEX_HTML looks like real customer content (not touched)"
  mark "landing" "keep"
fi

# -----------------------------------------------------------------------------
# 5. Apache backend vhost (so PHP requests have somewhere to go)
# -----------------------------------------------------------------------------
step_header "Apache backend vhost"
FIX_APACHE_LIB="$ROOT/scripts/lib/fix-apache-vhost.sh"
if [[ -f "$FIX_APACHE_LIB" ]]; then
  if [[ -z "${APACHE_BACKEND:-}" && -f "$ROOT/scripts/detect-web-backend.sh" ]]; then
    APACHE_BACKEND="$(DETECT_DOMAIN="$DOMAIN" bash "$ROOT/scripts/detect-web-backend.sh" 2>/dev/null | tail -1)"
  fi
  export APACHE_BACKEND="${APACHE_BACKEND:-127.0.0.1:8080}"
  # shellcheck source=lib/fix-apache-vhost.sh
  source "$FIX_APACHE_LIB"
  if fix_apache_vhost_for_domain "$DOMAIN" "$USER" "$PUB" "$ROOT"; then
    mark "apache-vhost" "ok"
  else
    echo "    WARN — fix_apache_vhost_for_domain returned non-zero" >&2
    mark "apache-vhost" "warn"
  fi
else
  echo "    SKIP — missing $FIX_APACHE_LIB"
  mark "apache-vhost" "skip"
fi

# -----------------------------------------------------------------------------
# 6. nginx customer vhost (HTTP)
# -----------------------------------------------------------------------------
step_header "nginx customer vhost (HTTP)"
NGINX_ONE="$ROOT/scripts/apply-customer-nginx-vhost-one.sh"
NGINX_APPLY="$ROOT/scripts/apply-domain-nginx.sh"
if [[ -f "$NGINX_ONE" ]]; then
  if bash "$NGINX_ONE" "$DOMAIN" "$USER"; then
    mark "nginx-vhost" "ok"
  else
    echo "    WARN — apply-customer-nginx-vhost-one.sh failed for $DOMAIN" >&2
    mark "nginx-vhost" "warn"
  fi
elif [[ -f "$NGINX_APPLY" ]]; then
  if bash "$NGINX_APPLY" "$DOMAIN" "$USER"; then
    mark "nginx-vhost" "ok"
  else
    echo "    WARN — apply-domain-nginx.sh failed for $DOMAIN" >&2
    mark "nginx-vhost" "warn"
  fi
else
  echo "    SKIP — missing $NGINX_APPLY"
  mark "nginx-vhost" "skip"
fi

# -----------------------------------------------------------------------------
# 7. Let's Encrypt SSL (best-effort)
# -----------------------------------------------------------------------------
step_header "Let's Encrypt certificate"
if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]] \
   || [[ -f "/etc/letsencrypt/live/www.${DOMAIN}/fullchain.pem" ]]; then
  echo "    OK — certificate already present"
  mark "letsencrypt" "ok"
elif ! command -v certbot >/dev/null 2>&1; then
  echo "    SKIP — certbot not installed (sudo apt-get install -y certbot)"
  mark "letsencrypt" "skip"
elif [[ -f "$NGINX_APPLY" ]]; then
  if ISSUE_SSL=1 bash "$NGINX_APPLY" "$DOMAIN" "$USER"; then
    if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
      echo "    OK — Let's Encrypt cert issued for $DOMAIN"
      mark "letsencrypt" "ok"
    else
      echo "    WARN — certbot did not produce a cert (DNS not pointed yet? rate-limit? Cloudflare proxy?)"
      echo "           Domain still serves via HTTPS using the default-deny snake-oil cert until DNS is ready."
      echo "           Re-run later:  sudo ISSUE_SSL=1 bash $NGINX_APPLY $DOMAIN $USER"
      mark "letsencrypt" "warn"
    fi
  else
    echo "    WARN — apply-domain-nginx.sh exited non-zero during SSL attempt (continuing)" >&2
    mark "letsencrypt" "warn"
  fi
else
  echo "    SKIP — missing $NGINX_APPLY (cannot run certbot helper)"
  mark "letsencrypt" "skip"
fi

# -----------------------------------------------------------------------------
# 8. Per-tenant PHP-FPM pool (Qadbak Premium: php-fpm-isolation)
# -----------------------------------------------------------------------------
step_header "PHP-FPM per-tenant pool"
PHP_LIB="$ROOT/scripts/lib/php-fpm-pool.sh"
LICENSE_FILE="$QADBAK_DIR/data/license.json"

license_has_php_fpm_isolation() {
  [[ -f "$LICENSE_FILE" ]] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -e '.features // [] | index("php-fpm-isolation") != null' \
      "$LICENSE_FILE" >/dev/null 2>&1
  else
    grep -qE '"php-fpm-isolation"' "$LICENSE_FILE" 2>/dev/null
  fi
}

if [[ ! -f "$PHP_LIB" ]]; then
  echo "    SKIP — missing $PHP_LIB"
  mark "php-fpm-pool" "skip"
elif ! license_has_php_fpm_isolation; then
  echo "    SKIP — php-fpm-isolation feature not licensed (Qadbak Core)"
  mark "php-fpm-pool" "skip"
else
  # Default to 8.2; provision-domain.mjs writes per-domain php.json with the
  # desired version, and apply-php-fpm-pool.sh resolves the real installed
  # version from php_fpm_detect_version().
  PHP_VER="8.2"
  if [[ -f "$QADBAK_DIR/data/domain-config/$DOMAIN/php.json" ]] \
     && command -v jq >/dev/null 2>&1; then
    PHP_VER="$(jq -r '.defaultVersion // "8.2"' \
      "$QADBAK_DIR/data/domain-config/$DOMAIN/php.json" 2>/dev/null \
      || echo 8.2)"
  fi
  if bash "$ROOT/scripts/apply-php-fpm-pool.sh" "$USER" "$PHP_VER" "$HOME_DIR"; then
    mark "php-fpm-pool" "ok"
  else
    echo "    WARN — apply-php-fpm-pool.sh failed for $USER (PHP $PHP_VER) — continuing" >&2
    mark "php-fpm-pool" "warn"
  fi
fi

# -----------------------------------------------------------------------------
# 9. Final probes
# -----------------------------------------------------------------------------
step_header "Probes"
HTTP_PROBE_BODY="$(mktemp)"
HTTPS_PROBE_BODY="$(mktemp)"
trap 'rm -f "$HTTP_PROBE_BODY" "$HTTPS_PROBE_BODY"' EXIT

HTTP_CODE="$(curl -sS --max-time 6 -o "$HTTP_PROBE_BODY" -w '%{http_code}' \
  -H "Host: $DOMAIN" http://127.0.0.1/ 2>/dev/null || echo 000)"
HTTPS_CODE="$(curl -skS --max-time 6 -o "$HTTPS_PROBE_BODY" -w '%{http_code}' \
  -H "Host: $DOMAIN" https://127.0.0.1/ 2>/dev/null || echo 000)"

http_ok=0
if [[ "$HTTP_CODE" =~ ^[0-9]+$ ]] && (( HTTP_CODE >= 200 && HTTP_CODE < 400 )); then
  echo "    HTTP  $HTTP_CODE  (Host: $DOMAIN → 127.0.0.1:80)"
  http_ok=1
else
  echo "    HTTP  $HTTP_CODE  FAIL for Host: $DOMAIN" >&2
  echo "    Hint: tail -n 50 /var/log/nginx/error.log" >&2
fi

if [[ "$HTTPS_CODE" =~ ^[0-9]+$ ]] && (( HTTPS_CODE >= 200 && HTTPS_CODE < 400 )); then
  echo "    HTTPS $HTTPS_CODE  (Host: $DOMAIN → 127.0.0.1:443)"
elif [[ "$HTTPS_CODE" == "000" ]]; then
  echo "    HTTPS no listener responded (cert may still be propagating)"
else
  echo "    HTTPS $HTTPS_CODE  (Host: $DOMAIN — see /var/log/nginx/error.log if unexpected)"
fi

mark "probe-http"  "$([[ $http_ok -eq 1 ]] && echo ok || echo warn)"
mark "probe-https" "$([[ $HTTPS_CODE != 000 ]] && echo ok || echo skip)"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "==> Summary for $DOMAIN"
printf "    %-22s  %s\n" "step" "status"
printf "    %-22s  %s\n" "----------------------" "------"
i=0
while (( i < ${#STEP_NAMES[@]} )); do
  printf "    %-22s  %s\n" "${STEP_NAMES[$i]}" "${STEP_STATUS[$i]}"
  i=$((i + 1))
done

# Never exit non-zero just because Let's Encrypt or a probe was soft-failed.
# Hard failures (missing user / missing home) already exited above with code 2.
exit 0

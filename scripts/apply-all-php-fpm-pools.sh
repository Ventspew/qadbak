#!/usr/bin/env bash
# Apply PHP-FPM pools + nginx vhosts for all customer domains.
set -euo pipefail

QADBAK_DIR="${QADBAK_DIR:-/opt/qadbak}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/apply-all-php-fpm-pools.sh" >&2
  exit 1
fi

# shellcheck source=lib/list-customer-domains.sh
source "$QADBAK_DIR/scripts/lib/list-customer-domains.sh"
# shellcheck source=lib/website-config.sh
source "$QADBAK_DIR/scripts/lib/website-config.sh"

if [[ -f "$QADBAK_DIR/scripts/migrate-legacy-domain-nginx.sh" ]]; then
  bash "$QADBAK_DIR/scripts/migrate-legacy-domain-nginx.sh" || true
fi

php_version_for_domain() {
  local domain="$1"
  local cfg="$QADBAK_DIR/data/domain-config/${domain}/php.json"
  [[ -f "$cfg" ]] || return 0
  if command -v jq &>/dev/null; then
    jq -r '.defaultVersion // empty' "$cfg" 2>/dev/null | head -1
    return 0
  fi
  node -e "
    const fs=require('fs');
    const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    process.stdout.write(String(j.defaultVersion||''));
  " "$cfg" 2>/dev/null || true
}

mapfile -t ROWS < <(list_customer_domains_tsv | sort -u)
if [[ ${#ROWS[@]} -eq 0 ]]; then
  echo "No customer domains to configure." >&2
  exit 0
fi

count=0
for row in "${ROWS[@]}"; do
  domain="${row%%$'\t'*}"
  user="${row#*$'\t'}"
  [[ -z "$domain" || -z "$user" ]] && continue
  ver="$(php_version_for_domain "$domain")"
  mode="$(website_mode "$domain")"
  echo "==> $domain ($user) PHP-FPM"
  if [[ "$mode" != "static" ]]; then
    if ! node "$QADBAK_DIR/scripts/provisioning-helper.mjs" php-sync-fpm "$domain"; then
      echo "    WARN: php-sync-fpm failed for $domain — falling back to default pool" >&2
      bash "$QADBAK_DIR/scripts/apply-php-fpm-pool.sh" "$user" "${ver:-}" "/home/${user}" \
        || echo "    WARN: pool failed for $user" >&2
      bash "$QADBAK_DIR/scripts/apply-domain-nginx.sh" "$domain" "$user" \
        || echo "    WARN: nginx failed for $domain" >&2
    fi
  else
    echo "    static site — skip PHP-FPM pool"
    bash "$QADBAK_DIR/scripts/apply-domain-nginx.sh" "$domain" "$user" \
      || echo "    WARN: nginx failed for $domain" >&2
  fi
  count=$((count + 1))
done

echo "Done — processed $count domain(s)."

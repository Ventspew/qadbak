#!/usr/bin/env bash
# Completely remove the PoGo stack from this VPS.
# Usage: sudo bash /opt/qadbak/scripts/remove-pogo-stack.sh [--yes]
set -euo pipefail

QADBAK_DIR="${QADBAK_DIR:-/opt/qadbak}"
STACK="$QADBAK_DIR/integrations/pogo-stack"
YES=0
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && YES=1

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0 --yes" >&2
  exit 1
fi

if [[ "$YES" -ne 1 ]]; then
  echo "This will permanently remove PoGo containers, volumes, nginx vhosts, certs data, and $STACK"
  echo "Re-run with: sudo bash $0 --yes"
  exit 1
fi

log() { printf '%s\n' "$*"; }

log "==> Stopping Docker project pogo-stack"
if [[ -f "$STACK/docker-compose.yml" ]]; then
  (cd "$STACK" && docker compose --profile mapping --profile workers --profile full down -v --remove-orphans) 2>/dev/null || true
fi
# Catch anything left by project name / name filter
docker ps -aq --filter "name=pogo-stack" | xargs -r docker rm -f 2>/dev/null || true
docker volume ls -q --filter "name=pogo-stack" | xargs -r docker volume rm -f 2>/dev/null || true
docker network ls -q --filter "name=pogo-stack" | xargs -r docker network rm 2>/dev/null || true
# Images we pulled for the stack (optional — keep shared ones if used elsewhere)
for img in \
  ghcr.io/turtiesocks/koji:main \
  ghcr.io/watwowmap/reactmap:v1.27.2 \
  ghcr.io/unownhash/golbat:main \
  ghcr.io/unownhash/rotom:main \
  ghcr.io/unownhash/dragonite-public:latest \
  pogo-stack-dashboard \
  pogo-stack-account-api \
  pogo-stack-worker-agent \
  pogo-stack-houndour \
  pogo-stack-rotom \
  pogo-stack-dragonite
do
  docker image rm -f "$img" 2>/dev/null || true
done

log "==> Removing nginx vhosts (pogo / map / koji)"
# shellcheck source=/dev/null
if [[ -f "$QADBAK_DIR/scripts/lib/nginx-customer-vhost.sh" ]]; then
  # shellcheck disable=SC1091
  source "$QADBAK_DIR/scripts/lib/nginx-customer-vhost.sh"
fi

remove_host() {
  local host="$1"
  log "    - $host"
  if declare -F nginx_customer_conf_remove >/dev/null 2>&1; then
    nginx_customer_conf_remove "$host" || true
  else
    slug="$(echo "$host" | tr '[:upper:].' '[:lower:]-')"
    rm -f "/etc/nginx/sites-available/qadbak-customer-${slug}.conf" \
          "/etc/nginx/sites-enabled/qadbak-customer-${slug}.conf" 2>/dev/null || true
  fi
  rm -rf "$QADBAK_DIR/data/domain-config/$host" 2>/dev/null || true
}

export QADBAK_DIR
python3 - <<'PY'
import json, pathlib, os
q = pathlib.Path(os.environ.get("QADBAK_DIR", "/opt/qadbak"))
hosts = set()
state = q / "data/pogo-stack.json"
if state.exists():
  try:
    d = json.loads(state.read_text())
    if d.get("pogoHost"):
      hosts.add(d["pogoHost"])
    if d.get("domain"):
      dom = d["domain"]
      hosts.update({f"pogo.{dom}", f"map.{dom}", f"koji.{dom}"})
  except Exception:
    pass
for name in ("pogo.inveil.net", "map.inveil.net", "koji.inveil.net"):
  if (q / "data/domain-config" / name).exists():
    hosts.add(name)
# Also scan domain-config for pogo/map/koji prefixes
dc = q / "data/domain-config"
if dc.is_dir():
  for p in dc.iterdir():
    n = p.name.lower()
    if n.startswith(("pogo.", "map.", "koji.")):
      hosts.add(p.name)
(q / "data").mkdir(parents=True, exist_ok=True)
(pathlib.Path("/tmp/qadbak-pogo-hosts.txt")).write_text("\n".join(sorted(hosts)) + ("\n" if hosts else ""))
print("\n".join(sorted(hosts)))
PY

while IFS= read -r host; do
  [[ -z "$host" ]] && continue
  remove_host "$host"
done < /tmp/qadbak-pogo-hosts.txt
rm -f /tmp/qadbak-pogo-hosts.txt

# Drop from native-domains registry
if [[ -f "$QADBAK_DIR/data/native-domains.json" ]]; then
  python3 - <<PY
import json
from pathlib import Path
p=Path("$QADBAK_DIR/data/native-domains.json")
rows=json.loads(p.read_text())
drop={"pogo.inveil.net","map.inveil.net","koji.inveil.net"}
# also drop any pogoHost from state
state=Path("$QADBAK_DIR/data/pogo-stack.json")
if state.exists():
  try:
    d=json.loads(state.read_text())
    if d.get("pogoHost"): drop.add(d["pogoHost"])
    if d.get("domain"):
      drop.update({f"pogo.{d['domain']}", f"map.{d['domain']}", f"koji.{d['domain']}"})
  except Exception:
    pass
keep=[r for r in rows if str(r.get("name","")).lower() not in {x.lower() for x in drop}]
if len(keep)!=len(rows):
  p.write_text(json.dumps(keep, indent=2)+"\n")
  print(f"removed {len(rows)-len(keep)} domain registry row(s)")
PY
fi

if nginx -t 2>/dev/null; then
  systemctl reload nginx || true
  log "    nginx reloaded"
fi

log "==> Removing Let's Encrypt / origin certs for map/koji/pogo (optional keep if shared)"
for host in pogo.inveil.net map.inveil.net koji.inveil.net; do
  if [[ -d "/etc/letsencrypt/live/$host" ]]; then
    certbot delete --cert-name "$host" --non-interactive 2>/dev/null || \
      rm -rf "/etc/letsencrypt/live/$host" "/etc/letsencrypt/archive/$host" "/etc/letsencrypt/renewal/${host}.conf" 2>/dev/null || true
  fi
  rm -rf "/etc/qadbak/ssl/$host" 2>/dev/null || true
done

log "==> Removing stack files + state"
rm -rf "$STACK"
rm -f "$QADBAK_DIR/data/pogo-stack.json"
rm -rf "$QADBAK_DIR/data/pogo-stack" 2>/dev/null || true

log ""
log "OK — PoGo stack removed from this VPS."
log "Cloudflare: delete A records for pogo / map / koji if you no longer need them."
log "Git: after pull, the stack is also gone from the repo."

#!/usr/bin/env bash
# Re-apply PoGo dashboard + map/koji reverse proxies (+ optional TLS).
# Usage: sudo bash scripts/lib/repair-pogo-proxy.sh [pogo.inveil.net]
set -euo pipefail

QADBAK_DIR="${QADBAK_DIR:-/opt/qadbak}"
POGO_DIR="$QADBAK_DIR/integrations/pogo-stack"
STATE="$QADBAK_DIR/data/pogo-stack.json"
HOST="${1:-}"

if [[ -z "$HOST" && -f "$STATE" ]]; then
  HOST="$(python3 -c "import json; print(json.load(open('$STATE')).get('pogoHost',''))" 2>/dev/null || true)"
fi
HOST="${HOST:-pogo.inveil.net}"
PARENT="${HOST#*.}"
MAP_HOST="map.${PARENT}"
KOJI_HOST="koji.${PARENT}"

USER=""
if [[ -f "$QADBAK_DIR/data/native-domains.json" ]]; then
  USER="$(python3 - <<PY
import json
rows=json.load(open("$QADBAK_DIR/data/native-domains.json"))
host="$HOST".lower()
parent="$PARENT".lower()
for r in rows:
  if str(r.get("name","")).lower()==host and r.get("user"):
    print(r["user"]); break
else:
  for r in rows:
    if str(r.get("name","")).lower()==parent and r.get("user"):
      print(r["user"]); break
PY
)"
fi
USER="${USER:-inveil}"

PORT=18080
REACTMAP_PORT=18081
KOJI_PORT=18082
if [[ -f "$POGO_DIR/.env" ]]; then
  PORT="$(grep -E '^DASHBOARD_PORT=' "$POGO_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '\"' || true)"
  PORT="${PORT:-18080}"
  REACTMAP_PORT="$(grep -E '^REACTMAP_PORT=' "$POGO_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '\"' || true)"
  REACTMAP_PORT="${REACTMAP_PORT:-18081}"
  KOJI_PORT="$(grep -E '^KOJI_PORT=' "$POGO_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '\"' || true)"
  KOJI_PORT="${KOJI_PORT:-18082}"
fi

write_proxy_vhost() {
  local name="$1"
  local dest="$2"
  local ws="${3:-false}"
  local ws_py=False
  case "$ws" in
    true|TRUE|1|yes|YES) ws_py=True ;;
  esac
  echo "==> Proxy ${name} → ${dest}"
  mkdir -p "$QADBAK_DIR/data/domain-config/$name"
  python3 - <<PY
import json, pathlib
cfg=pathlib.Path("$QADBAK_DIR/data/domain-config/$name")
cfg.mkdir(parents=True, exist_ok=True)
(cfg/"website.json").write_text(json.dumps({
  "webRoot": f"/home/$USER/public_html",
  "mode": "static",
  "wwwRedirect": "none",
}, indent=2)+"\n")
(cfg/"proxies.json").write_text(json.dumps([{
  "path": "/",
  "dest": "$dest",
  "type": "proxy",
  "websocket": $ws_py,
}], indent=2)+"\n")
print("wrote", cfg)
PY
  # Register subdomain in native-domains if missing
  python3 - <<PY
import json, pathlib
path=pathlib.Path("$QADBAK_DIR/data/native-domains.json")
if not path.exists():
  raise SystemExit
rows=json.loads(path.read_text())
name="$name".lower()
parent="$PARENT".lower()
user="$USER"
if not any(str(r.get("name","")).lower()==name for r in rows):
  rows.append({
    "name": "$name",
    "user": user,
    "disabled": False,
    "plan": "Default",
    "type": "sub",
    "parent": "$PARENT",
    "isDefault": False,
  })
  path.write_text(json.dumps(rows, indent=2)+"\n")
  print("registered subdomain", name)
PY
  bash "$QADBAK_DIR/scripts/apply-domain-nginx.sh" "$name" "$USER" --ssl || true
}

echo "==> PoGo proxy repair"
echo "    dashboard $HOST → http://127.0.0.1:${PORT}/"
echo "    reactmap  $MAP_HOST → http://127.0.0.1:${REACTMAP_PORT}/"
echo "    koji      $KOJI_HOST → http://127.0.0.1:${KOJI_PORT}/"

write_proxy_vhost "$HOST" "http://127.0.0.1:${PORT}/" false
write_proxy_vhost "$MAP_HOST" "http://127.0.0.1:${REACTMAP_PORT}/" true
write_proxy_vhost "$KOJI_HOST" "http://127.0.0.1:${KOJI_PORT}/" true

# Persist public URLs for the dashboard container / docs
if [[ -f "$POGO_DIR/.env" ]]; then
  python3 - <<PY
from pathlib import Path
p=Path("$POGO_DIR/.env")
text=p.read_text()
def upsert(text, key, val):
  import re
  if re.search(rf'^{key}=', text, re.M):
    return re.sub(rf'^{key}=.*$', f'{key}={val}', text, count=1, flags=re.M)
  return text.rstrip()+"\n"+f"{key}={val}\n"
text=upsert(text, "MAP_PUBLIC_URL", "https://$MAP_HOST/")
text=upsert(text, "KOJI_PUBLIC_URL", "https://$KOJI_HOST/")
text=upsert(text, "REACTMAP_PORT", "$REACTMAP_PORT")
text=upsert(text, "KOJI_PORT", "$KOJI_PORT")
p.write_text(text)
print("updated", p)
PY
fi

echo "==> Wait for dashboard on :${PORT}"
for i in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/"; then
    echo "dashboard ready after ${i}s"
    break
  fi
  sleep 1
done

echo "==> Local checks"
curl -sS -o /dev/null -w "dashboard :${PORT} → %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -sS -o /dev/null -w "reactmap :${REACTMAP_PORT} → %{http_code}\n" "http://127.0.0.1:${REACTMAP_PORT}/" || true
curl -sS -o /dev/null -w "koji :${KOJI_PORT} → %{http_code}\n" "http://127.0.0.1:${KOJI_PORT}/" || true
curl -sS -o /dev/null -w "origin HTTP $HOST / → %{http_code}\n" -H "Host: ${HOST}" "http://127.0.0.1/" || true

if [[ -f "/etc/letsencrypt/live/${HOST}/fullchain.pem" ]]; then
  echo "TLS cert present for ${HOST}"
else
  echo "WARN: no Let's Encrypt cert for ${HOST}"
fi

echo ""
echo "Cloudflare DNS (orange cloud OK once certs exist; SSL mode Full):"
echo "  A  pogo  → origin IP"
echo "  A  map   → origin IP"
echo "  A  koji  → origin IP"
echo "OK — repaired ${HOST}, ${MAP_HOST}, ${KOJI_HOST}"

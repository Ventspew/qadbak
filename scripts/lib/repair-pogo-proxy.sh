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

detect_origin_ip() {
  local ip=""
  if [[ -f "$POGO_DIR/.env" ]]; then
    ip="$(grep -E '^SERVER_PUBLIC_IP=' "$POGO_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '\"' || true)"
  fi
  if [[ -z "$ip" || "$ip" == "127.0.0.1" ]]; then
    ip="$(curl -4 -fsS --max-time 5 https://ifconfig.me/ip 2>/dev/null \
      || curl -4 -fsS --max-time 5 https://icanhazip.com 2>/dev/null \
      || true)"
    ip="$(echo "$ip" | tr -d '[:space:]')"
  fi
  echo "$ip"
}

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

http_code() {
  # usage: http_code URL [curl args...]
  local url="$1"; shift
  curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 "$@" "$url" 2>/dev/null || echo "000"
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
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/health"; then
    echo "dashboard ready after ${i}s"
    break
  fi
  sleep 1
done

ORIGIN_IP="$(detect_origin_ip)"

echo "==> Local checks (containers + nginx Host headers)"
echo "dashboard :${PORT} → $(http_code "http://127.0.0.1:${PORT}/api/health")"
echo "reactmap  :${REACTMAP_PORT} → $(http_code "http://127.0.0.1:${REACTMAP_PORT}/")"
echo "koji      :${KOJI_PORT} → $(http_code "http://127.0.0.1:${KOJI_PORT}/")"
echo "nginx HTTP  $HOST → $(http_code "http://127.0.0.1/" -H "Host: ${HOST}")"
echo "nginx HTTP  $MAP_HOST → $(http_code "http://127.0.0.1/" -H "Host: ${MAP_HOST}")"
echo "nginx HTTP  $KOJI_HOST → $(http_code "http://127.0.0.1/" -H "Host: ${KOJI_HOST}")"
# URL host must match --resolve host (SNI + Host), otherwise curl hits 127.0.0.1 literally.
echo "nginx HTTPS $HOST → $(http_code "https://${HOST}/" -k --resolve "${HOST}:443:127.0.0.1")"
echo "nginx HTTPS $MAP_HOST → $(http_code "https://${MAP_HOST}/" -k --resolve "${MAP_HOST}:443:127.0.0.1")"
echo "nginx HTTPS $KOJI_HOST → $(http_code "https://${KOJI_HOST}/" -k --resolve "${KOJI_HOST}:443:127.0.0.1")"

MAP_LOCAL="$(http_code "https://${MAP_HOST}/" -k --resolve "${MAP_HOST}:443:127.0.0.1")"
KOJI_LOCAL="$(http_code "https://${KOJI_HOST}/" -k --resolve "${KOJI_HOST}:443:127.0.0.1")"
POGO_LOCAL="$(http_code "https://${HOST}/" -k --resolve "${HOST}:443:127.0.0.1")"

echo ""
echo "==> Origin IP for Cloudflare A records: ${ORIGIN_IP:-UNKNOWN}"
echo "Cloudflare DNS (edit each record → Content must be this IPv4):"
echo "  A  pogo  → ${ORIGIN_IP:-<this VPS IPv4>}   (Proxied / orange)"
echo "  A  map   → ${ORIGIN_IP:-<this VPS IPv4>}   (Proxied / orange)"
echo "  A  koji  → ${ORIGIN_IP:-<this VPS IPv4>}   (Proxied / orange)"
echo "SSL/TLS encryption mode: Full  (not Flexible, not Full Strict)"
echo ""

ok_code() {
  case "$1" in 200|301|302|304) return 0 ;; *) return 1 ;; esac
}

if ! ok_code "$MAP_LOCAL"; then
  echo "FAIL — origin HTTPS for $MAP_HOST is $MAP_LOCAL (expected 200)." >&2
  ls -la "/etc/letsencrypt/live/${MAP_HOST}/" "/etc/qadbak/ssl/${MAP_HOST}/" 2>/dev/null || true
  exit 1
fi
if ! ok_code "$KOJI_LOCAL"; then
  echo "FAIL — origin HTTPS for $KOJI_HOST is $KOJI_LOCAL (expected 200)." >&2
  exit 1
fi
if ! ok_code "$POGO_LOCAL"; then
  echo "WARN — origin HTTPS for $HOST is $POGO_LOCAL" >&2
fi

echo "Origin HTTPS OK (pogo=$POGO_LOCAL map=$MAP_LOCAL koji=$KOJI_LOCAL)."
echo "Re-enable Cloudflare orange proxy on map if it is grey, then open https://${MAP_HOST}/"
echo "OK — repaired ${HOST}, ${MAP_HOST}, ${KOJI_HOST}"

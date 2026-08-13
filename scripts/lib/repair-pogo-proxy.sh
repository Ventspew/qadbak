#!/usr/bin/env bash
# Re-apply PoGo dashboard reverse proxy + optional TLS for pogo.<domain>.
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
if [[ -f "$POGO_DIR/.env" ]]; then
  PORT="$(grep -E '^DASHBOARD_PORT=' "$POGO_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '\"' || true)"
  PORT="${PORT:-18080}"
fi

echo "==> PoGo proxy repair: $HOST → http://127.0.0.1:${PORT}/ (user $USER)"

mkdir -p "$QADBAK_DIR/data/domain-config/$HOST"
python3 - <<PY
import json, pathlib
cfg=pathlib.Path("$QADBAK_DIR/data/domain-config/$HOST")
cfg.mkdir(parents=True, exist_ok=True)
(cfg/"website.json").write_text(json.dumps({
  "webRoot": f"/home/$USER/public_html",
  "mode": "static",
  "wwwRedirect": "none",
}, indent=2)+"\n")
(cfg/"proxies.json").write_text(json.dumps([{
  "path": "/",
  "dest": "http://127.0.0.1:${PORT}/",
  "type": "proxy",
  "websocket": True,
}], indent=2)+"\n")
print("wrote website.json + proxies.json")
PY

bash "$QADBAK_DIR/scripts/apply-domain-nginx.sh" "$HOST" "$USER" --ssl

echo "==> Local checks"
curl -sS -o /dev/null -w "dashboard :${PORT} → %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -sS -o /dev/null -w "origin HTTP Host ${HOST} → %{http_code}\n" -H "Host: ${HOST}" "http://127.0.0.1/" || true
if [[ -f "/etc/letsencrypt/live/${HOST}/fullchain.pem" ]]; then
  curl -sk -o /dev/null -w "origin HTTPS ${HOST} → %{http_code}\n" --resolve "${HOST}:443:127.0.0.1" "https://${HOST}/" || true
  echo "TLS cert present for ${HOST}"
else
  echo "WARN: no Let's Encrypt cert for ${HOST}"
  echo "  Cloudflare SSL mode must be Flexible until a cert exists,"
  echo "  OR set DNS to DNS-only (grey cloud), run this script again, then re-enable proxy + Full."
fi

echo "OK — repaired ${HOST}"

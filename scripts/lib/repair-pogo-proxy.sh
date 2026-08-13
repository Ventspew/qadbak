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
port = int("$PORT")
(cfg/"website.json").write_text(json.dumps({
  "webRoot": f"/home/$USER/public_html",
  "mode": "static",
  "wwwRedirect": "none",
}, indent=2)+"\n")
(cfg/"proxies.json").write_text(json.dumps([{
  "path": "/",
  "dest": f"http://127.0.0.1:{port}/",
  "type": "proxy",
  "websocket": False,
}], indent=2)+"\n")
print("wrote website.json + proxies.json")
PY

# Apply HTTP proxy (+ ACME carve-out) first; then attempt cert.
bash "$QADBAK_DIR/scripts/apply-domain-nginx.sh" "$HOST" "$USER" --ssl

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
curl -sS -o /dev/null -w "origin HTTP / → %{http_code}\n" -H "Host: ${HOST}" "http://127.0.0.1/" || true
curl -sS -o /dev/null -w "origin HTTP /api/health → %{http_code}\n" -H "Host: ${HOST}" "http://127.0.0.1/api/health" || true
# Prove ACME is not proxied to the dashboard SPA
mkdir -p "/home/${USER}/public_html/.well-known/acme-challenge"
echo ok-acme >"/home/${USER}/public_html/.well-known/acme-challenge/qadbak-probe"
chown -R "${USER}:${USER}" "/home/${USER}/public_html/.well-known" 2>/dev/null || true
probe="$(curl -sS -H "Host: ${HOST}" "http://127.0.0.1/.well-known/acme-challenge/qadbak-probe" || true)"
if [[ "$probe" == "ok-acme" ]]; then
  echo "ACME path OK (not proxied to dashboard)"
else
  echo "WARN: ACME path returned unexpected body (certbot may still fail behind Cloudflare)"
fi
rm -f "/home/${USER}/public_html/.well-known/acme-challenge/qadbak-probe"

if [[ -f "/etc/letsencrypt/live/${HOST}/fullchain.pem" ]]; then
  curl -sk -o /dev/null -w "origin HTTPS ${HOST} → %{http_code}\n" --resolve "${HOST}:443:127.0.0.1" "https://${HOST}/" || true
  echo "TLS cert present for ${HOST}"
else
  echo "WARN: no Let's Encrypt cert for ${HOST}"
  echo "  Cloudflare SSL mode must be Flexible until a cert exists,"
  echo "  OR set DNS to DNS-only (grey cloud), run this script again, then re-enable proxy + Full."
fi

echo "OK — repaired ${HOST}"

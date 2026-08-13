#!/usr/bin/env bash
# Ensure integrations/pogo-stack/.env exists with strong random secrets.
# - Creates from .env.example if missing
# - Replaces only placeholder / empty values (never overwrites real secrets)
# - Does NOT invent a Cosmog license token (that comes from Cosmog Discord)
#
# Usage:
#   bash scripts/ensure-secrets.sh
#   bash scripts/ensure-secrets.sh --show   # print key secrets (Koji, etc.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SHOW=0
[[ "${1:-}" == "--show" ]] && SHOW=1

rand() {
  openssl rand -hex 24
}

is_placeholder() {
  local v="$1"
  [[ -z "$v" ]] && return 0
  [[ "$v" == change-me* ]] && return 0
  [[ "$v" == "golbat-secret" ]] && return 0
  [[ "$v" == "127.0.0.1" ]] && return 0
  return 1
}

upsert() {
  local key="$1"
  local val="$2"
  local force="${3:-0}"
  python3 - "$key" "$val" "$force" <<'PY'
import re, sys
from pathlib import Path
key, val, force = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
p = Path(".env")
text = p.read_text() if p.exists() else ""
m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
cur = m.group(1).strip().strip('"').strip("'") if m else ""
placeholders = (
  not cur
  or cur.startswith("change-me")
  or cur in ("golbat-secret", "127.0.0.1")
)
if m and not force and not placeholders:
  print(f"keep  {key}")
  raise SystemExit(0)
line = f"{key}={val}"
if m:
  text = re.sub(rf"^{re.escape(key)}=.*$", line, text, count=1, flags=re.M)
  print(f"set   {key}")
else:
  text = text.rstrip() + "\n" + line + "\n"
  print(f"add   {key}")
p.write_text(text)
PY
}

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo "Missing .env.example" >&2
    exit 1
  fi
  cp .env.example .env
  echo "created .env from .env.example"
fi

echo "==> Ensuring random secrets in .env"

# Database passwords: do not rotate placeholders automatically (breaks existing MariaDB volumes).
python3 - <<'PY'
import re
from pathlib import Path
text = Path(".env").read_text()
for key in ("DB_ROOT_PASSWORD", "DB_PASSWORD"):
  m = re.search(rf"^{key}=(.*)$", text, re.M)
  cur = m.group(1).strip().strip('"').strip("'") if m else ""
  if (not cur) or cur.startswith("change-me"):
    print(f"WARN: {key} still placeholder — leave as-is so MariaDB keeps working; change manually only with a DB password reset")
  else:
    print(f"keep  {key}")
PY

upsert ACCOUNT_API_KEY "$(rand)"
upsert DASHBOARD_SECRET "$(rand)"
upsert KOJI_BEARER_TOKEN "$(rand)"
upsert PORACLE_SECRET "$(rand)"
upsert REACTMAP_SECRET "$(rand)"
upsert ROTOM_SECRET "$(rand)"
upsert GOLBAT_API_SECRET "$(rand)"
# GOLBAT_RAW_BEARER: only replace explicit placeholders, allow empty
python3 - <<'PY'
import re, secrets
from pathlib import Path
p = Path(".env")
text = p.read_text()
m = re.search(r"^GOLBAT_RAW_BEARER=(.*)$", text, re.M)
cur = m.group(1).strip().strip('"').strip("'") if m else None
if cur is not None and cur.startswith("change-me"):
  val = secrets.token_hex(24)
  text = re.sub(r"^GOLBAT_RAW_BEARER=.*$", f"GOLBAT_RAW_BEARER={val}", text, count=1, flags=re.M)
  p.write_text(text)
  print("set   GOLBAT_RAW_BEARER")
elif cur is None:
  p.write_text(text.rstrip() + "\nGOLBAT_RAW_BEARER=\n")
  print("add   GOLBAT_RAW_BEARER")
else:
  print("keep  GOLBAT_RAW_BEARER")
PY

# Public IP detection (only if placeholder)
PUB_IP="$(curl -4 -fsS --max-time 5 https://ifconfig.me/ip 2>/dev/null \
  || curl -4 -fsS --max-time 5 https://icanhazip.com 2>/dev/null \
  || true)"
PUB_IP="$(echo "$PUB_IP" | tr -d '[:space:]')"
if [[ -n "$PUB_IP" ]]; then
  upsert SERVER_PUBLIC_IP "$PUB_IP"
fi

# Cosmog license must come from Cosmog — never invent one
python3 - <<'PY'
import re
from pathlib import Path
text = Path(".env").read_text()
m = re.search(r"^COSMOG_TOKEN=(.*)$", text, re.M)
cur = (m.group(1).strip().strip('"').strip("'") if m else "")
if (not cur) or cur.startswith("change-me") or cur.startswith("cos-"):
    print("WARN: COSMOG_TOKEN still placeholder — set your real Cosmog license token")
else:
    print("keep  COSMOG_TOKEN (already set)")
PY

if [[ "$SHOW" -eq 1 ]] || [[ -t 1 ]]; then
  echo ""
  echo "==> Secrets you need now"
  python3 - <<'PY'
import re
from pathlib import Path
text = Path(".env").read_text()
def get(k):
  m = re.search(rf"^{re.escape(k)}=(.*)$", text, re.M)
  return m.group(1).strip() if m else ""
print(f"Koji login password (KOJI_BEARER_TOKEN):\n  {get('KOJI_BEARER_TOKEN')}")
print(f"Account API key:\n  {get('ACCOUNT_API_KEY')}")
print(f"Rotom secret:\n  {get('ROTOM_SECRET')}")
print(f"SERVER_PUBLIC_IP:\n  {get('SERVER_PUBLIC_IP')}")
print(f"COSMOG_TOKEN:\n  {get('COSMOG_TOKEN') or '(set real Cosmog license)'}")
PY
fi

echo "OK — secrets ready in $ROOT/.env"

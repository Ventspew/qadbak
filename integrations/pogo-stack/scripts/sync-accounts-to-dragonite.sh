#!/usr/bin/env bash
# Export accounts from Account API as CSV for Dragonite / manual import
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_URL="${ACCOUNT_API_URL:-http://127.0.0.1:${ACCOUNT_API_PORT:-4242}}"
API_KEY="${ACCOUNT_API_KEY:-dev-api-key}"
OUT="${1:-accounts-export.csv}"

curl -sf -H "X-API-Key: $API_KEY" "$API_URL/account?in_use=false&banned=false" \
  | python3 -c '
import csv, json, sys
rows = json.load(sys.stdin)
writer = csv.writer(sys.stdout)
writer.writerow(["auth_service", "username", "password", "level", "team"])
for row in rows:
    writer.writerow([
        row.get("auth_service", "ptc"),
        row.get("username", ""),
        "",
        row.get("level", 0),
        row.get("team", "unset"),
    ])
' > "$OUT"

echo "Exported metadata to $OUT (passwords omitted — use GET /account/{id} for full export if needed)"

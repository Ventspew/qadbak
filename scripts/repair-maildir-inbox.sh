#!/usr/bin/env bash
# Fix Maildir ownership, parent path access, and stuck tmp messages.
set -euo pipefail
ROOT="${QADBAK_DIR:-/opt/qadbak}"
DOMAIN="${1:?domain}"
USER_LOCAL="${2:-info}"

[[ -f "$ROOT/.env.local" ]] && source "$ROOT/.env.local"

UHOME="$(getent passwd "$USER_LOCAL" | cut -d: -f6)"
GROUP="$(id -gn "$USER_LOCAL" 2>/dev/null || getent passwd "$USER_LOCAL" | cut -d: -f4 | xargs getent group | cut -d: -f1)"

OWNER="$(python3 - "$DOMAIN" "$ROOT/data/native-domains.json" <<'PY'
import json, sys
domain = sys.argv[1].lower()
try:
    rows = json.load(open(sys.argv[2]))
except Exception:
    rows = []
for row in rows:
    if str(row.get("name", "")).lower() == domain and row.get("user"):
        print(row["user"])
        break
PY
)"

echo "==> Mailbox user $USER_LOCAL (home $UHOME, group $GROUP)"
if [[ -n "$OWNER" && -d "/home/$OWNER" ]]; then
  echo "==> Domain owner home /home/$OWNER (group traverse for sub-mailboxes)"
  chmod u+rx,g+rx "/home/$OWNER" 2>/dev/null || true
  [[ -d "/home/$OWNER/homes" ]] && chmod u+rx,g+rx "/home/$OWNER/homes" 2>/dev/null || true
fi

echo "==> Maildir $UHOME/Maildir"
mkdir -p "$UHOME/Maildir"/{cur,new,tmp}
for folder in Sent Drafts Archive Junk Trash; do
  mkdir -p "$UHOME/Maildir/.${folder}"/{cur,new,tmp}
done
chown -R "${USER_LOCAL}:${GROUP}" "$UHOME/Maildir"
chmod -R u+rwX,g+rwX "$UHOME/Maildir"

moved=0
if [[ -d "$UHOME/Maildir/tmp" ]]; then
  shopt -s nullglob
  for f in "$UHOME/Maildir/tmp"/*; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    if [[ ! "$base" =~ :2, ]]; then
      base="${base}:2,S"
    fi
    mv "$f" "$UHOME/Maildir/cur/$base"
    moved=$((moved + 1))
  done
  shopt -u nullglob
fi

echo "    moved $moved file(s) from tmp → cur"
for sub in new cur tmp; do
  n="$(find "$UHOME/Maildir/$sub" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "    $sub: $n file(s)"
done

if command -v doveadm &>/dev/null; then
  echo "==> doveadm save probe"
  doveadm save -u "$USER_LOCAL" -m "Qadbak repair probe $(date -Iseconds)" 2>&1 || true
fi

echo "==> mail-sync"
sudo -u "${QADBAK_USER:-qadbak}" sudo -n "$ROOT/scripts/run-provisioning-helper.sh" mail-sync | tail -1

echo "==> local delivery test"
bash "$ROOT/scripts/test-mail-receive.sh" "$DOMAIN" "$USER_LOCAL" || true

echo ""
echo "Recent LMTP/postfix lines:"
grep -iE "lmtp|${USER_LOCAL}@${DOMAIN}|status=bounced|status=sent|maildir delivery" /var/log/mail.log /var/log/syslog 2>/dev/null | tail -15 || true

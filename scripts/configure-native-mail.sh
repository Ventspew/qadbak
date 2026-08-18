#!/usr/bin/env bash
# Postfix + Dovecot for Qadbak native mail (inbound + outbound, any VPS).
#   sudo bash scripts/configure-native-mail.sh          # full apply (idempotent)
#   sudo bash scripts/configure-native-mail.sh sync     # maps only
#   sudo bash scripts/configure-native-mail.sh --force  # re-run even if stamp exists
set -euo pipefail

QADBAK_DIR="${QADBAK_DIR:-/opt/qadbak}"
[[ -d "$QADBAK_DIR" ]] || QADBAK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/mail-postfix-paths.sh
. "$QADBAK_DIR/scripts/lib/mail-postfix-paths.sh"
ACTION="${1:-apply}"
FORCE=0
[[ "${1:-}" == "--force" ]] && { FORCE=1; ACTION="apply"; }
[[ "${2:-}" == "--force" ]] && FORCE=1

STAMP="/var/lib/qadbak/native-mail-configured"
QADBAK_VIRTUAL="/etc/postfix/qadbak-virtual"
QADBAK_DOMAINS="/etc/postfix/qadbak-domains"
QADBAK_VMAILBOX="/etc/postfix/qadbak-vmailbox"
QADBAK_VMAILBOX_UID="/etc/postfix/qadbak-vmailbox-uid"
QADBAK_VMAILBOX_GID="/etc/postfix/qadbak-vmailbox-gid"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/configure-native-mail.sh" >&2
  exit 1
fi

sync_maps() {
  if [[ -f "$QADBAK_DIR/scripts/run-provisioning-helper.sh" ]]; then
    sudo -u "${QADBAK_USER:-qadbak}" sudo -n "$QADBAK_DIR/scripts/run-provisioning-helper.sh" mail-sync 2>/dev/null | tail -1 || true
  fi
}

if [[ "$ACTION" == "sync" ]]; then
  sync_maps
  echo "OK — qadbak mail maps synced"
  exit 0
fi

if [[ -f "$STAMP" && "$FORCE" -eq 0 ]]; then
  echo "==> Re-applying Postfix/Dovecot settings (stamp present; use --force for full reinstall)"
fi
[[ "$FORCE" -eq 1 ]] && rm -f "$STAMP"

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq postfix dovecot-core dovecot-imapd dovecot-lmtpd dovecot-sieve 2>/dev/null || true

touch "$QADBAK_VIRTUAL" "$QADBAK_DOMAINS" "$QADBAK_VMAILBOX" "$QADBAK_VMAILBOX_UID" "$QADBAK_VMAILBOX_GID"
chmod 640 "$QADBAK_VIRTUAL" "$QADBAK_DOMAINS" "$QADBAK_VMAILBOX" "$QADBAK_VMAILBOX_UID" "$QADBAK_VMAILBOX_GID" 2>/dev/null || true
chown root:postfix "$QADBAK_VIRTUAL" "$QADBAK_DOMAINS" "$QADBAK_VMAILBOX" "$QADBAK_VMAILBOX_UID" "$QADBAK_VMAILBOX_GID" 2>/dev/null || true

# Legacy legacy hosting API /etc/postfix/virtual must NOT be copied into qadbak-virtual —
# mailbox paths live in qadbak-vmailbox; qadbak-virtual is forwards-only.
if [[ "$FORCE" -eq 1 ]]; then
  : >"$QADBAK_VIRTUAL"
fi

echo "==> Postfix (Qadbak virtual domains + direct Maildir delivery)"
postconf -e "virtual_mailbox_domains = hash:${QADBAK_DOMAINS}"
postconf -e "virtual_mailbox_maps = hash:${QADBAK_VMAILBOX}"
postconf -e "virtual_uid_maps = hash:${QADBAK_VMAILBOX_UID}"
postconf -e "virtual_gid_maps = hash:${QADBAK_VMAILBOX_GID}"
postconf -e 'virtual_minimum_uid = 100'
postconf -e 'virtual_mailbox_base = /'
postconf -e 'virtual_transport = virtual'
postconf -e 'mailbox_transport = lmtp:unix:private/dovecot-lmtp'
postconf -e 'inet_interfaces = all'
postconf -X local_recipient_maps 2>/dev/null || true

for key in virtual_alias_domains \
  mailbox_command home_mailbox content_filter \
  canonical_maps sender_canonical_maps recipient_canonical_maps \
  relay_domains transport_maps; do
  postconf -X "$key" 2>/dev/null || true
done

postconf -e 'smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination'
postconf -e 'smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, defer_unauth_destination'
postconf -e 'smtpd_sasl_auth_enable = yes'
postconf -e 'smtpd_sasl_type = dovecot'
postconf -e 'smtpd_sasl_path = private/auth'
postconf -e 'smtpd_tls_security_level = may'
postconf -e 'smtp_tls_security_level = may'

is_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

is_mail_fqdn() {
  [[ -n "$1" && "$1" == *.* ]] && ! is_ipv4 "$1"
}

# Postfix must not use a bare IP as myhostname — virtual aliases like "info" become info@IP (invalid).
resolve_postfix_hostname() {
  local val host
  if [[ -f "$QADBAK_DIR/.env.local" ]]; then
    for key in QADBAK_MAIL_HOST QADBAK_PUBLIC_HOST PANEL_HOST; do
      val="$(grep -E "^${key}=" "$QADBAK_DIR/.env.local" 2>/dev/null | cut -d= -f2- | tr -d '"' | head -1)"
      if is_mail_fqdn "$val"; then
        echo "$val"
        return
      fi
      if is_ipv4 "$val"; then
        echo "WARN: $key=$val is an IP — Postfix needs an FQDN (fix QADBAK_MAIL_HOST in .env.local)" >&2
      fi
    done
  fi
  host="$(hostname -f 2>/dev/null || true)"
  if is_mail_fqdn "$host"; then
    echo "$host"
    return
  fi
  host="$(hostname 2>/dev/null || echo localhost.localdomain)"
  echo "$host"
}

HOST="$(resolve_postfix_hostname)"
postconf -e "myhostname = ${HOST}"
postconf -e 'myorigin = $myhostname'
postconf -e 'append_at_myorigin = no'
postconf -e 'mydestination = localhost, localhost.localdomain'

# Keep .env.local in sync when mail host was wrongly set to the panel IP.
if [[ -f "$QADBAK_DIR/.env.local" ]]; then
  ENV_MAIL="$(grep -E '^QADBAK_MAIL_HOST=' "$QADBAK_DIR/.env.local" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  if is_ipv4 "$ENV_MAIL" && is_mail_fqdn "$HOST"; then
    sed -i "s/^QADBAK_MAIL_HOST=.*/QADBAK_MAIL_HOST=${HOST}/" "$QADBAK_DIR/.env.local"
    echo "    Updated QADBAK_MAIL_HOST in .env.local → ${HOST}"
  fi
fi

echo "    Postfix myhostname = ${HOST}"

if [[ -x "$QADBAK_DIR/scripts/configure-postfix-apparmor.sh" ]]; then
  bash "$QADBAK_DIR/scripts/configure-postfix-apparmor.sh" 2>/dev/null || true
fi

DOVECOT_SNIPPET="/etc/dovecot/conf.d/99-qadbak-native.conf"
cat >"$DOVECOT_SNIPPET" <<'EOF'
# Qadbak native mail — Maildir, passwd auth, Postfix LMTP + SASL
protocols = imap pop3 lmtp

mail_location = maildir:~/Maildir
mail_privileged_group = mail
namespace inbox {
  inbox = yes
}

ssl = yes
ssl_cert = </etc/ssl/certs/ssl-cert-snakeoil.pem
ssl_key = </etc/ssl/private/ssl-cert-snakeoil.key

auth_mechanisms = plain login
disable_plaintext_auth = yes
auth_username_format = %n

passdb {
  driver = passwd
}
userdb {
  driver = passwd
}

service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}

protocol imap {
  mail_plugins = $mail_plugins sieve imap_quota
}

protocol lmtp {
  mail_plugins = $mail_plugins sieve quota
}

plugin {
  sieve = ~/Maildir/.dovecot.sieve
}
EOF

QUOTA_USERS="/etc/dovecot/qadbak-quota-users"
if [[ ! -f "$QUOTA_USERS" ]]; then
  printf '%s\n' "# user:::::::userdb_quota_rule=*:storage=NM" >"$QUOTA_USERS"
  chmod 640 "$QUOTA_USERS"
fi
cat >"/etc/dovecot/conf.d/05-qadbak-quota.conf" <<EOF
# Qadbak — Dovecot quota plugin (limits from mailbox-quotas.json)
mail_plugins = \$mail_plugins quota

plugin {
  quota = count:User quota
  quota_vsizes = yes
  quota_rule = *:storage=0
  quota_grace = 0
}

userdb {
  driver = passwd-file
  args = username_format=%n ${QUOTA_USERS}
  result_success = continue-ok
  result_failure = continue
  result_internalfail = continue
}
EOF
rm -f /etc/dovecot/conf.d/98-qadbak-quota.conf 2>/dev/null || true

MASTER="/etc/postfix/master.cf"
if [[ -f "$MASTER" ]] && ! grep -q '^submission inet' "$MASTER" 2>/dev/null; then
  cat >>"$MASTER" <<'EOF'

submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_sasl_type=dovecot
  -o smtpd_sasl_path=private/auth
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING
EOF
fi

doveconf -n >/dev/null 2>&1 || echo "WARN: doveconf check failed" >&2
systemctl enable postfix dovecot 2>/dev/null || true
systemctl restart dovecot 2>/dev/null || systemctl restart dovecot-core 2>/dev/null || true
systemctl restart postfix 2>/dev/null || true

if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 25/tcp comment 'SMTP inbound' 2>/dev/null || true
  ufw allow 587/tcp comment 'SMTP submission' 2>/dev/null || true
  ufw allow 993/tcp comment 'IMAPS' 2>/dev/null || true
fi
if [[ -x "$QADBAK_DIR/scripts/open-host-firewall-port.sh" ]]; then
  bash "$QADBAK_DIR/scripts/open-host-firewall-port.sh" 25 2>/dev/null || true
fi

mkdir -p /var/lib/qadbak
touch "$STAMP"

echo "==> Sync mailbox maps + virtual domains (hash: ... OK)"
sync_maps

# Forwards-only alias map — disable if empty so it cannot override qadbak-vmailbox.
if [[ -s "$QADBAK_VIRTUAL" ]] && grep -q '[^[:space:]]' "$QADBAK_VIRTUAL" 2>/dev/null; then
  postconf -e "virtual_alias_maps = hash:${QADBAK_VIRTUAL}"
else
  : >"$QADBAK_VIRTUAL"
  postmap "$QADBAK_VIRTUAL" 2>/dev/null || true
  postconf -X virtual_alias_maps 2>/dev/null || true
  echo "    virtual_alias_maps disabled (forwards-only; mailboxes use qadbak-vmailbox)"
fi
postfix reload 2>/dev/null || systemctl reload postfix 2>/dev/null || true
postqueue -f 2>/dev/null || true

# Warn if legacy alias still shadows a mailbox (virtual_alias wins over vmailbox).
ALIAS_CONFLICT=0
while IFS= read -r email; do
  [[ -n "$email" ]] || continue
  if postmap -q "$email" hash:"$QADBAK_VIRTUAL" 2>/dev/null | grep -q .; then
    echo "WARN: $email in qadbak-virtual AND qadbak-vmailbox — run mail-sync" >&2
    ALIAS_CONFLICT=1
  fi
done < <(grep -v '^#' "$QADBAK_VMAILBOX" 2>/dev/null | awk '{print $1}' || true)
[[ "$ALIAS_CONFLICT" -eq 0 ]] || echo "    Fix: sudo bash scripts/configure-native-mail.sh --force"

qadbak_warn_absolute_vmbox_paths "$QADBAK_VMAILBOX" || echo "    Fix: sudo bash scripts/configure-native-mail.sh --force"

# Verify postfix can write to a sample Maildir (AppArmor probe).
SAMPLE_VMAIL="$(grep -v '^#' "$QADBAK_VMAILBOX" 2>/dev/null | awk '{print $2}' | head -1 | tr -d ' ')"
if [[ -n "$SAMPLE_VMAIL" ]]; then
  SAMPLE_DIR="$(qadbak_absolute_maildir_from_vmbox "$SAMPLE_VMAIL")"
  SAMPLE_USER="$(qadbak_unix_user_from_maildir "$SAMPLE_DIR")"
  if [[ -x "$QADBAK_DIR/scripts/probe-postfix-maildir-write.sh" ]]; then
    bash "$QADBAK_DIR/scripts/probe-postfix-maildir-write.sh" "$SAMPLE_DIR" "$SAMPLE_USER" || true
  fi
fi

echo "OK — inbound mail: hash:${QADBAK_DOMAINS} + Maildir maps (qadbak-vmailbox)"
echo "    Test: sudo bash scripts/check-native-mail.sh YOUR-DOMAIN info"

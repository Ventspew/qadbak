#!/usr/bin/env bash
# Shared shell-level subcommand gate for sudo wrappers.
# Usage: write-wrapper-allowlist.sh WRAPPER_PATH ALLOWLIST_PATH HELPER_BASENAME
# Generates SCRIPT_DIR-relative wrappers (git-clean; no absolute paths).
set -euo pipefail

WRAPPER="${1:?wrapper path}"
ALLOWLIST="${2:?allowlist path}"
HELPER_BASENAME="${3:?helper .mjs basename}"

SHELL_ALLOWLIST="${ALLOWLIST/-commands.txt/-shell-commands.txt}"
: >"$SHELL_ALLOWLIST"
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" ]] && continue
  echo "${line% \*}" >>"$SHELL_ALLOWLIST"
done <"$ALLOWLIST"

SHELL_LIST_BASENAME="$(basename "$SHELL_ALLOWLIST")"

cat >"$WRAPPER" <<WRAPPER_EOF
#!/bin/bash
# NOPASSWD sudo wrapper — subcommand allowlist enforced here and in sudoers.
set -euo pipefail
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
QADBAK_NODE_BIN="\${QADBAK_NODE_BIN:-\$(command -v node 2>/dev/null || echo /usr/bin/node)}"
export QADBAK_DIR="\${QADBAK_DIR:-\$(dirname "\$SCRIPT_DIR")}"
ALLOWLIST="\$SCRIPT_DIR/lib/$SHELL_LIST_BASENAME"
CMD="\${1:-}"
if [[ -z "\$CMD" ]] || ! grep -qxF "\$CMD" "\$ALLOWLIST" 2>/dev/null; then
  echo "Disallowed command: \${CMD:-(empty)}" >&2
  exit 1
fi
exec "\$QADBAK_NODE_BIN" "\$SCRIPT_DIR/$HELPER_BASENAME" "\$@"
WRAPPER_EOF

chmod 755 "$WRAPPER"
chmod 644 "$SHELL_ALLOWLIST"

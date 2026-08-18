#!/usr/bin/env bash
# Reset files that are often modified on the server so git pull can fast-forward.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for rel in \
  package-lock.json \
  scripts/install-native-stack.sh \
  scripts/lib/linux-distro.sh \
  scripts/lib/ubuntu-release.sh \
  scripts/lib/domain-fs-shell-commands.txt \
  scripts/lib/host-services-shell-commands.txt \
  scripts/lib/stack-helper-shell-commands.txt \
  scripts/lib/update-helper-shell-commands.txt \
  scripts/run-domain-fs-helper.sh \
  scripts/run-host-services-helper.sh \
  scripts/run-stack-helper.sh \
  scripts/run-update-helper.sh \
  scripts/run-provisioning-helper.sh; do
  if ! git diff --quiet "$rel" 2>/dev/null; then
    echo "    Reset $rel (local drift — re-applied after pull)"
    git checkout -- "$rel"
  fi
done

#!/usr/bin/env bash
# Download Dragonite binary using UnownHash/Dragonite-Public helpers
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/services/dragonite/binary"
mkdir -p "$TARGET"

if [ -x "$TARGET/dragonite" ]; then
  echo "Dragonite binary already present at $TARGET/dragonite"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Cloning Dragonite-Public installer..."
git clone --depth 1 https://github.com/UnownHash/Dragonite-Public.git "$TMP/dragonite-public"

echo ""
echo "Dragonite is closed-source. Follow the installer in:"
echo "  $TMP/dragonite-public"
echo ""
echo "Copy the compiled binary to:"
echo "  $TARGET/dragonite"
echo ""
echo "Then copy config:"
echo "  cp services/dragonite/config/config.toml.example services/dragonite/config/config.toml"
echo ""
echo "Opening installer README..."
if [ -f "$TMP/dragonite-public/README.md" ]; then
  sed -n '1,80p' "$TMP/dragonite-public/README.md"
fi

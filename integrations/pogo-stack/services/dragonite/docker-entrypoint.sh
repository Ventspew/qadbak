#!/usr/bin/env bash
set -euo pipefail

BIN="/binary/dragonite"
if [ ! -x "$BIN" ]; then
  echo "Dragonite binary missing."
  echo "Run: bash scripts/install-dragonite.sh"
  echo "Expected executable at services/dragonite/binary/dragonite"
  sleep infinity
fi

exec "$BIN" -c /config/config.toml

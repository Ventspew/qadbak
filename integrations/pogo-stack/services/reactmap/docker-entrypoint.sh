#!/usr/bin/env bash
set -euo pipefail

cd /usr/src/app

if [ ! -d node_modules ]; then
  npm ci
fi

if [ -f /usr/src/app/config/local.json ]; then
  cp /usr/src/app/config/local.json ./config/local.json
fi

exec npm run start

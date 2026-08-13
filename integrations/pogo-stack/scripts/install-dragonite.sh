#!/usr/bin/env bash
# Pull official Dragonite image + render config.toml
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${DRAGONITE_IMAGE:-ghcr.io/unownhash/dragonite-public:latest}"

echo "Pulling $IMAGE ..."
docker pull "$IMAGE"

bash scripts/render-config.sh
bash scripts/ensure-databases.sh

echo ""
echo "Dragonite ready via official image:"
echo "  $IMAGE"
echo "Config:"
echo "  config/rendered/dragonite.toml"
echo ""
echo "Start with:"
echo "  docker compose --profile mapping up -d dragonite"

#!/usr/bin/env bash
# Render config templates with values from .env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env first."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

mkdir -p config/rendered

python3 - <<'PY'
import os
import pathlib
import re

def render_env(path_in: str, path_out: str) -> None:
    text = pathlib.Path(path_in).read_text()

    def repl(match: re.Match[str]) -> str:
        return os.environ.get(match.group(1), match.group(0))

    pathlib.Path(path_out).write_text(re.sub(r"\$\{([^}]+)\}", repl, text) + "\n")

render_env("config/golbat.toml", "config/rendered/golbat.toml")
print("Rendered config/rendered/golbat.toml")
PY

mkdir -p config/cosmog/rendered
PUBLIC_IP="${SERVER_PUBLIC_IP:-127.0.0.1}"
COSMOG_TOKEN="${COSMOG_TOKEN:-change-me-cosmog-token}"
ROTOM_SECRET="${ROTOM_SECRET:-change-me-rotom-secret}"
WORKERS_PER_CONTAINER="${COSMOG_WORKERS_PER_CONTAINER:-17}"

python3 - <<PY
import json, os, pathlib, copy

template = json.loads(pathlib.Path("config/cosmog/cosmog.json.template").read_text())
out_dir = pathlib.Path("config/cosmog/rendered")
out_dir.mkdir(parents=True, exist_ok=True)

count = int(os.environ.get("REDROID_INSTANCES", "2"))
for i in range(1, count + 1):
    cfg = copy.deepcopy(template)
    cfg["device_id"] = f"redroid-{i}"
    cfg["public_ip"] = os.environ.get("SERVER_PUBLIC_IP", "127.0.0.1")
    cfg["token"] = os.environ.get("COSMOG_TOKEN", "change-me")
    cfg["rotom_secret"] = os.environ.get("ROTOM_SECRET", "change-me")
    cfg["workers"] = int(os.environ.get("COSMOG_WORKERS_PER_CONTAINER", "17"))
    (out_dir / f"{i}.json").write_text(json.dumps(cfg, indent=2) + "\n")
print(f"Rendered {count} Cosmog configs in config/cosmog/rendered/")
PY

python3 - <<PY
import json, os, pathlib
src = pathlib.Path("config/reactmap/local.json")
dst = pathlib.Path("config/rendered/reactmap.local.json")
data = json.loads(src.read_text())
db = data.setdefault("database", {})
db["password"] = os.environ.get("DB_PASSWORD", db.get("password", ""))
db["username"] = os.environ.get("DB_USER", db.get("username", "pogo"))
data.setdefault("api", {})["reactMapSecret"] = os.environ.get("REACTMAP_SECRET", "change-me")
dst.write_text(json.dumps(data, indent=2) + "\n")
print("Rendered config/reactmap/local.json")
PY

echo "Rendered configs in config/rendered/"

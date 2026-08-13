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

render_env("config/rotom/local.json.template", "config/rendered/rotom.local.json")
print("Rendered config/rendered/rotom.local.json")

render_env(
    "services/dragonite/config/config.toml.example",
    "config/rendered/dragonite.toml",
)
print("Rendered config/rendered/dragonite.toml")
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

python3 - <<'PY'
import json, os, pathlib

src = pathlib.Path("config/reactmap/local.json")
dst = pathlib.Path("config/rendered/reactmap.local.json")
data = json.loads(src.read_text())

user = os.environ.get("DB_USER", "pogo")
password = os.environ.get("DB_PASSWORD", "change-me-pogo")
rm_secret = os.environ.get("REACTMAP_SECRET", "change-me-reactmap")
golbat_secret = os.environ.get("GOLBAT_API_SECRET", "")
start_lat = float(os.environ.get("MAP_START_LAT", "52.3676"))
start_lon = float(os.environ.get("MAP_START_LON", "4.9041"))

api = data.setdefault("api", {})
api["reactMapSecret"] = rm_secret
api.setdefault("sessionSecret", rm_secret)

general = data.setdefault("map", {}).setdefault("general", {})
general["startLat"] = start_lat
general["startLon"] = start_lon
general.setdefault("geoJsonFileName", "areas.json")

schemas = data.setdefault("database", {}).setdefault("schemas", [])
for schema in schemas:
    if schema.get("type") == "golbat":
        schema["endpoint"] = "http://golbat:9001"
        schema["secret"] = golbat_secret
        continue
    if "host" in schema:
        schema["host"] = "mariadb"
        schema["port"] = 3306
        schema["username"] = user
        schema["password"] = password

dst.write_text(json.dumps(data, indent=2) + "\n")
print("Rendered config/rendered/reactmap.local.json")
PY

echo "Rendered configs in config/rendered/"

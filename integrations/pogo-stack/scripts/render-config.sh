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

python3 - <<'PY'
from pathlib import Path
import os
import re

src = Path("config/rotom/rotom.toml.template")
dst = Path("config/rendered/rotom.toml")
text = src.read_text()

def repl(match: re.Match[str]) -> str:
    return os.environ.get(match.group(1), match.group(0))

dst.write_text(re.sub(r"\$\{([^}]+)\}", repl, text))
print("Rendered config/rendered/rotom.toml")
PY

mkdir -p config/cosmog/rendered

python3 - <<PY
import json, os, pathlib, copy

template = json.loads(pathlib.Path("config/cosmog/cosmog.json.template").read_text())
out_dir = pathlib.Path("config/cosmog/rendered")
out_dir.mkdir(parents=True, exist_ok=True)

count = int(os.environ.get("REDROID_INSTANCES", "2"))
internal_ws = os.environ.get("ROTOM_INTERNAL_WS", "ws://rotom:7070").rstrip("/")
for i in range(1, count + 1):
    cfg = copy.deepcopy(template)
    cfg["device_id"] = f"redroid-{i}"
    cfg["rotom_worker_endpoint"] = internal_ws
    cfg["rotom_device_endpoint"] = f"{internal_ws}/control"
    cfg["public_ip"] = os.environ.get("SERVER_PUBLIC_IP", "127.0.0.1")
    cfg["token"] = os.environ.get("COSMOG_TOKEN", "change-me")
    cfg["rotom_secret"] = os.environ.get("ROTOM_SECRET", "change-me")
    cfg["workers"] = int(os.environ.get("COSMOG_WORKERS_PER_CONTAINER", "17"))
    (out_dir / f"{i}.json").write_text(json.dumps(cfg, indent=2) + "\n")
print(f"Rendered {count} Redroid Cosmog configs in config/cosmog/rendered/")

android_template = json.loads(pathlib.Path("config/cosmog/android.json.template").read_text())
public_ip = os.environ.get("SERVER_PUBLIC_IP", "127.0.0.1")
public_ws = os.environ.get("ROTOM_PUBLIC_WS", f"ws://{public_ip}:7070").rstrip("/")
android_ids = [x.strip() for x in os.environ.get("ANDROID_DEVICE_IDS", "").split(",") if x.strip()]
for entry in os.environ.get("ANDROID_DEVICES", "").split(","):
    entry = entry.strip()
    if not entry:
        continue
    device_id = entry.split("@", 1)[0].strip()
    if device_id and device_id not in android_ids:
        android_ids.append(device_id)

for device_id in android_ids:
    cfg = copy.deepcopy(android_template)
    cfg["device_id"] = device_id
    cfg["rotom_worker_endpoint"] = public_ws
    cfg["rotom_device_endpoint"] = f"{public_ws}/control"
    cfg["public_ip"] = public_ip
    cfg["token"] = os.environ.get("COSMOG_TOKEN", "change-me")
    cfg["rotom_secret"] = os.environ.get("ROTOM_SECRET", "change-me")
    cfg["workers"] = int(os.environ.get("ANDROID_WORKERS_PER_DEVICE", "8"))
    (out_dir / f"android-{device_id}.json").write_text(json.dumps(cfg, indent=2) + "\n")
if android_ids:
    print(f"Rendered {len(android_ids)} Android Cosmog configs: {', '.join(android_ids)}")

ios_template_path = pathlib.Path("config/exeggcute/ios.json.template")
if ios_template_path.exists():
    ios_template = json.loads(ios_template_path.read_text())
    ios_out = pathlib.Path("config/exeggcute/rendered")
    ios_out.mkdir(parents=True, exist_ok=True)
    ios_ids = [x.strip() for x in os.environ.get("IOS_DEVICE_IDS", "").split(",") if x.strip()]
    for entry in os.environ.get("IOS_DEVICES", "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        device_id = entry.split("@", 1)[0].strip()
        if device_id and device_id not in ios_ids:
            ios_ids.append(device_id)
    for device_id in ios_ids:
        cfg = copy.deepcopy(ios_template)
        cfg["device_name"] = device_id
        cfg["rotom_url"] = public_ws
        cfg["rotom_secret"] = os.environ.get("ROTOM_SECRET", "change-me")
        cfg["api_key"] = os.environ.get("EXEGGCUTE_API_KEY", "change-me")
        cfg["workers_count"] = int(os.environ.get("IOS_WORKERS_PER_DEVICE", "4"))
        (ios_out / f"ios-{device_id}.json").write_text(json.dumps(cfg, indent=2) + "\n")
    if ios_ids:
        print(f"Rendered {len(ios_ids)} iOS Exeggcute configs: {', '.join(ios_ids)}")
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
general.setdefault(
    "geoJsonFileName",
    "http://koji:8080/api/v1/geofence/feature-collection/default",
)

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

#!/usr/bin/env bash
# Builds the Python loop into one executable and drops it where Tauri bundles sidecars.
# Run before `npm run tauri build`. Then add to ui/src-tauri/tauri.conf.json:
#   "bundle": { "externalBin": ["binaries/looper-service"] }
set -euo pipefail
cd "$(dirname "$0")/.."
triple="$(rustc -vV | sed -n 's/host: //p')"
uv run --with pyinstaller pyinstaller --onefile --name looper-service \
  --paths . --collect-all langgraph --collect-all acp \
  --add-data "registry:registry" scripts/entry.py
mkdir -p ui/src-tauri/binaries
cp dist/looper-service "ui/src-tauri/binaries/looper-service-$triple"
echo "sidecar: ui/src-tauri/binaries/looper-service-$triple"

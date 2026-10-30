#!/usr/bin/env bash
# Build a self-contained macOS app and installer for the current architecture.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/build-sidecar.sh
cd ui
npm run tauri build -- --bundles app,dmg

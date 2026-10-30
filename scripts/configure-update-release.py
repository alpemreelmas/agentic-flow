"""Inject public distribution settings only for signed tag builds."""
import json
import os
import re
from pathlib import Path
import tomllib

config_path = Path("ui/src-tauri/tauri.conf.json")
config = json.loads(config_path.read_text())
version = os.environ["RELEASE_TAG"].removeprefix("v")
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
    raise SystemExit("Only stable vMAJOR.MINOR.PATCH releases are supported")
versions = [config["version"], json.loads(Path("ui/package.json").read_text())["version"], tomllib.loads(Path("ui/src-tauri/Cargo.toml").read_text())["package"]["version"]]
if any(v != version for v in versions):
    raise SystemExit(f"Tag version {version} must match all application versions: {versions}")
key = os.environ.get("UPDATER_PUBLIC_KEY", "").strip()
if not key:
    raise SystemExit("Set repository variable TAURI_UPDATER_PUBLIC_KEY before publishing")
config["plugins"]["updater"]["pubkey"] = key
config["bundle"]["createUpdaterArtifacts"] = True
config_path.write_text(json.dumps(config, indent=2) + "\n")

"""Publish only complete macOS ARM64 + Linux x64 signed update sets."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

root = Path("release-assets")
tag = os.environ["RELEASE_TAG"]
repo = os.environ["GITHUB_REPOSITORY"]
platforms = {}
for target, pattern in [("darwin-aarch64", "*.app.tar.gz"), ("linux-x86_64", "*.AppImage")]:
    matches = list(root.rglob(pattern))
    if len(matches) != 1:
        raise SystemExit(f"Expected one {target} artifact, found {matches}")
    artifact = matches[0]
    signature = Path(str(artifact) + ".sig").read_text().strip()
    if not signature:
        raise SystemExit(f"Missing signature for {target}")
    platforms[target] = {"signature": signature, "url": f"https://github.com/{repo}/releases/download/{quote(tag, safe='')}/{quote(artifact.name, safe='')}"}
Path("latest.json").write_text(json.dumps({"version": tag.removeprefix("v"), "notes": f"Linear Looper {tag}", "pub_date": datetime.now(timezone.utc).isoformat(), "platforms": platforms}, indent=2) + "\n")

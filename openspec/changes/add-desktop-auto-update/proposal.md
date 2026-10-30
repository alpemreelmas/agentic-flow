# Change: Signed desktop auto updates

## Why
Installed copies need to receive new releases without downloading and replacing the app manually.

## What Changes
- Add the Tauri v2 updater with a pinned public signing key and HTTPS release manifest.
- Check at startup and every six hours while open; automatically download newer stable releases.
- Show download progress and a ready-to-install state. Apply on explicit install/restart after the daemon is stopped, chats are closed and unsaved state is resolved.
- Publish signed app bundles, signatures and latest.json through GitHub Releases in alpemreelmas/agentic-flow, triggered by version tags (v*).
- Package the UI and Python sidecar together on every release; preserve user data and registry edits.

## Impact
New capability: desktop-updates. Affects Tauri initialization, frontend update status, daemon lifecycle, bundle configuration and GitHub Actions release workflow.
Initial scope: macOS Apple Silicon, stable channel. Existing installs require one manual installation of the first updater-enabled release.
Implementation added. Distribution requires repository signing variables/secrets and the first signed tag release.

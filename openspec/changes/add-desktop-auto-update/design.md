# Design

Use tauri-plugin-updater and an HTTPS latest.json manifest hosted with GitHub Releases. Embed only the public updater key in the app; keep the private key and password in CI secrets. Updater signatures are required independently of Apple code signing/notarization.

A pushed v* tag starts a macOS ARM64 build. Verify that package.json, Cargo.toml and tauri.conf.json versions match the tag. Build a fresh Python sidecar with locked dependencies, build the app with createUpdaterArtifacts enabled, sign updater artifacts, upload all files to a draft release, then publish the complete release with its manifest. Never advertise an artifact before its upload completes. A normal source commit does not publish a release.

On startup and every six hours, check for a greater semantic version matching the current platform. Prevent overlapping checks/downloads. Download automatically and expose checking, downloading, ready, deferred and error states. Support manual check/retry. Offline or failed checks leave the installed app usable; reject invalid signatures and never automatically downgrade.

The daemon intentionally outlives the window. Before replacing the app, block new work, wait for active tasks and chats to finish, stop the owned daemon and confirm its exit. Resolve unsaved registry edits and active chat state before restart. Defer installation if safe quiescence cannot be established. After restart, resume only if the daemon was previously running. Preserve user configuration, credentials, databases, runs and edited registry files; never overwrite them with bundled defaults. Database migrations must be compatible or back up data before a destructive migration.

The repository currently has no updater dependency or release workflow. Hosting assumes public downloadable release assets; a private repository needs a public distribution repository or authenticated update service. Do not embed GitHub tokens in the desktop app. Confirm hosting visibility before implementation. Apple distribution certificates/notarization credentials and updater signing secrets must be configured before public distribution.

Reference: https://v2.tauri.app/plugin/updater/

## Implementation decision
Installation requires explicit confirmation, a stopped daemon and no open chat sessions. The updater never sends a stop signal to the loop: heartbeat-based idle checks race with task pickup. The user can finish work and install later. Startup retains the existing daemon autostart policy. Linux automatic replacement is supported for AppImage only; .deb remains a manual installation format. Public signing key is injected into tag builds from a repository variable; private signing key remains a CI secret.

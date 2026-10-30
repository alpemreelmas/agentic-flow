# Desktop updates

Signed tag builds check GitHub Releases at startup and every six hours and download newer versions automatically. Click “Kur ve yeniden başlat” after stopping the loop, closing chats and saving changes. Installation is deliberately explicit: the daemon outlives the window and must not be interrupted by an update. The new app follows its usual daemon autostart behavior on restart. Registry edits are protected; a confirmation covers unsaved settings and chat drafts.

## One-time GitHub setup

1. Generate keys on a trusted machine: `cd ui && npm run tauri signer generate -- --write-keys /secure/path/looper.key`. Keep the private key and its backup outside the repository.
2. Set repository variable `TAURI_UPDATER_PUBLIC_KEY` to the **contents** of `looper.key.pub`.
3. Set Actions secret `TAURI_SIGNING_PRIVATE_KEY` to the **contents** of `looper.key`; set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to its password if used.
4. Ensure release assets are publicly downloadable. A private source repository requires a public distribution repository or another HTTPS update endpoint; adjust both `tauri.conf.json` and `update-manifest.py` to that destination. Never embed a GitHub token in the app.
5. Enable GitHub Actions and permit this workflow to write releases. Configure Apple signing/notarization separately before distributing a trusted macOS release; updater signatures do not replace Apple signing.

## Publish

Set the same version in `ui/package.json`, its lockfile, `ui/src-tauri/Cargo.toml`, its lockfile and `ui/src-tauri/tauri.conf.json`. Push a stable tag such as `v0.2.0`. The build matrix creates fresh Python sidecars and signed updater artifacts; only after both platforms succeed does the release job generate `latest.json`, upload all assets to a draft release and publish it. Existing tag releases cause publication to fail rather than overwrite an installed release. Retry after reviewing/deleting an unpublished draft if needed. Use a new version for fixes.

Normal PR/branch builds create installers without update signing or an embedded distribution key. Only tag builds inject the public key and enable updater artifacts. Do not distribute unsigned branch builds as updater-enabled releases.

Supported updates: macOS ARM64 app bundles and Linux x64 **AppImage** installations. Debian packages can be installed manually but do not support Tauri in-place updates. Keep AppImage files in a writable location. The first updater-enabled version must be installed manually.

Downloads are verified by Tauri against the embedded public key. Failed network/signature checks leave the current installation intact and can be retried. Downloads are held in memory until installation or application exit. No updater path writes user data or overwrites edited registry entries. There are no database schema changes in this feature.

## Validation

Before the first public release, install signed version A and update it to B on macOS and Linux AppImage. Check offline behavior, invalid signatures, active daemon/chat rejection and preservation of user data. Build success alone does not validate the live release endpoint or operating-system installation permissions.

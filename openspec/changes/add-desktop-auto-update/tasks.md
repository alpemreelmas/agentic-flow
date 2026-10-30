## 1. Release setup
- [ ] Confirm public update hosting, stable channel and macOS ARM64 scope.
- [ ] Generate updater keys securely; configure CI secrets and app public key.
- [ ] Configure Apple signing and notarization for distribution.

## 2. Implementation
- [x] Add Tauri updater dependencies, initialization, permissions and endpoint.
- [x] Enable updater artifacts and add version consistency checks.
- [x] Implement startup/periodic checks, automatic download, progress and manual retry.
- [x] Require daemon lock availability, closed chats, resolved edits and explicit installation/restart.
- [x] Add tag-triggered CI: fresh sidecar, app build, signing, complete release publication.

## 3. Verification and rollout
- [ ] Test offline/no-update, newer-version, concurrent checks, failed download and invalid signature.
- [ ] Test update deferral during tasks/chats and with unsaved edits; verify daemon shutdown/resume.
- [ ] Install version A and update to version B on a clean Mac; verify user data survives.
- [ ] Publish the first updater-enabled installer and document the one-time manual installation.

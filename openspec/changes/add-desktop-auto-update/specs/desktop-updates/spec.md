## ADDED Requirements

### Requirement: Automatic update discovery and download
The desktop app SHALL check for newer stable releases at startup and every six hours while open, and automatically download an eligible signed update.

#### Scenario: New release exists
- **WHEN** a greater compatible version is advertised
- **THEN** the app downloads it once and displays progress and readiness

#### Scenario: Network unavailable
- **WHEN** update discovery or download fails
- **THEN** the current app remains usable and the user can retry

### Requirement: Trusted release artifacts
The app SHALL accept only compatible update artifacts verified with its pinned signing key.

#### Scenario: Invalid signature
- **WHEN** verification fails
- **THEN** installation is rejected and the current version remains installed

### Requirement: Safe installation
The app SHALL defer installation until the user requests installation, unsaved state is resolved, all chats are closed and the daemon lock is available; installation SHALL preserve user data.

#### Scenario: Active task or unsaved edits
- **WHEN** a downloaded update is ready while work or unsaved state exists
- **THEN** installation waits and the app exposes a deferred state

#### Scenario: Safe restart
- **WHEN** installation proceeds after quiescence
- **THEN** the app restarts with preserved data and uses the existing daemon autostart policy

### Requirement: Atomic release publication
Release automation SHALL publish matching versioned UI and sidecar artifacts, signatures and manifest only after all release assets are available.

#### Scenario: Tagged release
- **WHEN** a valid version tag is pushed and the build succeeds
- **THEN** automation publishes a complete signed release for supported targets

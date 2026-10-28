## ADDED Requirements

### Requirement: Shared workspace record
The system SHALL store a workspace centrally as a name, a normalized repository remote URL, and a Linear project identifier, without any machine-specific path.

#### Scenario: Workspace created
- **WHEN** an admin creates a workspace for `git@github.com:acme/bifrost.git`
- **THEN** the stored remote URL is normalized so that the SSH and HTTPS forms of the same repository compare equal

### Requirement: Local checkout binding
The Looper client SHALL map each shared workspace to a local checkout path in a machine-local file, matching by normalized remote URL and allowing an explicit per-machine override.

#### Scenario: Automatic binding
- **WHEN** the local checkout's `origin` URL matches a shared workspace's remote
- **THEN** the client binds that workspace to the checkout path

#### Scenario: No local checkout
- **WHEN** a user is a member of a workspace but has no matching local checkout
- **THEN** the client lists it as "not bound", allows reading its decisions, and does not run tasks or chat-with-code for it

### Requirement: Task routing unchanged
The system SHALL keep routing a task by its Linear project to a bound, enabled workspace and SHALL NOT run a task whose project matches no bound workspace.

#### Scenario: Unmatched project
- **WHEN** a task arrives whose Linear project matches no bound workspace
- **THEN** the task is left alone and nothing runs in any repository

### Requirement: Legacy single-user mode
The system SHALL keep working with the existing `workspaces.json` and no memory service when no service URL is configured.

#### Scenario: No service configured
- **WHEN** `memory_url` is not set
- **THEN** routing, chat and task runs behave exactly as before and no memory features appear to fail

### Requirement: Workspace import
The system SHALL provide a command that creates shared workspaces from entries of an existing `workspaces.json` and reports each created, skipped or failed entry.

#### Scenario: Re-running import
- **WHEN** the import command is run twice
- **THEN** the second run creates nothing and reports existing workspaces as skipped

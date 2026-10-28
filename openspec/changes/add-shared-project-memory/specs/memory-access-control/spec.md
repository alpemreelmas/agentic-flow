## ADDED Requirements

### Requirement: Authenticated access only
The system SHALL require a valid, non-revoked API token on every API and MCP request except the health endpoint, and SHALL resolve each token to exactly one member.

#### Scenario: Missing token
- **WHEN** a request has no token
- **THEN** the system responds 401 and returns no data

#### Scenario: Revoked token
- **WHEN** a request uses a revoked token
- **THEN** the system responds 401

### Requirement: Token handling
The system SHALL store only a hash of each token, SHALL show the plaintext token exactly once at creation, SHALL record last use, and SHALL NOT write tokens to logs.

#### Scenario: Token created
- **WHEN** an admin issues a token
- **THEN** the plaintext is returned once and only its hash is persisted

### Requirement: Workspace isolation
The system SHALL scope every read and write to workspaces where the caller is a member, and SHALL respond as if a workspace does not exist when the caller is not a member.

#### Scenario: Cross-workspace read
- **WHEN** a member of workspace A requests a decision id belonging to workspace B
- **THEN** the system responds 404 and reveals nothing about the decision

#### Scenario: Cross-workspace search
- **WHEN** a member searches
- **THEN** results come only from the workspace named in the request, and the request fails if the caller is not a member of it

### Requirement: Role-based permissions
The system SHALL enforce four roles per workspace: `viewer` may read; `contributor` may also propose decisions, edit own proposals, post sessions and create links; `approver` may also accept, reject and supersede; `admin` may also manage members and tokens.

#### Scenario: Contributor tries to accept
- **WHEN** a contributor calls accept on a proposed decision
- **THEN** the system responds 403 and the status is unchanged

#### Scenario: Viewer tries to propose
- **WHEN** a viewer posts a decision
- **THEN** the system responds 403

### Requirement: Agent clients are capped
The system SHALL limit write capability of MCP and agent-originated requests to proposing decisions and posting sessions, regardless of the token owner's role.

#### Scenario: Approver's token used through MCP
- **WHEN** a tool call over MCP is made with an approver's token and attempts a status change
- **THEN** no such tool exists and the status cannot be changed through MCP

### Requirement: Audit trail
The system SHALL write an immutable audit row for every mutating request, recording actor, client type, action, target and time, and SHALL make the log readable by approvers and admins of that workspace.

#### Scenario: Acceptance audited
- **WHEN** an approver accepts ADR-5
- **THEN** an audit row records the approver, action `accept`, target ADR-5 and timestamp

### Requirement: Request limits
The system SHALL bound request body size and apply per-token rate limiting, returning 413 and 429 respectively when exceeded.

#### Scenario: Oversized body
- **WHEN** a client posts a body above the configured limit
- **THEN** the system responds 413 and stores nothing

## ADDED Requirements

### Requirement: MCP endpoint
The system SHALL expose the memory over an MCP endpoint using HTTP transport, authenticated with the same tokens and workspace membership rules as the HTTP API.

#### Scenario: Authenticated client lists tools
- **WHEN** Codex CLI or Claude Code connects with a valid token
- **THEN** the server returns the tool list

#### Scenario: Unauthenticated client
- **WHEN** a client connects without a valid token
- **THEN** the connection is refused

### Requirement: Read tools
The MCP server SHALL provide `list_workspaces`, `search_decisions`, `get_decision` and `get_workspace_status`, each limited to workspaces the token's member belongs to.

#### Scenario: Search from another client
- **WHEN** Claude Code calls `search_decisions` for "token rotation"
- **THEN** it receives matching decisions with ids, status, rationale and links, the same data the chat sees

#### Scenario: Foreign workspace
- **WHEN** a tool names a workspace the member does not belong to
- **THEN** the tool returns a not-found error

### Requirement: Propose-only write tool
The MCP server SHALL provide `propose_decision`, which creates a `proposed` decision attributed to the token's member and to client type `mcp`, and SHALL NOT provide any tool that accepts, rejects, supersedes, deletes, or edits accepted decisions.

#### Scenario: Agent proposes
- **WHEN** Codex calls `propose_decision` after a planning discussion
- **THEN** a `proposed` decision is created and an approver must accept it before it is treated as a team decision

#### Scenario: Tool surface is fixed
- **WHEN** the tool list is enumerated
- **THEN** it contains no tool that changes decision status

### Requirement: Memory does not grant repository access
The MCP server SHALL NOT provide file, shell, git or pull request tools, and connecting to it SHALL NOT grant the client any additional repository or execution permission.

#### Scenario: Client wants to edit code
- **WHEN** a client needs to change code
- **THEN** it uses its own local tools under its own permissions; the memory service offers none

### Requirement: Untrusted content labeling
MCP tool results SHALL mark decision text as stored data, and the server SHALL NOT include instructions addressed to the calling agent in results.

#### Scenario: Result shape
- **WHEN** `get_decision` returns
- **THEN** the content is structured fields, with no free-form directives to the agent

### Requirement: Client setup documentation
The project SHALL document how to register the MCP server with Codex CLI and Claude Code, including token creation and revocation.

#### Scenario: New teammate
- **WHEN** a teammate follows the setup docs
- **THEN** they can run a search from their client within one session without custom code

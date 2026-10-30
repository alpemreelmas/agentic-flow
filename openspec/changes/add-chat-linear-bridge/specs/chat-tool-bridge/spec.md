## ADDED Requirements

### Requirement: Application-managed MCP provisioning
The application SHALL provision a session-scoped MCP proxy for embedded ACP chats without requiring users to edit agent CLI or MCP configuration.

#### Scenario: Supported adapter starts
- **WHEN** a chat starts with a compatible adapter and connected workspace
- **THEN** the application supplies its packaged stdio MCP proxy through the ACP session configuration

#### Scenario: Adapter lacks required support
- **WHEN** the adapter cannot expose tools with the required permission boundary
- **THEN** the app visibly disables bridge tools while preserving repository discussion

### Requirement: Credential and session isolation
The bridge SHALL keep Linear credentials in the trusted broker, bind each proxy capability to its chat and workspace, and reject arbitrary upstream requests.

#### Scenario: Agent process launched
- **WHEN** a chat and its agent subprocess start
- **THEN** Linear credentials are absent from their environment, arguments, prompts and emitted events

#### Scenario: Capability reused outside its session
- **WHEN** a revoked capability or an attempt to target another workspace reaches the broker
- **THEN** the request is rejected without performing a Linear operation

### Requirement: Separate repository and service permissions
The chat SHALL retain its repository read-only policy while allowing only the declared bridge service operations; unrelated edit and execute permissions SHALL remain denied.

#### Scenario: Linear issue mutation
- **WHEN** a scoped bridge write tool is called under the session's allowed capabilities
- **THEN** the broker performs the allowed service operation without granting repository write or shell access

#### Scenario: Unrelated tool requests write permission
- **WHEN** another tool requests edit or execute permission
- **THEN** the existing repository read-only restriction remains effective

### Requirement: Managed bridge lifecycle
The application SHALL revoke session capabilities and clean up broker and proxy processes when a chat closes or fails, and SHALL invalidate access when its Linear key is removed.

#### Scenario: Chat closes
- **WHEN** the user closes a chat
- **THEN** its bridge capability stops working and its processes are cleaned up without stopping the autonomous loop

#### Scenario: Key removed
- **WHEN** the user removes the Linear key
- **THEN** subsequent bridge tool calls fail with connection guidance and do not use a stale credential

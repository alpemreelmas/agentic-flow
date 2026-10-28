## ADDED Requirements

### Requirement: Decision anchors
When a decision is created from a chat, the client SHALL record the commit it was based on (`base_commit`) and the repository-relative files it referenced (`anchors`).

#### Scenario: Anchors captured
- **WHEN** a draft is saved from a session that read `auth/TokenProvider.java` at commit abc123
- **THEN** the decision stores base commit abc123 and that file as an anchor

#### Scenario: Paths stay inside the repo
- **WHEN** a draft lists a path outside the workspace root
- **THEN** that path is dropped from the anchors

### Requirement: Local freshness check
Clients with a checkout SHALL compute freshness by comparing anchors between `base_commit` and the current HEAD, and SHALL report `fresh` when no anchor changed, `stale` when any changed or was deleted, and `unknown` when the base commit is not available locally.

#### Scenario: Anchor changed
- **WHEN** `auth/TokenProvider.java` was modified after the decision's base commit
- **THEN** the decision is reported `stale` with the changed file named

#### Scenario: Base commit missing
- **WHEN** the base commit cannot be found in the local repository
- **THEN** the decision is reported `unknown`, not `fresh`

### Requirement: Staleness is shown wherever decisions are shown
The chat context, the Decisions page and MCP responses for clients that supply freshness SHALL display the freshness state next to each accepted decision.

#### Scenario: Stale decision in chat
- **WHEN** an accepted decision is stale
- **THEN** the injected context marks it stale and tells the agent to verify against current code before relying on it

### Requirement: Current code outranks memory
The system SHALL instruct agents that when memory and the current checkout disagree, the checkout is authoritative, and SHALL surface the disagreement to the user.

#### Scenario: Contradiction
- **WHEN** an accepted decision says sessions live in Redis and the code no longer uses Redis
- **THEN** the agent reports the contradiction and does not present the decision as the current design

### Requirement: Stale decisions can be revisited
The system SHALL let an approver mark a stale decision for review or supersede it, without deleting history.

#### Scenario: Supersede stale decision
- **WHEN** an approver supersedes a stale decision with a new accepted one
- **THEN** the old decision remains readable with status `superseded`

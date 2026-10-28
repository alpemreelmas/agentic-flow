## ADDED Requirements

### Requirement: Decision record content
The system SHALL store each decision with a title, context, rationale, a list of considered alternatives (each with a reason it was chosen or rejected), open questions, tags, author, creation time, and status.

#### Scenario: Complete decision stored
- **WHEN** a contributor proposes a decision with title, context, rationale and two alternatives
- **THEN** the system stores all fields and returns the decision with status `proposed`

#### Scenario: Missing required field
- **WHEN** a proposal has no title or no rationale
- **THEN** the system rejects it with a validation error naming the missing field

### Requirement: Server-assigned decision numbers
The system SHALL assign each decision a per-workspace sequential identifier of the form `ADR-<n>` on creation, and clients SHALL NOT be able to choose or change it.

#### Scenario: Concurrent proposals
- **WHEN** two members propose decisions in the same workspace at the same moment
- **THEN** each decision receives a distinct, gap-free-on-success number and neither request fails because of the other

#### Scenario: Client supplies a number
- **WHEN** a create request includes a number field
- **THEN** the system ignores it and assigns the next number

### Requirement: Decision status lifecycle
The system SHALL allow only these status transitions: `proposed` to `accepted`, `proposed` to `rejected`, and `accepted` to `superseded`. A new decision SHALL always start as `proposed`.

#### Scenario: Illegal transition
- **WHEN** a request tries to move a `rejected` decision to `accepted`
- **THEN** the system refuses with a conflict error and the status is unchanged

#### Scenario: Supersede requires replacement
- **WHEN** an approver supersedes an accepted decision without naming the replacing decision
- **THEN** the system refuses the request

#### Scenario: Supersede links both records
- **WHEN** an approver supersedes ADR-3 by accepted ADR-9
- **THEN** ADR-3 has status `superseded` and references ADR-9, and ADR-9 shows that it supersedes ADR-3

### Requirement: Acceptance is explicit and attributed
The system SHALL record who accepted or rejected a decision and when, and SHALL NOT infer acceptance from discussion, saved sessions, or the passage of time.

#### Scenario: Approver accepts
- **WHEN** an approver accepts a `proposed` decision
- **THEN** the decision becomes `accepted` with the approver and timestamp recorded

#### Scenario: Proposal is never auto-accepted
- **WHEN** a proposed decision has existed for any length of time without an approver action
- **THEN** its status remains `proposed`

### Requirement: Rejected decisions remain visible
The system SHALL keep rejected and superseded decisions queryable and SHALL label them with their status wherever they are shown.

#### Scenario: Rejected idea surfaces
- **WHEN** a search matches a rejected decision
- **THEN** the result is returned with status `rejected` and its rationale, never presented as approved

### Requirement: Revision history
The system SHALL keep an append-only history of content edits to a decision, and SHALL permit content edits only while the decision is `proposed`.

#### Scenario: Edit while proposed
- **WHEN** the author edits the rationale of a `proposed` decision
- **THEN** a new revision is stored and the previous text remains retrievable

#### Scenario: Edit after acceptance
- **WHEN** someone edits the content of an `accepted` decision
- **THEN** the system refuses and tells the caller to propose a superseding decision

### Requirement: Search
The system SHALL support full-text search over title, context, rationale and tags, with filters for status, tag and anchor file, scoped to one workspace.

#### Scenario: Status filter
- **WHEN** a client searches for "session" with status `accepted`
- **THEN** only accepted decisions in that workspace are returned

### Requirement: Conflict hints
The system SHALL flag a new proposal that shares anchors or tags with an existing `proposed` or `accepted` decision as a possible conflict, and SHALL NOT merge, overwrite or auto-resolve either decision.

#### Scenario: Overlapping proposals
- **WHEN** a member proposes a decision anchored on `auth/TokenProvider.java` while another open decision has the same anchor
- **THEN** the new decision lists the other as `possible_conflict_with` and both stay `proposed`/`accepted` unchanged

### Requirement: No secrets in stored text
The system SHALL redact values that match secret patterns (API keys, bearer tokens, private key blocks) from any text before storing it.

#### Scenario: Token pasted into a draft
- **WHEN** a proposal body contains an API key
- **THEN** the stored text contains a redaction marker instead of the key

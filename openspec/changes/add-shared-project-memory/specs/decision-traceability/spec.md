## ADDED Requirements

### Requirement: Decision to task link
The system SHALL allow creating a Linear task from an accepted decision and SHALL record the task as a link on the decision.

#### Scenario: Task from accepted decision
- **WHEN** a contributor creates a task from accepted ADR-7
- **THEN** a Linear task is created with the decision summary and a `linear_task` link is stored on ADR-7

#### Scenario: Task from proposed decision
- **WHEN** a task is requested from a decision that is still `proposed`
- **THEN** the system refuses and says the decision must be accepted first

### Requirement: Decision context in task runs
When a task is linked to an accepted decision, the task graph SHALL include that decision's rationale and acceptance notes in the context given to triage and the implementer, below the task text in authority.

#### Scenario: Linked decision used
- **WHEN** a task linked to ADR-7 enters triage
- **THEN** the triage prompt includes ADR-7's rationale as guidance

#### Scenario: Task text wins
- **WHEN** the decision context conflicts with the task text
- **THEN** the prompt states that the task text takes precedence

### Requirement: PR and commit links on delivery
After a successful delivery the harness SHALL record the pull request URL and head commit on the linked decision and SHALL mention the decision id in the pull request body.

#### Scenario: Delivery succeeds
- **WHEN** a task linked to ADR-7 is delivered as a PR
- **THEN** ADR-7 gains `pr` and `commit` links and the PR body references ADR-7

#### Scenario: Delivery fails
- **WHEN** delivery fails or tests do not pass
- **THEN** no `pr` link is recorded and the decision is not marked implemented

### Requirement: Idempotent links
The system SHALL ignore duplicate link writes of the same kind and reference.

#### Scenario: Retried delivery
- **WHEN** delivery is re-run on the same branch and PR
- **THEN** the decision has one link for that PR

### Requirement: Memory outage never blocks work
Link writes SHALL be queued locally and retried when the service is unreachable, and a task SHALL NOT fail, retry or park because of a memory outage.

#### Scenario: Service down during delivery
- **WHEN** the PR is created but the service is unreachable
- **THEN** the task completes, the link write is queued, and it is delivered on a later run

### Requirement: Implementation is not asserted by code alone
The system SHALL display a decision as having an implementing PR only from recorded links, and SHALL NOT claim a decision is implemented when no such link exists.

#### Scenario: Accepted without PR
- **WHEN** an accepted decision has no `pr` link
- **THEN** it is shown as accepted and not implemented

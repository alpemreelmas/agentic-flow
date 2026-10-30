## ADDED Requirements

### Requirement: Workspace-scoped Linear tools
The application SHALL expose issue search, read, metadata, create and update tools to an embedded ACP chat using its configured Linear project and existing application credentials.

#### Scenario: User prepares a task
- **WHEN** the user requests task creation and a connected workspace has a valid project and team
- **THEN** the chat creates the issue in that project and returns its identifier and URL without requesting CLI configuration

#### Scenario: Missing mapping or foreign issue
- **WHEN** a workspace has no project mapping or an issue belongs to another project
- **THEN** the tool returns an actionable error without guessing the project or exposing the foreign issue

### Requirement: Explicit autonomous handoff
The application SHALL separate preparation from submission and SHALL use the existing configured ready state and loop label for submission.

#### Scenario: Draft creation
- **WHEN** a task is created without an explicit submission tool call
- **THEN** it is created in the configured non-polled blocked state without automatically adding the loop label

#### Scenario: Submit prepared task
- **WHEN** the chat invokes submission following the user's request to hand off the task
- **THEN** the bridge sets the configured ready state and loop label and reports eligibility for the existing loop without starting a second executor

#### Scenario: Bypass through generic update
- **WHEN** create or update would produce a polled state together with the loop label
- **THEN** the operation is rejected and submission is required

### Requirement: Consistent task mutations
The bridge SHALL reject edits to in-progress tasks, detect observed version conflicts, coordinate with local daemon intake and avoid blind retries of uncertain mutations.

#### Scenario: Task claimed during editing
- **WHEN** daemon intake claims an issue before the bridge obtains its issue lock
- **THEN** the bridge rechecks the issue and rejects the edit if it is in progress

#### Scenario: Create response lost
- **WHEN** a create mutation may have succeeded but its response is unavailable
- **THEN** the bridge reconciles the request record before another create and reports uncertainty if success cannot be established

### Requirement: Existing skills and visible results
The chat SHALL retain existing skill selection and SHALL surface tool success, failure, issue links and actual queue eligibility.

#### Scenario: Product owner skill selected
- **WHEN** an available product-owner skill is selected for a task preparation turn
- **THEN** its content is composed using the existing skill mechanism and the resulting task can be written through the Linear tools

#### Scenario: Linear unavailable
- **WHEN** a Linear call fails
- **THEN** the chat reports failure without claiming an issue was created or submitted and remains available for discussion

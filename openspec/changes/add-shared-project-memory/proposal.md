# Change: Shared Project Memory (decisions, sessions, traceability)

## Why
Looper already reads live code, brainstorms in a read-only chat, and delivers reviewed PRs. It has
no memory: each chat starts from zero, rejected alternatives are forgotten, and nothing links a
discussion to the task and PR that implemented it. Teams switching between the desktop chat,
Codex CLI and Claude Code must re-explain context every time.

Repository-local decision files were considered and rejected: drafts would pollute shared history,
ADR numbers would collide between people, access control would be tied to repo access only, and
recording a thought would require a commit. The system is multi-user, so memory needs a shared,
access-controlled home.

## What Changes
- **NEW** shared memory service (HTTP API, FastAPI + PostgreSQL) holding workspaces, members,
  decisions, brainstorm sessions, links and an audit log.
- **NEW** decision lifecycle: `proposed -> accepted | rejected`, `accepted -> superseded`.
  Only authorized roles can accept; agents and MCP clients can only propose.
- **NEW** workspace split: shared workspace record (remote URL, Linear project) on the server,
  machine-local binding (checkout path) stays local. **BREAKING** for `workspaces.json` format:
  a migration is provided and the old file keeps working for single-user, offline use.
- **NEW** chat integration: relevant decisions injected at session start; "save as decision" at the
  end creates a `proposed` record. Chat remains read-only; the harness writes, not the agent.
- **NEW** traceability: decision <-> Linear task <-> PR <-> commit, written by the harness during
  task intake and delivery.
- **NEW** freshness: decisions record the commit and files they were based on; consumers get a
  stale warning when those files changed.
- **NEW** MCP server (HTTP transport) exposing read tools and `propose_decision` to external clients.
- **NEW** conflict handling: contradicting proposals are surfaced to the approver, never merged
  silently.

Out of scope: vector search, graph database, GitHub webhook sync, autonomous merging, remote code
execution on the server.

## Impact
- Affected specs (all new): `decision-records`, `memory-access-control`, `shared-workspaces`,
  `chat-memory`, `decision-traceability`, `decision-freshness`, `memory-mcp`
- Affected code: `looper/chat.py`, `looper/workspaces.py`, `looper/graph.py` (context in),
  `looper/deliver.py` (PR link out), `looper/sources.py` (task intake link), `looper/main.py`,
  new `looper/memory_client.py`, new `memory_service/` package, `ui/src-tauri/src/{chat,config}.rs`,
  `ui/src/pages/` (decisions page), `workspaces.json` format.
- Risk: introduces a network dependency. Mitigation: all consumers degrade to "no memory" with a
  visible notice; task execution never blocks on the memory service.

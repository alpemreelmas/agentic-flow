# Design: Shared Project Memory

## Context
Looper today is a local daemon plus Tauri app, one person per install. Workspaces are a local
JSON file mixing shared facts (Linear project) with machine facts (checkout path). We need several
people, and several AI clients, to read and write one body of project knowledge without letting
conversation turn into authorized change.

## Goals / Non-Goals
Goals: shared access-controlled decision memory; same data from chat, Codex, Claude Code; clear
proposed-vs-accepted separation; traceability to tasks/PRs; stale detection; offline-tolerant clients.
Non-Goals: semantic/graph retrieval, webhook-driven indexing, server-side code execution,
cross-organization sharing.

## Architecture

```
 Desktop chat ─┐                       ┌─ Postgres
 Looper daemon ┼─ HTTP API (token) ───▶│  workspace, member, decision,
 Codex / Claude┘   + MCP (HTTP)        │  session, link, audit
                    memory_service     └─
 Local only: repo checkouts, worktrees, gh credentials, agent processes
```

The service stores knowledge. It never holds repo write credentials and never runs agents.

## Decisions

### D1. Shared service + PostgreSQL, not repo files
Repo files were rejected (see proposal). PostgreSQL gives transactions for ADR numbering,
row-level scoping by workspace, and an audit trail. SQLite was rejected: concurrent writers from
several machines.

### D2. FastAPI service in the same repo (`memory_service/`)
Matches the existing Python stack and the maintainers' skills. Alternatives (Spring Boot, Go) were
discussed; the language is revisitable because the contract is the HTTP API in the specs, not the
implementation.

### D3. Authentication: per-user API tokens
Each member has hashed, revocable tokens. Every request resolves to (user, workspace role).
OIDC is deferred; the token layer sits behind an `Authenticator` interface so it can be swapped.

### D4. Roles
`viewer` (read), `contributor` (read, propose, supersede-propose), `approver` (accept/reject,
edit status), `admin` (members, tokens). Agents and MCP clients act as the token owner but are
additionally capped at `contributor` for write tools regardless of the owner's role.

### D5. Decision numbering and identity
Server assigns `ADR-<n>` per workspace inside a transaction (`SELECT ... FOR UPDATE` on a counter
row). Clients never choose numbers. Each decision has an immutable UUID and an append-only
revision history; status changes are separate audit rows.

### D6. Status machine
`proposed -> accepted`, `proposed -> rejected`, `accepted -> superseded` (requires `superseded_by`).
No other transitions. Only `approver`+ performs `accepted/rejected`. Rejected decisions stay
queryable; they are what stops a rejected idea resurfacing as approved.

### D7. Harness writes, agents do not
The chat agent stays under the existing read-only policy. A "save as decision" action asks the
agent for a structured draft (title, context, alternatives, rationale, open questions, referenced
files), the harness validates it and POSTs it as `proposed`. This mirrors `deliver.py`.

### D8. Workspace split
`workspace` (server): id, name, remote URL, Linear project id. `binding` (local file): workspace id
-> checkout path. Resolution is by normalized remote URL match with explicit local override.
`workspaces.json` v1 is auto-migrated; if no service URL is configured the old local-only behavior
is unchanged.

### D9. Freshness via recorded anchors
A decision stores `base_commit` and `anchors` (repo-relative file paths). A freshness check diffs
`base_commit..HEAD` over anchors locally (clients have the checkout) and reports `fresh`, `stale`
(anchors changed) or `unknown` (commit not found). The server never inspects code.

### D10. Conflicts surfaced, never merged
On creating a proposal, the server compares it with open `proposed`/`accepted` decisions in the
workspace using shared anchors and normalized topic tags and flags `possible_conflict_with`.
This is a heuristic hint for the approver, not a gate.

### D11. Failure behavior
Clients treat the service as optional. Unreachable service: chat starts without memory and says so;
daemon runs tasks without decision context; link writes are queued in a local outbox and retried.
Task execution must never fail because memory is down.

### D12. Prompt-injection posture
Stored decision text and repo content are data. When injected into prompts they are fenced and
labeled as untrusted reference material; the PREAMBLE states that they carry no authority over
tools or permissions.

## Data Model (logical)
- workspace(id, name, remote_url, linear_project_id, adr_counter, created_at)
- member(id, display_name, created_at); membership(workspace_id, member_id, role)
- api_token(id, member_id, token_hash, label, created_at, revoked_at, last_used_at)
- decision(id, workspace_id, number, title, status, context, rationale, alternatives jsonb,
  open_questions jsonb, tags text[], base_commit, anchors text[], author_id, approver_id,
  superseded_by, session_id, created_at, updated_at)
- decision_revision(id, decision_id, body jsonb, editor_id, created_at)
- session(id, workspace_id, author_id, summary, open_questions jsonb, client, created_at)
- link(id, decision_id, kind[linear_task|pr|commit], ref, created_at)
- audit(id, workspace_id, actor_id, client, action, target, detail jsonb, created_at)

## API Surface (v1, JSON)
- `GET/POST /v1/workspaces`, `GET /v1/workspaces/{id}`
- `GET /v1/workspaces/{id}/decisions?status=&q=&tag=`, `POST ...` (creates `proposed`)
- `GET /v1/decisions/{id}`, `PATCH /v1/decisions/{id}` (content, while `proposed`)
- `POST /v1/decisions/{id}/accept|reject|supersede`
- `POST /v1/decisions/{id}/links`
- `POST /v1/workspaces/{id}/sessions`
- `GET /v1/workspaces/{id}/audit`
- `/mcp` MCP endpoint (HTTP transport)

## Search
PostgreSQL full-text (`tsvector` over title, context, rationale, tags) plus exact tag and anchor
filters. Embeddings are deferred until retrieval quality is shown to be a problem.

## Migration
1. Deploy service empty. 2. Admin creates workspaces from existing `workspaces.json` entries
(`looper memory import-workspaces`). 3. Members and tokens issued. 4. Clients opt in by setting
`memory_url`/`memory_token`. Without them behavior is unchanged. Rollback: unset the config.

## Risks / Trade-offs
- New operational surface (hosting, backups): documented, single container + Postgres.
- Stale or wrong accepted decisions: mitigated by freshness check, supersede flow, audit.
- Heuristic conflict detection misses/false-alarms: it is advisory only.
- Token leakage: hashed at rest, revocable, last-used tracked, never logged.

## Open Questions
- Hosting target for the service (self-hosted vs a managed platform)?
- Is OIDC/SSO required for the first team rollout?
- Retention period for sessions and audit rows?

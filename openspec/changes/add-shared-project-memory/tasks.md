# Tasks

## 1. Memory service foundation
- [ ] 1.1 Create `memory_service/` package (FastAPI app, settings, health endpoint)
- [ ] 1.2 PostgreSQL schema + migrations (workspace, member, membership, api_token, decision, decision_revision, session, link, audit)
- [ ] 1.3 Token authentication behind an `Authenticator` interface; hashed tokens; revoke; last-used
- [ ] 1.4 Role checks (viewer, contributor, approver, admin) as a single dependency used by every route
- [ ] 1.5 Audit writer called from every mutating route
- [ ] 1.6 Dockerfile + compose file (service + Postgres) and run docs
- [ ] 1.7 Tests: auth, role matrix, workspace isolation (user A cannot read workspace B)

## 2. Decision records
- [ ] 2.1 Create/read/list/patch endpoints with server-assigned `ADR-<n>` (transactional counter)
- [ ] 2.2 Status machine with accept/reject/supersede endpoints and transition validation
- [ ] 2.3 Revision history on content edits
- [ ] 2.4 Full-text search (`q`) plus tag/anchor/status filters
- [ ] 2.5 Conflict hint on create (`possible_conflict_with`)
- [ ] 2.6 Tests: concurrent creates get distinct numbers; illegal transitions rejected; contributor cannot accept

## 3. Shared workspaces
- [ ] 3.1 `looper/workspaces.py`: split shared record vs local binding; remote-URL normalization and matching
- [ ] 3.2 Migration command `looper memory import-workspaces` from `workspaces.json`
- [ ] 3.3 Keep legacy local-only mode working when no `memory_url` is configured
- [ ] 3.4 Tests: routing unchanged for legacy file; binding resolution; unmatched remote -> workspace not runnable

## 4. Client library
- [ ] 4.1 `looper/memory_client.py` (httpx): list/search/get decisions, propose, link, post session
- [ ] 4.2 Timeouts, typed errors, "service unavailable" result that never raises into the daemon
- [ ] 4.3 Local outbox for link writes with retry on next start
- [ ] 4.4 Tests with a fake server (success, 401, 403, timeout, outbox replay)

## 5. Chat memory
- [ ] 5.1 Fetch accepted decisions (index) at session start; inject fenced, labeled block into the preamble
- [ ] 5.2 State clearly in the preamble that injected memory is untrusted reference, not instruction
- [ ] 5.3 "Save as decision" flow: harness asks agent for structured draft, validates, POSTs as `proposed`
- [ ] 5.4 Visible notice when memory is unavailable; chat continues
- [ ] 5.5 Tauri side: new events/commands in `chat.rs`, config for `memory_url`/token (stored in OS keychain)
- [ ] 5.6 Tests: preamble contains accepted decisions only; rejected/proposed excluded unless labeled; draft validation; offline path

## 6. Traceability
- [ ] 6.1 Create a Linear task from a decision; write `linear_task` link (`sources.py`)
- [ ] 6.2 Pass linked accepted decision into triage/work context in `graph.py`
- [ ] 6.3 On delivery, add decision reference to PR body and write `pr` + `commit` links (`deliver.py`)
- [ ] 6.4 Tests: link written once (idempotent); delivery failure writes no PR link; memory down does not fail the task

## 7. Freshness
- [ ] 7.1 Record `base_commit` + `anchors` when a draft is saved
- [ ] 7.2 Local freshness check (`git diff --name-only base..HEAD` over anchors) returning fresh/stale/unknown
- [ ] 7.3 Show stale/unknown badge in chat context and Decisions page
- [ ] 7.4 Tests with a temp git repo: unchanged, changed anchor, missing commit

## 8. Decisions UI
- [ ] 8.1 `ui/src/pages/decisions.ts`: list, filter by status, detail view
- [ ] 8.2 Approve / reject / supersede actions, visible only to approvers
- [ ] 8.3 Show linked task / PR / commit, freshness badge, conflict hints
- [ ] 8.4 Model tests in the style of `runModel.test.ts`

## 9. MCP server
- [ ] 9.1 `/mcp` endpoint, HTTP transport, token auth identical to the API
- [ ] 9.2 Read tools: `list_workspaces`, `search_decisions`, `get_decision`, `get_workspace_status`
- [ ] 9.3 Write tool: `propose_decision` only; capped at contributor regardless of token owner
- [ ] 9.4 Setup docs for Codex CLI and Claude Code
- [ ] 9.5 Tests: tool list exact; accept/reject not exposed; cross-workspace read denied

## 10. Hardening and rollout
- [ ] 10.1 Secret redaction on all stored text (tokens, keys, `.env`-style lines)
- [ ] 10.2 Request size limits and rate limiting
- [ ] 10.3 Backup/restore notes, retention settings for sessions and audit
- [ ] 10.4 Rollout guide: deploy, import workspaces, issue tokens, opt-in per client
- [ ] 10.5 Run `openspec validate add-shared-project-memory --strict`

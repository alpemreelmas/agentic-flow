# Project Context

## Purpose
Linear Looper turns Linear tasks into reviewed pull requests with a coding agent, and offers a
brainstorming chat over the same repositories. This project is extending it with a **shared,
persistent project memory**: decisions, brainstorm sessions and their links to tasks and PRs,
usable by several people and several AI clients (desktop chat, Codex CLI, Claude Code).

## Tech Stack
- Python 3.12: `looper/` (daemon, LangGraph per-task graph, ACP executor, chat)
- ACP (`agent-client-protocol`) to drive coding agents
- LangGraph + SQLite checkpoints for task runs
- Tauri 2 + TypeScript desktop app: `ui/`
- New: a shared memory service (FastAPI + PostgreSQL), see `changes/add-shared-project-memory`

## Conventions
- Harness code does the writing; the agent never gets push rights or credentials (`deliver.py`).
- Chat is read-only on the repository; approved application service tools may create/edit Linear tasks and explicitly submit them to the loop. Conversation does not authorize checkout changes.
- Routing is plain code; the model only acts inside `work` and `review`.
- A task whose Linear project matches no enabled workspace is not run (no guessing).
- Tests: pytest (`tests/`), vitest for UI models. New modules ship with tests.
- Comments are sparse and explain why, not what.

## Domain Context
- **Workspace**: a git repository plus the Linear project whose tasks belong in it.
- **Decision (ADR)**: a recorded architectural decision with rationale and alternatives.
- **Code state vs decision memory**: the live repository is authoritative for what the code does;
  memory records why, and is treated as possibly stale.

## Important Constraints
- Multi-user: more than one person uses the same memory. Single-user assumptions are not allowed
  in shared components.
- Code execution stays on each user's machine, with that user's credentials.
- No secret material is stored in memory.

## External Dependencies
- Linear API, GitHub (via the user's `gh` CLI), PostgreSQL (shared service only)

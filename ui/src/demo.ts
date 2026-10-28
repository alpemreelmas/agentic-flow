// Dev-only sample data so the screens can be viewed in a plain browser (no Tauri). Never bundled in production.
import type { RunEvent } from "./runModel.ts";

const t0 = Date.now() / 1000 - 400;
const ev = (run: string, i: number, type: string, data: Record<string, unknown> = {}): [string, RunEvent] => [run, { ts: t0 + i * 8, type, ...data }];

export const DEMO: [string, RunEvent][] = [
  ev("20260101T000000-LIN-4021", 0, "run_start", { title: "LIN-4021 Refactor Auth Token Cache with Redis fallback", role: "implementer" }),
  ev("20260101T000000-LIN-4021", 1, "triage_start", { role: "product-manager", cli: "claude" }),
  ev("20260101T000000-LIN-4021", 2, "triage_result", { decision: "proceed", size: "small", summary: "Add an in-memory LRU in front of Redis.", plan: ["Add LRU", "Fall back to Redis on miss"], acceptance_criteria: ["Redis failover <300ms"], risks: ["Stale tokens"], questions: [], proposed_verify: "pnpm test" }),
  ev("20260101T000000-LIN-4021", 3, "attempt_start", { attempt: 1, role: "implementer", cli: "claude" }),
  ev("20260101T000000-LIN-4021", 4, "agent_thought", { text: "Expired JWT tokens continue to authenticate if the replica lags. Use a local LRU first." }),
  ev("20260101T000000-LIN-4021", 5, "tool_call", { id: "t1", title: "Read tokenCache.ts", status: "completed", tool_kind: "read", raw_input: { path: "src/tokenCache.ts" }, content: [{ type: "content", content: { type: "text", text: "export class TokenCacheManager {}" } }] }),
  ev("20260101T000000-LIN-4021", 6, "tool_call", { id: "t2", title: "Edit tokenCache.ts", status: "completed", tool_kind: "edit", content: [{ type: "diff", path: "src/tokenCache.ts", old_text: "return await this.redis.get(key);", new_text: "const hit = this.lru.get(key);\nif (hit) return hit;\nreturn await this.redis.get(key);" }] }),
  ev("20260101T000000-LIN-4021", 7, "agent_message", { text: "Added an LRU in front of Redis.\n\n- `get()` checks the cache first\n- falls back to Redis" }),
  ev("20260101T000000-LIN-4021", 8, "verify", { ok: true, command: "pnpm test", output: "6 passed" }),
  ev("20260101T000000-LIN-4021", 9, "review_start", { reviewer: "tech-reviewer", cli: "claude" }),
  ev("20260101T000000-LIN-4021", 10, "review_result", { reviewer: "tech-reviewer", parsed: true, findings: [{ severity: "minor", file: "src/tokenCache.ts", line: 12, text: "Add a TTL to the LRU." }] }),
  ev("20260101T000000-LIN-4019", 0, "run_start", { title: "LIN-4019 Apply DB schema migration for permission tiers", role: "implementer" }),
  ev("20260101T000000-LIN-4019", 1, "triage_result", { decision: "needs_approval", size: "big", summary: "Destructive DDL.", plan: ["Migrate"], questions: [] }),
  ev("20260101T000000-LIN-4019", 2, "run_end", { status: "needs_human" }),
  ev("20260101T000000-LIN-4018", 0, "run_start", { title: "LIN-4018 Synthesize realtime telemetry protocol", role: "implementer" }),
  ev("20260101T000000-LIN-4018", 1, "attempt_start", { attempt: 1, role: "implementer", cli: "claude" }),
  ev("20260101T000000-LIN-4018", 2, "deliver", { ok: true, url: "https://github.com/acme/core/pull/1292", note: "", draft: false }),
  ev("20260101T000000-LIN-4018", 3, "run_end", { status: "review" }),
  ev("20260101T000000-LIN-4012", 0, "run_start", { title: "LIN-4012 Fix CSS overflow in Billing modal", role: "implementer" }),
  ev("20260101T000000-LIN-4012", 1, "agent_error", { error: "timeout waiting for locator" }),
  ev("20260101T000000-LIN-4012", 2, "run_end", { status: "needs_human" }),
];

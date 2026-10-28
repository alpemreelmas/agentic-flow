import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvent, type Run, type RunEvent } from "./runModel.ts";

const ev = (type: string, extra: Record<string, unknown> = {}): RunEvent => ({ ts: 1, type, ...extra });

function fold(events: RunEvent[]): Run {
  const runs = new Map<string, Run>();
  for (const e of events) applyEvent(runs, "r1", e);
  return runs.get("r1")!;
}

test("merges consecutive message chunks into one item", () => {
  const run = fold([ev("agent_message", { text: "Hel" }), ev("agent_message", { text: "lo" })]);
  assert.deepEqual(run.items, [{ kind: "message", text: "Hello" }]);
});

test("a tool call between messages splits them", () => {
  const run = fold([
    ev("agent_message", { text: "a" }),
    ev("tool_call", { id: "t", title: "Terminal", status: "pending" }),
    ev("agent_message", { text: "b" }),
  ]);
  assert.equal(run.items.length, 3);
});

test("tool_update changes the matching tool's status", () => {
  const run = fold([
    ev("tool_call", { id: "t", title: "Terminal", status: "pending" }),
    ev("tool_update", { id: "t", status: "completed" }),
  ]);
  assert.equal(run.items[0].kind === "tool" && run.items[0].status, "completed");
});

test("run lifecycle: start, failed verify, retry, success", () => {
  const run = fold([
    ev("run_start", { title: "Fix add()", role: "implementer" }),
    ev("attempt_start", { attempt: 1, role: "implementer", cli: "claude" }),
    ev("verify", { ok: false, output: "boom" }),
    ev("attempt_start", { attempt: 2, role: "implementer", cli: "claude" }),
    ev("verify", { ok: true, output: "" }),
    ev("run_end", { status: "review" }),
  ]);
  assert.equal(run.title, "Fix add()");
  assert.equal(run.status, "review");
  assert.deepEqual(run.items.map((i) => i.kind), ["attempt", "verify", "attempt", "verify"]);
});

test("run_end with any non-review status means needs_human; unfinished stays running", () => {
  assert.equal(fold([ev("run_end", { status: "needs_human" })]).status, "needs_human");
  assert.equal(fold([ev("run_start", { title: "x" })]).status, "running");
});

test("tool details: command, output text, diff; later updates replace earlier content", () => {
  const run = fold([
    ev("tool_call", { id: "t", title: "Terminal", tool_kind: "execute", status: "pending",
                      raw_input: { command: "ls calc*", description: "list" } }),
    ev("tool_update", { id: "t", content: [{ type: "content", content: { type: "text", text: "partial" } }] }),
    ev("tool_update", { id: "t", status: "completed", content: [
      { type: "content", content: { type: "text", text: "calc.py" } },
      { type: "diff", path: "calc.py", old_text: "a - b", new_text: "a + b" },
    ] }),
  ]);
  const tool = run.items[0];
  assert.equal(tool.kind, "tool");
  if (tool.kind !== "tool") return;
  assert.equal(tool.input, "ls calc*"); // shell input shows just the command
  assert.equal(tool.status, "completed");
  assert.deepEqual(tool.output, ["calc.py"]); // replaced, not appended
  assert.deepEqual(tool.diffs, [{ path: "calc.py", oldText: "a - b", newText: "a + b" }]);
});

test("non-shell tool input is shown as JSON; prompt and stop reason become items", () => {
  const run = fold([
    ev("prompt", { role: "reviewer", text: "# Role: reviewer" }),
    ev("tool_call", { id: "e", title: "Edit", raw_input: { file_path: "a.py" } }),
    ev("attempt_end", { stop_reason: "end_turn" }),
  ]);
  assert.deepEqual(run.items[0], { kind: "prompt", role: "reviewer", text: "# Role: reviewer" });
  assert.match((run.items[1] as { input: string }).input, /"file_path": "a.py"/);
  assert.deepEqual(run.items[2], { kind: "stop", reason: "end_turn" });
});

test("review events: header, findings with severities, skipped note", () => {
  const run = fold([
    ev("review_start", { reviewer: "tech-reviewer", cli: "claude" }),
    ev("review_result", { reviewer: "tech-reviewer", parsed: true, findings: [
      { severity: "blocking", file: "a.py", line: 3, text: "off by one" },
      { severity: "minor", file: "", line: null, text: "rename" },
    ] }),
    ev("review_skipped", { reason: "not a git checkout" }),
  ]);
  assert.deepEqual(run.items[0], { kind: "review", reviewer: "tech-reviewer", cli: "claude" });
  const f = run.items[1];
  assert.equal(f.kind === "findings" && f.findings.length, 2);
  assert.equal(f.kind === "findings" && f.findings[1].line, 0); // null line -> 0, never NaN
  assert.deepEqual(run.items[2], { kind: "note", text: "Review skipped: not a git checkout" });
});

test("deliver event becomes a PR item", () => {
  const run = fold([ev("deliver", { ok: true, url: "https://github.com/o/r/pull/7", note: "opened a PR", draft: false })]);
  assert.deepEqual(run.items[0], { kind: "deliver", ok: true, url: "https://github.com/o/r/pull/7", note: "opened a PR", draft: false });
});

test("triage events: stage header, result card, skipped note", () => {
  const run = fold([
    ev("triage_start", { role: "product-manager", cli: "claude" }),
    ev("triage_result", { decision: "needs_approval", size: "big", summary: "S", questions: [], plan: ["a", "b"],
                          criteria: ["c"], risks: [], proposed_verify: "pytest -q" }),
    ev("triage_skipped", { reason: "reply had no parsable JSON block" }),
  ]);
  assert.deepEqual(run.items[0], { kind: "stage", label: "Triage · product-manager · claude" });
  const t = run.items[1];
  assert.ok(t.kind === "triage" && t.decision === "needs_approval" && t.plan.length === 2 && t.proposedVerify === "pytest -q");
  assert.deepEqual(run.items[2], { kind: "note", text: "Triage skipped: reply had no parsable JSON block" });
});


test("chat: a user message breaks up the agent message chunks around it", () => {
  const runs = new Map<string, Run>();
  const ev = (type: string, text: string) => applyEvent(runs, "c", { ts: 1, type, text });
  ev("agent_message", "Hel"); ev("agent_message", "lo"); ev("user_message", "thanks"); ev("agent_message", "Sure");
  const items = runs.get("c")!.items;
  assert.deepEqual(items.map((i) => i.kind), ["message", "user", "message"]);
  assert.equal((items[0] as { text: string }).text, "Hello");
});

import asyncio
import json

from langgraph.checkpoint.memory import MemorySaver

from looper import graph as graph_mod
from looper.acp_executor import RunResult
from looper.registry import LocalRegistry


class FakeSource:
    def __init__(self): self.calls = []
    def mark_in_progress(self, tid): self.calls.append(("claim", tid))
    def finish(self, tid, status, comment): self.calls.append((status, tid))


def run_graph(tmp_path, monkeypatch, succeed_on, role="implementer", max_attempts=3):
    seen = []

    async def fake_run_prompt(agent, cwd, prompt, **kw):
        seen.append((agent, prompt, kw["auto_approve"]))
        kw["on_event"]({"type": "tool_call", "id": "1", "title": "Terminal", "status": "pending"})
        if len(seen) >= succeed_on:
            (tmp_path / "ok").write_text("x")
        return RunResult("did it", "end_turn")

    monkeypatch.setattr(graph_mod, "run_prompt", fake_run_prompt)
    src = FakeSource()
    g = graph_mod.build_graph(src, LocalRegistry("registry"), runs_dir=tmp_path / "runs", agent_override=None, max_attempts=max_attempts,
                              timeout=5, ask_permissions=False, quiet=True, checkpointer=MemorySaver())
    out = asyncio.run(g.ainvoke(
        {"task_id": "t1", "role": role, "title": "T", "description": "D",
         "verify_cmd": "test -f ok", "cwd": str(tmp_path)},
        {"configurable": {"thread_id": "t1"}}))
    return out, src, seen


def test_passes_first_try(tmp_path, monkeypatch):
    out, src, seen = run_graph(tmp_path, monkeypatch, succeed_on=1)
    assert src.calls == [("claim", "t1"), ("review", "t1")] and len(seen) == 1
    assert seen[0][0] == "claude" and seen[0][2] is True  # implementer: auto-approve


def test_retries_with_feedback_then_passes(tmp_path, monkeypatch):
    out, src, seen = run_graph(tmp_path, monkeypatch, succeed_on=2)
    assert len(seen) == 2 and "previous attempt failed" in seen[1][1]
    assert src.calls[-1] == ("review", "t1")


def test_escalates_after_max_attempts(tmp_path, monkeypatch):
    out, src, seen = run_graph(tmp_path, monkeypatch, succeed_on=99, max_attempts=2)
    assert len(seen) == 2 and src.calls[-1] == ("needs_human", "t1")


def test_review_role_denies_tool_calls(tmp_path, monkeypatch):
    _, _, seen = run_graph(tmp_path, monkeypatch, succeed_on=1, role="tech-reviewer")
    assert seen[0][2] is False and "# Skill: review-checklist" in seen[0][1]


def read_events(tmp_path):
    (log,) = (tmp_path / "runs").glob("*.jsonl")
    return [json.loads(line) for line in log.read_text().splitlines()]


def test_run_log_records_full_lifecycle(tmp_path, monkeypatch):
    run_graph(tmp_path, monkeypatch, succeed_on=2)
    types = [e["type"] for e in read_events(tmp_path)]
    assert types == ["run_start", "attempt_start", "prompt", "tool_call", "attempt_end", "verify",
                     "attempt_start", "prompt", "tool_call", "attempt_end", "verify", "run_end"]


def test_run_log_keeps_prompt_and_verify_output(tmp_path, monkeypatch):
    run_graph(tmp_path, monkeypatch, succeed_on=1)
    ev = read_events(tmp_path)
    prompt = next(e for e in ev if e["type"] == "prompt")
    assert prompt["role"] == "implementer" and "# Task" in prompt["text"]
    verify = next(e for e in ev if e["type"] == "verify")
    assert verify["command"] == "test -f ok" and verify["exit_code"] == 0


def test_run_log_marks_failure_and_escalation(tmp_path, monkeypatch):
    run_graph(tmp_path, monkeypatch, succeed_on=99, max_attempts=1)
    ev = read_events(tmp_path)
    assert [e for e in ev if e["type"] == "verify"][0]["ok"] is False
    assert ev[-1] == {**ev[-1], "type": "run_end", "status": "needs_human"}

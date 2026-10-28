import asyncio
import json

import pytest
from langgraph.checkpoint.memory import MemorySaver

from looper import graph as graph_mod
from looper.acp_executor import RunResult
from looper.deliver import Delivery
from looper.registry import LocalRegistry
from looper.triage import Triage, decide, format_comment, parse_triage


def reply(**over):
    data = {"actionable": True, "size": "small", "summary": "Add sub().", "questions": [],
            "assumptions": ["Plain numbers only."], "plan": ["Add sub to calc.py", "Test it"],
            "acceptance_criteria": ["sub(5, 3) == 2"], "proposed_verify": "python3 -m pytest -q", "risks": []}
    data.update(over)
    return "Short reasoning.\n\n```json\n" + json.dumps(data) + "\n```"


# ---- parser and decision ----------------------------------------------------------------------

def test_parse_valid_reply():
    t = parse_triage(reply())
    assert t.actionable and t.size == "small" and t.plan == ("Add sub to calc.py", "Test it")
    assert t.proposed_verify == "python3 -m pytest -q"


def test_parse_is_defensive():
    assert parse_triage("no json here") is None
    assert parse_triage('```json\n{"size": "small"}\n```') is None  # no actionable flag -> unusable
    assert parse_triage(reply(size="medium")).size == "big"  # unknown size: ask a human
    assert parse_triage(reply(proposed_verify="  ")).proposed_verify is None
    t = parse_triage(reply(actionable=False))  # unclear but nothing asked: a question is invented
    assert not t.actionable and len(t.questions) == 1


@pytest.mark.parametrize("over,approved,forced,expected", [
    ({"actionable": False, "questions": ["q?"]}, True, False, "needs_info"),
    ({"size": "big"}, False, False, "needs_approval"),
    ({"size": "big"}, True, False, "proceed"),
    ({"size": "small"}, False, True, "needs_approval"),  # label `big` overrides the model
    ({"size": "small"}, False, False, "proceed"),
])
def test_decision_matrix(over, approved, forced, expected):
    assert decide(parse_triage(reply(**over)), approved=approved, forced_big=forced) == expected


def test_comments_tell_the_human_what_to_do():
    t = parse_triage(reply(size="big", questions=["Which db?"]))
    assert "move the issue back to Todo" in format_comment(t, "needs_info")
    approval = format_comment(t, "needs_approval")
    assert "```verify\npython3 -m pytest -q\n```" in approval and "label `approved`" in approval
    proceed = format_comment(parse_triage(reply()), "proceed")
    assert "unverified" in proceed and "**Plan**" in proceed and "1. Add sub to calc.py" in proceed
    with_human = format_comment(parse_triage(reply()), "proceed", has_human_verify=True)
    assert "Proposed verification" not in with_human and "unverified" not in with_human
    assert '"actionable"' not in proceed  # never leak the raw JSON


# ---- inside the graph -------------------------------------------------------------------------

class Src:
    def __init__(self): self.finished, self.comments = [], []
    def mark_in_progress(self, tid): pass
    def comment(self, tid, body): self.comments.append(body)
    def finish(self, tid, status, comment): self.finished.append((status, comment))


class Deliv:
    def __init__(self): self.seen = None
    def deliver(self, **kw):
        self.seen = kw
        return Delivery(url="https://github.com/o/r/pull/1")


class Harness:
    def __init__(self, tmp_path, monkeypatch, replies):
        self.tmp, self.replies, self.prompts, self.src, self.deliv = tmp_path, list(replies), [], Src(), Deliv()

        async def fake(agent, cwd, prompt, **kw):
            role = prompt.split("# Role: ", 1)[1].split("\n", 1)[0]
            self.prompts.append((role, prompt))
            if role == "product-manager":
                r = self.replies.pop(0)
                if isinstance(r, Exception):
                    raise r
                return RunResult(r, "end_turn")
            (tmp_path / "ok").write_text("x")
            return RunResult("implemented", "end_turn")

        monkeypatch.setattr(graph_mod, "run_prompt", fake)
        self.graph = graph_mod.build_graph(
            self.src, LocalRegistry("registry"), runs_dir=tmp_path / "runs", agent_override=None, max_attempts=3,
            timeout=5, ask_permissions=False, quiet=True, checkpointer=MemorySaver(), deliverer=self.deliv,
            triager="product-manager")

    def run(self, **task):
        state = {"task_id": "t1", "title": "DEV-1 Add sub", "description": "Add sub(a, b).",
                 "verify_cmd": "test -f ok", "verified": True, "labels": [], "cwd": str(self.tmp), **task}
        asyncio.run(self.graph.ainvoke(state, {"configurable": {"thread_id": "t1"}}))
        return self

    @property
    def events(self):
        return [json.loads(l) for f in sorted((self.tmp / "runs").glob("*.jsonl")) for l in f.read_text().splitlines()]

    @property
    def implemented(self):
        return any(r == "implementer" for r, _ in self.prompts)


def test_unclear_task_stops_with_questions_and_no_code(tmp_path, monkeypatch):
    h = Harness(tmp_path, monkeypatch, [reply(actionable=False, questions=["Which currency?"])]).run()
    status, comment = h.src.finished[-1]
    assert status == "needs_human" and "Which currency?" in comment and not h.implemented
    assert h.events[-1]["type"] == "run_end"


def test_big_unapproved_task_waits_for_a_human(tmp_path, monkeypatch):
    h = Harness(tmp_path, monkeypatch, [reply(size="big")]).run(verified=False)
    status, comment = h.src.finished[-1]
    assert status == "needs_human" and "needs your approval" in comment and not h.implemented
    assert h.deliv.seen is None
    assert not (tmp_path / "ok").exists()  # the model's proposed command was never executed


def test_big_task_with_a_human_verify_block_proceeds_with_the_plan(tmp_path, monkeypatch):
    h = Harness(tmp_path, monkeypatch, [reply(size="big")]).run(verified=True)
    assert h.src.finished[-1][0] == "review" and h.implemented
    assert len(h.src.comments) == 1 and "### Triage (big)" in h.src.comments[0]
    impl = next(p for r, p in h.prompts if r == "implementer")
    assert "## Plan from triage" in impl and "1. Add sub to calc.py" in impl and "- sub(5, 3) == 2" in impl


def test_approved_label_counts_as_approval(tmp_path, monkeypatch):
    h = Harness(tmp_path, monkeypatch, [reply(size="big")]).run(verified=False, labels=["approved"])
    assert h.implemented and h.src.finished[-1][0] == "review"


def test_small_task_without_verify_goes_ahead_but_as_a_draft(tmp_path, monkeypatch):
    h = Harness(tmp_path, monkeypatch, [reply()]).run(verified=False, verify_cmd="true")
    assert h.implemented and h.deliv.seen["draft"] is True
    assert "unverified" in h.src.comments[0]


def test_big_label_forces_the_approval_gate(tmp_path, monkeypatch):
    h = Harness(tmp_path, monkeypatch, [reply(size="small")]).run(verified=False, labels=["big"])
    assert not h.implemented and "needs your approval" in h.src.finished[-1][1]


@pytest.mark.parametrize("bad", [RuntimeError("boom"), "I think it's fine, no JSON"])
def test_triage_failure_never_blocks_the_task(tmp_path, monkeypatch, bad):
    h = Harness(tmp_path, monkeypatch, [bad]).run()
    assert h.implemented and h.src.finished[-1][0] == "review" and h.src.comments == []
    assert any(e["type"] == "triage_skipped" for e in h.events)


def test_rerun_after_approval_is_not_poisoned_by_the_parked_run(tmp_path, monkeypatch):
    h = Harness(tmp_path, monkeypatch, [reply(size="big"), reply(size="big")])
    h.run(verified=False)
    assert h.src.finished[-1][0] == "needs_human" and not h.implemented
    h.run(verified=True)  # the human added a verify block and moved the issue back to Todo
    assert h.implemented and h.src.finished[-1][0] == "review"
    assert h.deliv.seen["draft"] is False

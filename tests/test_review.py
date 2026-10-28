import asyncio
import json
import subprocess

from langgraph.checkpoint.memory import MemorySaver

from looper import graph as graph_mod
from looper.acp_executor import RunResult
from looper.registry import LocalRegistry
from looper.review import git_diff, parse_review

BLOCK = '```json\n{"verdict": "changes_requested", "findings": [%s]}\n```'
BLOCKING = '{"severity": "blocking", "file": "a.py", "line": 3, "text": "off by one"}'
MINOR = '{"severity": "minor", "file": "a.py", "line": 1, "text": "rename x"}'


def test_parse_takes_last_block_and_severity_from_findings_only():
    text = "draft ```json\n{\"findings\": []}\n``` final:\n" + BLOCK % f"{BLOCKING}, {MINOR}"
    findings, ok = parse_review(text, "tech-reviewer")
    assert ok and [f.severity for f in findings] == ["blocking", "minor"]
    assert findings[0].render() == "[tech-reviewer] a.py:3: off by one"


def test_verdict_alone_never_blocks():
    findings, ok = parse_review(BLOCK % MINOR, "r")  # verdict says changes_requested, finding is minor
    assert ok and not any(f.severity == "blocking" for f in findings)


def test_unparsable_replies_are_reported_not_trusted():
    assert parse_review("looks good to me", "r") == ([], False)
    assert parse_review("```json\n{not json}\n```", "r") == ([], False)


def git(path, *args):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=path, check=True,
                   capture_output=True)


def make_repo(path):
    git(path, "init", "-q")
    (path / "a.py").write_text("x = 1\n")
    git(path, "add", "-A")
    git(path, "commit", "-qm", "base")


def test_git_diff_includes_edits_and_new_files_and_truncates(tmp_path):
    assert git_diff(str(tmp_path)) is None  # not a repo
    make_repo(tmp_path)
    assert git_diff(str(tmp_path)).strip() == ""
    (tmp_path / "a.py").write_text("x = 2\n")
    (tmp_path / "new.py").write_text("y = 1\n")
    diff = git_diff(str(tmp_path))
    assert "+x = 2" in diff and "new.py" in diff
    assert "truncated" in git_diff(str(tmp_path), limit=10)


class Src:
    def __init__(self): self.calls = []
    def mark_in_progress(self, tid): pass
    def finish(self, tid, status, comment): self.calls.append((status, comment))


def run_review(tmp_path, monkeypatch, replies, *, max_attempts=3, repo=True):
    """replies: role name -> list of reply texts, consumed one per call."""
    if repo:
        make_repo(tmp_path)
    prompts = []

    async def fake(agent, cwd, prompt, **kw):
        role = prompt.split("# Role: ", 1)[1].split("\n", 1)[0]
        prompts.append((role, prompt))
        if role == "implementer":
            (tmp_path / "a.py").write_text(f"x = {len([p for p in prompts if p[0] == 'implementer']) + 1}\n")
            (tmp_path / "ok").write_text("x")
            return RunResult("implemented", "end_turn")
        reply = replies[role].pop(0)
        if isinstance(reply, Exception):
            raise reply
        return RunResult(reply, "end_turn")

    monkeypatch.setattr(graph_mod, "run_prompt", fake)
    src = Src()
    g = graph_mod.build_graph(src, LocalRegistry("registry"), runs_dir=tmp_path / "runs", agent_override=None,
                              max_attempts=max_attempts, timeout=5, ask_permissions=False, quiet=True,
                              checkpointer=MemorySaver(), reviewers=("tech-reviewer", "product-reviewer"))
    asyncio.run(g.ainvoke({"task_id": "t1", "title": "T", "description": "D", "verify_cmd": "test -f ok",
                           "cwd": str(tmp_path)}, {"configurable": {"thread_id": "t1"}}))
    events = [json.loads(l) for f in (tmp_path / "runs").glob("*.jsonl") for l in f.read_text().splitlines()]
    return src, prompts, events


def test_clean_review_reports_with_minor_notes(tmp_path, monkeypatch):
    src, prompts, ev = run_review(tmp_path, monkeypatch, {
        "tech-reviewer": [BLOCK % MINOR], "product-reviewer": [BLOCK % ""]})
    status, comment = src.calls[-1]
    assert status == "review" and "rename x" in comment
    assert [e["reviewer"] for e in ev if e["type"] == "review_result"] == ["tech-reviewer", "product-reviewer"]
    assert "+x = 2" in prompts[1][1]  # the reviewer was handed the real diff


def test_blocking_finding_sends_work_back_then_passes(tmp_path, monkeypatch):
    src, prompts, ev = run_review(tmp_path, monkeypatch, {
        "tech-reviewer": [BLOCK % BLOCKING, BLOCK % ""], "product-reviewer": [BLOCK % "", BLOCK % ""]})
    impl = [p for r, p in prompts if r == "implementer"]
    assert len(impl) == 2 and "Code review found blocking issues" in impl[1] and "off by one" in impl[1]
    assert "failed verification" not in impl[1]  # retry wording matches the cause
    assert src.calls[-1][0] == "review"


def test_blocking_every_time_escalates_with_findings(tmp_path, monkeypatch):
    src, _, _ = run_review(tmp_path, monkeypatch, {
        "tech-reviewer": [BLOCK % BLOCKING] * 2, "product-reviewer": [BLOCK % ""] * 2}, max_attempts=2)
    status, comment = src.calls[-1]
    assert status == "needs_human" and "off by one" in comment


def test_not_a_git_checkout_skips_review(tmp_path, monkeypatch):
    src, prompts, ev = run_review(tmp_path, monkeypatch, {}, repo=False)
    assert src.calls[-1][0] == "review" and {r for r, _ in prompts} == {"implementer"}
    assert any(e["type"] == "review_skipped" for e in ev)


def test_crashed_or_unparsable_reviewer_does_not_block_but_is_visible(tmp_path, monkeypatch):
    src, _, _ = run_review(tmp_path, monkeypatch, {
        "tech-reviewer": [RuntimeError("boom")], "product-reviewer": ["no json here"]})
    status, comment = src.calls[-1]
    assert status == "review" and "reviewer failed" in comment and "no parsable JSON" in comment


def test_git_diff_ignores_build_byproducts(tmp_path):
    make_repo(tmp_path)
    (tmp_path / "a.py").write_text("x = 2\n")
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "__pycache__" / "a.cpython-312.pyc").write_bytes(b"\x00\x01binary")
    (tmp_path / ".DS_Store").write_bytes(b"\x00")
    diff = git_diff(str(tmp_path))
    assert "+x = 2" in diff and "pyc" not in diff and "DS_Store" not in diff
